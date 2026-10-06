namespace iPresenterPlux.Edge.Core.Runtime;

public static class EdgeHostLifecycle
{
    public static async Task RunUntilShutdownRequestedAsync(
        EdgeAgentRuntime runtime,
        string dataDirectory,
        DateTimeOffset hostStartedAt,
        CancellationTokenSource cancellation)
    {
        ArgumentNullException.ThrowIfNull(runtime);
        ArgumentException.ThrowIfNullOrWhiteSpace(dataDirectory);
        ArgumentNullException.ThrowIfNull(cancellation);

        var signal = new FileEdgeHostShutdownSignal(dataDirectory);
        var runtimeTask = runtime.RunAsync(cancellation.Token);
        var shutdownTask = signal.WaitAsync(hostStartedAt, cancellation.Token);
        try
        {
            var completed = await Task.WhenAny(runtimeTask, shutdownTask).ConfigureAwait(false);
            if (completed == shutdownTask && !cancellation.IsCancellationRequested)
                cancellation.Cancel();
            await runtimeTask.ConfigureAwait(false);
        }
        finally
        {
            if (!cancellation.IsCancellationRequested) cancellation.Cancel();
            try { await shutdownTask.ConfigureAwait(false); }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
        }
    }
}
