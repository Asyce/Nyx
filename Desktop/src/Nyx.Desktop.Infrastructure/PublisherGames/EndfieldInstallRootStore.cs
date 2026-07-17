namespace Nyx.Desktop.Infrastructure.PublisherGames;

/// <summary>
/// Stores one fixed Endfield install-root hint. A hint is never identity proof:
/// every observer and launch dispatch must still pass the sealed protected
/// Endfield validation boundary.
/// </summary>
public sealed class EndfieldInstallRootStore
{
    internal const string SettingName = "PublisherGames.Endfield.InstallRoot.v1";
    private const int MaximumPathLength = 2048;
    private readonly IDictionary<string, object> values;
    private readonly object sync = new();

    public EndfieldInstallRootStore(IDictionary<string, object> values)
    {
        this.values = values ?? throw new ArgumentNullException(nameof(values));
    }

    public string? Load()
    {
        lock (sync)
        {
            try
            {
                if (!values.TryGetValue(SettingName, out var raw)
                    || raw is not string value
                    || !TryNormalize(value, out var root))
                {
                    ClearCore();
                    return null;
                }

                return root;
            }
            catch (Exception exception) when (IsSettingsFailure(exception))
            {
                return null;
            }
        }
    }

    public bool TrySave(string? value)
    {
        if (!TryNormalize(value, out var root))
        {
            Clear();
            return false;
        }

        lock (sync)
        {
            try
            {
                values[SettingName] = root!;
                return true;
            }
            catch (Exception exception) when (IsSettingsFailure(exception))
            {
                ClearCore();
                return false;
            }
        }
    }

    /// <summary>
    /// Saves an automatically discovered hint only while no valid user choice
    /// exists. The check and write share the same settings lock so a late
    /// startup discovery cannot replace a folder selected by the user.
    /// </summary>
    public bool TrySaveIfEmpty(string? value)
    {
        if (!TryNormalize(value, out var root))
        {
            return false;
        }

        lock (sync)
        {
            try
            {
                if (values.TryGetValue(SettingName, out var raw)
                    && raw is string existing
                    && TryNormalize(existing, out _))
                {
                    return false;
                }

                ClearCore();
                values[SettingName] = root!;
                return true;
            }
            catch (Exception exception) when (IsSettingsFailure(exception))
            {
                return false;
            }
        }
    }

    public void Clear()
    {
        lock (sync)
        {
            ClearCore();
        }
    }

    private void ClearCore()
    {
        try
        {
            values.Remove(SettingName);
        }
        catch (Exception exception) when (IsSettingsFailure(exception))
        {
            // A failed local setting cannot become a launch path. Callers will
            // receive no root and the session remains disabled.
        }
    }

    internal static bool TryNormalize(string? value, out string? root)
    {
        root = null;
        try
        {
            if (string.IsNullOrEmpty(value)
                || value.Length > MaximumPathLength
                || !string.Equals(value, value.Trim(), StringComparison.Ordinal)
                || !Path.IsPathFullyQualified(value)
                || value.StartsWith(@"\\", StringComparison.Ordinal)
                || value.StartsWith(@"\\?\", StringComparison.Ordinal)
                || value.StartsWith(@"\\.\", StringComparison.Ordinal)
                || value.Length < 3
                || !char.IsAsciiLetter(value[0])
                || value[1] != Path.VolumeSeparatorChar
                || value[2] != Path.DirectorySeparatorChar)
            {
                return false;
            }

            var canonical = Path.GetFullPath(value);
            var trimmedCanonical = Path.TrimEndingDirectorySeparator(canonical);
            var trimmedInput = Path.TrimEndingDirectorySeparator(value);
            if (!string.Equals(trimmedCanonical, trimmedInput, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            root = trimmedCanonical;
            return true;
        }
        catch (Exception exception) when (exception is ArgumentException
                                              or IOException
                                              or NotSupportedException
                                              or PathTooLongException)
        {
            return false;
        }
    }

    private static bool IsSettingsFailure(Exception exception) =>
        exception is ArgumentException
            or InvalidOperationException
            or UnauthorizedAccessException
            or System.Security.SecurityException;
}
