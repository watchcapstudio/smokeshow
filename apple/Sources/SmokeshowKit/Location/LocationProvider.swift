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
    private var authorizationContinuation: CheckedContinuation<Bool, Never>?

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
        // `requestWhenInUseAuthorization` returns immediately and the prompt is
        // answered later, so asking for a fix in the next line is a request
        // made while still `.notDetermined` — CoreLocation drops it and the
        // first run never resolves a place. Wait for the status callback, then
        // ask.
        switch manager.authorizationStatus {
        case .notDetermined:
            guard await requestAuthorization() else { return nil }
        case .denied, .restricted:
            return nil
        default:
            break
        }

        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            manager.requestLocation()
        }
    }

    private func requestAuthorization() async -> Bool {
        await withCheckedContinuation { continuation in
            self.authorizationContinuation = continuation
            manager.requestWhenInUseAuthorization()
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

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard manager.authorizationStatus != .notDetermined,
              let pending = authorizationContinuation else { return }
        authorizationContinuation = nil
        switch manager.authorizationStatus {
        case .denied, .restricted:
            pending.resume(returning: false)
        default:
            pending.resume(returning: true)
        }
    }
}

/// Fixed location for previews, tests, and the simulator.
public struct StaticLocationProvider: LocationProviding {
    private let place: Place
    public init(place: Place = .preview) { self.place = place }
    public func currentPlace() async -> Place? { place }
}
