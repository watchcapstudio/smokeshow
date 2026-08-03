// Anonymous identity. No accounts, no email, no password.
//
// A device-scoped opaque ID is the whole of the user model (platform plan §4).
// It lives in the Keychain rather than UserDefaults so it survives an app
// reinstall — otherwise every reinstall orphans a push registration on B7's
// side and the user quietly stops getting alerts they are paying for.
//
// The same ID is handed to RevenueCat as the app user ID, so entitlement and
// push registration describe the same device without either of them knowing a
// person.

import Foundation
import Security

public enum DeviceIdentity {

    private static let service = "earth.smokeshow.device"
    private static let account = "anonymous-device-id"

    /// Creates one on first call and returns the same value forever after.
    public static var current: String {
        if let existing = read() { return existing }
        let generated = UUID().uuidString
        write(generated)
        return generated
    }

    /// Only for the "forget this device" path in Settings, which must also
    /// deregister from B7 — a rotated ID with a live registration behind it
    /// means the old ID keeps receiving pushes with nothing to turn them off.
    public static func rotate() -> String {
        delete()
        return current
    }

    // MARK: Keychain

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func read() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8),
              !value.isEmpty
        else { return nil }
        return value
    }

    private static func write(_ value: String) {
        var query = baseQuery
        query[kSecValueData as String] = Data(value.utf8)
        // Available after first unlock so a background push registration on
        // launch does not fail on a locked device.
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemDelete(baseQuery as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    private static func delete() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
