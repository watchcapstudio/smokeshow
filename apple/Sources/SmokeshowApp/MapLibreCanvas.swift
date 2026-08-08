// The map, on MapLibre instead of MapKit.
//
// Why the engine changed: the smoke ramp always runs opposite the basemap, and
// the product wants a dark map — so heavy air has to BRIGHTEN to amber to stay
// visible. MapKit will not hand its basemap a dark style that agrees with those
// frames (its tiles ignore overrideUserInterfaceStyle here), so the darkening
// ramp had no legible backdrop. MapLibre draws a basemap we control — CARTO
// dark — and draws it on iOS and Android both, so this is also the map Android
// will share. See CLAUDE.md's map rule and docs/codev-log.md.
//
// The frames are unchanged. They are PNG-8 whose palette IS the ramp, rendered
// in Web Mercator — which is MapLibre's projection too — so an image source
// with the domain's corners as its quad lands with no resampling, exactly as it
// did on MKMapRect.
//
// The three-layer sandwich matches the web: base tiles, then the smoke image,
// then the labels on top. Heavy smoke composites to near-opaque and would bury
// the city names precisely when a reader needs to know what is under the plume.

#if os(iOS)

import SwiftUI
import MapLibre
import SmokeshowKit

/// One georeferenced smoke frame: the palette-baked PNG and the lat/lon box it
/// covers. A class so the view can diff frames by identity, the same way the
/// MapKit overlay was compared by reference.
final class SmokeFramePayload {
    let image: CGImage
    let bounds: SmokeDomain.Bounds

    init(image: CGImage, bounds: SmokeDomain.Bounds) {
        self.image = image
        self.bounds = bounds
    }
}

struct MapLibreCanvas: UIViewRepresentable {
    let center: CLLocationCoordinate2D?
    let frame: SmokeFramePayload?
    let onLongPress: (CLLocationCoordinate2D) -> Void

    // Opening span: ~2.2° across, your metro and the country the smoke is
    // arriving from. Pinch out for the continent.
    private static let openingZoom: Double = 6.2

    func makeUIView(context: Context) -> MLNMapView {
        let mapView = MLNMapView(frame: .zero, styleURL: Self.darkStyleURL())
        mapView.delegate = context.coordinator
        context.coordinator.mapView = mapView

        // A weather map is read north-up and flat; rotation and tilt only ever
        // get in the way of a scrub.
        mapView.allowsRotating = false
        mapView.allowsTilting = false
        mapView.showsUserLocation = false
        mapView.logoView.isHidden = true // CARTO + OSM credit rides the info button

        // The info button carries the CARTO + OSM attribution, a licence
        // condition, so it stays — but out of the bottom-right corner, where the
        // scrubber card clipped it in half. Top-left, below the clock, dimmed:
        // small, out of the way, and fully on screen.
        mapView.attributionButton.tintColor = UIColor(white: 1, alpha: 0.45)
        mapView.attributionButtonPosition = .topLeft
        mapView.attributionButtonMargins = CGPoint(x: 14, y: 112)

        if let center {
            mapView.setCenter(center, zoomLevel: Self.openingZoom, animated: false)
            context.coordinator.lastCenter = center
        }

        // Press and hold to move the forecast: on a map, pointing at a spot IS
        // the gesture for "what about here?".
        let press = UILongPressGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleLongPress(_:))
        )
        press.minimumPressDuration = 0.45
        mapView.addGestureRecognizer(press)

        return mapView
    }

    func updateUIView(_ mapView: MLNMapView, context: Context) {
        // Move the dot to the current place; do NOT recentre. While the map is
        // open the only thing that changes the place is a long-press drop, and
        // the dot should jump to under the finger, not yank the map out from
        // under it.
        if let center {
            context.coordinator.moveMarker(to: center)
        }
        context.coordinator.apply(frame: frame)
    }

    func makeCoordinator() -> Coordinator { Coordinator(onLongPress: onLongPress) }

    // MARK: - Style

    /// CARTO dark-matter, the vector style. Raster tiles softened the city
    /// names on a 3x screen no matter the @Nx — a raster label is pixels, and
    /// pixels upscale. Vector labels are glyphs and stay crisp at any density.
    /// The smoke is inserted below the style's first symbol layer (see
    /// `render`), so the names still ride above the weather the way the raster
    /// sandwich did. Glyphs, sprite and the CARTO/OSM attribution all travel
    /// with the style.
    private static func darkStyleURL() -> URL {
        URL(string: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json")!
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, MLNMapViewDelegate {
        private let onLongPress: (CLLocationCoordinate2D) -> Void
        weak var mapView: MLNMapView?
        var lastCenter: CLLocationCoordinate2D?

        private var styleLoaded = false
        private var pendingFrame: SmokeFramePayload?
        private var appliedFrame: SmokeFramePayload?
        private var imageSource: MLNImageSource?
        private var meSource: MLNShapeSource?

        // The smoke rides between the base tiles and the labels; the "you are
        // here" dot rides above everything.
        private let smokeSourceID = "smoke"
        private let smokeLayerID = "smoke"

        init(onLongPress: @escaping (CLLocationCoordinate2D) -> Void) {
            self.onLongPress = onLongPress
        }

        func apply(frame: SmokeFramePayload?) {
            guard frame !== appliedFrame else { return }
            pendingFrame = frame
            if styleLoaded { render() }
        }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            styleLoaded = true
            installMarker(in: style)
            render()
        }

        private func render() {
            guard let style = mapView?.style else { return }
            let frame = pendingFrame

            // No dark frame for this place/hour: CONUS is the only dark domain
            // published today, so outside it the map shows the basemap and says
            // it has no coverage rather than painting a light ramp on dark
            // tiles, which is the one combination that must never ship.
            guard let frame else {
                if let source = imageSource {
                    if let layer = style.layer(withIdentifier: smokeLayerID) {
                        style.removeLayer(layer)
                    }
                    style.removeSource(source)
                    imageSource = nil
                }
                appliedFrame = nil
                return
            }

            let quad = Self.quad(for: frame.bounds)
            let image = Self.feathered(frame.image)

            if let source = imageSource {
                source.coordinates = quad
                source.image = image
            } else {
                let source = MLNImageSource(
                    identifier: smokeSourceID,
                    coordinateQuad: quad,
                    image: image
                )
                style.addSource(source)
                imageSource = source

                let layer = MLNRasterStyleLayer(identifier: smokeLayerID, source: source)
                // The field is a wash, not data to read pixel-wise — let it
                // interpolate, and hold it just under fully opaque so the base
                // never quite disappears, matching the MapKit renderer's 0.92.
                layer.rasterOpacity = NSExpression(forConstantValue: 0.92)
                layer.rasterResamplingMode = NSExpression(forConstantValue: "linear")
                // Below the first symbol (label) layer, so every city name
                // stays legible on top of heavy smoke.
                if let firstSymbol = style.layers.first(where: { $0 is MLNSymbolStyleLayer }) {
                    style.insertLayer(layer, below: firstSymbol)
                } else {
                    style.addLayer(layer)
                }
            }
            appliedFrame = frame
        }

        /// A styled dot for the selected place, drawn as a circle layer rather
        /// than an annotation so it needs no view reuse and always sits on top.
        private func installMarker(in style: MLNStyle) {
            guard let center = lastCenter else { return }
            let feature = MLNPointFeature()
            feature.coordinate = center
            let source = MLNShapeSource(identifier: "me", shape: feature, options: nil)
            style.addSource(source)
            meSource = source
            let dot = MLNCircleStyleLayer(identifier: "me-dot", source: source)
            dot.circleRadius = NSExpression(forConstantValue: 6)
            dot.circleColor = NSExpression(forConstantValue: UIColor.white)
            dot.circleStrokeWidth = NSExpression(forConstantValue: 2)
            dot.circleStrokeColor = NSExpression(forConstantValue: UIColor(white: 0.04, alpha: 1))
            style.addLayer(dot)
        }

        /// Follow the place. A long-press drops a new forecast point; the dot
        /// has to move to it, or the map disagrees with the verdict. Before the
        /// style loads there is no source yet — `lastCenter` carries the
        /// position forward and `installMarker` places the dot there on load.
        func moveMarker(to coordinate: CLLocationCoordinate2D) {
            guard lastCenter?.latitude != coordinate.latitude
                || lastCenter?.longitude != coordinate.longitude else { return }
            lastCenter = coordinate
            guard let meSource else { return }
            let feature = MLNPointFeature()
            feature.coordinate = coordinate
            meSource.shape = feature
        }

        /// Fade the frame to transparent at its four edges. A pre-rendered
        /// domain is a rectangle, and its border is a hard line — most visibly
        /// HRRR's northern edge cutting straight across Canada — which reads as
        /// "no smoke past here" when it means "no model past here". The web
        /// hides that seam by painting a coarser global field underneath; there
        /// is no dark global field yet, so instead the box dissolves. Only a
        /// thin margin fades, so real smoke in the interior is untouched.
        private static func feathered(_ cgImage: CGImage) -> UIImage {
            let size = CGSize(width: cgImage.width, height: cgImage.height)
            let margin = min(size.width, size.height) * 0.06
            let format = UIGraphicsImageRendererFormat.default()
            format.scale = 1
            format.opaque = false
            return UIGraphicsImageRenderer(size: size, format: format).image { context in
                let cg = context.cgContext
                UIImage(cgImage: cgImage).draw(in: CGRect(origin: .zero, size: size))

                // destinationOut: the gradient's alpha erases the frame — fully
                // at the very edge, fading to untouched at `margin` inward.
                cg.setBlendMode(.destinationOut)
                let gradient = CGGradient(
                    colorsSpace: CGColorSpaceCreateDeviceRGB(),
                    colors: [
                        UIColor(white: 0, alpha: 1).cgColor,
                        UIColor(white: 0, alpha: 0).cgColor,
                    ] as CFArray,
                    locations: [0, 1]
                )!
                let edges: [(clip: CGRect, from: CGPoint, to: CGPoint)] = [
                    (CGRect(x: 0, y: 0, width: margin, height: size.height),
                     CGPoint(x: 0, y: 0), CGPoint(x: margin, y: 0)),
                    (CGRect(x: size.width - margin, y: 0, width: margin, height: size.height),
                     CGPoint(x: size.width, y: 0), CGPoint(x: size.width - margin, y: 0)),
                    (CGRect(x: 0, y: 0, width: size.width, height: margin),
                     CGPoint(x: 0, y: 0), CGPoint(x: 0, y: margin)),
                    (CGRect(x: 0, y: size.height - margin, width: size.width, height: margin),
                     CGPoint(x: 0, y: size.height), CGPoint(x: 0, y: size.height - margin)),
                ]
                for edge in edges {
                    cg.saveGState()
                    cg.clip(to: edge.clip)
                    cg.drawLinearGradient(gradient, start: edge.from, end: edge.to, options: [])
                    cg.restoreGState()
                }
            }
        }

        private static func quad(for bounds: SmokeDomain.Bounds) -> MLNCoordinateQuad {
            // MLNCoordinateQuadMake's argument order is topLeft, bottomLeft,
            // bottomRight, topRight — the order MapLibre expects for an image
            // source's four corners.
            MLNCoordinateQuadMake(
                CLLocationCoordinate2D(latitude: bounds.latN, longitude: bounds.lonW),
                CLLocationCoordinate2D(latitude: bounds.latS, longitude: bounds.lonW),
                CLLocationCoordinate2D(latitude: bounds.latS, longitude: bounds.lonE),
                CLLocationCoordinate2D(latitude: bounds.latN, longitude: bounds.lonE)
            )
        }

        @objc func handleLongPress(_ recognizer: UILongPressGestureRecognizer) {
            // `.began`, not `.ended`: the place changes under the finger that is
            // still down, the way a pin drops.
            guard recognizer.state == .began, let mapView = recognizer.view as? MLNMapView
            else { return }
            let point = recognizer.location(in: mapView)
            let coordinate = mapView.convert(point, toCoordinateFrom: mapView)
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            onLongPress(coordinate)
        }
    }
}

#endif
