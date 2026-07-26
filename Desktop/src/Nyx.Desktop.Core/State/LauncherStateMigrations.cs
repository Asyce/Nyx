using System.Collections.ObjectModel;
using System.Text.Json;
using System.Text.Json.Serialization;
using Nyx.Desktop.Core.Features;
using Nyx.Desktop.Core.Games;

namespace Nyx.Desktop.Core.State;

/// <summary>Pure JSON migration and invariant repair. It has no file-system side effects.</summary>
public static class LauncherStateMigrations
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        AllowTrailingCommas = false,
        ReadCommentHandling = JsonCommentHandling.Disallow,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Skip,
    };

    public static LauncherStateReadResult Read(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return new(LauncherStateReadStatus.Malformed, null, "State is empty.");
        }

        try
        {
            var document = JsonSerializer.Deserialize<StateDto>(json, JsonOptions);
            if (document is null)
            {
                return new(LauncherStateReadStatus.Malformed, null, "State is null.");
            }

            var version = document.Version ?? 0;
            if (version > LauncherState.CurrentVersion)
            {
                return new(LauncherStateReadStatus.FutureVersion, null, $"Unsupported state version {version}.");
            }

            var state = Normalize(document);
            return new(
                version == LauncherState.CurrentVersion
                    ? LauncherStateReadStatus.Loaded
                    : LauncherStateReadStatus.Migrated,
                state);
        }
        catch (JsonException exception)
        {
            return new(LauncherStateReadStatus.Malformed, null, exception.Message);
        }
        catch (NotSupportedException exception)
        {
            return new(LauncherStateReadStatus.Malformed, null, exception.Message);
        }
    }

    public static string Write(LauncherState state)
    {
        ArgumentNullException.ThrowIfNull(state);
        return JsonSerializer.Serialize(ToDto(Normalize(state)), JsonOptions);
    }

    public static LauncherState Normalize(LauncherState state)
    {
        ArgumentNullException.ThrowIfNull(state);
        var dto = ToDto(state);
        return Normalize(dto);
    }

    private static LauncherState Normalize(StateDto dto)
    {
        var customs = (dto.CustomGames ?? Array.Empty<CustomGameDto>())
            .Where(static custom => custom is not null
                && CustomGameId.IsValid(custom.Id)
                && !string.IsNullOrWhiteSpace(custom.Name)
                && !string.IsNullOrWhiteSpace(custom.ExecutablePath)
                && !string.IsNullOrWhiteSpace(custom.IconPath))
            .Select(static custom => new CustomGameDefinition
            {
                Id = custom!.Id!,
                Name = custom.Name!.Trim(),
                ExecutablePath = custom.ExecutablePath!,
                IconPath = custom.IconPath!,
                BackgroundPath = NullIfWhiteSpace(custom.BackgroundPath),
                RuntimePath = NullIfWhiteSpace(custom.RuntimePath),
                RawArguments = custom.RawArguments,
                RequestAdministrator = custom.RequestAdministrator,
                CreationOrder = custom.CreationOrder,
            })
            .GroupBy(static custom => custom.Id, StringComparer.Ordinal)
            // An ambiguous identity is quarantined as a whole. Choosing either
            // executable would let array order decide what can be launched.
            .Where(static group => group.Count() == 1)
            .Select(static group => group.Single())
            .OrderBy(static custom => custom.CreationOrder)
            .ThenBy(static custom => custom.Id, StringComparer.Ordinal)
            .ToArray();

        var customById = customs.ToDictionary(static custom => custom.Id, StringComparer.Ordinal);
        var rail = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var id in dto.RailOrder ?? Array.Empty<string>())
        {
            if (id is null || !seen.Add(id))
            {
                continue;
            }

            if (GameCatalog.TryGet(id, out _) || customById.ContainsKey(id))
            {
                rail.Add(id);
            }
        }

        foreach (var game in GameCatalog.All)
        {
            if (seen.Add(game.Id))
            {
                rail.Add(game.Id);
            }
        }

        foreach (var custom in customs)
        {
            if (seen.Add(custom.Id))
            {
                rail.Add(custom.Id);
            }
        }

        var appearance = new Dictionary<string, GameAppearanceState>(StringComparer.Ordinal);
        if (dto.Appearance is not null)
        {
            foreach (var pair in dto.Appearance)
            {
                if (pair.Key is null || (!GameCatalog.TryGet(pair.Key, out _) && !customById.ContainsKey(pair.Key)))
                {
                    continue;
                }

                appearance[pair.Key] = new GameAppearanceState
                {
                    IconPath = NullIfWhiteSpace(pair.Value?.IconPath),
                    BackgroundPath = NullIfWhiteSpace(pair.Value?.BackgroundPath),
                    AutomaticArt = pair.Value?.AutomaticArt ?? true,
                    ArtScale = Math.Clamp(pair.Value?.ArtScale ?? 100, 25, 500),
                    ArtX = pair.Value?.ArtX ?? 0,
                    ArtY = pair.Value?.ArtY ?? 0,
                    ArtVariant = NullIfWhiteSpace(pair.Value?.ArtVariant),
                    ArtFit = NormalizeArtFit(pair.Value?.ArtFit),
                    ArtPinned = pair.Value?.ArtPinned ?? false,
                    PinnedArtFile = NormalizePinnedArtFile(pair.Value?.PinnedArtFile),
                };
            }
        }

        var gameArming = new Dictionary<string, ExportGameArming>(StringComparer.Ordinal);
        if (dto.Export?.Games is not null)
        {
            foreach (var pair in dto.Export.Games)
            {
                if (pair.Key is "gi" or "hsr")
                {
                    gameArming[pair.Key] = new ExportGameArming
                    {
                        PullsArmed = pair.Value?.PullsArmed ?? false,
                        AchievementsArmed = pair.Value?.AchievementsArmed ?? false,
                    };
                }
            }
        }
        else if (dto.Export?.IsArmed == true)
        {
            // v0 had one arm bit. Preserve its intent for both supported providers.
            gameArming["gi"] = new ExportGameArming { PullsArmed = true, AchievementsArmed = true };
            gameArming["hsr"] = new ExportGameArming { PullsArmed = true, AchievementsArmed = true };
        }

        return new LauncherState
        {
            Version = LauncherState.CurrentVersion,
            SelectedGameId = rail.Contains(dto.SelectedGameId ?? string.Empty, StringComparer.Ordinal)
                ? dto.SelectedGameId!
                : rail[0],
            RailOrder = rail.AsReadOnly(),
            CustomGames = customs,
            Appearance = new ReadOnlyDictionary<string, GameAppearanceState>(appearance),
            Export = new ExportArmingState
            {
                IsArmed = dto.Export?.IsArmed ?? false,
                Games = new ReadOnlyDictionary<string, ExportGameArming>(gameArming),
                // Export destinations are fixed under the Windows Downloads known
                // folder. Older custom paths are intentionally not trusted.
                OutputDirectory = null,
                OutputPaths = new ReadOnlyDictionary<string, string>(
                    new Dictionary<string, string>(StringComparer.Ordinal)),
            },
            Preferences = new LauncherGlobalPreferences
            {
                StayVisibleAfterLaunch = dto.Preferences?.StayVisibleAfterLaunch ?? true,
                RefreshContentOnStartup = dto.Preferences?.RefreshContentOnStartup ?? true,
                SafeNotifications = dto.Preferences?.SafeNotifications ?? true,
                DataDirectory = NullIfWhiteSpace(dto.Preferences?.DataDirectory),
                EndfieldInstallRoot = NormalizeLocalRoot(dto.Preferences?.EndfieldInstallRoot),
                ManualInstallRoots = NormalizeManualInstallRoots(dto.Preferences?.ManualInstallRoots),
                CopiedRedemptionCodes = NormalizeCopiedRedemptionCodes(dto.Preferences?.CopiedRedemptionCodes),
                FeatureFlags = NormalizeFeatureFlags(dto.Preferences?.FeatureFlags),
            },
        };
    }

    private static StateDto ToDto(LauncherState state) => new()
    {
        Version = state.Version,
        SelectedGameId = state.SelectedGameId,
        RailOrder = state.RailOrder?.ToArray(),
        CustomGames = state.CustomGames?.Select(static custom => new CustomGameDto
        {
            Id = custom.Id,
            Name = custom.Name,
            ExecutablePath = custom.ExecutablePath,
            IconPath = custom.IconPath,
            BackgroundPath = custom.BackgroundPath,
            RuntimePath = custom.RuntimePath,
            RawArguments = custom.RawArguments,
            RequestAdministrator = custom.RequestAdministrator,
            CreationOrder = custom.CreationOrder,
        }).ToArray(),
        Appearance = state.Appearance?.ToDictionary(
            static pair => pair.Key,
            static pair => (AppearanceDto?)new AppearanceDto
            {
                IconPath = pair.Value.IconPath,
                BackgroundPath = pair.Value.BackgroundPath,
                AutomaticArt = pair.Value.AutomaticArt,
                ArtScale = pair.Value.ArtScale,
                ArtX = pair.Value.ArtX,
                ArtY = pair.Value.ArtY,
                ArtVariant = pair.Value.ArtVariant,
                ArtFit = NormalizeArtFit(pair.Value.ArtFit),
                ArtPinned = pair.Value.ArtPinned,
                PinnedArtFile = pair.Value.PinnedArtFile,
            }, StringComparer.Ordinal),
        Export = new ExportDto
        {
            IsArmed = state.Export?.IsArmed ?? false,
            Games = state.Export?.Games?.ToDictionary(
                static pair => pair.Key,
                static pair => (ExportGameDto?)new ExportGameDto
                {
                    PullsArmed = pair.Value.PullsArmed,
                    AchievementsArmed = pair.Value.AchievementsArmed,
                }, StringComparer.Ordinal),
            OutputDirectory = state.Export?.OutputDirectory,
            OutputPaths = state.Export?.OutputPaths?.ToDictionary(static pair => pair.Key, static pair => (string?)pair.Value, StringComparer.Ordinal),
        },
        Preferences = new PreferencesDto
        {
            StayVisibleAfterLaunch = state.Preferences?.StayVisibleAfterLaunch ?? true,
            RefreshContentOnStartup = state.Preferences?.RefreshContentOnStartup ?? true,
            SafeNotifications = state.Preferences?.SafeNotifications ?? true,
            DataDirectory = state.Preferences?.DataDirectory,
            EndfieldInstallRoot = state.Preferences?.EndfieldInstallRoot,
            ManualInstallRoots = state.Preferences?.ManualInstallRoots?.ToDictionary(
                static pair => pair.Key,
                static pair => (string?)pair.Value,
                StringComparer.Ordinal),
            CopiedRedemptionCodes = state.Preferences?.CopiedRedemptionCodes?.ToDictionary(
                static pair => pair.Key,
                static pair => pair.Value?.ToArray(),
                StringComparer.Ordinal),
            FeatureFlags = state.Preferences?.FeatureFlags is null
                ? null
                : new FeatureFlagsDto
                {
                    RemoteBannerManifest = state.Preferences.FeatureFlags.RemoteBannerManifest,
                    AutomaticArt = state.Preferences.FeatureFlags.AutomaticArt,
                    GiPulls = state.Preferences.FeatureFlags.GiPulls,
                    GiAchievements = state.Preferences.FeatureFlags.GiAchievements,
                    HsrPulls = state.Preferences.FeatureFlags.HsrPulls,
                    HsrAchievements = state.Preferences.FeatureFlags.HsrAchievements,
                    ZzzPulls = state.Preferences.FeatureFlags.ZzzPulls,
                    ZzzAchievements = state.Preferences.FeatureFlags.ZzzAchievements,
                    WuWaPulls = state.Preferences.FeatureFlags.WuWaPulls,
                    WuWaAchievements = state.Preferences.FeatureFlags.WuWaAchievements,
                    WuWaAccountStatus = state.Preferences.FeatureFlags.WuWaAccountStatus,
                    HoyoLabAccountAccess = state.Preferences.FeatureFlags.HoyoLabAccountAccess,
                    SkportAccountAccess = state.Preferences.FeatureFlags.SkportAccountAccess,
                    HoyoLabAccountCleanupPending = state.Preferences.FeatureFlags.HoyoLabAccountCleanupPending,
                    SkportAccountCleanupPending = state.Preferences.FeatureFlags.SkportAccountCleanupPending,
                    EndfieldPulls = state.Preferences.FeatureFlags.EndfieldPulls,
                    EndfieldAchievements = state.Preferences.FeatureFlags.EndfieldAchievements,
                },
        },
    };

    private static LauncherFeatureFlags NormalizeFeatureFlags(FeatureFlagsDto? dto) => dto is null
        ? LauncherFeatureFlags.Defaults()
        : new LauncherFeatureFlags
        {
            RemoteBannerManifest = dto.RemoteBannerManifest ?? true,
            AutomaticArt = dto.AutomaticArt ?? true,
            GiPulls = dto.GiPulls ?? true,
            GiAchievements = dto.GiAchievements ?? true,
            HsrPulls = dto.HsrPulls ?? true,
            HsrAchievements = dto.HsrAchievements ?? true,
            ZzzPulls = dto.ZzzPulls ?? false,
            ZzzAchievements = dto.ZzzAchievements ?? false,
            WuWaPulls = dto.WuWaPulls ?? false,
            WuWaAchievements = dto.WuWaAchievements ?? false,
            WuWaAccountStatus = dto.WuWaAccountStatus ?? false,
            HoyoLabAccountAccess = dto.HoyoLabAccountAccess == true
                && dto.HoyoLabAccountCleanupPending != true,
            SkportAccountAccess = dto.SkportAccountAccess == true
                && dto.SkportAccountCleanupPending != true,
            HoyoLabAccountCleanupPending = dto.HoyoLabAccountCleanupPending ?? false,
            SkportAccountCleanupPending = dto.SkportAccountCleanupPending ?? false,
            EndfieldPulls = dto.EndfieldPulls ?? false,
            EndfieldAchievements = dto.EndfieldAchievements ?? false,
        };

    private static string? NullIfWhiteSpace(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;

    private static string NormalizeArtFit(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        "contain" => "contain",
        "fill" => "fill",
        _ => "cover",
    };

    private static string? NormalizeLocalRoot(string? value)
    {
        try
        {
            if (string.IsNullOrEmpty(value)
                || value.Length > 2048
                || !string.Equals(value, value.Trim(), StringComparison.Ordinal)
                || !Path.IsPathFullyQualified(value)
                || value.StartsWith("\\\\", StringComparison.Ordinal)
                || value.StartsWith("\\\\?\\", StringComparison.Ordinal)
                || value.StartsWith("\\\\.\\", StringComparison.Ordinal)
                || value.Length < 3
                || !char.IsAsciiLetter(value[0])
                || value[1] != Path.VolumeSeparatorChar
                || value[2] != Path.DirectorySeparatorChar)
            {
                return null;
            }
            var canonical = Path.TrimEndingDirectorySeparator(Path.GetFullPath(value));
            return string.Equals(canonical, Path.TrimEndingDirectorySeparator(value), StringComparison.OrdinalIgnoreCase)
                ? canonical
                : null;
        }
        catch (Exception exception) when (exception is ArgumentException or IOException or NotSupportedException or PathTooLongException)
        {
            return null;
        }
    }

    private static IReadOnlyDictionary<string, string> NormalizeManualInstallRoots(
        Dictionary<string, string?>? values)
    {
        var normalized = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var pair in values ?? [])
        {
            if (pair.Key is not ("gi" or "hsr" or "zzz" or "wuwa" or "ae")) continue;
            if (NormalizeLocalRoot(pair.Value) is { } root) normalized[pair.Key] = root;
        }
        return new ReadOnlyDictionary<string, string>(normalized);
    }

    private static IReadOnlyDictionary<string, IReadOnlyList<string>> NormalizeCopiedRedemptionCodes(
        Dictionary<string, string[]?>? values)
    {
        var normalized = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
        foreach (var pair in values ?? [])
        {
            if (pair.Key is not ("gi" or "hsr" or "zzz" or "wuwa" or "ae")) continue;
            var codes = (pair.Value ?? [])
                .Where(static code => !string.IsNullOrWhiteSpace(code)
                    && code.Length <= 64
                    && code.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_'))
                .Distinct(StringComparer.Ordinal)
                .Take(100)
                .ToArray();
            if (codes.Length > 0) normalized[pair.Key] = Array.AsReadOnly(codes);
        }
        return new ReadOnlyDictionary<string, IReadOnlyList<string>>(normalized);
    }

    private static string? NormalizePinnedArtFile(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || Path.IsPathRooted(value) || value.Length > 180) return null;
        var parts = value.Replace('\\', '/').Split('/');
        if (parts.Length != 2 || parts[0].Length == 0 || parts[0].Any(character => !char.IsAsciiLetterOrDigit(character) && character != '-')) return null;
        var extension = Path.GetExtension(parts[1]);
        var hash = Path.GetFileNameWithoutExtension(parts[1]);
        return hash.Length == 64
            && hash.All(Uri.IsHexDigit)
            && extension is ".webp" or ".png"
                ? $"{parts[0]}/{hash.ToLowerInvariant()}{extension}"
                : null;
    }

    private sealed class StateDto
    {
        [JsonPropertyName("version")] public int? Version { get; set; }
        [JsonPropertyName("selectedGameId")] public string? SelectedGameId { get; set; }
        [JsonPropertyName("railOrder")] public string[]? RailOrder { get; set; }
        [JsonPropertyName("customGames")] public CustomGameDto?[]? CustomGames { get; set; }
        [JsonPropertyName("appearance")] public Dictionary<string, AppearanceDto?>? Appearance { get; set; }
        [JsonPropertyName("export")] public ExportDto? Export { get; set; }
        [JsonPropertyName("preferences")] public PreferencesDto? Preferences { get; set; }
    }

    private sealed class CustomGameDto
    {
        public string? Id { get; set; }
        public string? Name { get; set; }
        public string? ExecutablePath { get; set; }
        public string? IconPath { get; set; }
        public string? BackgroundPath { get; set; }
        public string? RuntimePath { get; set; }
        public string? RawArguments { get; set; }
        public bool RequestAdministrator { get; set; }
        public long CreationOrder { get; set; }
    }

    private sealed class AppearanceDto
    {
        public string? IconPath { get; set; }
        public string? BackgroundPath { get; set; }
        public bool? AutomaticArt { get; set; }
        public int? ArtScale { get; set; }
        public int? ArtX { get; set; }
        public int? ArtY { get; set; }
        public string? ArtVariant { get; set; }
        public string? ArtFit { get; set; }
        public bool? ArtPinned { get; set; }
        public string? PinnedArtFile { get; set; }
    }

    private sealed class ExportDto
    {
        public bool IsArmed { get; set; }
        public Dictionary<string, ExportGameDto?>? Games { get; set; }
        public string? OutputDirectory { get; set; }
        public Dictionary<string, string?>? OutputPaths { get; set; }
    }

    private sealed class ExportGameDto
    {
        public bool PullsArmed { get; set; }
        public bool AchievementsArmed { get; set; }
    }

    private sealed class PreferencesDto
    {
        public bool? StayVisibleAfterLaunch { get; set; }
        public bool? RefreshContentOnStartup { get; set; }
        public bool? SafeNotifications { get; set; }
        public string? DataDirectory { get; set; }
        public string? EndfieldInstallRoot { get; set; }
        public Dictionary<string, string?>? ManualInstallRoots { get; set; }
        public Dictionary<string, string[]?>? CopiedRedemptionCodes { get; set; }
        public FeatureFlagsDto? FeatureFlags { get; set; }
    }

    private sealed class FeatureFlagsDto
    {
        public bool? RemoteBannerManifest { get; set; }
        // Read and ignore the retired setting so older state files remain valid.
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public bool? OfficialNews { get; set; }
        public bool? AutomaticArt { get; set; }
        public bool? GiPulls { get; set; }
        public bool? GiAchievements { get; set; }
        public bool? HsrPulls { get; set; }
        public bool? HsrAchievements { get; set; }
        public bool? ZzzPulls { get; set; }
        public bool? ZzzAchievements { get; set; }
        public bool? WuWaPulls { get; set; }
        public bool? WuWaAchievements { get; set; }
        public bool? WuWaAccountStatus { get; set; }
        public bool? HoyoLabAccountAccess { get; set; }
        public bool? SkportAccountAccess { get; set; }
        public bool? HoyoLabAccountCleanupPending { get; set; }
        public bool? SkportAccountCleanupPending { get; set; }
        public bool? EndfieldPulls { get; set; }
        public bool? EndfieldAchievements { get; set; }
    }
}
