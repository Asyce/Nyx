using System.Collections.ObjectModel;

namespace Nyx.Desktop.Core.Content;

public sealed record LauncherBannersManifest
{
    public LauncherBannersManifest(
        int schemaVersion,
        string revision,
        DateTimeOffset generatedAt,
        LauncherBannersHealth health,
        IReadOnlyDictionary<string, LauncherBannersGame> games)
    {
        if (schemaVersion != 1) throw new ArgumentOutOfRangeException(nameof(schemaVersion));
        if (string.IsNullOrWhiteSpace(revision) || revision.Length != 64 || revision.Any(c => !Uri.IsHexDigit(c))) throw new ArgumentOutOfRangeException(nameof(revision));
        SchemaVersion = schemaVersion;
        Revision = revision;
        GeneratedAt = generatedAt;
        Health = health ?? throw new ArgumentNullException(nameof(health));
        var copy = new Dictionary<string, LauncherBannersGame>(StringComparer.Ordinal);
        foreach (var game in games ?? throw new ArgumentNullException(nameof(games)))
        {
            if (game.Key is not ("gi" or "hsr" or "zzz" or "wuwa" or "ae") || game.Value is null) throw new InvalidDataException("Launcher manifest must use the canonical five games.");
            copy.Add(game.Key, game.Value);
        }
        if (copy.Count != 5) throw new InvalidDataException("Launcher manifest must cover all five games.");
        Games = new ReadOnlyDictionary<string, LauncherBannersGame>(copy);
    }

    public int SchemaVersion { get; }
    public string Revision { get; }
    public DateTimeOffset GeneratedAt { get; }
    public LauncherBannersHealth Health { get; }
    public IReadOnlyDictionary<string, LauncherBannersGame> Games { get; }
}

public sealed record LauncherBannersHealth
{
    public LauncherBannersHealth(string status, IReadOnlyDictionary<string, LauncherBannersGameHealth> games)
    {
        if (status is not ("ok" or "degraded" or "unavailable")) throw new ArgumentOutOfRangeException(nameof(status));
        Status = status;
        Games = new ReadOnlyDictionary<string, LauncherBannersGameHealth>((games ?? throw new ArgumentNullException(nameof(games))).ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal));
    }

    public string Status { get; }
    public IReadOnlyDictionary<string, LauncherBannersGameHealth> Games { get; }
}

public sealed record LauncherBannersGameHealth
{
    public LauncherBannersGameHealth(string status, string? reason, int newsCount)
    {
        if (status is not ("ok" or "degraded" or "missing")) throw new ArgumentOutOfRangeException(nameof(status));
        if (newsCount is < 0 or > 100) throw new ArgumentOutOfRangeException(nameof(newsCount));
        Status = status;
        Reason = reason;
        NewsCount = newsCount;
    }

    public string Status { get; }
    public string? Reason { get; }
    public int NewsCount { get; }
}

public sealed record LauncherBannersGame
{
    public LauncherBannersGame(string gameId, string region, LauncherBannersCurrentPhase? current, IReadOnlyList<LauncherBannersNewsItem> news)
    {
        if (gameId is not ("gi" or "hsr" or "zzz" or "wuwa" or "ae")) throw new ArgumentOutOfRangeException(nameof(gameId));
        if (region is not ("global" or "america" or "europe" or "asia")) throw new ArgumentOutOfRangeException(nameof(region));
        GameId = gameId;
        Region = region;
        Current = current;
        News = new ReadOnlyCollection<LauncherBannersNewsItem>((news ?? throw new ArgumentNullException(nameof(news))).ToArray());
    }

    public string GameId { get; }
    public string Region { get; }
    public LauncherBannersCurrentPhase? Current { get; }
    public IReadOnlyList<LauncherBannersNewsItem> News { get; }
}

public sealed record LauncherBannersCurrentPhase
{
    public LauncherBannersCurrentPhase(
        string? phase,
        DateTimeOffset start,
        DateTimeOffset end,
        long remainingSeconds,
        IReadOnlyList<LauncherBannersCharacter> characters,
        string? selectedCharacterId,
        string? selectionReason,
        IReadOnlyList<LauncherBannersAsset> variants)
    {
        if (end <= start) throw new ArgumentOutOfRangeException(nameof(end));
        if (remainingSeconds < 0) throw new ArgumentOutOfRangeException(nameof(remainingSeconds));
        Phase = phase;
        Start = start;
        End = end;
        RemainingSeconds = remainingSeconds;
        Characters = new ReadOnlyCollection<LauncherBannersCharacter>((characters ?? throw new ArgumentNullException(nameof(characters))).ToArray());
        SelectedCharacterId = selectedCharacterId;
        SelectionReason = selectionReason;
        Variants = new ReadOnlyCollection<LauncherBannersAsset>((variants ?? throw new ArgumentNullException(nameof(variants))).ToArray());
        if (selectedCharacterId is not null && Characters.All(character => character.Id != selectedCharacterId)) throw new InvalidDataException("Selected launcher character is not in the current phase.");
    }

    public string? Phase { get; }
    public DateTimeOffset Start { get; }
    public DateTimeOffset End { get; }
    public long RemainingSeconds { get; }
    public IReadOnlyList<LauncherBannersCharacter> Characters { get; }
    public string? SelectedCharacterId { get; }
    public string? SelectionReason { get; }
    public IReadOnlyList<LauncherBannersAsset> Variants { get; }
}

public sealed record LauncherBannersCharacter
{
    public LauncherBannersCharacter(string id, string name, int? rarity, bool? limited, DateTimeOffset? debut, IReadOnlyList<LauncherBannersAsset> variants)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 96 || id.Any(char.IsControl)) throw new ArgumentOutOfRangeException(nameof(id));
        if (string.IsNullOrWhiteSpace(name) || name.Length > 80 || name.Any(char.IsControl)) throw new ArgumentOutOfRangeException(nameof(name));
        if (rarity is < 1 or > 6) throw new ArgumentOutOfRangeException(nameof(rarity));
        Id = id; Name = name; Rarity = rarity; Limited = limited; Debut = debut;
        Variants = new ReadOnlyCollection<LauncherBannersAsset>((variants ?? throw new ArgumentNullException(nameof(variants))).ToArray());
    }

    public string Id { get; }
    public string Name { get; }
    public int? Rarity { get; }
    public bool? Limited { get; }
    public DateTimeOffset? Debut { get; }
    public IReadOnlyList<LauncherBannersAsset> Variants { get; }
}

public sealed record LauncherBannersAsset
{
    public LauncherBannersAsset(
        string id,
        string source,
        string path,
        Uri? url,
        string mime,
        long size,
        LauncherBannersDimensions dimensions,
        string sha256,
        LauncherBannersBounds transparentBounds,
        LauncherBannersPlacement placement)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 128 || id.Any(char.IsControl)) throw new ArgumentOutOfRangeException(nameof(id));
        if (string.IsNullOrWhiteSpace(source) || source.Length > 64 || source.Any(char.IsControl)) throw new ArgumentOutOfRangeException(nameof(source));
        if (string.IsNullOrWhiteSpace(path) || path.Length > 512 || path.Any(char.IsControl) || path.Contains('\\') || !path.StartsWith('/') || path[1..].Split('/').Any(part => part is "" or "." or "..")) throw new ArgumentOutOfRangeException(nameof(path));
        if (mime is not ("image/webp" or "image/png")) throw new ArgumentOutOfRangeException(nameof(mime));
        if (size <= 0) throw new ArgumentOutOfRangeException(nameof(size));
        if (string.IsNullOrWhiteSpace(sha256) || sha256.Length != 64 || sha256.Any(c => !Uri.IsHexDigit(c))) throw new ArgumentOutOfRangeException(nameof(sha256));
        Id = id; Source = source; Path = path; Url = url; Mime = mime; Size = size; Dimensions = dimensions; Sha256 = sha256.ToLowerInvariant(); TransparentBounds = transparentBounds; Placement = placement;
    }

    public string Id { get; }
    public string Source { get; }
    public string Path { get; }
    public Uri? Url { get; }
    public string Mime { get; }
    public long Size { get; }
    public LauncherBannersDimensions Dimensions { get; }
    public string Sha256 { get; }
    public LauncherBannersBounds TransparentBounds { get; }
    public LauncherBannersPlacement Placement { get; }
}

public sealed record LauncherBannersDimensions(int Width, int Height);
public sealed record LauncherBannersBounds(int Left, int Top, int Right, int Bottom);
public sealed record LauncherBannersPlacement(string Anchor, string Fit, double X, double Y);

public sealed record LauncherBannersNewsItem(string Id, string Title, string Type, DateTimeOffset? Start, DateTimeOffset? End, string? RawUrl, Uri? ApprovedUrl, bool IsLinkSafe);
