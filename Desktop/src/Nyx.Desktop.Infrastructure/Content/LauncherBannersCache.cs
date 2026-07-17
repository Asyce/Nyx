using System.Security.Cryptography;
using System.Text.Json;
using System.Buffers.Binary;
using Nyx.Desktop.Core.Content;

namespace Nyx.Desktop.Infrastructure.Content;

public sealed class LauncherBannersCache
{
    public const long MaximumManagedBytes = 150L * 1024 * 1024;
    public string RootDirectory { get; }
    public string ManagedDirectory { get; }
    public string ManagedAssetsDirectory { get; }
    public string LastKnownGoodDirectory { get; }
    public string UserArtDirectory { get; }

    public LauncherBannersCache(string rootDirectory)
    {
        if (string.IsNullOrWhiteSpace(rootDirectory)) throw new ArgumentException("A cache directory is required.", nameof(rootDirectory));
        RootDirectory = Path.GetFullPath(rootDirectory);
        ManagedDirectory = Path.Combine(RootDirectory, "managed");
        ManagedAssetsDirectory = Path.Combine(ManagedDirectory, "assets");
        LastKnownGoodDirectory = Path.Combine(RootDirectory, "last-known-good");
        UserArtDirectory = Path.Combine(RootDirectory, "user-art");
    }

    public string LastKnownGoodManifestPath => Path.Combine(LastKnownGoodDirectory, "launcher-banners-v1.json");

    public string PinUserArt(string gameId, LauncherBannersAsset asset, string sourcePath)
    {
        ArgumentNullException.ThrowIfNull(asset);
        if (string.IsNullOrWhiteSpace(gameId) || gameId.Any(character => !char.IsAsciiLetterOrDigit(character) && character != '-'))
            throw new ArgumentException("A safe game id is required.", nameof(gameId));
        var bytes = File.ReadAllBytes(Path.GetFullPath(sourcePath));
        ValidateAssetBytes(asset, bytes);
        Directory.CreateDirectory(UserArtDirectory);
        if (!IsSafeUserArtPath(UserArtDirectory, mustExist: true)) throw new InvalidDataException("Unsafe user-art root.");
        var gameDirectory = Path.Combine(UserArtDirectory, gameId);
        Directory.CreateDirectory(gameDirectory);
        if (!IsSafeUserArtPath(gameDirectory, mustExist: true)) throw new InvalidDataException("Unsafe user-art game directory.");
        var relative = $"{gameId}/{asset.Sha256}{Extension(asset.Mime)}";
        var destination = ResolveUserArtPath(relative, mustExist: false)
            ?? throw new InvalidDataException("Unsafe pinned art destination.");
        AtomicWrite(destination, bytes);
        return relative;
    }

    public string? TryResolveUserArt(string? relative)
    {
        var path = ResolveUserArtPath(relative, mustExist: true);
        if (path is null) return null;
        try
        {
            var expectedHash = Path.GetFileNameWithoutExtension(path);
            if (expectedHash.Length != 64 || expectedHash.Any(character => !Uri.IsHexDigit(character))) return null;
            var bytes = File.ReadAllBytes(path);
            var actualHash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            if (!string.Equals(expectedHash, actualHash, StringComparison.OrdinalIgnoreCase)) return null;
            var mime = Path.GetExtension(path).Equals(".png", StringComparison.OrdinalIgnoreCase) ? "image/png" : "image/webp";
            var dimensions = ReadDimensions(bytes, mime);
            return dimensions is { Width: > 0 and <= 4096, Height: > 0 and <= 4096 } ? path : null;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    public void ReleaseUserArt(string? relative)
    {
        var path = ResolveUserArtPath(relative, mustExist: true);
        if (path is not null) TryDelete(path);
    }

    public string? TryResolveManagedAsset(LauncherBannersAsset asset)
    {
        ArgumentNullException.ThrowIfNull(asset);
        var path = Path.Combine(ManagedAssetsDirectory, asset.Sha256 + Extension(asset.Mime));
        return TryValidateFile(path, asset);
    }

    public string? TryResolveBundledAsset(LauncherBannersAsset asset, string bundledAssetsDirectory)
    {
        ArgumentNullException.ThrowIfNull(asset);
        if (string.IsNullOrWhiteSpace(bundledAssetsDirectory)) return null;
        const string prefix = "/launcher-art/";
        if (!asset.Path.StartsWith(prefix, StringComparison.Ordinal)) return null;
        var root = Path.GetFullPath(bundledAssetsDirectory);
        var relative = asset.Path[prefix.Length..].Replace('/', Path.DirectorySeparatorChar);
        var path = Path.GetFullPath(Path.Combine(root, relative));
        if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return null;
        if (!string.Equals(Path.GetFileName(path), asset.Sha256 + Extension(asset.Mime), StringComparison.OrdinalIgnoreCase)) return null;
        return TryValidateFile(path, asset);
    }

    public LauncherBannersManifest? TryLoadLastKnownGood(DateTimeOffset observedAt)
    {
        try
        {
            if (!File.Exists(LastKnownGoodManifestPath)) return null;
            return LauncherBannersManifestParser.Parse(File.ReadAllBytes(LastKnownGoodManifestPath), fallback: true, observedAt);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or JsonException)
        {
            return null;
        }
    }

    public async Task PromoteAsync(
        LauncherBannersManifest manifest,
        byte[] payload,
        ILauncherBannersTransport transport,
        string? bundledAssetsDirectory = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(manifest);
        ArgumentNullException.ThrowIfNull(payload);
        ArgumentNullException.ThrowIfNull(transport);
        Directory.CreateDirectory(ManagedAssetsDirectory);
        Directory.CreateDirectory(LastKnownGoodDirectory);
        foreach (var asset in manifest.Games.Values.SelectMany(game => game.Current?.Variants ?? []).Concat(manifest.Games.Values.SelectMany(game => game.Current?.Characters.SelectMany(character => character.Variants) ?? [])))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (asset.Url is null) continue;
            if (bundledAssetsDirectory is not null
                && TryResolveBundledAsset(asset, bundledAssetsDirectory) is not null)
            {
                continue;
            }
            var bytes = await transport.GetAssetAsync(asset.Url, LauncherBannersTransport.MaximumAssetBytes, cancellationToken).ConfigureAwait(false);
            ValidateAssetBytes(asset, bytes);
            var destination = Path.Combine(ManagedAssetsDirectory, asset.Sha256 + Extension(asset.Mime));
            await AtomicWriteAsync(destination, bytes, cancellationToken).ConfigureAwait(false);
        }

        await AtomicWriteAsync(Path.Combine(ManagedDirectory, $"{manifest.Revision}.json"), payload, cancellationToken).ConfigureAwait(false);
        await AtomicWriteAsync(LastKnownGoodManifestPath, payload, cancellationToken).ConfigureAwait(false);
        PruneManagedCache(activeManifest: manifest, now: DateTimeOffset.UtcNow);
    }

    public int PruneManagedCache(long maximumBytes = MaximumManagedBytes, LauncherBannersManifest? activeManifest = null, DateTimeOffset? now = null)
    {
        if (maximumBytes <= 0) throw new ArgumentOutOfRangeException(nameof(maximumBytes));
        if (!Directory.Exists(ManagedDirectory)) return 0;
        foreach (var temporary in Directory.EnumerateFiles(ManagedDirectory, ".*.tmp", SearchOption.AllDirectories)) TryDelete(temporary);
        if (activeManifest is not null)
        {
            var at = now ?? DateTimeOffset.UtcNow;
            var liveHashes = activeManifest.Games.Values
                .Where(game => game.Current is not null && game.Current.End > at)
                .SelectMany(game => game.Current!.Variants.Concat(game.Current.Characters.SelectMany(character => character.Variants)))
                .Select(asset => asset.Sha256)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var file in Directory.EnumerateFiles(ManagedAssetsDirectory, "*", SearchOption.TopDirectoryOnly))
            {
                var hash = Path.GetFileNameWithoutExtension(file);
                if (!liveHashes.Contains(hash)) TryDelete(file);
            }
        }
        var files = Directory.EnumerateFiles(ManagedDirectory, "*", SearchOption.AllDirectories)
            .Where(file => !file.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            .Select(file => new FileInfo(file))
            .Where(file => file.Exists)
            .OrderBy(file => file.LastWriteTimeUtc)
            .ThenBy(file => file.FullName, StringComparer.Ordinal)
            .ToList();
        long total = files.Sum(file => file.Length);
        var removed = 0;
        foreach (var file in files)
        {
            if (total <= maximumBytes) break;
            total -= file.Length;
            TryDelete(file.FullName);
            removed++;
        }
        return removed;
    }

    private static string? TryValidateFile(string path, LauncherBannersAsset asset)
    {
        try
        {
            if (!File.Exists(path)) return null;
            var fullPath = Path.GetFullPath(path);
            var bytes = File.ReadAllBytes(fullPath);
            ValidateAssetBytes(asset, bytes);
            return fullPath;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            return null;
        }
    }

    private static void ValidateAssetBytes(LauncherBannersAsset asset, byte[] bytes)
    {
        if (bytes.Length != asset.Size || bytes.Length == 0) throw new InvalidDataException("Launcher asset size did not match the manifest.");
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        if (!string.Equals(hash, asset.Sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Launcher asset hash did not match the manifest.");
        if (asset.Mime == "image/png" && !(bytes.Length >= 8 && bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }))) throw new InvalidDataException("Launcher asset MIME did not match the bytes.");
        if (asset.Mime == "image/webp" && !(bytes.Length >= 12 && bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) && bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8))) throw new InvalidDataException("Launcher asset MIME did not match the bytes.");
        var dimensions = ReadDimensions(bytes, asset.Mime);
        if (dimensions is null || dimensions.Value.Width != asset.Dimensions.Width || dimensions.Value.Height != asset.Dimensions.Height) throw new InvalidDataException("Launcher asset dimensions did not match the manifest.");
    }

    private static (int Width, int Height)? ReadDimensions(byte[] bytes, string mime)
    {
        if (mime == "image/png" && bytes.Length >= 24 && bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }))
        {
            var width = BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(16, 4));
            var height = BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(20, 4));
            return width is > 0 and <= 4096 && height is > 0 and <= 4096 ? ((int)width, (int)height) : null;
        }
        if (mime != "image/webp" || bytes.Length < 30 || !bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) || !bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8)) return null;
        var kind = System.Text.Encoding.ASCII.GetString(bytes, 12, 4);
        if (kind == "VP8X")
        {
            var widthMinusOne = bytes[24] | bytes[25] << 8 | bytes[26] << 16;
            var heightMinusOne = bytes[27] | bytes[28] << 8 | bytes[29] << 16;
            return (1 + widthMinusOne, 1 + heightMinusOne);
        }
        if (kind == "VP8 " && bytes.Length >= 30 && bytes[23] == 0x9d && bytes[24] == 0x01 && bytes[25] == 0x2a) return (BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(26, 2)) & 0x3fff, BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(28, 2)) & 0x3fff);
        if (kind == "VP8L" && bytes.Length >= 25 && bytes[21] == 0x2f)
        {
            var bits = BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(21, 4));
            return (1 + (int)(bits >> 8 & 0x3fff), 1 + (int)(bits >> 22 & 0x3fff));
        }
        return null;
    }

    private static string Extension(string mime) => mime == "image/png" ? ".png" : ".webp";

    private static async Task AtomicWriteAsync(string target, byte[] bytes, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        var temp = Path.Combine(Path.GetDirectoryName(target)!, $".{Path.GetFileName(target)}.{Guid.NewGuid():N}.tmp");
        try
        {
            await using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.SequentialScan | FileOptions.WriteThrough))
            {
                await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
            }
            File.Move(temp, target, overwrite: true);
        }
        finally
        {
            TryDelete(temp);
        }
    }

    private static void AtomicWrite(string target, byte[] bytes)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        var temp = Path.Combine(Path.GetDirectoryName(target)!, $".{Path.GetFileName(target)}.{Guid.NewGuid():N}.tmp");
        try
        {
            using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.WriteThrough))
            {
                stream.Write(bytes);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temp, target, overwrite: true);
        }
        finally
        {
            TryDelete(temp);
        }
    }

    private string? ResolveUserArtPath(string? relative, bool mustExist)
    {
        if (string.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative)) return null;
        var parts = relative.Replace('\\', '/').Split('/');
        if (parts.Any(part => part.Length == 0 || part is "." or "..")) return null;
        var root = Path.GetFullPath(UserArtDirectory);
        var path = Path.GetFullPath(Path.Combine(root, Path.Combine(parts)));
        if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return null;
        return IsSafeUserArtPath(path, mustExist) ? path : null;
    }

    private bool IsSafeUserArtPath(string path, bool mustExist)
    {
        try
        {
            var root = Path.GetFullPath(UserArtDirectory);
            var full = Path.GetFullPath(path);
            if (!full.Equals(root, StringComparison.OrdinalIgnoreCase)
                && !full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return false;
            var current = root;
            if (Directory.Exists(current) && File.GetAttributes(current).HasFlag(FileAttributes.ReparsePoint)) return false;
            var relative = Path.GetRelativePath(root, full);
            if (relative != ".")
            {
                foreach (var part in relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
                {
                    current = Path.Combine(current, part);
                    if (!File.Exists(current) && !Directory.Exists(current)) break;
                    if (File.GetAttributes(current).HasFlag(FileAttributes.ReparsePoint)) return false;
                }
            }
            return !mustExist || File.Exists(full) || Directory.Exists(full);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            return false;
        }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
