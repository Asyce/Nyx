using System.Collections.ObjectModel;
using Nyx.Desktop.Core.AccountStatus;
using Nyx.Desktop.Infrastructure.AccountStatus;

namespace Nyx_Desktop_App;

public sealed class PublisherAccountService : IAsyncDisposable
{
    private readonly string root;
    private readonly PublisherAccountConsentGate consent;
    private readonly PublisherRoleBindingStore roleBindings;
    private readonly PublisherConsentRevocationStore revocations;
    private readonly SemaphoreSlim hoyoGate = new(1, 1);
    private readonly SemaphoreSlim skportGate = new(1, 1);
    private readonly PublisherSingleFlight<IReadOnlyDictionary<string, DailyCheckInResult>> checkInSingleFlight = new();
    private readonly IReadOnlyDictionary<string, PublisherSingleFlight<PublisherResourceSnapshot?>> resourceSingleFlights =
        new ReadOnlyDictionary<string, PublisherSingleFlight<PublisherResourceSnapshot?>>(
            new Dictionary<string, PublisherSingleFlight<PublisherResourceSnapshot?>>(StringComparer.Ordinal)
            {
                ["gi"] = new(),
                ["hsr"] = new(),
                ["zzz"] = new(),
            });
    private readonly PublisherGeneration hoyoGeneration = new();
    private readonly PublisherGeneration skportGeneration = new();
    private readonly PublisherProfileMutationJournal hoyoProfileMutations = new();
    private readonly PublisherProfileMutationJournal skportProfileMutations = new();
    private readonly Semaphore hoyoProfileOwner;
    private readonly Semaphore skportProfileOwner;
    private readonly bool ownsHoyoProfile;
    private readonly bool ownsSkportProfile;
    private readonly CancellationTokenSource shutdown = new();
    private readonly object sync = new();
    private readonly Dictionary<string, PublisherResourceSnapshot> resources = new(StringComparer.Ordinal);
    private readonly Dictionary<string, DailyCheckInResult> checkIns = new(StringComparer.Ordinal);
    private PublisherConnectionState hoyo = PublisherConnectionState.NotConnected;
    private PublisherConnectionState skport = PublisherConnectionState.NotConnected;
    private CancellationTokenSource hoyoSession = new();
    private CancellationTokenSource skportSession = new();
    private bool hoyoQuarantined;
    private bool skportQuarantined;
    private bool hoyoCleanupPending;
    private bool skportCleanupPending;
    private bool disposed;

    public PublisherAccountService(
        string root,
        bool hoyoLabAccountAccess = false,
        bool skportAccountAccess = false,
        bool hoyoLabCleanupPending = false,
        bool skportCleanupPending = false)
    {
        this.root = Path.GetFullPath(root);
        roleBindings = new(this.root);
        revocations = new(this.root);
        Directory.CreateDirectory(this.root);
        if ((File.GetAttributes(this.root) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("Publisher profile root cannot be a reparse point.");
        this.hoyoCleanupPending = hoyoLabCleanupPending || revocations.IsPending("HoYoLAB");
        this.skportCleanupPending = skportCleanupPending || revocations.IsPending("SKPORT");
        consent = new(
            hoyoLabAccountAccess && !this.hoyoCleanupPending,
            skportAccountAccess && !this.skportCleanupPending);
        (hoyoProfileOwner, ownsHoyoProfile) = AcquireProfileOwnership("HoYoLAB");
        try
        {
            (skportProfileOwner, ownsSkportProfile) = AcquireProfileOwnership("SKPORT");
        }
        catch
        {
            if (ownsHoyoProfile) hoyoProfileOwner.Release();
            hoyoProfileOwner.Dispose();
            throw;
        }
    }

    public event EventHandler? Updated;

    public bool HasConsent(string provider) => consent.IsEnabled(provider);

    public bool HasPendingConsentRevocation(string provider) => provider switch
    {
        "HoYoLAB" => Volatile.Read(ref hoyoCleanupPending) || revocations.IsPending(provider),
        "SKPORT" => Volatile.Read(ref skportCleanupPending) || revocations.IsPending(provider),
        _ => true,
    };

    public bool EnableConsent(string provider) =>
        !HasPendingConsentRevocation(provider) && consent.Set(provider, enabled: true);

    public void ApplyConsentSnapshot(
        bool hoyoLabEnabled,
        bool skportEnabled,
        bool hoyoLabCleanupPending,
        bool skportCleanupPending)
    {
        ApplyProviderConsentSnapshot("HoYoLAB", hoyoLabEnabled, hoyoLabCleanupPending);
        ApplyProviderConsentSnapshot("SKPORT", skportEnabled, skportCleanupPending);
    }

    public async Task<bool> PrepareConsentEnableAsync(
        string provider,
        CancellationToken cancellationToken = default)
    {
        if (provider is not ("HoYoLAB" or "SKPORT")) return false;
        consent.Set(provider, enabled: false);
        if (!HasPendingConsentRevocation(provider)) return true;
        revocations.MarkPending(provider);
        var cleaned = await RetryPendingConsentRevocationAsync(provider, cancellationToken)
            == PublisherConnectionState.NotConnected;
        return cleaned && revocations.Clear(provider);
    }

    public async Task<PublisherConnectionState> RetryPendingConsentRevocationAsync(
        string provider,
        CancellationToken cancellationToken = default)
    {
        if (provider is not ("HoYoLAB" or "SKPORT"))
            return PublisherConnectionState.NeedsReview;
        consent.Set(provider, enabled: false);
        revocations.MarkPending(provider);
        return await DisconnectCoreAsync(
            PublisherAccountCatalog.Get(provider == "HoYoLAB" ? "gi" : "ae"),
            consentRequired: false,
            cancellationToken);
    }

    public bool CompleteConsentRevocation(string provider)
    {
        if (provider is not ("HoYoLAB" or "SKPORT")) return false;
        return revocations.Clear(provider);
    }

    public async Task<bool> OpenOfficialResourcePageAsync(string gameId)
    {
        var entry = PublisherAccountCatalog.Get(gameId);
        return consent.IsEnabled(entry.Provider)
            && gameId == "ae"
            && entry.ResourceUri is not null
            && PublisherAccountCatalog.IsExactResourcePageUri(gameId, entry.ResourceUri)
            && await Windows.System.Launcher.LaunchUriAsync(entry.ResourceUri);
    }

    public PublisherAccountSummary Current
    {
        get
        {
            lock (sync)
            {
                return new(
                    hoyo,
                    skport,
                    new ReadOnlyDictionary<string, PublisherResourceSnapshot>(
                        new Dictionary<string, PublisherResourceSnapshot>(resources, StringComparer.Ordinal)),
                    new ReadOnlyDictionary<string, DailyCheckInResult>(
                        new Dictionary<string, DailyCheckInResult>(checkIns, StringComparer.Ordinal)));
            }
        }
    }

    public async Task<PublisherConnectionState> ConnectAsync(string gameId, CancellationToken cancellationToken = default)
    {
        var entry = PublisherAccountCatalog.Get(gameId);
        if (!consent.IsEnabled(entry.Provider))
            return PublisherConnectionState.NotConnected;
        if (!OwnsProfile(entry.Provider))
        {
            SetConnection(entry.Provider, PublisherConnectionState.NeedsReview);
            return PublisherConnectionState.NeedsReview;
        }
        var rotated = BeginRotatedOperation(entry.Provider, cancellationToken);
        var previousSession = rotated.PreviousSession;
        using var operation = rotated.Operation;
        var cancellationWrite = new PublisherConnectCancellationAuthority(
            operation.Generation,
            rotated.PreviousState,
            rotated.ProfileSnapshot);
        cancellationToken = operation.Cancellation.Token;
        var gate = GateFor(entry.Provider);
        var enteredGate = false;
        try
        {
            await previousSession.CancelAsync();
            await gate.WaitAsync(cancellationToken);
            enteredGate = true;
            if (!ProfileAccessAllowedAfterGate(entry.Provider, consentRequired: true))
            {
                TrySetConnection(entry.Provider, PublisherConnectionState.NeedsReview, operation);
                return PublisherConnectionState.NeedsReview;
            }
            if (!roleBindings.DeleteProvider(entry.Provider))
            {
                TrySetConnection(entry.Provider, PublisherConnectionState.NeedsReview, operation);
                return PublisherConnectionState.NeedsReview;
            }
            ClearProviderStateIfCurrent(entry.Provider, operation);
            ThrowIfDisposed();
            TrySetConnection(entry.Provider, PublisherConnectionState.Connecting, operation);
            await using (var window = CreateWindow(entry.Provider))
            {
                await window.InitializeAsync(
                    entry.CheckInUri ?? entry.ResourceUri ?? throw new InvalidOperationException("No official account page is configured."),
                    visible: true,
                    purpose: PublisherSessionPurpose.Connect,
                    gameId: entry.GameId,
                    heading: $"Connect {entry.Provider}",
                    cancellationToken,
                    ProfileMutationsFor(entry.Provider));
                await window.WaitUntilClosedAsync(cancellationToken);
            }

            var sessionProof = await ProbeConnectionCoreAsync(entry, cancellationToken);
            var state = PublisherAccountStatePolicy.ForSessionProof(sessionProof);
            TrySetConnection(entry.Provider, state, operation);
            return state;
        }
        catch (OperationCanceledException)
        {
            TrySetCanceledConnectState(entry.Provider, cancellationWrite);
            throw;
        }
        catch (PublisherSessionTeardownException)
        {
            QuarantineProvider(entry.Provider);
            return PublisherConnectionState.NeedsReview;
        }
        catch (Exception)
        {
            TrySetConnection(entry.Provider, PublisherConnectionState.NeedsReview, operation);
            return PublisherConnectionState.NeedsReview;
        }
        finally
        {
            if (enteredGate) gate.Release();
            previousSession.Dispose();
        }
    }

    public Task<PublisherResourceSnapshot?> RefreshResourceAsync(
        string gameId,
        Func<IReadOnlyList<PublisherRoleChoice>, CancellationToken, Task<PublisherRoleBinding?>>? rolePicker = null,
        CancellationToken cancellationToken = default)
    {
        var entry = PublisherAccountCatalog.Get(gameId);
        if (!consent.IsEnabled(entry.Provider))
            return Task.FromResult<PublisherResourceSnapshot?>(null);
        if (!entry.SupportsNumericResource
            || !resourceSingleFlights.TryGetValue(gameId, out var singleFlight))
            return Task.FromResult<PublisherResourceSnapshot?>(null);
        if (!OwnsProfile(entry.Provider))
        {
            SetConnection(entry.Provider, PublisherConnectionState.NeedsReview);
            return Task.FromResult<PublisherResourceSnapshot?>(null);
        }
        ThrowIfDisposed();
        return singleFlight.RunAsync(
            operationCancellation => RefreshResourceCoreAsync(entry, rolePicker, operationCancellation),
            shutdown.Token,
            cancellationToken);
    }

    private async Task<PublisherResourceSnapshot?> RefreshResourceCoreAsync(
        PublisherAccountCatalogEntry entry,
        Func<IReadOnlyList<PublisherRoleChoice>, CancellationToken, Task<PublisherRoleBinding?>>? rolePicker,
        CancellationToken cancellationToken)
    {
        using var operation = CreateOperation(entry.Provider, cancellationToken);
        cancellationToken = operation.Cancellation.Token;
        var gate = GateFor(entry.Provider);
        await gate.WaitAsync(cancellationToken);
        try
        {
            if (!ProfileAccessAllowedAfterGate(entry.Provider, consentRequired: true))
            {
                RemoveResourceIfCurrent(entry.GameId, entry.Provider, operation);
                TrySetConnection(entry.Provider, PublisherConnectionState.NeedsReview, operation);
                return null;
            }
            ThrowIfDisposed();
            await using var window = CreateWindow(entry.Provider);
            await window.InitializeAsync(
                entry.ResourceUri!,
                visible: false,
                purpose: PublisherSessionPurpose.Resource,
                gameId: entry.GameId,
                $"Refresh {entry.ResourceName}",
                cancellationToken);
            var sessionProof = await window.GetSessionProofAsync(cancellationToken);
            if (sessionProof != PublisherSessionProof.Authenticated)
            {
                RemoveResourceIfCurrent(entry.GameId, entry.Provider, operation);
                TrySetConnection(
                    entry.Provider,
                    PublisherAccountStatePolicy.ForSessionProof(sessionProof),
                    operation);
                return null;
            }
            var storedBinding = entry.Provider == "HoYoLAB"
                ? roleBindings.TryLoad(entry.GameId)
                : null;
            var resourceRead = await window.ReadResourceAsync(entry, storedBinding, cancellationToken);
            if (storedBinding is not null
                && resourceRead.Outcome is not PublisherResourceReadOutcome.Valid)
            {
                if (!roleBindings.Delete(entry.GameId))
                {
                    QuarantineProvider(entry.Provider);
                    return null;
                }
            }

            if (resourceRead.Outcome == PublisherResourceReadOutcome.SelectionRequired)
            {
                var candidates = resourceRead.Candidates ?? Array.Empty<PublisherResourceCandidate>();
                var choices = PublisherAccountCatalog.CreateRoleChoices(entry.GameId, candidates);
                if (choices.Count < 2 || rolePicker is null)
                {
                    RemoveResourceIfCurrent(entry.GameId, entry.Provider, operation);
                    TrySetConnection(entry.Provider, PublisherConnectionState.Connected, operation);
                    return null;
                }

                var selectedBinding = await rolePicker(choices, cancellationToken);
                var selectedChoice = selectedBinding is null
                    ? null
                    : choices.SingleOrDefault(choice => choice.Binding == selectedBinding);
                if (selectedChoice is null)
                {
                    RemoveResourceIfCurrent(entry.GameId, entry.Provider, operation);
                    TrySetConnection(entry.Provider, PublisherConnectionState.Connected, operation);
                    return null;
                }

                var selectedSnapshot = PublisherAccountCatalog.SelectResourceForBinding(
                    candidates,
                    selectedChoice.Binding);
                if (selectedSnapshot is null
                    || !roleBindings.Save(entry.GameId, selectedChoice.Binding))
                {
                    RemoveResourceIfCurrent(entry.GameId, entry.Provider, operation);
                    TrySetConnection(entry.Provider, PublisherConnectionState.NeedsReview, operation);
                    return null;
                }
                resourceRead = new(
                    selectedSnapshot,
                    PublisherResourceReadOutcome.Valid,
                    [new(selectedChoice.Binding, selectedSnapshot)]);
            }
            var nextState = PublisherAccountStatePolicy.ForResourceRead(resourceRead);
            var snapshot = resourceRead.Snapshot;
            if (resourceRead.Outcome == PublisherResourceReadOutcome.Valid
                && snapshot is not null
                && SetResourceIfCurrent(entry.Provider, operation, snapshot))
            {
                TrySetConnection(entry.Provider, nextState, operation);
                Updated?.Invoke(this, EventArgs.Empty);
                return CanPublish(entry.Provider, operation) ? snapshot : null;
            }

            RemoveResourceIfCurrent(entry.GameId, entry.Provider, operation);
            if (entry.Provider == "HoYoLAB" && !roleBindings.Delete(entry.GameId))
            {
                QuarantineProvider(entry.Provider);
                return null;
            }
            TrySetConnection(entry.Provider, nextState, operation);
            return null;
        }
        catch (PublisherSessionTeardownException)
        {
            QuarantineProvider(entry.Provider);
            RemoveResourceIfCurrent(entry.GameId, entry.Provider, operation);
            return null;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            RemoveResourceIfCurrent(entry.GameId, entry.Provider, operation);
            TrySetConnection(entry.Provider, PublisherConnectionState.NeedsReview, operation);
            return null;
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<IReadOnlyDictionary<string, DailyCheckInResult>> CheckInAllAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        return await checkInSingleFlight.RunAsync(
            CheckInAllCoreAsync,
            shutdown.Token,
            cancellationToken);
    }

    private async Task<IReadOnlyDictionary<string, DailyCheckInResult>> CheckInAllCoreAsync(
        CancellationToken cancellationToken)
    {
        var providers = new List<Task>(2);
        if (consent.IsEnabled("HoYoLAB"))
            providers.Add(RunProviderCheckInsAsync("HoYoLAB", ["gi", "hsr", "zzz"], cancellationToken));
        if (consent.IsEnabled("SKPORT"))
            providers.Add(RunProviderCheckInsAsync("SKPORT", ["ae"], cancellationToken));
        if (providers.Count > 0) await Task.WhenAll(providers);
        return Current.CheckIns;
    }

    private async Task RunProviderCheckInsAsync(string provider, string[] gameIds, CancellationToken cancellationToken)
    {
        if (!consent.IsEnabled(provider)) return;
        if (!OwnsProfile(provider))
        {
            SetConnection(provider, PublisherConnectionState.NeedsReview);
            foreach (var gameId in gameIds)
                SetCouldNotCheck(gameId, "The isolated publisher profile is already in use.");
            return;
        }
        using var operation = CreateOperation(provider, cancellationToken);
        cancellationToken = operation.Cancellation.Token;
        var gate = GateFor(provider);
        await gate.WaitAsync(cancellationToken);
        try
        {
            if (!ProfileAccessAllowedAfterGate(provider, consentRequired: true))
            {
                TrySetConnection(provider, PublisherConnectionState.NeedsReview, operation);
                foreach (var gameId in gameIds)
                {
                    SetCheckInIfCurrent(
                        provider,
                        operation,
                        new(
                            gameId,
                            DailyCheckInState.CouldNotCheck,
                            "The isolated publisher profile needs review.",
                            DateTimeOffset.UtcNow));
                }
                return;
            }
            for (var gameIndex = 0; gameIndex < gameIds.Length; gameIndex++)
            {
                var gameId = gameIds[gameIndex];
                var entry = PublisherAccountCatalog.Get(gameId);
                DailyCheckInResult result;
                try
                {
                    if (!CanPublish(provider, operation)) return;
                    SetCheckInIfCurrent(
                        provider,
                        operation,
                        new(gameId, DailyCheckInState.Opening, "Opening the official page.", DateTimeOffset.UtcNow));
                    await using var window = CreateWindow(provider);
                    await window.InitializeAsync(
                        entry.CheckInUri!,
                        visible: false,
                        purpose: PublisherSessionPurpose.CheckIn,
                        gameId,
                        $"Check in {gameId}",
                        cancellationToken);
                    var sessionProof = await window.GetSessionProofAsync(cancellationToken);
                    if (sessionProof == PublisherSessionProof.Authenticated)
                        result = await window.RunCheckInAsync(entry, cancellationToken);
                    else if (sessionProof == PublisherSessionProof.LoginRequired)
                        result = new(gameId, DailyCheckInState.LoginNeeded, $"Connect {provider} first.", DateTimeOffset.UtcNow);
                    else
                        result = new(gameId, DailyCheckInState.CouldNotCheck, "The official session proof needs review.", DateTimeOffset.UtcNow);
                }
                catch (PublisherSessionTeardownException)
                {
                    QuarantineProvider(provider);
                    result = new(gameId, DailyCheckInState.CouldNotCheck, "The isolated browser needs review.", DateTimeOffset.UtcNow);
                }
                catch (Exception exception) when (exception is not OperationCanceledException)
                {
                    result = new(gameId, DailyCheckInState.CouldNotCheck, "The official page could not be checked.", DateTimeOffset.UtcNow);
                }
                SetCheckInIfCurrent(provider, operation, result);
                var connectionState = PublisherAccountStatePolicy.ForCheckIn(result.State);
                if (connectionState.HasValue)
                    TrySetConnection(provider, connectionState.Value, operation);
                if (connectionState is PublisherConnectionState.LoginRequired
                    or PublisherConnectionState.NeedsReview)
                {
                    var remainingState = connectionState == PublisherConnectionState.LoginRequired
                        ? DailyCheckInState.LoginNeeded
                        : DailyCheckInState.CouldNotCheck;
                    var remainingMessage = connectionState == PublisherConnectionState.LoginRequired
                        ? $"Connect {provider} first."
                        : "The official page needs review.";
                    for (var remainingIndex = gameIndex + 1; remainingIndex < gameIds.Length; remainingIndex++)
                    {
                        SetCheckInIfCurrent(
                            provider,
                            operation,
                            new(
                                gameIds[remainingIndex],
                                remainingState,
                                remainingMessage,
                                DateTimeOffset.UtcNow));
                    }
                    return;
                }
                if (!OwnsProfile(provider)) return;
            }
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<PublisherSessionProof> ProbeConnectionCoreAsync(
        PublisherAccountCatalogEntry entry,
        CancellationToken cancellationToken)
    {
        await using var window = CreateWindow(entry.Provider);
        await window.InitializeAsync(
            entry.CheckInUri ?? entry.ResourceUri!,
            visible: false,
            purpose: PublisherSessionPurpose.ConnectionProbe,
            gameId: entry.GameId,
            heading: "Checking connection",
            cancellationToken);
        return await window.GetSessionProofAsync(cancellationToken);
    }

    private PublisherSessionWindow CreateWindow(string provider) =>
        new(ResolveProfilePath(provider), provider);

    public async Task<PublisherConnectionState> DisconnectAsync(
        string gameId,
        CancellationToken cancellationToken = default)
    {
        var entry = PublisherAccountCatalog.Get(gameId);
        if (!consent.IsEnabled(entry.Provider))
            return PublisherConnectionState.NotConnected;
        return await DisconnectCoreAsync(entry, consentRequired: true, cancellationToken);
    }

    public async Task<PublisherConnectionState> RevokeConsentAsync(
        string gameId,
        CancellationToken cancellationToken = default)
    {
        var entry = PublisherAccountCatalog.Get(gameId);
        // Revocation becomes authoritative before cancellation, profile cleanup,
        // or any fallible disk operation.
        consent.Set(entry.Provider, enabled: false);
        revocations.MarkPending(entry.Provider);
        return await DisconnectCoreAsync(entry, consentRequired: false, cancellationToken);
    }

    private async Task<PublisherConnectionState> DisconnectCoreAsync(
        PublisherAccountCatalogEntry entry,
        bool consentRequired,
        CancellationToken cancellationToken)
    {
        if (!OwnsProfile(entry.Provider))
        {
            SetConnection(entry.Provider, PublisherConnectionState.NeedsReview);
            return PublisherConnectionState.NeedsReview;
        }

        var rotated = BeginRotatedOperation(entry.Provider, cancellationToken);
        var previousSession = rotated.PreviousSession;
        using var operation = rotated.Operation;
        var initialProfile = rotated.ProfileSnapshot;
        var gate = GateFor(entry.Provider);
        var enteredGate = false;
        try
        {
            await previousSession.CancelAsync();
            await gate.WaitAsync(operation.Cancellation.Token);
            enteredGate = true;
            if (!ProfileAccessAllowedAfterGate(entry.Provider, consentRequired))
            {
                TrySetConnection(entry.Provider, PublisherConnectionState.NeedsReview, operation);
                return PublisherConnectionState.NeedsReview;
            }
            ThrowIfDisposed();
            var roleBindingsCleared = roleBindings.DeleteProvider(entry.Provider);
            await DeleteProfileDirectoryAsync(
                entry.Provider,
                ProfileMutationsFor(entry.Provider),
                operation.Cancellation.Token);
            if (!roleBindingsCleared)
            {
                CommitInterruptedProfileChange(
                    entry.Provider,
                    PublisherConnectionState.NeedsReview);
                return PublisherConnectionState.NeedsReview;
            }
            // Profile deletion is irreversible. Once the directory is known
            // absent, cancellation cannot preserve old Connected data.
            CommitDeletedProfile(entry.Provider);
            return PublisherConnectionState.NotConnected;
        }
        catch (OperationCanceledException)
        {
            var currentProfile = ProfileMutationsFor(entry.Provider).Capture();
            CommitInterruptedDisconnectIfNeeded(
                entry.Provider,
                initialProfile,
                currentProfile,
                operation,
                enteredGate);
            throw;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            if (operation.Cancellation.IsCancellationRequested)
            {
                CommitInterruptedDisconnectIfNeeded(
                    entry.Provider,
                    initialProfile,
                    ProfileMutationsFor(entry.Provider).Capture(),
                    operation,
                    enteredGate);
                throw new OperationCanceledException(operation.Cancellation.Token);
            }
            var currentProfile = ProfileMutationsFor(entry.Provider).Capture();
            if (PublisherProfileCommitPolicy.TryGetInterruptedDisconnectState(
                    initialProfile,
                    currentProfile,
                    out var terminalState))
            {
                if (CanCommitInterruptedProfileChange(entry.Provider, operation, enteredGate))
                    CommitInterruptedProfileChange(entry.Provider, terminalState);
                return terminalState;
            }
            TrySetConnection(entry.Provider, PublisherConnectionState.NeedsReview, operation);
            return PublisherConnectionState.NeedsReview;
        }
        finally
        {
            if (enteredGate) gate.Release();
            previousSession.Dispose();
        }
    }

    private SemaphoreSlim GateFor(string provider) => provider == "HoYoLAB"
        ? hoyoGate
        : provider == "SKPORT"
            ? skportGate
            : throw new ArgumentOutOfRangeException(nameof(provider));

    private PublisherProfileMutationJournal ProfileMutationsFor(string provider) => provider == "HoYoLAB"
        ? hoyoProfileMutations
        : provider == "SKPORT"
            ? skportProfileMutations
            : throw new ArgumentOutOfRangeException(nameof(provider));

    private bool OwnsProfile(string provider)
    {
        lock (sync)
        {
            return provider switch
            {
                "HoYoLAB" => ownsHoyoProfile && !hoyoQuarantined,
                "SKPORT" => ownsSkportProfile && !skportQuarantined,
                _ => false,
            };
        }
    }

    // A queued operation may have passed its first ownership check before the
    // prior WebView teardown quarantined the shared profile. Always recheck only
    // after the provider gate is held and before touching that profile again.
    private bool ProfileAccessAllowedAfterGate(string provider, bool consentRequired) =>
        OwnsProfile(provider) && (!consentRequired || consent.IsEnabled(provider));

    private PublisherOperation CreateOperation(string provider, CancellationToken cancellationToken)
    {
        CancellationToken providerToken;
        long generation;
        lock (sync)
        {
            providerToken = provider switch
            {
                "HoYoLAB" => hoyoSession.Token,
                "SKPORT" => skportSession.Token,
                _ => throw new ArgumentOutOfRangeException(nameof(provider)),
            };
            generation = GenerationFor(provider).Current;
        }
        return new(
            CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, shutdown.Token, providerToken),
            generation);
    }

    private (
        CancellationTokenSource PreviousSession,
        PublisherOperation Operation,
        PublisherConnectionState PreviousState,
        PublisherProfileMutationSnapshot ProfileSnapshot) BeginRotatedOperation(
            string provider,
            CancellationToken cancellationToken)
    {
        lock (sync)
        {
            var previousSession = provider switch
            {
                "HoYoLAB" => hoyoSession,
                "SKPORT" => skportSession,
                _ => throw new ArgumentOutOfRangeException(nameof(provider)),
            };
            var previousState = provider == "HoYoLAB" ? hoyo : skport;
            var profileSnapshot = ProfileMutationsFor(provider).Capture();
            var nextSession = new CancellationTokenSource();
            var generation = GenerationFor(provider).Advance();
            if (provider == "HoYoLAB") hoyoSession = nextSession;
            else skportSession = nextSession;
            var operation = new PublisherOperation(
                CancellationTokenSource.CreateLinkedTokenSource(
                    cancellationToken,
                    shutdown.Token,
                    nextSession.Token),
                generation);
            return (previousSession, operation, previousState, profileSnapshot);
        }
    }

    private CancellationTokenSource RotateSession(string provider)
    {
        lock (sync)
        {
            var previous = provider switch
            {
                "HoYoLAB" => hoyoSession,
                "SKPORT" => skportSession,
                _ => throw new ArgumentOutOfRangeException(nameof(provider)),
            };
            GenerationFor(provider).Advance();
            if (provider == "HoYoLAB") hoyoSession = new CancellationTokenSource();
            else skportSession = new CancellationTokenSource();
            return previous;
        }
    }

    private void ApplyProviderConsentSnapshot(
        string provider,
        bool enabled,
        bool cleanupPending)
    {
        if (provider == "HoYoLAB") Volatile.Write(ref hoyoCleanupPending, cleanupPending);
        else if (provider == "SKPORT") Volatile.Write(ref skportCleanupPending, cleanupPending);
        else throw new ArgumentOutOfRangeException(nameof(provider));
        enabled = enabled && !cleanupPending && !revocations.IsPending(provider);
        var wasEnabled = consent.IsEnabled(provider);
        consent.Set(provider, enabled);
        if (!wasEnabled || enabled) return;
        var previous = RotateSession(provider);
        try { previous.Cancel(); }
        catch (AggregateException) { }
        finally { previous.Dispose(); }
        ClearProviderState(provider);
        SetConnection(provider, PublisherConnectionState.NotConnected);
    }

    private void ClearProviderState(string provider)
    {
        var ids = provider == "HoYoLAB" ? new[] { "gi", "hsr", "zzz" } : new[] { "ae" };
        lock (sync)
        {
            foreach (var id in ids)
            {
                resources.Remove(id);
                checkIns.Remove(id);
            }
        }
        Updated?.Invoke(this, EventArgs.Empty);
    }

    private void CommitDeletedProfile(string provider) =>
        CommitInterruptedProfileChange(provider, PublisherConnectionState.NotConnected);

    private void CommitInterruptedDisconnectIfNeeded(
        string provider,
        PublisherProfileMutationSnapshot initialProfile,
        PublisherProfileMutationSnapshot currentProfile,
        PublisherOperation operation,
        bool enteredGate)
    {
        if (PublisherProfileCommitPolicy.TryGetInterruptedDisconnectState(
                initialProfile,
                currentProfile,
                out var terminalState)
            && CanCommitInterruptedProfileChange(provider, operation, enteredGate))
            CommitInterruptedProfileChange(provider, terminalState);
    }

    private bool CanCommitInterruptedProfileChange(
        string provider,
        PublisherOperation operation,
        bool enteredGate) =>
        enteredGate || GenerationFor(provider).IsCurrent(operation.Generation);

    private void CommitInterruptedProfileChange(
        string provider,
        PublisherConnectionState terminalState)
    {
        if (terminalState is not (PublisherConnectionState.NotConnected
                or PublisherConnectionState.NeedsReview))
            throw new ArgumentOutOfRangeException(nameof(terminalState));
        roleBindings.DeleteProvider(provider);
        var ids = provider == "HoYoLAB" ? new[] { "gi", "hsr", "zzz" } : new[] { "ae" };
        lock (sync)
        {
            foreach (var id in ids)
            {
                resources.Remove(id);
                checkIns.Remove(id);
            }
            if (provider == "HoYoLAB") hoyo = terminalState;
            else if (provider == "SKPORT") skport = terminalState;
            else throw new ArgumentOutOfRangeException(nameof(provider));
        }
        Updated?.Invoke(this, EventArgs.Empty);
    }

    private async Task DeleteProfileDirectoryAsync(
        string provider,
        PublisherProfileMutationJournal profileMutations,
        CancellationToken cancellationToken)
    {
        var profile = ResolveProfilePath(provider);
        if (!Directory.Exists(profile))
        {
            profileMutations.MarkDeleted();
            return;
        }
        if ((File.GetAttributes(profile) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("Publisher profile path cannot be a reparse point.");

        cancellationToken.ThrowIfCancellationRequested();
        // A recursive delete can remove part of a profile before Windows reports
        // a sharing failure. Record the irreversible boundary before attempting it.
        profileMutations.MarkMayHaveChanged();
        for (var attempt = 0; attempt < 6; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                Directory.Delete(profile, recursive: true);
                if (!Directory.Exists(profile))
                {
                    profileMutations.MarkDeleted();
                    return;
                }
            }
            catch (IOException) when (attempt < 5)
            {
            }
            catch (UnauthorizedAccessException) when (attempt < 5)
            {
            }
            await Task.Delay(TimeSpan.FromMilliseconds(150 * (attempt + 1)), cancellationToken);
        }
        if (!Directory.Exists(profile))
        {
            profileMutations.MarkDeleted();
            return;
        }
        throw new IOException("Nyx could not clear the publisher profile.");
    }

    private static (Semaphore Semaphore, bool Owned) AcquireProfileOwnership(string provider)
    {
        var semaphore = new Semaphore(
            initialCount: 1,
            maximumCount: 1,
            $"Local\\Pengo.Nyx.Desktop.PublisherProfile.{provider}");
        try
        {
            return (semaphore, semaphore.WaitOne(0));
        }
        catch
        {
            semaphore.Dispose();
            throw;
        }
    }

    private void SetConnection(string provider, PublisherConnectionState state)
    {
        lock (sync)
        {
            if (provider == "HoYoLAB") hoyo = state;
            else skport = state;
        }
        Updated?.Invoke(this, EventArgs.Empty);
    }

    private void TrySetCanceledConnectState(
        string provider,
        PublisherConnectCancellationAuthority authority)
    {
        lock (sync)
        {
            if (!authority.TryConsume(
                    GenerationFor(provider).Current,
                    ProfileMutationsFor(provider).Capture(),
                    out var terminalState))
                return;
            if (provider == "HoYoLAB") hoyo = terminalState;
            else skport = terminalState;
        }
        Updated?.Invoke(this, EventArgs.Empty);
    }

    private void QuarantineProvider(string provider)
    {
        lock (sync)
        {
            if (provider == "HoYoLAB") hoyoQuarantined = true;
            else if (provider == "SKPORT") skportQuarantined = true;
        }
        roleBindings.DeleteProvider(provider);
        ClearProviderState(provider);
        SetConnection(provider, PublisherConnectionState.NeedsReview);
    }

    private PublisherGeneration GenerationFor(string provider) => provider == "HoYoLAB"
        ? hoyoGeneration
        : provider == "SKPORT"
            ? skportGeneration
            : throw new ArgumentOutOfRangeException(nameof(provider));

    private bool CanPublish(string provider, PublisherOperation operation) =>
        consent.IsEnabled(provider)
        && GenerationFor(provider).CanPublish(operation.Generation, operation.Cancellation.Token);

    private void TrySetConnection(
        string provider,
        PublisherConnectionState state,
        PublisherOperation operation)
    {
        lock (sync)
        {
            if (!CanPublish(provider, operation)) return;
            if (provider == "HoYoLAB") hoyo = state;
            else skport = state;
        }
        Updated?.Invoke(this, EventArgs.Empty);
    }

    private void SetCheckInIfCurrent(
        string provider,
        PublisherOperation operation,
        DailyCheckInResult result)
    {
        if (!CanPublish(provider, operation)) return;
        lock (sync)
        {
            if (!CanPublish(provider, operation)) return;
            checkIns[result.GameId] = result;
        }
        Updated?.Invoke(this, EventArgs.Empty);
    }

    private void RemoveResourceIfCurrent(
        string gameId,
        string provider,
        PublisherOperation operation)
    {
        if (!CanPublish(provider, operation)) return;
        lock (sync)
        {
            if (!CanPublish(provider, operation)) return;
            resources.Remove(gameId);
        }
        Updated?.Invoke(this, EventArgs.Empty);
    }

    private bool SetResourceIfCurrent(
        string provider,
        PublisherOperation operation,
        PublisherResourceSnapshot snapshot)
    {
        lock (sync)
        {
            if (!CanPublish(provider, operation)) return false;
            resources[snapshot.GameId] = snapshot;
            return true;
        }
    }

    private void ClearProviderStateIfCurrent(string provider, PublisherOperation operation)
    {
        lock (sync)
        {
            if (!CanPublish(provider, operation)) return;
            var ids = provider == "HoYoLAB" ? new[] { "gi", "hsr", "zzz" } : new[] { "ae" };
            foreach (var id in ids)
            {
                resources.Remove(id);
                checkIns.Remove(id);
            }
        }
        Updated?.Invoke(this, EventArgs.Empty);
    }

    private void SetUnavailableCheckIn(string gameId, string message)
    {
        lock (sync)
            checkIns[gameId] = new(gameId, DailyCheckInState.Unavailable, message, DateTimeOffset.UtcNow);
        Updated?.Invoke(this, EventArgs.Empty);
    }

    private void SetCouldNotCheck(string gameId, string message)
    {
        lock (sync)
            checkIns[gameId] = new(gameId, DailyCheckInState.CouldNotCheck, message, DateTimeOffset.UtcNow);
        Updated?.Invoke(this, EventArgs.Empty);
    }

    private string ResolveProfilePath(string provider)
    {
        var leaf = provider switch
        {
            "HoYoLAB" => "HoYoLAB",
            "SKPORT" => "SKPORT",
            _ => throw new ArgumentOutOfRangeException(nameof(provider)),
        };
        var profile = Path.GetFullPath(Path.Combine(root, leaf));
        if (!string.Equals(Path.GetRelativePath(root, profile), leaf, StringComparison.Ordinal))
            throw new InvalidOperationException("Publisher profile path escaped the Nyx data folder.");
        if (Directory.Exists(profile)
            && (File.GetAttributes(profile) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("Publisher profile path cannot be a reparse point.");
        return profile;
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(disposed, this);

    public async ValueTask DisposeAsync()
    {
        if (disposed) return;
        disposed = true;
        shutdown.Cancel();
        var oldHoyoSession = RotateSession("HoYoLAB");
        var oldSkportSession = RotateSession("SKPORT");
        await Task.WhenAll(oldHoyoSession.CancelAsync(), oldSkportSession.CancelAsync());
        var allProviderWorkStopped = false;
        try
        {
            await Task.WhenAll(hoyoGate.WaitAsync(), skportGate.WaitAsync())
                .WaitAsync(TimeSpan.FromSeconds(15));
            allProviderWorkStopped = true;
        }
        catch (TimeoutException)
        {
            // Keep the named profile lease and live synchronization objects.
            // Process teardown may continue, but another process cannot reuse
            // a folder while an old WebView might still own it.
        }
        lock (sync)
        {
            resources.Clear();
            checkIns.Clear();
        }
        if (!allProviderWorkStopped) return;
        hoyoGate.Dispose();
        skportGate.Dispose();
        oldHoyoSession.Dispose();
        oldSkportSession.Dispose();
        hoyoSession.Dispose();
        skportSession.Dispose();
        if (ownsHoyoProfile && !hoyoQuarantined)
            hoyoProfileOwner.Release();
        if (ownsSkportProfile && !skportQuarantined)
            skportProfileOwner.Release();
        if (!hoyoQuarantined)
            hoyoProfileOwner.Dispose();
        if (!skportQuarantined)
            skportProfileOwner.Dispose();
        shutdown.Dispose();
    }

    private sealed class PublisherOperation(
        CancellationTokenSource cancellation,
        long generation) : IDisposable
    {
        public CancellationTokenSource Cancellation { get; } = cancellation;
        public long Generation { get; } = generation;

        public void Dispose() => Cancellation.Dispose();
    }
}
