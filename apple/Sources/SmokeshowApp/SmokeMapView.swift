// "Where is this coming from, and where is it going."
//
// The demo answered that with a map you scrub, and the app has never had one.
// This is the first pass: the same pre-rendered field the web paints, on
// MapKit, with its own scrubber over the same −12h/+48h window.
//
// What is deliberately not here yet, so it is not mistaken for missing by
// accident: the NIFC fire cards and FIRMS hotspots (`/api/fires` — a layer of
// its own), the screen-space ash stipple, and the saved-place chips. The
// coverage rule is honest instead: outside a domain, the map says it has none
// rather than inventing a smooth field out of nothing.

// iOS only for now. The renderer and the frames client are portable — the
// chrome is not: `UIViewRepresentable`, `UILongPressGestureRecognizer` and
// `fullScreenCover` are all UIKit. macOS gets the map when someone writes the
// AppKit half, and until then it says so rather than shipping a dead button.

#if os(iOS)

import SwiftUI
import CoreLocation
import SmokeshowKit

struct SmokeMapView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    /// The scrubbed curve index, or nil for now — the same model the home
    /// screen's curve uses, so the two scrub identically.
    @State private var selection: Int?
    @State private var domains: [SmokeDomain] = []
    @State private var frame: SmokeFramePayload?
    @State private var status: Status = .loading
    @State private var isPlaying = false
    /// The basemap is CARTO dark, unconditionally, so the frames must be the
    /// dark (grey→amber) ramp. Where no dark domain covers a place the map
    /// shows no smoke there rather than a light ramp on dark tiles — the one
    /// combination this product must never ship.
    private let theme: SmokeDomain.Theme = .dark

    private enum Status: Equatable {
        case loading
        case painted(String)
        case noCoverage
        case unavailable
    }

    private var place: Place? { model.place }

    /// The same 61-hour curve the home screen draws (−12h … +48h), so the map
    /// scrubs the identical shape of the smoke.
    private var points: [CurvePoint] {
        guard let forecast = model.forecast else { return [] }
        return TimelineBuilder.curve(around: forecast.now.index, in: forecast)
    }

    private var nowIndex: Int {
        guard let forecast = model.forecast else { return 0 }
        return min(forecast.now.index, TimelineBuilder.curveLookback)
    }

    /// The index the map is currently painting: the scrubbed hour, or now.
    private var currentIndex: Int {
        let index = selection ?? nowIndex
        return points.indices.contains(index) ? index : nowIndex
    }

    private var validTime: Date {
        // Frames are filed by their exact valid hour; snap to it.
        let base = points.indices.contains(currentIndex)
            ? points[currentIndex].t
            : (model.forecast?.now.exactUTC ?? Date())
        return Calendar(identifier: .gregorian)
            .date(bySetting: .minute, value: 0, of: base) ?? base
    }

    var body: some View {
        ZStack(alignment: .top) {
            MapLibreCanvas(
                center: place.map {
                    CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                },
                frame: frame,
                onLongPress: { coordinate in
                    Task { await move(to: coordinate) }
                }
            )
            .ignoresSafeArea()

            topBar

            VStack {
                Spacer()
                scrubber
            }
        }
        .task { await loadDomains() }
        .task(id: frameKey) { await loadFrame() }
        .task(id: isPlaying) { await run() }
    }

    /// Recomputing the frame is keyed on the hour and the place, not on the
    /// raw slider value — a drag emits hundreds of values and 61 frames exist.
    ///
    /// The domain count and theme are in the key because both are resolved
    /// *after* the first frame task runs — the manifest lands late, and the
    /// theme is decided from it. Without them the first paint waits for a
    /// scrub, and a map that switched to dark kept the light frames on it.
    private var frameKey: String {
        "\(SmokeFrames.timeKey(for: validTime))|\(place?.id.uuidString ?? "-")|\(domains.count)|\(theme.rawValue)"
    }

    // The status pill only. Dismiss moved to the scrubber card at the bottom:
    // a back button in the top-left corner is a long reach on a phone this
    // size, and the map is a full-screen cover the thumb should be able to
    // send back down without stretching.
    private var topBar: some View {
        HStack {
            Spacer()
            Text(statusLine)
                .font(Typography.eyebrow)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Capsule().fill(.ultraThinMaterial))
        }
        .padding(.horizontal, 16)
    }

    private var scrubber: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                // The reachable way out: a downward chevron on the bottom card
                // sends the cover back down, no stretch to the far corner.
                Button { dismiss() } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(Palette.dark.text.opacity(0.14)))
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 1) {
                    Text(whenLabel).font(Typography.md)
                    // The whole field is a forecast; past hours included are
                    // reanalysis, never observation. CLAUDE.md's hard rule.
                    Text(Copy.modelEstimate).font(Typography.eyebrow).opacity(0.5)
                }

                Spacer()

                if selection != nil {
                    Button("Now") {
                        isPlaying = false
                        selection = nil
                    }
                    .font(Typography.eyebrow)
                    .buttonStyle(.plain)
                    .opacity(0.7)
                }
            }

            // The shape of the smoke is the track you scrub — the same curve
            // the home screen draws, so the two read as one control.
            CurveView(
                points: points,
                nowIndex: nowIndex,
                ink: Palette.dark.text,
                selection: $selection
            )
            .frame(height: 84)

            HStack {
                Text("−12h").font(Typography.eyebrow).opacity(0.5)
                Spacer()
                // Watching it run is the answer to "where is this going" that
                // dragging never quite gives: the plume has a direction.
                Button { togglePlay() } label: {
                    Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(Palette.dark.accent.opacity(0.22)))
                }
                .buttonStyle(.plain)
                Spacer()
                Text("+48h").font(Typography.eyebrow).opacity(0.5)
            }
        }
        .foregroundStyle(Palette.dark.text)
        .padding(16)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(16)
    }

    private func togglePlay() {
        if !isPlaying {
            // Restart from the window's start if parked at the end or at now,
            // so play always runs the whole −12h…+48h sweep.
            let count = points.count
            let current = selection ?? nowIndex
            if count > 1, current >= count - 1 { selection = 0 }
        }
        isPlaying.toggle()
    }

    private var whenLabel: String {
        guard selection != nil, points.indices.contains(currentIndex) else { return "Now" }
        return readout(for: points[currentIndex])
    }

    /// "Sat 9 PM · 24 µg/m³", matching the home curve's readout. A null hour
    /// prints the dash the contract requires rather than inventing a number.
    private func readout(for point: CurvePoint) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = model.forecast?.location.timeZone ?? .current
        formatter.dateFormat = "EEE h a"
        let stamp = formatter.string(from: point.t)
        guard let value = point.value else { return "\(stamp) · \(Copy.noData)" }
        switch model.preferences.unit {
        case .microgramsPerCubicMetre:
            return "\(stamp) · \(Int(value.rounded())) µg/m³"
        case .aqi:
            let hour = model.forecast?.hours.first { $0.t == point.t }
            guard let aqi = hour?.aqi else { return "\(stamp) · \(Copy.noData)" }
            return "\(stamp) · AQI \(aqi) (approx)"
        }
    }

    private var statusLine: String {
        switch status {
        case .loading: return "LOADING"
        // Naming the model is the same rule the web map follows: never paint a
        // field without saying whose it is.
        case .painted(let model): return model.uppercased()
        case .noCoverage: return "NO SMOKE COVERAGE HERE"
        case .unavailable: return "COVERAGE UNAVAILABLE"
        }
    }

    /// Press and hold anywhere to move the forecast there. On a map, pointing
    /// at a spot *is* the gesture for "what about here?" — making people go
    /// back out to a search field to ask it wastes the map.
    private func move(to coordinate: CLLocationCoordinate2D) async {
        let name = await Self.name(for: coordinate) ?? "Dropped pin"
        await model.select(
            Place(
                name: name,
                latitude: coordinate.latitude,
                longitude: coordinate.longitude
            )
        )
    }

    private static func name(for coordinate: CLLocationCoordinate2D) async -> String? {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let placemarks = try? await CLGeocoder().reverseGeocodeLocation(location)
        guard let placemark = placemarks?.first else { return nil }
        return placemark.locality
            ?? placemark.subAdministrativeArea
            ?? placemark.administrativeArea
            ?? placemark.country
    }

    /// One hour every 320ms while playing, wrapping at the end of the window.
    /// The frame load is keyed on the hour, so a hop that lands on an image
    /// already in the URL cache paints immediately and one that does not
    /// simply arrives a beat later — no queue, no dropped frames to manage.
    private func run() async {
        guard isPlaying, points.count > 1 else { return }
        while !Task.isCancelled && isPlaying {
            try? await Task.sleep(for: .milliseconds(320))
            guard !Task.isCancelled, isPlaying else { return }
            let count = points.count
            let current = selection ?? nowIndex
            selection = current >= count - 1 ? 0 : current + 1
        }
    }

    private func loadDomains() async {
        do {
            domains = try await SmokeFrames.fetchDomains()
            // The basemap we control is here now — CARTO dark on MapLibre — so
            // the theme is fixed at dark and the map reads the grey→amber
            // frames. Coverage stays honest: where no dark domain reaches, the
            // map paints no smoke rather than the wrong ramp.
            if domains.isEmpty { status = .unavailable }
        } catch {
            status = .unavailable
        }
    }

    private func loadFrame() async {
        guard !domains.isEmpty, let place else { return }
        let coordinate = CLLocationCoordinate2D(
            latitude: place.latitude,
            longitude: place.longitude
        )
        guard let match = SmokeFrames.domain(
            for: coordinate,
            at: validTime,
            in: domains,
            theme: theme
        ) else {
            frame = nil
            status = .noCoverage
            return
        }
        do {
            let image = try await SmokeFrameImage.load(match.frame)
            guard !Task.isCancelled else { return }
            frame = SmokeFramePayload(image: image, bounds: match.domain.bounds)
            status = .painted(match.domain.model)
        } catch {
            // Playback supersedes its own loads: every hour that arrives while
            // an earlier one is still in flight cancels it. A cancelled fetch
            // is not a broken map, and treating it as one made the whole field
            // disappear the moment you pressed play.
            guard !Task.isCancelled, !(error is CancellationError) else { return }
            if (error as NSError).code == NSURLErrorCancelled { return }
            // Keep the last good frame rather than blanking: a single missing
            // hour mid-run is a gap in the run, not a loss of coverage.
            status = .unavailable
        }
    }
}

#endif
