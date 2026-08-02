// User preferences. All of them live in the App Group so the widget, the Live
// Activity, and the app read one copy — a widget showing AQI while the app
// shows µg/m³ is the same class of bug as a widget with a different clear-time.

import Foundation

public enum MeasurementUnit: String, Codable, Sendable, CaseIterable {
    case microgramsPerCubicMetre = "ug"
    case aqi

    public var shortLabel: String {
        switch self {
        case .microgramsPerCubicMetre: return "µg/m³"
        case .aqi: return "AQI"
        }
    }
}

/// Which measured row anchors the delivered series. Sent as `?source=` — the
/// server recomputes the verdict against it, which is exactly why this is a
/// query parameter and not a client-side post-process (contract §5).
public enum ForecastSourcePreference: String, Codable, Sendable, CaseIterable {
    case official, local, model

    public var displayName: String {
        switch self {
        case .official: return "Station"
        case .local: return "Neighborhood"
        case .model: return "Model only"
        }
    }
}

public struct Preferences: Codable, Sendable, Equatable {
    public var unit: MeasurementUnit
    /// Asthma, young kids, older adults, pregnancy, heart or lung conditions.
    /// Switches which `scale[].guidance` line is shown. Never leaves the device.
    public var sensitiveHousehold: Bool
    public var source: ForecastSourcePreference

    // Notification switches. The posture ships as written in the platform plan:
    // threshold alerts only. No digests, no streaks, no engagement pings.
    public var notifyInbound: Bool
    public var notifyPeak: Bool
    public var notifyClear: Bool
    /// 10 PM–7 AM local, urgent only. Honoured server-side at fan-out.
    public var quietHours: Bool

    public static let `default` = Preferences(
        unit: .microgramsPerCubicMetre,
        sensitiveHousehold: false,
        source: .official,
        notifyInbound: true,
        notifyPeak: true,
        notifyClear: true,
        quietHours: true
    )
}

/// Reads and writes `Preferences` in the shared container.
public final class PreferencesStore: @unchecked Sendable {
    public static let shared = PreferencesStore()

    private let defaults: UserDefaults
    private let key = "preferences.v1"

    public init(defaults: UserDefaults = AppGroup.defaults) {
        self.defaults = defaults
    }

    public var current: Preferences {
        get {
            guard let data = defaults.data(forKey: key),
                  let decoded = try? JSONDecoder().decode(Preferences.self, from: data)
            else { return .default }
            return decoded
        }
        set {
            guard let data = try? JSONEncoder().encode(newValue) else { return }
            defaults.set(data, forKey: key)
        }
    }
}
