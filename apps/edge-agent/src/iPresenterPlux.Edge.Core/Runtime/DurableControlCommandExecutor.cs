using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

/// <summary>
/// Executes control commands exactly once per enrolled device and persists the
/// completed result before it can be acknowledged to the control plane.
/// </summary>
public sealed class DurableControlCommandExecutor(
    Guid organizationId,
    Guid deviceId,
    ICompletedCommandJournal journal,
    ControlCommandProcessor processor)
{
    private readonly Guid _organizationId = organizationId != Guid.Empty
        ? organizationId
        : throw new ArgumentException("Organization ID must be nonempty.", nameof(organizationId));
    private readonly Guid _deviceId = deviceId != Guid.Empty
        ? deviceId
        : throw new ArgumentException("Device ID must be nonempty.", nameof(deviceId));
    private readonly ICompletedCommandJournal _journal = journal ?? throw new ArgumentNullException(nameof(journal));
    private readonly ControlCommandProcessor _processor = processor ?? throw new ArgumentNullException(nameof(processor));
    private ControlCommandResult? _pending;

    public void FlushPending()
    {
        if (_pending is null) return;
        _journal.Store(_organizationId, _deviceId, _pending);
        _pending = null;
    }

    public async Task<ControlCommandResult> ExecuteAsync(
        ControlCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        FlushPending();

        var existing = _journal.Find(_organizationId, _deviceId, command.CommandId);
        if (existing is not null) return existing;

        var result = await _processor.ProcessAsync(command, cancellationToken).ConfigureAwait(false);
        _pending = result;
        FlushPending();
        return result;
    }
}
