namespace iPresenterPlux.Edge.Desktop;

public static class LocalOutputLinkPolicy
{
    public static bool CanOpen(EdgeDesktopSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        return snapshot.LocalProgramHealthy &&
            snapshot.State is EdgeDesktopRuntimeState.Active or EdgeDesktopRuntimeState.Degraded;
    }
}
