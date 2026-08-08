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

import SwiftUI
import MapKit
import SmokeshowKit

struct SmokeMapView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    /// Hours from now, matching the curve's window.
    @State private var offset: Double = 0
    @State private var domains: [SmokeDomain] = []
    @State private var overlay: SmokeOverlay?
    @State private var status: Status = .loading

    private enum Status: Equatable {
        case loading
        case painted(String)
        case noCoverage
        case unavailable
    }

    private var place: Place? { model.place }

    private var validTime: Date {
        // Snap to the hour: frames are hourly and a half-hour offset would ask
        // for a file that was never published.
        let now = model.forecast?.now.exactUTC ?? Date()
        return Calendar(identifier: .gregorian)
            .date(bySetting: .minute, value: 0, of: now.addingTimeInterval(offset * 3600))
            ?? now
    }

    var body: some View {
        ZStack(alignment: .top) {
            MapCanvas(
                center: place.map {
                    CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                },
                overlay: overlay
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
    }

    /// Recomputing the frame is keyed on the hour and the place, not on the
    /// raw slider value — a drag emits hundreds of values and 61 frames exist.
    ///
    /// The domain count is in the key because the manifest lands *after* the
    /// first frame task runs; without it the first paint waits for a scrub.
    private var frameKey: String {
        "\(SmokeFrames.timeKey(for: validTime))|\(place?.id.uuidString ?? "-")|\(domains.count)"
    }

    private var topBar: some View {
        HStack {
            Button { dismiss() } label: {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 12, weight: .semibold))
                    Text("BACK").font(Typography.eyebrow)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Capsule().fill(.ultraThinMaterial))
            }
            .buttonStyle(.plain)

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
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(whenLabel).font(Typography.md)
                Spacer()
                if offset != 0 {
                    Button("Now") { offset = 0 }
                        .font(Typography.eyebrow)
                        .buttonStyle(.plain)
                        .opacity(0.7)
                }
            }

            Slider(value: $offset, in: -12...48, step: 1)
                .tint(Palette.dark.accent)

            HStack {
                Text("−12h").font(Typography.eyebrow).opacity(0.5)
                Spacer()
                Text(Copy.modelEstimate).font(Typography.eyebrow).opacity(0.5)
                Spacer()
                Text("+48h").font(Typography.eyebrow).opacity(0.5)
            }
        }
        .padding(16)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .padding(16)
    }

    private var whenLabel: String {
        let formatter = DateFormatter()
        formatter.timeZone = model.forecast?.location.timeZone ?? .current
        formatter.dateFormat = "EEEE h a"
        return offset == 0 ? "Now" : formatter.string(from: validTime)
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

    private func loadDomains() async {
        do {
            domains = try await SmokeFrames.fetchDomains()
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
        guard let match = SmokeFrames.domain(for: coordinate, at: validTime, in: domains) else {
            overlay = nil
            status = .noCoverage
            return
        }
        do {
            let image = try await SmokeFrameImage.load(match.frame)
            overlay = SmokeOverlay(image: image, bounds: match.domain.bounds)
            status = .painted(match.domain.model)
        } catch {
            overlay = nil
            status = .unavailable
        }
    }
}

/// MapKit, muted. The basemap is context, not the subject — the web makes the
/// same call with CARTO Positron, and the standard configuration's `.muted`
/// emphasis is the native way to say it.
private struct MapCanvas: UIViewRepresentable {
    let center: CLLocationCoordinate2D?
    let overlay: SmokeOverlay?

    func makeUIView(context: Context) -> MKMapView {
        let view = MKMapView()
        view.delegate = context.coordinator
        view.pointOfInterestFilter = .excludingAll
        view.showsCompass = false

        let configuration = MKStandardMapConfiguration(emphasisStyle: .muted)
        view.preferredConfiguration = configuration

        // The basemap is forced light, and this is not a style preference.
        //
        // CLAUDE.md: "the ramp always runs opposite the tiles" — the published
        // frames are PNG-8 whose palette darkens as smoke thickens, rendered
        // for a light basemap. The app inherits `.preferredColorScheme(.dark)`
        // from the root, which would hand MapKit a dark basemap and make the
        // heaviest air the least visible thing on screen. That flip has been
        // made twice on the web and was the same mistake both times.
        //
        // A dark map is not a toggle here: it needs a second set of frames
        // published with the ramp inverted.
        view.overrideUserInterfaceStyle = .light

        if let center {
            view.setRegion(
                MKCoordinateRegion(
                    center: center,
                    span: MKCoordinateSpan(latitudeDelta: 12, longitudeDelta: 12)
                ),
                animated: false
            )
            let pin = MKPointAnnotation()
            pin.coordinate = center
            view.addAnnotation(pin)
        }
        return view
    }

    func updateUIView(_ view: MKMapView, context: Context) {
        let existing = view.overlays.compactMap { $0 as? SmokeOverlay }
        guard existing.first !== overlay else { return }
        view.removeOverlays(existing)
        if let overlay { view.addOverlay(overlay, level: .aboveRoads) }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, MKMapViewDelegate {
        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            guard let smoke = overlay as? SmokeOverlay else {
                return MKOverlayRenderer(overlay: overlay)
            }
            return SmokeOverlayRenderer(overlay: smoke)
        }
    }
}
