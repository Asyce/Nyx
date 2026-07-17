using System.Reflection;
using Nyx.Desktop.Core.Tools;

namespace Nyx.Desktop.Tests.Tools;

public sealed class PengoWebToolCatalogTests
{
    private static readonly (string GameId, PengoWebToolKind Kind, string Destination)[] Expected =
    [
        ("gi", PengoWebToolKind.PullTracker, "https://pengo.gg/genshin/tracker"),
        ("gi", PengoWebToolKind.Achievements, "https://pengo.gg/genshin/achievements"),
        ("hsr", PengoWebToolKind.PullTracker, "https://pengo.gg/hsr/tracker"),
        ("hsr", PengoWebToolKind.Achievements, "https://pengo.gg/hsr/achievements"),
        ("zzz", PengoWebToolKind.PullTracker, "https://pengo.gg/zzz/tracker"),
        ("wuwa", PengoWebToolKind.PullTracker, "https://pengo.gg/wuwa/tracker"),
        ("ae", PengoWebToolKind.PullTracker, "https://pengo.gg/endfield/tracker"),
    ];

    [Fact]
    public void Catalog_exposes_exactly_five_pull_and_two_achievement_destinations()
    {
        var actual = PengoWebToolCatalog.All
            .Select(definition => (
                definition.GameId,
                definition.Kind,
                definition.Destination.AbsoluteUri))
            .ToArray();

        Assert.Equal(Expected, actual);
        Assert.Equal(5, actual.Count(entry => entry.Kind is PengoWebToolKind.PullTracker));
        Assert.Equal(2, actual.Count(entry => entry.Kind is PengoWebToolKind.Achievements));
        Assert.Equal(
            [PengoWebToolKind.PullTracker, PengoWebToolKind.Achievements],
            Enum.GetValues<PengoWebToolKind>());
    }

    [Fact]
    public void Every_destination_is_an_exact_path_on_the_fixed_secure_origin()
    {
        Assert.All(PengoWebToolCatalog.All, definition =>
        {
            var destination = definition.Destination;

            Assert.True(destination.IsAbsoluteUri);
            Assert.Equal(Uri.UriSchemeHttps, destination.Scheme);
            Assert.Equal("pengo.gg", destination.IdnHost);
            Assert.True(destination.IsDefaultPort);
            Assert.Empty(destination.UserInfo);
            Assert.Empty(destination.Query);
            Assert.Empty(destination.Fragment);
            Assert.Contains(
                Expected,
                expected => expected.GameId == definition.GameId
                    && expected.Kind == definition.Kind
                    && expected.Destination == destination.AbsoluteUri);
        });
    }

    [Theory]
    [InlineData("gi", PengoWebToolKind.PullTracker, "https://pengo.gg/genshin/tracker")]
    [InlineData("gi", PengoWebToolKind.Achievements, "https://pengo.gg/genshin/achievements")]
    [InlineData("hsr", PengoWebToolKind.PullTracker, "https://pengo.gg/hsr/tracker")]
    [InlineData("hsr", PengoWebToolKind.Achievements, "https://pengo.gg/hsr/achievements")]
    [InlineData("zzz", PengoWebToolKind.PullTracker, "https://pengo.gg/zzz/tracker")]
    [InlineData("wuwa", PengoWebToolKind.PullTracker, "https://pengo.gg/wuwa/tracker")]
    [InlineData("ae", PengoWebToolKind.PullTracker, "https://pengo.gg/endfield/tracker")]
    public void Exact_supported_pair_resolves_to_its_only_destination(
        string gameId,
        PengoWebToolKind kind,
        string expectedDestination)
    {
        Assert.True(PengoWebToolCatalog.TryGet(gameId, kind, out var definition));
        Assert.NotNull(definition);
        Assert.Equal(gameId, definition.GameId);
        Assert.Equal(kind, definition.Kind);
        Assert.Equal(expectedDestination, definition.Destination.AbsoluteUri);
    }

    [Theory]
    [InlineData("zzz")]
    [InlineData("wuwa")]
    [InlineData("ae")]
    public void Achievement_route_is_rejected_for_games_without_website_support(string gameId)
    {
        Assert.False(PengoWebToolCatalog.TryGet(
            gameId,
            PengoWebToolKind.Achievements,
            out var definition));
        Assert.Null(definition);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("GI")]
    [InlineData("Gi")]
    [InlineData("HSR")]
    [InlineData("genshin")]
    [InlineData("endfield")]
    [InlineData("ww")]
    [InlineData("/gi")]
    [InlineData("gi ")]
    public void Alias_case_whitespace_and_noncanonical_game_ids_fail_closed(string? gameId)
    {
        Assert.False(PengoWebToolCatalog.TryGet(
            gameId,
            PengoWebToolKind.PullTracker,
            out var definition));
        Assert.Null(definition);
    }

    [Fact]
    public void Every_canonical_game_id_is_ordinal_case_sensitive()
    {
        foreach (var canonicalId in new[] { "gi", "hsr", "zzz", "wuwa", "ae" })
        {
            Assert.False(PengoWebToolCatalog.TryGet(
                canonicalId.ToUpperInvariant(),
                PengoWebToolKind.PullTracker,
                out var definition));
            Assert.Null(definition);
        }
    }

    [Fact]
    public void Undefined_tool_kind_fails_closed()
    {
        Assert.False(PengoWebToolCatalog.TryGet(
            "gi",
            (PengoWebToolKind)int.MaxValue,
            out var definition));
        Assert.Null(definition);
    }

    [Fact]
    public void Public_surface_cannot_construct_or_mutate_a_destination()
    {
        Assert.Empty(typeof(PengoWebToolDefinition).GetConstructors());
        Assert.All(
            typeof(PengoWebToolDefinition).GetProperties(),
            property => Assert.False(property.CanWrite));

        var publicMethods = typeof(PengoWebToolCatalog)
            .GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly)
            .Where(method => !method.IsSpecialName)
            .ToArray();
        Assert.Single(publicMethods);
        Assert.Equal(nameof(PengoWebToolCatalog.TryGet), publicMethods[0].Name);
        Assert.Equal(
            [typeof(string), typeof(PengoWebToolKind), typeof(PengoWebToolDefinition).MakeByRefType()],
            publicMethods[0].GetParameters().Select(parameter => parameter.ParameterType));
        Assert.DoesNotContain(
            publicMethods[0].GetParameters(),
            parameter => parameter.ParameterType == typeof(Uri)
                || parameter.Name?.Contains("url", StringComparison.OrdinalIgnoreCase) is true
                || parameter.Name?.Contains("route", StringComparison.OrdinalIgnoreCase) is true
                || parameter.Name?.Contains("argument", StringComparison.OrdinalIgnoreCase) is true
                || parameter.Name?.Contains("command", StringComparison.OrdinalIgnoreCase) is true);
    }

    [Fact]
    public void Core_tools_source_has_no_execution_extraction_or_remote_api_capability()
    {
        var source = string.Join(
            '\n',
            Directory.GetFiles(FindToolsSourceRoot(), "*.cs")
                .Order(StringComparer.Ordinal)
                .Select(File.ReadAllText));

        foreach (var forbidden in new[]
                 {
                     "using System.Diagnostics;",
                     "ProcessStartInfo",
                     "Process.Start",
                     "Windows.System.Launcher",
                     "PowerShell",
                     "WebView",
                     "Clipboard",
                     "HttpClient",
                     "System.Net",
                     "File.Read",
                     "File.Write",
                     "Directory.GetFiles",
                     "Get-ChildItem",
                     "webCaches",
                     "Client.log",
                     "/api/",
                     "pengo-pulls.ps1",
                     "pengo-achievements.ps1",
                 })
        {
            Assert.DoesNotContain(forbidden, source, StringComparison.OrdinalIgnoreCase);
        }
    }

    private static string FindToolsSourceRoot()
    {
        for (var current = new DirectoryInfo(AppContext.BaseDirectory);
             current is not null;
             current = current.Parent)
        {
            var candidate = Path.Combine(
                current.FullName,
                "Desktop",
                "src",
                "Nyx.Desktop.Core",
                "Tools");
            if (Directory.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new DirectoryNotFoundException("Could not find the Core tools source root.");
    }
}
