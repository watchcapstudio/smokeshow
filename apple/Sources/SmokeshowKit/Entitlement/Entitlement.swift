// Entitlement state, and the two moments the platform plan says to design for
// rather than discover: day 0 (get a widget onto the home screen) and day
// 12–14 (the churn cliff, which happens *on the widget*).
//
// The app owns the RevenueCat SDK. The widget does not — it reads the snapshot
// the app last wrote into the App Group. That keeps the extension's memory
// budget for rendering and means a widget can decide what to draw without a
// network call it has no budget for.

import Foundation

public enum EntitlementStatus: Codable, Sendable, Equatable {
    /// Not checked yet this launch. Never a reason to lock the UI — treat it
    /// as "ask again", not "denied".
    case unknown
    /// In the 14-day introductory offer. The store owns eligibility.
    case trial(endsAt: Date)
    case subscribed(renewsAt: Date?)
    /// Had access, doesn't now. `hadTrial` distinguishes a lapsed trial from a
    /// cancelled paid subscription — different copy, different ask.
    case lapsed(endedAt: Date?, hadTrial: Bool)
    /// Never subscribed and never trialled. The paywall's first-run state.
    case never

    public var isActive: Bool {
        switch self {
        case .trial, .subscribed: return true
        case .unknown, .lapsed, .never: return false
        }
    }

    public var isTrial: Bool {
        if case .trial = self { return true }
        return false
    }
}

public struct EntitlementSnapshot: Codable, Sendable, Equatable {
    public let status: EntitlementStatus
    /// When this snapshot was taken. A widget that finds a very old snapshot
    /// keeps rendering rather than locking the user out of something they are
    /// paying for — a false lock is worse than a late one.
    public let checkedAt: Date

    public init(status: EntitlementStatus, checkedAt: Date = Date()) {
        self.status = status
        self.checkedAt = checkedAt
    }

    public static let unknown = EntitlementSnapshot(status: .unknown, checkedAt: .distantPast)

    /// Whole days left in the trial, rounded up. Nil outside a trial.
    public func trialDaysRemaining(asOf date: Date = Date()) -> Int? {
        guard case .trial(let endsAt) = status else { return nil }
        let seconds = endsAt.timeIntervalSince(date)
        guard seconds > 0 else { return 0 }
        return Int((seconds / 86400).rounded(.up))
    }

    /// Day 12–14 of a 14-day trial. This is the churn cliff, and the widget is
    /// the surface it happens on: from here the widget carries the conversion
    /// line instead of the usual subtitle, and lapse copy is one tap away.
    public func isInChurnWindow(asOf date: Date = Date()) -> Bool {
        guard let days = trialDaysRemaining(asOf: date) else { return false }
        return days <= TrialPolicy.churnWindowDays
    }

    /// Whether widgets should render the forecast at all. Deliberately
    /// generous: `.unknown` renders. A subscriber whose receipt check was slow
    /// must not watch their home screen go blank.
    public var widgetsMayRenderForecast: Bool {
        switch status {
        case .trial, .subscribed, .unknown: return true
        case .lapsed, .never: return false
        }
    }
}

public enum TrialPolicy {
    public static let trialDays = 14
    /// The last N days of the trial, where conversion is won or lost.
    public static let churnWindowDays = 2
    public static let monthlyPriceFallback = "$2.99"
}

/// Where the app and the widget agree about entitlement.
public final class EntitlementCache: @unchecked Sendable {
    public static let shared = EntitlementCache()

    private let defaults: UserDefaults
    private let key = "entitlement.snapshot.v1"

    public init(defaults: UserDefaults = AppGroup.defaults) {
        self.defaults = defaults
    }

    public var snapshot: EntitlementSnapshot {
        get {
            guard let data = defaults.data(forKey: key),
                  let decoded = try? JSONDecoder().decode(EntitlementSnapshot.self, from: data)
            else { return .unknown }
            return decoded
        }
        set {
            guard let data = try? JSONEncoder().encode(newValue) else { return }
            defaults.set(data, forKey: key)
        }
    }
}
