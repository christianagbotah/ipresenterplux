using System.Net;
using System.Net.Http.Headers;
using Lightworld.Update.Client;
using Xunit;

namespace Lightworld.Update.Client.Tests;

public sealed class ResumableDownloaderTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "lightworld-update-client-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task ExistingPartialFileUsesRangeAndAppends()
    {
        Directory.CreateDirectory(_directory);
        var destination = Path.Combine(_directory, "package.zip");
        await File.WriteAllTextAsync(destination, "hello ");
        var handler = new DelegateHandler(request =>
        {
            Assert.Equal(6, request.Headers.Range?.Ranges.Single().From);
            return new HttpResponseMessage(HttpStatusCode.PartialContent) { Content = new ByteArrayContent("world"u8.ToArray()) };
        });
        var downloader = new ResumableDownloader(new HttpClient(handler));
        await downloader.DownloadAsync(new Uri("https://updates.example.test/package.zip"), destination, 11, CancellationToken.None);
        Assert.Equal("hello world", await File.ReadAllTextAsync(destination));
    }

    [Fact]
    public async Task ServerIgnoringRangeRestartsFromZero()
    {
        Directory.CreateDirectory(_directory);
        var destination = Path.Combine(_directory, "package.zip");
        await File.WriteAllTextAsync(destination, "stale");
        var handler = new DelegateHandler(_ =>
            new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent("fresh package"u8.ToArray()) });
        var downloader = new ResumableDownloader(new HttpClient(handler));
        await downloader.DownloadAsync(new Uri("https://updates.example.test/package.zip"), destination, 13, CancellationToken.None);
        Assert.Equal("fresh package", await File.ReadAllTextAsync(destination));
    }

    [Fact]
    public async Task InterruptedTransferPreservesPartialBytes()
    {
        Directory.CreateDirectory(_directory);
        var destination = Path.Combine(_directory, "package.zip");
        var handler = new DelegateHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StreamContent(new FaultAfterStream("partial payload"u8.ToArray(), 7))
        });
        var downloader = new ResumableDownloader(new HttpClient(handler));
        await Assert.ThrowsAsync<IOException>(() => downloader.DownloadAsync(
            new Uri("https://updates.example.test/package.zip"), destination, 15, CancellationToken.None));
        Assert.True(File.Exists(destination));
        Assert.InRange(new FileInfo(destination).Length, 1, 14);
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
    }

    private sealed class DelegateHandler(Func<HttpRequestMessage, HttpResponseMessage> callback) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(callback(request));
    }

    private sealed class FaultAfterStream(byte[] bytes, int faultAfter) : Stream
    {
        private int _position;
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => bytes.Length;
        public override long Position { get => _position; set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override int Read(Span<byte> buffer)
        {
            if (_position >= faultAfter) throw new IOException("simulated network interruption");
            var remainingBeforeFault = faultAfter - _position;
            var count = Math.Min(buffer.Length, Math.Min(remainingBeforeFault, bytes.Length - _position));
            bytes.AsSpan(_position, count).CopyTo(buffer);
            _position += count;
            return count;
        }
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(Read(buffer.Span));
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
