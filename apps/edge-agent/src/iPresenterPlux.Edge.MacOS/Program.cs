using iPresenterPlux.Edge.Core.Queues;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.Security;
using iPresenterPlux.Edge.MacOS;

return await RunAsync();

static async Task<int> RunAsync()
{
    var controlUrlText = Environment.GetEnvironmentVariable("IPRESENTERPLUX_CONTROL_URL");
    if (!Uri.TryCreate(controlUrlText, UriKind.Absolute, out var controlUrl) ||
        (controlUrl.Scheme != Uri.UriSchemeHttps && controlUrl.Scheme != Uri.UriSchemeHttp))
    {
        Console.Error.WriteLine("IPRESENTERPLUX_CONTROL_URL must be an absolute HTTP(S) URL.");
        return 2;
    }

    var dataDirectory = Environment.GetEnvironmentVariable("IPRESENTERPLUX_DATA_DIR");
    if (string.IsNullOrWhiteSpace(dataDirectory))
        dataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "iPresenterPlux", "Edge");
    var deviceName = Environment.GetEnvironmentVariable("IPRESENTERPLUX_DEVICE_NAME");
    if (string.IsNullOrWhiteSpace(deviceName)) deviceName = Environment.MachineName;
    var softwareVersion = typeof(MacOSPlatformProfile).Assembly.GetName().Version?.ToString(3) ?? "0.1.0";

    var nativeBridge = new MacOSNativeMediaBridge();
    await using var identityStore = new FileAgentIdentityStore(dataDirectory);
    await using var queue = new FileOutboundEventQueue(dataDirectory);
    using var credentialStore = new MacOSCredentialStore(nativeBridge);
    using var http = new HttpClient { BaseAddress = controlUrl, Timeout = TimeSpan.FromSeconds(15) };

    var pairingCode = Environment.GetEnvironmentVariable("IPRESENTERPLUX_PAIRING_CODE");
    Environment.SetEnvironmentVariable("IPRESENTERPLUX_PAIRING_CODE", null);
    if (await identityStore.ReadAsync(CancellationToken.None) is null && string.IsNullOrWhiteSpace(pairingCode) && Environment.UserInteractive)
    {
        pairingCode = ReadSecret("One-time pairing code: ");
    }

    var profile = MacOSPlatformProfile.Create(nativeBridge);
    var capabilities = profile.Capabilities.ToDictionary(item => item.Key, item => item.Status);
    using var runtime = new EdgeAgentRuntime(
        http,
        credentialStore,
        identityStore,
        queue,
        capabilities,
        new EdgeAgentRuntimeOptions(deviceName, softwareVersion, pairingCode));

    using var cts = new CancellationTokenSource();
    Console.CancelKeyPress += (_, args) => { args.Cancel = true; cts.Cancel(); };
    try
    {
        await runtime.RunAsync(cts.Token);
        return 0;
    }
    catch (OperationCanceledException) when (cts.IsCancellationRequested)
    {
        return 0;
    }
    catch (EdgeEnrollmentRequiredException error)
    {
        Console.Error.WriteLine(error.Message);
        return 3;
    }
}

static string? ReadSecret(string prompt)
{
    Console.Write(prompt);
    var chars = new List<char>();
    while (true)
    {
        var key = Console.ReadKey(intercept: true);
        if (key.Key == ConsoleKey.Enter) break;
        if (key.Key == ConsoleKey.Backspace)
        {
            if (chars.Count > 0) chars.RemoveAt(chars.Count - 1);
            continue;
        }
        if (!char.IsControl(key.KeyChar)) chars.Add(key.KeyChar);
    }
    Console.WriteLine();
    return chars.Count == 0 ? null : new string(chars.ToArray()).Trim();
}
