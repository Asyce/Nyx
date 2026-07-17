using Microsoft.UI.Xaml;
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

namespace Nyx_Desktop_App;

public partial class App : Application
{
    private Window? _window;
    private GameSessionCoordinator? _sessions;
    private GameSessionRefreshPump? _sessionRefresh;
    private LatestContentService? _latestContent;
    private LauncherBannersContentService? _launcherBanners;
    private LauncherCacheService? _cache;
    private LauncherRecoveryService? _recovery;
    private ExportCoordinator? _exports;
    private UserConfirmedExportSignalWaiter? _exportSignals;
    private HoyoPullExportProvider? _pullExports;
    private HoyoPublisherStatusSource? _hoyoPublisherStatus;
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
            GenshinLaunchService);

        var hoyoIdentity = new HoyoGameIdentityAdapter();
        var hoyoDiscovery = new HoyoCurrentUserDiscovery();
        var hoyoLaunchService = new HoyoGameLaunchService(
            new HoyoGameLaunchIdentityValidator(hoyoIdentity),
            new WindowsRunningProcessInspector(),
            new DotNetLaunchProcessStarter());
        HoyoSessions = new Dictionary<string, HoyoGameSessionAdapter>(StringComparer.Ordinal)
        {
            ["hsr"] = new("hsr", hoyoDiscovery, hoyoLaunchService),
            ["zzz"] = new("zzz", hoyoDiscovery, hoyoLaunchService),
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
                wuwaRootLocator.LocateRoot,
                PublisherGameLaunchService),
            ["ae"] = new(
                "ae",
                EndfieldRootStore.Load,
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
        _latestContent = new LatestContentService(File.ReadAllBytes(Path.Combine(
            AppContext.BaseDirectory,
            "Assets",
            "Content",
            "launcher-content-bundled-v1.json")));
        var configuredManifest = Environment.GetEnvironmentVariable("PENGO_NYX_LAUNCHER_MANIFEST_URL");
        var manifestEndpoint = Uri.TryCreate(configuredManifest, UriKind.Absolute, out var configuredEndpoint)
            ? configuredEndpoint
            : null;
        _launcherBanners = new LauncherBannersContentService(
            File.ReadAllBytes(Path.Combine(
                AppContext.BaseDirectory,
                "Assets",
                "Content",
                "launcher-banners-v1.json")),
            Path.Combine(LauncherState.DataDirectory, "ContentCache"),
            manifestEndpoint);
        _pullExports = new HoyoPullExportProvider();
        var achievementHelperPath = Path.Combine(
            AppContext.BaseDirectory,
            "Assets",
            "Tools",
            VerifiedAchievementHelperBoundary.ExpectedHelperFileName);
        _exportSignals = new UserConfirmedExportSignalWaiter();
        _exports = new ExportCoordinator(
            _pullExports,
            new AchievementHelperExportProvider(
                new VerifiedAchievementHelperBoundary(
                    achievementHelperPath,
                    AchievementHelperPackageIdentity.Sha256,
                    new ProcessAchievementHelperRunner())),
            signals: _exportSignals,
            achievementPrepareTimeout: TimeSpan.FromSeconds(30));
        _hoyoPublisherStatus = new HoyoPublisherStatusSource(() => new HoyoLocalVersions(
            GenshinSession.Version,
            HoyoSessions["hsr"].Version,
            HoyoSessions["zzz"].Version));

        _launchStage = "main-window-construction";
        _window = new MainWindow();
        _launchStage = "main-window-event-wiring";
        _window.Activated += Window_Activated;
        _window.Closed += Window_Closed;
        _launchStage = "main-window-activation";
        _window.Activate();
        _launchStage = "background-services";
        _sessionRefresh.Start();
        if (LauncherState.Snapshot.Preferences.RefreshContentOnStartup
            && LauncherState.Snapshot.Preferences.FeatureFlags.OfficialNews)
        {
            _latestContent.Start();
        }
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

    internal ILatestContentSource LatestContent =>
        _latestContent ?? throw new InvalidOperationException("Latest content is not initialized.");

    internal LauncherBannersContentService LauncherBanners =>
        _launcherBanners ?? throw new InvalidOperationException("Launcher banners are not initialized.");

    internal LauncherCacheService Cache =>
        _cache ?? throw new InvalidOperationException("Launcher cache is not initialized.");

    internal ILauncherRecoveryService Recovery =>
        _recovery ?? throw new InvalidOperationException("Launcher recovery is not initialized.");

    internal ExportCoordinator Exports =>
        _exports ?? throw new InvalidOperationException("Export coordinator is not initialized.");

    internal UserConfirmedExportSignalWaiter ExportSignals =>
        _exportSignals ?? throw new InvalidOperationException("Export signals are not initialized.");

    internal HoyoPublisherStatusSource HoyoPublisherStatus =>
        _hoyoPublisherStatus ?? throw new InvalidOperationException("Publisher status is not initialized.");

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

    internal async ValueTask<bool> RediscoverInstallsAsync(CancellationToken cancellationToken = default)
    {
        if (_sessionRefresh is null) return false;
        await _sessionRefresh.RefreshNowAsync(cancellationToken);
        return true;
    }

    internal async ValueTask<bool> RefreshContentAsync(CancellationToken cancellationToken = default)
    {
        if (_latestContent is null || _launcherBanners is null) return false;
        var flags = LauncherState.Snapshot.Preferences.FeatureFlags;
        if (flags.OfficialNews)
        {
            await _latestContent.RefreshAsync(cancellationToken);
        }
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
        if (_latestContent is null || _launcherBanners is null) return;
        var preferences = LauncherState.Snapshot.Preferences;
        _latestContent.SetAutomaticRefreshEnabled(
            preferences.RefreshContentOnStartup && preferences.FeatureFlags.OfficialNews);
        _launcherBanners.SetAutomaticRefreshEnabled(
            preferences.RefreshContentOnStartup && preferences.FeatureFlags.RemoteBannerManifest);
    }

    internal GenshinInspectionAdapter GenshinInspection { get; private set; } = null!;

    internal WindowsGenshinCandidateDiscovery GenshinDiscovery { get; private set; } = null!;

    internal GenshinLaunchService GenshinLaunchService { get; private set; } = null!;

    internal event EventHandler? WindowReactivated;

    internal event EventHandler? EndfieldRootAutoDiscovered;

    private void Window_Activated(object sender, WindowActivatedEventArgs args)
    {
        if (args.WindowActivationState is not WindowActivationState.Deactivated)
        {
            _ = RefreshAfterActivationAsync();
        }
    }

    private void Window_Closed(object sender, WindowEventArgs args)
    {
        SessionUiLifetime.Terminate();
        Interlocked.Exchange(ref _endfieldDiscoveryCancellation, null)?.Cancel();

        if (_window is not null)
        {
            _window.Activated -= Window_Activated;
            _window.Closed -= Window_Closed;
        }

        _sessionRefresh?.Stop();
        _sessions?.Shutdown();
        if (_sessionRefresh is not null)
        {
            _ = DisposeRefreshAsync(_sessionRefresh);
        }

        if (_latestContent is not null)
        {
            _ = DisposeLatestContentAsync(_latestContent);
        }

        if (_launcherBanners is not null)
        {
            _ = DisposeLauncherBannersAsync(_launcherBanners);
        }

        if (_exports is not null)
        {
            _ = DisposeExportsAsync(_exports, _pullExports);
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

    private static async Task DisposeLatestContentAsync(LatestContentService latestContent)
    {
        try
        {
            await latestContent.DisposeAsync();
        }
        catch (Exception)
        {
            // Content is optional and owns no launch or maintenance state.
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
            // Remote art and news are optional and own no launch state.
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

    private static async Task DisposeExportsAsync(
        ExportCoordinator exports,
        HoyoPullExportProvider? pulls)
    {
        try { await exports.DisposeAsync(); }
        catch (Exception) { }
        pulls?.Dispose();
    }
}
