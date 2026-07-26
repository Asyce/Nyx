namespace Nyx.Desktop.Tests.UI;

public sealed class HoyoLiveSessionUiTests
{
    private static readonly string WorkspaceRoot = FindWorkspaceRoot();

    [Fact]
    public void App_registers_production_adapters_for_all_five_rows()
    {
        var app = ReadAppFile("App.xaml.cs");

        Assert.Contains("[\"hsr\"] = new(\"hsr\", hoyoDiscovery, hoyoLaunchService, () => GetManualInstallRoot(\"hsr\")", app, StringComparison.Ordinal);
        Assert.Contains("[\"zzz\"] = new(\"zzz\", hoyoDiscovery, hoyoLaunchService, () => GetManualInstallRoot(\"zzz\")", app, StringComparison.Ordinal);
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

        Assert.Contains("gameSnapshot = sessions.TryGetSnapshot(selected.Id", page, StringComparison.Ordinal);
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

    [Fact]
    public void Shared_account_strip_expires_daily_labels_and_displays_hsr_reserve_and_recovery()
    {
        var page = ReadAppFile("MainPage.xaml.cs");
        var projection = ReadAppFile(Path.Combine("ViewModels", "LauncherLayoutState.cs"));

        Assert.Contains("PublisherAccountPresentation.IsCurrentDayCheckIn(checkIn, now)", page, StringComparison.Ordinal);
        Assert.Contains("RenderLocalAccountTimeTick();", page, StringComparison.Ordinal);
        Assert.Contains("resource.Reserve is { } reserve", projection, StringComparison.Ordinal);
        Assert.Contains("RemainingRecoverySeconds(resource, now)", projection, StringComparison.Ordinal);
        Assert.Contains("RESERVE {reserve}", projection, StringComparison.Ordinal);
        Assert.Contains("FULL {label}", projection, StringComparison.Ordinal);
    }

    [Fact]
    public void Endfield_uses_separate_connect_lifecycle_and_keeps_numeric_data_in_protocol_terminal()
    {
        var page = ReadAppFile("MainPage.xaml.cs");
        var service = ReadAppFile("PublisherAccountService.cs");

        Assert.Contains("ConnectPublisherAccountAsync(selected.Id)", page, StringComparison.Ordinal);
        Assert.Contains("selected.Id == \"ae\"", page, StringComparison.Ordinal);
        Assert.Contains("OpenOfficialResourcePageAsync(\"ae\")", page, StringComparison.Ordinal);
        Assert.Contains("OFFICIAL PROTOCOL TERMINAL", page, StringComparison.Ordinal);
        Assert.Contains("AcquireProfileOwnership(\"SKPORT\")", service, StringComparison.Ordinal);
        Assert.Contains("RunProviderCheckInsAsync(\"SKPORT\", [\"ae\"]", service, StringComparison.Ordinal);
        Assert.Contains("oldSkportSession.CancelAsync()", service, StringComparison.Ordinal);
        Assert.Contains("skportGate.Dispose()", service, StringComparison.Ordinal);
        Assert.Contains("skportProfileOwner.Release()", service, StringComparison.Ordinal);
    }

    [Fact]
    public void Publisher_account_actions_are_double_gated_by_default_off_per_publisher_consent()
    {
        var app = ReadAppFile("App.xaml.cs");
        var page = ReadAppFile("MainPage.xaml.cs");
        var service = ReadAppFile("PublisherAccountService.cs");
        var flags = File.ReadAllText(Path.Combine(
            WorkspaceRoot,
            "Desktop",
            "src",
            "Nyx.Desktop.Core",
            "Features",
            "LauncherFeatureFlags.cs"));

        Assert.Contains("public bool HoyoLabAccountAccess { get; init; }", flags, StringComparison.Ordinal);
        Assert.Contains("public bool SkportAccountAccess { get; init; }", flags, StringComparison.Ordinal);
        Assert.Contains("public bool HoyoLabAccountCleanupPending { get; init; }", flags, StringComparison.Ordinal);
        Assert.Contains("public bool SkportAccountCleanupPending { get; init; }", flags, StringComparison.Ordinal);
        Assert.Contains("accountFlags.HoyoLabAccountAccess", app, StringComparison.Ordinal);
        Assert.Contains("accountFlags.SkportAccountAccess", app, StringComparison.Ordinal);
        Assert.Contains("accountFlags.HoyoLabAccountCleanupPending", app, StringComparison.Ordinal);
        Assert.Contains("accountFlags.SkportAccountCleanupPending", app, StringComparison.Ordinal);
        Assert.Contains("LauncherState.Changed += LauncherState_Changed", app, StringComparison.Ordinal);
        Assert.Contains("_publisherAccounts?.ApplyConsentSnapshot", app, StringComparison.Ordinal);
        Assert.Contains("RecoverPendingPublisherRevocationsAsync", app, StringComparison.Ordinal);
        Assert.Contains("HasPublisherConsent(gameId)", page, StringComparison.Ordinal);
        Assert.Contains("publisherAccounts.RevokeConsentAsync", page, StringComparison.Ordinal);
        Assert.Contains("publisherAccounts.PrepareConsentEnableAsync", page, StringComparison.Ordinal);
        Assert.Contains("publisherAccounts.CompleteConsentRevocation", page, StringComparison.Ordinal);
        Assert.Contains("HoyoLabAccountAccess = enabled", page, StringComparison.Ordinal);
        Assert.Contains("SkportAccountAccess = enabled", page, StringComparison.Ordinal);
        Assert.Contains("HoyoLabAccountCleanupPending = !enabled", page, StringComparison.Ordinal);
        Assert.Contains("SkportAccountCleanupPending = !enabled", page, StringComparison.Ordinal);
        Assert.Contains("OFF · CLEANUP PENDING", page, StringComparison.Ordinal);

        var officialPage = Slice(
            service,
            "public async Task<bool> OpenOfficialResourcePageAsync",
            "public PublisherAccountSummary");
        Assert.Contains("consent.IsEnabled(entry.Provider)", officialPage, StringComparison.Ordinal);
        Assert.True(
            officialPage.IndexOf("consent.IsEnabled(entry.Provider)", StringComparison.Ordinal)
            < officialPage.IndexOf("Launcher.LaunchUriAsync", StringComparison.Ordinal));
        Assert.Contains(
            "if (!consent.IsEnabled(entry.Provider))",
            Slice(service, "public async Task<PublisherConnectionState> ConnectAsync", "public Task<PublisherResourceSnapshot?>"),
            StringComparison.Ordinal);
        Assert.Contains(
            "if (!consent.IsEnabled(entry.Provider))",
            Slice(service, "public Task<PublisherResourceSnapshot?> RefreshResourceAsync", "private async Task<PublisherResourceSnapshot?>"),
            StringComparison.Ordinal);
        Assert.Contains(
            "if (!consent.IsEnabled(entry.Provider))",
            Slice(service, "public async Task<PublisherConnectionState> DisconnectAsync", "public async Task<PublisherConnectionState> RevokeConsentAsync"),
            StringComparison.Ordinal);
        Assert.Contains("if (consent.IsEnabled(\"HoYoLAB\"))", service, StringComparison.Ordinal);
        Assert.Contains("if (consent.IsEnabled(\"SKPORT\"))", service, StringComparison.Ordinal);
        var revoke = Slice(
            service,
            "public async Task<PublisherConnectionState> RevokeConsentAsync",
            "private async Task<PublisherConnectionState> DisconnectCoreAsync");
        Assert.True(
            revoke.IndexOf("consent.Set(entry.Provider, enabled: false)", StringComparison.Ordinal)
            < revoke.IndexOf("revocations.MarkPending(entry.Provider)", StringComparison.Ordinal));
        Assert.True(
            revoke.IndexOf("revocations.MarkPending(entry.Provider)", StringComparison.Ordinal)
            < revoke.IndexOf("DisconnectCoreAsync", StringComparison.Ordinal));
    }

    [Fact]
    public void Multiple_hoyo_roles_use_a_transient_unselected_masked_picker_and_protected_store()
    {
        var page = ReadAppFile("MainPage.xaml.cs");
        var service = ReadAppFile("PublisherAccountService.cs");
        var store = File.ReadAllText(Path.Combine(
            WorkspaceRoot,
            "Desktop",
            "src",
            "Nyx.Desktop.Infrastructure",
            "AccountStatus",
            "PublisherRoleBindingStore.cs"));

        var picker = Slice(
            page,
            "private async Task<PublisherRoleBinding?> ChoosePublisherRoleAsync",
            "private async Task ConnectPublisherAccountAsync");
        Assert.Contains("IsPrimaryButtonEnabled = false", picker, StringComparison.Ordinal);
        Assert.Contains("masked UID and region", picker, StringComparison.Ordinal);
        Assert.DoesNotContain("SelectedIndex", picker, StringComparison.Ordinal);
        Assert.Contains("roleBindings.Save", service, StringComparison.Ordinal);
        Assert.Contains("roleBindings.DeleteProvider", service, StringComparison.Ordinal);
        Assert.Contains("roleBindings.Delete(entry.GameId)", service, StringComparison.Ordinal);
        Assert.Contains("CryptProtectData", store, StringComparison.Ordinal);
        Assert.Contains("CryptUnprotectData", store, StringComparison.Ordinal);
        Assert.Contains("CryptographicOperations.ZeroMemory", store, StringComparison.Ordinal);
    }

    private static string Slice(string text, string startMarker, string endMarker)
    {
        var start = text.IndexOf(startMarker, StringComparison.Ordinal);
        var end = text.IndexOf(endMarker, start + startMarker.Length, StringComparison.Ordinal);
        Assert.True(start >= 0 && end > start);
        return text[start..end];
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
