namespace iPresenterPlux.Edge.Core.Runtime;

public static class AnnexBVideo
{
    public static bool IsH264KeyFrame(ReadOnlySpan<byte> accessUnit)
    {
        var offset = 0;
        while (TryFindStartCode(accessUnit, offset, out var nalOffset, out var nextSearch))
        {
            if (nalOffset < accessUnit.Length)
            {
                var nalType = accessUnit[nalOffset] & 0x1F;
                if (nalType == 5) return true; // IDR picture
            }
            offset = nextSearch;
        }
        return false;
    }

    private static bool TryFindStartCode(
        ReadOnlySpan<byte> data,
        int start,
        out int nalOffset,
        out int nextSearch)
    {
        for (var index = Math.Max(0, start); index <= data.Length - 3; index++)
        {
            if (data[index] != 0 || data[index + 1] != 0) continue;
            if (data[index + 2] == 1)
            {
                nalOffset = index + 3;
                nextSearch = nalOffset;
                return true;
            }
            if (index <= data.Length - 4 && data[index + 2] == 0 && data[index + 3] == 1)
            {
                nalOffset = index + 4;
                nextSearch = nalOffset;
                return true;
            }
        }

        nalOffset = 0;
        nextSearch = data.Length;
        return false;
    }
}
