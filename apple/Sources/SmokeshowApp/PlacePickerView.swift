// Choosing a place.
//
// The header used to call `useCurrentLocation()` directly, which left a user
// who declines the location prompt — or who wants to check on somewhere they
// are not — with no way into the product at all. This sheet is that way in:
// my location, anywhere I search for, and the places I already saved.
//
// Search is `MKLocalSearch`, so no key and no server. The coordinates it
// returns go to `/api/forecast` unsnapped, like every other request.

import SwiftUI
import MapKit
import SmokeshowKit

struct PlacePickerView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var results: [Place] = []
    @State private var isSearching = false
    @State private var saved: [Place] = PlaceStore.shared.places
    @State private var locationDenied = false
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        Task { await useCurrentLocation() }
                    } label: {
                        Label("Use my location", systemImage: "location")
                    }
                    if locationDenied {
                        Text("Location is off for Smokeshow. Turn it on in Settings, or search for a place below.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                if !results.isEmpty {
                    Section("Results") {
                        ForEach(results) { place in
                            Button(place.name) {
                                Task { await select(place) }
                            }
                        }
                    }
                }

                if !saved.isEmpty {
                    Section("Saved") {
                        ForEach(saved) { place in
                            Button {
                                Task { await select(place) }
                            } label: {
                                HStack {
                                    Text(place.name)
                                    if place.isCurrentLocation {
                                        Image(systemName: "location.fill")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                        .onDelete { offsets in
                            offsets.map { saved[$0] }.forEach(PlaceStore.shared.remove)
                            saved = PlaceStore.shared.places
                        }
                    }
                }
            }
            .navigationTitle("Places")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .searchable(text: $query, prompt: "Search for a city")
            .onSubmit(of: .search) { Task { await search() } }
            // Searching only on submit means a user who never taps the
            // keyboard's return key sees an empty sheet and concludes the
            // search is broken. Type-ahead, debounced so a five-letter city
            // is one request and not five.
            .onChange(of: query) { _, new in
                searchTask?.cancel()
                guard !new.trimmingCharacters(in: .whitespaces).isEmpty else {
                    results = []
                    return
                }
                searchTask = Task {
                    try? await Task.sleep(for: .milliseconds(350))
                    guard !Task.isCancelled else { return }
                    await search()
                }
            }
            .overlay {
                if isSearching { ProgressView() }
            }
        }
    }

    private func select(_ place: Place) async {
        await model.select(place)
        saved = PlaceStore.shared.places
        dismiss()
    }

    private func useCurrentLocation() async {
        await model.useCurrentLocation()
        saved = PlaceStore.shared.places
        // `useCurrentLocation` returns quietly when the prompt is declined, so
        // the absence of a place is the only signal the sheet gets.
        if model.place == nil {
            locationDenied = true
        } else {
            dismiss()
        }
    }

    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isSearching = true
        defer { isSearching = false }

        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = trimmed
        request.resultTypes = [.address, .pointOfInterest]

        guard let response = try? await MKLocalSearch(request: request).start() else {
            results = []
            return
        }

        results = response.mapItems.prefix(12).compactMap { item in
            let coordinate = item.placemark.coordinate
            guard CLLocationCoordinate2DIsValid(coordinate) else { return nil }
            let name = item.placemark.locality
                ?? item.placemark.name
                ?? item.name
                ?? trimmed
            let region = item.placemark.administrativeArea
            return Place(
                name: region.map { "\(name), \($0)" } ?? name,
                latitude: coordinate.latitude,
                longitude: coordinate.longitude
            )
        }
    }
}
