using System.IO.Compression;

namespace Lightworld.Update.Helper;

public sealed class AtomicInstallSwitcher
{
    private readonly string _installRoot;
    private readonly string _current;
    private readonly string _previous;
    private readonly string _staging;

    public AtomicInstallSwitcher(string installRoot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(installRoot);
        _installRoot = Path.GetFullPath(installRoot);
        _current = Path.Combine(_installRoot, "current");
        _previous = Path.Combine(_installRoot, "previous");
        _staging = Path.Combine(_installRoot, "staging");
    }

    public async Task<string> PrepareCandidateAsync(
        string packagePath,
        string candidateToken,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(packagePath);
        if (string.IsNullOrWhiteSpace(candidateToken) ||
            candidateToken.Any(character => !char.IsLetterOrDigit(character) && character is not '-' and not '_'))
            throw new InvalidDataException("Candidate token contains invalid characters.");

        Directory.CreateDirectory(_staging);
        var candidate = Path.Combine(_staging, $"candidate-{candidateToken}");
        if (Directory.Exists(candidate)) Directory.Delete(candidate, recursive: true);
        Directory.CreateDirectory(candidate);
        var candidateRoot = Path.GetFullPath(candidate) + Path.DirectorySeparatorChar;

        try
        {
            using var archive = ZipFile.OpenRead(Path.GetFullPath(packagePath));
            foreach (var entry in archive.Entries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var normalizedName = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                if (Path.IsPathRooted(normalizedName))
                    throw new InvalidDataException("Update package contains an absolute path.");
                var target = Path.GetFullPath(Path.Combine(candidate, normalizedName));
                if (!target.StartsWith(candidateRoot, StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(target, candidate.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Update package path traversal is not allowed.");

                if (entry.FullName.EndsWith('/'))
                {
                    Directory.CreateDirectory(target);
                    continue;
                }

                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                await using var input = entry.Open();
                await using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                    128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
                await input.CopyToAsync(output, cancellationToken).ConfigureAwait(false);
            }
            return candidate;
        }
        catch
        {
            try { if (Directory.Exists(candidate)) Directory.Delete(candidate, recursive: true); } catch { }
            throw;
        }
    }

    public Task SwitchToCandidateAsync(string candidatePath, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var candidate = Path.GetFullPath(candidatePath);
        var stagingRoot = Path.GetFullPath(_staging) + Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(stagingRoot, StringComparison.OrdinalIgnoreCase) || !Directory.Exists(candidate))
            throw new InvalidDataException("Candidate update directory is invalid.");
        if (!Directory.Exists(_current))
            throw new DirectoryNotFoundException("Current application directory does not exist.");

        if (Directory.Exists(_previous)) Directory.Delete(_previous, recursive: true);
        Directory.Move(_current, _previous);
        try
        {
            Directory.Move(candidate, _current);
        }
        catch
        {
            if (!Directory.Exists(_current) && Directory.Exists(_previous)) Directory.Move(_previous, _current);
            throw;
        }
        return Task.CompletedTask;
    }

    public Task RollbackAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!Directory.Exists(_previous)) return Task.CompletedTask;
        if (Directory.Exists(_current)) Directory.Delete(_current, recursive: true);
        Directory.Move(_previous, _current);
        return Task.CompletedTask;
    }
}
