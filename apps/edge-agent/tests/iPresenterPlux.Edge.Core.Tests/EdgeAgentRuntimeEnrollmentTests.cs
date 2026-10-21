using System.Net;
using System.Net.Http.Json;
using System.Text;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Runtime;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class EdgeAgentRuntimeEnrollmentTests
{
    [Fact]
    public async Task ExplicitPairingCodeReEnrollsEvenWhenExistingCredentialIsStillValid()
    {
        var deviceId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var organizationId = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var campusId = Guid.Parse("33333333-3333-3333-3333-333333333333");
        var oldCredentialId = Guid.Parse("44444444-4444-4444-4444-444444444444");
        var newCredentialId = Guid.Parse("55555555-5555-5555-5555-555555555555");
        var issuedAt = DateTimeOffset.Parse("2026-10-21T18:00:00Z");

        var identity = new AgentIdentity(deviceId, organizationId, campusId, "Main Auditorium PC", "1.0.0");
        var oldCredential = new DeviceCredential(
            new DeviceCredentialMetadata(identity, oldCredentialId, issuedAt, issuedAt.AddDays(30), DeviceCredentialState.Active),
            Encoding.UTF8.GetBytes("old-secret"));

        var credentialStore = new FakeCredentialStore(oldCredential);
        var identityStore = new FakeIdentityStore(identity);
        var handler = new EnrollmentHandler(deviceId, organizationId, campusId, newCredentialId, issuedAt);
        using var http = new HttpClient(handler) { BaseAddress = new Uri("https://control.test") };
        using var runtime = new EdgeAgentRuntime(
            http,
            credentialStore,
            identityStore,
            new NoopQueue(),
            new NoopJournal(),
            new Dictionary<string, string>(),
            new EdgeAgentRuntimeOptions("Main Auditorium PC", "1.0.0", "ABCD-EFGH-IJKL"));

        var result = await runtime.InitializeAsync(CancellationToken.None);

        Assert.Equal(1, handler.EnrollmentCalls);
        Assert.Equal(deviceId, result.DeviceId);
        Assert.Equal(newCredentialId, credentialStore.Current?.Metadata.CredentialId);
        Assert.Equal(newCredentialId, credentialStore.Metadata?.CredentialId);
    }

    private sealed class EnrollmentHandler(
        Guid deviceId,
        Guid organizationId,
        Guid campusId,
        Guid credentialId,
        DateTimeOffset issuedAt) : HttpMessageHandler
    {
        public int EnrollmentCalls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("/api/v1/edge/enroll", request.RequestUri?.AbsolutePath);
            EnrollmentCalls++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = JsonContent.Create(new
                {
                    ok = true,
                    credential = "new-secret",
                    metadata = new
                    {
                        deviceId = deviceId.ToString(),
                        organizationId = organizationId.ToString(),
                        campusId = campusId.ToString(),
                        deviceName = "Main Auditorium PC",
                        credentialId = credentialId.ToString(),
                        issuedAt,
                        expiresAt = issuedAt.AddDays(30),
                        state = "active",
                        replacesCredentialId = (string?)null
                    }
                })
            });
        }
    }

    private sealed class FakeCredentialStore(DeviceCredential current) : IDeviceCredentialStore
    {
        public DeviceCredential? Current { get; private set; } = current;
        public DeviceCredentialMetadata? Metadata { get; private set; } = current.Metadata;

        public Task<DeviceCredential?> ReadAsync(Guid organizationId, Guid deviceId, CancellationToken cancellationToken) =>
            Task.FromResult(Current?.Metadata.Identity.OrganizationId == organizationId && Current.Metadata.Identity.DeviceId == deviceId ? Current : null);

        public Task<DeviceCredentialMetadata?> ReadMetadataAsync(Guid organizationId, Guid deviceId, CancellationToken cancellationToken) =>
            Task.FromResult(Metadata?.Identity.OrganizationId == organizationId && Metadata.Identity.DeviceId == deviceId ? Metadata : null);

        public Task<bool> SaveAsync(DeviceCredential credential, Guid? expectedCredentialId, CancellationToken cancellationToken)
        {
            if (Metadata?.CredentialId != expectedCredentialId) return Task.FromResult(false);
            Current = credential;
            Metadata = credential.Metadata;
            return Task.FromResult(true);
        }

        public Task<bool> MarkRevokedAsync(DeviceCredentialMetadata revoked, Guid expectedCredentialId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }

    private sealed class FakeIdentityStore(AgentIdentity identity) : IAgentIdentityStore
    {
        public AgentIdentity? Current { get; private set; } = identity;
        public Task<AgentIdentity?> ReadAsync(CancellationToken cancellationToken) => Task.FromResult(Current);
        public Task SaveAsync(AgentIdentity identity, CancellationToken cancellationToken) { Current = identity; return Task.CompletedTask; }
        public Task ClearAsync(CancellationToken cancellationToken) { Current = null; return Task.CompletedTask; }
    }

    private sealed class NoopQueue : IOutboundEventQueue
    {
        public Task EnqueueAsync(OutboundEvent outboundEvent, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<IReadOnlyList<OutboundEventDelivery>> ClaimAsync(OutboundEventScope scope, int limit, DateTimeOffset now, TimeSpan leaseDuration, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<bool> AcknowledgeAsync(OutboundEventScope scope, Guid eventId, Guid claimId, DateTimeOffset now, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<bool> RetryAsync(OutboundEventScope scope, Guid eventId, Guid claimId, DateTimeOffset now, DateTimeOffset retryAt, CancellationToken cancellationToken) => throw new NotSupportedException();
    }

    private sealed class NoopJournal : ICompletedCommandJournal
    {
        public ControlCommandResult? Find(Guid organizationId, Guid deviceId, string commandId) => null;
        public void Store(Guid organizationId, Guid deviceId, ControlCommandResult result) { }
    }
}
