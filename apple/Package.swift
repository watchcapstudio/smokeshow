// swift-tools-version: 5.9
//
// SmokeshowKit is a SwiftPM package so it can be compiled and unit-tested
// without Xcode project state — `swift test` in this directory runs the
// contract-decoding, timeline-budget, and lapse tests on any machine with a
// Swift toolchain (macOS for the SwiftUI targets).
//
// The app, the widget extension, and the watch targets are Xcode targets and
// live in project.yml (XcodeGen), because widget extensions, entitlements, and
// StoreKit configuration are not expressible in SwiftPM.

import PackageDescription

let package = Package(
    name: "SmokeshowKit",
    platforms: [
        // WidgetKit's containerBackground, AppIntent widget configuration, and
        // the interactive-widget era all start here.
        .iOS(.v17),
        .macOS(.v14),
        .watchOS(.v10),
    ],
    products: [
        .library(name: "SmokeshowKit", targets: ["SmokeshowKit"]),
    ],
    dependencies: [
        // RevenueCat is added by the Xcode project, not here: the package is
        // compiled in CI without billing, and every RevenueCat call site is
        // behind `#if canImport(RevenueCat)`.
    ],
    targets: [
        .target(
            name: "SmokeshowKit",
            path: "Sources/SmokeshowKit",
            resources: [
                // Contract §10's mock cases, generated from the real payload
                // builder by scripts/generate-apple-fixtures.mjs.
                .copy("Resources/Fixtures"),
            ]
        ),
        .testTarget(
            name: "SmokeshowKitTests",
            dependencies: ["SmokeshowKit"],
            path: "Tests/SmokeshowKitTests"
        ),
    ]
)
