import Foundation
import CoreMedia
import CoreVideo
import ScreenCaptureKit
import VideoToolbox

public typealias EdgeEncodedVideoCallback = @convention(c) (
    UnsafePointer<UInt8>?, Int32, Int32, Int32, Int32, Int64
) -> Void

private final class EdgeInt32Box: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Int32
    init(_ value: Int32) { self.value = value }
    func set(_ next: Int32) { lock.lock(); value = next; lock.unlock() }
    func get() -> Int32 { lock.lock(); defer { lock.unlock() }; return value }
}

private let edgeCompressionOutputCallback: VTCompressionOutputCallback = {
    outputCallbackRefCon,
    _,
    status,
    _,
    sampleBuffer in
    guard status == noErr,
          let outputCallbackRefCon,
          let sampleBuffer else { return }
    let capture = Unmanaged<EdgeProgramVideoCapture>
        .fromOpaque(outputCallbackRefCon)
        .takeUnretainedValue()
    capture.handleEncodedSample(sampleBuffer)
}

private final class EdgeProgramVideoCapture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.lightworldtech.ipresenterplux.edge.program-video")
    private let stateLock = NSLock()
    private var stream: SCStream?
    private var compressionSession: VTCompressionSession?
    private var callback: EdgeEncodedVideoCallback?
    private var width: Int32 = 0
    private var height: Int32 = 0
    private var framesPerSecond: Int32 = 0
    private var running = false
    private var framesEncoded: Int64 = 0
    private var droppedFrames: Int64 = 0

    func start(
        processId: Int32,
        titleHint: String,
        width: Int32,
        height: Int32,
        framesPerSecond: Int32,
        bitrate: Int32,
        callback: @escaping EdgeEncodedVideoCallback
    ) -> Int32 {
        stateLock.lock()
        if running {
            stateLock.unlock()
            return 0
        }
        self.callback = callback
        self.width = width
        self.height = height
        self.framesPerSecond = framesPerSecond
        self.framesEncoded = 0
        self.droppedFrames = 0
        stateLock.unlock()

        let semaphore = DispatchSemaphore(value: 0)
        let result = EdgeInt32Box(-2010)

        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { [weak self] content, error in
            guard let self else {
                result.set(-2011)
                semaphore.signal()
                return
            }
            guard error == nil, let content else {
                result.set(-2012)
                semaphore.signal()
                return
            }

            let candidates = content.windows.filter {
                $0.owningApplication?.processID == processId && $0.isOnScreen
            }
            let titleMatch = candidates.first {
                ($0.title ?? "").localizedCaseInsensitiveContains(titleHint)
            }
            guard let window = titleMatch ?? (candidates.count == 1 ? candidates[0] : nil) else {
                result.set(-2013)
                semaphore.signal()
                return
            }

            let compressionStatus = self.configureCompression(
                width: width,
                height: height,
                framesPerSecond: framesPerSecond,
                bitrate: bitrate
            )
            guard compressionStatus == 0 else {
                result.set(compressionStatus)
                semaphore.signal()
                return
            }

            let filter = SCContentFilter(desktopIndependentWindow: window)
            let configuration = SCStreamConfiguration()
            configuration.width = Int(width)
            configuration.height = Int(height)
            configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(framesPerSecond))
            configuration.queueDepth = 3
            configuration.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
            configuration.showsCursor = false
            configuration.capturesAudio = false

            let captureStream = SCStream(filter: filter, configuration: configuration, delegate: self)
            do {
                try captureStream.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.queue)
            } catch {
                self.invalidateCompression()
                result.set(-2014)
                semaphore.signal()
                return
            }

            self.stateLock.lock()
            self.stream = captureStream
            self.stateLock.unlock()
            captureStream.startCapture { error in
                if error == nil {
                    self.stateLock.lock()
                    self.running = true
                    self.stateLock.unlock()
                    result.set(0)
                } else {
                    self.stateLock.lock()
                    self.stream = nil
                    self.stateLock.unlock()
                    self.invalidateCompression()
                    result.set(-2015)
                }
                semaphore.signal()
            }
        }

        if semaphore.wait(timeout: .now() + 10) == .timedOut {
            stop()
            return -2016
        }
        return result.get()
    }

    func stop() {
        stateLock.lock()
        let captureStream = stream
        stream = nil
        running = false
        callback = nil
        stateLock.unlock()

        if let captureStream {
            let semaphore = DispatchSemaphore(value: 0)
            captureStream.stopCapture { _ in semaphore.signal() }
            _ = semaphore.wait(timeout: .now() + 3)
            try? captureStream.removeStreamOutput(self, type: .screen)
        }
        invalidateCompression()
    }

    private func configureCompression(
        width: Int32,
        height: Int32,
        framesPerSecond: Int32,
        bitrate: Int32
    ) -> Int32 {
        invalidateCompression()
        var session: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            width: width,
            height: height,
            codecType: kCMVideoCodecType_H264,
            encoderSpecification: nil,
            imageBufferAttributes: nil,
            compressedDataAllocator: nil,
            outputCallback: edgeCompressionOutputCallback,
            refcon: Unmanaged.passUnretained(self).toOpaque(),
            compressionSessionOut: &session
        )
        guard status == noErr, let session else { return -2020 }

        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
        let bitRateNumber = NSNumber(value: bitrate)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AverageBitRate, value: bitRateNumber)
        let fpsNumber = NSNumber(value: framesPerSecond)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: fpsNumber)
        let keyFrameInterval = NSNumber(value: max(framesPerSecond * 2, 1))
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_MaxKeyFrameInterval, value: keyFrameInterval)
        let prepare = VTCompressionSessionPrepareToEncodeFrames(session)
        guard prepare == noErr else {
            VTCompressionSessionInvalidate(session)
            return -2021
        }
        stateLock.lock()
        compressionSession = session
        stateLock.unlock()
        return 0
    }

    private func invalidateCompression() {
        stateLock.lock()
        let session = compressionSession
        compressionSession = nil
        stateLock.unlock()
        if let session {
            VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid)
            VTCompressionSessionInvalidate(session)
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .screen,
              sampleBuffer.isValid,
              let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        stateLock.lock()
        let session = compressionSession
        let fps = framesPerSecond
        stateLock.unlock()
        guard let session else { return }

        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        var flags = VTEncodeInfoFlags()
        let status = VTCompressionSessionEncodeFrame(
            session,
            imageBuffer: imageBuffer,
            presentationTimeStamp: presentationTime,
            duration: CMTime(value: 1, timescale: CMTimeScale(max(fps, 1))),
            frameProperties: nil,
            sourceFrameRefcon: nil,
            infoFlagsOut: &flags
        )
        if status != noErr {
            stateLock.lock()
            droppedFrames += 1
            stateLock.unlock()
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        stateLock.lock()
        running = false
        stateLock.unlock()
    }

    func handleEncodedSample(_ sampleBuffer: CMSampleBuffer) {
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        let totalLength = CMBlockBufferGetDataLength(blockBuffer)
        guard totalLength > 0 else { return }
        var avcc = [UInt8](repeating: 0, count: totalLength)
        let copyStatus = avcc.withUnsafeMutableBytes { raw -> OSStatus in
            guard let base = raw.baseAddress else { return kCMBlockBufferBadPointerParameterErr }
            return CMBlockBufferCopyDataBytes(blockBuffer, atOffset: 0, dataLength: totalLength, destination: base)
        }
        guard copyStatus == kCMBlockBufferNoErr else {
            stateLock.lock(); droppedFrames += 1; stateLock.unlock()
            return
        }

        let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
            as? [[CFString: Any]]
        let isKeyFrame = !(attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool ?? false)
        var annexB = Data()
        if isKeyFrame, let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) {
            appendParameterSet(formatDescription, index: 0, to: &annexB)
            appendParameterSet(formatDescription, index: 1, to: &annexB)
        }
        appendAvccNals(avcc, to: &annexB)
        guard !annexB.isEmpty else {
            stateLock.lock(); droppedFrames += 1; stateLock.unlock()
            return
        }

        stateLock.lock()
        let currentCallback = callback
        let currentWidth = width
        let currentHeight = height
        framesEncoded += 1
        stateLock.unlock()
        guard let currentCallback else { return }

        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let ptsMicros = pts.isValid && pts.timescale != 0
            ? Int64((CMTimeGetSeconds(pts) * 1_000_000.0).rounded())
            : 0
        annexB.withUnsafeBytes { raw in
            currentCallback(
                raw.baseAddress?.assumingMemoryBound(to: UInt8.self),
                Int32(raw.count),
                currentWidth,
                currentHeight,
                isKeyFrame ? 1 : 0,
                ptsMicros
            )
        }
    }

    private func appendParameterSet(_ formatDescription: CMFormatDescription, index: Int, to output: inout Data) {
        var pointer: UnsafePointer<UInt8>?
        var size = 0
        var count = 0
        var headerLength: Int32 = 0
        let status = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            formatDescription,
            parameterSetIndex: index,
            parameterSetPointerOut: &pointer,
            parameterSetSizeOut: &size,
            parameterSetCountOut: &count,
            nalUnitHeaderLengthOut: &headerLength
        )
        guard status == noErr, let pointer, size > 0 else { return }
        output.append(contentsOf: [0, 0, 0, 1])
        output.append(pointer, count: size)
    }

    private func appendAvccNals(_ bytes: [UInt8], to output: inout Data) {
        var offset = 0
        while offset + 4 <= bytes.count {
            let length = (Int(bytes[offset]) << 24) |
                (Int(bytes[offset + 1]) << 16) |
                (Int(bytes[offset + 2]) << 8) |
                Int(bytes[offset + 3])
            offset += 4
            guard length > 0, offset + length <= bytes.count else { return }
            output.append(contentsOf: [0, 0, 0, 1])
            output.append(contentsOf: bytes[offset..<(offset + length)])
            offset += length
        }
    }
}

private final class EdgeProgramVideoRegistry: @unchecked Sendable {
    static let shared = EdgeProgramVideoRegistry()
    let queue = DispatchQueue(label: "com.lightworldtech.ipresenterplux.edge.program-video.registry")
    var capture: EdgeProgramVideoCapture?
    private init() {}
}

@_cdecl("ipresenterplux_macos_program_video_start")
public func programVideoStart(
    _ processId: Int32,
    _ titleHintPointer: UnsafePointer<CChar>?,
    _ width: Int32,
    _ height: Int32,
    _ framesPerSecond: Int32,
    _ bitrate: Int32,
    _ callback: EdgeEncodedVideoCallback?
) -> Int32 {
    guard processId > 0,
          let titleHintPointer,
          let titleHint = String(validatingCString: titleHintPointer),
          !titleHint.isEmpty,
          width > 0,
          height > 0,
          framesPerSecond > 0,
          bitrate > 0,
          let callback else { return -2000 }

    let registry = EdgeProgramVideoRegistry.shared
    return registry.queue.sync {
        if registry.capture != nil { return 0 }
        let capture = EdgeProgramVideoCapture()
        let status = capture.start(
            processId: processId,
            titleHint: titleHint,
            width: width,
            height: height,
            framesPerSecond: framesPerSecond,
            bitrate: bitrate,
            callback: callback
        )
        if status == 0 { registry.capture = capture }
        else { capture.stop() }
        return status
    }
}

@_cdecl("ipresenterplux_macos_program_video_stop")
public func programVideoStop() -> Int32 {
    let registry = EdgeProgramVideoRegistry.shared
    registry.queue.sync {
        registry.capture?.stop()
        registry.capture = nil
    }
    return 0
}
