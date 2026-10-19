using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class PresentationThemeMetadataTests
{
    private const string ValidTheme = """{"version":1,"background":{"kind":"gradient","value":"navy_teal"},"primaryTextColor":"#ffffff","secondaryTextColor":"#67e8f9","fontFamily":"Inter","titleSizeScale":1.2,"bodySizeScale":1.35,"footerSizeScale":0.9,"horizontalAlignment":"left","verticalAlignment":"bottom","shadow":true,"backingOpacity":0.35,"safeAreaPercent":8,"animation":"fade","lowerThird":{"mode":"always","position":"bottom_left"},"logo":{"mediaId":null,"position":"top_right","sizePercent":8}}""";

    [Fact]
    public void ResolvesKnownBoundedThemeTokens()
    {
        var theme = PresentationThemeMetadata.Resolve(new Dictionary<string,string> { [PresentationThemeMetadata.MetadataKey] = ValidTheme });
        Assert.Equal(1, theme.Version);
        Assert.Equal("gradient", theme.Background.Kind);
        Assert.Equal("navy_teal", theme.Background.Value);
        Assert.Equal("#67e8f9", theme.SecondaryTextColor);
        Assert.Equal("Inter", theme.FontFamily);
        Assert.Equal(1.35, theme.BodySizeScale, 3);
        Assert.Equal("left", theme.HorizontalAlignment);
        Assert.Equal("bottom", theme.VerticalAlignment);
        Assert.Equal("always", theme.LowerThird.Mode);
    }

    [Fact]
    public void MissingThemeUsesReadableDefault()
    {
        var theme = PresentationThemeMetadata.Resolve(new Dictionary<string,string>());
        Assert.Equal("gradient", theme.Background.Kind);
        Assert.Equal("midnight", theme.Background.Value);
        Assert.Equal("#ffffff", theme.PrimaryTextColor);
        Assert.True(theme.SafeAreaPercent >= 0);
    }

    [Theory]
    [InlineData("{not-json")]
    [InlineData("{\"version\":2}")]
    [InlineData("{\"version\":1,\"background\":{\"kind\":\"gradient\",\"value\":\"url(javascript:alert(1))\"}}")]
    [InlineData("<script>alert(1)</script>")]
    public void InvalidOrFutureThemeFailsClosed(string payload)
    {
        var theme = PresentationThemeMetadata.Resolve(new Dictionary<string,string> { [PresentationThemeMetadata.MetadataKey] = payload });
        Assert.Equal("midnight", theme.Background.Value);
        Assert.Equal("#ffffff", theme.PrimaryTextColor);
        Assert.DoesNotContain("javascript", theme.Background.Value.ToLowerInvariant());
    }
}
