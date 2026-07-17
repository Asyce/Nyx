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
    public const double ItemChrome = 12;
    public const double ItemMargin = 2;

    public double ItemExtent => IconSize + ItemChrome;

    public double ItemCrossExtent => ItemExtent + (ItemMargin * 2);
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
                DeckHeight: 286,
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
                DeckHeight: 152,
                LaunchWidth: Math.Clamp(width * 0.44, 300, 380)),
            LauncherLayoutState.Wide => new(
                LauncherLayoutState.Wide,
                UsesHorizontalRail: false,
                RailExtent: 132,
                IconSize: 108,
                HeroWidth: Math.Clamp(width * 0.68, 760, 1080),
                ContentWidth: Math.Clamp(width * 0.49, 540, 660),
                TitleSize: 64,
                OuterPadding: 24,
                DeckHeight: 166,
                LaunchWidth: 360),
            _ => new(
                LauncherLayoutState.Expanded,
                UsesHorizontalRail: false,
                RailExtent: 144,
                IconSize: 116,
                HeroWidth: Math.Clamp(width * 0.72, 1100, 1900),
                ContentWidth: Math.Clamp(width * 0.34, 660, 820),
                TitleSize: 80,
                OuterPadding: 36,
                DeckHeight: 180,
                LaunchWidth: 410),
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
        other.X >= X
        && other.Y >= Y
        && other.Right <= Right
        && other.Bottom <= Bottom;
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
    public const double CommandDeckBorder = 1;
    public const double NarrowWideDeckWidth = 1180;
    public const double CompactDeckPadding = 12;
    public const double CompactOfficialInset = 10;
    public const double CompactRowGap = 8;
    public const double CompactLocalWidth = 100;
    public const double CompactStatusHeight = 104;
    public const double CompactToolsHeight = 68;
    public const double CompactCtaHeight = 72;
    public const double TwoRowHorizontalPadding = 14;
    public const double TwoRowVerticalPadding = 9;
    public const double TwoRowColumnGap = 12;
    public const double TwoRowGap = 8;
    public const double TwoRowHeight = 62;
    public const double SingleRowHorizontalPadding = 26;
    public const double SingleRowVerticalPadding = 20;
    public const double SingleRowColumnGap = 20;

    public static LauncherViewportSnapshot Calculate(double width, double height)
    {
        var profile = LauncherLayoutStateSelector.CreateProfile(width, height);
        var horizontalRail = profile.UsesHorizontalRail;
        var railHeight = horizontalRail ? profile.RailExtent + TitleBarHeight : height;
        var rail = horizontalRail
            ? new LauncherRect(0, 0, width, railHeight)
            : new LauncherRect(0, 0, profile.RailExtent, height);

        var deckX = horizontalRail ? profile.OuterPadding : profile.RailExtent + 26;
        var deckRightMargin = horizontalRail ? profile.OuterPadding : profile.OuterPadding;
        var deckBottomMargin = horizontalRail ? 18 : 22;
        var deckWidth = width - deckX - deckRightMargin;
        var deck = new LauncherRect(
            deckX,
            height - deckBottomMargin - profile.DeckHeight,
            deckWidth,
            profile.DeckHeight);

        var contentX = horizontalRail ? profile.OuterPadding : profile.RailExtent + 52;
        var contentY = horizontalRail ? railHeight + 18 : 76;
        var contentBottom = deck.Y - (horizontalRail ? 4 : 20);
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
        var toolsY = inner.Y + CompactStatusHeight + CompactRowGap;
        var launchY = toolsY + CompactToolsHeight + CompactRowGap;

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
            new LauncherRect(inner.X, launchY, inner.Width, CompactCtaHeight));
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
        var flexibleWidth = Math.Max(
            0,
            inner.Width - (TwoRowColumnGap * 3) - profile.LaunchWidth);
        var firstWidth = flexibleWidth / 2;
        var launchHalf = profile.LaunchWidth / 2;
        var x0 = inner.X;
        var x1 = x0 + firstWidth + TwoRowColumnGap;
        var x2 = x1 + firstWidth + TwoRowColumnGap;
        var x3 = x2 + launchHalf + TwoRowColumnGap;
        var secondRowY = inner.Y + TwoRowHeight + TwoRowGap;

        return new(
            profile,
            LauncherDeckLayoutMode.TwoRow,
            rail,
            content,
            deck,
            inner,
            new LauncherRect(x0, inner.Y, firstWidth, TwoRowHeight),
            new LauncherRect(
                x1,
                inner.Y,
                firstWidth + profile.LaunchWidth + (TwoRowColumnGap * 2),
                TwoRowHeight),
            ClipTo(
                inner,
                new LauncherRect(
                    x0,
                    secondRowY,
                    (firstWidth * 2) + TwoRowColumnGap,
                    TwoRowHeight)),
            ClipTo(
                inner,
                new LauncherRect(
                    x2,
                    secondRowY,
                    (launchHalf * 2) + TwoRowColumnGap,
                    TwoRowHeight)));
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
        var localWidth = profile.State is LauncherLayoutState.Wide ? 160 : 190;
        var toolsWidth = profile.State is LauncherLayoutState.Wide ? 216 : 230;
        var officialWidth = Math.Max(
            0,
            inner.Width
            - localWidth
            - toolsWidth
            - profile.LaunchWidth
            - (SingleRowColumnGap * 3));
        var officialX = inner.X + localWidth + SingleRowColumnGap;
        var toolsX = officialX + officialWidth + SingleRowColumnGap;
        var launchX = toolsX + toolsWidth + SingleRowColumnGap;

        return new(
            profile,
            LauncherDeckLayoutMode.SingleRow,
            rail,
            content,
            deck,
            inner,
            new LauncherRect(inner.X, inner.Y, localWidth, inner.Height),
            new LauncherRect(officialX, inner.Y, officialWidth, inner.Height),
            new LauncherRect(toolsX, inner.Y, toolsWidth, inner.Height),
            new LauncherRect(launchX, inner.Y, profile.LaunchWidth, inner.Height));
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
        transformedImage.X <= stage.X
        && transformedImage.Y <= stage.Y
        && transformedImage.Right >= stage.Right
        && transformedImage.Bottom >= stage.Bottom;
}
