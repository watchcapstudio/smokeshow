// The native client for the notification service's anonymous device registry.
//
// The service, not the app, creates the registry identity. It returns an
// opaque device ID and a secret once; both are kept in the Keychain and used
// as bearer credentials for later updates and deletion. DeviceIdentity remains
// the RevenueCat app-user ID, which lets the webhook attach an entitlement to
// this registry record without identifying a person.

import Foundation
import Security

public struct DeviceRegistration: Codable, Sendable, Equatable {

    public struct MonitoredLocation: Codable, Sendable, Equatable {
        public let lat: Double
        public let lon: Double
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

    public struct QuietHours: Codable, Sendable, Equatable {
        public let enabled: Bool
        public let startHour: Int
        public let endHour: Int

        public init(enabled: Bool, startHour: Int = 22, endHour: Int = 7) {
            self.enabled = enabled
            self.startHour = startHour
            self.endHour = endHour
        }
    }

    public struct NotificationTypes: Codable, Sendable, Equatable {
        public let inbound: Bool
        public let peak: Bool
        public let clear: Bool

        public init(inbound: Bool, peak: Bool, clear: Bool) {
            self.inbound = inbound
            self.peak = peak
            self.clear = clear
        }
    }

    public let platform: String
    public let pushToken: String?
    public let appUserId: String
    public let locations: [MonitoredLocation]
    public let threshold: Int
    public let quietHours: QuietHours
    public let notificationTypes: NotificationTypes
    public let sensitiveHousehold: Bool
    public let timezone: String

    public init(
        platform: String,
        pushToken: String?,
        appUserId: String,
        locations: [MonitoredLocation],
        threshold: Int = 2,
        quietHours: QuietHours,
        notificationTypes: NotificationTypes = .init(inbound: true, peak: true, clear: true),
        sensitiveHousehold: Bool,
        timezone: String
    ) {
        self.platform = platform
        self.pushToken = pushToken
        self.appUserId = appUserId
        self.locations = locations
        self.threshold = threshold
        self.quietHours = quietHours
        self.notificationTypes = notificationTypes
        self.sensitiveHousehold = sensitiveHousehold
        self.timezone = timezone
    }

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
            platform: platform,
            pushToken: pushToken,
            appUserId: DeviceIdentity.current,
            locations: places.map(MonitoredLocation.init(place:)),
            quietHours: QuietHours(enabled: preferences.quietHours),
            notificationTypes: NotificationTypes(
                inbound: preferences.notifyInbound,
                peak: preferences.notifyPeak,
                clear: preferences.notifyClear
            ),
            sensitiveHousehold: preferences.sensitiveHousehold,
            timezone: TimeZone.current.identifier
        )
    }
}

public protocol DeviceRegistering: Sendable {
    func register(_ registration: DeviceRegistration) async throws
    func deregister() async throws
}

public struct DeviceRegistryCredentials: Codable, Sendable, Equatable {
    public let deviceId: String
    public let deviceSecret: String

    public init(deviceId: String, deviceSecret: String) {
        self.deviceId = deviceId
        self.deviceSecret = deviceSecret
    }
}

public protocol DeviceRegistryCredentialStoring: Sendable {
    func load() -> DeviceRegistryCredentials?
    func save(_ credentials: DeviceRegistryCredentials)
    func clear()
}

public struct KeychainDeviceRegistryCredentialStore: DeviceRegistryCredentialStoring {
    private let service = "earth.smokeshow.notifications"
    private let account = "device-registry-credentials"

    public init() {}

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func load() -> DeviceRegistryCredentials? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return try? JSONDecoder().decode(DeviceRegistryCredentials.self, from: data)
    }

    public func save(_ credentials: DeviceRegistryCredentials) {
        guard let data = try? JSONEncoder().encode(credentials) else { return }
        var query = baseQuery
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemDelete(baseQuery as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    public func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}

public struct DeviceRegistryClient: DeviceRegistering {
    public enum Route {
        public static let register = "v1/devices"
        public static func device(_ id: String) -> String { "v1/devices/\(id)" }
    }

    public static var productionBaseURL: URL {
        if let value = Bundle.main.object(forInfoDictionaryKey: "NotificationServiceBaseURL") as? String,
           let url = URL(string: value), !value.isEmpty {
            return url
        }
        return ForecastClient.productionBaseURL
    }

    private let baseURL: URL
    private let session: URLSession
    private let credentials: any DeviceRegistryCredentialStoring

    public init(
        baseURL: URL = DeviceRegistryClient.productionBaseURL,
        session: URLSession = .shared,
        credentials: any DeviceRegistryCredentialStoring = KeychainDeviceRegistryCredentialStore()
    ) {
        self.baseURL = baseURL
        self.session = session
        self.credentials = credentials
    }

    public func register(_ registration: DeviceRegistration) async throws {
        if let existing = credentials.load() {
            let status = try await update(registration, using: existing)
            if status != 404 { return }
            // The server no longer knows this credential (for example after a
            // database restore). Re-register instead of leaving alerts dead.
            credentials.clear()
        }

        // APNs registration is asynchronous. Preference/place changes before
        // the token arrives are still stored locally and will sync from
        // didRegisterForRemoteNotifications; the server requires a real token.
        guard let token = registration.pushToken, !token.isEmpty else { return }
        try await create(registration)
    }

    public func deregister() async throws {
        guard let existing = credentials.load() else { return }
        var request = URLRequest(url: url(Route.device(existing.deviceId)))
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(existing.deviceSecret)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) || status == 404 else {
            throw RegistryError.http(status: status)
        }
        credentials.clear()
    }

    private func create(_ registration: DeviceRegistration) async throws {
        var request = URLRequest(url: url(Route.register))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(registration)
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 201 else { throw RegistryError.http(status: status) }
        guard let issued = try? JSONDecoder().decode(DeviceRegistryCredentials.self, from: data),
              !issued.deviceId.isEmpty, !issued.deviceSecret.isEmpty
        else { throw RegistryError.malformedResponse }
        credentials.save(issued)
    }

    private func update(
        _ registration: DeviceRegistration,
        using existing: DeviceRegistryCredentials
    ) async throws -> Int {
        var request = URLRequest(url: url(Route.device(existing.deviceId)))
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(existing.deviceSecret)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(registration)
        let (_, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) || status == 404 else {
            throw RegistryError.http(status: status)
        }
        return status
    }

    private func url(_ path: String) -> URL {
        baseURL.appendingPathComponent(path)
    }

    public enum RegistryError: Error, Sendable, Equatable, LocalizedError {
        case http(status: Int)
        case malformedResponse

        public var errorDescription: String? {
            switch self {
            case .http(let status): return "Notification service returned HTTP \(status)."
            case .malformedResponse: return "Notification service returned an invalid registration."
            }
        }
    }
}

public struct NoopDeviceRegistry: DeviceRegistering {
    public init() {}
    public func register(_ registration: DeviceRegistration) async throws {}
    public func deregister() async throws {}
}
