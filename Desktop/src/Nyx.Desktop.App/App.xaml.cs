using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Nyx.Desktop.Core.AccountStatus;
using Nyx.Desktop.Core.Content;
using Nyx.Desktop.Core.Recovery;
using Nyx.Desktop.Core.Exports;
using Nyx.Desktop.Core.Games;
using Nyx.Desktop.Core.Launching;
using Nyx.Desktop.Core.PublisherMaintenance;
using Nyx.Desktop.Core.Sessions;
using Nyx.Desktop.Infrastructure.Genshin;
using Nyx.Desktop.Infrastructure.Games;
using Nyx.Desktop.Infrastructure.Content;
using Nyx.Desktop.Infrastructure.Cache;
using Nyx.Desktop.Infrastructure.Exports;
using Nyx.Desktop.Infrastructure.Hoyo;
using Nyx.Desktop.Infrastructure.Launching;
using Nyx.Desktop.Infrastructure.PublisherMaintenance;
using Nyx.Desktop.Infrastructure.PublisherGames;
using Nyx.Desktop.Infrastructure.Sessions;
using Nyx.Desktop.Infrastructure.Recovery;
using Nyx.Desktop.Infrastructure.State;
using Nyx.Desktop.Infrastructure.AccountStatus;

namespace Nyx_Desktop_App;

public partial class App : Application
{
    private Window? _window;
    private GameSessionCoordinator? _sessions;
    private GameSessionRefreshPump? _sessionRefresh;
    private LauncherBannersContentService? _launcherBanners;
    private LauncherCacheService? _cache;
    private LauncherRecoveryService? _recovery;
    private ExportCoordinator? _exports;
    private HoyoPullExportProvider? _pullExports;
    private HoyoPublisherStatusSource? _hoyoPublisherStatus;
    private WuWaAccountStatusService? _wuwaAccountStatus;
    private PublisherAccountService? _publisherAccounts;
    private bool _accountShutdownStarted;
    private bool _accountShutdownComplete;
    private CancellationTokenSource? _endfieldDiscoveryCancellation;
    private string? _diagnosticsRoot;
    private string _launchStage = "app-construction";

    public App()
    {
        InitializeComponent();
        UnhandledException += App_UnhandledException;
    }

    private void App_UnhandledException(object sender, Microsoft.UI.Xaml.UnhandledExceptionEventArgs e)
    {
        try
        {
            // Do not create the canonical root from the crash path. It becomes
            // available only after legacy migration and root auditing succeed.
            var folder = _diagnosticsRoot;
            if (folder is null) return;
            Directory.CreateDirectory(folder);
            // Keep this file useful for support without copying user paths,
            // account data, or exception text that may contain them.
            File.WriteAllText(
                Path.Combine(folder, "last-crash.txt"),
                $"{DateTimeOffset.UtcNow:O}\nlaunch-stage: {_launchStage}\n{FormatSafeExceptionChain(e.Exception)}");
        }
        catch (Exception)
        {
            // Crash diagnostics must never replace the original failure.
        }
    }

    private static string FormatSafeExceptionChain(Exception exception)
    {
        var lines = new List<string>();
        for (var current = exception; current is not null && lines.Count < 5; current = current.InnerException)
        {
            lines.Add($"exception-{lines.Count}: {current.GetType().Name} hresult=0x{current.HResult:X8}");
        }
        return string.Join('\n', lines);
    }

    internal static void SetLaunchStage(string stage)
    {
        if (Current is App app)
        {
            app._launchStage = stage;
        }
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _launchStage = "state-initialization";
        var stateStore = new LauncherStateStore();
        LauncherState = new LauncherStateController(stateStore);
        _diagnosticsRoot = Path.Combine(LauncherState.DataDirectory, "Diagnostics");
        _cache = new LauncherCacheService(LauncherState.DataDirectory);
        _recovery = new LauncherRecoveryService(
            stateStore,
            _cache,
            rediscoverInstalls: RediscoverInstallsAsync,
            retryContent: RefreshContentAsync);
        GenshinInspection = new GenshinInspectionAdapter(
            new WindowsAuthenticodeExecutableMetadataReader());
        GenshinDiscovery = new WindowsGenshinCandidateDiscovery(
            new WindowsMachineGenshinRegistryReader(),
            new GenshinInspectionCandidateInspector(GenshinInspection));
        GenshinLaunchService = new GenshinLaunchService(
            new GenshinLaunchIdentityValidator(GenshinInspection),
            new WindowsRunningProcessInspector(),
            new DotNetLaunchProcessStarter());
        GenshinSession = new GenshinGameSessionAdapter(
            GenshinDiscovery,
            GenshinInspection,
            GenshinLaunchService,
            () => GetManualInstallRoot("gi"));

        var hoyoIdentity = new HoyoGameIdentityAdapter();
        var hoyoDiscovery = new HoyoCurrentUserDiscovery();
        var hoyoLaunchService = new HoyoGameLaunchService(
            new HoyoGameLaunchIdentityValidator(hoyoIdentity),
            new WindowsRunningProcessInspector(),
            new DotNetLaunchProcessStarter());
        HoyoSessions = new Dictionary<string, HoyoGameSessionAdapter>(StringComparer.Ordinal)
        {
            ["hsr"] = new("hsr", hoyoDiscovery, hoyoLaunchService, () => GetManualInstallRoot("hsr"), hoyoIdentity),
            ["zzz"] = new("zzz", hoyoDiscovery, hoyoLaunchService, () => GetManualInstallRoot("zzz"), hoyoIdentity),
        };
        HoyoPlayExecutor = new HoyoPlayHandoffExecutor();
        WuWaMaintenance = new WuWaMaintenanceService();
        PublisherGameLaunchService = PublisherGameDirectLaunchFactory.Create();
        EndfieldRootStore = new EndfieldInstallRootStore(
            read: () => LauncherState.Snapshot.Preferences.EndfieldInstallRoot,
            write: root => LauncherState.TryUpdate(state => state with
            {
                Preferences = state.Preferences with { EndfieldInstallRoot = root },
            }),
            writeIfEmpty: root =>
            {
                var stored = false;
                var updated = LauncherState.TryUpdate(state =>
                {
                    if (state.Preferences.EndfieldInstallRoot is not null) return state;
                    stored = true;
                    return state with
                    {
                        Preferences = state.Preferences with { EndfieldInstallRoot = root },
                    };
                });
                return updated && stored;
            },
            remove: () => LauncherState.TryUpdate(state => state with
            {
                Preferences = state.Preferences with { EndfieldInstallRoot = null },
            }));
        var wuwaRootLocator = new WuWaInstallRootLocator();
        EndfieldMaintenance = new EndfieldOfficialMaintenanceService(EndfieldRootStore);
        PublisherGameSessions = new Dictionary<string, PublisherGameSessionAdapter>(StringComparer.Ordinal)
        {
            ["wuwa"] = new(
                "wuwa",
                () => GetManualInstallRoot("wuwa") ?? wuwaRootLocator.LocateRoot(),
                PublisherGameLaunchService),
            ["ae"] = new(
                "ae",
                () => GetManualInstallRoot("ae") ?? EndfieldRootStore.Load(),
                PublisherGameLaunchService),
        };

        var officialAdapters = GameCatalog.All.Select<Nyx.Desktop.Core.Games.GameDefinition, IGameSessionAdapter>(game =>
            game.Id switch
            {
                "gi" => GenshinSession,
                "hsr" or "zzz" => HoyoSessions[game.Id],
                "wuwa" or "ae" => PublisherGameSessions[game.Id],
                _ => throw new InvalidOperationException($"No session adapter exists for '{game.Id}'."),
            });
        var customAdapters = LauncherState.Snapshot.CustomGames
            // Keep invalid or moved definitions registered as repair-only
            // sessions. Their adapter revalidates on every observation and
            // launch, so they can report NeedsReview but can never dispatch.
            .Select(static game => CustomGameSessionFactory.Create(game))
            .Cast<IGameSessionAdapter>();
        var adapters = officialAdapters.Concat(customAdapters);
        _sessions = new GameSessionCoordinator(adapters);
        _sessionRefresh = new GameSessionRefreshPump(_sessions);
        var configuredManifest = Environment.GetEnvironmentVariable("PENGO_NYX_LAUNCHER_MANIFEST_URL");
        var manifestEndpoint = Uri.TryCreate(configuredManifest, UriKind.Absolute, out var configuredEndpoint)
            ? configuredEndpoint
            : null;
        var configuredCodes = Environment.GetEnvironmentVariable("PENGO_NYX_LAUNCHER_CODES_URL");
        var codesEndpoint = Uri.TryCreate(configuredCodes, UriKind.Absolute, out var configuredCodesEndpoint)
            ? configuredCodesEndpoint
            : null;
        _launcherBanners = new LauncherBannersContentService(
            File.ReadAllBytes(Path.Combine(
                AppContext.BaseDirectory,
                "Assets",
                "Content",
                "launcher-banners-v1.json")),
            Path.Combine(LauncherState.DataDirectory, "ContentCache"),
            manifestEndpoint,
            codesEndpoint: codesEndpoint);
        _pullExports = new HoyoPullExportProvider();
        var achievementHelperPath = Path.Combine(
            AppContext.BaseDirectory,
            "Assets",
            "Tools",
            VerifiedAchievementHelperBoundary.ExpectedHelperFileName);
        _exports = new ExportCoordinator(
            _pullExports,
            new AchievementHelperExportProvider(
                new VerifiedAchievementHelperBoundary(
                    achievementHelperPath,
                    AchievementHelperPackageIdentity.Sha256,
                    new ProcessAchievementHelperRunner())),
            achievementPrepareTimeout: TimeSpan.FromSeconds(30));
        _hoyoPublisherStatus = new HoyoPublisherStatusSource(() => new HoyoLocalVersions(
            GenshinSession.Version,
            HoyoSessions["hsr"].Version,
            HoyoSessions["zzz"].Version));
        _wuwaAccountStatus = new WuWaAccountStatusService();
        var accountFlags = LauncherState.Snapshot.Preferences.FeatureFlags;
        _publisherAccounts = new PublisherAccountService(
            Path.Combine(LauncherState.DataDirectory, "PublisherProfiles"),
            accountFlags.HoyoLabAccountAccess,
            accountFlags.SkportAccountAccess,
            accountFlags.HoyoLabAccountCleanupPending,
            accountFlags.SkportAccountCleanupPending);
        LauncherState.Changed += LauncherState_Changed;
        _ = RecoverPendingPublisherRevocationsAsync();

        _launchStage = "main-window-construction";
        _window = new MainWindow();
        _launchStage = "main-window-event-wiring";
        _window.Activated += Window_Activated;
        _window.Closed += Window_Closed;
        _window.AppWindow.Closing += AppWindow_Closing;
        _launchStage = "main-window-activation";
        _window.Activate();
        _launchStage = "background-services";
        _sessionRefresh.Start();
        if (LauncherState.Snapshot.Preferences.RefreshContentOnStartup
            && LauncherState.Snapshot.Preferences.FeatureFlags.RemoteBannerManifest)
        {
            _launcherBanners.Start();
        }
        StartEndfieldSiblingDiscovery(wuwaRootLocator);
        _launchStage = "running";
    }

    private void StartEndfieldSiblingDiscovery(WuWaInstallRootLocator wuwaRootLocator)
    {
        var cancellation = new CancellationTokenSource();
        _endfieldDiscoveryCancellation = cancellation;
        _ = DiscoverEndfieldSiblingAfterActivationAsync(
            wuwaRootLocator,
            cancellation.Token);
    }

    private async Task DiscoverEndfieldSiblingAfterActivationAsync(
        WuWaInstallRootLocator wuwaRootLocator,
        CancellationToken cancellationToken)
    {
        EndfieldSiblingDiscoveryResult result;
        try
        {
            result = await Task.Run(
                () => TryDiscoverEndfieldSibling(wuwaRootLocator, cancellationToken),
                cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return;
        }
        catch (Exception)
        {
            // Automatic discovery is optional. The bounded folder picker remains.
            return;
        }

        if (result.Status is not EndfieldSiblingDiscoveryStatus.Saved
            || cancellationToken.IsCancellationRequested
            || _sessionRefresh is null)
        {
            return;
        }

        EndfieldRootAutoDiscovered?.Invoke(this, EventArgs.Empty);

        try
        {
            await _sessionRefresh.RefreshNowAsync(cancellationToken);
        }
        catch (Exception) when (cancellationToken.IsCancellationRequested)
        {
            // Closing the window cancels optional discovery and its UI refresh.
        }
        catch (Exception)
        {
            // The periodic observer will retry. A saved root remains only a hint.
        }
    }

    private EndfieldSiblingDiscoveryResult TryDiscoverEndfieldSibling(
        WuWaInstallRootLocator wuwaRootLocator,
        CancellationToken cancellationToken)
    {
        var existingRoot = EndfieldRootStore.Load();
        if (existingRoot is not null)
        {
            return new(
                EndfieldSiblingDiscoveryStatus.ExistingRoot,
                existingRoot);
        }

        try
        {
            var wuwaRoot = wuwaRootLocator.LocateRoot();
            if (wuwaRoot is not null
                && PublisherGameLaunchService.CheckGame("wuwa", wuwaRoot).Status
                    is not PublisherGameLaunchStatus.Ready
                    and not PublisherGameLaunchStatus.Running)
            {
                wuwaRoot = null;
            }

            var genshinGameRoot = GenshinDiscovery.Discover().GameRoot;
            return new EndfieldSiblingDiscoveryPolicy().DiscoverAndSave(
                existingEndfieldRoot: null,
                validatedWuWaRoot: wuwaRoot,
                validatedGenshinGameRoot: genshinGameRoot,
                checkEndfield: candidate => PublisherGameLaunchService.CheckGame("ae", candidate),
                save: EndfieldRootStore.TrySaveIfEmpty,
                cancellationToken: cancellationToken);
        }
        catch (Exception)
        {
            // Automatic discovery is optional. The bounded folder picker remains.
            return new(EndfieldSiblingDiscoveryStatus.Uncertain);
        }
    }

    internal GameSessionCoordinator Sessions =>
        _sessions ?? throw new InvalidOperationException("Session coordinator is not initialized.");

    internal GameSessionRefreshPump SessionRefresh =>
        _sessionRefresh ?? throw new InvalidOperationException("Session refresh is not initialized.");

    internal SessionUiLifetime SessionUiLifetime { get; } = new();

    internal LauncherBannersContentService LauncherBanners =>
        _launcherBanners ?? throw new InvalidOperationException("Launcher banners are not initialized.");

    internal LauncherCacheService Cache =>
        _cache ?? throw new InvalidOperationException("Launcher cache is not initialized.");

    internal ILauncherRecoveryService Recovery =>
        _recovery ?? throw new InvalidOperationException("Launcher recovery is not initialized.");

    internal ExportCoordinator Exports =>
        _exports ?? throw new InvalidOperationException("Export coordinator is not initialized.");

    internal HoyoPublisherStatusSource HoyoPublisherStatus =>
        _hoyoPublisherStatus ?? throw new InvalidOperationException("Publisher status is not initialized.");

    internal WuWaAccountStatusService WuWaAccountStatus =>
        _wuwaAccountStatus ?? throw new InvalidOperationException("Wuthering Waves account status is not initialized.");

    internal PublisherAccountService PublisherAccounts =>
        _publisherAccounts ?? throw new InvalidOperationException("Publisher account service is not initialized.");

    internal GenshinGameSessionAdapter GenshinSession { get; private set; } = null!;

    internal LauncherStateController LauncherState { get; private set; } = null!;

    internal IReadOnlyDictionary<string, HoyoGameSessionAdapter> HoyoSessions { get; private set; } =
        null!;

    internal HoyoPlayHandoffExecutor HoyoPlayExecutor { get; private set; } = null!;

    internal WuWaMaintenanceService WuWaMaintenance { get; private set; } = null!;

    internal PublisherGameDirectLaunchService PublisherGameLaunchService { get; private set; } = null!;

    internal EndfieldInstallRootStore EndfieldRootStore { get; private set; } = null!;

    internal EndfieldOfficialMaintenanceService EndfieldMaintenance { get; private set; } = null!;

    internal IReadOnlyDictionary<string, PublisherGameSessionAdapter> PublisherGameSessions
    {
        get;
        private set;
    } = null!;

    internal nint WindowHandle => _window is null
        ? throw new InvalidOperationException("The Nyx window is not initialized.")
        : WinRT.Interop.WindowNative.GetWindowHandle(_window);

    internal void MinimizeWindow()
    {
        if (_window is MainWindow mainWindow) mainWindow.Minimize();
    }

    internal void BeginWindowDrag()
    {
        if (_window is MainWindow mainWindow) mainWindow.BeginDrag();
    }

    internal async ValueTask<bool> RediscoverInstallsAsync(CancellationToken cancellationToken = default)
    {
        if (_sessionRefresh is null) return false;
        await _sessionRefresh.RefreshNowAsync(cancellationToken);
        return true;
    }

    internal async ValueTask<bool> RefreshContentAsync(CancellationToken cancellationToken = default)
    {
        if (_launcherBanners is null) return false;
        var flags = LauncherState.Snapshot.Preferences.FeatureFlags;
        if (flags.RemoteBannerManifest)
        {
            await _launcherBanners.RefreshManualAsync(cancellationToken);
        }
        return true;
    }

    internal async Task RefreshContentManualAsync(CancellationToken cancellationToken = default)
    {
        await RefreshContentAsync(cancellationToken);
    }

    internal void ApplyContentRefreshPreferences()
    {
        if (_launcherBanners is null) return;
        var preferences = LauncherState.Snapshot.Preferences;
        _launcherBanners.SetAutomaticRefreshEnabled(
            preferences.RefreshContentOnStartup && preferences.FeatureFlags.RemoteBannerManifest);
    }

    internal GenshinInspectionAdapter GenshinInspection { get; private set; } = null!;

    internal WindowsGenshinCandidateDiscovery GenshinDiscovery { get; private set; } = null!;

    internal GenshinLaunchService GenshinLaunchService { get; private set; } = null!;

    internal event EventHandler? WindowReactivated;

    internal event EventHandler? EndfieldRootAutoDiscovered;

    private string? GetManualInstallRoot(string gameId) =>
        LauncherState.Snapshot.Preferences.ManualInstallRoots.TryGetValue(gameId, out var root)
            ? root
            : null;

    private void Window_Activated(object sender, WindowActivatedEventArgs args)
    {
        if (args.WindowActivationState is not WindowActivationState.Deactivated)
        {
            _ = RefreshAfterActivationAsync();
        }
    }

    private void LauncherState_Changed(object? sender, EventArgs e)
    {
        var flags = LauncherState.Snapshot.Preferences.FeatureFlags;
        _publisherAccounts?.ApplyConsentSnapshot(
            flags.HoyoLabAccountAccess,
            flags.SkportAccountAccess,
            flags.HoyoLabAccountCleanupPending,
            flags.SkportAccountCleanupPending);
    }

    private async Task RecoverPendingPublisherRevocationsAsync()
    {
        var accounts = _publisherAccounts;
        if (accounts is null) return;
        foreach (var provider in new[] { "HoYoLAB", "SKPORT" })
        {
            try
            {
                if (!accounts.HasPendingConsentRevocation(provider)) continue;
                if (!TryPersistPublisherConsent(provider, enabled: false, cleanupPending: true))
                    continue;
                var result = await accounts.RetryPendingConsentRevocationAsync(provider);
                if (result != PublisherConnectionState.NotConnected) continue;
                if (!accounts.CompleteConsentRevocation(provider)) continue;
                TryPersistPublisherConsent(provider, enabled: false, cleanupPending: false);
            }
            catch (OperationCanceledException)
            {
            }
            catch (ObjectDisposedException)
            {
            }
        }
    }

    private bool TryPersistPublisherConsent(
        string provider,
        bool enabled,
        bool cleanupPending) =>
        LauncherState.TryUpdate(state => state with
        {
            Preferences = state.Preferences with
            {
                FeatureFlags = provider switch
                {
                    "HoYoLAB" => state.Preferences.FeatureFlags with
                    {
                        HoyoLabAccountAccess = enabled,
                        HoyoLabAccountCleanupPending = cleanupPending,
                    },
                    "SKPORT" => state.Preferences.FeatureFlags with
                    {
                        SkportAccountAccess = enabled,
                        SkportAccountCleanupPending = cleanupPending,
                    },
                    _ => state.Preferences.FeatureFlags,
                },
            },
        });

    private void AppWindow_Closing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        if (_accountShutdownComplete) return;
        args.Cancel = true;
        if (_accountShutdownStarted) return;
        _accountShutdownStarted = true;
        sender.Hide();
        SessionUiLifetime.Terminate();
        Interlocked.Exchange(ref _endfieldDiscoveryCancellation, null)?.Cancel();
        _sessionRefresh?.Stop();
        _sessions?.Shutdown();
        _ = ShutDownAccountsAndCloseAsync();
    }

    private async Task ShutDownAccountsAndCloseAsync()
    {
        var wuwaAccountShutdown = _wuwaAccountStatus is null
            ? Task.CompletedTask
            : DisposeWuWaAccountStatusAsync(_wuwaAccountStatus);
        var publisherAccountShutdown = _publisherAccounts is null
            ? Task.CompletedTask
            : DisposePublisherAccountsAsync(_publisherAccounts);
        var exportShutdown = _exports is null
            ? Task.CompletedTask
            : DisposeExportsAsync(_exports, _pullExports);
        await Task.WhenAll(wuwaAccountShutdown, publisherAccountShutdown);
        await exportShutdown;
        _exports = null;
        _pullExports = null;
        _accountShutdownComplete = true;
        _window?.Close();
    }

    private void Window_Closed(object sender, WindowEventArgs args)
    {
        LauncherState.Changed -= LauncherState_Changed;
        SessionUiLifetime.Terminate();
        Interlocked.Exchange(ref _endfieldDiscoveryCancellation, null)?.Cancel();

        if (_window is not null)
        {
            _window.Activated -= Window_Activated;
            _window.Closed -= Window_Closed;
            _window.AppWindow.Closing -= AppWindow_Closing;
        }

        _sessionRefresh?.Stop();
        _sessions?.Shutdown();
        if (_sessionRefresh is not null)
        {
            _ = DisposeRefreshAsync(_sessionRefresh);
        }

        if (_launcherBanners is not null)
        {
            _ = DisposeLauncherBannersAsync(_launcherBanners);
        }

        if (_hoyoPublisherStatus is not null)
        {
            _ = DisposePublisherStatusAsync(_hoyoPublisherStatus);
        }

    }

    private async Task RefreshAfterActivationAsync()
    {
        WindowReactivated?.Invoke(this, EventArgs.Empty);

        try
        {
            // Ordinary focus changes are not a system resume. Preserve the two
            // separated absence samples used to prove that a game really closed.
            await SessionRefresh.RefreshNowAsync();
        }
        catch (Exception)
        {
            // Session state remains fail-closed. The periodic observer can try again.
        }

    }

    private static async Task DisposeRefreshAsync(GameSessionRefreshPump refresh)
    {
        try
        {
            await refresh.DisposeAsync();
        }
        catch (Exception)
        {
            // Shutdown already blocked new coordinator work.
        }
    }

    private static async Task DisposeLauncherBannersAsync(LauncherBannersContentService launcherBanners)
    {
        try
        {
            await launcherBanners.DisposeAsync();
        }
        catch (Exception)
        {
            // Remote banners, codes, and art are optional and own no launch state.
        }
    }

    private static async Task DisposePublisherStatusAsync(HoyoPublisherStatusSource publisherStatus)
    {
        try
        {
            await publisherStatus.DisposeAsync();
        }
        catch (Exception)
        {
            // Publisher status is advisory and cannot keep the app alive.
        }
    }

    private static async Task DisposeWuWaAccountStatusAsync(WuWaAccountStatusService accountStatus)
    {
        try
        {
            await accountStatus.DisposeAsync();
        }
        catch (Exception)
        {
            // Account status is optional and never owns launch state.
        }
    }

    private static async Task DisposePublisherAccountsAsync(PublisherAccountService publisherAccounts)
    {
        try
        {
            await publisherAccounts.DisposeAsync();
        }
        catch (Exception)
        {
            // Publisher browser sessions are optional and never own launch state.
        }
    }

    private static async Task DisposeExportsAsync(
        ExportCoordinator exports,
        HoyoPullExportProvider? pulls)
    {
        try { await exports.DisposeAsync(); }
        catch (Exception) { }
        pulls?.Dispose();
    }
}
