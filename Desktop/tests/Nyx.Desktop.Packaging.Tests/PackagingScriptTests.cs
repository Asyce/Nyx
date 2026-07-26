using System.Diagnostics;

namespace Nyx.Desktop.Packaging.Tests;

public sealed class PackagingScriptTests
{
    private static readonly string DesktopRoot = FindDesktopRoot();
    private static readonly string PackagingRoot = Path.Combine(DesktopRoot, "packaging");

    [Fact]
    public void Packaging_and_install_scripts_parse_without_errors()
    {
        foreach (var script in new[]
        {
            Path.Combine(PackagingRoot, "build-development-package.ps1"),
            Path.Combine(PackagingRoot, "scripts", "Install-Nyx.ps1"),
            Path.Combine(PackagingRoot, "scripts", "Uninstall-Nyx.ps1"),
        })
        {
            var escaped = script.Replace("'", "''", StringComparison.Ordinal);
            var result = RunPowerShell(
                "$errors=$null; [void][Management.Automation.Language.Parser]::ParseFile('" + escaped +
                "',[ref]$null,[ref]$errors); if($errors.Count){$errors | ForEach-Object Message; exit 1}");
            Assert.Equal(0, result.ExitCode);
        }
    }

    [Fact]
    public void Scripts_do_not_interpret_commands_or_download_and_uninstall_requires_explicit_data_switch()
    {
        var build = File.ReadAllText(Path.Combine(PackagingRoot, "build-development-package.ps1"));
        var install = File.ReadAllText(Path.Combine(PackagingRoot, "scripts", "Install-Nyx.ps1"));
        var uninstall = File.ReadAllText(Path.Combine(PackagingRoot, "scripts", "Uninstall-Nyx.ps1"));
        var all = build + install + uninstall;

        Assert.DoesNotContain("Invoke-Expression", all, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Invoke-WebRequest", all, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Start-Process", all, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("cmd.exe", all, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("-Recurse -Force $", all, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("[switch] $RemoveUserData", uninstall);
        Assert.Contains("if ($RemoveUserData)", uninstall);
        Assert.Contains("Run this installer without administrator approval", install);
    }

    [Fact]
    public void Solution_gate_includes_the_updater_and_packaging_tests()
    {
        var solution = File.ReadAllText(Path.Combine(DesktopRoot, "Nyx.Desktop.slnx"));

        Assert.Contains("tests/Nyx.Desktop.Packaging.Tests/Nyx.Desktop.Packaging.Tests.csproj", solution);
        Assert.Contains("tools/Nyx.Desktop.Update/Nyx.Desktop.Update.csproj", solution);
        Assert.Contains("<Platform Project=\"x64\" />", solution, StringComparison.Ordinal);
        Assert.DoesNotContain("<Platform Project=\"x86\" />", solution, StringComparison.Ordinal);
    }

    [Fact]
    public void Development_package_verifies_and_stamps_the_exact_embedded_achievement_helper()
    {
        var build = File.ReadAllText(Path.Combine(PackagingRoot, "build-development-package.ps1"));
        var project = File.ReadAllText(Path.Combine(
            DesktopRoot,
            "src",
            "Nyx.Desktop.App",
            "Nyx.Desktop.App.csproj"));

        Assert.Contains("verify_release.py", build, StringComparison.Ordinal);
        Assert.Contains("Get-FileHash -LiteralPath $builtHelper -Algorithm SHA256", build, StringComparison.Ordinal);
        Assert.Contains("-p:AchievementHelperSource=$builtHelper", build, StringComparison.Ordinal);
        Assert.Contains("-p:AchievementHelperSha256=$helperSha256", build, StringComparison.Ordinal);
        Assert.True(
            build.IndexOf("verify_release.py", StringComparison.Ordinal) <
            build.IndexOf("Get-FileHash -LiteralPath $builtHelper", StringComparison.Ordinal));
        Assert.Contains("PengoAchievementHelperSha256", project, StringComparison.Ordinal);
        Assert.Contains("Assets\\Tools\\pengo-achievements-launcher.exe", project, StringComparison.Ordinal);
    }

    [Fact]
    public void Development_package_restores_by_default_with_an_explicit_no_restore_opt_out()
    {
        var build = File.ReadAllText(Path.Combine(PackagingRoot, "build-development-package.ps1"));
        var readme = File.ReadAllText(Path.Combine(PackagingRoot, "README.md"));
        var updateDoc = File.ReadAllText(Path.Combine(
            DesktopRoot,
            "..",
            "docs",
            "desktop-packaging-update-2026-07-17.md"));

        Assert.Contains("[switch] $NoRestore", build, StringComparison.Ordinal);
        Assert.Contains("$restoreArgument = if ($NoRestore) { @('--no-restore') } else { @() }", build, StringComparison.Ordinal);
        Assert.DoesNotContain("[switch] $Restore", build, StringComparison.Ordinal);
        Assert.Contains("build-development-package.ps1 -Version 1.0.0.0", readme, StringComparison.Ordinal);
        Assert.Contains("Use `-NoRestore` only", readme, StringComparison.Ordinal);
        Assert.Contains("`-NoRestore` is an explicit opt-out", updateDoc, StringComparison.Ordinal);
    }

    private static (int ExitCode, string Output) RunPowerShell(string command)
    {
        var start = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        start.ArgumentList.Add("-NoLogo");
        start.ArgumentList.Add("-NoProfile");
        start.ArgumentList.Add("-Command");
        start.ArgumentList.Add(command);
        using var process = Process.Start(start)!;
        var output = process.StandardOutput.ReadToEnd() + process.StandardError.ReadToEnd();
        Assert.True(process.WaitForExit(30_000));
        return (process.ExitCode, output);
    }

    private static string FindDesktopRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "Nyx.Desktop.slnx")))
            {
                return current.FullName;
            }
            current = current.Parent;
        }
        throw new DirectoryNotFoundException();
    }
}
