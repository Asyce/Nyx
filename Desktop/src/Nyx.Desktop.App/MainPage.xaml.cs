using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.ApplicationModel.DataTransfer;
using Windows.UI.Text;
using Windows.Storage.Pickers;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using Nyx.Desktop.Core.Content;
using Nyx.Desktop.Core.AccountStatus;
using Nyx.Desktop.Core.Diagnostics;
using Nyx.Desktop.Core.Exports;
using Nyx.Desktop.Core.Features;
using Nyx.Desktop.Core.Games;
using Nyx.Desktop.Core.Genshin;
using Nyx.Desktop.Core.Hoyo;
using Nyx.Desktop.Core.Launching;
using Nyx.Desktop.Core.PublisherMaintenance;
using Nyx.Desktop.Core.PublisherGames;
using Nyx.Desktop.Core.Recovery;
using Nyx.Desktop.Core.Sessions;
using Nyx.Desktop.Core.State;
using Nyx.Desktop.Infrastructure.Genshin;
using Nyx.Desktop.Infrastructure.Games;
using Nyx.Desktop.Infrastructure.Content;
using Nyx.Desktop.Infrastructure.AccountStatus;
using Nyx.Desktop.Infrastructure.Hoyo;
using Nyx.Desktop.Infrastructure.PublisherMaintenance;
using Nyx.Desktop.Infrastructure.PublisherGames;
using Nyx.Desktop.Infrastructure.Sessions;
using Nyx_Desktop_App.ViewModels;
using Windows.Networking.Connectivity;

namespace Nyx_Desktop_App;

public sealed partial class MainPage : Page
{
    private const double PublisherAccountStatusLayoutHeight = 60d;
    private const int WuWaLaunchObservationCount = 6;
    private const int EndfieldLaunchObservationCount = 6;
    private static readonly TimeSpan WuWaLaunchObservationInterval =
        TimeSpan.FromMilliseconds(500);

    private static readonly IReadOnlyDictionary<string, string> IconPaths =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["gi"] = "ms-appx:///Assets/Catalog/giicon.png",
            ["hsr"] = "ms-appx:///Assets/Catalog/hsricon.png",
            ["zzz"] = "ms-appx:///Assets/Catalog/zzzicon.png",
            ["wuwa"] = "ms-appx:///Assets/Catalog/wuwaicon.png",
            ["ae"] = "ms-appx:///Assets/Catalog/aeicon.png",
        };

    private static readonly IReadOnlyDictionary<string, string> HeroArtPaths =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["gi"] = "ms-appx:///Assets/Iris/gi-hero.png",
            ["hsr"] = "ms-appx:///Assets/Iris/hsr-hero.png",
            ["zzz"] = "ms-appx:///Assets/Iris/zzz-hero.png",
            ["wuwa"] = "ms-appx:///Assets/Iris/wuwa-hero.png",
            ["ae"] = "ms-appx:///Assets/Iris/ae-hero.png",
        };

    private static readonly IReadOnlyDictionary<string, HeroPresentation> HeroPresentations =
        new Dictionary<string, HeroPresentation>(StringComparer.Ordinal)
        {
            ["gi"] = new(1, 0, 0, 0.30, 0.62),
            ["hsr"] = new(1, 0, 0, 0.24, 0.54),
            ["zzz"] = new(1, 0, 0, 0.32, 0.64),
            ["wuwa"] = new(1, 0, 0, 0.22, 0.50),
            ["ae"] = new(1, 0, 0, 0.28, 0.58),
        };

    private static readonly IReadOnlyDictionary<string, string> MaintenanceProviders =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["gi"] = "HoYoPlay",
            ["hsr"] = "HoYoPlay",
            ["zzz"] = "HoYoPlay",
            ["wuwa"] = "KURO GAMES",
            ["ae"] = "GRYPHLINK",
        };

    private static readonly IReadOnlyDictionary<GameRailSignalKind, string> RailSignalGlyphs =
        new Dictionary<GameRailSignalKind, string>
        {
            [GameRailSignalKind.Checking] = "⋯",
            [GameRailSignalKind.Ready] = "●",
            [GameRailSignalKind.Starting] = "◐",
            [GameRailSignalKind.Running] = "▶",
            [GameRailSignalKind.UpdateAndPreDownload] = "✦",
            [GameRailSignalKind.UpdateAvailable] = "↑",
            [GameRailSignalKind.PreDownloadAvailable] = "↓",
            [GameRailSignalKind.RetryAvailable] = "!",
            [GameRailSignalKind.NeedsReview] = "!",
            [GameRailSignalKind.NotFound] = "○",
            [GameRailSignalKind.Unsupported] = "○",
        };

    private readonly GameSessionCoordinator sessions;
    private readonly GameSessionRefreshPump sessionRefresh;
    private readonly SessionUiLifetime sessionUiLifetime;
    private readonly LauncherBannersContentService launcherBanners;
    private readonly ExportCoordinator exports;
    private readonly HoyoPublisherStatusSource publisherStatus;
    private readonly WuWaAccountStatusService wuwaAccountStatus;
    private readonly PublisherAccountService publisherAccounts;
    private readonly GenshinGameSessionAdapter genshinSession;
    private readonly IReadOnlyDictionary<string, HoyoGameSessionAdapter> hoyoSessions;
    private readonly HoyoPlayHandoffExecutor hoyoPlayExecutor;
    private readonly WuWaMaintenanceService wuwaMaintenance;
    private readonly PublisherGameDirectLaunchService publisherGameLaunchService;
    private readonly EndfieldInstallRootStore endfieldRootStore;
    private readonly EndfieldOfficialMaintenanceService endfieldMaintenance;
    private readonly App app;
    private readonly LauncherStateController launcherState;
    private readonly UserAssetStore userAssets;
    private readonly WindowsGenshinCandidateDiscovery discovery;
    private readonly GenshinInspectionAdapter genshinInspection;
    private readonly HoyoGameIdentityAdapter hoyoIdentity = new();
    private string? updaterRoot;
    private GameSessionSnapshot? gameSnapshot;
    private GenshinLaunchStatus? updaterStatus;
    private GenshinLaunchFailureReason gameFailureReason;
    private bool updaterScanFinished;
    private bool wuwaScanFinished;
    private readonly HashSet<string> gameActionsInFlight = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Guid> latestExportJobs = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (string Revision, string VariantId)> automaticArtVariants = new(StringComparer.Ordinal);
    private string? lastArtSelectionGameId;
    private string? displayedHeroSource;
    private string? displayedBackgroundSource;
    private bool updaterActionInFlight;
    private bool wuwaActionInFlight;
    private bool endfieldFolderActionInFlight;
    private bool endfieldMaintenanceScanFinished;
    private bool endfieldMaintenanceActionInFlight;
    private bool wuwaAccountStatusActionInFlight;
    private bool wuwaAccountInitialRefreshRequested;
    private bool wuwaAccountStatusSessionDisabled;
    private bool wuwaAccountStatusSaveFailed;
    private bool publisherAccountActionInFlight;
    private readonly HashSet<string> publisherConsentSaveFailures = new(StringComparer.Ordinal);
    private readonly HashSet<string> publisherConsentCleanupFailures = new(StringComparer.Ordinal);
    private int wuwaAccountStatusUiGeneration;
    private EndfieldOfficialMaintenanceStatus? endfieldMaintenanceStatus;
    private PublisherGameInspectionReason endfieldMaintenanceReason;
    private WuWaOfficialMaintenanceStatus? wuwaMaintenanceStatus;
    private PublisherGameInspectionReason wuwaMaintenanceReason;
    private OfficialMaintenanceHandoffRequest? wuwaMaintenanceRequest;
    private bool refreshSubscribed;
    private bool launcherBannersSubscribed;
    private bool publisherStatusSubscribed;
    private bool publisherAccountsSubscribed;
    private bool selectorSubscribed;
    private bool reactivationSubscribed;
    private bool networkStatusSubscribed;
    private bool endfieldRootDiscoverySubscribed;
    private int networkAvailability = -1;
    private int networkContentRefreshInFlight;
    private int networkRefreshGeneration;
    private int hoyoRefreshGeneration;
    private readonly LatestGenerationGate wuwaRefreshGeneration = new();
    private readonly LatestGenerationGate endfieldMaintenanceGeneration = new();
    private readonly EndfieldFolderSelectionPolicy endfieldFolderSelections = new();
    private readonly EndfieldUiActionAdmission endfieldUiActions = new();
    private readonly DispatcherTimer bannerRotationTimer = new() { Interval = TimeSpan.FromSeconds(7) };
    private readonly DispatcherTimer bannerCountdownTimer = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly DispatcherTimer codeCopyResetTimer = new() { Interval = TimeSpan.FromSeconds(2) };
    private int bannerRotationIndex;
    private string? bannerRotationContextKey;
    private DateTimeOffset bannerRotationStartedAt = DateTimeOffset.UtcNow;
    private DateTimeOffset? bannerRotationPauseStartedAt;
    private double bannerRotationProgressAtPause;
    private string? bannerPinnedGameId;
    private string? bannerPinnedCharacterId;
    private bool bannerRotationPaused;
    private double toolLayoutExtraHeight;
    internal Func<DateTimeOffset> AccountDisplayClock { get; set; } = static () => DateTimeOffset.Now;
    private double redemptionCodeRowHeight = 17;
    private bool compactCodeRows;
    private RedemptionCodeRowItem? copiedCodeRow;
    private string? copiedCodeValue;
    private Storyboard? heroCrossfade;
    private SessionUiLease? pageLease;

    public ObservableCollection<GameLauncherItem> Games { get; } = new();

    public ObservableCollection<RedemptionCodeRowItem> RedemptionCodeRows { get; } = new();

    public ObservableCollection<BannerCharacterRowItem> BannerCharacterRows { get; } = new();

    public MainPage()
    {
        InitializeComponent();
        bannerRotationTimer.Tick += BannerRotationTimer_Tick;
        bannerCountdownTimer.Tick += BannerCountdownTimer_Tick;
        codeCopyResetTimer.Tick += CodeCopyResetTimer_Tick;

        app = (App)Application.Current;
        launcherState = app.LauncherState;
        userAssets = new UserAssetStore(launcherState.DataDirectory);
        RebuildGameRail(launcherState.Snapshot);
        sessions = app.Sessions;
        sessionRefresh = app.SessionRefresh;
        sessionUiLifetime = app.SessionUiLifetime;
        launcherBanners = app.LauncherBanners;
        exports = app.Exports;
        publisherStatus = app.HoyoPublisherStatus;
        wuwaAccountStatus = app.WuWaAccountStatus;
        publisherAccounts = app.PublisherAccounts;
        genshinSession = app.GenshinSession;
        hoyoSessions = app.HoyoSessions;
        hoyoPlayExecutor = app.HoyoPlayExecutor;
        wuwaMaintenance = app.WuWaMaintenance;
        publisherGameLaunchService = app.PublisherGameLaunchService;
        endfieldRootStore = app.EndfieldRootStore;
        endfieldMaintenance = app.EndfieldMaintenance;
        discovery = app.GenshinDiscovery;
        genshinInspection = app.GenshinInspection;

        Loaded += MainPage_Loaded;
        Unloaded += MainPage_Unloaded;
        SizeChanged += MainPage_SizeChanged;
        GameSelector.SelectedItem = Games.FirstOrDefault(
            game => game.Id == launcherState.Snapshot.SelectedGameId) ?? Games.FirstOrDefault();
        gameSnapshot = GameSelector.SelectedItem is GameLauncherItem selected
            && sessions.TryGetSnapshot(selected.Id, out var initialSnapshot)
                ? initialSnapshot
                : null;
        RenderSelection();
    }

    private void RebuildGameRail(Nyx.Desktop.Core.State.LauncherState state)
    {
        var official = GameCatalog.All.ToDictionary(
            static game => game.Id,
            game =>
            {
                var hero = HeroPresentations[game.Id];
                var appearance = state.Appearance.TryGetValue(game.Id, out var saved)
                    ? saved
                    : null;
                return new GameLauncherItem(
                    game.Id,
                    game.DisplayName,
                    appearance?.IconPath ?? IconPaths[game.Id],
                    HeroArtPaths[game.Id],
                    (appearance?.ArtScale ?? (int)(hero.Scale * 100)) / 100d,
                    appearance?.ArtX ?? (int)hero.OffsetX,
                    appearance?.ArtY ?? (int)hero.OffsetY,
                    hero.FadeStart,
                    hero.FadeMid,
                    MaintenanceProviders[game.Id],
                    "⋯",
                    "Checking local status",
                    isCustom: false);
            },
            StringComparer.Ordinal);
        var customs = state.CustomGames.ToDictionary(
            static game => game.Id,
            game =>
            {
                var appearance = state.Appearance.TryGetValue(game.Id, out var saved)
                    ? saved
                    : null;
                return new GameLauncherItem(
                    game.Id,
                    game.Name,
                    appearance?.IconPath ?? game.IconPath,
                    "ms-appx:///Assets/Iris/nyx-eye-fill.png",
                    (appearance?.ArtScale ?? 100) / 100d,
                    appearance?.ArtX ?? 0,
                    appearance?.ArtY ?? 0,
                    0.24,
                    0.56,
                    "CUSTOM GAME",
                    "○",
                    "Ready to check",
                    isCustom: true);
            },
            StringComparer.Ordinal);

        Games.Clear();
        foreach (var id in state.RailOrder)
        {
            if (official.TryGetValue(id, out var officialGame))
            {
                Games.Add(officialGame);
            }
            else if (customs.TryGetValue(id, out var customGame))
            {
                Games.Add(customGame);
            }
        }
    }

    private async void MainPage_Loaded(object sender, RoutedEventArgs e)
    {
        if (!selectorSubscribed)
        {
            GameSelector.SelectionChanged += GameSelector_SelectionChanged;
            selectorSubscribed = true;
        }

        ApplyLayout(ActualWidth, ActualHeight);
        bannerRotationStartedAt = DateTimeOffset.UtcNow;
        bannerRotationPauseStartedAt = null;
        if (bannerPinnedCharacterId is not null || bannerRotationPaused)
        {
            PauseBannerRotation();
        }
        UpdateBannerRotationTimerState();
        bannerCountdownTimer.Start();
        var lease = sessionUiLifetime.Activate();
        pageLease = lease;
        gameActionsInFlight.Clear();
        updaterActionInFlight = false;
        wuwaActionInFlight = false;
        endfieldFolderActionInFlight = false;
        endfieldMaintenanceActionInFlight = false;

        if (!refreshSubscribed)
        {
            sessionRefresh.Refreshed += SessionRefresh_Refreshed;
            refreshSubscribed = true;
        }

        if (!launcherBannersSubscribed)
        {
            launcherBanners.Updated += LauncherBanners_Updated;
            launcherBannersSubscribed = true;
        }

        if (!publisherStatusSubscribed)
        {
            publisherStatus.Updated += PublisherStatus_Updated;
            publisherStatusSubscribed = true;
        }

        if (!publisherAccountsSubscribed)
        {
            publisherAccounts.Updated += PublisherAccounts_Updated;
            publisherAccountsSubscribed = true;
        }

        if (!reactivationSubscribed)
        {
            app.WindowReactivated += App_WindowReactivated;
            reactivationSubscribed = true;
        }

        if (!networkStatusSubscribed)
        {
            Interlocked.Increment(ref networkRefreshGeneration);
            NetworkInformation.NetworkStatusChanged += NetworkInformation_NetworkStatusChanged;
            networkStatusSubscribed = true;
            Volatile.Write(ref networkAvailability, HasInternetConnection() ? 1 : 0);
        }

        if (!endfieldRootDiscoverySubscribed)
        {
            app.EndfieldRootAutoDiscovered += App_EndfieldRootAutoDiscovered;
            endfieldRootDiscoverySubscribed = true;
        }

        RenderSelection();
        var hoyoCheck = updaterScanFinished
            ? Task.CompletedTask
            : RefreshHoyoMaintenanceAsync(lease, refreshSessions: true);
        var wuwaCheck = wuwaScanFinished
            ? Task.CompletedTask
            : RefreshWuWaMaintenanceAsync(lease, useStoredRequest: false);
        var endfieldCheck = endfieldMaintenanceScanFinished
            ? Task.CompletedTask
            : RefreshEndfieldMaintenanceAsync(lease);
        await Task.WhenAll(
            IndependentMaintenanceLaneRunner.RunAsync(
                () => hoyoCheck,
                () => wuwaCheck),
            endfieldCheck);
    }

    private void MainPage_Unloaded(object sender, RoutedEventArgs e)
    {
        bannerRotationTimer.Stop();
        bannerRotationPauseStartedAt = null;
        bannerCountdownTimer.Stop();
        codeCopyResetTimer.Stop();
        if (selectorSubscribed)
        {
            GameSelector.SelectionChanged -= GameSelector_SelectionChanged;
            selectorSubscribed = false;
        }

        if (refreshSubscribed)
        {
            sessionRefresh.Refreshed -= SessionRefresh_Refreshed;
            refreshSubscribed = false;
        }

        if (launcherBannersSubscribed)
        {
            launcherBanners.Updated -= LauncherBanners_Updated;
            launcherBannersSubscribed = false;
        }

        if (publisherStatusSubscribed)
        {
            publisherStatus.Updated -= PublisherStatus_Updated;
            publisherStatusSubscribed = false;
        }

        if (publisherAccountsSubscribed)
        {
            publisherAccounts.Updated -= PublisherAccounts_Updated;
            publisherAccountsSubscribed = false;
        }

        if (reactivationSubscribed)
        {
            app.WindowReactivated -= App_WindowReactivated;
            reactivationSubscribed = false;
        }

        if (networkStatusSubscribed)
        {
            NetworkInformation.NetworkStatusChanged -= NetworkInformation_NetworkStatusChanged;
            networkStatusSubscribed = false;
            Interlocked.Increment(ref networkRefreshGeneration);
            Volatile.Write(ref networkAvailability, -1);
            Interlocked.Exchange(ref networkContentRefreshInFlight, 0);
        }

        if (endfieldRootDiscoverySubscribed)
        {
            app.EndfieldRootAutoDiscovered -= App_EndfieldRootAutoDiscovered;
            endfieldRootDiscoverySubscribed = false;
        }

        var lease = Interlocked.Exchange(ref pageLease, null);
        endfieldFolderSelections.CancelAll();
        endfieldUiActions.Reset();
        endfieldMaintenanceGeneration.Next();
        if (lease is not null)
        {
            sessionUiLifetime.Deactivate(lease);
        }
    }

    private HoyoMaintenanceUiSnapshot DiscoverHoyoMaintenance()
    {
        var roots = discovery.Discover();
        var updaterResult = roots.UpdaterRoot is null
            ? null
            : hoyoPlayExecutor.Check("gi", roots.UpdaterRoot);

        return new(
            roots.UpdaterRoot,
            updaterResult is null ? null : MapHoyoPlayStatus(updaterResult.Status));
    }

    private async Task RefreshHoyoMaintenanceAsync(
        SessionUiLease lease,
        bool refreshSessions)
    {
        var generation = Interlocked.Increment(ref hoyoRefreshGeneration);
        try
        {
            var snapshot = await Task.Run(DiscoverHoyoMaintenance, lease.CancellationToken);
            if (refreshSessions)
            {
                await sessionRefresh.RefreshNowAsync(lease.CancellationToken);
            }

            publisherStatus.Start();
            var refreshedGame = sessions.GetSnapshot("gi");
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                if (generation != Volatile.Read(ref hoyoRefreshGeneration))
                {
                    return;
                }

                updaterRoot = snapshot.UpdaterRoot;
                updaterStatus = snapshot.UpdaterStatus;
                gameFailureReason = GenshinLaunchFailureReason.None;
                gameSnapshot = refreshedGame;
                updaterScanFinished = true;
                RenderSelection();
            });
        }
        catch (OperationCanceledException) when (lease.CancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception)
        {
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                if (generation != Volatile.Read(ref hoyoRefreshGeneration))
                {
                    return;
                }

                updaterStatus = GenshinLaunchStatus.NeedsReview;
                gameFailureReason = GenshinLaunchFailureReason.None;
                updaterScanFinished = true;
                RenderSelection();
            });
        }
    }

    private async Task RefreshWuWaMaintenanceAsync(
        SessionUiLease lease,
        bool useStoredRequest)
    {
        var generation = wuwaRefreshGeneration.Next();
        var request = useStoredRequest ? wuwaMaintenanceRequest : null;
        try
        {
            var result = await Task.Run(
                () => request is null
                    ? wuwaMaintenance.Check()
                    : wuwaMaintenance.Check(request),
                lease.CancellationToken);
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                _ = wuwaRefreshGeneration.TryApply(generation, () =>
                {
                    ApplyWuWaMaintenanceResult(result);
                    wuwaScanFinished = true;
                    RenderSelection();
                });
            });
        }
        catch (OperationCanceledException) when (lease.CancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception)
        {
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                _ = wuwaRefreshGeneration.TryApply(generation, () =>
                {
                    wuwaMaintenanceStatus = WuWaOfficialMaintenanceStatus.NeedsReview;
                    wuwaMaintenanceReason = PublisherGameInspectionReason.InspectionFailed;
                    wuwaMaintenanceRequest = null;
                    wuwaScanFinished = true;
                    RenderSelection();
                });
            });
        }
    }

    private async Task RefreshEndfieldMaintenanceAsync(SessionUiLease lease)
    {
        var generation = endfieldMaintenanceGeneration.Next();
        try
        {
            var result = await Task.Run(
                endfieldMaintenance.Check,
                lease.CancellationToken);
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                _ = endfieldMaintenanceGeneration.TryApply(generation, () =>
                {
                    ApplyEndfieldMaintenanceResult(result);
                    endfieldMaintenanceScanFinished = true;
                    RenderSelection();
                });
            });
        }
        catch (OperationCanceledException) when (lease.CancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception)
        {
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                _ = endfieldMaintenanceGeneration.TryApply(generation, () =>
                {
                    endfieldMaintenanceStatus = EndfieldOfficialMaintenanceStatus.NeedsReview;
                    endfieldMaintenanceReason = PublisherGameInspectionReason.InspectionFailed;
                    endfieldMaintenanceScanFinished = true;
                    RenderSelection();
                });
            });
        }
    }

    private void App_WindowReactivated(object? sender, EventArgs e)
    {
        var lease = pageLease;
        if (lease is null)
        {
            return;
        }

        _ = DispatcherQueue.TryEnqueue(() =>
        {
            _ = RefreshHoyoMaintenanceAsync(lease, refreshSessions: false);
            if (WuWaMaintenanceInteractionPolicy.AllowsActivationRefresh(wuwaActionInFlight))
            {
                _ = RefreshWuWaMaintenanceAsync(lease, useStoredRequest: true);
            }

            if (GameSelector?.SelectedItem is GameLauncherItem { Id: "wuwa" }
                && IsWuWaAccountStatusEnabled())
            {
                _ = RefreshWuWaAccountStatusAsync(lease);
            }

            if (!endfieldMaintenanceActionInFlight)
            {
                _ = RefreshEndfieldMaintenanceAsync(lease);
            }
        });
    }

    private void NetworkInformation_NetworkStatusChanged(object sender)
    {
        var connected = HasInternetConnection();
        var previous = Interlocked.Exchange(ref networkAvailability, connected ? 1 : 0);
        if (!connected || previous != 0)
        {
            return;
        }

        // NetworkInformation raises on a system thread. Queue one refresh on
        // the page dispatcher; the service itself coalesces any in-flight
        // manifest/code fetch and the page lease prevents work after unload.
        if (Interlocked.CompareExchange(ref networkContentRefreshInFlight, 1, 0) != 0)
        {
            return;
        }

        var generation = Volatile.Read(ref networkRefreshGeneration);
        if (!DispatcherQueue.TryEnqueue(() =>
            _ = RefreshContentAfterNetworkReactivationAsync(generation)))
        {
            Interlocked.Exchange(ref networkContentRefreshInFlight, 0);
        }
    }

    private async Task RefreshContentAfterNetworkReactivationAsync(int generation)
    {
        try
        {
            if (generation != Volatile.Read(ref networkRefreshGeneration))
            {
                return;
            }

            var lease = pageLease;
            var preferences = launcherState.Snapshot.Preferences;
            if (lease is null
                || !preferences.RefreshContentOnStartup
                || !preferences.FeatureFlags.RemoteBannerManifest)
            {
                return;
            }

            await launcherBanners.RefreshOnReactivationAsync(lease.CancellationToken);
        }
        catch (OperationCanceledException)
        {
            // Unload/close cancels the page lease; no retry should outlive it.
        }
        catch (Exception)
        {
            // Keep the last-known-good snapshot. The next network transition
            // or scheduled refresh can try again without affecting launch.
        }
        finally
        {
            if (generation == Volatile.Read(ref networkRefreshGeneration))
            {
                Interlocked.Exchange(ref networkContentRefreshInFlight, 0);
            }
        }
    }

    private static bool HasInternetConnection()
    {
        try
        {
            // GetInternetConnectionProfile can raise an uncatchable WinRT
            // stowed exception in unpackaged WinUI apps on some Windows 11
            // builds. Link availability is sufficient here: it only decides
            // whether a transition should retry the already fail-safe feed.
            return System.Net.NetworkInformation.NetworkInterface.GetIsNetworkAvailable();
        }
        catch (Exception)
        {
            return false;
        }
    }

    private void App_EndfieldRootAutoDiscovered(object? sender, EventArgs e)
    {
        var lease = pageLease;
        if (lease is null)
        {
            return;
        }

        _ = DispatcherQueue.TryEnqueue(() =>
        {
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                endfieldMaintenanceScanFinished = false;
                endfieldMaintenanceStatus = null;
                RenderSelection();
                _ = RefreshEndfieldMaintenanceAsync(lease);
            });
        });
    }

    private async void LaunchButton_Click(object sender, RoutedEventArgs e)
    {
        var lease = pageLease;
        if (lease is null || GameSelector?.SelectedItem is not GameLauncherItem selected)
        {
            return;
        }

        var gameId = selected.Id;
        if (!gameActionsInFlight.Add(gameId))
        {
            return;
        }
        ShowGameActionInProgress("Starting…", "Checking the game once more");

        try
        {
            var state = launcherState.Snapshot;
            var arm = ExportArmSnapshot.From(state.Export, gameId, state.Preferences.FeatureFlags);
            if (latestExportJobs.TryGetValue(gameId, out var activeJobId)
                && !exports.GetSnapshot(activeJobId).IsFinished)
            {
                RenderSelection();
                return;
            }
            if (gameSnapshot?.Status is LocalGameStatus.Running
                && arm.RequestedKinds == ExportKind.None)
            {
                RenderSelection();
                return;
            }
            var exportResult = await exports.RunForLaunchAsync(
                arm,
                async cancellationToken =>
                {
                    var result = await sessions.RequestLaunchAsync(gameId, cancellationToken);
                    _ = sessionUiLifetime.TryRun(lease, () =>
                    {
                        gameSnapshot = result.Snapshot;
                        if (gameId == "gi") gameFailureReason = genshinSession.LastLaunchFailureReason;
                    });
                    return result.Outcome is GameLaunchRequestOutcome.Accepted
                        or GameLaunchRequestOutcome.AlreadyRunning
                        or GameLaunchRequestOutcome.AlreadyStarting;
                },
                lease.CancellationToken);
            if (arm.RequestedKinds != ExportKind.None)
            {
                latestExportJobs[gameId] = exportResult.JobId;
                _ = TrackExportJobAsync(gameId, exportResult.JobId, lease);
            }
            if (exportResult.LaunchAdmitted && !launcherState.Snapshot.Preferences.StayVisibleAfterLaunch)
                app.MinimizeWindow();
        }
        catch (OperationCanceledException) when (lease.CancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception)
        {
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                gameSnapshot = sessions.GetSnapshot(gameId);
                if (gameId == "gi")
                {
                    gameFailureReason = GenshinLaunchFailureReason.WindowsStartFailed;
                }
            });
        }
        finally
        {
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                gameActionsInFlight.Remove(gameId);
                RenderSelection();
            });
        }
    }

    private async void WuWaAccountStatusToggle_Click(object sender, RoutedEventArgs e)
    {
        if (GameSelector?.SelectedItem is GameLauncherItem selected && selected.Id != "wuwa")
        {
            await SetPublisherConsentAsync(
                selected.Id,
                WuWaAccountStatusToggle.IsChecked == true);
            return;
        }
        var enable = WuWaAccountStatusToggle.IsChecked == true;
        wuwaAccountStatusSaveFailed = false;
        if (!enable)
        {
            // Opt-out is a session boundary first. A read-only or failing state
            // store must never keep credential work or old totals alive.
            wuwaAccountStatusSessionDisabled = true;
            wuwaAccountInitialRefreshRequested = false;
            wuwaAccountStatusUiGeneration++;
            wuwaAccountStatusActionInFlight = false;
            wuwaAccountStatus.DisableSession();
            RenderWuWaAccountStatus();
        }

        if (enable
            && launcherState.Snapshot.Preferences.FeatureFlags.WuWaAccountStatus)
        {
            wuwaAccountStatusSessionDisabled = false;
            wuwaAccountInitialRefreshRequested = true;
            RenderWuWaAccountStatus();
            if (pageLease is { } existingLease)
                await RefreshWuWaAccountStatusAsync(existingLease);
            return;
        }

        var updated = launcherState.TryUpdate(state => state with
        {
            Preferences = state.Preferences with
            {
                FeatureFlags = state.Preferences.FeatureFlags with { WuWaAccountStatus = enable },
            },
        });
        if (!updated)
        {
            wuwaAccountStatusSaveFailed = !enable;
            RenderWuWaAccountStatus();
            return;
        }

        wuwaAccountStatusSessionDisabled = !enable;
        wuwaAccountInitialRefreshRequested = enable;
        RenderWuWaAccountStatus();
        if (enable && pageLease is { } lease)
        {
            await RefreshWuWaAccountStatusAsync(lease);
        }
    }

    private async void WuWaAccountStatusRefreshButton_Click(object sender, RoutedEventArgs e)
    {
        if (GameSelector?.SelectedItem is GameLauncherItem selected && selected.Id != "wuwa")
        {
            if (selected.Id == "ae")
                await publisherAccounts.OpenOfficialResourcePageAsync("ae");
            else
                await RefreshPublisherResourceAsync(selected.Id);
            return;
        }
        // A manual click during the local request floor must leave the actual
        // publisher result visible instead of briefly replacing it with noise.
        if (wuwaAccountStatus.IsRefreshCoolingDown)
        {
            RenderWuWaAccountStatus();
            return;
        }

        if (pageLease is { } lease)
        {
            await RefreshWuWaAccountStatusAsync(lease);
        }
    }

    private async void PublisherAccountConnectButton_Click(object sender, RoutedEventArgs e)
    {
        if (GameSelector?.SelectedItem is not GameLauncherItem selected
            || selected.Id == "wuwa"
            || !HasPublisherConsent(selected.Id))
            return;
        var entry = PublisherAccountCatalog.Get(selected.Id);
        var summary = publisherAccounts.Current;
        var connection = entry.Provider == "HoYoLAB" ? summary.HoyoLab : summary.Skport;
        if (connection == PublisherConnectionState.Connected)
            await DisconnectPublisherAccountAsync(selected.Id);
        else
            await ConnectPublisherAccountAsync(selected.Id);
    }

    private async void DailyCheckInButton_Click(object sender, RoutedEventArgs e)
    {
        if (publisherAccountActionInFlight
            || GameSelector?.SelectedItem is not GameLauncherItem selected
            || selected.Id == "wuwa"
            || !HasPublisherConsent(selected.Id))
            return;
        publisherAccountActionInFlight = true;
        RenderSelection();
        try
        {
            await publisherAccounts.CheckInAllAsync(pageLease?.CancellationToken ?? CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            publisherAccountActionInFlight = false;
            RenderSelection();
        }
    }

    private async Task SetPublisherConsentAsync(string gameId, bool enabled)
    {
        if (publisherAccountActionInFlight) return;
        var entry = PublisherAccountCatalog.Get(gameId);
        publisherAccountActionInFlight = true;
        try
        {
            var cleanupResult = PublisherConnectionState.NotConnected;
            if (!enabled)
            {
                // The in-memory service gate closes synchronously at the start
                // of this call, before cancellation or profile deletion can fail.
                try
                {
                    cleanupResult = await publisherAccounts.RevokeConsentAsync(
                        gameId,
                        pageLease?.CancellationToken ?? CancellationToken.None);
                }
                catch (OperationCanceledException)
                {
                    cleanupResult = PublisherConnectionState.NeedsReview;
                }
            }
            else
            {
                bool prepared;
                try
                {
                    prepared = await publisherAccounts.PrepareConsentEnableAsync(
                        entry.Provider,
                        pageLease?.CancellationToken ?? CancellationToken.None);
                }
                catch (OperationCanceledException)
                {
                    prepared = false;
                }
                if (!prepared)
                {
                    publisherConsentCleanupFailures.Add(entry.Provider);
                    return;
                }
            }

            var updated = launcherState.TryUpdate(state => state with
            {
                Preferences = state.Preferences with
                {
                    FeatureFlags = entry.Provider switch
                    {
                        "HoYoLAB" => state.Preferences.FeatureFlags with
                        {
                            HoyoLabAccountAccess = enabled,
                            HoyoLabAccountCleanupPending = !enabled,
                        },
                        "SKPORT" => state.Preferences.FeatureFlags with
                        {
                            SkportAccountAccess = enabled,
                            SkportAccountCleanupPending = !enabled,
                        },
                        _ => state.Preferences.FeatureFlags,
                    },
                },
            });
            if (!updated)
            {
                publisherConsentSaveFailures.Add(entry.Provider);
                return;
            }

            publisherConsentSaveFailures.Remove(entry.Provider);
            if (enabled)
            {
                publisherConsentCleanupFailures.Remove(entry.Provider);
                publisherAccounts.EnableConsent(entry.Provider);
                return;
            }

            if (cleanupResult != PublisherConnectionState.NotConnected
                || !publisherAccounts.CompleteConsentRevocation(entry.Provider))
            {
                publisherConsentCleanupFailures.Add(entry.Provider);
                return;
            }

            var cleanupRecorded = launcherState.TryUpdate(state => state with
            {
                Preferences = state.Preferences with
                {
                    FeatureFlags = entry.Provider switch
                    {
                        "HoYoLAB" => state.Preferences.FeatureFlags with
                        {
                            HoyoLabAccountAccess = false,
                            HoyoLabAccountCleanupPending = false,
                        },
                        "SKPORT" => state.Preferences.FeatureFlags with
                        {
                            SkportAccountAccess = false,
                            SkportAccountCleanupPending = false,
                        },
                        _ => state.Preferences.FeatureFlags,
                    },
                },
            });
            if (cleanupRecorded)
            {
                publisherConsentCleanupFailures.Remove(entry.Provider);
            }
            else
            {
                publisherConsentSaveFailures.Add(entry.Provider);
            }
        }
        finally
        {
            publisherAccountActionInFlight = false;
            RenderSelection();
        }
    }

    private async Task<PublisherRoleBinding?> ChoosePublisherRoleAsync(
        IReadOnlyList<PublisherRoleChoice> choices,
        CancellationToken cancellationToken)
    {
        if (choices.Count < 2) return null;
        var list = new ListView
        {
            ItemsSource = choices,
            SelectionMode = ListViewSelectionMode.Single,
            IsItemClickEnabled = true,
            MaxHeight = 280,
        };
        AutomationProperties.SetName(list, "Available HoYoLAB roles with masked UIDs");
        var content = new StackPanel { Spacing = 10 };
        content.Children.Add(new TextBlock
        {
            Text = "Choose the character Nyx may read. Only a masked UID and region are shown.",
            TextWrapping = TextWrapping.Wrap,
        });
        content.Children.Add(list);
        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = "Choose HoYoLAB character",
            Content = content,
            PrimaryButtonText = "Use this character",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.None,
            IsPrimaryButtonEnabled = false,
        };
        list.SelectionChanged += (_, _) =>
            dialog.IsPrimaryButtonEnabled = list.SelectedItem is PublisherRoleChoice;
        using var cancellationRegistration = cancellationToken.Register(() =>
            DispatcherQueue.TryEnqueue(dialog.Hide));
        var result = await dialog.ShowAsync().AsTask(cancellationToken);
        return result == ContentDialogResult.Primary
            && list.SelectedItem is PublisherRoleChoice selected
                ? selected.Binding
                : null;
    }

    private async Task ConnectPublisherAccountAsync(string gameId)
    {
        if (publisherAccountActionInFlight || !HasPublisherConsent(gameId)) return;
        publisherAccountActionInFlight = true;
        RenderSelection();
        try
        {
            await publisherAccounts.ConnectAsync(gameId, pageLease?.CancellationToken ?? CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            publisherAccountActionInFlight = false;
            RenderSelection();
        }
    }

    private async Task RefreshPublisherResourceAsync(string gameId)
    {
        if (publisherAccountActionInFlight || !HasPublisherConsent(gameId)) return;
        publisherAccountActionInFlight = true;
        RenderSelection();
        try
        {
            await publisherAccounts.RefreshResourceAsync(
                gameId,
                ChoosePublisherRoleAsync,
                pageLease?.CancellationToken ?? CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            publisherAccountActionInFlight = false;
            RenderSelection();
        }
    }

    private async Task DisconnectPublisherAccountAsync(string gameId)
    {
        if (publisherAccountActionInFlight || !HasPublisherConsent(gameId)) return;
        publisherAccountActionInFlight = true;
        RenderSelection();
        try
        {
            await publisherAccounts.DisconnectAsync(gameId, pageLease?.CancellationToken ?? CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            publisherAccountActionInFlight = false;
            RenderSelection();
        }
    }

    private bool HasPublisherConsent(string gameId)
    {
        var entry = PublisherAccountCatalog.Get(gameId);
        return publisherAccounts.HasConsent(entry.Provider);
    }

    private async Task RefreshWuWaAccountStatusAsync(SessionUiLease lease)
    {
        if (wuwaAccountStatusActionInFlight
            || !IsWuWaAccountStatusEnabled())
        {
            return;
        }

        var uiGeneration = wuwaAccountStatusUiGeneration;
        wuwaAccountStatusActionInFlight = true;
        _ = sessionUiLifetime.TryRun(lease, RenderWuWaAccountStatus);
        try
        {
            await wuwaAccountStatus.RefreshAsync(lease.CancellationToken);
        }
        finally
        {
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                if (uiGeneration != wuwaAccountStatusUiGeneration) return;
                wuwaAccountStatusActionInFlight = false;
                RenderWuWaAccountStatus();
            });
        }
    }

    private async void ChooseGameFolderButton_Click(object sender, RoutedEventArgs e)
    {
        var lease = pageLease;
        if (lease is null
            || endfieldFolderActionInFlight
            || GameSelector?.SelectedItem is not GameLauncherItem selected
            || selected.IsCustom)
        {
            return;
        }

        endfieldFolderActionInFlight = true;
        ChooseGameFolderButton.IsEnabled = false;
        ChooseGameFolderButton.Content = "CHOOSING…";
        try
        {
            var picker = new FolderPicker
            {
                SuggestedStartLocation = PickerLocationId.ComputerFolder,
            };
            picker.FileTypeFilter.Add("*");
            WinRT.Interop.InitializeWithWindow.Initialize(picker, app.WindowHandle);
            var folder = await picker.PickSingleFolderAsync();
            if (folder is null || lease.CancellationToken.IsCancellationRequested)
            {
                return;
            }

            UpdaterSignalText.Text = $"Checking the selected {selected.DisplayName} folder…";
            var accepted = await Task.Run(
                () => IsValidManualInstallRoot(selected.Id, folder.Path),
                lease.CancellationToken);
            if (!accepted)
            {
                HeroDescription.Text = "That is not the complete official game folder. Nothing was saved.";
                return;
            }

            var canonical = Path.TrimEndingDirectorySeparator(Path.GetFullPath(folder.Path));
            launcherState.TryUpdate(state =>
            {
                var roots = new Dictionary<string, string>(state.Preferences.ManualInstallRoots, StringComparer.Ordinal)
                {
                    [selected.Id] = canonical,
                };
                return state with
                {
                    Preferences = state.Preferences with
                    {
                        ManualInstallRoots = new ReadOnlyDictionary<string, string>(roots),
                        EndfieldInstallRoot = selected.Id == "ae"
                            ? canonical
                            : state.Preferences.EndfieldInstallRoot,
                    },
                };
            });
            await sessionRefresh.RefreshNowAsync(lease.CancellationToken);
            if (selected.Id == "ae") await RefreshEndfieldMaintenanceAsync(lease);
            if (selected.Id == "wuwa") await RefreshWuWaMaintenanceAsync(lease, useStoredRequest: false);
        }
        catch (OperationCanceledException) when (lease.CancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception)
        {
            HeroDescription.Text = "Nyx could not check that folder.";
        }
        finally
        {
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                endfieldFolderActionInFlight = false;
                RenderSelection();
            });
        }
    }

    private bool IsValidManualInstallRoot(string gameId, string root) => gameId switch
    {
        "gi" => genshinInspection.InspectGame(root, GenshinPathOrigin.PreviouslySaved).Status
            is GenshinInspectionStatus.Ready,
        "hsr" or "zzz" => hoyoIdentity.Inspect(gameId, root).Status is HoyoInspectionStatus.Ready,
        "wuwa" or "ae" => publisherGameLaunchService.CheckGame(gameId, root).Status
            is PublisherGameLaunchStatus.Ready or PublisherGameLaunchStatus.Running,
        _ => false,
    };

    private async void OpenUpdaterButton_Click(object sender, RoutedEventArgs e)
    {
        var lease = pageLease;
        if (lease is null || GameSelector?.SelectedItem is not GameLauncherItem selected)
        {
            return;
        }

        if (selected.Id == "wuwa")
        {
            await OpenWuWaMaintenanceAsync(lease);
            return;
        }

        if (selected.Id == "ae")
        {
            await OpenEndfieldMaintenanceAsync(lease);
            return;
        }

        if (updaterActionInFlight
            || updaterRoot is null
            || selected.Id is not ("gi" or "hsr" or "zzz"))
        {
            return;
        }

        updaterActionInFlight = true;
        OpenUpdaterButton.IsEnabled = false;
        OpenUpdaterButton.Content = "Opening…";
        UpdaterSignalText.Text = "Opening…";

        try
        {
            var selectedGameId = selected.Id;
            var result = await hoyoPlayExecutor.OpenOrObserveCurrentAsync(
                selectedGameId,
                updaterRoot,
                lease.CancellationToken);
            var status = MapHoyoPlayStatus(result.Status);
            _ = sessionUiLifetime.TryRun(lease, () => updaterStatus = status);
        }
        catch (OperationCanceledException) when (lease.CancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception)
        {
            _ = sessionUiLifetime.TryRun(
                lease,
                () => updaterStatus = GenshinLaunchStatus.LaunchFailed);
        }
        finally
        {
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                updaterActionInFlight = false;
                RenderSelection();
            });
        }
    }

    private async Task OpenEndfieldMaintenanceAsync(SessionUiLease lease)
    {
        if (endfieldMaintenanceActionInFlight
            || endfieldFolderActionInFlight
            || GameSelector?.SelectedItem is not GameLauncherItem { Id: "ae" })
        {
            return;
        }

        var actionAdmission = endfieldUiActions.TryEnter(EndfieldUiActionKind.OpenMaintenance);
        if (actionAdmission is null)
        {
            return;
        }

        var generation = endfieldMaintenanceGeneration.Next();
        endfieldMaintenanceActionInFlight = true;
        OpenUpdaterButton.IsEnabled = false;
        ChooseGameFolderButton.IsEnabled = false;
        OpenUpdaterButton.Content = "Opening…";
        UpdaterSignalText.Text = "Opening GRYPHLINK…";

        try
        {
            var result = await endfieldMaintenance.OpenOrObserveCurrentAsync(
                lease.CancellationToken);
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                _ = endfieldMaintenanceGeneration.TryApply(generation, () =>
                {
                    ApplyEndfieldMaintenanceResult(result);
                    RenderSelection();
                });
            });

            if (result.Status is EndfieldOfficialMaintenanceStatus.Opened
                && endfieldMaintenanceGeneration.IsCurrent(generation))
            {
                var observed = await BoundedMaintenanceObservation.ObserveAsync(
                    token => Task.Run(endfieldMaintenance.Check, token),
                    observation => observation.Status is not EndfieldOfficialMaintenanceStatus.Ready,
                    EndfieldLaunchObservationCount,
                    WuWaLaunchObservationInterval,
                    lease.CancellationToken);
                _ = sessionUiLifetime.TryRun(lease, () =>
                {
                    _ = endfieldMaintenanceGeneration.TryApply(generation, () =>
                    {
                        ApplyEndfieldMaintenanceResult(observed);
                        RenderSelection();
                    });
                });
            }
        }
        catch (OperationCanceledException) when (lease.CancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception)
        {
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                _ = endfieldMaintenanceGeneration.TryApply(generation, () =>
                {
                    endfieldMaintenanceStatus = EndfieldOfficialMaintenanceStatus.Failed;
                    endfieldMaintenanceReason = PublisherGameInspectionReason.InspectionFailed;
                });
            });
        }
        finally
        {
            actionAdmission.Dispose();
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                endfieldMaintenanceActionInFlight = false;
                RenderSelection();
            });
        }
    }

    private async Task OpenWuWaMaintenanceAsync(SessionUiLease lease)
    {
        if (wuwaActionInFlight
            || wuwaMaintenanceRequest is null
            || GameSelector?.SelectedItem is not GameLauncherItem { Id: "wuwa" })
        {
            return;
        }

        var request = wuwaMaintenanceRequest;
        var generation = wuwaRefreshGeneration.Next();
        wuwaActionInFlight = true;
        OpenUpdaterButton.IsEnabled = false;
        OpenUpdaterButton.Content = "Opening…";
        UpdaterSignalText.Text = "Opening the official launcher…";

        try
        {
            var result = await wuwaMaintenance.OpenOrObserveCurrentAsync(
                request,
                lease.CancellationToken);
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                _ = wuwaRefreshGeneration.TryApply(generation, () =>
                {
                    ApplyWuWaMaintenanceResult(result);
                    RenderSelection();
                });
            });

            if (result.Status is WuWaOfficialMaintenanceStatus.Opened
                && result.Request is not null
                && wuwaRefreshGeneration.IsCurrent(generation))
            {
                var observed = await BoundedMaintenanceObservation.ObserveAsync(
                    token => Task.Run(() => wuwaMaintenance.Check(result.Request), token),
                    observation => observation.Status is not WuWaOfficialMaintenanceStatus.Ready,
                    WuWaLaunchObservationCount,
                    WuWaLaunchObservationInterval,
                    lease.CancellationToken);
                _ = sessionUiLifetime.TryRun(lease, () =>
                {
                    _ = wuwaRefreshGeneration.TryApply(generation, () =>
                    {
                        ApplyWuWaMaintenanceResult(observed);
                        RenderSelection();
                    });
                });
            }
        }
        catch (OperationCanceledException) when (lease.CancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception)
        {
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                _ = wuwaRefreshGeneration.TryApply(generation, () =>
                {
                    wuwaMaintenanceStatus = WuWaOfficialMaintenanceStatus.Failed;
                    wuwaMaintenanceReason = PublisherGameInspectionReason.InspectionFailed;
                    wuwaMaintenanceRequest = null;
                });
            });
        }
        finally
        {
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                wuwaActionInFlight = false;
                RenderSelection();
            });
        }
    }

    private async void BrandLockup_Click(object sender, RoutedEventArgs e) =>
        await OpenFixedDestinationAsync(new Uri("https://pengo.gg"), "the Nyx website");

    private void RailSurface_PointerEntered(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs e) =>
        AddGameButton.Opacity = 0.9;

    private void RailSurface_PointerExited(object sender, Microsoft.UI.Xaml.Input.PointerRoutedEventArgs e)
    {
        if (!ReferenceEquals(FocusManager.GetFocusedElement(XamlRoot), AddGameButton))
        {
            AddGameButton.Opacity = 0.56;
        }
    }

    private void AddGameButton_GotFocus(object sender, RoutedEventArgs e) =>
        AddGameButton.Opacity = 0.9;

    private void AddGameButton_LostFocus(object sender, RoutedEventArgs e) =>
        AddGameButton.Opacity = 0.56;

    private void RedemptionCode_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { CommandParameter: string code }
            || string.IsNullOrWhiteSpace(code)
            || GameSelector?.SelectedItem is not GameLauncherItem { IsCustom: false } selected) return;
        var data = new DataPackage();
        data.SetText(code);
        Clipboard.SetContent(data);
        copiedCodeRow?.ResetCopyState();
        copiedCodeRow = RedemptionCodeRows.FirstOrDefault(row => string.Equals(row.Code, code, StringComparison.Ordinal));
        copiedCodeRow?.MarkPreviouslyCopied();
        copiedCodeRow?.MarkCopied();
        PersistCopiedRedemptionCode(selected.Id, code);
        codeCopyResetTimer.Stop();
        copiedCodeValue = code;
        codeCopyResetTimer.Start();
        NyxToolsStatusText.Text = $"Copied {code}.";
    }

    private void PersistCopiedRedemptionCode(string gameId, string code)
    {
        _ = launcherState.TryUpdate(state =>
        {
            var values = state.Preferences.CopiedRedemptionCodes.ToDictionary(
                static pair => pair.Key,
                static pair => (IReadOnlyList<string>)pair.Value.ToArray(),
                StringComparer.Ordinal);
            var gameCodes = values.TryGetValue(gameId, out var existing)
                ? existing.ToList()
                : [];
            gameCodes.RemoveAll(value => string.Equals(value, code, StringComparison.Ordinal));
            gameCodes.Insert(0, code);
            if (gameCodes.Count > 100) gameCodes.RemoveRange(100, gameCodes.Count - 100);
            values[gameId] = gameCodes.AsReadOnly();
            return state with
            {
                Preferences = state.Preferences with { CopiedRedemptionCodes = values },
            };
        });
    }

    private void CodeCopyResetTimer_Tick(object? sender, object e)
    {
        codeCopyResetTimer.Stop();
        copiedCodeValue = null;
        copiedCodeRow?.ResetCopyState();
        copiedCodeRow = null;
    }

    private async void KofiButton_Click(object sender, RoutedEventArgs e) =>
        await OpenFixedDestinationAsync(new Uri("https://ko-fi.com/asyce"), "Ko-fi");

    private async Task OpenFixedDestinationAsync(Uri destination, string label)
    {
        try
        {
            if (!await Windows.System.Launcher.LaunchUriAsync(destination))
            {
                HeroDescription.Text = $"Windows could not open {label}.";
            }
        }
        catch (Exception)
        {
            HeroDescription.Text = $"Windows could not open {label}.";
        }
    }

    private async void AddGameButton_Click(object sender, RoutedEventArgs e) =>
        await ShowAddGameDialogAsync();

    private LauncherDiagnosticsSnapshot BuildDiagnosticsSnapshot()
    {
        var state = launcherState.Snapshot;
        var games = Games.Select(game =>
        {
            GameSessionSnapshot snapshot;
            try
            {
                snapshot = sessions.GetSnapshot(game.Id);
            }
            catch (Exception)
            {
                snapshot = new GameSessionSnapshot(
                    game.Id,
                    LocalReadinessEvidence.Unknown,
                    LocalGameStatus.NeedsReview,
                    ExactProcessPresence.Uncertain,
                    false,
                    false,
                    0,
                    0,
                    null,
                    null,
                    null,
                    null,
                    0,
                    0,
                    GameSessionFailureReason.EvidenceUnavailable,
                    false);
            }

            var discovery = snapshot.Readiness switch
            {
                LocalReadinessEvidence.Ready => LauncherDiscoveryResultCategory.Ready,
                LocalReadinessEvidence.NotFound => LauncherDiscoveryResultCategory.Missing,
                LocalReadinessEvidence.NeedsReview => LauncherDiscoveryResultCategory.Invalid,
                _ => LauncherDiscoveryResultCategory.Uncertain,
            };
            var export = state.Export.Games.TryGetValue(game.Id, out var arm)
                ? $"pulls={(arm.PullsArmed ? "armed" : "off")},achievements={(arm.AchievementsArmed ? "armed" : "off")}"
                : "off";
            return new LauncherDiagnosticGame(
                game.Id,
                snapshot.Status.ToString(),
                export,
                discovery,
                snapshot.FailureReason is GameSessionFailureReason.None
                    ? null
                    : snapshot.FailureReason.ToString());
        });

        var cache = app.Cache.GetTotals();
        var manifest = launcherBanners.Current;
        return new LauncherDiagnosticsSnapshot(
            typeof(App).Assembly.GetName().Version?.ToString() ?? "dev",
            state.Preferences.FeatureFlags,
            games,
            manifest.Revision,
            manifest.Health.Status,
            cache);
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        var value = bytes / 1024d;
        return value < 1024
            ? $"{value:0.0} KB"
            : value / 1024 < 1024
                ? $"{value / 1024:0.0} MB"
                : $"{value / 1024 / 1024:0.0} GB";
    }

    private async Task OpenFolderAsync(LauncherRecoveryAction action, TextBlock message)
    {
        try
        {
            string? folder;
            if (action is LauncherRecoveryAction.OpenOutputFolder)
            {
                folder = Path.Combine(WindowsDownloadsDirectory.Get(), "Pengo Exports");
                Directory.CreateDirectory(folder);
            }
            else
            {
                var result = await app.Recovery.OpenDataFolderAsync();
                folder = result.Succeeded ? result.SafeLocation : null;
            }
            if (string.IsNullOrWhiteSpace(folder))
            {
                message.Text = "Nyx could not open that folder.";
                return;
            }

            if (!await Windows.System.Launcher.LaunchFolderPathAsync(folder))
            {
                message.Text = "Windows could not open that folder.";
            }
        }
        catch (Exception)
        {
            message.Text = "Windows could not open that folder.";
        }
    }

    private void RebuildAfterStateRecovery()
    {
        if (!launcherState.TryReload()) return;
        SynchronizeCustomSessions(launcherState.Snapshot);
        RebuildGameRail(launcherState.Snapshot);
        GameSelector.SelectedItem = Games.FirstOrDefault(game => game.Id == launcherState.Snapshot.SelectedGameId)
            ?? Games.FirstOrDefault();
        RenderSelection();
    }

    private void SynchronizeCustomSessions(Nyx.Desktop.Core.State.LauncherState state)
    {
        var savedIds = state.CustomGames.Select(static game => game.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var existingId in sessions.GetAllSnapshots().Keys
                     .Where(static id => id.StartsWith("custom-", StringComparison.Ordinal))
                     .Where(id => !savedIds.Contains(id)))
        {
            sessions.TryRemoveCustomAdapter(existingId);
        }

        foreach (var game in state.CustomGames)
        {
            sessions.TryRemoveCustomAdapter(game.Id);
            sessions.TryRegisterCustomAdapter(CustomGameSessionFactory.Create(game));
        }
    }

    private static void ApplyNyxAccentResources(ResourceDictionary resources)
    {
        if (Application.Current.Resources["HighContrastBackdropOpacity"] is double opacity && opacity > 0)
        {
            return;
        }

        static SolidColorBrush CloneBrush(string key)
        {
            var source = (SolidColorBrush)Application.Current.Resources[key];
            return new SolidColorBrush(source.Color);
        }

        foreach (var key in new[]
                 {
                     "AccentFillColorDefaultBrush",
                     "AccentButtonBackground",
                     "ToggleSwitchFillOn",
                     "ToggleSwitchStrokeOn",
                     "SliderThumbBackground",
                     "SliderTrackValueFill",
                 })
        {
            resources[key] = CloneBrush("IrisBrush");
        }
        foreach (var key in new[]
                 {
                     "AccentFillColorSecondaryBrush",
                     "AccentButtonBackgroundPointerOver",
                     "ToggleSwitchFillOnPointerOver",
                     "SliderThumbBackgroundPointerOver",
                     "SliderTrackValueFillPointerOver",
                 })
        {
            resources[key] = CloneBrush("AccentFillColorSecondaryBrush");
        }
        foreach (var key in new[]
                 {
                     "AccentFillColorTertiaryBrush",
                     "AccentButtonBackgroundPressed",
                     "ToggleSwitchFillOnPressed",
                     "SliderThumbBackgroundPressed",
                     "SliderTrackValueFillPressed",
                 })
        {
            resources[key] = CloneBrush("AccentFillColorTertiaryBrush");
        }
        resources["AccentButtonForeground"] = CloneBrush("PrimaryActionForegroundBrush");
        resources["AccentButtonForegroundPointerOver"] = CloneBrush("PrimaryActionForegroundBrush");
        resources["AccentButtonForegroundPressed"] = CloneBrush("PrimaryActionForegroundBrush");
    }

    public async Task ShowSettingsAsync()
    {
        if (XamlRoot is null)
        {
            return;
        }

        if (GameSelector?.SelectedItem is not GameLauncherItem selected)
        {
            return;
        }

        var before = launcherState.Snapshot;
        var savedAppearance = before.Appearance.TryGetValue(selected.Id, out var existingAppearance)
            ? existingAppearance
            : new Nyx.Desktop.Core.State.GameAppearanceState();
        var hadAutomaticVariant = automaticArtVariants.TryGetValue(selected.Id, out var automaticVariantBefore);
        string? chosenArtVariant = savedAppearance.ArtVariant
            ?? (hadAutomaticVariant ? automaticVariantBefore.VariantId : null);
        var chosenArtFit = HeroArtFitGeometry.Normalize(savedAppearance.ArtFit);
        var openedAppearance = savedAppearance with
        {
            IconPath = savedAppearance.IconPath ?? selected.IconPath,
            ArtVariant = chosenArtVariant,
        };
        var automaticArt = new ToggleSwitch
        {
            Header = "Automatic current-banner character art",
            IsOn = savedAppearance.AutomaticArt,
            OnContent = "On",
            OffContent = "Off",
        };
        var artScale = new Slider
        {
            Minimum = 25,
            Maximum = 500,
            Value = savedAppearance.ArtScale,
            StepFrequency = 1,
            Header = "Character art scale",
        };
        var artScaleNumber = new NumberBox
        {
            Header = "Scale %",
            Minimum = 25,
            Maximum = 500,
            Value = savedAppearance.ArtScale,
            SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact,
        };
        var artX = new NumberBox
        {
            Header = "Horizontal position",
            Minimum = -1000,
            Maximum = 1000,
            Value = savedAppearance.ArtX,
            SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact,
        };
        var artXSlider = new Slider
        {
            Header = "Horizontal position",
            Minimum = -1000,
            Maximum = 1000,
            Value = savedAppearance.ArtX,
            StepFrequency = 1,
        };
        var artY = new NumberBox
        {
            Header = "Vertical position",
            Minimum = -1000,
            Maximum = 1000,
            Value = savedAppearance.ArtY,
            SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact,
        };
        var artYSlider = new Slider
        {
            Header = "Vertical position",
            Minimum = -1000,
            Maximum = 1000,
            Value = savedAppearance.ArtY,
            StepFrequency = 1,
        };
        var keepArt = new ToggleSwitch
        {
            Header = "Freeze this artwork",
            IsOn = savedAppearance.ArtPinned,
            OnContent = "Keep this exact splash art",
            OffContent = "Follow current banners",
        };
        var iconPath = new TextBox
        {
            Header = "Game icon",
            Text = savedAppearance.IconPath ?? selected.IconPath,
        };
        var backgroundPath = new TextBox
        {
            Header = "Launcher background",
            Text = savedAppearance.BackgroundPath ?? string.Empty,
            PlaceholderText = "Nyx background (default)",
        };
        var browseIcon = new Button { Content = "CHANGE ICON", Style = (Style)Application.Current.Resources["NyxQuietActionStyle"] };
        var browseBackground = new Button { Content = "CHANGE BACKGROUND", Style = (Style)Application.Current.Resources["NyxQuietActionStyle"] };
        var resetAppearance = new Button { Content = "RESET APPEARANCE", Style = (Style)Application.Current.Resources["NyxQuietActionStyle"] };
        var tryAnother = new Button { Content = "TRY ANOTHER", Style = (Style)Application.Current.Resources["NyxQuietActionStyle"] };
        var stayVisible = new ToggleSwitch
        {
            Header = "Keep Nyx visible after starting a game",
            IsOn = before.Preferences.StayVisibleAfterLaunch,
        };
        var refreshOnStartup = new ToggleSwitch
        {
            Header = "Refresh banners, codes, and artwork when Nyx opens",
            IsOn = before.Preferences.RefreshContentOnStartup,
        };
        var safeNotifications = new ToggleSwitch
        {
            Header = "Safe notifications",
            IsOn = before.Preferences.SafeNotifications,
            OnContent = "On",
            OffContent = "Off",
        };
        var globalAutomaticArt = new ToggleSwitch
        {
            Header = "Enable automatic banner character art for all games",
            IsOn = before.Preferences.FeatureFlags.AutomaticArt,
            OnContent = "On",
            OffContent = "Off",
        };
        var remoteManifest = new ToggleSwitch
        {
            Header = "Allow remote banner manifest refresh",
            IsOn = before.Preferences.FeatureFlags.RemoteBannerManifest,
            OnContent = "On",
            OffContent = "Off",
        };
        var resetOrder = new Button
        {
            Content = "RESET GAME ORDER",
            Style = (Style)Application.Current.Resources["NyxQuietActionStyle"],
        };
        var resetLauncherState = new Button
        {
            Content = "RESET LAUNCHER STATE",
            Style = (Style)Application.Current.Resources["NyxQuietActionStyle"],
        };
        var cacheSummary = new TextBlock
        {
            Text = $"Generated content: {FormatBytes(app.Cache.GetTotals().GeneratedBytes)}",
            Foreground = (Brush)Application.Current.Resources["MistBrush"],
            TextWrapping = TextWrapping.Wrap,
        };
        var refreshContent = new Button
        {
            Content = "REFRESH CONTENT NOW",
            Style = (Style)Application.Current.Resources["NyxQuietActionStyle"],
        };
        var clearCache = new Button
        {
            Content = "CLEAR GENERATED CACHE",
            Style = (Style)Application.Current.Resources["NyxQuietActionStyle"],
        };
        var openData = new Button
        {
            Content = "OPEN DATA FOLDER",
            Style = (Style)Application.Current.Resources["NyxQuietActionStyle"],
        };
        var openExports = new Button
        {
            Content = "OPEN EXPORT FOLDER",
            Style = (Style)Application.Current.Resources["NyxQuietActionStyle"],
        };
        var copyDiagnostics = new Button
        {
            Content = "COPY SAFE DIAGNOSTICS",
            Style = (Style)Application.Current.Resources["NyxQuietActionStyle"],
        };
        var rediscover = new Button
        {
            Content = "REDISCOVER GAME INSTALLS",
            Style = (Style)Application.Current.Resources["NyxQuietActionStyle"],
        };
        var resetSavedAppearance = new Button
        {
            Content = "RESET SAVED APPEARANCE",
            Style = (Style)Application.Current.Resources["NyxQuietActionStyle"],
        };
        var restoreSettings = new Button
        {
            Content = "RESTORE LAST-KNOWN-GOOD SETTINGS",
            Style = (Style)Application.Current.Resources["NyxQuietActionStyle"],
        };
        var message = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            Foreground = (Brush)Application.Current.Resources["MistBrush"],
        };

        var custom = before.CustomGames.FirstOrDefault(game => game.Id == selected.Id);
        var customName = new TextBox { Header = "Custom game name", Text = custom?.Name ?? selected.DisplayName };
        var customExecutable = new TextBox { Header = "Exact executable", Text = custom?.ExecutablePath ?? string.Empty };
        var customRuntime = new TextBox { Header = "Runtime executable (optional)", Text = custom?.RuntimePath ?? string.Empty };
        var customArguments = new TextBox { Header = "Arguments (optional)", Text = custom?.RawArguments ?? string.Empty };
        var customAdmin = new ToggleSwitch { Header = "Ask Windows for administrator approval", IsOn = custom?.RequestAdministrator ?? false };
        var browseExecutable = new Button { Content = "REPAIR / CHANGE EXE", Style = (Style)Application.Current.Resources["NyxQuietActionStyle"] };
        var browseRuntime = new Button { Content = "CHOOSE RUNTIME", Style = (Style)Application.Current.Resources["NyxQuietActionStyle"] };

        async Task<string?> PickFileAsync(params string[] extensions)
        {
            var picker = new FileOpenPicker { SuggestedStartLocation = PickerLocationId.ComputerFolder };
            foreach (var extension in extensions) picker.FileTypeFilter.Add(extension);
            WinRT.Interop.InitializeWithWindow.Initialize(picker, app.WindowHandle);
            return (await picker.PickSingleFileAsync())?.Path;
        }

        browseIcon.Click += async (_, _) =>
        {
            var path = await PickFileAsync(".png", ".jpg", ".jpeg", ".webp", ".ico");
            if (path is not null) iconPath.Text = path;
        };
        browseBackground.Click += async (_, _) =>
        {
            var path = await PickFileAsync(".png", ".jpg", ".jpeg", ".webp");
            if (path is not null)
            {
                backgroundPath.Text = path;
                SetBackgroundSource(path);
            }
        };
        browseExecutable.Click += async (_, _) =>
        {
            var path = await PickFileAsync(".exe");
            if (path is not null) customExecutable.Text = path;
        };
        browseRuntime.Click += async (_, _) =>
        {
            var path = await PickFileAsync(".exe");
            if (path is not null) customRuntime.Text = path;
        };

        refreshContent.Click += async (_, _) =>
        {
            refreshContent.IsEnabled = false;
            message.Text = "Refreshing banners, codes, and artwork...";
            try
            {
                await app.RefreshContentManualAsync();
                message.Text = "Launcher content refreshed."
                    + (launcherBanners.Current.Health.Status is "ok" ? string.Empty : " Nyx kept the last safe copy.");
                RenderSelection();
            }
            catch (Exception)
            {
                message.Text = "Nyx could not refresh content. The last safe copy is still in use.";
            }
            finally
            {
                refreshContent.IsEnabled = true;
            }
        };
        clearCache.Click += async (_, _) =>
        {
            var result = await app.Recovery.ClearGeneratedCacheAsync();
            cacheSummary.Text = $"Generated content: {FormatBytes(app.Cache.GetTotals().GeneratedBytes)}";
            message.Text = result.Succeeded
                ? "Generated content cache cleared. Nyx will rebuild it when needed."
                : "Nyx could not clear the generated content cache.";
        };
        openData.Click += async (_, _) => await OpenFolderAsync(LauncherRecoveryAction.OpenDataFolder, message);
        openExports.Click += async (_, _) => await OpenFolderAsync(LauncherRecoveryAction.OpenOutputFolder, message);
        copyDiagnostics.Click += (_, _) =>
        {
            try
            {
                var package = new DataPackage();
                package.SetText(LauncherDiagnosticsText.FormatForCopy(BuildDiagnosticsSnapshot()));
                Clipboard.SetContent(package);
                message.Text = "Safe diagnostics copied. They contain no user paths or account data.";
            }
            catch (Exception)
            {
                message.Text = "Nyx could not copy diagnostics to the clipboard.";
            }
        };
        rediscover.Click += async (_, _) =>
        {
            rediscover.IsEnabled = false;
            message.Text = "Rediscovering installed games...";
            try
            {
                var result = await app.Recovery.RediscoverInstallsAsync();
                await sessionRefresh.RefreshNowAsync();
                RenderSelection();
                message.Text = result.Succeeded
                    ? "Game install checks refreshed."
                    : "Nyx could not finish rediscovering installs.";
            }
            catch (Exception)
            {
                message.Text = "Nyx could not finish rediscovering installs.";
            }
            finally
            {
                rediscover.IsEnabled = true;
            }
        };
        resetSavedAppearance.Click += async (_, _) =>
        {
            var result = await app.Recovery.ResetSelectedAppearanceAsync(selected.Id);
            if (result.Succeeded)
            {
                RebuildAfterStateRecovery();
                automaticArt.IsOn = true;
                artScale.Value = 100;
                artX.Value = 0;
                artY.Value = 0;
                keepArt.IsOn = false;
                chosenArtVariant = null;
                iconPath.Text = selected.IsCustom ? custom?.IconPath ?? selected.IconPath : IconPaths[selected.Id];
                backgroundPath.Text = string.Empty;
                message.Text = "Saved appearance reset. Choose Save to keep other changes in this dialog.";
            }
            else
            {
                message.Text = "Nyx could not reset the saved appearance.";
            }
        };
        restoreSettings.Click += async (_, _) =>
        {
            var result = await app.Recovery.RestoreLastKnownGoodSettingsAsync();
            if (result.Succeeded)
            {
                RebuildAfterStateRecovery();
                message.Text = "Last-known-good settings restored. Close and reopen Settings to review them.";
            }
            else
            {
                message.Text = "No usable last-known-good settings backup was found.";
            }
        };

        void PreviewArt()
        {
            var previewAppearance = savedAppearance with
            {
                ArtScale = double.IsNaN(artScale.Value) ? 100 : (int)Math.Round(artScale.Value),
                ArtX = double.IsNaN(artX.Value) ? 0 : (int)Math.Round(artX.Value),
                ArtY = double.IsNaN(artY.Value) ? 0 : (int)Math.Round(artY.Value),
            };
            var previewAsset = !keepArt.IsOn && automaticArt.IsOn && chosenArtVariant is not null
                && launcherBanners.Current.Games.TryGetValue(selected.Id, out var previewGame)
                && previewGame.Current is { } previewCurrent
                ? previewCurrent.Characters
                    .SelectMany(character => character.Variants)
                    .Concat(previewCurrent.Variants)
                    .FirstOrDefault(asset => asset.Id == chosenArtVariant)
                : null;
            if (previewAsset is not null)
            {
                var path = launcherBanners.TryResolveManagedAsset(previewAsset);
                if (path is not null)
                {
                    chosenArtFit = HeroArtFitGeometry.Normalize(previewAsset.Placement.Fit);
                    var presentation = HeroArtFitGeometry.ManagedPresentation(
                        selected.Id,
                        previewAsset.Placement.Fit,
                        previewAsset.Dimensions.Width,
                        previewAsset.Dimensions.Height);
                    SetHeroSource(path, BannerAssetStretch(previewAsset.Placement.Fit));
                    ApplyManagedHeroLayout(
                        presentation,
                        previewAsset.Dimensions.Width,
                        previewAsset.Dimensions.Height);
                    ApplyHeroTransform(
                        previewAppearance,
                        presentation.UsesCenteredCoverGeometry
                            ? 0
                            : (previewAsset.Placement.X - 0.5) * HeroStage.ActualWidth,
                        (previewAsset.Placement.Y - 0.5) * HeroStage.ActualHeight);
                    return;
                }
            }

            // Saved and pinned art use the exact same transform as this preview;
            // only automatic banner placement adds a manifest focal offset.
            ApplyHeroTransform(previewAppearance);
        }
        var syncingArtControls = false;
        void SyncPair(Slider slider, NumberBox number, double value)
        {
            if (syncingArtControls) return;
            syncingArtControls = true;
            slider.Value = value;
            number.Value = value;
            syncingArtControls = false;
            PreviewArt();
        }
        artScale.ValueChanged += (_, args) => SyncPair(artScale, artScaleNumber, args.NewValue);
        artScaleNumber.ValueChanged += (_, args) => SyncPair(artScale, artScaleNumber, double.IsNaN(args.NewValue) ? 100 : args.NewValue);
        artXSlider.ValueChanged += (_, args) => SyncPair(artXSlider, artX, args.NewValue);
        artX.ValueChanged += (_, args) => SyncPair(artXSlider, artX, double.IsNaN(args.NewValue) ? 0 : args.NewValue);
        artYSlider.ValueChanged += (_, args) => SyncPair(artYSlider, artY, args.NewValue);
        artY.ValueChanged += (_, args) => SyncPair(artYSlider, artY, double.IsNaN(args.NewValue) ? 0 : args.NewValue);
        resetAppearance.Click += (_, _) =>
        {
            automaticArt.IsOn = true;
            artScale.Value = 100;
            artX.Value = 0;
            artY.Value = 0;
            keepArt.IsOn = false;
            chosenArtVariant = null;
            automaticArtVariants.Remove(selected.Id);
            iconPath.Text = selected.IsCustom ? custom?.IconPath ?? selected.IconPath : IconPaths[selected.Id];
            backgroundPath.Text = string.Empty;
            SetBackgroundSource("ms-appx:///Assets/backgroundnyx.png");
            PreviewArt();
        };
        tryAnother.Click += (_, _) =>
        {
            if (!launcherBanners.Current.Games.TryGetValue(selected.Id, out var bannerGame)
                || bannerGame.Current is not { } current)
                return;
            var selectedCharacter = current.Characters.FirstOrDefault(character => character.Id == current.SelectedCharacterId)
                ?? current.Characters.FirstOrDefault();
            var variants = selectedCharacter?.Variants.Count > 0
                ? selectedCharacter.Variants
                : current.Variants;
            if (variants.Count == 0) return;
            var currentIndex = chosenArtVariant is null
                ? -1
                : variants.ToList().FindIndex(asset => asset.Id == chosenArtVariant);
            var next = variants[(currentIndex + 1) % variants.Count];
            chosenArtVariant = next.Id;
            chosenArtFit = HeroArtFitGeometry.Normalize(next.Placement.Fit);
            automaticArtVariants[selected.Id] = (launcherBanners.Current.Revision, next.Id);
            keepArt.IsOn = false;
            var path = launcherBanners.TryResolveManagedAsset(next);
            if (path is not null)
            {
                SetHeroSource(path, BannerAssetStretch(next.Placement.Fit));
                PreviewArt();
            }
        };

        Grid SliderRow(Slider slider, NumberBox number)
        {
            var row = new Grid { ColumnSpacing = 12 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(140) });
            row.Children.Add(slider);
            Grid.SetColumn(number, 1);
            row.Children.Add(number);
            return row;
        }

        var appearancePanel = new StackPanel { Spacing = 10 };
        appearancePanel.Children.Add(automaticArt);
        appearancePanel.Children.Add(SliderRow(artScale, artScaleNumber));
        appearancePanel.Children.Add(SliderRow(artXSlider, artX));
        appearancePanel.Children.Add(SliderRow(artYSlider, artY));
        appearancePanel.Children.Add(keepArt);
        appearancePanel.Children.Add(new TextBlock
        {
            Text = "Freeze keeps the exact splash art you see now. Leave it off to switch automatically when banners change.",
            Foreground = (Brush)Application.Current.Resources["MistBrush"],
            FontSize = 11,
            TextWrapping = TextWrapping.Wrap,
        });
        appearancePanel.Children.Add(iconPath);
        appearancePanel.Children.Add(backgroundPath);
        appearancePanel.Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Children = { browseIcon, browseBackground, tryAnother, resetAppearance },
        });

        var launcherPanel = new StackPanel { Spacing = 10 };
        launcherPanel.Children.Add(stayVisible);
        launcherPanel.Children.Add(refreshOnStartup);
        launcherPanel.Children.Add(safeNotifications);
        launcherPanel.Children.Add(globalAutomaticArt);
        launcherPanel.Children.Add(remoteManifest);
        launcherPanel.Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Children = { resetOrder, resetLauncherState },
        });
        launcherPanel.Children.Add(new TextBlock
        {
            Text = "To reorder games, close Settings and drag their icons directly on the launcher rail.",
            Foreground = (Brush)Application.Current.Resources["MistBrush"],
            TextWrapping = TextWrapping.Wrap,
        });

        var recoveryPanel = new StackPanel { Spacing = 12 };
        recoveryPanel.Children.Add(cacheSummary);
        recoveryPanel.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { refreshContent, clearCache } });
        recoveryPanel.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { openData, openExports } });
        recoveryPanel.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { copyDiagnostics, rediscover } });
        recoveryPanel.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { resetSavedAppearance, restoreSettings } });

        var customPanel = new StackPanel { Spacing = 10 };
        customPanel.Children.Add(customName);
        customPanel.Children.Add(customExecutable);
        customPanel.Children.Add(browseExecutable);
        customPanel.Children.Add(customRuntime);
        customPanel.Children.Add(browseRuntime);
        customPanel.Children.Add(customArguments);
        customPanel.Children.Add(customAdmin);

        var panels = new List<FrameworkElement> { appearancePanel, launcherPanel, recoveryPanel };
        var tabNames = new List<string> { "Appearance", "Launcher", "Recovery" };
        if (selected.IsCustom)
        {
            panels.Add(customPanel);
            tabNames.Add("Custom game");
        }
        var panelHost = new Grid();
        foreach (var panel in panels)
        {
            panelHost.Children.Add(new ScrollViewer
            {
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Content = panel,
                Visibility = Visibility.Collapsed,
            });
        }
        ((ScrollViewer)panelHost.Children[0]).Visibility = Visibility.Visible;
        var tabs = new ListView
        {
            Width = 150,
            ItemsSource = tabNames,
            SelectedIndex = 0,
            SelectionMode = ListViewSelectionMode.Single,
        };
        tabs.SelectionChanged += (_, _) =>
        {
            for (var index = 0; index < panelHost.Children.Count; index++)
                panelHost.Children[index].Visibility = index == tabs.SelectedIndex ? Visibility.Visible : Visibility.Collapsed;
        };

        // ContentDialog is centered by WinUI, so keep a small edge allowance
        // instead of forcing a desktop-sized dialog onto narrow windows.
        var settingsWidth = Math.Clamp(ActualWidth - 32, 320, 1180);
        var settingsHeight = Math.Clamp(ActualHeight - 154, 440, 650);
        var settingsInset = settingsWidth < 720 ? 40 : 64;
        var settingsTabWidth = settingsWidth < 720 ? 112 : 160;
        var settingsColumnGap = settingsWidth < 720 ? 12 : 24;
        var content = new Grid
        {
            Width = Math.Max(248, settingsWidth - settingsInset),
            Height = settingsHeight,
            ColumnSpacing = settingsColumnGap,
        };
        ApplyNyxAccentResources(content.Resources);
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(settingsTabWidth) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        content.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetRow(tabs, 0);
        content.Children.Add(tabs);
        Grid.SetRow(panelHost, 0);
        Grid.SetColumn(panelHost, 1);
        content.Children.Add(panelHost);
        Grid.SetRow(message, 1);
        Grid.SetColumn(message, 1);
        message.Margin = new Thickness(0, 8, 0, 0);
        content.Children.Add(message);

        var settingsTitle = new Grid
        {
            Height = 36,
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
        };
        var settingsTitleText = new TextBlock
        {
            Text = $"Settings - {selected.DisplayName}",
            VerticalAlignment = VerticalAlignment.Center,
            FontFamily = (FontFamily)Application.Current.Resources["NyxBodyFont"],
            FontSize = 16,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = (Brush)Application.Current.Resources["MoonBrush"],
        };
        settingsTitle.Children.Add(settingsTitleText);
        AutomationProperties.SetName(settingsTitle, "Drag the Settings window");
        settingsTitle.PointerPressed += (_, args) =>
        {
            if (!args.GetCurrentPoint(settingsTitle).Properties.IsLeftButtonPressed)
            {
                return;
            }

            if (Application.Current is App currentApp)
            {
                currentApp.BeginWindowDrag();
                args.Handled = true;
            }
        };

        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = settingsTitle,
            Background = (Brush)Application.Current.Resources["SettingsSurfaceBrush"],
            BorderBrush = (Brush)Application.Current.Resources["DeckBorderBrush"],
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(14),
            MinWidth = settingsWidth,
            MaxWidth = settingsWidth,
            Content = content,
            PrimaryButtonText = "Save",
            SecondaryButtonText = selected.IsCustom ? "Delete Game" : string.Empty,
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            PrimaryButtonStyle = (Style)Application.Current.Resources["NyxDialogPrimaryStyle"],
            SecondaryButtonStyle = (Style)Application.Current.Resources["NyxDialogQuietStyle"],
            CloseButtonStyle = (Style)Application.Current.Resources["NyxDialogQuietStyle"],
        };
        ApplyNyxAccentResources(dialog.Resources);
        dialog.Resources["ContentDialogMinWidth"] = settingsWidth;
        dialog.Resources["ContentDialogMaxWidth"] = settingsWidth;
        var resetOrderConfirmationArmed = false;
        var resetLauncherConfirmationArmed = false;
        resetOrder.Click += (_, _) =>
        {
            if (!resetOrderConfirmationArmed)
            {
                resetOrderConfirmationArmed = true;
                resetOrder.Content = "CONFIRM RESET ORDER";
                message.Text = "Press Confirm reset order to restore GI, HSR, ZZZ, WuWa, Endfield, then custom games. No game is deleted.";
                return;
            }

            if (launcherState.TryUpdate(LauncherSettingsStateMerge.ResetRailOrder))
            {
                resetOrderConfirmationArmed = false;
                resetOrder.Content = "RESET GAME ORDER";
                RebuildAfterStateRecovery();
                message.Text = "Game order reset. Games and settings were kept.";
            }
            else
            {
                message.Text = "Nyx could not save the new order. Your previous order is still safe.";
            }
        };
        resetLauncherState.Click += (_, _) =>
        {
            if (!resetLauncherConfirmationArmed)
            {
                resetLauncherConfirmationArmed = true;
                resetLauncherState.Content = "CONFIRM RESET STATE";
                message.Text = "Press Confirm reset state to restore launcher settings only. Accounts, cache, downloads, exports, and files stay untouched.";
                return;
            }

            if (launcherState.TryReset())
            {
                dialog.Hide();
                RebuildAfterStateRecovery();
            }
            else
            {
                message.Text = "Nyx could not reset launcher settings. Your previous settings are still safe.";
            }
        };
        var saveSucceeded = false;
        string? newlyPinnedArtFile = null;
        dialog.PrimaryButtonClick += (_sender, args) =>
        {
            try
            {
                var storedIcon = iconPath.Text;
                if (!string.Equals(storedIcon, savedAppearance.IconPath ?? selected.IconPath, StringComparison.OrdinalIgnoreCase))
                {
                    storedIcon = userAssets.CopyImage(selected.Id, "icon", storedIcon);
                }
                var storedBackground = string.IsNullOrWhiteSpace(backgroundPath.Text)
                    ? null
                    : backgroundPath.Text;
                if (storedBackground is not null
                    && !string.Equals(storedBackground, savedAppearance.BackgroundPath, StringComparison.OrdinalIgnoreCase))
                {
                    storedBackground = userAssets.CopyImage(selected.Id, "background", storedBackground);
                }

                CustomGameDefinition? updatedCustom = custom;
                if (custom is not null)
                {
                    var validation = CustomGameValidator.Validate(
                        new CustomGameDraft(
                            customName.Text,
                            customExecutable.Text,
                            storedIcon,
                            storedBackground,
                            string.IsNullOrWhiteSpace(customRuntime.Text) ? null : customRuntime.Text,
                            string.IsNullOrWhiteSpace(customArguments.Text) ? null : customArguments.Text,
                            customAdmin.IsOn,
                            custom.Id,
                            custom.CreationOrder),
                        before.CustomGames.Where(game => game.Id != custom.Id));
                    if (!validation.IsValid || validation.Game is null)
                    {
                        args.Cancel = true;
                        message.Text = $"Custom game settings need review: {validation.Error}.";
                        return;
                    }
                    updatedCustom = validation.Game;
                }

                var pinnedArtFile = savedAppearance.PinnedArtFile;
                if (keepArt.IsOn)
                {
                    LauncherBannersAsset? chosenAsset = null;
                    if (chosenArtVariant is not null
                        && launcherBanners.Current.Games.TryGetValue(selected.Id, out var bannerGame)
                        && bannerGame.Current is { } current)
                    {
                        chosenAsset = current.Characters.SelectMany(character => character.Variants)
                            .Concat(current.Variants)
                            .FirstOrDefault(asset => asset.Id == chosenArtVariant);
                    }
                    var savedPinIsUsable = launcherBanners.TryResolveUserArt(pinnedArtFile) is not null;
                    if (chosenAsset is not null
                        && (!savedPinIsUsable || !string.Equals(chosenArtVariant, savedAppearance.ArtVariant, StringComparison.Ordinal)))
                    {
                        chosenArtFit = HeroArtFitGeometry.Normalize(chosenAsset.Placement.Fit);
                        newlyPinnedArtFile = launcherBanners.PinUserArt(selected.Id, chosenAsset);
                        pinnedArtFile = newlyPinnedArtFile;
                    }
                    else if (!savedPinIsUsable)
                    {
                        args.Cancel = true;
                        message.Text = "Choose available banner art before keeping it.";
                        return;
                    }
                }
                else
                {
                    pinnedArtFile = null;
                }

                var settingsEdit = new LauncherSettingsEdit
                {
                    GameId = selected.Id,
                    OpenedAppearance = openedAppearance,
                    Appearance = new GameAppearanceState
                    {
                        IconPath = storedIcon,
                        BackgroundPath = storedBackground,
                        AutomaticArt = automaticArt.IsOn,
                        ArtScale = (int)Math.Round(artScale.Value),
                        ArtX = double.IsNaN(artX.Value) ? 0 : (int)Math.Round(artX.Value),
                        ArtY = double.IsNaN(artY.Value) ? 0 : (int)Math.Round(artY.Value),
                        ArtVariant = chosenArtVariant,
                        ArtFit = chosenArtFit,
                        ArtPinned = keepArt.IsOn,
                        PinnedArtFile = pinnedArtFile,
                    },
                    CustomGame = updatedCustom,
                    RailOrder = launcherState.Snapshot.RailOrder,
                    StayVisibleAfterLaunch = stayVisible.IsOn,
                    RefreshContentOnStartup = refreshOnStartup.IsOn,
                    SafeNotifications = safeNotifications.IsOn,
                    AutomaticArt = globalAutomaticArt.IsOn,
                    RemoteBannerManifest = remoteManifest.IsOn,
                };
                saveSucceeded = launcherState.TryUpdate(
                    state => LauncherSettingsStateMerge.Apply(state, before, settingsEdit),
                    out var settingsFailure);
                if (!saveSucceeded)
                {
                    launcherBanners.ReleaseUserArt(newlyPinnedArtFile);
                    newlyPinnedArtFile = null;
                    args.Cancel = true;
                    message.Text = settingsFailure is LauncherStateUpdateFailure.CustomGameExecutableConflict
                        ? "That executable is already in your game rail. Your previous settings are still safe."
                        : "Nyx could not save Settings. Your previous settings are still safe.";
                    return;
                }

                if (updatedCustom is not null)
                {
                    sessions.TryRemoveCustomAdapter(updatedCustom.Id);
                    var savedCustom = launcherState.Snapshot.CustomGames.FirstOrDefault(
                        game => string.Equals(game.Id, updatedCustom.Id, StringComparison.Ordinal));
                    if (savedCustom is not null)
                    {
                        sessions.TryRegisterCustomAdapter(CustomGameSessionFactory.Create(savedCustom));
                    }
                }

                if ((globalAutomaticArt.IsOn && !before.Preferences.FeatureFlags.AutomaticArt)
                    || (remoteManifest.IsOn && !before.Preferences.FeatureFlags.RemoteBannerManifest))
                {
                    _ = app.RefreshContentManualAsync();
                }
                app.ApplyContentRefreshPreferences();
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException)
            {
                launcherBanners.ReleaseUserArt(newlyPinnedArtFile);
                newlyPinnedArtFile = null;
                args.Cancel = true;
                message.Text = "Nyx could not safely copy one of those images.";
            }
        };

        var result = await dialog.ShowAsync();
        if (result is ContentDialogResult.Secondary && custom is not null)
        {
            var confirmDelete = new ContentDialog
            {
                XamlRoot = XamlRoot,
                Title = $"Delete {custom.Name}?",
                Content = "This removes the custom game from Nyx. The game files on disk will not be touched.",
                PrimaryButtonText = "Delete game",
                CloseButtonText = "Cancel",
                DefaultButton = ContentDialogButton.Close,
            };
            if (await confirmDelete.ShowAsync() is not ContentDialogResult.Primary)
            {
                return;
            }

            var deleted = launcherState.TryUpdate(state => state with
            {
                CustomGames = state.CustomGames.Where(game => game.Id != custom.Id).ToArray(),
                RailOrder = state.RailOrder.Where(id => id != custom.Id).ToArray(),
                Appearance = state.Appearance.Where(pair => pair.Key != custom.Id).ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
                SelectedGameId = "gi",
            });
            if (!deleted)
            {
                return;
            }
            sessions.TryRemoveCustomAdapter(custom.Id);
            RebuildGameRail(launcherState.Snapshot);
            GameSelector.SelectedItem = Games.FirstOrDefault(game => game.Id == "gi");
        }
        else if (saveSucceeded)
        {
            RebuildGameRail(launcherState.Snapshot);
            GameSelector.SelectedItem = Games.FirstOrDefault(game => game.Id == selected.Id) ?? Games.FirstOrDefault();
        }
        else
        {
            if (hadAutomaticVariant) automaticArtVariants[selected.Id] = automaticVariantBefore;
            else automaticArtVariants.Remove(selected.Id);
            ApplySelectedAppearance(selected.Id);
            RenderSelection();
        }
    }

    private async Task ShowAddGameDialogAsync()
    {
        if (XamlRoot is null)
        {
            return;
        }

        var name = new TextBox { Header = "Game name", PlaceholderText = "My game" };
        var executable = new TextBox { Header = "Game executable", PlaceholderText = "Choose the exact .exe file" };
        var icon = new TextBox { Header = "Game icon", PlaceholderText = "Choose a PNG, JPG, WebP, or ICO file" };
        var chooseExecutable = new Button
        {
            Content = "BROWSE",
            Style = (Style)Application.Current.Resources["NyxQuietActionStyle"],
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        var chooseIcon = new Button
        {
            Content = "BROWSE",
            Style = (Style)Application.Current.Resources["NyxQuietActionStyle"],
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        chooseExecutable.Click += async (_, _) =>
        {
            var picker = new FileOpenPicker { SuggestedStartLocation = PickerLocationId.ComputerFolder };
            picker.FileTypeFilter.Add(".exe");
            WinRT.Interop.InitializeWithWindow.Initialize(picker, app.WindowHandle);
            var file = await picker.PickSingleFileAsync();
            if (file is not null) executable.Text = file.Path;
        };
        chooseIcon.Click += async (_, _) =>
        {
            var picker = new FileOpenPicker { SuggestedStartLocation = PickerLocationId.PicturesLibrary };
            foreach (var extension in new[] { ".png", ".jpg", ".jpeg", ".webp", ".ico" })
            {
                picker.FileTypeFilter.Add(extension);
            }
            WinRT.Interop.InitializeWithWindow.Initialize(picker, app.WindowHandle);
            var file = await picker.PickSingleFileAsync();
            if (file is not null) icon.Text = file.Path;
        };
        var message = new TextBlock
        {
            Text = "Nyx starts this exact file directly. You can add a separate runtime file and administrator approval in Settings after saving.",
            TextWrapping = TextWrapping.Wrap,
            Foreground = (Brush)Application.Current.Resources["MistBrush"],
        };
        static Grid PickerRow(TextBox field, Button button)
        {
            var row = new Grid { ColumnSpacing = 8 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.Children.Add(field);
            Grid.SetColumn(button, 1);
            row.Children.Add(button);
            return row;
        }

        var addGameWidth = Math.Clamp(ActualWidth - 32, 320, 744);
        var content = new StackPanel
        {
            Width = Math.Max(248, addGameWidth - 48),
            Spacing = 12,
            Children = { message, name, PickerRow(executable, chooseExecutable), PickerRow(icon, chooseIcon) },
        };
        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = "Add Game",
            Background = (Brush)Application.Current.Resources["SettingsSurfaceBrush"],
            BorderBrush = (Brush)Application.Current.Resources["DeckBorderBrush"],
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(14),
            MinWidth = addGameWidth,
            MaxWidth = addGameWidth,
            Content = content,
            PrimaryButtonText = "Add Game",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            PrimaryButtonStyle = (Style)Application.Current.Resources["NyxDialogPrimaryStyle"],
            CloseButtonStyle = (Style)Application.Current.Resources["NyxDialogQuietStyle"],
        };
        ApplyNyxAccentResources(dialog.Resources);
        dialog.Resources["ContentDialogMinWidth"] = addGameWidth;
        dialog.Resources["ContentDialogMaxWidth"] = addGameWidth;
        CustomGameDefinition? addedGame = null;
        dialog.PrimaryButtonClick += (_, args) =>
        {
            var id = CustomGameValidator.GenerateId();
            var validation = CustomGameValidator.Validate(
                new CustomGameDraft(
                    name.Text,
                    executable.Text,
                    icon.Text,
                    Id: id,
                    CreationOrder: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()),
                launcherState.Snapshot.CustomGames);
            if (!validation.IsValid || validation.Game is null)
            {
                args.Cancel = true;
                message.Text = validation.Error switch
                {
                    CustomGameValidationError.NameRequired => "Enter a game name.",
                    CustomGameValidationError.ExecutableMissing => "The selected game executable no longer exists.",
                    CustomGameValidationError.IconMissing => "The selected icon no longer exists.",
                    CustomGameValidationError.DuplicateExecutable => "That executable is already in your game rail.",
                    CustomGameValidationError.UnsafeArguments => "The saved arguments are not safe to start directly.",
                    _ => "Choose an exact local .exe and a local icon image.",
                };
                message.Foreground = (Brush)Application.Current.Resources["LavenderBrush"];
                return;
            }

            try
            {
                var copiedIcon = userAssets.CopyImage(id, "icon", validation.Game.IconPath);
                var game = validation.Game with { IconPath = copiedIcon };
                if (!sessions.TryRegisterCustomAdapter(CustomGameSessionFactory.Create(game)))
                {
                    args.Cancel = true;
                    message.Text = "Nyx could not prepare this game. Nothing was launched.";
                    message.Foreground = (Brush)Application.Current.Resources["LavenderBrush"];
                    return;
                }

                var saved = launcherState.TryUpdate(
                    state => LauncherCustomGameStateMerge.Add(state, game),
                    out var addFailure);
                if (!saved)
                {
                    sessions.TryRemoveCustomAdapter(game.Id);
                    args.Cancel = true;
                    message.Text = addFailure is LauncherStateUpdateFailure.CustomGameExecutableConflict
                        ? "That executable is already in your game rail. Nothing was launched."
                        : "Nyx could not save this game. Nothing was launched.";
                    message.Foreground = (Brush)Application.Current.Resources["LavenderBrush"];
                    return;
                }

                addedGame = game;
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException)
            {
                args.Cancel = true;
                message.Text = "Nyx could not safely copy that icon into its data folder.";
                message.Foreground = (Brush)Application.Current.Resources["LavenderBrush"];
            }
        };
        var result = await dialog.ShowAsync();
        if (result is ContentDialogResult.Primary && addedGame is not null)
        {
            RebuildGameRail(launcherState.Snapshot);
            GameSelector.SelectedItem = Games.FirstOrDefault(game => game.Id == addedGame.Id);
            var lease = pageLease;
            if (lease is not null)
            {
                await sessionRefresh.RefreshNowAsync(lease.CancellationToken);
            }
        }
    }

    private void ExportToggle_Click(object sender, RoutedEventArgs e)
    {
        if (GameSelector?.SelectedItem is not GameLauncherItem selected)
        {
            return;
        }
        var capability = ExportProviderCatalog.GetEnabled(
            selected.Id,
            launcherState.Snapshot.Preferences.FeatureFlags);
        if (ReferenceEquals(sender, PullExportToggle) && !capability.Supports(ExportKind.Pulls)) return;
        if (ReferenceEquals(sender, AchievementExportToggle) && !capability.Supports(ExportKind.Achievements)) return;
        var gameId = selected.Id;
        var pullsArmed = capability.Supports(ExportKind.Pulls) && PullExportToggle.IsChecked == true;
        var achievementsArmed = capability.Supports(ExportKind.Achievements) && AchievementExportToggle.IsChecked == true;
        var saved = launcherState.TryUpdate(state =>
        {
            var games = state.Export.Games.ToDictionary(static pair => pair.Key, static pair => pair.Value, StringComparer.Ordinal);
            games[gameId] = new Nyx.Desktop.Core.State.ExportGameArming
            {
                PullsArmed = pullsArmed,
                AchievementsArmed = achievementsArmed,
            };
            return state with { Export = state.Export with { Games = games } };
        });
        if (!saved) NyxToolsStatusText.Text = "Nyx could not save that choice. Try again.";
        else RenderSelection();
    }

    private async void OpenExportsButton_Click(object sender, RoutedEventArgs e)
    {
        var folder = Path.Combine(WindowsDownloadsDirectory.Get(), "Pengo Exports");
        try
        {
            Directory.CreateDirectory(folder);
            await Windows.System.Launcher.LaunchFolderPathAsync(folder);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            NyxToolsStatusText.Text = "Windows could not open the export folder.";
        }
    }

    private void CancelExportButton_Click(object sender, RoutedEventArgs e)
    {
        if (GameSelector?.SelectedItem is GameLauncherItem selected
            && latestExportJobs.TryGetValue(selected.Id, out var jobId)
            && exports.Cancel(jobId))
            NyxToolsStatusText.Text = "Canceling this export safely…";
    }

    private async Task TrackExportJobAsync(string gameId, Guid jobId, SessionUiLease lease)
    {
        while (!lease.CancellationToken.IsCancellationRequested)
        {
            ExportJobSnapshot snapshot;
            try { snapshot = exports.GetSnapshot(jobId); }
            catch (KeyNotFoundException) { return; }
            _ = DispatcherQueue.TryEnqueue(() =>
            {
                if (GameSelector?.SelectedItem is GameLauncherItem { Id: var selectedId } && selectedId == gameId)
                {
                    if (snapshot.IsFinished) RenderSelection();
                    else RenderExportTools((GameLauncherItem)GameSelector.SelectedItem);
                }
            });
            if (snapshot.IsFinished) return;
            try { await Task.Delay(400, lease.CancellationToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    private void SessionRefresh_Refreshed(object? sender, GameSessionsRefreshedEventArgs e)
    {
        var lease = pageLease;
        if (lease is null)
        {
            return;
        }

        _ = DispatcherQueue.TryEnqueue(() =>
            sessionUiLifetime.TryRun(lease, () =>
            {
                if (GameSelector?.SelectedItem is GameLauncherItem selected
                    && e.Snapshots.TryGetValue(selected.Id, out var snapshot))
                {
                    gameSnapshot = snapshot;
                }

                RenderSelection();
            }));
    }

    private void LauncherBanners_Updated(object? sender, EventArgs e)
    {
        var lease = pageLease;
        if (lease is null)
        {
            return;
        }

        _ = DispatcherQueue.TryEnqueue(() =>
            sessionUiLifetime.TryRun(lease, () =>
            {
                if (GameSelector?.SelectedItem is GameLauncherItem selected)
                {
                    bannerRotationIndex = GetPreferredBannerStartIndex(selected.Id);
                    bannerRotationStartedAt = DateTimeOffset.UtcNow;
                }

                RenderSelection();
            }));
    }

    private void PublisherStatus_Updated(object? sender, EventArgs e)
    {
        var lease = pageLease;
        if (lease is null)
        {
            return;
        }

        _ = DispatcherQueue.TryEnqueue(() =>
            sessionUiLifetime.TryRun(lease, RenderSelection));
    }

    private void PublisherAccounts_Updated(object? sender, EventArgs e)
    {
        var lease = pageLease;
        if (lease is null) return;
        _ = DispatcherQueue.TryEnqueue(() => sessionUiLifetime.TryRun(lease, RenderSelection));
    }

    private void GameSelector_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        bannerRotationIndex = GameSelector?.SelectedItem is GameLauncherItem selectedForRotation
            ? GetPreferredBannerStartIndex(selectedForRotation.Id)
            : 0;
        bannerRotationStartedAt = DateTimeOffset.UtcNow;
        bannerRotationPauseStartedAt = null;
        bannerRotationProgressAtPause = 0;
        bannerPinnedGameId = null;
        bannerPinnedCharacterId = null;
        if (GameSelector?.SelectedItem is GameLauncherItem selected
            && !string.Equals(lastArtSelectionGameId, selected.Id, StringComparison.Ordinal))
        {
            lastArtSelectionGameId = selected.Id;
            automaticArtVariants.Remove(selected.Id);
            if (selected.Id == "wuwa" && IsWuWaAccountStatusEnabled())
                wuwaAccountInitialRefreshRequested = false;
        }
        if (bannerRotationPaused)
        {
            PauseBannerRotation();
        }
        UpdateBannerRotationTimerState();
        RenderSelection();
    }

    private void GameSelector_DragItemsCompleted(ListViewBase sender, DragItemsCompletedEventArgs args)
    {
        var selectedId = (GameSelector.SelectedItem as GameLauncherItem)?.Id;
        var reordered = Games.Select(static game => game.Id).ToArray();
        if (!launcherState.TryUpdate(state => state with { RailOrder = reordered }))
        {
            RebuildGameRail(launcherState.Snapshot);
        }
        GameSelector.SelectedItem = Games.FirstOrDefault(game => game.Id == selectedId) ?? Games.FirstOrDefault();
    }

    private void GameSelector_Loaded(object sender, RoutedEventArgs e) =>
        ApplyLayout(ActualWidth, ActualHeight);

    private void MainPage_SizeChanged(object sender, SizeChangedEventArgs e) =>
        ApplyLayout(e.NewSize.Width, e.NewSize.Height);

    private void ApplyLayout(double width, double height)
    {
        if (width <= 0 || height <= 0 || GameSelector is null)
        {
            return;
        }

        var profile = LauncherLayoutStateSelector.CreateProfile(width, height);
        var horizontal = profile.UsesHorizontalRail;
        var accountStatusExtra = WuWaAccountStatusStrip.Visibility is Visibility.Visible ? PublisherAccountStatusLayoutHeight : 0d;

        foreach (var game in Games)
        {
            game.ApplyLayout(profile);
        }

        ContentPanel.MaxWidth = profile.ContentWidth;
        ContentScroll.MaxWidth = profile.ContentWidth;
        HeroStage.Width = profile.UsesHorizontalRail
            ? profile.HeroWidth
            : profile.HeroWidth;
        HeroArtwork.Opacity = 1;
        CommandDeck.Height = profile.DeckHeight + accountStatusExtra;
        LaunchStack.Width = profile.LaunchWidth;
        LaunchButton.Width = profile.LaunchWidth;
        LaunchButton.Height = profile.State switch
        {
            LauncherLayoutState.Compact => 72,
            LauncherLayoutState.Horizontal => 62,
            LauncherLayoutState.Wide => 110,
            _ => 92,
        };
        ApplyVerticalDensity(profile, height);
        ApplyMaintenanceLayout(profile.State);
        ApplyCommandDeckLayout(profile, width);

        if (GameSelector.ItemsPanelRoot is ItemsStackPanel itemsPanel)
        {
            itemsPanel.Orientation = horizontal
                ? Orientation.Horizontal
                : Orientation.Vertical;
        }

        if (horizontal)
        {
            RailRow.Height = new GridLength(profile.RailExtent + 52);
            RailColumn.Width = new GridLength(0);
            ContentColumn.Width = new GridLength(1, GridUnitType.Star);

            Grid.SetRow(RailSurface, 0);
            Grid.SetRowSpan(RailSurface, 1);
            Grid.SetColumn(RailSurface, 0);
            Grid.SetColumnSpan(RailSurface, 3);
            RailSurface.Width = double.NaN;
            RailSurface.Height = profile.RailExtent + 52;
            RailSurface.HorizontalAlignment = HorizontalAlignment.Stretch;
            RailSurface.VerticalAlignment = VerticalAlignment.Top;
            RailSurface.BorderThickness = new Thickness(0, 0, 0, 1);

            RailBrandRow.Height = new GridLength(1, GridUnitType.Star);
            RailContentRow.Height = new GridLength(0);
            RailAddRow.Height = new GridLength(0);
            RailSpacerRow.Height = new GridLength(0);
            RailFooterRow.Height = new GridLength(0);
            Grid.SetRow(BrandLockup, 0);
            Grid.SetRowSpan(BrandLockup, 1);
            BrandLockup.Width = profile.State is LauncherLayoutState.Compact ? 92 : 116;
            BrandLockup.Margin = new Thickness(10, 32, 0, 4);
            BrandLockup.HorizontalAlignment = HorizontalAlignment.Left;
            BrandLockup.VerticalAlignment = VerticalAlignment.Center;
            BrandLogo.Width = profile.State is LauncherLayoutState.Compact ? 84 : 106;
            BrandLogo.Height = profile.State is LauncherLayoutState.Compact ? 72 : 88;
            BrandLogo.Margin = new Thickness(0);
            AddGameButton.Visibility = Visibility.Visible;
            AddGameButton.Width = profile.IconSize;
            AddGameButton.Height = profile.IconSize;
            AddGameButton.Margin = new Thickness(0, 0, 8, 0);
            AddGameButton.HorizontalAlignment = HorizontalAlignment.Right;
            AddGameButton.VerticalAlignment = VerticalAlignment.Center;
            KofiButton.Visibility = Visibility.Collapsed;

            Grid.SetRow(GameSelector, 0);
            Grid.SetRowSpan(GameSelector, 3);
            Grid.SetColumn(GameSelector, 0);
            Grid.SetColumnSpan(GameSelector, 3);
            GameSelector.Width = double.NaN;
            GameSelector.Height = profile.RailExtent;
            GameSelector.HorizontalAlignment = HorizontalAlignment.Stretch;
            GameSelector.VerticalAlignment = VerticalAlignment.Center;
            GameSelector.Margin = new Thickness(
                profile.State is LauncherLayoutState.Compact ? 100 : 126,
                52,
                76,
                0);
            ScrollViewer.SetHorizontalScrollMode(GameSelector, ScrollMode.Enabled);
            ScrollViewer.SetHorizontalScrollBarVisibility(GameSelector, ScrollBarVisibility.Hidden);
            ScrollViewer.SetVerticalScrollMode(GameSelector, ScrollMode.Disabled);
            ScrollViewer.SetVerticalScrollBarVisibility(GameSelector, ScrollBarVisibility.Hidden);

            Grid.SetRow(ContentScroll, 1);
            Grid.SetRowSpan(ContentScroll, 1);
            Grid.SetColumn(ContentScroll, 0);
            Grid.SetColumnSpan(ContentScroll, 3);
            ContentScroll.Width = profile.ContentWidth;
            ContentScroll.HorizontalAlignment = HorizontalAlignment.Left;
            ContentScroll.VerticalAlignment = VerticalAlignment.Stretch;
            ContentScroll.Margin = new Thickness(
                profile.OuterPadding,
                18,
                profile.OuterPadding,
                profile.DeckHeight + toolLayoutExtraHeight + (WuWaAccountStatusStrip.Visibility is Visibility.Visible ? PublisherAccountStatusLayoutHeight : 0d) + 22);

            Grid.SetRow(CommandDeck, 1);
            Grid.SetRowSpan(CommandDeck, 1);
            Grid.SetColumn(CommandDeck, 0);
            Grid.SetColumnSpan(CommandDeck, 3);
            CommandDeck.Margin = new Thickness(0);
            return;
        }

        RailRow.Height = new GridLength(0);
        RailColumn.Width = new GridLength(profile.RailExtent);
        ContentColumn.Width = new GridLength(profile.ContentWidth + 76);

        Grid.SetRow(RailSurface, 0);
        Grid.SetRowSpan(RailSurface, 2);
        Grid.SetColumn(RailSurface, 0);
        Grid.SetColumnSpan(RailSurface, 1);
        RailSurface.Width = profile.RailExtent;
        RailSurface.Height = double.NaN;
        RailSurface.HorizontalAlignment = HorizontalAlignment.Left;
        RailSurface.VerticalAlignment = VerticalAlignment.Stretch;
        RailSurface.BorderThickness = new Thickness(0, 0, 1, 0);

        RailBrandRow.Height = new GridLength(
            profile.State is LauncherLayoutState.Expanded ? 104 : 90);
        RailContentRow.Height = new GridLength(1, GridUnitType.Star);
        RailAddRow.Height = GridLength.Auto;
        RailSpacerRow.Height = new GridLength(0);
        RailFooterRow.Height = new GridLength(54);
        Grid.SetRow(BrandLockup, 0);
        Grid.SetRowSpan(BrandLockup, 1);
        BrandLockup.Width = profile.RailExtent - 4;
        BrandLockup.Height = profile.State is LauncherLayoutState.Expanded ? 104 : 90;
        BrandLockup.Margin = new Thickness(2, 0, 2, 0);
        BrandLockup.HorizontalAlignment = HorizontalAlignment.Center;
        BrandLockup.VerticalAlignment = VerticalAlignment.Top;
        BrandLogo.Width = profile.RailExtent - 10;
        BrandLogo.Height = profile.State is LauncherLayoutState.Expanded ? 92 : 80;
        BrandLogo.Margin = new Thickness(0, 7, 0, 0);
        AddGameButton.Visibility = Visibility.Visible;
        AddGameButton.Width = profile.IconSize;
        AddGameButton.Height = profile.IconSize;
        AddGameButton.Margin = new Thickness(0);
        AddGameButton.HorizontalAlignment = HorizontalAlignment.Center;
        AddGameButton.VerticalAlignment = VerticalAlignment.Center;
        KofiButton.Visibility = Visibility.Visible;
        KofiButton.Width = Math.Max(78, profile.RailExtent - 10);
        Grid.SetRow(KofiButton, 4);

        Grid.SetRow(GameSelector, 1);
        Grid.SetRowSpan(GameSelector, 1);
        Grid.SetColumn(GameSelector, 0);
        Grid.SetColumnSpan(GameSelector, 1);
        GameSelector.Width = profile.RailExtent;
        GameSelector.Height = double.NaN;
        GameSelector.Margin = new Thickness(0);
        GameSelector.HorizontalAlignment = HorizontalAlignment.Left;
        GameSelector.VerticalAlignment = VerticalAlignment.Top;
        ScrollViewer.SetHorizontalScrollMode(GameSelector, ScrollMode.Disabled);
        ScrollViewer.SetHorizontalScrollBarVisibility(GameSelector, ScrollBarVisibility.Hidden);
        ScrollViewer.SetVerticalScrollMode(GameSelector, ScrollMode.Enabled);
        ScrollViewer.SetVerticalScrollBarVisibility(GameSelector, ScrollBarVisibility.Auto);

        Grid.SetRow(ContentScroll, 0);
        Grid.SetRowSpan(ContentScroll, 2);
        Grid.SetColumn(ContentScroll, 1);
        Grid.SetColumnSpan(ContentScroll, 1);
        ContentScroll.Width = profile.ContentWidth;
        ContentScroll.HorizontalAlignment = HorizontalAlignment.Left;
        ContentScroll.VerticalAlignment = VerticalAlignment.Stretch;
        ContentScroll.Margin = profile.State is LauncherLayoutState.Wide
            ? new Thickness(
                30,
                38,
                18,
                profile.DeckHeight + toolLayoutExtraHeight
                + (WuWaAccountStatusStrip.Visibility is Visibility.Visible ? PublisherAccountStatusLayoutHeight : 0d)
                + 11)
            : new Thickness(
                30,
                20,
                18,
                profile.DeckHeight + toolLayoutExtraHeight
                + (WuWaAccountStatusStrip.Visibility is Visibility.Visible ? PublisherAccountStatusLayoutHeight : 0d)
                + 42);

        Grid.SetRow(CommandDeck, 0);
        Grid.SetRowSpan(CommandDeck, 2);
        Grid.SetColumn(CommandDeck, 1);
        Grid.SetColumnSpan(CommandDeck, 2);
        CommandDeck.Margin = new Thickness(0);
    }

    private void ApplyCommandDeckLayout(LauncherLayoutProfile profile, double width)
    {
        var compact = profile.State is LauncherLayoutState.Compact;
        var horizontal = profile.State is LauncherLayoutState.Horizontal;
        compactCodeRows = compact;
        var accountStatusExtra = WuWaAccountStatusStrip.Visibility is Visibility.Visible ? PublisherAccountStatusLayoutHeight : 0d;
        var horizontalDeck = horizontal
            || (profile.State is LauncherLayoutState.Wide
                && width < LauncherViewportGeometry.NarrowWideDeckWidth);
        toolLayoutExtraHeight = 0;
        CommandDeck.Height = profile.DeckHeight + accountStatusExtra;

        CommandDeck.Padding = compact
            ? new Thickness(12, 12, 12, 12)
            : horizontalDeck
                ? new Thickness(14, 9, 14, 9)
                : profile.State is LauncherLayoutState.Wide
                    ? new Thickness(26, 8, 26, 8)
                    : new Thickness(26, 8, 26, 8);
        CommandDeckGrid.ColumnSpacing = compact
            ? 0
            : horizontalDeck ? 12 : profile.State is LauncherLayoutState.Wide ? 16 : 20;
        CommandDeckGrid.RowSpacing = compact || horizontalDeck ? 8 : 6;

        SignalPanel.MinWidth = 0;
        ApplyCombinedStatusLayout(compact, horizontalDeck, profile.State);
        CombinedStatusGrid.ColumnSpacing = compact ? 12 : 16;
        CombinedStatusGrid.RowSpacing = compact ? 2 : 8;
        PengoToolsLabel.Visibility = Visibility.Collapsed;
        PengoToolButtons.Margin = new Thickness(0);
        UpdaterSignalRow.Margin = compact
            ? new Thickness(LauncherViewportGeometry.CompactOfficialInset, 0, 0, 0)
            : new Thickness(0, 0, 0, 0);
        NyxToolsPanel.Margin = new Thickness(0);
        PullExportToggle.Width = 100;
        AchievementExportToggle.Width = 122;
        OpenUpdaterButton.Width = 152;
        NyxToolsStatusText.Visibility = Visibility.Visible;
        SetRedemptionCodeMetadataVisibility();
        LaunchStack.VerticalAlignment = VerticalAlignment.Center;
        CombinedStatusPanel.VerticalAlignment = VerticalAlignment.Top;
        SignalStack.Visibility = Visibility.Visible;
        LaunchStack.Margin = horizontalDeck
            ? new Thickness(0, LauncherViewportGeometry.TwoRowGap, 0, 0)
            : profile.State is LauncherLayoutState.Wide
                ? new Thickness(0, 5, 0, 0)
                : new Thickness(0, 10, 0, 0);
        LaunchButton.Margin = new Thickness(0);
        CombinedStatusPanel.Height = double.NaN;
        SetRedemptionCodeRowHeight(compact || horizontalDeck ? 17 : 24);

        if (compact)
        {
            LaunchStack.Width = double.NaN;
            LaunchStack.Height = LauncherViewportGeometry.CompactCtaHeight + accountStatusExtra;
            LaunchButton.Width = double.NaN;
            LaunchButton.Height = LauncherViewportGeometry.CompactCtaHeight;
            DeckRow0.Height = new GridLength(LauncherViewportGeometry.CompactStatusHeight);
            DeckRow1.Height = new GridLength(LauncherViewportGeometry.CompactCtaHeight + accountStatusExtra);
            DeckRow2.Height = new GridLength(LauncherViewportGeometry.CompactToolsHeight);
            DeckColumn0.Width = new GridLength(LauncherViewportGeometry.CompactLocalWidth);
            DeckColumn1.Width = new GridLength(1, GridUnitType.Star);
            DeckColumn2.Width = new GridLength(0);
            DeckColumn3.Width = new GridLength(0);

            PlaceDeckItem(CombinedStatusPanel, 0, 0, 1, 2);
            PlaceDeckItem(LaunchStack, 1, 0, 1, 2);
            PlaceDeckItem(NyxToolsPanel, 2, 0, 1, 2);
            LaunchStack.HorizontalAlignment = HorizontalAlignment.Stretch;
            ApplyToolButtonLayout(width - 24, forceStacked: true);
            return;
        }

        if (horizontalDeck)
        {
            LaunchStack.Width = double.NaN;
            LaunchStack.Height = LauncherViewportGeometry.TwoRowActionHeight + accountStatusExtra;
            LaunchButton.Width = double.NaN;
            LaunchButton.Height = LauncherViewportGeometry.TwoRowActionHeight;
            DeckRow0.Height = new GridLength(
                profile.State is LauncherLayoutState.Wide
                    ? LauncherViewportGeometry.WideTwoRowStatusHeight
                    : LauncherViewportGeometry.TwoRowStatusHeight);
            DeckRow1.Height = new GridLength(62 + accountStatusExtra);
            DeckRow2.Height = new GridLength(40);
            DeckColumn0.Width = new GridLength(1, GridUnitType.Star);
            DeckColumn1.Width = new GridLength(1, GridUnitType.Star);
            DeckColumn2.Width = new GridLength(profile.LaunchWidth / 2);
            DeckColumn3.Width = new GridLength(profile.LaunchWidth / 2);

            PlaceDeckItem(CombinedStatusPanel, 0, 0, 1, 4);
            PlaceDeckItem(LaunchStack, 1, 0, 1, 4);
            PlaceDeckItem(NyxToolsPanel, 2, 0, 1, 4);
            LaunchStack.HorizontalAlignment = HorizontalAlignment.Stretch;
            ApplyToolButtonLayout(width - 28, forceStacked: false);
            return;
        }

        DeckRow0.Height = new GridLength(
            (profile.State is LauncherLayoutState.Wide ? 110 : 166) + accountStatusExtra);
        var toolLayoutHeight = ApplyToolButtonLayout(profile.LaunchWidth, forceStacked: false);
        toolLayoutExtraHeight = Math.Max(0, toolLayoutHeight - 40);
        CommandDeck.Height = profile.DeckHeight + accountStatusExtra + toolLayoutExtraHeight;
        DeckRow1.Height = new GridLength(toolLayoutHeight);
        DeckRow2.Height = new GridLength(0);
        DeckColumn0.Width = new GridLength(
            profile.State is LauncherLayoutState.Wide ? 220 : 210);
        DeckColumn1.Width = new GridLength(1, GridUnitType.Star);
        DeckColumn2.Width = new GridLength(
            0);
        DeckColumn3.Width = new GridLength(profile.LaunchWidth);
        LaunchStack.Width = profile.LaunchWidth;
        LaunchButton.Width = profile.LaunchWidth;

        PlaceDeckItem(
            CombinedStatusPanel,
            0,
            0,
            profile.State is LauncherLayoutState.Wide or LauncherLayoutState.Expanded ? 2 : 1,
            3);
        PlaceDeckItem(NyxToolsPanel, 1, 3, 1, 1);
        PlaceDeckItem(LaunchStack, 0, 3, 1, 1);
        LaunchButton.Height = profile.State is LauncherLayoutState.Wide ? 110 : 166;
        LaunchStack.Height = LaunchButton.Height + accountStatusExtra;
        LaunchStack.VerticalAlignment = VerticalAlignment.Top;
        LaunchStack.Margin = profile.State is LauncherLayoutState.Wide
            ? new Thickness(0, 5, 0, 0)
            : new Thickness(0);
        CombinedStatusPanel.Height = double.NaN;
        CombinedStatusPanel.Margin = new Thickness(0);
        CombinedStatusPanel.VerticalAlignment = VerticalAlignment.Stretch;
        CombinedStatusPanel.CornerRadius = profile.State is LauncherLayoutState.Wide or LauncherLayoutState.Expanded
            ? new CornerRadius(10, 10, 0, 0)
            : new CornerRadius(10);
        NyxToolsPanel.Margin = new Thickness(0);
        NyxToolsPanel.VerticalAlignment = VerticalAlignment.Top;
        NyxToolsStatusText.Visibility = Visibility.Collapsed;
        LaunchStack.HorizontalAlignment = HorizontalAlignment.Stretch;
    }

    private void ApplyCombinedStatusLayout(
        bool compact,
        bool horizontalDeck,
        LauncherLayoutState state)
    {
        CombinedStatusGrid.RowDefinitions.Clear();
        CombinedStatusGrid.ColumnDefinitions.Clear();
        if (compact)
        {
            CombinedStatusGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            CombinedStatusGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(90) });
            CombinedStatusGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            CombinedStatusGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            CombinedStatusGrid.ColumnDefinitions.Add(CombinedBannerColumn);
            CombinedStatusGrid.ColumnDefinitions.Add(CombinedOfficialColumn);
            CombinedStatusGrid.ColumnDefinitions.Add(CombinedLocalColumn);
            CombinedBannerColumn.Width = new GridLength(1, GridUnitType.Star);
            CombinedOfficialColumn.Width = new GridLength(1, GridUnitType.Star);
            CombinedLocalColumn.Width = new GridLength(0);
            PlaceDeckItem(PremiumCodesLabel, 0, 0, 1, 2);
            PlaceDeckItem(SignalPanel, 1, 0, 1, 2);
            PlaceDeckItem(OfficialStatusLabel, 2, 0, 1, 1);
            PlaceDeckItem(LocalStatusLabel, 2, 1, 1, 1);
            PlaceDeckItem(UpdaterSignalRow, 3, 0, 1, 1);
            PlaceDeckItem(LocalSignalPanel, 3, 1, 1, 1);
            return;
        }

        CombinedStatusGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        CombinedStatusGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        CombinedStatusGrid.ColumnDefinitions.Add(CombinedBannerColumn);
        CombinedStatusGrid.ColumnDefinitions.Add(CombinedOfficialColumn);
        CombinedStatusGrid.ColumnDefinitions.Add(CombinedLocalColumn);
        CombinedBannerColumn.Width = new GridLength(horizontalDeck ? 220 : state is LauncherLayoutState.Wide ? 330 : 300);
        CombinedOfficialColumn.Width = new GridLength(1, GridUnitType.Star);
        CombinedLocalColumn.Width = new GridLength(horizontalDeck ? 124 : 116);
        PlaceDeckItem(PremiumCodesLabel, 0, 0, 1, 1);
        PlaceDeckItem(OfficialStatusLabel, 0, 1, 1, 1);
        PlaceDeckItem(LocalStatusLabel, 0, 2, 1, 1);
        PlaceDeckItem(SignalPanel, 1, 0, 1, 1);
        PlaceDeckItem(UpdaterSignalRow, 1, 1, 1, 1);
        PlaceDeckItem(LocalSignalPanel, 1, 2, 1, 1);
    }

    private double ApplyToolButtonLayout(double availableWidth, bool forceStacked)
    {
        var visibleButtonCount = new FrameworkElement[]
        {
            PullExportToggle,
            AchievementExportToggle,
            OpenUpdaterButton,
            CancelExportButton,
            OpenExportsButton,
        }.Count(button => button.Visibility is Visibility.Visible);
        var requiredWidth = 100 + 120 + 146 + Math.Max(0, visibleButtonCount - 1) * 6;
        if (CancelExportButton.Visibility is Visibility.Visible) requiredWidth += 86;
        if (OpenExportsButton.Visibility is Visibility.Visible) requiredWidth += 98;
        var stacked = forceStacked || requiredWidth > availableWidth;
        PengoToolButtons.Orientation = stacked ? Orientation.Vertical : Orientation.Horizontal;
        PengoToolButtons.HorizontalAlignment = HorizontalAlignment.Stretch;
        foreach (var button in new FrameworkElement[]
        {
            PullExportToggle,
            AchievementExportToggle,
            OpenUpdaterButton,
            CancelExportButton,
            OpenExportsButton,
        })
        {
            button.HorizontalAlignment = HorizontalAlignment.Stretch;
            button.Width = stacked ? double.NaN : button switch
            {
                _ when ReferenceEquals(button, PullExportToggle) => 100,
                _ when ReferenceEquals(button, AchievementExportToggle) => 120,
                _ when ReferenceEquals(button, OpenUpdaterButton) => 146,
                _ => double.NaN,
            };
        }
        return stacked ? (visibleButtonCount * 42) + (Math.Max(0, visibleButtonCount - 1) * 6) : 42;
    }

    private void SetRedemptionCodeRowHeight(double height)
    {
        redemptionCodeRowHeight = height;
        foreach (var row in RedemptionCodeRows)
        {
            row.SetRowHeight(height);
        }
    }

    private void SetRedemptionCodeMetadataVisibility()
    {
        foreach (var row in RedemptionCodeRows)
        {
            row.SetMetadataVisibility(!compactCodeRows);
        }
    }

    private static void PlaceDeckItem(
        FrameworkElement element,
        int row,
        int column,
        int rowSpan,
        int columnSpan)
    {
        Grid.SetRow(element, row);
        Grid.SetColumn(element, column);
        Grid.SetRowSpan(element, rowSpan);
        Grid.SetColumnSpan(element, columnSpan);
    }

    private void ApplyMaintenanceLayout(LauncherLayoutState state)
    {
        var compact = state is LauncherLayoutState.Compact;
        var stackedActions = state is not LauncherLayoutState.Horizontal;

        UpdaterSignalLayout.ColumnDefinitions.Clear();
        UpdaterSignalLayout.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        UpdaterSignalLayout.ColumnDefinitions.Add(new ColumnDefinition
        {
            Width = new GridLength(1, GridUnitType.Star),
        });
        if (!stackedActions)
        {
            UpdaterSignalLayout.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            UpdaterSignalLayout.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        }

        UpdaterSignalStack.Spacing = compact ? 2 : 7;
        HeroDescription.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        MaintenanceOwnershipText.Visibility = Visibility.Collapsed;
        UpdaterSignalLayout.RowSpacing = compact ? 2 : stackedActions ? 6 : 0;
        Grid.SetRow(MaintenanceProviderText, 0);
        Grid.SetColumn(MaintenanceProviderText, 0);
        Grid.SetRow(UpdaterSignalText, stackedActions ? 1 : 0);
        Grid.SetColumn(UpdaterSignalText, stackedActions ? 0 : 1);
        Grid.SetColumnSpan(UpdaterSignalText, stackedActions ? 2 : 1);

        Grid.SetRow(ChooseGameFolderButton, 0);
        Grid.SetColumn(ChooseGameFolderButton, 0);
        ChooseGameFolderButton.HorizontalAlignment = HorizontalAlignment.Left;
    }

    private void ApplyVerticalDensity(LauncherLayoutProfile profile, double height)
    {
        var dense = height < LauncherLayoutStateSelector.ExpandedHeight;
        LatestStrip.Margin = new Thickness(0);
        LatestStrip.MinHeight = profile.State switch
        {
            LauncherLayoutState.Compact => 320,
            LauncherLayoutState.Horizontal => 320,
            LauncherLayoutState.Wide => 493,
            _ => 460,
        };
    }

    private void RenderSelection()
    {
        RefreshGameRailSignals();
        if (GameSignalText is null || GameSelector?.SelectedItem is not GameLauncherItem selected)
        {
            return;
        }

        MaintenanceProviderText.Text = selected.MaintenanceProvider;
        ApplySelectedAppearance(selected.Id);
        ChooseGameFolderButton.Visibility = Visibility.Collapsed;
        gameSnapshot = sessions.TryGetSnapshot(selected.Id, out var selectedSnapshot)
            ? selectedSnapshot
            : null;
        ChooseGameFolderButton.Visibility = !selected.IsCustom
            && gameSnapshot?.Readiness is LocalReadinessEvidence.NotFound or LocalReadinessEvidence.NeedsReview
                ? Visibility.Visible
                : Visibility.Collapsed;
        ChooseGameFolderButton.Content = endfieldFolderActionInFlight ? "CHOOSING…" : "FIND GAME CLIENT";
        ChooseGameFolderButton.IsEnabled = !endfieldFolderActionInFlight;
        LatestStrip.Visibility = !selected.IsCustom
            && launcherState.Snapshot.Preferences.FeatureFlags.RemoteBannerManifest
                ? Visibility.Visible
                : Visibility.Collapsed;
        CombinedStatusPanel.Visibility = selected.IsCustom
            ? Visibility.Collapsed
            : Visibility.Visible;
        WuWaAccountStatusStrip.Visibility = !selected.IsCustom
            ? Visibility.Visible
            : Visibility.Collapsed;
        if (selected.Id == "wuwa") RenderWuWaAccountStatus();
        else RenderPublisherAccountStatus(selected.Id);
        RedemptionCodeList.Visibility = Visibility.Visible;
        if (ActualWidth > 0 && ActualHeight > 0) ApplyLayout(ActualWidth, ActualHeight);
        if (launcherState.Snapshot.SelectedGameId != selected.Id)
        {
            _ = launcherState.TryUpdate(state => state with { SelectedGameId = selected.Id });
        }
        RenderBannerCycle();
        RenderExportTools(selected);

        if (selected.IsCustom)
        {
            RenderCustomGame(selected);
            return;
        }

        if (selected.Id == "gi")
        {
            RenderGenshin();
            return;
        }

        if (selected.Id is "hsr" or "zzz")
        {
            RenderHoyo(selected);
            return;
        }

        if (selected.Id == "wuwa")
        {
            RenderWuWa(selected);
            return;
        }

        RenderEndfield(selected);
    }

    private void ApplySelectedAppearance(string gameId)
    {
        var state = launcherState.Snapshot;
        var appearance = state.Appearance.TryGetValue(gameId, out var savedAppearance)
            ? savedAppearance
            : new Nyx.Desktop.Core.State.GameAppearanceState();
        var pinned = TryApplyPinnedArt(appearance);
        var automaticBannerExpected = !pinned
            && appearance.AutomaticArt
            && state.Preferences.FeatureFlags.AutomaticArt
            && launcherBanners.Current.Games.TryGetValue(gameId, out var bannerGame)
            && bannerGame.Current is { } current
            && (current.Variants.Count > 0 || current.Characters.Any(character => character.Variants.Count > 0));
        if (!pinned
            && !automaticBannerExpected
            && GameSelector?.SelectedItem is GameLauncherItem selected
            && string.Equals(selected.Id, gameId, StringComparison.Ordinal))
        {
            SetHeroSource(selected.HeroArtPath, Stretch.UniformToFill);
            ApplyHeroTransform(appearance);
        }
        var path = appearance.BackgroundPath;
        if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
        {
            SetBackgroundSource(path);
        }
        else
        {
            SetBackgroundSource("ms-appx:///Assets/backgroundnyx.png");
        }
    }

    private void SetHeroSource(string source, Stretch stretch)
    {
        if (string.Equals(displayedHeroSource, source, StringComparison.OrdinalIgnoreCase))
        {
            if (heroCrossfade is null)
            {
                HeroArtwork.Stretch = stretch;
            }
            else
            {
                HeroArtworkNext.Stretch = stretch;
            }

            return;
        }
        heroCrossfade?.Stop();
        if (HeroArtworkNext.Opacity > 0 && HeroArtworkNext.Source is not null)
        {
            HeroArtwork.Source = HeroArtworkNext.Source;
            HeroArtwork.Stretch = HeroArtworkNext.Stretch;
            CopyHeroTransform(HeroArtworkNext, HeroArtwork);
            HeroArtwork.Opacity = 1;
        }

        HeroArtworkNext.Stretch = stretch;
        HeroArtworkNext.Source = new BitmapImage(new Uri(source));
        HeroArtworkNext.Opacity = 0;
        CopyHeroTransform(HeroArtwork, HeroArtworkNext);
        displayedHeroSource = source;
        var fade = new Storyboard();
        var outgoing = new DoubleAnimation
        {
            From = 1,
            To = 0,
            Duration = new Duration(TimeSpan.FromMilliseconds(400)),
        };
        var incoming = new DoubleAnimation
        {
            From = 0,
            To = 1,
            Duration = new Duration(TimeSpan.FromMilliseconds(400)),
        };
        Storyboard.SetTarget(outgoing, HeroArtwork);
        Storyboard.SetTargetProperty(outgoing, "Opacity");
        Storyboard.SetTarget(incoming, HeroArtworkNext);
        Storyboard.SetTargetProperty(incoming, "Opacity");
        fade.Children.Add(outgoing);
        fade.Children.Add(incoming);
        fade.Completed += (_, _) =>
        {
            HeroArtwork.Source = HeroArtworkNext.Source;
            HeroArtwork.Stretch = HeroArtworkNext.Stretch;
            CopyHeroTransform(HeroArtworkNext, HeroArtwork);
            HeroArtwork.Opacity = 1;
            HeroArtworkNext.Opacity = 0;
            heroCrossfade = null;
        };
        heroCrossfade = fade;
        fade.Begin();
    }

    private static void CopyHeroTransform(Image source, Image destination)
    {
        if (source.RenderTransform is CompositeTransform sourceTransform
            && destination.RenderTransform is CompositeTransform destinationTransform)
        {
            destinationTransform.ScaleX = sourceTransform.ScaleX;
            destinationTransform.ScaleY = sourceTransform.ScaleY;
            destinationTransform.TranslateX = sourceTransform.TranslateX;
            destinationTransform.TranslateY = sourceTransform.TranslateY;
            destination.Width = source.Width;
            destination.Height = source.Height;
            destination.Margin = source.Margin;
            destination.HorizontalAlignment = source.HorizontalAlignment;
            destination.VerticalAlignment = source.VerticalAlignment;
        }
    }

    private void ApplyManagedHeroLayout(
        HeroArtFitGeometry.AutomaticPresentation presentation,
        int imageWidth,
        int imageHeight)
    {
        var targetArtwork = heroCrossfade is null ? HeroArtwork : HeroArtworkNext;
        if (!presentation.UsesCenteredCoverGeometry
            || HeroStage.ActualWidth <= 0
            || HeroStage.ActualHeight <= 0
            || imageWidth <= 0
            || imageHeight <= 0)
        {
            targetArtwork.Width = double.NaN;
            targetArtwork.Height = double.NaN;
            targetArtwork.Margin = new Thickness(0);
            targetArtwork.HorizontalAlignment = HorizontalAlignment.Stretch;
            targetArtwork.VerticalAlignment = VerticalAlignment.Stretch;
            return;
        }

        var cover = HeroArtFitGeometry.CalculateFittedBounds(
            HeroStage.ActualWidth,
            HeroStage.ActualHeight,
            imageWidth,
            imageHeight,
            "cover");
        targetArtwork.Width = cover.Width;
        targetArtwork.Height = cover.Height;
        targetArtwork.Margin = new Thickness(cover.X, cover.Y, 0, 0);
        targetArtwork.HorizontalAlignment = HorizontalAlignment.Left;
        targetArtwork.VerticalAlignment = VerticalAlignment.Top;
        targetArtwork.Stretch = Stretch.Fill;
    }

    private void ApplyHeroTransform(
        Nyx.Desktop.Core.State.GameAppearanceState appearance,
        double automaticAnchorOffsetX = 0,
        double automaticAnchorOffsetY = 0)
    {
        var targetArtwork = heroCrossfade is null ? HeroArtwork : HeroArtworkNext;
        if (targetArtwork.RenderTransform is not CompositeTransform transform)
        {
            return;
        }

        var profile = LauncherLayoutStateSelector.CreateProfile(ActualWidth, ActualHeight);
        var presentationScale = profile.State switch
        {
            LauncherLayoutState.Wide => 1.05d,
            LauncherLayoutState.Expanded => 1.15d,
            _ => 1d,
        };
        var automaticOffsetScale = profile.State is LauncherLayoutState.Wide ? 0.24d : 1d;
        transform.ScaleX = (appearance.ArtScale / 100d) * presentationScale;
        transform.ScaleY = (appearance.ArtScale / 100d) * presentationScale;
        transform.TranslateX = appearance.ArtX + (automaticAnchorOffsetX * automaticOffsetScale);
        transform.TranslateY = appearance.ArtY + automaticAnchorOffsetY;
    }

    private void SetBackgroundSource(string source)
    {
        if (string.Equals(displayedBackgroundSource, source, StringComparison.OrdinalIgnoreCase)) return;
        BackgroundArtwork.Source = new BitmapImage(new Uri(source));
        displayedBackgroundSource = source;
    }

    private void RenderCustomGame(GameLauncherItem selected)
    {
        LatestStrip.Visibility = Visibility.Collapsed;
        UpdaterSignalRow.Visibility = Visibility.Collapsed;
        NyxToolsPanel.Visibility = Visibility.Collapsed;
        RedemptionCodeList.Visibility = Visibility.Collapsed;

        var snapshot = gameSnapshot;
        if (snapshot is null || snapshot.Readiness is LocalReadinessEvidence.Unknown)
        {
            SetGameSignal("Checking…", "LavenderBrush");
            HeroDescription.Text = "Checking the exact custom executable.";
            SetLaunchControls(false, "CHECKING", "Verifying the saved file", $"Checking {selected.DisplayName}");
            return;
        }

        switch (snapshot.Status)
        {
            case LocalGameStatus.Ready:
                SetGameSignal("Ready", "LavenderBrush");
                HeroDescription.Text = "Custom executable verified.";
                SetLaunchControls(true, "LAUNCH", "Ready", $"Launch {selected.DisplayName}");
                break;
            case LocalGameStatus.Starting:
                SetGameSignal("Starting…", "LavenderBrush");
                HeroDescription.Text = "Waiting for the exact game process.";
                SetLaunchControls(false, "STARTING", "Waiting for the game", $"Starting {selected.DisplayName}");
                break;
            case LocalGameStatus.Running:
                SetGameSignal("Running", "MoonBrush");
                HeroDescription.Text = $"{selected.DisplayName} is running.";
                SetLaunchControls(false, "RUNNING", "Detected", $"{selected.DisplayName} is running");
                break;
            case LocalGameStatus.LaunchFailed:
                SetGameSignal("Launch failed", "MoonBrush");
                HeroDescription.Text = "The custom game did not start. Check its saved path in Settings.";
                SetLaunchControls(true, "TRY AGAIN", "Ready", $"Try launching {selected.DisplayName} again");
                break;
            case LocalGameStatus.NotFound:
                SetGameSignal("Moved or missing", "MistBrush");
                HeroDescription.Text = "The saved executable moved or is missing. Repair it in Settings.";
                SetLaunchControls(false, "NOT FOUND", "Repair the saved path", $"{selected.DisplayName} was not found");
                break;
            default:
                SetGameSignal("Needs review", "LavenderBrush");
                HeroDescription.Text = "Nyx could not prove the exact custom process.";
                SetLaunchControls(false, "LOCKED", "Review the saved path", $"{selected.DisplayName} needs review");
                break;
        }
    }

    private void RenderExportTools(GameLauncherItem selected)
    {
        var capability = ExportProviderCatalog.GetEnabled(
            selected.Id,
            launcherState.Snapshot.Preferences.FeatureFlags);
        var pullsAvailable = capability.Supports(ExportKind.Pulls);
        var achievementsAvailable = capability.Supports(ExportKind.Achievements);
        NyxToolsPanel.Visibility = selected.IsCustom ? Visibility.Collapsed : Visibility.Visible;
        if (selected.IsCustom) return;
        var armed = launcherState.Snapshot.Export.Games.TryGetValue(selected.Id, out var saved)
            ? saved
            : new Nyx.Desktop.Core.State.ExportGameArming();
        PullExportToggle.IsChecked = pullsAvailable && armed.PullsArmed;
        AchievementExportToggle.IsChecked = achievementsAvailable && armed.AchievementsArmed;
        PullExportToggle.Visibility = Visibility.Visible;
        AchievementExportToggle.Visibility = Visibility.Visible;
        PullExportToggle.IsEnabled = pullsAvailable;
        AchievementExportToggle.IsEnabled = achievementsAvailable;
        AutomationProperties.SetName(PullExportToggle, pullsAvailable
            ? $"Export pulls on the next {selected.DisplayName} launch"
            : $"Pull export for {selected.DisplayName} is coming later");
        AutomationProperties.SetName(AchievementExportToggle, achievementsAvailable
            ? $"Export achievements on the next {selected.DisplayName} launch"
            : $"Achievement export for {selected.DisplayName} is coming later");

        CancelExportButton.Visibility = Visibility.Collapsed;
        OpenExportsButton.Visibility = Visibility.Collapsed;
        if (latestExportJobs.TryGetValue(selected.Id, out var jobId))
        {
            var job = exports.GetSnapshot(jobId);
            CancelExportButton.Visibility = job.IsFinished ? Visibility.Collapsed : Visibility.Visible;
            OpenExportsButton.Visibility = job.IsFinished ? Visibility.Visible : Visibility.Collapsed;
            NyxToolsStatusText.Text = FormatExportStatus(job);
        }
        else
        {
            var kinds = (armed.PullsArmed, armed.AchievementsArmed) switch
            {
                (true, true) => "Pulls and achievements are armed for the next launch.",
                (true, false) => "Pull export is armed for the next launch.",
                (false, true) => "Achievement export is armed for the next launch.",
                _ => "Choose what Nyx should export after the next launch.",
            };
            NyxToolsStatusText.Text = kinds;
        }
        AutomationProperties.SetName(NyxToolsPanel, $"Nyx exports for {selected.DisplayName}");
        if (ActualWidth > 0 && ActualHeight > 0)
        {
            ApplyLayout(ActualWidth, ActualHeight);
        }
    }

    private static string FormatExportStatus(ExportJobSnapshot job)
    {
        if (!job.IsFinished)
        {
            if (job.Achievements.State is ExportTaskState.Preparing)
                return "Achievements: preparing capture before launch...";
            if (job.Pulls.State is ExportTaskState.Preparing)
                return "Pulls: safely checking the pre-launch cache...";
            if (job.Pulls.State is ExportTaskState.Running
                && job.Achievements.State is ExportTaskState.Running)
                return "Enter the world and open Wish or Warp History. Nyx continues automatically.";
            if (job.Pulls.State is ExportTaskState.Running)
                return "Open Wish or Warp History. Nyx continues automatically.";
            if (job.Achievements.State is ExportTaskState.Running)
                return "Return to the title, then enter the world. Nyx continues automatically.";
            return "Export is running. Keep the game open.";
        }
        if (job.State == ExportJobState.Completed) return "Export complete. The files are in Pengo Exports.";
        if (job.State == ExportJobState.Canceled) return "Export canceled. No unfinished file was kept.";
        if (job.State == ExportJobState.Unsupported) return "This game’s export provider is coming later.";
        var failures = new List<string>(2);
        if (job.Pulls.State is ExportTaskState.Failed)
            failures.Add(FormatPullFailure(job.Pulls.ErrorCode));
        if (job.Achievements.State is ExportTaskState.Failed)
            failures.Add(FormatAchievementFailure(job.Achievements.ErrorCode));
        return failures.Count == 0
            ? "The export did not finish, but the game launch was not blocked."
            : string.Join(" ", failures);
    }

    private static string FormatPullFailure(string? code) => code switch
    {
        PullExportErrorCodes.HistoryNotUpdated or PullExportErrorCodes.HistoryNotFound =>
            "Pulls: no fresh History update. Open Wish or Warp History, then try Export again.",
        PullExportErrorCodes.OutputFailed => "Pulls: Nyx could not create the export file.",
        _ => "Pulls: export failed without blocking the game.",
    };

    private static string FormatAchievementFailure(string? code) => code switch
    {
        "capture_timeout" or "capture_closed" or "timed-out" =>
            "Achievements: return to the title, enter the world, then try Export again.",
        "approval-canceled" => "Achievements: administrator approval was canceled.",
        "administrator_required" => "Achievements: Star Rail needs administrator approval.",
        "normal_user_required" => "Achievements: Genshin must run without administrator rights.",
        "output-missing" or "output_write_failed" => "Achievements: Nyx could not create the export file.",
        _ => "Achievements: export failed without blocking the game.",
    };

    private void RefreshGameRailSignals()
    {
        foreach (var game in Games)
        {
            var signal = GameRailSignalProjector.Project(
                game.Id,
                sessions.GetSnapshot(game.Id),
                publisherStatus.Current,
                directLaunchSupported: true);
            game.UpdateStatus(RailSignalGlyphs[signal.Kind], signal.Description);

            if (GameSelector?.ContainerFromItem(game) is ListViewItem container)
            {
                AutomationProperties.SetName(container, game.AccessibleName);
            }
        }
    }

    private void RenderBannerCycle()
    {
        if (GameSelector?.SelectedItem is not GameLauncherItem selected)
        {
            return;
        }

        LatestStrip.Visibility = !selected.IsCustom
            && launcherState.Snapshot.Preferences.FeatureFlags.RemoteBannerManifest
                ? Visibility.Visible
                : Visibility.Collapsed;
        if (!selected.IsCustom
            && launcherBanners.Current.Games.TryGetValue(selected.Id, out var launcherGame))
        {
            var health = launcherBanners.Current.Health.Games.TryGetValue(selected.Id, out var gameHealth)
                ? gameHealth.Status
                : launcherBanners.Current.Health.Status;
            AutomationProperties.SetName(
                LatestStrip,
                $"Current and next banners for {selected.DisplayName}. Nyx feed status: {health}.");

            SyncRedemptionCodeRows(selected.Id, launcherGame.Codes);

            var now = DateTimeOffset.UtcNow;
            var current = launcherGame.Current is { } live && live.Start <= now && now < live.End
                ? live
                : null;
            var next = launcherGame.Upcoming
                .Where(phase => phase.Start > now)
                .OrderBy(phase => phase.Start)
                .FirstOrDefault();
            var rotationContextKey = current is null
                ? $"{selected.Id}:none"
                : $"{selected.Id}:{current.Start:O}:{current.SelectedCharacterId}";
            if (!string.Equals(bannerRotationContextKey, rotationContextKey, StringComparison.Ordinal))
            {
                bannerRotationContextKey = rotationContextKey;
                bannerRotationIndex = GetPreferredBannerStartIndex(selected.Id);
                bannerRotationStartedAt = now;
                bannerRotationPauseStartedAt = null;
                bannerRotationProgressAtPause = 0;
            }
            ClearStaleBannerPin(selected.Id, current);
            RenderBannerRows(selected.Id, current, now);
            SetBannerCard(
                CurrentBannerCard,
                CurrentBannerImage,
                null,
                BannerCyclePhase,
                BannerCycleTiming,
                current?.Phase,
                current?.Characters ?? [],
                current is null ? "Banner unavailable" : "Character not announced",
                current is null ? string.Empty : $"Ends in {BannerTimingFormatter.FormatRemaining(current.End - now)}");
            SetBannerCard(
                NextBannerCard,
                NextBannerImage,
                NextBannerName,
                NextBannerPhase,
                NextBannerTiming,
                next?.Phase,
                next?.Characters ?? [],
                "Not announced",
                next is null ? string.Empty : $"Starts in {BannerTimingFormatter.FormatRemaining(next.Start - now)}");
            var hasUpcoming = next is not null && next.Characters.Count > 0;
            NextBannerCard.Visibility = hasUpcoming ? Visibility.Visible : Visibility.Collapsed;
            if (current is not null) ApplyLauncherBannerArt(selected.Id, current);
            return;
        }

        BannerCharacterRows.Clear();
        bannerPinnedGameId = null;
        bannerPinnedCharacterId = null;
        ResumeBannerRotation();
        NextBannerCard.Visibility = Visibility.Collapsed;
        SyncRedemptionCodeRows(selected.Id, []);
    }

    private void SyncRedemptionCodeRows(string gameId, IReadOnlyList<LauncherRedemptionCode> codes)
    {
        var visible = codes
            .OrderByDescending(static code => code.Added)
            .ThenBy(static code => code.Code, StringComparer.Ordinal)
            .Take(5)
            .ToArray();
        if (visible.Length == 0)
        {
            if (RedemptionCodeRows.Count != 1 || RedemptionCodeRows[0].IsCopyable)
            {
                RedemptionCodeRows.Clear();
                RedemptionCodeRows.Add(RedemptionCodeRowItem.Empty);
            }

            SetRedemptionCodeMetadataVisibility();
            return;
        }

        for (var index = 0; index < visible.Length; index++)
        {
            var code = visible[index];
            var existing = index < RedemptionCodeRows.Count ? RedemptionCodeRows[index] : null;
            if (existing is not null
                && existing.IsCopyable
                && string.Equals(existing.Code, code.Code, StringComparison.Ordinal))
            {
                continue;
            }

            var row = new RedemptionCodeRowItem(
                code.Code,
                code.Added,
                code.CurrencyAmount,
                code.CurrencyName,
                CurrencyIconFor(gameId),
                true,
                redemptionCodeRowHeight);
            if (launcherState.Snapshot.Preferences.CopiedRedemptionCodes.TryGetValue(gameId, out var copied)
                && copied.Contains(row.Code, StringComparer.Ordinal))
            {
                row.MarkPreviouslyCopied();
            }
            if (string.Equals(copiedCodeValue, row.Code, StringComparison.Ordinal))
            {
                row.MarkCopied();
                copiedCodeRow = row;
            }

            if (index < RedemptionCodeRows.Count)
            {
                RedemptionCodeRows[index] = row;
            }
            else
            {
                RedemptionCodeRows.Add(row);
            }
        }

        while (RedemptionCodeRows.Count > visible.Length)
        {
            RedemptionCodeRows.RemoveAt(RedemptionCodeRows.Count - 1);
        }
        SetRedemptionCodeMetadataVisibility();
    }

    private static string CurrencyIconFor(string gameId) => gameId switch
    {
        "ae" => "ms-appx:///Assets/Currency/ae.png",
        "gi" or "hsr" or "zzz" or "wuwa" => $"ms-appx:///Assets/Currency/{gameId}.webp",
        _ => string.Empty,
    };

    private void BannerRotationTimer_Tick(object? sender, object e)
    {
        if (bannerRotationPaused || bannerPinnedCharacterId is not null)
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        var progress = GetBannerRotationProgress(now);
        if (progress < 100)
        {
            bannerRotationTimer.Stop();
            bannerRotationTimer.Interval = BannerRotationSchedule.Remaining(progress);
            bannerRotationTimer.Start();
            return;
        }

        bannerRotationIndex++;
        bannerRotationStartedAt = now;
        bannerRotationTimer.Interval = BannerRotationSchedule.Duration;
        RenderBannerCycle();
    }

    private void BannerCountdownTimer_Tick(object? sender, object e)
    {
        if (GameSelector?.SelectedItem is GameLauncherItem { IsCustom: false })
        {
            RenderBannerCycle();
        }

        RenderLocalAccountTimeTick();
    }

    private void RenderLocalAccountTimeTick()
    {
        if (WuWaAccountStatusStrip.Visibility is not Visibility.Visible
            || GameSelector?.SelectedItem is not GameLauncherItem selected
            || selected.Id == "wuwa")
            return;

        // This is a local projection of the last snapshot. It never refreshes,
        // connects, checks in, or performs any account/network operation.
        RenderPublisherAccountStatus(selected.Id);
    }

    private void BannerPanel_PointerEntered(object sender, PointerRoutedEventArgs e)
    {
        bannerRotationPaused = true;
        PauseBannerRotation();
        UpdateBannerRotationTimerState();
    }

    private void BannerPanel_PointerExited(object sender, PointerRoutedEventArgs e)
    {
        bannerRotationPaused = false;
        ResumeBannerRotation();
        UpdateBannerRotationTimerState();
    }

    private void BannerCharacterRow_Click(object sender, RoutedEventArgs e)
    {
        if (GameSelector?.SelectedItem is not GameLauncherItem selected
            || sender is not Button { CommandParameter: string characterId }
            || string.IsNullOrWhiteSpace(characterId))
        {
            return;
        }

        if (IsBannerPinned(selected.Id) && string.Equals(bannerPinnedCharacterId, characterId, StringComparison.Ordinal))
        {
            bannerPinnedGameId = null;
            bannerPinnedCharacterId = null;
            ResumeBannerRotation();
        }
        else
        {
            bannerPinnedGameId = selected.Id;
            bannerPinnedCharacterId = characterId;
            PauseBannerRotation();
        }

        RenderBannerCycle();
        UpdateBannerRotationTimerState();
    }

    private void UpdateBannerRotationTimerState()
    {
        if (bannerRotationPaused || bannerPinnedCharacterId is not null || !IsLoaded)
        {
            bannerRotationTimer.Stop();
            return;
        }

        bannerRotationTimer.Stop();
        bannerRotationTimer.Interval = BannerRotationSchedule.Remaining(
            GetBannerRotationProgress(DateTimeOffset.UtcNow));
        bannerRotationTimer.Start();
    }

    private void PauseBannerRotation()
    {
        if (bannerRotationPauseStartedAt is not null)
        {
            return;
        }

        bannerRotationProgressAtPause = GetBannerRotationProgress(DateTimeOffset.UtcNow);
        bannerRotationPauseStartedAt = DateTimeOffset.UtcNow;
    }

    private void ResumeBannerRotation()
    {
        if (bannerRotationPaused || bannerPinnedCharacterId is not null)
        {
            return;
        }

        if (bannerRotationPauseStartedAt is null)
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        bannerRotationStartedAt = now - BannerRotationSchedule.ElapsedFromProgress(bannerRotationProgressAtPause);
        bannerRotationTimer.Interval = BannerRotationSchedule.Remaining(bannerRotationProgressAtPause);
        bannerRotationPauseStartedAt = null;
    }

    private double GetBannerRotationProgress(DateTimeOffset now)
    {
        if (bannerRotationPauseStartedAt is not null)
        {
            return bannerRotationProgressAtPause;
        }

        return BannerRotationSchedule.Progress(bannerRotationStartedAt, now);
    }

    private bool IsBannerPinned(string gameId) =>
        string.Equals(bannerPinnedGameId, gameId, StringComparison.Ordinal)
        && !string.IsNullOrWhiteSpace(bannerPinnedCharacterId);

    private void ClearStaleBannerPin(string gameId, LauncherBannersCurrentPhase? current)
    {
        var valid = current is not null
            && string.Equals(bannerPinnedGameId, gameId, StringComparison.Ordinal)
            && current.Characters
                .Take(5)
                .Any(character => string.Equals(character.Id, bannerPinnedCharacterId, StringComparison.Ordinal));
        if (valid || bannerPinnedCharacterId is null)
        {
            return;
        }

        bannerPinnedGameId = null;
        bannerPinnedCharacterId = null;
        ResumeBannerRotation();
        UpdateBannerRotationTimerState();
    }

    private int GetActiveBannerIndex(IReadOnlyList<LauncherBannersCharacter> characters)
    {
        var visibleCount = Math.Min(5, characters.Count);
        if (visibleCount == 0)
        {
            return -1;
        }

        if (!string.IsNullOrWhiteSpace(bannerPinnedCharacterId))
        {
            var pinnedIndex = characters
                .Take(visibleCount)
                .Select((character, index) => (character, index))
                .FirstOrDefault(item => string.Equals(item.character.Id, bannerPinnedCharacterId, StringComparison.Ordinal));
            if (pinnedIndex.character is not null)
            {
                return pinnedIndex.index;
            }
        }

        return bannerRotationIndex % visibleCount;
    }

    private LauncherBannersCharacter? GetActiveBannerCharacter(IReadOnlyList<LauncherBannersCharacter> characters)
    {
        var activeIndex = GetActiveBannerIndex(characters);
        return activeIndex < 0 ? null : characters[activeIndex];
    }

    private int GetPreferredBannerStartIndex(string gameId)
    {
        if (!launcherBanners.Current.Games.TryGetValue(gameId, out var game)
            || game.Current is not { } current
            || string.IsNullOrWhiteSpace(current.SelectedCharacterId))
        {
            return 0;
        }

        var preferredIndex = current.Characters
            .Take(5)
            .Select((character, index) => (character, index))
            .FirstOrDefault(item => string.Equals(
                item.character.Id,
                current.SelectedCharacterId,
                StringComparison.Ordinal));
        return preferredIndex.character is null ? 0 : preferredIndex.index;
    }

    private void RenderBannerRows(string gameId, LauncherBannersCurrentPhase? current, DateTimeOffset now)
    {
        if (current is null)
        {
            BannerCharacterRows.Clear();
            return;
        }

        var characters = current.Characters.Take(5).ToArray();
        var activeIndex = GetActiveBannerIndex(characters);
        var progress = GetBannerRotationProgress(now);
        var timing = $"Ends in {BannerTimingFormatter.FormatRemaining(current.End - now)}";
        for (var index = 0; index < characters.Length; index++)
        {
            var character = characters[index];
            var portrait = character.Icon is null
                ? null
                : launcherBanners.TryResolveManagedAsset(character.Icon);
            portrait ??= character.Variants
                .Select(launcherBanners.TryResolveManagedAsset)
                .FirstOrDefault(path => path is not null);
            var isActive = index == activeIndex;
            var isPinned = IsBannerPinned(gameId)
                && string.Equals(character.Id, bannerPinnedCharacterId, StringComparison.Ordinal);
            var existing = index < BannerCharacterRows.Count ? BannerCharacterRows[index] : null;
            if (existing is null || !string.Equals(existing.CharacterId, character.Id, StringComparison.Ordinal))
            {
                if (index < BannerCharacterRows.Count)
                {
                    BannerCharacterRows[index] = new BannerCharacterRowItem(
                        character,
                        portrait,
                        timing,
                        isActive,
                        isPinned,
                        isActive ? progress : 0);
                }
                else
                {
                    BannerCharacterRows.Add(new BannerCharacterRowItem(
                        character,
                        portrait,
                        timing,
                        isActive,
                        isPinned,
                        isActive ? progress : 0));
                }
            }
            else
            {
                existing.Update(portrait, timing, isActive, isPinned, isActive ? progress : 0);
            }
        }

        while (BannerCharacterRows.Count > characters.Length)
        {
            BannerCharacterRows.RemoveAt(BannerCharacterRows.Count - 1);
        }
    }

    private void SetBannerCard(
        Border card,
        Image image,
        TextBlock? nameText,
        TextBlock phaseText,
        TextBlock timingText,
        string? phase,
        IReadOnlyList<LauncherBannersCharacter> characters,
        string emptyName,
        string timing)
    {
        var character = characters.Count == 0
            ? null
            : GetActiveBannerCharacter(characters)
                ?? characters[bannerRotationIndex % characters.Count];
        var variants = character?.Variants ?? [];
        var asset = ReferenceEquals(image, NextBannerImage)
            ? character?.Icon
            : variants.Count == 0
                ? null
                : variants[bannerRotationIndex % variants.Count];
        asset ??= variants.Count == 0
            ? null
            : variants[bannerRotationIndex % variants.Count];
        var path = asset is null ? null : launcherBanners.TryResolveManagedAsset(asset);
        image.Source = path is null ? null : new BitmapImage(new Uri(path));
        image.Visibility = path is null ? Visibility.Collapsed : Visibility.Visible;
        phaseText.Text = string.IsNullOrWhiteSpace(phase)
            ? "VERSION —"
            : $"VERSION {phase.ToUpperInvariant()}";
        var bannerName = ReferenceEquals(image, NextBannerImage) && characters.Count > 1
            ? string.Join(" + ", characters.Take(5).Select(entry => entry.Name))
            : character?.Name ?? emptyName;
        if (nameText is not null)
        {
            nameText.Text = bannerName;
        }
        timingText.Text = timing;
        AutomationProperties.SetName(card, $"{bannerName}. {timing}".Trim());
    }

    private void ApplyLauncherBannerArt(string gameId, LauncherBannersCurrentPhase current)
    {
        var state = launcherState.Snapshot;
        var appearance = state.Appearance.TryGetValue(gameId, out var saved)
            ? saved
            : new Nyx.Desktop.Core.State.GameAppearanceState();
        if (!state.Preferences.FeatureFlags.AutomaticArt || !appearance.AutomaticArt)
        {
            return;
        }

        if (TryApplyPinnedArt(appearance)) return;

        var selectedCharacter = GetActiveBannerCharacter(current.Characters)
            ?? current.Characters.FirstOrDefault(character => character.Id == current.SelectedCharacterId)
            ?? current.Characters.FirstOrDefault();
        var artKey = selectedCharacter is null ? gameId : $"{gameId}:{selectedCharacter.Id}";
        var variants = selectedCharacter?.Variants.Count > 0
            ? selectedCharacter.Variants
            : current.Variants;
        var allCurrentVariants = current.Characters
            .SelectMany(character => character.Variants)
            .Concat(current.Variants)
            .DistinctBy(asset => asset.Id)
            .ToArray();
        var pinMigration = LauncherPinnedArtMigration.Evaluate(
            appearance,
            protectedFileValid: false,
            allCurrentVariants.Select(asset => asset.Id));
        LauncherBannersAsset? variant = null;
        if (!string.IsNullOrWhiteSpace(appearance.ArtVariant)
            && (!appearance.ArtPinned
                || pinMigration is LauncherPinnedArtMigrationStatus.AvailableForProtection))
        {
            // A saved choice is authoritative regardless of which character
            // happens to be active when the seven-second cycle is repainted.
            variant = allCurrentVariants.FirstOrDefault(asset => asset.Id == appearance.ArtVariant);
        }
        if (appearance.ArtPinned
            && launcherBanners.TryResolveUserArt(appearance.PinnedArtFile) is null
            && variant is not null)
        {
            string? migratedPin = null;
            try
            {
                migratedPin = launcherBanners.PinUserArt(gameId, variant);
                var pinToSave = migratedPin;
                var pinWasSaved = false;
                var migrated = launcherState.TryUpdate(currentState =>
                {
                    var currentAppearance = currentState.Appearance.TryGetValue(gameId, out var existing)
                        ? existing
                        : new Nyx.Desktop.Core.State.GameAppearanceState();
                    if (!currentAppearance.ArtPinned
                        || !string.Equals(currentAppearance.ArtVariant, variant.Id, StringComparison.Ordinal)
                        || (launcherBanners.TryResolveUserArt(currentAppearance.PinnedArtFile) is not null
                            && !string.Equals(currentAppearance.PinnedArtFile, pinToSave, StringComparison.Ordinal)))
                    {
                        return currentState;
                    }
                    if (string.Equals(currentAppearance.PinnedArtFile, pinToSave, StringComparison.Ordinal))
                    {
                        pinWasSaved = true;
                        return currentState;
                    }
                    var appearances = new Dictionary<string, Nyx.Desktop.Core.State.GameAppearanceState>(
                        currentState.Appearance,
                        StringComparer.Ordinal)
                    {
                        [gameId] = currentAppearance with
                        {
                            PinnedArtFile = pinToSave,
                            ArtFit = HeroArtFitGeometry.Normalize(variant.Placement.Fit),
                        },
                    };
                    pinWasSaved = true;
                    return currentState with { Appearance = appearances };
                });
                if (migrated && pinWasSaved)
                {
                    appearance = appearance with
                    {
                        PinnedArtFile = migratedPin,
                        ArtFit = HeroArtFitGeometry.Normalize(variant.Placement.Fit),
                    };
                    if (TryApplyPinnedArt(appearance)) return;
                }
                else
                {
                    migratedPin = null;
                }
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException)
            {
                migratedPin = null;
            }
        }
        if (variant is null
            && automaticArtVariants.TryGetValue(artKey, out var remembered)
            && remembered.Revision == launcherBanners.Current.Revision)
            variant = variants.FirstOrDefault(asset => asset.Id == remembered.VariantId);
        if (variant is null
            && automaticArtVariants.TryGetValue(gameId, out remembered)
            && remembered.Revision == launcherBanners.Current.Revision)
        {
            variant = allCurrentVariants.FirstOrDefault(asset => asset.Id == remembered.VariantId);
        }
        if (variant is null && variants.Count > 0)
        {
            variant = variants[Random.Shared.Next(variants.Count)];
            automaticArtVariants[artKey] = (launcherBanners.Current.Revision, variant.Id);
        }
        if (variant is null)
        {
            return;
        }
        var path = launcherBanners.TryResolveManagedAsset(variant);
        if (path is null)
        {
            return;
        }

        SetHeroSource(path, BannerAssetStretch(variant.Placement.Fit));
        var presentation = HeroArtFitGeometry.ManagedPresentation(
            gameId,
            variant.Placement.Fit,
            variant.Dimensions.Width,
            variant.Dimensions.Height);
        ApplyManagedHeroLayout(
            presentation,
            variant.Dimensions.Width,
            variant.Dimensions.Height);
        ApplyHeroTransform(
            appearance,
            presentation.UsesCenteredCoverGeometry
                ? 0
                : (variant.Placement.X - 0.5) * HeroStage.ActualWidth,
            (variant.Placement.Y - 0.5) * HeroStage.ActualHeight);
    }

    private static Stretch BannerAssetStretch(string? fit) =>
        HeroArtFitGeometry.Parse(fit) switch
        {
            HeroArtFit.Cover => Stretch.UniformToFill,
            HeroArtFit.Fill => Stretch.Fill,
            _ => Stretch.Uniform,
        };

    private bool TryApplyPinnedArt(Nyx.Desktop.Core.State.GameAppearanceState appearance)
    {
        if (!appearance.ArtPinned || launcherBanners.TryResolveUserArt(appearance.PinnedArtFile) is not { } path) return false;
        SetHeroSource(path, BannerAssetStretch(appearance.ArtFit));
        // A pinned file is already the user's chosen composition. Do not apply
        // a banner focal offset that belongs only to manifest-managed artwork.
        ApplyHeroTransform(appearance);
        return true;
    }

    private void RenderGenshin()
    {
        UpdaterSignalRow.Visibility = Visibility.Visible;
        OpenUpdaterButton.Visibility = Visibility.Visible;
        MaintenanceProviderText.Text = "HoYoPlay";

        if (gameSnapshot is null || gameSnapshot.Readiness is LocalReadinessEvidence.Unknown)
        {
            SetGameSignal("Checking…", "LavenderBrush");
            HeroDescription.Text = "Looking for the official Genshin Impact install.";
            SetLaunchControls(false, "CHECKING", "Verifying local files", "Checking Genshin Impact");
            RenderUpdater();
            return;
        }

        var gameVersion = genshinSession.Version;
        switch (gameSnapshot.Status)
        {
            case LocalGameStatus.Ready:
                SetGameSignal(WithVersion("Ready", gameVersion), "LavenderBrush");
                HeroDescription.Text = "Official files verified.";
                SetLaunchControls(true, "LAUNCH", WithVersion("Ready", gameVersion), "Launch Genshin Impact");
                break;
            case LocalGameStatus.Starting:
                SetGameSignal("Starting…", "LavenderBrush");
                HeroDescription.Text = "Nyx is waiting for the exact Genshin Impact process.";
                SetLaunchControls(false, "STARTING", "Waiting for the game", "Starting Genshin Impact");
                break;
            case LocalGameStatus.Running:
                SetGameSignal(WithVersion("Running", gameVersion), "MoonBrush");
                HeroDescription.Text = "Genshin Impact is already running.";
                SetRunningExportControls("Genshin Impact", gameVersion);
                break;
            case LocalGameStatus.LaunchFailed:
                RenderLaunchFailure(gameVersion);
                break;
            case LocalGameStatus.NeedsReview:
                SetGameSignal("Needs review", "LavenderBrush");
                HeroDescription.Text = "Nyx found something unexpected. Launching stays locked.";
                SetLaunchControls(false, "LOCKED", "Check with HoYoPlay", "Genshin Impact needs review");
                break;
            default:
                SetGameSignal("Not found", "MistBrush");
                HeroDescription.Text = "Genshin Impact was not found in HoYoPlay.";
                SetLaunchControls(false, "NOT FOUND", "Install with HoYoPlay", "Genshin Impact was not found");
                break;
        }

        RenderUpdater();
    }

    private void RenderHoyo(GameLauncherItem selected)
    {
        UpdaterSignalRow.Visibility = Visibility.Visible;
        OpenUpdaterButton.Visibility = Visibility.Visible;

        var snapshot = gameSnapshot;
        var version = hoyoSessions[selected.Id].Version;
        if (snapshot is null || snapshot.Readiness is LocalReadinessEvidence.Unknown)
        {
            SetGameSignal("Checking...", "LavenderBrush");
            HeroDescription.Text = $"Looking for the official {selected.DisplayName} install.";
            SetLaunchControls(false, "CHECKING", "Verifying local files", $"Checking {selected.DisplayName}");
            RenderUpdater();
            return;
        }

        switch (snapshot.Status)
        {
            case LocalGameStatus.Ready:
                SetGameSignal(WithVersion("Ready", version), "LavenderBrush");
                HeroDescription.Text = "Official files verified.";
                SetLaunchControls(true, "LAUNCH", WithVersion("Ready", version), $"Launch {selected.DisplayName}");
                break;
            case LocalGameStatus.Starting:
                SetGameSignal("Starting...", "LavenderBrush");
                HeroDescription.Text = $"Nyx is waiting for the exact {selected.DisplayName} process.";
                SetLaunchControls(false, "STARTING", "Waiting for the game", $"Starting {selected.DisplayName}");
                break;
            case LocalGameStatus.Running:
                SetGameSignal(WithVersion("Running", version), "MoonBrush");
                HeroDescription.Text = $"{selected.DisplayName} is already running.";
                SetRunningExportControls(selected.DisplayName, version);
                break;
            case LocalGameStatus.LaunchFailed:
                SetGameSignal("Launch failed", "MoonBrush");
                HeroDescription.Text = $"{selected.DisplayName} did not start. Check the install in HoYoPlay.";
                SetLaunchControls(true, "TRY AGAIN", WithVersion("Ready", version), $"Try launching {selected.DisplayName} again");
                break;
            case LocalGameStatus.NeedsReview:
                SetGameSignal("Needs review", "LavenderBrush");
                HeroDescription.Text = "Nyx found something unexpected. Launching stays locked.";
                SetLaunchControls(false, "LOCKED", "Check with HoYoPlay", $"{selected.DisplayName} needs review");
                break;
            default:
                SetGameSignal("Not found", "MistBrush");
                HeroDescription.Text = $"{selected.DisplayName} was not found in HoYoPlay.";
                SetLaunchControls(false, "NOT FOUND", "Install with HoYoPlay", $"{selected.DisplayName} was not found");
                break;
        }

        RenderUpdater();
    }

    private void RenderPublisherSession(GameLauncherItem selected)
    {
        var snapshot = gameSnapshot;
        if (snapshot is null || snapshot.Readiness is LocalReadinessEvidence.Unknown)
        {
            SetGameSignal("Checking…", "LavenderBrush");
            HeroDescription.Text = $"Looking for the official {selected.DisplayName} install.";
            SetLaunchControls(false, "CHECKING", "Verifying local files", $"Checking {selected.DisplayName}");
            return;
        }

        if (snapshot.Readiness is LocalReadinessEvidence.NotFound)
        {
            SetGameSignal("Not found", "MistBrush");
            HeroDescription.Text = selected.Id == "ae"
                ? "Choose the GRYPHLINK folder that contains Arknights: Endfield."
                : "The official Wuthering Waves install was not found.";
            SetLaunchControls(
                false,
                "NOT FOUND",
                selected.Id == "ae" ? "Choose the game folder" : "Check the official launcher",
                $"{selected.DisplayName} was not found");
            return;
        }

        switch (snapshot.Status)
        {
            case LocalGameStatus.Ready:
                SetGameSignal("Ready", "LavenderBrush");
                HeroDescription.Text = "Official files verified.";
                SetLaunchControls(true, "LAUNCH", "Ready", $"Launch {selected.DisplayName}");
                break;
            case LocalGameStatus.Starting:
                SetGameSignal("Starting…", "LavenderBrush");
                HeroDescription.Text = $"Nyx is waiting for the exact {selected.DisplayName} process.";
                SetLaunchControls(false, "STARTING", "Waiting for the game", $"Starting {selected.DisplayName}");
                break;
            case LocalGameStatus.Running:
                SetGameSignal("Running", "MoonBrush");
                HeroDescription.Text = $"{selected.DisplayName} is already running.";
                SetLaunchControls(false, "RUNNING", "Detected", $"{selected.DisplayName} is running");
                break;
            case LocalGameStatus.LaunchFailed:
                SetGameSignal("Launch failed", "MoonBrush");
                HeroDescription.Text = selected.Id == "wuwa"
                    ? "Wuthering Waves did not start. Check its files with the official launcher."
                    : "Arknights: Endfield did not start. Choose Change Folder if GRYPHLINK moved the game.";
                SetLaunchControls(true, "TRY AGAIN", "Ready", $"Try launching {selected.DisplayName} again");
                break;
            default:
                SetGameSignal("Needs review", "LavenderBrush");
                HeroDescription.Text = "Nyx found unexpected local files or could not prove the exact game process. Launching stays locked.";
                SetLaunchControls(false, "LOCKED", "Official files need review", $"{selected.DisplayName} needs review");
                break;
        }
    }

    private void RenderEndfield(GameLauncherItem selected)
    {
        UpdaterSignalRow.Visibility = Visibility.Visible;
        OpenUpdaterButton.Visibility = Visibility.Visible;
        OpenUpdaterButton.IsEnabled = WuWaMaintenanceInteractionPolicy.AllowsOpenOfficial(
            maintenanceReady: false,
            wuwaActionInFlight,
            hasRequest: wuwaMaintenanceRequest is not null);
        OpenUpdaterButton.Content = "Official Launcher";
        MaintenanceProviderText.Text = "GRYPHLINK";
        RenderEndfieldMaintenance();

        RenderPublisherSession(selected);
    }

    private void RenderEndfieldMaintenance()
    {
        if (!endfieldMaintenanceScanFinished || endfieldMaintenanceStatus is null)
        {
            UpdaterSignalText.Text = "Checking official maintenance…";
            OpenUpdaterButton.IsEnabled = false;
            AutomationProperties.SetName(OpenUpdaterButton, "Checking the official GRYPHLINK launcher");
            return;
        }

        switch (endfieldMaintenanceStatus)
        {
            case EndfieldOfficialMaintenanceStatus.Ready:
                UpdaterSignalText.Text = endfieldMaintenanceReason is PublisherGameInspectionReason.VersionUnavailable
                    ? "Official maintenance ready · version status unavailable"
                    : "Official maintenance ready";
                OpenUpdaterButton.IsEnabled = !endfieldMaintenanceActionInFlight
                    && !endfieldFolderActionInFlight;
                AutomationProperties.SetName(
                    OpenUpdaterButton,
                    "Open GRYPHLINK for Endfield updates, pre-downloads, verification and repairs");
                break;
            case EndfieldOfficialMaintenanceStatus.Running:
                UpdaterSignalText.Text = "GRYPHLINK open · official maintenance only";
                OpenUpdaterButton.IsEnabled = false;
                AutomationProperties.SetName(OpenUpdaterButton, "GRYPHLINK is running");
                break;
            case EndfieldOfficialMaintenanceStatus.Opened:
                UpdaterSignalText.Text = "GRYPHLINK start requested";
                OpenUpdaterButton.IsEnabled = false;
                AutomationProperties.SetName(OpenUpdaterButton, "GRYPHLINK start requested");
                break;
            case EndfieldOfficialMaintenanceStatus.Failed:
                UpdaterSignalText.Text = "GRYPHLINK failed to open";
                OpenUpdaterButton.Content = "Try Again";
                OpenUpdaterButton.IsEnabled = !endfieldMaintenanceActionInFlight
                    && !endfieldFolderActionInFlight;
                AutomationProperties.SetName(OpenUpdaterButton, "Try opening GRYPHLINK again");
                break;
            case EndfieldOfficialMaintenanceStatus.NotFound:
                UpdaterSignalText.Text = "Choose the GRYPHLINK folder";
                OpenUpdaterButton.IsEnabled = false;
                AutomationProperties.SetName(OpenUpdaterButton, "GRYPHLINK folder is not configured");
                break;
            default:
                UpdaterSignalText.Text = "Official maintenance needs review";
                OpenUpdaterButton.IsEnabled = false;
                AutomationProperties.SetName(OpenUpdaterButton, "GRYPHLINK maintenance needs review");
                break;
        }
    }

    private void ApplyEndfieldMaintenanceResult(EndfieldOfficialMaintenanceResult result)
    {
        endfieldMaintenanceStatus = result.Status;
        endfieldMaintenanceReason = result.InspectionReason;
    }

    private void RenderWuWa(GameLauncherItem selected)
    {
        UpdaterSignalRow.Visibility = Visibility.Visible;
        OpenUpdaterButton.Visibility = Visibility.Visible;
        OpenUpdaterButton.IsEnabled = false;
        OpenUpdaterButton.Content = "Official Launcher";
        MaintenanceProviderText.Text = "KURO GAMES";
        RenderPublisherSession(selected);

        if (IsWuWaAccountStatusEnabled()
            && !wuwaAccountInitialRefreshRequested
            && pageLease is { } lease)
        {
            wuwaAccountInitialRefreshRequested = true;
            _ = RefreshWuWaAccountStatusAsync(lease);
        }

        if (!wuwaScanFinished || wuwaMaintenanceStatus is null)
        {
            UpdaterSignalText.Text = "Checking official maintenance…";
            AutomationProperties.SetName(OpenUpdaterButton, "Checking the Wuthering Waves launcher");
            return;
        }

        switch (wuwaMaintenanceStatus)
        {
            case WuWaOfficialMaintenanceStatus.Ready:
                UpdaterSignalText.Text = wuwaMaintenanceReason is PublisherGameInspectionReason.VersionConflict
                    ? "Official maintenance ready · local versions differ"
                    : "Official maintenance ready";
                OpenUpdaterButton.Visibility = Visibility.Visible;
                OpenUpdaterButton.IsEnabled = WuWaMaintenanceInteractionPolicy.AllowsOpenOfficial(
                    maintenanceReady: true,
                    wuwaActionInFlight,
                    hasRequest: wuwaMaintenanceRequest is not null);
                AutomationProperties.SetName(
                    OpenUpdaterButton,
                    "Open the official Wuthering Waves launcher for maintenance");
                break;
            case WuWaOfficialMaintenanceStatus.Running:
                UpdaterSignalText.Text = "Official launcher open";
                OpenUpdaterButton.Visibility = Visibility.Visible;
                OpenUpdaterButton.IsEnabled = WuWaMaintenanceInteractionPolicy.AllowsOpenOfficial(
                    maintenanceReady: false,
                    wuwaActionInFlight,
                    hasRequest: wuwaMaintenanceRequest is not null);
                AutomationProperties.SetName(OpenUpdaterButton, "Wuthering Waves launcher is running");
                break;
            case WuWaOfficialMaintenanceStatus.Opened:
                UpdaterSignalText.Text = "Official launcher start requested";
                OpenUpdaterButton.IsEnabled = WuWaMaintenanceInteractionPolicy.AllowsOpenOfficial(
                    maintenanceReady: false,
                    wuwaActionInFlight,
                    hasRequest: wuwaMaintenanceRequest is not null);
                AutomationProperties.SetName(OpenUpdaterButton, "Wuthering Waves launcher start requested");
                break;
            case WuWaOfficialMaintenanceStatus.Failed:
                UpdaterSignalText.Text = "Official launcher failed to open";
                OpenUpdaterButton.IsEnabled = WuWaMaintenanceInteractionPolicy.AllowsOpenOfficial(
                    maintenanceReady: false,
                    wuwaActionInFlight,
                    hasRequest: wuwaMaintenanceRequest is not null);
                AutomationProperties.SetName(OpenUpdaterButton, "Wuthering Waves launcher failed to open");
                break;
            case WuWaOfficialMaintenanceStatus.NotFound:
                UpdaterSignalText.Text = "Official launcher not found";
                AutomationProperties.SetName(OpenUpdaterButton, "Wuthering Waves launcher was not found");
                break;
            default:
                UpdaterSignalText.Text = "Official maintenance needs review";
                OpenUpdaterButton.IsEnabled = WuWaMaintenanceInteractionPolicy.AllowsOpenOfficial(
                    maintenanceReady: false,
                    wuwaActionInFlight,
                    hasRequest: wuwaMaintenanceRequest is not null);
                AutomationProperties.SetName(OpenUpdaterButton, "Wuthering Waves maintenance needs review");
                break;
        }
    }

    private void RenderWuWaAccountStatus()
    {
        AccountProviderText.Text = "ROVER";
        AccountConnectionWarningText.Text = "Unofficial local connection · may stop working.";
        AutomationProperties.SetHelpText(
            WuWaAccountStatusStrip,
            AccountConnectionWarningText.Text);
        PublisherAccountConnectButton.Visibility = Visibility.Collapsed;
        DailyCheckInButton.Visibility = Visibility.Collapsed;
        AutomationProperties.SetName(WuWaAccountStatusStrip, "Wuthering Waves Rover status");
        AutomationProperties.SetName(WuWaAccountStatusToggle, "Enable or disable local Wuthering Waves Rover status");
        var enabled = IsWuWaAccountStatusEnabled();
        WuWaAccountStatusToggle.IsChecked = enabled;
        WuWaAccountStatusToggle.Content = enabled ? "ON" : "START";
        WuWaAccountStatusToggle.IsEnabled = !wuwaAccountStatusActionInFlight;
        WuWaAccountStatusRefreshButton.Visibility = enabled ? Visibility.Visible : Visibility.Collapsed;
        WuWaAccountStatusRefreshButton.IsEnabled = !wuwaAccountStatusActionInFlight;

        if (!enabled)
        {
            WuWaAccountMetricsText.Text = "ENERGY + DAILIES";
            WuWaAccountFreshnessText.Text = wuwaAccountStatusSaveFailed
                ? "OFF · SETTING NOT SAVED"
                : "OPT IN";
            return;
        }

        if (wuwaAccountStatusActionInFlight)
        {
            // Do not show an earlier account while the cache identity is being
            // re-established for this request.
            WuWaAccountMetricsText.Text = "Checking official account status";
            WuWaAccountFreshnessText.Text = "CHECKING";
            return;
        }

        var result = wuwaAccountStatus.Current;
        if (result?.Snapshot is { } snapshot)
        {
            WuWaAccountMetricsText.Text =
                $"WP {snapshot.Energy}/{snapshot.MaxEnergy}  ·  RES {snapshot.StoreEnergy}  ·  DAILY {snapshot.Liveness}/{snapshot.LivenessMaxCount}";
        }
        else
        {
            WuWaAccountMetricsText.Text = "Waiting for official account status";
        }

        if (wuwaAccountStatusActionInFlight || result is null) return;
        var age = result.SuccessfulAt is { } successfulAt
            ? FormatAccountStatusAge(DateTimeOffset.UtcNow - successfulAt)
            : null;
        if (result.Failure is WuWaAccountStatusFailure.None)
        {
            WuWaAccountFreshnessText.Text = $"UPDATED {age ?? "NOW"}";
            return;
        }

        var failure = result.Failure switch
        {
            WuWaAccountStatusFailure.CacheNotFound => "OPEN KURO LAUNCHER",
            WuWaAccountStatusFailure.CacheMalformed => "CACHE UNREADABLE",
            WuWaAccountStatusFailure.MultipleAccounts => "CHOOSE ACCOUNT IN KURO",
            WuWaAccountStatusFailure.PlayerInfoRejected or WuWaAccountStatusFailure.RoleRejected => "SIGN IN AGAIN",
            WuWaAccountStatusFailure.Timeout => "TIMED OUT",
            WuWaAccountStatusFailure.RateLimited => age is null ? "TRY AGAIN SOON" : $"UPDATED {age}",
            WuWaAccountStatusFailure.Canceled => "CANCELED",
            _ => "STATUS UNAVAILABLE",
        };
        WuWaAccountFreshnessText.Text = result.IsStale && age is not null
            ? $"STALE {age} · {failure}"
            : failure;
    }

    private void RenderPublisherAccountStatus(string gameId)
    {
        var entry = PublisherAccountCatalog.Get(gameId);
        var summary = publisherAccounts.Current;
        var connection = entry.Provider == "HoYoLAB" ? summary.HoyoLab : summary.Skport;
        var consentEnabled = publisherAccounts.HasConsent(entry.Provider);
        AccountProviderText.Text = entry.Provider == "HoYoLAB" ? "HOYOLAB" : "SKPORT";
        if (gameId == "ae") AccountProviderText.Text = "GRYPHLINE";
        AccountConnectionWarningText.Text = consentEnabled
            ? "Nyx-only private browser · disconnect deletes its profile."
            : "Off by default · allow before Nyx opens publisher account pages.";
        AutomationProperties.SetHelpText(
            WuWaAccountStatusStrip,
            AccountConnectionWarningText.Text);
        AutomationProperties.SetName(WuWaAccountStatusStrip, $"{entry.Provider} account tools for {gameId}");
        AutomationProperties.SetName(
            WuWaAccountStatusToggle,
            consentEnabled
                ? $"Turn off {entry.Provider} account access and delete its Nyx profile"
                : $"Allow {entry.Provider} account access");

        var now = AccountDisplayClock();
        var resource = summary.Resources.TryGetValue(gameId, out var value) ? value : null;
        WuWaAccountMetricsText.Text = resource is not null
            ? FormatPublisherResource(resource, now)
            : gameId == "ae"
                ? "OFFICIAL PROTOCOL TERMINAL"
                : $"{entry.ResourceName.ToUpperInvariant()}  —";

        var checkIn = summary.CheckIns.TryGetValue(gameId, out var result) ? result : null;
        var currentCheckIn = checkIn is not null
            && PublisherAccountPresentation.IsCurrentDayCheckIn(checkIn, now)
                ? checkIn
                : null;
        WuWaAccountFreshnessText.Text = publisherAccountActionInFlight
            ? "WORKING"
            : !consentEnabled
                ? publisherConsentSaveFailures.Contains(entry.Provider)
                    ? "OFF · SETTING NOT SAVED"
                    : publisherConsentCleanupFailures.Contains(entry.Provider)
                        || publisherAccounts.HasPendingConsentRevocation(entry.Provider)
                        ? "OFF · CLEANUP PENDING"
                        : "ACCESS OFF"
            : currentCheckIn is not null
                ? currentCheckIn.State switch
                {
                    DailyCheckInState.Claimed => "CLAIMED TODAY",
                    DailyCheckInState.AlreadyClaimed => "DONE TODAY",
                    DailyCheckInState.LoginNeeded => "LOGIN NEEDED",
                    DailyCheckInState.CouldNotCheck => "TRY AGAIN",
                    _ => connection.ToString().ToUpperInvariant(),
                }
                : checkIn is not null
                    ? $"DAY EXPIRED · {connection.ToString().ToUpperInvariant()}"
                    : connection switch
                {
                    PublisherConnectionState.Connected => "CONNECTED",
                    PublisherConnectionState.Connecting => "CONNECTING",
                    PublisherConnectionState.LoginRequired => "LOGIN NEEDED",
                    PublisherConnectionState.NeedsReview => "NEEDS REVIEW",
                    _ => "PRIVATE SESSION",
                };

        WuWaAccountStatusToggle.IsChecked = consentEnabled;
        WuWaAccountStatusToggle.Content = consentEnabled ? "ON" : "ALLOW";
        WuWaAccountStatusToggle.IsEnabled = !publisherAccountActionInFlight;
        PublisherAccountConnectButton.Visibility = consentEnabled
            ? Visibility.Visible
            : Visibility.Collapsed;
        PublisherAccountConnectButton.Content = connection switch
        {
            PublisherConnectionState.Connected => "DELETE",
            PublisherConnectionState.Connecting => "WAIT",
            PublisherConnectionState.LoginRequired => "SIGN IN",
            PublisherConnectionState.NeedsReview => "REVIEW",
            _ => "CONNECT",
        };
        AutomationProperties.SetName(
            PublisherAccountConnectButton,
            connection == PublisherConnectionState.Connected
                ? $"Disconnect {entry.Provider} and delete its Nyx browser profile"
                : $"Connect {entry.Provider} in a Nyx-only private browser");
        PublisherAccountConnectButton.IsEnabled = consentEnabled
            && !publisherAccountActionInFlight
            && connection != PublisherConnectionState.Connecting;
        WuWaAccountStatusRefreshButton.Visibility = consentEnabled
            && (gameId == "ae"
                || (entry.SupportsNumericResource && connection == PublisherConnectionState.Connected))
                ? Visibility.Visible
                : Visibility.Collapsed;
        AutomationProperties.SetName(
            WuWaAccountStatusRefreshButton,
            gameId == "ae"
                ? "Open the official Arknights Endfield Protocol Terminal"
                : $"Refresh {entry.ResourceName}");
        WuWaAccountStatusRefreshButton.IsEnabled = consentEnabled && !publisherAccountActionInFlight;
        DailyCheckInButton.Visibility = consentEnabled ? Visibility.Visible : Visibility.Collapsed;
        DailyCheckInButton.IsEnabled = consentEnabled && !publisherAccountActionInFlight;
    }

    public static string FormatPublisherResource(PublisherResourceSnapshot resource, DateTimeOffset now)
        => PublisherAccountDisplayProjection.FormatResource(resource, now);

    public static int RemainingRecoverySeconds(PublisherResourceSnapshot resource, DateTimeOffset now)
        => PublisherAccountDisplayProjection.RemainingRecoverySeconds(resource, now);

    private static string FormatRecoveryDuration(int seconds)
    {
        var duration = TimeSpan.FromSeconds(seconds);
        return duration.TotalHours >= 1
            ? $"{(int)duration.TotalHours}H {duration.Minutes}M"
            : $"{Math.Max(1, duration.Minutes)}M";
    }

    private bool IsWuWaAccountStatusEnabled() =>
        launcherState.Snapshot.Preferences.FeatureFlags.WuWaAccountStatus
        && !wuwaAccountStatusSessionDisabled;

    private static string FormatAccountStatusAge(TimeSpan age)
    {
        if (age < TimeSpan.FromMinutes(1)) return "NOW";
        if (age < TimeSpan.FromHours(1)) return $"{Math.Max(1, (int)age.TotalMinutes)}M AGO";
        return $"{Math.Max(1, (int)age.TotalHours)}H AGO";
    }

    private void ApplyWuWaMaintenanceResult(WuWaOfficialMaintenanceResult result)
    {
        wuwaMaintenanceStatus = result.Status;
        wuwaMaintenanceReason = result.InspectionReason;
        wuwaMaintenanceRequest = result.Request;
    }

    private void RenderLaunchFailure(string? gameVersion)
    {
        switch (gameFailureReason)
        {
            case GenshinLaunchFailureReason.ElevationRequired:
                SetGameSignal("Admin approval needed", "MoonBrush");
                HeroDescription.Text = "Windows requires administrator approval. HoYoPlay is the safe available action.";
                SetLaunchControls(false, "ADMIN REQUIRED", "Open HoYoPlay", "Administrator approval is required; open HoYoPlay");
                break;
            case GenshinLaunchFailureReason.ElevationCancelled:
                SetGameSignal("Admin approval cancelled", "MoonBrush");
                HeroDescription.Text = "Nothing started. Choose Try again when you are ready to approve Windows.";
                SetLaunchControls(true, "TRY AGAIN", "Approval cancelled", "Try launching Genshin Impact again");
                break;
            case GenshinLaunchFailureReason.ElevatedStartFailed:
                SetGameSignal("Admin start failed", "MoonBrush");
                HeroDescription.Text = "Windows approved the request, but Genshin Impact did not start. Nothing else was opened.";
                SetLaunchControls(true, "TRY AGAIN", "Admin start failed", "Try the administrator start again");
                break;
            default:
                SetGameSignal("Launch failed", "MoonBrush");
                HeroDescription.Text = "Genshin Impact did not start. Check the install in HoYoPlay.";
                SetLaunchControls(true, "TRY AGAIN", WithVersion("Ready", gameVersion), "Try launching Genshin Impact again");
                break;
        }
    }

    private void RenderUpdater()
    {
        if (GameSelector?.SelectedItem is not GameLauncherItem selected)
        {
            return;
        }

        OpenUpdaterButton.Content = "Official Launcher";

        if (!updaterScanFinished)
        {
            UpdaterSignalText.Text = "Checking…";
            OpenUpdaterButton.IsEnabled = false;
            AutomationProperties.SetName(OpenUpdaterButton, $"Checking HoYoPlay for {selected.DisplayName}");
            return;
        }

        switch (updaterStatus)
        {
            case GenshinLaunchStatus.Ready:
                UpdaterSignalText.Text = PublisherMaintenanceLabel(selected.Id);
                OpenUpdaterButton.IsEnabled = !updaterActionInFlight;
                AutomationProperties.SetName(OpenUpdaterButton, $"Open HoYoPlay for {selected.DisplayName}");
                break;
            case GenshinLaunchStatus.Running:
                UpdaterSignalText.Text = $"{PublisherMaintenanceLabel(selected.Id)} · HoYoPlay open";
                OpenUpdaterButton.IsEnabled = false;
                AutomationProperties.SetName(OpenUpdaterButton, "HoYoPlay is running");
                break;
            case GenshinLaunchStatus.LaunchFailed:
                UpdaterSignalText.Text = "Launch failed";
                OpenUpdaterButton.Content = "Try Again";
                OpenUpdaterButton.IsEnabled = !updaterActionInFlight;
                AutomationProperties.SetName(OpenUpdaterButton, "Try opening HoYoPlay again");
                break;
            case GenshinLaunchStatus.NeedsReview:
                UpdaterSignalText.Text = "Needs review";
                OpenUpdaterButton.IsEnabled = false;
                AutomationProperties.SetName(OpenUpdaterButton, "HoYoPlay needs review");
                break;
            default:
                UpdaterSignalText.Text = "Not found";
                OpenUpdaterButton.IsEnabled = false;
                AutomationProperties.SetName(OpenUpdaterButton, "HoYoPlay was not found");
                break;
        }
    }

    private string PublisherMaintenanceLabel(string gameId) =>
        HoyoPublisherMaintenanceLabelProjector.Project(publisherStatus.Current, gameId);

    private static GenshinLaunchStatus MapHoyoPlayStatus(HoyoPlayOpenStatus status) => status switch
    {
        HoyoPlayOpenStatus.Ready => GenshinLaunchStatus.Ready,
        HoyoPlayOpenStatus.Running or HoyoPlayOpenStatus.Opened =>
            GenshinLaunchStatus.Running,
        HoyoPlayOpenStatus.Failed => GenshinLaunchStatus.LaunchFailed,
        _ => GenshinLaunchStatus.NeedsReview,
    };

    private void ShowGameActionInProgress(string signal, string detail)
    {
        SetGameSignal(signal, "LavenderBrush");
        HeroDescription.Text = "Nyx is checking the official files before it starts the game.";
        var gameName = (GameSelector?.SelectedItem as GameLauncherItem)?.DisplayName ?? "game";
        SetLaunchControls(false, "STARTING", detail, $"Starting {gameName}");
    }

    private void SetGameSignal(string text, string brushKey)
    {
        var brush = (Brush)Application.Current.Resources[brushKey];
        GameSignalDot.Fill = brush;
        GameSignalText.Foreground = brush;
        GameSignalText.Text = text;
    }

    private void SetRunningExportControls(string gameName, string? version)
    {
        if (GameSelector?.SelectedItem is not GameLauncherItem selected)
        {
            SetLaunchControls(false, "RUNNING", WithVersion("Detected", version), $"{gameName} is running");
            return;
        }

        var state = launcherState.Snapshot;
        var arm = ExportArmSnapshot.From(state.Export, selected.Id, state.Preferences.FeatureFlags);
        var hasActiveJob = latestExportJobs.TryGetValue(selected.Id, out var jobId)
            && !exports.GetSnapshot(jobId).IsFinished;
        if (arm.RequestedKinds != ExportKind.None && !hasActiveJob)
        {
            SetLaunchControls(true, "EXPORT", "Game already running", $"Export selected {gameName} data now");
            return;
        }

        SetLaunchControls(false, "RUNNING", WithVersion("Detected", version), $"{gameName} is running");
    }

    private void SetLaunchControls(
        bool enabled,
        string title,
        string detail,
        string accessibleName)
    {
        var selectedGameId = (GameSelector?.SelectedItem as GameLauncherItem)?.Id;
        LaunchButton.IsEnabled = enabled
            && (selectedGameId is null || !gameActionsInFlight.Contains(selectedGameId));
        LaunchTitle.Text = title;
        LaunchDetail.Text = detail;
        AutomationProperties.SetName(LaunchButton, accessibleName);
    }

    private static string WithVersion(string state, string? version) =>
        string.IsNullOrWhiteSpace(version) ? state : $"{state} · {version}";

    private void GameSelector_ContainerContentChanging(
        ListViewBase sender,
        ContainerContentChangingEventArgs args)
    {
        if (args.ItemContainer is ListViewItem item && args.Item is GameLauncherItem game)
        {
            AutomationProperties.SetName(item, game.AccessibleName);
        }
    }

    private sealed record HoyoMaintenanceUiSnapshot(
        string? UpdaterRoot,
        GenshinLaunchStatus? UpdaterStatus);

    private sealed record HeroPresentation(
        double Scale,
        double OffsetX,
        double OffsetY,
        double FadeStart,
        double FadeMid);
}

public sealed class BannerCharacterRowItem : INotifyPropertyChanged
{
    public BannerCharacterRowItem(
        LauncherBannersCharacter character,
        string? portraitSource,
        string timing,
        bool isActive,
        bool isPinned,
        double progress)
    {
        CharacterId = character.Id;
        Name = character.Name;
        Detail = timing;
        Update(portraitSource, timing, isActive, isPinned, progress);
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public string CharacterId { get; }

    public string Name { get; }

    public string Detail { get; private set; }

    public string? PortraitSource { get; private set; }

    public bool IsActive { get; private set; }

    public bool IsPinned { get; private set; }

    public double Progress { get; private set; }

    public double RowOpacity => IsActive ? 1 : 0.9;

    public Visibility ActiveVisibility => IsActive ? Visibility.Visible : Visibility.Collapsed;

    public Visibility SeparatorVisibility => IsActive ? Visibility.Collapsed : Visibility.Visible;

    public string ActiveLabel => IsPinned ? "PINNED" : IsActive ? "ACTIVE" : string.Empty;

    public string ProgressLabel => IsActive ? $"{Math.Round(Progress):0}%" : string.Empty;

    public string PinLabel => IsPinned ? "UNPIN" : "PIN";

    public string AccessibilityName => IsPinned
        ? $"{Name}. Pinned banner character. Click to resume rotation."
        : IsActive
            ? $"{Name}. Active banner character. Click to pin this character."
            : $"{Name}. Click to pin this character.";

    public void Update(string? portraitSource, string timing, bool isActive, bool isPinned, double progress)
    {
        var nextProgress = Math.Clamp(progress, 0, 100);
        var portraitChanged = !string.Equals(PortraitSource, portraitSource, StringComparison.OrdinalIgnoreCase);
        var timingChanged = !string.Equals(Detail, timing, StringComparison.Ordinal);
        var activeChanged = IsActive != isActive;
        var pinnedChanged = IsPinned != isPinned;
        var progressChanged = Math.Abs(Progress - nextProgress) >= 0.01;

        PortraitSource = portraitSource;
        Detail = timing;
        IsActive = isActive;
        IsPinned = isPinned;
        Progress = nextProgress;

        if (portraitChanged) Notify(nameof(PortraitSource));
        if (timingChanged) Notify(nameof(Detail));
        if (progressChanged)
        {
            Notify(nameof(Progress));
            Notify(nameof(ProgressLabel));
        }
        if (activeChanged)
        {
            Notify(nameof(RowOpacity));
            Notify(nameof(ActiveVisibility));
            Notify(nameof(SeparatorVisibility));
            Notify(nameof(ActiveLabel));
            Notify(nameof(ProgressLabel));
            Notify(nameof(PinLabel));
            Notify(nameof(AccessibilityName));
        }
        if (pinnedChanged)
        {
            Notify(nameof(ActiveLabel));
            Notify(nameof(PinLabel));
            Notify(nameof(AccessibilityName));
        }
    }

    private void Notify(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));

}

public static class BannerTimingFormatter
{
    public static string FormatRemaining(TimeSpan duration)
    {
        if (duration.TotalDays >= 1)
        {
            return $"{(int)duration.TotalDays}d {duration.Hours}h";
        }

        return duration.TotalHours >= 1
            ? $"{(int)duration.TotalHours}h {duration.Minutes}m"
            : $"{Math.Max(0, duration.Minutes)}m";
    }
}

public sealed class RedemptionCodeRowItem : INotifyPropertyChanged
{
    public RedemptionCodeRowItem(
        string code,
        DateOnly added,
        int currencyAmount,
        string currencyName,
        string currencyIconSource,
        bool isCopyable,
        double rowHeight = 17)
    {
        Code = code;
        AddedLabel = isCopyable
            ? added.ToString("MMM d", CultureInfo.InvariantCulture).ToUpperInvariant()
            : string.Empty;
        IsCopyable = isCopyable;
        CurrencyAmount = currencyAmount;
        CurrencyName = currencyName;
        CurrencyIconSource = currencyIconSource;
        CurrencyAmountLabel = currencyAmount > 0 ? currencyAmount.ToString(CultureInfo.InvariantCulture) : string.Empty;
        CurrencyVisibility = currencyAmount > 0 ? Visibility.Visible : Visibility.Collapsed;
        FontSize = code.Length > 16 ? 9 : 11;
        AccessibilityName = isCopyable
            ? $"Copy redemption code {code}, {currencyAmount} {currencyName}, added {added:yyyy-MM-dd}"
            : code;
        CopyStatus = isCopyable ? "COPY" : string.Empty;
        RowHeight = rowHeight;
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public static RedemptionCodeRowItem Empty { get; } = new(
        "No premium codes available", default, 0, string.Empty, string.Empty, false);

    public string Code { get; }

    public string AddedLabel { get; }

    public bool IsCopyable { get; }

    public int CurrencyAmount { get; }

    public string CurrencyName { get; }

    public string CurrencyIconSource { get; }

    public string CurrencyAmountLabel { get; }

    public Visibility CurrencyVisibility { get; private set; }

    public double FontSize { get; }

    public string AccessibilityName { get; }

    public string CopyStatus { get; private set; }

    public double RowHeight { get; private set; }

    public Visibility MetadataVisibility { get; private set; } = Visibility.Visible;

    public TextDecorations CodeDecoration { get; private set; }

    public double CodeOpacity { get; private set; } = 1;

    public void MarkPreviouslyCopied()
    {
        if (CodeDecoration == TextDecorations.Strikethrough) return;
        CodeDecoration = TextDecorations.Strikethrough;
        CodeOpacity = 0.58;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CodeDecoration)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CodeOpacity)));
    }

    public void SetRowHeight(double height)
    {
        if (Math.Abs(RowHeight - height) < 0.01) return;
        RowHeight = height;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(RowHeight)));
    }

    public void SetMetadataVisibility(bool isVisible)
    {
        var next = isVisible ? Visibility.Visible : Visibility.Collapsed;
        var currencyNext = isVisible && CurrencyAmount > 0 ? Visibility.Visible : Visibility.Collapsed;
        if (MetadataVisibility == next && CurrencyVisibility == currencyNext) return;
        MetadataVisibility = next;
        CurrencyVisibility = currencyNext;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(MetadataVisibility)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CurrencyVisibility)));
    }

    public void MarkCopied()
    {
        if (CopyStatus == "COPIED") return;
        CopyStatus = "COPIED";
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CopyStatus)));
    }

    public void ResetCopyState()
    {
        if (CopyStatus == "COPY") return;
        CopyStatus = "COPY";
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CopyStatus)));
    }
}

public sealed class GameLauncherItem : INotifyPropertyChanged
{
    private double iconSize = 104;
    private double itemExtent = 112;
    private string statusGlyph;
    private string statusDescription;

    public GameLauncherItem(
        string id,
        string displayName,
        string iconPath,
        string heroArtPath,
        double heroScale,
        double heroOffsetX,
        double heroOffsetY,
        double heroFadeStart,
        double heroFadeMid,
        string maintenanceProvider,
        string statusGlyph,
        string statusDescription,
        bool isCustom = false)
    {
        Id = id;
        DisplayName = displayName;
        IconPath = iconPath;
        HeroArtPath = heroArtPath;
        HeroScale = heroScale;
        HeroOffsetX = heroOffsetX;
        HeroOffsetY = heroOffsetY;
        HeroFadeStart = heroFadeStart;
        HeroFadeMid = heroFadeMid;
        MaintenanceProvider = maintenanceProvider;
        IsCustom = isCustom;
        this.statusGlyph = statusGlyph;
        this.statusDescription = statusDescription;
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public string Id { get; }

    public string DisplayName { get; }

    public string IconPath { get; }

    public string HeroArtPath { get; }

    public double HeroScale { get; }

    public double HeroOffsetX { get; }

    public double HeroOffsetY { get; }

    public double HeroFadeStart { get; }

    public double HeroFadeMid { get; }

    public string MaintenanceProvider { get; }

    public bool IsCustom { get; }

    public string StatusGlyph => statusGlyph;

    public string StatusDescription => statusDescription;

    public double IconSize => iconSize;

    public double ItemExtent => itemExtent;

    public string AccessibleName => $"{DisplayName}. {StatusDescription}. Select game.";

    public void UpdateStatus(string glyph, string description)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(glyph);
        ArgumentException.ThrowIfNullOrWhiteSpace(description);
        if (statusGlyph == glyph && statusDescription == description)
        {
            return;
        }

        statusGlyph = glyph;
        statusDescription = description;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(StatusGlyph)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(StatusDescription)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(AccessibleName)));
    }

    public void ApplyLayout(LauncherLayoutProfile profile)
    {
        if (iconSize == profile.IconSize && itemExtent == profile.ItemExtent)
        {
            return;
        }

        iconSize = profile.IconSize;
        itemExtent = profile.ItemExtent;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IconSize)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(ItemExtent)));
    }
}
