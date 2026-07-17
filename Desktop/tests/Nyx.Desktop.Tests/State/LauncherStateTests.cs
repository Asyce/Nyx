using System.Diagnostics;
using Nyx.Desktop.Core.Games;
using Nyx.Desktop.Core.State;
using Nyx.Desktop.Core.Features;
using Nyx.Desktop.Infrastructure.State;

namespace Nyx.Desktop.Tests.State;

public sealed class LauncherStateTests
{
    [Fact]
    public void Migration_quarantines_invalid_official_colliding_and_ambiguous_custom_ids()
    {
        var result = LauncherStateMigrations.Read("""
        {
          "version": 1,
          "selectedGameId": "custom-duplicate",
          "railOrder": ["evil", "gi", "custom-", "custom_bad", " custom-space ", "custom-duplicate", "custom-good"],
          "customGames": [
            {"id":"evil","name":"Evil","executablePath":"C:\\Games\\evil.exe","iconPath":"C:\\Games\\evil.png"},
            {"id":"gi","name":"Collision","executablePath":"C:\\Games\\gi.exe","iconPath":"C:\\Games\\gi.png"},
            {"id":"custom-","name":"Empty suffix","executablePath":"C:\\Games\\empty.exe","iconPath":"C:\\Games\\empty.png"},
            {"id":"custom_bad","name":"Bad syntax","executablePath":"C:\\Games\\bad.exe","iconPath":"C:\\Games\\bad.png"},
            {"id":" custom-space ","name":"Whitespace","executablePath":"C:\\Games\\space.exe","iconPath":"C:\\Games\\space.png"},
            {"id":"custom-duplicate","name":"First","executablePath":"C:\\Games\\first.exe","iconPath":"C:\\Games\\first.png","creationOrder":1},
            {"id":"custom-duplicate","name":"Second","executablePath":"C:\\Games\\second.exe","iconPath":"C:\\Games\\second.png","creationOrder":2},
            {"id":"custom-good","name":"Good","executablePath":"C:\\Games\\good.exe","iconPath":"C:\\Games\\good.png","creationOrder":3}
          ],
          "appearance": {
            "evil":{"artScale":150},
            "gi":{"artScale":120},
            "custom-duplicate":{"artScale":160},
            "custom-good":{"artScale":170}
          }
        }
        """);

        Assert.Equal(LauncherStateReadStatus.Migrated, result.Status);
        var state = Assert.IsType<LauncherState>(result.State);
        var custom = Assert.Single(state.CustomGames);
        Assert.Equal("custom-good", custom.Id);
        Assert.DoesNotContain("evil", state.RailOrder);
        Assert.DoesNotContain("custom-duplicate", state.RailOrder);
        Assert.DoesNotContain("custom-duplicate", state.Appearance.Keys);
        Assert.Equal(120, state.Appearance["gi"].ArtScale);
        Assert.Equal(170, state.Appearance["custom-good"].ArtScale);
        Assert.Equal("gi", state.SelectedGameId);
    }

    [Fact]
    public void Migration_repairs_order_and_preserves_custom_creation_order_and_appearance()
    {
        var json = """
        {
          "version": 0,
          "selectedGameId": "custom-b",
          "railOrder": ["custom-b", "gi", "gi", "unknown"],
          "customGames": [
            {"id":"custom-b","name":"Beta","executablePath":"C:\\Games\\b.exe","iconPath":"C:\\Games\\b.png","creationOrder":2},
            {"id":"custom-a","name":"Alpha","executablePath":"C:\\Games\\a.exe","iconPath":"C:\\Games\\a.png","creationOrder":1}
          ],
          "appearance": {"gi":{"artScale":999,"artPinned":true},"unknown":{"artScale":5}},
          "export":{"isArmed":true,"outputPaths":{"gi":"C:\\out\\gi.json"}},
          "preferences":{"stayVisibleAfterLaunch":true}
        }
        """;

        var result = LauncherStateMigrations.Read(json);

        Assert.Equal(LauncherStateReadStatus.Migrated, result.Status);
        Assert.NotNull(result.State);
        Assert.Equal(["custom-b", "gi", "hsr", "zzz", "wuwa", "ae", "custom-a"], result.State!.RailOrder);
        Assert.Equal("custom-b", result.State.SelectedGameId);
        Assert.Equal(["custom-a", "custom-b"], result.State.CustomGames.Select(static game => game.Id));
        Assert.Equal(250, result.State.Appearance["gi"].ArtScale);
        Assert.True(result.State.Appearance["gi"].ArtPinned);
        Assert.True(result.State.Export.IsArmed);
        Assert.Null(result.State.Export.OutputDirectory);
        Assert.Empty(result.State.Export.OutputPaths);
    }

    [Fact]
    public void Malformed_and_future_state_fail_closed()
    {
        var malformed = LauncherStateMigrations.Read("{\"version\":1,\"appearance\":");
        var future = LauncherStateMigrations.Read("{\"version\":999}");

        Assert.Equal(LauncherStateReadStatus.Malformed, malformed.Status);
        Assert.Null(malformed.State);
        Assert.Equal(LauncherStateReadStatus.FutureVersion, future.Status);
        Assert.Null(future.State);
    }

    [Fact]
    public void Export_arming_migrates_per_game_and_per_kind_without_cross_game_leakage()
    {
        var result = LauncherStateMigrations.Read("""
        {"version":1,"export":{"games":{
          "gi":{"pullsArmed":true,"achievementsArmed":false},
          "hsr":{"pullsArmed":false,"achievementsArmed":true},
          "zzz":{"pullsArmed":true,"achievementsArmed":true}
        }}}
        """);

        Assert.Equal(LauncherStateReadStatus.Migrated, result.Status);
        Assert.True(result.State!.Export.Games["gi"].PullsArmed);
        Assert.False(result.State.Export.Games["gi"].AchievementsArmed);
        Assert.False(result.State.Export.Games["hsr"].PullsArmed);
        Assert.True(result.State.Export.Games["hsr"].AchievementsArmed);
        Assert.DoesNotContain("zzz", result.State.Export.Games.Keys);
    }

    [Fact]
    public void Persisted_export_paths_are_never_trusted_or_written_back()
    {
        var result = LauncherStateMigrations.Read("""
        {"version":1,"export":{
          "outputDirectory":"\\\\attacker\\share",
          "outputPaths":{"gi:pulls":"C:\\outside\\pulls.json","hsr:achievements":"..\\escape.json"}
        }}
        """);

        Assert.True(result.IsUsable);
        Assert.Null(result.State!.Export.OutputDirectory);
        Assert.Empty(result.State.Export.OutputPaths);
        var written = LauncherStateMigrations.Write(result.State);
        Assert.DoesNotContain("attacker", written, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("outside", written, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("escape", written, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Pinned_art_uses_only_a_safe_relative_content_address()
    {
        var hash = new string('a', 64);
        var valid = LauncherStateMigrations.Read(
            $"{{\"version\":1,\"appearance\":{{\"gi\":{{\"artPinned\":true,\"pinnedArtFile\":\"gi/{hash}.webp\"}}}}}}");
        Assert.Equal(LauncherStateReadStatus.Migrated, valid.Status);
        Assert.Equal(LauncherState.CurrentVersion, valid.State!.Version);
        Assert.Equal($"gi/{hash}.webp", valid.State!.Appearance["gi"].PinnedArtFile);
        Assert.Contains($"gi/{hash}.webp", LauncherStateMigrations.Write(valid.State), StringComparison.Ordinal);

        var unsafeState = LauncherStateMigrations.Read("""
        {"version":1,"appearance":{"gi":{"artPinned":true,"pinnedArtFile":"../outside.webp"}}}
        """);
        Assert.Null(unsafeState.State!.Appearance["gi"].PinnedArtFile);
    }

    [Fact]
    public void Version_one_pinned_variant_is_preserved_for_lazy_protected_copy()
    {
        var result = LauncherStateMigrations.Read("""
        {"version":1,"appearance":{"gi":{"artPinned":true,"artVariant":"citlali-card"}}}
        """);

        Assert.Equal(LauncherStateReadStatus.Migrated, result.Status);
        Assert.Equal(LauncherState.CurrentVersion, result.State!.Version);
        Assert.True(result.State.Appearance["gi"].ArtPinned);
        Assert.Equal("citlali-card", result.State.Appearance["gi"].ArtVariant);
        Assert.Null(result.State.Appearance["gi"].PinnedArtFile);
    }

    [Fact]
    public void Rolled_over_version_one_pin_stays_pending_until_its_exact_variant_returns()
    {
        var migrated = LauncherStateMigrations.Read("""
        {"version":1,"appearance":{"gi":{"artPinned":true,"artVariant":"old-banner-art"}}}
        """);
        var appearance = migrated.State!.Appearance["gi"];

        Assert.Equal(
            LauncherPinnedArtMigrationStatus.Pending,
            LauncherPinnedArtMigration.Evaluate(appearance, protectedFileValid: false, ["new-banner-art"]));
        Assert.True(appearance.ArtPinned);
        Assert.Equal("old-banner-art", appearance.ArtVariant);
        Assert.Null(appearance.PinnedArtFile);
        Assert.Equal(
            LauncherPinnedArtMigrationStatus.AvailableForProtection,
            LauncherPinnedArtMigration.Evaluate(appearance, protectedFileValid: false, ["old-banner-art"]));
    }

    [Fact]
    public void Preferences_migration_adds_safe_defaults_and_preserves_independent_flags()
    {
        var result = LauncherStateMigrations.Read("""
        {"version":1,"preferences":{"safeNotifications":false,"featureFlags":{"giPulls":false,"hsrAchievements":true,"zzzPulls":true}}}
        """);

        Assert.Equal(LauncherStateReadStatus.Migrated, result.Status);
        Assert.False(result.State!.Preferences.SafeNotifications);
        Assert.False(result.State.Preferences.FeatureFlags.GiPulls);
        Assert.True(result.State.Preferences.FeatureFlags.GiAchievements);
        Assert.True(result.State.Preferences.FeatureFlags.HsrAchievements);
        Assert.True(result.State.Preferences.FeatureFlags.ZzzPulls);
        Assert.False(result.State.Preferences.FeatureFlags.ZzzAchievements);
    }

    [Fact]
    public void Settings_save_keeps_a_custom_game_added_by_another_instance_while_open()
    {
        var directory = Path.Combine(Path.GetTempPath(), "nyx-settings-merge-" + Guid.NewGuid().ToString("N"));
        try
        {
            var settingsStore = new LauncherStateStore(directory);
            settingsStore.Save(LauncherState.Defaults());
            var opened = settingsStore.Load().State!;
            var concurrentGame = CustomGame("custom-concurrent", 1);
            var otherInstance = new LauncherStateStore(directory);
            otherInstance.Update(state => state with
            {
                CustomGames = state.CustomGames.Append(concurrentGame).ToArray(),
                RailOrder = state.RailOrder.Append(concurrentGame.Id).ToArray(),
                Appearance = state.Appearance
                    .Append(new KeyValuePair<string, GameAppearanceState>("gi", new() { ArtX = 88 }))
                    .Append(new KeyValuePair<string, GameAppearanceState>("hsr", new() { ArtScale = 175 }))
                    .ToDictionary(static pair => pair.Key, static pair => pair.Value, StringComparer.Ordinal),
                Preferences = state.Preferences with
                {
                    StayVisibleAfterLaunch = false,
                    DataDirectory = @"D:\NyxData",
                    FeatureFlags = state.Preferences.FeatureFlags with { GiPulls = false },
                },
            });

            settingsStore.Update(latest => LauncherSettingsStateMerge.Apply(
                latest,
                opened,
                SettingsEdit(opened, opened.RailOrder, artScale: 140)));

            var saved = settingsStore.Load().State!;
            Assert.Contains(saved.CustomGames, game => game.Id == concurrentGame.Id);
            Assert.Contains(concurrentGame.Id, saved.RailOrder);
            Assert.Equal(175, saved.Appearance["hsr"].ArtScale);
            Assert.Equal(140, saved.Appearance["gi"].ArtScale);
            Assert.Equal(88, saved.Appearance["gi"].ArtX);
            Assert.False(saved.Preferences.StayVisibleAfterLaunch);
            Assert.Equal(@"D:\NyxData", saved.Preferences.DataDirectory);
            Assert.False(saved.Preferences.FeatureFlags.GiPulls);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public void Settings_reorder_keeps_rail_additions_from_another_instance()
    {
        var directory = Path.Combine(Path.GetTempPath(), "nyx-settings-rail-" + Guid.NewGuid().ToString("N"));
        try
        {
            var settingsStore = new LauncherStateStore(directory);
            settingsStore.Save(LauncherState.Defaults());
            var opened = settingsStore.Load().State!;
            var concurrentGame = CustomGame("custom-new-rail", 2);
            new LauncherStateStore(directory).Update(state => state with
            {
                CustomGames = state.CustomGames.Append(concurrentGame).ToArray(),
                RailOrder = state.RailOrder.Append(concurrentGame.Id).ToArray(),
            });
            var localOrder = opened.RailOrder.Reverse().ToArray();

            settingsStore.Update(latest => LauncherSettingsStateMerge.Apply(
                latest,
                opened,
                SettingsEdit(opened, localOrder, artScale: 130)));

            var saved = settingsStore.Load().State!;
            Assert.Equal(localOrder, saved.RailOrder.Take(localOrder.Length));
            Assert.Equal(concurrentGame.Id, saved.RailOrder.Last());
            Assert.Contains(saved.CustomGames, game => game.Id == concurrentGame.Id);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public void Settings_save_does_not_resurrect_a_custom_game_deleted_by_another_instance()
    {
        var directory = Path.Combine(Path.GetTempPath(), "nyx-settings-delete-" + Guid.NewGuid().ToString("N"));
        try
        {
            var settingsStore = new LauncherStateStore(directory);
            var custom = CustomGame("custom-concurrent-delete", 3);
            settingsStore.Save(LauncherState.Defaults() with
            {
                CustomGames = [custom],
                RailOrder = LauncherState.Defaults().RailOrder.Append(custom.Id).ToArray(),
                SelectedGameId = custom.Id,
            });
            var opened = settingsStore.Load().State!;
            new LauncherStateStore(directory).Update(state => state with
            {
                CustomGames = state.CustomGames.Where(game => game.Id != custom.Id).ToArray(),
                RailOrder = state.RailOrder.Where(id => id != custom.Id).ToArray(),
                SelectedGameId = "gi",
            });

            settingsStore.Update(latest => LauncherSettingsStateMerge.Apply(
                latest,
                opened,
                SettingsEdit(
                    opened,
                    opened.RailOrder,
                    artScale: 100,
                    gameId: custom.Id,
                    customGame: custom with { Name = "Locally edited name" })));

            var saved = settingsStore.Load().State!;
            Assert.DoesNotContain(saved.CustomGames, game => game.Id == custom.Id);
            Assert.DoesNotContain(custom.Id, saved.RailOrder);
            Assert.DoesNotContain(custom.Id, saved.Appearance.Keys);
            Assert.Equal("gi", saved.SelectedGameId);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public void Concurrent_add_with_the_same_canonical_executable_fails_without_mutating_state()
    {
        var directory = Path.Combine(Path.GetTempPath(), "nyx-custom-add-race-" + Guid.NewGuid().ToString("N"));
        try
        {
            var firstInstance = new LauncherStateStore(directory);
            firstInstance.Save(LauncherState.Defaults());
            var otherGame = CustomGame("custom-add-winner", 4, @"C:\Games\Shared.exe");
            new LauncherStateStore(directory).Update(
                state => LauncherCustomGameStateMerge.Add(state, otherGame));
            var primaryBeforeConflict = File.ReadAllText(firstInstance.StatePath);
            var staleCandidate = CustomGame(
                "custom-add-stale",
                5,
                "c:/games/staging/../SHARED.exe");

            Assert.Throws<CustomGameExecutableConflictException>(() => firstInstance.Update(
                state => LauncherCustomGameStateMerge.Add(state, staleCandidate)));

            Assert.Equal(primaryBeforeConflict, File.ReadAllText(firstInstance.StatePath));
            var saved = firstInstance.Load().State!;
            var onlyGame = Assert.Single(saved.CustomGames);
            Assert.Equal(otherGame.Id, onlyGame.Id);
            Assert.DoesNotContain(saved.CustomGames, game => game.Id == staleCandidate.Id);
            AssertUniqueExecutableIdentities(saved.CustomGames);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public void Concurrent_settings_edit_to_an_owned_executable_fails_without_mutating_state()
    {
        var directory = Path.Combine(Path.GetTempPath(), "nyx-custom-edit-race-" + Guid.NewGuid().ToString("N"));
        try
        {
            var settingsStore = new LauncherStateStore(directory);
            var editedGame = CustomGame("custom-edit-source", 6, @"C:\Games\Original.exe");
            settingsStore.Save(LauncherCustomGameStateMerge.Add(LauncherState.Defaults(), editedGame));
            var opened = settingsStore.Load().State!;
            var otherGame = CustomGame("custom-edit-winner", 7, @"C:\Games\Shared.exe");
            new LauncherStateStore(directory).Update(
                state => LauncherCustomGameStateMerge.Add(state, otherGame));
            var primaryBeforeConflict = File.ReadAllText(settingsStore.StatePath);

            Assert.Throws<CustomGameExecutableConflictException>(() => settingsStore.Update(
                latest => LauncherSettingsStateMerge.Apply(
                    latest,
                    opened,
                    SettingsEdit(
                        opened,
                        opened.RailOrder,
                        artScale: 100,
                        gameId: editedGame.Id,
                        customGame: editedGame with
                        {
                            Name = "Stale local edit",
                            ExecutablePath = "c:/GAMES/staging/../shared.exe",
                        }))));

            Assert.Equal(primaryBeforeConflict, File.ReadAllText(settingsStore.StatePath));
            var saved = settingsStore.Load().State!;
            Assert.Equal(2, saved.CustomGames.Count);
            Assert.Equal(
                @"C:\Games\Original.exe",
                saved.CustomGames.Single(game => game.Id == editedGame.Id).ExecutablePath);
            Assert.Equal(
                @"C:\Games\Shared.exe",
                saved.CustomGames.Single(game => game.Id == otherGame.Id).ExecutablePath);
            AssertUniqueExecutableIdentities(saved.CustomGames);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public void Store_recovers_backup_after_malformed_primary_and_is_safe_for_concurrent_writers()
    {
        var directory = Path.Combine(Path.GetTempPath(), "nyx-state-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new LauncherStateStore(directory);
            store.Save(LauncherState.Defaults() with { SelectedGameId = "hsr" });
            store.Save(LauncherState.Defaults() with { SelectedGameId = "zzz" });
            File.WriteAllText(store.StatePath, "{bad");

            var recovered = store.Load();
            Assert.Equal(LauncherStateReadStatus.Recovered, recovered.Status);
            Assert.Equal("hsr", recovered.State!.SelectedGameId);
            Assert.False(store.CanSave);
            Assert.True(store.RestoreLastKnownGood().IsUsable);

            Parallel.For(0, 16, index => store.Save(LauncherState.Defaults() with
            {
                SelectedGameId = index % 2 == 0 ? "gi" : "ae",
            }));
            var final = store.Load();
            Assert.True(final.IsUsable);
            Assert.Contains(final.State!.SelectedGameId, new[] { "gi", "ae" });
            Assert.True(File.Exists(store.BackupPath));
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task State_updates_from_real_processes_keep_every_edit_and_valid_json()
    {
        var directory = Path.Combine(Path.GetTempPath(), "nyx-state-processes-" + Guid.NewGuid().ToString("N"));
        var barrier = Path.Combine(directory, "go");
        var processes = new List<Process>();
        try
        {
            Directory.CreateDirectory(directory);
            new LauncherStateStore(directory).Save(LauncherState.Defaults());
            for (var index = 0; index < 6; index++)
            {
                var id = $"custom-process-{index}";
                processes.Add(StartStateWorker(
                    directory,
                    id,
                    Path.Combine(directory, $"ready-{index}"),
                    barrier,
                    Path.Combine(directory, $"acquired-{index}"),
                    delayMilliseconds: 75));
            }

            await WaitForFilesAsync(
                Enumerable.Range(0, processes.Count).Select(index => Path.Combine(directory, $"ready-{index}")),
                TimeSpan.FromSeconds(10));
            File.WriteAllText(barrier, "go");
            await WaitForProcessesAsync(processes, TimeSpan.FromSeconds(20));

            Assert.All(processes, process => Assert.Equal(0, process.ExitCode));
            var payload = File.ReadAllText(Path.Combine(directory, "launcher-state-v1.json"));
            var parsed = LauncherStateMigrations.Read(payload);
            Assert.Equal(LauncherStateReadStatus.Loaded, parsed.Status);
            Assert.Equal(
                Enumerable.Range(0, 6).Select(index => $"custom-process-{index}").Order(),
                parsed.State!.CustomGames.Select(game => game.Id).Order());
        }
        finally
        {
            foreach (var process in processes)
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
                process.Dispose();
            }
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task Cross_process_state_lock_fails_in_bounded_time_without_changing_state()
    {
        var directory = Path.Combine(Path.GetTempPath(), "nyx-state-timeout-" + Guid.NewGuid().ToString("N"));
        Process? holder = null;
        try
        {
            Directory.CreateDirectory(directory);
            var baseline = LauncherState.Defaults() with { SelectedGameId = "hsr" };
            new LauncherStateStore(directory).Save(baseline);
            var barrier = Path.Combine(directory, "go");
            var ready = Path.Combine(directory, "ready");
            var acquired = Path.Combine(directory, "acquired");
            holder = StartStateWorker(
                directory,
                "custom-holder",
                ready,
                barrier,
                acquired,
                delayMilliseconds: 1_500);
            await WaitForFilesAsync([ready], TimeSpan.FromSeconds(10));
            File.WriteAllText(barrier, "go");
            await WaitForFilesAsync([acquired], TimeSpan.FromSeconds(10));

            var contender = new LauncherStateStore(directory, TimeSpan.FromMilliseconds(150));
            var stopwatch = Stopwatch.StartNew();
            var exception = Assert.ThrowsAny<IOException>(() => contender.Save(
                baseline with { SelectedGameId = "ae" }));
            stopwatch.Stop();

            Assert.Contains("busy", exception.Message, StringComparison.OrdinalIgnoreCase);
            Assert.InRange(stopwatch.Elapsed, TimeSpan.FromMilliseconds(100), TimeSpan.FromSeconds(2));
            await WaitForProcessesAsync([holder], TimeSpan.FromSeconds(10));
            Assert.Equal(0, holder.ExitCode);
            var final = new LauncherStateStore(directory).Load();
            Assert.Equal("hsr", final.State!.SelectedGameId);
            Assert.Contains(final.State.CustomGames, game => game.Id == "custom-holder");
        }
        finally
        {
            if (holder is not null)
            {
                if (!holder.HasExited) holder.Kill(entireProcessTree: true);
                holder.Dispose();
            }
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Theory]
    [InlineData("{bad")]
    [InlineData("{\"version\":999,\"selectedGameId\":\"hsr\"}")]
    public void Unusable_primary_blocks_ordinary_writes_until_explicit_reset(string unusablePayload)
    {
        var directory = Path.Combine(Path.GetTempPath(), "nyx-state-block-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(directory);
            var store = new LauncherStateStore(directory);
            File.WriteAllText(store.StatePath, unusablePayload);

            Assert.False(store.CanSave);
            Assert.Throws<IOException>(() => store.Save(
                LauncherState.Defaults() with { SelectedGameId = "ae" }));
            Assert.Equal(unusablePayload, File.ReadAllText(store.StatePath));

            var reset = store.ResetToDefaults();
            Assert.True(reset.IsUsable);
            var recoveryCopy = Assert.Single(Directory.GetFiles(
                directory,
                "launcher-state-v1.json.recovery.*"));
            Assert.Equal(unusablePayload, File.ReadAllText(recoveryCopy));
            Assert.True(store.CanSave);
            store.Save(LauncherState.Defaults() with { SelectedGameId = "hsr" });
            Assert.Equal("hsr", store.Load().State!.SelectedGameId);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public void Recovered_backup_does_not_silently_authorize_replacing_bad_primary()
    {
        var directory = Path.Combine(Path.GetTempPath(), "nyx-state-recovery-block-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new LauncherStateStore(directory);
            store.Save(LauncherState.Defaults() with { SelectedGameId = "hsr" });
            store.Save(LauncherState.Defaults() with { SelectedGameId = "zzz" });
            const string malformed = "{bad";
            File.WriteAllText(store.StatePath, malformed);
            var backupBefore = File.ReadAllText(store.BackupPath);

            var recovered = store.Load();
            Assert.Equal(LauncherStateReadStatus.Recovered, recovered.Status);
            Assert.Equal("hsr", recovered.State!.SelectedGameId);
            Assert.False(store.CanSave);
            Assert.Throws<IOException>(() => store.Save(recovered.State));
            Assert.Equal(malformed, File.ReadAllText(store.StatePath));
            Assert.Equal(backupBefore, File.ReadAllText(store.BackupPath));

            var restored = store.RestoreLastKnownGood();
            Assert.Equal(LauncherStateReadStatus.Recovered, restored.Status);
            var recoveryCopy = Assert.Single(Directory.GetFiles(
                directory,
                "launcher-state-v1.json.recovery.*"));
            Assert.Equal(malformed, File.ReadAllText(recoveryCopy));
            Assert.True(store.CanSave);
            Assert.Equal("hsr", store.Load().State!.SelectedGameId);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public void Legacy_user_data_is_moved_whole_to_the_canonical_root()
    {
        var local = Path.Combine(Path.GetTempPath(), "nyx-data-root-" + Guid.NewGuid().ToString("N"));
        var legacy = NyxUserDataPaths.LegacyRoot(local);
        var canonical = NyxUserDataPaths.CanonicalRoot(local);
        try
        {
            Directory.CreateDirectory(Path.Combine(legacy, "UserAssets"));
            File.WriteAllText(Path.Combine(legacy, "launcher-state-v1.json"), "state");
            File.WriteAllText(Path.Combine(legacy, "UserAssets", "keep.png"), "asset");

            var result = NyxUserDataRootMigration.PrepareCanonicalRoot(local);

            Assert.Equal(canonical, result);
            Assert.False(Directory.Exists(legacy));
            Assert.Equal("state", File.ReadAllText(Path.Combine(canonical, "launcher-state-v1.json")));
            Assert.Equal("asset", File.ReadAllText(Path.Combine(canonical, "UserAssets", "keep.png")));
        }
        finally
        {
            if (Directory.Exists(local)) Directory.Delete(local, recursive: true);
        }
    }

    [Fact]
    public void Migration_refuses_to_merge_two_roots_and_preserves_both()
    {
        var local = Path.Combine(Path.GetTempPath(), "nyx-data-conflict-" + Guid.NewGuid().ToString("N"));
        var legacy = NyxUserDataPaths.LegacyRoot(local);
        var canonical = NyxUserDataPaths.CanonicalRoot(local);
        try
        {
            Directory.CreateDirectory(legacy);
            Directory.CreateDirectory(canonical);
            File.WriteAllText(Path.Combine(legacy, "legacy.txt"), "legacy");
            File.WriteAllText(Path.Combine(canonical, "canonical.txt"), "canonical");

            Assert.Throws<IOException>(() => NyxUserDataRootMigration.PrepareCanonicalRoot(local));

            Assert.Equal("legacy", File.ReadAllText(Path.Combine(legacy, "legacy.txt")));
            Assert.Equal("canonical", File.ReadAllText(Path.Combine(canonical, "canonical.txt")));
        }
        finally
        {
            if (Directory.Exists(local)) Directory.Delete(local, recursive: true);
        }
    }

    [Fact]
    public void Migration_rejects_a_link_inside_legacy_data_without_moving_it()
    {
        var local = Path.Combine(Path.GetTempPath(), "nyx-data-link-" + Guid.NewGuid().ToString("N"));
        var legacy = NyxUserDataPaths.LegacyRoot(local);
        var outside = Path.Combine(local, "outside");
        try
        {
            Directory.CreateDirectory(legacy);
            Directory.CreateDirectory(outside);
            File.WriteAllText(Path.Combine(outside, "keep.txt"), "keep");
            Directory.CreateSymbolicLink(Path.Combine(legacy, "linked"), outside);

            Assert.Throws<IOException>(() => NyxUserDataRootMigration.PrepareCanonicalRoot(local));

            Assert.True(Directory.Exists(legacy));
            Assert.False(Directory.Exists(NyxUserDataPaths.CanonicalRoot(local)));
            Assert.Equal("keep", File.ReadAllText(Path.Combine(outside, "keep.txt")));
        }
        finally
        {
            if (Directory.Exists(local)) Directory.Delete(local, recursive: true);
        }
    }

    private static Process StartStateWorker(
        string root,
        string id,
        string readyPath,
        string goPath,
        string acquiredPath,
        int delayMilliseconds)
    {
        var start = new ProcessStartInfo("dotnet")
        {
            UseShellExecute = false,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
        };
        start.ArgumentList.Add(FindStateWorker());
        start.ArgumentList.Add("append");
        start.ArgumentList.Add(root);
        start.ArgumentList.Add(id);
        start.ArgumentList.Add(readyPath);
        start.ArgumentList.Add(goPath);
        start.ArgumentList.Add(acquiredPath);
        start.ArgumentList.Add(delayMilliseconds.ToString(System.Globalization.CultureInfo.InvariantCulture));
        return Process.Start(start) ?? throw new InvalidOperationException("Could not start the state worker.");
    }

    private static CustomGameDefinition CustomGame(
        string id,
        long creationOrder,
        string? executablePath = null) => new()
    {
        Id = id,
        Name = id,
        ExecutablePath = executablePath ?? $@"C:\Games\{id}.exe",
        IconPath = $@"C:\Games\{id}.png",
        CreationOrder = creationOrder,
    };

    private static void AssertUniqueExecutableIdentities(IReadOnlyList<CustomGameDefinition> games)
    {
        var identities = games
            .Select(game => LauncherCustomGameStateMerge.CanonicalExecutableIdentity(game.ExecutablePath))
            .ToArray();
        Assert.Equal(
            identities.Length,
            identities.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    private static LauncherSettingsEdit SettingsEdit(
        LauncherState opened,
        IReadOnlyList<string> railOrder,
        int artScale,
        string gameId = "gi",
        CustomGameDefinition? customGame = null) => new()
    {
        GameId = gameId,
        OpenedAppearance = opened.Appearance.TryGetValue(gameId, out var appearance)
            ? appearance
            : new GameAppearanceState(),
        Appearance = new GameAppearanceState { ArtScale = artScale },
        CustomGame = customGame,
        RailOrder = railOrder,
        StayVisibleAfterLaunch = opened.Preferences.StayVisibleAfterLaunch,
        RefreshContentOnStartup = opened.Preferences.RefreshContentOnStartup,
        SafeNotifications = opened.Preferences.SafeNotifications,
        AutomaticArt = opened.Preferences.FeatureFlags.AutomaticArt,
        OfficialNews = opened.Preferences.FeatureFlags.OfficialNews,
        RemoteBannerManifest = opened.Preferences.FeatureFlags.RemoteBannerManifest,
    };

    private static string FindStateWorker()
    {
        var root = FindWorkspaceRoot();
        var targetFramework = new DirectoryInfo(AppContext.BaseDirectory.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar));
        var configuration = targetFramework.Parent?.Name
            ?? throw new DirectoryNotFoundException("Could not identify the test build configuration.");
        var path = Path.Combine(
            root,
            "Desktop",
            "tests",
            "Nyx.Desktop.StateWorker",
            "bin",
            configuration,
            "net10.0",
            "Nyx.Desktop.StateWorker.dll");
        return File.Exists(path)
            ? path
            : throw new FileNotFoundException("The state worker was not built.", path);
    }

    private static string FindWorkspaceRoot()
    {
        for (var current = new DirectoryInfo(AppContext.BaseDirectory);
             current is not null;
             current = current.Parent)
        {
            if (Directory.Exists(Path.Combine(current.FullName, "Desktop", "src", "Nyx.Desktop.Core")))
                return current.FullName;
        }

        throw new DirectoryNotFoundException("Could not find the Nyx workspace root.");
    }

    private static async Task WaitForFilesAsync(IEnumerable<string> paths, TimeSpan timeout)
    {
        var expected = paths.ToArray();
        var deadline = DateTime.UtcNow + timeout;
        while (expected.Any(path => !File.Exists(path)))
        {
            if (DateTime.UtcNow >= deadline)
                throw new TimeoutException("Timed out waiting for worker readiness.");
            await Task.Delay(20);
        }
    }

    private static async Task WaitForProcessesAsync(IEnumerable<Process> processes, TimeSpan timeout)
    {
        using var cancellation = new CancellationTokenSource(timeout);
        await Task.WhenAll(processes.Select(process => process.WaitForExitAsync(cancellation.Token)));
        foreach (var process in processes)
        {
            var error = await process.StandardError.ReadToEndAsync(cancellation.Token);
            Assert.True(process.ExitCode == 0, error);
        }
    }
}
