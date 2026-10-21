using System.Security.Cryptography;
using Lightworld.Update.Client;
using Xunit;

namespace Lightworld.Update.Client.Tests;

public sealed class PackageVerifierTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "lightworld-package-verifier-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task VerifyAcceptsMatchingSizeAndSha256()
    {
        Directory.CreateDirectory(_directory);
        var path = Path.Combine(_directory, "package.zip");
        var bytes = "verified package"u8.ToArray();
        await File.WriteAllBytesAsync(path, bytes);
        var sha = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        await PackageVerifier.VerifyAsync(path, bytes.Length, sha, CancellationToken.None);
    }

    [Fact]
    public async Task VerifyRejectsSizeMismatch()
    {
        Directory.CreateDirectory(_directory);
        var path = Path.Combine(_directory, "package.zip");
        await File.WriteAllTextAsync(path, "abc");
        await Assert.ThrowsAsync<InvalidDataException>(() => PackageVerifier.VerifyAsync(path, 4, new string('0', 64), CancellationToken.None));
    }

    [Fact]
    public async Task VerifyRejectsHashMismatch()
    {
        Directory.CreateDirectory(_directory);
        var path = Path.Combine(_directory, "package.zip");
        await File.WriteAllTextAsync(path, "abc");
        await Assert.ThrowsAsync<InvalidDataException>(() => PackageVerifier.VerifyAsync(path, 3, new string('0', 64), CancellationToken.None));
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
    }
}
