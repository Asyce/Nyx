using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Nyx.Desktop.Infrastructure.Content;

namespace Nyx.Desktop.Tests.Content;

public sealed class LatestContentTransportTests
{
    private const string AllowedUri =
        "https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGameContent?game_id=4ziysqXOQ8&launcher_id=VYTpXlbWo8&language=en-us";

    [Fact]
    public async Task Exact_allowlisted_uri_returns_only_json_success_body()
    {
        var handler = new StubHandler((request, _) =>
        {
            Assert.Equal(AllowedUri, request.RequestUri?.AbsoluteUri);
            return Task.FromResult(JsonResponse("{\"ok\":true}"));
        });
        using var transport = new FixedLatestContentTransport(handler);

        var bytes = await transport.GetAsync(new(AllowedUri), 128 * 1024, default);

        Assert.Equal("{\"ok\":true}", Encoding.UTF8.GetString(bytes));
        Assert.Equal(1, handler.Calls);
    }

    [Theory]
    [InlineData("https://evil.example/content.json")]
    [InlineData("https://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGameContent?launcher_id=VYTpXlbWo8&game_id=4ziysqXOQ8&language=en-us")]
    [InlineData("http://sg-hyp-api.hoyoverse.com/hyp/hyp-connect/api/getGameContent?game_id=4ziysqXOQ8&launcher_id=VYTpXlbWo8&language=en-us")]
    public async Task Non_exact_uri_is_rejected_before_transport(string uri)
    {
        var handler = new StubHandler((_, _) => Task.FromResult(JsonResponse("{}")));
        using var transport = new FixedLatestContentTransport(handler);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            transport.GetAsync(new(uri), 128 * 1024, default));

        Assert.Equal(0, handler.Calls);
    }

    [Theory]
    [InlineData(HttpStatusCode.Redirect)]
    [InlineData(HttpStatusCode.InternalServerError)]
    public async Task Redirect_or_non_success_status_is_rejected(HttpStatusCode status)
    {
        var handler = new StubHandler((_, _) => Task.FromResult(new HttpResponseMessage(status)
        {
            Content = JsonContent("{}"),
        }));
        using var transport = new FixedLatestContentTransport(handler);

        await Assert.ThrowsAsync<InvalidDataException>(() =>
            transport.GetAsync(new(AllowedUri), 128 * 1024, default));
    }

    [Fact]
    public async Task Non_json_content_type_is_rejected()
    {
        var handler = new StubHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{}", Encoding.UTF8, "text/html"),
        }));
        using var transport = new FixedLatestContentTransport(handler);

        await Assert.ThrowsAsync<InvalidDataException>(() =>
            transport.GetAsync(new(AllowedUri), 128 * 1024, default));
    }

    [Fact]
    public async Task Request_timeout_cancels_inflight_handler()
    {
        var handler = new StubHandler(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return JsonResponse("{}");
        });
        using var transport = new FixedLatestContentTransport(handler, TimeSpan.FromMilliseconds(20));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            transport.GetAsync(new(AllowedUri), 128 * 1024, default));
    }

    [Fact]
    public async Task Declared_oversized_body_is_rejected()
    {
        var handler = new StubHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = ByteContent(new byte[129]),
        }));
        using var transport = new FixedLatestContentTransport(handler);

        await Assert.ThrowsAsync<InvalidDataException>(() =>
            transport.GetAsync(new(AllowedUri), 128, default));
    }

    [Fact]
    public async Task Streamed_oversized_body_without_content_length_is_rejected()
    {
        var content = new UnknownLengthContent(new byte[129]);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        var handler = new StubHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = content,
        }));
        using var transport = new FixedLatestContentTransport(handler);

        await Assert.ThrowsAsync<InvalidDataException>(() =>
            transport.GetAsync(new(AllowedUri), 128, default));
    }

    [Fact]
    public async Task Precancelled_request_never_reaches_handler()
    {
        var handler = new StubHandler((_, _) => Task.FromResult(JsonResponse("{}")));
        using var transport = new FixedLatestContentTransport(handler);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            transport.GetAsync(new(AllowedUri), 128 * 1024, cancellation.Token));

        Assert.Equal(0, handler.Calls);
    }

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = JsonContent(json),
    };

    private static HttpContent JsonContent(string json) =>
        new StringContent(json, Encoding.UTF8, "application/json");

    private static HttpContent ByteContent(byte[] bytes)
    {
        var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        return content;
    }

    private sealed class StubHandler(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> response)
        : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Calls++;
            return response(request, cancellationToken);
        }
    }

    private sealed class UnknownLengthContent(byte[] bytes) : HttpContent
    {
        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
            stream.WriteAsync(bytes).AsTask();

        protected override bool TryComputeLength(out long length)
        {
            length = 0;
            return false;
        }
    }
}
