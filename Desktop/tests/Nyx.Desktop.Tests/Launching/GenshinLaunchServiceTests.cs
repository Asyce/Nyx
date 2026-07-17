using Nyx.Desktop.Core.Genshin;
using Nyx.Desktop.Core.Launching;

namespace Nyx.Desktop.Tests.Launching;

public sealed class GenshinLaunchServiceTests
{
    private const string GameRoot = @"C:\Games\Genshin Impact Game";
    private const string UpdaterRoot = @"C:\FakePublisher\HoYoPlay";

    [Fact]
    public void Ready_game_check_exposes_only_the_exact_safe_start_specification()
    {
        var fixture = new LaunchFixture();

        var result = fixture.Service.CheckGame(GameRoot);

        Assert.Equal(GenshinLaunchStatus.Ready, result.Status);
        Assert.Equal(GenshinLaunchFailureReason.None, result.FailureReason);
        Assert.Equal(Path.Combine(GameRoot, "GenshinImpact.exe"), result.Specification!.FileName);
        Assert.Equal(GameRoot, result.Specification.WorkingDirectory);
        Assert.Empty(result.Specification.Arguments);
        Assert.False(result.Specification.UseShellExecute);
        Assert.Equal(("GenshinImpact", Path.Combine(GameRoot, "GenshinImpact.exe")), fixture.ProcessInspector.Checks.Single());
        Assert.Empty(fixture.Starter.Starts);
    }

    [Fact]
    public void Launch_game_revalidates_and_starts_once_with_the_exact_specification()
    {
        var fixture = new LaunchFixture();

        var result = fixture.Service.LaunchGame(GameRoot);

        Assert.Equal(GenshinLaunchStatus.Running, result.Status);
        var start = Assert.Single(fixture.Starter.Starts);
        Assert.Equal(Path.Combine(GameRoot, "GenshinImpact.exe"), start.FileName);
        Assert.Equal(GameRoot, start.WorkingDirectory);
        Assert.Empty(start.Arguments);
        Assert.False(start.UseShellExecute);
        Assert.Equal([GameRoot], fixture.Validator.GameRoots);
        Assert.Empty(fixture.Starter.ElevatedStarts);
    }

    [Fact]
    public void Launch_updater_uses_its_independently_validated_root_and_exact_launcher()
    {
        var fixture = new LaunchFixture();

        var result = fixture.Service.LaunchUpdater(UpdaterRoot);

        Assert.Equal(GenshinLaunchStatus.Running, result.Status);
        var start = Assert.Single(fixture.Starter.Starts);
        Assert.Equal(Path.Combine(UpdaterRoot, "launcher.exe"), start.FileName);
        Assert.Equal(UpdaterRoot, start.WorkingDirectory);
        Assert.Empty(start.Arguments);
        Assert.False(start.UseShellExecute);
        Assert.Equal([UpdaterRoot], fixture.Validator.UpdaterRoots);
        Assert.Empty(fixture.Validator.GameRoots);
        Assert.Empty(fixture.Starter.ElevatedStarts);
    }

    [Theory]
    [InlineData(GenshinInspectionReason.LaunchTargetMissing)]
    [InlineData(GenshinInspectionReason.ReparsePointFound)]
    [InlineData(GenshinInspectionReason.SignatureInvalid)]
    public void Missing_linked_or_invalid_target_needs_review_and_never_starts(GenshinInspectionReason reason)
    {
        var fixture = new LaunchFixture
        {
            GameResult = Review(reason),
        };

        var result = fixture.Service.LaunchGame(GameRoot);

        Assert.Equal(GenshinLaunchStatus.NeedsReview, result.Status);
        Assert.Equal(reason, result.InspectionReason);
        Assert.Empty(fixture.Starter.Starts);
        Assert.Empty(fixture.ProcessInspector.Checks);
    }

    [Fact]
    public void Target_that_changes_after_ready_check_is_rejected_by_launch_revalidation()
    {
        var validator = new SequencedValidator(
            Ready(GameRoot),
            Review(GenshinInspectionReason.LaunchTargetMissing));
        var inspector = new FakeProcessInspector();
        var starter = new FakeStarter();
        var service = new GenshinLaunchService(validator, inspector, starter);

        Assert.Equal(GenshinLaunchStatus.Ready, service.CheckGame(GameRoot).Status);
        var result = service.LaunchGame(GameRoot);

        Assert.Equal(GenshinLaunchStatus.NeedsReview, result.Status);
        Assert.Empty(starter.Starts);
        Assert.Single(inspector.Checks);
    }

    [Fact]
    public void Validator_cannot_redirect_a_launch_to_a_different_root()
    {
        var fixture = new LaunchFixture
        {
            GameResult = Ready(@"C:\Other\Genshin Impact Game"),
        };

        var result = fixture.Service.LaunchGame(GameRoot);

        Assert.Equal(GenshinLaunchStatus.NeedsReview, result.Status);
        Assert.Empty(fixture.ProcessInspector.Checks);
        Assert.Empty(fixture.Starter.Starts);
    }

    [Fact]
    public void Already_running_exact_game_path_does_not_start_a_second_process()
    {
        var fixture = new LaunchFixture
        {
            RunningStatus = RunningProcessStatus.Running,
        };

        var result = fixture.Service.LaunchGame(GameRoot);

        Assert.Equal(GenshinLaunchStatus.Running, result.Status);
        Assert.Empty(fixture.Starter.Starts);
        Assert.Empty(fixture.Starter.ElevatedStarts);
    }

    [Fact]
    public void Same_named_process_with_unknown_path_needs_review_and_does_not_start()
    {
        var fixture = new LaunchFixture
        {
            RunningStatus = RunningProcessStatus.Uncertain,
        };

        var result = fixture.Service.LaunchGame(GameRoot);

        Assert.Equal(GenshinLaunchStatus.NeedsReview, result.Status);
        Assert.Empty(fixture.Starter.Starts);
    }

    [Fact]
    public void Start_failure_is_reported_without_a_fallback_or_second_attempt()
    {
        var fixture = new LaunchFixture
        {
            StandardStartException = new InvalidOperationException("fake failure"),
        };

        var result = fixture.Service.LaunchGame(GameRoot);

        Assert.Equal(GenshinLaunchStatus.LaunchFailed, result.Status);
        Assert.Equal(GenshinLaunchFailureReason.WindowsStartFailed, result.FailureReason);
        Assert.Single(fixture.Starter.Starts);
        Assert.Empty(fixture.Starter.ElevatedStarts);
    }

    [Fact]
    public void Windows_error_740_revalidates_then_makes_one_exact_elevated_game_attempt()
    {
        var fixture = new LaunchFixture
        {
            StandardStartException = new System.ComponentModel.Win32Exception(740),
        };

        var result = fixture.Service.LaunchGame(GameRoot);

        Assert.Equal(GenshinLaunchStatus.Running, result.Status);
        Assert.Equal(GenshinLaunchFailureReason.None, result.FailureReason);
        var standard = Assert.Single(fixture.Starter.Starts);
        var elevated = Assert.Single(fixture.Starter.ElevatedStarts).Specification;
        Assert.Equal(standard.FileName, elevated.FileName);
        Assert.Equal(standard.WorkingDirectory, elevated.WorkingDirectory);
        Assert.Empty(elevated.Arguments);
        Assert.False(elevated.UseShellExecute);
        Assert.Equal([GameRoot, GameRoot], fixture.Validator.GameRoots);
        Assert.Equal(2, fixture.ProcessInspector.Checks.Count);
    }

    [Fact]
    public void Updater_error_740_never_uses_the_genshin_elevation_path()
    {
        var fixture = new LaunchFixture
        {
            StandardStartException = new System.ComponentModel.Win32Exception(740),
        };

        var result = fixture.Service.LaunchUpdater(UpdaterRoot);

        Assert.Equal(GenshinLaunchStatus.LaunchFailed, result.Status);
        Assert.Equal(GenshinLaunchFailureReason.ElevationRequired, result.FailureReason);
        Assert.Single(fixture.Starter.Starts);
        Assert.Empty(fixture.Starter.ElevatedStarts);
        Assert.Equal([UpdaterRoot], fixture.Validator.UpdaterRoots);
    }

    [Fact]
    public void Other_windows_start_error_is_reported_without_retrying()
    {
        var fixture = new LaunchFixture
        {
            StandardStartException = new System.ComponentModel.Win32Exception(5),
        };

        var result = fixture.Service.LaunchGame(GameRoot);

        Assert.Equal(GenshinLaunchStatus.LaunchFailed, result.Status);
        Assert.Equal(GenshinLaunchFailureReason.WindowsStartFailed, result.FailureReason);
        Assert.Single(fixture.Starter.Starts);
        Assert.Empty(fixture.Starter.ElevatedStarts);
    }

    [Fact]
    public void Cancelling_the_uac_prompt_is_distinct_and_never_retried()
    {
        var fixture = new LaunchFixture
        {
            StandardStartException = new System.ComponentModel.Win32Exception(740),
            ElevatedStartException = new System.ComponentModel.Win32Exception(1223),
        };

        var result = fixture.Service.LaunchGame(GameRoot);

        Assert.Equal(GenshinLaunchStatus.LaunchFailed, result.Status);
        Assert.Equal(GenshinLaunchFailureReason.ElevationCancelled, result.FailureReason);
        Assert.Single(fixture.Starter.Starts);
        Assert.Single(fixture.Starter.ElevatedStarts);
    }

    [Fact]
    public void Generic_elevated_start_failure_fails_closed_without_further_fallback()
    {
        var fixture = new LaunchFixture
        {
            StandardStartException = new System.ComponentModel.Win32Exception(740),
            ElevatedStartException = new System.ComponentModel.Win32Exception(5),
        };

        var result = fixture.Service.LaunchGame(GameRoot);

        Assert.Equal(GenshinLaunchStatus.LaunchFailed, result.Status);
        Assert.Equal(GenshinLaunchFailureReason.ElevatedStartFailed, result.FailureReason);
        Assert.Single(fixture.Starter.Starts);
        Assert.Single(fixture.Starter.ElevatedStarts);
    }

    [Fact]
    public void Game_target_change_after_error_740_blocks_uac_retry()
    {
        var validator = new SequencedValidator(
            Ready(GameRoot),
            Review(GenshinInspectionReason.ReparsePointFound));
        var inspector = new FakeProcessInspector();
        var starter = new FakeStarter
        {
            StandardExceptionOverride = new System.ComponentModel.Win32Exception(740),
        };
        var service = new GenshinLaunchService(validator, inspector, starter);

        var result = service.LaunchGame(GameRoot);

        Assert.Equal(GenshinLaunchStatus.NeedsReview, result.Status);
        Assert.Equal(GenshinInspectionReason.ReparsePointFound, result.InspectionReason);
        Assert.Single(starter.Starts);
        Assert.Empty(starter.ElevatedStarts);
        Assert.Single(inspector.Checks);
    }

    [Fact]
    public void Game_seen_running_during_post_740_recheck_does_not_request_uac()
    {
        var validator = new SequencedValidator(Ready(GameRoot), Ready(GameRoot));
        var inspector = new SequencedProcessInspector(
            RunningProcessStatus.NotRunning,
            RunningProcessStatus.Running);
        var starter = new FakeStarter
        {
            StandardExceptionOverride = new System.ComponentModel.Win32Exception(740),
        };
        var service = new GenshinLaunchService(validator, inspector, starter);

        var result = service.LaunchGame(GameRoot);

        Assert.Equal(GenshinLaunchStatus.Running, result.Status);
        Assert.Single(starter.Starts);
        Assert.Empty(starter.ElevatedStarts);
        Assert.Equal(2, inspector.Checks.Count);
    }

    [Fact]
    public void Invalid_updater_does_not_change_a_ready_game_result()
    {
        var fixture = new LaunchFixture
        {
            UpdaterResult = Review(GenshinInspectionReason.LaunchTargetMissing),
        };

        var updater = fixture.Service.CheckUpdater(UpdaterRoot);
        var game = fixture.Service.CheckGame(GameRoot);

        Assert.Equal(GenshinLaunchStatus.NeedsReview, updater.Status);
        Assert.Equal(GenshinLaunchStatus.Ready, game.Status);
    }

    [Fact]
    public void Repeated_ready_checks_do_not_mutate_fake_state()
    {
        var fixture = new LaunchFixture();
        var before = fixture.Snapshot();

        var first = fixture.Service.CheckGame(GameRoot);
        var middle = fixture.SnapshotIgnoringCallLogs();
        var second = fixture.Service.CheckGame(GameRoot);
        var after = fixture.SnapshotIgnoringCallLogs();

        Assert.Equal(first, second);
        Assert.Equal(before, middle);
        Assert.Equal(before, after);
        Assert.Empty(fixture.Starter.Starts);
    }

    private static GenshinInspectionResult Ready(string root) =>
        new(GenshinInspectionStatus.Ready, GenshinInspectionReason.None, root, "1.0.0");

    private static GenshinInspectionResult Review(GenshinInspectionReason reason) =>
        new(GenshinInspectionStatus.NeedsReview, reason);

    private sealed class LaunchFixture
    {
        public LaunchFixture()
        {
            Validator = new FakeValidator(this);
            ProcessInspector = new FakeProcessInspector(this);
            Starter = new FakeStarter(this);
            Service = new(Validator, ProcessInspector, Starter);
        }

        public GenshinInspectionResult GameResult { get; set; } = Ready(GameRoot);

        public GenshinInspectionResult UpdaterResult { get; set; } = Ready(UpdaterRoot);

        public RunningProcessStatus RunningStatus { get; set; } = RunningProcessStatus.NotRunning;

        public Exception? StandardStartException { get; set; }

        public Exception? ElevatedStartException { get; set; }

        public FakeValidator Validator { get; }

        public FakeProcessInspector ProcessInspector { get; }

        public FakeStarter Starter { get; }

        public GenshinLaunchService Service { get; }

        public string Snapshot() =>
            $"{GameResult}|{UpdaterResult}|{RunningStatus}|{StandardStartException?.GetType().FullName}|{ElevatedStartException?.GetType().FullName}";

        public string SnapshotIgnoringCallLogs() => Snapshot();
    }

    private sealed class FakeValidator(LaunchFixture fixture) : IGenshinLaunchIdentityValidator
    {
        public List<string?> GameRoots { get; } = [];

        public List<string?> UpdaterRoots { get; } = [];

        public GenshinInspectionResult ValidateGame(string? root)
        {
            GameRoots.Add(root);
            return fixture.GameResult;
        }

        public GenshinInspectionResult ValidateUpdater(string? root)
        {
            UpdaterRoots.Add(root);
            return fixture.UpdaterResult;
        }
    }

    private sealed class SequencedValidator(params GenshinInspectionResult[] results)
        : IGenshinLaunchIdentityValidator
    {
        private readonly Queue<GenshinInspectionResult> results = new(results);

        public GenshinInspectionResult ValidateGame(string? root) => results.Dequeue();

        public GenshinInspectionResult ValidateUpdater(string? root) => throw new NotSupportedException();
    }

    private sealed class FakeProcessInspector(LaunchFixture? fixture = null) : IRunningProcessInspector
    {
        public List<(string ProcessName, string ExpectedPath)> Checks { get; } = [];

        public RunningProcessStatus Check(string processName, string expectedExecutablePath)
        {
            Checks.Add((processName, expectedExecutablePath));
            return fixture?.RunningStatus ?? RunningProcessStatus.NotRunning;
        }
    }

    private sealed class SequencedProcessInspector(params RunningProcessStatus[] statuses)
        : IRunningProcessInspector
    {
        private readonly Queue<RunningProcessStatus> statuses = new(statuses);

        public List<(string ProcessName, string ExpectedPath)> Checks { get; } = [];

        public RunningProcessStatus Check(string processName, string expectedExecutablePath)
        {
            Checks.Add((processName, expectedExecutablePath));
            return statuses.Dequeue();
        }
    }

    private sealed class FakeStarter(LaunchFixture? fixture = null)
        : ILaunchProcessStarter, IGenshinElevatedProcessStarter
    {
        public List<LaunchSpecification> Starts { get; } = [];

        public List<ValidatedGenshinElevationRequest> ElevatedStarts { get; } = [];

        public Exception? StandardExceptionOverride { get; init; }

        public Exception? ElevatedExceptionOverride { get; init; }

        public void Start(LaunchSpecification specification)
        {
            Starts.Add(specification);
            if ((StandardExceptionOverride ?? fixture?.StandardStartException) is { } exception)
            {
                throw exception;
            }
        }

        public void StartValidatedGenshin(ValidatedGenshinElevationRequest request)
        {
            ElevatedStarts.Add(request);
            if ((ElevatedExceptionOverride ?? fixture?.ElevatedStartException) is { } exception)
            {
                throw exception;
            }
        }
    }
}
