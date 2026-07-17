namespace Nyx.Desktop.Tests.UI;

public sealed class PublisherGameLiveSessionUiTests
{
    private static readonly string WorkspaceRoot = FindWorkspaceRoot();

    [Fact]
    public void App_composes_only_the_sealed_factory_and_two_bounded_root_sources()
    {
        var app = ReadAppFile("App.xaml.cs");

        Assert.Contains("PublisherGameDirectLaunchFactory.Create()", app, StringComparison.Ordinal);
        Assert.Contains("var wuwaRootLocator = new WuWaInstallRootLocator()", app, StringComparison.Ordinal);
        Assert.Contains("wuwaRootLocator.LocateRoot", app, StringComparison.Ordinal);
        Assert.Contains("Preferences.EndfieldInstallRoot", app, StringComparison.Ordinal);
        Assert.DoesNotContain("ApplicationData.Current", app, StringComparison.Ordinal);
        Assert.Contains("EndfieldRootStore.Load", app, StringComparison.Ordinal);
        Assert.Contains("\"wuwa\" or \"ae\" => PublisherGameSessions[game.Id]", app, StringComparison.Ordinal);
        Assert.DoesNotContain(@"D:\Gaming", app, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("GetDirectories", app, StringComparison.Ordinal);
        Assert.DoesNotContain("EnumerateDirectories", app, StringComparison.Ordinal);
    }

    [Fact]
    public void Endfield_picker_is_window_owned_and_saves_only_after_sealed_identity_proof()
    {
        var page = ReadAppFile("MainPage.xaml.cs");
        var start = page.IndexOf("private async void ChooseGameFolderButton_Click", StringComparison.Ordinal);
        var end = page.IndexOf("private async void OpenUpdaterButton_Click", start, StringComparison.Ordinal);
        var picker = page[start..end];

        Assert.Contains("new FolderPicker", picker, StringComparison.Ordinal);
        Assert.Contains("InitializeWithWindow.Initialize(picker, app.WindowHandle)", picker, StringComparison.Ordinal);
        Assert.Contains("picker.PickSingleFolderAsync()", picker, StringComparison.Ordinal);
        Assert.Contains("publisherGameLaunchService.CheckGame(\"ae\", folder.Path)", picker, StringComparison.Ordinal);
        Assert.Contains("endfieldFolderSelections.IsCurrent(", picker, StringComparison.Ordinal);
        Assert.Contains("selectionAttempt", picker, StringComparison.Ordinal);
        Assert.True(
            picker.IndexOf("CheckGame(\"ae\", folder.Path)", StringComparison.Ordinal)
            < picker.IndexOf("endfieldFolderSelections.CompleteAsync", StringComparison.Ordinal));
        Assert.Contains("endfieldRootStore.TrySave", picker, StringComparison.Ordinal);
        Assert.Contains("endfieldRootStore.Clear", picker, StringComparison.Ordinal);
        Assert.Contains("result.NeedsReview", picker, StringComparison.Ordinal);
        Assert.Contains("sessionRefresh.RefreshNowAsync", picker, StringComparison.Ordinal);
        Assert.DoesNotContain("LaunchGame", picker, StringComparison.Ordinal);
        Assert.DoesNotContain("Process.Start", picker, StringComparison.Ordinal);
    }

    [Fact]
    public void Both_rows_render_full_session_lifecycle_without_a_version_currentness_claim()
    {
        var page = ReadAppFile("MainPage.xaml.cs");
        var start = page.IndexOf("private void RenderPublisherSession", StringComparison.Ordinal);
        var end = page.IndexOf("private void RenderEndfield", start, StringComparison.Ordinal);
        var render = page[start..end];

        Assert.Contains("LocalGameStatus.Ready", render, StringComparison.Ordinal);
        Assert.Contains("LocalGameStatus.Starting", render, StringComparison.Ordinal);
        Assert.Contains("LocalGameStatus.Running", render, StringComparison.Ordinal);
        Assert.Contains("LocalGameStatus.LaunchFailed", render, StringComparison.Ordinal);
        Assert.Contains("LocalReadinessEvidence.NotFound", render, StringComparison.Ordinal);
        Assert.Contains("Needs review", render, StringComparison.Ordinal);
        Assert.Contains("TRY AGAIN", render, StringComparison.Ordinal);
        Assert.DoesNotContain("WithVersion", render, StringComparison.Ordinal);
        Assert.DoesNotContain("Version", render, StringComparison.Ordinal);
        Assert.Contains("RenderPublisherSession(selected)", page[page.IndexOf("private void RenderEndfield", StringComparison.Ordinal)..], StringComparison.Ordinal);
        Assert.Contains("RenderPublisherSession(selected)", page[page.IndexOf("private void RenderWuWa", StringComparison.Ordinal)..], StringComparison.Ordinal);
    }

    [Fact]
    public void One_launch_click_and_rail_support_all_five_independent_game_ids()
    {
        var page = ReadAppFile("MainPage.xaml.cs");
        var clickStart = page.IndexOf("private async void LaunchButton_Click", StringComparison.Ordinal);
        var clickEnd = page.IndexOf("private async void ChooseGameFolderButton_Click", clickStart, StringComparison.Ordinal);
        var click = page[clickStart..clickEnd];

        Assert.Contains("var gameId = selected.Id", click, StringComparison.Ordinal);
        Assert.Contains("gameActionsInFlight.Add(gameId)", click, StringComparison.Ordinal);
        Assert.Contains("sessions.RequestLaunchAsync(gameId", click, StringComparison.Ordinal);
        Assert.DoesNotContain("gameId is not", click, StringComparison.Ordinal);
        Assert.Contains("directLaunchSupported: true", page, StringComparison.Ordinal);
    }

    [Fact]
    public void Endfield_update_wording_and_separate_official_dispatch_are_visible()
    {
        var page = ReadAppFile("MainPage.xaml.cs");
        var start = page.IndexOf("private void RenderEndfield", StringComparison.Ordinal);
        var end = page.IndexOf("private void RenderWuWa", start, StringComparison.Ordinal);
        var render = page[start..end];

        Assert.Contains("GRYPHLINK", render, StringComparison.Ordinal);
        Assert.Contains("OpenUpdaterButton.Visibility = Visibility.Visible", render, StringComparison.Ordinal);
        Assert.Contains("OPEN GRYPHLINK", render, StringComparison.Ordinal);
        Assert.Contains("updates, pre-downloads, verification and repairs", render, StringComparison.Ordinal);
        Assert.Contains("OpenEndfieldMaintenanceAsync", page, StringComparison.Ordinal);
        Assert.Contains("endfieldMaintenance.OpenOrObserveCurrentAsync", page, StringComparison.Ordinal);
    }

    [Fact]
    public void Launch_failure_wording_is_honest_for_each_publisher_game()
    {
        var page = ReadAppFile("MainPage.xaml.cs");
        var start = page.IndexOf("private void RenderPublisherSession", StringComparison.Ordinal);
        var end = page.IndexOf("private void RenderEndfield", start, StringComparison.Ordinal);
        var render = page[start..end];

        Assert.Contains("Wuthering Waves did not start. Check its files with the official launcher.", render, StringComparison.Ordinal);
        Assert.Contains("Arknights: Endfield did not start. Choose Change Folder if GRYPHLINK moved the game.", render, StringComparison.Ordinal);
        Assert.DoesNotContain("Its verified folder is still saved", render, StringComparison.Ordinal);
    }

    private static string ReadAppFile(string fileName) => File.ReadAllText(Path.Combine(
        WorkspaceRoot,
        "Desktop",
        "src",
        "Nyx.Desktop.App",
        fileName));

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
