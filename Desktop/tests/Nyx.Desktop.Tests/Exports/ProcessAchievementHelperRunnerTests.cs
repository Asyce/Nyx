using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Nyx.Desktop.Core.Exports;
using Nyx.Desktop.Infrastructure.Exports;

namespace Nyx.Desktop.Tests.Exports;

public sealed class ProcessAchievementHelperRunnerTests
{
    private const string JobId = "0123456789abcdef0123456789abcdef";
    private const string Proof = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

    [Fact]
    public void Readiness_is_not_published_until_authenticated_ready_state()
    {
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var sequence = new ProcessAchievementHelperRunner.StatusSequence(ready);
        sequence.Accept(Status("preparing"));
        Assert.False(ready.Task.IsCompleted);

        sequence.Accept(Status("ready"));
        Assert.True(ready.Task.IsCompletedSuccessfully);
        sequence.Accept(Status("waiting_for_game"));
        sequence.Accept(Status("exported", itemCount: 2, outputFile: "hsr/pengo-achievements-20260717T120000Z-abc123.json"));
        Assert.True(sequence.IsTerminal);
    }

    [Fact]
    public void Wrong_job_or_proof_cannot_authenticate_ipc()
    {
        var invocation = Invocation(Path.GetTempPath());
        var wrongJob = JsonSerializer.Serialize(Status("preparing") with { JobId = new string('a', 32) });
        var wrongProof = JsonSerializer.Serialize(Status("preparing") with { Proof = new string('f', 64) });

        Assert.Equal(
            "helper-authentication-failed",
            Assert.Throws<ExportProviderException>(() =>
                ProcessAchievementHelperRunner.ParseAuthenticatedStatus(wrongJob, invocation, Proof)).Code);
        Assert.Equal(
            "helper-authentication-failed",
            Assert.Throws<ExportProviderException>(() =>
                ProcessAchievementHelperRunner.ParseAuthenticatedStatus(wrongProof, invocation, Proof)).Code);
    }

    [Fact]
    public void Nonzero_exit_cannot_promote_an_unrelated_json_to_success()
    {
        using var temp = new TemporaryDirectory();
        var gameRoot = temp.Combine("hsr");
        Directory.CreateDirectory(gameRoot);
        File.WriteAllText(Path.Combine(gameRoot, "unrelated.json"), "{\"hsr_achievements\":[1]}");

        var error = Assert.Throws<ExportProviderException>(() =>
            ProcessAchievementHelperRunner.ValidateCompletedOutput(Invocation(temp.Path), 1, null));

        Assert.Equal("provider-failed", error.Code);
    }

    [Theory]
    [InlineData("{\"achievements\":[1,2]}")]
    [InlineData("{\"hsr_achievements\":[1,1]}")]
    [InlineData("{\"hsr_achievements\":[\"1\"]}")]
    [InlineData("{\"hsr_achievements\":[1],\"extra\":[]}")]
    [InlineData("not-json")]
    public void Malformed_or_wrong_shape_export_fails_closed(string json)
    {
        using var temp = new TemporaryDirectory();
        var gameRoot = temp.Combine("hsr");
        Directory.CreateDirectory(gameRoot);
        const string fileName = "pengo-achievements-20260717T120000Z-abc123.json";
        File.WriteAllText(Path.Combine(gameRoot, fileName), json);
        var final = Status("exported", itemCount: 2, outputFile: "hsr/" + fileName);

        var error = Assert.Throws<ExportProviderException>(() =>
            ProcessAchievementHelperRunner.ValidateCompletedOutput(Invocation(temp.Path), 0, final));

        Assert.Equal("output-invalid", error.Code);
    }

    [Fact]
    public void Exact_authenticated_result_and_shape_are_required_for_success()
    {
        using var temp = new TemporaryDirectory();
        var gameRoot = temp.Combine("hsr");
        Directory.CreateDirectory(gameRoot);
        const string fileName = "pengo-achievements-20260717T120000Z-abc123.json";
        File.WriteAllText(Path.Combine(gameRoot, fileName), "{\"hsr_achievements\":[10,20]}");

        var artifact = ProcessAchievementHelperRunner.ValidateCompletedOutput(
            Invocation(temp.Path),
            0,
            Status("exported", itemCount: 2, outputFile: "hsr/" + fileName));

        Assert.Equal(2, artifact.ItemCount);
        Assert.Equal(Path.Combine(gameRoot, fileName), artifact.OutputPath);
    }

    [Fact]
    public void Cancelled_terminal_state_never_claims_readiness()
    {
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var sequence = new ProcessAchievementHelperRunner.StatusSequence(ready);
        sequence.Accept(Status("preparing"));
        sequence.Accept(Status("cancelled"));

        Assert.True(sequence.IsTerminal);
        Assert.False(ready.Task.IsCompleted);
    }

    [Theory]
    [InlineData("gi", false)]
    [InlineData("hsr", true)]
    public void Verified_launch_blocks_ancestor_and_leaf_substitution_for_normal_and_runas(
        string gameId,
        bool elevated)
    {
        using var temp = new TemporaryDirectory();
        var package = temp.Combine("Package");
        var helperPath = Path.Combine(
            package,
            VerifiedAchievementHelperBoundary.ExpectedHelperFileName);
        var attackerPackage = temp.Combine("AttackerPackage");
        var attackerHelper = Path.Combine(
            attackerPackage,
            VerifiedAchievementHelperBoundary.ExpectedHelperFileName);
        Directory.CreateDirectory(package);
        Directory.CreateDirectory(attackerPackage);
        File.WriteAllText(helperPath, "reviewed-helper");
        File.WriteAllText(attackerHelper, "attacker-helper");
        var expectedHash = SHA256.HashData(File.ReadAllBytes(helperPath));
        using var binding = VerifiedAchievementHelperLaunchBinding.OpenAndVerify(
            helperPath,
            expectedHash);
        var invocation = Invocation(temp.Path, helperPath, gameId);
        var dispatcher = new SwappingDispatcher(package, helperPath, attackerPackage, attackerHelper);

        var error = Assert.Throws<ExportProviderException>(() =>
            ProcessAchievementHelperRunner.StartBoundHelper(invocation, binding, dispatcher));

        Assert.Equal("helper-start-failed", error.Code);
        Assert.Equal(elevated, dispatcher.StartInfo!.UseShellExecute);
        Assert.Equal(elevated ? "runas" : string.Empty, dispatcher.StartInfo.Verb);
        Assert.Equal("reviewed-helper", File.ReadAllText(helperPath));
        ProcessAchievementHelperRunner.EnsureBoundHelper(invocation, binding);
    }

    private static AchievementHelperInvocation Invocation(string outputRoot) => new(
        Path.Combine(outputRoot, VerifiedAchievementHelperBoundary.ExpectedHelperFileName),
        [],
        "hsr",
        JobId,
        outputRoot);

    private static AchievementHelperInvocation Invocation(
        string outputRoot,
        string helperPath,
        string gameId) => new(
        helperPath,
        [],
        gameId,
        JobId,
        outputRoot);

    private static ProcessAchievementHelperRunner.HelperStatus Status(
        string state,
        long? itemCount = null,
        string? outputFile = null,
        string? errorCode = null) => new(
            1,
            JobId,
            "hsr",
            "achievements",
            state,
            Proof,
            itemCount,
            outputFile,
            errorCode);

    private sealed class TemporaryDirectory : IDisposable
    {
        public TemporaryDirectory()
        {
            Path = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(),
                "nyx-achievement-runner-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }
        public string Combine(string value) => System.IO.Path.Combine(Path, value);

        public void Dispose()
        {
            if (Directory.Exists(Path)) Directory.Delete(Path, recursive: true);
        }
    }

    private sealed class SwappingDispatcher(
        string package,
        string helperPath,
        string attackerPackage,
        string attackerHelper) : IAchievementHelperProcessDispatcher
    {
        public ProcessStartInfo? StartInfo { get; private set; }

        public bool Start(Process process)
        {
            StartInfo = process.StartInfo;
            AssertDenied(() => Directory.Move(package, package + ".moved"));
            AssertDenied(() => File.Move(helperPath, helperPath + ".moved"));
            AssertDenied(() => File.Move(attackerHelper, helperPath, overwrite: true));
            AssertDenied(() => Directory.Move(attackerPackage, package));
            return false;
        }

        private static void AssertDenied(Action swap)
        {
            var exception = Record.Exception(swap);
            Assert.True(
                exception is IOException or UnauthorizedAccessException,
                $"Expected the bound path swap to be denied, but got {exception?.GetType().Name ?? "no exception"}.");
        }
    }
}
