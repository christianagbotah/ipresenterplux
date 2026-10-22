import Foundation
import AVFoundation
import CoreMedia
import AudioToolbox

struct MediaAudioChunk {
    let data: Data
    let timestampMicroseconds: Int64
}

enum MediaAudioDecoderError: Error {
    case invalidPath
    case invalidFormat
    case missingAudioTrack
    case readerCreationFailed
    case readerStartFailed
    case decodeFailed
}

final class MediaAudioDecoder: @unchecked Sendable {
    private let path: String
    private let sampleRate: Int
    private let channels: Int
    private let bytesPerFrame: Int
    private var reader: AVAssetReader?
    private var output: AVAssetReaderTrackOutput?
    private var pending = Data()
    private var pendingOffset = 0
    private var nextTimestampMicroseconds: Int64 = 0
    private var closed = false

    init(path: String, sampleRate: Int, channels: Int) throws {
        guard path.hasPrefix("/"), !path.contains("://"), FileManager.default.fileExists(atPath: path) else {
            throw MediaAudioDecoderError.invalidPath
        }
        guard (8_000...192_000).contains(sampleRate), (1...2).contains(channels) else {
            throw MediaAudioDecoderError.invalidFormat
        }
        self.path = path
        self.sampleRate = sampleRate
        self.channels = channels
        self.bytesPerFrame = channels * MemoryLayout<Int16>.size
        try rebuildReader(atSeconds: 0)
    }

    func seek(toSeconds seconds: Double) throws {
        guard seconds.isFinite, seconds >= 0, !closed else { throw MediaAudioDecoderError.invalidFormat }
        try rebuildReader(atSeconds: seconds)
    }

    func read(frameSamples: Int) throws -> MediaAudioChunk? {
        guard !closed, frameSamples > 0, frameSamples <= 16_384 else {
            throw MediaAudioDecoderError.invalidFormat
        }
        let requiredBytes = frameSamples * bytesPerFrame
        var result = Data(capacity: requiredBytes)
        let timestamp = nextTimestampMicroseconds

        while result.count < requiredBytes {
            if pendingOffset < pending.count {
                let available = pending.count - pendingOffset
                let take = min(available, requiredBytes - result.count)
                result.append(pending[pendingOffset..<(pendingOffset + take)])
                pendingOffset += take
                if pendingOffset >= pending.count {
                    pending.removeAll(keepingCapacity: true)
                    pendingOffset = 0
                }
                continue
            }

            guard let output else { break }
            guard let sampleBuffer = output.copyNextSampleBuffer() else {
                if reader?.status == .failed { throw MediaAudioDecoderError.decodeFailed }
                break
            }
            guard let block = CMSampleBufferGetDataBuffer(sampleBuffer) else { continue }
            let length = CMBlockBufferGetDataLength(block)
            if length <= 0 { continue }
            var bytes = [UInt8](repeating: 0, count: length)
            let status = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: &bytes)
            guard status == kCMBlockBufferNoErr else { throw MediaAudioDecoderError.decodeFailed }
            pending = Data(bytes)
            pendingOffset = 0
        }

        guard !result.isEmpty else { return nil }
        if result.count < requiredBytes {
            result.append(Data(repeating: 0, count: requiredBytes - result.count))
        }
        nextTimestampMicroseconds += Int64((Double(frameSamples) / Double(sampleRate) * 1_000_000).rounded())
        return MediaAudioChunk(data: result, timestampMicroseconds: timestamp)
    }

    func close() {
        if closed { return }
        reader?.cancelReading()
        reader = nil
        output = nil
        pending.removeAll(keepingCapacity: false)
        pendingOffset = 0
        closed = true
    }

    deinit { close() }

    private func rebuildReader(atSeconds seconds: Double) throws {
        reader?.cancelReading()
        pending.removeAll(keepingCapacity: true)
        pendingOffset = 0
        closed = false

        let asset = AVURLAsset(url: URL(fileURLWithPath: path))
        guard let track = asset.tracks(withMediaType: .audio).first else {
            throw MediaAudioDecoderError.missingAudioTrack
        }
        let newReader: AVAssetReader
        do { newReader = try AVAssetReader(asset: asset) }
        catch { throw MediaAudioDecoderError.readerCreationFailed }

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channels,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false
        ]
        let newOutput = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
        newOutput.alwaysCopiesSampleData = false
        guard newReader.canAdd(newOutput) else { throw MediaAudioDecoderError.readerCreationFailed }
        newReader.add(newOutput)
        if seconds > 0 {
            let start = CMTime(seconds: seconds, preferredTimescale: 1_000_000)
            let duration = CMTimeSubtract(asset.duration, start)
            if duration > .zero { newReader.timeRange = CMTimeRange(start: start, duration: duration) }
        }
        guard newReader.startReading() else { throw MediaAudioDecoderError.readerStartFailed }
        reader = newReader
        output = newOutput
        nextTimestampMicroseconds = Int64((seconds * 1_000_000).rounded())
    }
}

private final class MediaAudioDecoderRegistry: @unchecked Sendable {
    static let shared = MediaAudioDecoderRegistry()
    let queue = DispatchQueue(label: "com.lightworldtech.ipresenterplux.edge.media-audio")
    var nextHandle: Int64 = 1
    var decoders: [Int64: MediaAudioDecoder] = [:]
    private init() {}
}

private func mediaAudioString(_ pointer: UnsafePointer<CChar>?) -> String? {
    guard let pointer else { return nil }
    return String(validatingCString: pointer)
}

@_cdecl("ipresenterplux_macos_media_audio_open")
public func mediaAudioOpen(
    _ pathPointer: UnsafePointer<CChar>?,
    _ sampleRate: Int32,
    _ channels: Int32,
    _ outputHandle: UnsafeMutablePointer<Int64>?
) -> Int32 {
    guard let path = mediaAudioString(pathPointer), let outputHandle else { return -2201 }
    let registry = MediaAudioDecoderRegistry.shared
    return registry.queue.sync {
        do {
            let decoder = try MediaAudioDecoder(path: path, sampleRate: Int(sampleRate), channels: Int(channels))
            let handle = registry.nextHandle
            registry.nextHandle += 1
            registry.decoders[handle] = decoder
            outputHandle.pointee = handle
            return 0
        } catch {
            return -2202
        }
    }
}

@_cdecl("ipresenterplux_macos_media_audio_seek")
public func mediaAudioSeek(_ handle: Int64, _ positionMicroseconds: Int64) -> Int32 {
    guard handle > 0, positionMicroseconds >= 0 else { return -2210 }
    let registry = MediaAudioDecoderRegistry.shared
    return registry.queue.sync {
        guard let decoder = registry.decoders[handle] else { return -2211 }
        do {
            try decoder.seek(toSeconds: Double(positionMicroseconds) / 1_000_000)
            return 0
        } catch {
            return -2212
        }
    }
}

@_cdecl("ipresenterplux_macos_media_audio_read")
public func mediaAudioRead(
    _ handle: Int64,
    _ frameSamples: Int32,
    _ outputBytes: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>?,
    _ outputLength: UnsafeMutablePointer<Int32>?,
    _ outputTimestampMicroseconds: UnsafeMutablePointer<Int64>?
) -> Int32 {
    guard handle > 0, frameSamples > 0, let outputBytes, let outputLength, let outputTimestampMicroseconds else { return -2220 }
    let registry = MediaAudioDecoderRegistry.shared
    return registry.queue.sync {
        guard let decoder = registry.decoders[handle] else { return -2221 }
        do {
            guard let chunk = try decoder.read(frameSamples: Int(frameSamples)) else {
                outputBytes.pointee = nil
                outputLength.pointee = 0
                outputTimestampMicroseconds.pointee = 0
                return 1
            }
            guard !chunk.data.isEmpty, chunk.data.count <= Int(Int32.max) else { return -2222 }
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: chunk.data.count)
            chunk.data.copyBytes(to: buffer, count: chunk.data.count)
            outputBytes.pointee = buffer
            outputLength.pointee = Int32(chunk.data.count)
            outputTimestampMicroseconds.pointee = chunk.timestampMicroseconds
            return 0
        } catch {
            return -2223
        }
    }
}

@_cdecl("ipresenterplux_macos_media_audio_close")
public func mediaAudioClose(_ handle: Int64) -> Int32 {
    guard handle > 0 else { return 0 }
    let registry = MediaAudioDecoderRegistry.shared
    return registry.queue.sync {
        registry.decoders.removeValue(forKey: handle)?.close()
        return 0
    }
}
