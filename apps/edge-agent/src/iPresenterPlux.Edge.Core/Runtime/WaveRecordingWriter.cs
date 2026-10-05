using System.Buffers.Binary;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

internal sealed class WaveRecordingWriter : IAsyncDisposable
{
    private const long MaxSegmentDataBytes = 1_500_000_000;
    private const long HeaderCheckpointBytes = 2 * 1024 * 1024;
    private readonly string _directory;
    private readonly string _baseName;
    private readonly List<string> _files = [];
    private FileStream? _stream;
    private AudioFrame? _format;
    private long _dataBytes;
    private long _bytesSinceCheckpoint;
    private int _segment;

    public WaveRecordingWriter(string directory, string baseName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        ArgumentException.ThrowIfNullOrWhiteSpace(baseName);
        Directory.CreateDirectory(directory);
        _directory = directory;
        _baseName = baseName;
    }

    public IReadOnlyList<string> Files => _files.AsReadOnly();
    public long FramesWritten { get; private set; }

    public async Task WriteAsync(AudioFrame frame, CancellationToken cancellationToken)
    {
        ValidateFrame(frame);
        if (_stream is null)
            await OpenSegmentAsync(frame, cancellationToken).ConfigureAwait(false);
        else if (!SameFormat(_format!, frame))
            throw new InvalidDataException("Audio input format changed during recording.");

        if (_dataBytes > 0 && _dataBytes + frame.BytesRecorded > MaxSegmentDataBytes)
        {
            await FinalizeSegmentAsync(cancellationToken).ConfigureAwait(false);
            await OpenSegmentAsync(frame, cancellationToken).ConfigureAwait(false);
        }

        await _stream!.WriteAsync(frame.Buffer[..frame.BytesRecorded], cancellationToken).ConfigureAwait(false);
        _dataBytes += frame.BytesRecorded;
        _bytesSinceCheckpoint += frame.BytesRecorded;
        FramesWritten++;

        if (_bytesSinceCheckpoint >= HeaderCheckpointBytes)
            await CheckpointHeaderAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task OpenSegmentAsync(AudioFrame format, CancellationToken cancellationToken)
    {
        _segment++;
        _format = format with { Buffer = ReadOnlyMemory<byte>.Empty, BytesRecorded = 0 };
        _dataBytes = 0;
        _bytesSinceCheckpoint = 0;
        var path = Path.Combine(_directory, $"{_baseName}-{_segment:000}.wav");
        _stream = new FileStream(
            path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read,
            128 * 1024, FileOptions.Asynchronous | FileOptions.WriteThrough);
        _files.Add(path);
        await WriteHeaderAsync(_stream, _format, 0, cancellationToken).ConfigureAwait(false);
    }

    private async Task CheckpointHeaderAsync(CancellationToken cancellationToken)
    {
        if (_stream is null || _format is null) return;
        var position = _stream.Position;
        _stream.Position = 0;
        await WriteHeaderAsync(_stream, _format, _dataBytes, cancellationToken).ConfigureAwait(false);
        _stream.Position = position;
        await _stream.FlushAsync(cancellationToken).ConfigureAwait(false);
        _stream.Flush(flushToDisk: true);
        _bytesSinceCheckpoint = 0;
    }

    private async Task FinalizeSegmentAsync(CancellationToken cancellationToken)
    {
        if (_stream is null || _format is null) return;
        await CheckpointHeaderAsync(cancellationToken).ConfigureAwait(false);
        await _stream.DisposeAsync().ConfigureAwait(false);
        _stream = null;
        _format = null;
        _dataBytes = 0;
        _bytesSinceCheckpoint = 0;
    }

    private static async Task WriteHeaderAsync(
        Stream stream,
        AudioFrame format,
        long dataBytes,
        CancellationToken cancellationToken)
    {
        if (dataBytes > uint.MaxValue - 36)
            throw new InvalidDataException("WAV segment exceeded RIFF size limits.");
        var bytesPerSample = format.BitsPerSample / 8;
        var blockAlign = checked((ushort)(format.Channels * bytesPerSample));
        var byteRate = checked((uint)(format.SampleRate * blockAlign));
        var formatTag = format.Encoding == AudioSampleEncoding.IeeeFloat ? (ushort)3 : (ushort)1;
        var header = new byte[44];
        "RIFF"u8.CopyTo(header);
        BinaryPrimitives.WriteUInt32LittleEndian(header.AsSpan(4, 4), checked((uint)(36 + dataBytes)));
        "WAVE"u8.CopyTo(header.AsSpan(8, 4));
        "fmt "u8.CopyTo(header.AsSpan(12, 4));
        BinaryPrimitives.WriteUInt32LittleEndian(header.AsSpan(16, 4), 16);
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(20, 2), formatTag);
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(22, 2), checked((ushort)format.Channels));
        BinaryPrimitives.WriteUInt32LittleEndian(header.AsSpan(24, 4), checked((uint)format.SampleRate));
        BinaryPrimitives.WriteUInt32LittleEndian(header.AsSpan(28, 4), byteRate);
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(32, 2), blockAlign);
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(34, 2), checked((ushort)format.BitsPerSample));
        "data"u8.CopyTo(header.AsSpan(36, 4));
        BinaryPrimitives.WriteUInt32LittleEndian(header.AsSpan(40, 4), checked((uint)dataBytes));
        await stream.WriteAsync(header, cancellationToken).ConfigureAwait(false);
    }

    private static bool SameFormat(AudioFrame left, AudioFrame right) =>
        left.SampleRate == right.SampleRate &&
        left.Channels == right.Channels &&
        left.BitsPerSample == right.BitsPerSample &&
        left.Encoding == right.Encoding;

    private static void ValidateFrame(AudioFrame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        if (frame.BytesRecorded <= 0 || frame.BytesRecorded > frame.Buffer.Length)
            throw new ArgumentException("Audio frame byte count is invalid.", nameof(frame));
        if (frame.SampleRate is < 8_000 or > 384_000 || frame.Channels is < 1 or > 32)
            throw new ArgumentException("Audio frame sample rate or channel count is invalid.", nameof(frame));
        if (frame.BitsPerSample is not (16 or 24 or 32))
            throw new ArgumentException("WAV recording supports 16, 24, or 32-bit input.", nameof(frame));
        if (frame.Encoding == AudioSampleEncoding.IeeeFloat && frame.BitsPerSample != 32)
            throw new ArgumentException("IEEE float WAV recording requires 32-bit input.", nameof(frame));
        var bytesPerFrame = frame.Channels * (frame.BitsPerSample / 8);
        if (frame.BytesRecorded % bytesPerFrame != 0)
            throw new ArgumentException("Audio frame is not aligned to its sample format.", nameof(frame));
    }

    public async ValueTask DisposeAsync()
    {
        await FinalizeSegmentAsync(CancellationToken.None).ConfigureAwait(false);
    }
}
