using Nyx.Desktop.Core.AccountStatus;

namespace Nyx.Desktop.Tests.AccountStatus;

public sealed class PublisherAccountCatalogTests
{
    [Fact]
    public void Catalog_CoversExactlyTheFiveCanonicalGames()
    {
        Assert.Equal(["ae", "gi", "hsr", "wuwa", "zzz"],
            PublisherAccountCatalog.All.Select(static entry => entry.GameId).Order(StringComparer.Ordinal));
    }

    [Theory]
    [InlineData("gi", "https://act.hoyolab.com/ys/event/signin-sea-v3/index.html?act_id=e202102251931481")]
    [InlineData("hsr", "https://act.hoyolab.com/bbs/event/signin/hkrpg/e202303301540311.html")]
    [InlineData("zzz", "https://act.hoyolab.com/bbs/event/signin/zzz/e202406031448091.html")]
    [InlineData("ae", "https://game.skport.com/endfield/sign-in")]
    public void ExactCheckInUri_AcceptsOnlyTheCompiledUrl(string gameId, string value)
    {
        Assert.True(PublisherAccountCatalog.IsExactCheckInUri(gameId, new Uri(value)));
        Assert.False(PublisherAccountCatalog.IsExactCheckInUri(gameId, new Uri(value + "#changed")));
        Assert.False(PublisherAccountCatalog.IsExactCheckInUri(gameId, new Uri(value + (value.Contains('?') ? "&extra=1" : "?extra=1"))));
    }

    [Fact]
    public void WuWa_HasNoGuessedDailyCheckInUrl()
    {
        var entry = PublisherAccountCatalog.Get("wuwa");
        Assert.False(entry.SupportsDailyCheckIn);
        Assert.Null(entry.CheckInUri);
    }

    [Fact]
    public void Resource_pages_use_the_reviewed_official_surfaces()
    {
        Assert.Equal(
            "https://act.hoyolab.com/app/community-game-records-sea/rpg/index.html#/hsr",
            PublisherAccountCatalog.Get("hsr").ResourceUri!.AbsoluteUri);
        Assert.Equal(
            "https://act.hoyolab.com/app/mihoyo-zzz-game-record/index.html#/zzz",
            PublisherAccountCatalog.Get("zzz").ResourceUri!.AbsoluteUri);
        Assert.Equal(
            "https://game.skport.com/endfield/game-data?header=0",
            PublisherAccountCatalog.Get("ae").ResourceUri!.AbsoluteUri);
    }

    [Fact]
    public void Endfield_UsesTheExactOfficialProtocolTerminalUrl()
    {
        var entry = PublisherAccountCatalog.Get("ae");

        Assert.Equal("https://game.skport.com/endfield/game-data?header=0", entry.ResourceUri?.AbsoluteUri);
        Assert.True(entry.SupportsDailyCheckIn);
        Assert.False(entry.SupportsNumericResource);
        Assert.Equal("https://game.skport.com/endfield/sign-in", entry.CheckInUri?.AbsoluteUri);
    }

    [Fact]
    public void Exact_page_matching_normalizes_safe_URI_spelling_but_rejects_scope_changes()
    {
        Assert.True(PublisherAccountCatalog.IsExactCheckInUri(
            "gi",
            new Uri("HTTPS://ACT.HOYOLAB.COM:443/ys/event/signin-sea-v3/index.html?act_id=e202102251931481")));
        Assert.True(PublisherAccountCatalog.IsExactResourcePageUri(
            "zzz",
            new Uri("HTTPS://ACT.HOYOLAB.COM:443/app/mihoyo-zzz-game-record/index.html#/zzz")));
        Assert.False(PublisherAccountCatalog.IsExactResourcePageUri(
            "zzz",
            new Uri("https://act.hoyolab.com/app/mihoyo-zzz-game-record/index.html?extra=1#/zzz")));
        Assert.False(PublisherAccountCatalog.IsExactResourcePageUri(
            "ae",
            new Uri("https://game.skport.com/endfield/game-data?header=1")));
    }

    [Theory]
    [InlineData("gi", "https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote?role_id=123456789&server=os_euro")]
    [InlineData("hsr", "https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/note?server=prod_official_eur&role_id=123456789")]
    [InlineData("zzz", "https://sg-act-public-api.hoyolab.com/event/game_record_zzz/api/zzz/note?role_id=123456789&server=prod_gf_eu")]
    public void Resource_response_filter_accepts_only_the_compiled_endpoint_and_bounded_binding_query(
        string gameId,
        string value)
    {
        Assert.True(PublisherAccountCatalog.IsExactResourceResponseUri(gameId, new Uri(value)));
        Assert.False(PublisherAccountCatalog.IsExactResourceResponseUri(gameId, new Uri(value + "&lang=en-us")));
        Assert.False(PublisherAccountCatalog.IsExactResourceResponseUri(gameId, new Uri(value + "#changed")));
        Assert.False(PublisherAccountCatalog.IsExactResourceResponseUri(
            gameId,
            new Uri(value.Replace("https://", "https://evil.example/forward/", StringComparison.Ordinal))));
    }

    [Theory]
    [InlineData("https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote?role_id=abc&server=os_euro")]
    [InlineData("https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote?role_id=123&server=os_unknown")]
    [InlineData("https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote?role_id=123&role_id=456&server=os_euro")]
    [InlineData("https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote?role_id=123&server=os_euro&")]
    public void Resource_response_filter_rejects_ambiguous_or_unreviewed_bindings(string value)
    {
        Assert.False(PublisherAccountCatalog.IsExactResourceResponseUri("gi", new Uri(value)));
    }
}
