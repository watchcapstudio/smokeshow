// The one nudge the app makes: put a widget on the home screen.
//
// The product's value is ambient, and it can't be felt from inside the app, so
// the first session asks once for a widget. It never asks twice, and it never
// asks someone who already has one.
//
// Local only: counters in the App Group, no network, no analytics SDK, no
// identifiers. The keys keep their old `trial.` prefix on purpose, so a reader
// who was already asked in a paid build is not asked again after updating.

import Foundation

public enum WidgetNudge {

    public enum Event: String, Sendable, CaseIterable {
        /// The widget-install screen was shown.
        case widgetPromptShown
        /// WidgetKit reported at least one installed widget. The only honest
        /// measure that onboarding worked.
        case widgetInstalled
    }

    /// The App Group in production; swapped in tests.
    public static var defaults: UserDefaults = AppGroup.defaults

    /// Test seam only.
    public static func reset() {
        for event in Event.allCases {
            defaults.removeObject(forKey: key(event))
            defaults.removeObject(forKey: countKey(event))
        }
    }

    private static func key(_ event: Event) -> String { "trial.event.\(event.rawValue)" }
    private static func countKey(_ event: Event) -> String { "trial.count.\(event.rawValue)" }

    /// Records the first occurrence plus a count. Nothing else.
    public static func record(_ event: Event, at date: Date = Date()) {
        defaults.set(defaults.integer(forKey: countKey(event)) + 1, forKey: countKey(event))
        if defaults.object(forKey: key(event)) == nil {
            defaults.set(date, forKey: key(event))
        }
    }

    public static func firstOccurrence(_ event: Event) -> Date? {
        defaults.object(forKey: key(event)) as? Date
    }

    public static func count(_ event: Event) -> Int {
        defaults.integer(forKey: countKey(event))
    }

    public static var hasInstalledWidget: Bool {
        firstOccurrence(.widgetInstalled) != nil
    }

    /// Called once the app is on screen. True means: show the install flow.
    public static func shouldAsk(installedWidgetCount: Int, now: Date = Date()) -> Bool {
        if installedWidgetCount > 0 {
            record(.widgetInstalled, at: now)
            return false
        }
        return count(.widgetPromptShown) == 0
    }
}
