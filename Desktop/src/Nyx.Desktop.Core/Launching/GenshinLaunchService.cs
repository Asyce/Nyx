using Nyx.Desktop.Core.Genshin;

namespace Nyx.Desktop.Core.Launching;

public enum GenshinLaunchStatus
{
    Ready,
    Running,
    LaunchFailed,
    NeedsReview,
}

public enum GenshinLaunchFailureReason
{
    None,
    ElevationRequired,
    ElevationCancelled,
    ElevatedStartFailed,
    WindowsStartFailed,
}

public enum RunningProcessStatus
{
    NotRunning,
    Running,
    Uncertain,
}

public sealed record LaunchSpecification(
    string FileName,
    string WorkingDirectory,
    IReadOnlyList<string> Arguments,
    bool UseShellExecute);

public sealed record GenshinLaunchResult(
    GenshinLaunchStatus Status,
    LaunchSpecification? Specification = null,
    GenshinInspectionReason InspectionReason = GenshinInspectionReason.None,
    GenshinLaunchFailureReason FailureReason = GenshinLaunchFailureReason.None);

public interface IGenshinLaunchIdentityValidator
{
    GenshinInspectionResult ValidateGame(string? root);

    GenshinInspectionResult ValidateUpdater(string? root);
}

public interface IRunningProcessInspector
{
    RunningProcessStatus Check(string processName, string expectedExecutablePath);
}

public interface ILaunchProcessStarter
{
    void Start(LaunchSpecification specification);
}

public sealed class ValidatedGenshinElevationRequest
{
    internal ValidatedGenshinElevationRequest(LaunchSpecification specification)
    {
        Specification = specification;
    }

    public LaunchSpecification Specification { get; }
}

public interface IGenshinElevatedProcessStarter
{
    void StartValidatedGenshin(ValidatedGenshinElevationRequest request);
}

public sealed class GenshinLaunchService
{
    private readonly IGenshinLaunchIdentityValidator validator;
    private readonly IRunningProcessInspector processInspector;
    private readonly ILaunchProcessStarter processStarter;
    private readonly IGenshinElevatedProcessStarter? elevatedProcessStarter;

    public GenshinLaunchService(
        IGenshinLaunchIdentityValidator validator,
        IRunningProcessInspector processInspector,
        ILaunchProcessStarter processStarter)
    {
        this.validator = validator ?? throw new ArgumentNullException(nameof(validator));
        this.processInspector = processInspector ?? throw new ArgumentNullException(nameof(processInspector));
        this.processStarter = processStarter ?? throw new ArgumentNullException(nameof(processStarter));
        elevatedProcessStarter = processStarter as IGenshinElevatedProcessStarter;
    }

    public GenshinLaunchResult CheckGame(string? gameRoot) =>
        Check(gameRoot, validator.ValidateGame, "GenshinImpact.exe", "GenshinImpact");

    public GenshinLaunchResult CheckUpdater(string? updaterRoot) =>
        Check(updaterRoot, validator.ValidateUpdater, "launcher.exe", "launcher");

    public GenshinLaunchResult LaunchGame(string? gameRoot) =>
        Launch(
            gameRoot,
            validator.ValidateGame,
            "GenshinImpact.exe",
            "GenshinImpact",
            allowGenshinElevation: true);

    public GenshinLaunchResult LaunchUpdater(string? updaterRoot) =>
        Launch(
            updaterRoot,
            validator.ValidateUpdater,
            "launcher.exe",
            "launcher",
            allowGenshinElevation: false);

    private GenshinLaunchResult Launch(
        string? root,
        Func<string?, GenshinInspectionResult> revalidate,
        string executableName,
        string processName,
        bool allowGenshinElevation)
    {
        var checkedResult = Check(root, revalidate, executableName, processName);
        if (checkedResult.Status is not GenshinLaunchStatus.Ready)
        {
            return checkedResult;
        }

        try
        {
            processStarter.Start(checkedResult.Specification!);
            return checkedResult with { Status = GenshinLaunchStatus.Running };
        }
        catch (Exception exception) when (IsStartFailure(exception))
        {
            if (exception is not System.ComponentModel.Win32Exception { NativeErrorCode: 740 })
            {
                return Failed(checkedResult, GenshinLaunchFailureReason.WindowsStartFailed);
            }

            if (!allowGenshinElevation || elevatedProcessStarter is null)
            {
                return Failed(checkedResult, GenshinLaunchFailureReason.ElevationRequired);
            }

            return LaunchElevatedGame(
                root,
                revalidate,
                executableName,
                processName,
                checkedResult.Specification!);
        }
    }

    private GenshinLaunchResult LaunchElevatedGame(
        string? root,
        Func<string?, GenshinInspectionResult> revalidate,
        string executableName,
        string processName,
        LaunchSpecification originalSpecification)
    {
        var freshResult = Check(root, revalidate, executableName, processName);
        if (freshResult.Status is not GenshinLaunchStatus.Ready
            || freshResult.Specification is null
            || !SpecificationsMatch(originalSpecification, freshResult.Specification))
        {
            return freshResult.Status is GenshinLaunchStatus.Ready
                ? new(GenshinLaunchStatus.NeedsReview, freshResult.Specification)
                : freshResult;
        }

        try
        {
            elevatedProcessStarter!.StartValidatedGenshin(
                new ValidatedGenshinElevationRequest(freshResult.Specification));
            return freshResult with { Status = GenshinLaunchStatus.Running };
        }
        catch (Exception exception) when (IsStartFailure(exception))
        {
            var reason = exception is System.ComponentModel.Win32Exception { NativeErrorCode: 1223 }
                ? GenshinLaunchFailureReason.ElevationCancelled
                : GenshinLaunchFailureReason.ElevatedStartFailed;
            return Failed(freshResult, reason);
        }
    }

    private static bool SpecificationsMatch(LaunchSpecification left, LaunchSpecification right) =>
        string.Equals(left.FileName, right.FileName, StringComparison.OrdinalIgnoreCase)
        && string.Equals(left.WorkingDirectory, right.WorkingDirectory, StringComparison.OrdinalIgnoreCase)
        && left.UseShellExecute == right.UseShellExecute
        && left.Arguments.SequenceEqual(right.Arguments, StringComparer.Ordinal);

    private static GenshinLaunchResult Failed(
        GenshinLaunchResult result,
        GenshinLaunchFailureReason reason) =>
        result with
        {
            Status = GenshinLaunchStatus.LaunchFailed,
            FailureReason = reason,
        };

    private GenshinLaunchResult Check(
        string? root,
        Func<string?, GenshinInspectionResult> revalidate,
        string executableName,
        string processName)
    {
        GenshinInspectionResult inspection;
        try
        {
            inspection = revalidate(root);
        }
        catch (Exception exception) when (IsInspectionFailure(exception))
        {
            return new(GenshinLaunchStatus.NeedsReview);
        }

        if (inspection.Status is not GenshinInspectionStatus.Ready
            || string.IsNullOrWhiteSpace(inspection.CanonicalRoot)
            || !string.Equals(
                Path.TrimEndingDirectorySeparator(root ?? string.Empty),
                inspection.CanonicalRoot,
                StringComparison.OrdinalIgnoreCase))
        {
            return new(GenshinLaunchStatus.NeedsReview, InspectionReason: inspection.Reason);
        }

        var specification = new LaunchSpecification(
            Path.Combine(inspection.CanonicalRoot, executableName),
            inspection.CanonicalRoot,
            Array.Empty<string>(),
            UseShellExecute: false);

        RunningProcessStatus runningStatus;
        try
        {
            runningStatus = processInspector.Check(processName, specification.FileName);
        }
        catch (Exception exception) when (IsInspectionFailure(exception))
        {
            return new(GenshinLaunchStatus.NeedsReview, specification);
        }

        return runningStatus switch
        {
            RunningProcessStatus.NotRunning => new(GenshinLaunchStatus.Ready, specification),
            RunningProcessStatus.Running => new(GenshinLaunchStatus.Running, specification),
            _ => new(GenshinLaunchStatus.NeedsReview, specification),
        };
    }

    private static bool IsInspectionFailure(Exception exception) =>
        exception is IOException
            or UnauthorizedAccessException
            or System.Security.SecurityException
            or NotSupportedException
            or System.ComponentModel.Win32Exception;

    private static bool IsStartFailure(Exception exception) =>
        IsInspectionFailure(exception)
        || exception is InvalidOperationException
            or System.ComponentModel.Win32Exception;
}
