import Foundation
import AVFoundation
import CoreAudio
import ScreenCaptureKit
import Security
import VideoToolbox

@_cdecl("ipresenterplux_macos_bridge_api_version")
public func bridgeApiVersion() -> Int32 {
    2
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
    return String(validatingUTF8: pointer)
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
