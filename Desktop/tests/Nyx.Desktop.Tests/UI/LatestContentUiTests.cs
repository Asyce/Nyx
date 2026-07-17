namespace Nyx.Desktop.Tests.UI;

public sealed class LatestContentUiTests
{
    private static readonly string WorkspaceRoot = FindWorkspaceRoot();

    [Fact]
    public void Selected_game_drives_source_freshness_and_at_most_three_text_cards()
    {
        var code = ReadAppFile("MainPage.xaml.cs");
        var render = Slice(code, "private void RenderLatestContent()", "private void RenderGenshin()");

        Assert.Contains("latestContent.Current.TryGetValue(selected.Id", render, StringComparison.Ordinal);
        Assert.Contains("LatestSourceText.Text", render, StringComparison.Ordinal);
        Assert.Contains("LatestFreshnessText.Text", render, StringComparison.Ordinal);
        Assert.Contains("snapshot.IsFallback ? \"LOCAL\" : \"FRESH\"", render, StringComparison.Ordinal);
        Assert.Contains("AutomationProperties.SetName(LatestFreshnessText", render, StringComparison.Ordinal);
        Assert.Contains("snapshot.Cards.Take(3)", render, StringComparison.Ordinal);
        Assert.Contains("LatestCards.Add(LatestContentCardItem.From(card, cardIndex++))", render, StringComparison.Ordinal);
        Assert.Contains("var cardIndex = 0", render, StringComparison.Ordinal);
        Assert.DoesNotContain("ApprovedLink", render, StringComparison.Ordinal);
        Assert.DoesNotContain("Image", render, StringComparison.Ordinal);
    }

    [Fact]
    public void Content_refresh_only_repaints_latest_and_never_changes_game_session_state()
    {
        var code = ReadAppFile("MainPage.xaml.cs");
        var handler = Slice(
            code,
            "private void LatestContent_Updated(object? sender, EventArgs e)",
            "private void GameSelector_SelectionChanged");

        Assert.Contains("RenderLatestContent", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("RequestLaunch", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("sessionRefresh", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("gameSnapshot", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("updaterStatus", handler, StringComparison.Ordinal);
    }

    [Fact]
    public void Page_subscribes_for_automatic_updates_and_unsubscribes_when_unloaded()
    {
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains("latestContent.Updated += LatestContent_Updated", code, StringComparison.Ordinal);
        Assert.Contains("latestContent.Updated -= LatestContent_Updated", code, StringComparison.Ordinal);
        Assert.Contains("latestContent = app.LatestContent", code, StringComparison.Ordinal);
        Assert.Contains("RenderLatestContent();", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Publisher_date_label_is_used_before_timestamp_or_current_fallback()
    {
        var code = ReadAppFile("MainPage.xaml.cs");
        var publisherLabel = code.IndexOf("DateLabel = card.PublisherDateLabel", StringComparison.Ordinal);
        var timestamp = code.IndexOf("?? card.PublishedAt", publisherLabel, StringComparison.Ordinal);
        var current = code.IndexOf("?? \"CURRENT\"", timestamp, StringComparison.Ordinal);

        Assert.True(publisherLabel >= 0);
        Assert.True(timestamp > publisherLabel);
        Assert.True(current > timestamp);
    }

    [Fact]
    public void App_starts_optional_content_service_and_packages_offline_snapshot()
    {
        var app = ReadAppFile("App.xaml.cs");
        var project = ReadAppFile("Nyx.Desktop.App.csproj");
        var bundled = Path.Combine(
            WorkspaceRoot,
            "Desktop",
            "src",
            "Nyx.Desktop.App",
            "Assets",
            "Content",
            "launcher-content-bundled-v1.json");

        Assert.Contains("_latestContent = new LatestContentService", app, StringComparison.Ordinal);
        Assert.Contains("_latestContent.Start();", app, StringComparison.Ordinal);
        Assert.Contains("DisposeLatestContentAsync", app, StringComparison.Ordinal);
        Assert.Contains("Assets\\Content\\**\\*", project, StringComparison.Ordinal);
        Assert.True(File.Exists(bundled));
        Assert.True(new FileInfo(bundled).Length > 0);
    }

    private static string Slice(string source, string startMarker, string endMarker)
    {
        var start = source.IndexOf(startMarker, StringComparison.Ordinal);
        var end = source.IndexOf(endMarker, start + startMarker.Length, StringComparison.Ordinal);
        Assert.True(start >= 0, $"Could not find {startMarker}.");
        Assert.True(end > start, $"Could not find {endMarker} after {startMarker}.");
        return source[start..end];
    }

    private static string ReadAppFile(params string[] relativeSegments) =>
        File.ReadAllText(Path.Combine(
            [
                WorkspaceRoot,
                "Desktop",
                "src",
                "Nyx.Desktop.App",
                .. relativeSegments,
            ]));

    private static string FindWorkspaceRoot()
    {
        for (var current = new DirectoryInfo(AppContext.BaseDirectory);
             current is not null;
             current = current.Parent)
        {
            if (Directory.Exists(Path.Combine(current.FullName, "Desktop", "src", "Nyx.Desktop.App")))
            {
                return current.FullName;
            }
        }

        throw new DirectoryNotFoundException("Could not find the Nyx workspace root.");
    }
}
