using System.Collections.Immutable;
using System.Reflection;
using Nyx.Desktop.Core.Updating;

namespace Nyx.Desktop.Tests.Updating;

public sealed class GenshinUpdatePlannerTests
{
    private const string OldHash = "1111111111111111111111111111111111111111111111111111111111111111";
    private const string NewHash = "2222222222222222222222222222222222222222222222222222222222222222";
    private const string AddedHash = "3333333333333333333333333333333333333333333333333333333333333333";
    private const string UnchangedHash = "4444444444444444444444444444444444444444444444444444444444444444";
    private const string PackageHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private const string UnknownHash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    [Fact]
    public void Verified_full_package_produces_internal_ready_dry_run()
    {
        var plan = Plan(ReadyRequest(UpdatePackageKind.Full));

        Assert.True(plan.IsReady);
        Assert.Equal(UpdatePlanStatus.Ready, plan.Status);
        Assert.Equal("full-6.8.0", Assert.Single(plan.PackageIds));
        Assert.Equal(2, plan.Operations.Length);
        Assert.Equal(190, plan.RequiredStagingBytes);
        Assert.Equal(50, plan.RequiredRollbackBytes);
        Assert.Equal("personal\\notes.txt", Assert.Single(plan.PreservedUnknownFiles));
        Assert.Empty(plan.BlockReasons);
    }

    [Fact]
    public void Verified_delta_requires_and_accepts_exact_base_hashes()
    {
        var plan = Plan(ReadyRequest(UpdatePackageKind.Delta));

        Assert.True(plan.IsReady);
        Assert.Equal(OldHash, plan.Operations.Single(operation => operation.RelativePath == "data.bin").ExpectedBaseSha256);
    }

    [Fact]
    public void Default_package_array_blocks_without_throwing()
    {
        var request = ReadyRequest(UpdatePackageKind.Full);
        request = request with { Release = request.Release with { Packages = default } };

        var exception = Record.Exception(() => Plan(request));

        Assert.Null(exception);
        AssertBlocked(Plan(request));
    }

    [Theory]
    [InlineData("installation")]
    [InlineData("result")]
    [InlineData("protected")]
    [InlineData("changes")]
    public void Other_default_arrays_block_without_throwing(string target)
    {
        var request = ReadyRequest(UpdatePackageKind.Full);
        request = target switch
        {
            "installation" => request with
            {
                Installation = request.Installation with { Files = default }
            },
            "result" => request with
            {
                Release = request.Release with { ResultFiles = default }
            },
            "protected" => request with
            {
                Installation = request.Installation with
                {
                    ProtectedComponents = request.Installation.ProtectedComponents with { Paths = default }
                }
            },
            _ => request with
            {
                Release = request.Release with
                {
                    Packages = request.Release.Packages.SetItem(0,
                        request.Release.Packages[0] with { Changes = default })
                }
            }
        };

        var exception = Record.Exception(() => Plan(request));

        Assert.Null(exception);
        AssertBlocked(Plan(request));
    }

    [Theory]
    [InlineData("release")]
    [InlineData("storage")]
    [InlineData("package")]
    [InlineData("protected")]
    public void Evidence_from_a_different_root_or_release_binding_blocks(string artifact)
    {
        var request = ReadyRequest(UpdatePackageKind.Full);
        var other = new UpdateEvidenceBinding("other-root", "other-release");
        request = artifact switch
        {
            "release" => request with { Release = request.Release with { Binding = other } },
            "storage" => request with { Storage = request.Storage with { Binding = other } },
            "package" => request with
            {
                Release = request.Release with
                {
                    Packages = request.Release.Packages.SetItem(0,
                        request.Release.Packages[0] with { Binding = other })
                }
            },
            _ => request with
            {
                Installation = request.Installation with
                {
                    ProtectedComponents = request.Installation.ProtectedComponents with { Binding = other }
                }
            }
        };

        AssertBlockedWith(request, UpdateBlockCode.EvidenceBindingMismatch);
    }

    [Fact]
    public void Equal_binding_text_does_not_forge_the_same_opaque_binding()
    {
        var request = ReadyRequest(UpdatePackageKind.Full);
        var copy = new UpdateEvidenceBinding(
            request.Installation.Binding.RootEvidenceId,
            request.Installation.Binding.ReleaseEvidenceId);
        request = request with { Storage = request.Storage with { Binding = copy } };

        AssertBlockedWith(request, UpdateBlockCode.EvidenceBindingMismatch);
    }

    [Theory]
    [InlineData(0, 9)]
    [InlineData(1, 10)]
    [InlineData(2, 11)]
    public void Independently_verified_protected_paths_block(
        int kindValue,
        int expectedValue)
    {
        var kind = (ProtectedComponentKind)kindValue;
        var expected = (UpdateBlockCode)expectedValue;
        var request = ReadyRequest(UpdatePackageKind.Full);
        request = request with
        {
            Installation = request.Installation with
            {
                ProtectedComponents = request.Installation.ProtectedComponents with
                {
                    Paths = ImmutableArray.Create(new ProtectedUpdatePath("data.bin", kind))
                }
            }
        };

        AssertBlockedWith(request, expected);
    }

    [Fact]
    public void Package_changes_have_no_caller_declared_protected_role()
    {
        Assert.Null(typeof(VerifiedUpdateFileChange).GetProperty("Role"));
        Assert.DoesNotContain(typeof(VerifiedUpdateFileChange).GetProperties(),
            property => property.PropertyType == typeof(ProtectedComponentKind));
    }

    [Fact]
    public void Budgets_cover_complete_target_and_complete_managed_rollback_not_only_changes()
    {
        var plan = Plan(ReadyRequest(UpdatePackageKind.Full));

        Assert.True(plan.IsReady);
        Assert.Equal(100 + 20 + 30 + 40, plan.RequiredStagingBytes);
        Assert.Equal(10 + 40, plan.RequiredRollbackBytes);
    }

    [Theory]
    [InlineData("6.8")]
    [InlineData("6.08.0")]
    [InlineData(" 6.8.0")]
    [InlineData("6.8.0 ")]
    [InlineData("6.8.0.0.0")]
    [InlineData("6.8.0+release")]
    public void Loose_or_noncanonical_versions_block(string targetVersion)
    {
        var request = ReadyRequest(UpdatePackageKind.Full);
        request = request with
        {
            Release = request.Release with
            {
                TargetVersion = targetVersion,
                Packages = request.Release.Packages.SetItem(0,
                    request.Release.Packages[0] with { TargetVersion = targetVersion })
            }
        };

        AssertBlockedWith(request, UpdateBlockCode.InvalidVersion);
    }

    [Theory]
    [InlineData("../package")]
    [InlineData(".hidden")]
    [InlineData("bad package")]
    [InlineData("bad/package")]
    [InlineData("Δelta")]
    public void Unsafe_package_ids_block(string packageId)
    {
        var request = ReadyRequest(UpdatePackageKind.Full);
        request = request with
        {
            Release = request.Release with
            {
                Packages = request.Release.Packages.SetItem(0,
                    request.Release.Packages[0] with { PackageId = packageId })
            }
        };

        AssertBlockedWith(request, UpdateBlockCode.InvalidInput);
    }

    [Theory]
    [InlineData("CONIN$")]
    [InlineData("CONOUT$.bin")]
    [InlineData("content\\COM¹.log")]
    [InlineData("content\\COM².log")]
    [InlineData("content\\COM³.log")]
    [InlineData("content\\LPT¹.log")]
    [InlineData("content\\LPT².log")]
    [InlineData("content\\LPT³.log")]
    [InlineData("content\\NUL.txt")]
    [InlineData("..\\escape.bin")]
    public void Windows_device_and_escape_paths_block(string unsafePath)
    {
        var request = ReadyRequest(UpdatePackageKind.Full);
        var package = request.Release.Packages[0];
        request = request with
        {
            Release = request.Release with
            {
                Packages = request.Release.Packages.SetItem(0,
                    package with
                    {
                        Changes = package.Changes.SetItem(0,
                            package.Changes[0] with { RelativePath = unsafePath })
                    })
            }
        };

        AssertBlockedWith(request, UpdateBlockCode.InvalidPackageChange);
    }

    [Fact]
    public void Downgrade_blocks()
    {
        var request = ReadyRequest(UpdatePackageKind.Full);
        request = request with
        {
            Release = request.Release with
            {
                TargetVersion = "6.6.0",
                Packages = request.Release.Packages.SetItem(0,
                    request.Release.Packages[0] with { TargetVersion = "6.6.0" })
            }
        };

        AssertBlockedWith(request, UpdateBlockCode.DowngradeOrSameVersion);
    }

    [Fact]
    public void Delta_for_wrong_base_blocks()
    {
        var request = ReadyRequest(UpdatePackageKind.Delta);
        request = request with
        {
            Release = request.Release with
            {
                Packages = request.Release.Packages.SetItem(0,
                    request.Release.Packages[0] with { BaseVersion = "6.6.0" })
            }
        };

        AssertBlockedWith(request, UpdateBlockCode.WrongDeltaBase);
    }

    [Fact]
    public void Result_set_mismatch_blocks()
    {
        var request = ReadyRequest(UpdatePackageKind.Full);
        request = request with
        {
            Release = request.Release with
            {
                ResultFiles = request.Release.ResultFiles.SetItem(0,
                    request.Release.ResultFiles[0] with { Sha256 = AddedHash })
            }
        };

        AssertBlockedWith(request, UpdateBlockCode.ResultSetMismatch);
    }

    [Fact]
    public void Unknown_file_mutation_blocks_and_unknown_file_remains_preserved()
    {
        var request = ReadyRequest(UpdatePackageKind.Full);
        var package = request.Release.Packages[0];
        request = request with
        {
            Release = request.Release with
            {
                Packages = request.Release.Packages.SetItem(0,
                    package with
                    {
                        Changes = package.Changes.Add(new VerifiedUpdateFileChange(
                            "personal\\notes.txt", UpdateFileChangeKind.Delete, null, null, 0))
                    })
            }
        };

        var plan = Plan(request);

        AssertBlocked(plan);
        Assert.Contains(plan.BlockReasons, reason => reason.Code is UpdateBlockCode.UnknownFileMutation);
        Assert.Equal("personal\\notes.txt", Assert.Single(plan.PreservedUnknownFiles));
    }

    [Theory]
    [InlineData(189, 50, 17)]
    [InlineData(190, 49, 18)]
    public void Insufficient_complete_tree_budget_blocks(long staging, long rollback, int expectedValue)
    {
        var expected = (UpdateBlockCode)expectedValue;
        var request = ReadyRequest(UpdatePackageKind.Full);
        request = request with { Storage = request.Storage with
        {
            AvailableStagingBytes = staging,
            AvailableRollbackBytes = rollback
        } };

        AssertBlockedWith(request, expected);
    }

    [Theory]
    [InlineData(1, 2)]
    [InlineData(2, 2)]
    [InlineData(3, 3)]
    public void Unsafe_root_state_blocks(int stateValue, int expectedValue)
    {
        var state = (InstallationPathState)stateValue;
        var expected = (UpdateBlockCode)expectedValue;
        var request = ReadyRequest(UpdatePackageKind.Full);
        request = request with { Installation = request.Installation with { PathState = state } };

        AssertBlockedWith(request, expected);
    }

    [Fact]
    public void Null_request_blocks_without_throwing()
    {
        var plan = Plan(null);

        AssertBlocked(plan);
        Assert.Contains(plan.BlockReasons, reason => reason.Code is UpdateBlockCode.InvalidInput);
    }

    [Fact]
    public void No_external_caller_can_create_or_consume_updater_ready_state()
    {
        var assembly = typeof(GenshinUpdatePlanner).Assembly;
        var updaterTypes = assembly.GetTypes()
            .Where(type => type.Namespace == typeof(GenshinUpdatePlanner).Namespace)
            .ToArray();

        Assert.NotEmpty(updaterTypes);
        Assert.DoesNotContain(assembly.GetExportedTypes(),
            type => type.Namespace == typeof(GenshinUpdatePlanner).Namespace);
        Assert.All(updaterTypes, type => Assert.True(type.IsNotPublic || type.IsNestedPrivate));

        var planType = typeof(GenshinUpdatePlan);
        Assert.True(planType.IsSealed);
        Assert.Empty(planType.GetConstructors(BindingFlags.Public | BindingFlags.Instance));
        Assert.Empty(planType.GetProperties(BindingFlags.Public | BindingFlags.Instance));
        Assert.Null(planType.GetMethod("<Clone>$", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic));
        Assert.Null(planType.GetMethod("CreateReady", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic));
        Assert.All(planType.GetConstructors(BindingFlags.NonPublic | BindingFlags.Instance),
            constructor => Assert.True(constructor.IsPrivate));
        Assert.Null(planType.GetProperty("Status", BindingFlags.Instance | BindingFlags.NonPublic)!.SetMethod);
        Assert.True(planType.GetMethod("Evaluate", BindingFlags.Static | BindingFlags.NonPublic)!.IsAssembly);
    }

    [Fact]
    public void Opaque_evidence_has_no_caller_controlled_trust_booleans()
    {
        var evidenceTypes = new[]
        {
            typeof(UpdateEvidenceBinding),
            typeof(VerifiedGenshinInstallation),
            typeof(VerifiedProtectedComponentInventory),
            typeof(VerifiedUpdatePackage),
            typeof(VerifiedPublisherRelease),
            typeof(VerifiedUpdateStorage)
        };

        Assert.All(evidenceTypes, type =>
        {
            Assert.True(type.IsNotPublic);
            Assert.DoesNotContain(type.GetProperties(), property => property.PropertyType == typeof(bool));
            Assert.DoesNotContain(typeof(GenshinUpdatePlanner).Assembly.GetExportedTypes(), exported => exported == type);
        });
    }

    [Fact]
    public void Planner_has_no_integration_dependency()
    {
        var type = typeof(GenshinUpdatePlanner);
        var forbidden = new[] { ".IO", ".Net", ".Diagnostics", ".Automation", ".Interop", ".Windows" };

        Assert.Empty(type.GetInterfaces());
        Assert.DoesNotContain(type.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic),
            field => forbidden.Any(fragment =>
                (field.FieldType.Namespace ?? string.Empty).Contains(fragment, StringComparison.Ordinal)));
    }

    private void AssertBlockedWith(GenshinUpdatePlanningRequest request, UpdateBlockCode code)
    {
        var plan = Plan(request);
        AssertBlocked(plan);
        Assert.Contains(plan.BlockReasons, reason => reason.Code == code);
    }

    private static void AssertBlocked(GenshinUpdatePlan plan)
    {
        Assert.False(plan.IsReady);
        Assert.Equal(UpdatePlanStatus.Blocked, plan.Status);
        Assert.Empty(plan.PackageIds);
        Assert.Empty(plan.Operations);
        Assert.NotEmpty(plan.BlockReasons);
    }

    private static GenshinUpdatePlan Plan(GenshinUpdatePlanningRequest? request) =>
        GenshinUpdatePlan.Evaluate(request);

    private static GenshinUpdatePlanningRequest ReadyRequest(UpdatePackageKind kind)
    {
        var binding = new UpdateEvidenceBinding("root-proof-001", "release-proof-680");
        var changes = ImmutableArray.Create(
            new VerifiedUpdateFileChange(
                "data.bin", UpdateFileChangeKind.Write,
                kind is UpdatePackageKind.Delta ? OldHash : null, NewHash, 20),
            new VerifiedUpdateFileChange(
                "content\\new.bin", UpdateFileChangeKind.Write, null, AddedHash, 30));
        var package = new VerifiedUpdatePackage(
            binding,
            kind is UpdatePackageKind.Full ? "full-6.8.0" : "delta-6.7.0-6.8.0",
            kind,
            kind is UpdatePackageKind.Delta ? "6.7.0" : null,
            "6.8.0",
            100,
            PackageHash,
            changes);

        return new GenshinUpdatePlanningRequest(
            new VerifiedGenshinInstallation(
                binding,
                "genshin-global",
                "6.7.0",
                InstallationPathState.VerifiedCanonical,
                new VerifiedProtectedComponentInventory(binding, ImmutableArray<ProtectedUpdatePath>.Empty),
                ImmutableArray.Create(
                    new VerifiedInstalledUpdateFile(
                        "data.bin", 10, OldHash, InstalledFileKind.PublisherManaged),
                    new VerifiedInstalledUpdateFile(
                        "content\\unchanged.bin", 40, UnchangedHash, InstalledFileKind.PublisherManaged),
                    new VerifiedInstalledUpdateFile(
                        "personal\\notes.txt", 4, UnknownHash, InstalledFileKind.Unknown))),
            new VerifiedPublisherRelease(
                binding,
                "genshin-global",
                "6.8.0",
                ImmutableArray.Create(package),
                ImmutableArray.Create(
                    new VerifiedResultFile("data.bin", 20, NewHash),
                    new VerifiedResultFile("content\\new.bin", 30, AddedHash),
                    new VerifiedResultFile("content\\unchanged.bin", 40, UnchangedHash))),
            new VerifiedUpdateStorage(binding, 190, 50));
    }
}
