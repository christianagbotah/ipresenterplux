using System.IO.Pipes;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class LocalOperatorIpcServer : IAsyncDisposable
{
    private const int MaxRequestCharacters = 32_768;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        MaxDepth = 16
    };

    private readonly LocalOperatorIpcEndpoint _endpoint;
    private readonly LocalOperatorCommandHandler _handler;
    private readonly CancellationTokenSource _shutdown = new();
    private Task? _loop;
    private Socket? _unixListener;
    private bool _started;

    public LocalOperatorIpcServer(
        string dataDirectory,
        LocalOperatorCommandHandler handler)
    {
        _endpoint = LocalOperatorIpcEndpoint.ForDataDirectory(dataDirectory);
        _handler = handler ?? throw new ArgumentNullException(nameof(handler));
    }

    public LocalOperatorIpcEndpoint Endpoint => _endpoint;

    public Task StartAsync(CancellationToken cancellationToken = default)
    {
        if (_started) return Task.CompletedTask;
        _started = true;
        var linked = CancellationTokenSource.CreateLinkedTokenSource(_shutdown.Token, cancellationToken);
        _loop = OperatingSystem.IsWindows()
            ? RunNamedPipeAsync(linked.Token)
            : RunUnixSocketAsync(linked.Token);
        return Task.CompletedTask;
    }

    private async Task RunNamedPipeAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            await using var pipe = new NamedPipeServerStream(
                _endpoint.PipeName,
                PipeDirection.InOut,
                1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            try
            {
                await pipe.WaitForConnectionAsync(cancellationToken).ConfigureAwait(false);
                await HandleStreamAsync(pipe, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (IOException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task RunUnixSocketAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_endpoint.UnixSocketPath)!);
        TryDeleteSocketFile();

        var listener = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        _unixListener = listener;
        listener.Bind(new UnixDomainSocketEndPoint(_endpoint.UnixSocketPath));
        listener.Listen(4);
        File.SetUnixFileMode(
            _endpoint.UnixSocketPath,
            UnixFileMode.UserRead | UnixFileMode.UserWrite);

        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                Socket client;
                try
                {
                    client = await listener.AcceptAsync(cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    break;
                }

                await using var stream = new NetworkStream(client, ownsSocket: true);
                try
                {
                    await HandleStreamAsync(stream, cancellationToken).ConfigureAwait(false);
                }
                catch (IOException) when (cancellationToken.IsCancellationRequested)
                {
                    break;
                }
            }
        }
        finally
        {
            try { listener.Close(); } catch { }
            _unixListener = null;
            TryDeleteSocketFile();
        }
    }

    private async Task HandleStreamAsync(Stream stream, CancellationToken cancellationToken)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8, false, 4096, leaveOpen: true);
        await using var writer = new StreamWriter(stream, new UTF8Encoding(false), 4096, leaveOpen: true)
        {
            AutoFlush = true
        };

        LocalOperatorResponse response;
        try
        {
            var line = await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(line) || line.Length > MaxRequestCharacters)
            {
                response = await RejectAsync("request_invalid", cancellationToken).ConfigureAwait(false);
            }
            else
            {
                var request = JsonSerializer.Deserialize<LocalOperatorRequest>(line, JsonOptions);
                response = request is null
                    ? await RejectAsync("request_invalid", cancellationToken).ConfigureAwait(false)
                    : await _handler.HandleAsync(request, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (JsonException)
        {
            response = await RejectAsync("request_invalid", cancellationToken).ConfigureAwait(false);
        }

        await writer.WriteLineAsync(JsonSerializer.Serialize(response, JsonOptions)).ConfigureAwait(false);
    }

    private async Task<LocalOperatorResponse> RejectAsync(string errorCode, CancellationToken cancellationToken)
    {
        var requestId = Guid.NewGuid().ToString("D");
        var snapshot = await _handler.HandleAsync(
            new LocalOperatorRequest(requestId, LocalOperatorCommands.SnapshotQuery),
            cancellationToken).ConfigureAwait(false);
        return snapshot with
        {
            Ok = false,
            State = errorCode,
            ErrorCode = errorCode
        };
    }

    private void TryDeleteSocketFile()
    {
        try
        {
            if (File.Exists(_endpoint.UnixSocketPath)) File.Delete(_endpoint.UnixSocketPath);
        }
        catch { }
    }

    public async ValueTask DisposeAsync()
    {
        _shutdown.Cancel();
        try { _unixListener?.Close(); } catch { }
        if (_loop is not null)
        {
            try { await _loop.ConfigureAwait(false); }
            catch (OperationCanceledException) { }
            catch (ObjectDisposedException) { }
            catch (SocketException) when (_shutdown.IsCancellationRequested) { }
        }
        TryDeleteSocketFile();
        _shutdown.Dispose();
    }
}
