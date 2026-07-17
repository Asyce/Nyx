using System.Text.Json;
using Nyx.Desktop.ReadOnlyPilot;

namespace Nyx.Desktop.Tests.PublisherGames;

public sealed class ReadOnlyPilotSurfaceTests
{
    private static readonly string WorkspaceRoot = FindWorkspaceRoot();

    [Theory]
    [InlineData("wuwa")]
    [InlineData("ae")]
    public void Exact_supported_game_and_explicit_root_parse_in_either_order(string gameId)
    {
        var root = Path.Combine(Path.GetTempPath(), "nyx-pilot-missing");

        Assert.True(PilotCommand.TryParse(["--game", gameId, "--root", root], out var normal));
        Assert.True(PilotCommand.TryParse(["--root", root, "--game", gameId], out var reversed));
        Assert.Equal(new PilotRequest(gameId, root), normal);
        Assert.Equal(normal, reversed);
    }

    [Theory]
    [InlineData()]
    [InlineData("--game", "gi", "--root", "C:\\Games")]
    [InlineData("--game", "wuwa", "--root", "")]
    [InlineData("--game", "wuwa", "--game", "ae")]
    [InlineData("--root", "C:\\Games", "--root", "D:\\Games")]
    [InlineData("wuwa", "C:\\Games", "--root", "D:\\Games")]
    public void Missing_unsupported_duplicate_or_unlabeled_input_fails_closed(params string[] arguments)
    {
        Assert.False(PilotCommand.TryParse(arguments, out var request));
        Assert.Null(request);
    }

    [Fact]
    public void Oversized_root_is_rejected_before_adapter_entry()
    {
        var oversized = new string('x', 32_768);

        Assert.False(
            PilotCommand.TryParse(["--game", "wuwa", "--root", oversized], out var request));
        Assert.Null(request);
    }

    [Theory]
    [InlineData("wuwa")]
    [InlineData("ae")]
    public void Missing_root_returns_one_sanitized_bounded_read_only_result(string gameId)
    {
        var secretRoot = Path.Combine(Path.GetTempPath(), $"nyx-private-{Guid.NewGuid():N}");

        var output = PilotCommand.Inspect(new(gameId, secretRoot));
        var json = JsonSerializer.Serialize(output);

        Assert.Equal(gameId, output.GameId);
        Assert.Equal("NotFound", output.Status);
        Assert.Equal("DirectoryNotFound", output.Reason);
        Assert.Equal("Unavailable", output.VersionState);
        Assert.Null(output.Version);
        Assert.False(output.HasFullInstallMaintenanceProof);
        Assert.False(output.AllowsDirectGameLaunch);
        Assert.True(output.ReadOnly);
        Assert.DoesNotContain(secretRoot, json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("CanonicalRoot", json, StringComparison.Ordinal);
        Assert.DoesNotContain("LauncherPath", json, StringComparison.Ordinal);
        Assert.InRange(json.Length, 1, 512);
    }

    [Fact]
    public void Pilot_source_has_no_execution_network_registry_write_cache_or_log_capability()
    {
        var sourceRoot = Path.Combine(
            WorkspaceRoot,
            "Desktop",
            "tools",
            "Nyx.Desktop.ReadOnlyPilot");
        var source = string.Join(
            '\n',
            Directory.GetFiles(sourceRoot, "*.cs").Order().Select(File.ReadAllText));

        foreach (var forbidden in new[]
                 {
                     "System.Diagnostics",
                     "ProcessStartInfo",
                     "Process.Start",
                     "System.Net",
                     "HttpClient",
                     "Registry",
                     "File.Write",
                     "File.Append",
                     "File.Create",
                     "Directory.Create",
                     "Environment.GetEnvironmentVariable",
                     "cache",
                     "cookie",
                     "credential",
                     "log",
                     "runas",
                     "UseShellExecute",
                 })
        {
            Assert.DoesNotContain(forbidden, source, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void Pilot_output_surface_cannot_retain_paths_or_raw_evidence()
    {
        Assert.Equal(
            new[]
            {
                "AllowsDirectGameLaunch",
                "GameId",
                "HasFullInstallMaintenanceProof",
                "ReadOnly",
                "Reason",
                "Status",
                "Version",
                "VersionState",
            },
            typeof(PilotOutput).GetProperties().Select(property => property.Name).Order());
        Assert.DoesNotContain(
            typeof(PilotOutput).GetProperties(),
            property => property.PropertyType != typeof(string)
                && property.PropertyType != typeof(bool));
    }

    private static string FindWorkspaceRoot()
    {
        for (var current = new DirectoryInfo(AppContext.BaseDirectory);
             current is not null;
             current = current.Parent)
        {
            if (File.Exists(Path.Combine(current.FullName, "Desktop", "Nyx.Desktop.slnx")))
            {
                return current.FullName;
            }
        }

        throw new DirectoryNotFoundException("Could not find the Nyx workspace root.");
    }
}
