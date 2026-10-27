using Xunit;

namespace iPresenterPlux.Edge.Desktop.Tests;

/// <summary>
/// Pins the shutdown-safety property of workspace persistence: the settings
/// save must never capture the calling (UI) synchronization context. Blocking
/// the UI dispatcher on a save whose continuation needs that same dispatcher
/// is the shutdown-deadlock shape discovered while capturing v2.2 renders —
/// the window closes but the process lingers.
/// </summary>
public sealed class SettingsPersistenceTests
{
    /// <summary>
    /// A synchronization context that accepts posts but never runs them —
    /// the deterministic stand-in for a blocked UI dispatcher.
    /// </summary>
    private sealed class NeverPumpedSynchronizationContext : SynchronizationContext
    {
        public int PostCount { get; private set; }

        public override void Post(SendOrPostCallback callback, object? state) => PostCount++;

        public override void Send(SendOrPostCallback callback, object? state) =>
            throw new InvalidOperationException("The blocked dispatcher must never be sent to synchronously.");
    }

    [Fact]
    public void RunBlockingWithoutCaptureNeverRoutesTheSaveThroughTheCallingContext()
    {
        var poison = new NeverPumpedSynchronizationContext();
        var previous = SynchronizationContext.Current;
        SynchronizationContext.SetSynchronizationContext(poison);
        try
        {
            var ranToCompletion = false;

            SettingsPersistence.RunBlockingWithoutCapture(async () =>
            {
                // Task.Yield captures SynchronizationContext.Current: without
                // the thread-pool marshalling this continuation is posted to
                // the poison context and the blocking wait below never returns.
                await Task.Yield();
                await Task.Delay(25);
                ranToCompletion = true;
            });

            Assert.True(ranToCompletion, "the save delegate must run to completion while the caller blocks");
        }
        finally
        {
            SynchronizationContext.SetSynchronizationContext(previous);
        }

        // Nothing may have been routed through the blocked context: with the
        // marshalling in place the delegate's awaits capture no context at all.
        Assert.Equal(0, poison.PostCount);
    }

    [Fact]
    public void RunBlockingWithoutCaptureSurfacesSaveFailuresInsteadOfSwallowingThem()
    {
        // Persistence is best-effort at the call site, but the helper itself
        // must propagate exceptions so callers can decide (a swallowed failure
        // here would silently disable workspace persistence).
        var threw = false;
        try
        {
            SettingsPersistence.RunBlockingWithoutCapture(() => throw new InvalidOperationException("disk on fire"));
        }
        catch (InvalidOperationException)
        {
            threw = true;
        }
        Assert.True(threw);
    }
}
