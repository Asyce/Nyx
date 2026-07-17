using Nyx.Desktop.Core.PublisherGames;
using Nyx.Desktop.Infrastructure.PublisherGames;

namespace Nyx.Desktop.ReadOnlyPilot;

internal sealed record PilotRequest(string GameId, string Root);

internal sealed record PilotOutput(
    string GameId,
    string Status,
    string Reason,
    string VersionState,
    string? Version,
    bool HasFullInstallMaintenanceProof,
    bool AllowsDirectGameLaunch,
    bool ReadOnly)
{
    public static PilotOutput From(PublisherGameInspectionResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return new(
            result.GameId,
            result.Status.ToString(),
            result.Reason.ToString(),
            result.VersionState.ToString(),
            result.Version,
            result.HasFullInstallMaintenanceProof,
            result.AllowsDirectGameLaunch,
            ReadOnly: true);
    }
}

internal static class PilotCommand
{
    private const int MaximumRootLength = 32_767;

    public static bool TryParse(
        IReadOnlyList<string> arguments,
        out PilotRequest? request)
    {
        request = null;
        if (arguments.Count != 4)
        {
            return false;
        }

        string? gameId = null;
        string? root = null;
        for (var index = 0; index < arguments.Count; index += 2)
        {
            var name = arguments[index];
            var value = arguments[index + 1];
            switch (name)
            {
                case "--game" when gameId is null:
                    gameId = value;
                    break;
                case "--root" when root is null:
                    root = value;
                    break;
                default:
                    return false;
            }
        }

        if (gameId is not ("wuwa" or "ae")
            || string.IsNullOrWhiteSpace(root)
            || root.Length > MaximumRootLength)
        {
            return false;
        }

        request = new(gameId, root);
        return true;
    }

    public static PilotOutput Inspect(PilotRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("The read-only pilot requires Windows.");
        }

        var result = request.GameId switch
        {
            "wuwa" => new WuWaIdentityAdapter().Inspect(request.Root),
            "ae" => new EndfieldIdentityAdapter().Inspect(request.Root),
            _ => throw new ArgumentOutOfRangeException(nameof(request)),
        };

        return PilotOutput.From(result);
    }
}
