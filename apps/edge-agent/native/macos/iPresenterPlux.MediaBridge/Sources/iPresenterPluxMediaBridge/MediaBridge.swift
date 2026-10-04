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
public func isScreenCaptureSupported() -> Bool {
    if #available(macOS 14.0, *) {
        return true
    }
    return false
}

// Native capture sessions are intentionally added behind a stable C ABI.
// The .NET Edge Agent owns orchestration; Swift owns macOS-only media APIs.
