using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;
using iPresenterPlux.Edge.Core.Models;
using iPresenterPlux.Edge.Core.Runtime;
using iPresenterPlux.Edge.Core.State;
using Xunit;

namespace iPresenterPlux.Edge.Core.Tests;

public sealed class VisualControlCommandProcessorTests
{
    [Fact]
    public async Task VisualRescanScansOnlyAndNeverTouchesProgram()
    {
        var state = LiveState(out var serviceId);
        var catalog = new FakeCatalog();
        var router = new FakeRouter();
        var output = new FakeMediaOutput();
        var processor = new ControlCommandProcessor(state, output, visualSourceCatalog: catalog, visualRouter: router);

        var result = await processor.ProcessAsync(Command(serviceId, "visual.rescan"), CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal(1, catalog.ScanCount);
        Assert.Equal(0, router.SelectCount);
        Assert.Equal(0, router.TakeCount);
        Assert.Equal(0, output.TakeCount);
    }

    [Fact]
    public async Task VisualPreviewSelectRequiresSourceIdAndOnlySelectsPreview()
    {
        var state = LiveState(out var serviceId);
        var router = new FakeRouter();
        var processor = new ControlCommandProcessor(state, visualRouter: router);

        var missing = await processor.ProcessAsync(Command(serviceId, "visual.preview.select"), CancellationToken.None);
        var selected = await processor.ProcessAsync(Command(serviceId, "visual.preview.select", new() { ["sourceId"] = "visual:camera:abc" }), CancellationToken.None);

        Assert.False(missing.Success);
        Assert.Equal("source_id_required", missing.Error);
        Assert.True(selected.Success);
        Assert.Equal("visual:camera:abc", router.LastSelectedSourceId);
        Assert.Equal(1, router.SelectCount);
        Assert.Equal(0, router.TakeCount);
    }

    [Fact]
    public async Task VisualPreviewClearClearsOnlyVisualPreview()
    {
        var state = LiveState(out var serviceId);
        var router = new FakeRouter(previewSourceId: "visual:camera:abc");
        var processor = new ControlCommandProcessor(state, visualRouter: router);

        var result = await processor.ProcessAsync(Command(serviceId, "visual.preview.clear"), CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal(1, router.ClearPreviewCount);
        Assert.Equal(0, router.TakeCount);
    }

    [Fact]
    public async Task PresentationPreviewClearsVisualPreviewBeforePreparingContent()
    {
        var state = LiveState(out var serviceId);
        var order = new List<string>();
        var router = new FakeRouter(previewSourceId: "visual:camera:abc", order: order);
        var output = new FakeMediaOutput(order);
        var item = Item(serviceId);
        var processor = new ControlCommandProcessor(state, output, new FakeContentProvider(item), visualRouter: router);

        var result = await processor.ProcessAsync(Command(serviceId, "preview.prepare", new() { ["itemId"] = item.ItemId }), CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal(["visual.clear", "presentation.preview"], order);
        Assert.Equal(1, router.ClearPreviewCount);
        Assert.Equal(item.ItemId, output.LastPreviewItem?.ItemId);
    }

    [Fact]
    public async Task ProgramTakePromotesVisualPreviewWithoutTakingPresentationPreview()
    {
        var state = LiveState(out var serviceId);
        var router = new FakeRouter(previewSourceId: "visual:camera:abc");
        var output = new FakeMediaOutput();
        var processor = new ControlCommandProcessor(state, output, visualRouter: router);

        var result = await processor.ProcessAsync(Command(serviceId, "program.take"), CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal(1, router.TakeCount);
        Assert.Equal(0, router.UseRenderedCount);
        Assert.Equal(0, output.TakeCount);
        Assert.Equal("visual:camera:abc", router.Snapshot.Program?.SourceId);
    }

    [Fact]
    public async Task ProgramTakeWithoutVisualPreviewUsesPresentationTakeAndRenderedProgram()
    {
        var state = LiveState(out var serviceId);
        var router = new FakeRouter();
        var output = new FakeMediaOutput();
        var processor = new ControlCommandProcessor(state, output, visualRouter: router);

        var result = await processor.ProcessAsync(Command(serviceId, "program.take"), CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal(1, output.TakeCount);
        Assert.Equal(0, router.TakeCount);
        Assert.Equal(1, router.UseRenderedCount);
    }

    [Fact]
    public async Task ProgramShowClearsVisualPreviewThenRestoresRenderedProgram()
    {
        var state = LiveState(out var serviceId);
        var order = new List<string>();
        var router = new FakeRouter(previewSourceId: "visual:camera:abc", order: order);
        var output = new FakeMediaOutput(order);
        var item = Item(serviceId);
        var processor = new ControlCommandProcessor(state, output, new FakeContentProvider(item), visualRouter: router);

        var result = await processor.ProcessAsync(Command(serviceId, "program.show", new() { ["itemId"] = item.ItemId }), CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal(["visual.clear", "presentation.preview", "presentation.take", "visual.rendered"], order);
        Assert.Equal(1, router.UseRenderedCount);
        Assert.Equal(1, output.TakeCount);
    }

    [Fact]
    public async Task ProgramClearKeepsTakeAuthorityAndRestoresRenderedProgram()
    {
        var state = LiveState(out var serviceId);
        var router = new FakeRouter(programSourceId: "visual:camera:abc");
        var output = new FakeMediaOutput();
        var processor = new ControlCommandProcessor(state, output, visualRouter: router);

        var result = await processor.ProcessAsync(Command(serviceId, "program.clear"), CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal(1, output.ClearCount);
        Assert.Equal(1, router.UseRenderedCount);
        Assert.Equal(0, router.TakeCount);
    }

    [Fact]
    public async Task ServiceScopeMismatchRejectsVisualCommandBeforeAnyMutation()
    {
        var state = LiveState(out _);
        var router = new FakeRouter();
        var catalog = new FakeCatalog();
        var processor = new ControlCommandProcessor(state, visualSourceCatalog: catalog, visualRouter: router);

        var result = await processor.ProcessAsync(Command(Guid.NewGuid(), "visual.preview.select", new() { ["sourceId"] = "visual:camera:abc" }), CancellationToken.None);

        Assert.False(result.Success);
        Assert.Equal("service_scope_mismatch", result.Error);
        Assert.Equal(0, router.SelectCount);
        Assert.Equal(0, catalog.ScanCount);
    }

    private static AgentRuntimeState LiveState(out Guid serviceId)
    {
        var assignedServiceId = Guid.NewGuid();
        serviceId = assignedServiceId;
        var state = new AgentRuntimeState();
        state.Update(snapshot => snapshot with { ActiveServiceId = assignedServiceId, ServiceMode = "live" });
        return state;
    }

    private static ControlCommand Command(Guid serviceId, string type, Dictionary<string, string>? arguments = null) =>
        new(Guid.NewGuid().ToString("D"), serviceId.ToString("D"), type, DateTimeOffset.UtcNow, arguments ?? new());

    private static PresentationRenderItem Item(Guid serviceId) =>
        new(Guid.NewGuid().ToString("D"), serviceId, "scripture", "John 3:16", "For God so loved the world", "KJV", new Dictionary<string, string>());

    private sealed class FakeCatalog : IVisualSourceCatalog
    {
        public int ScanCount { get; private set; }
        public Task<IReadOnlyList<VisualSourceDescriptor>> ScanAsync(CancellationToken cancellationToken)
        {
            ScanCount++;
            return Task.FromResult<IReadOnlyList<VisualSourceDescriptor>>([]);
        }
    }

    private sealed class FakeRouter : IVisualProgramRouter
    {
        private readonly List<string>? _order;
        public FakeRouter(string? previewSourceId = null, string? programSourceId = null, List<string>? order = null)
        {
            _order = order;
            Snapshot = new(
                previewSourceId is null ? null : Slot(previewSourceId),
                programSourceId is null ? null : Slot(programSourceId),
                programSourceId is null);
        }

        public VisualRouteSnapshot Snapshot { get; private set; }
        public int SelectCount { get; private set; }
        public int ClearPreviewCount { get; private set; }
        public int TakeCount { get; private set; }
        public int UseRenderedCount { get; private set; }
        public string? LastSelectedSourceId { get; private set; }

        public Task SelectPreviewAsync(string sourceId, CancellationToken cancellationToken)
        {
            SelectCount++;
            LastSelectedSourceId = sourceId;
            Snapshot = Snapshot with { Preview = Slot(sourceId) };
            _order?.Add("visual.select");
            return Task.CompletedTask;
        }

        public Task ClearPreviewAsync(CancellationToken cancellationToken)
        {
            ClearPreviewCount++;
            Snapshot = Snapshot with { Preview = null };
            _order?.Add("visual.clear");
            return Task.CompletedTask;
        }

        public Task TakePreviewAsync(CancellationToken cancellationToken)
        {
            TakeCount++;
            Snapshot = new(null, Snapshot.Preview, false);
            _order?.Add("visual.take");
            return Task.CompletedTask;
        }

        public Task UseRenderedProgramAsync(CancellationToken cancellationToken)
        {
            UseRenderedCount++;
            Snapshot = Snapshot with { Program = null, UsingRenderedProgram = true };
            _order?.Add("visual.rendered");
            return Task.CompletedTask;
        }

        public ProgramVideoFrame GetCurrentFrame() => new(2, 2, 8, "bgra32", new byte[16], null, DateTimeOffset.UtcNow);
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        private static VisualRouteSlot Slot(string sourceId) => new(sourceId, VisualSourceKind.Camera, VisualSourceAvailability.Available, true, null);
    }

    private sealed class FakeContentProvider(PresentationRenderItem item) : IPresentationContentProvider
    {
        public Task<PresentationRenderItem> GetAsync(string itemId, CancellationToken cancellationToken)
        {
            Assert.Equal(item.ItemId, itemId);
            return Task.FromResult(item);
        }
    }

    private sealed class FakeMediaOutput(List<string>? order = null) : IMediaOutputService
    {
        public int ClearCount { get; private set; }
        public int TakeCount { get; private set; }
        public PresentationRenderItem? LastPreviewItem { get; private set; }
        public Task StartProgramOutputAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StopProgramOutputAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task SetPreviewAsync(PresentationRenderItem item, CancellationToken cancellationToken) { LastPreviewItem = item; order?.Add("presentation.preview"); return Task.CompletedTask; }
        public Task TakePreviewToProgramAsync(CancellationToken cancellationToken) { TakeCount++; order?.Add("presentation.take"); return Task.CompletedTask; }
        public Task ClearProgramAsync(CancellationToken cancellationToken) { ClearCount++; order?.Add("presentation.clear"); return Task.CompletedTask; }
    }
}
