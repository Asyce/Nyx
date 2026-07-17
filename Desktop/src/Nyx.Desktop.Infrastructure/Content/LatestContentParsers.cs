using System.Collections.ObjectModel;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Nyx.Desktop.Core.Content;

namespace Nyx.Desktop.Infrastructure.Content;

internal static class LatestContentJson
{
    public static JsonDocument ParseBounded(byte[] payload, int maximumBytes, int maximumDepth)
    {
        ArgumentNullException.ThrowIfNull(payload);
        if (payload.Length == 0 || payload.Length > maximumBytes)
        {
            throw new InvalidDataException("Content payload is outside the allowed size.");
        }

        RejectDuplicateProperties(payload, maximumDepth);
        return JsonDocument.Parse(payload, new JsonDocumentOptions
        {
            AllowTrailingCommas = false,
            CommentHandling = JsonCommentHandling.Disallow,
            MaxDepth = maximumDepth,
        });
    }

    public static bool HasOnlyProperties(JsonElement element, params string[] allowed)
    {
        var set = new HashSet<string>(allowed, StringComparer.Ordinal);
        return element.ValueKind is JsonValueKind.Object
            && element.EnumerateObject().All(property => set.Contains(property.Name));
    }

    public static string RequiredText(JsonElement element, string name, int maximumLength)
    {
        if (!element.TryGetProperty(name, out var value)
            || value.ValueKind is not JsonValueKind.String)
        {
            throw new InvalidDataException($"Missing content field: {name}.");
        }

        var text = value.GetString()?.Trim() ?? string.Empty;
        if (text.Length == 0 || text.Length > maximumLength || text.Any(char.IsControl))
        {
            throw new InvalidDataException($"Invalid content field: {name}.");
        }

        return text;
    }

    public static bool TryParseIsoDate(string? value, out DateTimeOffset result) =>
        DateTimeOffset.TryParseExact(
            value,
            ["O", "yyyy-MM-dd'T'HH:mm:ss.fff'Z'"],
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out result);

    private static void RejectDuplicateProperties(byte[] payload, int maximumDepth)
    {
        var reader = new Utf8JsonReader(payload, new JsonReaderOptions
        {
            AllowTrailingCommas = false,
            CommentHandling = JsonCommentHandling.Disallow,
            MaxDepth = maximumDepth,
        });
        var objects = new Stack<HashSet<string>>();
        while (reader.Read())
        {
            if (reader.TokenType is JsonTokenType.StartObject)
            {
                objects.Push(new(StringComparer.Ordinal));
            }
            else if (reader.TokenType is JsonTokenType.EndObject)
            {
                objects.Pop();
            }
            else if (reader.TokenType is JsonTokenType.PropertyName
                && (objects.Count == 0 || !objects.Peek().Add(reader.GetString()!)))
            {
                throw new InvalidDataException("Duplicate JSON property.");
            }
        }
    }
}

internal static class HoyoLatestContentParser
{
    internal const int MaximumBytes = 128 * 1024;
    private static readonly HashSet<string> AllowedTypes = new(
        [
            "POST_TYPE_ACTIVITY",
            "POST_TYPE_ANNOUNCE",
            "POST_TYPE_INFO",
            "POST_TYPE_NEWS",
            "activity",
            "announcement",
            "news",
        ],
        StringComparer.Ordinal);
    private static readonly HashSet<string> AllowedHosts = new(
        [
            "www.hoyolab.com",
            "hoyo.link",
            "youtu.be",
            "genshin.hoyoverse.com",
            "hsr.hoyoverse.com",
            "zenless.hoyoverse.com",
        ],
        StringComparer.OrdinalIgnoreCase);

    public static IReadOnlyList<LatestContentCard> Parse(
        byte[] payload,
        string expectedGameId,
        string expectedBiz,
        string expectedLanguage)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(expectedGameId);
        ArgumentException.ThrowIfNullOrWhiteSpace(expectedBiz);
        ArgumentException.ThrowIfNullOrWhiteSpace(expectedLanguage);
        using var document = LatestContentJson.ParseBounded(payload, MaximumBytes, 8);
        var root = document.RootElement;
        if (!LatestContentJson.HasOnlyProperties(root, "retcode", "message", "data")
            || !root.TryGetProperty("retcode", out var retcode)
            || !retcode.TryGetInt32(out var code)
            || code != 0
            || !root.TryGetProperty("message", out var message)
            || message.ValueKind is not JsonValueKind.String
            || !root.TryGetProperty("data", out var data)
            || !LatestContentJson.HasOnlyProperties(data, "content")
            || !data.TryGetProperty("content", out var content)
            || !LatestContentJson.HasOnlyProperties(
                content,
                "game",
                "language",
                "banners",
                "posts",
                "social_media_list")
            || !content.TryGetProperty("game", out var game)
            || !LatestContentJson.HasOnlyProperties(game, "id", "biz")
            || LatestContentJson.RequiredText(game, "id", 32) != expectedGameId
            || LatestContentJson.RequiredText(game, "biz", 32) != expectedBiz
            || !content.TryGetProperty("language", out var language)
            || language.ValueKind is not JsonValueKind.String
            || !string.Equals(language.GetString(), expectedLanguage, StringComparison.Ordinal)
            || !content.TryGetProperty("posts", out var posts)
            || posts.ValueKind is not JsonValueKind.Array
            || posts.GetArrayLength() > 100)
        {
            throw new InvalidDataException("Unexpected HoYoPlay content schema.");
        }

        var cards = new List<LatestContentCard>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var post in posts.EnumerateArray())
        {
            if (!LatestContentJson.HasOnlyProperties(
                post,
                "id",
                "type",
                "title",
                "date",
                "link",
                "login_state_in_link",
                "i18n_identifier"))
            {
                throw new InvalidDataException("Unexpected HoYoPlay post field.");
            }

            var id = LatestContentJson.RequiredText(post, "id", 64);
            var type = LatestContentJson.RequiredText(post, "type", 32);
            var title = LatestContentJson.RequiredText(post, "title", 120);
            if (!ids.Add(id) || !AllowedTypes.Contains(type))
            {
                throw new InvalidDataException("Unsupported or duplicate HoYoPlay post.");
            }

            DateTimeOffset? date = null;
            string? publisherDateLabel = null;
            if (post.TryGetProperty("date", out var dateElement))
            {
                if (dateElement.ValueKind is not JsonValueKind.String
                    || !TryParseDate(dateElement.GetString(), out date, out publisherDateLabel))
                {
                    throw new InvalidDataException("Invalid HoYoPlay post date.");
                }
            }

            ValidateIgnoredPostFields(post);

            string? link = null;
            if (post.TryGetProperty("link", out var linkElement))
            {
                if (linkElement.ValueKind is not JsonValueKind.String
                    || !Uri.TryCreate(linkElement.GetString(), UriKind.Absolute, out var uri)
                    || uri.Scheme is not "https"
                    || !AllowedHosts.Contains(uri.IdnHost)
                    || !string.IsNullOrEmpty(uri.UserInfo))
                {
                    throw new InvalidDataException("Unsafe HoYoPlay link.");
                }

                link = uri.AbsoluteUri;
            }

            if (cards.Count < 3)
            {
                cards.Add(new(id, type, title, date, link, publisherDateLabel));
            }
        }

        return new ReadOnlyCollection<LatestContentCard>(cards);
    }

    private static bool TryParseDate(
        string? value,
        out DateTimeOffset? result,
        out string? publisherDateLabel)
    {
        if (LatestContentJson.TryParseIsoDate(value, out var parsed))
        {
            result = parsed;
            publisherDateLabel = null;
            return true;
        }

        result = null;
        publisherDateLabel = null;
        if (!DateTime.TryParseExact(
            value,
            "MM/dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out _))
        {
            return false;
        }

        publisherDateLabel = value;
        return true;
    }

    private static void ValidateIgnoredPostFields(JsonElement post)
    {
        if (post.TryGetProperty("login_state_in_link", out var login)
            && login.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            throw new InvalidDataException("Invalid HoYoPlay login marker.");
        }

        if (post.TryGetProperty("i18n_identifier", out var i18n))
        {
            if (i18n.ValueKind is not JsonValueKind.String)
            {
                throw new InvalidDataException("Invalid HoYoPlay identifier.");
            }

            var value = i18n.GetString() ?? string.Empty;
            if (value.Length > 128 || value.Any(char.IsControl))
            {
                throw new InvalidDataException("Invalid HoYoPlay identifier.");
            }
        }
    }
}

internal static class NyxLauncherContentParser
{
    internal const int MaximumBytes = 256 * 1024;
    internal static readonly TimeSpan MaximumRemoteAge = TimeSpan.FromDays(7);
    internal static readonly TimeSpan MaximumFutureSkew = TimeSpan.FromMinutes(5);

    public static IReadOnlyDictionary<string, LatestContentSnapshot> Parse(
        byte[] payload,
        bool fallback,
        DateTimeOffset observedAt,
        IReadOnlySet<string>? allowedGames = null)
    {
        using var document = LatestContentJson.ParseBounded(payload, MaximumBytes, 8);
        var root = document.RootElement;
        if (!LatestContentJson.HasOnlyProperties(root, "schemaVersion", "generatedAt", "games")
            || !root.TryGetProperty("schemaVersion", out var version)
            || !version.TryGetInt32(out var schemaVersion)
            || schemaVersion != 1
            || !root.TryGetProperty("generatedAt", out var generated)
            || generated.ValueKind is not JsonValueKind.String
            || !LatestContentJson.TryParseIsoDate(generated.GetString(), out var generatedAt)
            || !root.TryGetProperty("games", out var games)
            || games.ValueKind is not JsonValueKind.Object)
        {
            throw new InvalidDataException("Unexpected Nyx launcher content schema.");
        }

        if (!fallback
            && (generatedAt < observedAt - MaximumRemoteAge
                || generatedAt > observedAt + MaximumFutureSkew))
        {
            throw new InvalidDataException("Nyx launcher content is outside the allowed freshness window.");
        }

        var result = new Dictionary<string, LatestContentSnapshot>(StringComparer.Ordinal);
        foreach (var game in games.EnumerateObject())
        {
            if (game.Name is not ("gi" or "hsr" or "zzz" or "wuwa" or "ae")
                || (allowedGames is not null && !allowedGames.Contains(game.Name))
                || !LatestContentJson.HasOnlyProperties(game.Value, "source", "cards"))
            {
                throw new InvalidDataException("Unexpected Nyx launcher game.");
            }

            var source = LatestContentJson.RequiredText(game.Value, "source", 64);
            if (!game.Value.TryGetProperty("cards", out var cardsElement)
                || cardsElement.ValueKind is not JsonValueKind.Array
                || cardsElement.GetArrayLength() > 3)
            {
                throw new InvalidDataException("Invalid Nyx launcher cards.");
            }

            var cards = new List<LatestContentCard>();
            foreach (var card in cardsElement.EnumerateArray())
            {
                if (!LatestContentJson.HasOnlyProperties(card, "id", "type", "title", "date"))
                {
                    throw new InvalidDataException("Unexpected Nyx launcher card field.");
                }

                var id = LatestContentJson.RequiredText(card, "id", 64);
                var type = LatestContentJson.RequiredText(card, "type", 32);
                var title = LatestContentJson.RequiredText(card, "title", 120);
                DateTimeOffset? date = null;
                if (card.TryGetProperty("date", out var dateElement))
                {
                    if (dateElement.ValueKind is not JsonValueKind.String
                        || !LatestContentJson.TryParseIsoDate(dateElement.GetString(), out var parsed))
                    {
                        throw new InvalidDataException("Invalid Nyx launcher card date.");
                    }

                    date = parsed;
                }

                cards.Add(new(id, type, title, date));
            }

            result.Add(game.Name, new(
                game.Name,
                source,
                fallback ? $"Bundled snapshot · {generatedAt:yyyy-MM-dd}" : $"Updated · {generatedAt:yyyy-MM-dd}",
                observedAt,
                fallback,
                cards));
        }

        return new ReadOnlyDictionary<string, LatestContentSnapshot>(result);
    }
}
