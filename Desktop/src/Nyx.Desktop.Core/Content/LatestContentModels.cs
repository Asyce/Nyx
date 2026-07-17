using System.Collections.ObjectModel;

namespace Nyx.Desktop.Core.Content;

public sealed record LatestContentCard
{
    public LatestContentCard(
        string id,
        string type,
        string title,
        DateTimeOffset? publishedAt = null,
        string? approvedLink = null,
        string? publisherDateLabel = null)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 64)
        {
            throw new ArgumentOutOfRangeException(nameof(id));
        }

        if (string.IsNullOrWhiteSpace(type) || type.Length > 32)
        {
            throw new ArgumentOutOfRangeException(nameof(type));
        }

        if (string.IsNullOrWhiteSpace(title) || title.Length > 120 || title.Any(char.IsControl))
        {
            throw new ArgumentOutOfRangeException(nameof(title));
        }

        if (publisherDateLabel is not null
            && (publisherDateLabel.Length is 0 or > 16 || publisherDateLabel.Any(char.IsControl)))
        {
            throw new ArgumentOutOfRangeException(nameof(publisherDateLabel));
        }

        Id = id;
        Type = type;
        Title = title;
        PublishedAt = publishedAt;
        ApprovedLink = approvedLink;
        PublisherDateLabel = publisherDateLabel;
    }

    public string Id { get; }

    public string Type { get; }

    public string Title { get; }

    public DateTimeOffset? PublishedAt { get; }

    public string? ApprovedLink { get; }

    public string? PublisherDateLabel { get; }
}

public sealed record LatestContentSnapshot
{
    public LatestContentSnapshot(
        string gameId,
        string sourceLabel,
        string freshnessLabel,
        DateTimeOffset observedAt,
        bool isFallback,
        IEnumerable<LatestContentCard> cards)
    {
        if (gameId is not ("gi" or "hsr" or "zzz" or "wuwa" or "ae"))
        {
            throw new ArgumentOutOfRangeException(nameof(gameId));
        }

        if (string.IsNullOrWhiteSpace(sourceLabel) || sourceLabel.Length > 64)
        {
            throw new ArgumentOutOfRangeException(nameof(sourceLabel));
        }

        if (string.IsNullOrWhiteSpace(freshnessLabel) || freshnessLabel.Length > 64)
        {
            throw new ArgumentOutOfRangeException(nameof(freshnessLabel));
        }

        var bounded = cards.Take(3).ToArray();
        GameId = gameId;
        SourceLabel = sourceLabel;
        FreshnessLabel = freshnessLabel;
        ObservedAt = observedAt;
        IsFallback = isFallback;
        Cards = new ReadOnlyCollection<LatestContentCard>(bounded);
    }

    public string GameId { get; }

    public string SourceLabel { get; }

    public string FreshnessLabel { get; }

    public DateTimeOffset ObservedAt { get; }

    public bool IsFallback { get; }

    public IReadOnlyList<LatestContentCard> Cards { get; }
}

public interface ILatestContentSource
{
    IReadOnlyDictionary<string, LatestContentSnapshot> Current { get; }

    event EventHandler? Updated;

    Task RefreshAsync(CancellationToken cancellationToken = default);
}
