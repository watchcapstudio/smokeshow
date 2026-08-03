// The shared container. The app fetches; the widget reads. One payload on
// disk, one set of preferences, one device identity — the widget must never
// run its own fetch loop against a different cache.

import Foundation

public enum AppGroup {
    /// Must match the App Group capability on every target in project.yml:
    /// the app, the widget extension, and the watch app.
    public static let identifier = "group.earth.smokeshow"

    /// Falls back to `.standard` in unit tests and previews, where no App
    /// Group entitlement exists.
    public static var defaults: UserDefaults {
        UserDefaults(suiteName: identifier) ?? .standard
    }

    /// Shared container directory, or the caller's own Caches directory when
    /// the entitlement is missing (tests, previews, command-line tools).
    public static var containerURL: URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    }

    public static func cacheURL(named name: String) -> URL {
        containerURL.appendingPathComponent(name, isDirectory: false)
    }
}
