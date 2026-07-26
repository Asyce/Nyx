using System.Text.Json;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using Nyx.Desktop.Core.AccountStatus;
using Windows.Graphics;

namespace Nyx_Desktop_App;

public sealed partial class PublisherSessionWindow : Window, IAsyncDisposable
{
    private const int ResourceCaptureTimeoutSeconds = 12;
    private readonly string profileDirectory;
    private readonly string provider;
    private readonly TimeProvider timeProvider;
    private readonly PublisherClaimWriteAuthority claimWriteAuthority = new();
    private readonly TaskCompletionSource closed = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly CancellationTokenSource lifetime = new();
    private Uri? approvedTopLevelUri;
    private SessionProbeCapture? pendingSessionProbe;
    private CheckInCapture? pendingCheckInCapture;
    private PendingResourceCapture? pendingResourceCapture;
    private PublisherProfileMutationJournal? profileMutationJournal;
    private long sessionProbeGeneration;
    private long checkInGeneration;
    private long resourceGeneration;
    private PublisherSessionPurpose purpose;
    private string? authorizedGameId;
    private int initialized;
    private bool windowClosed;
    private bool disposed;

    public PublisherSessionWindow(
        string profileDirectory,
        string provider,
        TimeProvider? timeProvider = null)
    {
        this.profileDirectory = Path.GetFullPath(profileDirectory);
        this.provider = provider;
        this.timeProvider = timeProvider ?? TimeProvider.System;
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBarDrag);
        Closed += (_, _) =>
        {
            windowClosed = true;
            closed.TrySetResult();
        };
    }

    public async Task InitializeAsync(
        Uri initialUri,
        bool visible,
        PublisherSessionPurpose purpose,
        string gameId,
        string heading,
        CancellationToken cancellationToken,
        PublisherProfileMutationJournal? profileMutationJournal = null)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        ArgumentNullException.ThrowIfNull(initialUri);
        var entry = PublisherAccountCatalog.Get(gameId);
        if (!string.Equals(entry.Provider, provider, StringComparison.Ordinal)
            || !PublisherAccountCatalog.IsAllowedTopLevelNavigation(provider, purpose, gameId, initialUri))
            throw new InvalidOperationException("The publisher session purpose does not authorize this page.");
        if (purpose == PublisherSessionPurpose.Connect && profileMutationJournal is null)
            throw new InvalidOperationException("Connect sessions require profile mutation tracking.");
        if (Interlocked.Exchange(ref initialized, 1) != 0)
            throw new InvalidOperationException("The publisher session purpose is already fixed.");
        approvedTopLevelUri = initialUri;
        this.purpose = purpose;
        this.profileMutationJournal = purpose == PublisherSessionPurpose.Connect
            ? profileMutationJournal
            : null;
        authorizedGameId = gameId;
        WindowHeading.Text = heading;
        DoneButton.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        AppWindow.IsShownInSwitchers = visible;
        // Keep the reviewed desktop markup even while the window is hidden.
        AppWindow.Resize(new SizeInt32(1000, 680));
        if (!visible) AppWindow.Move(new PointInt32(-20000, -20000));
        Activate();
        if (!visible) AppWindow.Hide();

        // WebView pages can persist cookies or script storage from any response,
        // not only from a reviewed login POST. Crossing into a Connect profile is
        // therefore the conservative mutation boundary for cancellation.
        if (purpose == PublisherSessionPurpose.Connect)
            profileMutationJournal!.MarkMayHaveChanged();
        Directory.CreateDirectory(profileDirectory);
        // Each publisher receives its own app-owned WebView2 directory. This
        // never reads or attaches to Chrome, Edge, or another browser profile.
        var environment = await CoreWebView2Environment.CreateWithOptionsAsync(
            null,
            profileDirectory,
            new CoreWebView2EnvironmentOptions());
        await Browser.EnsureCoreWebView2Async(environment);
        var core = Browser.CoreWebView2 ?? throw new InvalidOperationException("Publisher browser did not initialize.");
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = visible;
        core.Settings.AreHostObjectsAllowed = false;
        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        core.NavigationStarting += Core_NavigationStarting;
        core.WebResourceRequested += Core_WebResourceRequested;
        core.WebResourceResponseReceived += Core_WebResourceResponseReceived;
        core.NewWindowRequested += Core_NewWindowRequested;
        core.DownloadStarting += Core_DownloadStarting;
        core.PermissionRequested += Core_PermissionRequested;
        // Resource capture owns its first and only navigation so requests from
        // initialization cannot be mistaken for the measured operation.
        if (purpose != PublisherSessionPurpose.Resource)
            await NavigateAsync(initialUri, cancellationToken);
    }

    public Task WaitUntilClosedAsync(CancellationToken cancellationToken) =>
        closed.Task.WaitAsync(cancellationToken);

    public async Task<PublisherSessionProof> GetSessionProofAsync(CancellationToken cancellationToken)
    {
        var core = Browser.CoreWebView2 ?? throw new InvalidOperationException("Publisher browser is not initialized.");
        if (provider == "HoYoLAB")
        {
            var cookies = await core.CookieManager
                .GetCookiesAsync("https://www.hoyolab.com")
                .AsTask(cancellationToken);
            var names = cookies.Select(static cookie => cookie.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            return names.Contains("ltoken_v2")
                && (names.Contains("ltuid_v2") || names.Contains("account_id_v2"))
                ? PublisherSessionProof.Authenticated
                : PublisherSessionProof.LoginRequired;
        }
        if (provider != "SKPORT") return PublisherSessionProof.NeedsReview;

        var capture = BeginSessionProbe(cancellationToken);
        try
        {
            core.Reload();
            return await capture.Completion.Task.WaitAsync(
                TimeSpan.FromSeconds(ResourceCaptureTimeoutSeconds),
                cancellationToken);
        }
        catch (TimeoutException)
        {
            return PublisherSessionProof.NeedsReview;
        }
        finally
        {
            if (Interlocked.CompareExchange(ref pendingSessionProbe, null, capture) == capture)
                capture.Cancel();
        }
    }

    public async Task<DailyCheckInResult> RunCheckInAsync(
        PublisherAccountCatalogEntry entry,
        CancellationToken cancellationToken)
    {
        if (purpose != PublisherSessionPurpose.CheckIn
            || !string.Equals(authorizedGameId, entry.GameId, StringComparison.Ordinal))
            throw new InvalidOperationException("This publisher session cannot perform that check-in.");
        if (entry.CheckInUri is null || !entry.SupportsDailyCheckIn)
            return new(entry.GameId, DailyCheckInState.Unavailable, "No official daily check-in is available.", DateTimeOffset.UtcNow);

        var operationTime = timeProvider.GetLocalNow();
        var expectedDate = DateOnly.FromDateTime(operationTime.DateTime);
        var before = await CaptureCheckInProofAsync(
            entry,
            "GET",
            expectedDate,
            operationTime,
            navigate: true,
            cancellationToken);
        if (before is PublisherCheckInProof.LoginNeeded)
            return new(entry.GameId, DailyCheckInState.LoginNeeded, $"Connect {entry.Provider} first.", DateTimeOffset.UtcNow);
        if (before is PublisherCheckInProof.Claimed)
            return new(entry.GameId, DailyCheckInState.AlreadyClaimed, "Already checked in today.", DateTimeOffset.UtcNow);
        if (before is not PublisherCheckInProof.Ready)
            return new(entry.GameId, DailyCheckInState.CouldNotCheck, "The official page needs review.", DateTimeOffset.UtcNow);

        var claimCapture = BeginCheckInCapture(
            entry.GameId,
            "POST",
            expectedDate,
            operationTime,
            cancellationToken);
        try
        {
            using var claimWrite = claimWriteAuthority.Arm(entry.GameId);
            var clickResult = await Browser.CoreWebView2!
                .ExecuteScriptAsync(BuildExactClaimScript(entry.GameId))
                .AsTask(cancellationToken);
            if (!string.Equals(ReadScriptString(clickResult), "clicked", StringComparison.Ordinal))
                return new(entry.GameId, DailyCheckInState.CouldNotCheck, "The official claim control was not available.", DateTimeOffset.UtcNow);

            var accepted = await claimCapture.Completion.Task.WaitAsync(
                TimeSpan.FromSeconds(ResourceCaptureTimeoutSeconds),
                cancellationToken);
            if (accepted is PublisherCheckInProof.LoginNeeded)
                return new(entry.GameId, DailyCheckInState.LoginNeeded, $"Connect {entry.Provider} first.", DateTimeOffset.UtcNow);
            if (accepted is not PublisherCheckInProof.ClaimAccepted)
                return new(entry.GameId, DailyCheckInState.CouldNotCheck, "The official page did not accept the claim.", DateTimeOffset.UtcNow);
        }
        catch (TimeoutException)
        {
            return new(entry.GameId, DailyCheckInState.CouldNotCheck, "The official claim control was not available.", DateTimeOffset.UtcNow);
        }
        finally
        {
            if (Interlocked.CompareExchange(ref pendingCheckInCapture, null, claimCapture) == claimCapture)
                claimCapture.Cancel();
        }

        var after = await CaptureCheckInProofAsync(
            entry,
            "GET",
            expectedDate,
            operationTime,
            navigate: true,
            cancellationToken);
        return after switch
        {
            PublisherCheckInProof.Claimed =>
                new(entry.GameId, DailyCheckInState.Claimed, "Daily reward claimed.", DateTimeOffset.UtcNow),
            PublisherCheckInProof.LoginNeeded =>
                new(entry.GameId, DailyCheckInState.LoginNeeded, $"Connect {entry.Provider} first.", DateTimeOffset.UtcNow),
            _ =>
                new(entry.GameId, DailyCheckInState.CouldNotCheck, "The official page did not confirm the claim.", DateTimeOffset.UtcNow),
        };
    }

    public async Task<PublisherResourceReadResult> ReadResourceAsync(
        PublisherAccountCatalogEntry entry,
        PublisherRoleBinding? expectedBinding,
        CancellationToken cancellationToken)
    {
        if (purpose != PublisherSessionPurpose.Resource
            || !string.Equals(authorizedGameId, entry.GameId, StringComparison.Ordinal))
            throw new InvalidOperationException("This publisher session cannot read that resource.");
        if (entry.ResourceUri is null
            || !entry.SupportsNumericResource
            || !PublisherAccountCatalog.IsExactResourcePageUri(entry.GameId, entry.ResourceUri))
            return new(null, PublisherResourceReadOutcome.NeedsReview);

        var generation = Interlocked.Increment(ref resourceGeneration);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, lifetime.Token);
        if (expectedBinding is not null
            && !PublisherAccountCatalog.IsValidRoleBinding(entry.GameId, expectedBinding))
            return new(null, PublisherResourceReadOutcome.NeedsReview);
        var authority = new PublisherResourceCaptureAuthority(
            entry.GameId,
            generation,
            expectedBinding);
        var capture = new PendingResourceCapture(authority, linked.Token);
        var previous = Interlocked.Exchange(ref pendingResourceCapture, capture);
        previous?.Cancel();
        try
        {
            var observation = Task.Delay(
                TimeSpan.FromSeconds(ResourceCaptureTimeoutSeconds),
                linked.Token);
            if (!authority.Open(generation))
                return new(null, PublisherResourceReadOutcome.NeedsReview);
            await NavigateAsync(entry.ResourceUri, linked.Token);
            await observation;
            return authority.Seal(generation);
        }
        finally
        {
            if (Interlocked.CompareExchange(ref pendingResourceCapture, null, capture) == capture)
                capture.Cancel();
        }
    }

    private async Task<PublisherCheckInProof> CaptureCheckInProofAsync(
        PublisherAccountCatalogEntry entry,
        string method,
        DateOnly expectedDate,
        DateTimeOffset expectedInstant,
        bool navigate,
        CancellationToken cancellationToken)
    {
        var capture = BeginCheckInCapture(
            entry.GameId,
            method,
            expectedDate,
            expectedInstant,
            cancellationToken);
        try
        {
            if (navigate) await NavigateAsync(entry.CheckInUri!, cancellationToken);
            return await capture.Completion.Task.WaitAsync(
                TimeSpan.FromSeconds(ResourceCaptureTimeoutSeconds),
                cancellationToken);
        }
        catch (TimeoutException)
        {
            return PublisherCheckInProof.Invalid;
        }
        finally
        {
            if (Interlocked.CompareExchange(ref pendingCheckInCapture, null, capture) == capture)
                capture.Cancel();
        }
    }

    private CheckInCapture BeginCheckInCapture(
        string gameId,
        string method,
        DateOnly expectedDate,
        DateTimeOffset expectedInstant,
        CancellationToken cancellationToken)
    {
        var generation = Interlocked.Increment(ref checkInGeneration);
        var capture = new CheckInCapture(
            gameId,
            method,
            expectedDate,
            expectedInstant,
            generation,
            cancellationToken);
        Interlocked.Exchange(ref pendingCheckInCapture, capture)?.Cancel();
        return capture;
    }

    private SessionProbeCapture BeginSessionProbe(CancellationToken cancellationToken)
    {
        var generation = Interlocked.Increment(ref sessionProbeGeneration);
        var capture = new SessionProbeCapture(generation, cancellationToken);
        Interlocked.Exchange(ref pendingSessionProbe, capture)?.Cancel();
        return capture;
    }

    private static string BuildExactClaimScript(string gameId)
    {
        if (gameId == "ae")
        {
            return """
                (() => {
                  const selectors = [
                    'img[src$="PCCalendarTodayBg.510de0.png"]',
                    'img[src$="MobileCalendarTodayBg.5f4677.png"]'
                  ];
                  const current = selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)));
                  if (current.length !== 1) return 'missing';
                  current[0].click();
                  return 'clicked';
                })()
                """;
        }

        var selector = PublisherAccountCatalog.GetCheckInDomContract(gameId).ReadySelector;
        return $$"""
            (() => {
              const current = document.querySelectorAll({{JsonSerializer.Serialize(selector)}});
              if (current.length !== 1) return 'missing';
              current[0].click();
              return 'clicked';
            })()
            """;
    }

    private async Task NavigateAsync(
        Uri uri,
        CancellationToken cancellationToken,
        Action? navigationRequested = null)
    {
        approvedTopLevelUri = uri;
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        void Completed(CoreWebView2 sender, CoreWebView2NavigationCompletedEventArgs args) => completion.TrySetResult(args.IsSuccess);
        var core = Browser.CoreWebView2;
        if (core is null)
        {
            Browser.Source = uri;
            return;
        }
        core.NavigationCompleted += Completed;
        try
        {
            try { core.Stop(); } catch (Exception) { }
            core.Navigate(uri.AbsoluteUri);
            navigationRequested?.Invoke();
            var success = await completion.Task.WaitAsync(TimeSpan.FromSeconds(20), cancellationToken);
            if (!success) throw new InvalidOperationException("The official page did not load.");
        }
        finally
        {
            core.NavigationCompleted -= Completed;
        }
    }

    private void Core_NavigationStarting(CoreWebView2 sender, CoreWebView2NavigationStartingEventArgs args)
    {
        if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var target)
            || target.Scheme != Uri.UriSchemeHttps
            || !target.IsDefaultPort
            || !string.IsNullOrEmpty(target.UserInfo))
        {
            args.Cancel = true;
            return;
        }

        if (purpose == PublisherSessionPurpose.Connect)
        {
            if (!IsAllowedConnectTopLevel(target)) args.Cancel = true;
            return;
        }

        if (approvedTopLevelUri is null
            || !string.Equals(
                PublisherAccountCatalog.NormalizeTopLevelUri(target),
                PublisherAccountCatalog.NormalizeTopLevelUri(approvedTopLevelUri),
                StringComparison.Ordinal))
            args.Cancel = true;
    }

    private async void Core_WebResourceRequested(
        CoreWebView2 sender,
        CoreWebView2WebResourceRequestedEventArgs args)
    {
        if (purpose == PublisherSessionPurpose.Connect)
        {
            var deferral = args.GetDeferral();
            byte[]? body = null;
            SensitiveRequestBodyStream? replacement = null;
            try
            {
                var requestContent = args.Request.Content;
                var hadContent = requestContent is not null;
                if (requestContent is not null)
                {
                    using var contentStream = requestContent.AsStreamForRead();
                    body = await ReadBoundedAsync(
                        contentStream,
                        PublisherAccountCatalog.MaximumConnectRequestBodyBytes,
                        lifetime.Token);
                }
                var contentType = TryGetRequestHeader(args, "Content-Type");
                if ((hadContent && body is null)
                    || !TryAuthorizeWebResourceRequest(args, body, contentType))
                {
                    if (body is not null) Array.Clear(body);
                    TryBlockWebResourceRequest(sender, args);
                    return;
                }

                if (hadContent)
                {
                    // Reading the intercepted body advances WebView2's stream.
                    // Give the exact bytes back without ever turning credentials
                    // into a string or log entry. The wrapper clears them when the
                    // browser releases the request (or when it is collected).
                    replacement = new SensitiveRequestBodyStream(body!);
                    body = null;
                    args.Request.Content = replacement.AsRandomAccessStream();
                    replacement = null;
                }
            }
            catch
            {
                if (body is not null) Array.Clear(body);
                replacement?.Dispose();
                TryBlockWebResourceRequest(sender, args);
            }
            finally
            {
                try
                {
                    deferral.Complete();
                }
                catch
                {
                    // The WebView can close while a deferred body is being read.
                }
            }
            return;
        }

        if (!TryAuthorizeWebResourceRequest(args, null, null))
            TryBlockWebResourceRequest(sender, args);
    }

    private bool TryAuthorizeWebResourceRequest(
        CoreWebView2WebResourceRequestedEventArgs args,
        ReadOnlyMemory<byte>? requestBody,
        string? contentType)
    {
        var context = MapResourceContext(args.ResourceContext);
        if (!Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out var uri)
            || authorizedGameId is null
            || !PublisherAccountCatalog.IsAllowedWebResourceRequest(
                provider,
                purpose,
                authorizedGameId,
                uri,
                args.Request.Method,
                context,
                claimWriteAuthority,
                requestBody,
                contentType))
            return false;

        var capture = Volatile.Read(ref pendingResourceCapture);
        if (purpose == PublisherSessionPurpose.Resource
            && context is (PublisherWebResourceContext.XmlHttpRequest or PublisherWebResourceContext.Fetch)
            && string.Equals(args.Request.Method, "GET", StringComparison.Ordinal)
            && capture is not null
            && capture.Authority.Generation == Interlocked.Read(ref resourceGeneration)
            && PublisherAccountCatalog.TryGetResourceBinding(
                capture.Authority.GameId,
                uri,
                out var binding)
            && binding is not null)
            return capture.Authority.TryReserve(
                capture.Authority.Generation,
                capture.Authority.GameId,
                binding);
        return true;
    }

    private static string? TryGetRequestHeader(
        CoreWebView2WebResourceRequestedEventArgs args,
        string name)
    {
        try
        {
            return args.Request.Headers.GetHeader(name);
        }
        catch
        {
            // Missing or disposed request headers are denied by the caller.
            return null;
        }
    }

    private static void TryBlockWebResourceRequest(
        CoreWebView2 sender,
        CoreWebView2WebResourceRequestedEventArgs args)
    {
        try
        {
            BlockWebResourceRequest(sender, args);
        }
        catch
        {
            // The WebView can be disposed while a deferred request is in flight.
        }
    }

    private static void BlockWebResourceRequest(
        CoreWebView2 sender,
        CoreWebView2WebResourceRequestedEventArgs args) =>
        args.Response = sender.Environment.CreateWebResourceResponse(
            null,
            403,
            "Blocked by publisher session policy",
            "Content-Type: text/plain; charset=utf-8");

    private static PublisherWebResourceContext MapResourceContext(
        CoreWebView2WebResourceContext context) => context switch
        {
            CoreWebView2WebResourceContext.Document => PublisherWebResourceContext.Document,
            CoreWebView2WebResourceContext.Stylesheet => PublisherWebResourceContext.Stylesheet,
            CoreWebView2WebResourceContext.Image => PublisherWebResourceContext.Image,
            CoreWebView2WebResourceContext.Media => PublisherWebResourceContext.Media,
            CoreWebView2WebResourceContext.Font => PublisherWebResourceContext.Font,
            CoreWebView2WebResourceContext.Script => PublisherWebResourceContext.Script,
            CoreWebView2WebResourceContext.XmlHttpRequest => PublisherWebResourceContext.XmlHttpRequest,
            CoreWebView2WebResourceContext.Fetch => PublisherWebResourceContext.Fetch,
            _ => PublisherWebResourceContext.Other,
        };

    private void Core_WebResourceResponseReceived(
        CoreWebView2 sender,
        CoreWebView2WebResourceResponseReceivedEventArgs args)
    {
        var sessionProbe = Volatile.Read(ref pendingSessionProbe);
        if (sessionProbe is not null
            && sessionProbe.Generation == Interlocked.Read(ref sessionProbeGeneration)
            && Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out var sessionProbeUri)
            && PublisherAccountCatalog.IsExactSkportSessionProbeUri(sessionProbeUri, args.Request.Method)
            && sessionProbe.TryBegin())
        {
            _ = CompleteSessionProbeAsync(args, sessionProbe);
            return;
        }

        var checkInCapture = Volatile.Read(ref pendingCheckInCapture);
        if (checkInCapture is not null
            && checkInCapture.Generation == Interlocked.Read(ref checkInGeneration)
            && string.Equals(args.Request.Method, checkInCapture.Method, StringComparison.Ordinal)
            && Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out var checkInUri)
            && PublisherAccountCatalog.IsExactCheckInResponseUri(
                checkInCapture.GameId,
                checkInUri,
                checkInCapture.Method)
            && checkInCapture.TryBegin())
        {
            _ = CompleteCheckInCaptureAsync(args, checkInCapture);
            return;
        }

        var capture = Volatile.Read(ref pendingResourceCapture);
        if (capture is null
            || capture.Authority.Generation != Interlocked.Read(ref resourceGeneration)
            || !Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out var responseUri)
            || !PublisherAccountCatalog.TryGetResourceBinding(
                capture.Authority.GameId,
                responseUri,
                out var binding)
            || binding is null
            || !capture.Authority.TryBeginResponse(capture.Authority.Generation, binding))
            return;

        _ = CompleteResourceCaptureAsync(args, capture, binding);
    }

    private static async Task CompleteSessionProbeAsync(
        CoreWebView2WebResourceResponseReceivedEventArgs args,
        SessionProbeCapture capture)
    {
        byte[]? body = null;
        try
        {
            var response = args.Response;
            if (response.StatusCode is 401 or 403)
            {
                capture.TryComplete(PublisherAccountCatalog.ClassifySkportSessionResponse(
                    response.StatusCode,
                    response.Headers.GetHeader("Content-Type"),
                    ReadOnlyMemory<byte>.Empty));
                return;
            }
            if (response.StatusCode != 200
                || !HasJsonContentType(response.Headers.GetHeader("Content-Type")))
            {
                capture.TryComplete(PublisherAccountCatalog.ClassifySkportSessionResponse(
                    response.StatusCode,
                    response.Headers.GetHeader("Content-Type"),
                    ReadOnlyMemory<byte>.Empty));
                return;
            }

            using var content = await response.GetContentAsync().AsTask(capture.CancellationToken);
            using var stream = content.AsStreamForRead();
            body = await ReadBoundedAsync(
                stream,
                PublisherAccountCatalog.MaximumResourceResponseBytes,
                capture.CancellationToken);
            capture.TryComplete(body is null
                ? PublisherSessionProof.NeedsReview
                : PublisherAccountCatalog.ClassifySkportSessionResponse(
                    response.StatusCode,
                    response.Headers.GetHeader("Content-Type"),
                    body));
        }
        catch (OperationCanceledException)
        {
            capture.Cancel();
        }
        catch (Exception)
        {
            capture.TryComplete(PublisherSessionProof.NeedsReview);
        }
        finally
        {
            if (body is not null) Array.Clear(body);
        }
    }

    private static async Task CompleteCheckInCaptureAsync(
        CoreWebView2WebResourceResponseReceivedEventArgs args,
        CheckInCapture capture)
    {
        try
        {
            var response = args.Response;
            var contentType = response.Headers.GetHeader("Content-Type");
            if (response.StatusCode != 200
                || !HasJsonContentType(contentType))
            {
                capture.TryComplete(PublisherAccountCatalog.ClassifyCheckInResponse(
                    response.StatusCode,
                    contentType,
                    capture.GameId,
                    capture.Method,
                    ReadOnlyMemory<byte>.Empty,
                    capture.ExpectedDate,
                    capture.ExpectedInstant));
                return;
            }

            using var content = await response.GetContentAsync().AsTask(capture.CancellationToken);
            using var stream = content.AsStreamForRead();
            var body = await ReadBoundedAsync(
                stream,
                PublisherAccountCatalog.MaximumResourceResponseBytes,
                capture.CancellationToken);
            if (body is null)
            {
                capture.TryComplete(PublisherAccountCatalog.ClassifyCheckInResponse(
                    response.StatusCode,
                    contentType,
                    capture.GameId,
                    capture.Method,
                    ReadOnlyMemory<byte>.Empty,
                    capture.ExpectedDate,
                    capture.ExpectedInstant));
                return;
            }
            try
            {
                capture.TryComplete(PublisherAccountCatalog.ClassifyCheckInResponse(
                    response.StatusCode,
                    contentType,
                    capture.GameId,
                    capture.Method,
                    body,
                    capture.ExpectedDate,
                    capture.ExpectedInstant));
            }
            finally
            {
                Array.Clear(body);
            }
        }
        catch (OperationCanceledException)
        {
            capture.Cancel();
        }
        catch (Exception)
        {
            capture.TryComplete(PublisherCheckInProof.Invalid);
        }
    }

    private static async Task CompleteResourceCaptureAsync(
        CoreWebView2WebResourceResponseReceivedEventArgs args,
        PendingResourceCapture capture,
        PublisherRoleBinding binding)
    {
        var authority = capture.Authority;
        var generation = authority.Generation;
        try
        {
            var response = args.Response;
            if (response.StatusCode is 401 or 403)
            {
                authority.CompleteResponse(
                    generation,
                    binding,
                    PublisherResourceProof.LoginNeeded,
                    null);
                return;
            }
            if (response.StatusCode != 200
                || !HasJsonContentType(response.Headers.GetHeader("Content-Type")))
            {
                authority.CompleteResponse(
                    generation,
                    binding,
                    PublisherResourceProof.Invalid,
                    null);
                return;
            }

            using var content = await response.GetContentAsync().AsTask(capture.CancellationToken);
            using var stream = content.AsStreamForRead();
            var body = await ReadBoundedAsync(
                stream,
                PublisherAccountCatalog.MaximumResourceResponseBytes,
                capture.CancellationToken);
            if (body is null)
            {
                authority.CompleteResponse(
                    generation,
                    binding,
                    PublisherResourceProof.Invalid,
                    null);
                return;
            }
            try
            {
                var proof = PublisherAccountCatalog.ParseResourceResponse(
                    authority.GameId,
                    body,
                    DateTimeOffset.UtcNow,
                    out var snapshot);
                authority.CompleteResponse(
                    generation,
                    binding,
                    proof,
                    snapshot);
            }
            finally
            {
                Array.Clear(body);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception)
        {
            authority.CompleteResponse(
                generation,
                binding,
                PublisherResourceProof.Invalid,
                null);
        }
    }

    private static bool HasJsonContentType(string? contentType)
    {
        if (string.IsNullOrWhiteSpace(contentType)) return false;
        var mediaType = contentType.Split(';', 2)[0].Trim();
        return string.Equals(mediaType, "application/json", StringComparison.OrdinalIgnoreCase)
            || mediaType.EndsWith("+json", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<byte[]?> ReadBoundedAsync(
        Stream stream,
        int maximumBytes,
        CancellationToken cancellationToken)
    {
        var buffer = new byte[maximumBytes + 1];
        try
        {
            var length = 0;
            while (length <= maximumBytes)
            {
                var read = await stream.ReadAsync(buffer.AsMemory(length), cancellationToken);
                if (read == 0) return buffer.AsSpan(0, length).ToArray();
                length += read;
            }
            return null;
        }
        finally
        {
            Array.Clear(buffer);
        }
    }

    private void Core_NewWindowRequested(CoreWebView2 sender, CoreWebView2NewWindowRequestedEventArgs args)
    {
        args.Handled = true;
        if (purpose != PublisherSessionPurpose.Connect
            || !Uri.TryCreate(args.Uri, UriKind.Absolute, out var target))
            return;
        if (IsAllowedConnectTopLevel(target))
            sender.Navigate(target.AbsoluteUri);
    }

    private bool IsAllowedConnectTopLevel(Uri target) =>
        authorizedGameId is not null
        && PublisherAccountCatalog.IsAllowedTopLevelNavigation(
            provider,
            PublisherSessionPurpose.Connect,
            authorizedGameId,
            target);

    private static void Core_DownloadStarting(CoreWebView2 sender, CoreWebView2DownloadStartingEventArgs args)
    {
        // Publisher sessions are only for account status and explicit daily
        // claims. They never need to write a site-provided file to the PC.
        args.Cancel = true;
    }

    private static void Core_PermissionRequested(CoreWebView2 sender, CoreWebView2PermissionRequestedEventArgs args)
    {
        // Camera, microphone, location, notifications, and other browser
        // permissions are outside this isolated session's purpose.
        args.State = CoreWebView2PermissionState.Deny;
    }

    private static string? ReadScriptString(string raw)
    {
        try
        {
            using var document = JsonDocument.Parse(raw);
            return document.RootElement.ValueKind is JsonValueKind.String
                ? document.RootElement.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e) => Close();

    public async ValueTask DisposeAsync()
    {
        if (disposed) return;
        disposed = true;
        lifetime.Cancel();
        Interlocked.Increment(ref sessionProbeGeneration);
        Interlocked.Increment(ref checkInGeneration);
        Interlocked.Increment(ref resourceGeneration);
        Interlocked.Exchange(ref pendingSessionProbe, null)?.Cancel();
        Interlocked.Exchange(ref pendingCheckInCapture, null)?.Cancel();
        Interlocked.Exchange(ref pendingResourceCapture, null)?.Cancel();
        var core = Browser.CoreWebView2;
        if (core is not null)
        {
            core.NavigationStarting -= Core_NavigationStarting;
            core.WebResourceRequested -= Core_WebResourceRequested;
            core.WebResourceResponseReceived -= Core_WebResourceResponseReceived;
            core.NewWindowRequested -= Core_NewWindowRequested;
            core.DownloadStarting -= Core_DownloadStarting;
            core.PermissionRequested -= Core_PermissionRequested;
            try { core.Stop(); } catch (Exception) { }
        }
        Exception? teardownFailure = null;
        try
        {
            Browser.Close();
        }
        catch (Exception exception)
        {
            teardownFailure = exception;
        }
        try
        {
            if (!windowClosed) Close();
            await closed.Task;
        }
        catch (Exception exception)
        {
            teardownFailure ??= exception;
        }
        finally
        {
            lifetime.Dispose();
        }
        if (teardownFailure is not null)
            throw new PublisherSessionTeardownException(teardownFailure);
    }

    private sealed class SensitiveRequestBodyStream : MemoryStream
    {
        private byte[]? sensitiveBytes;

        public SensitiveRequestBodyStream(byte[] sensitiveBytes)
            : base(sensitiveBytes, writable: false)
        {
            this.sensitiveBytes = sensitiveBytes;
        }

        ~SensitiveRequestBodyStream() => ClearSensitiveBytes();

        protected override void Dispose(bool disposing)
        {
            ClearSensitiveBytes();
            if (disposing) GC.SuppressFinalize(this);
            base.Dispose(disposing);
        }

        private void ClearSensitiveBytes()
        {
            var bytes = Interlocked.Exchange(ref sensitiveBytes, null);
            if (bytes is not null) Array.Clear(bytes);
        }
    }

    private sealed class PendingResourceCapture(
        PublisherResourceCaptureAuthority authority,
        CancellationToken cancellationToken)
    {
        public PublisherResourceCaptureAuthority Authority { get; } = authority;
        public CancellationToken CancellationToken { get; } = cancellationToken;

        public void Cancel() => Authority.Cancel();
    }

    private sealed class SessionProbeCapture(long generation, CancellationToken cancellationToken)
    {
        private int began;

        public long Generation { get; } = generation;
        public CancellationToken CancellationToken { get; } = cancellationToken;
        public TaskCompletionSource<PublisherSessionProof> Completion { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public bool TryBegin() => Interlocked.CompareExchange(ref began, 1, 0) == 0;

        public void TryComplete(PublisherSessionProof proof) => Completion.TrySetResult(proof);

        public void Cancel() => Completion.TrySetCanceled(CancellationToken);
    }

    private sealed class CheckInCapture(
        string gameId,
        string method,
        DateOnly expectedDate,
        DateTimeOffset expectedInstant,
        long generation,
        CancellationToken cancellationToken)
    {
        private int began;

        public string GameId { get; } = gameId;
        public string Method { get; } = method;
        public DateOnly ExpectedDate { get; } = expectedDate;
        public DateTimeOffset ExpectedInstant { get; } = expectedInstant;
        public long Generation { get; } = generation;
        public CancellationToken CancellationToken { get; } = cancellationToken;
        public TaskCompletionSource<PublisherCheckInProof> Completion { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public bool TryBegin() => Interlocked.CompareExchange(ref began, 1, 0) == 0;

        public void TryComplete(PublisherCheckInProof proof) => Completion.TrySetResult(proof);

        public void Cancel() => Completion.TrySetCanceled(CancellationToken);
    }
}

internal sealed class PublisherSessionTeardownException(Exception innerException) :
    Exception("The isolated publisher browser did not stop cleanly.", innerException);
