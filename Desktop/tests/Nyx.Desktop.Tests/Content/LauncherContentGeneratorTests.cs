using System.Diagnostics;
using System.Text.Json;

namespace Nyx.Desktop.Tests.Content;

public sealed class LauncherContentGeneratorTests
{
    [Fact]
    public void Generator_rolls_expired_hsr_current_to_next()
    {
        var fixture = """
            {"games":[{"id":"hsr","current":{"phase":"4.3","end":"2026-07-14T16:00:00.000Z","characters":[{"name":"Old"}]},"next":{"phase":"4.4","start":"2026-07-14T16:00:00.000Z","end":"2026-08-25T16:00:00.000Z","characters":[{"name":"Sparxie"}]}}]}
            """;

        using var result = RunGenerator(fixture, "2026-07-15T00:00:00.000Z", "hsr");

        Assert.Equal("4.4", result.RootElement.GetProperty("phase").GetString());
        Assert.Equal("Sparxie", result.RootElement.GetProperty("names")[0].GetString());
    }

    [Fact]
    public void Generator_selects_current_then_next_at_exact_rollover()
    {
        var fixture = """
            {"games":[{"id":"wuwa","current":{"phase":"A","start":"2026-07-01T00:00:00.000Z","end":"2026-07-15T00:00:00.000Z","characters":[{"name":"A"}]},"next":{"phase":"B","start":"2026-07-15T00:00:00.000Z","end":"2026-08-01T00:00:00.000Z","characters":[{"name":"B"}]}}]}
            """;

        using var before = RunGenerator(fixture, "2026-07-14T23:59:59.000Z", "wuwa");
        using var rollover = RunGenerator(fixture, "2026-07-15T00:00:00.000Z", "wuwa");

        Assert.Equal("A", before.RootElement.GetProperty("phase").GetString());
        Assert.Equal("B", rollover.RootElement.GetProperty("phase").GetString());
    }

    [Fact]
    public void Generator_rejects_overlapping_zzz_active_phases()
    {
        var fixture = """
            {"games":[{"id":"zzz","current":{"phase":"3.0","start":"2026-07-01T00:00:00.000Z","end":"2026-07-28T00:00:00.000Z","characters":[{"name":"A"}]},"next":{"phase":"3.1","start":"2026-07-08T00:00:00.000Z","end":"2026-07-29T00:00:00.000Z","characters":[{"name":"B"}]}}]}
            """;

        using var result = RunGenerator(fixture, "2026-07-15T00:00:00.000Z", "zzz");

        Assert.Equal(JsonValueKind.Null, result.RootElement.ValueKind);
    }

    [Fact]
    public void Generated_snapshot_is_bounded_deterministic_and_contains_no_urls_or_html()
    {
        var fixture = """
            {"games":[
              {"id":"wuwa","current":{"phase":"<b>Phase</b>","end":"2026-08-20T10:00:00.000Z","characters":[{"name":"One"},{"name":"Two"},{"name":"Three"},{"name":"Four"}]}},
              {"id":"endfield","current":{"phase":"1.3","end":"2026-07-16T02:00:00.000Z","characters":[{"name":"Camille"}]}}
            ]}
            """;

        var first = RunGeneratorText(fixture, "2026-07-15T00:00:00.000Z");
        var second = RunGeneratorText(fixture, "2026-07-15T00:00:00.000Z");
        using var document = JsonDocument.Parse(first);

        Assert.Equal(first, second);
        Assert.Equal(["wuwa", "ae"], document.RootElement.GetProperty("games")
            .EnumerateObject().Select(property => property.Name));
        Assert.DoesNotContain("http", first, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("<", first, StringComparison.Ordinal);
        Assert.DoesNotContain("Four", first, StringComparison.Ordinal);
        Assert.InRange(first.Length, 1, 4096);
    }

    private static JsonDocument RunGenerator(string fixture, string at, string inspect) =>
        JsonDocument.Parse(RunGeneratorText(fixture, at, inspect));

    private static string RunGeneratorText(string fixture, string at, string? inspect = null)
    {
        var fixturePath = Path.Combine(Path.GetTempPath(), $"nyx-launcher-content-{Guid.NewGuid():N}.json");
        File.WriteAllText(fixturePath, fixture);
        try
        {
            var script = Path.Combine(FindWorkspaceRoot(), "Site", "tools", "generate-site-data.mjs");
            var arguments = new List<string>
            {
                script,
                "--launcher-content-only",
                "--launcher-content-stdout",
                $"--launcher-content-input={fixturePath}",
                $"--launcher-content-at={at}",
            };
            if (inspect is not null)
            {
                arguments.Add($"--launcher-content-inspect={inspect}");
            }

            var start = new ProcessStartInfo("node")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };
            foreach (var argument in arguments)
            {
                start.ArgumentList.Add(argument);
            }

            using var process = Process.Start(start) ?? throw new InvalidOperationException("Node did not start.");
            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit(30_000);
            Assert.Equal(0, process.ExitCode);
            Assert.True(string.IsNullOrEmpty(error), error);
            return output;
        }
        finally
        {
            File.Delete(fixturePath);
        }
    }

    private static string FindWorkspaceRoot()
    {
        for (var current = new DirectoryInfo(AppContext.BaseDirectory);
             current is not null;
             current = current.Parent)
        {
            if (File.Exists(Path.Combine(current.FullName, "Site", "tools", "generate-site-data.mjs")))
            {
                return current.FullName;
            }
        }

        throw new DirectoryNotFoundException();
    }
}
