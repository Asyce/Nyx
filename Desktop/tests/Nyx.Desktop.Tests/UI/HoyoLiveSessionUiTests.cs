namespace Nyx.Desktop.Tests.UI;

public sealed class HoyoLiveSessionUiTests
{
    private static readonly string WorkspaceRoot = FindWorkspaceRoot();

    [Fact]
    public void App_registers_production_adapters_for_all_five_rows()
    {
        var app = ReadAppFile("App.xaml.cs");

        Assert.Contains("[\"hsr\"] = new(\"hsr\", hoyoDiscovery, hoyoLaunchService)", app, StringComparison.Ordinal);
        Assert.Contains("[\"zzz\"] = new(\"zzz\", hoyoDiscovery, hoyoLaunchService)", app, StringComparison.Ordinal);
        Assert.Contains("\"hsr\" or \"zzz\" => HoyoSessions[game.Id]", app, StringComparison.Ordinal);
        Assert.Contains("[\"wuwa\"] = new(", app, StringComparison.Ordinal);
        Assert.Contains("[\"ae\"] = new(", app, StringComparison.Ordinal);
        Assert.Contains("\"wuwa\" or \"ae\" => PublisherGameSessions[game.Id]", app, StringComparison.Ordinal);
        Assert.DoesNotContain("new FailClosedGameSessionAdapter", app, StringComparison.Ordinal);
    }

    [Fact]
    public void One_launch_button_targets_the_selected_game_and_tracks_inflight_per_game()
    {
        var page = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains("var gameId = selected.Id;", page, StringComparison.Ordinal);
        Assert.Contains("sessions.RequestLaunchAsync(gameId", page, StringComparison.Ordinal);
        Assert.Contains("HashSet<string> gameActionsInFlight", page, StringComparison.Ordinal);
        Assert.Contains("gameActionsInFlight.Add(gameId)", page, StringComparison.Ordinal);
        Assert.Contains("gameActionsInFlight.Remove(gameId)", page, StringComparison.Ordinal);
        Assert.DoesNotContain("sessions.RequestLaunchAsync(\"gi\"", page, StringComparison.Ordinal);
    }

    [Fact]
    public void Selection_and_refresh_render_each_hoyo_game_independently()
    {
        var page = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains("gameSnapshot = sessions.GetSnapshot(selected.Id)", page, StringComparison.Ordinal);
        Assert.Contains("selected.Id is \"hsr\" or \"zzz\"", page, StringComparison.Ordinal);
        Assert.Contains("RenderHoyo(selected)", page, StringComparison.Ordinal);
        Assert.Contains("e.Snapshots.TryGetValue(selected.Id", page, StringComparison.Ordinal);
        Assert.Contains("PublisherMaintenanceLabel(selected.Id)", page, StringComparison.Ordinal);
        Assert.Contains("OpenUpdaterButton.Visibility = Visibility.Visible", page, StringComparison.Ordinal);
    }

    [Fact]
    public void Ordinary_window_activation_refresh_does_not_reset_close_confirmation()
    {
        var app = ReadAppFile("App.xaml.cs");
        var start = app.IndexOf("private async Task RefreshAfterActivationAsync()", StringComparison.Ordinal);
        var end = app.IndexOf("private static async Task DisposeRefreshAsync", start, StringComparison.Ordinal);
        var activation = app[start..end];

        Assert.Contains("await SessionRefresh.RefreshNowAsync()", activation, StringComparison.Ordinal);
        Assert.DoesNotContain("ResetAfterResumeAndRefreshAsync", activation, StringComparison.Ordinal);
    }

    private static string ReadAppFile(string fileName) =>
        File.ReadAllText(Path.Combine(
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
