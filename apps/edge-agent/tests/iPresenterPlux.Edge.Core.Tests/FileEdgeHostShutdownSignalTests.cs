using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class FileEdgeHostShutdownSignalTests : IDisposable
{
    private readonly string _directory = Path.Combine(
        Path.GetTempPath(), "ipresenterplux-desktop-shutdown-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task FreshRequestStopsCurrentHostAndIsConsumed()
    {
        var signal = new FileEdgeHostShutdownSignal(_directory);
        var startedAt = DateTimeOffset.UtcNow.AddMilliseconds(-50);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));

        var waiter = signal.WaitAsync(startedAt, timeout.Token);
        await signal.RequestAsync(timeout.Token);
        await waiter;

        Assert.False(File.Exists(signal.RequestPath));
    }

    [Fact]
    public async Task StaleRequestCannotStopNewHost()
    {
        Directory.CreateDirectory(_directory);
        var signal = new FileEdgeHostShutdownSignal(_directory);
        await File.WriteAllTextAsync(signal.RequestPath, DateTimeOffset.UtcNow.AddMinutes(-5).ToString("O"));
        var startedAt = DateTimeOffset.UtcNow;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));

        var waiter = signal.WaitAsync(startedAt, timeout.Token);
        await Task.Delay(400, timeout.Token);
        Assert.False(waiter.IsCompleted);
        Assert.False(File.Exists(signal.RequestPath));

        await signal.RequestAsync(timeout.Token);
        await waiter;
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }
}
