using System.Text.Json;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.Transport;

const string path = "service/11111111-1111-1111-1111-111111111111";
var publishUri = new Uri($"srt://127.0.0.1:8890?streamid=publish:{path}:edge:smoke-token&pkt_size=1316");
var apiUri = new Uri("http://127.0.0.1:9997/v3/paths/list");

await using var sender = new LibSrtContributionSender();
var connected = await sender.ConnectAsync(publishUri, CancellationToken.None);
if (!connected.IsConnected)
    throw new InvalidOperationException($"SRT smoke connect failed: {connected.ErrorCode ?? connected.State}");

var muxer = new MpegTsMuxer();
using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
var startedAt = DateTimeOffset.UtcNow;
var frameNumber = 0L;
var verified = false;

while (!timeout.IsCancellationRequested)
{
    var ptsUs = frameNumber * 33_333L;
    var video = muxer.MuxVideo(new EncodedProgramVideoFrame(
        BuildH264AccessUnit(frameNumber % 30 == 0),
        640,
        360,
        "h264",
        "annexb",
        frameNumber % 30 == 0,
        ptsUs));
    await SendPacketsAsync(sender, video, timeout.Token);

    if ((frameNumber & 1) == 0)
    {
        var audioPts = frameNumber * 21_333L;
        var audio = muxer.MuxAudio(new EncodedProgramAudioFrame(
            BuildAdtsAacFrame(),
            48_000,
            2,
            "aac",
            "adts",
            audioPts,
            21_333));
        await SendPacketsAsync(sender, audio, timeout.Token);
    }

    frameNumber++;
    if (DateTimeOffset.UtcNow - startedAt > TimeSpan.FromMilliseconds(400))
    {
        try
        {
            var json = await http.GetStringAsync(apiUri, timeout.Token);
            if (PathHasCodecs(json, path, "H264", "MPEG4Audio"))
            {
                verified = true;
                break;
            }
        }
        catch (HttpRequestException)
        {
        }
    }

    await Task.Delay(20, timeout.Token);
}

await sender.DisconnectAsync(CancellationToken.None);
if (!verified)
    throw new InvalidOperationException("MediaMTX never reported the smoke path with H264 and MPEG4Audio tracks.");

Console.WriteLine("SRT_MEDIAMTX_SMOKE_OK");

static async Task SendPacketsAsync(
    LibSrtContributionSender sender,
    IReadOnlyList<byte[]> packets,
    CancellationToken cancellationToken)
{
    for (var offset = 0; offset < packets.Count; offset += 7)
    {
        var count = Math.Min(7, packets.Count - offset);
        var payload = new byte[count * MpegTsMuxer.PacketSize];
        for (var index = 0; index < count; index++)
            Buffer.BlockCopy(packets[offset + index], 0, payload, index * MpegTsMuxer.PacketSize, MpegTsMuxer.PacketSize);
        await sender.SendAsync(payload, cancellationToken);
    }
}

static byte[] BuildH264AccessUnit(bool keyFrame)
{
    if (!keyFrame)
        return [0x00, 0x00, 0x00, 0x01, 0x41, 0x9A, 0x20, 0x11, 0x00];

    // Baseline-compatible SPS/PPS plus an IDR NAL. MediaMTX parses the codec
    // headers; this smoke intentionally does not depend on a decoder or camera.
    return
    [
        0x00, 0x00, 0x00, 0x01,
        0x67, 0x42, 0xC0, 0x1E, 0xD9, 0x01, 0x40, 0x7B, 0x20, 0x11, 0x00, 0x00,
        0x03, 0x00, 0x01, 0x00, 0x00, 0x03, 0x00, 0x3C, 0x8F, 0x16, 0x2E, 0x48,
        0x00, 0x00, 0x00, 0x01,
        0x68, 0xCE, 0x3C, 0x80,
        0x00, 0x00, 0x00, 0x01,
        0x65, 0x88, 0x84, 0x00, 0x0A, 0xF2, 0x62, 0x80
    ];
}

static byte[] BuildAdtsAacFrame()
{
    const int payloadLength = 2;
    const int frameLength = 7 + payloadLength;
    return
    [
        0xFF, 0xF1,
        0x4C, // AAC-LC, 48 kHz, stereo high channel bit.
        (byte)(0x80 | ((frameLength >> 11) & 0x03)),
        (byte)((frameLength >> 3) & 0xFF),
        (byte)(((frameLength & 0x07) << 5) | 0x1F),
        0xFC,
        0x00, 0x00
    ];
}

static bool PathHasCodecs(string json, string expectedPath, params string[] codecs)
{
    using var document = JsonDocument.Parse(json);
    if (!document.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
        return false;

    foreach (var item in items.EnumerateArray())
    {
        if (!item.TryGetProperty("name", out var name) || name.GetString() != expectedPath)
            continue;
        if (!item.TryGetProperty("ready", out var ready) || ready.ValueKind != JsonValueKind.True)
            continue;

        var itemText = item.GetRawText();
        return codecs.All(codec => itemText.Contains(codec, StringComparison.OrdinalIgnoreCase));
    }
    return false;
}
