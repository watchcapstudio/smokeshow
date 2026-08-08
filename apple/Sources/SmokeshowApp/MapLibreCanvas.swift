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
        if let center, context.coordinator.lastCenter.map({
            $0.latitude != center.latitude || $0.longitude != center.longitude
        }) ?? true {
            // Recentre at whatever zoom the reader is already using — switching
            // cities is not a fresh visit.
            mapView.setCenter(center, animated: true)
            context.coordinator.lastCenter = center
        }
        context.coordinator.apply(frame: frame)
    }

    func makeCoordinator() -> Coordinator { Coordinator(onLongPress: onLongPress) }

    // MARK: - Style

    /// CARTO dark raster, written once to a local file MapLibre loads as its
    /// style. Raster rather than CARTO's vector style on purpose: rasters let
    /// the labels sit in their own layer ABOVE the smoke, which the vector
    /// style bakes together. Both credits are carried on the source so the
    /// info button shows them wherever the tiles are.
    private static func darkStyleURL() -> URL {
        let attribution = "© OpenStreetMap contributors © CARTO"
        func rasterSource(_ slug: String) -> String {
            let tiles = ["a", "b", "c", "d"].map {
                "\"https://\($0).basemaps.cartocdn.com/\(slug)/{z}/{x}/{y}.png\""
            }.joined(separator: ",")
            return """
            {"type":"raster","tiles":[\(tiles)],"tileSize":256,"maxzoom":20,\
            "attribution":"\(attribution)"}
            """
        }
        let json = """
        {"version":8,"sources":{\
        "carto-dark":\(rasterSource("dark_nolabels")),\
        "carto-labels":\(rasterSource("dark_only_labels"))},\
        "layers":[\
        {"id":"bg","type":"background","paint":{"background-color":"#0a0c10"}},\
        {"id":"carto-dark","type":"raster","source":"carto-dark"},\
        {"id":"carto-labels","type":"raster","source":"carto-labels"}]}
        """
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("smokeshow-dark-style.json")
        try? json.data(using: .utf8)?.write(to: url)
        return url
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

        // The smoke rides between the base tiles and the labels; the "you are
        // here" dot rides above everything.
        private let smokeSourceID = "smoke"
        private let smokeLayerID = "smoke"
        private let labelsLayerID = "carto-labels"

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
            let image = UIImage(cgImage: frame.image)

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
                if let labels = style.layer(withIdentifier: labelsLayerID) {
                    style.insertLayer(layer, below: labels)
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
            let dot = MLNCircleStyleLayer(identifier: "me-dot", source: source)
            dot.circleRadius = NSExpression(forConstantValue: 6)
            dot.circleColor = NSExpression(forConstantValue: UIColor.white)
            dot.circleStrokeWidth = NSExpression(forConstantValue: 2)
            dot.circleStrokeColor = NSExpression(forConstantValue: UIColor(white: 0.04, alpha: 1))
            style.addLayer(dot)
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
