import Foundation
import XCTest
@testable import iPresenterPluxMediaBridge

final class MediaAudioDecoderTests: XCTestCase {
    func testReadsGeneratedAacMp4AndSeeks() throws {
        let decoder = try MediaAudioDecoder(path: fixturePath("h264-aac-2s.mp4"), sampleRate: 48_000, channels: 2)
        defer { decoder.close() }

        let early = try decoder.read(frameSamples: 960)
        XCTAssertNotNil(early)
        XCTAssertEqual(early?.data.count, 960 * 2 * MemoryLayout<Int16>.size)

        try decoder.seek(toSeconds: 1.0)
        let late = try decoder.read(frameSamples: 960)
        XCTAssertNotNil(late)
        XCTAssertEqual(late?.data.count, 960 * 2 * MemoryLayout<Int16>.size)
        XCTAssertGreaterThanOrEqual(late?.timestampMicroseconds ?? -1, 950_000)
    }

    func testRejectsNetworkUrlAndCorruptLocalFile() throws {
        XCTAssertThrowsError(try MediaAudioDecoder(path: "https://example.com/audio.m4a", sampleRate: 48_000, channels: 2))

        let corrupt = FileManager.default.temporaryDirectory.appendingPathComponent("ipresenter-corrupt-\(UUID().uuidString).m4a")
        try Data("not media".utf8).write(to: corrupt)
        defer { try? FileManager.default.removeItem(at: corrupt) }
        XCTAssertThrowsError(try MediaAudioDecoder(path: corrupt.path, sampleRate: 48_000, channels: 2))
    }

    func testCloseIsIdempotent() throws {
        let decoder = try MediaAudioDecoder(path: fixturePath("h264-aac-2s.mp4"), sampleRate: 48_000, channels: 2)
        decoder.close()
        decoder.close()
    }

    private func fixturePath(_ name: String) -> String {
        var root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        for _ in 0..<5 { root.deleteLastPathComponent() }
        return root.appendingPathComponent("tests/fixtures/media").appendingPathComponent(name).path
    }
}
