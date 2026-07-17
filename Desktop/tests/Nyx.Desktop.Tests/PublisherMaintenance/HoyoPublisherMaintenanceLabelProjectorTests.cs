using Nyx.Desktop.Core.PublisherMaintenance;

namespace Nyx.Desktop.Tests.PublisherMaintenance;

public sealed class HoyoPublisherMaintenanceLabelProjectorTests
{
    [Fact]
    public void Missing_local_version_never_turns_a_predownload_fact_into_a_local_claim()
    {
        var result = Result(
            new HoyoPublisherGameStatus(
                "hsr",
                PublisherObservationState.Available,
                PublisherUpdateState.Unknown,
                PublisherPreDownloadState.Offered,
                "4.3.0",
                "4.4.0",
                PublisherOptionalSignal.NotAdvertised,
                PublisherOptionalSignal.Advertised));

        var label = HoyoPublisherMaintenanceLabelProjector.Project(result, "hsr");

        Assert.Equal("Check in HoYoPlay", label);
    }

    [Theory]
    [InlineData(PublisherUpdateState.UpdateOffered, PublisherPreDownloadState.Offered, "Update + pre-download available")]
    [InlineData(PublisherUpdateState.UpdateOffered, PublisherPreDownloadState.NotOffered, "Update available")]
    [InlineData(PublisherUpdateState.Current, PublisherPreDownloadState.Offered, "Pre-download available")]
    [InlineData(PublisherUpdateState.Current, PublisherPreDownloadState.NotOffered, "Up to date")]
    public void Known_statuses_have_one_conservative_label(
        PublisherUpdateState update,
        PublisherPreDownloadState preDownload,
        string expected)
    {
        var status = new HoyoPublisherGameStatus(
            "genshin",
            PublisherObservationState.Available,
            update,
            preDownload,
            "6.7.0",
            preDownload is PublisherPreDownloadState.Offered ? "6.8.0" : null,
            PublisherOptionalSignal.NotAdvertised,
            PublisherOptionalSignal.NotAdvertised);

        Assert.Equal(expected, HoyoPublisherMaintenanceLabelProjector.Project(Result(status), "gi"));
    }

    [Fact]
    public void No_result_is_still_checking()
    {
        Assert.Equal(
            "Checking for updates…",
            HoyoPublisherMaintenanceLabelProjector.Project(null, "zzz"));
    }

    private static HoyoPublisherStatusResult Result(HoyoPublisherGameStatus replacement)
    {
        var statuses = new[]
        {
            Current("genshin", "6.7.0"),
            Current("hsr", "4.3.0"),
            Current("zzz", "2.3.0"),
        };
        statuses[replacement.GameId switch
        {
            "genshin" => 0,
            "hsr" => 1,
            "zzz" => 2,
            _ => throw new ArgumentOutOfRangeException(nameof(replacement)),
        }] = replacement;

        return new HoyoPublisherStatusResult(
            DateTimeOffset.UtcNow,
            PublisherCheckFailure.None,
            statuses);
    }

    private static HoyoPublisherGameStatus Current(string gameId, string version) => new(
        gameId,
        PublisherObservationState.Available,
        PublisherUpdateState.Current,
        PublisherPreDownloadState.NotOffered,
        version,
        null,
        PublisherOptionalSignal.NotAdvertised,
        PublisherOptionalSignal.NotAdvertised);
}
