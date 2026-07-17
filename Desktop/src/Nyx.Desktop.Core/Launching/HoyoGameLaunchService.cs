using Nyx.Desktop.Core.Hoyo;

namespace Nyx.Desktop.Core.Launching;

public enum HoyoGameLaunchStatus
{
    Ready,
    Running,
    LaunchFailed,
    NeedsReview,
}

public enum HoyoGameLaunchFailureReason
{
    None,
    ElevationRequired,
    ElevationCancelled,
    ElevatedStartFailed,
    WindowsStartFailed,
}

public sealed record HoyoGameLaunchResult(
    HoyoGameLaunchStatus Status,
    LaunchSpecification? Specification = null,
    HoyoInspectionReason InspectionReason = HoyoInspectionReason.None,
    HoyoGameLaunchFailureReason FailureReason = HoyoGameLaunchFailureReason.None);

public interface IHoyoGameLaunchIdentityValidator
{
    HoyoGameInspectionResult Validate(string gameId, string? root);
}

public interface IStrictRunningProcessInspector
{
    RunningProcessStatus CheckStrict(string processName, string expectedExecutablePath);
}

public sealed class ValidatedHoyoGameElevationRequest
{
    internal ValidatedHoyoGameElevationRequest(
        string gameId,
        LaunchSpecification specification)
    {
        GameId = gameId;
        Specification = specification;
    }

    public string GameId { get; }

    public LaunchSpecification Specification { get; }
}

public interface IHoyoGameElevatedProcessStarter
{
    void StartValidatedHoyoGame(ValidatedHoyoGameElevationRequest request);
}

/// <summary>
/// Admits only the two sealed HoYo game profiles after immediate identity validation.
/// It has no launcher, argument, update, or arbitrary-path fallback. Elevation is
/// admitted only for a sealed HSR/ZZZ request after a normal Windows 740 failure.
/// </summary>
public sealed class HoyoGameLaunchService
{
    private static readonly IReadOnlyDictionary<string, LaunchProfile> Profiles =
        new Dictionary<string, LaunchProfile>(StringComparer.Ordinal)
        {
            ["hsr"] = new("StarRail.exe", "StarRail"),
            ["zzz"] = new("ZenlessZoneZero.exe", "ZenlessZoneZero"),
        };

    private readonly IHoyoGameLaunchIdentityValidator validator;
    private readonly IStrictRunningProcessInspector processInspector;
    private readonly ILaunchProcessStarter processStarter;
    private readonly IHoyoGameElevatedProcessStarter? elevatedProcessStarter;

    public HoyoGameLaunchService(
        IHoyoGameLaunchIdentityValidator validator,
        IStrictRunningProcessInspector processInspector,
        ILaunchProcessStarter processStarter)
    {
        this.validator = validator ?? throw new ArgumentNullException(nameof(validator));
        this.processInspector = processInspector ?? throw new ArgumentNullException(nameof(processInspector));
        this.processStarter = processStarter ?? throw new ArgumentNullException(nameof(processStarter));
        elevatedProcessStarter = processStarter as IHoyoGameElevatedProcessStarter;
    }

    public HoyoGameLaunchResult CheckGame(string gameId, string? gameRoot) =>
        Check(GetProfile(gameId), gameId, gameRoot);

    public HoyoGameLaunchResult LaunchGame(string gameId, string? gameRoot)
    {
        var checkedResult = CheckGame(gameId, gameRoot);
        if (checkedResult.Status is not HoyoGameLaunchStatus.Ready)
        {
            return checkedResult;
        }

        // Validate a second time at the actual dispatch boundary and require the
        // exact same fixed specification before any process start is admitted.
        var freshResult = CheckGame(gameId, gameRoot);
        if (freshResult.Status is not HoyoGameLaunchStatus.Ready
            || freshResult.Specification is null
            || !SpecificationsMatch(checkedResult.Specification!, freshResult.Specification))
        {
            return freshResult.Status is HoyoGameLaunchStatus.Ready
                ? new(HoyoGameLaunchStatus.NeedsReview, freshResult.Specification)
                : freshResult;
        }

        try
        {
            processStarter.Start(freshResult.Specification);
            return freshResult with { Status = HoyoGameLaunchStatus.Running };
        }
        catch (Exception exception) when (IsBoundaryFailure(exception))
        {
            if (exception is not System.ComponentModel.Win32Exception { NativeErrorCode: 740 })
            {
                return Failed(freshResult, HoyoGameLaunchFailureReason.WindowsStartFailed);
            }

            if (elevatedProcessStarter is null)
            {
                return Failed(freshResult, HoyoGameLaunchFailureReason.ElevationRequired);
            }

            return LaunchElevatedGame(gameId, gameRoot, freshResult.Specification);
        }
    }

    private HoyoGameLaunchResult LaunchElevatedGame(
        string gameId,
        string? gameRoot,
        LaunchSpecification originalSpecification)
    {
        // Repeat the complete identity and exact-process check immediately before
        // constructing the sealed elevation request. A changed or running target
        // can never inherit the earlier 740 decision.
        var freshResult = CheckGame(gameId, gameRoot);
        if (freshResult.Status is not HoyoGameLaunchStatus.Ready
            || freshResult.Specification is null
            || !SpecificationsMatch(originalSpecification, freshResult.Specification))
        {
            return freshResult.Status is HoyoGameLaunchStatus.Ready
                ? new(HoyoGameLaunchStatus.NeedsReview, freshResult.Specification)
                : freshResult;
        }

        try
        {
            elevatedProcessStarter!.StartValidatedHoyoGame(
                new ValidatedHoyoGameElevationRequest(gameId, freshResult.Specification));
            return freshResult with { Status = HoyoGameLaunchStatus.Running };
        }
        catch (Exception exception) when (IsBoundaryFailure(exception))
        {
            var reason = exception is System.ComponentModel.Win32Exception { NativeErrorCode: 1223 }
                ? HoyoGameLaunchFailureReason.ElevationCancelled
                : HoyoGameLaunchFailureReason.ElevatedStartFailed;
            return Failed(freshResult, reason);
        }
    }

    private HoyoGameLaunchResult Check(
        LaunchProfile profile,
        string gameId,
        string? root)
    {
        HoyoGameInspectionResult inspection;
        try
        {
            inspection = validator.Validate(gameId, root);
        }
        catch (Exception exception) when (IsBoundaryFailure(exception))
        {
            return new(HoyoGameLaunchStatus.NeedsReview);
        }

        if (inspection.Status is not HoyoInspectionStatus.Ready
            || !string.Equals(inspection.GameId, gameId, StringComparison.Ordinal)
            || string.IsNullOrWhiteSpace(inspection.CanonicalRoot)
            || !string.Equals(
                Path.TrimEndingDirectorySeparator(root ?? string.Empty),
                inspection.CanonicalRoot,
                StringComparison.OrdinalIgnoreCase))
        {
            return new(
                HoyoGameLaunchStatus.NeedsReview,
                InspectionReason: inspection.Reason);
        }

        var specification = new LaunchSpecification(
            Path.Combine(inspection.CanonicalRoot, profile.ExecutableName),
            inspection.CanonicalRoot,
            Array.Empty<string>(),
            UseShellExecute: false);

        RunningProcessStatus running;
        try
        {
            running = processInspector.CheckStrict(profile.ProcessName, specification.FileName);
        }
        catch (Exception exception) when (IsBoundaryFailure(exception))
        {
            return new(HoyoGameLaunchStatus.NeedsReview, specification);
        }

        return running switch
        {
            RunningProcessStatus.NotRunning => new(HoyoGameLaunchStatus.Ready, specification),
            RunningProcessStatus.Running => new(HoyoGameLaunchStatus.Running, specification),
            _ => new(HoyoGameLaunchStatus.NeedsReview, specification),
        };
    }

    private static LaunchProfile GetProfile(string? gameId)
    {
        ArgumentNullException.ThrowIfNull(gameId);
        return Profiles.TryGetValue(gameId, out var profile)
            ? profile
            : throw new ArgumentOutOfRangeException(nameof(gameId), "Only sealed HSR and ZZZ profiles are supported.");
    }

    private static bool SpecificationsMatch(LaunchSpecification left, LaunchSpecification right) =>
        string.Equals(left.FileName, right.FileName, StringComparison.OrdinalIgnoreCase)
        && string.Equals(left.WorkingDirectory, right.WorkingDirectory, StringComparison.OrdinalIgnoreCase)
        && left.UseShellExecute == right.UseShellExecute
        && left.Arguments.SequenceEqual(right.Arguments, StringComparer.Ordinal);

    private static HoyoGameLaunchResult Failed(
        HoyoGameLaunchResult result,
        HoyoGameLaunchFailureReason reason) =>
        result with
        {
            Status = HoyoGameLaunchStatus.LaunchFailed,
            FailureReason = reason,
        };

    private static bool IsBoundaryFailure(Exception exception) =>
        exception is IOException
            or UnauthorizedAccessException
            or System.Security.SecurityException
            or NotSupportedException
            or InvalidOperationException
            or System.ComponentModel.Win32Exception;

    private sealed record LaunchProfile(string ExecutableName, string ProcessName);
}
