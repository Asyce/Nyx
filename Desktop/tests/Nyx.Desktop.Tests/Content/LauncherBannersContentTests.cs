using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
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
    public void Parser_accepts_at_most_five_safe_dated_redemption_codes()
    {
        var text = Encoding.UTF8.GetString(ManifestJson(null))
            .Replace("\"news\":", "\"codes\":[{\"code\":\"NYX_2026\",\"added\":\"2026-07-17\"}],\"news\":", StringComparison.Ordinal);
        var manifest = LauncherBannersManifestParser.Parse(Encoding.UTF8.GetBytes(text), fallback: true, DateTimeOffset.UtcNow);

        var code = Assert.Single(manifest.Games["gi"].Codes);
        Assert.Equal("NYX_2026", code.Code);
        Assert.Equal(new DateOnly(2026, 7, 17), code.Added);

        var unsafeCode = text.Replace("NYX_2026", "NYX CODE", StringComparison.Ordinal);
        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(Encoding.UTF8.GetBytes(unsafeCode), true, DateTimeOffset.UtcNow));
    }

    [Fact]
    public void Dedicated_code_feed_requires_all_five_games_and_exact_safe_rows()
    {
        var games = string.Join(',', new[] { "gi", "hsr", "zzz", "wuwa", "ae" }
            .Select(game => $"\"{game}\":[{{\"code\":\"{game.ToUpperInvariant()}2026\",\"added\":\"2026-07-17\",\"amount\":60,\"currency\":\"Premium\"}}]"));
        var payload = Encoding.UTF8.GetBytes($"{{\"schemaVersion\":1,\"revision\":\"{new string('b', 64)}\",\"generatedAt\":\"2026-07-17T00:00:00.000Z\",\"games\":{{{games}}}}}");
        var manifest = LauncherBannersManifestParser.ParseCodes(payload, fallback: true, DateTimeOffset.Parse("2026-07-17T01:00:00Z"));

        Assert.Equal(5, manifest.Games.Count);
        var code = Assert.Single(manifest.Games["gi"]);
        Assert.Equal("GI2026", code.Code);
        Assert.Equal(60, code.CurrencyAmount);
        Assert.Equal("Premium", code.CurrencyName);

        var missing = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(payload).Replace("\"ae\":[{\"code\":\"AE2026\",\"added\":\"2026-07-17\",\"amount\":60,\"currency\":\"Premium\"}]", "", StringComparison.Ordinal));
        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.ParseCodes(missing, true, DateTimeOffset.Parse("2026-07-17T01:00:00Z")));

        var incomplete = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(payload).Replace("\"currency\":\"Premium\"", "\"currency\":\"\"", StringComparison.Ordinal));
        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.ParseCodes(incomplete, true, DateTimeOffset.Parse("2026-07-17T01:00:00Z")));
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

    [Theory]
    [InlineData("degraded")]
    [InlineData("unavailable")]
    public void Remote_parser_rejects_an_unhealthy_manifest(string status)
    {
        var text = ReplaceFirst(
            Encoding.UTF8.GetString(ManifestJson(null)),
            "\"status\":\"ok\"",
            $"\"status\":\"{status}\"");

        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(
            Encoding.UTF8.GetBytes(text),
            fallback: false,
            DateTimeOffset.Parse("2026-07-17T00:01:00Z")));
    }

    [Theory]
    [InlineData("unknown", "ok")]
    [InlineData("ok", "unknown")]
    public void Parser_rejects_health_values_outside_the_contract(string overall, string game)
    {
        var text = ReplaceFirst(
            Encoding.UTF8.GetString(ManifestJson(null)),
            "\"status\":\"ok\"",
            $"\"status\":\"{overall}\"");
        if (game != "ok") text = ReplaceFirst(text, "\"status\":\"ok\"", $"\"status\":\"{game}\"");

        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(
            Encoding.UTF8.GetBytes(text),
            fallback: true,
            DateTimeOffset.Parse("2026-07-17T00:01:00Z")));
    }

    [Fact]
    public void Parser_requires_the_same_five_canonical_games_in_health_and_content()
    {
        var missingContent = JsonNode.Parse(Encoding.UTF8.GetString(ManifestJson(null)))!.AsObject();
        missingContent["games"]!.AsObject().Remove("ae");
        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(
            JsonSerializer.SerializeToUtf8Bytes(missingContent),
            true,
            DateTimeOffset.Parse("2026-07-17T00:01:00Z")));

        var missingHealth = JsonNode.Parse(Encoding.UTF8.GetString(ManifestJson(null)))!.AsObject();
        missingHealth["health"]!["games"]!.AsObject().Remove("ae");
        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(
            JsonSerializer.SerializeToUtf8Bytes(missingHealth),
            true,
            DateTimeOffset.Parse("2026-07-17T00:01:00Z")));
    }

    [Fact]
    public void Parser_rejects_health_news_counts_that_disagree_with_content()
    {
        var root = JsonNode.Parse(Encoding.UTF8.GetString(ManifestJson(null)))!.AsObject();
        root["health"]!["games"]!["gi"]!["newsCount"] = 2;
        var payload = JsonSerializer.SerializeToUtf8Bytes(root);

        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(
            payload,
            fallback: true,
            DateTimeOffset.Parse("2026-07-17T00:01:00Z")));
    }

    [Fact]
    public void Unhealthy_game_phases_are_rejected_remotely_and_hidden_in_fallbacks()
    {
        var generatedAt = DateTimeOffset.Parse("2026-07-17T00:00:00Z");
        var root = JsonNode.Parse(Encoding.UTF8.GetString(ManifestWithGiPhasesJson(
            generatedAt,
            generatedAt.AddHours(-1),
            generatedAt.AddHours(1),
            [(generatedAt.AddHours(1), generatedAt.AddHours(2))])))!.AsObject();
        root["health"]!["games"]!["gi"]!["status"] = "degraded";
        var payload = JsonSerializer.SerializeToUtf8Bytes(root);

        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(payload, false, generatedAt));
        var fallback = LauncherBannersManifestParser.Parse(payload, true, generatedAt);
        Assert.Null(fallback.Games["gi"].Current);
        Assert.Empty(fallback.Games["gi"].Upcoming);
    }

    [Fact]
    public void Remote_parser_rejects_expired_or_future_current_phases_while_fallback_hides_them()
    {
        var generatedAt = DateTimeOffset.Parse("2026-07-17T00:00:00Z");
        var start = generatedAt.AddHours(-1);
        var end = generatedAt.AddHours(1);
        var payload = ManifestWithGiPhasesJson(generatedAt, start, end);

        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(payload, false, end));
        Assert.Null(LauncherBannersManifestParser.Parse(payload, true, end).Games["gi"].Current);
        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(payload, false, start.AddTicks(-1)));
        Assert.Null(LauncherBannersManifestParser.Parse(payload, true, start.AddTicks(-1)).Games["gi"].Current);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(1)]
    public void Parser_rejects_a_forged_current_countdown(int adjustment)
    {
        var generatedAt = DateTimeOffset.Parse("2026-07-17T00:00:00Z");
        var payload = ManifestWithGiPhasesJson(
            generatedAt,
            generatedAt.AddHours(-1),
            generatedAt.AddHours(1),
            countdownAdjustment: adjustment);

        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(payload, true, generatedAt));
    }

    [Fact]
    public void Parser_rejects_non_positive_current_and_upcoming_windows()
    {
        var generatedAt = DateTimeOffset.Parse("2026-07-17T00:00:00Z");

        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(
            ManifestWithGiPhasesJson(generatedAt, generatedAt, generatedAt),
            true,
            generatedAt));
        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(
            ManifestWithGiPhasesJson(generatedAt, null, null, [(generatedAt.AddHours(1), generatedAt.AddHours(1))]),
            true,
            generatedAt));
    }

    [Fact]
    public void Parser_rejects_overlapping_current_and_upcoming_windows()
    {
        var generatedAt = DateTimeOffset.Parse("2026-07-17T00:00:00Z");
        var payload = ManifestWithGiPhasesJson(
            generatedAt,
            generatedAt.AddHours(-1),
            generatedAt.AddHours(1),
            [(generatedAt.AddMinutes(30), generatedAt.AddHours(2))]);

        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(payload, true, generatedAt));
    }

    [Fact]
    public void Parser_rejects_duplicate_or_overlapping_upcoming_windows()
    {
        var generatedAt = DateTimeOffset.Parse("2026-07-17T00:00:00Z");
        var first = (generatedAt.AddHours(2), generatedAt.AddHours(3));

        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(
            ManifestWithGiPhasesJson(generatedAt, null, null, [first, first]),
            true,
            generatedAt));
        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(
            ManifestWithGiPhasesJson(generatedAt, null, null, [first, (generatedAt.AddMinutes(150), generatedAt.AddHours(4))]),
            true,
            generatedAt));
    }

    [Fact]
    public void Remote_parser_rejects_an_upcoming_phase_that_has_already_started()
    {
        var generatedAt = DateTimeOffset.Parse("2026-07-17T00:00:00Z");
        var observedAt = generatedAt.AddHours(1);
        var payload = ManifestWithGiPhasesJson(
            generatedAt,
            null,
            null,
            [(generatedAt.AddMinutes(30), generatedAt.AddHours(2))]);

        Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(payload, false, observedAt));
        Assert.Empty(LauncherBannersManifestParser.Parse(payload, true, observedAt).Games["gi"].Upcoming);
    }

    [Fact]
    public void Bundled_generated_snapshot_round_trips_through_the_desktop_parser()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Site", "src", "data", "generated", "launcher-banners-v1.json"))) directory = directory.Parent;
        Assert.NotNull(directory);
        var payload = File.ReadAllBytes(Path.Combine(directory!.FullName, "Site", "src", "data", "generated", "launcher-banners-v1.json"));
        using var document = JsonDocument.Parse(payload);
        var generatedAt = document.RootElement.GetProperty("generatedAt").GetDateTimeOffset();
        var remote = LauncherBannersManifestParser.Parse(payload, fallback: false, generatedAt);
        var fallback = LauncherBannersManifestParser.Parse(payload, fallback: true, DateTimeOffset.UtcNow);
        Assert.Equal(remote.Revision, fallback.Revision);
        Assert.Equal(new[] { "gi", "hsr", "zzz", "wuwa", "ae" }, remote.Games.Keys);
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
    public async Task Every_current_banner_character_has_a_resolvable_head_icon_separate_from_splash_art()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Site", "src", "data", "generated", "launcher-banners-v1.json"))) directory = directory.Parent;
        Assert.NotNull(directory);
        var generated = Path.Combine(directory!.FullName, "Site", "src", "data", "generated");
        var cache = Path.Combine(Path.GetTempPath(), "nyx-launcher-icon-cache-" + Guid.NewGuid().ToString("N"));
        try
        {
            await using var service = new LauncherBannersContentService(
                File.ReadAllBytes(Path.Combine(generated, "launcher-banners-v1.json")),
                cache,
                bundledAssetsDirectory: Path.Combine(generated, "launcher-art"));
            var characters = service.Current.Games.Values
                .SelectMany(game => game.Current?.Characters ?? [])
                .ToArray();
            Assert.NotEmpty(characters);
            Assert.All(characters, character =>
            {
                var icon = Assert.IsType<LauncherBannersAsset>(character.Icon);
                Assert.Equal("character-icon", icon.Source);
                Assert.DoesNotContain(character.Variants, variant => variant.Sha256 == icon.Sha256);
                Assert.NotNull(service.TryResolveManagedAsset(icon));
            });
        }
        finally { if (Directory.Exists(cache)) Directory.Delete(cache, true); }
    }

    [Fact]
    public void Parser_rejects_bad_asset_path_hash_dimensions_and_mime()
    {
        var generatedAt = DateTimeOffset.Parse("2026-07-17T00:00:00Z");

        AssertRejected(asset => asset["path"] = "/launcher-art/../escape.webp");
        AssertRejected(asset => asset["sha256"] = new string('g', 64));
        AssertRejected(asset => asset["dimensions"]!["width"] = 0);
        AssertRejected(asset => asset["mime"] = "image/gif");

        void AssertRejected(Action<JsonObject> mutate)
        {
            var root = JsonNode.Parse(Encoding.UTF8.GetString(ManifestWithAssetJson(generatedAt)))!.AsObject();
            var asset = root["games"]!["gi"]!["current"]!["variants"]!.AsArray()[0]!.AsObject();
            mutate(asset);
            Assert.Throws<InvalidDataException>(() => LauncherBannersManifestParser.Parse(
                JsonSerializer.SerializeToUtf8Bytes(root),
                fallback: true,
                generatedAt));
        }
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
    public async Task Failed_multi_asset_promotion_removes_all_staged_downloads()
    {
        var root = Path.Combine(Path.GetTempPath(), "nyx-launcher-cache-" + Guid.NewGuid().ToString("N"));
        try
        {
            var firstBytes = WebpFixture(21);
            var secondBytes = WebpFixture(22);
            var first = RemoteAsset("first", firstBytes);
            var second = RemoteAsset("second", secondBytes);
            var cache = new LauncherBannersCache(root);
            var transport = new QueueAssetTransport(firstBytes, WebpFixture(23));

            await Assert.ThrowsAsync<InvalidDataException>(() =>
                cache.PromoteAsync(ManifestModel(first, second), ManifestJson(null), transport));

            Assert.False(File.Exists(cache.LastKnownGoodManifestPath));
            Assert.Empty(Directory.EnumerateFiles(cache.ManagedAssetsDirectory, "*", SearchOption.AllDirectories));
            Assert.DoesNotContain(
                Directory.EnumerateDirectories(cache.ManagedDirectory, "*", SearchOption.TopDirectoryOnly),
                directory => directory.EndsWith(".staging", StringComparison.Ordinal));
            Assert.Equal(2, transport.AssetRequests);
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Promotion_rejects_an_asset_set_above_the_cache_cap_before_downloading()
    {
        var root = Path.Combine(Path.GetTempPath(), "nyx-launcher-cache-" + Guid.NewGuid().ToString("N"));
        try
        {
            var assets = Enumerable.Range(1, 19)
                .Select(index => new LauncherBannersAsset(
                    $"asset-{index}",
                    "test",
                    $"/assets/{index}.webp",
                    new Uri($"https://pengo.gg/assets/{index}.webp"),
                    "image/webp",
                    LauncherBannersTransport.MaximumAssetBytes,
                    new(1, 1),
                    index.ToString("x64"),
                    new(0, 0, 1, 1),
                    new("center", "contain", .5, .5)))
                .ToArray();
            var cache = new LauncherBannersCache(root);
            var transport = new QueueAssetTransport();

            await Assert.ThrowsAsync<InvalidDataException>(() =>
                cache.PromoteAsync(ManifestModel(assets), ManifestJson(null), transport));

            Assert.Equal(0, transport.AssetRequests);
            Assert.True(Directory.EnumerateFiles(cache.ManagedDirectory, "*", SearchOption.AllDirectories)
                .Sum(path => new FileInfo(path).Length) <= LauncherBannersCache.MaximumManagedBytes);
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
        var staging = Path.Combine(cache.ManagedDirectory, ".interrupted.staging");
        Directory.CreateDirectory(staging);
        File.WriteAllBytes(Path.Combine(staging, "partial.webp"), new byte[40]);
        File.WriteAllBytes(Path.Combine(cache.ManagedAssetsDirectory, "a.webp"), new byte[80]);
        File.WriteAllBytes(Path.Combine(cache.ManagedAssetsDirectory, "b.webp"), new byte[80]);
        var user = Path.Combine(cache.UserArtDirectory, "owned.webp");
        File.WriteAllBytes(user, new byte[120]);
        var removed = cache.PruneManagedCache(80);
        Assert.True(removed >= 1);
        Assert.False(File.Exists(Path.Combine(cache.ManagedDirectory, ".interrupted.tmp")));
        Assert.False(Directory.Exists(staging));
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
    public async Task Service_keeps_last_known_good_when_remote_health_is_degraded()
    {
        var root = Path.Combine(Path.GetTempPath(), "nyx-launcher-cache-" + Guid.NewGuid().ToString("N"));
        try
        {
            var bundled = ManifestJson(null);
            var remote = Encoding.UTF8.GetBytes(ReplaceFirst(
                Encoding.UTF8.GetString(bundled)
                    .Replace(new string('a', 64), new string('b', 64), StringComparison.Ordinal),
                "\"status\":\"ok\"",
                "\"status\":\"degraded\""));
            await using var service = new LauncherBannersContentService(
                bundled,
                root,
                new Uri("http://127.0.0.1:32123/launcher-banners-v1.json"),
                new FakeTransport(remote),
                () => DateTimeOffset.Parse("2026-07-17T00:01:00Z"),
                TimeSpan.FromMinutes(15));

            await service.RefreshAsync();

            Assert.Equal(new string('a', 64), service.Current.Revision);
            Assert.False(File.Exists(Path.Combine(root, "last-known-good", "launcher-banners-v1.json")));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Service_persists_newer_codes_rejects_replay_and_restores_them_without_changing_banner_identity()
    {
        var root = Path.Combine(Path.GetTempPath(), "nyx-launcher-cache-" + Guid.NewGuid().ToString("N"));
        var now = DateTimeOffset.Parse("2026-07-17T01:00:00Z");
        var bannerPayload = ManifestJson(null);
        var newerCodes = CodesJson(now.AddMinutes(-10), "NEWCODE", 'c');
        var olderCodes = CodesJson(now.AddMinutes(-20), "OLDCODE", 'b');
        var bannerEndpoint = new Uri("http://127.0.0.1:32123/launcher-banners-v1.json");
        var codesEndpoint = new Uri("http://127.0.0.1:32123/launcher-codes-v1.json");
        try
        {
            await using (var service = new LauncherBannersContentService(
                bannerPayload,
                root,
                bannerEndpoint,
                new RoutedManifestTransport(bannerPayload, newerCodes, newerCodes, olderCodes),
                () => now,
                TimeSpan.FromMinutes(15),
                codesEndpoint: codesEndpoint))
            {
                var bannerRevision = service.Current.Revision;
                var bannerGeneratedAt = service.Current.GeneratedAt;

                await service.RefreshAsync();
                Assert.Equal("NEWCODE", Assert.Single(service.Current.Games["gi"].Codes).Code);
                Assert.Equal(bannerRevision, service.Current.Revision);
                Assert.Equal(bannerGeneratedAt, service.Current.GeneratedAt);
                var cache = new LauncherBannersCache(root);
                Assert.Equal(newerCodes, File.ReadAllBytes(cache.LastKnownGoodCodesPath));

                await service.RefreshAsync();
                Assert.Equal("NEWCODE", Assert.Single(service.Current.Games["gi"].Codes).Code);
                Assert.Equal(newerCodes, File.ReadAllBytes(cache.LastKnownGoodCodesPath));
                Assert.Equal(bannerRevision, service.Current.Revision);
                Assert.Equal(bannerGeneratedAt, service.Current.GeneratedAt);

                await service.RefreshAsync();
                Assert.Equal("NEWCODE", Assert.Single(service.Current.Games["gi"].Codes).Code);
                Assert.Equal(newerCodes, File.ReadAllBytes(cache.LastKnownGoodCodesPath));
                Assert.Equal(bannerRevision, service.Current.Revision);
                Assert.Equal(bannerGeneratedAt, service.Current.GeneratedAt);
            }

            await using var restarted = new LauncherBannersContentService(
                bannerPayload,
                root,
                bannerEndpoint,
                new FakeTransport(new HttpRequestException("offline")),
                () => now,
                TimeSpan.FromMinutes(15),
                codesEndpoint: codesEndpoint);
            Assert.Equal("NEWCODE", Assert.Single(restarted.Current.Games["gi"].Codes).Code);
            Assert.Equal(new string('a', 64), restarted.Current.Revision);
            Assert.Equal(DateTimeOffset.Parse("2026-07-17T00:00:00Z"), restarted.Current.GeneratedAt);
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Service_never_returns_a_current_phase_after_it_expires()
    {
        var root = Path.Combine(Path.GetTempPath(), "nyx-launcher-cache-" + Guid.NewGuid().ToString("N"));
        var generatedAt = DateTimeOffset.Parse("2026-07-17T00:00:00Z");
        var start = generatedAt.AddHours(-1);
        var end = generatedAt.AddHours(1);
        var now = generatedAt;
        try
        {
            await using var service = new LauncherBannersContentService(
                ManifestWithGiPhasesJson(generatedAt, start, end),
                root,
                clock: () => now);

            Assert.NotNull(service.Current.Games["gi"].Current);
            now = end;
            Assert.Null(service.Current.Games["gi"].Current);
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

    private static LauncherBannersManifest ManifestModel(params LauncherBannersAsset[] assets)
    {
        var games = new Dictionary<string, LauncherBannersGame>(StringComparer.Ordinal);
        foreach (var game in new[] { "gi", "hsr", "zzz", "wuwa", "ae" })
        {
            var current = game == "gi" ? new LauncherBannersCurrentPhase("1.0", DateTimeOffset.Parse("2026-07-16T00:00:00Z"), DateTimeOffset.Parse("2026-07-18T00:00:00Z"), 1, [new LauncherBannersCharacter("a", "Alpha", 5, true, null, assets)], "a", "highest-rarity", assets) : null;
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

    private static byte[] CodesJson(DateTimeOffset generatedAt, string code, char revision)
    {
        var games = string.Join(',', new[] { "gi", "hsr", "zzz", "wuwa", "ae" }
            .Select(game => $"\"{game}\":[{{\"code\":\"{code}\",\"added\":\"2026-07-17\",\"amount\":60,\"currency\":\"Premium\"}}]"));
        return Encoding.UTF8.GetBytes($"{{\"schemaVersion\":1,\"revision\":\"{new string(revision, 64)}\",\"generatedAt\":\"{generatedAt:O}\",\"games\":{{{games}}}}}");
    }

    private static byte[] ManifestWithAssetJson(DateTimeOffset generatedAt)
    {
        var root = JsonNode.Parse(Encoding.UTF8.GetString(ManifestWithGiPhasesJson(
            generatedAt,
            generatedAt.AddHours(-1),
            generatedAt.AddHours(1))))!.AsObject();
        var bytes = WebpFixture(31);
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        root["games"]!["gi"]!["current"]!["variants"] = new JsonArray(new JsonObject
        {
            ["id"] = "asset",
            ["source"] = "test",
            ["path"] = $"/launcher-art/{hash}.webp",
            ["url"] = $"https://pengo.gg/dist/launcher-art/{hash}.webp",
            ["mime"] = "image/webp",
            ["size"] = bytes.Length,
            ["dimensions"] = new JsonObject { ["width"] = 1, ["height"] = 1 },
            ["sha256"] = hash,
            ["transparentBounds"] = new JsonObject { ["left"] = 0, ["top"] = 0, ["right"] = 1, ["bottom"] = 1 },
            ["placement"] = new JsonObject { ["anchor"] = "center", ["fit"] = "contain", ["x"] = .5, ["y"] = .5 },
        });
        return JsonSerializer.SerializeToUtf8Bytes(root);
    }

    private static byte[] ManifestWithWindowJson(DateTimeOffset start, DateTimeOffset end)
    {
        return ManifestWithGiPhasesJson(start, start, end);
    }

    private static byte[] ManifestWithGiPhasesJson(
        DateTimeOffset generatedAt,
        DateTimeOffset? currentStart,
        DateTimeOffset? currentEnd,
        IReadOnlyList<(DateTimeOffset Start, DateTimeOffset End)>? upcoming = null,
        int countdownAdjustment = 0)
    {
        var root = JsonNode.Parse(Encoding.UTF8.GetString(ManifestJson(null)))!.AsObject();
        root["generatedAt"] = generatedAt.ToString("O");
        var game = root["games"]!["gi"]!.AsObject();
        if (currentStart.HasValue != currentEnd.HasValue) throw new ArgumentException("Current phase bounds must be paired.");
        if (currentStart is { } start && currentEnd is { } end)
        {
            var duration = Math.Max(0, (long)Math.Floor((end - generatedAt).TotalSeconds)) + countdownAdjustment;
            game["current"] = new JsonObject
            {
                ["phase"] = "1.0",
                ["start"] = start.ToString("O"),
                ["end"] = end.ToString("O"),
                ["remaining"] = new JsonObject
                {
                    ["startsAt"] = start.ToString("O"),
                    ["endsAt"] = end.ToString("O"),
                    ["durationSeconds"] = duration,
                },
                ["characters"] = new JsonArray(),
                ["selectedCharacter"] = null,
                ["selectedCharacterId"] = null,
                ["selectionReason"] = "no-characters",
                ["variants"] = new JsonArray(),
            };
        }
        game["upcoming"] = new JsonArray((upcoming ?? [])
            .Select(window => (JsonNode)new JsonObject
            {
                ["phase"] = "next",
                ["start"] = window.Start.ToString("O"),
                ["end"] = window.End.ToString("O"),
                ["characters"] = new JsonArray(),
            })
            .ToArray());
        return JsonSerializer.SerializeToUtf8Bytes(root);
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

    private static LauncherBannersAsset RemoteAsset(string id, byte[] bytes)
    {
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        return new LauncherBannersAsset(
            id,
            "test",
            $"/assets/{id}.webp",
            new Uri($"https://pengo.gg/assets/{id}.webp"),
            "image/webp",
            bytes.Length,
            new(1, 1),
            hash,
            new(0, 0, 1, 1),
            new("center", "contain", .5, .5));
    }

    private static string ReplaceFirst(string value, string oldValue, string newValue)
    {
        var index = value.IndexOf(oldValue, StringComparison.Ordinal);
        return index < 0 ? value : string.Concat(value.AsSpan(0, index), newValue, value.AsSpan(index + oldValue.Length));
    }

    private sealed class FakeTransport : ILauncherBannersTransport
    {
        private readonly byte[]? bytes;
        private readonly Exception? exception;
        public FakeTransport(byte[] bytes) => this.bytes = bytes;
        public FakeTransport(Exception exception) => this.exception = exception;
        public Task<byte[]> GetManifestAsync(Uri endpoint, int maximumBytes, CancellationToken cancellationToken) => exception is null ? Task.FromResult(bytes ?? throw new InvalidOperationException()) : Task.FromException<byte[]>(exception);
        public Task<byte[]> GetAssetAsync(Uri endpoint, int maximumBytes, CancellationToken cancellationToken) => Task.FromResult(bytes ?? throw exception!);
    }

    private sealed class RoutedManifestTransport(byte[] banner, params byte[][] codes) : ILauncherBannersTransport
    {
        private readonly Queue<byte[]> codePayloads = new(codes);

        public Task<byte[]> GetManifestAsync(Uri endpoint, int maximumBytes, CancellationToken cancellationToken)
        {
            if (endpoint.AbsolutePath.Contains("launcher-codes", StringComparison.Ordinal))
                return Task.FromResult(codePayloads.Dequeue());
            return Task.FromResult(banner);
        }

        public Task<byte[]> GetAssetAsync(Uri endpoint, int maximumBytes, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("No remote art was expected.");
    }

    private sealed class QueueAssetTransport(params byte[][] assets) : ILauncherBannersTransport
    {
        private readonly Queue<byte[]> payloads = new(assets);
        public int AssetRequests { get; private set; }

        public Task<byte[]> GetManifestAsync(Uri endpoint, int maximumBytes, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("No manifest request was expected.");

        public Task<byte[]> GetAssetAsync(Uri endpoint, int maximumBytes, CancellationToken cancellationToken)
        {
            AssetRequests++;
            return Task.FromResult(payloads.Dequeue());
        }
    }
}
