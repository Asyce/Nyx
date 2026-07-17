using System.Collections.ObjectModel;
using Nyx.Desktop.Core.Content;

namespace Nyx.Desktop.Infrastructure.Content;

public sealed class LatestContentService : ILatestContentSource, IAsyncDisposable
{
    private static readonly IReadOnlyDictionary<string, HoyoContentEndpoint> HoyoEndpoints =
        new ReadOnlyDictionary<string, HoyoContentEndpoint>(new Dictionary<string, HoyoContentEndpoint>(StringComparer.Ordinal)
        {
            ["gi"] = new(
                new("https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGameContent?game_id=gopR6Cufr3&launcher_id=VYTpXlbWo8&language=en-us"),
                "gopR6Cufr3",
                "hk4e_global"),
            ["hsr"] = new(
                new("https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGameContent?game_id=4ziysqXOQ8&launcher_id=VYTpXlbWo8&language=en-us"),
                "4ziysqXOQ8",
                "hkrpg_global"),
            ["zzz"] = new(
                new("https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGameContent?game_id=U5hbdsT9W7&launcher_id=VYTpXlbWo8&language=en-us"),
                "U5hbdsT9W7",
                "nap_global"),
        });
    private static readonly Uri NyxUri = new("https://pengo.gg/dist/launcher-content-v1.json");
    private static readonly IReadOnlySet<string> NyxGames = new HashSet<string>(["wuwa", "ae"], StringComparer.Ordinal);

    private readonly object sync = new();
    private readonly ILatestContentTransport transport;
    private readonly IReadOnlyDictionary<string, LatestContentSnapshot> bundled;
    private readonly Func<DateTimeOffset> clock;
    private readonly TimeSpan interval;
    private readonly CancellationTokenSource shutdown = new();
    private IReadOnlyDictionary<string, LatestContentSnapshot> current;
    private Task? refresh;
    private Task? pump;
    private bool disposed;

    public LatestContentService(byte[] bundledPayload)
        : this(new FixedLatestContentTransport(), bundledPayload)
    {
    }

    internal LatestContentService(
        ILatestContentTransport transport,
        byte[] bundledPayload,
        Func<DateTimeOffset>? clock = null,
        TimeSpan? interval = null)
    {
        this.transport = transport ?? throw new ArgumentNullException(nameof(transport));
        this.clock = clock ?? (() => DateTimeOffset.UtcNow);
        this.interval = interval ?? TimeSpan.FromHours(6);
        if (this.interval < TimeSpan.FromMinutes(15))
        {
            throw new ArgumentOutOfRangeException(nameof(interval));
        }

        bundled = NyxLauncherContentParser.Parse(bundledPayload, true, this.clock());
        if (bundled.Count != 5)
        {
            throw new InvalidDataException("Bundled content must cover all five games.");
        }

        current = bundled;
    }

    public IReadOnlyDictionary<string, LatestContentSnapshot> Current
    {
        get
        {
            lock (sync)
            {
                return current;
            }
        }
    }

    public event EventHandler? Updated;

    public void Start()
    {
        lock (sync)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            pump ??= PumpAsync();
        }

        _ = RefreshAsync();
    }

    public Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (sync)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            refresh ??= RunRefreshAsync();
            return refresh.WaitAsync(cancellationToken);
        }
    }

    private async Task RunRefreshAsync()
    {
        await Task.Yield();
        try
        {
            await RefreshCoreAsync();
        }
        finally
        {
            lock (sync)
            {
                refresh = null;
            }
        }
    }

    private async Task RefreshCoreAsync()
    {
        var next = new Dictionary<string, LatestContentSnapshot>(bundled, StringComparer.Ordinal);
        var now = clock();
        foreach (var pair in HoyoEndpoints)
        {
            try
            {
                var endpoint = pair.Value;
                var payload = await transport.GetAsync(endpoint.Uri, HoyoLatestContentParser.MaximumBytes, shutdown.Token);
                var cards = HoyoLatestContentParser.Parse(
                    payload,
                    endpoint.GameId,
                    endpoint.Biz,
                    "en-us");
                next[pair.Key] = new(
                    pair.Key,
                    "Official HoYoPlay",
                    $"Updated · {now:yyyy-MM-dd HH:mm} UTC",
                    now,
                    false,
                    cards);
            }
            catch (Exception exception) when (exception is not OperationCanceledException || !shutdown.IsCancellationRequested)
            {
                next[pair.Key] = bundled[pair.Key];
            }
        }

        try
        {
            var payload = await transport.GetAsync(NyxUri, NyxLauncherContentParser.MaximumBytes, shutdown.Token);
            var nyx = NyxLauncherContentParser.Parse(payload, false, now, NyxGames);
            foreach (var gameId in NyxGames)
            {
                if (nyx.TryGetValue(gameId, out var snapshot))
                {
                    next[gameId] = snapshot;
                }
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !shutdown.IsCancellationRequested)
        {
            next["wuwa"] = bundled["wuwa"];
            next["ae"] = bundled["ae"];
        }

        if (!shutdown.IsCancellationRequested)
        {
            lock (sync)
            {
                current = new ReadOnlyDictionary<string, LatestContentSnapshot>(next);
            }

            Updated?.Invoke(this, EventArgs.Empty);
        }

    }

    private async Task PumpAsync()
    {
        using var timer = new PeriodicTimer(interval);
        try
        {
            while (await timer.WaitForNextTickAsync(shutdown.Token))
            {
                await RefreshAsync(shutdown.Token);
            }
        }
        catch (OperationCanceledException) when (shutdown.IsCancellationRequested)
        {
        }
    }

    public async ValueTask DisposeAsync()
    {
        Task? pendingRefresh;
        Task? pendingPump;
        lock (sync)
        {
            if (disposed)
            {
                return;
            }

            disposed = true;
            shutdown.Cancel();
            pendingRefresh = refresh;
            pendingPump = pump;
        }

        try
        {
            await Task.WhenAll(
                pendingRefresh ?? Task.CompletedTask,
                pendingPump ?? Task.CompletedTask);
        }
        catch (OperationCanceledException)
        {
        }

        shutdown.Dispose();
        if (transport is IDisposable disposable)
        {
            disposable.Dispose();
        }
    }

    private sealed record HoyoContentEndpoint(Uri Uri, string GameId, string Biz);
}
