using System.Net;
using System.Net.Http.Headers;

namespace Nyx.Desktop.Infrastructure.Content;

internal interface ILatestContentTransport
{
    Task<byte[]> GetAsync(Uri uri, int maximumBytes, CancellationToken cancellationToken);
}

internal sealed class FixedLatestContentTransport : ILatestContentTransport, IDisposable
{
    private static readonly HashSet<string> AllowedUris = new(StringComparer.Ordinal)
    {
        "https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGameContent?game_id=gopR6Cufr3&launcher_id=VYTpXlbWo8&language=en-us",
        "https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGameContent?game_id=4ziysqXOQ8&launcher_id=VYTpXlbWo8&language=en-us",
        "https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGameContent?game_id=U5hbdsT9W7&launcher_id=VYTpXlbWo8&language=en-us",
        "https://pengo.gg/dist/launcher-content-v1.json",
    };
    private readonly HttpClient client;
    private readonly TimeSpan requestTimeout;

    public FixedLatestContentTransport()
        : this(CreateDefaultHandler(), TimeSpan.FromSeconds(10))
    {
    }

    internal FixedLatestContentTransport(
        HttpMessageHandler handler,
        TimeSpan? requestTimeout = null)
    {
        ArgumentNullException.ThrowIfNull(handler);
        this.requestTimeout = requestTimeout ?? TimeSpan.FromSeconds(10);
        if (this.requestTimeout <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(requestTimeout));
        }

        client = new(handler, disposeHandler: true)
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
    }

    public async Task<byte[]> GetAsync(
        Uri uri,
        int maximumBytes,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(uri);
        if (!AllowedUris.Contains(uri.AbsoluteUri) || maximumBytes is <= 0 or > 256 * 1024)
        {
            throw new InvalidOperationException("Content request is outside the fixed allowlist.");
        }

        cancellationToken.ThrowIfCancellationRequested();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(requestTimeout);
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var response = await client.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            timeout.Token);
        if (response.StatusCode is not HttpStatusCode.OK
            || response.Content.Headers.ContentType?.MediaType is not "application/json"
            || response.Content.Headers.ContentLength > maximumBytes)
        {
            throw new InvalidDataException("Content response was not an allowed JSON document.");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
        using var memory = new MemoryStream(Math.Min(maximumBytes, 16 * 1024));
        var buffer = new byte[8192];
        while (true)
        {
            var read = await stream.ReadAsync(buffer, timeout.Token);
            if (read == 0)
            {
                break;
            }

            if (memory.Length + read > maximumBytes)
            {
                throw new InvalidDataException("Content response exceeded its byte limit.");
            }

            memory.Write(buffer, 0, read);
        }

        return memory.ToArray();
    }

    public void Dispose() => client.Dispose();

    private static SocketsHttpHandler CreateDefaultHandler() => new()
    {
        AllowAutoRedirect = false,
        UseCookies = false,
        AutomaticDecompression = DecompressionMethods.None,
    };
}
