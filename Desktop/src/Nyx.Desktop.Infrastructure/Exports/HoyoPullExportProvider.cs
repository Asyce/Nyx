using System.Net;
using Nyx.Desktop.Core.Exports;

namespace Nyx.Desktop.Infrastructure.Exports;

/// <summary>
/// Exports GI and HSR pull history directly from the two official HoYoverse APIs.
/// Cached authentication is held only in short-lived in-memory request state.
/// </summary>
public sealed class HoyoPullExportProvider : IPullExportProvider, IDisposable
{
    private readonly HttpClient httpClient;
    private readonly bool ownsHttpClient;
    private readonly IHoyoPullCacheLocator cacheLocator;
    private readonly IHoyoPullHistoryLinkReader linkReader;
    private readonly PullExportSafetyLimits limits;
    private readonly IPullRequestPacer pacer;
    private readonly string downloadsDirectory;
    private readonly TimeProvider timeProvider;
    private int disposed;

    public HoyoPullExportProvider()
        : this(
            CreateHttpClient(),
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            WindowsDownloadsDirectory.Get(),
            new PullRequestPacer(),
            new PullExportSafetyLimits(),
            TimeProvider.System,
            ownsHttpClient: true)
    {
    }

    internal HoyoPullExportProvider(
        HttpClient httpClient,
        string userProfile,
        string downloadsDirectory,
        IPullRequestPacer? pacer = null,
        PullExportSafetyLimits? limits = null,
        TimeProvider? timeProvider = null,
        bool ownsHttpClient = false,
        IHoyoPullCacheLocator? cacheLocator = null,
        IHoyoPullHistoryLinkReader? linkReader = null)
    {
        this.httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        this.limits = limits ?? new PullExportSafetyLimits();
        ValidateLimits(this.limits);
        this.pacer = pacer ?? new PullRequestPacer();
        this.downloadsDirectory = Path.GetFullPath(downloadsDirectory ?? throw new ArgumentNullException(nameof(downloadsDirectory)));
        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.cacheLocator = cacheLocator ?? new HoyoPullCacheLocator(
            Path.GetFullPath(userProfile ?? throw new ArgumentNullException(nameof(userProfile))), this.limits);
        this.linkReader = linkReader ?? new HoyoPullHistoryLinkReader(this.limits);
        this.ownsHttpClient = ownsHttpClient;
    }

    public async ValueTask<ExportArtifactMetadata> SnapshotAsync(
        string gameId,
        IExportSignalWaiter signals,
        CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        ArgumentNullException.ThrowIfNull(signals);
        var game = HoyoPullGameConfiguration.For(gameId);
        using var totalBudget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        totalBudget.CancelAfter(limits.EffectiveTotalDuration);
        try
        {
            var cachePath = cacheLocator.Locate(game, totalBudget.Token);
            var candidates = linkReader.ReadNewest(cachePath, game, totalBudget.Token);
            var api = new HoyoPullApiClient(httpClient, limits, pacer);
            var archive = await api.DownloadNewestValidAsync(game, candidates, totalBudget.Token).ConfigureAwait(false);
            var writer = new UigfPullExportWriter(downloadsDirectory, limits, timeProvider);
            var output = await writer.WriteAsync(archive, null, totalBudget.Token).ConfigureAwait(false);
            return new ExportArtifactMetadata(
                "pulls",
                archive.Records.Count,
                output.ByteCount,
                "UIGF v4.2 JSON",
                timeProvider.GetUtcNow(),
                output.Path);
        }
        catch (OperationCanceledException) { throw; }
        catch (PullExportException) { throw; }
        catch (Exception) { throw new PullExportException(PullExportErrorCodes.UpstreamInvalid); }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) == 0 && ownsHttpClient) httpClient.Dispose();
    }

    private static HttpClient CreateHttpClient()
    {
        var handler = new HttpClientHandler
        {
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate | DecompressionMethods.Brotli,
            UseCookies = false,
            UseProxy = false,
        };
        return new HttpClient(handler, disposeHandler: true) { Timeout = Timeout.InfiniteTimeSpan };
    }

    private static void ValidateLimits(PullExportSafetyLimits value)
    {
        if (value.MaximumCacheBytes is < 1 or > 256L * 1024 * 1024
            || value.MaximumLogBytes is < 1 or > 16 * 1024 * 1024
            || value.MaximumCandidateUrls is < 1 or > 256
            || value.MaximumQueryBytes is < 512 or > 64 * 1024
            || value.MaximumResponseBytes is < 1_024 or > 8 * 1024 * 1024
            || value.MaximumPagesPerType is < 1 or > 2_000
            || value.MaximumRecords is < 1 or > 200_000
            || value.MaximumOutputBytes is < 1_024 or > 256L * 1024 * 1024
            || value.MaximumVersionDirectories is < 1 or > 1_024
            || value.MaximumSearchDirectories is < 1 or > 20_000
            || value.EffectiveTotalDuration < TimeSpan.FromSeconds(1)
            || value.EffectiveTotalDuration > TimeSpan.FromMinutes(15)
            || value.EffectiveRequestTimeout < TimeSpan.FromSeconds(1)
            || value.EffectiveRequestTimeout > TimeSpan.FromMinutes(1))
            throw new ArgumentOutOfRangeException(nameof(value));
    }
}
