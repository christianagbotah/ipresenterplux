using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;

namespace Lightworld.Update.Helper;

public sealed class FileDeltaApplier
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _current;
    private readonly string _staging;

    public FileDeltaApplier(string installRoot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(installRoot);
        var root = Path.GetFullPath(installRoot);
        _current = Path.Combine(root, "current");
        _staging = Path.Combine(root, "staging");
    }

    public async Task<string> PrepareCandidateAsync(
        string packagePath,
        string installedVersion,
        string targetVersion,
        string candidateToken,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(packagePath);
        ArgumentException.ThrowIfNullOrWhiteSpace(installedVersion);
        ArgumentException.ThrowIfNullOrWhiteSpace(targetVersion);
        ValidateToken(candidateToken);
        if (!Directory.Exists(_current)) throw new DirectoryNotFoundException("Current application directory does not exist.");

        Directory.CreateDirectory(_staging);
        var candidate = Path.Combine(_staging, $"candidate-{candidateToken}");
        if (Directory.Exists(candidate)) Directory.Delete(candidate, recursive: true);
        Directory.CreateDirectory(candidate);

        try
        {
            CloneCurrent(candidate, cancellationToken);
            using var archive = ZipFile.OpenRead(Path.GetFullPath(packagePath));
            var metadataEntry = archive.Entries.SingleOrDefault(entry =>
                string.Equals(entry.FullName, "delta.json", StringComparison.Ordinal));
            if (metadataEntry is null) throw new InvalidDataException("Delta package is missing delta.json.");

            FileDeltaDescriptor descriptor;
            await using (var stream = metadataEntry.Open())
            {
                descriptor = await JsonSerializer.DeserializeAsync<FileDeltaDescriptor>(stream, JsonOptions, cancellationToken)
                    .ConfigureAwait(false) ?? throw new InvalidDataException("Delta metadata is invalid.");
            }
            ValidateDescriptor(descriptor, installedVersion, targetVersion);

            var changed = descriptor.Files.ToDictionary(file => NormalizeRelative(file.Path), StringComparer.OrdinalIgnoreCase);
            var deleted = descriptor.DeletedPaths.Select(NormalizeRelative).ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (changed.Keys.Any(deleted.Contains)) throw new InvalidDataException("Delta cannot both change and delete the same path.");

            var archiveFiles = new Dictionary<string, ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in archive.Entries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (string.Equals(entry.FullName, "delta.json", StringComparison.Ordinal)) continue;
                if (entry.FullName.EndsWith('/')) continue;
                var path = NormalizeRelative(entry.FullName);
                if (!archiveFiles.TryAdd(path, entry)) throw new InvalidDataException("Delta package contains duplicate file paths.");
            }
            if (archiveFiles.Count != changed.Count || archiveFiles.Keys.Any(path => !changed.ContainsKey(path)))
                throw new InvalidDataException("Delta package payload does not match delta metadata.");

            foreach (var deletedPath in deleted)
            {
                var target = ResolveCandidatePath(candidate, deletedPath);
                if (Directory.Exists(target)) throw new InvalidDataException("Delta deleted path unexpectedly targets a directory.");
                if (File.Exists(target)) File.Delete(target);
            }

            foreach (var (relativePath, metadata) in changed)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var entry = archiveFiles[relativePath];
                if (entry.Length != metadata.Size) throw new InvalidDataException($"Delta file size mismatch: {relativePath}");
                var target = ResolveCandidatePath(candidate, relativePath);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                await using var input = entry.Open();
                await using var output = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None,
                    128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
                using var hasher = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                var buffer = new byte[128 * 1024];
                long written = 0;
                int read;
                while ((read = await input.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken).ConfigureAwait(false)) > 0)
                {
                    await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
                    hasher.AppendData(buffer, 0, read);
                    written += read;
                }
                var hash = Convert.ToHexString(hasher.GetHashAndReset()).ToLowerInvariant();
                if (written != metadata.Size || !string.Equals(hash, metadata.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException($"Delta file hash mismatch: {relativePath}");
            }

            await VerifyResultCatalogAsync(candidate, descriptor.ResultCatalog, cancellationToken).ConfigureAwait(false);
            return candidate;
        }
        catch
        {
            try { if (Directory.Exists(candidate)) Directory.Delete(candidate, recursive: true); } catch { }
            throw;
        }
    }

    private void CloneCurrent(string candidate, CancellationToken cancellationToken)
    {
        var currentRoot = Path.GetFullPath(_current) + Path.DirectorySeparatorChar;
        foreach (var directory in Directory.EnumerateDirectories(_current, "*", SearchOption.AllDirectories))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("Current installation contains an unsupported reparse point.");
            var relative = Path.GetRelativePath(_current, directory);
            Directory.CreateDirectory(ResolveCandidatePath(candidate, relative));
        }
        foreach (var file in Directory.EnumerateFiles(_current, "*", SearchOption.AllDirectories))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("Current installation contains an unsupported reparse point.");
            if (!Path.GetFullPath(file).StartsWith(currentRoot, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Current installation path escaped its root.");
            var relative = Path.GetRelativePath(_current, file);
            var target = ResolveCandidatePath(candidate, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target, overwrite: false);
        }
    }

    private static async Task VerifyResultCatalogAsync(
        string candidate,
        IReadOnlyList<FileDeltaCatalogEntry> expectedEntries,
        CancellationToken cancellationToken)
    {
        var expected = expectedEntries.ToDictionary(entry => NormalizeRelative(entry.Path), StringComparer.OrdinalIgnoreCase);
        var actualFiles = Directory.EnumerateFiles(candidate, "*", SearchOption.AllDirectories).ToArray();
        if (actualFiles.Length != expected.Count) throw new InvalidDataException("Delta result catalog file count mismatch.");

        foreach (var file in actualFiles)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var relative = NormalizeRelative(Path.GetRelativePath(candidate, file));
            if (!expected.TryGetValue(relative, out var entry))
                throw new InvalidDataException($"Delta result catalog is missing: {relative}");
            var info = new FileInfo(file);
            if (info.Length != entry.Size) throw new InvalidDataException($"Delta result size mismatch: {relative}");
            await using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read,
                128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            using var sha = SHA256.Create();
            var bytes = await sha.ComputeHashAsync(stream, cancellationToken).ConfigureAwait(false);
            var hash = Convert.ToHexString(bytes).ToLowerInvariant();
            if (!string.Equals(hash, entry.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"Delta result hash mismatch: {relative}");
        }
    }

    private static void ValidateDescriptor(FileDeltaDescriptor descriptor, string fromVersion, string toVersion)
    {
        if (descriptor.SchemaVersion != 1 ||
            !string.Equals(descriptor.FromVersion, fromVersion, StringComparison.Ordinal) ||
            !string.Equals(descriptor.ToVersion, toVersion, StringComparison.Ordinal))
            throw new InvalidDataException("Delta package version does not match the requested update.");
        if (descriptor.Files is null || descriptor.DeletedPaths is null || descriptor.ResultCatalog is null)
            throw new InvalidDataException("Delta package metadata is incomplete.");
        foreach (var entry in descriptor.Files.Concat(descriptor.ResultCatalog))
        {
            _ = NormalizeRelative(entry.Path);
            if (entry.Size < 0 || entry.Sha256 is not { Length: 64 } || !entry.Sha256.All(Uri.IsHexDigit))
                throw new InvalidDataException("Delta package contains invalid file metadata.");
        }
        _ = descriptor.Files.ToDictionary(entry => NormalizeRelative(entry.Path), StringComparer.OrdinalIgnoreCase);
        _ = descriptor.ResultCatalog.ToDictionary(entry => NormalizeRelative(entry.Path), StringComparer.OrdinalIgnoreCase);
        foreach (var deleted in descriptor.DeletedPaths) _ = NormalizeRelative(deleted);
    }

    private static string NormalizeRelative(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new InvalidDataException("Delta path is empty.");
        var normalized = value.Replace('\\', '/');
        if (normalized.StartsWith('/') || normalized.EndsWith('/') || normalized == "delta.json" ||
            normalized.Split('/').Any(segment => segment is "" or "." or ".."))
            throw new InvalidDataException("Delta path traversal or reserved path is not allowed.");
        return normalized;
    }

    private static string ResolveCandidatePath(string candidate, string relative)
    {
        var normalized = NormalizeRelative(relative).Replace('/', Path.DirectorySeparatorChar);
        var root = Path.GetFullPath(candidate) + Path.DirectorySeparatorChar;
        var target = Path.GetFullPath(Path.Combine(candidate, normalized));
        if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Delta path traversal is not allowed.");
        return target;
    }

    private static void ValidateToken(string candidateToken)
    {
        if (string.IsNullOrWhiteSpace(candidateToken) || candidateToken.Length > 200 ||
            candidateToken.Any(character => !char.IsLetterOrDigit(character) && character is not '-' and not '_'))
            throw new InvalidDataException("Candidate token contains invalid characters.");
    }

    private sealed record FileDeltaDescriptor(
        int SchemaVersion,
        string FromVersion,
        string ToVersion,
        IReadOnlyList<FileDeltaCatalogEntry> Files,
        IReadOnlyList<string> DeletedPaths,
        IReadOnlyList<FileDeltaCatalogEntry> ResultCatalog);

    private sealed record FileDeltaCatalogEntry(string Path, long Size, string Sha256);
}
