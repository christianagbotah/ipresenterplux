using System.Text.Json;
using iPresenterPlux.Edge.Core.Contracts;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class EnrollmentContractTests
{
    [Theory]
    [InlineData(DeviceCredentialState.Active)]
    [InlineData(DeviceCredentialState.RotationRequired)]
    [InlineData(DeviceCredentialState.Revoked)]
    public void MetadataRoundTripPreservesTenantDeviceAndLifecycle(DeviceCredentialState state)
    {
        var now = DateTimeOffset.Parse("2026-01-01T00:00:00Z");
        var identity = new AgentIdentity(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), "Edge", "1.0");
        var metadata = new DeviceCredentialMetadata(identity, Guid.NewGuid(), now, now.AddHours(1),
            state, Guid.NewGuid(), state == DeviceCredentialState.Revoked ? now : null);

        var restored = JsonSerializer.Deserialize<DeviceCredentialMetadata>(JsonSerializer.Serialize(metadata));

        Assert.Equal(metadata, restored);
        Assert.NotNull(restored);
        Assert.Equal(identity.OrganizationId, restored.Identity.OrganizationId);
        Assert.Equal(identity.DeviceId, restored.Identity.DeviceId);
    }
}
