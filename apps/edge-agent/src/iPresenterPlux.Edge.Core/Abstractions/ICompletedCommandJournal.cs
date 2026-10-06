using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Abstractions;

/// <summary>Single-writer, bounded completed results scoped to an enrolled device.</summary>
public interface ICompletedCommandJournal
{
    ControlCommandResult? Find(Guid organizationId, Guid deviceId, string commandId);
    void Store(Guid organizationId, Guid deviceId, ControlCommandResult result);
}
