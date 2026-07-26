using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.Json;

namespace Nyx.Desktop.Core.AccountStatus;

public enum PublisherConnectionState
{
    NotConnected,
    Connecting,
    Connected,
    LoginRequired,
    NeedsReview,
}

public enum DailyCheckInState
{
    NotStarted,
    Opening,
    Checking,
    Claiming,
    Claimed,
    AlreadyClaimed,
    LoginNeeded,
    Unavailable,
    CouldNotCheck,
}

public sealed record PublisherResourceSnapshot(
    string GameId,
    string ResourceName,
    int Current,
    int Maximum,
    DateTimeOffset ObservedAt,
    bool IsStale = false,
    int RecoverySeconds = 0,
    int? Reserve = null)
{
    public double Fraction => Maximum <= 0 ? 0 : Math.Clamp((double)Current / Maximum, 0, 1);
}

public sealed record DailyCheckInResult(
    string GameId,
    DailyCheckInState State,
    string Message,
    DateTimeOffset ObservedAt);

public sealed record PublisherAccountSummary(
    PublisherConnectionState HoyoLab,
    PublisherConnectionState Skport,
    IReadOnlyDictionary<string, PublisherResourceSnapshot> Resources,
    IReadOnlyDictionary<string, DailyCheckInResult> CheckIns)
{
    public static PublisherAccountSummary Empty { get; } = new(
        PublisherConnectionState.NotConnected,
        PublisherConnectionState.NotConnected,
        new ReadOnlyDictionary<string, PublisherResourceSnapshot>(
            new Dictionary<string, PublisherResourceSnapshot>(StringComparer.Ordinal)),
        new ReadOnlyDictionary<string, DailyCheckInResult>(
            new Dictionary<string, DailyCheckInResult>(StringComparer.Ordinal)));
}

public sealed record PublisherAccountCatalogEntry(
    string GameId,
    string Provider,
    Uri? CheckInUri,
    Uri? ResourceUri,
    string ResourceName,
    bool SupportsDailyCheckIn,
    bool SupportsNumericResource);

/// <summary>
/// A second, non-UI authorization boundary for publisher-account work. Unknown
/// providers always fail closed and revocation is visible to concurrent callers
/// before any cleanup begins.
/// </summary>
public sealed class PublisherAccountConsentGate(bool hoyoLabEnabled = false, bool skportEnabled = false)
{
    private int hoyoLab = hoyoLabEnabled ? 1 : 0;
    private int skport = skportEnabled ? 1 : 0;

    public bool IsEnabled(string provider) => provider switch
    {
        "HoYoLAB" => Volatile.Read(ref hoyoLab) == 1,
        "SKPORT" => Volatile.Read(ref skport) == 1,
        _ => false,
    };

    public bool Set(string provider, bool enabled)
    {
        var value = enabled ? 1 : 0;
        switch (provider)
        {
            case "HoYoLAB":
                Interlocked.Exchange(ref hoyoLab, value);
                return true;
            case "SKPORT":
                Interlocked.Exchange(ref skport, value);
                return true;
            default:
                return false;
        }
    }
}

public sealed record PublisherCheckInDomContract(string ReadySelector);

public enum PublisherCheckInProof
{
    Invalid,
    LoginNeeded,
    Ready,
    Claimed,
    ClaimAccepted,
}

public enum PublisherResourceProof
{
    Invalid,
    LoginNeeded,
    Valid,
}

public enum PublisherSessionPurpose
{
    Connect,
    ConnectionProbe,
    CheckIn,
    Resource,
}

public enum PublisherResourceReadOutcome
{
    Valid,
    SelectionRequired,
    LoginRequired,
    NeedsReview,
}

public enum PublisherSessionProof
{
    Authenticated,
    LoginRequired,
    NeedsReview,
}

public enum PublisherWebResourceContext
{
    Document,
    Stylesheet,
    Image,
    Media,
    Font,
    Script,
    XmlHttpRequest,
    Fetch,
    Other,
}

public sealed record PublisherRoleBinding(string RoleId, string Server)
{
    // A debugger or accidental interpolation must not reveal the UID.
    public override string ToString() => nameof(PublisherRoleBinding);
}

public sealed record PublisherRoleChoice(PublisherRoleBinding Binding, string DisplayText)
{
    public override string ToString() => DisplayText;
}

public sealed record PublisherResourceCandidate(
    PublisherRoleBinding Binding,
    PublisherResourceSnapshot? Snapshot);

public sealed record PublisherResourceReadResult(
    PublisherResourceSnapshot? Snapshot,
    PublisherResourceReadOutcome Outcome,
    IReadOnlyList<PublisherResourceCandidate>? Candidates = null)
{
    public bool LoginRequired => Outcome == PublisherResourceReadOutcome.LoginRequired;
    public bool NeedsReview => Outcome == PublisherResourceReadOutcome.NeedsReview;
}

public sealed class PublisherClaimWriteAuthority
{
    private readonly object sync = new();
    private long generation;
    private string? armedGameId;
    private bool scopeActive;

    public IDisposable Arm(string gameId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(gameId);
        lock (sync)
        {
            if (scopeActive)
                throw new InvalidOperationException("A publisher claim write is already armed.");
            scopeActive = true;
            armedGameId = gameId;
            return new Scope(this, ++generation);
        }
    }

    public bool TryConsume(string gameId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(gameId);
        lock (sync)
        {
            if (!string.Equals(armedGameId, gameId, StringComparison.Ordinal)) return false;
            armedGameId = null;
            return true;
        }
    }

    private void Revoke(long scopeGeneration)
    {
        lock (sync)
        {
            if (generation == scopeGeneration)
            {
                armedGameId = null;
                scopeActive = false;
            }
        }
    }

    private sealed class Scope(
        PublisherClaimWriteAuthority owner,
        long generation) : IDisposable
    {
        private int disposed;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref disposed, 1) == 0)
                owner.Revoke(generation);
        }
    }
}

public sealed class PublisherResourceCaptureAuthority(
    string gameId,
    long generation,
    PublisherRoleBinding? expectedBinding = null)
{
    private const int MaximumRequests = 8;
    private readonly object sync = new();
    private readonly Dictionary<PublisherRoleBinding, int> pending = [];
    private readonly Dictionary<PublisherRoleBinding, int> processing = [];
    private readonly HashSet<PublisherRoleBinding> bindings = [];
    private readonly List<PublisherResourceCandidate> candidates = [];
    private int observedRequests;
    private int reserved;
    private int completed;
    private bool accepting;
    private bool sealedCapture;
    private bool overflow;
    private bool invalidProof;
    private bool loginRequired;

    public string GameId { get; } = gameId;
    public long Generation { get; } = generation;

    public bool Open(long requestGeneration)
    {
        lock (sync)
        {
            if (requestGeneration != Generation || sealedCapture) return false;
            accepting = true;
            return true;
        }
    }

    public bool TryReserve(
        long requestGeneration,
        string requestGameId,
        PublisherRoleBinding binding)
    {
        ArgumentNullException.ThrowIfNull(binding);
        lock (sync)
        {
            if (!accepting
                || sealedCapture
                || requestGeneration != Generation
                || !string.Equals(requestGameId, GameId, StringComparison.Ordinal))
                return false;

            observedRequests++;
            if (observedRequests > MaximumRequests)
            {
                overflow = true;
                return false;
            }
            bindings.Add(binding);
            if (expectedBinding is not null && binding != expectedBinding) return false;

            reserved++;
            pending[binding] = pending.GetValueOrDefault(binding) + 1;
            return true;
        }
    }

    public bool TryBeginResponse(long responseGeneration, PublisherRoleBinding binding)
    {
        ArgumentNullException.ThrowIfNull(binding);
        lock (sync)
        {
            if (sealedCapture
                || responseGeneration != Generation
                || !pending.TryGetValue(binding, out var count)
                || count <= 0)
                return false;

            if (count == 1) pending.Remove(binding);
            else pending[binding] = count - 1;
            processing[binding] = processing.GetValueOrDefault(binding) + 1;
            return true;
        }
    }

    public bool CompleteResponse(
        long responseGeneration,
        PublisherRoleBinding binding,
        PublisherResourceProof proof,
        PublisherResourceSnapshot? snapshot)
    {
        ArgumentNullException.ThrowIfNull(binding);
        lock (sync)
        {
            if (sealedCapture
                || responseGeneration != Generation
                || !processing.TryGetValue(binding, out var count)
                || count <= 0)
                return false;

            if (count == 1) processing.Remove(binding);
            else processing[binding] = count - 1;
            completed++;
            switch (proof)
            {
                case PublisherResourceProof.LoginNeeded:
                    loginRequired = true;
                    break;
                case PublisherResourceProof.Valid when snapshot is not null:
                    candidates.Add(new(binding, snapshot));
                    break;
                default:
                    invalidProof = true;
                    break;
            }
            return true;
        }
    }

    public PublisherResourceReadResult Seal(long requestGeneration)
    {
        lock (sync)
        {
            accepting = false;
            sealedCapture = true;
            if (requestGeneration != Generation
                || overflow
                || invalidProof
                || pending.Count != 0
                || processing.Count != 0
                || reserved == 0
                || completed != reserved
                || (loginRequired && candidates.Count != 0))
                return new(null, PublisherResourceReadOutcome.NeedsReview);
            if (loginRequired)
                return new(null, PublisherResourceReadOutcome.LoginRequired);

            var snapshot = PublisherAccountCatalog.SelectUnambiguousResource(candidates);
            var captured = candidates
                .GroupBy(static candidate => candidate.Binding)
                .Select(static group => group.MaxBy(static candidate => candidate.Snapshot!.ObservedAt)!)
                .OrderBy(static candidate => candidate.Binding.Server, StringComparer.Ordinal)
                .ThenBy(static candidate => candidate.Binding.RoleId, StringComparer.Ordinal)
                .ToArray();
            if (snapshot is null && expectedBinding is null && captured.Length > 1)
                return new(null, PublisherResourceReadOutcome.SelectionRequired, captured);
            return snapshot is null
                ? new(null, PublisherResourceReadOutcome.NeedsReview)
                : new(snapshot, PublisherResourceReadOutcome.Valid, captured);
        }
    }

    public void Cancel()
    {
        lock (sync)
        {
            accepting = false;
            sealedCapture = true;
        }
    }
}

public enum PublisherProfileMutationCommitPoint
{
    Unchanged,
    MayHaveChanged,
    Deleted,
}

public readonly record struct PublisherProfileMutationSnapshot(
    long Revision,
    PublisherProfileMutationCommitPoint CommitPoint);

public sealed class PublisherProfileMutationJournal
{
    private readonly object sync = new();
    private long revision;
    private PublisherProfileMutationCommitPoint commitPoint;

    public PublisherProfileMutationSnapshot Capture()
    {
        lock (sync)
            return new(revision, commitPoint);
    }

    public void MarkMayHaveChanged()
    {
        lock (sync)
        {
            revision++;
            commitPoint = PublisherProfileMutationCommitPoint.MayHaveChanged;
        }
    }

    public void MarkDeleted()
    {
        lock (sync)
        {
            revision++;
            commitPoint = PublisherProfileMutationCommitPoint.Deleted;
        }
    }
}

public static class PublisherProfileCommitPolicy
{
    public static PublisherConnectionState ForCanceledConnect(
        PublisherConnectionState previousState,
        PublisherProfileMutationSnapshot initialProfile,
        PublisherProfileMutationSnapshot currentProfile)
    {
        if (currentProfile.Revision != initialProfile.Revision)
            return currentProfile.CommitPoint == PublisherProfileMutationCommitPoint.Deleted
                ? PublisherConnectionState.NotConnected
                : PublisherConnectionState.NeedsReview;
        return previousState == PublisherConnectionState.Connecting
            ? PublisherConnectionState.NotConnected
            : previousState;
    }

    public static bool MustCommitDeletedProfile(
        PublisherProfileMutationSnapshot initialProfile,
        PublisherProfileMutationSnapshot currentProfile) =>
        currentProfile.Revision != initialProfile.Revision
        && currentProfile.CommitPoint == PublisherProfileMutationCommitPoint.Deleted;

    public static bool TryGetInterruptedDisconnectState(
        PublisherProfileMutationSnapshot initialProfile,
        PublisherProfileMutationSnapshot currentProfile,
        out PublisherConnectionState terminalState)
    {
        terminalState = currentProfile.CommitPoint == PublisherProfileMutationCommitPoint.Deleted
            ? PublisherConnectionState.NotConnected
            : PublisherConnectionState.NeedsReview;
        return currentProfile.Revision != initialProfile.Revision;
    }
}

public sealed class PublisherConnectCancellationAuthority(
    long generation,
    PublisherConnectionState previousState,
    PublisherProfileMutationSnapshot initialProfile)
{
    private int available = 1;

    public long Generation { get; } = generation;

    public bool TryConsume(
        long currentGeneration,
        PublisherProfileMutationSnapshot currentProfile,
        out PublisherConnectionState terminalState)
    {
        terminalState = PublisherProfileCommitPolicy.ForCanceledConnect(
            previousState,
            initialProfile,
            currentProfile);
        return currentGeneration == Generation
            && Interlocked.Exchange(ref available, 0) == 1;
    }
}

public static class PublisherAccountStatePolicy
{
    public static PublisherConnectionState ForSessionProof(PublisherSessionProof proof) => proof switch
    {
        PublisherSessionProof.Authenticated => PublisherConnectionState.Connected,
        PublisherSessionProof.LoginRequired => PublisherConnectionState.LoginRequired,
        _ => PublisherConnectionState.NeedsReview,
    };

    public static PublisherConnectionState ForResourceRead(PublisherResourceReadResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return result.Outcome switch
        {
            PublisherResourceReadOutcome.Valid when result.Snapshot is not null => PublisherConnectionState.Connected,
            PublisherResourceReadOutcome.SelectionRequired => PublisherConnectionState.Connected,
            PublisherResourceReadOutcome.LoginRequired => PublisherConnectionState.LoginRequired,
            _ => PublisherConnectionState.NeedsReview,
        };
    }

    public static PublisherConnectionState? ForCheckIn(DailyCheckInState state) => state switch
    {
        DailyCheckInState.Claimed or DailyCheckInState.AlreadyClaimed => PublisherConnectionState.Connected,
        DailyCheckInState.LoginNeeded => PublisherConnectionState.LoginRequired,
        DailyCheckInState.CouldNotCheck => PublisherConnectionState.NeedsReview,
        _ => null,
    };
}

public static class PublisherAccountPresentation
{
    public static bool IsCurrentDayCheckIn(DailyCheckInResult result, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(result);
        return result.ObservedAt.ToOffset(now.Offset).Date == now.Date;
    }
}

public sealed class PublisherSingleFlight<T>
{
    private readonly object sync = new();
    private Task<T>? current;

    public Task<T> RunAsync(
        Func<CancellationToken, Task<T>> operation,
        CancellationToken operationCancellation,
        CancellationToken observerCancellation = default)
    {
        ArgumentNullException.ThrowIfNull(operation);
        Task<T> shared;
        lock (sync)
        {
            if (current is null || current.IsCompleted)
            {
                var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
                current = completion.Task;
                _ = CompleteAsync(operation, operationCancellation, completion);
            }
            shared = current;
        }
        return observerCancellation.CanBeCanceled
            ? shared.WaitAsync(observerCancellation)
            : shared;
    }

    private static async Task CompleteAsync(
        Func<CancellationToken, Task<T>> operation,
        CancellationToken operationCancellation,
        TaskCompletionSource<T> completion)
    {
        try
        {
            completion.TrySetResult(await operation(operationCancellation).ConfigureAwait(false));
        }
        catch (OperationCanceledException exception)
        {
            completion.TrySetCanceled(exception.CancellationToken);
        }
        catch (Exception exception)
        {
            completion.TrySetException(exception);
        }
    }
}

public sealed class PublisherGeneration
{
    private long value;

    public long Current => Interlocked.Read(ref value);

    public long Advance() => Interlocked.Increment(ref value);

    public bool IsCurrent(long generation) => generation == Current;

    public bool CanPublish(long generation, CancellationToken cancellationToken = default) =>
        !cancellationToken.IsCancellationRequested && IsCurrent(generation);
}

public static class PublisherAccountCatalog
{
    public const int MaximumResourceResponseBytes = 64 * 1024;
    public const int MaximumConnectRequestBodyBytes = 16 * 1024;
    private static readonly TimeSpan EndfieldMaximumPastSkew = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan EndfieldMaximumFutureSkew = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan EndfieldAsiaServerOffset = TimeSpan.FromHours(8);
    private static readonly TimeSpan EndfieldAmericasEuropeServerOffset = TimeSpan.FromHours(-5);
    private static readonly Uri SkportSessionProbeUri =
        new("https://web-api.skport.com/cookie_store/account_token");

    private sealed record CheckInResponseEndpoint(
        Uri InfoUri,
        Uri ClaimUri,
        string? ActId,
        IReadOnlySet<string>? Servers);

    private static readonly IReadOnlyDictionary<string, CheckInResponseEndpoint> CheckInResponseEndpoints =
        new ReadOnlyDictionary<string, CheckInResponseEndpoint>(
            new Dictionary<string, CheckInResponseEndpoint>(StringComparer.Ordinal)
            {
                ["gi"] = new(
                    new("https://sg-hk4e-api.hoyolab.com/event/sol/info"),
                    new("https://sg-hk4e-api.hoyolab.com/event/sol/sign"),
                    "e202102251931481",
                    new HashSet<string>(["os_usa", "os_euro", "os_asia", "os_cht"], StringComparer.Ordinal)),
                ["hsr"] = new(
                    new("https://sg-act-public-api.hoyolab.com/event/luna/hkrpg/os/info"),
                    new("https://sg-act-public-api.hoyolab.com/event/luna/hkrpg/os/sign"),
                    "e202303301540311",
                    new HashSet<string>(["prod_official_usa", "prod_official_eur", "prod_official_asia", "prod_official_cht"], StringComparer.Ordinal)),
                ["zzz"] = new(
                    new("https://sg-act-public-api.hoyolab.com/event/luna/zzz/os/info"),
                    new("https://sg-act-public-api.hoyolab.com/event/luna/zzz/os/sign"),
                    "e202406031448091",
                    new HashSet<string>(["prod_gf_us", "prod_gf_eu", "prod_gf_jp", "prod_gf_sg"], StringComparer.Ordinal)),
                ["ae"] = new(
                    new("https://zonai.skport.com/web/v1/game/endfield/attendance"),
                    new("https://zonai.skport.com/web/v1/game/endfield/attendance"),
                    null,
                    null),
            });

    private static readonly IReadOnlyDictionary<string, Uri> ResourceResponseEndpoints =
        new ReadOnlyDictionary<string, Uri>(
            new Dictionary<string, Uri>(StringComparer.Ordinal)
            {
                ["gi"] = new("https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote"),
                ["hsr"] = new("https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/note"),
                ["zzz"] = new("https://sg-act-public-api.hoyolab.com/event/game_record_zzz/api/zzz/note"),
            });

    private static readonly IReadOnlyDictionary<string, IReadOnlySet<string>> ResourceServers =
        new ReadOnlyDictionary<string, IReadOnlySet<string>>(
            new Dictionary<string, IReadOnlySet<string>>(StringComparer.Ordinal)
            {
                ["gi"] = new HashSet<string>(["os_usa", "os_euro", "os_asia", "os_cht"], StringComparer.Ordinal),
                ["hsr"] = new HashSet<string>(["prod_official_usa", "prod_official_eur", "prod_official_asia", "prod_official_cht"], StringComparer.Ordinal),
                ["zzz"] = new HashSet<string>(["prod_gf_us", "prod_gf_eu", "prod_gf_jp", "prod_gf_sg"], StringComparer.Ordinal),
            });

    // These selectors are compiled from the reviewed official pages. If a
    // publisher changes its markup, Nyx stops instead of guessing another
    // clickable element. Updating them requires a source review and a rebuild.
    private static readonly IReadOnlyDictionary<string, PublisherCheckInDomContract> CheckInDomContracts =
        new ReadOnlyDictionary<string, PublisherCheckInDomContract>(
            new Dictionary<string, PublisherCheckInDomContract>(StringComparer.Ordinal)
            {
                ["gi"] = new(
                    ".components-home-assets-__sign-content_---sign-item---k8WFIr.components-home-assets-__sign-content_---sign-wrapper---38rWqB:not(.components-home-assets-__sign-content_---has-signed---2brETR)"),
                ["hsr"] = new(
                    ".components-pc-assets-__prize-list_---item---F852VZ.active"),
                ["zzz"] = new(
                    ".components-pc-assets-__prize-list_---item---F852VZ.active"),
            });

    private static readonly IReadOnlyDictionary<string, PublisherAccountCatalogEntry> Entries =
        new ReadOnlyDictionary<string, PublisherAccountCatalogEntry>(
            new Dictionary<string, PublisherAccountCatalogEntry>(StringComparer.Ordinal)
            {
                ["gi"] = new("gi", "HoYoLAB",
                    new Uri("https://act.hoyolab.com/ys/event/signin-sea-v3/index.html?act_id=e202102251931481"),
                    new Uri("https://act.hoyolab.com/app/community-game-records-sea/index.html#/ys"),
                    "Original Resin", true, true),
                ["hsr"] = new("hsr", "HoYoLAB",
                    new Uri("https://act.hoyolab.com/bbs/event/signin/hkrpg/e202303301540311.html"),
                    new Uri("https://act.hoyolab.com/app/community-game-records-sea/rpg/index.html#/hsr"),
                    "Trailblaze Power", true, true),
                ["zzz"] = new("zzz", "HoYoLAB",
                    new Uri("https://act.hoyolab.com/bbs/event/signin/zzz/e202406031448091.html"),
                    new Uri("https://act.hoyolab.com/app/mihoyo-zzz-game-record/index.html#/zzz"),
                    "Battery Charge", true, true),
                ["wuwa"] = new("wuwa", "KURO GAMES", null, null, "Waveplates", false, true),
                ["ae"] = new("ae", "SKPORT",
                    new Uri("https://game.skport.com/endfield/sign-in"),
                    new Uri("https://game.skport.com/endfield/game-data?header=0"),
                    "Sanity", true, false),
            });

    public static IReadOnlyCollection<PublisherAccountCatalogEntry> All => Entries.Values.ToArray();

    public static PublisherAccountCatalogEntry Get(string gameId) =>
        Entries.TryGetValue(gameId, out var entry)
            ? entry
            : throw new ArgumentOutOfRangeException(nameof(gameId));

    public static bool IsExactCheckInUri(string gameId, Uri uri)
    {
        ArgumentNullException.ThrowIfNull(uri);
        var expected = Get(gameId).CheckInUri;
        return expected is not null
            && uri.IsAbsoluteUri
            && string.IsNullOrEmpty(uri.UserInfo)
            && uri.IsDefaultPort
            && string.IsNullOrEmpty(uri.Fragment)
            && string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.Ordinal)
            && string.Equals(NormalizeTopLevelUri(uri), NormalizeTopLevelUri(expected), StringComparison.Ordinal);
    }

    public static bool IsExactResourcePageUri(string gameId, Uri uri)
    {
        ArgumentNullException.ThrowIfNull(uri);
        var expected = Get(gameId).ResourceUri;
        return expected is not null
            && uri.IsAbsoluteUri
            && string.IsNullOrEmpty(uri.UserInfo)
            && uri.IsDefaultPort
            && string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            && string.Equals(NormalizeTopLevelUri(uri), NormalizeTopLevelUri(expected), StringComparison.Ordinal);
    }

    public static string NormalizeTopLevelUri(Uri uri)
    {
        ArgumentNullException.ThrowIfNull(uri);
        if (!uri.IsAbsoluteUri) throw new ArgumentException("An absolute URI is required.", nameof(uri));
        return uri.GetComponents(
            UriComponents.SchemeAndServer | UriComponents.PathAndQuery | UriComponents.Fragment,
            UriFormat.UriEscaped);
    }

    public static PublisherCheckInDomContract GetCheckInDomContract(string gameId) =>
        CheckInDomContracts.TryGetValue(gameId, out var contract)
            ? contract
            : throw new ArgumentOutOfRangeException(nameof(gameId));

    public static bool IsAllowedWebResourceRequest(
        string provider,
        PublisherSessionPurpose purpose,
        string gameId,
        Uri uri,
        string method,
        PublisherWebResourceContext context,
        PublisherClaimWriteAuthority? claimWriteAuthority = null,
        ReadOnlyMemory<byte>? requestBody = null,
        string? contentType = null)
    {
        ArgumentNullException.ThrowIfNull(uri);
        if (!Entries.TryGetValue(gameId, out var entry)
            || !string.Equals(entry.Provider, provider, StringComparison.Ordinal)
            || method is not ("GET" or "HEAD" or "POST" or "DELETE" or "OPTIONS")
            || !uri.IsAbsoluteUri
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !uri.IsDefaultPort
            || !string.IsNullOrEmpty(uri.Fragment)
            || uri.Query.Length > 2048
            || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            return false;
        if (purpose == PublisherSessionPurpose.Connect
            && method != "POST"
            && !IsNoRequestBody(requestBody))
            return false;

        if (context == PublisherWebResourceContext.Document)
        {
            if (method != "GET") return false;
            if (IsAllowedPurposeDocumentRequest(entry, purpose, uri)) return true;
            return purpose == PublisherSessionPurpose.Connect
                && provider == "HoYoLAB"
                && IsReviewedHoyoAccountDocument(uri);
        }

        // Cross-origin claim APIs can issue a non-mutating CORS preflight.
        // Keep that handshake exact-game and exact-endpoint without spending
        // the one authorization reserved for the actual POST.
        if (purpose == PublisherSessionPurpose.CheckIn
            && method == "OPTIONS"
            && context is PublisherWebResourceContext.XmlHttpRequest
                or PublisherWebResourceContext.Fetch
                or PublisherWebResourceContext.Other
            && IsExactCheckInResponseUri(gameId, uri, "POST"))
            return true;

        if (context is PublisherWebResourceContext.XmlHttpRequest or PublisherWebResourceContext.Fetch)
        {
            if (provider == "HoYoLAB"
                && IsAllowedHoyoApiRequest(
                    gameId,
                    purpose,
                    uri,
                    method,
                    claimWriteAuthority,
                    requestBody,
                    contentType))
                return true;
            if (provider == "SKPORT"
                && IsAllowedSkportApiRequest(
                    gameId,
                    purpose,
                    uri,
                    method,
                    claimWriteAuthority,
                    requestBody,
                    contentType))
                return true;
        }

        return method is "GET" or "HEAD"
            && (provider == "HoYoLAB"
                ? IsAllowedHoyoAsset(uri, context, purpose == PublisherSessionPurpose.Connect)
                : IsAllowedSkportAsset(uri, context, purpose == PublisherSessionPurpose.Connect));
    }

    public static bool IsAllowedTopLevelNavigation(
        string provider,
        PublisherSessionPurpose purpose,
        string gameId,
        Uri uri)
    {
        ArgumentNullException.ThrowIfNull(uri);
        if (!Entries.TryGetValue(gameId, out var entry)
            || !string.Equals(entry.Provider, provider, StringComparison.Ordinal)
            || !uri.IsAbsoluteUri
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !uri.IsDefaultPort
            || uri.Query.Length > 2048
            || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            return false;

        var selectedPage = purpose switch
        {
            PublisherSessionPurpose.CheckIn => entry.CheckInUri is not null && IsExactCheckInUri(gameId, uri),
            PublisherSessionPurpose.Resource => entry.ResourceUri is not null && IsExactResourcePageUri(gameId, uri),
            PublisherSessionPurpose.Connect or PublisherSessionPurpose.ConnectionProbe =>
                (entry.CheckInUri is not null && IsExactCheckInUri(gameId, uri))
                || (entry.ResourceUri is not null && IsExactResourcePageUri(gameId, uri)),
            _ => false,
        };
        if (selectedPage) return true;
        return purpose == PublisherSessionPurpose.Connect
            && provider == "HoYoLAB"
            && string.IsNullOrEmpty(uri.Fragment)
            && IsReviewedHoyoAccountDocument(uri);
    }

    private static bool IsReviewedHoyoAccountDocument(Uri uri) =>
        string.Equals(uri.Host, "account.hoyoverse.com", StringComparison.OrdinalIgnoreCase)
        && (uri.AbsolutePath is "/passport/index.html"
            or "/login-platform"
            or "/login-platform/index.html"
            or "/single-page"
            or "/single-page/index.html"
            or "/ue/login-platform"
            or "/ue/single-page")
        && uri.Query.Length <= 2048;

    private static bool IsAllowedPurposeDocumentRequest(
        PublisherAccountCatalogEntry entry,
        PublisherSessionPurpose purpose,
        Uri uri) => purpose switch
        {
            PublisherSessionPurpose.CheckIn =>
                entry.CheckInUri is not null && IsExactCheckInUri(entry.GameId, uri),
            PublisherSessionPurpose.Resource =>
                entry.ResourceUri is not null && IsExactResourceDocumentRequest(entry.GameId, uri),
            PublisherSessionPurpose.Connect or PublisherSessionPurpose.ConnectionProbe =>
                (entry.CheckInUri is not null && IsExactCheckInUri(entry.GameId, uri))
                || (entry.ResourceUri is not null && IsExactResourceDocumentRequest(entry.GameId, uri)),
            _ => false,
        };

    private static bool IsExactResourceDocumentRequest(string gameId, Uri uri)
    {
        var expected = Get(gameId).ResourceUri;
        return expected is not null
            && uri.IsAbsoluteUri
            && string.IsNullOrEmpty(uri.UserInfo)
            && uri.IsDefaultPort
            && string.IsNullOrEmpty(uri.Fragment)
            && string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            // URI fragments select the in-page route but are never sent in an
            // HTTP request. Compare the exact network address beneath it.
            && string.Equals(
                uri.GetComponents(UriComponents.SchemeAndServer | UriComponents.PathAndQuery, UriFormat.UriEscaped),
                expected.GetComponents(UriComponents.SchemeAndServer | UriComponents.PathAndQuery, UriFormat.UriEscaped),
                StringComparison.Ordinal);
    }

    private static bool IsAllowedHoyoApiRequest(
        string gameId,
        PublisherSessionPurpose purpose,
        Uri uri,
        string method,
        PublisherClaimWriteAuthority? claimWriteAuthority,
        ReadOnlyMemory<byte>? requestBody,
        string? contentType)
    {
        if (method == "GET"
            && purpose is PublisherSessionPurpose.Connect
                or PublisherSessionPurpose.ConnectionProbe
                or PublisherSessionPurpose.CheckIn
            && IsExactCheckInResponseUri(gameId, uri, method))
            return true;
        if (method == "POST"
            && purpose == PublisherSessionPurpose.CheckIn
            && IsExactCheckInResponseUri(gameId, uri, method))
            return claimWriteAuthority?.TryConsume(gameId) == true;
        if (method == "GET"
            && purpose is PublisherSessionPurpose.Connect
                or PublisherSessionPurpose.ConnectionProbe
                or PublisherSessionPurpose.Resource
            && IsExactResourceResponseUri(gameId, uri))
            return true;

        if (purpose != PublisherSessionPurpose.Connect
            && string.Equals(uri.Host, "bbs-api-os.hoyolab.com", StringComparison.OrdinalIgnoreCase)
            && uri.AbsolutePath.StartsWith("/community/", StringComparison.Ordinal)
            && method == "GET")
            return true;

        return purpose == PublisherSessionPurpose.Connect
            && IsReviewedHoyoConnectRequest(gameId, uri, method, requestBody, contentType);
    }

    private static bool IsAllowedSkportApiRequest(
        string gameId,
        PublisherSessionPurpose purpose,
        Uri uri,
        string method,
        PublisherClaimWriteAuthority? claimWriteAuthority,
        ReadOnlyMemory<byte>? requestBody,
        string? contentType)
    {
        if (IsExactSkportSessionProbeUri(uri, method)) return true;
        if (gameId == "ae"
            && method == "GET"
            && purpose is PublisherSessionPurpose.Connect
                or PublisherSessionPurpose.ConnectionProbe
                or PublisherSessionPurpose.CheckIn
            && IsExactCheckInResponseUri(gameId, uri, method))
            return true;
        if (gameId == "ae"
            && method == "POST"
            && purpose == PublisherSessionPurpose.CheckIn
            && IsExactCheckInResponseUri(gameId, uri, method))
            return claimWriteAuthority?.TryConsume(gameId) == true;

        if (string.Equals(uri.Host, "zonai.skport.com", StringComparison.OrdinalIgnoreCase)
            && string.Equals(uri.AbsolutePath, "/api/v1/game/player/binding", StringComparison.Ordinal)
            && method == "GET")
            return true;

        if (IsReviewedSkportBindingListRequest(uri, method))
            return true;

        return purpose == PublisherSessionPurpose.Connect
            && IsReviewedSkportConnectRequest(uri, method, requestBody, contentType);
    }

    // Reviewed from the official production login clients on 2026-07-21.
    // HoYo: account.hoyoverse.com/login-platform/chunk-common.8caf3da0.js.
    // SKPORT: WEB-SDK 1.14.0, chunk 988.b35e1f61131197f9cb91.js, plus
    // game.skport.com/skport-fe-static/skport-game-tools/9773.b689537c.js.
    // Only the existing-account password path and its required session/OAuth
    // hand-off are authorized. Registration, recovery, binding, unbinding,
    // account deletion, and future endpoints stay blocked.
    private static bool IsReviewedHoyoConnectRequest(
        string gameId,
        Uri uri,
        string method,
        ReadOnlyMemory<byte>? requestBody,
        string? contentType)
    {
        if (!IsHoyoPassportApiHost(uri.Host)) return false;

        var path = uri.AbsolutePath;
        if (method == "GET")
            return IsNoRequestBody(requestBody)
                && string.Equals(path, "/account/ma-passport/api/getSwitchStatus", StringComparison.Ordinal)
                && IsExactHoyoSwitchQuery(gameId, uri.Query);

        var exactPost = path is
            "/account/ma-passport/api/getConfig"
            or "/account/ma-passport/api/getAreaCode"
            or "/account/ma-passport/api/webLoginByPassword"
            or "/account/ma-passport/token/verifyCookieToken"
            or "/account/ma-passport/token/verifyLToken";
        if (method == "OPTIONS")
            return IsNoRequestBody(requestBody)
                && ((exactPost && string.IsNullOrEmpty(uri.Query))
                    || (string.Equals(path, "/account/ma-passport/api/getSwitchStatus", StringComparison.Ordinal)
                        && IsExactHoyoSwitchQuery(gameId, uri.Query)));
        if (method != "POST" || !exactPost || !string.IsNullOrEmpty(uri.Query)) return false;

        return string.Equals(path, "/account/ma-passport/api/webLoginByPassword", StringComparison.Ordinal)
            ? IsExactJsonObject(requestBody, contentType, static root =>
                HasExactProperties(root, "account", "password", "token_type")
                && HasNonEmptyJsonString(root, "account")
                && HasNonEmptyJsonString(root, "password")
                && TryGetExactInt32(root, "token_type", 2))
            : IsExactJsonObject(requestBody, contentType, static root =>
                HasExactProperties(root));
    }

    private static bool IsReviewedSkportConnectRequest(
        Uri uri,
        string method,
        ReadOnlyMemory<byte>? requestBody,
        string? contentType)
    {
        var path = uri.AbsolutePath;
        if (method == "GET")
        {
            if (!IsNoRequestBody(requestBody)) return false;
            if (string.Equals(uri.Host, "as.gryphline.com", StringComparison.OrdinalIgnoreCase)
                && string.Equals(path, "/user/info/v1/basic", StringComparison.Ordinal))
                return IsExactOpaqueTokenQuery(uri.Query);
            return string.Equals(uri.Host, "zonai.skport.com", StringComparison.OrdinalIgnoreCase)
                && string.Equals(path, "/web/v1/user/check", StringComparison.Ordinal)
                && string.IsNullOrEmpty(uri.Query);
        }

        var isPasswordLogin = string.Equals(uri.Host, "as.gryphline.com", StringComparison.OrdinalIgnoreCase)
            && string.Equals(path, "/user/auth/v1/token_by_email_password", StringComparison.Ordinal);
        var isOauthGrant = string.Equals(uri.Host, "as.gryphline.com", StringComparison.OrdinalIgnoreCase)
            && string.Equals(path, "/user/oauth2/v2/grant", StringComparison.Ordinal);
        var isTokenStore = string.Equals(uri.Host, "web-api.skport.com", StringComparison.OrdinalIgnoreCase)
            && string.Equals(path, "/cookie_store/account_token", StringComparison.Ordinal);
        var isCredExchange = string.Equals(uri.Host, "zonai.skport.com", StringComparison.OrdinalIgnoreCase)
            && string.Equals(path, "/web/v1/user/auth/generate_cred_by_code", StringComparison.Ordinal);
        var exactPost = isPasswordLogin || isOauthGrant || isTokenStore || isCredExchange;

        if (method == "OPTIONS")
            return IsNoRequestBody(requestBody)
                && string.IsNullOrEmpty(uri.Query)
                && (exactPost
                    || (string.Equals(uri.Host, "zonai.skport.com", StringComparison.OrdinalIgnoreCase)
                        && string.Equals(path, "/web/v1/user/check", StringComparison.Ordinal)));
        if (method != "POST" || !exactPost || !string.IsNullOrEmpty(uri.Query)) return false;

        if (isPasswordLogin)
            return IsExactJsonObject(requestBody, contentType, static root =>
                HasExactProperties(root, "email", "password")
                && HasNonEmptyJsonString(root, "email")
                && HasNonEmptyJsonString(root, "password"));
        if (isOauthGrant)
            return IsExactJsonObject(requestBody, contentType, static root =>
                HasExactProperties(root, "token", "appCode", "type")
                && HasNonEmptyJsonString(root, "token")
                && (HasExactJsonString(root, "appCode", "endfield")
                    || HasExactJsonString(root, "appCode", "4ca99fa6b56cc2ba"))
                && TryGetExactInt32(root, "type", 1));
        if (isTokenStore)
            return IsExactJsonObject(requestBody, contentType, static root =>
                HasExactProperties(root, "content")
                && HasNonEmptyJsonString(root, "content"));
        return IsExactJsonObject(requestBody, contentType, static root =>
            HasExactProperties(root, "kind", "code")
            && TryGetExactInt32(root, "kind", 1)
            && HasNonEmptyJsonString(root, "code"));
    }

    private static bool IsReviewedSkportBindingListRequest(Uri uri, string method)
    {
        if (!string.Equals(uri.Host, "binding-api-account-prod.gryphline.com", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(uri.AbsolutePath, "/account/binding/v1/binding_list", StringComparison.Ordinal)
            || method is not ("GET" or "OPTIONS"))
            return false;
        return IsExactSkportBindingQuery(uri.Query);
    }

    private static bool IsHoyoPassportApiHost(string host) =>
        string.Equals(host, "passport-api-sg.hoyoverse.com", StringComparison.OrdinalIgnoreCase)
        || string.Equals(host, "passport-api-eu.hoyoverse.com", StringComparison.OrdinalIgnoreCase)
        || string.Equals(host, "passport-api-us.hoyoverse.com", StringComparison.OrdinalIgnoreCase);

    private static bool IsExactHoyoSwitchQuery(string gameId, string query)
    {
        var expectedAppId = gameId switch
        {
            "gi" => "c9oqaq3s3gu8",
            "hsr" => "ciebhwzprpq8",
            "zzz" => "cieaz4epd5vk",
            _ => null,
        };
        var parsed = ParseBoundedQuery(query, "app_id", "platform");
        return expectedAppId is not null
            && parsed is not null
            && parsed.Count == 2
            && parsed.TryGetValue("app_id", out var appId)
            && string.Equals(appId, expectedAppId, StringComparison.Ordinal)
            && parsed.TryGetValue("platform", out var platform)
            && string.Equals(platform, "4", StringComparison.Ordinal);
    }

    private static bool IsExactOpaqueTokenQuery(string query)
    {
        var parsed = ParseConnectQuery(query, "token");
        return parsed is not null
            && parsed.Count == 1
            && parsed.TryGetValue("token", out var token)
            && IsBoundedOpaqueValue(token, 4096);
    }

    private static bool IsExactSkportBindingQuery(string query)
    {
        var parsed = ParseConnectQuery(query, "token", "appCode", "serverId");
        if (parsed is null
            || parsed.Count is < 2 or > 3
            || !parsed.TryGetValue("token", out var token)
            || !IsBoundedOpaqueValue(token, 4096)
            || !parsed.TryGetValue("appCode", out var appCode)
            || !string.Equals(appCode, "endfield", StringComparison.Ordinal))
            return false;
        return !parsed.TryGetValue("serverId", out var serverId)
            || (serverId.Length is > 0 and <= 64
                && serverId.All(static character =>
                    char.IsAsciiLetterOrDigit(character) || character is '-' or '_'));
    }

    private static bool IsNoRequestBody(ReadOnlyMemory<byte>? requestBody) =>
        requestBody is null || requestBody.Value.IsEmpty;

    private static bool IsExactJsonObject(
        ReadOnlyMemory<byte>? requestBody,
        string? contentType,
        Func<JsonElement, bool> predicate)
    {
        if (requestBody is null
            || requestBody.Value.IsEmpty
            || requestBody.Value.Length > MaximumConnectRequestBodyBytes
            || !IsJsonContentType(contentType))
            return false;
        try
        {
            using var document = JsonDocument.Parse(requestBody.Value, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 4,
            });
            return document.RootElement.ValueKind == JsonValueKind.Object
                && predicate(document.RootElement);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool HasExactProperties(JsonElement root, params string[] propertyNames)
    {
        var expected = propertyNames.ToHashSet(StringComparer.Ordinal);
        var found = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in root.EnumerateObject())
        {
            if (!expected.Contains(property.Name) || !found.Add(property.Name)) return false;
        }
        return found.SetEquals(expected);
    }

    // Keep credentials and tokens in the bounded UTF-8 request buffer. ValueEquals
    // validates string contents without creating an immutable secret-bearing string.
    private static bool HasNonEmptyJsonString(JsonElement root, string propertyName) =>
        TryGetUniqueProperty(root, propertyName, out var property)
        && property.ValueKind == JsonValueKind.String
        && !property.ValueEquals(ReadOnlySpan<byte>.Empty);

    private static bool HasExactJsonString(
        JsonElement root,
        string propertyName,
        string expected) =>
        TryGetUniqueProperty(root, propertyName, out var property)
        && property.ValueKind == JsonValueKind.String
        && property.ValueEquals(expected);

    private static bool TryGetExactInt32(JsonElement root, string propertyName, int expected) =>
        TryGetUniqueProperty(root, propertyName, out var property)
        && property.ValueKind == JsonValueKind.Number
        && property.TryGetInt32(out var value)
        && value == expected;

    private static bool IsBoundedOpaqueValue(string value, int maximumLength) =>
        value.Length is > 0
        && value.Length <= maximumLength
        && !value.Any(char.IsControl);

    private static bool IsAllowedHoyoAsset(
        Uri uri,
        PublisherWebResourceContext context,
        bool connectMode)
    {
        if (!IsAssetContext(context, allowDataFetch: !connectMode)) return false;
        var host = uri.Host;
        var path = uri.AbsolutePath;
        if (string.Equals(host, "act.hoyolab.com", StringComparison.OrdinalIgnoreCase))
            return path.StartsWith("/ys/event/signin-sea-v3/", StringComparison.Ordinal)
                || path.StartsWith("/bbs/event/signin/hkrpg/", StringComparison.Ordinal)
                || path.StartsWith("/bbs/event/signin/zzz/", StringComparison.Ordinal)
                || path.StartsWith("/app/community-game-records-sea/", StringComparison.Ordinal)
                || path.StartsWith("/app/mihoyo-zzz-game-record/", StringComparison.Ordinal);
        if (string.Equals(host, "account.hoyoverse.com", StringComparison.OrdinalIgnoreCase))
            return connectMode
                && (path.StartsWith("/passport/", StringComparison.Ordinal)
                    || path.StartsWith("/login-platform/", StringComparison.Ordinal)
                    || path.StartsWith("/single-page/", StringComparison.Ordinal)
                    || path is "/chunk-vendors.8caf3da0.js"
                        or "/chunk-common.8caf3da0.js"
                        or "/web.8caf3da0.js"
                        or "/chunk-vendors.8caf3da0.css"
                        or "/chunk-common.8caf3da0.css"
                        or "/web.8caf3da0.css"
                        or "/favicon.ico");
        if (string.Equals(host, "webstatic.hoyoverse.com", StringComparison.OrdinalIgnoreCase))
            return path.StartsWith("/dora/", StringComparison.Ordinal);
        if (string.Equals(host, "act.hoyoverse.com", StringComparison.OrdinalIgnoreCase))
            return path.StartsWith("/common/event/", StringComparison.Ordinal)
                || (context == PublisherWebResourceContext.Image
                    && path.StartsWith("/event-static/", StringComparison.Ordinal));
        if (string.Equals(host, "fastcdn.hoyoverse.com", StringComparison.OrdinalIgnoreCase))
            return context == PublisherWebResourceContext.Image
                && path.StartsWith("/static-resource-v2/", StringComparison.Ordinal);
        if (string.Equals(host, "upload-static.hoyoverse.com", StringComparison.OrdinalIgnoreCase))
            return context == PublisherWebResourceContext.Image
                && path.StartsWith("/event/", StringComparison.Ordinal);
        if (string.Equals(host, "act-webstatic.hoyoverse.com", StringComparison.OrdinalIgnoreCase))
            return context == PublisherWebResourceContext.Image
                && path.StartsWith("/event-static/", StringComparison.Ordinal);
        if (string.Equals(host, "img-os-static.hoyolab.com", StringComparison.OrdinalIgnoreCase)
            || string.Equals(host, "sdk-os-static.hoyoverse.com", StringComparison.OrdinalIgnoreCase))
            return context is PublisherWebResourceContext.Image
                or PublisherWebResourceContext.Font
                or PublisherWebResourceContext.Script
                or PublisherWebResourceContext.Stylesheet;
        return false;
    }

    private static bool IsAllowedSkportAsset(
        Uri uri,
        PublisherWebResourceContext context,
        bool connectMode)
    {
        if (!IsAssetContext(context, allowDataFetch: !connectMode)) return false;
        var host = uri.Host;
        var path = uri.AbsolutePath;
        if (string.Equals(host, "static.skport.com", StringComparison.OrdinalIgnoreCase))
            return path.StartsWith("/skport-fe-static/skport-game-tools/", StringComparison.Ordinal)
                || (context == PublisherWebResourceContext.Image
                    && (path.StartsWith("/asset/endfield_attendance/", StringComparison.Ordinal)
                        || path.StartsWith("/image/", StringComparison.Ordinal)));
        if (string.Equals(host, "assets.skport.com", StringComparison.OrdinalIgnoreCase))
            return path.StartsWith("/assets/", StringComparison.Ordinal);
        if (string.Equals(host, "web-api.gryphline.com", StringComparison.OrdinalIgnoreCase))
            return context == PublisherWebResourceContext.Script
                && path.StartsWith("/static/gl_web_sdk/", StringComparison.Ordinal);
        if (string.Equals(host, "web-static.hg-cdn.com", StringComparison.OrdinalIgnoreCase))
            return path.StartsWith("/gl_web_sdk/", StringComparison.Ordinal);
        return string.Equals(host, "o.alicdn.com", StringComparison.OrdinalIgnoreCase)
            && context == PublisherWebResourceContext.Script
            && string.Equals(path, "/frontend-lib/common-lib/jquery.min.js", StringComparison.Ordinal);
    }

    private static bool IsAssetContext(PublisherWebResourceContext context, bool allowDataFetch) =>
        context is PublisherWebResourceContext.Stylesheet
            or PublisherWebResourceContext.Image
            or PublisherWebResourceContext.Media
            or PublisherWebResourceContext.Font
            or PublisherWebResourceContext.Script
        || (allowDataFetch
            && context is PublisherWebResourceContext.XmlHttpRequest or PublisherWebResourceContext.Fetch);

    public static bool IsExactSkportSessionProbeUri(Uri uri, string method)
    {
        ArgumentNullException.ThrowIfNull(uri);
        return method == "GET"
            && uri.IsAbsoluteUri
            && string.IsNullOrEmpty(uri.UserInfo)
            && uri.IsDefaultPort
            && string.IsNullOrEmpty(uri.Query)
            && string.IsNullOrEmpty(uri.Fragment)
            && string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            && string.Equals(uri.Host, SkportSessionProbeUri.Host, StringComparison.OrdinalIgnoreCase)
            && string.Equals(uri.AbsolutePath, SkportSessionProbeUri.AbsolutePath, StringComparison.Ordinal);
    }

    public static bool IsAuthenticatedSkportSessionResponse(
        int statusCode,
        string? contentType,
        ReadOnlyMemory<byte> utf8Json)
    {
        if (statusCode != 200
            || !IsJsonContentType(contentType)
            || utf8Json.IsEmpty
            || utf8Json.Length > MaximumResourceResponseBytes)
            return false;

        try
        {
            using var document = JsonDocument.Parse(utf8Json, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 8,
            });
            var root = document.RootElement;
            return root.ValueKind == JsonValueKind.Object
                && TryGetUniqueProperty(root, "code", out var codeProperty)
                && codeProperty.ValueKind == JsonValueKind.Number
                && codeProperty.TryGetInt32(out var code)
                && code == 0
                && TryGetUniqueProperty(root, "data", out var data)
                && data.ValueKind == JsonValueKind.Object
                && TryGetUniqueProperty(data, "content", out var content)
                && content.ValueKind == JsonValueKind.String
                // The official SDK treats data.content as the account token.
                // ValueEquals avoids materializing or retaining that secret.
                && !content.ValueEquals(ReadOnlySpan<byte>.Empty);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public static PublisherSessionProof ClassifySkportSessionResponse(
        int statusCode,
        string? contentType,
        ReadOnlyMemory<byte> utf8Json)
    {
        if (statusCode is 401 or 403) return PublisherSessionProof.LoginRequired;
        return IsAuthenticatedSkportSessionResponse(statusCode, contentType, utf8Json)
            ? PublisherSessionProof.Authenticated
            : PublisherSessionProof.NeedsReview;
    }

    public static bool IsExactCheckInResponseUri(string gameId, Uri uri, string method)
    {
        ArgumentNullException.ThrowIfNull(uri);
        if (!CheckInResponseEndpoints.TryGetValue(gameId, out var endpoint)
            || method is not ("GET" or "POST")
            || !uri.IsAbsoluteUri
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !uri.IsDefaultPort
            || !string.IsNullOrEmpty(uri.Fragment)
            || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            return false;

        var expected = method == "GET" ? endpoint.InfoUri : endpoint.ClaimUri;
        if (!string.Equals(uri.Host, expected.Host, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(uri.AbsolutePath, expected.AbsolutePath, StringComparison.Ordinal))
            return false;

        if (gameId == "ae") return string.IsNullOrEmpty(uri.Query);
        if (method == "POST") return string.IsNullOrEmpty(uri.Query);

        var query = ParseBoundedQuery(uri.Query, "act_id", "lang", "region", "uid");
        return query is not null
            && query.Count == 4
            && query.TryGetValue("act_id", out var actId)
            && string.Equals(actId, endpoint.ActId, StringComparison.Ordinal)
            && query.TryGetValue("uid", out var uid)
            && uid.Length is > 0 and <= 20
            && uid.All(char.IsAsciiDigit)
            && query.TryGetValue("region", out var region)
            && endpoint.Servers!.Contains(region)
            && query.TryGetValue("lang", out var language)
            && IsBoundedLanguage(language);
    }

    public static PublisherCheckInProof ParseCheckInResponse(
        string gameId,
        string method,
        ReadOnlyMemory<byte> utf8Json,
        DateOnly expectedDate,
        DateTimeOffset expectedInstant)
    {
        if (!CheckInResponseEndpoints.ContainsKey(gameId)
            || method is not ("GET" or "POST")
            || utf8Json.IsEmpty
            || utf8Json.Length > MaximumResourceResponseBytes)
            return PublisherCheckInProof.Invalid;

        try
        {
            using var document = JsonDocument.Parse(utf8Json, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 16,
            });
            return gameId == "ae"
                ? ParseEndfieldCheckInResponse(method, document.RootElement, expectedInstant)
                : ParseHoyoCheckInResponse(method, document.RootElement, expectedDate);
        }
        catch (JsonException)
        {
            return PublisherCheckInProof.Invalid;
        }
    }

    public static PublisherCheckInProof ClassifyCheckInResponse(
        int statusCode,
        string? contentType,
        string gameId,
        string method,
        ReadOnlyMemory<byte> utf8Json,
        DateOnly expectedDate,
        DateTimeOffset expectedInstant)
    {
        if (statusCode is 401 or 403) return PublisherCheckInProof.LoginNeeded;
        if (statusCode != 200 || !IsJsonContentType(contentType))
            return PublisherCheckInProof.Invalid;
        return ParseCheckInResponse(
            gameId,
            method,
            utf8Json,
            expectedDate,
            expectedInstant);
    }

    public static bool IsExactResourceResponseUri(string gameId, Uri uri)
        => TryGetResourceBinding(gameId, uri, out _);

    public static bool TryGetResourceBinding(
        string gameId,
        Uri uri,
        out PublisherRoleBinding? binding)
    {
        binding = null;
        ArgumentNullException.ThrowIfNull(uri);
        if (!ResourceResponseEndpoints.TryGetValue(gameId, out var expected)
            || !ResourceServers.TryGetValue(gameId, out var servers)
            || !uri.IsAbsoluteUri
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !uri.IsDefaultPort
            || !string.IsNullOrEmpty(uri.Fragment)
            || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(uri.Host, expected.Host, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(uri.AbsolutePath, expected.AbsolutePath, StringComparison.Ordinal))
            return false;

        var query = ParseBoundedQuery(uri.Query, "role_id", "server");
        if (query is null
            || query.Count != 2
            || !query.TryGetValue("role_id", out var roleId)
            || roleId.Length is <= 0 or > 20
            || !roleId.All(char.IsAsciiDigit)
            || !query.TryGetValue("server", out var server)
            || !servers.Contains(server))
            return false;
        binding = new(roleId, server);
        return true;
    }

    public static bool IsValidRoleBinding(string gameId, PublisherRoleBinding binding)
    {
        ArgumentNullException.ThrowIfNull(binding);
        return ResourceServers.TryGetValue(gameId, out var servers)
            && binding.RoleId.Length is > 0 and <= 20
            && binding.RoleId.All(char.IsAsciiDigit)
            && servers.Contains(binding.Server);
    }

    public static IReadOnlyList<PublisherRoleChoice> CreateRoleChoices(
        string gameId,
        IReadOnlyCollection<PublisherResourceCandidate> candidates)
    {
        ArgumentNullException.ThrowIfNull(candidates);
        if (candidates.Count is < 2 or > 8) return Array.Empty<PublisherRoleChoice>();
        return candidates
            .Select(static candidate => candidate.Binding)
            .Distinct()
            .Where(binding => IsValidRoleBinding(gameId, binding))
            .OrderBy(static binding => binding.Server, StringComparer.Ordinal)
            .ThenBy(static binding => binding.RoleId, StringComparer.Ordinal)
            .Select(binding => new PublisherRoleChoice(
                binding,
                $"UID {MaskRoleId(binding.RoleId)} · {RegionLabel(binding.Server)}"))
            .ToArray();
    }

    public static PublisherResourceSnapshot? SelectResourceForBinding(
        IReadOnlyCollection<PublisherResourceCandidate> candidates,
        PublisherRoleBinding binding)
    {
        ArgumentNullException.ThrowIfNull(candidates);
        ArgumentNullException.ThrowIfNull(binding);
        return SelectUnambiguousResource(
            candidates.Where(candidate => candidate.Binding == binding).ToArray());
    }

    private static string MaskRoleId(string roleId)
    {
        if (roleId.Length <= 4) return new string('•', roleId.Length);
        return new string('•', roleId.Length - 4) + roleId[^4..];
    }

    private static string RegionLabel(string server) => server switch
    {
        "os_usa" or "prod_official_usa" or "prod_gf_us" => "Americas",
        "os_euro" or "prod_official_eur" or "prod_gf_eu" => "Europe",
        "os_asia" or "prod_official_asia" or "prod_gf_jp" or "prod_gf_sg" => "Asia",
        "os_cht" or "prod_official_cht" => "TW/HK/MO",
        _ => "Official region",
    };

    public static PublisherResourceSnapshot? SelectUnambiguousResource(
        IReadOnlyCollection<PublisherResourceCandidate> candidates)
    {
        ArgumentNullException.ThrowIfNull(candidates);
        if (candidates.Count is < 1 or > 8 || candidates.Any(static candidate => candidate.Snapshot is null))
            return null;

        var first = candidates.First();
        if (candidates.Any(candidate => candidate.Binding != first.Binding))
            return null;
        var snapshots = candidates.Select(static candidate => candidate.Snapshot!).ToArray();
        if (snapshots.Any(snapshot => !SameResourceValue(snapshot, snapshots[0])))
            return null;
        return snapshots.MaxBy(static snapshot => snapshot.ObservedAt);
    }

    public static PublisherResourceProof ParseResourceResponse(
        string gameId,
        ReadOnlyMemory<byte> utf8Json,
        DateTimeOffset observedAt,
        out PublisherResourceSnapshot? snapshot)
    {
        snapshot = null;
        if (!ResourceResponseEndpoints.ContainsKey(gameId)
            || utf8Json.IsEmpty
            || utf8Json.Length > MaximumResourceResponseBytes)
            return PublisherResourceProof.Invalid;

        try
        {
            using var document = JsonDocument.Parse(utf8Json, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 16,
            });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !TryGetInt32(root, "retcode", out var retcode))
                return PublisherResourceProof.Invalid;
            if (retcode == -100) return PublisherResourceProof.LoginNeeded;
            if (retcode != 0
                || !TryGetUniqueProperty(root, "data", out var data)
                || data.ValueKind != JsonValueKind.Object)
                return PublisherResourceProof.Invalid;

            int current;
            int maximum;
            int recoverySeconds;
            int? reserve = null;
            switch (gameId)
            {
                case "gi":
                    if (!TryGetInt32(data, "current_resin", out current)
                        || !TryGetInt32(data, "max_resin", out maximum)
                        || !TryGetInt32(data, "resin_recovery_time", out recoverySeconds))
                        return PublisherResourceProof.Invalid;
                    break;
                case "hsr":
                    if (!TryGetInt32(data, "current_stamina", out current)
                        || !TryGetInt32(data, "max_stamina", out maximum)
                        || !TryGetInt32(data, "stamina_recover_time", out recoverySeconds)
                        || !TryGetInt32(data, "current_reserve_stamina", out var parsedReserve)
                        || parsedReserve is < 0 or > 10000)
                        return PublisherResourceProof.Invalid;
                    reserve = parsedReserve;
                    break;
                case "zzz":
                    if (!TryGetUniqueProperty(data, "energy", out var energy)
                        || energy.ValueKind != JsonValueKind.Object
                        || !TryGetUniqueProperty(energy, "progress", out var progress)
                        || progress.ValueKind != JsonValueKind.Object
                        || !TryGetInt32(progress, "current", out current)
                        || !TryGetInt32(progress, "max", out maximum)
                        || !TryGetInt32(energy, "restore", out recoverySeconds))
                        return PublisherResourceProof.Invalid;
                    break;
                default:
                    return PublisherResourceProof.Invalid;
            }

            if (current < 0
                || maximum is <= 0 or > 10000
                || current > maximum
                || recoverySeconds is < 0 or > 604800
                || (current == maximum && recoverySeconds != 0))
                return PublisherResourceProof.Invalid;

            snapshot = new(
                gameId,
                Get(gameId).ResourceName,
                current,
                maximum,
                observedAt,
                RecoverySeconds: recoverySeconds,
                Reserve: reserve);
            return PublisherResourceProof.Valid;
        }
        catch (JsonException)
        {
            return PublisherResourceProof.Invalid;
        }
    }

    public static bool TryParseResourceResponse(
        string gameId,
        ReadOnlyMemory<byte> utf8Json,
        DateTimeOffset observedAt,
        out PublisherResourceSnapshot? snapshot) =>
        ParseResourceResponse(gameId, utf8Json, observedAt, out snapshot) == PublisherResourceProof.Valid;

    private static bool SameResourceValue(
        PublisherResourceSnapshot left,
        PublisherResourceSnapshot right) =>
        string.Equals(left.GameId, right.GameId, StringComparison.Ordinal)
        && string.Equals(left.ResourceName, right.ResourceName, StringComparison.Ordinal)
        && left.Current == right.Current
        && left.Maximum == right.Maximum
        && left.IsStale == right.IsStale
        && left.RecoverySeconds == right.RecoverySeconds
        && left.Reserve == right.Reserve;

    private static PublisherCheckInProof ParseHoyoCheckInResponse(
        string method,
        JsonElement root,
        DateOnly expectedDate)
    {
        if (root.ValueKind != JsonValueKind.Object
            || !TryGetInt32(root, "retcode", out var retcode))
            return PublisherCheckInProof.Invalid;
        if (retcode == -100) return PublisherCheckInProof.LoginNeeded;
        if (retcode != 0
            || !TryGetUniqueProperty(root, "data", out var data)
            || data.ValueKind != JsonValueKind.Object)
            return PublisherCheckInProof.Invalid;
        if (method == "POST") return PublisherCheckInProof.ClaimAccepted;

        if (!TryGetUniqueProperty(data, "is_sign", out var isSign)
            || isSign.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
            || !TryGetInt32(data, "total_sign_day", out var totalSignDay)
            || totalSignDay is < 0 or > 366
            || !TryGetUniqueProperty(data, "today", out var today)
            || today.ValueKind != JsonValueKind.String
            || today.GetString() is not { Length: 10 } todayText
            || !DateOnly.TryParseExact(
                todayText,
                "yyyy-MM-dd",
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var responseDate)
            || responseDate != expectedDate)
            return PublisherCheckInProof.Invalid;
        return isSign.GetBoolean()
            ? PublisherCheckInProof.Claimed
            : PublisherCheckInProof.Ready;
    }

    private static PublisherCheckInProof ParseEndfieldCheckInResponse(
        string method,
        JsonElement root,
        DateTimeOffset expectedInstant)
    {
        if (root.ValueKind != JsonValueKind.Object
            || !TryGetInt32(root, "code", out var code)
            || code != 0
            || !TryGetUniqueProperty(root, "data", out var data)
            || data.ValueKind != JsonValueKind.Object)
            return PublisherCheckInProof.Invalid;

        if (method == "POST")
        {
            if (!TryGetFreshEndfieldTimestamp(data, "ts", expectedInstant)
                || !TryGetUniqueProperty(data, "awardIds", out var awards)
                || !IsBoundedEndfieldAwardArray(awards, requireNonEmpty: true)
                || !TryGetUniqueProperty(data, "tomorrowAwardIds", out var tomorrowAwards)
                || !IsBoundedEndfieldAwardArray(tomorrowAwards, requireNonEmpty: false)
                || !TryGetUniqueProperty(data, "resourceInfoMap", out var resources)
                || resources.ValueKind != JsonValueKind.Object)
                return PublisherCheckInProof.Invalid;
            return PublisherCheckInProof.ClaimAccepted;
        }

        if (!TryGetFreshEndfieldTimestamp(data, "currentTs", expectedInstant)
            || !TryGetUniqueProperty(data, "hasToday", out var hasToday)
            || hasToday.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
            || !TryGetUniqueProperty(data, "calendar", out var calendar)
            || calendar.ValueKind != JsonValueKind.Array
            || calendar.GetArrayLength() is < 1 or > 62
            || !TryGetUniqueProperty(data, "first", out var first)
            || first.ValueKind != JsonValueKind.Array
            || first.GetArrayLength() > 16
            || !TryGetUniqueProperty(data, "resourceInfoMap", out var resourceInfoMap)
            || resourceInfoMap.ValueKind != JsonValueKind.Object)
            return PublisherCheckInProof.Invalid;

        var availableCount = 0;
        var doneCount = 0;
        var awardIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in calendar.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object
                || !TryGetUniqueProperty(item, "awardId", out var awardId)
                || awardId.ValueKind != JsonValueKind.String
                || awardId.GetString() is not { Length: > 0 and <= 64 } awardIdText
                || !awardIds.Add(awardIdText)
                || !TryGetUniqueProperty(item, "available", out var available)
                || available.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
                || !TryGetUniqueProperty(item, "done", out var done)
                || done.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                return PublisherCheckInProof.Invalid;
            if (done.GetBoolean()) doneCount++;
            if (!available.GetBoolean()) continue;
            if (done.GetBoolean() || ++availableCount > 1) return PublisherCheckInProof.Invalid;
        }
        // The current official UI uses hasToday to keep the selected day on
        // the last completed reward. A response cannot therefore be both
        // checked today and expose a claimable reward (or have no completed
        // calendar reward at all). `available` remains the primary proof.
        if (hasToday.GetBoolean() && (availableCount != 0 || doneCount == 0))
            return PublisherCheckInProof.Invalid;
        if (availableCount == 0 && doneCount == 0)
            return PublisherCheckInProof.Invalid;
        return availableCount == 1
            ? PublisherCheckInProof.Ready
            : PublisherCheckInProof.Claimed;
    }

    private static bool IsBoundedEndfieldAwardArray(JsonElement array, bool requireNonEmpty)
    {
        if (array.ValueKind != JsonValueKind.Array
            || array.GetArrayLength() > 16
            || (requireNonEmpty && array.GetArrayLength() == 0))
            return false;
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var award in array.EnumerateArray())
        {
            if (award.ValueKind != JsonValueKind.Object
                || !TryGetUniqueProperty(award, "id", out var id)
                || id.ValueKind != JsonValueKind.String
                || id.GetString() is not { Length: > 0 and <= 64 } idText
                || !ids.Add(idText)
                || !TryGetInt32(award, "type", out var type)
                || type is < 1 or > 3)
                return false;
        }
        return true;
    }

    private static bool TryGetFreshEndfieldTimestamp(
        JsonElement parent,
        string name,
        DateTimeOffset expectedInstant)
    {
        if (!TryGetUniqueProperty(parent, name, out var property)
            || property.ValueKind != JsonValueKind.String)
            return false;
        var text = property.GetString();
        if (text is not { Length: 10 }
            || !text.All(char.IsAsciiDigit)
            || !long.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var unixSeconds))
            return false;

        DateTimeOffset serverInstant;
        try
        {
            // The reviewed anonymous endpoint advances with Unix seconds. The
            // official game notices define reset at 04:00 in UTC+8 (Asia) or
            // UTC-5 (Americas/Europe). The response does not prove its region,
            // so require agreement under both possible server calendars.
            serverInstant = DateTimeOffset.FromUnixTimeSeconds(unixSeconds);
        }
        catch (ArgumentOutOfRangeException)
        {
            return false;
        }

        var expectedUtc = expectedInstant.ToUniversalTime();
        if (serverInstant < expectedUtc - EndfieldMaximumPastSkew
            || serverInstant > expectedUtc + EndfieldMaximumFutureSkew)
            return false;
        return IsSameEndfieldResetDay(serverInstant, expectedUtc, EndfieldAsiaServerOffset)
            && IsSameEndfieldResetDay(serverInstant, expectedUtc, EndfieldAmericasEuropeServerOffset);
    }

    private static bool IsSameEndfieldResetDay(
        DateTimeOffset serverInstant,
        DateTimeOffset expectedInstant,
        TimeSpan serverOffset)
    {
        static DateOnly ResetDay(DateTimeOffset instant, TimeSpan offset) =>
            DateOnly.FromDateTime(instant.ToOffset(offset).AddHours(-4).DateTime);

        return ResetDay(serverInstant, serverOffset) == ResetDay(expectedInstant, serverOffset);
    }

    private static bool IsBoundedLanguage(string language) =>
        language.Length is >= 2 and <= 16
        && language.All(static character => char.IsAsciiLetterLower(character) || character == '-');

    private static bool IsJsonContentType(string? contentType)
    {
        if (string.IsNullOrWhiteSpace(contentType)) return false;
        var mediaType = contentType.Split(';', 2)[0].Trim();
        return string.Equals(mediaType, "application/json", StringComparison.OrdinalIgnoreCase)
            || mediaType.EndsWith("+json", StringComparison.OrdinalIgnoreCase);
    }

    private static bool TryGetUniqueProperty(
        JsonElement parent,
        string propertyName,
        out JsonElement value)
    {
        value = default;
        var count = 0;
        foreach (var property in parent.EnumerateObject())
        {
            if (!property.NameEquals(propertyName)) continue;
            if (++count > 1) return false;
            value = property.Value;
        }
        return count == 1;
    }

    private static Dictionary<string, string>? ParseBoundedQuery(string query, params string[] allowedKeys)
    {
        if (query.Length is <= 1 or > 256 || query[0] != '?') return null;
        var allowed = allowedKeys.ToHashSet(StringComparer.Ordinal);
        try
        {
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var pair in query[1..].Split('&', StringSplitOptions.None))
            {
                var separator = pair.IndexOf('=');
                if (separator <= 0 || separator == pair.Length - 1) return null;
                var key = pair[..separator];
                var value = Uri.UnescapeDataString(pair[(separator + 1)..]);
                if (!allowed.Contains(key)
                    || value.Length > 64
                    || value.Any(char.IsControl)
                    || !result.TryAdd(key, value))
                    return null;
            }
            return result;
        }
        catch (UriFormatException)
        {
            return null;
        }
    }

    private static Dictionary<string, string>? ParseConnectQuery(string query, params string[] allowedKeys)
    {
        if (query.Length is <= 1 or > 2048 || query[0] != '?') return null;
        var allowed = allowedKeys.ToHashSet(StringComparer.Ordinal);
        try
        {
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var pair in query[1..].Split('&', StringSplitOptions.None))
            {
                var separator = pair.IndexOf('=');
                if (separator <= 0 || separator == pair.Length - 1) return null;
                var key = pair[..separator];
                var value = Uri.UnescapeDataString(pair[(separator + 1)..]);
                if (!allowed.Contains(key)
                    || value.Length > 4096
                    || value.Any(char.IsControl)
                    || !result.TryAdd(key, value))
                    return null;
            }
            return result;
        }
        catch (UriFormatException)
        {
            return null;
        }
    }

    private static bool TryGetInt32(JsonElement parent, string propertyName, out int value)
    {
        value = default;
        if (!TryGetUniqueProperty(parent, propertyName, out var property)) return false;
        if (property.ValueKind == JsonValueKind.Number) return property.TryGetInt32(out value);
        if (property.ValueKind != JsonValueKind.String) return false;
        var text = property.GetString();
        return text is { Length: > 0 and <= 10 }
            && text.All(char.IsAsciiDigit)
            && int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out value);
    }
}
