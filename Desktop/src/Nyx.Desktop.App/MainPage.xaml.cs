using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage.Pickers;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using Nyx.Desktop.Core.Content;
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
using Nyx.Desktop.Infrastructure.Hoyo;
using Nyx.Desktop.Infrastructure.PublisherMaintenance;
using Nyx.Desktop.Infrastructure.PublisherGames;
using Nyx.Desktop.Infrastructure.Sessions;
using Nyx_Desktop_App.ViewModels;

namespace Nyx_Desktop_App;

public sealed partial class MainPage : Page
{
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
            // Portrait art: lower the crop so the two faces stay in view.
            ["gi"] = new(1.45, 80, 100, 0.30, 0.62),
            // Square art: a small rightward bias protects both Trailblazers.
            ["hsr"] = new(1.06, 34, 18, 0.24, 0.54),
            // Bright square poster: keep the faces right of the copy and fade it earlier.
            ["zzz"] = new(1.07, 46, 12, 0.32, 0.64),
            // Wide key art: preserve both faces with only a light rightward bias.
            ["wuwa"] = new(1.02, 42, 0, 0.22, 0.50),
            // Wide pale poster: nudge its focal pair right and use a longer dark handoff.
            ["ae"] = new(1.04, 38, 8, 0.28, 0.58),
        };

    private static readonly IReadOnlyDictionary<string, string> MaintenanceProviders =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["gi"] = "HoYoPlay",
            ["hsr"] = "HoYoPlay",
            ["zzz"] = "HoYoPlay",
            ["wuwa"] = "Wuthering Waves launcher",
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
    private readonly ILatestContentSource latestContent;
    private readonly LauncherBannersContentService launcherBanners;
    private readonly ExportCoordinator exports;
    private readonly UserConfirmedExportSignalWaiter exportSignals;
    private readonly HoyoPublisherStatusSource publisherStatus;
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
    private bool updaterActionInFlight;
    private bool wuwaActionInFlight;
    private bool endfieldFolderActionInFlight;
    private bool endfieldFolderSelectionNeedsReview;
    private bool endfieldMaintenanceScanFinished;
    private bool endfieldMaintenanceActionInFlight;
    private EndfieldOfficialMaintenanceStatus? endfieldMaintenanceStatus;
    private PublisherGameInspectionReason endfieldMaintenanceReason;
    private WuWaOfficialMaintenanceStatus? wuwaMaintenanceStatus;
    private PublisherGameInspectionReason wuwaMaintenanceReason;
    private OfficialMaintenanceHandoffRequest? wuwaMaintenanceRequest;
    private bool refreshSubscribed;
    private bool latestSubscribed;
    private bool launcherBannersSubscribed;
    private bool publisherStatusSubscribed;
    private bool selectorSubscribed;
    private bool reactivationSubscribed;
    private bool endfieldRootDiscoverySubscribed;
    private int hoyoRefreshGeneration;
    private readonly LatestGenerationGate wuwaRefreshGeneration = new();
    private readonly LatestGenerationGate endfieldMaintenanceGeneration = new();
    private readonly EndfieldFolderSelectionPolicy endfieldFolderSelections = new();
    private readonly EndfieldUiActionAdmission endfieldUiActions = new();
    private SessionUiLease? pageLease;

    public ObservableCollection<GameLauncherItem> Games { get; } = new();

    public ObservableCollection<LatestContentCardItem> LatestCards { get; } = new();

    public ObservableCollection<CurrentBannerRowItem> CurrentBannerRows { get; } = new();

    public MainPage()
    {
        InitializeComponent();

        app = (App)Application.Current;
        launcherState = app.LauncherState;
        userAssets = new UserAssetStore(launcherState.DataDirectory);
        RebuildGameRail(launcherState.Snapshot);
        sessions = app.Sessions;
        sessionRefresh = app.SessionRefresh;
        sessionUiLifetime = app.SessionUiLifetime;
        latestContent = app.LatestContent;
        launcherBanners = app.LauncherBanners;
        exports = app.Exports;
        exportSignals = app.ExportSignals;
        publisherStatus = app.HoyoPublisherStatus;
        genshinSession = app.GenshinSession;
        hoyoSessions = app.HoyoSessions;
        hoyoPlayExecutor = app.HoyoPlayExecutor;
        wuwaMaintenance = app.WuWaMaintenance;
        publisherGameLaunchService = app.PublisherGameLaunchService;
        endfieldRootStore = app.EndfieldRootStore;
        endfieldMaintenance = app.EndfieldMaintenance;
        discovery = app.GenshinDiscovery;

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

        if (!latestSubscribed)
        {
            latestContent.Updated += LatestContent_Updated;
            latestSubscribed = true;
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

        if (!reactivationSubscribed)
        {
            app.WindowReactivated += App_WindowReactivated;
            reactivationSubscribed = true;
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

        if (latestSubscribed)
        {
            latestContent.Updated -= LatestContent_Updated;
            latestSubscribed = false;
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

        if (reactivationSubscribed)
        {
            app.WindowReactivated -= App_WindowReactivated;
            reactivationSubscribed = false;
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

            if (!endfieldMaintenanceActionInFlight)
            {
                _ = RefreshEndfieldMaintenanceAsync(lease);
            }
        });
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

    private async void ChooseGameFolderButton_Click(object sender, RoutedEventArgs e)
    {
        var lease = pageLease;
        if (lease is null
            || endfieldFolderActionInFlight
            || endfieldMaintenanceActionInFlight
            || GameSelector?.SelectedItem is not GameLauncherItem { Id: "ae" })
        {
            return;
        }

        var actionAdmission = endfieldUiActions.TryEnter(EndfieldUiActionKind.ChooseFolder);
        if (actionAdmission is null)
        {
            return;
        }

        endfieldFolderActionInFlight = true;
        var selectionAttempt = endfieldFolderSelections.Begin();
        ChooseGameFolderButton.IsEnabled = false;
        OpenUpdaterButton.IsEnabled = false;
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

            UpdaterSignalText.Text = "Checking the selected GRYPHLINK folder…";
            var inspection = await Task.Run(
                () => publisherGameLaunchService.CheckGame("ae", folder.Path),
                lease.CancellationToken);
            if (!endfieldFolderSelections.IsCurrent(
                    selectionAttempt,
                    lease.CancellationToken))
            {
                return;
            }

            var identityAccepted = inspection.Status is PublisherGameLaunchStatus.Ready
                or PublisherGameLaunchStatus.Running;
            var result = await endfieldFolderSelections.CompleteAsync(
                selectionAttempt,
                lease.CancellationToken,
                identityAccepted,
                folder.Path,
                endfieldRootStore.TrySave,
                endfieldRootStore.Clear,
                async token =>
                {
                    await sessionRefresh.RefreshNowAsync(token);
                });
            if (result.Status is not EndfieldFolderSelectionStatus.Stale)
            {
                _ = sessionUiLifetime.TryRun(lease, () =>
                {
                    endfieldFolderSelectionNeedsReview = result.NeedsReview;
                    RenderSelection();
                });
                await RefreshEndfieldMaintenanceAsync(lease);
            }
        }
        catch (OperationCanceledException) when (lease.CancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception)
        {
            if (endfieldFolderSelections.IsCurrent(selectionAttempt, lease.CancellationToken))
            {
                _ = sessionUiLifetime.TryRun(
                    lease,
                    () => endfieldFolderSelectionNeedsReview = true);
            }
        }
        finally
        {
            actionAdmission.Dispose();
            if (endfieldFolderSelections.IsCurrent(selectionAttempt, lease.CancellationToken))
            {
                _ = sessionUiLifetime.TryRun(lease, () =>
                {
                    endfieldFolderActionInFlight = false;
                    RenderSelection();
                });
            }
        }
    }

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
        OpenUpdaterButton.Content = "OPENING…";
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
        OpenUpdaterButton.Content = "OPENING…";
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
        OpenUpdaterButton.Content = "OPENING…";
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

    private async void LatestCard_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { CommandParameter: string destination }
            || GameSelector?.SelectedItem is not GameLauncherItem selected
            || !launcherState.Snapshot.Preferences.FeatureFlags.OfficialNews
            || !Uri.TryCreate(destination, UriKind.Absolute, out var uri)
            || !IsApprovedNewsUri(selected.Id, uri))
        {
            return;
        }
        await OpenFixedDestinationAsync(uri, "the official news item");
    }

    private static bool IsApprovedNewsUri(string gameId, Uri uri)
    {
        if (uri.Scheme != Uri.UriSchemeHttps || uri.UserInfo.Length != 0 || !uri.IsDefaultPort)
        {
            return false;
        }
        var host = uri.IdnHost;
        return gameId switch
        {
            "gi" => IsHost(host, "genshin.hoyoverse.com", "sg-hk4e-api.hoyoverse.com", "sg-hk4e-api.hoyolab.com"),
            "hsr" => IsHost(host, "honkai-star-rail.hoyoverse.com", "sg-hkrpg-api.hoyoverse.com", "sg-hkrpg-api.hoyolab.com"),
            "zzz" => IsHost(host, "zenless.hoyoverse.com", "sg-announcement-api.hoyoverse.com"),
            "wuwa" => IsHost(host, "wutheringwaves.kurogames.com"),
            "ae" => IsHost(host, "endfield.gryphline.com"),
            _ => false,
        };
    }

    private static bool IsHost(string host, params string[] allowed) =>
        allowed.Any(candidate => host.Equals(candidate, StringComparison.OrdinalIgnoreCase));

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
            Minimum = 50,
            Maximum = 250,
            Value = savedAppearance.ArtScale,
            StepFrequency = 1,
            Header = "Character art scale",
        };
        var artX = new NumberBox
        {
            Header = "Horizontal position",
            Minimum = -1000,
            Maximum = 1000,
            Value = savedAppearance.ArtX,
            SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact,
        };
        var artY = new NumberBox
        {
            Header = "Vertical position",
            Minimum = -1000,
            Maximum = 1000,
            Value = savedAppearance.ArtY,
            SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact,
        };
        var keepArt = new ToggleSwitch
        {
            Header = "Keep this character-art variant",
            IsOn = savedAppearance.ArtPinned,
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
            Header = "Refresh news and banner art when Nyx opens",
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
        var officialNews = new ToggleSwitch
        {
            Header = "Use official news feed",
            IsOn = before.Preferences.FeatureFlags.OfficialNews,
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
                BackgroundArtwork.Source = new BitmapImage(new Uri(path));
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
            message.Text = "Refreshing official news and banner art...";
            try
            {
                await app.RefreshContentManualAsync();
                message.Text = "Official content refreshed."
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
            if (HeroArtwork.RenderTransform is CompositeTransform transform)
            {
                transform.ScaleX = artScale.Value / 100d;
                transform.ScaleY = artScale.Value / 100d;
                transform.TranslateX = double.IsNaN(artX.Value) ? 0 : artX.Value;
                transform.TranslateY = double.IsNaN(artY.Value) ? 0 : artY.Value;
            }
        }
        artScale.ValueChanged += (_, _) => PreviewArt();
        artX.ValueChanged += (_, _) => PreviewArt();
        artY.ValueChanged += (_, _) => PreviewArt();
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
            BackgroundArtwork.Source = new BitmapImage(new Uri("ms-appx:///Assets/backgroundnyx.png"));
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
            automaticArtVariants[selected.Id] = (launcherBanners.Current.Revision, next.Id);
            keepArt.IsOn = false;
            var path = launcherBanners.TryResolveManagedAsset(next);
            if (path is not null)
            {
                HeroArtwork.Source = new BitmapImage(new Uri(path));
                HeroArtwork.Stretch = next.Placement.Fit == "contain" ? Stretch.Uniform : Stretch.UniformToFill;
                PreviewArt();
            }
        };

        var order = new ObservableCollection<GameOrderItem>(before.RailOrder.Select(id =>
            new GameOrderItem(id, Games.FirstOrDefault(game => game.Id == id)?.DisplayName ?? id)));
        var orderList = new ListView
        {
            Height = 180,
            ItemsSource = order,
            DisplayMemberPath = nameof(GameOrderItem.DisplayName),
            SelectionMode = ListViewSelectionMode.Single,
        };
        var moveUp = new Button { Content = "MOVE UP", Style = (Style)Application.Current.Resources["NyxQuietActionStyle"] };
        var moveDown = new Button { Content = "MOVE DOWN", Style = (Style)Application.Current.Resources["NyxQuietActionStyle"] };
        var resetOrder = new Button { Content = "RESET ORDER", Style = (Style)Application.Current.Resources["NyxQuietActionStyle"] };
        moveUp.Click += (_, _) => MoveOrderItem(orderList, order, -1);
        moveDown.Click += (_, _) => MoveOrderItem(orderList, order, 1);
        resetOrder.Click += (_, _) =>
        {
            order.Clear();
            foreach (var game in GameCatalog.All) order.Add(new(game.Id, game.DisplayName));
            foreach (var game in before.CustomGames.OrderBy(game => game.CreationOrder)) order.Add(new(game.Id, game.Name));
        };

        var content = new StackPanel { Width = 560, Spacing = 14 };
        ApplyNyxAccentResources(content.Resources);
        content.Children.Add(new TextBlock
        {
            Text = selected.DisplayName,
            FontFamily = (FontFamily)Application.Current.Resources["NyxDisplayFont"],
            FontSize = 30,
            Foreground = (Brush)Application.Current.Resources["MoonBrush"],
        });
        content.Children.Add(new TextBlock
        {
            Text = "Appearance",
            Style = (Style)Application.Current.Resources["NyxEyebrowTextStyle"],
        });
        content.Children.Add(automaticArt);
        content.Children.Add(artScale);
        var position = new Grid { ColumnSpacing = 10 };
        position.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        position.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        position.Children.Add(artX);
        Grid.SetColumn(artY, 1);
        position.Children.Add(artY);
        content.Children.Add(position);
        content.Children.Add(keepArt);
        content.Children.Add(iconPath);
        content.Children.Add(backgroundPath);
        content.Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Children = { browseIcon, browseBackground, tryAnother, resetAppearance },
        });
        if (selected.IsCustom)
        {
            content.Children.Add(new TextBlock { Text = "CUSTOM GAME", Style = (Style)Application.Current.Resources["NyxEyebrowTextStyle"] });
            content.Children.Add(customName);
            content.Children.Add(customExecutable);
            content.Children.Add(browseExecutable);
            content.Children.Add(customRuntime);
            content.Children.Add(browseRuntime);
            content.Children.Add(customArguments);
            content.Children.Add(customAdmin);
        }
        content.Children.Add(new TextBlock { Text = "GAME ORDER", Style = (Style)Application.Current.Resources["NyxEyebrowTextStyle"] });
        content.Children.Add(orderList);
        content.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { moveUp, moveDown, resetOrder } });
        content.Children.Add(new TextBlock
        {
            Text = "Launcher",
            Style = (Style)Application.Current.Resources["NyxEyebrowTextStyle"],
        });
        content.Children.Add(stayVisible);
        content.Children.Add(refreshOnStartup);
        content.Children.Add(safeNotifications);
        content.Children.Add(globalAutomaticArt);
        content.Children.Add(officialNews);
        content.Children.Add(remoteManifest);
        content.Children.Add(new TextBlock
        {
            Text = "Recovery & diagnostics",
            Style = (Style)Application.Current.Resources["NyxEyebrowTextStyle"],
        });
        content.Children.Add(cacheSummary);
        content.Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Children = { refreshContent, clearCache },
        });
        content.Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Children = { openData, openExports },
        });
        content.Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Children = { copyDiagnostics, rediscover },
        });
        content.Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Children = { resetSavedAppearance, restoreSettings },
        });
        content.Children.Add(message);

        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = "Settings",
            Background = (Brush)Application.Current.Resources["GlassDeckBrush"],
            BorderBrush = (Brush)Application.Current.Resources["DeckBorderBrush"],
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(14),
            Content = new ScrollViewer
            {
                MaxHeight = 620,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Content = content,
            },
            PrimaryButtonText = "Save",
            SecondaryButtonText = selected.IsCustom ? "Delete Game" : string.Empty,
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            PrimaryButtonStyle = (Style)Application.Current.Resources["NyxDialogPrimaryStyle"],
            SecondaryButtonStyle = (Style)Application.Current.Resources["NyxDialogQuietStyle"],
            CloseButtonStyle = (Style)Application.Current.Resources["NyxDialogQuietStyle"],
        };
        ApplyNyxAccentResources(dialog.Resources);
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
                        ArtPinned = keepArt.IsOn,
                        PinnedArtFile = pinnedArtFile,
                    },
                    CustomGame = updatedCustom,
                    RailOrder = order.Select(item => item.Id).ToArray(),
                    StayVisibleAfterLaunch = stayVisible.IsOn,
                    RefreshContentOnStartup = refreshOnStartup.IsOn,
                    SafeNotifications = safeNotifications.IsOn,
                    AutomaticArt = globalAutomaticArt.IsOn,
                    OfficialNews = officialNews.IsOn,
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
                    || (officialNews.IsOn && !before.Preferences.FeatureFlags.OfficialNews)
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

    private static void MoveOrderItem(
        ListView list,
        ObservableCollection<GameOrderItem> order,
        int offset)
    {
        if (list.SelectedItem is not GameOrderItem selected)
        {
            return;
        }
        var index = order.IndexOf(selected);
        var target = index + offset;
        if (index < 0 || target < 0 || target >= order.Count)
        {
            return;
        }
        order.Move(index, target);
        list.SelectedItem = selected;
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

        var content = new StackPanel
        {
            Width = 500,
            Spacing = 12,
            Children = { message, name, PickerRow(executable, chooseExecutable), PickerRow(icon, chooseIcon) },
        };
        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = "Add Game",
            Content = content,
            PrimaryButtonText = "Add Game",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
        };
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

    private void ConfirmWorldButton_Click(object sender, RoutedEventArgs e)
    {
        if (GameSelector?.SelectedItem is GameLauncherItem selected
            && exportSignals.ConfirmWorldReady(selected.Id))
            NyxToolsStatusText.Text = "Achievements: collecting the complete list...";
    }

    private void ConfirmHistoryButton_Click(object sender, RoutedEventArgs e)
    {
        if (GameSelector?.SelectedItem is GameLauncherItem selected
            && exportSignals.ConfirmHistory(selected.Id))
            NyxToolsStatusText.Text = "Pulls: collecting history...";
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

    private void LatestContent_Updated(object? sender, EventArgs e)
    {
        var lease = pageLease;
        if (lease is null)
        {
            return;
        }

        _ = DispatcherQueue.TryEnqueue(() =>
            sessionUiLifetime.TryRun(lease, RenderLatestContent));
    }

    private void LauncherBanners_Updated(object? sender, EventArgs e)
    {
        var lease = pageLease;
        if (lease is null)
        {
            return;
        }

        _ = DispatcherQueue.TryEnqueue(() =>
            sessionUiLifetime.TryRun(lease, RenderSelection));
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

    private void GameSelector_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (GameSelector?.SelectedItem is GameLauncherItem selected
            && !string.Equals(lastArtSelectionGameId, selected.Id, StringComparison.Ordinal))
        {
            lastArtSelectionGameId = selected.Id;
            automaticArtVariants.Remove(selected.Id);
        }
        RenderSelection();
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

        foreach (var game in Games)
        {
            game.ApplyLayout(profile);
        }

        HeroTitle.FontSize = profile.TitleSize;
        ContentPanel.MaxWidth = profile.ContentWidth;
        ContentScroll.MaxWidth = profile.ContentWidth;
        HeroStage.Width = profile.UsesHorizontalRail
            ? profile.HeroWidth
            : Math.Max(profile.HeroWidth, width + 70);
        HeroArtwork.Opacity = profile.State switch
        {
            LauncherLayoutState.Compact => 0.34,
            LauncherLayoutState.Horizontal => 0.58,
            LauncherLayoutState.Wide => 0.68,
            _ => 0.78,
        };
        CommandDeck.Height = profile.DeckHeight;
        LaunchButton.Width = profile.LaunchWidth;
        LaunchButton.Height = profile.State switch
        {
            LauncherLayoutState.Compact => 72,
            LauncherLayoutState.Horizontal => 62,
            LauncherLayoutState.Wide => 96,
            _ => 104,
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
            BrandLockup.Margin = new Thickness(12, 48, 0, 6);
            BrandLockup.HorizontalAlignment = HorizontalAlignment.Left;
            BrandLockup.VerticalAlignment = VerticalAlignment.Center;
            AddGameButton.Visibility = Visibility.Visible;
            AddGameButton.Width = 52;
            AddGameButton.Margin = new Thickness(0, 52, 12, 0);
            AddGameButton.HorizontalAlignment = HorizontalAlignment.Right;
            AddGameButton.VerticalAlignment = VerticalAlignment.Center;
            AddGameLabel.Visibility = Visibility.Collapsed;
            Grid.SetRow(AddGameButton, 0);
            Grid.SetRowSpan(AddGameButton, 1);
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
                profile.DeckHeight + 22);

            Grid.SetRow(CommandDeck, 1);
            Grid.SetRowSpan(CommandDeck, 1);
            Grid.SetColumn(CommandDeck, 0);
            Grid.SetColumnSpan(CommandDeck, 3);
            CommandDeck.Margin = new Thickness(
                profile.OuterPadding,
                0,
                profile.OuterPadding,
                18);
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

        RailBrandRow.Height = new GridLength(105);
        RailContentRow.Height = new GridLength(1, GridUnitType.Star);
        RailAddRow.Height = GridLength.Auto;
        RailSpacerRow.Height = new GridLength(0);
        RailFooterRow.Height = new GridLength(54);
        Grid.SetRow(BrandLockup, 0);
        Grid.SetRowSpan(BrandLockup, 1);
        BrandLockup.Width = double.NaN;
        BrandLockup.Margin = new Thickness(8, 42, 8, 0);
        BrandLockup.HorizontalAlignment = HorizontalAlignment.Center;
        BrandLockup.VerticalAlignment = VerticalAlignment.Top;
        AddGameButton.Visibility = Visibility.Visible;
        AddGameButton.Width = Math.Max(72, profile.RailExtent - 24);
        AddGameButton.Margin = new Thickness(12, 8, 12, 8);
        AddGameButton.HorizontalAlignment = HorizontalAlignment.Center;
        AddGameButton.VerticalAlignment = VerticalAlignment.Center;
        AddGameLabel.Visibility = Visibility.Visible;
        Grid.SetRow(AddGameButton, 2);
        Grid.SetRowSpan(AddGameButton, 1);
        KofiButton.Visibility = Visibility.Visible;
        Grid.SetRow(KofiButton, 4);

        Grid.SetRow(GameSelector, 1);
        Grid.SetRowSpan(GameSelector, 1);
        Grid.SetColumn(GameSelector, 0);
        Grid.SetColumnSpan(GameSelector, 1);
        GameSelector.Width = profile.RailExtent;
        GameSelector.Height = double.NaN;
        GameSelector.Margin = new Thickness(0);
        GameSelector.HorizontalAlignment = HorizontalAlignment.Left;
        GameSelector.VerticalAlignment = VerticalAlignment.Center;
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
        ContentScroll.Margin = new Thickness(
            52,
            76,
            24,
            profile.DeckHeight + 42);

        Grid.SetRow(CommandDeck, 0);
        Grid.SetRowSpan(CommandDeck, 2);
        Grid.SetColumn(CommandDeck, 1);
        Grid.SetColumnSpan(CommandDeck, 2);
        CommandDeck.Margin = new Thickness(
            26,
            0,
            profile.OuterPadding,
            22);
    }

    private void ApplyCommandDeckLayout(LauncherLayoutProfile profile, double width)
    {
        var compact = profile.State is LauncherLayoutState.Compact;
        var horizontal = profile.State is LauncherLayoutState.Horizontal;
        var horizontalDeck = horizontal
            || (profile.State is LauncherLayoutState.Wide
                && width < LauncherViewportGeometry.NarrowWideDeckWidth);

        CommandDeck.Padding = compact
            ? new Thickness(12, 12, 12, 12)
            : horizontalDeck
                ? new Thickness(14, 9, 14, 9)
                : new Thickness(26, 20, 26, 20);
        CommandDeckGrid.ColumnSpacing = compact ? 0 : horizontalDeck ? 12 : 20;
        CommandDeckGrid.RowSpacing = compact ? 8 : 0;

        SignalPanel.MinWidth = 0;
        MaintenanceResponsibilityText.Visibility = horizontalDeck || compact
            ? Visibility.Collapsed
            : Visibility.Visible;
        PengoToolsLabel.Visibility = horizontalDeck || compact
            ? Visibility.Collapsed
            : Visibility.Visible;
        PengoToolButtons.Margin = horizontalDeck || compact
            ? new Thickness(0, 0, 0, 0)
            : new Thickness(0, 8, 0, 0);
        UpdaterSignalRow.Margin = compact
            ? new Thickness(LauncherViewportGeometry.CompactOfficialInset, 0, 0, 0)
            : new Thickness(0, 0, 0, 0);
        NyxToolsPanel.Margin = new Thickness(0);
        SignalStack.Visibility = horizontalDeck ? Visibility.Collapsed : Visibility.Visible;
        LaunchButton.Margin = horizontalDeck
            ? new Thickness(0, LauncherViewportGeometry.TwoRowGap, 0, 0)
            : new Thickness(0, 0, 0, 0);

        if (compact)
        {
            LaunchButton.Width = double.NaN;
            DeckRow0.Height = new GridLength(LauncherViewportGeometry.CompactStatusHeight);
            DeckRow1.Height = new GridLength(LauncherViewportGeometry.CompactToolsHeight);
            DeckRow2.Height = new GridLength(LauncherViewportGeometry.CompactCtaHeight);
            DeckColumn0.Width = new GridLength(LauncherViewportGeometry.CompactLocalWidth);
            DeckColumn1.Width = new GridLength(1, GridUnitType.Star);
            DeckColumn2.Width = new GridLength(0);
            DeckColumn3.Width = new GridLength(0);

            PlaceDeckItem(SignalPanel, 0, 0, 1, 1);
            PlaceDeckItem(UpdaterSignalRow, 0, 1, 1, 1);
            PlaceDeckItem(NyxToolsPanel, 1, 0, 1, 2);
            PlaceDeckItem(LaunchButton, 2, 0, 1, 2);
            LaunchButton.HorizontalAlignment = HorizontalAlignment.Stretch;
            return;
        }

        if (horizontalDeck)
        {
            LaunchButton.Width = double.NaN;
            LaunchButton.Height = 62;
            DeckRow0.Height = new GridLength(
                profile.State is LauncherLayoutState.Wide
                    ? LauncherViewportGeometry.WideTwoRowStatusHeight
                    : LauncherViewportGeometry.TwoRowHeight);
            DeckRow1.Height = new GridLength(
                LauncherViewportGeometry.TwoRowHeight
                + LauncherViewportGeometry.TwoRowGap);
            DeckRow2.Height = new GridLength(0);
            DeckColumn0.Width = new GridLength(1, GridUnitType.Star);
            DeckColumn1.Width = new GridLength(1, GridUnitType.Star);
            DeckColumn2.Width = new GridLength(profile.LaunchWidth / 2);
            DeckColumn3.Width = new GridLength(profile.LaunchWidth / 2);

            PlaceDeckItem(SignalPanel, 0, 0, 1, 1);
            PlaceDeckItem(UpdaterSignalRow, 0, 1, 1, 3);
            PlaceDeckItem(NyxToolsPanel, 1, 0, 1, 2);
            PlaceDeckItem(LaunchButton, 1, 2, 1, 2);
            LaunchButton.HorizontalAlignment = HorizontalAlignment.Stretch;
            return;
        }

        DeckRow0.Height = new GridLength(1, GridUnitType.Star);
        DeckRow1.Height = new GridLength(0);
        DeckRow2.Height = new GridLength(0);
        DeckColumn0.Width = new GridLength(
            profile.State is LauncherLayoutState.Wide ? 200 : 190);
        DeckColumn1.Width = new GridLength(1, GridUnitType.Star);
        DeckColumn2.Width = new GridLength(
            profile.State is LauncherLayoutState.Wide ? 232 : 230);
        DeckColumn3.Width = new GridLength(profile.LaunchWidth);
        LaunchButton.Width = profile.LaunchWidth;

        PlaceDeckItem(SignalPanel, 0, 0, 1, 1);
        PlaceDeckItem(UpdaterSignalRow, 0, 1, 1, 1);
        PlaceDeckItem(NyxToolsPanel, 0, 2, 1, 1);
        PlaceDeckItem(LaunchButton, 0, 3, 1, 1);
        LaunchButton.HorizontalAlignment = HorizontalAlignment.Stretch;
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

        UpdaterSignalRow.Spacing = compact ? 2 : 7;
        UpdaterSignalLayout.RowSpacing = compact ? 2 : stackedActions ? 6 : 0;
        Grid.SetRow(MaintenanceProviderText, 0);
        Grid.SetColumn(MaintenanceProviderText, 0);
        Grid.SetRow(UpdaterSignalText, 0);
        Grid.SetColumn(UpdaterSignalText, 1);

        Grid.SetRow(ChooseGameFolderButton, stackedActions ? 1 : 0);
        Grid.SetColumn(ChooseGameFolderButton, stackedActions ? 0 : 2);
        ChooseGameFolderButton.HorizontalAlignment = HorizontalAlignment.Left;

        Grid.SetRow(OpenUpdaterButton, stackedActions ? 1 : 0);
        Grid.SetColumn(OpenUpdaterButton, stackedActions ? 1 : 3);
        OpenUpdaterButton.HorizontalAlignment = stackedActions
            ? HorizontalAlignment.Right
            : HorizontalAlignment.Left;
    }

    private void ApplyVerticalDensity(LauncherLayoutProfile profile, double height)
    {
        var dense = height < LauncherLayoutStateSelector.ExpandedHeight;

        HeroTitle.FontSize = dense
            ? Math.Max(42, profile.TitleSize - 4)
            : profile.TitleSize;
        LatestStrip.Margin = new Thickness(0, dense ? 22 : 30, 0, 0);
        LatestContentStack.Spacing = dense ? 6 : 9;
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
        LatestStrip.Visibility = launcherState.Snapshot.Preferences.FeatureFlags.OfficialNews
            ? Visibility.Visible
            : Visibility.Collapsed;
        CurrentBannerList.Visibility = Visibility.Visible;
        var layout = LauncherLayoutStateSelector.CreateProfile(ActualWidth, ActualHeight);
        MaintenanceResponsibilityText.Visibility = layout.State is LauncherLayoutState.Horizontal or LauncherLayoutState.Compact
            || (layout.State is LauncherLayoutState.Wide && ActualWidth < LauncherViewportGeometry.NarrowWideDeckWidth)
            ? Visibility.Collapsed
            : Visibility.Visible;
        if (launcherState.Snapshot.SelectedGameId != selected.Id)
        {
            _ = launcherState.TryUpdate(state => state with { SelectedGameId = selected.Id });
        }
        RenderLatestContent();
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
        if (GameSelector?.SelectedItem is GameLauncherItem selected
            && string.Equals(selected.Id, gameId, StringComparison.Ordinal)
            && Uri.TryCreate(selected.HeroArtPath, UriKind.Absolute, out var heroUri))
        {
            HeroArtwork.Source = new BitmapImage(heroUri);
            HeroArtwork.Stretch = Stretch.UniformToFill;
        }
        _ = TryApplyPinnedArt(appearance);
        var path = appearance.BackgroundPath;
        if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
        {
            BackgroundArtwork.Source = new BitmapImage(new Uri(path));
        }
        else
        {
            BackgroundArtwork.Source = new BitmapImage(new Uri("ms-appx:///Assets/backgroundnyx.png"));
        }
    }

    private void RenderCustomGame(GameLauncherItem selected)
    {
        LatestStrip.Visibility = Visibility.Collapsed;
        UpdaterSignalRow.Visibility = Visibility.Collapsed;
        NyxToolsPanel.Visibility = Visibility.Collapsed;
        CurrentBannerList.Visibility = Visibility.Collapsed;
        MaintenanceResponsibilityText.Visibility = Visibility.Collapsed;

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
        NyxToolsPanel.Visibility = pullsAvailable || achievementsAvailable
            ? Visibility.Visible
            : Visibility.Collapsed;
        if (!pullsAvailable && !achievementsAvailable) return;
        var armed = launcherState.Snapshot.Export.Games.TryGetValue(selected.Id, out var saved)
            ? saved
            : new Nyx.Desktop.Core.State.ExportGameArming();
        PullExportToggle.IsChecked = pullsAvailable && armed.PullsArmed;
        AchievementExportToggle.IsChecked = achievementsAvailable && armed.AchievementsArmed;
        PullExportToggle.Visibility = pullsAvailable ? Visibility.Visible : Visibility.Collapsed;
        AchievementExportToggle.Visibility = achievementsAvailable ? Visibility.Visible : Visibility.Collapsed;
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
        ConfirmWorldButton.Visibility = Visibility.Collapsed;
        ConfirmHistoryButton.Visibility = Visibility.Collapsed;
        if (latestExportJobs.TryGetValue(selected.Id, out var jobId))
        {
            var job = exports.GetSnapshot(jobId);
            CancelExportButton.Visibility = job.IsFinished ? Visibility.Collapsed : Visibility.Visible;
            OpenExportsButton.Visibility = job.IsFinished ? Visibility.Visible : Visibility.Collapsed;
            ConfirmWorldButton.Visibility = job.Achievements.State is ExportTaskState.WaitingForWorld
                ? Visibility.Visible
                : Visibility.Collapsed;
            ConfirmHistoryButton.Visibility = job.Pulls.State is ExportTaskState.WaitingForHistory
                ? Visibility.Visible
                : Visibility.Collapsed;
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
    }

    private static string FormatExportStatus(ExportJobSnapshot job)
    {
        if (!job.IsFinished)
        {
            if (job.Achievements.State is ExportTaskState.Preparing)
                return "Achievements: preparing capture before launch...";
            if (job.Achievements.State is ExportTaskState.WaitingForWorld)
                return "Achievements: enter the world, then confirm.";
            if (job.Pulls.State is ExportTaskState.WaitingForHistory)
                return "Pulls: open Wish or Warp History, then confirm.";
            return "Export is running. Keep the game open.";
        }
        if (job.State == ExportJobState.Completed) return "Export complete. The files are in Pengo Exports.";
        if (job.State == ExportJobState.Canceled) return "Export canceled. No unfinished file was kept.";
        if (job.State == ExportJobState.Unsupported) return "This game’s export provider is coming later.";
        var code = job.Pulls.ErrorCode ?? job.Achievements.ErrorCode;
        return code switch
        {
            "approval-canceled" => "Administrator approval was canceled, so achievements were not exported.",
            "administrator_required" => "Achievement export needs administrator approval for this game.",
            "normal_user_required" => "Genshin achievement export must run without administrator rights.",
            "capture_timeout" or "timed-out" => "Export timed out. Launch again and enter the game promptly.",
            "output-missing" or "output_write_failed" => "Nyx could not create the export file.",
            _ => "The export did not finish, but the game launch was not blocked.",
        };
    }

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

    private void RenderLatestContent()
    {
        if (LatestSourceText is null || GameSelector?.SelectedItem is not GameLauncherItem selected)
        {
            return;
        }

        LatestCards.Clear();
        CurrentBannerRows.Clear();
        var officialNewsEnabled = launcherState.Snapshot.Preferences.FeatureFlags.OfficialNews;
        LatestStrip.Visibility = officialNewsEnabled ? Visibility.Visible : Visibility.Collapsed;
        if (!selected.IsCustom
            && launcherBanners.Current.Games.TryGetValue(selected.Id, out var launcherGame))
        {
            var health = launcherBanners.Current.Health.Games.TryGetValue(selected.Id, out var gameHealth)
                ? gameHealth.Status
                : launcherBanners.Current.Health.Status;
            LatestSourceText.Text = "OFFICIAL";
            LatestFreshnessText.Text = health.ToUpperInvariant();
            AutomationProperties.SetName(LatestSourceText, "Source: official publisher feeds cached by Nyx");
            AutomationProperties.SetName(LatestFreshnessText, $"Freshness: {health}");
            var index = 0;
            foreach (var item in officialNewsEnabled ? launcherGame.News.Take(3) : [])
            {
                LatestCards.Add(LatestContentCardItem.From(
                    new LatestContentCard(
                        item.Id,
                        item.Type,
                        item.Title,
                        item.Start,
                        item.ApprovedUrl?.AbsoluteUri),
                    index++));
            }

            var now = DateTimeOffset.UtcNow;
            if (launcherGame.Current is { } current && current.Start <= now && now < current.End)
            {
                foreach (var character in current.Characters.Take(2))
                {
                    CurrentBannerRows.Add(new CurrentBannerRowItem(
                        character.Name,
                        CurrentBannerRowItem.FormatRemainingForDisplay(current.End - DateTimeOffset.UtcNow)));
                }
                ApplyLauncherBannerArt(selected.Id, current);
            }
            return;
        }

        if (!officialNewsEnabled) return;

        if (!latestContent.Current.TryGetValue(selected.Id, out var snapshot))
        {
            LatestSourceText.Text = "LOCAL SNAPSHOT";
            LatestFreshnessText.Text = "N/A";
            AutomationProperties.SetName(LatestSourceText, "Source: local snapshot");
            AutomationProperties.SetName(LatestFreshnessText, "Freshness: unavailable");
            AutomationProperties.SetName(
                LatestStrip,
                $"Latest for {selected.DisplayName}. Content is unavailable.");
            return;
        }

        LatestSourceText.Text = snapshot.SourceLabel.ToUpperInvariant();
        LatestFreshnessText.Text = snapshot.IsFallback ? "LOCAL" : "FRESH";
        AutomationProperties.SetName(LatestSourceText, $"Source: {snapshot.SourceLabel}");
        AutomationProperties.SetName(LatestFreshnessText, $"Freshness: {snapshot.FreshnessLabel}");
        AutomationProperties.SetName(
            LatestStrip,
            $"Latest for {selected.DisplayName}. Source: {snapshot.SourceLabel}. Freshness: {snapshot.FreshnessLabel}.");

        var cardIndex = 0;
        foreach (var card in snapshot.Cards.Take(3))
        {
            LatestCards.Add(LatestContentCardItem.From(card, cardIndex++));
        }

        foreach (var card in snapshot.Cards
                     .Where(static card => string.Equals(card.Type, "banner", StringComparison.OrdinalIgnoreCase))
                     .Take(2))
        {
            CurrentBannerRows.Add(CurrentBannerRowItem.From(card, DateTimeOffset.Now));
        }
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

        var selectedCharacter = current.Characters.FirstOrDefault(character => character.Id == current.SelectedCharacterId)
            ?? current.Characters.FirstOrDefault();
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
        if (pinMigration is LauncherPinnedArtMigrationStatus.AvailableForProtection)
            variant = allCurrentVariants.FirstOrDefault(asset => asset.Id == appearance.ArtVariant);
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
                        [gameId] = currentAppearance with { PinnedArtFile = pinToSave },
                    };
                    pinWasSaved = true;
                    return currentState with { Appearance = appearances };
                });
                if (migrated && pinWasSaved)
                {
                    appearance = appearance with { PinnedArtFile = migratedPin };
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
            && automaticArtVariants.TryGetValue(gameId, out var remembered)
            && remembered.Revision == launcherBanners.Current.Revision)
            variant = variants.FirstOrDefault(asset => asset.Id == remembered.VariantId);
        if (variant is null && variants.Count > 0)
        {
            variant = variants[Random.Shared.Next(variants.Count)];
            automaticArtVariants[gameId] = (launcherBanners.Current.Revision, variant.Id);
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

        HeroArtwork.Source = new BitmapImage(new Uri(path));
        HeroArtwork.Stretch = variant.Placement.Fit == "contain" ? Stretch.Uniform : Stretch.UniformToFill;
        if (HeroArtwork.RenderTransform is CompositeTransform transform)
        {
            transform.ScaleX = appearance.ArtScale / 100d;
            transform.ScaleY = appearance.ArtScale / 100d;
            transform.TranslateX = appearance.ArtX + ((variant.Placement.X - 0.5) * HeroStage.ActualWidth);
            transform.TranslateY = appearance.ArtY + ((variant.Placement.Y - 0.5) * HeroStage.ActualHeight);
        }
    }

    private bool TryApplyPinnedArt(Nyx.Desktop.Core.State.GameAppearanceState appearance)
    {
        if (!appearance.ArtPinned || launcherBanners.TryResolveUserArt(appearance.PinnedArtFile) is not { } path) return false;
        HeroArtwork.Source = new BitmapImage(new Uri(path));
        HeroArtwork.Stretch = Stretch.Uniform;
        if (HeroArtwork.RenderTransform is CompositeTransform transform)
        {
            transform.ScaleX = appearance.ArtScale / 100d;
            transform.ScaleY = appearance.ArtScale / 100d;
            transform.TranslateX = appearance.ArtX + (0.22 * HeroStage.ActualWidth);
            transform.TranslateY = appearance.ArtY;
        }
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
        OpenUpdaterButton.IsEnabled = false;
        OpenUpdaterButton.Content = "OPEN GRYPHLINK";
        ChooseGameFolderButton.Visibility = Visibility.Visible;
        ChooseGameFolderButton.IsEnabled = !endfieldFolderActionInFlight
            && !endfieldMaintenanceActionInFlight;
        var hasRoot = endfieldRootStore.Load() is not null;
        ChooseGameFolderButton.Content = endfieldFolderActionInFlight
            ? "CHOOSING…"
            : hasRoot ? "CHANGE FOLDER" : "CHOOSE FOLDER";
        AutomationProperties.SetName(
            ChooseGameFolderButton,
            hasRoot
                ? "Change the Arknights Endfield game folder"
                : "Choose the Arknights Endfield game folder");
        MaintenanceProviderText.Text = "GRYPHLINK";
        RenderEndfieldMaintenance();

        if (endfieldFolderSelectionNeedsReview)
        {
            SetGameSignal("Needs review", "LavenderBrush");
            HeroDescription.Text = "That folder was not the complete official GRYPHLINK install. Nothing was saved or started.";
            SetLaunchControls(false, "LOCKED", "Choose the GRYPHLINK folder", "Endfield folder needs review");
            return;
        }

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
                OpenUpdaterButton.Content = "TRY AGAIN";
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
        OpenUpdaterButton.Visibility = Visibility.Collapsed;
        OpenUpdaterButton.IsEnabled = false;
        OpenUpdaterButton.Content = "OPEN OFFICIAL";
        MaintenanceProviderText.Text = "Wuthering Waves launcher";
        RenderPublisherSession(selected);

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
                AutomationProperties.SetName(OpenUpdaterButton, "Wuthering Waves launcher start requested");
                break;
            case WuWaOfficialMaintenanceStatus.Failed:
                UpdaterSignalText.Text = "Official launcher failed to open";
                AutomationProperties.SetName(OpenUpdaterButton, "Wuthering Waves launcher failed to open");
                break;
            case WuWaOfficialMaintenanceStatus.NotFound:
                UpdaterSignalText.Text = "Official launcher not found";
                AutomationProperties.SetName(OpenUpdaterButton, "Wuthering Waves launcher was not found");
                break;
            default:
                UpdaterSignalText.Text = "Official maintenance needs review";
                AutomationProperties.SetName(OpenUpdaterButton, "Wuthering Waves maintenance needs review");
                break;
        }
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

        OpenUpdaterButton.Content = "OPEN OFFICIAL";

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
                OpenUpdaterButton.Content = "TRY AGAIN";
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

public sealed class LatestContentCardItem
{
    public string TypeLabel { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string DateLabel { get; set; } = string.Empty;

    public double TitleSize { get; set; } = 13;

    public double ItemOpacity { get; set; } = 0.78;

    public string? ApprovedLink { get; set; }

    public bool IsLinkSafe { get; set; }

    public string AccessibilityName { get; set; } = string.Empty;

    public static LatestContentCardItem From(LatestContentCard card, int index = 0) => new()
    {
        TypeLabel = FormatType(card.Type),
        Title = card.Title,
        DateLabel = card.PublisherDateLabel
            ?? card.PublishedAt?.ToUniversalTime().ToString("yyyy.MM.dd", CultureInfo.InvariantCulture)
            ?? "CURRENT",
        TitleSize = index == 0 ? 15 : 13,
        ItemOpacity = index == 0 ? 1 : 0.78,
        ApprovedLink = card.ApprovedLink,
        IsLinkSafe = !string.IsNullOrWhiteSpace(card.ApprovedLink),
        AccessibilityName = string.IsNullOrWhiteSpace(card.ApprovedLink)
            ? $"News: {card.Title}"
            : $"Open official news: {card.Title}",
    };

    private static string FormatType(string type) => type switch
    {
        "POST_TYPE_ACTIVITY" => "ACTIVITY",
        "POST_TYPE_ANNOUNCE" => "NOTICE",
        "POST_TYPE_NEWS" => "NEWS",
        _ => type.ToUpperInvariant(),
    };
}

public sealed class CurrentBannerRowItem
{
    public CurrentBannerRowItem(string title, string remaining)
    {
        Title = title;
        Remaining = remaining;
    }

    public string Title { get; set; }

    public string Remaining { get; set; }

    public static CurrentBannerRowItem From(LatestContentCard card, DateTimeOffset now)
    {
        var remaining = card.PublishedAt is not { } end || end <= now
            ? "LIVE"
            : FormatRemainingForDisplay(end - now);
        return new(card.Title, remaining);
    }

    public static string FormatRemainingForDisplay(TimeSpan duration)
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

public sealed record GameOrderItem(string Id, string DisplayName);

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
