// The smoke field, as one image over one rectangle.
//
// The web draws this into a canvas because the browser has no map-overlay
// primitive worth using. MapKit does, and the frames are already rendered in
// Web Mercator with the ramp baked into the palette, so the whole job here is:
// put this PNG on that rect.
//
// The stipple the web applies in screen space is deliberately not ported. It
// exists because a domain-wide texture smudges at 10–20× upscaling, and
// solving that on iOS is its own piece of work, not a line of it.

import Foundation
import MapKit

public final class SmokeOverlay: NSObject, MKOverlay {
    public let coordinate: CLLocationCoordinate2D
    public let boundingMapRect: MKMapRect
    public let image: CGImage

    public init(image: CGImage, bounds: SmokeDomain.Bounds) {
        self.image = image
        self.boundingMapRect = bounds.mapRect
        self.coordinate = CLLocationCoordinate2D(
            latitude: (bounds.latS + bounds.latN) / 2,
            longitude: (bounds.lonW + bounds.lonE) / 2
        )
        super.init()
    }
}

public final class SmokeOverlayRenderer: MKOverlayRenderer {

    private let image: CGImage

    public init(overlay: SmokeOverlay) {
        self.image = overlay.image
        super.init(overlay: overlay)
    }

    public override func draw(
        _ mapRect: MKMapRect,
        zoomScale: MKZoomScale,
        in context: CGContext
    ) {
        let rect = rect(for: overlay.boundingMapRect)

        // Core Graphics draws bottom-up and the frame is top-down; flip once
        // here rather than shipping upside-down weather.
        context.saveGState()
        context.translateBy(x: 0, y: rect.maxY + rect.minY)
        context.scaleBy(x: 1, y: -1)

        // The field is a smooth wash, not data to read pixel-wise. Let it
        // interpolate — nearest-neighbour at this upscale looks like a bug.
        context.interpolationQuality = .high
        context.setAlpha(0.92)
        context.draw(image, in: rect)
        context.restoreGState()
    }
}

public enum SmokeFrameImage {

    /// Frames are immutable once published — a given hour's file never changes
    /// — so the URL cache does the right thing without any policy of ours.
    public static func load(_ url: URL, session: URLSession = .shared) async throws -> CGImage {
        let (data, response) = try await session.data(from: url)
        guard (response as? HTTPURLResponse).map({ (200...299).contains($0.statusCode) }) ?? false,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else {
            throw SmokeFrameError.manifestUnavailable
        }
        return image
    }
}
