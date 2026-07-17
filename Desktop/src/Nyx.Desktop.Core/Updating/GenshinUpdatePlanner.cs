using System.Collections.Immutable;
using System.Globalization;
using System.Text;

namespace Nyx.Desktop.Core.Updating;

internal static class GenshinUpdatePlanner
{
    private const string SupportedGameId = "genshin-global";
    private static readonly StringComparer PathComparer = StringComparer.OrdinalIgnoreCase;

    internal static GenshinUpdateEvaluation Evaluate(GenshinUpdatePlanningRequest? request)
    {
        var reasons = ImmutableArray.CreateBuilder<UpdateBlockReason>();
        if (request?.Installation is null || request.Release is null || request.Storage is null)
        {
            Add(reasons, UpdateBlockCode.InvalidInput, "The planning request is missing or incomplete.");
            return Blocked(string.Empty, string.Empty, ImmutableArray<string>.Empty, 0, 0, reasons);
        }

        var installation = request.Installation;
        var release = request.Release;
        var storage = request.Storage;
        var packages = Normalize(release.Packages);
        var resultEntries = Normalize(release.ResultFiles);
        var installedEntries = Normalize(installation.Files);

        ValidateBinding(installation, release, storage, packages, reasons);
        ValidateIdentityAndPath(installation, release, reasons);
        ValidateVersionsAndPackages(installation, release, packages, reasons);

        var protectedPaths = new Dictionary<string, ProtectedComponentKind>(PathComparer);
        ValidateProtectedInventory(installation, protectedPaths, reasons);

        var installedManaged = new Dictionary<string, VerifiedInstalledUpdateFile>(PathComparer);
        var installedUnknown = new Dictionary<string, VerifiedInstalledUpdateFile>(PathComparer);
        ValidateInstallationFiles(installedEntries, installedManaged, installedUnknown, reasons);

        var resultFiles = new Dictionary<string, VerifiedResultFile>(PathComparer);
        ValidateResultFiles(resultEntries, resultFiles, reasons);

        var operations = ImmutableArray.CreateBuilder<PlannedUpdateOperation>();
        var changedPaths = new HashSet<string>(PathComparer);
        var workingResult = installedManaged.ToDictionary(
            pair => pair.Key,
            pair => new VerifiedResultFile(pair.Value.RelativePath, pair.Value.SizeBytes, pair.Value.Sha256),
            PathComparer);

        ValidateAndApplyChanges(
            packages,
            protectedPaths,
            installedManaged,
            installedUnknown,
            workingResult,
            changedPaths,
            operations,
            reasons);

        if (!EquivalentResult(workingResult, resultFiles))
        {
            Add(reasons, UpdateBlockCode.ResultSetMismatch,
                "The packages do not produce the complete verified result set.");
        }

        var requiredStaging = 0L;
        var requiredRollback = 0L;
        try
        {
            checked
            {
                // A later apply phase must be able to hold every package and a complete
                // independently verifiable target tree, not just the changed files.
                requiredStaging = packages.Sum(package => package?.DownloadSizeBytes ?? 0)
                    + resultFiles.Values.Sum(file => file.SizeBytes);

                // Rollback reserves a complete verified managed snapshot. Partial backup
                // accounting is not sufficient for a crash-safe future publisher.
                requiredRollback = installedManaged.Values.Sum(file => file.SizeBytes);
            }
        }
        catch (OverflowException)
        {
            Add(reasons, UpdateBlockCode.BudgetOverflow, "The staging or rollback budget overflowed.");
            requiredStaging = 0;
            requiredRollback = 0;
        }

        if (storage.AvailableStagingBytes < 0 || storage.AvailableRollbackBytes < 0)
        {
            Add(reasons, UpdateBlockCode.InvalidInput, "Storage evidence cannot contain a negative value.");
        }
        else
        {
            if (storage.AvailableStagingBytes < requiredStaging)
            {
                Add(reasons, UpdateBlockCode.InsufficientStagingSpace,
                    "There is not enough verified staging space for packages and the complete result tree.");
            }

            if (storage.AvailableRollbackBytes < requiredRollback)
            {
                Add(reasons, UpdateBlockCode.InsufficientRollbackSpace,
                    "There is not enough verified rollback space for the complete managed installation.");
            }
        }

        var preservedUnknown = installedUnknown.Values
            .Select(file => file.RelativePath)
            .Order(PathComparer)
            .ToImmutableArray();

        if (reasons.Count > 0)
        {
            return Blocked(
                installation.CurrentVersion,
                release.TargetVersion,
                preservedUnknown,
                requiredStaging,
                requiredRollback,
                reasons);
        }

        return new GenshinUpdateEvaluation(
            installation.CurrentVersion,
            release.TargetVersion,
            packages.Select(package => package!.PackageId).ToImmutableArray(),
            operations.ToImmutable(),
            preservedUnknown,
            requiredStaging,
            requiredRollback,
            ImmutableArray<UpdateBlockReason>.Empty);
    }

    private static void ValidateBinding(
        VerifiedGenshinInstallation installation,
        VerifiedPublisherRelease release,
        VerifiedUpdateStorage storage,
        ImmutableArray<VerifiedUpdatePackage?> packages,
        ImmutableArray<UpdateBlockReason>.Builder reasons)
    {
        var binding = installation.Binding;
        if (binding is null || !IsSafeIdentifier(binding.RootEvidenceId)
            || !IsSafeIdentifier(binding.ReleaseEvidenceId))
        {
            Add(reasons, UpdateBlockCode.EvidenceBindingMismatch,
                "The root and release evidence binding is missing or invalid.");
            return;
        }

        if (!ReferenceEquals(binding, release.Binding)
            || !ReferenceEquals(binding, storage.Binding)
            || !ReferenceEquals(binding, installation.ProtectedComponents?.Binding)
            || packages.Any(package => package is null || !ReferenceEquals(binding, package.Binding)))
        {
            Add(reasons, UpdateBlockCode.EvidenceBindingMismatch,
                "Installation, release, package, protected-path, and storage evidence must share one opaque binding.");
        }
    }

    private static void ValidateIdentityAndPath(
        VerifiedGenshinInstallation installation,
        VerifiedPublisherRelease release,
        ImmutableArray<UpdateBlockReason>.Builder reasons)
    {
        if (!string.Equals(installation.GameId, SupportedGameId, StringComparison.Ordinal)
            || !string.Equals(release.GameId, SupportedGameId, StringComparison.Ordinal))
        {
            Add(reasons, UpdateBlockCode.InvalidInput, "Only the supported global Genshin identity may be planned.");
        }

        switch (installation.PathState)
        {
            case InstallationPathState.VerifiedCanonical:
                break;
            case InstallationPathState.ReparsePoint:
                Add(reasons, UpdateBlockCode.ReparsePoint,
                    "Planning is blocked when the installation root contains a reparse point.");
                break;
            case InstallationPathState.Unverified:
            case InstallationPathState.Ambiguous:
            default:
                Add(reasons, UpdateBlockCode.AmbiguousPath,
                    "The installation root is not verified, canonical, and unambiguous.");
                break;
        }
    }

    private static void ValidateVersionsAndPackages(
        VerifiedGenshinInstallation installation,
        VerifiedPublisherRelease release,
        ImmutableArray<VerifiedUpdatePackage?> packages,
        ImmutableArray<UpdateBlockReason>.Builder reasons)
    {
        if (!TryParseStrictVersion(installation.CurrentVersion, out var current)
            || !TryParseStrictVersion(release.TargetVersion, out var target))
        {
            Add(reasons, UpdateBlockCode.InvalidVersion,
                "Current and target versions must be canonical three- or four-part numeric versions.");
        }
        else if (target <= current)
        {
            Add(reasons, UpdateBlockCode.DowngradeOrSameVersion,
                "The target version must be newer than the current version.");
        }

        if (packages.IsEmpty)
        {
            Add(reasons, UpdateBlockCode.InvalidInput, "At least one verified package is required.");
            return;
        }

        if (packages.Any(package => package is null))
        {
            Add(reasons, UpdateBlockCode.InvalidInput, "A package entry is missing.");
        }

        var presentPackages = packages.Where(package => package is not null).Select(package => package!).ToArray();
        if (presentPackages.Length == 0)
        {
            return;
        }

        var firstKind = presentPackages[0].Kind;
        if (!Enum.IsDefined(firstKind) || presentPackages.Any(package => package.Kind != firstKind))
        {
            Add(reasons, UpdateBlockCode.UnsupportedPackageMix,
                "Only one supported package kind may appear in a plan.");
        }

        var packageIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var package in presentPackages)
        {
            if (!Enum.IsDefined(package.Kind) || !IsSafePackageId(package.PackageId)
                || !packageIds.Add(package.PackageId) || package.DownloadSizeBytes < 0 || !IsSha256(package.Sha256))
            {
                Add(reasons, UpdateBlockCode.InvalidInput,
                    "Every package needs a unique safe ID, supported kind, non-negative size, and SHA-256 hash.");
            }

            if (!string.Equals(package.TargetVersion, release.TargetVersion, StringComparison.Ordinal)
                || !TryParseStrictVersion(package.TargetVersion, out _))
            {
                Add(reasons, UpdateBlockCode.MixedRelease,
                    $"Package '{package.PackageId}' does not exactly match the verified target release.");
            }

            if (package.Kind is UpdatePackageKind.Delta)
            {
                if (!TryParseStrictVersion(package.BaseVersion, out _)
                    || !string.Equals(package.BaseVersion, installation.CurrentVersion, StringComparison.Ordinal))
                {
                    Add(reasons, UpdateBlockCode.WrongDeltaBase,
                        $"Delta package '{package.PackageId}' does not exactly match the installed base version.");
                }
            }
            else if (package.Kind is UpdatePackageKind.Full && package.BaseVersion is not null)
            {
                Add(reasons, UpdateBlockCode.InvalidInput, "A full package cannot declare a delta base version.");
            }
        }
    }

    private static void ValidateProtectedInventory(
        VerifiedGenshinInstallation installation,
        Dictionary<string, ProtectedComponentKind> protectedPaths,
        ImmutableArray<UpdateBlockReason>.Builder reasons)
    {
        if (installation.ProtectedComponents is null)
        {
            Add(reasons, UpdateBlockCode.InvalidInput, "Verified protected-component evidence is missing.");
            return;
        }

        if (installation.ProtectedComponents.Paths.IsDefault)
        {
            Add(reasons, UpdateBlockCode.InvalidInput,
                "Verified protected-component evidence is uninitialized.");
            return;
        }

        foreach (var component in Normalize(installation.ProtectedComponents.Paths))
        {
            if (component is null || !Enum.IsDefined(component.Kind) || !IsSafeRelativePath(component.RelativePath))
            {
                Add(reasons, UpdateBlockCode.InvalidInput, "Protected-component evidence contains an invalid entry.");
                continue;
            }

            if (!protectedPaths.TryAdd(component.RelativePath, component.Kind))
            {
                Add(reasons, UpdateBlockCode.DuplicatePath,
                    $"Protected path '{component.RelativePath}' is ambiguous.");
            }
        }
    }

    private static void ValidateInstallationFiles(
        ImmutableArray<VerifiedInstalledUpdateFile?> files,
        Dictionary<string, VerifiedInstalledUpdateFile> managed,
        Dictionary<string, VerifiedInstalledUpdateFile> unknown,
        ImmutableArray<UpdateBlockReason>.Builder reasons)
    {
        if (files.IsEmpty)
        {
            Add(reasons, UpdateBlockCode.InvalidInput, "The complete verified installation inventory is missing.");
            return;
        }

        foreach (var file in files)
        {
            if (file is null || !Enum.IsDefined(file.Kind) || !IsSafeRelativePath(file.RelativePath)
                || file.SizeBytes < 0 || !IsSha256(file.Sha256))
            {
                Add(reasons, UpdateBlockCode.InvalidInput, "The installation inventory contains an invalid entry.");
                continue;
            }

            if (managed.ContainsKey(file.RelativePath) || unknown.ContainsKey(file.RelativePath))
            {
                Add(reasons, UpdateBlockCode.DuplicatePath,
                    $"Installed path '{file.RelativePath}' is ambiguous.");
                continue;
            }

            (file.Kind is InstalledFileKind.PublisherManaged ? managed : unknown).Add(file.RelativePath, file);
        }
    }

    private static void ValidateResultFiles(
        ImmutableArray<VerifiedResultFile?> files,
        Dictionary<string, VerifiedResultFile> result,
        ImmutableArray<UpdateBlockReason>.Builder reasons)
    {
        if (files.IsEmpty)
        {
            Add(reasons, UpdateBlockCode.InvalidInput, "The complete verified result set is missing.");
            return;
        }

        foreach (var file in files)
        {
            if (file is null || !IsSafeRelativePath(file.RelativePath)
                || file.SizeBytes < 0 || !IsSha256(file.Sha256))
            {
                Add(reasons, UpdateBlockCode.InvalidInput, "The result set contains an invalid entry.");
                continue;
            }

            if (!result.TryAdd(file.RelativePath, file))
            {
                Add(reasons, UpdateBlockCode.DuplicatePath,
                    $"Result path '{file.RelativePath}' is ambiguous.");
            }
        }
    }

    private static void ValidateAndApplyChanges(
        ImmutableArray<VerifiedUpdatePackage?> packages,
        Dictionary<string, ProtectedComponentKind> protectedPaths,
        Dictionary<string, VerifiedInstalledUpdateFile> installedManaged,
        Dictionary<string, VerifiedInstalledUpdateFile> installedUnknown,
        Dictionary<string, VerifiedResultFile> workingResult,
        HashSet<string> changedPaths,
        ImmutableArray<PlannedUpdateOperation>.Builder operations,
        ImmutableArray<UpdateBlockReason>.Builder reasons)
    {
        foreach (var package in packages)
        {
            if (package is null)
            {
                continue;
            }

            var changes = Normalize(package.Changes);
            if (changes.IsEmpty)
            {
                Add(reasons, UpdateBlockCode.InvalidPackageChange,
                    $"Package '{package.PackageId}' has no complete change manifest.");
                continue;
            }

            foreach (var change in changes)
            {
                if (change is null || !Enum.IsDefined(change.Kind) || !IsSafeRelativePath(change.RelativePath))
                {
                    Add(reasons, UpdateBlockCode.InvalidPackageChange,
                        $"Package '{package.PackageId}' contains an invalid change entry.");
                    continue;
                }

                if (!changedPaths.Add(change.RelativePath))
                {
                    Add(reasons, UpdateBlockCode.DuplicatePath,
                        $"More than one package change targets '{change.RelativePath}'.");
                    continue;
                }

                if (protectedPaths.TryGetValue(change.RelativePath, out var protectedKind))
                {
                    AddProtectedBlock(protectedKind, change.RelativePath, reasons);
                    continue;
                }

                if (installedUnknown.ContainsKey(change.RelativePath))
                {
                    Add(reasons, UpdateBlockCode.UnknownFileMutation,
                        $"Unknown file '{change.RelativePath}' must be preserved and cannot be changed.");
                    continue;
                }

                var hasManagedBase = installedManaged.TryGetValue(change.RelativePath, out var baseFile);
                if (package.Kind is UpdatePackageKind.Delta)
                {
                    if (hasManagedBase && !SameHash(change.ExpectedBaseSha256, baseFile!.Sha256))
                    {
                        Add(reasons, UpdateBlockCode.InvalidPackageChange,
                            $"Delta base hash does not match '{change.RelativePath}'.");
                        continue;
                    }

                    if (!hasManagedBase && change.ExpectedBaseSha256 is not null)
                    {
                        Add(reasons, UpdateBlockCode.InvalidPackageChange,
                            $"Delta package expects a missing base file '{change.RelativePath}'.");
                        continue;
                    }
                }

                if (change.Kind is UpdateFileChangeKind.Delete)
                {
                    if (!hasManagedBase || change.ResultSha256 is not null || change.ResultSizeBytes != 0)
                    {
                        Add(reasons, UpdateBlockCode.InvalidPackageChange,
                            $"Delete operation for '{change.RelativePath}' is not fully proven.");
                        continue;
                    }

                    workingResult.Remove(change.RelativePath);
                }
                else
                {
                    if (change.ResultSizeBytes < 0 || !IsSha256(change.ResultSha256))
                    {
                        Add(reasons, UpdateBlockCode.InvalidPackageChange,
                            $"Write operation for '{change.RelativePath}' lacks a result hash and size.");
                        continue;
                    }

                    workingResult[change.RelativePath] = new VerifiedResultFile(
                        change.RelativePath, change.ResultSizeBytes, change.ResultSha256!);
                }

                operations.Add(new PlannedUpdateOperation(
                    change.RelativePath,
                    change.Kind,
                    change.ExpectedBaseSha256,
                    change.ResultSha256,
                    change.ResultSizeBytes));
            }
        }
    }

    private static void AddProtectedBlock(
        ProtectedComponentKind kind,
        string path,
        ImmutableArray<UpdateBlockReason>.Builder reasons)
    {
        var (code, label) = kind switch
        {
            ProtectedComponentKind.AntiCheat => (UpdateBlockCode.AntiCheatBlocked, "Anti-cheat"),
            ProtectedComponentKind.WindowsService => (UpdateBlockCode.ServiceBlocked, "Windows service"),
            ProtectedComponentKind.KernelDriver => (UpdateBlockCode.DriverBlocked, "Driver"),
            _ => (UpdateBlockCode.InvalidInput, "Unknown protected component")
        };
        Add(reasons, code, $"{label} path '{path}' requires a separate reviewed boundary.");
    }

    private static bool EquivalentResult(
        Dictionary<string, VerifiedResultFile> actual,
        Dictionary<string, VerifiedResultFile> expected) =>
        actual.Count == expected.Count
        && expected.All(pair => actual.TryGetValue(pair.Key, out var actualFile)
            && actualFile.SizeBytes == pair.Value.SizeBytes
            && SameHash(actualFile.Sha256, pair.Value.Sha256));

    private static bool IsSafeRelativePath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !path.IsNormalized(NormalizationForm.FormC)
            || path.StartsWith('\\') || path.EndsWith('\\') || path.Contains('/') || path.Contains(':')
            || path.Contains('\0') || path.Contains("\\\\"))
        {
            return false;
        }

        return path.Split('\\').All(IsSafePathSegment);
    }

    private static bool IsSafePathSegment(string segment)
    {
        if (segment.Length == 0 || segment is "." or ".." || segment.EndsWith(' ') || segment.EndsWith('.'))
        {
            return false;
        }

        if (segment.Any(character => character < ' ' || "<>\"|?*".Contains(character)))
        {
            return false;
        }

        var deviceName = segment.Split('.')[0];
        if (deviceName.Equals("CON", StringComparison.OrdinalIgnoreCase)
            || deviceName.Equals("PRN", StringComparison.OrdinalIgnoreCase)
            || deviceName.Equals("AUX", StringComparison.OrdinalIgnoreCase)
            || deviceName.Equals("NUL", StringComparison.OrdinalIgnoreCase)
            || deviceName.Equals("CLOCK$", StringComparison.OrdinalIgnoreCase)
            || deviceName.Equals("CONIN$", StringComparison.OrdinalIgnoreCase)
            || deviceName.Equals("CONOUT$", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (deviceName.Length == 4
            && (deviceName.StartsWith("COM", StringComparison.OrdinalIgnoreCase)
                || deviceName.StartsWith("LPT", StringComparison.OrdinalIgnoreCase)))
        {
            return deviceName[3] is not (>= '1' and <= '9') and not '¹' and not '²' and not '³';
        }

        return true;
    }

    private static bool TryParseStrictVersion(string? value, out Version version)
    {
        version = new Version();
        if (string.IsNullOrEmpty(value))
        {
            return false;
        }

        var parts = value.Split('.');
        if (parts.Length is < 3 or > 4
            || parts.Any(part => part.Length == 0 || (part.Length > 1 && part[0] == '0')
                || part.Any(character => character is < '0' or > '9'))
            || !Version.TryParse(value, out var parsed)
            || parsed.ToString(parts.Length) != value)
        {
            return false;
        }

        version = parsed;
        return true;
    }

    private static bool IsSafePackageId(string? value) =>
        value is { Length: >= 1 and <= 128 }
        && value[0] is (>= 'A' and <= 'Z') or (>= 'a' and <= 'z') or (>= '0' and <= '9')
        && value.All(character => character is (>= 'A' and <= 'Z') or (>= 'a' and <= 'z')
            or (>= '0' and <= '9') or '-' or '_' or '.');

    private static bool IsSafeIdentifier(string? value) => IsSafePackageId(value);

    private static bool IsSha256(string? value) => value is { Length: 64 }
        && value.All(char.IsAsciiHexDigit);

    private static bool SameHash(string? left, string? right) =>
        string.Equals(left, right, StringComparison.OrdinalIgnoreCase);

    private static ImmutableArray<T?> Normalize<T>(ImmutableArray<T> values) where T : class =>
        values.IsDefault ? ImmutableArray<T?>.Empty : values.Cast<T?>().ToImmutableArray();

    private static void Add(
        ImmutableArray<UpdateBlockReason>.Builder reasons,
        UpdateBlockCode code,
        string message) => reasons.Add(new UpdateBlockReason(code, message));

    private static GenshinUpdateEvaluation Blocked(
        string currentVersion,
        string targetVersion,
        ImmutableArray<string> preservedUnknown,
        long requiredStaging,
        long requiredRollback,
        ImmutableArray<UpdateBlockReason>.Builder reasons) => new(
            currentVersion,
            targetVersion,
            ImmutableArray<string>.Empty,
            ImmutableArray<PlannedUpdateOperation>.Empty,
            preservedUnknown,
            requiredStaging,
            requiredRollback,
            reasons.ToImmutable());
}
