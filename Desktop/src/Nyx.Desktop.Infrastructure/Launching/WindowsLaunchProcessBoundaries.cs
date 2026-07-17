using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security;
using System.Text;
using Microsoft.Win32.SafeHandles;
using Nyx.Desktop.Core.Launching;

namespace Nyx.Desktop.Infrastructure.Launching;

public sealed class WindowsRunningProcessInspector
    : IRunningProcessInspector, IStrictRunningProcessInspector
{
    private readonly IWindowsProcessPathQuery processPathQuery;

    public WindowsRunningProcessInspector()
        : this(new LimitedInformationWindowsProcessPathQuery())
    {
    }

    internal WindowsRunningProcessInspector(IWindowsProcessPathQuery processPathQuery)
    {
        this.processPathQuery = processPathQuery
            ?? throw new ArgumentNullException(nameof(processPathQuery));
    }

    public RunningProcessStatus Check(string processName, string expectedExecutablePath) =>
        Check(processName, expectedExecutablePath, differentPathIsUncertain: false);

    public RunningProcessStatus CheckStrict(string processName, string expectedExecutablePath) =>
        Check(processName, expectedExecutablePath, differentPathIsUncertain: true);

    private RunningProcessStatus Check(
        string processName,
        string expectedExecutablePath,
        bool differentPathIsUncertain)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(processName);
        ArgumentException.ThrowIfNullOrWhiteSpace(expectedExecutablePath);

        return EvaluateSameNamePaths(
            processPathQuery.QueryExecutablePaths(processName),
            expectedExecutablePath,
            differentPathIsUncertain);
    }

    internal static RunningProcessStatus EvaluateSameNamePaths(
        IEnumerable<string?> observedPaths,
        string expectedExecutablePath,
        bool differentPathIsUncertain)
    {
        ArgumentNullException.ThrowIfNull(observedPaths);
        ArgumentException.ThrowIfNullOrWhiteSpace(expectedExecutablePath);

        var uncertain = false;
        foreach (var actualPath in observedPaths)
        {
            if (string.Equals(actualPath, expectedExecutablePath, StringComparison.OrdinalIgnoreCase))
            {
                return RunningProcessStatus.Running;
            }

            // Strict game checks treat a different path as a possible older game
            // root. Ordinary checks preserve the existing behavior needed for
            // generic publisher process names such as launcher.exe.
            uncertain |= actualPath is null || differentPathIsUncertain;
        }

        return uncertain ? RunningProcessStatus.Uncertain : RunningProcessStatus.NotRunning;
    }
}

internal interface IWindowsProcessPathQuery
{
    IReadOnlyList<string?> QueryExecutablePaths(string processName);
}

/// <summary>
/// Reads only the executable image path from same-name processes. The Windows
/// handle requests PROCESS_QUERY_LIMITED_INFORMATION, which is specifically
/// sufficient for QueryFullProcessImageName and can inspect elevated processes
/// without making Nyx elevated. Every failed/racing candidate is retained as
/// unknown evidence rather than being converted to absence.
/// </summary>
internal sealed class LimitedInformationWindowsProcessPathQuery : IWindowsProcessPathQuery
{
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const int MaximumWindowsPathCharacters = 32768;

    public IReadOnlyList<string?> QueryExecutablePaths(string processName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(processName);

        var paths = new List<string?>();
        foreach (var process in Process.GetProcessesByName(processName))
        {
            using (process)
            {
                try
                {
                    paths.Add(QueryExecutablePath(process.Id));
                }
                catch (Exception exception) when (exception is Win32Exception
                                                      or InvalidOperationException
                                                      or NotSupportedException
                                                      or UnauthorizedAccessException
                                                      or SecurityException)
                {
                    // The process may have exited between enumeration and query,
                    // or Windows may deny even limited information. Both are
                    // uncertain same-name evidence and must fail closed.
                    paths.Add(null);
                }
            }
        }

        return paths;
    }

    private static string? QueryExecutablePath(int processId)
    {
        using var handle = OpenProcess(
            ProcessQueryLimitedInformation,
            inheritHandle: false,
            checked((uint)processId));
        if (handle.IsInvalid)
        {
            return null;
        }

        var path = new StringBuilder(MaximumWindowsPathCharacters);
        var capacity = checked((uint)path.Capacity);
        return QueryFullProcessImageName(handle, flags: 0, path, ref capacity)
            && capacity > 0
            ? path.ToString()
            : null;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeProcessHandle OpenProcess(
        uint desiredAccess,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandle,
        uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(
        SafeProcessHandle process,
        uint flags,
        StringBuilder executablePath,
        ref uint size);
}

public sealed class DotNetLaunchProcessStarter
    : ILaunchProcessStarter,
      IGenshinElevatedProcessStarter,
      IHoyoGameElevatedProcessStarter,
      IPublisherGameElevatedProcessStarter
{
    public void Start(LaunchSpecification specification)
    {
        ArgumentNullException.ThrowIfNull(specification);
        if (specification.UseShellExecute
            || specification.Arguments.Count != 0
            || string.IsNullOrWhiteSpace(specification.FileName)
            || string.IsNullOrWhiteSpace(specification.WorkingDirectory))
        {
            throw new InvalidOperationException("Only exact, argument-free, non-shell starts are allowed.");
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = specification.FileName,
            WorkingDirectory = specification.WorkingDirectory,
            UseShellExecute = false,
        };

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("The process did not start.");
    }

    public void StartValidatedGenshin(ValidatedGenshinElevationRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var specification = request.Specification;
        if (specification.UseShellExecute
            || specification.Arguments.Count != 0
            || !string.Equals(
                Path.GetFileName(specification.FileName),
                "GenshinImpact.exe",
                StringComparison.OrdinalIgnoreCase)
            || !string.Equals(
                Path.GetDirectoryName(specification.FileName),
                specification.WorkingDirectory,
                StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Only an internally validated Genshin launch can request elevation.");
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = specification.FileName,
            WorkingDirectory = specification.WorkingDirectory,
            UseShellExecute = true,
            Verb = "runas",
        };

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("The elevated Genshin process did not start.");
    }

    public void StartValidatedHoyoGame(ValidatedHoyoGameElevationRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var specification = request.Specification;
        var expectedExecutableName = request.GameId switch
        {
            "hsr" => "StarRail.exe",
            "zzz" => "ZenlessZoneZero.exe",
            _ => null,
        };
        if (expectedExecutableName is null
            || specification.UseShellExecute
            || specification.Arguments.Count != 0
            || !string.Equals(
                Path.GetFileName(specification.FileName),
                expectedExecutableName,
                StringComparison.OrdinalIgnoreCase)
            || !string.Equals(
                Path.GetDirectoryName(specification.FileName),
                specification.WorkingDirectory,
                StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Only an internally validated HSR or ZZZ launch can request elevation.");
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = specification.FileName,
            WorkingDirectory = specification.WorkingDirectory,
            UseShellExecute = true,
            Verb = "runas",
        };

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("The elevated HoYo game process did not start.");
    }

    public void StartValidatedPublisherGame(ValidatedPublisherGameElevationRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var specification = request.Specification;
        var expectedRelativePath = request.GameId switch
        {
            "wuwa" => @"Wuthering Waves Game\Wuthering Waves.exe",
            "ae" => @"games\EndField Game\Endfield.exe",
            _ => null,
        };
        var expectedPath = expectedRelativePath is null
            ? null
            : Path.Combine(request.CanonicalRoot, expectedRelativePath);
        if (expectedPath is null
            || specification.UseShellExecute
            || specification.Arguments.Count != 0
            || !string.Equals(
                specification.FileName,
                expectedPath,
                StringComparison.OrdinalIgnoreCase)
            || !string.Equals(
                Path.GetDirectoryName(specification.FileName),
                specification.WorkingDirectory,
                StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Only an internally validated WuWa or Endfield game can request elevation.");
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = specification.FileName,
            WorkingDirectory = specification.WorkingDirectory,
            UseShellExecute = true,
            Verb = "runas",
        };

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("The elevated publisher game did not start.");
    }
}
