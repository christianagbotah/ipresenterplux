using System.Runtime.CompilerServices;
using System.Threading.Channels;
using iPresenterPlux.Edge.Core.Abstractions;
using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class BoundedContributionAudioBuffer : IContributionAudioBuffer
{
    private readonly object _gate = new();
    private readonly Channel<AudioFrame> _frames;
    private bool _enabled;
    private Guid? _serviceId;
    private long _acceptedFrames;
    private long _droppedFrames;

    public BoundedContributionAudioBuffer(int capacity = 256)
    {
        if (capacity < 1 || capacity > 8192) throw new ArgumentOutOfRangeException(nameof(capacity));
        _frames = Channel.CreateBounded<AudioFrame>(new BoundedChannelOptions(capacity)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.Wait,
            AllowSynchronousContinuations = false
        });
    }

    public ContributionAudioBufferStatus Status
    {
        get
        {
            lock (_gate)
            {
                return new ContributionAudioBufferStatus(
                    _enabled,
                    _serviceId,
                    Interlocked.Read(ref _acceptedFrames),
                    Interlocked.Read(ref _droppedFrames));
            }
        }
    }

    public void Enable(Guid serviceId)
    {
        if (serviceId == Guid.Empty) throw new ArgumentException("Service ID must be nonempty.", nameof(serviceId));
        lock (_gate)
        {
            if (_enabled && _serviceId == serviceId) return;
            DrainQueuedFrames();
            _serviceId = serviceId;
            _enabled = true;
            Interlocked.Exchange(ref _acceptedFrames, 0);
            Interlocked.Exchange(ref _droppedFrames, 0);
        }
    }

    public void Disable()
    {
        lock (_gate)
        {
            _enabled = false;
            _serviceId = null;
            DrainQueuedFrames();
        }
    }

    public bool TrySubmit(AudioFrame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);

        lock (_gate)
        {
            if (!_enabled) return false;
        }

        if (frame.BytesRecorded <= 0 ||
            frame.BytesRecorded > frame.Buffer.Length ||
            frame.SampleRate <= 0 ||
            frame.Channels <= 0 ||
            frame.BitsPerSample <= 0)
        {
            Interlocked.Increment(ref _droppedFrames);
            return false;
        }

        // Audio capture implementations may reuse native/managed buffers after the callback returns.
        // Streaming therefore owns a bounded copy rather than retaining capture memory.
        var owned = frame.Buffer.Slice(0, frame.BytesRecorded).ToArray();
        var copy = frame with { Buffer = owned, BytesRecorded = owned.Length };
        if (_frames.Writer.TryWrite(copy))
        {
            Interlocked.Increment(ref _acceptedFrames);
            return true;
        }

        Interlocked.Increment(ref _droppedFrames);
        return false;
    }

    public async IAsyncEnumerable<AudioFrame> ReadAllAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        while (await _frames.Reader.WaitToReadAsync(cancellationToken).ConfigureAwait(false))
        {
            while (_frames.Reader.TryRead(out var frame))
                yield return frame;
        }
    }

    private void DrainQueuedFrames()
    {
        while (_frames.Reader.TryRead(out _)) { }
    }
}
