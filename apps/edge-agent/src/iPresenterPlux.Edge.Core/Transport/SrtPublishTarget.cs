namespace iPresenterPlux.Edge.Core.Transport;

public sealed class SrtPublishTarget
{
    private SrtPublishTarget(string host, int port, string streamId, int payloadSize)
    {
        Host = host;
        Port = port;
        StreamId = streamId;
        PayloadSize = payloadSize;
    }

    public string Host { get; }
    public int Port { get; }
    public int PayloadSize { get; }
    internal string StreamId { get; }

    public static SrtPublishTarget Parse(Uri publishUri)
    {
        ArgumentNullException.ThrowIfNull(publishUri);
        if (!publishUri.IsAbsoluteUri ||
            !string.Equals(publishUri.Scheme, "srt", StringComparison.OrdinalIgnoreCase) ||
            string.IsNullOrWhiteSpace(publishUri.Host) ||
            publishUri.Port is <= 0 or > 65535)
            throw new ArgumentException("SRT publish target must include an absolute host and port.", nameof(publishUri));
        if (!string.IsNullOrEmpty(publishUri.UserInfo) || !string.IsNullOrEmpty(publishUri.Fragment))
            throw new ArgumentException("SRT publish target cannot contain URI credentials or a fragment.", nameof(publishUri));
        if (publishUri.AbsolutePath is not ("" or "/"))
            throw new ArgumentException("SRT publish target path must be carried only by the stream ID.", nameof(publishUri));

        string? streamId = null;
        string? packetSize = null;
        var seenStreamId = false;
        var seenPacketSize = false;
        foreach (var part in publishUri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var pair = part.Split('=', 2);
            var key = Uri.UnescapeDataString(pair[0]);
            var value = pair.Length == 2 ? Uri.UnescapeDataString(pair[1]) : string.Empty;
            switch (key)
            {
                case "streamid" when !seenStreamId:
                    seenStreamId = true;
                    streamId = value;
                    break;
                case "pkt_size" when !seenPacketSize:
                    seenPacketSize = true;
                    packetSize = value;
                    break;
                default:
                    throw new ArgumentException("SRT publish target contains an unsupported or duplicate query option.", nameof(publishUri));
            }
        }

        if (streamId is null || streamId.Length is 0 or > 512)
            throw new ArgumentException("SRT stream ID is missing or exceeds the protocol limit.", nameof(publishUri));
        var fields = streamId.Split(':', 4);
        if (fields.Length != 4 ||
            fields[0] != "publish" ||
            string.IsNullOrWhiteSpace(fields[1]) ||
            fields[2] != "edge" ||
            string.IsNullOrWhiteSpace(fields[3]))
            throw new ArgumentException("SRT stream ID is not an iPresenterPlux Edge publish ID.", nameof(publishUri));
        if (!int.TryParse(packetSize, out var payloadSize) || payloadSize != 1316)
            throw new ArgumentException("SRT MPEG-TS payload size must be 1316 bytes.", nameof(publishUri));

        return new SrtPublishTarget(publishUri.IdnHost, publishUri.Port, streamId, payloadSize);
    }

    public override string ToString() =>
        $"SrtPublishTarget(Host={Host}, Port={Port}, PayloadSize={PayloadSize}, StreamId=[redacted])";
}
