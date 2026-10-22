namespace iPresenterPlux.Edge.Core.Runtime;

public static class MediaFormatProbe
{
    public static string Detect(ReadOnlySpan<byte> bytes, string mediaKind, string? declaredContentType)
    {
        var detected = DetectCore(bytes, out var detectedKind);
        var declared = NormalizeContentType(declaredContentType);
        if (detected is null || !string.Equals(mediaKind, detectedKind, StringComparison.OrdinalIgnoreCase))
            throw InvalidType();
        if (declared.Length > 0 && !Equivalent(declared, detected)) throw InvalidType();
        return detected;
    }

    private static string? DetectCore(ReadOnlySpan<byte> bytes, out string mediaKind)
    {
        mediaKind = string.Empty;
        if (bytes.Length >= 8 && bytes[..8].SequenceEqual(new byte[] { 0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a }))
        { mediaKind = "image"; return "image/png"; }
        if (bytes.Length >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff)
        { mediaKind = "image"; return "image/jpeg"; }
        if (bytes.Length >= 12 && bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8,4).SequenceEqual("WEBP"u8))
        { mediaKind = "image"; return "image/webp"; }
        if (bytes.Length >= 12 && bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8,4).SequenceEqual("WAVE"u8))
        { mediaKind = "audio"; return "audio/wav"; }
        if (bytes.Length >= 3 && bytes[..3].SequenceEqual("ID3"u8))
        { mediaKind = "audio"; return "audio/mpeg"; }
        if (bytes.Length >= 2 && bytes[0] == 0xff && (bytes[1] & 0xf6) == 0xf0)
        { mediaKind = "audio"; return "audio/aac"; }
        if (bytes.Length >= 2 && bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0 &&
            (bytes[1] & 0x18) != 0x08 && (bytes[1] & 0x06) != 0)
        { mediaKind = "audio"; return "audio/mpeg"; }
        if (bytes.Length >= 12 && bytes.Slice(4,4).SequenceEqual("ftyp"u8))
        {
            var brand = bytes.Slice(8,4);
            if (brand.SequenceEqual("M4A "u8) || brand.SequenceEqual("M4B "u8))
            { mediaKind = "audio"; return "audio/mp4"; }
            mediaKind = "video"; return "video/mp4";
        }
        return null;
    }

    private static string NormalizeContentType(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var semi = value.IndexOf(';');
        return (semi >= 0 ? value[..semi] : value).Trim().ToLowerInvariant();
    }

    private static bool Equivalent(string declared, string detected) =>
        declared == detected ||
        (detected == "audio/wav" && declared is "audio/x-wav" or "audio/wave") ||
        (detected == "audio/mpeg" && declared == "audio/mp3");

    private static MediaAssetCacheException InvalidType() =>
        new("media_type_invalid", "Downloaded bytes do not match the approved media family/content type.");
}
