using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class AnnexBVideoTests
{
    [Fact]
    public void DetectsIdrAfterParameterSets()
    {
        var accessUnit = new byte[]
        {
            0, 0, 0, 1, 0x67, 1, 2, 3,
            0, 0, 1, 0x68, 4, 5,
            0, 0, 0, 1, 0x65, 6, 7, 8
        };

        Assert.True(AnnexBVideo.IsH264KeyFrame(accessUnit));
    }

    [Fact]
    public void RejectsNonIdrAccessUnit()
    {
        var accessUnit = new byte[]
        {
            0, 0, 0, 1, 0x67, 1, 2,
            0, 0, 1, 0x68, 3,
            0, 0, 0, 1, 0x41, 4, 5, 6
        };

        Assert.False(AnnexBVideo.IsH264KeyFrame(accessUnit));
    }

    [Theory]
    [InlineData(new byte[0])]
    [InlineData(new byte[] { 1, 2, 3, 4 })]
    [InlineData(new byte[] { 0, 0, 1 })]
    public void MalformedOrEmptyDataIsNotKeyFrame(byte[] data)
    {
        Assert.False(AnnexBVideo.IsH264KeyFrame(data));
    }
}
