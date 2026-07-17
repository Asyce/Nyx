using System.Text.RegularExpressions;

namespace Nyx.Desktop.Tests.UI;

public sealed class PengoWebToolsUiTests
{
    private static readonly string WorkspaceRoot = FindWorkspaceRoot();

    [Fact]
    public void Shell_exposes_persistent_pull_and_achievement_export_arming()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Single(Regex.Matches(xaml, "x:Name=\"PullExportToggle\"").Cast<Match>());
        Assert.Single(Regex.Matches(xaml, "x:Name=\"AchievementExportToggle\"").Cast<Match>());
        Assert.Contains("Text=\"PULLS\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Text=\"ACHIEVEMENTS\"", xaml, StringComparison.Ordinal);
        Assert.Contains("ExportToggle_Click", xaml, StringComparison.Ordinal);
        Assert.Contains("state.Export.Games.ToDictionary", code, StringComparison.Ordinal);
        Assert.Contains("launcherState.TryUpdate", code, StringComparison.Ordinal);
        Assert.Contains("PullsArmed = pullsArmed", code, StringComparison.Ordinal);
        Assert.Contains("AchievementsArmed = achievementsArmed", code, StringComparison.Ordinal);
        Assert.DoesNotContain("PengoWebToolCatalog", code, StringComparison.Ordinal);
        Assert.DoesNotContain("OPENS IN YOUR BROWSER", xaml, StringComparison.Ordinal);
    }

    [Fact]
    public void Launch_runs_exports_through_the_same_validated_game_admission()
    {
        var code = ReadAppFile("MainPage.xaml.cs");
        var launch = Slice(code, "private async void LaunchButton_Click", "private async void ChooseGameFolderButton_Click");

        Assert.Contains("ExportArmSnapshot.From", launch, StringComparison.Ordinal);
        Assert.Contains("exports.RunForLaunchAsync", launch, StringComparison.Ordinal);
        Assert.Contains("sessions.RequestLaunchAsync(gameId, cancellationToken)", launch, StringComparison.Ordinal);
        Assert.Contains("GameLaunchRequestOutcome.Accepted", launch, StringComparison.Ordinal);
        Assert.Contains("GameLaunchRequestOutcome.AlreadyRunning", launch, StringComparison.Ordinal);
        Assert.Contains("TrackExportJobAsync", launch, StringComparison.Ordinal);
        Assert.DoesNotContain("LaunchUriAsync", launch, StringComparison.Ordinal);
        Assert.DoesNotContain("Clipboard", launch, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Feature_flags_gate_each_lane_and_dormant_provider_controls_are_hidden()
    {
        var code = ReadAppFile("MainPage.xaml.cs");
        var render = Slice(code, "private void RenderExportTools", "private static string FormatExportStatus");

        Assert.Contains("ExportProviderCatalog.GetEnabled", render, StringComparison.Ordinal);
        Assert.Contains("NyxToolsPanel.Visibility = pullsAvailable || achievementsAvailable", render, StringComparison.Ordinal);
        Assert.Contains("PullExportToggle.Visibility = pullsAvailable", render, StringComparison.Ordinal);
        Assert.Contains("AchievementExportToggle.Visibility = achievementsAvailable", render, StringComparison.Ordinal);
        Assert.Contains("PullExportToggle.IsEnabled = pullsAvailable", render, StringComparison.Ordinal);
        Assert.Contains("AchievementExportToggle.IsEnabled = achievementsAvailable", render, StringComparison.Ordinal);
        Assert.DoesNotContain("future provider script", render, StringComparison.Ordinal);
    }

    [Fact]
    public void Export_controls_are_keyboard_sized_report_status_and_allow_safe_cancel()
    {
        var controls = ReadAppFile("Themes", "NyxControls.xaml");
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");
        var start = controls.IndexOf("x:Key=\"NyxExportToggleStyle\"", StringComparison.Ordinal);
        var end = controls.IndexOf("x:Key=\"NyxLaunchButtonStyle\"", start, StringComparison.Ordinal);
        Assert.True(start >= 0 && end > start);
        var style = controls[start..end];

        Assert.Contains("MinHeight\" Value=\"44", style, StringComparison.Ordinal);
        Assert.Contains("UseSystemFocusVisuals\" Value=\"True", style, StringComparison.Ordinal);
        Assert.Contains("AutomationProperties.LiveSetting=\"Polite\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"CancelExportButton\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"OpenExportsButton\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"ConfirmWorldButton\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"ConfirmHistoryButton\"", xaml, StringComparison.Ordinal);
        Assert.Contains("exportSignals.ConfirmWorldReady", code, StringComparison.Ordinal);
        Assert.Contains("exportSignals.ConfirmHistory", code, StringComparison.Ordinal);
        Assert.Contains("exports.Cancel(jobId)", code, StringComparison.Ordinal);
        Assert.Contains("LaunchFolderPathAsync", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Armed_exports_can_be_started_by_a_real_click_while_the_game_is_already_running()
    {
        var code = ReadAppFile("MainPage.xaml.cs");
        var running = Slice(code, "private void SetRunningExportControls", "private void SetLaunchControls");

        Assert.Contains("arm.RequestedKinds != ExportKind.None", running, StringComparison.Ordinal);
        Assert.Contains("SetLaunchControls(true, \"EXPORT\"", running, StringComparison.Ordinal);
        Assert.Contains("!exports.GetSnapshot(jobId).IsFinished", running, StringComparison.Ordinal);
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
            [WorkspaceRoot, "Desktop", "src", "Nyx.Desktop.App", .. relativeSegments]));

    private static string FindWorkspaceRoot()
    {
        for (var current = new DirectoryInfo(AppContext.BaseDirectory);
             current is not null;
             current = current.Parent)
            if (Directory.Exists(Path.Combine(current.FullName, "Desktop", "src", "Nyx.Desktop.App")))
                return current.FullName;
        throw new DirectoryNotFoundException("Could not find the Nyx workspace root.");
    }
}
