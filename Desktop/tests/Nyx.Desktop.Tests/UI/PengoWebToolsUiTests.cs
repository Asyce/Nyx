using System.Text.RegularExpressions;

namespace Nyx.Desktop.Tests.UI;

public sealed class PengoWebToolsUiTests
{
    private static readonly string WorkspaceRoot = FindWorkspaceRoot();

    [Fact]
    public void Shell_exposes_one_pull_action_and_one_game_aware_achievement_action()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Single(Regex.Matches(xaml, "x:Name=\"OpenPullTrackerButton\"").Cast<Match>());
        Assert.Single(Regex.Matches(xaml, "x:Name=\"OpenAchievementsButton\"").Cast<Match>());
        Assert.Contains("PULL HISTORY", xaml, StringComparison.Ordinal);
        Assert.Contains("ACHIEVEMENTS", xaml, StringComparison.Ordinal);
        Assert.Contains("OPENS IN YOUR BROWSER", xaml, StringComparison.Ordinal);
        Assert.Contains("PengoWebToolKind.PullTracker", code, StringComparison.Ordinal);
        Assert.Contains("PengoWebToolKind.Achievements", code, StringComparison.Ordinal);
        Assert.Contains("OpenAchievementsButton.Visibility = achievementsAvailable", code, StringComparison.Ordinal);
        Assert.Contains("Visibility.Collapsed", code, StringComparison.Ordinal);
        Assert.Contains("selected.DisplayName", code, StringComparison.Ordinal);
        Assert.Contains("AutomationProperties.SetName", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Explicit_click_opens_only_the_catalog_definition_and_suppresses_duplicates()
    {
        var code = ReadAppFile("MainPage.xaml.cs");
        var handler = Slice(
            code,
            "private async void OpenPullTrackerButton_Click",
            "private void SessionRefresh_Refreshed");

        Assert.Contains("PengoWebToolCatalog.TryGet(selected.Id, kind, out var definition)", handler, StringComparison.Ordinal);
        Assert.Contains("webToolActionsInFlight.Add(action)", handler, StringComparison.Ordinal);
        Assert.Contains("webToolActionsInFlight.Remove(action)", handler, StringComparison.Ordinal);
        Assert.Contains("Windows.System.Launcher.LaunchUriAsync(definition.Destination)", handler, StringComparison.Ordinal);
        Assert.Contains("sessionUiLifetime.TryRun(lease", handler, StringComparison.Ordinal);
        Assert.Contains("Windows could not open the Pengo page", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("http://", handler, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("https://", handler, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Process.Start", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("PowerShell", handler, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("WebView", handler, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Clipboard", handler, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("RequestLaunch", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("OpenOrObserveCurrentAsync", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("webCaches", handler, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("/api/", handler, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Tool_feedback_and_busy_state_are_isolated_per_game_and_latest_invocation()
    {
        var code = ReadAppFile("MainPage.xaml.cs");
        var handler = Slice(
            code,
            "private async void OpenPullTrackerButton_Click",
            "private void SessionRefresh_Refreshed");
        var render = Slice(code, "private void RenderPengoTools", "private void RefreshGameRailSignals");

        Assert.Contains("webToolActionsInFlight.Contains((selected.Id", render, StringComparison.Ordinal);
        Assert.Contains("webToolFeedbackByGame.TryGetValue(selected.Id", render, StringComparison.Ordinal);
        Assert.Contains("feedback.Message", render, StringComparison.Ordinal);
        Assert.Contains("feedbackGeneration", handler, StringComparison.Ordinal);
        Assert.Contains("SetPengoWebToolFeedbackIfCurrent", handler, StringComparison.Ordinal);
        Assert.Contains("current.Generation == generation", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("webToolFeedbackGameId", code, StringComparison.Ordinal);
        Assert.Contains("Endfield currently supports JSON, CSV, and manual pull import.", render, StringComparison.Ordinal);
        Assert.DoesNotContain("gameActionsInFlight", render, StringComparison.Ordinal);
        Assert.DoesNotContain("updaterActionInFlight", render, StringComparison.Ordinal);
        Assert.DoesNotContain("wuwaActionInFlight", render, StringComparison.Ordinal);
        Assert.DoesNotContain("endfieldMaintenanceActionInFlight", render, StringComparison.Ordinal);
    }

    [Fact]
    public void Tool_actions_are_keyboard_sized_and_keep_system_focus_visuals()
    {
        var controls = ReadAppFile("Themes", "NyxControls.xaml");
        var xaml = ReadAppFile("MainPage.xaml");

        var start = controls.IndexOf("x:Key=\"NyxToolActionStyle\"", StringComparison.Ordinal);
        var end = controls.IndexOf("x:Key=\"NyxLaunchButtonStyle\"", start, StringComparison.Ordinal);
        Assert.True(start >= 0 && end > start);
        var style = controls[start..end];

        Assert.Contains("MinHeight\" Value=\"44", style, StringComparison.Ordinal);
        Assert.Contains("UseSystemFocusVisuals\" Value=\"True", style, StringComparison.Ordinal);
        Assert.Contains("FocusVisualPrimaryBrush", style, StringComparison.Ordinal);
        Assert.Contains("AutomationProperties.LiveSetting=\"Polite\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Import and extraction choices stay on Pengo.", xaml, StringComparison.Ordinal);
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
