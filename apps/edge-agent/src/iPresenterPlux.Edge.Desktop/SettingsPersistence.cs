namespace iPresenterPlux.Edge.Desktop;

/// <summary>
/// Context-free synchronous persistence for workspace settings.
///
/// Every caller (<see cref="MainWindow"/> pane collapse, preset switch and
/// window close) runs on the UI thread. Awaiting the settings store directly
/// from there lets the store's internal awaits capture the UI dispatcher;
/// blocking that same dispatcher on the result then deadlocks shutdown
/// whenever the file write goes genuinely asynchronous — the window is gone
/// but the process lingers. Marshalling the save to the thread pool removes
/// the captured context, so the synchronous wait always completes.
/// </summary>
internal static class SettingsPersistence
{
    /// <summary>
    /// Runs <paramref name="save"/> on the thread pool and waits for it.
    /// The delegate must not post back to a captured UI context; inside this
    /// helper it executes on a pool thread where no context is captured.
    /// </summary>
    public static void RunBlockingWithoutCapture(Func<Task> save)
    {
        ArgumentNullException.ThrowIfNull(save);
        Task.Run(save).GetAwaiter().GetResult();
    }
}
