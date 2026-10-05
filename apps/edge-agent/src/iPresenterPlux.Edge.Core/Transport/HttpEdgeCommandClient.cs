using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Transport;

public sealed class HttpEdgeCommandClient(
    HttpClient httpClient,
    AgentIdentity identity,
    IDeviceCredentialStore credentialStore,
    TimeProvider? clock = null) : IControlPlaneCommandStream
{
    private readonly HttpClient _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
    private readonly AgentIdentity _identity = identity ?? throw new ArgumentNullException(nameof(identity));
    private readonly IDeviceCredentialStore _credentialStore = credentialStore ?? throw new ArgumentNullException(nameof(credentialStore));
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;

    public async IAsyncEnumerable<ControlCommand> ReceiveCommandsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var credential = await ReadUsableCredentialAsync(cancellationToken).ConfigureAwait(false);
            var token = Encoding.UTF8.GetString(credential.Material.Span);
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/edge/commands?limit=10");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            var payload = await response.Content.ReadFromJsonAsync<CommandPollResponse>(cancellationToken: cancellationToken)
                .ConfigureAwait(false) ?? throw new InvalidDataException("The Edge command response was empty.");
            if (!payload.Ok || payload.Commands is null) throw new InvalidDataException("The Edge command response was invalid.");

            foreach (var command in payload.Commands)
            {
                if (!Guid.TryParse(command.CommandId, out _)) throw new InvalidDataException("The Edge command id was invalid.");
                if (command.ServiceId is not null && !Guid.TryParse(command.ServiceId, out _))
                    throw new InvalidDataException("The Edge command service id was invalid.");
                if (!DateTimeOffset.TryParse(command.IssuedAt, out var issuedAt)) throw new InvalidDataException("The Edge command timestamp was invalid.");
                yield return new ControlCommand(command.CommandId, command.ServiceId, command.Type, issuedAt, command.Arguments ?? new Dictionary<string, string>());
            }

            if (payload.Commands.Count == 0)
                await Task.Delay(TimeSpan.FromSeconds(1), _clock, cancellationToken).ConfigureAwait(false);
        }
    }

    public async Task AcknowledgeCommandAsync(ControlCommandResult result, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(result);
        if (!Guid.TryParse(result.CommandId, out _)) throw new ArgumentException("Command id must be a UUID.", nameof(result));
        var credential = await ReadUsableCredentialAsync(cancellationToken).ConfigureAwait(false);
        var token = Encoding.UTF8.GetString(credential.Material.Span);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/edge/commands/{result.CommandId}/ack");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Content = JsonContent.Create(new
        {
            success = result.Success,
            resultingState = result.ResultingState,
            error = result.Error,
            completedAt = result.CompletedAt.ToUniversalTime().ToString("O")
        });
        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
    }

    private async Task<DeviceCredential> ReadUsableCredentialAsync(CancellationToken cancellationToken)
    {
        var credential = await _credentialStore.ReadAsync(_identity.OrganizationId, _identity.DeviceId, cancellationToken)
            .ConfigureAwait(false) ?? throw new InvalidOperationException("The Edge device is not enrolled.");
        if (credential.Metadata.State == DeviceCredentialState.Revoked ||
            credential.Metadata.ExpiresAt <= _clock.GetUtcNow() || credential.Material.IsEmpty)
            throw new InvalidOperationException("The Edge device credential is not usable.");
        return credential;
    }

    private sealed record CommandPollResponse(bool Ok, IReadOnlyList<CommandPayload>? Commands);
    private sealed record CommandPayload(
        string CommandId,
        string? ServiceId,
        string Type,
        string IssuedAt,
        IReadOnlyDictionary<string, string>? Arguments);
}
