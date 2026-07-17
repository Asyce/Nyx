using System.Security.Cryptography;
using System.Text;
using Nyx.Desktop.Core.Content;
using Nyx.Desktop.Core.State;
using Nyx.Desktop.Infrastructure.Content;
using Nyx.Desktop.Infrastructure.State;

namespace Nyx.Desktop.Tests.Content;

public sealed class LauncherBannersContentTests
{
    [Fact]
    public void Production_https_endpoint_uses_its_implicit_default_port()
    {
        LauncherBannersTransport.ValidateEndpoint(
            new Uri(LauncherBannersTransport.ProductionEndpoint),
            allowConfigured: true,
            requireJson: true);
    }

    [Theory]
    [InlineData("https://evil.workers.dev/dist/launcher-banners-v1.json")]
    [InlineData("https://evil.hoyoverse.com/dist/launcher-banners-v1.json")]
    [InlineData("https://evil.kurogames.com/dist/launcher-banners-v1.json")]
    [InlineData("https://evil.gryphline.com/dist/launcher-banners-v1.json")]
    public void Transport_rejects_arbitrary_publisher_and_preview_subdomains(string url)
    {
        Assert.Throws<InvalidOperationException>(() => LauncherBannersTransport.ValidateEndpoint(
            new Uri(url), allowConfigured: true, requireJson: true));
    }

    [Fact]
    public void Parser_preserves_an_exact_supported_banner_region()
    {
        var payload = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(ManifestJson(null))
            .Replace("\"region\":\"global\"", "\"region\":\"europe\"", StringComparison.Ordinal));
        var manifest = LauncherBannersManifestParser.Parse(payload, fallback: true, DateTimeOffset.UtcNow);
        Assert.All(manifest.Games.Values, game => Assert.Equal("europe", game.Region));

        var unsupported = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(ManifestJson(null))
            .Replace("\"region\":\"global\"", "\"region\":\"moon\"", StringComparison.Ordinal));
        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(unsupported, fallback: true, DateTimeOffset.UtcNow));
    }

    [Fact]
    public void Parser_requires_all_five_games_and_keeps_unsafe_news_non_clickable()
    {
        var payload = ManifestJson("https://evil.example/news");
        var manifest = LauncherBannersManifestParser.Parse(payload, fallback: true, DateTimeOffset.UtcNow);
        Assert.Equal(5, manifest.Games.Count);
        Assert.Single(manifest.Games["gi"].News);
        Assert.False(manifest.Games["gi"].News[0].IsLinkSafe);
        Assert.Null(manifest.Games["gi"].News[0].ApprovedUrl);
        Assert.Equal("https://evil.example/news", manifest.Games["gi"].News[0].RawUrl);
    }

    [Fact]
    public void Parser_accepts_explicit_default_https_port_for_official_news()
    {
        var manifest = LauncherBannersManifestParser.Parse(ManifestJson("https://genshin.hoyoverse.com:443/news"), fallback: true, DateTimeOffset.UtcNow);
        Assert.True(manifest.Games["gi"].News[0].IsLinkSafe);
        Assert.Equal(443, manifest.Games["gi"].News[0].ApprovedUrl!.Port);
    }

    [Fact]
    public void Parser_rejects_a_different_games_publisher_host()
    {
        var manifest = LauncherBannersManifestParser.Parse(
            ManifestJson("https://sg-hkrpg-api.hoyoverse.com/news"),
            fallback: true,
            DateTimeOffset.UtcNow);

        Assert.False(manifest.Games["gi"].News[0].IsLinkSafe);
        Assert.Null(manifest.Games["gi"].News[0].ApprovedUrl);
    }

    [Theory]
    [InlineData("https://evil.sg-hk4e-api.hoyoverse.com/news")]
    [InlineData("https://pengo.gg/news")]
    public void Parser_requires_an_exact_game_news_host(string url)
    {
        var manifest = LauncherBannersManifestParser.Parse(ManifestJson(url), true, DateTimeOffset.UtcNow);
        Assert.False(manifest.Games["gi"].News[0].IsLinkSafe);
        Assert.Null(manifest.Games["gi"].News[0].ApprovedUrl);
    }

    [Fact]
    public void Parser_keeps_current_only_inside_the_start_inclusive_end_exclusive_window()
    {
        var start = DateTimeOffset.Parse("2026-07-17T00:00:00Z");
        var end = DateTimeOffset.Parse("2026-07-18T00:00:00Z");
        var payload = ManifestWithWindowJson(start, end);

        Assert.NotNull(LauncherBannersManifestParser.Parse(payload, true, start).Games["gi"].Current);
        Assert.NotNull(LauncherBannersManifestParser.Parse(payload, true, end.AddTicks(-1)).Games["gi"].Current);
        Assert.Null(LauncherBannersManifestParser.Parse(payload, true, start.AddTicks(-1)).Games["gi"].Current);
        Assert.Null(LauncherBannersManifestParser.Parse(payload, true, end).Games["gi"].Current);
    }

    [Fact]
    public void Bundled_generated_snapshot_round_trips_through_the_desktop_parser()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Site", "src", "data", "generated", "launcher-banners-v1.json"))) directory = directory.Parent;
        Assert.NotNull(directory);
        var payload = File.ReadAllBytes(Path.Combine(directory!.FullName, "Site", "src", "data", "generated", "launcher-banners-v1.json"));
        var manifest = LauncherBannersManifestParser.Parse(payload, fallback: true, DateTimeOffset.UtcNow);
        Assert.Equal(new[] { "gi", "hsr", "zzz", "wuwa", "ae" }, manifest.Games.Keys);
    }

    [Fact]
    public async Task Every_available_selected_current_character_has_resolvable_bundled_art()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Site", "src", "data", "generated", "launcher-banners-v1.json"))) directory = directory.Parent;
        Assert.NotNull(directory);
        var generated = Path.Combine(directory!.FullName, "Site", "src", "data", "generated");
        var cache = Path.Combine(Path.GetTempPath(), "nyx-launcher-cache-" + Guid.NewGuid().ToString("N"));
        try
        {
            await using var service = new LauncherBannersContentService(
                File.ReadAllBytes(Path.Combine(generated, "launcher-banners-v1.json")),
                cache,
                bundledAssetsDirectory: Path.Combine(generated, "launcher-art"));
            var currentGames = service.Current.Games.Where(pair => pair.Value.Current is not null).ToArray();
            Assert.NotEmpty(currentGames);
            foreach (var pair in currentGames)
            {
                var game = pair.Value;
                if (game.Current is not LauncherBannersCurrentPhase current) continue;
                var selected = Assert.Single(current.Characters, character => character.Id == current.SelectedCharacterId);
                var usableArt = selected.Variants.Count > 0 ? selected.Variants : current.Variants;
                Assert.NotEmpty(usableArt);
                Assert.All(usableArt, asset =>
                {
                    Assert.True(Math.Max(asset.Dimensions.Width, asset.Dimensions.Height) >= 800, $"{pair.Key} selected a thumbnail instead of launcher artwork.");
                    Assert.True(asset.Placement.X > 0.5, $"{pair.Key} artwork must stay on the right side of the launcher copy.");
                    Assert.NotNull(service.TryResolveManagedAsset(asset));
                });
            }
        }
        finally { if (Directory.Exists(cache)) Directory.Delete(cache, true); }
    }

    [Fact]
    public void Parser_rejects_bad_asset_path_hash_dimensions_and_mime()
    {
        var bytes = ManifestJson(null);
        var text = Encoding.UTF8.GetString(bytes);
        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(Encoding.UTF8.GetBytes(text.Replace("\"ae\":", "\"missing\":", StringComparison.Ordinal)), true, DateTimeOffset.UtcNow));
        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(Encoding.UTF8.GetBytes(text.Replace("\"games\":", "\"extra\":1,\"games\":", StringComparison.Ordinal)), true, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task Cache_promotes_validated_remote_art_with_hash_and_preserves_user_art()
    {
        var root = Path.Combine(Path.GetTempPath(), "nyx-launcher-cache-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var art = WebpFixture(1);
            var hash = Convert.ToHexString(SHA256.HashData(art)).ToLowerInvariant();
            var manifest = ManifestModel(new LauncherBannersAsset("asset", "test", "/assets/test.webp", new Uri("https://pengo.gg/assets/test.webp"), "image/webp", art.Length, new(1, 1), hash, new(0, 0, 1, 1), new("center", "contain", .5, .5)));
            var cache = new LauncherBannersCache(root);
            var transport = new FakeTransport(art);
            var payload = ManifestJson(null);
            await cache.PromoteAsync(manifest, payload, transport);
            Assert.True(File.Exists(Path.Combine(cache.ManagedAssetsDirectory, hash + ".webp")));
            Assert.NotNull(cache.TryLoadLastKnownGood(DateTimeOffset.UtcNow));
            Directory.CreateDirectory(cache.UserArtDirectory);
            var user = Path.Combine(cache.UserArtDirectory, "keep.webp");
            await File.WriteAllTextAsync(user, "user");
            cache.PruneManagedCache(1);
            Assert.True(File.Exists(user));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Cache_rejects_corrupt_asset_bytes_before_promotion()
    {
        var root = Path.Combine(Path.GetTempPath(), "nyx-launcher-cache-" + Guid.NewGuid().ToString("N"));
        try
        {
            var expected = WebpFixture(1);
            var bad = WebpFixture(2);
            var hash = Convert.ToHexString(SHA256.HashData(expected)).ToLowerInvariant();
            var manifest = ManifestModel(new LauncherBannersAsset("asset", "test", "/assets/test.webp", new Uri("https://pengo.gg/assets/test.webp"), "image/webp", expected.Length, new(1, 1), hash, new(0, 0, 1, 1), new("center", "contain", .5, .5)));
            var cache = new LauncherBannersCache(root);
            await Assert.ThrowsAsync<InvalidDataException>(() => cache.PromoteAsync(manifest, ManifestJson(null), new FakeTransport(bad)));
            Assert.False(File.Exists(cache.LastKnownGoodManifestPath));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public void Cache_prune_is_deterministic_and_removes_interrupted_temp_files_only_from_managed_area()
    {
        var root = Path.Combine(Path.GetTempPath(), "nyx-launcher-cache-" + Guid.NewGuid().ToString("N"));
        var cache = new LauncherBannersCache(root);
        Directory.CreateDirectory(cache.ManagedAssetsDirectory);
        Directory.CreateDirectory(cache.UserArtDirectory);
        File.WriteAllBytes(Path.Combine(cache.ManagedDirectory, ".interrupted.tmp"), new byte[40]);
        File.WriteAllBytes(Path.Combine(cache.ManagedAssetsDirectory, "a.webp"), new byte[80]);
        File.WriteAllBytes(Path.Combine(cache.ManagedAssetsDirectory, "b.webp"), new byte[80]);
        var user = Path.Combine(cache.UserArtDirectory, "owned.webp");
        File.WriteAllBytes(user, new byte[120]);
        var removed = cache.PruneManagedCache(80);
        Assert.True(removed >= 1);
        Assert.False(File.Exists(Path.Combine(cache.ManagedDirectory, ".interrupted.tmp")));
        Assert.True(File.Exists(user));
        Directory.Delete(root, true);
    }

    [Fact]
    public void Pinned_user_art_survives_manifest_pruning_and_rejects_tampering()
    {
        var root = Path.Combine(Path.GetTempPath(), "nyx-launcher-cache-" + Guid.NewGuid().ToString("N"));
        var source = Path.Combine(root, "source.webp");
        Directory.CreateDirectory(root);
        try
        {
            var bytes = WebpFixture(7);
            File.WriteAllBytes(source, bytes);
            var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            var asset = new LauncherBannersAsset("asset", "test", "/launcher-art/test.webp", null, "image/webp", bytes.Length, new(1, 1), hash, new(0, 0, 1, 1), new("center", "contain", .7, .5));
            var cache = new LauncherBannersCache(root);

            var relative = cache.PinUserArt("gi", asset, source);
            var pinned = Assert.IsType<string>(cache.TryResolveUserArt(relative));
            cache.PruneManagedCache(1, activeManifest: null);
            Assert.Equal(pinned, cache.TryResolveUserArt(relative));

            File.WriteAllBytes(pinned, WebpFixture(8));
            Assert.Null(cache.TryResolveUserArt(relative));
            Assert.Equal(relative, cache.PinUserArt("gi", asset, source));
            Assert.NotNull(cache.TryResolveUserArt(relative));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public void Pinned_user_art_remains_resolvable_when_state_recovers_its_backup()
    {
        var root = Path.Combine(Path.GetTempPath(), "nyx-pinned-backup-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var cache = new LauncherBannersCache(Path.Combine(root, "cache"));
            var stateStore = new LauncherStateStore(Path.Combine(root, "state"));
            var firstBytes = WebpFixture(11);
            var secondBytes = WebpFixture(12);
            var firstSource = Path.Combine(root, "first.webp");
            var secondSource = Path.Combine(root, "second.webp");
            File.WriteAllBytes(firstSource, firstBytes);
            File.WriteAllBytes(secondSource, secondBytes);
            var first = AssetFor("first", firstBytes);
            var second = AssetFor("second", secondBytes);
            var firstPin = cache.PinUserArt("gi", first, firstSource);
            var secondPin = cache.PinUserArt("gi", second, secondSource);

            stateStore.Save(StateWithPin(first.Id, firstPin));
            stateStore.Save(StateWithPin(second.Id, secondPin));
            File.WriteAllText(stateStore.StatePath, "{bad");

            var recovered = stateStore.Load();
            Assert.Equal(LauncherStateReadStatus.Recovered, recovered.Status);
            Assert.Equal(firstPin, recovered.State!.Appearance["gi"].PinnedArtFile);
            Assert.NotNull(cache.TryResolveUserArt(firstPin));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }

        static LauncherBannersAsset AssetFor(string id, byte[] bytes)
        {
            var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            return new(id, "test", $"/launcher-art/{id}.webp", null, "image/webp", bytes.Length,
                new(1, 1), hash, new(0, 0, 1, 1), new("center", "contain", .7, .5));
        }

        static LauncherState StateWithPin(string variant, string pin) => LauncherState.Defaults() with
        {
            Appearance = new Dictionary<string, GameAppearanceState>(StringComparer.Ordinal)
            {
                ["gi"] = new() { ArtPinned = true, ArtVariant = variant, PinnedArtFile = pin },
            },
        };
    }

    [Fact]
    public void Bundled_asset_is_resolved_and_validated_before_managed_cache()
    {
        var root = Path.Combine(Path.GetTempPath(), "nyx-launcher-cache-" + Guid.NewGuid().ToString("N"));
        var bundled = Path.Combine(root, "launcher-art");
        Directory.CreateDirectory(bundled);
        try
        {
            var bytes = WebpFixture(3);
            var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            var asset = new LauncherBannersAsset("asset", "test", $"/launcher-art/{hash}.webp", null, "image/webp", bytes.Length, new(1, 1), hash, new(0, 0, 1, 1), new("center", "contain", .5, .5));
            var file = Path.Combine(bundled, hash + ".webp");
            File.WriteAllBytes(file, bytes);
            var cache = new LauncherBannersCache(root);
            Assert.Equal(Path.GetFullPath(file), cache.TryResolveBundledAsset(asset, bundled));
            File.WriteAllBytes(file, WebpFixture(4));
            Assert.Null(cache.TryResolveBundledAsset(asset, bundled));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Service_keeps_bundled_snapshot_when_transport_is_offline()
    {
        var root = Path.Combine(Path.GetTempPath(), "nyx-launcher-cache-" + Guid.NewGuid().ToString("N"));
        try
        {
            var bundled = LauncherBannersManifestParser.Parse(ManifestJson(null), true, DateTimeOffset.UtcNow);
            await using var service = new LauncherBannersContentService(
                ManifestJson(null),
                root,
                new Uri("http://127.0.0.1:32123/launcher-banners-v1.json"),
                new FakeTransport(new HttpRequestException("offline")),
                () => DateTimeOffset.Parse("2026-07-17T00:00:00Z"),
                TimeSpan.FromMinutes(15));
            await service.RefreshAsync();
            Assert.Equal(bundled.Revision, service.Current.Revision);
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public void Service_refreshes_shortly_after_the_next_current_banner_expires()
    {
        var now = DateTimeOffset.Parse("2026-07-17T00:00:00Z");
        var manifest = ManifestModel(new LauncherBannersAsset(
            "asset", "test", "/assets/test.webp", null, "image/webp", 30,
            new(1, 1), new string('a', 64), new(0, 0, 1, 1), new("center", "contain", .5, .5)));

        Assert.Equal(
            TimeSpan.FromHours(24) + TimeSpan.FromSeconds(30),
            LauncherBannersContentService.CalculateNextRefreshDelay(manifest, now, TimeSpan.FromDays(2)));
        Assert.Equal(
            TimeSpan.FromHours(6),
            LauncherBannersContentService.CalculateNextRefreshDelay(manifest, now, TimeSpan.FromHours(6)));
    }

    private static LauncherBannersManifest ManifestModel(LauncherBannersAsset asset)
    {
        var games = new Dictionary<string, LauncherBannersGame>(StringComparer.Ordinal);
        foreach (var game in new[] { "gi", "hsr", "zzz", "wuwa", "ae" })
        {
            var current = game == "gi" ? new LauncherBannersCurrentPhase("1.0", DateTimeOffset.Parse("2026-07-16T00:00:00Z"), DateTimeOffset.Parse("2026-07-18T00:00:00Z"), 1, [new LauncherBannersCharacter("a", "Alpha", 5, true, null, [asset])], "a", "highest-rarity", [asset]) : null;
            games[game] = new LauncherBannersGame(game, "global", current, []);
        }
        var health = new LauncherBannersHealth("ok", games.ToDictionary(pair => pair.Key, _ => new LauncherBannersGameHealth("ok", null, 0), StringComparer.Ordinal));
        return new LauncherBannersManifest(1, new string('a', 64), DateTimeOffset.Parse("2026-07-17T00:00:00Z"), health, games);
    }

    private static byte[] ManifestJson(string? url)
    {
        var newsUrl = url is null ? "null" : $"\"{url}\"";
        var games = string.Join(',', new[] { "gi", "hsr", "zzz", "wuwa", "ae" }.Select(game => $"\"{game}\":{{\"game\":\"{game}\",\"region\":\"global\",\"current\":null,\"news\":[{{\"id\":\"{game}-news\",\"title\":\"Official\",\"type\":\"event\",\"start\":null,\"end\":null,\"url\":{newsUrl}}}]}}"));
        var health = string.Join(',', new[] { "gi", "hsr", "zzz", "wuwa", "ae" }.Select(game => $"\"{game}\":{{\"status\":\"ok\",\"reason\":null,\"newsCount\":1}}"));
        return Encoding.UTF8.GetBytes($"{{\"schemaVersion\":1,\"revision\":\"{new string('a', 64)}\",\"generatedAt\":\"2026-07-17T00:00:00.000Z\",\"health\":{{\"status\":\"ok\",\"games\":{{{health}}}}},\"games\":{{{games}}}}}");
    }

    private static byte[] ManifestWithWindowJson(DateTimeOffset start, DateTimeOffset end)
    {
        var current = $"{{\"phase\":\"1.0\",\"start\":\"{start:O}\",\"end\":\"{end:O}\",\"remaining\":{{\"startsAt\":\"{start:O}\",\"endsAt\":\"{end:O}\",\"durationSeconds\":0}},\"characters\":[],\"selectedCharacter\":null,\"selectedCharacterId\":null,\"selectionReason\":\"no-characters\",\"variants\":[]}}";
        var payload = Encoding.UTF8.GetString(ManifestJson(null)).Replace("\"current\":null", $"\"current\":{current}", StringComparison.Ordinal);
        return Encoding.UTF8.GetBytes(payload);
    }

    private static byte[] WebpFixture(byte marker)
    {
        var bytes = new byte[30];
        Encoding.ASCII.GetBytes("RIFF").CopyTo(bytes, 0);
        Encoding.ASCII.GetBytes("WEBP").CopyTo(bytes, 8);
        Encoding.ASCII.GetBytes("VP8X").CopyTo(bytes, 12);
        bytes[16] = 10;
        bytes[20] = marker;
        return bytes;
    }

    private sealed class FakeTransport : ILauncherBannersTransport
    {
        private readonly byte[]? bytes;
        private readonly Exception? exception;
        public FakeTransport(byte[] bytes) => this.bytes = bytes;
        public FakeTransport(Exception exception) => this.exception = exception;
        public Task<byte[]> GetManifestAsync(Uri endpoint, int maximumBytes, CancellationToken cancellationToken) => throw exception ?? new InvalidOperationException();
        public Task<byte[]> GetAssetAsync(Uri endpoint, int maximumBytes, CancellationToken cancellationToken) => Task.FromResult(bytes ?? throw exception!);
    }
}
