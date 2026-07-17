using System.Globalization;
using System.Text.RegularExpressions;
using Nyx_Desktop_App.ViewModels;

namespace Nyx.Desktop.Tests.UI;

public sealed class IrisLauncherShellTests
{
    private static readonly string WorkspaceRoot = FindWorkspaceRoot();

    public static TheoryData<double, double, string> LayoutCases => new()
    {
        { 390, 844, "Compact" },
        { 759.99, 900, "Compact" },
        { 760, 540, "Horizontal" },
        { 901, 713, "Horizontal" },
        { 1039.99, 900, "Horizontal" },
        { 1040, 680, "Wide" },
        { 1280, 720, "Wide" },
        { 1599.99, 900, "Wide" },
        { 1600, 759.99, "Wide" },
        { 1600, 760, "Expanded" },
        { 2560, 1080, "Expanded" },
        { 3440, 1440, "Expanded" },
    };

    [Theory]
    [MemberData(nameof(LayoutCases))]
    public void Pure_layout_contract_selects_exact_breakpoint_state(
        double width,
        double height,
        string expected)
    {
        var source = ReadAppFile("ViewModels", "LauncherLayoutState.cs");
        var constants = ReadConstants(source);

        var actual = SelectLayout(width, height, constants);

        Assert.Equal(expected, actual);
        Assert.Contains("if (width < CompactWidth)", source, StringComparison.Ordinal);
        Assert.Contains("if (width < WideWidth || height < ShortHeight)", source, StringComparison.Ordinal);
        Assert.Contains(
            "if (width >= ExpandedWidth && height >= ExpandedHeight)",
            source,
            StringComparison.Ordinal);
    }

    [Fact]
    public void Layout_contract_declares_exact_product_thresholds_and_safe_profiles()
    {
        var source = ReadAppFile("ViewModels", "LauncherLayoutState.cs");
        var constants = ReadConstants(source);

        Assert.Equal(760, constants["CompactWidth"]);
        Assert.Equal(1040, constants["WideWidth"]);
        Assert.Equal(1600, constants["ExpandedWidth"]);
        Assert.Equal(680, constants["ShortHeight"]);
        Assert.Equal(760, constants["ExpandedHeight"]);
        Assert.Contains("IconSize: 92", source, StringComparison.Ordinal);
        Assert.Contains("IconSize: 100", source, StringComparison.Ordinal);
        Assert.Contains("IconSize: 108", source, StringComparison.Ordinal);
        Assert.Contains("IconSize: 116", source, StringComparison.Ordinal);
        Assert.Contains("Math.Clamp", source, StringComparison.Ordinal);
    }

    public static TheoryData<string, double, double> RailGeometryCases => new()
    {
        { "Compact", 112, 92 },
        { "Horizontal", 120, 100 },
        { "Wide", 132, 108 },
        { "Expanded", 144, 116 },
    };

    [Theory]
    [MemberData(nameof(RailGeometryCases))]
    public void Every_profile_item_cross_extent_fits_its_rail(
        string state,
        double railExtent,
        double iconSize)
    {
        var source = ReadAppFile("ViewModels", "LauncherLayoutState.cs");
        var constants = ReadConstants(source);
        var profileSelector = state == "Expanded"
            ? "_"
            : $@"LauncherLayoutState\.{Regex.Escape(state)}";
        var profile = Regex.Match(
            source,
            $@"{profileSelector}\s*=>\s*new\([\s\S]*?RailExtent:\s*(?<rail>[0-9]+),\s*IconSize:\s*(?<icon>[0-9]+)");
        Assert.True(profile.Success, $"Could not read the {state} profile.");
        Assert.Equal(railExtent, double.Parse(profile.Groups["rail"].Value, CultureInfo.InvariantCulture));
        Assert.Equal(iconSize, double.Parse(profile.Groups["icon"].Value, CultureInfo.InvariantCulture));

        var itemChrome = constants["ItemChrome"];
        var itemMargin = constants["ItemMargin"];
        var itemExtent = iconSize + itemChrome;
        var itemCrossExtent = itemExtent + (itemMargin * 2);

        Assert.True(itemCrossExtent <= railExtent, $"{state} item exceeds its rail.");
    }

    [Fact]
    public void Profile_icon_size_drives_item_image_and_focus_geometry()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");
        var layout = ReadAppFile("ViewModels", "LauncherLayoutState.cs");
        var controls = ReadAppFile("Themes", "NyxControls.xaml");

        Assert.Contains("game.ApplyLayout(profile)", code, StringComparison.Ordinal);
        Assert.Contains("iconSize = profile.IconSize", code, StringComparison.Ordinal);
        Assert.Contains("itemExtent = profile.ItemExtent", code, StringComparison.Ordinal);
        Assert.Contains("Width=\"{Binding IconSize}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Width=\"{Binding ItemExtent}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("ItemCrossExtent => ItemExtent + (ItemMargin * 2)", layout, StringComparison.Ordinal);
        Assert.DoesNotContain("Property=\"Width\" Value=\"112\"", controls, StringComparison.Ordinal);
        Assert.Contains("HorizontalContentAlignment\" Value=\"Stretch", controls, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"SelectionMarker\"", controls, StringComparison.Ordinal);
        Assert.DoesNotContain("SelectionAura", controls, StringComparison.Ordinal);
    }

    [Fact]
    public void Five_item_rail_has_bounded_cross_axis_and_scrollable_main_axis()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Equal(5, Regex.Matches(code, "HeroArtPaths\\s*=|\\[\"(?:gi|hsr|zzz|wuwa|ae)\"\\] = \"ms-appx:///Assets/Iris/")
            .Cast<Match>()
            .Count(match => match.Value.StartsWith("[", StringComparison.Ordinal)));
        Assert.Contains("itemsPanel.Orientation = horizontal", code, StringComparison.Ordinal);
        Assert.Contains("ScrollViewer.SetHorizontalScrollMode(GameSelector, ScrollMode.Enabled)", code, StringComparison.Ordinal);
        Assert.Contains("ScrollViewer.SetVerticalScrollMode(GameSelector, ScrollMode.Enabled)", code, StringComparison.Ordinal);
        Assert.Contains("ScrollViewer.HorizontalScrollBarVisibility=\"Hidden\"", xaml, StringComparison.Ordinal);
    }

    [Fact]
    public void Shell_has_one_launch_action_and_one_anchored_command_deck()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");
        var combined = xaml + code;

        Assert.Single(Regex.Matches(xaml, "Click=\"LaunchButton_Click\"").Cast<Match>());
        Assert.Single(Regex.Matches(xaml, "x:Name=\"LaunchButton\"").Cast<Match>());
        Assert.DoesNotContain("CompactLaunch", combined, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("WideLaunch", combined, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Coming later", combined, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Genshin first", combined, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("GAME 01 / 05", combined, StringComparison.Ordinal);
        Assert.Contains("$\"GAME {gameIndex:00} / {Games.Count:00}\"", combined, StringComparison.Ordinal);
        Assert.DoesNotContain("LOCAL LIBRARY", combined, StringComparison.Ordinal);
        Assert.Single(Regex.Matches(xaml, "x:Name=\"CommandDeck\"").Cast<Match>());
        Assert.Contains("ApplyCommandDeckLayout(profile, width)", code, StringComparison.Ordinal);
        Assert.Contains("PlaceDeckItem(LaunchButton", code, StringComparison.Ordinal);
        Assert.Contains("profile.DeckHeight + 22", code, StringComparison.Ordinal);
        Assert.Contains("profile.DeckHeight + 42", code, StringComparison.Ordinal);
        Assert.Contains("VerticalAlignment=\"Bottom\"", xaml, StringComparison.Ordinal);
    }

    [Fact]
    public void Every_viewport_reserves_content_clearance_above_the_command_deck()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains("x:Name=\"CommandDeck\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"DeckRow0\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"DeckColumn3\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"LatestContentStack\"", xaml, StringComparison.Ordinal);
        Assert.Contains(
            "var dense = height < LauncherLayoutStateSelector.ExpandedHeight",
            code,
            StringComparison.Ordinal);
        Assert.Contains("LatestStrip.Margin = new Thickness(0, dense ? 22 : 30, 0, 0)", code, StringComparison.Ordinal);
        Assert.Contains("LatestContentStack.Spacing = dense ? 6 : 9", code, StringComparison.Ordinal);
        Assert.Contains("profile.DeckHeight + 22", code, StringComparison.Ordinal);
        Assert.Contains("profile.DeckHeight + 42", code, StringComparison.Ordinal);
        Assert.Contains("DeckHeight: 286", ReadAppFile("ViewModels", "LauncherLayoutState.cs"), StringComparison.Ordinal);
        Assert.Contains("DeckHeight: 152", ReadAppFile("ViewModels", "LauncherLayoutState.cs"), StringComparison.Ordinal);
        Assert.Contains("DeckHeight: 166", ReadAppFile("ViewModels", "LauncherLayoutState.cs"), StringComparison.Ordinal);
        Assert.Contains("DeckHeight: 180", ReadAppFile("ViewModels", "LauncherLayoutState.cs"), StringComparison.Ordinal);
    }

    [Fact]
    public void Compact_maintenance_reflows_actions_below_wrapped_status()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains("x:Name=\"UpdaterSignalLayout\"", xaml, StringComparison.Ordinal);
        Assert.Contains("TextWrapping=\"Wrap\"", xaml, StringComparison.Ordinal);
        Assert.Contains("MaxLines=\"2\"", xaml, StringComparison.Ordinal);
        Assert.Contains("ApplyMaintenanceLayout(profile.State)", code, StringComparison.Ordinal);
        Assert.Contains("var compact = state is LauncherLayoutState.Compact", code, StringComparison.Ordinal);
        Assert.Contains("var stackedActions = state is not LauncherLayoutState.Horizontal", code, StringComparison.Ordinal);
        Assert.Contains("Grid.SetRow(ChooseGameFolderButton, stackedActions ? 1 : 0)", code, StringComparison.Ordinal);
        Assert.Contains("Grid.SetRow(OpenUpdaterButton, stackedActions ? 1 : 0)", code, StringComparison.Ordinal);
        Assert.Contains("UpdaterSignalLayout.RowSpacing = compact ? 2 : stackedActions ? 6 : 0", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Every_game_has_reachable_art_and_status_accessibility_copy()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");

        foreach (var gameId in new[] { "gi", "hsr", "zzz", "wuwa", "ae" })
        {
            Assert.Contains($"[\"{gameId}\"]", code, StringComparison.Ordinal);
            Assert.True(File.Exists(Path.Combine(
                WorkspaceRoot,
                "Desktop",
                "src",
                "Nyx.Desktop.App",
                "Assets",
                "Iris",
                $"{gameId}-hero.png")));
        }

        Assert.Contains("StatusDescription", code, StringComparison.Ordinal);
        Assert.Contains("AccessibleName", code, StringComparison.Ordinal);
        Assert.Contains(
            "AutomationProperties.Name=\"{Binding AccessibilityName}\"",
            xaml,
            StringComparison.Ordinal);
        Assert.Contains(
            "ContainerContentChanging=\"GameSelector_ContainerContentChanging\"",
            xaml,
            StringComparison.Ordinal);
        Assert.Contains(
            "AutomationProperties.SetName(item, game.AccessibleName)",
            code,
            StringComparison.Ordinal);
        Assert.Contains(
            "$\"{DisplayName}. {StatusDescription}. Select game.\"",
            code,
            StringComparison.Ordinal);
        Assert.Contains(
            "GameSelector.SelectionChanged += GameSelector_SelectionChanged",
            code,
            StringComparison.Ordinal);
        Assert.Contains("HorizontalScrollMode", code, StringComparison.Ordinal);
        Assert.Contains("VerticalScrollMode", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Rail_marks_refresh_for_every_game_and_keep_accessibility_names_current()
    {
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains("RefreshGameRailSignals();", code, StringComparison.Ordinal);
        Assert.Contains("foreach (var game in Games)", code, StringComparison.Ordinal);
        Assert.Contains("sessions.GetSnapshot(game.Id)", code, StringComparison.Ordinal);
        Assert.Contains("publisherStatus.Current", code, StringComparison.Ordinal);
        Assert.Contains("GameRailSignalProjector.Project", code, StringComparison.Ordinal);
        Assert.Contains("game.UpdateStatus(RailSignalGlyphs[signal.Kind]", code, StringComparison.Ordinal);
        Assert.Contains("ContainerFromItem(game)", code, StringComparison.Ordinal);
        Assert.Contains("nameof(StatusGlyph)", code, StringComparison.Ordinal);
        Assert.Contains("nameof(StatusDescription)", code, StringComparison.Ordinal);
        Assert.Contains("nameof(AccessibleName)", code, StringComparison.Ordinal);
        Assert.Contains("SessionRefresh_Refreshed", code, StringComparison.Ordinal);
        Assert.Contains("PublisherStatus_Updated", code, StringComparison.Ordinal);
        Assert.Contains("GameRailSignalKind.Running] = \"▶\"", code, StringComparison.Ordinal);
        Assert.Contains("GameRailSignalKind.UpdateAvailable] = \"↑\"", code, StringComparison.Ordinal);
        Assert.Contains("GameRailSignalKind.PreDownloadAvailable] = \"↓\"", code, StringComparison.Ordinal);
        Assert.Contains("GameRailSignalKind.Unsupported] = \"○\"", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Runtime_palette_lookup_uses_application_resources()
    {
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains(
            "Application.Current.Resources[brushKey]",
            code,
            StringComparison.Ordinal);
        Assert.DoesNotContain(
            "(Brush)Resources[brushKey]",
            code,
            StringComparison.Ordinal);
    }

    [Fact]
    public void Responsibility_disclaimer_focus_and_high_contrast_are_persistent()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var controls = ReadAppFile("Themes", "NyxControls.xaml");
        var palette = ReadAppFile("Themes", "NyxPalette.xaml");

        Assert.Contains(
            "Nyx starts games. Official launchers handle downloads, updates, pre-downloads, verification, and repairs.",
            xaml,
            StringComparison.Ordinal);
        Assert.Contains("Fan-made launcher", xaml, StringComparison.Ordinal);
        Assert.Contains("Not affiliated with HoYoverse, Kuro Games, or GRYPHLINK", xaml, StringComparison.Ordinal);
        Assert.Contains("UseSystemFocusVisuals\" Value=\"True", controls, StringComparison.Ordinal);
        Assert.Contains("FocusVisualPrimaryThickness\" Value=\"2", controls, StringComparison.Ordinal);
        Assert.Contains("x:Key=\"HighContrast\"", palette, StringComparison.Ordinal);
        Assert.DoesNotContain("Storyboard", xaml, StringComparison.Ordinal);
        Assert.DoesNotContain("DoubleAnimation", xaml, StringComparison.Ordinal);
    }

    [Fact]
    public void High_contrast_tokens_pair_highlight_with_highlight_text()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var controls = ReadAppFile("Themes", "NyxControls.xaml");
        var palette = ReadAppFile("Themes", "NyxPalette.xaml");

        Assert.Contains(
            "x:Key=\"PrimaryActionBackgroundBrush\" Color=\"{ThemeResource SystemColorHighlightColor}\"",
            palette,
            StringComparison.Ordinal);
        Assert.Contains(
            "x:Key=\"PrimaryActionForegroundBrush\" Color=\"{ThemeResource SystemColorHighlightTextColor}\"",
            palette,
            StringComparison.Ordinal);
        Assert.Contains(
            "x:Key=\"FocusSecondaryBrush\" Color=\"{ThemeResource SystemColorHighlightTextColor}\"",
            palette,
            StringComparison.Ordinal);
        Assert.Contains("Background\" Value=\"{ThemeResource PrimaryActionBackgroundBrush}", controls, StringComparison.Ordinal);
        Assert.Contains("FocusVisualPrimaryBrush\" Value=\"{ThemeResource PrimaryActionForegroundBrush}", controls, StringComparison.Ordinal);
        Assert.Equal(
            3,
            Regex.Matches(xaml, "Foreground=\"{ThemeResource PrimaryActionForegroundBrush}\"").Count);
        Assert.DoesNotContain("Foreground=\"#", xaml, StringComparison.Ordinal);
    }

    [Fact]
    public void High_contrast_backdrop_is_between_root_art_and_semantic_content()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var artwork = xaml.IndexOf("x:Name=\"BackgroundArtwork\"", StringComparison.Ordinal);
        var scrim = xaml.IndexOf("x:Name=\"BackgroundScrim\"", StringComparison.Ordinal);
        var cover = xaml.IndexOf("x:Name=\"HighContrastBackdrop\"", StringComparison.Ordinal);
        var brand = xaml.IndexOf("x:Name=\"BrandLockup\"", StringComparison.Ordinal);
        var games = xaml.IndexOf("x:Name=\"GameSelector\"", StringComparison.Ordinal);
        var content = xaml.IndexOf("x:Name=\"ContentScroll\"", StringComparison.Ordinal);
        var disclaimer = xaml.IndexOf("Fan-made launcher", StringComparison.Ordinal);

        Assert.True(artwork >= 0 && artwork < scrim);
        Assert.True(scrim < cover);
        Assert.True(cover < brand);
        Assert.True(cover < games);
        Assert.True(cover < content);
        Assert.True(cover < disclaimer);
        var hero = xaml.IndexOf("x:Name=\"HeroStage\"", StringComparison.Ordinal);
        var heroTagEnd = xaml.IndexOf('>', hero);
        Assert.Contains(
            "Opacity=\"{ThemeResource DecorativeArtOpacity}\"",
            xaml[hero..heroTagEnd],
            StringComparison.Ordinal);
    }

    [Fact]
    public void High_contrast_hides_all_decorative_art_while_dark_theme_keeps_it()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var palette = ReadAppFile("Themes", "NyxPalette.xaml");

        Assert.Contains(
            "x:Key=\"HighContrastBackdropBrush\" Color=\"{ThemeResource SystemColorWindowColor}\"",
            palette,
            StringComparison.Ordinal);
        Assert.Contains("x:Key=\"DecorativeArtOpacity\">1</x:Double>", palette, StringComparison.Ordinal);
        Assert.Contains("x:Key=\"HighContrastBackdropOpacity\">0</x:Double>", palette, StringComparison.Ordinal);
        Assert.Contains("x:Key=\"DecorativeArtOpacity\">0</x:Double>", palette, StringComparison.Ordinal);
        Assert.Contains("x:Key=\"HighContrastBackdropOpacity\">1</x:Double>", palette, StringComparison.Ordinal);
        Assert.Contains("Source=\"ms-appx:///Assets/backgroundnyx.png\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Source=\"{Binding SelectedItem.HeroArtPath, ElementName=GameSelector}\"", xaml, StringComparison.Ordinal);
        foreach (var decorativeName in new[]
                 {
                     "BackgroundArtwork",
                     "HeroStage",
                     "HeroArtwork",
                     "BackgroundScrim",
                     "HighContrastBackdrop",
                 })
        {
            AssertRawElement(xaml, decorativeName);
        }
        Assert.Contains("Opacity=\"{ThemeResource DecorativeArtOpacity}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Opacity=\"{ThemeResource HighContrastBackdropOpacity}\"", xaml, StringComparison.Ordinal);
    }

    [Fact]
    public void Windows_owns_caption_colors_for_high_contrast_safety()
    {
        var code = ReadAppFile("MainWindow.xaml.cs");

        Assert.Contains("_nativeTitleBar.ExtendsContentIntoTitleBar = true", code, StringComparison.Ordinal);
        Assert.DoesNotContain("Color.FromArgb", code, StringComparison.Ordinal);
        Assert.DoesNotContain("ButtonForegroundColor", code, StringComparison.Ordinal);
        Assert.DoesNotContain("ButtonHoverBackgroundColor", code, StringComparison.Ordinal);
        Assert.DoesNotContain("ButtonPressedBackgroundColor", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Palette_contains_no_cyan_or_signal_teal_accent()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");
        var controls = ReadAppFile("Themes", "NyxControls.xaml");
        var palette = ReadAppFile("Themes", "NyxPalette.xaml");
        var combined = xaml + code + controls + palette;

        Assert.DoesNotContain("#70D7D1", combined, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SignalBrush", combined, StringComparison.Ordinal);
        Assert.DoesNotContain("TealBrush", combined, StringComparison.Ordinal);
        Assert.DoesNotContain("NyxSignalColor", combined, StringComparison.Ordinal);
    }

    [Fact]
    public void Nebula_stage_uses_full_bleed_game_art_open_content_and_one_glass_deck()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");
        var palette = ReadAppFile("Themes", "NyxPalette.xaml");
        var controls = ReadAppFile("Themes", "NyxControls.xaml");
        var combined = xaml + code;

        Assert.Contains("x:Name=\"RailSurface\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Background=\"{ThemeResource RailSurfaceBrush}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"HeroStage\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"HeroArtwork\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Source=\"{Binding SelectedItem.HeroArtPath, ElementName=GameSelector}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Stretch=\"UniformToFill\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"ContentScroll\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"CommandDeck\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Background=\"{ThemeResource GlassDeckBrush}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Key=\"GlassDeckBrush\"", palette, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"LaunchButton\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Height\" Value=\"96", controls, StringComparison.Ordinal);
        Assert.Contains("HeroArtwork.Opacity = profile.State switch", code, StringComparison.Ordinal);
        Assert.DoesNotContain("IrisStage", combined, StringComparison.Ordinal);
        Assert.DoesNotContain("IrisDecorativeContent", combined, StringComparison.Ordinal);
        Assert.DoesNotContain("SelectionAura", combined, StringComparison.Ordinal);
    }

    [Fact]
    public void Every_game_has_an_asset_specific_focal_transform_and_fade()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");

        foreach (var property in new[]
                 {
                     "HeroScale",
                     "HeroOffsetX",
                     "HeroOffsetY",
                     "HeroFadeStart",
                     "HeroFadeMid",
                 })
        {
            Assert.Contains($"SelectedItem.{property}", xaml, StringComparison.Ordinal);
            Assert.Contains($"public double {property}", code, StringComparison.Ordinal);
        }

        var presentations = Regex.Matches(
                code,
                @"\[""(?<id>gi|hsr|zzz|wuwa|ae)""\]\s*=\s*new\((?<scale>[0-9.]+),\s*(?<x>-?[0-9.]+),\s*(?<y>-?[0-9.]+),\s*(?<start>[0-9.]+),\s*(?<mid>[0-9.]+)\)")
            .Cast<Match>()
            .ToArray();

        Assert.Equal(5, presentations.Length);
        Assert.Equal(5, presentations.Select(match => match.Groups["id"].Value).Distinct().Count());
        Assert.Equal(
            5,
            presentations
                .Select(match => string.Join(
                    "/",
                    match.Groups["scale"].Value,
                    match.Groups["x"].Value,
                    match.Groups["y"].Value,
                    match.Groups["start"].Value,
                    match.Groups["mid"].Value))
                .Distinct()
                .Count());
        Assert.All(presentations, presentation =>
        {
            var scale = double.Parse(presentation.Groups["scale"].Value, CultureInfo.InvariantCulture);
            var fadeStart = double.Parse(presentation.Groups["start"].Value, CultureInfo.InvariantCulture);
            var fadeMid = double.Parse(presentation.Groups["mid"].Value, CultureInfo.InvariantCulture);
            Assert.InRange(scale, 1, 1.5);
            Assert.InRange(fadeStart, 0.15, 0.4);
            Assert.InRange(fadeMid, 0.45, 0.7);
            Assert.True(fadeStart < fadeMid);
        });
    }

    [Fact]
    public void Mockup_does_not_create_dead_or_unavailable_controls()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");
        var combined = xaml + code;

        Assert.DoesNotContain("Settings", combined, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Add Game", combined, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Ko-fi", combined, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("CURRENT BANNERS", combined, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("View all news", combined, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("CornerRadius=\"", SliceElement(xaml, "x:Name=\"GameSelector\""), StringComparison.Ordinal);
    }

    public static TheoryData<double, double, LauncherLayoutState, LauncherDeckLayoutMode>
        TargetViewportGeometryCases => new()
        {
            { 390, 844, LauncherLayoutState.Compact, LauncherDeckLayoutMode.CompactStack },
            { 760, 540, LauncherLayoutState.Horizontal, LauncherDeckLayoutMode.TwoRow },
            { 1280, 720, LauncherLayoutState.Wide, LauncherDeckLayoutMode.SingleRow },
            { 1600, 900, LauncherLayoutState.Expanded, LauncherDeckLayoutMode.SingleRow },
            { 2560, 1080, LauncherLayoutState.Expanded, LauncherDeckLayoutMode.SingleRow },
        };

    [Theory]
    [MemberData(nameof(TargetViewportGeometryCases))]
    public void Target_viewport_geometry_keeps_every_command_cell_inside_the_deck(
        double width,
        double height,
        LauncherLayoutState expectedState,
        LauncherDeckLayoutMode expectedDeckMode)
    {
        var geometry = LauncherViewportGeometry.Calculate(width, height);
        var viewport = new LauncherRect(0, 0, width, height);

        Assert.Equal(expectedState, geometry.Profile.State);
        Assert.Equal(expectedDeckMode, geometry.DeckMode);
        Assert.True(viewport.Contains(geometry.Rail));
        Assert.True(viewport.Contains(geometry.CommandDeck));
        Assert.True(geometry.CommandDeck.Contains(geometry.CommandDeckInner));
        Assert.True(geometry.CommandDeckInner.Contains(geometry.LocalCell));
        Assert.True(geometry.CommandDeckInner.Contains(geometry.OfficialCell));
        Assert.True(geometry.CommandDeckInner.Contains(geometry.ToolsCell));
        Assert.True(geometry.CommandDeckInner.Contains(geometry.LaunchCell));
        Assert.True(geometry.Content.Height >= 160);
        Assert.True(geometry.Content.Bottom <= geometry.CommandDeck.Y);
        Assert.True(geometry.LocalCell.Width >= 90);
        Assert.True(geometry.OfficialCell.Width >= 210);
        Assert.True(geometry.ToolsCell.Width >= 200);
        Assert.True(geometry.LaunchCell.Width >= 270);
        Assert.True(geometry.LocalCell.Height >= 44);
        Assert.True(geometry.OfficialCell.Height >= 44);
        Assert.True(geometry.ToolsCell.Height >= 44);
        Assert.True(geometry.LaunchCell.Height >= 44);
    }

    [Fact]
    public void Compact_geometry_reserves_measured_status_tools_and_launch_heights()
    {
        var geometry = LauncherViewportGeometry.Calculate(390, 844);

        Assert.Equal(286, geometry.CommandDeck.Height);
        Assert.Equal(27, geometry.CommandDeckInner.X);
        Assert.Equal(553, geometry.CommandDeckInner.Y);
        Assert.Equal(336, geometry.CommandDeckInner.Width);
        Assert.Equal(260, geometry.CommandDeckInner.Height);
        Assert.Equal(226, geometry.OfficialCell.Width);
        Assert.Equal(336, geometry.ToolsCell.Width);
        Assert.Equal(336, geometry.LaunchCell.Width);
        Assert.Equal(104, geometry.OfficialCell.Height);
        Assert.Equal(68, geometry.ToolsCell.Height);
        Assert.Equal(72, geometry.LaunchCell.Height);
        Assert.True(geometry.LocalCell.Right <= geometry.OfficialCell.X);
        Assert.True(geometry.OfficialCell.Bottom <= geometry.ToolsCell.Y);
        Assert.True(geometry.ToolsCell.Bottom <= geometry.LaunchCell.Y);
        Assert.True(geometry.LaunchCell.Bottom <= geometry.CommandDeckInner.Bottom);
    }

    [Fact]
    public void Compact_and_two_row_launch_controls_stretch_to_their_calculated_cells()
    {
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Equal(2, Regex.Matches(code, "LaunchButton.Width = double.NaN").Count);
        Assert.Contains("LaunchButton.Width = profile.LaunchWidth", code, StringComparison.Ordinal);
        Assert.Contains("LauncherViewportGeometry.NarrowWideDeckWidth", code, StringComparison.Ordinal);
        Assert.Contains("LauncherViewportGeometry.CompactStatusHeight", code, StringComparison.Ordinal);
        Assert.Contains("LauncherViewportGeometry.CompactToolsHeight", code, StringComparison.Ordinal);
        Assert.Contains("LauncherViewportGeometry.CompactCtaHeight", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Compact_production_columns_charge_the_official_inset_once()
    {
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains(
            "CommandDeckGrid.ColumnSpacing = compact ? 0",
            code,
            StringComparison.Ordinal);
        Assert.Contains(
            "UpdaterSignalRow.Margin = compact",
            code,
            StringComparison.Ordinal);
        Assert.Contains(
            "LauncherViewportGeometry.CompactOfficialInset",
            code,
            StringComparison.Ordinal);
        Assert.Contains(
            ": new Thickness(0, 0, 0, 0);",
            code,
            StringComparison.Ordinal);
    }

    [Fact]
    public void Horizontal_760_geometry_matches_the_border_padding_rows_and_explicit_gap()
    {
        var geometry = LauncherViewportGeometry.Calculate(760, 540);
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Equal(35, geometry.CommandDeckInner.X);
        Assert.Equal(380, geometry.CommandDeckInner.Y);
        Assert.Equal(690, geometry.CommandDeckInner.Width);
        Assert.Equal(132, geometry.CommandDeckInner.Height);
        Assert.Equal(159.8, geometry.LocalCell.Width, precision: 6);
        Assert.Equal(518.2, geometry.OfficialCell.Width, precision: 6);
        Assert.Equal(331.6, geometry.ToolsCell.Width, precision: 6);
        Assert.Equal(346.4, geometry.LaunchCell.Width, precision: 6);
        Assert.Equal(450, geometry.ToolsCell.Y);
        Assert.Equal(450, geometry.LaunchCell.Y);
        Assert.Equal(62, geometry.ToolsCell.Height);
        Assert.Equal(62, geometry.LaunchCell.Height);
        Assert.Equal(geometry.CommandDeckInner.Bottom, geometry.ToolsCell.Bottom);
        Assert.Equal(geometry.CommandDeckInner.Bottom, geometry.LaunchCell.Bottom);
        Assert.True(geometry.CommandDeckInner.Contains(geometry.ToolsCell));
        Assert.True(geometry.CommandDeckInner.Contains(geometry.LaunchCell));

        Assert.Contains(
            "CommandDeckGrid.RowSpacing = compact ? 8 : 0",
            code,
            StringComparison.Ordinal);
        Assert.Contains(
            "new Thickness(0, LauncherViewportGeometry.TwoRowGap, 0, 0)",
            code,
            StringComparison.Ordinal);
        Assert.Contains(
            "LauncherViewportGeometry.TwoRowHeight\n                + LauncherViewportGeometry.TwoRowGap",
            code,
            StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(390, 844)]
    [InlineData(760, 540)]
    [InlineData(1280, 720)]
    [InlineData(1600, 900)]
    [InlineData(2560, 1080)]
    public void Genshin_focal_transform_covers_the_entire_hero_stage(
        double width,
        double height)
    {
        var profile = LauncherLayoutStateSelector.CreateProfile(width, height);
        var stage = new LauncherRect(0, 0, profile.HeroWidth, height);
        var transformed = HeroStageGeometry.CalculateTransformedBounds(
            stage.Width,
            stage.Height,
            focalScale: 1.45,
            offsetX: 80,
            offsetY: 100);

        Assert.True(
            HeroStageGeometry.Covers(transformed, stage),
            $"GI art {transformed} does not cover stage {stage} at {width}x{height}.");
    }

    [Fact]
    public void Genshin_production_metadata_matches_the_coverage_contract()
    {
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains(
            "[\"gi\"] = new(1.45, 80, 100, 0.30, 0.62)",
            code,
            StringComparison.Ordinal);
    }

    [Fact]
    public void Latest_strip_is_text_only_and_uses_a_three_row_editorial_ledger()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var start = xaml.IndexOf("x:Name=\"LatestStrip\"", StringComparison.Ordinal);
        var end = xaml.IndexOf("x:Name=\"CommandDeck\"", start, StringComparison.Ordinal);
        var strip = xaml[start..end];

        Assert.Contains("x:Name=\"LatestStrip\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"LatestSourceText\"", strip, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"LatestFreshnessText\"", strip, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"LatestHeaderGrid\"", strip, StringComparison.Ordinal);
        Assert.DoesNotContain("MaxWidth=\"150\"", strip, StringComparison.Ordinal);
        Assert.DoesNotContain("x:Name=\"LatestCardsScroll\"", strip, StringComparison.Ordinal);
        Assert.DoesNotContain("HorizontalScrollMode=\"Enabled\"", strip, StringComparison.Ordinal);
        Assert.Contains("AutomationProperties.Name=\"Latest items\"", strip, StringComparison.Ordinal);
        Assert.Contains("ItemsSource=\"{x:Bind LatestCards, Mode=OneWay}\"", strip, StringComparison.Ordinal);
        Assert.Contains("FontSize=\"{Binding TitleSize}\"", strip, StringComparison.Ordinal);
        Assert.Contains("Opacity=\"{Binding ItemOpacity}\"", strip, StringComparison.Ordinal);
        Assert.DoesNotContain("<Image", strip, StringComparison.Ordinal);
        Assert.DoesNotContain("Hyperlink", strip, StringComparison.Ordinal);
        Assert.DoesNotContain("Click=", strip, StringComparison.Ordinal);
        Assert.DoesNotContain("http://", strip, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("https://", strip, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Iris_assets_are_local_nonempty_and_project_packaged()
    {
        var project = ReadAppFile("Nyx.Desktop.App.csproj");
        var irisDirectory = Path.Combine(
            WorkspaceRoot,
            "Desktop",
            "src",
            "Nyx.Desktop.App",
            "Assets",
            "Iris");
        var required = new[]
        {
            "gi-hero.png",
            "hsr-hero.png",
            "zzz-hero.png",
            "wuwa-hero.png",
            "ae-hero.png",
            "nyx-eye-fill.png",
            "nyx-logo.png",
        };

        Assert.Contains("Assets\\Iris\\**\\*", project, StringComparison.Ordinal);
        Assert.All(required, fileName =>
        {
            var file = new FileInfo(Path.Combine(irisDirectory, fileName));
            Assert.True(file.Exists);
            Assert.True(file.Length > 1024);
        });
    }

    private static void AssertRawElement(string xaml, string elementName)
    {
        var start = xaml.IndexOf($"x:Name=\"{elementName}\"", StringComparison.Ordinal);
        Assert.True(start >= 0, $"Could not find {elementName}.");
        var end = xaml.IndexOf('>', start);
        Assert.True(end > start, $"Could not read {elementName}.");
        Assert.Contains(
            "AutomationProperties.AccessibilityView=\"Raw\"",
            xaml[start..end],
            StringComparison.Ordinal);
    }

    private static string SliceElement(string xaml, string marker)
    {
        var start = xaml.IndexOf(marker, StringComparison.Ordinal);
        Assert.True(start >= 0, $"Could not find {marker}.");
        var end = xaml.IndexOf('>', start);
        Assert.True(end > start, $"Could not read {marker}.");
        return xaml[start..end];
    }

    private static IReadOnlyDictionary<string, double> ReadConstants(string source)
    {
        var matches = Regex.Matches(
            source,
            @"public const double (?<name>[A-Za-z]+) = (?<value>[0-9]+(?:\.[0-9]+)?);");
        return matches.ToDictionary(
            match => match.Groups["name"].Value,
            match => double.Parse(match.Groups["value"].Value, CultureInfo.InvariantCulture),
            StringComparer.Ordinal);
    }

    private static string SelectLayout(
        double width,
        double height,
        IReadOnlyDictionary<string, double> constants)
    {
        if (width < constants["CompactWidth"])
        {
            return "Compact";
        }

        if (width < constants["WideWidth"] || height < constants["ShortHeight"])
        {
            return "Horizontal";
        }

        return width >= constants["ExpandedWidth"] && height >= constants["ExpandedHeight"]
            ? "Expanded"
            : "Wide";
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
