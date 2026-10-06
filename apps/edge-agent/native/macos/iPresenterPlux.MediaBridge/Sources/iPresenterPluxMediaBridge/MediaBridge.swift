import Foundation
import AVFoundation
import CoreAudio
import ScreenCaptureKit
import Security
import VideoToolbox

@_cdecl("ipresenterplux_macos_bridge_api_version")
public func bridgeApiVersion() -> Int32 {
    3
}

@_cdecl("ipresenterplux_macos_is_screen_capture_supported")
public func isScreenCaptureSupported() -> Int32 {
    if #available(macOS 14.0, *) {
        return 1
    }
    return 0
}

@_cdecl("ipresenterplux_macos_is_camera_capture_supported")
public func isCameraCaptureSupported() -> Int32 {
    return 1
}

@_cdecl("ipresenterplux_macos_is_audio_capture_supported")
public func isAudioCaptureSupported() -> Int32 {
    return 1
}

private func stringFromUtf8(_ pointer: UnsafePointer<CChar>?) -> String? {
    guard let pointer else { return nil }
    return String(validatingCString: pointer)
}

@_cdecl("ipresenterplux_macos_keychain_write")
public func keychainWrite(
    _ servicePointer: UnsafePointer<CChar>?,
    _ accountPointer: UnsafePointer<CChar>?,
    _ bytes: UnsafePointer<UInt8>?,
    _ length: Int32
) -> Int32 {
    guard
        let service = stringFromUtf8(servicePointer),
        let account = stringFromUtf8(accountPointer),
        let bytes,
        length > 0
    else {
        return Int32(errSecParam)
    }

    let data = Data(bytes: bytes, count: Int(length))
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account
    ]
    let update: [String: Any] = [
        kSecValueData as String: data
    ]

    let updateStatus = SecItemUpdate(query as CFDictionary, update as CFDictionary)
    if updateStatus != errSecItemNotFound {
        return Int32(updateStatus)
    }

    var add = query
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    return Int32(SecItemAdd(add as CFDictionary, nil))
}

@_cdecl("ipresenterplux_macos_keychain_read")
public func keychainRead(
    _ servicePointer: UnsafePointer<CChar>?,
    _ accountPointer: UnsafePointer<CChar>?,
    _ outputBytes: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>?,
    _ outputLength: UnsafeMutablePointer<Int32>?
) -> Int32 {
    guard
        let service = stringFromUtf8(servicePointer),
        let account = stringFromUtf8(accountPointer),
        let outputBytes,
        let outputLength
    else {
        return Int32(errSecParam)
    }

    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne
    ]

    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess else {
        return Int32(status)
    }
    guard let data = result as? Data, !data.isEmpty, data.count <= Int(Int32.max) else {
        return Int32(errSecDecode)
    }

    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: data.count)
    data.copyBytes(to: buffer, count: data.count)
    outputBytes.pointee = buffer
    outputLength.pointee = Int32(data.count)
    return Int32(errSecSuccess)
}

@_cdecl("ipresenterplux_macos_keychain_delete")
public func keychainDelete(
    _ servicePointer: UnsafePointer<CChar>?,
    _ accountPointer: UnsafePointer<CChar>?
) -> Int32 {
    guard
        let service = stringFromUtf8(servicePointer),
        let account = stringFromUtf8(accountPointer)
    else {
        return Int32(errSecParam)
    }

    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account
    ]
    return Int32(SecItemDelete(query as CFDictionary))
}

@_cdecl("ipresenterplux_macos_keychain_free")
public func keychainFree(_ bytes: UnsafeMutablePointer<UInt8>?, _ length: Int32) {
    guard let bytes, length > 0 else { return }
    for index in 0..<Int(length) {
        bytes[index] = 0
    }
    bytes.deallocate()
}

// Native capture sessions are intentionally added behind this stable C ABI.
// .NET owns service orchestration; Swift owns macOS-only media and Keychain APIs.

private struct EdgeAudioInputInfo: Codable {
    let id: String
    let name: String
    let channels: Int32
    let sampleRate: Int32
    let isDefault: Bool
}

public typealias EdgeAudioFrameCallback = @convention(c) (
    UnsafePointer<UInt8>?, Int32, Int32, Int32, Int32, Int32, Int64
) -> Void

private final class EdgeAudioEngineCapture: @unchecked Sendable {
    let engine = AVAudioEngine()
    private let callbackLock = NSLock()
    private var callback: EdgeAudioFrameCallback?
    var running = false

    func start(callback: @escaping EdgeAudioFrameCallback) throws {
        if running { return }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(domain: "iPresenterPlux.Audio", code: 1)
        }
        callbackLock.lock()
        self.callback = callback
        callbackLock.unlock()
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
            self?.emit(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
            running = true
        } catch {
            input.removeTap(onBus: 0)
            callbackLock.lock()
            self.callback = nil
            callbackLock.unlock()
            throw error
        }
    }

    func stop() {
        guard running || callback != nil else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        callbackLock.lock()
        callback = nil
        callbackLock.unlock()
        running = false
    }

    private func emit(_ buffer: AVAudioPCMBuffer) {
        callbackLock.lock()
        let currentCallback = callback
        callbackLock.unlock()
        guard let callback = currentCallback, buffer.frameLength > 0 else { return }
        let format = buffer.format
        let channels = Int(format.channelCount)
        let frames = Int(buffer.frameLength)
        let sampleRate = Int32(format.sampleRate.rounded())
        let capturedAt = Int64(Date().timeIntervalSince1970 * 1000.0)

        if format.commonFormat == .pcmFormatFloat32, let channelData = buffer.floatChannelData {
            var interleaved = [Float](repeating: 0, count: frames * channels)
            for frame in 0..<frames {
                for channel in 0..<channels {
                    interleaved[frame * channels + channel] = channelData[channel][frame]
                }
            }
            interleaved.withUnsafeBytes { raw in
                callback(
                    raw.baseAddress?.assumingMemoryBound(to: UInt8.self),
                    Int32(raw.count), sampleRate, Int32(channels), 32, 1, capturedAt
                )
            }
            return
        }

        if format.commonFormat == .pcmFormatInt16, let channelData = buffer.int16ChannelData {
            var interleaved = [Int16](repeating: 0, count: frames * channels)
            for frame in 0..<frames {
                for channel in 0..<channels {
                    interleaved[frame * channels + channel] = channelData[channel][frame]
                }
            }
            interleaved.withUnsafeBytes { raw in
                callback(
                    raw.baseAddress?.assumingMemoryBound(to: UInt8.self),
                    Int32(raw.count), sampleRate, Int32(channels), 16, 0, capturedAt
                )
            }
        }
    }
}

private final class EdgeAudioCaptureRegistry: @unchecked Sendable {
    static let shared = EdgeAudioCaptureRegistry()
    let queue = DispatchQueue(label: "com.lightworldtech.ipresenterplux.edge.audio")
    var capture: EdgeAudioEngineCapture?
    private init() {}
}

@_cdecl("ipresenterplux_macos_audio_inputs_json")
public func audioInputsJson(
    _ outputBytes: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>?,
    _ outputLength: UnsafeMutablePointer<Int32>?
) -> Int32 {
    guard let outputBytes, let outputLength else { return Int32(errSecParam) }
    guard let device = AVCaptureDevice.default(for: .audio) else { return -1001 }

    let engine = AVAudioEngine()
    let format = engine.inputNode.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else { return -1002 }
    let input = EdgeAudioInputInfo(
        id: device.uniqueID,
        name: device.localizedName,
        channels: Int32(format.channelCount),
        sampleRate: Int32(format.sampleRate.rounded()),
        isDefault: true
    )
    guard let data = try? JSONEncoder().encode([input]), !data.isEmpty, data.count <= Int(Int32.max) else {
        return -1003
    }
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: data.count)
    data.copyBytes(to: buffer, count: data.count)
    outputBytes.pointee = buffer
    outputLength.pointee = Int32(data.count)
    return 0
}

@_cdecl("ipresenterplux_macos_audio_start")
public func audioStart(
    _ deviceIdPointer: UnsafePointer<CChar>?,
    _ callback: EdgeAudioFrameCallback?
) -> Int32 {
    guard let deviceId = stringFromUtf8(deviceIdPointer), let callback else { return -1010 }
    guard let device = AVCaptureDevice.default(for: .audio), device.uniqueID == deviceId else { return -1011 }

    let registry = EdgeAudioCaptureRegistry.shared
    return registry.queue.sync {
        if registry.capture?.running == true { return 0 }
        let capture = EdgeAudioEngineCapture()
        do {
            try capture.start(callback: callback)
            registry.capture = capture
            return 0
        } catch {
            capture.stop()
            return -1012
        }
    }
}

@_cdecl("ipresenterplux_macos_audio_stop")
public func audioStop() -> Int32 {
    let registry = EdgeAudioCaptureRegistry.shared
    return registry.queue.sync {
        registry.capture?.stop()
        registry.capture = nil
        return 0
    }
}

@_cdecl("ipresenterplux_macos_buffer_free")
public func bufferFree(_ bytes: UnsafeMutablePointer<UInt8>?, _ length: Int32) {
    guard let bytes, length > 0 else { return }
    for index in 0..<Int(length) { bytes[index] = 0 }
    bytes.deallocate()
}
