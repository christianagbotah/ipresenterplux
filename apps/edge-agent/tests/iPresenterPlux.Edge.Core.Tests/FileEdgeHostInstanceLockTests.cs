using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class FileEdgeHostInstanceLockTests : IDisposable
{
    private readonly string _directory = Path.Combine(
        Path.GetTempPath(), "ipresenterplux-instance-lock-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public void OnlyOneHostCanHoldTheUserScopedRuntimeLock()
    {
        using var first = FileEdgeHostInstanceLock.TryAcquire(_directory);
        Assert.NotNull(first);
        using var second = FileEdgeHostInstanceLock.TryAcquire(_directory);
        Assert.Null(second);
    }

    [Fact]
    public void LockCanBeReacquiredAfterOwnerReleasesIt()
    {
        using (var first = FileEdgeHostInstanceLock.TryAcquire(_directory))
            Assert.NotNull(first);

        using var replacement = FileEdgeHostInstanceLock.TryAcquire(_directory);
        Assert.NotNull(replacement);
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }
}
