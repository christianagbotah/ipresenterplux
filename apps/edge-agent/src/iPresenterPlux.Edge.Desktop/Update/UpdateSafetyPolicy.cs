using iPresenterPlux.Edge.Core.Runtime;

namespace iPresenterPlux.Edge.Desktop.Update;

public static class UpdateSafetyPolicy
{
    public static bool IsSafe(LocalOperatorSnapshot snapshot, EdgeDesktopSnapshot runtime)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(runtime);
        return !snapshot.IsRecording &&
               snapshot.Program is null &&
               !snapshot.OutputRunning &&
               !runtime.CriticalLiveSessionActive;
    }
}
