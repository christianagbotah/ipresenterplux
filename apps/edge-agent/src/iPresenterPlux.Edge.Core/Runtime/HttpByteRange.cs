namespace iPresenterPlux.Edge.Core.Runtime;

public static class HttpByteRange
{
    public static bool TryParseSingle(string? rangeHeader, long length, out long start, out long end)
    {
        start = 0;
        end = 0;
        if (length <= 0 || string.IsNullOrWhiteSpace(rangeHeader)) return false;
        const string prefix = "bytes=";
        var value = rangeHeader.Trim();
        if (!value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return false;
        var spec = value[prefix.Length..].Trim();
        if (spec.Length == 0 || spec.Contains(',', StringComparison.Ordinal)) return false;
        var separator = spec.IndexOf('-');
        if (separator < 0 || spec.IndexOf('-', separator + 1) >= 0) return false;
        var left = spec[..separator].Trim();
        var right = spec[(separator + 1)..].Trim();

        if (left.Length == 0)
        {
            if (!long.TryParse(right, out var suffixLength) || suffixLength <= 0) return false;
            suffixLength = Math.Min(suffixLength, length);
            start = length - suffixLength;
            end = length - 1;
            return true;
        }

        if (!long.TryParse(left, out start) || start < 0 || start >= length) return false;
        if (right.Length == 0)
        {
            end = length - 1;
            return true;
        }

        if (!long.TryParse(right, out end) || end < start) return false;
        end = Math.Min(end, length - 1);
        return true;
    }
}
