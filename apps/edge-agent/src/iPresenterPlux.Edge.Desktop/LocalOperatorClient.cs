using System.IO.Pipes;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Desktop;

public sealed class LocalOperatorClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        MaxDepth = 16
    };

    private readonly LocalOperatorIpcEndpoint _endpoint;
    private readonly TimeSpan _timeout;

    public LocalOperatorClient(string dataDirectory, TimeSpan? timeout = null)
    {
        _endpoint = LocalOperatorIpcEndpoint.ForDataDirectory(dataDirectory);
        _timeout = timeout ?? TimeSpan.FromSeconds(2);
    }

    public Task<LocalOperatorResponse> QueryAsync(CancellationToken cancellationToken = default) =>
        SendAsync(LocalOperatorCommands.SnapshotQuery, cancellationToken: cancellationToken);

    public Task<LocalOperatorResponse> QueryCatalogAsync(CancellationToken cancellationToken = default) =>
        SendAsync(LocalOperatorCommands.CatalogQuery, cancellationToken: cancellationToken);

    public Task<LocalOperatorResponse> ResolveScriptureAsync(
        string reference,
        string? version = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reference);
        reference = reference.Trim();
        if (reference.Length > 120) throw new ArgumentOutOfRangeException(nameof(reference));
        if (version is not null)
        {
            version = version.Trim();
            if (version.Length is 0 or > 32) throw new ArgumentOutOfRangeException(nameof(version));
        }
        return SendAsync(
            LocalOperatorCommands.ScriptureResolve,
            cancellationToken: cancellationToken,
            scripture: new LocalOperatorScriptureQuery(reference, version));
    }

    public async Task<LocalOperatorResponse> SendAsync(
        string command,
        LocalOperatorPresentation? presentation = null,
        CancellationToken cancellationToken = default,
        LocalOperatorScriptureQuery? scripture = null)
    {
        if (!LocalOperatorCommands.IsAllowed(command))
            throw new ArgumentOutOfRangeException(nameof(command), "Unsupported local operator command.");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(_timeout);
        var request = new LocalOperatorRequest(Guid.NewGuid().ToString("D"), command, presentation, scripture);

        await using var stream = await ConnectAsync(timeout.Token).ConfigureAwait(false);
        using var reader = new StreamReader(stream, Encoding.UTF8, false, 4096, leaveOpen: true);
        await using var writer = new StreamWriter(stream, new UTF8Encoding(false), 4096, leaveOpen: true)
        {
            AutoFlush = true
        };

        await writer.WriteLineAsync(JsonSerializer.Serialize(request, JsonOptions)).ConfigureAwait(false);
        var line = await reader.ReadLineAsync(timeout.Token).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(line))
            throw new IOException("The Edge runtime closed the local operator channel without a response.");

        var response = JsonSerializer.Deserialize<LocalOperatorResponse>(line, JsonOptions)
            ?? throw new InvalidDataException("The Edge runtime returned an invalid local operator response.");
        if (!string.Equals(response.RequestId, request.RequestId, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The Edge runtime returned a mismatched local operator response.");
        return response;
    }

    private async Task<Stream> ConnectAsync(CancellationToken cancellationToken)
    {
        if (OperatingSystem.IsWindows())
        {
            var pipe = new NamedPipeClientStream(
                ".",
                _endpoint.PipeName,
                PipeDirection.InOut,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            try
            {
                await pipe.ConnectAsync(cancellationToken).ConfigureAwait(false);
                return pipe;
            }
            catch
            {
                await pipe.DisposeAsync().ConfigureAwait(false);
                throw;
            }
        }

        var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        try
        {
            await socket.ConnectAsync(new UnixDomainSocketEndPoint(_endpoint.UnixSocketPath), cancellationToken)
                .ConfigureAwait(false);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }
}
