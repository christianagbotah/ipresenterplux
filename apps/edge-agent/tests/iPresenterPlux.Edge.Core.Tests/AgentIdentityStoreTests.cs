using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Security;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class AgentIdentityStoreTests
{
    [Fact]
    public async Task IdentitySurvivesRestartAndCanBeCleared()
    {
        var directory = Path.Combine(Path.GetTempPath(), "ipresenterplux-identity-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var identity = new AgentIdentity(
                Guid.Parse("11111111-1111-1111-1111-111111111111"),
                Guid.Parse("22222222-2222-2222-2222-222222222222"),
                Guid.Parse("33333333-3333-3333-3333-333333333333"),
                "Church Mac",
                "1.2.3");

            await using (var first = new FileAgentIdentityStore(directory))
            {
                Assert.Null(await first.ReadAsync(CancellationToken.None));
                await first.SaveAsync(identity, CancellationToken.None);
            }

            await using (var second = new FileAgentIdentityStore(directory))
            {
                Assert.Equal(identity, await second.ReadAsync(CancellationToken.None));
                await second.ClearAsync(CancellationToken.None);
            }

            await using var third = new FileAgentIdentityStore(directory);
            Assert.Null(await third.ReadAsync(CancellationToken.None));
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task InvalidIdentityIsNeverPersisted()
    {
        var directory = Path.Combine(Path.GetTempPath(), "ipresenterplux-identity-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var invalid = new AgentIdentity(Guid.Empty, Guid.NewGuid(), null, "Edge", "1.0");
            await using var store = new FileAgentIdentityStore(directory);
            await Assert.ThrowsAsync<ArgumentException>(() => store.SaveAsync(invalid, CancellationToken.None));
            Assert.Null(await store.ReadAsync(CancellationToken.None));
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }
}
