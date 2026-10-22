using Lightworld.Update.Client;
using Xunit;

namespace Lightworld.Update.Client.Tests;

public sealed class UpdateManifestVerifierTests
{
    private static readonly byte[] PublicKey = Convert.FromHexString("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
    private static readonly byte[] EmptyMessageSignature = Convert.FromHexString(
        "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155" +
        "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");

    [Fact]
    public void VerifyAcceptsKnownEd25519Vector()
    {
        var verifier = new UpdateManifestVerifier(new Dictionary<string, byte[]> { ["test-key"] = PublicKey });
        verifier.Verify([], EmptyMessageSignature, "test-key");
    }

    [Fact]
    public void VerifyRejectsTamperedManifest()
    {
        var verifier = new UpdateManifestVerifier(new Dictionary<string, byte[]> { ["test-key"] = PublicKey });
        Assert.Throws<InvalidDataException>(() => verifier.Verify("x"u8, EmptyMessageSignature, "test-key"));
    }

    [Fact]
    public void VerifyRejectsUnknownKey()
    {
        var verifier = new UpdateManifestVerifier(new Dictionary<string, byte[]> { ["test-key"] = PublicKey });
        Assert.Throws<InvalidDataException>(() => verifier.Verify([], EmptyMessageSignature, "other-key"));
    }
}
