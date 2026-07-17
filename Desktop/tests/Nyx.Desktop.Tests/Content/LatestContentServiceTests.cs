using System.Text;
using Nyx.Desktop.Infrastructure.Content;

namespace Nyx.Desktop.Tests.Content;

public sealed class LatestContentServiceTests
{
    [Fact]
    public void Bundled_fallback_covers_five_games_and_never_exceeds_three_cards()
    {
        var service = CreateService(new FakeTransport());

        Assert.Equal(["gi", "hsr", "zzz", "wuwa", "ae"], service.Current.Keys);
        Assert.All(service.Current.Values, snapshot =>
        {
            Assert.True(snapshot.IsFallback);
            Assert.InRange(snapshot.Cards.Count, 0, 3);
        });
    }

    [Fact]
    public async Task Refresh_uses_only_four_fixed_endpoints_and_keeps_sources_independent()
    {
        var transport = SuccessfulTransport();
        await using var service = CreateService(transport);

        await service.RefreshAsync();

        Assert.Equal(4, transport.Calls.Count);
        Assert.All(transport.Calls, uri => Assert.Equal("https", uri.Scheme));
        Assert.Equal("Official HoYoPlay", service.Current["gi"].SourceLabel);
        Assert.Equal("Nyx banner snapshot", service.Current["wuwa"].SourceLabel);
        Assert.DoesNotContain("Session", typeof(LatestContentService).AssemblyQualifiedName!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Cross_game_hoyo_response_falls_back_only_for_the_mismatched_game()
    {
        var transport = SuccessfulTransport();
        transport.Hoyo["gopR6Cufr3"] = LatestContentParserTests.HoyoPayload(
            "{\"id\":\"wrong\",\"type\":\"news\",\"title\":\"Wrong game\"}",
            "4ziysqXOQ8",
            "hkrpg_global");
        await using var service = CreateService(transport);

        await service.RefreshAsync();

        Assert.True(service.Current["gi"].IsFallback);
        Assert.False(service.Current["hsr"].IsFallback);
        Assert.False(service.Current["zzz"].IsFallback);
    }

    [Fact]
    public async Task Concurrent_refreshes_coalesce_without_overlapping_requests()
    {
        var transport = SuccessfulTransport();
        transport.Block = new(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var service = CreateService(transport);

        var first = service.RefreshAsync();
        var second = service.RefreshAsync();
        await Task.Delay(30);
        Assert.Equal(1, transport.Active);
        transport.Block.SetResult();
        await Task.WhenAll(first, second);

        Assert.Equal(4, transport.Calls.Count);
        Assert.Equal(1, transport.MaximumActive);
    }

    [Fact]
    public async Task Failed_refresh_after_success_returns_to_honest_bundled_fallback()
    {
        var transport = SuccessfulTransport();
        await using var service = CreateService(transport);
        await service.RefreshAsync();
        Assert.False(service.Current["gi"].IsFallback);
        transport.Fail = true;

        await service.RefreshAsync();

        Assert.True(service.Current["gi"].IsFallback);
        Assert.True(service.Current["wuwa"].IsFallback);
    }

    [Theory]
    [InlineData("2026-07-07T23:59:59.999Z")]
    [InlineData("2026-07-15T00:05:00.001Z")]
    public async Task Stale_or_future_nyx_remote_snapshot_uses_bundled_fallback(string generatedAt)
    {
        var transport = SuccessfulTransport(generatedAt);
        await using var service = CreateService(transport);

        await service.RefreshAsync();

        Assert.False(service.Current["gi"].IsFallback);
        Assert.True(service.Current["wuwa"].IsFallback);
        Assert.True(service.Current["ae"].IsFallback);
    }

    [Fact]
    public async Task Precancelled_refresh_has_zero_transport_side_effects()
    {
        var transport = SuccessfulTransport();
        await using var service = CreateService(transport);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            service.RefreshAsync(cancellation.Token));

        Assert.Empty(transport.Calls);
    }

    [Fact]
    public async Task Shutdown_cancels_inflight_work_and_rejects_new_refresh()
    {
        var transport = SuccessfulTransport();
        transport.WaitForCancellation = true;
        var service = CreateService(transport);
        var refresh = service.RefreshAsync();
        await Task.Delay(30);

        await service.DisposeAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => refresh);
        await Assert.ThrowsAsync<ObjectDisposedException>(() => service.RefreshAsync());
    }

    [Fact]
    public void Service_has_conservative_interval_and_no_process_or_file_mutation_capability()
    {
        var source = ReadInfrastructureFile("LatestContentService.cs")
            + ReadInfrastructureFile("LatestContentTransport.cs");

        Assert.Contains("TimeSpan.FromHours(6)", source, StringComparison.Ordinal);
        Assert.Contains("PeriodicTimer", source, StringComparison.Ordinal);
        Assert.DoesNotContain("Process", source, StringComparison.Ordinal);
        Assert.DoesNotContain("File.Write", source, StringComparison.Ordinal);
        Assert.DoesNotContain("Registry", source, StringComparison.Ordinal);
        Assert.DoesNotContain("package", source, StringComparison.OrdinalIgnoreCase);
    }

    private static LatestContentService CreateService(FakeTransport transport) => new(
        transport,
        File.ReadAllBytes(Path.Combine(
            FindWorkspaceRoot(),
            "Desktop",
            "src",
            "Nyx.Desktop.App",
            "Assets",
            "Content",
            "launcher-content-bundled-v1.json")),
        () => DateTimeOffset.Parse("2026-07-15T00:00:00Z"),
        TimeSpan.FromMinutes(15));

    private static FakeTransport SuccessfulTransport(
        string generatedAt = "2026-07-15T00:00:00.0000000+00:00")
    {
        var transport = new FakeTransport();
        transport.Hoyo["gopR6Cufr3"] = LatestContentParserTests.HoyoPayload(
            "{\"id\":\"gi-1\",\"type\":\"news\",\"title\":\"Official update\"}",
            "gopR6Cufr3",
            "hk4e_global");
        transport.Hoyo["4ziysqXOQ8"] = LatestContentParserTests.HoyoPayload(
            "{\"id\":\"hsr-1\",\"type\":\"news\",\"title\":\"Official update\"}",
            "4ziysqXOQ8",
            "hkrpg_global");
        transport.Hoyo["U5hbdsT9W7"] = LatestContentParserTests.HoyoPayload(
            "{\"id\":\"zzz-1\",\"type\":\"news\",\"title\":\"Official update\"}",
            "U5hbdsT9W7",
            "nap_global");
        transport.Nyx = Encoding.UTF8.GetBytes(
            "{\"schemaVersion\":1,\"generatedAt\":\""
            + generatedAt
            + "\",\"games\":{"
            + "\"wuwa\":{\"source\":\"Nyx banner snapshot\",\"cards\":[{\"id\":\"w\",\"type\":\"banner\",\"title\":\"Current\"}]},"
            + "\"ae\":{\"source\":\"Nyx banner snapshot\",\"cards\":[{\"id\":\"a\",\"type\":\"banner\",\"title\":\"Current\"}]}"
            + "}}");
        return transport;
    }

    private static string ReadInfrastructureFile(string name) => File.ReadAllText(Path.Combine(
        FindWorkspaceRoot(),
        "Desktop",
        "src",
        "Nyx.Desktop.Infrastructure",
        "Content",
        name));

    private static string FindWorkspaceRoot()
    {
        for (var current = new DirectoryInfo(AppContext.BaseDirectory);
             current is not null;
             current = current.Parent)
        {
            if (Directory.Exists(Path.Combine(current.FullName, "Desktop", "src")))
            {
                return current.FullName;
            }
        }

        throw new DirectoryNotFoundException();
    }

    internal sealed class FakeTransport : ILatestContentTransport
    {
        private int active;

        public List<Uri> Calls { get; } = [];

        public Dictionary<string, byte[]> Hoyo { get; } = new(StringComparer.Ordinal);

        public byte[] Nyx { get; set; } = [];

        public TaskCompletionSource? Block { get; set; }

        public bool Fail { get; set; }

        public bool WaitForCancellation { get; set; }

        public int Active => active;

        public int MaximumActive { get; private set; }

        public async Task<byte[]> GetAsync(Uri uri, int maximumBytes, CancellationToken cancellationToken)
        {
            Calls.Add(uri);
            var count = Interlocked.Increment(ref active);
            MaximumActive = Math.Max(MaximumActive, count);
            try
            {
                if (WaitForCancellation)
                {
                    await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                }

                if (Block is not null)
                {
                    await Block.Task.WaitAsync(cancellationToken);
                }

                if (Fail)
                {
                    throw new HttpRequestException("Sanitized fixture failure.");
                }

                if (uri.Host.Equals("pengo.gg", StringComparison.OrdinalIgnoreCase))
                {
                    return Nyx;
                }

                var gameIdPart = uri.Query
                    .TrimStart('?')
                    .Split('&', StringSplitOptions.RemoveEmptyEntries)
                    .Single(part => part.StartsWith("game_id=", StringComparison.Ordinal));
                var gameId = Uri.UnescapeDataString(gameIdPart["game_id=".Length..]);
                return Hoyo[gameId];
            }
            finally
            {
                Interlocked.Decrement(ref active);
            }
        }
    }
}
