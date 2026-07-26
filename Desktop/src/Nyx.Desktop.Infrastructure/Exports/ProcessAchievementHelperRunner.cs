using System.ComponentModel;
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Win32.SafeHandles;
using Nyx.Desktop.Core.Exports;

namespace Nyx.Desktop.Infrastructure.Exports;

public sealed class ProcessAchievementHelperRunner : IVerifiedAchievementHelperRunner
{
    private const string CancelEventPrefix = @"Local\Pengo.Nyx.ExportCancel.v1.";
    private const string ParentMutexPrefix = @"Local\Pengo.Nyx.ExportParent.v1.";
    private const string PipePrefix = "Pengo.Nyx.AchievementIpc.v1.";
    private const int ProofSize = 32;
    private const int MaxStatusLines = 8;
    private const long MaxExportBytes = 8 * 1024 * 1024;
    private static readonly HashSet<string> AllowedErrors =
    [
        "administrator_required", "normal_user_required", "cancel_unavailable",
        "decoder_unavailable", "capture_start_failed", "capture_read_failed",
        "capture_timeout", "capture_safety_limit", "capture_parser_failed",
        "capture_invalid_snapshot", "capture_cleanup_failed", "capture_closed",
        "output_unsafe", "output_exists", "output_write_failed", "internal_error",
    ];

    public ValueTask<IAchievementExportSession> StartAsync(
        AchievementHelperInvocation invocation,
        VerifiedAchievementHelperLaunchBinding helperBinding,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(invocation);
        ArgumentNullException.ThrowIfNull(helperBinding);
        ValidateInvocation(invocation);

        var linkedCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var completion = RunTrackedAsync(invocation, helperBinding, ready, linkedCancellation.Token);
        return ValueTask.FromResult<IAchievementExportSession>(
            new ProcessAchievementExportSession(ready.Task, completion, linkedCancellation));
    }

    private static async Task<ExportArtifactMetadata> RunTrackedAsync(
        AchievementHelperInvocation invocation,
        VerifiedAchievementHelperLaunchBinding helperBinding,
        TaskCompletionSource ready,
        CancellationToken cancellationToken)
    {
        try
        {
            return await RunCoreAsync(invocation, helperBinding, ready, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception exception)
        {
            ready.TrySetException(exception);
            throw;
        }
    }

    private static async Task<ExportArtifactMetadata> RunCoreAsync(
        AchievementHelperInvocation invocation,
        VerifiedAchievementHelperLaunchBinding helperBinding,
        TaskCompletionSource ready,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(invocation.OutputRoot);
        using var cancelEvent = new EventWaitHandle(
            false,
            EventResetMode.ManualReset,
            CancelEventPrefix + invocation.JobId,
            out _);
        using var parentMutex = new Mutex(
            initiallyOwned: true,
            ParentMutexPrefix + invocation.JobId,
            out var createdParentMutex);
        if (!createdParentMutex)
            throw new ExportProviderException("helper-start-failed");

        using var pipe = new NamedPipeServerStream(
            PipePrefix + invocation.JobId,
            PipeDirection.InOut,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly,
            4096,
            4096);
        Process process;
        try
        {
            process = StartBoundHelper(
                invocation,
                helperBinding,
                DotNetAchievementHelperProcessDispatcher.Instance);
        }
        catch (Win32Exception exception) when (exception.NativeErrorCode == 1223)
        {
            throw new ExportProviderException("approval-canceled");
        }
        using (process)
        {
            return await RunStartedProcessAsync(
                invocation,
                ready,
                cancellationToken,
                cancelEvent,
                pipe,
                process).ConfigureAwait(false);
        }
    }

    private static async Task<ExportArtifactMetadata> RunStartedProcessAsync(
        AchievementHelperInvocation invocation,
        TaskCompletionSource ready,
        CancellationToken cancellationToken,
        EventWaitHandle cancelEvent,
        NamedPipeServerStream pipe,
        Process process)
    {
        var proof = RandomNumberGenerator.GetBytes(ProofSize);
        var statuses = new List<HelperStatus>();
        var readStatuses = ReadAuthenticatedStatusesAsync(
            pipe, process.Id, invocation, proof, statuses, ready, cancellationToken);
        using var registration = cancellationToken.Register(static state =>
        {
            try { ((EventWaitHandle)state!).Set(); } catch (ObjectDisposedException) { }
        }, cancelEvent);

        try
        {
            await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            cancelEvent.Set();
            using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            try { await process.WaitForExitAsync(cleanup.Token).ConfigureAwait(false); }
            catch (OperationCanceledException)
            {
                try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            }
            throw;
        }
        await readStatuses.ConfigureAwait(false);

        var final = statuses.LastOrDefault();
        if (final?.State == "cancelled") throw new OperationCanceledException(cancellationToken);
        if (final?.State == "failed") throw new ExportProviderException(final.ErrorCode ?? "provider-failed");
        return ValidateCompletedOutput(invocation, process.ExitCode, final);
    }

    internal static Process StartBoundHelper(
        AchievementHelperInvocation invocation,
        VerifiedAchievementHelperLaunchBinding helperBinding,
        IAchievementHelperProcessDispatcher dispatcher)
    {
        ArgumentNullException.ThrowIfNull(dispatcher);
        var process = new Process { StartInfo = CreateStartInfo(invocation) };
        var started = false;
        try
        {
            EnsureBoundHelper(invocation, helperBinding);
            if (!dispatcher.Start(process))
                throw new ExportProviderException("helper-start-failed");
            started = true;
            EnsureBoundHelper(invocation, helperBinding);
            return process;
        }
        catch
        {
            if (started)
            {
                try { process.Kill(entireProcessTree: true); }
                catch (InvalidOperationException) { }
                catch (Win32Exception) { }
                catch (NotSupportedException) { }
            }
            process.Dispose();
            throw;
        }
    }

    private static ProcessStartInfo CreateStartInfo(AchievementHelperInvocation invocation)
    {
        var elevated = invocation.GameId == "hsr";
        var start = new ProcessStartInfo
        {
            FileName = invocation.HelperPath,
            UseShellExecute = elevated,
            Verb = elevated ? "runas" : string.Empty,
            CreateNoWindow = true,
            RedirectStandardOutput = false,
            RedirectStandardError = false,
            WorkingDirectory = Path.GetDirectoryName(invocation.HelperPath)!,
        };
        foreach (var argument in invocation.Arguments) start.ArgumentList.Add(argument);
        return start;
    }

    internal static void EnsureBoundHelper(
        AchievementHelperInvocation invocation,
        VerifiedAchievementHelperLaunchBinding helperBinding)
    {
        if (!string.Equals(
                Path.GetFullPath(invocation.HelperPath),
                helperBinding.HelperPath,
                StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The fixed achievement helper binding did not match the invocation.");
        helperBinding.EnsurePathStillMatches();
    }

    private static async Task ReadAuthenticatedStatusesAsync(
        NamedPipeServerStream pipe,
        int expectedProcessId,
        AchievementHelperInvocation invocation,
        byte[] proof,
        ICollection<HelperStatus> statuses,
        TaskCompletionSource ready,
        CancellationToken cancellationToken)
    {
        await WaitForExpectedClientAsync(pipe, expectedProcessId, cancellationToken).ConfigureAwait(false);
        await pipe.WriteAsync(proof, cancellationToken).ConfigureAwait(false);
        await pipe.FlushAsync(cancellationToken).ConfigureAwait(false);
        var proofHex = Convert.ToHexString(proof).ToLowerInvariant();
        using var reader = new StreamReader(
            pipe,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true),
            detectEncodingFromByteOrderMarks: false,
            bufferSize: 4096,
            leaveOpen: true);
        var sequence = new StatusSequence(ready);
        for (var count = 0; count < MaxStatusLines; count++)
        {
            var line = await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false);
            if (line is null) break;
            if (line.Length is 0 or > 4096)
                throw new ExportProviderException("helper-protocol-invalid");
            var status = ParseAuthenticatedStatus(line, invocation, proofHex);
            sequence.Accept(status);
            statuses.Add(status);
        }
        if (!sequence.IsTerminal)
            throw new ExportProviderException("helper-protocol-incomplete");
        if (await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false) is not null)
            throw new ExportProviderException("helper-protocol-invalid");
    }

    private static async Task WaitForExpectedClientAsync(
        NamedPipeServerStream pipe,
        int expectedProcessId,
        CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 8; attempt++)
        {
            await pipe.WaitForConnectionAsync(cancellationToken).ConfigureAwait(false);
            if (GetNamedPipeClientProcessId(pipe.SafePipeHandle, out var processId)
                && processId == (uint)expectedProcessId)
                return;
            pipe.Disconnect();
        }
        throw new ExportProviderException("helper-authentication-failed");
    }

    internal static HelperStatus ParseAuthenticatedStatus(
        string line,
        AchievementHelperInvocation invocation,
        string expectedProof)
    {
        HelperStatus? status;
        try { status = JsonSerializer.Deserialize<HelperStatus>(line); }
        catch (JsonException) { throw new ExportProviderException("helper-protocol-invalid"); }
        if (status is null
            || status.SchemaVersion != 1
            || status.JobId != invocation.JobId
            || status.Game != invocation.GameId
            || status.Kind != "achievements"
            || !ProofEquals(status.Proof, expectedProof)
            || (status.ErrorCode is not null && !AllowedErrors.Contains(status.ErrorCode)))
            throw new ExportProviderException("helper-authentication-failed");
        return status;
    }

    private static bool ProofEquals(string? actual, string expected)
    {
        if (actual?.Length != ProofSize * 2 || expected.Length != ProofSize * 2)
            return false;
        try
        {
            return CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(actual),
                Convert.FromHexString(expected));
        }
        catch (FormatException) { return false; }
    }

    internal static ExportArtifactMetadata ValidateCompletedOutput(
        AchievementHelperInvocation invocation,
        int exitCode,
        HelperStatus? final)
    {
        if (exitCode != 0 || final?.State != "exported" || final.ItemCount is null
            || final.ItemCount <= 0 || string.IsNullOrWhiteSpace(final.OutputFile))
            throw new ExportProviderException(exitCode == 0 ? "output-missing" : "provider-failed");

        var gameDirectoryName = AchievementGameDirectory(invocation.GameId);
        var parts = final.OutputFile.Split('/');
        if (parts.Length != 2 || parts[0] != gameDirectoryName || !IsExportFileName(parts[1]))
            throw new ExportProviderException("output-unsafe");
        var gameRoot = Path.GetFullPath(Path.Combine(invocation.OutputRoot, gameDirectoryName));
        var outputFile = Path.GetFullPath(Path.Combine(gameRoot, parts[1]));
        if (!string.Equals(Path.GetDirectoryName(outputFile), gameRoot, StringComparison.OrdinalIgnoreCase))
            throw new ExportProviderException("output-unsafe");

        try
        {
            var info = new FileInfo(outputFile);
            if (!info.Exists || info.Length is <= 0 or > MaxExportBytes
                || (info.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new ExportProviderException("output-invalid");
            using var stream = new FileStream(outputFile, FileMode.Open, FileAccess.Read, FileShare.Read);
            using var document = JsonDocument.Parse(stream, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 8,
            });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw new ExportProviderException("output-invalid");
            var properties = root.EnumerateObject().ToArray();
            var expectedProperty = invocation.GameId + "_achievements";
            if (properties.Length != 1 || properties[0].Name != expectedProperty
                || properties[0].Value.ValueKind != JsonValueKind.Array)
                throw new ExportProviderException("output-invalid");
            var ids = new HashSet<uint>();
            foreach (var item in properties[0].Value.EnumerateArray())
                if (item.ValueKind != JsonValueKind.Number || !item.TryGetUInt32(out var id)
                    || id == 0 || !ids.Add(id))
                    throw new ExportProviderException("output-invalid");
            if (ids.Count != final.ItemCount)
                throw new ExportProviderException("output-invalid");
            return new ExportArtifactMetadata(
                "achievements",
                ids.Count,
                info.Length,
                "nyx-achievements-json",
                info.LastWriteTimeUtc,
                info.FullName);
        }
        catch (ExportProviderException) { throw; }
        catch (JsonException) { throw new ExportProviderException("output-invalid"); }
        catch (IOException) { throw new ExportProviderException("output-invalid"); }
        catch (UnauthorizedAccessException) { throw new ExportProviderException("output-invalid"); }
    }

    private static bool IsExportFileName(string name)
    {
        const string suffix = ".json";
        if (!name.EndsWith(suffix, StringComparison.Ordinal)
            || name.Length <= suffix.Length)
            return false;
        var body = name.AsSpan(0, name.Length - suffix.Length);
        return body.Length == 23
            && DateTimeOffset.TryParseExact(
                body[..16],
                "yyyyMMdd'T'HHmmss'Z'",
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal |
                    System.Globalization.DateTimeStyles.AdjustToUniversal,
                out _)
            && body[..8].ContainsOnlyAsciiDigits()
            && body[8] == 'T'
            && body[9..15].ContainsOnlyAsciiDigits()
            && body[15] == 'Z'
            && body[16] == '-'
            && body[17..].ContainsOnlyAsciiLettersOrDigits();
    }

    private static string AchievementGameDirectory(string gameId) => gameId switch
    {
        "gi" => "Genshin Impact",
        "hsr" => "Honkai Star Rail",
        _ => throw new ExportProviderException("output-unsafe"),
    };

    private static void ValidateInvocation(AchievementHelperInvocation invocation)
    {
        if (invocation.GameId is not ("gi" or "hsr")
            || invocation.JobId.Length != 32
            || invocation.JobId.Any(character => !char.IsAsciiHexDigit(character) || char.IsUpper(character))
            || !string.Equals(Path.GetFileName(invocation.HelperPath), VerifiedAchievementHelperBoundary.ExpectedHelperFileName, StringComparison.OrdinalIgnoreCase)
            || !File.Exists(invocation.HelperPath)
            || !HasExactArguments(invocation))
            throw new InvalidOperationException("The fixed achievement helper is unavailable.");
    }

    private static bool HasExactArguments(AchievementHelperInvocation invocation)
    {
        var common = new[]
        {
            "--launcher", "--game", invocation.GameId, "--kind", "achievements",
            "--job-id", invocation.JobId, "--cancel", "named-event",
            "--parent-watch", "named-mutex", "--ipc", "named-pipe",
        };
        var expected = new List<string>(common);
        if (invocation.Arguments.Contains("--fixed-root", StringComparer.Ordinal))
            expected.AddRange(["--output-root", "fixed", "--fixed-root", invocation.OutputRoot]);
        else
            expected.AddRange(["--output-root", "downloads"]);
        expected.AddRange(["--timeout-seconds", "300"]);
        return invocation.Arguments.SequenceEqual(expected, StringComparer.Ordinal);
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientProcessId(
        SafePipeHandle pipe,
        out uint clientProcessId);

    internal sealed record HelperStatus(
        [property: JsonPropertyName("schemaVersion")] int SchemaVersion,
        [property: JsonPropertyName("jobId")] string JobId,
        [property: JsonPropertyName("game")] string Game,
        [property: JsonPropertyName("kind")] string Kind,
        [property: JsonPropertyName("state")] string State,
        [property: JsonPropertyName("proof")] string? Proof,
        [property: JsonPropertyName("itemCount")] long? ItemCount,
        [property: JsonPropertyName("outputFile")] string? OutputFile,
        [property: JsonPropertyName("errorCode")] string? ErrorCode);

    internal sealed class StatusSequence(TaskCompletionSource ready)
    {
        private string? previous;
        public bool IsTerminal => previous is "exported" or "failed" or "cancelled";

        public void Accept(HelperStatus status)
        {
            var valid = (previous, status.State) switch
            {
                (null, "preparing") => status.ItemCount is null && status.OutputFile is null && status.ErrorCode is null,
                ("preparing", "ready") => status.ItemCount is null && status.OutputFile is null && status.ErrorCode is null,
                ("preparing", "failed") => FailureShape(status),
                ("preparing", "cancelled") => EmptyShape(status),
                ("ready", "waiting_for_game") => EmptyShape(status),
                ("ready", "failed") => FailureShape(status),
                ("ready", "cancelled") => EmptyShape(status),
                ("waiting_for_game", "exported") => status.ItemCount > 0 && status.OutputFile is not null && status.ErrorCode is null,
                ("waiting_for_game", "failed") => FailureShape(status),
                ("waiting_for_game", "cancelled") => EmptyShape(status),
                _ => false,
            };
            if (!valid) throw new ExportProviderException("helper-protocol-invalid");
            previous = status.State;
            if (status.State == "ready") ready.TrySetResult();
        }

        private static bool EmptyShape(HelperStatus status) =>
            status.ItemCount is null && status.OutputFile is null && status.ErrorCode is null;

        private static bool FailureShape(HelperStatus status) =>
            status.ItemCount is null && status.OutputFile is null && status.ErrorCode is not null;
    }

    private sealed class ProcessAchievementExportSession : IAchievementExportSession
    {
        private readonly CancellationTokenSource cancellation;
        private int disposed;

        public ProcessAchievementExportSession(
            Task ready,
            Task<ExportArtifactMetadata> completion,
            CancellationTokenSource cancellation)
        {
            Ready = ready;
            Completion = completion;
            this.cancellation = cancellation;
        }

        public Task Ready { get; }
        public Task<ExportArtifactMetadata> Completion { get; }

        public async ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref disposed, 1) != 0) return;
            cancellation.Cancel();
            try { await Completion.ConfigureAwait(false); }
            catch (Exception) { }
            cancellation.Dispose();
        }
    }
}

internal interface IAchievementHelperProcessDispatcher
{
    bool Start(Process process);
}

internal sealed class DotNetAchievementHelperProcessDispatcher : IAchievementHelperProcessDispatcher
{
    internal static DotNetAchievementHelperProcessDispatcher Instance { get; } = new();

    private DotNetAchievementHelperProcessDispatcher() { }

    public bool Start(Process process) => process.Start();
}

internal static class SpanCharacterExtensions
{
    internal static bool ContainsOnlyAsciiLettersOrDigits(this ReadOnlySpan<char> value)
    {
        foreach (var character in value)
            if (!char.IsAsciiLetterOrDigit(character)) return false;
        return true;
    }

    internal static bool ContainsOnlyAsciiDigits(this ReadOnlySpan<char> value)
    {
        foreach (var character in value)
            if (!char.IsAsciiDigit(character)) return false;
        return true;
    }
}
