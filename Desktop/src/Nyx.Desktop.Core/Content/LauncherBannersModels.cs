using System.Collections.ObjectModel;

namespace Nyx.Desktop.Core.Content;

public sealed record LauncherBannersManifest
{
    private static readonly string[] CanonicalGames = ["gi", "hsr", "zzz", "wuwa", "ae"];

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
            if (!CanonicalGames.Contains(game.Key, StringComparer.Ordinal) || game.Value is null || game.Value.GameId != game.Key) throw new InvalidDataException("Launcher manifest must use the canonical five games.");
            copy.Add(game.Key, game.Value);
        }
        if (copy.Count != 5) throw new InvalidDataException("Launcher manifest must cover all five games.");
        if (CanonicalGames.Any(game => !Health.Games.ContainsKey(game))) throw new InvalidDataException("Launcher health must match the canonical five games.");
        Games = new ReadOnlyDictionary<string, LauncherBannersGame>(copy);
    }

    public int SchemaVersion { get; }
    public string Revision { get; }
    public DateTimeOffset GeneratedAt { get; }
    public LauncherBannersHealth Health { get; }
    public IReadOnlyDictionary<string, LauncherBannersGame> Games { get; }

    public LauncherBannersManifest ForDisplayAt(DateTimeOffset observedAt)
    {
        var overallHealthy = Health.Status == "ok";
        var visibleGames = Games.ToDictionary(
            pair => pair.Key,
            pair =>
            {
                var game = pair.Value;
                var healthy = overallHealthy
                    && Health.Games.TryGetValue(pair.Key, out var gameHealth)
                    && gameHealth.Status == "ok";
                var current = healthy
                    && game.Current is { } phase
                    && phase.Start <= observedAt
                    && observedAt < phase.End
                        ? phase
                        : null;
                var upcoming = healthy
                    ? game.Upcoming.Where(phase => phase.Start > observedAt).ToArray()
                    : [];
                return new LauncherBannersGame(game.GameId, game.Region, current, game.News, upcoming, game.Codes);
            },
            StringComparer.Ordinal);
        return new LauncherBannersManifest(SchemaVersion, Revision, GeneratedAt, Health, visibleGames);
    }
}

public sealed record LauncherBannersHealth
{
    private static readonly string[] CanonicalGames = ["gi", "hsr", "zzz", "wuwa", "ae"];

    public LauncherBannersHealth(string status, IReadOnlyDictionary<string, LauncherBannersGameHealth> games)
    {
        if (status is not ("ok" or "degraded" or "unavailable")) throw new ArgumentOutOfRangeException(nameof(status));
        Status = status;
        var copy = new Dictionary<string, LauncherBannersGameHealth>(StringComparer.Ordinal);
        foreach (var game in games ?? throw new ArgumentNullException(nameof(games)))
        {
            if (!CanonicalGames.Contains(game.Key, StringComparer.Ordinal) || game.Value is null) throw new InvalidDataException("Launcher health must use the canonical five games.");
            copy.Add(game.Key, game.Value);
        }
        if (copy.Count != CanonicalGames.Length) throw new InvalidDataException("Launcher health must cover all five games.");
        Games = new ReadOnlyDictionary<string, LauncherBannersGameHealth>(copy);
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
    public LauncherBannersGame(
        string gameId,
        string region,
        LauncherBannersCurrentPhase? current,
        IReadOnlyList<LauncherBannersNewsItem> news,
        IReadOnlyList<LauncherBannersUpcomingPhase>? upcoming = null,
        IReadOnlyList<LauncherRedemptionCode>? codes = null)
    {
        if (gameId is not ("gi" or "hsr" or "zzz" or "wuwa" or "ae")) throw new ArgumentOutOfRangeException(nameof(gameId));
        if (region is not ("global" or "america" or "europe" or "asia")) throw new ArgumentOutOfRangeException(nameof(region));
        GameId = gameId;
        Region = region;
        Current = current;
        News = new ReadOnlyCollection<LauncherBannersNewsItem>((news ?? throw new ArgumentNullException(nameof(news))).ToArray());
        var future = (upcoming ?? []).ToArray();
        if (future.Any(phase => phase is null)) throw new InvalidDataException("Launcher upcoming phases cannot contain null entries.");
        var windows = future
            .Select(phase => (phase.Start, phase.End))
            .Concat(current is null ? [] : [(current.Start, current.End)])
            .OrderBy(window => window.Start)
            .ThenBy(window => window.End)
            .ToArray();
        for (var index = 1; index < windows.Length; index++)
        {
            if (windows[index].Start < windows[index - 1].End) throw new InvalidDataException("Launcher banner phase windows overlap.");
        }
        Upcoming = new ReadOnlyCollection<LauncherBannersUpcomingPhase>(future);
        Codes = new ReadOnlyCollection<LauncherRedemptionCode>((codes ?? []).ToArray());
    }

    public string GameId { get; }
    public string Region { get; }
    public LauncherBannersCurrentPhase? Current { get; }
    public IReadOnlyList<LauncherBannersNewsItem> News { get; }
    public IReadOnlyList<LauncherBannersUpcomingPhase> Upcoming { get; }
    public IReadOnlyList<LauncherRedemptionCode> Codes { get; }
}

public sealed record LauncherRedemptionCode(
    string Code,
    DateOnly Added,
    int CurrencyAmount,
    string CurrencyName)
{
    public LauncherRedemptionCode(string code, DateOnly added)
        : this(code, added, 0, string.Empty)
    {
    }
}

public sealed record LauncherCodesManifest(
    int SchemaVersion,
    string Revision,
    DateTimeOffset GeneratedAt,
    IReadOnlyDictionary<string, IReadOnlyList<LauncherRedemptionCode>> Games);

public sealed record LauncherBannersUpcomingPhase
{
    public LauncherBannersUpcomingPhase(
        string? phase,
        DateTimeOffset start,
        DateTimeOffset end,
        IReadOnlyList<LauncherBannersCharacter> characters)
    {
        if (end <= start) throw new ArgumentOutOfRangeException(nameof(end));
        var copy = (characters ?? throw new ArgumentNullException(nameof(characters))).ToArray();
        if (copy.Any(character => character is null) || copy.Select(character => character.Id).Distinct(StringComparer.Ordinal).Count() != copy.Length) throw new InvalidDataException("Launcher phase characters must be unique.");
        Phase = phase;
        Start = start;
        End = end;
        Characters = new ReadOnlyCollection<LauncherBannersCharacter>(copy);
    }

    public string? Phase { get; }
    public DateTimeOffset Start { get; }
    public DateTimeOffset End { get; }
    public IReadOnlyList<LauncherBannersCharacter> Characters { get; }
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
        var characterCopy = (characters ?? throw new ArgumentNullException(nameof(characters))).ToArray();
        if (characterCopy.Any(character => character is null) || characterCopy.Select(character => character.Id).Distinct(StringComparer.Ordinal).Count() != characterCopy.Length) throw new InvalidDataException("Launcher phase characters must be unique.");
        Phase = phase;
        Start = start;
        End = end;
        RemainingSeconds = remainingSeconds;
        Characters = new ReadOnlyCollection<LauncherBannersCharacter>(characterCopy);
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
    public LauncherBannersCharacter(
        string id,
        string name,
        int? rarity,
        bool? limited,
        DateTimeOffset? debut,
        IReadOnlyList<LauncherBannersAsset> variants,
        LauncherBannersAsset? icon = null)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 96 || id.Any(char.IsControl)) throw new ArgumentOutOfRangeException(nameof(id));
        if (string.IsNullOrWhiteSpace(name) || name.Length > 80 || name.Any(char.IsControl)) throw new ArgumentOutOfRangeException(nameof(name));
        if (rarity is < 1 or > 6) throw new ArgumentOutOfRangeException(nameof(rarity));
        Id = id; Name = name; Rarity = rarity; Limited = limited; Debut = debut; Icon = icon;
        Variants = new ReadOnlyCollection<LauncherBannersAsset>((variants ?? throw new ArgumentNullException(nameof(variants))).ToArray());
    }

    public string Id { get; }
    public string Name { get; }
    public int? Rarity { get; }
    public bool? Limited { get; }
    public DateTimeOffset? Debut { get; }
    public LauncherBannersAsset? Icon { get; }
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
