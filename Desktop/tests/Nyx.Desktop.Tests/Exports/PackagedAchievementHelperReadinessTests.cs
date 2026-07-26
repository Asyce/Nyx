using System.Security.Cryptography;
using Nyx.Desktop.Core.Exports;
using Nyx.Desktop.Core.Features;

namespace Nyx.Desktop.Tests.Exports;

public sealed class PackagedAchievementHelperReadinessTests
{
    [Fact]
    public void Exact_packaged_helper_and_hash_enable_only_achievement_capability()
    {
        using var temp = new TemporaryDirectory();
        var tools = Path.Combine(temp.Path, "Assets", "Tools");
        Directory.CreateDirectory(tools);
        var helper = Path.Combine(tools, PackagedAchievementHelperReadiness.HelperFileName);
        File.WriteAllBytes(helper, "reviewed packaged helper"u8.ToArray());
        var hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(helper))).ToLowerInvariant();

        var ready = PackagedAchievementHelperReadiness.IsReady(temp.Path, hash);
        Assert.True(ready);
        AssertCapabilities(achievementHelperReady: ready, achievementsExpected: true);
    }

    [Fact]
    public void Missing_mismatched_or_unstamped_helper_is_visibly_unavailable_while_pulls_remain_ready()
    {
        using var temp = new TemporaryDirectory();
        var tools = Path.Combine(temp.Path, "Assets", "Tools");
        Directory.CreateDirectory(tools);
        var helper = Path.Combine(tools, PackagedAchievementHelperReadiness.HelperFileName);
        File.WriteAllBytes(helper, "unverified helper"u8.ToArray());

        var ready = PackagedAchievementHelperReadiness.IsReady(temp.Path, new string('0', 64));
        Assert.False(ready);
        Assert.False(PackagedAchievementHelperReadiness.IsReady(temp.Path, "NOT-A-HASH"));
        File.Delete(helper);
        Assert.False(PackagedAchievementHelperReadiness.IsReady(temp.Path, new string('0', 64)));
        AssertCapabilities(achievementHelperReady: ready, achievementsExpected: false);
    }

    private static void AssertCapabilities(bool achievementHelperReady, bool achievementsExpected)
    {
        var flags = LauncherFeatureFlags.Defaults() with
        {
            GiPulls = true,
            HsrPulls = true,
            GiAchievements = true,
            HsrAchievements = true,
            AchievementHelperReady = achievementHelperReady,
        };

        foreach (var gameId in new[] { "gi", "hsr" })
        {
            var capability = ExportProviderCatalog.GetEnabled(gameId, flags);
            Assert.True(capability.Supports(ExportKind.Pulls));
            Assert.Equal(achievementsExpected, capability.Supports(ExportKind.Achievements));
        }
    }

    private sealed class TemporaryDirectory : IDisposable
    {
        public TemporaryDirectory()
        {
            Path = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(),
                "nyx-helper-readiness-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }

        public void Dispose()
        {
            if (Directory.Exists(Path)) Directory.Delete(Path, recursive: true);
        }
    }
}
