using Nyx.Desktop.Infrastructure.AccountStatus;

namespace Nyx.Desktop.Tests.AccountStatus;

public sealed class PublisherConsentRevocationStoreTests
{
    [Fact]
    public void Pending_marker_contains_no_account_material_and_survives_restart()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "nyx-publisher-revocation-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var first = new PublisherConsentRevocationStore(root);
            Assert.False(first.IsPending("HoYoLAB"));
            Assert.True(first.MarkPending("HoYoLAB"));
            Assert.True(first.IsPending("HoYoLAB"));
            Assert.False(first.IsPending("SKPORT"));

            var second = new PublisherConsentRevocationStore(root);
            Assert.True(second.IsPending("HoYoLAB"));
            var marker = Directory.GetFiles(root, "*.pending", SearchOption.AllDirectories);
            var path = Assert.Single(marker);
            Assert.Equal(0, new FileInfo(path).Length);
            Assert.True(second.Clear("HoYoLAB"));
            Assert.False(second.IsPending("HoYoLAB"));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Theory]
    [InlineData("")]
    [InlineData("unknown")]
    [InlineData("../HoYoLAB")]
    public void Unknown_provider_fails_closed_without_creating_a_marker(string provider)
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "nyx-publisher-revocation-invalid-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new PublisherConsentRevocationStore(root);
            Assert.True(store.IsPending(provider));
            Assert.False(store.MarkPending(provider));
            Assert.False(store.Clear(provider));
            Assert.False(Directory.Exists(root));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }
}
