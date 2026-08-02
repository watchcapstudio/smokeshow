// Push registration against B7's device registry.
//
// ⚠️ PROVISIONAL SHAPE. B7 (`claude/b7-notify-backend`) had not landed when
// this was written, so the request bodies below are this branch's reading of
// its brief (platform plan §5 and the B7 prompt in docs/branch-prompts.md):
// anonymous device-scoped opaque IDs; a device registers its push token,
// platform, subscribed locations, thresholds, quiet hours, and the
// sensitive-household flag. Everything B7-shaped is confined to this one file
// and to `DeviceRegistration`, so reconciling with the real API is an edit
// here, not a refactor across the app.
//
// Two things this client deliberately does *not* do:
//   • send anything that identifies a person — no email, no name, no IDFA;
//   • send coordinates at full precision. Locations are snapped to the same
//     0.1° lattice the forecast cache uses (contract §1), which is both the
//     privacy-preserving choice and the one that makes B7's evaluation loop
//     O(unique cells) instead of O(users).

import Foundation

public struct DeviceRegistration: Codable, Sendable, Equatable {

    public struct MonitoredLocation: Codable, Sendable, Equatable {
        /// Snapped to the 0.1° lattice before it leaves the device.
        public let lat: Double
        public let lon: Double
        /// Client-side label, sent so the push text can name the place. It is
        /// the user's own words for somewhere, not an identifier.
        public let label: String

        public init(lat: Double, lon: Double, label: String) {
            self.lat = lat
            self.lon = lon
            self.label = label
        }

        public init(place: Place) {
            self.init(
                lat: DeviceRegistration.snap(place.latitude),
                lon: DeviceRegistration.snap(place.longitude),
                label: place.shortName
            )
        }
    }

    public struct Thresholds: Codable, Sendable, Equatable {
        /// Smoke is on its way. Fires on the *arrival* state change.
        public let inbound: Bool
        /// The worst of it has been reached.
        public let peak: Bool
        /// It cleared, and held.
        public let clear: Bool

        public init(inbound: Bool, peak: Bool, clear: Bool) {
            self.inbound = inbound
            self.peak = peak
            self.clear = clear
        }
    }

    /// Anonymous, device-scoped, from the Keychain.
    public let deviceId: String
    /// "ios" | "macos". B7 needs it to choose APNs topic and to reason about
    /// which surfaces a lapse affects.
    public let platform: String
    /// APNs token, hex. Nil when the user has not granted permission — the
    /// registration is still sent so preferences survive a later grant.
    public let pushToken: String?
    public let locations: [MonitoredLocation]
    public let thresholds: Thresholds
    /// 10 PM–7 AM local, urgent only. Applied at fan-out, not at send.
    public let quietHours: Bool
    /// Shifts which `scale[].guidance` line the push text uses. It is a
    /// household preference, not a health record, and it never leaves B7.
    public let sensitiveHousehold: Bool
    /// IANA zone, so quiet hours can be evaluated server-side.
    public let timeZone: String
    public let appVersion: String

    public static func snap(_ value: Double) -> Double {
        (value * 10).rounded() / 10
    }

    public static func current(
        pushToken: String?,
        places: [Place] = PlaceStore.shared.places,
        preferences: Preferences = PreferencesStore.shared.current
    ) -> DeviceRegistration {
        #if os(macOS)
        let platform = "macos"
        #else
        let platform = "ios"
        #endif

        return DeviceRegistration(
            deviceId: DeviceIdentity.current,
            platform: platform,
            pushToken: pushToken,
            locations: places.map(MonitoredLocation.init(place:)),
            thresholds: Thresholds(
                inbound: preferences.notifyInbound,
                peak: preferences.notifyPeak,
                clear: preferences.notifyClear
            ),
            quietHours: preferences.quietHours,
            sensitiveHousehold: preferences.sensitiveHousehold,
            timeZone: TimeZone.current.identifier,
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        )
    }
}

public protocol DeviceRegistering: Sendable {
    func register(_ registration: DeviceRegistration) async throws
    func deregister(deviceId: String) async throws
}

public struct DeviceRegistryClient: DeviceRegistering {

    /// B7's routes. One constant to change when the real ones land.
    public enum Route {
        public static let register = "api/devices"
        public static func device(_ id: String) -> String { "api/devices/\(id)" }
    }

    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL = ForecastClient.productionBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func register(_ registration: DeviceRegistration) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent(Route.register))
        request.httpMethod = "PUT" // idempotent: same device ID overwrites
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(registration)

        let (_, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else {
            throw RegistryError.http(status: status)
        }
    }

    public func deregister(deviceId: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent(Route.device(deviceId)))
        request.httpMethod = "DELETE"
        let (_, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        // A device the registry has already forgotten is a success, not a
        // failure — this path runs when the user turns notifications off and
        // must not leave the switch stuck.
        guard (200...299).contains(status) || status == 404 else {
            throw RegistryError.http(status: status)
        }
    }

    public enum RegistryError: Error, Sendable, Equatable {
        case http(status: Int)
    }
}

/// No-op registry for previews, tests, and any build without a backend.
public struct NoopDeviceRegistry: DeviceRegistering {
    public init() {}
    public func register(_ registration: DeviceRegistration) async throws {}
    public func deregister(deviceId: String) async throws {}
}
