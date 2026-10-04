import Foundation
import AVFoundation
import CoreAudio
import ScreenCaptureKit
import VideoToolbox

@_cdecl("ipresenterplux_macos_bridge_api_version")
public func bridgeApiVersion() -> Int32 {
    1
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

// Native capture sessions are intentionally added behind this stable C ABI.
// .NET owns service orchestration; Swift owns macOS-only media APIs.
