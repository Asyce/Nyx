using System.Collections.ObjectModel;
using Nyx.Desktop.Core.Games;

namespace Nyx.Desktop.Core.State;

/// <summary>
/// The values a Settings dialog owns. They are merged into the latest state so
/// an older open dialog cannot replace unrelated edits made by another process.
/// </summary>
public sealed record LauncherSettingsEdit
{
    public required string GameId { get; init; }
    public required GameAppearanceState OpenedAppearance { get; init; }
    public required GameAppearanceState Appearance { get; init; }
    public CustomGameDefinition? CustomGame { get; init; }
    public required IReadOnlyList<string> RailOrder { get; init; }
    public required bool StayVisibleAfterLaunch { get; init; }
    public required bool RefreshContentOnStartup { get; init; }
    public required bool SafeNotifications { get; init; }
    public required bool AutomaticArt { get; init; }
    public required bool OfficialNews { get; init; }
    public required bool RemoteBannerManifest { get; init; }
}

public static class LauncherSettingsStateMerge
{
    public static LauncherState Apply(
        LauncherState latest,
        LauncherState opened,
        LauncherSettingsEdit edit)
    {
        ArgumentNullException.ThrowIfNull(latest);
        ArgumentNullException.ThrowIfNull(opened);
        ArgumentNullException.ThrowIfNull(edit);

        var appearances = latest.Appearance.ToDictionary(
            static pair => pair.Key,
            static pair => pair.Value,
            StringComparer.Ordinal);
        if (edit.Appearance != edit.OpenedAppearance)
        {
            var currentAppearance = appearances.TryGetValue(edit.GameId, out var savedAppearance)
                ? savedAppearance
                : new GameAppearanceState();
            appearances[edit.GameId] = MergeAppearance(
                currentAppearance,
                edit.OpenedAppearance,
                edit.Appearance);
        }

        var customs = MergeCustomGame(latest.CustomGames, opened.CustomGames, edit.CustomGame);
        var rail = MergeRailOrder(
            opened.RailOrder,
            edit.RailOrder,
            latest.RailOrder,
            edit.CustomGame?.Id);

        return latest with
        {
            Appearance = new ReadOnlyDictionary<string, GameAppearanceState>(appearances),
            CustomGames = customs,
            RailOrder = rail,
            Preferences = latest.Preferences with
            {
                StayVisibleAfterLaunch = MergeValue(
                    latest.Preferences.StayVisibleAfterLaunch,
                    opened.Preferences.StayVisibleAfterLaunch,
                    edit.StayVisibleAfterLaunch),
                RefreshContentOnStartup = MergeValue(
                    latest.Preferences.RefreshContentOnStartup,
                    opened.Preferences.RefreshContentOnStartup,
                    edit.RefreshContentOnStartup),
                SafeNotifications = MergeValue(
                    latest.Preferences.SafeNotifications,
                    opened.Preferences.SafeNotifications,
                    edit.SafeNotifications),
                FeatureFlags = latest.Preferences.FeatureFlags with
                {
                    AutomaticArt = MergeValue(
                        latest.Preferences.FeatureFlags.AutomaticArt,
                        opened.Preferences.FeatureFlags.AutomaticArt,
                        edit.AutomaticArt),
                    OfficialNews = MergeValue(
                        latest.Preferences.FeatureFlags.OfficialNews,
                        opened.Preferences.FeatureFlags.OfficialNews,
                        edit.OfficialNews),
                    RemoteBannerManifest = MergeValue(
                        latest.Preferences.FeatureFlags.RemoteBannerManifest,
                        opened.Preferences.FeatureFlags.RemoteBannerManifest,
                        edit.RemoteBannerManifest),
                },
            },
        };
    }

    public static LauncherState ResetAppearance(LauncherState latest, string gameId)
    {
        ArgumentNullException.ThrowIfNull(latest);
        ArgumentException.ThrowIfNullOrWhiteSpace(gameId);

        var appearances = latest.Appearance.ToDictionary(
            static pair => pair.Key,
            static pair => pair.Value,
            StringComparer.Ordinal);
        appearances.Remove(gameId);
        return latest with
        {
            Appearance = new ReadOnlyDictionary<string, GameAppearanceState>(appearances),
        };
    }

    private static IReadOnlyList<CustomGameDefinition> MergeCustomGame(
        IReadOnlyList<CustomGameDefinition> latest,
        IReadOnlyList<CustomGameDefinition> opened,
        CustomGameDefinition? edited)
    {
        if (edited is null)
        {
            return latest;
        }

        var openedGame = opened.FirstOrDefault(game => string.Equals(game.Id, edited.Id, StringComparison.Ordinal));
        if (openedGame == edited)
        {
            return latest;
        }

        var replaced = false;
        var merged = latest.Select(game =>
        {
            if (!string.Equals(game.Id, edited.Id, StringComparison.Ordinal))
            {
                return game;
            }

            replaced = true;
            return openedGame is null
                ? edited
                : MergeCustomGame(game, openedGame, edited);
        }).ToList();
        if (!replaced && openedGame is null)
        {
            merged.Add(edited);
        }

        var mergedGame = merged.FirstOrDefault(game => string.Equals(game.Id, edited.Id, StringComparison.Ordinal));
        if (mergedGame is not null)
        {
            LauncherCustomGameStateMerge.EnsureExecutableUnique(merged, mergedGame);
        }

        return merged;
    }

    private static CustomGameDefinition MergeCustomGame(
        CustomGameDefinition latest,
        CustomGameDefinition opened,
        CustomGameDefinition edited) => latest with
    {
        Name = MergeValue(latest.Name, opened.Name, edited.Name),
        ExecutablePath = MergeValue(latest.ExecutablePath, opened.ExecutablePath, edited.ExecutablePath),
        IconPath = MergeValue(latest.IconPath, opened.IconPath, edited.IconPath),
        BackgroundPath = MergeValue(latest.BackgroundPath, opened.BackgroundPath, edited.BackgroundPath),
        RuntimePath = MergeValue(latest.RuntimePath, opened.RuntimePath, edited.RuntimePath),
        RawArguments = MergeValue(latest.RawArguments, opened.RawArguments, edited.RawArguments),
        RequestAdministrator = MergeValue(
            latest.RequestAdministrator,
            opened.RequestAdministrator,
            edited.RequestAdministrator),
        CreationOrder = MergeValue(latest.CreationOrder, opened.CreationOrder, edited.CreationOrder),
    };

    private static GameAppearanceState MergeAppearance(
        GameAppearanceState latest,
        GameAppearanceState opened,
        GameAppearanceState edited) => latest with
    {
        IconPath = MergeValue(latest.IconPath, opened.IconPath, edited.IconPath),
        BackgroundPath = MergeValue(latest.BackgroundPath, opened.BackgroundPath, edited.BackgroundPath),
        AutomaticArt = MergeValue(latest.AutomaticArt, opened.AutomaticArt, edited.AutomaticArt),
        ArtScale = MergeValue(latest.ArtScale, opened.ArtScale, edited.ArtScale),
        ArtX = MergeValue(latest.ArtX, opened.ArtX, edited.ArtX),
        ArtY = MergeValue(latest.ArtY, opened.ArtY, edited.ArtY),
        ArtVariant = MergeValue(latest.ArtVariant, opened.ArtVariant, edited.ArtVariant),
        ArtPinned = MergeValue(latest.ArtPinned, opened.ArtPinned, edited.ArtPinned),
        PinnedArtFile = MergeValue(latest.PinnedArtFile, opened.PinnedArtFile, edited.PinnedArtFile),
    };

    private static T MergeValue<T>(T latest, T opened, T edited) =>
        EqualityComparer<T>.Default.Equals(opened, edited) ? latest : edited;

    private static IReadOnlyList<string> MergeRailOrder(
        IReadOnlyList<string> opened,
        IReadOnlyList<string> edited,
        IReadOnlyList<string> latest,
        string? locallyRetainedGameId)
    {
        if (opened.SequenceEqual(edited, StringComparer.Ordinal))
        {
            return latest;
        }

        var openedIds = opened.ToHashSet(StringComparer.Ordinal);
        var availableIds = latest.ToHashSet(StringComparer.Ordinal);
        if (locallyRetainedGameId is not null)
        {
            availableIds.Add(locallyRetainedGameId);
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var merged = edited
            .Where(id => availableIds.Contains(id) && seen.Add(id))
            .ToList();

        // IDs absent when the dialog opened belong to a concurrent writer.
        // Keep them in that writer's order after the locally ordered entries.
        foreach (var id in latest)
        {
            if (!openedIds.Contains(id) && seen.Add(id))
            {
                merged.Add(id);
            }
        }

        return merged;
    }
}
