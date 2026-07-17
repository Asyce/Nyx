using Nyx.Desktop.Core.Games;
using Nyx.Desktop.Core.Genshin;
using Nyx.Desktop.Core.Launching;
using Nyx.Desktop.Core.Sessions;
using Nyx.Desktop.Infrastructure.Genshin;

namespace Nyx.Desktop.Infrastructure.Sessions;

/// <summary>
/// Connects the shared session coordinator to the already sealed Genshin discovery,
/// inspection, exact-process, direct-start, and narrow UAC boundaries.
/// </summary>
public sealed class GenshinGameSessionAdapter : IGameSessionAdapter
{
    private readonly Func<GenshinDiscoveryResult> discover;
    private readonly Func<string, GenshinInspectionResult> inspect;
    private readonly Func<string, GenshinLaunchResult> check;
    private readonly Func<string, GenshinLaunchResult> launch;
    private readonly object stateSync = new();
    private string? version;
    private GenshinLaunchFailureReason lastLaunchFailureReason;

    public GenshinGameSessionAdapter(
        WindowsGenshinCandidateDiscovery discovery,
        GenshinInspectionAdapter inspectionAdapter,
        GenshinLaunchService launchService)
    {
        ArgumentNullException.ThrowIfNull(discovery);
        ArgumentNullException.ThrowIfNull(inspectionAdapter);
        ArgumentNullException.ThrowIfNull(launchService);

        discover = discovery.Discover;
        inspect = root => inspectionAdapter.InspectGame(root, GenshinPathOrigin.PreviouslySaved);
        check = launchService.CheckGame;
        launch = launchService.LaunchGame;
    }

    internal GenshinGameSessionAdapter(
        Func<GenshinDiscoveryResult> discover,
        Func<string, GenshinInspectionResult> inspect,
        Func<string, GenshinLaunchResult> check,
        Func<string, GenshinLaunchResult> launch)
    {
        this.discover = discover ?? throw new ArgumentNullException(nameof(discover));
        this.inspect = inspect ?? throw new ArgumentNullException(nameof(inspect));
        this.check = check ?? throw new ArgumentNullException(nameof(check));
        this.launch = launch ?? throw new ArgumentNullException(nameof(launch));
    }

    public string GameId => "gi";

    public string? Version
    {
        get
        {
            lock (stateSync)
            {
                return version;
            }
        }
    }

    public GenshinLaunchFailureReason LastLaunchFailureReason
    {
        get
        {
            lock (stateSync)
            {
                return lastLaunchFailureReason;
            }
        }
    }

    public async ValueTask<GameSessionEvidence> ObserveSessionAsync(
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return await Task.Run(Observe, cancellationToken).ConfigureAwait(false);
    }

    public async ValueTask<GameLaunchDispatchResult> RequestValidatedLaunchAsync(
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return await Task.Run(Launch, cancellationToken).ConfigureAwait(false);
    }

    private GameSessionEvidence Observe()
    {
        try
        {
            var roots = discover();
            if (roots.GameRoot is null)
            {
                StoreObservation(version: null);
                return new(
                    LocalReadinessEvidence.NotFound,
                    ExactProcessPresence.Uncertain,
                    ExactProcessPresence.Uncertain);
            }

            var inspection = inspect(roots.GameRoot);
            if (inspection.Status is not GenshinInspectionStatus.Ready
                || string.IsNullOrWhiteSpace(inspection.CanonicalRoot)
                || !string.Equals(
                    Path.TrimEndingDirectorySeparator(roots.GameRoot),
                    inspection.CanonicalRoot,
                    StringComparison.OrdinalIgnoreCase))
            {
                StoreObservation(version: null);
                return ReviewEvidence;
            }

            var result = check(inspection.CanonicalRoot);
            switch (result.Status)
            {
                case GenshinLaunchStatus.Ready:
                    StoreObservation(inspection.Version);
                    return GameSessionEvidence.ReadyAndAbsent;
                case GenshinLaunchStatus.Running:
                    StoreObservation(inspection.Version);
                    return new(
                        LocalReadinessEvidence.Ready,
                        ExactProcessPresence.Absent,
                        ExactProcessPresence.Present);
                default:
                    StoreObservation(version: null);
                    return ReviewEvidence;
            }
        }
        catch (Exception exception) when (IsBoundaryFailure(exception))
        {
            StoreObservation(version: null);
            return ReviewEvidence;
        }
    }

    private GameLaunchDispatchResult Launch()
    {
        GenshinLaunchResult result;
        try
        {
            // Discovery is repeated at dispatch time. GenshinLaunchService then performs
            // its own exact revalidation immediately before any normal or elevated start.
            var roots = discover();
            if (roots.GameRoot is null)
            {
                StoreLaunchFailure(GenshinLaunchFailureReason.None);
                return GameLaunchDispatchResult.NeedsReview;
            }

            var inspection = inspect(roots.GameRoot);
            if (inspection.Status is not GenshinInspectionStatus.Ready
                || string.IsNullOrWhiteSpace(inspection.CanonicalRoot)
                || !string.Equals(
                    Path.TrimEndingDirectorySeparator(roots.GameRoot),
                    inspection.CanonicalRoot,
                    StringComparison.OrdinalIgnoreCase))
            {
                StoreLaunchFailure(GenshinLaunchFailureReason.None);
                return GameLaunchDispatchResult.NeedsReview;
            }

            result = launch(inspection.CanonicalRoot);
        }
        catch (Exception exception) when (IsBoundaryFailure(exception))
        {
            StoreLaunchFailure(GenshinLaunchFailureReason.WindowsStartFailed);
            return GameLaunchDispatchResult.Failed;
        }

        StoreLaunchFailure(result.FailureReason);
        return result.Status switch
        {
            GenshinLaunchStatus.Running => GameLaunchDispatchResult.Accepted,
            GenshinLaunchStatus.LaunchFailed => GameLaunchDispatchResult.Failed,
            _ => GameLaunchDispatchResult.NeedsReview,
        };
    }

    private void StoreObservation(string? version)
    {
        lock (stateSync)
        {
            this.version = version;
        }
    }

    private void StoreLaunchFailure(GenshinLaunchFailureReason reason)
    {
        lock (stateSync)
        {
            lastLaunchFailureReason = reason;
        }
    }

    private static bool IsBoundaryFailure(Exception exception) =>
        exception is IOException
            or UnauthorizedAccessException
            or System.Security.SecurityException
            or NotSupportedException
            or InvalidOperationException
            or System.ComponentModel.Win32Exception;

    private static GameSessionEvidence ReviewEvidence { get; } = new(
        LocalReadinessEvidence.NeedsReview,
        ExactProcessPresence.Uncertain,
        ExactProcessPresence.Uncertain);
}

/// <summary>
/// A capability-free placeholder for games whose direct-launch adapter is not enabled yet.
/// It cannot inspect a process or dispatch any executable.
/// </summary>
public sealed class FailClosedGameSessionAdapter : IGameSessionAdapter
{
    public FailClosedGameSessionAdapter(string gameId)
    {
        GameId = GameCatalog.GetRequired(gameId).Id;
        if (GameId == "gi")
        {
            throw new ArgumentException("Genshin requires its production session adapter.", nameof(gameId));
        }
    }

    public string GameId { get; }

    public ValueTask<GameSessionEvidence> ObserveSessionAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new GameSessionEvidence(
            LocalReadinessEvidence.NeedsReview,
            ExactProcessPresence.Uncertain,
            ExactProcessPresence.Uncertain));
    }

    public ValueTask<GameLaunchDispatchResult> RequestValidatedLaunchAsync(
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.FromResult(GameLaunchDispatchResult.NeedsReview);
    }
}
