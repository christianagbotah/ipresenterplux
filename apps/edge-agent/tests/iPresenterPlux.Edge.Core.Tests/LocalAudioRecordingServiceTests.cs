using System.Buffers.Binary;
using System.Text;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class LocalAudioRecordingServiceTests
{
    [Fact]
    public async Task RecordsValidPcmWaveAndManifest()
    {
        var directory = TempDirectory();
        try
        {
            await using var recorder = new LocalAudioRecordingService(directory);
            var serviceId = Guid.NewGuid();
            var started = await recorder.StartAsync(serviceId, CancellationToken.None);
            var frame = Pcm16Frame();

            Assert.True(recorder.TrySubmit(frame));
            Assert.True(recorder.TrySubmit(frame));
            var stopped = await recorder.StopAsync(CancellationToken.None);

            Assert.False(stopped.IsRecording);
            Assert.Equal(started.RecordingId, stopped.RecordingId);
            Assert.Equal(2L, stopped.FramesWritten);
            Assert.NotNull(stopped.DirectoryPath);
            var wave = Directory.GetFiles(stopped.DirectoryPath!, "audio-*.wav").Single();
            var bytes = await File.ReadAllBytesAsync(wave);
            Assert.Equal("RIFF", Encoding.ASCII.GetString(bytes, 0, 4));
            Assert.Equal("WAVE", Encoding.ASCII.GetString(bytes, 8, 4));
            Assert.Equal((uint)(bytes.Length - 8), BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(4, 4)));
            Assert.Equal((uint)(bytes.Length - 44), BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(40, 4)));
            Assert.True(File.Exists(Path.Combine(stopped.DirectoryPath!, "recording.json")));
        }
        finally { Directory.Delete(directory, recursive: true); }
    }

    [Fact]
    public async Task ServiceAssignmentChangeStopsAnActiveRecording()
    {
        var directory = TempDirectory();
        try
        {
            await using var recorder = new LocalAudioRecordingService(directory);
            var serviceId = Guid.NewGuid();
            await recorder.StartAsync(serviceId, CancellationToken.None);
            recorder.TrySubmit(Pcm16Frame());

            await recorder.HandleActiveServiceAsync(Guid.NewGuid(), CancellationToken.None);

            Assert.False(recorder.Status.IsRecording);
            Assert.Equal(serviceId, recorder.Status.ServiceId);
        }
        finally { Directory.Delete(directory, recursive: true); }
    }

    private static AudioFrame Pcm16Frame()
    {
        var bytes = new byte[640];
        for (var index = 0; index < bytes.Length; index += 2)
            BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(index, 2), (short)(index * 8));
        return new AudioFrame(bytes, bytes.Length, 16_000, 1, 16, DateTimeOffset.UtcNow);
    }

    private static string TempDirectory()
    {
        var directory = Path.Combine(Path.GetTempPath(), "ipresenterplux-recording-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        return directory;
    }
}
