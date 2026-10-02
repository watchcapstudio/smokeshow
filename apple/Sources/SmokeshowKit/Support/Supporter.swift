// Supporter state. Nothing in the product is gated on it.
//
// Smokeshow is free: the forecast, every widget, alerts, Live Activities. What
// a supporter gets is a thank-you and the alternate app icons, and that is the
// only thing this state ever switches. If a reader finds a code path where
// `isSupporter` decides whether a forecast renders, that is a bug.
//
// Two ways to be a supporter:
//   • a one-time tip (consumable in-app purchase), or
//   • the monthly subscription. This is the same product the paid builds sold
//     as "Smokeshow" with a 14-day trial, renamed in App Store Connect. Its
//     existing subscribers keep it, and see `Copy.Support.freeNotice` once.

import Foundation

public enum SupporterStatus: Codable, Sendable, Equatable {
    /// Not checked yet this launch.
    case unknown
    case notSupporting
    /// At least one tip, ever.
    case tipped
    case subscribed(renewsAt: Date?)

    public var isSupporter: Bool {
        switch self {
        case .tipped, .subscribed: return true
        case .unknown, .notSupporting: return false
        }
    }

    public var isSubscribed: Bool {
        if case .subscribed = self { return true }
        return false
    }
}

public struct SupporterSnapshot: Codable, Sendable, Equatable {
    public let status: SupporterStatus
    public let checkedAt: Date

    public init(status: SupporterStatus, checkedAt: Date = Date()) {
        self.status = status
        self.checkedAt = checkedAt
    }

    public static let unknown = SupporterSnapshot(status: .unknown, checkedAt: .distantPast)
}

/// Last known supporter state, so the icon picker can draw before the store
/// answers. App Group because it sits next to everything else the app caches;
/// no widget reads it.
public final class SupporterCache: @unchecked Sendable {
    public static let shared = SupporterCache()

    private let defaults: UserDefaults
    private let key = "supporter.snapshot.v1"
    private let noticeKey = "supporter.freeNoticeShown.v1"

    public init(defaults: UserDefaults = AppGroup.defaults) {
        self.defaults = defaults
    }

    public var snapshot: SupporterSnapshot {
        get {
            guard let data = defaults.data(forKey: key),
                  let decoded = try? JSONDecoder().decode(SupporterSnapshot.self, from: data)
            else { return .unknown }
            return decoded
        }
        set {
            guard let data = try? JSONEncoder().encode(newValue) else { return }
            defaults.set(data, forKey: key)
        }
    }

    /// Whether this device has seen the "Smokeshow is free now" notice.
    public var hasShownFreeNotice: Bool {
        get { defaults.bool(forKey: noticeKey) }
        set { defaults.set(newValue, forKey: noticeKey) }
    }

    /// The notice is for people who were paying when the app went free, and
    /// only once. Subscribing from the Support screen after this build is not
    /// that, so the Support screen marks it shown when it sells one.
    public func shouldShowFreeNotice(for status: SupporterStatus) -> Bool {
        status.isSubscribed && !hasShownFreeNotice
    }
}

/// The alternate icons. `assetName` must match an `.appiconset` in the app's
/// asset catalog and the ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES list in
/// project.yml; scripts/gen_alt_icons.py writes all four.
public enum SupporterIcon: String, CaseIterable, Identifiable, Sendable {
    case standard
    case clear
    case golden
    case night
    case smokeshow

    public var id: String { rawValue }

    /// Nil is the primary icon, which is what `setAlternateIconName` expects.
    public var assetName: String? {
        switch self {
        case .standard: return nil
        case .clear: return "AppIcon-Clear"
        case .golden: return "AppIcon-Golden"
        case .night: return "AppIcon-Night"
        case .smokeshow: return "AppIcon-Smokeshow"
        }
    }

    public var displayName: String {
        switch self {
        case .standard: return "Smoke sunset"
        case .clear: return "All clear"
        case .golden: return "Golden hour"
        case .night: return "Night"
        case .smokeshow: return "Smokeshow"
        }
    }

    /// A plain image set for the picker. App icon sets cannot be loaded as
    /// images, so scripts/gen_alt_icons.py writes a small copy of each.
    public var previewAssetName: String {
        "IconPreview-" + rawValue.prefix(1).uppercased() + String(rawValue.dropFirst())
    }

    /// Everyone has the standard icon; the rest are the supporter reward.
    public var requiresSupport: Bool { self != .standard }

    public init(assetName: String?) {
        self = Self.allCases.first { $0.assetName == assetName } ?? .standard
    }
}
