using System.Collections.ObjectModel;
using System.Text.Json.Serialization;
using Nyx.Desktop.Core.Features;
using Nyx.Desktop.Core.Games;

namespace Nyx.Desktop.Core.State;

/// <summary>Versioned, user-owned launcher state. The record contains no process or UI state.</summary>
public sealed record LauncherState
{
    public const int CurrentVersion = 2;

    public int Version { get; init; } = CurrentVersion;
    public string SelectedGameId { get; init; } = "gi";
    public IReadOnlyList<string> RailOrder { get; init; } = Array.Empty<string>();
    public IReadOnlyList<CustomGameDefinition> CustomGames { get; init; } = Array.Empty<CustomGameDefinition>();
    public IReadOnlyDictionary<string, GameAppearanceState> Appearance { get; init; } =
        new ReadOnlyDictionary<string, GameAppearanceState>(new Dictionary<string, GameAppearanceState>(StringComparer.Ordinal));
    public ExportArmingState Export { get; init; } = new();
    public LauncherGlobalPreferences Preferences { get; init; } = new();

    public static LauncherState Defaults() => new()
    {
        RailOrder = GameCatalog.All.Select(static game => game.Id).ToArray(),
    };
}

public sealed record GameAppearanceState
{
    public string? IconPath { get; init; }
    public string? BackgroundPath { get; init; }
    public bool AutomaticArt { get; init; } = true;
    public int ArtScale { get; init; } = 100;
    public int ArtX { get; init; }
    public int ArtY { get; init; }
    public string? ArtVariant { get; init; }
    public bool ArtPinned { get; init; }
    public string? PinnedArtFile { get; init; }

    public GameAppearanceState Normalize()
        => this with { ArtScale = Math.Clamp(ArtScale, 50, 250) };
}

public sealed record ExportArmingState
{
    /// <summary>Legacy/global arm bit retained for v0 readers. New callers use Games.</summary>
    public bool IsArmed { get; init; }
    public IReadOnlyDictionary<string, ExportGameArming> Games { get; init; } =
        new ReadOnlyDictionary<string, ExportGameArming>(new Dictionary<string, ExportGameArming>(StringComparer.Ordinal));
    public string? OutputDirectory { get; init; }
    public IReadOnlyDictionary<string, string> OutputPaths { get; init; } =
        new ReadOnlyDictionary<string, string>(new Dictionary<string, string>(StringComparer.Ordinal));
}

public sealed record ExportGameArming
{
    public bool PullsArmed { get; init; }
    public bool AchievementsArmed { get; init; }
}

public sealed record LauncherGlobalPreferences
{
    public bool StayVisibleAfterLaunch { get; init; } = true;
    public bool RefreshContentOnStartup { get; init; } = true;
    public bool SafeNotifications { get; init; } = true;
    public string? DataDirectory { get; init; }
    public string? EndfieldInstallRoot { get; init; }
    public LauncherFeatureFlags FeatureFlags { get; init; } = LauncherFeatureFlags.Defaults();
}

public enum LauncherStateReadStatus
{
    Loaded,
    Migrated,
    Recovered,
    DefaultsUsed,
    Malformed,
    FutureVersion,
}

public sealed record LauncherStateReadResult(
    LauncherStateReadStatus Status,
    LauncherState? State,
    string? Error = null)
{
    public bool IsUsable => State is not null;
}
