using Nyx.Desktop.Core.Genshin;
using Nyx.Desktop.Core.Launching;

namespace Nyx.Desktop.Infrastructure.Genshin;

public sealed class GenshinLaunchIdentityValidator(GenshinInspectionAdapter adapter)
    : IGenshinLaunchIdentityValidator
{
    private readonly GenshinInspectionAdapter adapter =
        adapter ?? throw new ArgumentNullException(nameof(adapter));

    public GenshinInspectionResult ValidateGame(string? root) =>
        adapter.InspectGame(root, GenshinPathOrigin.PreviouslySaved);

    public GenshinInspectionResult ValidateUpdater(string? root) =>
        adapter.InspectUpdater(root, GenshinPathOrigin.PreviouslySaved);
}
