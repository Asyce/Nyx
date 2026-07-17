using System.Collections.ObjectModel;

namespace Nyx.Desktop.Core.Features;

/// <summary>
/// Independent opt-in lanes. A disabled lane is never allowed to disable launch
/// or another lane. Future providers default off until they are verified.
/// </summary>
public enum LauncherFeatureFlag
{
    RemoteBannerManifest,
    OfficialNews,
    AutomaticArt,
    GiPulls,
    GiAchievements,
    HsrPulls,
    HsrAchievements,
    ZzzPulls,
    ZzzAchievements,
    WuWaPulls,
    WuWaAchievements,
    EndfieldPulls,
    EndfieldAchievements,
}

public sealed record LauncherFeatureFlags
{
    public bool RemoteBannerManifest { get; init; } = true;
    public bool OfficialNews { get; init; } = true;
    public bool AutomaticArt { get; init; } = true;
    public bool GiPulls { get; init; } = true;
    public bool GiAchievements { get; init; } = true;
    public bool HsrPulls { get; init; } = true;
    public bool HsrAchievements { get; init; } = true;
    public bool ZzzPulls { get; init; }
    public bool ZzzAchievements { get; init; }
    public bool WuWaPulls { get; init; }
    public bool WuWaAchievements { get; init; }
    public bool EndfieldPulls { get; init; }
    public bool EndfieldAchievements { get; init; }

    public static LauncherFeatureFlags Defaults() => new();

    public bool IsEnabled(LauncherFeatureFlag flag) => flag switch
    {
        LauncherFeatureFlag.RemoteBannerManifest => RemoteBannerManifest,
        LauncherFeatureFlag.OfficialNews => OfficialNews,
        LauncherFeatureFlag.AutomaticArt => AutomaticArt,
        LauncherFeatureFlag.GiPulls => GiPulls,
        LauncherFeatureFlag.GiAchievements => GiAchievements,
        LauncherFeatureFlag.HsrPulls => HsrPulls,
        LauncherFeatureFlag.HsrAchievements => HsrAchievements,
        LauncherFeatureFlag.ZzzPulls => ZzzPulls,
        LauncherFeatureFlag.ZzzAchievements => ZzzAchievements,
        LauncherFeatureFlag.WuWaPulls => WuWaPulls,
        LauncherFeatureFlag.WuWaAchievements => WuWaAchievements,
        LauncherFeatureFlag.EndfieldPulls => EndfieldPulls,
        LauncherFeatureFlag.EndfieldAchievements => EndfieldAchievements,
        _ => false,
    };

    public LauncherFeatureFlags Set(LauncherFeatureFlag flag, bool enabled) => flag switch
    {
        LauncherFeatureFlag.RemoteBannerManifest => this with { RemoteBannerManifest = enabled },
        LauncherFeatureFlag.OfficialNews => this with { OfficialNews = enabled },
        LauncherFeatureFlag.AutomaticArt => this with { AutomaticArt = enabled },
        LauncherFeatureFlag.GiPulls => this with { GiPulls = enabled },
        LauncherFeatureFlag.GiAchievements => this with { GiAchievements = enabled },
        LauncherFeatureFlag.HsrPulls => this with { HsrPulls = enabled },
        LauncherFeatureFlag.HsrAchievements => this with { HsrAchievements = enabled },
        LauncherFeatureFlag.ZzzPulls => this with { ZzzPulls = enabled },
        LauncherFeatureFlag.ZzzAchievements => this with { ZzzAchievements = enabled },
        LauncherFeatureFlag.WuWaPulls => this with { WuWaPulls = enabled },
        LauncherFeatureFlag.WuWaAchievements => this with { WuWaAchievements = enabled },
        LauncherFeatureFlag.EndfieldPulls => this with { EndfieldPulls = enabled },
        LauncherFeatureFlag.EndfieldAchievements => this with { EndfieldAchievements = enabled },
        _ => this,
    };

    public IReadOnlyDictionary<string, bool> AsCapabilityMap()
    {
        var map = Enum.GetValues<LauncherFeatureFlag>()
            .ToDictionary(static flag => flag.ToString(), IsEnabled, StringComparer.Ordinal);
        return new ReadOnlyDictionary<string, bool>(map);
    }
}
