using System.Security.Cryptography;
using System.Text;
using iPresenterPlux.Edge.Core.Models;

namespace iPresenterPlux.Edge.Core.Runtime;

public static class VisualSourceIdentity
{
    public static string Create(string platform, VisualSourceKind kind, string nativeKey)
    {
        if (string.IsNullOrWhiteSpace(platform)) throw new ArgumentException("Platform is required.", nameof(platform));
        if (string.IsNullOrWhiteSpace(nativeKey)) throw new ArgumentException("Native key is required.", nameof(nativeKey));

        var input = Encoding.UTF8.GetBytes($"{platform.Trim().ToLowerInvariant()}\n{nativeKey}");
        var hash = SHA256.HashData(input);
        var digest = Convert.ToHexString(hash.AsSpan(0, 16)).ToLowerInvariant();
        return $"visual:{kind.ToString().ToLowerInvariant()}:{digest}";
    }
}
