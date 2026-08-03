// Instrumenting day 0 and day 12–14 — the two moments the trial is won or lost.
//
// This is deliberately *local*: counters in the App Group, no network, no
// analytics SDK, no identifiers. The product's rule is no accounts and no
// email capture, and a funnel worth measuring is not worth breaking that for.
// What it is for is the app's own behaviour — whether to show the widget nudge
// again, and when to put the conversion line on the widget.
//
// If these numbers ever need to leave the device, they go through B7 keyed by
// the anonymous device ID, aggregated, and that is a decision to take
// explicitly rather than by adding an SDK.

import Foundation

public enum TrialEvent: String, Sendable, CaseIterable {
    /// Trial started. Day 0 begins here.
    case trialStarted
    /// The widget-install screen was shown.
    case widgetPromptShown
    /// WidgetKit reported at least one installed widget. The only honest
    /// measure that onboarding worked.
    case widgetInstalled
    /// The user reached the churn window (day 12 of 14) with a widget
    /// installed — the good case.
    case churnWindowWithWidget
    /// …and without one. This is the cohort that will not convert, and knowing
    /// its size locally is what justifies re-prompting.
    case churnWindowWithoutWidget
    case paywallShown
    case converted
    case lapsed
}

public enum TrialInstrumentation {

    /// The App Group in production; swapped in tests so the nudge policy can
    /// be exercised without leaking counters between cases.
    public static var defaults: UserDefaults = AppGroup.defaults

    /// Test seam only.
    public static func reset() {
        for event in TrialEvent.allCases {
            defaults.removeObject(forKey: key(event))
            defaults.removeObject(forKey: countKey(event))
        }
    }
    private static func key(_ event: TrialEvent) -> String { "trial.event.\(event.rawValue)" }
    private static func countKey(_ event: TrialEvent) -> String { "trial.count.\(event.rawValue)" }

    /// Records the first and latest occurrence, plus a count. Nothing else.
    public static func record(_ event: TrialEvent, at date: Date = Date()) {
        defaults.set(defaults.integer(forKey: countKey(event)) + 1, forKey: countKey(event))
        if defaults.object(forKey: key(event)) == nil {
            defaults.set(date, forKey: key(event))
        }
    }

    public static func firstOccurrence(_ event: TrialEvent) -> Date? {
        defaults.object(forKey: key(event)) as? Date
    }

    public static func count(_ event: TrialEvent) -> Int {
        defaults.integer(forKey: countKey(event))
    }

    public static var hasInstalledWidget: Bool {
        firstOccurrence(.widgetInstalled) != nil
    }

    /// Called on every launch once the entitlement snapshot is known. It is
    /// what turns "day 12–14 is the churn cliff" from an observation into
    /// behaviour: a trial user without a widget gets asked again, once.
    public static func evaluate(
        entitlement: EntitlementSnapshot,
        installedWidgetCount: Int,
        now: Date = Date()
    ) -> Nudge? {
        if installedWidgetCount > 0 { record(.widgetInstalled, at: now) }

        switch entitlement.status {
        case .trial:
            guard entitlement.isInChurnWindow(asOf: now) else {
                // Day 0–11: ask once, on the first session, and never again.
                return installedWidgetCount == 0 && count(.widgetPromptShown) == 0
                    ? .installWidget
                    : nil
            }
            if installedWidgetCount == 0 {
                record(.churnWindowWithoutWidget, at: now)
                // No widget by day 12 means the trial never became a glance.
                // One last, honest ask — the alternative is silent churn.
                return count(.churnWindowWithoutWidget) <= 1 ? .installWidget : .subscribe
            }
            record(.churnWindowWithWidget, at: now)
            return .subscribe

        case .lapsed:
            record(.lapsed, at: now)
            return .subscribe

        case .never:
            return .subscribe

        case .subscribed, .unknown:
            return nil
        }
    }

    public enum Nudge: Equatable, Sendable {
        case installWidget
        case subscribe
    }
}
