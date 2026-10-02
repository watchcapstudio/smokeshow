// One app, two platforms. iOS and macOS share this entire target; the only
// platform-specific code in the product is where the OS genuinely differs —
// push registration, window sizing, and the fact that macOS has no lock
// screen.

import SwiftUI
import SmokeshowKit

@main
struct SmokeshowApp: App {

    #if os(iOS)
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #elseif os(macOS)
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif

    @StateObject private var model = AppModel(supportProvider: SupportFactory.make())
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                // `onLaunch` asks for location, so RootView owns when it runs:
                // not until the disclaimer has been acknowledged.
                .onOpenURL { url in
                    if let destination = DeepLink.destination(for: url) {
                        NotificationCenter.default.post(
                            name: .smokeshowDeepLink,
                            object: destination
                        )
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else { return }
                    Task { await model.onForeground() }
                }
                .preferredColorScheme(.dark)
        }
        #if os(macOS)
        .defaultSize(width: 460, height: 760)
        .windowResizability(.contentSize)
        #endif
    }
}

extension Notification.Name {
    static let smokeshowDeepLink = Notification.Name("smokeshow.deeplink")
}

/// Chooses the tip-jar implementation at launch. RevenueCat when the SDK is
/// linked and a key is present; the stub otherwise, so the app is runnable in
/// the simulator, in previews, and in CI without billing configured. Nothing
/// is gated on it either way.
enum SupportFactory {
    static func make() -> SupportProviding {
        #if canImport(RevenueCat)
        if let key = Bundle.main.object(forInfoDictionaryKey: "RevenueCatAPIKey") as? String,
           !key.isEmpty {
            return RevenueCatSupportProvider(apiKey: key, appUserID: DeviceIdentity.current)
        }
        #endif
        return StubSupportProvider()
    }
}
