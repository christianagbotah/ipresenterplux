using System.Globalization;

namespace iPresenterPlux.Edge.Core.Runtime;

/// <summary>
/// User-scoped local shutdown request used by the desktop shell to ask the
/// headless Edge host for a graceful cancellation without exposing a network
/// listener or placing credentials in process arguments.
/// </summary>
public sealed class FileEdgeHostShutdownSignal(string dataDirectory)
{
    private const string FileName = "desktop-shutdown.request";
    private readonly string _dataDirectory = !string.IsNullOrWhiteSpace(dataDirectory)
        ? Path.GetFullPath(dataDirectory)
        : throw new ArgumentException("Data directory is required.", nameof(dataDirectory));

    public string RequestPath => Path.Combine(_dataDirectory, FileName);

    public async Task RequestAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_dataDirectory);
        var temporary = RequestPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            var body = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture);
            await File.WriteAllTextAsync(temporary, body, cancellationToken).ConfigureAwait(false);
            File.Move(temporary, RequestPath, overwrite: true);
        }
        finally
        {
            try { if (File.Exists(temporary)) File.Delete(temporary); } catch { }
        }
    }

    public async Task WaitAsync(DateTimeOffset hostStartedAt, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            if (File.Exists(RequestPath))
            {
                string? body = null;
                try { body = await File.ReadAllTextAsync(RequestPath, cancellationToken).ConfigureAwait(false); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }

                DateTimeOffset requestedAt = default;
                var valid = DateTimeOffset.TryParse(
                    body,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind,
                    out requestedAt);

                try { File.Delete(RequestPath); } catch (IOException) { } catch (UnauthorizedAccessException) { }

                if (valid && requestedAt > hostStartedAt)
                    return;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(250), cancellationToken).ConfigureAwait(false);
        }
    }
}
