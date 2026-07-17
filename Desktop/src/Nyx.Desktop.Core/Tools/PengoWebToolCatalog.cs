using System.Collections.ObjectModel;
using System.Diagnostics.CodeAnalysis;
using Nyx.Desktop.Core.Games;

namespace Nyx.Desktop.Core.Tools;

public enum PengoWebToolKind
{
    PullTracker,
    Achievements,
}

public sealed class PengoWebToolDefinition
{
    internal PengoWebToolDefinition(
        string gameId,
        PengoWebToolKind kind,
        string fixedDestination)
    {
        var game = GameCatalog.GetRequired(gameId);
        var destination = new Uri(fixedDestination, UriKind.Absolute);
        if (!string.Equals(destination.Scheme, Uri.UriSchemeHttps, StringComparison.Ordinal)
            || !string.Equals(destination.IdnHost, "pengo.gg", StringComparison.Ordinal)
            || !destination.IsDefaultPort
            || destination.UserInfo.Length != 0
            || destination.Query.Length != 0
            || destination.Fragment.Length != 0)
        {
            throw new InvalidOperationException("A fixed Pengo tool destination is invalid.");
        }

        GameId = game.Id;
        Kind = kind;
        Destination = destination;
    }

    public string GameId { get; }

    public PengoWebToolKind Kind { get; }

    public Uri Destination { get; }
}

public static class PengoWebToolCatalog
{
    private static readonly PengoWebToolDefinition[] Definitions =
    [
        new("gi", PengoWebToolKind.PullTracker, "https://pengo.gg/genshin/tracker"),
        new("gi", PengoWebToolKind.Achievements, "https://pengo.gg/genshin/achievements"),
        new("hsr", PengoWebToolKind.PullTracker, "https://pengo.gg/hsr/tracker"),
        new("hsr", PengoWebToolKind.Achievements, "https://pengo.gg/hsr/achievements"),
        new("zzz", PengoWebToolKind.PullTracker, "https://pengo.gg/zzz/tracker"),
        new("wuwa", PengoWebToolKind.PullTracker, "https://pengo.gg/wuwa/tracker"),
        new("ae", PengoWebToolKind.PullTracker, "https://pengo.gg/endfield/tracker"),
    ];

    private static readonly IReadOnlyDictionary<(string GameId, PengoWebToolKind Kind), PengoWebToolDefinition>
        ByGameAndKind = Definitions.ToDictionary(
            definition => (definition.GameId, definition.Kind));

    public static IReadOnlyList<PengoWebToolDefinition> All { get; } =
        new ReadOnlyCollection<PengoWebToolDefinition>(Definitions);

    public static bool TryGet(
        string? gameId,
        PengoWebToolKind kind,
        [NotNullWhen(true)] out PengoWebToolDefinition? definition)
    {
        if (!GameCatalog.TryGet(gameId, out var game))
        {
            definition = null;
            return false;
        }

        return ByGameAndKind.TryGetValue((game.Id, kind), out definition);
    }
}
