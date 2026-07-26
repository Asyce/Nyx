namespace Nyx.Desktop.Tests.UI;

public sealed class BannerCycleUiTests
{
    private static readonly string WorkspaceRoot = FindWorkspaceRoot();

    [Fact]
    public void Selected_game_drives_accessible_current_and_next_banner_cards()
    {
        var code = ReadAppFile("MainPage.xaml.cs");
        var render = Slice(code, "private void RenderBannerCycle()", "private void RenderGenshin()");

        Assert.Contains("launcherBanners.Current.Games.TryGetValue(selected.Id", render, StringComparison.Ordinal);
        Assert.Contains("AutomationProperties.SetName(\n                LatestStrip", render, StringComparison.Ordinal);
        Assert.Contains("SetBannerCard(\n                CurrentBannerCard", render, StringComparison.Ordinal);
        Assert.Contains("SetBannerCard(\n                NextBannerCard", render, StringComparison.Ordinal);
        Assert.Contains("launcherGame.Upcoming", render, StringComparison.Ordinal);
        Assert.DoesNotContain("latestContent.Current", render, StringComparison.Ordinal);
    }

    [Fact]
    public void Banner_refresh_repaints_selection_and_never_changes_game_session_state()
    {
        var code = ReadAppFile("MainPage.xaml.cs");
        var handler = Slice(
            code,
            "private void LauncherBanners_Updated(object? sender, EventArgs e)",
            "private void GameSelector_SelectionChanged");

        Assert.Contains("RenderSelection", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("RequestLaunch", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("sessionRefresh", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("gameSnapshot", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("updaterStatus", handler, StringComparison.Ordinal);
    }

    [Fact]
    public void Remote_manifest_flag_controls_the_banner_schedule()
    {
        var code = ReadAppFile("MainPage.xaml.cs");
        var render = Slice(code, "private void RenderBannerCycle()", "private void RenderGenshin()");
        Assert.Contains("FeatureFlags.RemoteBannerManifest", render, StringComparison.Ordinal);
        Assert.DoesNotContain("FeatureFlags.OfficialNews", render, StringComparison.Ordinal);
        Assert.Contains("LatestStrip.Visibility = !selected.IsCustom", render, StringComparison.Ordinal);
    }

    [Fact]
    public void Premium_codes_are_limited_dated_and_copyable()
    {
        var code = ReadAppFile("MainPage.xaml.cs");
        var render = Slice(code, "private void RenderBannerCycle()", "private void BannerRotationTimer_Tick");
        var click = Slice(code, "private void RedemptionCode_Click", "private async void KofiButton_Click");

        Assert.Contains("SyncRedemptionCodeRows(selected.Id, launcherGame.Codes)", render, StringComparison.Ordinal);
        Assert.Contains(".Take(5)", code, StringComparison.Ordinal);
        Assert.Contains("code.CurrencyAmount", code, StringComparison.Ordinal);
        Assert.Contains("CurrencyIconFor(gameId)", code, StringComparison.Ordinal);
        Assert.Contains("MarkPreviouslyCopied", code, StringComparison.Ordinal);
        Assert.Contains("Clipboard.SetContent(data)", click, StringComparison.Ordinal);
        Assert.Contains("Copied {code}", click, StringComparison.Ordinal);
    }

    [Fact]
    public void Banner_characters_rotate_every_seven_seconds()
    {
        var code = ReadAppFile("MainPage.xaml.cs");
        Assert.Contains("Interval = TimeSpan.FromSeconds(7)", code, StringComparison.Ordinal);
        Assert.Contains("bannerRotationTimer.Start()", code, StringComparison.Ordinal);
        Assert.Contains("bannerRotationTimer.Stop()", code, StringComparison.Ordinal);
        Assert.Contains("bannerRotationIndex++", code, StringComparison.Ordinal);
        Assert.Contains("characters[bannerRotationIndex % characters.Count]", code, StringComparison.Ordinal);
        Assert.Contains("GetPreferredBannerStartIndex(selectedForRotation.Id)", code, StringComparison.Ordinal);
        Assert.Contains("current.SelectedCharacterId", code, StringComparison.Ordinal);
        Assert.Contains("bannerRotationContextKey", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Banner_panel_renders_rows_progress_rail_and_hides_unknown_next()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains("x:Name=\"BannerCharacterList\"", xaml, StringComparison.Ordinal);
        Assert.Contains("ItemsSource=\"{x:Bind BannerCharacterRows, Mode=OneWay}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("ProgressBar", xaml, StringComparison.Ordinal);
        Assert.Contains("Visibility=\"{Binding ActiveVisibility}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("CornerRadius=\"32\"", xaml, StringComparison.Ordinal);
        Assert.Contains("NextBannerName", code, StringComparison.Ordinal);
        Assert.Contains("nameText.Text = bannerName", code, StringComparison.Ordinal);
        Assert.Contains("Height=\"78\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Visibility=\"{Binding ActiveVisibility}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("BorderThickness=\"0\"", xaml, StringComparison.Ordinal);
        Assert.DoesNotContain("Text=\"CURRENT BANNER\"", xaml, StringComparison.Ordinal);
        Assert.DoesNotContain("CurrentBannerCounter", xaml, StringComparison.Ordinal);
        Assert.Contains("current.Characters.Take(5)", code, StringComparison.Ordinal);
        Assert.Contains("NextBannerCard.Visibility = hasUpcoming ? Visibility.Visible : Visibility.Collapsed", code, StringComparison.Ordinal);
        Assert.Contains("existing.Update(portrait, timing, isActive, isPinned", code, StringComparison.Ordinal);
        Assert.Contains("character.Icon is null", code, StringComparison.Ordinal);
        Assert.Contains("if (portraitChanged) Notify(nameof(PortraitSource))", code, StringComparison.Ordinal);
        Assert.DoesNotContain("PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(string.Empty))", code, StringComparison.Ordinal);
        Assert.Contains("GetBannerRotationProgress(now)", code, StringComparison.Ordinal);
        Assert.Contains(".Where(phase => phase.Start > now)", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Banner_rotation_supports_hover_pause_and_schedule_only_pin_toggle()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains("PointerEntered=\"BannerPanel_PointerEntered\"", xaml, StringComparison.Ordinal);
        Assert.Contains("PointerExited=\"BannerPanel_PointerExited\"", xaml, StringComparison.Ordinal);
        Assert.Contains("bannerPinnedGameId = null", code, StringComparison.Ordinal);
        Assert.Contains("bannerPinnedCharacterId = null", code, StringComparison.Ordinal);
        Assert.Contains("bannerPinnedCharacterId = null", code, StringComparison.Ordinal);
        Assert.Contains("Duration = new Duration(TimeSpan.FromMilliseconds(400))", code, StringComparison.Ordinal);
        Assert.Contains("HeroArtworkNext", code, StringComparison.Ordinal);
        Assert.Contains("Placement.Fit", code, StringComparison.Ordinal);
        Assert.Contains("Placement.Y", code, StringComparison.Ordinal);
        Assert.Contains("ApplyHeroTransform(previewAppearance)", code, StringComparison.Ordinal);
        Assert.DoesNotContain("ApplyHeroTransform(appearance, 0.18", code, StringComparison.Ordinal);
        Assert.Contains("allCurrentVariants.FirstOrDefault(asset => asset.Id == appearance.ArtVariant)", code, StringComparison.Ordinal);
        Assert.Contains("automaticArtVariants.TryGetValue(gameId", code, StringComparison.Ordinal);
        Assert.Contains("bannerRotationStartedAt = DateTimeOffset.UtcNow;", code, StringComparison.Ordinal);
        Assert.Contains("var targetArtwork = heroCrossfade is null ? HeroArtwork : HeroArtworkNext", code, StringComparison.Ordinal);
        Assert.Contains("Active banner character", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Code_rows_show_inline_copy_feedback()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains("Text=\"{Binding CopyStatus}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("copiedCodeRow?.MarkCopied()", code, StringComparison.Ordinal);
        Assert.Contains("CopyStatus = \"COPIED\"", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Ordinary_window_focus_never_refreshes_remote_content()
    {
        var app = ReadAppFile("App.xaml.cs");
        var handler = Slice(app, "private async Task RefreshAfterActivationAsync", "private static async Task DisposeRefreshAsync");

        Assert.Contains("SessionRefresh.RefreshNowAsync", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("RefreshOnReactivationAsync", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("RefreshAsync", handler, StringComparison.Ordinal);
    }

    [Fact]
    public void Page_subscribes_for_banner_updates_and_unsubscribes_when_unloaded()
    {
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains("launcherBanners.Updated += LauncherBanners_Updated", code, StringComparison.Ordinal);
        Assert.Contains("launcherBanners.Updated -= LauncherBanners_Updated", code, StringComparison.Ordinal);
        Assert.Contains("launcherBanners = app.LauncherBanners", code, StringComparison.Ordinal);
        Assert.Contains("RenderBannerCycle();", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Network_reactivation_retries_remote_launcher_content_without_duplicate_handlers()
    {
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains("NetworkInformation.NetworkStatusChanged += NetworkInformation_NetworkStatusChanged", code, StringComparison.Ordinal);
        Assert.Contains("NetworkInformation.NetworkStatusChanged -= NetworkInformation_NetworkStatusChanged", code, StringComparison.Ordinal);
        Assert.Contains("Interlocked.CompareExchange(ref networkContentRefreshInFlight, 1, 0)", code, StringComparison.Ordinal);
        Assert.Contains("networkRefreshGeneration", code, StringComparison.Ordinal);
        Assert.Contains("launcherBanners.RefreshOnReactivationAsync(lease.CancellationToken)", code, StringComparison.Ordinal);
        Assert.Contains(
            "System.Net.NetworkInformation.NetworkInterface.GetIsNetworkAvailable()",
            code,
            StringComparison.Ordinal);
        Assert.DoesNotContain("GetInternetConnectionProfile()", code, StringComparison.Ordinal);
        Assert.Contains("Refreshing banners, codes, and artwork...", code, StringComparison.Ordinal);
        Assert.DoesNotContain("Refreshing official news and banner art...", code, StringComparison.Ordinal);
    }

    [Fact]
    public void App_uses_only_the_banner_manifest_content_service()
    {
        var app = ReadAppFile("App.xaml.cs");
        var project = ReadAppFile("Nyx.Desktop.App.csproj");

        Assert.DoesNotContain("new LatestContentService", app, StringComparison.Ordinal);
        Assert.DoesNotContain("_latestContent", app, StringComparison.Ordinal);
        Assert.Contains("_launcherBanners = new LauncherBannersContentService", app, StringComparison.Ordinal);
        Assert.Contains("Assets\\Content\\**\\*", project, StringComparison.Ordinal);
        Assert.Contains("CopyToOutputDirectory=\"PreserveNewest\"", project, StringComparison.Ordinal);
    }

    [Fact]
    public void Publisher_browser_blocks_downloads_and_site_permissions()
    {
        var code = ReadAppFile("PublisherSessionWindow.xaml.cs");

        Assert.Contains("core.DownloadStarting += Core_DownloadStarting", code, StringComparison.Ordinal);
        Assert.Contains("args.Cancel = true;", Slice(code, "private static void Core_DownloadStarting", "private static void Core_PermissionRequested"), StringComparison.Ordinal);
        Assert.Contains("args.State = CoreWebView2PermissionState.Deny", code, StringComparison.Ordinal);
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
