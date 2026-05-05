// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ConduitMenuBar",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "ConduitMenuBar", targets: ["ConduitMenuBar"])
    ],
    targets: [
        .executableTarget(
            name: "ConduitMenuBar",
            path: "Sources/ConduitMenuBar"
        )
    ]
)
