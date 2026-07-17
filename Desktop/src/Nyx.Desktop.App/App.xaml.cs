using Microsoft.UI.Xaml;
using Windows.Storage;
using Nyx.Desktop.Core.Content;
using Nyx.Desktop.Core.Games;
using Nyx.Desktop.Core.Launching;
using Nyx.Desktop.Core.PublisherMaintenance;
using Nyx.Desktop.Core.Sessions;
using Nyx.Desktop.Infrastructure.Genshin;
using Nyx.Desktop.Infrastructure.Content;
using Nyx.Desktop.Infrastructure.Hoyo;
using Nyx.Desktop.Infrastructure.Launching;
using Nyx.Desktop.Infrastructure.PublisherMaintenance;
using Nyx.Desktop.Infrastructure.PublisherGames;
using Nyx.Desktop.Infrastructure.Sessions;

namespace Nyx_Desktop_App;

public partial class App : Application
{
    private Window? _window;
    private GameSessionCoordinator? _sessions;
    private GameSessionRefreshPump? _sessionRefresh;
    private LatestContentService? _latestContent;
    private HoyoPublisherStatusSource? _hoyoPublisherStatus;
    private CancellationTokenSource? _endfieldDiscoveryCancellation;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
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
            ApplicationData.Current.LocalSettings.Values);
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

        var adapters = GameCatalog.All.Select<Nyx.Desktop.Core.Games.GameDefinition, IGameSessionAdapter>(game =>
            game.Id switch
            {
                "gi" => GenshinSession,
                "hsr" or "zzz" => HoyoSessions[game.Id],
                "wuwa" or "ae" => PublisherGameSessions[game.Id],
                _ => throw new InvalidOperationException($"No session adapter exists for '{game.Id}'."),
            });
        _sessions = new GameSessionCoordinator(adapters);
        _sessionRefresh = new GameSessionRefreshPump(_sessions);
        _latestContent = new LatestContentService(File.ReadAllBytes(Path.Combine(
            AppContext.BaseDirectory,
            "Assets",
            "Content",
            "launcher-content-bundled-v1.json")));
        _hoyoPublisherStatus = new HoyoPublisherStatusSource(() => new HoyoLocalVersions(
            GenshinSession.Version,
            HoyoSessions["hsr"].Version,
            HoyoSessions["zzz"].Version));

        _window = new MainWindow();
        _window.Activated += Window_Activated;
        _window.Closed += Window_Closed;
        _window.Activate();
        _sessionRefresh.Start();
        _latestContent.Start();
        StartEndfieldSiblingDiscovery(wuwaRootLocator);
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

    internal HoyoPublisherStatusSource HoyoPublisherStatus =>
        _hoyoPublisherStatus ?? throw new InvalidOperationException("Publisher status is not initialized.");

    internal GenshinGameSessionAdapter GenshinSession { get; private set; } = null!;

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
}
