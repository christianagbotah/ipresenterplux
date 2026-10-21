using System.Security.Cryptography;

namespace Lightworld.Update.Client;

public static class PackageVerifier
{
    public static async Task VerifyAsync(
        string path,
        long expectedSize,
        string expectedSha256,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        if (expectedSize < 0) throw new ArgumentOutOfRangeException(nameof(expectedSize));
        if (expectedSha256 is null || expectedSha256.Length != 64 || !expectedSha256.All(Uri.IsHexDigit))
            throw new ArgumentException("Expected SHA-256 must be 64 hexadecimal characters.", nameof(expectedSha256));

        var info = new FileInfo(path);
        if (!info.Exists) throw new FileNotFoundException("The staged update package does not exist.", path);
        if (info.Length != expectedSize)
            throw new InvalidDataException($"The staged update package size is invalid. Expected {expectedSize} bytes, found {info.Length}.");

        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var sha256 = SHA256.Create();
        var actual = Convert.ToHexString(await sha256.ComputeHashAsync(stream, cancellationToken).ConfigureAwait(false))
            .ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(actual),
                Convert.FromHexString(expectedSha256)))
            throw new InvalidDataException("The staged update package SHA-256 does not match the signed manifest.");
    }
}
