using System.Text;
using Nyx.Desktop.Core.AccountStatus;
using Nyx.Desktop.Infrastructure.AccountStatus;

namespace Nyx.Desktop.Tests.AccountStatus;

public sealed class PublisherRoleBindingStoreTests
{
    [Fact]
    public void Role_binding_is_current_user_protected_and_provider_delete_clears_it()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "nyx-protected-role-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new PublisherRoleBindingStore(root);
            var binding = new PublisherRoleBinding("123456789", "os_euro");

            Assert.True(store.Save("gi", binding));
            var path = Path.Combine(root, ".protected-role-bindings", "gi.bin");
            var ciphertext = File.ReadAllBytes(path);
            Assert.Equal(-1, ciphertext.AsSpan().IndexOf(Encoding.UTF8.GetBytes(binding.RoleId)));
            Assert.Equal(binding, store.TryLoad("gi"));

            Assert.True(store.DeleteProvider("HoYoLAB"));
            Assert.Null(store.TryLoad("gi"));
            Assert.False(File.Exists(path));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Theory]
    [InlineData("ae", "123456789", "os_euro")]
    [InlineData("gi", "not-a-uid", "os_euro")]
    [InlineData("gi", "123456789", "attacker")]
    public void Unsupported_or_malformed_bindings_are_never_written(
        string gameId,
        string roleId,
        string server)
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "nyx-invalid-role-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new PublisherRoleBindingStore(root);

            Assert.False(store.Save(gameId, new(roleId, server)));
            Assert.Null(store.TryLoad(gameId));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Corrupt_ciphertext_and_unprotect_failure_fail_closed()
    {
        var root = NewRoot("nyx-corrupt-role-tests-");
        try
        {
            var binding = new PublisherRoleBinding("123456789", "os_euro");
            var store = new PublisherRoleBindingStore(root);
            Assert.True(store.Save("gi", binding));
            var path = BindingPath(root, "gi");
            File.WriteAllBytes(path, [0x01, 0x02, 0x03, 0x04]);
            Assert.Null(store.TryLoad("gi"));

            var passthrough = new FaultProtector();
            var injectable = new PublisherRoleBindingStore(root, passthrough);
            Assert.True(injectable.Save("gi", binding));
            passthrough.FailUnprotect = true;
            Assert.Null(injectable.TryLoad("gi"));
        }
        finally
        {
            DeleteRoot(root);
        }
    }

    [Fact]
    public void Protect_failure_and_oversized_ciphertext_are_never_persisted()
    {
        var root = NewRoot("nyx-protector-failure-tests-");
        try
        {
            var protector = new FaultProtector { FailProtect = true };
            var store = new PublisherRoleBindingStore(root, protector);
            var binding = new PublisherRoleBinding("123456789", "os_euro");
            Assert.False(store.Save("gi", binding));
            Assert.False(File.Exists(BindingPath(root, "gi")));

            protector.FailProtect = false;
            protector.ProtectedLength = 16 * 1024 + 1;
            Assert.False(store.Save("gi", binding));
            Assert.False(File.Exists(BindingPath(root, "gi")));
        }
        finally
        {
            DeleteRoot(root);
        }
    }

    [Fact]
    public void Oversized_ciphertext_is_rejected_before_unprotect()
    {
        var root = NewRoot("nyx-oversized-role-tests-");
        try
        {
            var path = BindingPath(root, "gi");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllBytes(path, new byte[16 * 1024 + 1]);
            var protector = new FaultProtector();

            Assert.Null(new PublisherRoleBindingStore(root, protector).TryLoad("gi"));
            Assert.Equal(0, protector.UnprotectCalls);
        }
        finally
        {
            DeleteRoot(root);
        }
    }

    [Fact]
    public void Reparse_binding_interrupted_move_and_denied_delete_fail_closed()
    {
        var root = NewRoot("nyx-role-boundary-tests-");
        try
        {
            var binding = new PublisherRoleBinding("123456789", "os_euro");
            var boundary = new FaultFileBoundary();
            var store = new PublisherRoleBindingStore(root, new FaultProtector(), boundary);
            var path = BindingPath(root, "gi");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllBytes(path, [0x01]);

            boundary.ReparsePath = path;
            Assert.Null(store.TryLoad("gi"));
            Assert.False(store.Save("gi", binding));

            boundary.ReparsePath = null;
            boundary.FailMove = true;
            Assert.False(store.Save("gi", binding));
            Assert.Empty(Directory.EnumerateFiles(
                Path.GetDirectoryName(path)!,
                "gi.bin.tmp.*"));
            Assert.Equal(new byte[] { 0x01 }, File.ReadAllBytes(path));

            boundary.FailMove = false;
            Assert.True(store.Save("gi", binding));
            boundary.FailDelete = true;
            Assert.False(store.Delete("gi"));
            Assert.True(File.Exists(path));
        }
        finally
        {
            DeleteRoot(root);
        }
    }

    private static string NewRoot(string prefix) => Path.Combine(
        Path.GetTempPath(),
        prefix + Guid.NewGuid().ToString("N"));

    private static string BindingPath(string root, string gameId) =>
        Path.Combine(root, ".protected-role-bindings", gameId + ".bin");

    private static void DeleteRoot(string root)
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }

    private sealed class FaultProtector : IPublisherRoleBindingProtector
    {
        public bool FailProtect { get; set; }
        public bool FailUnprotect { get; set; }
        public int? ProtectedLength { get; set; }
        public int UnprotectCalls { get; private set; }

        public byte[] Protect(byte[] plaintext)
        {
            if (FailProtect) throw new System.Security.Cryptography.CryptographicException();
            return ProtectedLength is { } length ? new byte[length] : [.. plaintext];
        }

        public byte[] Unprotect(byte[] ciphertext)
        {
            UnprotectCalls++;
            if (FailUnprotect) throw new System.Security.Cryptography.CryptographicException();
            return [.. ciphertext];
        }
    }

    private sealed class FaultFileBoundary : IPublisherRoleBindingFileBoundary
    {
        private readonly SystemPublisherRoleBindingFileBoundary inner = new();

        public string? ReparsePath { get; set; }
        public bool FailMove { get; set; }
        public bool FailDelete { get; set; }

        public void CreateDirectory(string path) => inner.CreateDirectory(path);

        public bool Exists(string path) => inner.Exists(path);

        public FileAttributes GetAttributes(string path) =>
            string.Equals(path, ReparsePath, StringComparison.Ordinal)
                ? FileAttributes.ReparsePoint
                : inner.GetAttributes(path);

        public FileStream OpenRead(string path) => inner.OpenRead(path);

        public FileStream CreateNewWriteThrough(string path) =>
            inner.CreateNewWriteThrough(path);

        public void MoveOverwrite(string source, string destination)
        {
            if (FailMove) throw new IOException("Injected interrupted move.");
            inner.MoveOverwrite(source, destination);
        }

        public void Delete(string path)
        {
            if (FailDelete) throw new UnauthorizedAccessException("Injected delete denial.");
            inner.Delete(path);
        }
    }
}
