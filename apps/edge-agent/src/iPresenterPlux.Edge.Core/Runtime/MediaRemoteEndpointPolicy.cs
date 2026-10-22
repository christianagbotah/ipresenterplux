using System.Net;
using System.Net.Sockets;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed record ApprovedMediaRemoteEndpoint(Uri Uri, IReadOnlyList<IPAddress> Addresses);

public sealed class MediaRemoteEndpointPolicy
{
    private readonly Func<string, CancellationToken, Task<IPAddress[]>> _resolver;
    private readonly Func<IPAddress, int, CancellationToken, ValueTask<Stream>> _connector;

    public MediaRemoteEndpointPolicy(
        Func<string, CancellationToken, Task<IPAddress[]>>? resolver = null,
        Func<IPAddress, int, CancellationToken, ValueTask<Stream>>? connector = null)
    {
        _resolver = resolver ?? ((host, cancellationToken) => Dns.GetHostAddressesAsync(host, cancellationToken));
        _connector = connector ?? ConnectSocketAsync;
    }

    public async Task<ApprovedMediaRemoteEndpoint> ApproveAsync(Uri uri, CancellationToken cancellationToken)
    {
        if (uri is null || !uri.IsAbsoluteUri ||
            !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
            !string.IsNullOrEmpty(uri.UserInfo) || string.IsNullOrWhiteSpace(uri.Host))
        {
            throw Unsafe();
        }

        IPAddress[] addresses;
        if (IPAddress.TryParse(uri.Host, out var literal))
        {
            addresses = [literal];
        }
        else
        {
            try
            {
                addresses = await _resolver(uri.DnsSafeHost, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception error)
            {
                throw new MediaAssetCacheException("media_remote_unavailable", "Media hostname could not be resolved.", error);
            }
        }

        if (addresses.Length == 0 || addresses.Any(address => !IsPublic(address))) throw Unsafe();
        return new ApprovedMediaRemoteEndpoint(uri, Array.AsReadOnly(addresses.ToArray()));
    }

    public async ValueTask<Stream> ConnectApprovedHostAsync(string host, int port, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(host) || port is < 1 or > 65535) throw Unsafe();
        IPAddress[] addresses;
        if (IPAddress.TryParse(host, out var literal)) addresses = [literal];
        else addresses = await _resolver(host, cancellationToken).ConfigureAwait(false);
        if (addresses.Length == 0 || addresses.Any(address => !IsPublic(address))) throw Unsafe();

        Exception? last = null;
        foreach (var address in addresses)
        {
            try
            {
                return await _connector(address, port, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception error)
            {
                last = error;
            }
        }
        throw new MediaAssetCacheException("media_remote_unavailable", "Approved media endpoint could not be reached.", last);
    }

    public SocketsHttpHandler CreateHttpHandler() => new()
    {
        AllowAutoRedirect = false,
        UseProxy = false,
        ConnectCallback = (context, cancellationToken) =>
            ConnectApprovedHostAsync(context.DnsEndPoint.Host, context.DnsEndPoint.Port, cancellationToken)
    };

    private static async ValueTask<Stream> ConnectSocketAsync(IPAddress address, int port, CancellationToken cancellationToken)
    {
        var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(new IPEndPoint(address, port), cancellationToken).ConfigureAwait(false);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }

    private static bool IsPublic(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) return IsPublic(address.MapToIPv4());
        if (IPAddress.IsLoopback(address) || address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any)) return false;

        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            var a = bytes[0];
            var b = bytes[1];
            if (a == 0 || a == 10 || a == 127 || a >= 224) return false;
            if (a == 100 && b is >= 64 and <= 127) return false;
            if (a == 169 && b == 254) return false;
            if (a == 172 && b is >= 16 and <= 31) return false;
            if (a == 192 && b == 168) return false;
            return true;
        }

        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (address.IsIPv6LinkLocal || address.IsIPv6Multicast || address.IsIPv6SiteLocal) return false;
            if ((bytes[0] & 0xFE) == 0xFC) return false;
            return !address.Equals(IPAddress.IPv6None);
        }

        return false;
    }

    private static MediaAssetCacheException Unsafe() =>
        new("media_remote_unsafe", "Media remote endpoint is not safe for Edge retrieval.");
}
