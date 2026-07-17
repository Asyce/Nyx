using System.Text;
using Nyx.Desktop.Core.Exports;

namespace Nyx.Desktop.Infrastructure.Exports;

internal sealed record HoyoAuthQuery(IReadOnlyList<KeyValuePair<string, string>> Pairs)
{
    public string Language => DecodeValue("lang") is { Length: > 0 } value ? value.ToLowerInvariant() : "en-us";
    public string? Region => DecodeValue("region");

    public Uri BuildRequestUri(Uri endpoint, string gachaType, string endId, int size)
    {
        var query = new StringBuilder();
        foreach (var pair in Pairs)
        {
            if (query.Length != 0) query.Append('&');
            query.Append(pair.Key).Append('=').Append(pair.Value);
        }
        query.Append("&gacha_type=").Append(Uri.EscapeDataString(gachaType));
        query.Append("&size=").Append(size);
        query.Append("&end_id=").Append(Uri.EscapeDataString(endId));
        return new Uri(endpoint.AbsoluteUri + "?" + query, UriKind.Absolute);
    }

    private string? DecodeValue(string key)
    {
        var pair = Pairs.FirstOrDefault(item => item.Key.Equals(key, StringComparison.Ordinal));
        if (pair.Key is null) return null;
        try { return Uri.UnescapeDataString(pair.Value.Replace('+', ' ')); }
        catch (Exception) { return null; }
    }
}

internal interface IHoyoPullHistoryLinkReader
{
    IReadOnlyList<HoyoAuthQuery> ReadNewest(string cachePath, HoyoPullGameConfiguration game, CancellationToken cancellationToken);
}

internal sealed class HoyoPullHistoryLinkReader(PullExportSafetyLimits limits) : IHoyoPullHistoryLinkReader
{
    private static readonly HashSet<string> AllowedKeys = new(StringComparer.Ordinal)
    {
        "auth_appid", "authkey", "authkey_ver", "sign_type", "game_biz", "lang", "region",
        "timestamp", "init_type", "gacha_id", "device_type", "plat_type", "game_version",
    };

    private static readonly HashSet<string> CallSpecificKeys = new(StringComparer.Ordinal)
    {
        "gacha_type", "real_gacha_type", "size", "end_id", "page",
    };

    public IReadOnlyList<HoyoAuthQuery> ReadNewest(
        string cachePath,
        HoyoPullGameConfiguration game,
        CancellationToken cancellationToken)
    {
        try
        {
            var bytes = ReadSharedBounded(cachePath, cancellationToken);
            try
            {
                var text = Encoding.ASCII.GetString(bytes);
                return ExtractNewest(text, game, limits.MaximumCandidateUrls, limits.MaximumQueryBytes);
            }
            finally { Array.Clear(bytes); }
        }
        catch (OperationCanceledException) { throw; }
        catch (PullExportException) { throw; }
        catch (Exception)
        {
            throw new PullExportException(PullExportErrorCodes.HistoryNotFound);
        }
    }

    internal static IReadOnlyList<HoyoAuthQuery> ExtractNewest(
        string text,
        HoyoPullGameConfiguration game,
        int maximumCandidates,
        int maximumQueryBytes)
    {
        var candidates = new Queue<HoyoAuthQuery>(maximumCandidates);
        var cursor = 0;
        while (cursor < text.Length)
        {
            var start = text.IndexOf("https://", cursor, StringComparison.OrdinalIgnoreCase);
            if (start < 0) break;
            var end = start;
            var hardEnd = Math.Min(text.Length, start + maximumQueryBytes + 512);
            while (end < hardEnd && !IsUrlTerminator(text[end])) end++;
            cursor = Math.Max(end, start + 8);
            if ((end == hardEnd && hardEnd < text.Length) || end <= start) continue;
            if (!TryParseCandidate(text[start..end], game, maximumQueryBytes, out var query)) continue;
            if (candidates.Count == maximumCandidates) candidates.Dequeue();
            candidates.Enqueue(query!);
        }

        if (candidates.Count == 0)
            throw new PullExportException(PullExportErrorCodes.InvalidHistoryLink);
        return candidates.Reverse().ToArray();
    }

    private static bool TryParseCandidate(
        string value,
        HoyoPullGameConfiguration game,
        int maximumQueryBytes,
        out HoyoAuthQuery? auth)
    {
        auth = null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || !uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || !uri.Host.Equals(game.Endpoint.Host, StringComparison.OrdinalIgnoreCase)
            || !uri.IsDefaultPort
            || uri.UserInfo.Length != 0
            || !uri.AbsolutePath.Equals(game.Endpoint.AbsolutePath, StringComparison.Ordinal)
            || uri.Fragment.Length != 0
            || uri.Query.Length is <= 1
            || Encoding.UTF8.GetByteCount(uri.Query) > maximumQueryBytes)
            return false;

        var pairs = new List<KeyValuePair<string, string>>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var segment in uri.Query[1..].Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var equals = segment.IndexOf('=');
            if (equals <= 0) return false;
            var rawKey = segment[..equals];
            string key;
            try { key = Uri.UnescapeDataString(rawKey); }
            catch (Exception) { return false; }
            if (!key.Equals(key.ToLowerInvariant(), StringComparison.Ordinal) || key.Any(static c => !(char.IsAsciiLetterOrDigit(c) || c == '_')))
                return false;
            if (CallSpecificKeys.Contains(key)) continue;
            if (!AllowedKeys.Contains(key)) continue;
            if (!seen.Add(key)) return false;
            var rawValue = segment[(equals + 1)..];
            if (rawValue.Length == 0 || rawValue.Length > 8_192 || rawValue.IndexOfAny(['\r', '\n', '#']) >= 0) return false;
            pairs.Add(new(key, rawValue));
        }

        if (!TryDecodedValue(pairs, "auth_appid", out var appId)
            || !appId.Equals("webview_gacha", StringComparison.Ordinal)
            || !TryDecodedValue(pairs, "authkey", out var authKey)
            || authKey.Length is 0 or > 4_096)
            return false;

        auth = new HoyoAuthQuery(pairs);
        return true;
    }

    private byte[] ReadSharedBounded(string sourcePath, CancellationToken cancellationToken)
    {
        byte[]? bytes = null;
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var source = new FileStream(sourcePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            var initialLength = source.Length;
            if (initialLength > limits.MaximumCacheBytes || initialLength > int.MaxValue)
                throw new PullExportException(PullExportErrorCodes.CacheTooLarge);
            bytes = new byte[checked((int)initialLength)];
            var offset = 0;
            while (offset < bytes.Length)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var count = source.Read(bytes, offset, bytes.Length - offset);
                if (count == 0) break;
                offset += count;
            }
            cancellationToken.ThrowIfCancellationRequested();
            if (offset == bytes.Length && source.ReadByte() != -1)
                throw new PullExportException(PullExportErrorCodes.CacheTooLarge);
            if (offset != bytes.Length) Array.Resize(ref bytes, offset);
            var result = bytes;
            bytes = null;
            return result;
        }
        finally
        {
            if (bytes is not null) Array.Clear(bytes);
        }
    }

    private static bool TryDecodedValue(IReadOnlyList<KeyValuePair<string, string>> pairs, string key, out string value)
    {
        value = string.Empty;
        var pair = pairs.FirstOrDefault(item => item.Key.Equals(key, StringComparison.Ordinal));
        if (pair.Key is null) return false;
        try { value = Uri.UnescapeDataString(pair.Value.Replace('+', ' ')); return true; }
        catch (Exception) { return false; }
    }

    private static bool IsUrlTerminator(char value) => value is '\0' or '\r' or '\n' or ' ' or '\t' or '"' or '\'' or '<' or '>';
}
