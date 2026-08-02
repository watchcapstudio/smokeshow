// Which place a widget shows.
//
// A user with two saved places wants two widgets, not a widget that follows
// whatever the app last looked at. This is the AppIntent configuration that
// lets them pick one per widget; unconfigured widgets fall back to the
// selected place in the shared store, so the first one added on day 0 works
// with no configuration at all — which is the point of onboarding straight
// into a widget.

import AppIntents
import SmokeshowKit

struct PlaceEntity: AppEntity, Identifiable {
    let id: String
    let name: String
    let latitude: Double
    let longitude: Double

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Place"
    static var defaultQuery = PlaceEntityQuery()

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }

    init(place: Place) {
        id = place.id.uuidString
        name = place.name
        latitude = place.latitude
        longitude = place.longitude
    }

    var place: Place {
        Place(
            id: UUID(uuidString: id) ?? UUID(),
            name: name,
            latitude: latitude,
            longitude: longitude
        )
    }
}

struct PlaceEntityQuery: EntityQuery {
    func entities(for identifiers: [PlaceEntity.ID]) async throws -> [PlaceEntity] {
        PlaceStore.shared.places
            .filter { identifiers.contains($0.id.uuidString) }
            .map(PlaceEntity.init(place:))
    }

    func suggestedEntities() async throws -> [PlaceEntity] {
        PlaceStore.shared.places.map(PlaceEntity.init(place:))
    }
}

struct SelectPlaceIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Choose a place"
    static var description = IntentDescription("Pick which saved place this widget shows.")

    @Parameter(title: "Place")
    var place: PlaceEntity?

    init() {}

    init(place: PlaceEntity?) {
        self.place = place
    }

    /// Falls back to the app's selected place, then to a sensible default, so
    /// a widget dropped on the home screen before anything is configured still
    /// renders something honest rather than an empty tile.
    var resolvedPlace: Place {
        place?.place ?? PlaceStore.shared.selected ?? Place.preview
    }
}
