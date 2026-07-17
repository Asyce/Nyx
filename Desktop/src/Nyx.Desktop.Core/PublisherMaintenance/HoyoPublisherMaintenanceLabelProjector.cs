namespace Nyx.Desktop.Core.PublisherMaintenance;

public static class HoyoPublisherMaintenanceLabelProjector
{
    public static string Project(HoyoPublisherStatusResult? result, string gameId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(gameId);
        var publisherGameId = gameId == "gi" ? "genshin" : gameId;

        if (result is null)
        {
            return "Checking for updates…";
        }

        var status = result.Current.FirstOrDefault(game => game.GameId == publisherGameId);
        if (result.Failure is not PublisherCheckFailure.None
            || status is null
            || status.Observation is not PublisherObservationState.Available
            || status.Update is PublisherUpdateState.Unknown)
        {
            return "Check in HoYoPlay";
        }

        return (status.Update, status.PreDownload) switch
        {
            (PublisherUpdateState.UpdateOffered, PublisherPreDownloadState.Offered) =>
                "Update + pre-download available",
            (PublisherUpdateState.UpdateOffered, _) => "Update available",
            (_, PublisherPreDownloadState.Offered) => "Pre-download available",
            (PublisherUpdateState.Current, _) => "Up to date",
            _ => "Check in HoYoPlay",
        };
    }
}
