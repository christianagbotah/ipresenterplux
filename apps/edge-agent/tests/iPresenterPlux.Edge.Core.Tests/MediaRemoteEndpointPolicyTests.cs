using System.Net;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class MediaRemoteEndpointPolicyTests
{
    private static readonly IPAddress PublicAddress = IPAddress.Parse("93.184.216.34");

    [Theory]
    [InlineData("http://cdn.example.test/video.mp4")]
    [InlineData("https://user:pass@cdn.example.test/video.mp4")]
    [InlineData("https://127.0.0.1/video.mp4")]
    [InlineData("https://10.0.0.1/video.mp4")]
    [InlineData("https://169.254.10.20/video.mp4")]
    [InlineData("https://[::1]/video.mp4")]
    [InlineData("https://[fe80::1]/video.mp4")]
    [InlineData("https://[fc00::1]/video.mp4")]
    public async Task RejectsUnsafeUrisBeforeTransport(string value)
    {
        var policy = Policy(_ => [PublicAddress]);

        var error = await Assert.ThrowsAsync<MediaAssetCacheException>(
            () => policy.ApproveAsync(new Uri(value), CancellationToken.None));

        Assert.Equal("media_remote_unsafe", error.Code);
    }

    [Fact]
    public async Task AllowsCredentialFreeHttpsHostResolvingOnlyToPublicAddresses()
    {
        var policy = Policy(host =>
        {
            Assert.Equal("cdn.example.test", host);
            return [PublicAddress, IPAddress.Parse("2606:2800:220:1:248:1893:25c8:1946")];
        });

        var approved = await policy.ApproveAsync(
            new Uri("https://cdn.example.test/worship.mp4"), CancellationToken.None);

        Assert.Equal("cdn.example.test", approved.Uri.Host);
        Assert.Equal(2, approved.Addresses.Count);
    }

    [Theory]
    [InlineData("127.0.0.1")]
    [InlineData("10.20.30.40")]
    [InlineData("172.16.0.1")]
    [InlineData("192.168.4.4")]
    [InlineData("169.254.1.1")]
    [InlineData("::1")]
    [InlineData("fe80::42")]
    [InlineData("fd00::42")]
    public async Task RejectsDnsResolutionContainingNonPublicDestination(string address)
    {
        var policy = Policy(_ => [IPAddress.Parse(address)]);

        var error = await Assert.ThrowsAsync<MediaAssetCacheException>(
            () => policy.ApproveAsync(new Uri("https://cdn.example.test/a.mp4"), CancellationToken.None));

        Assert.Equal("media_remote_unsafe", error.Code);
    }

    [Fact]
    public async Task SocketConnectionRevalidatesResolvedDestinationBeforeConnectorRuns()
    {
        var connectorCalls = 0;
        var policy = new MediaRemoteEndpointPolicy(
            (host, _) => Task.FromResult(new[] { IPAddress.Parse("192.168.2.4") }),
            (address, port, _) =>
            {
                connectorCalls++;
                return ValueTask.FromResult<Stream>(Stream.Null);
            });

        var error = await Assert.ThrowsAsync<MediaAssetCacheException>(async () =>
            await policy.ConnectApprovedHostAsync("cdn.example.test", 443, CancellationToken.None));

        Assert.Equal("media_remote_unsafe", error.Code);
        Assert.Equal(0, connectorCalls);
    }

    [Fact]
    public void ProductionHandlerDisablesAutomaticRedirectsAndOwnsConnectCallback()
    {
        var policy = Policy(_ => [PublicAddress]);
        using var handler = policy.CreateHttpHandler();

        Assert.False(handler.AllowAutoRedirect);
        Assert.False(handler.UseProxy);
        Assert.NotNull(handler.ConnectCallback);
    }

    private static MediaRemoteEndpointPolicy Policy(Func<string, IPAddress[]> resolver) =>
        new((host, _) => Task.FromResult(resolver(host)));
}
