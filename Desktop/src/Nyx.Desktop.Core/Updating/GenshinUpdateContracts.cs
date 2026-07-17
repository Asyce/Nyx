using System.Collections.Immutable;

namespace Nyx.Desktop.Core.Updating;

internal enum UpdatePackageKind
{
    Full,
    Delta
}

internal enum UpdateFileChangeKind
{
    Write,
    Delete
}

internal enum ProtectedComponentKind
{
    AntiCheat,
    WindowsService,
    KernelDriver
}

internal enum InstalledFileKind
{
    PublisherManaged,
    Unknown
}

internal enum InstallationPathState
{
    VerifiedCanonical,
    Unverified,
    Ambiguous,
    ReparsePoint
}

internal enum UpdatePlanStatus
{
    Blocked,
    Ready
}

internal enum UpdateBlockCode
{
    InvalidInput,
    EvidenceBindingMismatch,
    AmbiguousPath,
    ReparsePoint,
    InvalidVersion,
    DowngradeOrSameVersion,
    WrongDeltaBase,
    MixedRelease,
    UnsupportedPackageMix,
    AntiCheatBlocked,
    ServiceBlocked,
    DriverBlocked,
    UnsafeRelativePath,
    DuplicatePath,
    UnknownFileMutation,
    InvalidPackageChange,
    ResultSetMismatch,
    InsufficientStagingSpace,
    InsufficientRollbackSpace,
    BudgetOverflow
}

// Opaque correlation object. Later validators must create one only after all evidence
// has been gathered for the same installation root and publisher release.
internal sealed class UpdateEvidenceBinding
{
    internal UpdateEvidenceBinding(string rootEvidenceId, string releaseEvidenceId)
    {
        RootEvidenceId = rootEvidenceId;
        ReleaseEvidenceId = releaseEvidenceId;
    }

    internal string RootEvidenceId { get; }
    internal string ReleaseEvidenceId { get; }
}

internal sealed record ProtectedUpdatePath(string RelativePath, ProtectedComponentKind Kind);

internal sealed record VerifiedProtectedComponentInventory(
    UpdateEvidenceBinding Binding,
    ImmutableArray<ProtectedUpdatePath> Paths);

internal sealed record VerifiedInstalledUpdateFile(
    string RelativePath,
    long SizeBytes,
    string Sha256,
    InstalledFileKind Kind);

internal sealed record VerifiedGenshinInstallation(
    UpdateEvidenceBinding Binding,
    string GameId,
    string CurrentVersion,
    InstallationPathState PathState,
    VerifiedProtectedComponentInventory ProtectedComponents,
    ImmutableArray<VerifiedInstalledUpdateFile> Files);

internal sealed record VerifiedUpdateFileChange(
    string RelativePath,
    UpdateFileChangeKind Kind,
    string? ExpectedBaseSha256,
    string? ResultSha256,
    long ResultSizeBytes);

internal sealed record VerifiedUpdatePackage(
    UpdateEvidenceBinding Binding,
    string PackageId,
    UpdatePackageKind Kind,
    string? BaseVersion,
    string TargetVersion,
    long DownloadSizeBytes,
    string Sha256,
    ImmutableArray<VerifiedUpdateFileChange> Changes);

internal sealed record VerifiedResultFile(
    string RelativePath,
    long SizeBytes,
    string Sha256);

internal sealed record VerifiedPublisherRelease(
    UpdateEvidenceBinding Binding,
    string GameId,
    string TargetVersion,
    ImmutableArray<VerifiedUpdatePackage> Packages,
    ImmutableArray<VerifiedResultFile> ResultFiles);

internal sealed record VerifiedUpdateStorage(
    UpdateEvidenceBinding Binding,
    long AvailableStagingBytes,
    long AvailableRollbackBytes);

internal sealed record GenshinUpdatePlanningRequest(
    VerifiedGenshinInstallation Installation,
    VerifiedPublisherRelease Release,
    VerifiedUpdateStorage Storage);

internal sealed record PlannedUpdateOperation(
    string RelativePath,
    UpdateFileChangeKind Kind,
    string? ExpectedBaseSha256,
    string? ResultSha256,
    long ResultSizeBytes);

internal sealed record UpdateBlockReason(UpdateBlockCode Code, string Message);

internal sealed record GenshinUpdateEvaluation(
    string CurrentVersion,
    string TargetVersion,
    ImmutableArray<string> PackageIds,
    ImmutableArray<PlannedUpdateOperation> Operations,
    ImmutableArray<string> PreservedUnknownFiles,
    long RequiredStagingBytes,
    long RequiredRollbackBytes,
    ImmutableArray<UpdateBlockReason> BlockReasons);

internal sealed class GenshinUpdatePlan
{
    private readonly bool ready;

    private GenshinUpdatePlan(GenshinUpdateEvaluation evaluation)
    {
        ready = evaluation.BlockReasons.IsEmpty;
        CurrentVersion = evaluation.CurrentVersion;
        TargetVersion = evaluation.TargetVersion;
        PackageIds = ready ? evaluation.PackageIds : ImmutableArray<string>.Empty;
        Operations = ready ? evaluation.Operations : ImmutableArray<PlannedUpdateOperation>.Empty;
        PreservedUnknownFiles = evaluation.PreservedUnknownFiles;
        RequiredStagingBytes = evaluation.RequiredStagingBytes;
        RequiredRollbackBytes = evaluation.RequiredRollbackBytes;
        BlockReasons = evaluation.BlockReasons;
    }

    internal UpdatePlanStatus Status => ready ? UpdatePlanStatus.Ready : UpdatePlanStatus.Blocked;
    internal bool IsReady => ready;
    internal string CurrentVersion { get; }
    internal string TargetVersion { get; }
    internal ImmutableArray<string> PackageIds { get; }
    internal ImmutableArray<PlannedUpdateOperation> Operations { get; }
    internal ImmutableArray<string> PreservedUnknownFiles { get; }
    internal long RequiredStagingBytes { get; }
    internal long RequiredRollbackBytes { get; }
    internal ImmutableArray<UpdateBlockReason> BlockReasons { get; }

    internal static GenshinUpdatePlan Evaluate(GenshinUpdatePlanningRequest? request) =>
        new(GenshinUpdatePlanner.Evaluate(request));
}
