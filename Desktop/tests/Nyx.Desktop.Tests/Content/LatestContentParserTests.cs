using System.Text;
using Nyx.Desktop.Infrastructure.Content;

namespace Nyx.Desktop.Tests.Content;

public sealed class LatestContentParserTests
{
    public static TheoryData<string, string> HoyoGames => new()
    {
        { "gopR6Cufr3", "hk4e_global" },
        { "4ziysqXOQ8", "hkrpg_global" },
        { "U5hbdsT9W7", "nap_global" },
    };

    [Theory]
    [MemberData(nameof(HoyoGames))]
    public void Hoyo_parser_accepts_only_the_requested_sanitized_game_identity(
        string gameId,
        string biz)
    {
        var cards = HoyoLatestContentParser.Parse(
            HoyoPayload("{\"id\":\"1\",\"type\":\"POST_TYPE_INFO\",\"title\":\"Official\"}", gameId, biz),
            gameId,
            biz,
            "en-us");

        Assert.Single(cards);
        Assert.Equal("Official", cards[0].Title);
    }

    [Fact]
    public void Hoyo_parser_preserves_order_projects_allowlisted_fields_and_caps_three()
    {
        var payload = HoyoPayload(
            """
            {"id":"1","type":"POST_TYPE_INFO","title":"First","date":"07/15","link":"https://youtu.be/example","login_state_in_link":false,"i18n_identifier":"launcher.post.1"},
            {"id":"2","type":"activity","title":"Second"},
            {"id":"3","type":"announcement","title":"Third"},
            {"id":"4","type":"news","title":"Fourth"}
            """);

        var cards = HoyoLatestContentParser.Parse(
            payload,
            "4ziysqXOQ8",
            "hkrpg_global",
            "en-us");

        Assert.Equal(["1", "2", "3"], cards.Select(card => card.Id));
        Assert.Equal("First", cards[0].Title);
        Assert.Equal("https://youtu.be/example", cards[0].ApprovedLink);
        Assert.Null(cards[0].PublishedAt);
        Assert.Equal("07/15", cards[0].PublisherDateLabel);
    }

    [Theory]
    [InlineData("gopR6Cufr3", "hkrpg_global", "en-us")]
    [InlineData("4ziysqXOQ8", "nap_global", "en-us")]
    [InlineData("4ziysqXOQ8", "hkrpg_global", "en")]
    public void Hoyo_parser_rejects_cross_game_biz_or_language_payloads(
        string payloadGameId,
        string payloadBiz,
        string payloadLanguage)
    {
        var payload = HoyoPayload(
            "{\"id\":\"1\",\"type\":\"POST_TYPE_INFO\",\"title\":\"Wrong identity\"}",
            payloadGameId,
            payloadBiz,
            payloadLanguage);

        Assert.Throws<InvalidDataException>(() => HoyoLatestContentParser.Parse(
            payload,
            "4ziysqXOQ8",
            "hkrpg_global",
            "en-us"));
    }

    [Fact]
    public void Hoyo_parser_rejects_missing_game_or_language_identity()
    {
        var missingGame = Encoding.UTF8.GetBytes(
            "{\"retcode\":0,\"message\":\"OK\",\"data\":{\"content\":{\"language\":\"en-us\",\"posts\":[]}}}");
        var missingLanguage = Encoding.UTF8.GetBytes(
            "{\"retcode\":0,\"message\":\"OK\",\"data\":{\"content\":{\"game\":{\"id\":\"4ziysqXOQ8\",\"biz\":\"hkrpg_global\"},\"posts\":[]}}}");

        Assert.ThrowsAny<Exception>(() => ParseHsr(missingGame));
        Assert.ThrowsAny<Exception>(() => ParseHsr(missingLanguage));
    }

    public static TheoryData<string> RejectedHoyoPayloads => new()
    {
        "{}",
        "{\"retcode\":1,\"message\":\"x\",\"data\":{\"content\":{\"posts\":[]}}}",
        "{\"retcode\":0,\"message\":\"OK\",\"data\":{\"content\":{\"posts\":[],\"extra\":1}}}",
        "{\"retcode\":0,\"message\":\"OK\",\"data\":{\"content\":{\"posts\":[{\"id\":\"1\",\"id\":\"2\",\"type\":\"news\",\"title\":\"x\"}]}}}",
        "{\"retcode\":0,\"message\":\"OK\",\"data\":{\"content\":{\"posts\":[{\"id\":\"1\",\"type\":\"html\",\"title\":\"x\"}]}}}",
        "{\"retcode\":0,\"message\":\"OK\",\"data\":{\"content\":{\"posts\":[{\"id\":\"1\",\"type\":\"news\",\"title\":\"x\",\"link\":\"http://www.hoyolab.com/a\"}]}}}",
        "{\"retcode\":0,\"message\":\"OK\",\"data\":{\"content\":{\"posts\":[{\"id\":\"1\",\"type\":\"news\",\"title\":\"x\",\"link\":\"https://evil.example/a\"}]}}}",
        "{\"retcode\":0,\"message\":\"OK\",\"data\":{\"content\":{\"posts\":[{\"id\":\"1\",\"type\":\"news\",\"title\":\"x\",\"extra\":true}]}}}",
        "{\"retcode\":0,\"message\":\"OK\",\"data\":{\"content\":{\"posts\":[{\"id\":\"1\",\"type\":\"news\",\"title\":\"x\",\"login_state_in_link\":\"false\"}]}}}",
    };

    [Theory]
    [MemberData(nameof(RejectedHoyoPayloads))]
    public void Hoyo_parser_rejects_schema_drift_duplicates_unsafe_links_and_unknown_types(string json)
    {
        Assert.ThrowsAny<Exception>(() =>
            ParseHsr(Encoding.UTF8.GetBytes(json)));
    }

    [Fact]
    public void Hoyo_parser_rejects_oversized_and_deep_documents()
    {
        Assert.Throws<InvalidDataException>(() => ParseHsr(
            new byte[HoyoLatestContentParser.MaximumBytes + 1]));
        var deep = "{\"retcode\":0,\"message\":\"OK\",\"data\":"
            + new string('[', 10)
            + "0"
            + new string(']', 10)
            + "}";
        Assert.ThrowsAny<Exception>(() =>
            ParseHsr(Encoding.UTF8.GetBytes(deep)));
    }

    [Fact]
    public void Nyx_parser_is_bounded_text_only_and_can_restrict_remote_games()
    {
        var payload = Encoding.UTF8.GetBytes(
            """
            {"schemaVersion":1,"generatedAt":"2026-07-15T00:00:00.0000000+00:00","games":{
              "wuwa":{"source":"Nyx banner snapshot","cards":[{"id":"w","type":"banner","title":"Current","date":"2026-08-01T00:00:00.0000000+00:00"}]},
              "ae":{"source":"Nyx banner snapshot","cards":[]}
            }}
            """);

        var snapshots = NyxLauncherContentParser.Parse(
            payload,
            false,
            DateTimeOffset.Parse("2026-07-15T00:00:00Z"),
            new HashSet<string>(["wuwa", "ae"], StringComparer.Ordinal));

        Assert.Equal(["wuwa", "ae"], snapshots.Keys);
        Assert.False(snapshots["wuwa"].IsFallback);
        Assert.Null(snapshots["wuwa"].Cards[0].ApprovedLink);
    }

    [Fact]
    public void Nyx_parser_rejects_third_party_or_image_fields_and_more_than_three_cards()
    {
        var image = "{\"schemaVersion\":1,\"generatedAt\":\"2026-07-15T00:00:00.0000000+00:00\",\"games\":{\"wuwa\":{\"source\":\"Nyx\",\"cards\":[{\"id\":\"1\",\"type\":\"banner\",\"title\":\"x\",\"image\":\"https://evil.example/a.png\"}]}}}";
        Assert.Throws<InvalidDataException>(() => NyxLauncherContentParser.Parse(
            Encoding.UTF8.GetBytes(image), false, DateTimeOffset.UtcNow));

        var cards = string.Join(',', Enumerable.Range(1, 4)
            .Select(index => $"{{\"id\":\"{index}\",\"type\":\"banner\",\"title\":\"x\"}}"));
        var tooMany = $"{{\"schemaVersion\":1,\"generatedAt\":\"2026-07-15T00:00:00.0000000+00:00\",\"games\":{{\"wuwa\":{{\"source\":\"Nyx\",\"cards\":[{cards}]}}}}}}";
        Assert.Throws<InvalidDataException>(() => NyxLauncherContentParser.Parse(
            Encoding.UTF8.GetBytes(tooMany), false, DateTimeOffset.UtcNow));
    }

    [Theory]
    [InlineData("2026-07-07T23:59:59.999Z")]
    [InlineData("2026-07-15T00:05:00.001Z")]
    public void Nyx_remote_parser_rejects_stale_or_future_generated_at(string generatedAt)
    {
        var payload = Encoding.UTF8.GetBytes(
            $"{{\"schemaVersion\":1,\"generatedAt\":\"{generatedAt}\",\"games\":{{\"wuwa\":{{\"source\":\"Nyx\",\"cards\":[]}}}}}}");

        Assert.Throws<InvalidDataException>(() => NyxLauncherContentParser.Parse(
            payload,
            false,
            DateTimeOffset.Parse("2026-07-15T00:00:00Z")));
    }

    [Theory]
    [InlineData("2026-07-08T00:00:00.000Z")]
    [InlineData("2026-07-15T00:05:00.000Z")]
    public void Nyx_remote_parser_accepts_exact_freshness_boundaries(string generatedAt)
    {
        var payload = Encoding.UTF8.GetBytes(
            $"{{\"schemaVersion\":1,\"generatedAt\":\"{generatedAt}\",\"games\":{{\"wuwa\":{{\"source\":\"Nyx\",\"cards\":[]}}}}}}");

        var result = NyxLauncherContentParser.Parse(
            payload,
            false,
            DateTimeOffset.Parse("2026-07-15T00:00:00Z"));

        Assert.Contains("wuwa", result.Keys);
    }

    private static IReadOnlyList<Nyx.Desktop.Core.Content.LatestContentCard> ParseHsr(byte[] payload) =>
        HoyoLatestContentParser.Parse(payload, "4ziysqXOQ8", "hkrpg_global", "en-us");

    internal static byte[] HoyoPayload(
        string posts,
        string gameId = "4ziysqXOQ8",
        string biz = "hkrpg_global",
        string language = "en-us") => Encoding.UTF8.GetBytes(
        $"{{\"retcode\":0,\"message\":\"OK\",\"data\":{{\"content\":{{\"game\":{{\"id\":\"{gameId}\",\"biz\":\"{biz}\"}},\"language\":\"{language}\",\"banners\":[],\"posts\":["
        + posts
        + "],\"social_media_list\":[]}}}");
}
