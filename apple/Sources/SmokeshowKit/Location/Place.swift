// A place is client-side state. The contract carries coordinates and a
// timezone but no place *name* — the name comes from the device's own
// geocoder or from the user, and it is what the widget prints in its corner.

import Foundation

public struct Place: Codable, Sendable, Equatable, Identifiable {
    public let id: UUID
    /// "Bend" or "Colorado Springs". Long names are a live layout risk at
    /// 148pt widget width — `shortName` is what widgets render.
    public var name: String
    public var latitude: Double
    public var longitude: Double
    /// True for the follow-my-location entry, which re-resolves on launch.
    public var isCurrentLocation: Bool

    public init(
        id: UUID = UUID(),
        name: String,
        latitude: Double,
        longitude: Double,
        isCurrentLocation: Bool = false
    ) {
        self.id = id
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.isCurrentLocation = isCurrentLocation
    }

    /// The first component only — "Minneapolis, Minnesota" prints as
    /// "MINNEAPOLIS" in a 148pt tile, and the rest was never going to fit.
    public var shortName: String {
        name.split(separator: ",").first.map(String.init) ?? name
    }

    public static let preview = Place(
        name: "Minneapolis",
        latitude: 44.9778,
        longitude: -93.2650
    )
}

/// The place set, in the shared container so the widget knows what to fetch.
public final class PlaceStore: @unchecked Sendable {
    public static let shared = PlaceStore()

    private let defaults: UserDefaults
    private let key = "places.v1"
    private let selectedKey = "places.selected.v1"

    public init(defaults: UserDefaults = AppGroup.defaults) {
        self.defaults = defaults
    }

    public var places: [Place] {
        get {
            guard let data = defaults.data(forKey: key),
                  let decoded = try? JSONDecoder().decode([Place].self, from: data)
            else { return [] }
            return decoded
        }
        set {
            guard let data = try? JSONEncoder().encode(newValue) else { return }
            defaults.set(data, forKey: key)
        }
    }

    /// What an unconfigured widget shows: the selected place, or the first one.
    public var selected: Place? {
        get {
            let all = places
            if let raw = defaults.string(forKey: selectedKey),
               let id = UUID(uuidString: raw),
               let match = all.first(where: { $0.id == id }) {
                return match
            }
            return all.first
        }
        set { defaults.set(newValue?.id.uuidString, forKey: selectedKey) }
    }

    public func upsert(_ place: Place) {
        var all = places
        if let index = all.firstIndex(where: { $0.id == place.id }) {
            all[index] = place
        } else if place.isCurrentLocation,
                  let index = all.firstIndex(where: { $0.isCurrentLocation }) {
            // Only ever one follow-me entry; it moves rather than multiplying.
            all[index] = place
        } else {
            all.append(place)
        }
        places = all
    }

    public func remove(_ place: Place) {
        places = places.filter { $0.id != place.id }
    }
}
