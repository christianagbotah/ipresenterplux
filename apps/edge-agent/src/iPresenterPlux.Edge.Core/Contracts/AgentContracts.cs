namespace iPresenterPlux.Edge.Core.Contracts;

public sealed record AgentIdentity(
    Guid DeviceId,
    Guid OrganizationId,
    Guid? CampusId,
    string DeviceName,
    string SoftwareVersion);

public sealed record AudioInputDevice(
    string Id,
    string Name,
    int Channels,
    int SampleRate,
    bool IsDefault);

public enum AudioSampleEncoding
{
    PcmInteger,
    IeeeFloat
}

public sealed record AudioFrame(
    ReadOnlyMemory<byte> Buffer,
    int BytesRecorded,
    int SampleRate,
    int Channels,
    int BitsPerSample,
    DateTimeOffset CapturedAt,
    AudioSampleEncoding Encoding = AudioSampleEncoding.PcmInteger);

public sealed record TranscriptSegment(
    Guid? ServiceId,
    long Sequence,
    DateTimeOffset StartedAt,
    string Text,
    bool IsFinal,
    string? SpeakerId = null,
    string? Language = null,
    double? Confidence = null,
    int? WireVersion = null);


public sealed record SpeechAudioChunk(
    ReadOnlyMemory<short> Samples,
    int SampleRate,
    DateTimeOffset StartedAt,
    TimeSpan Duration);

public sealed record SpeechRecognitionResult(
    string Text,
    string? Language = null,
    string? SpeakerId = null,
    double? Confidence = null);

public sealed record SpeechRecognitionHealth(
    string Status,
    string? Version = null,
    bool? ModelLoaded = null,
    string? Engine = null,
    string? Device = null,
    string? Diarization = null,
    bool? DiarizationReady = null);

public sealed record SourceHealth(
    string SourceId,
    string Name,
    string SourceType,
    string Status,
    double? LevelDb = null,
    double? FramesPerSecond = null,
    string? Detail = null);

public sealed record AgentHeartbeat(
    Guid DeviceId,
    DateTimeOffset SentAt,
    string SoftwareVersion,
    string Status,
    IReadOnlyList<SourceHealth> Sources,
    IReadOnlyDictionary<string, object?> Capabilities);

public sealed record ScriptureSuggestion(
    Guid DetectionId,
    string Reference,
    string BibleVersion,
    decimal Confidence,
    string State);
