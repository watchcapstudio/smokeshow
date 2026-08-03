// Starting, updating, and — the part people forget — ending the smoke Live
// Activity.
//
// Policy, in one place:
//   • Start when the server says `verdict.above` is true. A smoke event is
//     something the *server* declares; the app never decides it from a series.
//   • Update only when the content state actually differs. Same headline, same
//     clear-time, same level → no update, because ActivityKit throttles apps
//     that chatter and the countdown ticks on its own regardless.
//   • End when `above` goes false, i.e. it cleared. Then leave the final frame
//     up briefly so the user sees the payoff — the one moment the product has
//     been promising — and dismiss.
//   • Never start one for a lapsed subscriber.

import Foundation

#if canImport(ActivityKit) && os(iOS)
import ActivityKit

@MainActor
public final class LiveActivityController: ObservableObject {

    public static let shared = LiveActivityController()

    /// How long the "it cleared" frame stays up after the event ends.
    public static let clearedDismissalDelay: TimeInterval = 30 * 60

    @Published public private(set) var isRunning = false

    private var activity: Activity<SmokeActivityAttributes>?

    public init() {}

    public var isSupported: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Drive the whole lifecycle from one payload. Call it wherever a fresh
    /// forecast lands — foreground refresh, background refresh, or a push.
    public func sync(
        forecast: Forecast,
        place: Place,
        preferences: Preferences = PreferencesStore.shared.current,
        entitlement: EntitlementSnapshot = EntitlementCache.shared.snapshot
    ) async {
        guard isSupported, entitlement.widgetsMayRenderForecast else {
            await end(reason: .entitlement)
            return
        }

        guard forecast.verdict.above else {
            await end(reason: .cleared)
            return
        }

        let state = contentState(from: forecast, preferences: preferences)
        if let activity {
            guard activity.content.state != state else { return }
            await activity.update(ActivityContent(state: state, staleDate: staleDate(forecast)))
        } else {
            start(attributes: SmokeActivityAttributes(placeName: place.shortName), state: state, forecast: forecast)
        }
    }

    private func start(
        attributes: SmokeActivityAttributes,
        state: SmokeActivityAttributes.ContentState,
        forecast: Forecast
    ) {
        do {
            activity = try Activity.request(
                attributes: attributes,
                content: ActivityContent(state: state, staleDate: staleDate(forecast)),
                // Push updates come from B7 on a verdict change, so the
                // activity does not need the app to be running.
                pushType: .token
            )
            isRunning = true
        } catch {
            isRunning = false
        }
    }

    public enum EndReason { case cleared, entitlement, userDismissed }

    public func end(reason: EndReason) async {
        guard let activity else { return }
        let dismissal: ActivityUIDismissalPolicy = reason == .cleared
            ? .after(Date().addingTimeInterval(Self.clearedDismissalDelay))
            : .immediate
        await activity.end(activity.content, dismissalPolicy: dismissal)
        self.activity = nil
        isRunning = false
    }

    /// The push token this activity was granted, for B7 to update it without
    /// the app running. Registered the same anonymous way everything else is.
    public func observePushToken(_ handler: @escaping @Sendable (String) -> Void) {
        guard let activity else { return }
        Task {
            for await tokenData in activity.pushTokenUpdates {
                handler(tokenData.map { String(format: "%02x", $0) }.joined())
            }
        }
    }

    // MARK: Content

    private func contentState(
        from forecast: Forecast,
        preferences: Preferences
    ) -> SmokeActivityAttributes.ContentState {
        let hour = forecast.nowHour
        let scaleEntry = forecast.verdictScaleEntry
        return SmokeActivityAttributes.ContentState(
            levelName: scaleEntry?.name ?? Copy.unavailable,
            levelIndex: forecast.verdict.levelIndex,
            headline: forecast.verdict.headline,
            changeAt: forecast.nextChangeAt,
            isClearing: forecast.nextChangeIsClearing,
            reading: hour?.reading(in: preferences.unit),
            unitLabel: preferences.unit.shortLabel,
            generatedAt: forecast.generatedAt
        )
    }

    /// After this the system dims the activity — the honest signal that we no
    /// longer stand behind the number on it.
    private func staleDate(_ forecast: Forecast) -> Date {
        forecast.generatedAt.addingTimeInterval(Forecast.staleAfter)
    }
}
#endif
