using System.Net;
using System.Text;
using System.Text.Json;
using Nyx.Desktop.Core.Exports;
using Nyx.Desktop.Infrastructure.Exports;

namespace Nyx.Desktop.Tests.Exports;

public sealed class HoyoPullExportProviderTests
{
    [Fact]
    public void DefaultSafetyLimits_AreFiniteForDiskNetworkTimeAndMemory()
    {
        var limits = new PullExportSafetyLimits();

        Assert.Equal(64L * 1024 * 1024, limits.MaximumCacheBytes);
        Assert.Equal(4 * 1024 * 1024, limits.MaximumLogBytes);
        Assert.Equal(64, limits.MaximumCandidateUrls);
        Assert.Equal(16 * 1024, limits.MaximumQueryBytes);
        Assert.Equal(2 * 1024 * 1024, limits.MaximumResponseBytes);
        Assert.Equal(500, limits.MaximumPagesPerType);
        Assert.Equal(60_000, limits.MaximumRecords);
        Assert.Equal(64L * 1024 * 1024, limits.MaximumOutputBytes);
        Assert.Equal(TimeSpan.FromMinutes(4), limits.EffectiveTotalDuration);
        Assert.Equal(TimeSpan.FromSeconds(15), limits.EffectiveRequestTimeout);
    }

    [Fact]
    public void CacheLocator_UsesLogInstallAndNewestVersionWithData2Priority()
    {
        using var temp = new TemporaryDirectory();
        var profile = temp.Combine("profile");
        var install = temp.Combine("install");
        var log = Path.Combine(profile, "AppData", "LocalLow", "miHoYo", "Genshin Impact", "output_log.txt");
        Directory.CreateDirectory(Path.GetDirectoryName(log)!);
        File.WriteAllText(log, $"prefix ignored {install}\\GenshinImpact_Data\\Managed");
        var oldData = MakeCache(install, "1.2.0", "data_2", "old");
        MakeCache(install, "2.0.0", "data_1", "fallback");
        var newestData = MakeCache(install, "2.0.0", "data_2", "newest");

        var locator = new HoyoPullCacheLocator(profile, new PullExportSafetyLimits());

        Assert.Equal(newestData, locator.Locate(HoyoPullGameConfiguration.For("gi"), default));
        Assert.NotEqual(oldData, newestData);
    }

    [Fact]
    public void LinkReader_AcceptsOnlyExactOfficialEndpointAndReturnsNewestValidLink()
    {
        var game = HoyoPullGameConfiguration.For("gi");
        var text = string.Join('\0',
            Link(game, "OLDER_TEST_TOKEN"),
            "https://attacker.invalid/gacha_info/api/getGachaLog?auth_appid=webview_gacha&authkey=EVIL_TEST_TOKEN",
            "https://public-operation-hk4e-sg.hoyoverse.com.evil.invalid/gacha_info/api/getGachaLog?auth_appid=webview_gacha&authkey=EVIL2_TEST_TOKEN",
            Link(game, "NEWEST_TEST_TOKEN"));

        var found = HoyoPullHistoryLinkReader.ExtractNewest(text, game, 64, 16 * 1024);

        Assert.Equal(2, found.Count);
        Assert.Contains(found[0].Pairs, pair => pair.Key == "authkey" && pair.Value == "NEWEST_TEST_TOKEN");
        Assert.DoesNotContain(found.SelectMany(value => value.Pairs), pair => pair.Value.Contains("EVIL", StringComparison.Ordinal));
    }

    [Fact]
    public void LinkReader_KeepsOnlyBoundedNewestCandidatesAndRejectsOversizedQuery()
    {
        var game = HoyoPullGameConfiguration.For("gi");
        var text = string.Join('\0',
            Link(game, "TOKEN_ONE"),
            Link(game, "TOKEN_TWO"),
            Link(game, "TOKEN_THREE"),
            Link(game, new string('X', 600)));

        var found = HoyoPullHistoryLinkReader.ExtractNewest(text, game, 2, 512);

        Assert.Equal(2, found.Count);
        Assert.Contains(found[0].Pairs, pair => pair.Value == "TOKEN_THREE");
        Assert.Contains(found[1].Pairs, pair => pair.Value == "TOKEN_TWO");
    }

    [Fact]
    public void LinkReader_ReadsSharedFileInMemoryWithoutCreatingPrivateTemporaryCopy()
    {
        using var temp = new TemporaryDirectory();
        var source = temp.Combine("data_2");
        File.WriteAllText(source, Link(HoyoPullGameConfiguration.For("gi"), "SHARED_TEST_TOKEN"));
        using var held = new FileStream(source, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete);
        var before = Directory.GetFiles(Path.GetTempPath(), "nyx-pulls-*.cache").ToHashSet(StringComparer.OrdinalIgnoreCase);
        var reader = new HoyoPullHistoryLinkReader(new PullExportSafetyLimits(MaximumCacheBytes: 1024));

        var found = reader.ReadNewest(source, HoyoPullGameConfiguration.For("gi"), default);

        Assert.Single(found);
        Assert.DoesNotContain(Directory.GetFiles(Path.GetTempPath(), "nyx-pulls-*.cache"), path => !before.Contains(path));
    }

    [Fact]
    public void LinkReader_FailureAndCancellationNeverMaterializeAuthKeyCacheInTemp()
    {
        using var temp = new TemporaryDirectory();
        var source = temp.Combine("data_2");
        File.WriteAllText(source, Link(HoyoPullGameConfiguration.For("gi"), "PRIVATE_CRASH_TEST_TOKEN"));
        var before = Directory.GetFiles(Path.GetTempPath(), "nyx-pulls-*.cache").ToHashSet(StringComparer.OrdinalIgnoreCase);
        var reader = new HoyoPullHistoryLinkReader(new PullExportSafetyLimits(MaximumCacheBytes: 32));
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();

        Assert.Throws<PullExportException>(() => reader.ReadNewest(source, HoyoPullGameConfiguration.For("gi"), default));
        Assert.Throws<OperationCanceledException>(() => reader.ReadNewest(source, HoyoPullGameConfiguration.For("gi"), cancelled.Token));
        Assert.DoesNotContain(Directory.GetFiles(Path.GetTempPath(), "nyx-pulls-*.cache"), path => !before.Contains(path));
    }

    [Fact]
    public void LinkReader_SourceHasNoDiskCopyPrimitive()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "AGENTS.md"))) root = root.Parent;
        Assert.NotNull(root);
        var source = File.ReadAllText(Path.Combine(root!.FullName,
            "Desktop", "src", "Nyx.Desktop.Infrastructure", "Exports", "HoyoPullHistoryLinkReader.cs"));

        Assert.DoesNotContain("Path.GetTempPath", source, StringComparison.Ordinal);
        Assert.DoesNotContain("FileMode.Create", source, StringComparison.Ordinal);
        Assert.DoesNotContain("File.Copy", source, StringComparison.Ordinal);
    }

    [Fact]
    public void LinkReader_RejectsOversizedCacheWithoutLeakingPath()
    {
        using var temp = new TemporaryDirectory();
        var source = temp.Combine("private-cache-name");
        File.WriteAllBytes(source, new byte[33]);
        var reader = new HoyoPullHistoryLinkReader(new PullExportSafetyLimits(MaximumCacheBytes: 32));

        var error = Assert.Throws<PullExportException>(() =>
            reader.ReadNewest(source, HoyoPullGameConfiguration.For("gi"), default));

        Assert.Equal(PullExportErrorCodes.CacheTooLarge, error.ErrorCode);
        Assert.DoesNotContain("private-cache-name", error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Api_RebuildsAllowlistedQueryAndPaginatesAllGiTypesAtTwentyPerPage()
    {
        var requests = new List<Uri>();
        var handler = new DelegateHandler(request =>
        {
            var uri = request.RequestUri!;
            requests.Add(uri);
            var query = ParseQuery(uri);
            var type = query["gacha_type"];
            var endId = query["end_id"];
            if (type != "301") return JsonResponse(Page([]));
            if (endId == "0")
                return JsonResponse(Page(Enumerable.Range(81, 20).Reverse().Select(id => Record(type, id.ToString())).ToArray()));
            if (endId == "81") return JsonResponse(Page([Record(type, "80")]));
            return JsonResponse(Page([]));
        });
        using var http = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
        var pacing = new RecordingPacer();
        var api = new HoyoPullApiClient(http, new PullExportSafetyLimits(), pacing);
        var auth = new HoyoAuthQuery([
            new("auth_appid", "webview_gacha"), new("authkey", "SANITIZED_TEST_TOKEN"),
            new("lang", "en-us"), new("region", "os_usa")]);

        var archive = await api.DownloadNewestValidAsync(HoyoPullGameConfiguration.For("gi"), [auth], default);

        Assert.Equal(21, archive.Records.Count);
        Assert.Equal(7, requests.Count);
        Assert.Equal(requests.Count, pacing.Calls);
        Assert.Equal(TimeSpan.FromMilliseconds(250), PullRequestPacer.RequestSpacing);
        Assert.All(requests, uri =>
        {
            Assert.True(HoyoPullApiClient.IsOfficialEndpoint(uri, HoyoPullGameConfiguration.For("gi").Endpoint));
            var query = ParseQuery(uri);
            Assert.Equal("20", query["size"]);
            Assert.Equal("SANITIZED_TEST_TOKEN", query["authkey"]);
            Assert.DoesNotContain("page", query.Keys);
            Assert.DoesNotContain("real_gacha_type", query.Keys);
            Assert.DoesNotContain("evil", query.Keys);
        });
        Assert.Equal(new[] { "301", "301", "400", "302", "500", "200", "100" },
            requests.Select(uri => ParseQuery(uri)["gacha_type"]));
        Assert.Equal("81", ParseQuery(requests[1])["end_id"]);
    }

    [Fact]
    public async Task Provider_DropsCallSpecificAndUnknownCacheParameters()
    {
        using var temp = new TemporaryDirectory();
        var profile = temp.Combine("profile");
        var downloads = temp.Combine("downloads");
        var game = HoyoPullGameConfiguration.For("gi");
        var cache = MakeProfileCache(profile, game, Link(game, "QUERY_TEST_TOKEN") +
            "&gacha_type=999&real_gacha_type=999&size=5&end_id=BAD&page=9&evil=DROP_ME");
        Assert.True(File.Exists(cache));
        var requests = new List<Uri>();
        using var http = new HttpClient(new DelegateHandler(request =>
        {
            requests.Add(request.RequestUri!);
            return JsonResponse(Page([]));
        }))
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
        using var provider = new HoyoPullExportProvider(http, profile, downloads, new NoWaitPullRequestPacer());

        await provider.SnapshotAsync("gi", new ImmediateExportSignalWaiter(), default);

        Assert.NotEmpty(requests);
        Assert.All(requests, request =>
        {
            var query = ParseQuery(request);
            Assert.Equal("20", query["size"]);
            Assert.Equal("0", query["end_id"]);
            Assert.DoesNotContain("page", query.Keys);
            Assert.DoesNotContain("real_gacha_type", query.Keys);
            Assert.DoesNotContain("evil", query.Keys);
        });
    }

    [Fact]
    public async Task ProductionPacer_RequestsExactlyTwoHundredFiftyMillisecondsBetweenCalls()
    {
        TimeSpan? requestedDelay = null;
        var pacer = new PullRequestPacer((duration, _) =>
        {
            requestedDelay = duration;
            return ValueTask.CompletedTask;
        });

        await pacer.BeforeRequestAsync(default);
        await pacer.BeforeRequestAsync(default);

        Assert.Equal(TimeSpan.FromMilliseconds(250), requestedDelay);
    }

    [Theory]
    [InlineData("gi", "hk4e", "301")]
    [InlineData("hsr", "hkrpg", "11")]
    public async Task Provider_WritesExactUigf42AccountAndRecordShape(string gameId, string accountKey, string firstType)
    {
        using var temp = new TemporaryDirectory();
        var profile = temp.Combine("profile");
        var game = HoyoPullGameConfiguration.For(gameId);
        MakeProfileCache(profile, game, Link(game, "UIGF_TEST_TOKEN"));
        using var http = new HttpClient(new DelegateHandler(request =>
        {
            var type = ParseQuery(request.RequestUri!)["gacha_type"];
            return JsonResponse(Page(type == firstType ? [Record(type, "123456789", gameId == "hsr" ? "pool-1" : "")] : []));
        }))
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
        using var provider = new HoyoPullExportProvider(http, profile, temp.Combine("downloads"), new NoWaitPullRequestPacer());

        var metadata = await provider.SnapshotAsync(gameId, new ImmediateExportSignalWaiter(), default);

        Assert.Equal(1, metadata.ItemCount);
        Assert.Equal("UIGF v4.2 JSON", metadata.Format);
        Assert.NotNull(metadata.OutputPath);
        using var document = JsonDocument.Parse(File.ReadAllBytes(metadata.OutputPath));
        var root = document.RootElement;
        Assert.Equal("v4.2", root.GetProperty("info").GetProperty("version").GetString());
        Assert.False(root.TryGetProperty(gameId == "gi" ? "hkrpg" : "hk4e", out _));
        var account = root.GetProperty(accountKey)[0];
        Assert.Equal("600000001", account.GetProperty("uid").GetString());
        Assert.Equal(8, account.GetProperty("timezone").GetInt32());
        Assert.Equal("en-us", account.GetProperty("lang").GetString());
        var record = Assert.Single(account.GetProperty("list").EnumerateArray());
        Assert.Equal(firstType, record.GetProperty("gacha_type").GetString());
        Assert.Equal("1001", record.GetProperty("item_id").GetString());
        Assert.Equal("2026-07-17 12:34:56", record.GetProperty("time").GetString());
        Assert.Equal("123456789", record.GetProperty("id").GetString());
        if (gameId == "gi") Assert.Equal("301", record.GetProperty("uigf_gacha_type").GetString());
        else Assert.Equal("pool-1", record.GetProperty("gacha_id").GetString());
    }

    [Fact]
    public async Task Writer_FlushesThenAtomicallyChoosesNewNameWithoutOverwrite()
    {
        using var temp = new TemporaryDirectory();
        var requested = temp.Combine("pulls.json");
        File.WriteAllText(requested, "keep me");
        var archive = Archive("gi");
        var writer = new UigfPullExportWriter(temp.Path, new PullExportSafetyLimits(), TimeProvider.System);

        var result = await writer.WriteAsync(archive, requested, default);

        Assert.Equal("keep me", File.ReadAllText(requested));
        Assert.Equal(temp.Combine("pulls (1).json"), result.Path);
        Assert.True(new FileInfo(result.Path).Length > 0);
        Assert.Empty(Directory.GetFiles(temp.Path, "*.tmp"));
    }

    [Fact]
    public async Task Writer_CancellationLeavesNoFinalOrTemporaryFile()
    {
        using var temp = new TemporaryDirectory();
        var output = temp.Combine("canceled.json");
        var writer = new UigfPullExportWriter(temp.Path, new PullExportSafetyLimits(), TimeProvider.System);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
            await writer.WriteAsync(Archive("gi"), output, cancellation.Token));

        Assert.False(File.Exists(output));
        Assert.Empty(Directory.GetFiles(temp.Path, "*.tmp"));
    }

    [Fact]
    public async Task Writer_DefaultsUnderDownloadsPengoExportsAndGameFolder()
    {
        using var temp = new TemporaryDirectory();
        var writer = new UigfPullExportWriter(temp.Path, new PullExportSafetyLimits(), TimeProvider.System);

        var output = await writer.WriteAsync(Archive("hsr"), null, default);

        Assert.StartsWith(temp.Combine(Path.Combine("Pengo Exports", "Honkai Star Rail")), output.Path, StringComparison.OrdinalIgnoreCase);
        Assert.True(File.Exists(output.Path));
    }

    [Fact]
    public async Task Writer_rejects_a_reparse_point_beneath_the_fixed_downloads_root()
    {
        using var temp = new TemporaryDirectory();
        var downloads = temp.Combine("downloads");
        var outside = temp.Combine("outside");
        Directory.CreateDirectory(downloads);
        Directory.CreateDirectory(outside);
        Directory.CreateSymbolicLink(Path.Combine(downloads, "Pengo Exports"), outside);
        var writer = new UigfPullExportWriter(downloads, new PullExportSafetyLimits(), TimeProvider.System);

        var error = await Assert.ThrowsAsync<PullExportException>(async () =>
            await writer.WriteAsync(Archive("gi"), null, default));

        Assert.Equal(PullExportErrorCodes.OutputFailed, error.ErrorCode);
        Assert.Empty(Directory.GetFiles(outside, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Provider_PreCanceledRequestMakesNoNetworkCallOrOutput()
    {
        using var temp = new TemporaryDirectory();
        var profile = temp.Combine("profile");
        var game = HoyoPullGameConfiguration.For("gi");
        MakeProfileCache(profile, game, Link(game, "CANCEL_TEST_TOKEN"));
        var calls = 0;
        using var http = new HttpClient(new DelegateHandler(_ => { calls++; return JsonResponse(Page([])); }));
        using var provider = new HoyoPullExportProvider(http, profile, temp.Combine("downloads"), new NoWaitPullRequestPacer());
        var downloads = temp.Combine("downloads");
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
            await provider.SnapshotAsync("gi", new ImmediateExportSignalWaiter(), cancellation.Token));

        Assert.Equal(0, calls);
        Assert.False(Directory.Exists(Path.Combine(downloads, "Pengo Exports")));
    }

    [Fact]
    public async Task Api_StopsAtPageBoundAndReturnsOnlySanitizedFailure()
    {
        var game = HoyoPullGameConfiguration.For("gi");
        const string fixtureToken = "BOUND_TEST_TOKEN";
        using var http = new HttpClient(new DelegateHandler(_ =>
            JsonResponse(Page(Enumerable.Range(1, 20).Select(id => Record("301", id.ToString())).ToArray()))));
        var api = new HoyoPullApiClient(http,
            new PullExportSafetyLimits(MaximumPagesPerType: 1), new NoWaitPullRequestPacer());
        var auth = new HoyoAuthQuery([new("auth_appid", "webview_gacha"), new("authkey", fixtureToken)]);

        var error = await Assert.ThrowsAsync<PullExportException>(async () =>
            await api.DownloadNewestValidAsync(game, [auth], default));

        Assert.Equal(PullExportErrorCodes.SafetyLimit, error.ErrorCode);
        Assert.DoesNotContain(fixtureToken, error.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain(game.Endpoint.Host, error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Api_DoesNotFollowRedirectOrLeakTransportExceptionDetails()
    {
        var game = HoyoPullGameConfiguration.For("hsr");
        const string fixtureToken = "PRIVATE_TEST_TOKEN";
        var calls = 0;
        using var redirectHttp = new HttpClient(new DelegateHandler(_ =>
        {
            calls++;
            var response = new HttpResponseMessage(HttpStatusCode.Redirect);
            response.Headers.Location = new Uri("https://attacker.invalid/steal");
            return response;
        }));
        var auth = new HoyoAuthQuery([new("auth_appid", "webview_gacha"), new("authkey", fixtureToken)]);
        var redirectApi = new HoyoPullApiClient(redirectHttp, new PullExportSafetyLimits(), new NoWaitPullRequestPacer());

        var redirectError = await Assert.ThrowsAsync<PullExportException>(async () =>
            await redirectApi.DownloadNewestValidAsync(game, [auth], default));

        Assert.Equal(1, calls);
        Assert.Equal(PullExportErrorCodes.UpstreamInvalid, redirectError.ErrorCode);

        using var throwingHttp = new HttpClient(new DelegateHandler(_ =>
            throw new HttpRequestException(fixtureToken + " https://private.invalid/raw")));
        var throwingApi = new HoyoPullApiClient(throwingHttp, new PullExportSafetyLimits(), new NoWaitPullRequestPacer());
        var transportError = await Assert.ThrowsAsync<PullExportException>(async () =>
            await throwingApi.DownloadNewestValidAsync(game, [auth], default));
        Assert.DoesNotContain(fixtureToken, transportError.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain("private.invalid", transportError.ToString(), StringComparison.Ordinal);
    }

    private static HoyoPullArchive Archive(string gameId)
    {
        var game = HoyoPullGameConfiguration.For(gameId);
        return new HoyoPullArchive(game, "600000001", 8, "en-us",
            [new HoyoPullRecord(gameId == "hsr" ? "pool" : "", game.GachaTypes[0], "1001", "1",
                "2026-07-17 12:34:56", "Test Item", "en-us", "Character", "5", "123")]);
    }

    private static string MakeProfileCache(string profile, HoyoPullGameConfiguration game, string content)
    {
        var root = Path.Combine(profile, game.LocalLowRelativePath);
        return MakeCache(root, "1.0.0", "data_2", content);
    }

    private static string MakeCache(string root, string version, string name, string content)
    {
        var path = Path.Combine(root, "webCaches", version, "Cache", "Cache_Data", name);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content, Encoding.ASCII);
        return path;
    }

    private static string Link(HoyoPullGameConfiguration game, string token) =>
        game.Endpoint.AbsoluteUri + "?auth_appid=webview_gacha&authkey=" + token + "&authkey_ver=1&lang=en-us&region=os_usa";

    private static object Page(object[] records) => new
    {
        retcode = 0,
        message = "OK",
        data = new { region_time_zone = 8, list = records },
    };

    private static object Record(string gachaType, string id, string gachaId = "") => new
    {
        uid = "600000001",
        gacha_id = gachaId,
        gacha_type = gachaType,
        item_id = "1001",
        count = "1",
        time = "2026-07-17 12:34:56",
        name = "Test Item",
        lang = "en-us",
        item_type = "Character",
        rank_type = "5",
        id,
    };

    private static HttpResponseMessage JsonResponse(object value) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json"),
    };

    private static Dictionary<string, string> ParseQuery(Uri uri) => uri.Query.TrimStart('?')
        .Split('&', StringSplitOptions.RemoveEmptyEntries)
        .Select(segment => segment.Split('=', 2))
        .ToDictionary(pair => Uri.UnescapeDataString(pair[0]), pair => Uri.UnescapeDataString(pair[1]), StringComparer.Ordinal);

    private sealed class DelegateHandler(Func<HttpRequestMessage, HttpResponseMessage> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(send(request));
    }

    private sealed class RecordingPacer : IPullRequestPacer
    {
        public int Calls { get; private set; }
        public ValueTask BeforeRequestAsync(CancellationToken cancellationToken) { Calls++; return ValueTask.CompletedTask; }
    }

    private sealed class TemporaryDirectory : IDisposable
    {
        public TemporaryDirectory()
        {
            Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "nyx-pull-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path);
        }
        public string Path { get; }
        public string Combine(string value) => System.IO.Path.Combine(Path, value);
        public void Dispose()
        {
            try { Directory.Delete(Path, recursive: true); }
            catch (Exception) { }
        }
    }
}
