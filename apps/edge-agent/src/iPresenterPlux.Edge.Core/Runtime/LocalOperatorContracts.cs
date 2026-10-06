using System.Security.Cryptography;
using System.Text;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public static class LocalOperatorCommands
{
    public const string SnapshotQuery = "snapshot.query";
    public const string CatalogQuery = "catalog.query";
    public const string ScriptureResolve = "scripture.resolve";
    public const string PreviewRender = "preview.render";
    public const string ProgramTake = "program.take";
    public const string ProgramClear = "program.clear";
    public const string OutputStart = "output.start";
    public const string OutputStop = "output.stop";
    public const string RecordingStart = "recording.start";
    public const string RecordingStop = "recording.stop";

    public static bool IsAllowed(string? command) => command is
        SnapshotQuery or CatalogQuery or ScriptureResolve or PreviewRender or ProgramTake or ProgramClear or
        OutputStart or OutputStop or RecordingStart or RecordingStop;
}

public sealed record LocalOperatorPresentation(
    string ItemId,
    string ItemType,
    string Title,
    string Body,
    string? Footer);

public sealed record LocalOperatorScriptureQuery(
    string Reference,
    string? Version = null);

public sealed record LocalOperatorRequest(
    string RequestId,
    string Command,
    LocalOperatorPresentation? Presentation = null,
    LocalOperatorScriptureQuery? Scripture = null);

public sealed record LocalOperatorSnapshot(
    bool OutputRunning,
    PresentationRenderItem? Preview,
    PresentationRenderItem? Program,
    bool IsRecording,
    string? RecordingId,
    string ConnectionStatus,
    Guid? ActiveServiceId,
    string ServiceMode,
    DateTimeOffset UpdatedAt);

public sealed record LocalOperatorResponse(
    string RequestId,
    bool Ok,
    string State,
    string? ErrorCode,
    LocalOperatorSnapshot Snapshot,
    OperatorCatalogSnapshot? Catalog = null,
    bool CatalogStale = false,
    OperatorCatalogItem? ResolvedPresentation = null);

public sealed record LocalOperatorIpcEndpoint(string PipeName, string UnixSocketPath)
{
    public static LocalOperatorIpcEndpoint ForDataDirectory(string dataDirectory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(dataDirectory);
        var full = Path.GetFullPath(dataDirectory);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(full)))[..20].ToLowerInvariant();
        var candidate = Path.Combine(full, "operator.sock");
        var unixSocketPath = Encoding.UTF8.GetByteCount(candidate) <= 100
            ? candidate
            : Path.Combine(Path.GetTempPath(), $"ipx-{hash}.sock");
        if (Encoding.UTF8.GetByteCount(unixSocketPath) > 100 && !OperatingSystem.IsWindows())
            unixSocketPath = Path.Combine("/tmp", $"ipx-{hash}.sock");

        return new LocalOperatorIpcEndpoint(
            $"ipresenterplux-operator-{hash}",
            unixSocketPath);
    }
}
