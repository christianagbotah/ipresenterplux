using System.Diagnostics;

namespace Lightworld.Update.Helper;

public static class ParentProcessExitWaiter
{
    public static async Task WaitAsync(
        int parentProcessId,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        if (parentProcessId <= 0) return;
        if (timeout <= TimeSpan.Zero || timeout > TimeSpan.FromMinutes(2))
            throw new ArgumentOutOfRangeException(nameof(timeout));

        Process? parent;
        try
        {
            parent = Process.GetProcessById(parentProcessId);
        }
        catch (ArgumentException)
        {
            return;
        }

        using (parent)
        {
            if (parent.HasExited) return;
            using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            bounded.CancelAfter(timeout);
            try
            {
                await parent.WaitForExitAsync(bounded.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw new TimeoutException("The running desktop did not exit before the update switch timeout.");
            }
        }
    }
}
