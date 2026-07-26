namespace Nyx.Desktop.Infrastructure.AccountStatus;

/// <summary>
/// Persists only the fact that publisher-account cleanup must finish. The marker
/// contains no account, role, cookie, or server identifier.
/// </summary>
public sealed class PublisherConsentRevocationStore
{
    private readonly string root;

    public PublisherConsentRevocationStore(string publisherProfilesRoot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(publisherProfilesRoot);
        root = Path.GetFullPath(Path.Combine(
            publisherProfilesRoot,
            ".pending-account-revocations"));
    }

    public bool IsPending(string provider)
    {
        if (!TryMarkerPath(provider, out var path)) return true;
        try
        {
            if (!Directory.Exists(root)) return false;
            if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) return true;
            if (!File.Exists(path)) return false;
            return true;
        }
        catch (Exception exception) when (exception is IOException
            or UnauthorizedAccessException)
        {
            // An unreadable marker location must never reopen account access.
            return true;
        }
    }

    public bool MarkPending(string provider)
    {
        if (!TryMarkerPath(provider, out var path)) return false;
        try
        {
            EnsureRoot();
            if (File.Exists(path))
                return (File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0;
            using var stream = new FileStream(
                path,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                1,
                FileOptions.WriteThrough);
            stream.Flush(flushToDisk: true);
            return true;
        }
        catch (Exception exception) when (exception is IOException
            or UnauthorizedAccessException)
        {
            return false;
        }
    }

    public bool Clear(string provider)
    {
        if (!TryMarkerPath(provider, out var path)) return false;
        try
        {
            if (!Directory.Exists(root)) return true;
            if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) return false;
            if (!File.Exists(path)) return true;
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) return false;
            File.Delete(path);
            return !File.Exists(path);
        }
        catch (Exception exception) when (exception is IOException
            or UnauthorizedAccessException)
        {
            return false;
        }
    }

    private void EnsureRoot()
    {
        Directory.CreateDirectory(root);
        if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0)
            throw new IOException("Publisher revocation marker root cannot be a reparse point.");
    }

    private bool TryMarkerPath(string provider, out string path)
    {
        var name = provider switch
        {
            "HoYoLAB" => "hoyolab.pending",
            "SKPORT" => "skport.pending",
            _ => null,
        };
        path = name is null ? string.Empty : Path.Combine(root, name);
        return name is not null;
    }
}
