using Nyx.Desktop.Core.Hoyo;
using Nyx.Desktop.Core.Launching;
using Nyx.Desktop.Core.Sessions;
using Nyx.Desktop.Infrastructure.Hoyo;

namespace Nyx.Desktop.Infrastructure.Sessions;

/// <summary>
/// Connects one sealed HSR or ZZZ profile to the shared app-lifetime coordinator.
/// Discovery is repeated at dispatch, followed by the launch service's immediate
/// exact identity revalidation and argument-free process admission.
/// </summary>
public sealed class HoyoGameSessionAdapter : IGameSessionAdapter
{
    private readonly Func<HoyoGameInspectionResult> discover;
    private readonly Func<string, HoyoGameLaunchResult> check;
    private readonly Func<string, HoyoGameLaunchResult> launch;
    private readonly object stateSync = new();
    private string? activeRoot;
    private string? pendingRoot;
    private string? version;

    public HoyoGameSessionAdapter(
        string gameId,
        HoyoCurrentUserDiscovery discovery,
        HoyoGameLaunchService launchService)
    {
        ArgumentNullException.ThrowIfNull(discovery);
        ArgumentNullException.ThrowIfNull(launchService);

        GameId = RequireSupportedGame(gameId);
        var record = GameId == "hsr"
            ? HoyoCurrentGameRecord.HsrGlobal
            : HoyoCurrentGameRecord.ZzzGlobal;
        discover = () => discovery.Discover(record);
        check = root => launchService.CheckGame(GameId, root);
        launch = root => launchService.LaunchGame(GameId, root);
    }

    internal HoyoGameSessionAdapter(
        string gameId,
        Func<HoyoGameInspectionResult> discover,
        Func<string, HoyoGameLaunchResult> check,
        Func<string, HoyoGameLaunchResult> launch)
    {
        GameId = RequireSupportedGame(gameId);
        this.discover = discover ?? throw new ArgumentNullException(nameof(discover));
        this.check = check ?? throw new ArgumentNullException(nameof(check));
        this.launch = launch ?? throw new ArgumentNullException(nameof(launch));
    }

    public string GameId { get; }

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
            var inspection = discover();
            var roots = ReadRoots();
            if (!IsExactReadyInspection(inspection))
            {
                return ObserveUnavailableDiscovery(inspection, roots.Active);
            }

            var discoveredRoot = inspection.CanonicalRoot!;
            if (roots.Active is not null
                && !string.Equals(roots.Active, discoveredRoot, StringComparison.OrdinalIgnoreCase))
            {
                var previous = check(roots.Active);
                if (previous.Status is HoyoGameLaunchStatus.Running)
                {
                    StoreActiveRoot(roots.Active, roots.Version);
                    return RunningEvidence;
                }

                if (previous.Status is not HoyoGameLaunchStatus.Ready)
                {
                    ClearPendingRoot();
                    return ReviewEvidence;
                }

                // A changed registry target cannot replace the root we were observing
                // after one absence sample. Keep the old exact path active and require
                // the same new root plus another old-root absence observation.
                if (!string.Equals(roots.Pending, discoveredRoot, StringComparison.OrdinalIgnoreCase))
                {
                    StorePendingRoot(discoveredRoot);
                    return ReviewEvidence;
                }
            }

            var result = check(discoveredRoot);
            switch (result.Status)
            {
                case HoyoGameLaunchStatus.Ready:
                    StoreActiveRoot(discoveredRoot, inspection.Version);
                    return GameSessionEvidence.ReadyAndAbsent;
                case HoyoGameLaunchStatus.Running:
                    StoreActiveRoot(discoveredRoot, inspection.Version);
                    return RunningEvidence;
                default:
                    return ReviewEvidence;
            }
        }
        catch (Exception exception) when (IsBoundaryFailure(exception))
        {
            return ReviewEvidence;
        }
    }

    private GameLaunchDispatchResult Launch()
    {
        try
        {
            var inspection = discover();
            if (!IsExactReadyInspection(inspection))
            {
                return GameLaunchDispatchResult.NeedsReview;
            }

            var roots = ReadRoots();
            if (roots.Active is not null
                && !string.Equals(
                    roots.Active,
                    inspection.CanonicalRoot,
                    StringComparison.OrdinalIgnoreCase))
            {
                // A target that changes after the coordinator's observation must go
                // through the two-observation root transition before it can launch.
                ClearPendingRoot();
                return GameLaunchDispatchResult.NeedsReview;
            }

            return launch(inspection.CanonicalRoot!).Status switch
            {
                HoyoGameLaunchStatus.Running => GameLaunchDispatchResult.Accepted,
                HoyoGameLaunchStatus.LaunchFailed => GameLaunchDispatchResult.Failed,
                _ => GameLaunchDispatchResult.NeedsReview,
            };
        }
        catch (Exception exception) when (IsBoundaryFailure(exception))
        {
            return GameLaunchDispatchResult.Failed;
        }
    }

    private bool IsExactReadyInspection(HoyoGameInspectionResult inspection) =>
        inspection.Status is HoyoInspectionStatus.Ready
        && string.Equals(inspection.GameId, GameId, StringComparison.Ordinal)
        && !string.IsNullOrWhiteSpace(inspection.CanonicalRoot);

    private static bool IsMissingCurrentRecord(HoyoGameInspectionResult inspection) =>
        inspection.Status is not HoyoInspectionStatus.Ready
        && inspection.Reason is HoyoInspectionReason.CurrentRecordMissing;

    private GameSessionEvidence ObserveUnavailableDiscovery(
        HoyoGameInspectionResult inspection,
        string? previousRoot)
    {
        if (previousRoot is null)
        {
            StoreActiveRoot(null, null);
            return IsMissingCurrentRecord(inspection)
                ? MissingUncertainEvidence
                : ReviewEvidence;
        }

        var previous = check(previousRoot);
        if (previous.Status is HoyoGameLaunchStatus.Running)
        {
            ClearPendingRoot();
            return RunningEvidence;
        }

        if (previous.Status is not HoyoGameLaunchStatus.Ready)
        {
            ClearPendingRoot();
            return ReviewEvidence;
        }

        ClearPendingRoot();

        return IsMissingCurrentRecord(inspection)
            ? new(
                LocalReadinessEvidence.NotFound,
                ExactProcessPresence.Absent,
                ExactProcessPresence.Absent)
            : new(
                LocalReadinessEvidence.NeedsReview,
                ExactProcessPresence.Absent,
                ExactProcessPresence.Absent);
    }

    private (string? Active, string? Pending, string? Version) ReadRoots()
    {
        lock (stateSync)
        {
            return (activeRoot, pendingRoot, version);
        }
    }

    private void StoreActiveRoot(string? root, string? observedVersion)
    {
        lock (stateSync)
        {
            activeRoot = root;
            pendingRoot = null;
            version = observedVersion;
        }
    }

    private void StorePendingRoot(string root)
    {
        lock (stateSync)
        {
            pendingRoot = root;
        }
    }

    private void ClearPendingRoot()
    {
        lock (stateSync)
        {
            pendingRoot = null;
        }
    }

    private static string RequireSupportedGame(string? gameId) => gameId switch
    {
        "hsr" => gameId,
        "zzz" => gameId,
        _ => throw new ArgumentOutOfRangeException(nameof(gameId), "Only HSR and ZZZ sessions are supported."),
    };

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

    private static GameSessionEvidence MissingUncertainEvidence { get; } = new(
        LocalReadinessEvidence.NotFound,
        ExactProcessPresence.Uncertain,
        ExactProcessPresence.Uncertain);

    private static GameSessionEvidence RunningEvidence { get; } = new(
        LocalReadinessEvidence.Ready,
        ExactProcessPresence.Absent,
        ExactProcessPresence.Present);
}
