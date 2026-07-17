using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.Storage.Pickers;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using Nyx.Desktop.Core.Content;
using Nyx.Desktop.Core.Games;
using Nyx.Desktop.Core.Genshin;
using Nyx.Desktop.Core.Hoyo;
using Nyx.Desktop.Core.Launching;
using Nyx.Desktop.Core.PublisherMaintenance;
using Nyx.Desktop.Core.PublisherGames;
using Nyx.Desktop.Core.Sessions;
using Nyx.Desktop.Core.Tools;
using Nyx.Desktop.Infrastructure.Genshin;
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
    private readonly HoyoPublisherStatusSource publisherStatus;
    private readonly GenshinGameSessionAdapter genshinSession;
    private readonly IReadOnlyDictionary<string, HoyoGameSessionAdapter> hoyoSessions;
    private readonly HoyoPlayHandoffExecutor hoyoPlayExecutor;
    private readonly WuWaMaintenanceService wuwaMaintenance;
    private readonly PublisherGameDirectLaunchService publisherGameLaunchService;
    private readonly EndfieldInstallRootStore endfieldRootStore;
    private readonly EndfieldOfficialMaintenanceService endfieldMaintenance;
    private readonly App app;
    private readonly WindowsGenshinCandidateDiscovery discovery;
    private string? updaterRoot;
    private GameSessionSnapshot? gameSnapshot;
    private GenshinLaunchStatus? updaterStatus;
    private GenshinLaunchFailureReason gameFailureReason;
    private bool updaterScanFinished;
    private bool wuwaScanFinished;
    private readonly HashSet<string> gameActionsInFlight = new(StringComparer.Ordinal);
    private readonly HashSet<(string GameId, PengoWebToolKind Kind)> webToolActionsInFlight = [];
    private readonly Dictionary<string, (long Generation, string Message)> webToolFeedbackByGame =
        new(StringComparer.Ordinal);
    private long nextWebToolFeedbackGeneration;
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

    public IReadOnlyList<GameLauncherItem> Games { get; } = GameCatalog.All
        .Select(game =>
        {
            var hero = HeroPresentations[game.Id];
            return new GameLauncherItem(
                game.Id,
                game.DisplayName,
                IconPaths[game.Id],
                HeroArtPaths[game.Id],
                hero.Scale,
                hero.OffsetX,
                hero.OffsetY,
                hero.FadeStart,
                hero.FadeMid,
                MaintenanceProviders[game.Id],
                "⋯",
                "Checking local status");
        })
        .ToArray();

    public ObservableCollection<LatestContentCardItem> LatestCards { get; } = new();

    public MainPage()
    {
        InitializeComponent();

        app = (App)Application.Current;
        sessions = app.Sessions;
        sessionRefresh = app.SessionRefresh;
        sessionUiLifetime = app.SessionUiLifetime;
        latestContent = app.LatestContent;
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
        gameSnapshot = sessions.GetSnapshot("gi");
        RenderSelection();
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
        webToolActionsInFlight.Clear();
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
            var result = await sessions.RequestLaunchAsync(gameId, lease.CancellationToken);
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                gameSnapshot = result.Snapshot;
                if (gameId == "gi")
                {
                    gameFailureReason = genshinSession.LastLaunchFailureReason;
                }
            });
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

    private async void OpenPullTrackerButton_Click(object sender, RoutedEventArgs e) =>
        await OpenPengoWebToolAsync(PengoWebToolKind.PullTracker);

    private async void OpenAchievementsButton_Click(object sender, RoutedEventArgs e) =>
        await OpenPengoWebToolAsync(PengoWebToolKind.Achievements);

    private async Task OpenPengoWebToolAsync(PengoWebToolKind kind)
    {
        var lease = pageLease;
        if (lease is null
            || GameSelector?.SelectedItem is not GameLauncherItem selected
            || !PengoWebToolCatalog.TryGet(selected.Id, kind, out var definition))
        {
            return;
        }

        var action = (selected.Id, kind);
        if (!webToolActionsInFlight.Add(action))
        {
            return;
        }

        var feedbackGeneration = ++nextWebToolFeedbackGeneration;
        webToolFeedbackByGame[selected.Id] = (
            feedbackGeneration,
            "Opening the exact Pengo page...");
        RenderPengoTools(selected);

        try
        {
            var opened = await Windows.System.Launcher.LaunchUriAsync(definition.Destination);
            _ = sessionUiLifetime.TryRun(lease, () =>
                SetPengoWebToolFeedbackIfCurrent(
                    selected.Id,
                    feedbackGeneration,
                    opened
                    ? "Opened in your browser. Import choices stay on Pengo."
                    : "Windows could not open the Pengo page. Check your default browser."));
        }
        catch (Exception)
        {
            _ = sessionUiLifetime.TryRun(lease, () =>
                SetPengoWebToolFeedbackIfCurrent(
                    selected.Id,
                    feedbackGeneration,
                    "Windows could not open the Pengo page. Check your default browser."));
        }
        finally
        {
            _ = sessionUiLifetime.TryRun(lease, () =>
            {
                webToolActionsInFlight.Remove(action);
                if (GameSelector?.SelectedItem is GameLauncherItem current)
                {
                    RenderPengoTools(current);
                }
            });
        }
    }

    private void SetPengoWebToolFeedbackIfCurrent(
        string gameId,
        long generation,
        string message)
    {
        if (webToolFeedbackByGame.TryGetValue(gameId, out var current)
            && current.Generation == generation)
        {
            webToolFeedbackByGame[gameId] = (generation, message);
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

    private void GameSelector_SelectionChanged(object sender, SelectionChangedEventArgs e) =>
        RenderSelection();

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
        HeroStage.Width = profile.HeroWidth;
        HeroArtwork.Opacity = profile.State switch
        {
            LauncherLayoutState.Compact => 0.34,
            LauncherLayoutState.Horizontal => 0.58,
            LauncherLayoutState.Wide => 0.92,
            _ => 1,
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
            RailFooterRow.Height = new GridLength(0);
            Grid.SetRow(BrandLockup, 0);
            Grid.SetRowSpan(BrandLockup, 1);
            BrandLockup.Width = profile.State is LauncherLayoutState.Compact ? 92 : 116;
            BrandLockup.Margin = new Thickness(12, 48, 0, 6);
            BrandLockup.HorizontalAlignment = HorizontalAlignment.Left;
            BrandLockup.VerticalAlignment = VerticalAlignment.Center;
            RailGameCount.Visibility = Visibility.Collapsed;

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
                10,
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

        RailBrandRow.Height = new GridLength(100);
        RailContentRow.Height = new GridLength(1, GridUnitType.Star);
        RailFooterRow.Height = new GridLength(0);
        Grid.SetRow(BrandLockup, 0);
        Grid.SetRowSpan(BrandLockup, 1);
        BrandLockup.Width = double.NaN;
        BrandLockup.Margin = new Thickness(12, 48, 12, 0);
        BrandLockup.HorizontalAlignment = HorizontalAlignment.Center;
        BrandLockup.VerticalAlignment = VerticalAlignment.Top;
        RailGameCount.Visibility = Visibility.Collapsed;

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
        MaintenanceResponsibilityText.Visibility = horizontal || compact
            ? Visibility.Collapsed
            : Visibility.Visible;
        PengoToolsLabel.Visibility = horizontal || compact
            ? Visibility.Collapsed
            : Visibility.Visible;
        PengoToolButtons.Margin = horizontal || compact
            ? new Thickness(0, 0, 0, 0)
            : new Thickness(0, 8, 0, 0);
        UpdaterSignalRow.Margin = compact
            ? new Thickness(LauncherViewportGeometry.CompactOfficialInset, 0, 0, 0)
            : new Thickness(0, 0, 0, 0);
        NyxToolsPanel.Margin = horizontalDeck
            ? new Thickness(0, LauncherViewportGeometry.TwoRowGap, 0, 0)
            : new Thickness(0, 0, 0, 0);
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
            DeckRow0.Height = new GridLength(LauncherViewportGeometry.TwoRowHeight);
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
            profile.State is LauncherLayoutState.Wide ? 160 : 190);
        DeckColumn1.Width = new GridLength(1, GridUnitType.Star);
        DeckColumn2.Width = new GridLength(
            profile.State is LauncherLayoutState.Wide ? 216 : 230);
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

        var gameIndex = Games.TakeWhile(game => game.Id != selected.Id).Count() + 1;
        GameIndexText.Text = $"GAME {gameIndex:00} / {Games.Count:00}";
        MaintenanceProviderText.Text = selected.MaintenanceProvider;
        ChooseGameFolderButton.Visibility = Visibility.Collapsed;
        gameSnapshot = sessions.GetSnapshot(selected.Id);
        RenderLatestContent();
        RenderPengoTools(selected);

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

    private void RenderPengoTools(GameLauncherItem selected)
    {
        var pullAvailable = PengoWebToolCatalog.TryGet(
            selected.Id,
            PengoWebToolKind.PullTracker,
            out _);
        var achievementsAvailable = PengoWebToolCatalog.TryGet(
            selected.Id,
            PengoWebToolKind.Achievements,
            out _);

        OpenPullTrackerButton.Visibility = pullAvailable
            ? Visibility.Visible
            : Visibility.Collapsed;
        OpenPullTrackerButton.IsEnabled = pullAvailable
            && !webToolActionsInFlight.Contains((selected.Id, PengoWebToolKind.PullTracker));
        AutomationProperties.SetName(
            OpenPullTrackerButton,
            $"Open Pengo pull history for {selected.DisplayName} in your browser");

        OpenAchievementsButton.Visibility = achievementsAvailable
            ? Visibility.Visible
            : Visibility.Collapsed;
        OpenAchievementsButton.IsEnabled = achievementsAvailable
            && !webToolActionsInFlight.Contains((selected.Id, PengoWebToolKind.Achievements));
        AutomationProperties.SetName(
            OpenAchievementsButton,
            $"Open Pengo achievements for {selected.DisplayName} in your browser");

        NyxToolsStatusText.Text = webToolFeedbackByGame.TryGetValue(selected.Id, out var feedback)
                ? feedback.Message
                : selected.Id == "ae"
                    ? "Endfield currently supports JSON, CSV, and manual pull import."
                    : "Import and extraction choices stay on Pengo.";
        AutomationProperties.SetName(
            NyxToolsPanel,
            achievementsAvailable
                ? $"Pengo pull history and achievements for {selected.DisplayName}"
                : $"Pengo pull history for {selected.DisplayName}");
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
                HeroDescription.Text = "Official files verified. Nyx is ready to start the game.";
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
                SetLaunchControls(false, "RUNNING", WithVersion("Detected", gameVersion), "Genshin Impact is running");
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
                HeroDescription.Text = "Official files verified. Nyx is ready to start the game.";
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
                SetLaunchControls(false, "RUNNING", WithVersion("Detected", version), $"{selected.DisplayName} is running");
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
                HeroDescription.Text = "Official files verified. Nyx is ready to start the game.";
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

    public static LatestContentCardItem From(LatestContentCard card, int index = 0) => new()
    {
        TypeLabel = FormatType(card.Type),
        Title = card.Title,
        DateLabel = card.PublisherDateLabel
            ?? card.PublishedAt?.ToUniversalTime().ToString("yyyy.MM.dd", CultureInfo.InvariantCulture)
            ?? "CURRENT",
        TitleSize = index == 0 ? 15 : 13,
        ItemOpacity = index == 0 ? 1 : 0.78,
    };

    private static string FormatType(string type) => type switch
    {
        "POST_TYPE_ACTIVITY" => "ACTIVITY",
        "POST_TYPE_ANNOUNCE" => "NOTICE",
        "POST_TYPE_NEWS" => "NEWS",
        _ => type.ToUpperInvariant(),
    };
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
        string statusDescription)
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
