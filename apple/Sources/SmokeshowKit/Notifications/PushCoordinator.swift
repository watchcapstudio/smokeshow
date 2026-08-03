// Permission, token, registration — and what to do when a push arrives.
//
// The posture ships as written (platform plan §5): threshold alerts only. No
// digests, no streaks, no engagement pings. There is no code path in this file
// that sends or schedules a local notification on a timer, and there should
// never be one.
//
// A push is also the cheapest widget refresh there is: when B7 says the
// verdict moved, the app reloads timelines instead of the widget having spent
// a reload discovering it.

import Foundation
import UserNotifications
#if canImport(WidgetKit)
import WidgetKit
#endif

@MainActor
public final class PushCoordinator: ObservableObject {

    /// One instance: the app delegate receives the APNs token and the app
    /// model shows its state, and they have to be the same object.
    public static let shared = PushCoordinator()

    @Published public private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published public private(set) var lastRegistrationError: String?

    private let registry: DeviceRegistering
    private var pushToken: String?

    public init(registry: DeviceRegistering = DeviceRegistryClient()) {
        self.registry = registry
    }

    public func refreshAuthorizationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorizationStatus = settings.authorizationStatus
    }

    /// Ask only when the user has asked for alerts — never on first launch.
    /// The first-session job is a widget on the home screen, not a permission
    /// dialog the user has no context for.
    @discardableResult
    public func requestAuthorization() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound]
        )) ?? false
        await refreshAuthorizationStatus()
        return granted
    }

    public func didRegister(deviceToken: Data) async {
        pushToken = deviceToken.map { String(format: "%02x", $0) }.joined()
        await syncRegistration()
    }

    public func didFailToRegister(error: Error) {
        lastRegistrationError = error.localizedDescription
    }

    /// Push the current preferences and place set to B7. Cheap and idempotent:
    /// call it after any change to either.
    public func syncRegistration() async {
        do {
            try await registry.register(.current(pushToken: pushToken))
            lastRegistrationError = nil
        } catch {
            lastRegistrationError = error.localizedDescription
        }
    }

    public func forgetDevice() async {
        try? await registry.deregister(deviceId: DeviceIdentity.current)
    }

    /// Called from the app delegate on a silent push. B7 sends one when a
    /// monitored cell changes state, which is exactly when a widget's picture
    /// is wrong.
    public func handleVerdictChangePush() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}
