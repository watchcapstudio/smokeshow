// Choosing a place.
//
// A roll-up sheet, not a full screen: it opens at a medium detent so the
// verdict you came from stays on screen above it, and grows to large only
// while the search field is focused, so the keyboard never crushes the
// results. The header used to call `useCurrentLocation()` directly, which left
// a user who declines the prompt — or who wants to check somewhere they are
// not — with no way into the product. This sheet is that way in: my location,
// anywhere I search for, and the places I already saved.
//
// The interaction is add-then-close, not pick-then-close. Tapping the ＋ on a
// result pins it as a pill AND switches the screen to it live behind the
// sheet, so you can add several and preview each without the sheet dismissing.
// Done closes. That matches the pills the sheet feeds: one mental model in
// both places.
//
// Chrome is hand-built on the app's tokens — warm smoke surface, ember accent,
// the mono eyebrow that carries place names everywhere else — rather than a
// stock `List` + `.searchable`, which paints system blue on a screen whose
// whole personality is warm smoke. Search is `MKLocalSearch`, so no key and no
// server; the coordinates go to `/api/forecast` unsnapped, like every request.

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
    @FocusState private var searchFocused: Bool

    private let scheme: Palette.Scheme = Palette.dark

    var body: some View {
        VStack(spacing: 0) {
            grabber
            header
            searchField
                .padding(.horizontal, 16)
                .padding(.top, 4)
            scroller
        }
        .background(Color(Tokens.Color.Dark.bgPanel).ignoresSafeArea())
        .tint(scheme.accent)
        #if os(iOS)
        // Medium at rest so the verdict above stays visible; large while the
        // field is focused so the keyboard has somewhere to go.
        .presentationDetents(searchFocused ? [.large] : [.medium, .large])
        .presentationDragIndicator(.hidden)
        .presentationBackground(Color(Tokens.Color.Dark.bgPanel))
        #endif
        .preferredColorScheme(.dark)
    }

    // MARK: - Chrome

    private var grabber: some View {
        Capsule()
            .fill(scheme.border)
            .frame(width: 36, height: 4)
            .padding(.top, 8)
            .padding(.bottom, 12)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("WHERE TO")
                    .font(Typography.eyebrow)
                    .tracking(1.6)
                    .foregroundStyle(scheme.textDim)
                Text("Add a place")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(scheme.text)
            }
            Spacer()
            Button {
                dismiss()
            } label: {
                Text("DONE")
                    .font(Typography.eyebrow)
                    .tracking(1.2)
                    .foregroundStyle(scheme.accent)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }

    private var searchField: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(scheme.textDim)
            TextField("", text: $query, prompt:
                Text("Search for a city").foregroundColor(scheme.textDim)
            )
            .focused($searchFocused)
            .foregroundStyle(scheme.text)
            .autocorrectionDisabled()
            #if os(iOS)
            .textInputAutocapitalization(.words)
            #endif
            .submitLabel(.search)
            .onSubmit { Task { await search() } }
            if !query.isEmpty {
                Button {
                    query = ""
                    results = []
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(scheme.textDim)
                }
                .buttonStyle(.plain)
            }
        }
        .font(.system(size: 16))
        .padding(.horizontal, 13)
        .padding(.vertical, 11)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(Tokens.Color.Dark.bg))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(scheme.border, lineWidth: 1)
                )
        )
        .onChange(of: query) { _, new in
            searchTask?.cancel()
            guard !new.trimmingCharacters(in: .whitespaces).isEmpty else {
                results = []
                return
            }
            // Type-ahead, debounced so a five-letter city is one request.
            searchTask = Task {
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled else { return }
                await search()
            }
        }
    }

    // MARK: - Body list

    private var scroller: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if results.isEmpty {
                    currentLocationButton
                    if locationDenied { deniedNote }
                    if !saved.isEmpty {
                        sectionLabel("SAVED")
                        ForEach(saved) { place in
                            savedRow(place)
                        }
                    }
                } else {
                    sectionLabel("RESULTS")
                    ForEach(results) { place in
                        resultRow(place)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 6)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .overlay(alignment: .top) {
            if isSearching {
                ProgressView()
                    .tint(scheme.accent)
                    .padding(.top, 20)
            }
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(Typography.eyebrow)
            .tracking(1.8)
            .foregroundStyle(scheme.textDim)
            .padding(.top, 18)
            .padding(.bottom, 4)
    }

    private var currentLocationButton: some View {
        Button {
            Task { await useCurrentLocation() }
        } label: {
            HStack(spacing: 11) {
                Image(systemName: "location.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(scheme.accent)
                Text("Use my current location")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(scheme.text)
                Spacer()
            }
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var deniedNote: some View {
        Text("Location is off for Smokeshow. Turn it on in Settings, or search for a place above.")
            .font(.footnote)
            .foregroundStyle(scheme.textDim)
            .padding(.bottom, 8)
    }

    private func resultRow(_ place: Place) -> some View {
        let added = isSaved(place)
        return Button {
            Task { await add(place) }
        } label: {
            HStack {
                placeLabel(place)
                Spacer()
                addGlyph(added)
            }
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) { rowRule }
    }

    private func savedRow(_ place: Place) -> some View {
        let isCurrent = place.id == model.place?.id
        return Button {
            Task { await add(place) }
        } label: {
            HStack(spacing: 8) {
                placeLabel(place)
                if place.isCurrentLocation {
                    Image(systemName: "location.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(scheme.textDim)
                }
                Spacer()
                if isCurrent {
                    Image(systemName: "checkmark")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(scheme.accent)
                }
            }
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) { rowRule }
    }

    /// The hollow ember ring that fills to a solid ✓ once a place is saved —
    /// the state change is the feedback, so it has to be visible at a glance.
    private func addGlyph(_ added: Bool) -> some View {
        ZStack {
            Circle()
                .fill(added ? scheme.accent : Color.clear)
                .overlay(Circle().strokeBorder(scheme.accent, lineWidth: added ? 0 : 1.5))
                .frame(width: 30, height: 30)
            Image(systemName: added ? "checkmark" : "plus")
                .font(.system(size: added ? 14 : 16, weight: .semibold))
                .foregroundStyle(added ? Color(Tokens.Color.Dark.bg) : scheme.accent)
        }
    }

    private var rowRule: some View {
        Rectangle()
            .fill(scheme.border.opacity(0.5))
            .frame(height: 1)
    }

    /// Locality on top in the app's face; region beneath in the mono eyebrow
    /// that labels places everywhere else. The composed name is "Portland, OR".
    private func placeLabel(_ place: Place) -> some View {
        let parts = place.name
            .split(separator: ",", maxSplits: 1)
            .map { $0.trimmingCharacters(in: .whitespaces) }
        return VStack(alignment: .leading, spacing: 2) {
            Text(parts.first ?? place.name)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(scheme.text)
            if parts.count > 1 {
                Text(parts[1].uppercased())
                    .font(Typography.eyebrow)
                    .tracking(1.2)
                    .foregroundStyle(scheme.textDim)
            }
        }
    }

    // MARK: - Actions

    /// ＋ / tap: pin the pill and take you there — close the sheet and land on
    /// that place's forecast. Dismiss first (the store write is synchronous, so
    /// the pill is already there), then let `model.select` run its network
    /// refresh behind the closed sheet; gating the dismiss on that round-trip
    /// would make the tap feel dead.
    private func add(_ place: Place) async {
        let target = PlaceStore.shared.places.first { sameSpot($0, place) } ?? place
        PlaceStore.shared.upsert(target)
        dismiss()
        await model.select(target)
    }

    private func useCurrentLocation() async {
        await model.useCurrentLocation()
        saved = PlaceStore.shared.places
        // `useCurrentLocation` returns quietly when the prompt is declined, so
        // the absence of a place is the only signal the sheet gets. On success
        // it has already switched the screen, so take the user there.
        if model.place == nil {
            locationDenied = true
        } else {
            dismiss()
        }
    }

    private func isSaved(_ place: Place) -> Bool {
        saved.contains { sameSpot($0, place) }
    }

    /// Search results are minted with fresh ids every query, so identity is by
    /// where the place is, not by its UUID.
    private func sameSpot(_ a: Place, _ b: Place) -> Bool {
        if a.name == b.name { return true }
        return abs(a.latitude - b.latitude) < 0.02
            && abs(a.longitude - b.longitude) < 0.02
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
