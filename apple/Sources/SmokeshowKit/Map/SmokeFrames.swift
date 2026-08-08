// `MKMapRect` is unavailable on watchOS, and the watch draws no map.

#if !os(watchOS)

// Client for the pre-rendered smoke domains on the `data` branch.
//
// A port of `src/lib/frames.js`, and deliberately a thin one. The web already
// settled the hard questions: a DOMAIN is one rectangular pre-rendered field
// (a model, an extent, a pixel size, hourly PNG frames keyed by absolute valid
// time), the map paints the sharpest domain containing the view centre that
// has a frame for the hour, and an unrecognised manifest version means paint
// nothing rather than guess.
//
// Two facts make this port small, and both are the publisher's doing:
//
//  • the PNGs are PNG-8 whose palette *is* the smoke ramp, so there is no
//    client-side colour mapping to keep in step with `SMOKE_STOPS`; and
//  • their rows are spaced linearly in Web-Mercator y, which is the projection
//    MapKit already draws in, so a frame lands on an `MKMapRect` with no
//    resampling.

import Foundation
import MapKit

public struct SmokeDomain: Sendable, Identifiable {
    public enum Theme: String, Sendable {
        /// Ramp darkens with concentration; for a light basemap.
        case light
        /// Ramp lightens with concentration; for a dark one.
        case dark
    }

    public let id: String
    public let label: String
    public let model: String
    /// Which basemap this domain's palette was rendered for. Domains published
    /// before the field existed are light, which is what they are.
    public let theme: Theme
    public let source: String?
    public let resolutionKm: Double?
    /// Higher is sharper. The map paints the highest-priority domain that
    /// contains the centre and has a frame for the hour.
    public let priority: Int
    public let bounds: Bounds
    public let frames: [String: URL]

    public struct Bounds: Sendable {
        public let latS, latN, lonW, lonE: Double

        public func contains(_ coordinate: CLLocationCoordinate2D) -> Bool {
            coordinate.latitude >= latS && coordinate.latitude <= latN
                && coordinate.longitude >= lonW && coordinate.longitude <= lonE
        }

        /// The rect a frame covers. `MKMapRect` is Web Mercator, which is what
        /// the frames were rendered in.
        public var mapRect: MKMapRect {
            let topLeft = MKMapPoint(CLLocationCoordinate2D(latitude: latN, longitude: lonW))
            let bottomRight = MKMapPoint(CLLocationCoordinate2D(latitude: latS, longitude: lonE))
            return MKMapRect(
                x: topLeft.x,
                y: topLeft.y,
                width: bottomRight.x - topLeft.x,
                height: bottomRight.y - topLeft.y
            )
        }
    }
}

public enum SmokeFrames {

    /// Bumped when one `bounds` became many domains. A newer publisher and an
    /// older client is a normal state during a rollout, not an error: this
    /// build returns no domains and the map says so.
    public static let supportedManifestVersion = 2

    static let base = URL(string: "https://raw.githubusercontent.com/watchcapstudio/smokeshow/data")!

    public static func fetchDomains(session: URLSession = .shared) async throws -> [SmokeDomain] {
        // Revalidate rather than trust the cache. The manifest is a few kB and
        // changes four times a day, but `raw.githubusercontent.com` sends a
        // five-minute max-age — long enough that a run which has just landed is
        // invisible to someone opening the map, including the run that first
        // publishes a new domain.
        var request = URLRequest(url: base.appendingPathComponent("manifest.json"))
        request.cachePolicy = .reloadRevalidatingCacheData
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse).map({ (200...299).contains($0.statusCode) }) ?? false else {
            throw SmokeFrameError.manifestUnavailable
        }

        let manifest = try JSONDecoder().decode(Manifest.self, from: data)
        guard manifest.version == supportedManifestVersion else { return [] }

        return manifest.domains.compactMap { domain in
            guard let bounds = domain.bounds else { return nil }
            var frames: [String: URL] = [:]
            for frame in domain.frames ?? [] {
                frames[frame.time] = base
                    .appendingPathComponent(domain.id)
                    .appendingPathComponent(frame.file)
            }
            guard !frames.isEmpty else { return nil }
            return SmokeDomain(
                id: domain.id,
                label: domain.label ?? domain.id,
                model: domain.model ?? domain.id,
                theme: SmokeDomain.Theme(rawValue: domain.theme ?? "light") ?? .light,
                source: domain.source,
                resolutionKm: domain.resolutionKm,
                priority: domain.priority ?? 99,
                bounds: .init(
                    latS: bounds.latS,
                    latN: bounds.latN,
                    lonW: bounds.lonW,
                    lonE: bounds.lonE
                ),
                frames: frames
            )
        }
        // Highest priority first, matching `assemble_manifest.py` and
        // `frames.js`: the sharpest domain covering the point wins, and the
        // caller takes the first match without sorting again. Ascending was
        // backwards — harmless only because the themes never compete.
        .sorted { $0.priority > $1.priority }
    }

    /// The key a frame is filed under: the valid hour in UTC, to the hour.
    public static func timeKey(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:00"
        return formatter.string(from: date)
    }

    /// The sharpest domain that covers this point and has this hour. Nil is a
    /// supported state — it means the point grid would have to carry the map,
    /// and on iOS there is no point grid, so the map says it has no coverage.
    public static func domain(
        for coordinate: CLLocationCoordinate2D,
        at date: Date,
        in domains: [SmokeDomain],
        theme: SmokeDomain.Theme
    ) -> (domain: SmokeDomain, frame: URL)? {
        let key = timeKey(for: date)
        for domain in domains
        where domain.theme == theme && domain.bounds.contains(coordinate) {
            if let frame = domain.frames[key] { return (domain, frame) }
        }
        return nil
    }

    /// True once the publisher is writing dark-ramp domains. Until the first
    /// run after that change lands, there are none, and a map that assumed
    /// otherwise would go black with nothing painted on it.
    public static func hasTheme(_ theme: SmokeDomain.Theme, in domains: [SmokeDomain]) -> Bool {
        domains.contains { $0.theme == theme }
    }

    // MARK: Wire types

    private struct Manifest: Decodable {
        let version: Int
        let domains: [Domain]
    }

    private struct Domain: Decodable {
        let id: String
        let label: String?
        let model: String?
        let theme: String?
        let source: String?
        let resolutionKm: Double?
        let priority: Int?
        let bounds: Bounds?
        let frames: [Frame]?

        enum CodingKeys: String, CodingKey {
            case id, label, model, theme, source, priority, bounds, frames
            case resolutionKm = "resolution_km"
        }
    }

    private struct Bounds: Decodable {
        let latS, latN, lonW, lonE: Double
    }

    private struct Frame: Decodable {
        let time: String
        let file: String
    }
}

public enum SmokeFrameError: Error {
    case manifestUnavailable
}

#endif
