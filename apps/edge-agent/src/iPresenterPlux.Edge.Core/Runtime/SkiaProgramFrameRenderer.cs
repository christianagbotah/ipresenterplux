using System.Runtime.InteropServices;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using SkiaSharp;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class SkiaProgramFrameRenderer : IProgramFrameRenderer
{
    private static readonly SKColor Background = new(5, 7, 10);
    private static readonly SKColor BackgroundGlow = new(22, 28, 38);
    private static readonly SKColor Foreground = new(247, 248, 250);
    private static readonly SKColor Muted = new(177, 185, 197);
    private static readonly SKColor Accent = new(215, 169, 74);

    public ProgramVideoFrame Render(
        PresentationRenderItem? item,
        int width = 1920,
        int height = 1080,
        DateTimeOffset? renderedAt = null)
    {
        if (width < 320 || width > 7680) throw new ArgumentOutOfRangeException(nameof(width));
        if (height < 180 || height > 4320) throw new ArgumentOutOfRangeException(nameof(height));

        var info = new SKImageInfo(width, height, SKColorType.Bgra8888, SKAlphaType.Opaque);
        using var bitmap = new SKBitmap(info);
        using var canvas = new SKCanvas(bitmap);
        DrawBackground(canvas, width, height);
        if (item is not null) DrawItem(canvas, item, width, height);

        canvas.Flush();
        var length = checked(bitmap.RowBytes * bitmap.Height);
        var buffer = new byte[length];
        Marshal.Copy(bitmap.GetPixels(), buffer, 0, length);

        return new ProgramVideoFrame(
            width,
            height,
            bitmap.RowBytes,
            "bgra32",
            buffer,
            item?.ItemId,
            renderedAt ?? DateTimeOffset.UtcNow);
    }

    private static void DrawBackground(SKCanvas canvas, int width, int height)
    {
        canvas.Clear(Background);
        using var shader = SKShader.CreateRadialGradient(
            new SKPoint(width * 0.5f, height * 0.44f),
            Math.Max(width, height) * 0.72f,
            new[] { BackgroundGlow, Background },
            new[] { 0f, 1f },
            SKShaderTileMode.Clamp);
        using var paint = new SKPaint { Shader = shader, IsAntialias = true };
        canvas.DrawRect(SKRect.Create(width, height), paint);
    }

    private static void DrawItem(SKCanvas canvas, PresentationRenderItem item, int width, int height)
    {
        var horizontalPadding = width * 0.095f;
        var contentWidth = width - (horizontalPadding * 2f);
        var bodyText = item.Body?.Trim() ?? string.Empty;
        var titleText = item.Title?.Trim() ?? string.Empty;
        var footerText = item.Footer?.Trim() ?? string.Empty;

        using var boldTypeface = SKTypeface.FromFamilyName("sans-serif", SKFontStyle.Bold);
        using var regularTypeface = SKTypeface.FromFamilyName("sans-serif", SKFontStyle.Normal);
        using var labelFont = new SKFont(boldTypeface, Math.Max(18f, height * 0.022f));
        using var titleFont = new SKFont(boldTypeface, Math.Max(34f, height * 0.064f));
        using var footerFont = new SKFont(boldTypeface, Math.Max(18f, height * 0.025f));
        using var labelPaint = TextPaint(Accent);
        using var titlePaint = TextPaint(Foreground);
        using var footerPaint = TextPaint(Muted);

        var bodySize = bodyText.Length switch
        {
            > 520 => height * 0.034f,
            > 320 => height * 0.041f,
            > 180 => height * 0.049f,
            _ => height * 0.058f
        };
        using var bodyFont = new SKFont(regularTypeface, Math.Max(28f, bodySize));
        using var bodyPaint = TextPaint(Foreground);

        var label = item.ItemType.Equals("scripture", StringComparison.OrdinalIgnoreCase)
            ? "SCRIPTURE"
            : item.ItemType.ToUpperInvariant();
        canvas.DrawText(label, horizontalPadding, height * 0.12f, SKTextAlign.Left, labelFont, labelPaint);

        var titleY = height * 0.205f;
        if (!string.IsNullOrWhiteSpace(titleText))
            canvas.DrawText(titleText, horizontalPadding, titleY, SKTextAlign.Left, titleFont, titlePaint);

        var bodyTop = height * 0.31f;
        var bodyBottom = height * 0.80f;
        var lineHeight = bodyFont.Size * 1.42f;
        var lines = WrapText(bodyText, bodyFont, bodyPaint, contentWidth);
        var maxLines = Math.Max(1, (int)Math.Floor((bodyBottom - bodyTop) / lineHeight));
        if (lines.Count > maxLines)
        {
            lines = lines.Take(maxLines).ToList();
            if (lines.Count > 0)
            {
                var last = lines[^1].TrimEnd();
                lines[^1] = last.EndsWith('…') ? last : $"{last.TrimEnd('.', ',', ';', ':')}…";
            }
        }

        var totalHeight = Math.Max(lineHeight, lines.Count * lineHeight);
        var y = bodyTop + Math.Max(0, ((bodyBottom - bodyTop) - totalHeight) * 0.5f) + bodyFont.Size;
        foreach (var line in lines)
        {
            canvas.DrawText(line, horizontalPadding, y, SKTextAlign.Left, bodyFont, bodyPaint);
            y += lineHeight;
        }

        if (!string.IsNullOrWhiteSpace(footerText))
            canvas.DrawText(footerText, horizontalPadding, height * 0.91f, SKTextAlign.Left, footerFont, footerPaint);
    }

    private static SKPaint TextPaint(SKColor color) => new()
    {
        IsAntialias = true,
        Color = color
    };

    private static List<string> WrapText(string text, SKFont font, SKPaint paint, float maxWidth)
    {
        var lines = new List<string>();
        if (string.IsNullOrWhiteSpace(text)) return lines;

        foreach (var paragraph in text.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n'))
        {
            var words = paragraph.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (words.Length == 0)
            {
                lines.Add(string.Empty);
                continue;
            }

            var current = words[0];
            for (var index = 1; index < words.Length; index++)
            {
                var candidate = $"{current} {words[index]}";
                if (font.MeasureText(candidate, paint) <= maxWidth)
                {
                    current = candidate;
                    continue;
                }

                lines.Add(current);
                current = words[index];
            }
            lines.Add(current);
        }
        return lines;
    }
}
