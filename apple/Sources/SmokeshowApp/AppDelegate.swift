// Push plumbing. The only thing it does is hand APNs tokens to
// `PushCoordinator`, which hands them to B7's registry with an anonymous
// device ID attached.
//
// A silent push from B7 means "the verdict moved" — the app reloads widget
// timelines rather than the widgets discovering it on their own schedule.

import SmokeshowKit
import UserNotifications

#if os(iOS)
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // Registration is cheap and silent; the *permission* prompt is not
        // shown here — it waits until the user asks for alerts.
        application.registerForRemoteNotifications()
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in await PushCoordinator.shared.didRegister(deviceToken: deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in PushCoordinator.shared.didFailToRegister(error: error) }
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification info: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        await MainActor.run { PushCoordinator.shared.handleVerdictChangePush() }
        return .newData
    }

    // iOS suppresses banners while the app is open unless its delegate opts
    // in. A threshold crossing should not disappear just because someone is
    // looking at the map when it arrives.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        PushCoordinator.shared.handleVerdictChangePush()
        return [.banner, .list, .sound]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        PushCoordinator.shared.handleVerdictChangePush()
        let payload = response.notification.request.content.userInfo["smokeshow"] as? [String: Any]
        let label = payload?["label"] as? String
        NotificationCenter.default.post(
            name: .smokeshowDeepLink,
            object: DeepLink.Destination.verdict(place: label)
        )
    }
}

#elseif os(macOS)
import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.registerForRemoteNotifications()
    }

    func application(
        _ application: NSApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in await PushCoordinator.shared.didRegister(deviceToken: deviceToken) }
    }

    func application(
        _ application: NSApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in PushCoordinator.shared.didFailToRegister(error: error) }
    }

    func application(
        _ application: NSApplication,
        didReceiveRemoteNotification userInfo: [String: Any]
    ) {
        Task { @MainActor in PushCoordinator.shared.handleVerdictChangePush() }
    }
}
#endif
