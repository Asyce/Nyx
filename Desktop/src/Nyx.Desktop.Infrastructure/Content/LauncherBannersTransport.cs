using System.Net;
using System.Net.Http.Headers;

namespace Nyx.Desktop.Infrastructure.Content;

public interface ILauncherBannersTransport
{
    Task<byte[]> GetManifestAsync(Uri endpoint, int maximumBytes, CancellationToken cancellationToken);
    Task<byte[]> GetAssetAsync(Uri endpoint, int maximumBytes, CancellationToken cancellationToken);
}

public sealed class LauncherBannersTransport : ILauncherBannersTransport, IDisposable
{
    public const string ProductionEndpoint = "https://pengo.gg/dist/launcher-banners-v1.json";
    public const string ProductionCodesEndpoint = "https://pengo.gg/dist/launcher-codes-v1.json";
    public const int MaximumManifestBytes = 2 * 1024 * 1024;
    public const int MaximumAssetBytes = 8 * 1024 * 1024;
    private readonly HttpClient client;
    private readonly TimeSpan timeout;

    public LauncherBannersTransport()
        : this(CreateDefaultHandler(), TimeSpan.FromSeconds(15))
    {
    }

    public LauncherBannersTransport(HttpMessageHandler handler, TimeSpan? timeout = null)
    {
        ArgumentNullException.ThrowIfNull(handler);
        this.timeout = timeout ?? TimeSpan.FromSeconds(15);
        if (this.timeout <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(timeout));
        client = new HttpClient(handler, disposeHandler: true) { Timeout = Timeout.InfiniteTimeSpan };
    }

    public Task<byte[]> GetManifestAsync(Uri endpoint, int maximumBytes, CancellationToken cancellationToken) => GetAsync(endpoint, maximumBytes, requireJson: true, cancellationToken: cancellationToken);
    public Task<byte[]> GetAssetAsync(Uri endpoint, int maximumBytes, CancellationToken cancellationToken) => GetAsync(endpoint, maximumBytes, requireJson: false, cancellationToken: cancellationToken);

    private async Task<byte[]> GetAsync(Uri endpoint, int maximumBytes, bool requireJson, CancellationToken cancellationToken)
    {
        ValidateEndpoint(endpoint, allowConfigured: true, requireJson);
        if (maximumBytes is <= 0 or > MaximumAssetBytes) throw new ArgumentOutOfRangeException(nameof(maximumBytes));
        cancellationToken.ThrowIfCancellationRequested();
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);
        using var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue(requireJson ? "application/json" : "image/webp"));
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeoutSource.Token).ConfigureAwait(false);
        if (response.StatusCode != HttpStatusCode.OK) throw new InvalidDataException("Launcher content request failed.");
        if (requireJson && response.Content.Headers.ContentType?.MediaType is not "application/json") throw new InvalidDataException("Launcher manifest response was not JSON.");
        if (response.Content.Headers.ContentLength > maximumBytes) throw new InvalidDataException("Launcher content exceeded the byte limit.");
        await using var stream = await response.Content.ReadAsStreamAsync(timeoutSource.Token).ConfigureAwait(false);
        using var memory = new MemoryStream(Math.Min(maximumBytes, 32 * 1024));
        var buffer = new byte[16 * 1024];
        while (true)
        {
            var read = await stream.ReadAsync(buffer, timeoutSource.Token).ConfigureAwait(false);
            if (read == 0) break;
            if (memory.Length + read > maximumBytes) throw new InvalidDataException("Launcher content exceeded the byte limit.");
            memory.Write(buffer, 0, read);
        }
        return memory.ToArray();
    }

    internal static void ValidateEndpoint(Uri endpoint, bool allowConfigured, bool requireJson)
    {
        ArgumentNullException.ThrowIfNull(endpoint);
        if (!endpoint.IsAbsoluteUri || endpoint.UserInfo.Length > 0 || endpoint.Fragment.Length > 0 || endpoint.Scheme is not ("https" or "http")) throw new InvalidOperationException("Launcher endpoint is unsafe.");
        var loopback = endpoint.IsLoopback;
        if (endpoint.Scheme == "http" && !loopback) throw new InvalidOperationException("Launcher endpoint must use HTTPS.");
        if (endpoint.Scheme == "https" && !endpoint.IsDefaultPort && !loopback) throw new InvalidOperationException("Launcher endpoint must use the default HTTPS port.");
        if (!allowConfigured) return;
        if (!loopback)
        {
            var approved = endpoint.Host.Equals("pengo.gg", StringComparison.OrdinalIgnoreCase);
            if (!approved) throw new InvalidOperationException(requireJson ? "Launcher manifest endpoint is not approved." : "Launcher asset endpoint is not approved.");
        }
    }

    public void Dispose() => client.Dispose();

    private static SocketsHttpHandler CreateDefaultHandler() => new()
    {
        AllowAutoRedirect = false,
        UseCookies = false,
        AutomaticDecompression = DecompressionMethods.None,
    };
}
