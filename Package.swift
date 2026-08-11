// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "tiro",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "ObjCTry", path: "Sources/ObjCTry"),
        .executableTarget(name: "tiro", dependencies: ["ObjCTry"], path: "Sources/tiro"),
    ]
)
