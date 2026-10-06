using iPresenterPlux.Edge.Core.Abstractions;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class StreamContributionGrantTests
{
    [Fact]
    public void DiagnosticsDoNotExposePublishUriDetails()
    {
        var serviceId = Guid.NewGuid();
        var sessionId = Guid.NewGuid();
        var path = $"edge-{sessionId:D}";
        const string privateMarker = "private-value-redaction-check";
        var uri = new Uri($"srt://router.example.test:8890?streamid=publish%3A{path}%3Aedge%3A{privateMarker}&pkt_size=1316");
        var grant = new StreamContributionGrant(
            sessionId,
            serviceId,
            path,
            "srt",
            uri,
            DateTimeOffset.Parse("2026-10-06T02:05:00Z"));

        var diagnostic = grant.ToString();

        Assert.DoesNotContain(privateMarker, diagnostic, StringComparison.Ordinal);
        Assert.DoesNotContain("streamid", diagnostic, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(path, diagnostic, StringComparison.Ordinal);
        Assert.Contains(serviceId.ToString("D"), diagnostic, StringComparison.OrdinalIgnoreCase);
    }
}
