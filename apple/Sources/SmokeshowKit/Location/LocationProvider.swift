// Where you are, once, and only when you ask.
//
// Requests are one-shot (`requestLocation`), not continuous updates: the
// product needs a coordinate to fetch a forecast for, not a track. Reverse
// geocoding runs on-device through CLGeocoder purely to get a place *name* —
// the contract carries no name, and "MINNEAPOLIS" in the widget corner has to
// come from somewhere.

import Foundation
import CoreLocation

public protocol LocationProviding: Sendable {
    func currentPlace() async -> Place?
}

public final class LocationProvider: NSObject, LocationProviding, CLLocationManagerDelegate, @unchecked Sendable {

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation?, Never>?

    public override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer // the lattice is ~11 km
    }

    public func currentPlace() async -> Place? {
        guard let location = await requestLocation() else { return nil }
        let name = await placeName(for: location) ?? "Current location"
        return Place(
            name: name,
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            isCurrentLocation: true
        )
    }

    private func requestLocation() async -> CLLocation? {
        #if os(macOS)
        manager.requestWhenInUseAuthorization()
        #else
        manager.requestWhenInUseAuthorization()
        #endif
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            manager.requestLocation()
        }
    }

    private func placeName(for location: CLLocation) async -> String? {
        let placemarks = try? await CLGeocoder().reverseGeocodeLocation(location)
        guard let placemark = placemarks?.first else { return nil }
        return placemark.locality ?? placemark.subAdministrativeArea ?? placemark.administrativeArea
    }

    // MARK: CLLocationManagerDelegate

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        continuation?.resume(returning: locations.last)
        continuation = nil
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        continuation?.resume(returning: nil)
        continuation = nil
    }
}

/// Fixed location for previews, tests, and the simulator.
public struct StaticLocationProvider: LocationProviding {
    private let place: Place
    public init(place: Place = .preview) { self.place = place }
    public func currentPlace() async -> Place? { place }
}
