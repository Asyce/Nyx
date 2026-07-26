using Nyx.Desktop.Core.AccountStatus;

namespace Nyx_Desktop_App.ViewModels;

public enum LauncherLayoutState
{
    Compact,
    Horizontal,
    Wide,
    Expanded,
}

public sealed record LauncherLayoutProfile(
    LauncherLayoutState State,
    bool UsesHorizontalRail,
    double RailExtent,
    double IconSize,
    double HeroWidth,
    double ContentWidth,
    double TitleSize,
    double OuterPadding,
    double DeckHeight,
    double LaunchWidth)
{
    public const double ItemChrome = 2;
    public const double ItemMargin = 0;

    public double ItemExtent => IconSize + ItemChrome;

    public double ItemCrossExtent => ItemExtent + (ItemMargin * 2);
}

public enum HeroArtFit
{
    Cover,
    Contain,
    Fill,
}

public static class HeroArtFitGeometry
{
    public readonly record struct AutomaticPresentation(bool UsesCenteredCoverGeometry);

    public static HeroArtFit Parse(string? fit) => fit?.Trim().ToLowerInvariant() switch
    {
        "contain" => HeroArtFit.Contain,
        "fill" => HeroArtFit.Fill,
        _ => HeroArtFit.Cover,
    };

    public static string Normalize(string? fit) => Parse(fit) switch
    {
        HeroArtFit.Contain => "contain",
        HeroArtFit.Fill => "fill",
        _ => "cover",
    };

    public static LauncherRect CalculateFittedBounds(
        double stageWidth,
        double stageHeight,
        double imageWidth,
        double imageHeight,
        string? fit)
    {
        if (stageWidth <= 0 || stageHeight <= 0 || imageWidth <= 0 || imageHeight <= 0
            || !double.IsFinite(stageWidth) || !double.IsFinite(stageHeight)
            || !double.IsFinite(imageWidth) || !double.IsFinite(imageHeight))
            throw new ArgumentOutOfRangeException(nameof(stageWidth));

        if (Parse(fit) is HeroArtFit.Fill)
            return new LauncherRect(0, 0, stageWidth, stageHeight);

        var scale = Parse(fit) is HeroArtFit.Contain
            ? Math.Min(stageWidth / imageWidth, stageHeight / imageHeight)
            : Math.Max(stageWidth / imageWidth, stageHeight / imageHeight);
        var width = imageWidth * scale;
        var height = imageHeight * scale;
        return new LauncherRect((stageWidth - width) / 2, (stageHeight - height) / 2, width, height);
    }

    public static AutomaticPresentation ManagedPresentation(
        string gameId,
        string? fit,
        int imageWidth,
        int imageHeight)
    {
        if (gameId == "gi"
            && Parse(fit) is HeroArtFit.Cover
            && imageWidth > 0
            && imageHeight > 0
            && (double)imageWidth / imageHeight >= 1.6d)
        {
            // Genshin's official gacha images can be wide full scenes rather
            // than transparent character cut-outs. Pull those scenes slightly
            // inward so the character remains visible in Nyx's portrait-like
            // hero stage while the user's own scale/position stays additive.
            return new(UsesCenteredCoverGeometry: true);
        }

        return new(UsesCenteredCoverGeometry: false);
    }
}

public static class BannerRotationSchedule
{
    public static readonly TimeSpan Duration = TimeSpan.FromSeconds(7);

    public static TimeSpan ElapsedFromProgress(double progressPercent) =>
        TimeSpan.FromMilliseconds(Duration.TotalMilliseconds * Math.Clamp(progressPercent, 0, 100) / 100d);

    public static TimeSpan Remaining(double progressPercent) =>
        TimeSpan.FromMilliseconds(Math.Max(1, Duration.TotalMilliseconds - ElapsedFromProgress(progressPercent).TotalMilliseconds));

    public static double Progress(DateTimeOffset startedAt, DateTimeOffset now) =>
        Math.Clamp((now - startedAt).TotalMilliseconds / Duration.TotalMilliseconds * 100d, 0, 100);
}

public static class PublisherAccountDisplayProjection
{
    public static int RemainingRecoverySeconds(PublisherResourceSnapshot resource, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(resource);
        var elapsed = Math.Max(0, (int)Math.Floor((now - resource.ObservedAt).TotalSeconds));
        return Math.Max(0, resource.RecoverySeconds - elapsed);
    }

    public static string FormatResource(PublisherResourceSnapshot resource, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(resource);
        var text = $"{resource.ResourceName.ToUpperInvariant()}  {resource.Current}/{resource.Maximum}";
        if (resource.Reserve is { } reserve) text += $"  ·  RESERVE {reserve}";
        var remaining = RemainingRecoverySeconds(resource, now);
        if (remaining > 0)
        {
            var duration = TimeSpan.FromSeconds(remaining);
            var label = duration.TotalHours >= 1
                ? $"{(int)duration.TotalHours}H {duration.Minutes}M"
                : $"{Math.Max(1, duration.Minutes)}M";
            text += $"  ·  FULL {label}";
        }
        if (resource.IsStale) text += "  ·  STALE";
        return text;
    }
}

public static class LauncherLayoutStateSelector
{
    public const double CompactWidth = 760;
    public const double WideWidth = 1040;
    public const double ExpandedWidth = 1600;
    public const double ShortHeight = 680;
    public const double ExpandedHeight = 760;

    public static LauncherLayoutState Select(double width, double height)
    {
        if (!double.IsFinite(width) || width < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(width));
        }

        if (!double.IsFinite(height) || height < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(height));
        }

        if (width < CompactWidth)
        {
            return LauncherLayoutState.Compact;
        }

        if (width < WideWidth || height < ShortHeight)
        {
            return LauncherLayoutState.Horizontal;
        }

        if (width >= ExpandedWidth && height >= ExpandedHeight)
        {
            return LauncherLayoutState.Expanded;
        }

        return LauncherLayoutState.Wide;
    }

    public static LauncherLayoutProfile CreateProfile(double width, double height) =>
        Select(width, height) switch
        {
            LauncherLayoutState.Compact => new(
                LauncherLayoutState.Compact,
                UsesHorizontalRail: true,
                RailExtent: 112,
                IconSize: 92,
                HeroWidth: Math.Clamp(width, 390, 760),
                ContentWidth: Math.Max(300, width - 40),
                TitleSize: 44,
                OuterPadding: 14,
                DeckHeight: 492,
                LaunchWidth: Math.Clamp(width - 52, 270, 420)),
            LauncherLayoutState.Horizontal => new(
                LauncherLayoutState.Horizontal,
                UsesHorizontalRail: true,
                RailExtent: 120,
                IconSize: 100,
                HeroWidth: Math.Clamp(width * 0.66, 500, 760),
                ContentWidth: Math.Clamp(width * 0.66, 440, 620),
                TitleSize: 52,
                OuterPadding: 20,
                DeckHeight: 198,
                LaunchWidth: Math.Clamp(width * 0.44, 300, 380)),
            LauncherLayoutState.Wide => new(
                LauncherLayoutState.Wide,
                UsesHorizontalRail: false,
                RailExtent: 102,
                IconSize: 82,
                HeroWidth: Math.Clamp(width * 0.52, 560, 760),
                ContentWidth: Math.Clamp(width * 0.32, 405, 520),
                TitleSize: 64,
                OuterPadding: 24,
                DeckHeight: width < LauncherViewportGeometry.NarrowWideDeckWidth ? 228 : 172,
                LaunchWidth: 405),
            _ => new(
                LauncherLayoutState.Expanded,
                UsesHorizontalRail: false,
                RailExtent: 112,
                IconSize: 100,
                HeroWidth: Math.Clamp(width * 0.52, 760, 1180),
                ContentWidth: Math.Clamp(width * 0.46, 720, 920),
                TitleSize: 80,
                OuterPadding: 36,
                DeckHeight: 244,
                LaunchWidth: 440),
        };
}

public enum LauncherDeckLayoutMode
{
    CompactStack,
    TwoRow,
    SingleRow,
}

public readonly record struct LauncherRect(double X, double Y, double Width, double Height)
{
    public double Right => X + Width;

    public double Bottom => Y + Height;

    public bool Contains(LauncherRect other) =>
        other.X + 0.000001 >= X
        && other.Y + 0.000001 >= Y
        && other.Right <= Right + 0.000001
        && other.Bottom <= Bottom + 0.000001;
}

public sealed record LauncherViewportSnapshot(
    LauncherLayoutProfile Profile,
    LauncherDeckLayoutMode DeckMode,
    LauncherRect Rail,
    LauncherRect Content,
    LauncherRect CommandDeck,
    LauncherRect CommandDeckInner,
    LauncherRect LocalCell,
    LauncherRect OfficialCell,
    LauncherRect ToolsCell,
    LauncherRect LaunchCell);

public static class LauncherViewportGeometry
{
    public const double TitleBarHeight = 52;
    public const double CommandDeckBorder = 0;
    public const double NarrowWideDeckWidth = 1200;
    public const double CompactDeckPadding = 12;
    public const double CompactOfficialInset = 10;
    public const double CompactRowGap = 8;
    public const double CompactLocalWidth = 100;
    public const double CompactStatusHeight = 196;
    public const double CompactToolsHeight = 184;
    public const double CompactCtaHeight = 72;
    public const double TwoRowHorizontalPadding = 14;
    public const double TwoRowVerticalPadding = 9;
    public const double TwoRowColumnGap = 12;
    public const double TwoRowGap = 8;
    public const double TwoRowStatusHeight = 62;
    public const double TwoRowActionHeight = 110;
    public const double WideTwoRowStatusHeight = 92;
    public const double SingleRowHorizontalPadding = 26;
    public const double SingleRowVerticalPadding = 8;
    public const double SingleRowColumnGap = 20;

    public static LauncherViewportSnapshot Calculate(
        double width,
        double height,
        bool accountStatusVisible = false)
    {
        var profile = LauncherLayoutStateSelector.CreateProfile(width, height);
        var horizontalRail = profile.UsesHorizontalRail;
        var railHeight = horizontalRail ? profile.RailExtent + TitleBarHeight : height;
        var rail = horizontalRail
            ? new LauncherRect(0, 0, width, railHeight)
            : new LauncherRect(0, 0, profile.RailExtent, height);

        var deckX = horizontalRail ? 0 : profile.RailExtent;
        var deckRightMargin = 0d;
        var deckBottomMargin = 0d;
        var deckHeight = profile.DeckHeight + (accountStatusVisible ? 60 : 0);
        var deckWidth = width - deckX - deckRightMargin;
        var deck = new LauncherRect(
            deckX,
            height - deckBottomMargin - deckHeight,
            deckWidth,
            deckHeight);

        var contentX = horizontalRail ? profile.OuterPadding : profile.RailExtent + 30;
        var contentY = horizontalRail ? railHeight + 18 : profile.State is LauncherLayoutState.Wide ? 38 : 76;
        var contentBottom = deck.Y - (horizontalRail ? 4 : profile.State is LauncherLayoutState.Wide ? 4 : 20);
        var content = new LauncherRect(
            contentX,
            contentY,
            profile.ContentWidth,
            Math.Max(0, contentBottom - contentY));

        var deckMode = profile.State is LauncherLayoutState.Compact
            ? LauncherDeckLayoutMode.CompactStack
            : profile.State is LauncherLayoutState.Horizontal
              || (profile.State is LauncherLayoutState.Wide && width < NarrowWideDeckWidth)
                ? LauncherDeckLayoutMode.TwoRow
                : LauncherDeckLayoutMode.SingleRow;

        return deckMode switch
        {
            LauncherDeckLayoutMode.CompactStack => CalculateCompact(
                profile,
                rail,
                content,
                deck),
            LauncherDeckLayoutMode.TwoRow => CalculateTwoRow(
                profile,
                rail,
                content,
                deck),
            _ => CalculateSingleRow(profile, rail, content, deck),
        };
    }

    private static LauncherViewportSnapshot CalculateCompact(
        LauncherLayoutProfile profile,
        LauncherRect rail,
        LauncherRect content,
        LauncherRect deck)
    {
        var inner = Inset(
            deck,
            CompactDeckPadding + CommandDeckBorder,
            CompactDeckPadding + CommandDeckBorder);
        var officialWidth = inner.Width - CompactLocalWidth - CompactOfficialInset;
        var officialX = inner.X + CompactLocalWidth + CompactOfficialInset;
        var accountStatusExtra = Math.Max(0, deck.Height - profile.DeckHeight);
        var launchY = inner.Y + CompactStatusHeight + CompactRowGap;
        var launchHeight = CompactCtaHeight + accountStatusExtra;
        var toolsY = launchY + launchHeight + CompactRowGap;

        return new(
            profile,
            LauncherDeckLayoutMode.CompactStack,
            rail,
            content,
            deck,
            inner,
            new LauncherRect(inner.X, inner.Y, CompactLocalWidth, CompactStatusHeight),
            new LauncherRect(officialX, inner.Y, officialWidth, CompactStatusHeight),
            new LauncherRect(inner.X, toolsY, inner.Width, CompactToolsHeight),
            new LauncherRect(inner.X, launchY, inner.Width, launchHeight));
    }

    private static LauncherViewportSnapshot CalculateTwoRow(
        LauncherLayoutProfile profile,
        LauncherRect rail,
        LauncherRect content,
        LauncherRect deck)
    {
        var inner = Inset(
            deck,
            TwoRowHorizontalPadding + CommandDeckBorder,
            TwoRowVerticalPadding + CommandDeckBorder);
        var firstWidth = Math.Max(0, (inner.Width - TwoRowColumnGap) * 0.36);
        var x0 = inner.X;
        var x1 = x0 + firstWidth + TwoRowColumnGap;
        var statusHeight = profile.State is LauncherLayoutState.Wide
            ? WideTwoRowStatusHeight
            : TwoRowStatusHeight;
        var launchY = inner.Y + statusHeight + TwoRowGap;
        var accountStatusExtra = Math.Max(0, deck.Height - profile.DeckHeight);
        var launchHeight = Math.Max(40, (TwoRowActionHeight - TwoRowGap) * 0.6) + accountStatusExtra;
        var toolsY = launchY + launchHeight + TwoRowGap;
        var toolsHeight = Math.Max(40, inner.Bottom - toolsY);

        return new(
            profile,
            LauncherDeckLayoutMode.TwoRow,
            rail,
            content,
            deck,
            inner,
            new LauncherRect(x0, inner.Y, firstWidth, statusHeight),
            new LauncherRect(x1, inner.Y, Math.Max(0, inner.Right - x1), statusHeight),
            ClipTo(inner, new LauncherRect(inner.X, toolsY, inner.Width, toolsHeight)),
            ClipTo(inner, new LauncherRect(inner.X, launchY, inner.Width, launchHeight)));
    }

    private static LauncherViewportSnapshot CalculateSingleRow(
        LauncherLayoutProfile profile,
        LauncherRect rail,
        LauncherRect content,
        LauncherRect deck)
    {
        var inner = Inset(
            deck,
            SingleRowHorizontalPadding + CommandDeckBorder,
            SingleRowVerticalPadding + CommandDeckBorder);
        var localWidth = Math.Max(190, (inner.Width - profile.LaunchWidth - (SingleRowColumnGap * 2)) * 0.38);
        var officialWidth = Math.Max(0, inner.Width - localWidth - profile.LaunchWidth - (SingleRowColumnGap * 2));
        var officialX = inner.X + localWidth + SingleRowColumnGap;
        var launchX = officialX + officialWidth + SingleRowColumnGap;
        var launchHeight = Math.Max(40, inner.Height - 46);
        var toolsY = inner.Y + launchHeight + 6;

        return new(
            profile,
            LauncherDeckLayoutMode.SingleRow,
            rail,
            content,
            deck,
            inner,
            new LauncherRect(inner.X, inner.Y, localWidth, inner.Height),
            new LauncherRect(officialX, inner.Y, officialWidth, inner.Height),
            new LauncherRect(launchX, toolsY, profile.LaunchWidth, Math.Max(40, inner.Bottom - toolsY)),
            new LauncherRect(launchX, inner.Y, profile.LaunchWidth, launchHeight));
    }

    private static LauncherRect Inset(
        LauncherRect rectangle,
        double horizontal,
        double vertical) =>
        new(
            rectangle.X + horizontal,
            rectangle.Y + vertical,
            Math.Max(0, rectangle.Width - (horizontal * 2)),
            Math.Max(0, rectangle.Height - (vertical * 2)));

    private static LauncherRect ClipTo(LauncherRect bounds, LauncherRect rectangle)
    {
        var x = Math.Max(bounds.X, rectangle.X);
        var y = Math.Max(bounds.Y, rectangle.Y);
        var right = Math.Min(bounds.Right, rectangle.Right);
        var bottom = Math.Min(bounds.Bottom, rectangle.Bottom);
        return new LauncherRect(
            x,
            y,
            Math.Max(0, right - x),
            Math.Max(0, bottom - y));
    }
}

public static class HeroStageGeometry
{
    public static LauncherRect CalculateTransformedBounds(
        double stageWidth,
        double stageHeight,
        double focalScale,
        double offsetX,
        double offsetY)
    {
        if (stageWidth <= 0 || stageHeight <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(stageWidth));
        }

        if (!double.IsFinite(focalScale) || focalScale < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(focalScale));
        }

        // WinUI first arranges the Image element to the stage. UniformToFill clips
        // the bitmap inside that element; the CompositeTransform then scales the
        // already stage-sized element around its center.
        var transformedWidth = stageWidth * focalScale;
        var transformedHeight = stageHeight * focalScale;

        return new LauncherRect(
            ((stageWidth - transformedWidth) / 2) + offsetX,
            ((stageHeight - transformedHeight) / 2) + offsetY,
            transformedWidth,
            transformedHeight);
    }

    public static bool Covers(LauncherRect transformedImage, LauncherRect stage) =>
        transformedImage.X <= stage.X + 0.000001
        && transformedImage.Y <= stage.Y + 0.000001
        && transformedImage.Right + 0.000001 >= stage.Right
        && transformedImage.Bottom + 0.000001 >= stage.Bottom;
}
