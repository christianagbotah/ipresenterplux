using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Transport;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Queues;
using iPresenterPlux.Edge.Core.Journals;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.Security;
using iPresenterPlux.Edge.Windows;

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
    if (controlUrl.Scheme != Uri.UriSchemeHttps && !controlUrl.IsLoopback)
    {
        Console.Error.WriteLine("Remote control planes must use HTTPS; plain HTTP is allowed only for loopback development.");
        return 2;
    }

    var dataDirectory = Environment.GetEnvironmentVariable("IPRESENTERPLUX_DATA_DIR");
    if (string.IsNullOrWhiteSpace(dataDirectory))
        dataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "iPresenterPlux", "Edge");
    var deviceName = Environment.GetEnvironmentVariable("IPRESENTERPLUX_DEVICE_NAME");
    if (string.IsNullOrWhiteSpace(deviceName)) deviceName = Environment.MachineName;
    var softwareVersion = typeof(WindowsPlatformProfile).Assembly.GetName().Version?.ToString(3) ?? "0.1.0";
    Guid? activeServiceId = null;
    var serviceIdText = Environment.GetEnvironmentVariable("IPRESENTERPLUX_SERVICE_ID");
    if (!string.IsNullOrWhiteSpace(serviceIdText))
    {
        if (!Guid.TryParse(serviceIdText, out var parsedServiceId))
        {
            Console.Error.WriteLine("IPRESENTERPLUX_SERVICE_ID must be a valid UUID.");
            return 2;
        }
        activeServiceId = parsedServiceId;
    }

    await using var identityStore = new FileAgentIdentityStore(dataDirectory);
    await using var queue = new FileOutboundEventQueue(dataDirectory);
    using var credentialStore = new WindowsCredentialStore();
    await using var audioCapture = new WindowsWasapiAudioCaptureService();
    using var http = new HttpClient { BaseAddress = controlUrl, Timeout = TimeSpan.FromSeconds(15) };
    using var asrHttp = CreateAsrHttpClient();
    ISpeechRecognitionEngine? speechRecognition = asrHttp is null ? null : new HttpSpeechRecognitionEngine(asrHttp);
    await using var mediaOutput = await CreateProgramOutputAsync(dataDirectory);
    await using var recordingService = new LocalAudioRecordingService(dataDirectory);
    activeServiceId ??= mediaOutput.LastKnownServiceId;

    ProgramDisplayConfiguration displayConfiguration;
    try
    {
        displayConfiguration = ProgramDisplayConfiguration.FromEnvironment(Environment.UserInteractive);
    }
    catch (InvalidOperationException error)
    {
        Console.Error.WriteLine(error.Message);
        return 2;
    }
    await using var programDisplay = WindowsProgramDisplay.Create(dataDirectory, displayConfiguration.BrowserPath);
    if (displayConfiguration.AutoOpen && mediaOutput.Snapshot.OutputRunning)
    {
        var opened = await programDisplay.LaunchAsync(mediaOutput.ProgramUri, displayConfiguration.Placement, CancellationToken.None);
        if (!opened) Console.Error.WriteLine($"No supported Chromium browser was available for kiosk Program output. Open {mediaOutput.ProgramUri} manually.");
    }

    var contributionAudioBuffer = new BoundedContributionAudioBuffer();
    var contributionTransport = new EncodedContributionStreamTransport(
        new WindowsMediaFoundationEncodedProgramVideoSource(
            new RenderedProgramVideoSource(mediaOutput, new SkiaProgramFrameRenderer())),
        new WindowsMediaFoundationEncodedProgramAudioSource(contributionAudioBuffer),
        new LibSrtContributionSender(),
        () => new ProgramVideoCaptureTarget(Environment.ProcessId, "iPresenterPlux program"));
    await using var streamPublisher = new ContributionMasterStreamPublisher(
        new DeferredStreamContributionClient(http, identityStore, credentialStore),
        contributionTransport);
    var runtimeMediaOutput = new StreamPublishingMediaOutputService(mediaOutput, streamPublisher);
    EventHandler<AudioFrame> contributionAudioHandler = (_, frame) =>
    {
        _ = contributionAudioBuffer.TrySubmit(frame);
    };
    audioCapture.AudioFrameCaptured += contributionAudioHandler;

    var pairingCode = Environment.GetEnvironmentVariable("IPRESENTERPLUX_PAIRING_CODE");
    Environment.SetEnvironmentVariable("IPRESENTERPLUX_PAIRING_CODE", null);
    if (await identityStore.ReadAsync(CancellationToken.None) is null && string.IsNullOrWhiteSpace(pairingCode) && Environment.UserInteractive)
    {
        pairingCode = ReadSecret("One-time pairing code: ");
    }

    var profile = WindowsPlatformProfile.Create();
    var capabilities = profile.Capabilities.ToDictionary(item => item.Key, item => item.Status);
    using var runtime = new EdgeAgentRuntime(
        http,
        credentialStore,
        identityStore,
        queue,
        new FileCompletedCommandJournal(dataDirectory),
        capabilities,
        new EdgeAgentRuntimeOptions(deviceName, softwareVersion, pairingCode, activeServiceId),
        audioCapture: audioCapture,
        speechRecognitionEngine: speechRecognition,
        mediaOutput: runtimeMediaOutput,
        recordingService: recordingService);

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
    finally
    {
        audioCapture.AudioFrameCaptured -= contributionAudioHandler;
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

static async Task<LocalWebProgramOutputService> CreateProgramOutputAsync(string dataDirectory)
{
    const int defaultPort = 49321;
    var port = defaultPort;
    var configured = Environment.GetEnvironmentVariable("IPRESENTERPLUX_PROGRAM_PORT");
    if (!string.IsNullOrWhiteSpace(configured) &&
        (!int.TryParse(configured, out port) || port is < 1024 or > 65535))
    {
        Console.Error.WriteLine($"Invalid IPRESENTERPLUX_PROGRAM_PORT; using {defaultPort}.");
        port = defaultPort;
    }

    var output = new LocalWebProgramOutputService(port, new FileProgramStateStore(dataDirectory));
    try
    {
        await output.RestoreAsync(CancellationToken.None);
        await output.StartProgramOutputAsync(CancellationToken.None);
        Console.WriteLine($"Local Preview: {output.PreviewUri}");
        Console.WriteLine($"Local Program: {output.ProgramUri}");
    }
    catch (Exception error)
    {
        Console.Error.WriteLine($"Local Program renderer unavailable: {error.GetType().Name}: {error.Message}");
    }
    return output;
}

static HttpClient? CreateAsrHttpClient()
{
    var value = Environment.GetEnvironmentVariable("IPRESENTERPLUX_ASR_URL");
    if (string.IsNullOrWhiteSpace(value)) return null;
    if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
        (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
    {
        throw new InvalidOperationException("IPRESENTERPLUX_ASR_URL must be an absolute HTTP(S) URL.");
    }
    if (uri.Scheme != Uri.UriSchemeHttps && !uri.IsLoopback)
        throw new InvalidOperationException("Remote ASR workers must use HTTPS; plain HTTP is allowed only for loopback workers.");

    var token = Environment.GetEnvironmentVariable("IPRESENTERPLUX_ASR_TOKEN");
    Environment.SetEnvironmentVariable("IPRESENTERPLUX_ASR_TOKEN", null);
    var client = new HttpClient { BaseAddress = uri, Timeout = TimeSpan.FromSeconds(45) };
    if (!string.IsNullOrWhiteSpace(token))
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token.Trim());
    return client;
}
