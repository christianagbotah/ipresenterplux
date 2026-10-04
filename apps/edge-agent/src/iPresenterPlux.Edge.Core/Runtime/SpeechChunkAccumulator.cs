using iPresenterPlux.Edge.Core.Contracts;

namespace iPresenterPlux.Edge.Core.Runtime;

public sealed class SpeechChunkAccumulator(int sampleRate = 16_000, TimeSpan? chunkDuration = null)
{
    private readonly int _sampleRate = sampleRate > 0 ? sampleRate : throw new ArgumentOutOfRangeException(nameof(sampleRate));
    private readonly int _targetSamples = checked((int)Math.Round(sampleRate * (chunkDuration ?? TimeSpan.FromSeconds(5)).TotalSeconds));
    private readonly List<short> _pending = [];
    private DateTimeOffset? _startedAt;

    public IReadOnlyList<SpeechAudioChunk> Append(ReadOnlySpan<short> samples, DateTimeOffset startedAt)
    {
        if (_targetSamples <= 0) throw new InvalidOperationException("Speech chunk duration must produce at least one sample.");
        if (samples.IsEmpty) return Array.Empty<SpeechAudioChunk>();
        _startedAt ??= startedAt;
        foreach (var sample in samples) _pending.Add(sample);

        var chunks = new List<SpeechAudioChunk>();
        while (_pending.Count >= _targetSamples)
        {
            var data = _pending.GetRange(0, _targetSamples).ToArray();
            _pending.RemoveRange(0, _targetSamples);
            var duration = TimeSpan.FromSeconds(_targetSamples / (double)_sampleRate);
            var chunkStart = _startedAt!.Value;
            chunks.Add(new SpeechAudioChunk(data, _sampleRate, chunkStart, duration));
            _startedAt = chunkStart + duration;
        }
        return chunks.AsReadOnly();
    }

    public void Reset()
    {
        _pending.Clear();
        _startedAt = null;
    }
}
