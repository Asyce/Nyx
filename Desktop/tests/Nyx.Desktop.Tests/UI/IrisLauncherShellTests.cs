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
        Assert.Contains("IconSize: 82", source, StringComparison.Ordinal);
        Assert.Contains("IconSize: 100", source, StringComparison.Ordinal);
        Assert.Contains("Math.Clamp", source, StringComparison.Ordinal);
    }

    public static TheoryData<string, double, double> RailGeometryCases => new()
    {
        { "Compact", 112, 92 },
        { "Horizontal", 120, 100 },
        { "Wide", 102, 82 },
        { "Expanded", 112, 100 },
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
        Assert.DoesNotContain("SelectionMarker", controls, StringComparison.Ordinal);
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
        Assert.DoesNotContain("Genshin first", combined, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("GAME 01 / 05", combined, StringComparison.Ordinal);
        Assert.DoesNotContain("$\"GAME {gameIndex:00} / {Games.Count:00}\"", combined, StringComparison.Ordinal);
        Assert.Contains("PullExportToggle.IsEnabled = pullsAvailable", code, StringComparison.Ordinal);
        Assert.DoesNotContain("LOCAL LIBRARY", combined, StringComparison.Ordinal);
        Assert.Single(Regex.Matches(xaml, "x:Name=\"CommandDeck\"").Cast<Match>());
        Assert.Contains("ApplyCommandDeckLayout(profile, width)", code, StringComparison.Ordinal);
        Assert.Contains("PlaceDeckItem(LaunchStack", code, StringComparison.Ordinal);
        Assert.Contains("WuWaAccountStatusStrip.Visibility is Visibility.Visible ? PublisherAccountStatusLayoutHeight : 0d", code, StringComparison.Ordinal);
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
        Assert.Contains("x:Name=\"BannerCycleStack\"", xaml, StringComparison.Ordinal);
        Assert.Contains(
            "var dense = height < LauncherLayoutStateSelector.ExpandedHeight",
            code,
            StringComparison.Ordinal);
        Assert.Contains("LatestStrip.Margin = new Thickness(0)", code, StringComparison.Ordinal);
        Assert.Contains("LatestStrip.MinHeight = profile.State switch", code, StringComparison.Ordinal);
        Assert.Contains("+ 11)", code, StringComparison.Ordinal);
        Assert.Contains("+ 42)", code, StringComparison.Ordinal);
        Assert.Contains("DeckHeight: 492", ReadAppFile("ViewModels", "LauncherLayoutState.cs"), StringComparison.Ordinal);
        Assert.Contains("DeckHeight: 198", ReadAppFile("ViewModels", "LauncherLayoutState.cs"), StringComparison.Ordinal);
        Assert.Contains("DeckHeight: width < LauncherViewportGeometry.NarrowWideDeckWidth ? 228 : 172", ReadAppFile("ViewModels", "LauncherLayoutState.cs"), StringComparison.Ordinal);
        Assert.Contains("DeckHeight: 244", ReadAppFile("ViewModels", "LauncherLayoutState.cs"), StringComparison.Ordinal);
    }

    [Fact]
    public void Narrow_wide_viewports_use_the_two_row_command_deck()
    {
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains("var horizontalDeck = horizontal", code, StringComparison.Ordinal);
        Assert.Contains("profile.State is LauncherLayoutState.Wide", code, StringComparison.Ordinal);
        Assert.Contains("width < LauncherViewportGeometry.NarrowWideDeckWidth", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Large_launch_cell_aligns_with_combined_status_and_keeps_tools_below()
    {
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains("CombinedStatusPanel.Height = double.NaN", code, StringComparison.Ordinal);
        Assert.Contains("profile.State is LauncherLayoutState.Wide or LauncherLayoutState.Expanded ? 2 : 1", code, StringComparison.Ordinal);
        Assert.Contains("CombinedStatusPanel.VerticalAlignment = VerticalAlignment.Stretch", code, StringComparison.Ordinal);
        Assert.Contains("new CornerRadius(10, 10, 0, 0)", code, StringComparison.Ordinal);
        Assert.Contains("profile.State is LauncherLayoutState.Wide ? 110 : 166", code, StringComparison.Ordinal);
        Assert.Contains("+ accountStatusExtra", code, StringComparison.Ordinal);
        Assert.True(Regex.Matches(ReadAppFile("MainPage.xaml"), "Height=\"42\"[\\s\\S]{0,80}MinHeight=\"42\"").Count >= 3);
        Assert.Contains("PlaceDeckItem(NyxToolsPanel, 1, 3, 1, 1)", code, StringComparison.Ordinal);
        Assert.Contains("LaunchStack.VerticalAlignment = VerticalAlignment.Top", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Official_status_is_combined_and_the_launcher_action_sits_below_export_tools()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains("x:Name=\"UpdaterSignalLayout\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"UpdaterActionRow\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"CombinedStatusPanel\"", xaml, StringComparison.Ordinal);
        Assert.Contains("TextWrapping=\"Wrap\"", xaml, StringComparison.Ordinal);
        Assert.Contains("MaxLines=\"2\"", xaml, StringComparison.Ordinal);
        Assert.Contains("ApplyMaintenanceLayout(profile.State)", code, StringComparison.Ordinal);
        Assert.Contains("var compact = state is LauncherLayoutState.Compact", code, StringComparison.Ordinal);
        Assert.Contains("var stackedActions = state is not LauncherLayoutState.Horizontal", code, StringComparison.Ordinal);
        Assert.Contains("Grid.SetRow(ChooseGameFolderButton, 0)", code, StringComparison.Ordinal);
        Assert.True(
            xaml.IndexOf("x:Name=\"PengoToolButtons\"", StringComparison.Ordinal)
            < xaml.IndexOf("x:Name=\"OpenUpdaterButton\"", StringComparison.Ordinal));
        Assert.Contains("Content=\"Official Launcher\"", xaml, StringComparison.Ordinal);
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
            "Updates and repairs: official launcher.",
            xaml,
            StringComparison.Ordinal);
        Assert.DoesNotContain("Fan-made launcher", xaml, StringComparison.Ordinal);
        Assert.DoesNotContain("Not affiliated with HoYoverse, Kuro Games, or GRYPHLINK", xaml, StringComparison.Ordinal);
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
        Assert.Contains("FocusVisualPrimaryBrush\" Value=\"{ThemeResource LaunchActionForegroundBrush}", controls, StringComparison.Ordinal);
        Assert.Equal(
            2,
            Regex.Matches(xaml, "Foreground=\"{ThemeResource LaunchActionForegroundBrush}\"").Count);
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
        var deck = xaml.IndexOf("x:Name=\"CommandDeck\"", StringComparison.Ordinal);

        Assert.True(artwork >= 0 && artwork < scrim);
        Assert.True(scrim < cover);
        Assert.True(cover < brand);
        Assert.True(cover < games);
        Assert.True(cover < content);
        Assert.True(cover < deck);
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
        Assert.Contains("ApplyNyxAccentResources(content.Resources)", code, StringComparison.Ordinal);
        Assert.Contains("ApplyNyxAccentResources(dialog.Resources)", code, StringComparison.Ordinal);
        Assert.Contains("\"ToggleSwitchFillOn\"", code, StringComparison.Ordinal);
        Assert.Contains("\"SliderTrackValueFill\"", code, StringComparison.Ordinal);
        Assert.Contains("\"AccentButtonBackground\"", code, StringComparison.Ordinal);
        Assert.Contains("HighContrastBackdropOpacity", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Nebula_stage_uses_full_bleed_game_art_and_an_open_command_area()
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
        Assert.Contains("Stretch=\"UniformToFill\"", SliceElement(xaml, "x:Name=\"HeroArtwork\""), StringComparison.Ordinal);
        Assert.Contains("x:Name=\"ContentScroll\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"CommandDeck\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Background=\"{ThemeResource GlassDeckBrush}\"", SliceElement(xaml, "x:Name=\"CommandDeck\""), StringComparison.Ordinal);
        Assert.Contains("BorderThickness=\"0\"", SliceElement(xaml, "x:Name=\"CommandDeck\""), StringComparison.Ordinal);
        Assert.Contains("x:Key=\"GlassDeckBrush\"", palette, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"LaunchButton\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Height\" Value=\"96", controls, StringComparison.Ordinal);
        Assert.Contains("HeroArtwork.Opacity = 1", code, StringComparison.Ordinal);
        Assert.DoesNotContain("IrisStage", combined, StringComparison.Ordinal);
        Assert.DoesNotContain("IrisDecorativeContent", combined, StringComparison.Ordinal);
        Assert.DoesNotContain("SelectionAura", combined, StringComparison.Ordinal);
    }

    [Fact]
    public void Every_game_has_full_height_art_with_user_positioning_overrides()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");

        foreach (var property in new[]
                 {
                     "HeroScale",
                     "HeroOffsetX",
                     "HeroOffsetY",
                 })
        {
            Assert.Contains($"SelectedItem.{property}", xaml, StringComparison.Ordinal);
            Assert.Contains($"public double {property}", code, StringComparison.Ordinal);
        }

        Assert.DoesNotContain("SelectedItem.HeroFadeStart", xaml, StringComparison.Ordinal);
        Assert.DoesNotContain("SelectedItem.HeroFadeMid", xaml, StringComparison.Ordinal);
        Assert.Contains("SetHeroSource(path, BannerAssetStretch(appearance.ArtFit))", code, StringComparison.Ordinal);
        Assert.Contains("HorizontalAlignment=\"Stretch\"", SliceElement(xaml, "x:Name=\"HeroArtwork\""), StringComparison.Ordinal);
        Assert.Contains("RenderTransformOrigin=\"0.5,0.5\"", SliceElement(xaml, "x:Name=\"HeroArtwork\""), StringComparison.Ordinal);
        Assert.Contains("transform.TranslateX = appearance.ArtX", code, StringComparison.Ordinal);
        Assert.Contains(
            "presentation.UsesCenteredCoverGeometry",
            code,
            StringComparison.Ordinal);
        Assert.DoesNotContain("0.22 * HeroStage.ActualWidth", code, StringComparison.Ordinal);
        Assert.Contains("RenderTransformOrigin=\"0.5,0.5\"", xaml, StringComparison.Ordinal);
        Assert.Contains("HeroArtwork.Opacity = 1", code, StringComparison.Ordinal);

        var presentations = Regex.Matches(
                code,
                @"\[""(?<id>gi|hsr|zzz|wuwa|ae)""\]\s*=\s*new\((?<scale>[0-9.]+),\s*(?<x>-?[0-9.]+),\s*(?<y>-?[0-9.]+),\s*(?<start>[0-9.]+),\s*(?<mid>[0-9.]+)\)")
            .Cast<Match>()
            .ToArray();

        Assert.Equal(5, presentations.Length);
        Assert.Equal(5, presentations.Select(match => match.Groups["id"].Value).Distinct().Count());
        Assert.All(presentations, presentation =>
        {
            var scale = double.Parse(presentation.Groups["scale"].Value, CultureInfo.InvariantCulture);
            var fadeStart = double.Parse(presentation.Groups["start"].Value, CultureInfo.InvariantCulture);
            var fadeMid = double.Parse(presentation.Groups["mid"].Value, CultureInfo.InvariantCulture);
            Assert.Equal(1, scale);
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

        Assert.Contains("Settings", combined, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Add Game", combined, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Ko-fi", combined, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("BANNER CYCLE", combined, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("RedemptionCode_Click", combined, StringComparison.Ordinal);
        Assert.DoesNotContain("CornerRadius=\"", SliceElement(xaml, "x:Name=\"GameSelector\""), StringComparison.Ordinal);
    }

    [Fact]
    public void Launcher_uses_wordmarks_open_status_order_and_matching_dialog_surfaces()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");
        var window = ReadAppFile("MainWindow.xaml");
        var project = ReadAppFile("Nyx.Desktop.App.csproj");
        var palette = ReadAppFile("Themes", "NyxPalette.xaml");

        Assert.DoesNotContain("x:Name=\"GameLogo\"", xaml, StringComparison.Ordinal);
        Assert.DoesNotContain("SelectedItem.GameLogoPath", xaml, StringComparison.Ordinal);
        Assert.DoesNotContain("x:Name=\"HeroTitle\"", xaml, StringComparison.Ordinal);
        Assert.True(
            xaml.IndexOf("Text=\"OFFICIAL\"", StringComparison.Ordinal)
            < xaml.IndexOf("Text=\"LOCAL\"", StringComparison.Ordinal));
        Assert.Contains("x:Name=\"HeroDescription\"", xaml, StringComparison.Ordinal);
        Assert.DoesNotContain("Text=\"↗\"", xaml, StringComparison.Ordinal);
        Assert.DoesNotContain("Text=\"◇\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Text = $\"Settings - {selected.DisplayName}\"", code, StringComparison.Ordinal);
        Assert.Contains("currentApp.BeginWindowDrag()", code, StringComparison.Ordinal);
        Assert.Contains("SettingsSurfaceBrush", code, StringComparison.Ordinal);
        Assert.Contains("SettingsSurfaceBrush", palette, StringComparison.Ordinal);
        Assert.DoesNotContain("Text=\"NYX\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"RailBrandRow\" Height=\"104\"", xaml, StringComparison.Ordinal);
        Assert.Contains("GameSelector.VerticalAlignment = VerticalAlignment.Top", code, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"AppTitleBar\"\n            Height=\"32\"", window, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"SettingsButton\"\n                    Height=\"32\"", window, StringComparison.Ordinal);
        Assert.Contains("new Thickness(\n                30,\n                38,", code, StringComparison.Ordinal);
        Assert.Contains("x:Key=\"ReadingSurfaceBrush\"", palette, StringComparison.Ordinal);
        Assert.Contains("Background=\"{ThemeResource GlassDeckBrush}\"", SliceElement(xaml, "x:Name=\"LatestStrip\""), StringComparison.Ordinal);
        Assert.Contains("Background=\"{ThemeResource GlassDeckBrush}\"", SliceElement(xaml, "x:Name=\"CommandDeck\""), StringComparison.Ordinal);
        Assert.Contains("Color=\"#5808060F\"", palette, StringComparison.Ordinal);
        Assert.Contains("PengoToolButtons.HorizontalAlignment = HorizontalAlignment.Stretch", code, StringComparison.Ordinal);
        Assert.Contains("profile.State is LauncherLayoutState.Wide ? 110 : 166", code, StringComparison.Ordinal);
        Assert.DoesNotContain("Assets\\GameLogos\\**\\*", project, StringComparison.Ordinal);
    }

    public static TheoryData<double, double, LauncherLayoutState, LauncherDeckLayoutMode>
        TargetViewportGeometryCases => new()
        {
            { 390, 844, LauncherLayoutState.Compact, LauncherDeckLayoutMode.CompactStack },
            { 760, 540, LauncherLayoutState.Horizontal, LauncherDeckLayoutMode.TwoRow },
            { 1199, 720, LauncherLayoutState.Wide, LauncherDeckLayoutMode.TwoRow },
            { 1260, 705, LauncherLayoutState.Wide, LauncherDeckLayoutMode.SingleRow },
            { 1600, 900, LauncherLayoutState.Expanded, LauncherDeckLayoutMode.SingleRow },
            { 2560, 1080, LauncherLayoutState.Expanded, LauncherDeckLayoutMode.SingleRow },
        };

    [Fact]
    public void Wide_1260_profile_matches_the_mockup_geometry()
    {
        var profile = LauncherLayoutStateSelector.CreateProfile(1260, 705);

        Assert.Equal(LauncherLayoutState.Wide, profile.State);
        Assert.Equal(102, profile.RailExtent);
        Assert.Equal(405, profile.ContentWidth);
        Assert.Equal(172, profile.DeckHeight);
        Assert.Equal(405, profile.LaunchWidth);
    }

    [Theory]
    [MemberData(nameof(TargetViewportGeometryCases))]
    public void Target_viewport_geometry_keeps_every_command_cell_inside_the_deck(
        double width,
        double height,
        LauncherLayoutState expectedState,
        LauncherDeckLayoutMode expectedDeckMode)
    {
        foreach (var accountVisible in new[] { false, true })
        {
            var geometry = LauncherViewportGeometry.Calculate(width, height, accountVisible);
            var viewport = new LauncherRect(0, 0, width, height);

            Assert.Equal(expectedState, geometry.Profile.State);
            Assert.Equal(expectedDeckMode, geometry.DeckMode);
            Assert.True(viewport.Contains(geometry.Rail));
            Assert.True(viewport.Contains(geometry.CommandDeck));
            Assert.True(geometry.CommandDeck.Contains(geometry.CommandDeckInner));
            foreach (var cell in new[] { geometry.LocalCell, geometry.OfficialCell, geometry.LaunchCell, geometry.ToolsCell })
            {
                Assert.True(geometry.CommandDeckInner.Contains(cell));
                Assert.True(cell.Width > 0);
                Assert.True(cell.Height >= 40);
            }
            Assert.False(Intersects(geometry.LocalCell, geometry.OfficialCell));
            Assert.False(Intersects(geometry.LocalCell, geometry.LaunchCell));
            Assert.False(Intersects(geometry.LocalCell, geometry.ToolsCell));
            Assert.False(Intersects(geometry.OfficialCell, geometry.LaunchCell));
            Assert.False(Intersects(geometry.OfficialCell, geometry.ToolsCell));
            Assert.False(Intersects(geometry.LaunchCell, geometry.ToolsCell));
            Assert.True(geometry.Content.Bottom <= geometry.CommandDeck.Y);
            Assert.True(geometry.LaunchCell.Bottom <= geometry.ToolsCell.Y);
            if (expectedState is LauncherLayoutState.Wide or LauncherLayoutState.Expanded)
            {
                Assert.Equal(geometry.Rail.Right, geometry.CommandDeck.X);
                Assert.Equal(height, geometry.CommandDeck.Bottom);
            }
        }
    }

    [Fact]
    public void Compact_geometry_reserves_measured_status_tools_and_launch_heights()
    {
        var geometry = LauncherViewportGeometry.Calculate(390, 844);

        Assert.Equal(492, geometry.CommandDeck.Height);
        Assert.Equal(12, geometry.CommandDeckInner.X);
        Assert.Equal(364, geometry.CommandDeckInner.Y);
        Assert.Equal(366, geometry.CommandDeckInner.Width);
        Assert.Equal(468, geometry.CommandDeckInner.Height);
        Assert.Equal(256, geometry.OfficialCell.Width);
        Assert.Equal(366, geometry.ToolsCell.Width);
        Assert.Equal(366, geometry.LaunchCell.Width);
        Assert.Equal(196, geometry.OfficialCell.Height);
        Assert.Equal(184, geometry.ToolsCell.Height);
        Assert.Equal(72, geometry.LaunchCell.Height);
        Assert.True(geometry.LocalCell.Right <= geometry.OfficialCell.X);
        Assert.True(geometry.OfficialCell.Bottom <= geometry.LaunchCell.Y);
        Assert.True(geometry.LaunchCell.Bottom <= geometry.ToolsCell.Y);
        Assert.Equal(geometry.CommandDeckInner.Bottom, geometry.ToolsCell.Bottom);
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
            "profile.State is LauncherLayoutState.Wide ? 16 : 20",
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

        Assert.Equal(14, geometry.CommandDeckInner.X);
        Assert.Equal(351, geometry.CommandDeckInner.Y);
        Assert.Equal(732, geometry.CommandDeckInner.Width);
        Assert.Equal(180, geometry.CommandDeckInner.Height);
        Assert.Equal(259.2, geometry.LocalCell.Width, precision: 6);
        Assert.Equal(460.8, geometry.OfficialCell.Width, precision: 6);
        Assert.Equal(732, geometry.ToolsCell.Width);
        Assert.Equal(732, geometry.LaunchCell.Width);
        Assert.Equal(490.2, geometry.ToolsCell.Y, precision: 6);
        Assert.Equal(421, geometry.LaunchCell.Y);
        Assert.InRange(geometry.ToolsCell.Height, 40, 42);
        Assert.InRange(geometry.LaunchCell.Height, 61, 62);
        Assert.Equal(geometry.CommandDeckInner.Bottom, geometry.ToolsCell.Bottom);
        Assert.True(geometry.LaunchCell.Bottom <= geometry.ToolsCell.Y);
        Assert.True(geometry.CommandDeckInner.Contains(geometry.ToolsCell));
        Assert.True(geometry.CommandDeckInner.Contains(geometry.LaunchCell));

        Assert.Contains(
            "CommandDeckGrid.RowSpacing = compact || horizontalDeck ? 8 : 6",
            code,
            StringComparison.Ordinal);
        Assert.Contains(
            "PlaceDeckItem(LaunchStack, 1, 0, 1, 4)",
            code,
            StringComparison.Ordinal);
        Assert.Contains(
            "PlaceDeckItem(NyxToolsPanel, 2, 0, 1, 4)",
            code,
            StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(390, 844)]
    [InlineData(760, 540)]
    [InlineData(1199, 720)]
    [InlineData(1260, 705)]
    [InlineData(1600, 900)]
    public void Cover_contain_and_fill_have_expected_bounds(double width, double height)
    {
        var profile = LauncherLayoutStateSelector.CreateProfile(width, height);
        var stage = new LauncherRect(0, 0, profile.HeroWidth, height);
        var cover = HeroArtFitGeometry.CalculateFittedBounds(stage.Width, stage.Height, 1920, 1080, "cover");
        var contain = HeroArtFitGeometry.CalculateFittedBounds(stage.Width, stage.Height, 1920, 1080, "contain");
        var fill = HeroArtFitGeometry.CalculateFittedBounds(stage.Width, stage.Height, 1920, 1080, "fill");

        Assert.True(HeroStageGeometry.Covers(cover, stage));
        Assert.True(stage.Contains(contain));
        Assert.Equal(stage, fill);
    }

    [Theory]
    [InlineData("gi", "cover", 2048, 1024, true)]
    [InlineData("gi", "cover", 1024, 1024, false)]
    [InlineData("hsr", "cover", 2048, 1024, false)]
    [InlineData("gi", "contain", 2048, 1024, false)]
    public void Managed_art_presentation_only_adjusts_wide_genshin_cover_scenes(
        string gameId,
        string fit,
        int width,
        int height,
        bool expectedCenteredCover)
    {
        var presentation = HeroArtFitGeometry.ManagedPresentation(gameId, fit, width, height);

        Assert.Equal(expectedCenteredCover, presentation.UsesCenteredCoverGeometry);
    }

    [Fact]
    public void Live_and_preview_art_share_the_managed_scene_adjustment()
    {
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Equal(
            2,
            Regex.Matches(code, @"HeroArtFitGeometry\.ManagedPresentation\(").Count);
        Assert.Contains(
            "ApplyManagedHeroLayout(",
            code,
            StringComparison.Ordinal);
        Assert.Contains(
            "HeroArtFitGeometry.CalculateFittedBounds(",
            code,
            StringComparison.Ordinal);
        Assert.Contains(
            "(appearance.ArtScale / 100d) * presentationScale",
            code,
            StringComparison.Ordinal);
    }

    [Fact]
    public void Hover_pause_resumes_from_forty_percent_without_reloading_art()
    {
        var start = DateTimeOffset.Parse("2026-07-21T12:00:00Z", CultureInfo.InvariantCulture);
        var pausedProgress = BannerRotationSchedule.Progress(start, start.AddSeconds(2.8));
        var resumedStart = start.AddMinutes(1) - BannerRotationSchedule.ElapsedFromProgress(pausedProgress);

        Assert.InRange(pausedProgress, 39.999, 40.001);
        Assert.InRange(BannerRotationSchedule.Remaining(pausedProgress).TotalMilliseconds, 4199.99, 4200.01);
        Assert.True(BannerRotationSchedule.Progress(resumedStart, start.AddMinutes(1).AddSeconds(4.19)) < 100);
        Assert.InRange(
            BannerRotationSchedule.Progress(resumedStart, start.AddMinutes(1).AddSeconds(4.2)),
            99.999,
            100);
        var code = ReadAppFile("MainPage.xaml.cs");
        var exit = code[code.IndexOf("private void BannerPanel_PointerExited", StringComparison.Ordinal)..code.IndexOf("private void BannerCharacterRow_Click", StringComparison.Ordinal)];
        Assert.DoesNotContain("SetHeroSource", exit, StringComparison.Ordinal);
        Assert.DoesNotContain("RenderBannerCycle", exit, StringComparison.Ordinal);
    }

    [Fact]
    public void Five_long_codes_keep_exact_copy_text_when_narrow_metadata_is_hidden()
    {
        var codes = new[]
        {
            "GENSHIN-PRIMOGEMS-2026-LONG",
            "STARRAIL_JADE_REDEMPTION_2026",
            "ZZZ-POLYCHROME-LONG-CODE-2026",
            "WUWA_ASTRITE_REDEMPTION_LONG",
            "ENDFIELD-OROBERYL-LONG-2026",
        };
        foreach (var code in codes)
        {
            Assert.True(code.Length > 16);
            Assert.DoesNotContain(' ', code);
        }

        var xaml = ReadAppFile("MainPage.xaml");
        var appCode = ReadAppFile("MainPage.xaml.cs");
        var codeText = SliceElement(xaml, "Text=\"{Binding Code}\"");
        Assert.DoesNotContain("TextTrimming", codeText, StringComparison.Ordinal);
        Assert.Contains("CommandParameter=\"{Binding Code}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("row.SetMetadataVisibility(!compactCodeRows)", appCode, StringComparison.Ordinal);
        Assert.Contains("CurrencyVisibility = currencyNext", appCode, StringComparison.Ordinal);
    }

    private static bool Intersects(LauncherRect left, LauncherRect right) =>
        left.X < right.Right && left.Right > right.X && left.Y < right.Bottom && left.Bottom > right.Y;

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
            "[\"gi\"] = new(1, 0, 0, 0.30, 0.62)",
            code,
            StringComparison.Ordinal);
    }

    [Fact]
    public void Banner_schedule_shows_current_and_next_rotating_art_cards()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var start = xaml.IndexOf("x:Name=\"LatestStrip\"", StringComparison.Ordinal);
        var end = xaml.IndexOf("x:Name=\"CommandDeck\"", start, StringComparison.Ordinal);
        var strip = xaml[start..end];

        Assert.Contains("x:Name=\"LatestStrip\"", xaml, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"LatestHeaderGrid\"", strip, StringComparison.Ordinal);
        Assert.Contains("Text=\"BANNER CYCLE\"", strip, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"CurrentBannerCard\"", strip, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"NextBannerCard\"", strip, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"CurrentBannerImage\"", strip, StringComparison.Ordinal);
        Assert.Contains("x:Name=\"NextBannerImage\"", strip, StringComparison.Ordinal);
        Assert.Contains("ProgressBar", strip, StringComparison.Ordinal);
        Assert.Contains("Value=\"{Binding Progress}\"", strip, StringComparison.Ordinal);
        Assert.Contains("Height=\"78\"", strip, StringComparison.Ordinal);
        Assert.Contains("CornerRadius=\"32\"", strip, StringComparison.Ordinal);
        Assert.Contains("Visibility=\"{Binding ActiveVisibility}\"", strip, StringComparison.Ordinal);
        Assert.DoesNotContain("Text=\"CURRENT BANNER\"", strip, StringComparison.Ordinal);
        Assert.Contains("Background=\"Transparent\"", strip, StringComparison.Ordinal);
        Assert.DoesNotContain("CHANGES EVERY 7S", strip, StringComparison.Ordinal);
        Assert.DoesNotContain("Hyperlink", strip, StringComparison.Ordinal);
        Assert.DoesNotContain("http://", strip, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("https://", strip, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Launch_action_keeps_the_violet_double_frame_and_bottom_rail()
    {
        var controls = ReadAppFile("Themes", "NyxControls.xaml");
        var start = controls.IndexOf("x:Key=\"NyxLaunchButtonStyle\"", StringComparison.Ordinal);
        Assert.True(start >= 0);
        var style = controls[start..];

        Assert.Contains("Margin=\"8\"", style, StringComparison.Ordinal);
        Assert.Contains("VerticalAlignment=\"Bottom\"", style, StringComparison.Ordinal);
        Assert.Contains("Fill=\"{ThemeResource IrisBrush}\"", style, StringComparison.Ordinal);
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
        Assert.Contains("Assets\\Iris\\**\\*\" CopyToOutputDirectory=\"PreserveNewest\"", project, StringComparison.Ordinal);
        Assert.Contains("Assets\\Catalog\\**\\*\" CopyToOutputDirectory=\"PreserveNewest\"", project, StringComparison.Ordinal);
        Assert.Contains("Assets\\backgroundnyx.png\" CopyToOutputDirectory=\"PreserveNewest\"", project, StringComparison.Ordinal);
        Assert.Contains("<Link>Assets\\Brand\\kofi-logo.png</Link>", project, StringComparison.Ordinal);
        Assert.Contains("<CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>", project, StringComparison.Ordinal);
        Assert.All(required, fileName =>
        {
            var file = new FileInfo(Path.Combine(irisDirectory, fileName));
            Assert.True(file.Exists);
            Assert.True(file.Length > 1024);
        });
    }

    [Fact]
    public void Direct_distribution_is_explicitly_unpackaged_and_self_contained()
    {
        var project = ReadAppFile("Nyx.Desktop.App.csproj");

        Assert.Contains("<WindowsPackageType>None</WindowsPackageType>", project, StringComparison.Ordinal);
        Assert.Contains("<WindowsAppSDKSelfContained>true</WindowsAppSDKSelfContained>", project, StringComparison.Ordinal);
        Assert.Contains("<WindowsAppSdkUndockedRegFreeWinRTInitialize>true</WindowsAppSdkUndockedRegFreeWinRTInitialize>", project, StringComparison.Ordinal);
        Assert.Contains("<SelfContained>true</SelfContained>", project, StringComparison.Ordinal);
        Assert.Contains("<EnableMsixTooling>false</EnableMsixTooling>", project, StringComparison.Ordinal);
        Assert.Contains("<PublishTrimmed>False</PublishTrimmed>", project, StringComparison.Ordinal);
        Assert.Contains("Name=\"CopyApplicationPriToPublishDirectory\"", project, StringComparison.Ordinal);
        Assert.Contains("$(TargetDir)$(AssemblyName).pri", project, StringComparison.Ordinal);
        Assert.Contains("DestinationFolder=\"$(PublishDir)\"", project, StringComparison.Ordinal);
    }

    [Fact]
    public void Pinned_art_is_lazily_protected_without_deleting_backup_references()
    {
        var code = ReadAppFile("MainPage.xaml.cs");

        Assert.Contains("TryResolveUserArt(appearance.PinnedArtFile) is null", code, StringComparison.Ordinal);
        Assert.Contains("launcherBanners.PinUserArt(gameId, variant)", code, StringComparison.Ordinal);
        Assert.Contains("currentAppearance with", code, StringComparison.Ordinal);
        Assert.Contains("PinnedArtFile = pinToSave", code, StringComparison.Ordinal);
        Assert.Contains("pinWasSaved", code, StringComparison.Ordinal);
        Assert.Contains("allCurrentVariants", code, StringComparison.Ordinal);
        Assert.Contains("LauncherPinnedArtMigration.Evaluate", code, StringComparison.Ordinal);
        Assert.DoesNotContain("ArtPinned = false", code, StringComparison.Ordinal);
        Assert.DoesNotContain("ReleaseUserArt(savedAppearance.PinnedArtFile)", code, StringComparison.Ordinal);
        Assert.DoesNotContain("ReleaseUserArt(migratedPin)", code, StringComparison.Ordinal);
    }

    [Fact]
    public void Concurrent_custom_executable_conflicts_are_reported_and_add_cleanup_runs()
    {
        var page = ReadAppFile("MainPage.xaml.cs");
        var controller = ReadAppFile("LauncherStateController.cs");

        Assert.Contains("out var settingsFailure", page, StringComparison.Ordinal);
        Assert.Contains("out var addFailure", page, StringComparison.Ordinal);
        Assert.True(
            page.Split("That executable is already in your game rail.", StringSplitOptions.None).Length - 1 >= 2,
            "Both locked Settings and Add Game conflicts must show the duplicate message.");
        Assert.Contains("sessions.TryRemoveCustomAdapter(game.Id);", page, StringComparison.Ordinal);
        Assert.Contains("catch (CustomGameExecutableConflictException)", controller, StringComparison.Ordinal);
        Assert.Contains("LauncherStateUpdateFailure.CustomGameExecutableConflict", controller, StringComparison.Ordinal);
    }

    [Fact]
    public void Rail_and_settings_use_the_compact_direct_manipulation_design()
    {
        var xaml = ReadAppFile("MainPage.xaml");
        var code = ReadAppFile("MainPage.xaml.cs");
        var controls = ReadAppFile("Themes", "NyxControls.xaml");

        Assert.Contains("CanReorderItems=\"True\"", xaml, StringComparison.Ordinal);
        Assert.Contains("DragItemsCompleted=\"GameSelector_DragItemsCompleted\"", xaml, StringComparison.Ordinal);
        Assert.DoesNotContain("Text=\"{Binding StatusGlyph}\"", xaml, StringComparison.Ordinal);
        Assert.DoesNotContain("SelectionMarker", controls, StringComparison.Ordinal);
        Assert.Contains("SetBackgroundSource", code, StringComparison.Ordinal);
        Assert.Contains("displayedBackgroundSource", code, StringComparison.Ordinal);
        Assert.Contains("Freeze this artwork", code, StringComparison.Ordinal);
        Assert.Contains("var tabs = new ListView", code, StringComparison.Ordinal);
        Assert.Contains("Minimum = 25", code, StringComparison.Ordinal);
        Assert.Contains("Maximum = 500", code, StringComparison.Ordinal);
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
