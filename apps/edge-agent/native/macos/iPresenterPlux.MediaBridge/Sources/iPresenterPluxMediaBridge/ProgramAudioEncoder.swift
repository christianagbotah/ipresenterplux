import Foundation
import AVFoundation
import AudioToolbox

public typealias EdgeEncodedAudioCallback = @convention(c) (
    UnsafePointer<UInt8>?, Int32, Int32, Int32, Int64, Int64
) -> Void

private final class EdgeProgramAudioEncoder: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.lightworldtech.ipresenterplux.edge.program-audio")
    private var converter: AVAudioConverter?
    private var inputFormat: AVAudioFormat?
    private var outputFormat: AVAudioFormat?
    private var callback: EdgeEncodedAudioCallback?
    private var sampleRate: Int32 = 0
    private var channels: Int32 = 0
    private var pendingTimestamps: [(pts: Int64, duration: Int64)] = []

    func start(
        sampleRate: Int32,
        channels: Int32,
        bitrate: Int32,
        callback: @escaping EdgeEncodedAudioCallback
    ) -> Int32 {
        queue.sync {
            if converter != nil { return 0 }
            guard sampleRate == 44_100 || sampleRate == 48_000,
                  channels == 2,
                  bitrate == 96_000 || bitrate == 128_000 || bitrate == 160_000 || bitrate == 192_000,
                  let pcm = AVAudioFormat(
                    commonFormat: .pcmFormatInt16,
                    sampleRate: Double(sampleRate),
                    channels: AVAudioChannelCount(channels),
                    interleaved: true
                  ) else {
                return -3010
            }

            let outputSettings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: Double(sampleRate),
                AVNumberOfChannelsKey: Int(channels),
                AVEncoderBitRateKey: Int(bitrate),
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ]
            guard let aac = AVAudioFormat(settings: outputSettings),
                  let converter = AVAudioConverter(from: pcm, to: aac) else {
                return -3011
            }

            self.converter = converter
            self.inputFormat = pcm
            self.outputFormat = aac
            self.callback = callback
            self.sampleRate = sampleRate
            self.channels = channels
            self.pendingTimestamps.removeAll(keepingCapacity: true)
            return 0
        }
    }

    func encode(
        bytes: UnsafePointer<UInt8>?,
        length: Int32,
        presentationTimestampMicroseconds: Int64,
        durationMicroseconds: Int64
    ) -> Int32 {
        guard let bytes, length > 0 else { return -3012 }
        return queue.sync {
            guard let converter, let inputFormat, let outputFormat, let callback else { return -3013 }
            let bytesPerFrame = Int(channels) * MemoryLayout<Int16>.size
            guard bytesPerFrame > 0,
                  Int(length) % bytesPerFrame == 0 else { return -3014 }
            let frameCount = Int(length) / bytesPerFrame
            guard frameCount == 1024,
                  let pcm = AVAudioPCMBuffer(
                    pcmFormat: inputFormat,
                    frameCapacity: AVAudioFrameCount(frameCount)
                  ) else { return -3015 }

            pcm.frameLength = AVAudioFrameCount(frameCount)
            let audioBufferList = pcm.mutableAudioBufferList
            guard audioBufferList.pointee.mNumberBuffers > 0,
                  let destination = audioBufferList.pointee.mBuffers.mData else { return -3016 }
            memcpy(destination, bytes, Int(length))
            audioBufferList.pointee.mBuffers.mDataByteSize = UInt32(length)

            let compressed = AVAudioCompressedBuffer(
                format: outputFormat,
                packetCapacity: 1,
                maximumPacketSize: 8192
            )
            pendingTimestamps.append((presentationTimestampMicroseconds, durationMicroseconds))
            var supplied = false
            var conversionError: NSError?
            let status = converter.convert(to: compressed, error: &conversionError) { _, inputStatus in
                if supplied {
                    inputStatus.pointee = .noDataNow
                    return nil
                }
                supplied = true
                inputStatus.pointee = .haveData
                return pcm
            }

            if status == .error || conversionError != nil {
                if !pendingTimestamps.isEmpty { pendingTimestamps.removeLast() }
                return -3017
            }
            guard compressed.byteLength > 0, compressed.packetCount > 0 else {
                return 0 // Codec priming may delay the first access unit.
            }

            let payload = Data(bytes: compressed.data, count: Int(compressed.byteLength))
            guard let adts = makeAdtsFrame(payload: payload) else { return -3018 }
            let timing = pendingTimestamps.isEmpty
                ? (presentationTimestampMicroseconds, durationMicroseconds)
                : pendingTimestamps.removeFirst()
            adts.withUnsafeBytes { raw in
                callback(
                    raw.baseAddress?.assumingMemoryBound(to: UInt8.self),
                    Int32(raw.count),
                    sampleRate,
                    channels,
                    timing.0,
                    timing.1
                )
            }
            return 0
        }
    }

    func stop() -> Int32 {
        queue.sync {
            converter?.reset()
            converter = nil
            inputFormat = nil
            outputFormat = nil
            callback = nil
            sampleRate = 0
            channels = 0
            pendingTimestamps.removeAll(keepingCapacity: false)
            return 0
        }
    }

    private func makeAdtsFrame(payload: Data) -> Data? {
        let frequencyIndex: Int
        switch sampleRate {
        case 48_000: frequencyIndex = 3
        case 44_100: frequencyIndex = 4
        default: return nil
        }
        let channelConfig = Int(channels)
        let fullLength = payload.count + 7
        guard fullLength <= 0x1FFF else { return nil }

        var header = [UInt8](repeating: 0, count: 7)
        header[0] = 0xFF
        header[1] = 0xF1 // MPEG-4, layer 0, no CRC.
        header[2] = UInt8((1 << 6) | (frequencyIndex << 2) | ((channelConfig >> 2) & 0x01)) // AAC-LC.
        header[3] = UInt8(((channelConfig & 0x03) << 6) | ((fullLength >> 11) & 0x03))
        header[4] = UInt8((fullLength >> 3) & 0xFF)
        header[5] = UInt8(((fullLength & 0x07) << 5) | 0x1F)
        header[6] = 0xFC

        var frame = Data(header)
        frame.append(payload)
        return frame
    }
}

private final class EdgeProgramAudioEncoderRegistry: @unchecked Sendable {
    static let shared = EdgeProgramAudioEncoderRegistry()
    let encoder = EdgeProgramAudioEncoder()
    private init() {}
}

@_cdecl("ipresenterplux_macos_program_audio_start")
public func programAudioStart(
    _ sampleRate: Int32,
    _ channels: Int32,
    _ bitrate: Int32,
    _ callback: EdgeEncodedAudioCallback?
) -> Int32 {
    guard let callback else { return -3020 }
    return EdgeProgramAudioEncoderRegistry.shared.encoder.start(
        sampleRate: sampleRate,
        channels: channels,
        bitrate: bitrate,
        callback: callback
    )
}

@_cdecl("ipresenterplux_macos_program_audio_encode")
public func programAudioEncode(
    _ bytes: UnsafePointer<UInt8>?,
    _ length: Int32,
    _ presentationTimestampMicroseconds: Int64,
    _ durationMicroseconds: Int64
) -> Int32 {
    EdgeProgramAudioEncoderRegistry.shared.encoder.encode(
        bytes: bytes,
        length: length,
        presentationTimestampMicroseconds: presentationTimestampMicroseconds,
        durationMicroseconds: durationMicroseconds
    )
}

@_cdecl("ipresenterplux_macos_program_audio_stop")
public func programAudioStop() -> Int32 {
    EdgeProgramAudioEncoderRegistry.shared.encoder.stop()
}
