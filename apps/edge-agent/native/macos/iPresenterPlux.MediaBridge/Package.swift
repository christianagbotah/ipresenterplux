// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "iPresenterPluxMediaBridge",
    platforms: [.macOS(.v14)],
    products: [
        .library(
            name: "iPresenterPluxMediaBridge",
            type: .dynamic,
            targets: ["iPresenterPluxMediaBridge"]
        )
    ],
    targets: [
        .target(
            name: "iPresenterPluxMediaBridge",
            path: "Sources/iPresenterPluxMediaBridge"
        )
    ]
)
