using System.Collections.Concurrent;
using System.Collections.ObjectModel;
using System.Text.Json;
using Nyx.Desktop.Core.Features;
using Nyx.Desktop.Core.State;

namespace Nyx.Desktop.Core.Exports;

[Flags]
public enum ExportKind
{
    None = 0,
    Pulls = 1,
    Achievements = 2,
}

public enum ExportProviderStatus
{
    Unsupported,
    Ready,
    Completed,
    Failed,
    Canceled,
}

public sealed record ExportProviderCapability(string GameId, ExportKind SupportedKinds)
{
    public bool Supports(ExportKind kind) => (SupportedKinds & kind) == kind;
}

/// <summary>Capability slots are intentionally explicit: ZZZ and WuWa never invoke an exporter.</summary>
public static class ExportProviderCatalog
{
    private static readonly IReadOnlyDictionary<string, ExportProviderCapability> Slots =
        new ReadOnlyDictionary<string, ExportProviderCapability>(new Dictionary<string, ExportProviderCapability>(StringComparer.Ordinal)
        {
            ["gi"] = new("gi", ExportKind.Pulls | ExportKind.Achievements),
            ["hsr"] = new("hsr", ExportKind.Pulls | ExportKind.Achievements),
            ["zzz"] = new("zzz", ExportKind.None),
            ["wuwa"] = new("wuwa", ExportKind.None),
            ["ae"] = new("ae", ExportKind.None),
        });

    public static IReadOnlyList<ExportProviderCapability> All { get; } = Slots.Values.ToArray();

    public static ExportProviderCapability Get(string gameId) =>
        Slots.TryGetValue(gameId, out var slot)
            ? slot
            : new ExportProviderCapability(gameId, ExportKind.None);

    public static ExportProviderCapability GetEnabled(string gameId, LauncherFeatureFlags flags)
    {
        ArgumentNullException.ThrowIfNull(flags);
        var available = Get(gameId);
        var enabled = gameId switch
        {
            "gi" => (flags.GiPulls ? ExportKind.Pulls : ExportKind.None)
                | (flags.GiAchievements ? ExportKind.Achievements : ExportKind.None),
            "hsr" => (flags.HsrPulls ? ExportKind.Pulls : ExportKind.None)
                | (flags.HsrAchievements ? ExportKind.Achievements : ExportKind.None),
            "zzz" => (flags.ZzzPulls ? ExportKind.Pulls : ExportKind.None)
                | (flags.ZzzAchievements ? ExportKind.Achievements : ExportKind.None),
            "wuwa" => (flags.WuWaPulls ? ExportKind.Pulls : ExportKind.None)
                | (flags.WuWaAchievements ? ExportKind.Achievements : ExportKind.None),
            "ae" => (flags.EndfieldPulls ? ExportKind.Pulls : ExportKind.None)
                | (flags.EndfieldAchievements ? ExportKind.Achievements : ExportKind.None),
            _ => ExportKind.None,
        };
        return available with { SupportedKinds = available.SupportedKinds & enabled };
    }
}

public sealed record ExportArmSnapshot(
    string GameId,
    bool PullsArmed,
    bool AchievementsArmed)
{
    public ExportKind RequestedKinds =>
        (PullsArmed ? ExportKind.Pulls : ExportKind.None)
        | (AchievementsArmed ? ExportKind.Achievements : ExportKind.None);

    public static ExportArmSnapshot From(
        ExportArmingState state,
        string gameId,
        LauncherFeatureFlags featureFlags)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(featureFlags);
        var armed = state.Games.TryGetValue(gameId, out var game)
            ? game
            : new ExportGameArming { PullsArmed = state.IsArmed, AchievementsArmed = state.IsArmed };
        var capability = ExportProviderCatalog.GetEnabled(gameId, featureFlags);
        return new(
            gameId,
            armed.PullsArmed && capability.Supports(ExportKind.Pulls),
            armed.AchievementsArmed && capability.Supports(ExportKind.Achievements));
    }
}

public enum ExportTaskState
{
    NotRequested,
    WaitingForWorld,
    WaitingForHistory,
    Preparing,
    Running,
    Succeeded,
    Failed,
    Canceled,
    Unsupported,
}

public enum ExportJobState
{
    PendingLaunch,
    Running,
    Completed,
    Failed,
    Canceled,
    Unsupported,
}

public sealed record ExportTaskSnapshot(
    ExportTaskState State,
    string? ErrorCode = null,
    ExportArtifactMetadata? Artifact = null);

public sealed record ExportJobSnapshot(
    Guid JobId,
    string GameId,
    ExportJobState State,
    ExportTaskSnapshot Pulls,
    ExportTaskSnapshot Achievements,
    DateTimeOffset StartedAt,
    DateTimeOffset? FinishedAt = null)
{
    public bool IsFinished => State is ExportJobState.Completed or ExportJobState.Failed
        or ExportJobState.Canceled or ExportJobState.Unsupported;
}

public sealed record ExportArtifactMetadata(
    string Kind,
    long ItemCount,
    long ByteCount,
    string Format,
    DateTimeOffset CreatedAt,
    string? OutputPath = null);

public sealed class ExportProviderException : Exception
{
    public ExportProviderException(string code) : base("The export provider could not complete the job.")
    {
        if (string.IsNullOrWhiteSpace(code)) throw new ArgumentException("A safe error code is required.", nameof(code));
        Code = code;
    }

    public string Code { get; }
}

public sealed record ExportLaunchResult(
    bool LaunchAdmitted,
    Guid JobId,
    ExportJobSnapshot Snapshot);

public interface IExportSignalWaiter
{
    ValueTask WaitForHistoryAsync(string gameId, CancellationToken cancellationToken);
    ValueTask WaitForWorldReadyAsync(string gameId, CancellationToken cancellationToken);
}

public sealed class ImmediateExportSignalWaiter : IExportSignalWaiter
{
    public ValueTask WaitForHistoryAsync(string gameId, CancellationToken cancellationToken) => ValueTask.CompletedTask;
    public ValueTask WaitForWorldReadyAsync(string gameId, CancellationToken cancellationToken) => ValueTask.CompletedTask;
}

/// <summary>
/// User confirmations are one-shot and release only work that is already waiting.
/// A click can never arm a later export or start provider work by itself.
/// </summary>
public sealed class UserConfirmedExportSignalWaiter : IExportSignalWaiter
{
    private readonly ConcurrentDictionary<(string GameId, ExportSignalKind Kind), SignalGate> gates = new();

    public ValueTask WaitForHistoryAsync(string gameId, CancellationToken cancellationToken) =>
        GetGate(gameId, ExportSignalKind.History).WaitAsync(cancellationToken);

    public ValueTask WaitForWorldReadyAsync(string gameId, CancellationToken cancellationToken) =>
        GetGate(gameId, ExportSignalKind.World).WaitAsync(cancellationToken);

    public bool ConfirmHistory(string gameId) => GetGate(gameId, ExportSignalKind.History).TrySignal();

    public bool ConfirmWorldReady(string gameId) => GetGate(gameId, ExportSignalKind.World).TrySignal();

    private SignalGate GetGate(string gameId, ExportSignalKind kind)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(gameId);
        return gates.GetOrAdd((gameId, kind), static _ => new SignalGate());
    }

    private enum ExportSignalKind { World, History }

    private sealed class SignalGate
    {
        private readonly object sync = new();
        private readonly LinkedList<Waiter> waiters = new();

        public async ValueTask WaitAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var waiter = new Waiter(cancellationToken);
            lock (sync) waiter.Node = waiters.AddLast(waiter);
            using var registration = cancellationToken.Register(static state =>
            {
                var (gate, pending) = ((SignalGate Gate, Waiter Waiter))state!;
                gate.Cancel(pending);
            }, (this, waiter));
            await waiter.Completion.Task.ConfigureAwait(false);
        }

        public bool TrySignal()
        {
            lock (sync)
            {
                while (waiters.First is { } node)
                {
                    waiters.RemoveFirst();
                    node.Value.Node = null;
                    if (node.Value.Completion.TrySetResult()) return true;
                }
            }
            return false;
        }

        private void Cancel(Waiter waiter)
        {
            lock (sync)
            {
                if (waiter.Node?.List == waiters) waiters.Remove(waiter.Node);
                waiter.Node = null;
            }
            waiter.Completion.TrySetCanceled(waiter.CancellationToken);
        }

        private sealed class Waiter(CancellationToken cancellationToken)
        {
            public CancellationToken CancellationToken { get; } = cancellationToken;
            public TaskCompletionSource Completion { get; } =
                new(TaskCreationOptions.RunContinuationsAsynchronously);
            public LinkedListNode<Waiter>? Node { get; set; }
        }
    }
}

public interface IPullExportProvider
{
    ValueTask<ExportArtifactMetadata> SnapshotAsync(
        string gameId,
        IExportSignalWaiter signals,
        CancellationToken cancellationToken);
}

public interface IAchievementExportProvider
{
    ValueTask<IAchievementExportSession> StartAsync(
        string gameId,
        string? outputPath,
        IExportSignalWaiter signals,
        CancellationToken cancellationToken);
}

public interface IAchievementExportSession : IAsyncDisposable
{
    Task Ready { get; }
    Task<ExportArtifactMetadata> Completion { get; }
}

public sealed record ExportStatusEvent(
    Guid JobId,
    string GameId,
    string Kind,
    string State,
    string? ErrorCode,
    DateTimeOffset At)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    public string ToNdjson() => JsonSerializer.Serialize(this, JsonOptions);
}

public interface IExportStatusSink
{
    ValueTask PublishAsync(ExportStatusEvent status, CancellationToken cancellationToken);
}

public sealed class NullExportStatusSink : IExportStatusSink
{
    public ValueTask PublishAsync(ExportStatusEvent status, CancellationToken cancellationToken) => ValueTask.CompletedTask;
}

public static class ExportErrorSanitizer
{
    public static string Code(Exception exception) => exception switch
    {
        ExportProviderException provider => provider.Code,
        PullExportException pulls => pulls.ErrorCode,
        OperationCanceledException => "canceled",
        TimeoutException => "timed-out",
        UnauthorizedAccessException => "access-denied",
        IOException => "io-failed",
        _ => "provider-failed",
    };
}

/// <summary>
/// Coordinates export work independently from launch. A provider failure only fails its own task;
/// no exception text, path, argument, or secret is included in a status event.
/// </summary>
public sealed class ExportCoordinator : IAsyncDisposable
{
    private readonly IPullExportProvider pulls;
    private readonly IAchievementExportProvider achievements;
    private readonly IExportSignalWaiter signals;
    private readonly IExportStatusSink statusSink;
    private readonly TimeSpan achievementPrepareTimeout;
    private readonly ConcurrentDictionary<Guid, JobEntry> jobs = new();
    private int closed;

    public ExportCoordinator(
        IPullExportProvider pulls,
        IAchievementExportProvider achievements,
        IExportSignalWaiter? signals = null,
        IExportStatusSink? statusSink = null,
        TimeSpan? achievementPrepareTimeout = null)
    {
        this.pulls = pulls ?? throw new ArgumentNullException(nameof(pulls));
        this.achievements = achievements ?? throw new ArgumentNullException(nameof(achievements));
        this.signals = signals ?? new ImmediateExportSignalWaiter();
        this.statusSink = statusSink ?? new NullExportStatusSink();
        this.achievementPrepareTimeout = achievementPrepareTimeout ?? TimeSpan.FromSeconds(20);
        if (this.achievementPrepareTimeout <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(achievementPrepareTimeout));
    }

    public ExportJobSnapshot GetSnapshot(Guid jobId) => jobs.TryGetValue(jobId, out var entry)
        ? entry.Snapshot
        : throw new KeyNotFoundException("Unknown export job.");

    public async ValueTask<ExportLaunchResult> RunForLaunchAsync(
        ExportArmSnapshot arm,
        Func<CancellationToken, ValueTask<bool>> launchAdmission,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(arm);
        ArgumentNullException.ThrowIfNull(launchAdmission);
        var capability = ExportProviderCatalog.Get(arm.GameId);
        var requested = arm.RequestedKinds & capability.SupportedKinds;
        var unsupported = arm.RequestedKinds & ~capability.SupportedKinds;
        var entry = new JobEntry(Guid.NewGuid(), arm.GameId, arm, requested, unsupported);
        jobs[entry.Snapshot.JobId] = entry;
        await PublishAsync(entry, "job", ExportJobState.PendingLaunch.ToString(), null, cancellationToken).ConfigureAwait(false);

        // Achievement preparation is a bounded preflight. It is deliberately
        // independent from pulls, and its failure/timeout never vetoes launch.
        IAchievementExportSession? achievementSession = null;
        if ((requested & ExportKind.Achievements) != 0)
        {
            entry.BeginWorkers();
            entry.SetAchievements(ExportTaskState.Preparing);
            await PublishAsync(entry, "achievements", ExportTaskState.Preparing.ToString(), null, CancellationToken.None).ConfigureAwait(false);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(entry.Token, cancellationToken);
            timeout.CancelAfter(achievementPrepareTimeout);
            try
            {
                achievementSession = await achievements.StartAsync(
                    entry.GameId,
                    null,
                    signals,
                    entry.Token).ConfigureAwait(false);
                await achievementSession.Ready.WaitAsync(timeout.Token).ConfigureAwait(false);
                entry.SetAchievements(ExportTaskState.Running);
                await PublishAsync(entry, "achievements", ExportTaskState.Running.ToString(), null, CancellationToken.None).ConfigureAwait(false);
            }
            catch (Exception exception)
            {
                if (achievementSession is not null) await achievementSession.DisposeAsync().ConfigureAwait(false);
                achievementSession = null;
                var code = timeout.IsCancellationRequested && !entry.Token.IsCancellationRequested && !cancellationToken.IsCancellationRequested
                    ? "timed-out"
                    : ExportErrorSanitizer.Code(exception);
                entry.SetAchievements(code == "canceled" ? ExportTaskState.Canceled : ExportTaskState.Failed, errorCode: code);
                entry.TryComplete();
                await PublishAsync(entry, "achievements", entry.Snapshot.Achievements.State.ToString(), code, CancellationToken.None).ConfigureAwait(false);
            }
        }

        bool admitted;
        try { admitted = !cancellationToken.IsCancellationRequested
                && !entry.Token.IsCancellationRequested
                && Volatile.Read(ref closed) == 0
                && await launchAdmission(cancellationToken).ConfigureAwait(false); }
        catch (OperationCanceledException) { admitted = false; }
        catch (Exception) { admitted = false; }
        if (!admitted)
        {
            if (achievementSession is not null) await achievementSession.DisposeAsync().ConfigureAwait(false);
            entry.Cancel(forceComplete: true);
            await PublishAsync(entry, "job", ExportJobState.Canceled.ToString(), "launch-not-admitted", CancellationToken.None).ConfigureAwait(false);
            return new(false, entry.Snapshot.JobId, entry.Snapshot);
        }

        entry.MarkRunning();
        entry.SetLaunchSettled(true);
        if (achievementSession is not null)
            _ = Task.Run(() => CompleteAchievementsAsync(entry, achievementSession));
        if (requested == ExportKind.None)
        {
            entry.Finish(unsupported != ExportKind.None ? ExportJobState.Unsupported : ExportJobState.Completed);
            await PublishAsync(entry, "job", entry.Snapshot.State.ToString(), null, CancellationToken.None).ConfigureAwait(false);
            return new(true, entry.Snapshot.JobId, entry.Snapshot);
        }

        if ((requested & ExportKind.Pulls) != 0)
        {
            entry.BeginWorkers();
            _ = Task.Run(() => RunPullsAsync(entry));
        }
        return new(true, entry.Snapshot.JobId, entry.Snapshot);
    }

    public bool Cancel(Guid jobId)
    {
        if (!jobs.TryGetValue(jobId, out var entry) || entry.Snapshot.IsFinished) return false;
        entry.Cancel();
        return true;
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref closed, 1) != 0) return;
        foreach (var entry in jobs.Values.Where(static entry => !entry.Snapshot.IsFinished)) entry.Cancel();
        var pending = jobs.Values.Select(static entry => entry.Completion).ToArray();
        if (pending.Length != 0) await Task.WhenAll(pending).ConfigureAwait(false);
    }

    private async Task RunPullsAsync(JobEntry entry)
    {
        entry.SetPulls(ExportTaskState.WaitingForHistory);
        await PublishAsync(entry, "pulls", ExportTaskState.WaitingForHistory.ToString(), null, CancellationToken.None).ConfigureAwait(false);
        try
        {
            await signals.WaitForHistoryAsync(entry.GameId, entry.Token).ConfigureAwait(false);
            entry.SetPulls(ExportTaskState.Running);
            await PublishAsync(entry, "pulls", ExportTaskState.Running.ToString(), null, CancellationToken.None).ConfigureAwait(false);
            var artifact = await pulls.SnapshotAsync(entry.GameId, signals, entry.Token).ConfigureAwait(false);
            entry.SetPulls(ExportTaskState.Succeeded, artifact);
            await PublishAsync(entry, "pulls", ExportTaskState.Succeeded.ToString(), null, CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception exception)
        {
            var code = ExportErrorSanitizer.Code(exception);
            entry.SetPulls(code == "canceled" ? ExportTaskState.Canceled : ExportTaskState.Failed, errorCode: code);
            await PublishAsync(entry, "pulls", entry.Snapshot.Pulls.State.ToString(), code, CancellationToken.None).ConfigureAwait(false);
        }
        finally { entry.TryComplete(); }
    }

    private async Task CompleteAchievementsAsync(JobEntry entry, IAchievementExportSession session)
    {
        try
        {
            entry.SetAchievements(ExportTaskState.WaitingForWorld);
            await PublishAsync(entry, "achievements", ExportTaskState.WaitingForWorld.ToString(), null, CancellationToken.None).ConfigureAwait(false);
            await signals.WaitForWorldReadyAsync(entry.GameId, entry.Token).ConfigureAwait(false);
            entry.SetAchievements(ExportTaskState.Running);
            await PublishAsync(entry, "achievements", ExportTaskState.Running.ToString(), null, CancellationToken.None).ConfigureAwait(false);
            var artifact = await session.Completion.ConfigureAwait(false);
            entry.SetAchievements(ExportTaskState.Succeeded, artifact);
            await PublishAsync(entry, "achievements", ExportTaskState.Succeeded.ToString(), null, CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception exception)
        {
            var code = ExportErrorSanitizer.Code(exception);
            entry.SetAchievements(code == "canceled" ? ExportTaskState.Canceled : ExportTaskState.Failed, errorCode: code);
            await PublishAsync(entry, "achievements", entry.Snapshot.Achievements.State.ToString(), code, CancellationToken.None).ConfigureAwait(false);
        }
        finally
        {
            await session.DisposeAsync().ConfigureAwait(false);
            entry.TryComplete();
        }
    }

    private async ValueTask PublishAsync(JobEntry entry, string kind, string state, string? error, CancellationToken cancellationToken)
    {
        try
        {
            await statusSink.PublishAsync(new ExportStatusEvent(entry.Snapshot.JobId, entry.GameId, kind, state, error, DateTimeOffset.UtcNow), cancellationToken).ConfigureAwait(false);
        }
        catch (Exception) { /* status reporting cannot affect launch/export */ }
    }

    private sealed class JobEntry
    {
        private readonly object sync = new();
        private readonly CancellationTokenSource cancellation = new();
        private int remaining;
        private ExportJobSnapshot snapshot;

        public JobEntry(Guid id, string gameId, ExportArmSnapshot arm, ExportKind requested, ExportKind unsupported)
        {
            GameId = gameId; Arm = arm; remaining = BitCount(requested);
            var unsupportedState = unsupported != ExportKind.None ? ExportTaskState.Unsupported : ExportTaskState.NotRequested;
            snapshot = new(id, gameId, ExportJobState.PendingLaunch,
                requested.HasFlag(ExportKind.Pulls) ? new(ExportTaskState.NotRequested) : new(unsupportedState),
                requested.HasFlag(ExportKind.Achievements) ? new(ExportTaskState.NotRequested) : new(unsupportedState), DateTimeOffset.UtcNow);
        }

        public string GameId { get; }
        public ExportArmSnapshot Arm { get; }
        public CancellationToken Token => cancellation.Token;
        public Task Completion => completion.Task;
        private readonly TaskCompletionSource completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public ExportJobSnapshot Snapshot { get { lock (sync) return snapshot; } }
        public void MarkRunning() { lock (sync) snapshot = snapshot with { State = ExportJobState.Running }; }
        private bool workersStarted;
        public void BeginWorkers() { lock (sync) workersStarted = true; }
        private bool launchSettled;
        public void SetLaunchSettled(bool admitted)
        {
            lock (sync) launchSettled = true;
            if (!admitted) Finish(ExportJobState.Canceled);
            else TryFinishIfReady();
        }
        public void Cancel(bool forceComplete = false)
        {
            cancellation.Cancel();
            lock (sync) snapshot = snapshot with { State = ExportJobState.Canceled, FinishedAt = DateTimeOffset.UtcNow };
            lock (sync) if (forceComplete || !workersStarted) completion.TrySetResult();
        }
        public void Finish(ExportJobState state) { lock (sync) snapshot = snapshot with { State = state, FinishedAt = DateTimeOffset.UtcNow }; completion.TrySetResult(); }
        public void SetPulls(ExportTaskState state, ExportArtifactMetadata? artifact = null, string? errorCode = null) { lock (sync) snapshot = snapshot with { Pulls = new(state, errorCode, artifact) }; }
        public void SetAchievements(ExportTaskState state, ExportArtifactMetadata? artifact = null, string? errorCode = null) { lock (sync) snapshot = snapshot with { Achievements = new(state, errorCode, artifact) }; }
        public void TryComplete()
        {
            if (Interlocked.Decrement(ref remaining) != 0) return;
            TryFinishIfReady();
        }
        private void TryFinishIfReady()
        {
            lock (sync) if (!launchSettled || remaining != 0) return;
            var pullsFailed = Snapshot.Pulls.State is ExportTaskState.Failed or ExportTaskState.Canceled;
            var achievementsFailed = Snapshot.Achievements.State is ExportTaskState.Failed or ExportTaskState.Canceled;
            Finish(cancellation.IsCancellationRequested ? ExportJobState.Canceled : pullsFailed || achievementsFailed ? ExportJobState.Failed : ExportJobState.Completed);
        }
        private static int BitCount(ExportKind kind) => (kind.HasFlag(ExportKind.Pulls) ? 1 : 0) + (kind.HasFlag(ExportKind.Achievements) ? 1 : 0);
    }
}
