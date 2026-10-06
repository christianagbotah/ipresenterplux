using iPresenterPlux.Edge.Core.Transport;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class SrtPublishTargetTests
{
    [Fact]
    public void ParsesExpectedMediaMtxGrantWithoutExposingCredentialInDiagnostics()
    {
        const string token = "fixture-secret-token";
        var uri = new Uri(
            "srt://router.example.test:8890/?streamid=publish%3Aedge-session%3Aedge%3A" + token + "&pkt_size=1316");

        var target = SrtPublishTarget.Parse(uri);

        Assert.Equal("router.example.test", target.Host);
        Assert.Equal(8890, target.Port);
        Assert.Equal(1316, target.PayloadSize);
        Assert.DoesNotContain(token, target.ToString(), StringComparison.Ordinal);
        Assert.Contains("[redacted]", target.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void RejectsUnexpectedQueryOptionsAndDuplicates()
    {
        Assert.Throws<ArgumentException>(() => SrtPublishTarget.Parse(new Uri(
            "srt://router.example.test:8890/?streamid=publish%3Aa%3Aedge%3Ab&pkt_size=1316&latency=100")));
        Assert.Throws<ArgumentException>(() => SrtPublishTarget.Parse(new Uri(
            "srt://router.example.test:8890/?streamid=publish%3Aa%3Aedge%3Ab&streamid=publish%3Aa%3Aedge%3Ac&pkt_size=1316")));
    }

    [Fact]
    public void RejectsWrongPayloadSizeMissingPortAndUriCredentials()
    {
        Assert.Throws<ArgumentException>(() => SrtPublishTarget.Parse(new Uri(
            "srt://router.example.test:8890/?streamid=publish%3Aa%3Aedge%3Ab&pkt_size=1400")));
        Assert.Throws<ArgumentException>(() => SrtPublishTarget.Parse(new Uri(
            "srt://router.example.test/?streamid=publish%3Aa%3Aedge%3Ab&pkt_size=1316")));
        Assert.Throws<ArgumentException>(() => SrtPublishTarget.Parse(new Uri(
            "srt://user:password@router.example.test:8890/?streamid=publish%3Aa%3Aedge%3Ab&pkt_size=1316")));
    }

    [Fact]
    public void RejectsMalformedOrOversizedStreamIds()
    {
        Assert.Throws<ArgumentException>(() => SrtPublishTarget.Parse(new Uri(
            "srt://router.example.test:8890/?streamid=read%3Aa%3Aedge%3Ab&pkt_size=1316")));
        var oversized = "publish:a:edge:" + new string('x', 500);
        Assert.True(oversized.Length > 512);
        Assert.Throws<ArgumentException>(() => SrtPublishTarget.Parse(new Uri(
            $"srt://router.example.test:8890/?streamid={Uri.EscapeDataString(oversized)}&pkt_size=1316")));
    }
}
