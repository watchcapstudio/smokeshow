// The last good payload, on disk in the App Group.
//
// Contract §9.3: a native client that cannot reach the endpoint shows the last
// successfully cached payload *with its `generatedAt` visible*, or an explicit
// unavailable state. It must never render a stale number as if it were
// current. The cache stores the raw response body, so a payload written by one
// app version decodes under the next one's decoder — or fails cleanly and is
// discarded, which is the same degrade path as a bad network.

import Foundation

public struct CachedForecast: Sendable {
    public let forecast: Forecast
    /// When *we* stored it. `forecast.generatedAt` is when the server computed
    /// it; the two differ by the CDN cache and the fetch itself.
    public let storedAt: Date
    public let requestKey: String

    public init(forecast: Forecast, storedAt: Date, requestKey: String) {
        self.forecast = forecast
        self.storedAt = storedAt
        self.requestKey = requestKey
    }
}

public final class ForecastCache: @unchecked Sendable {
    public static let shared = ForecastCache()

    private let directory: URL
    private let fileManager = FileManager.default
    private let queue = DispatchQueue(label: "earth.smokeshow.forecast-cache")

    public init(directory: URL = AppGroup.cacheURL(named: "forecasts")) {
        self.directory = directory
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// One entry per (place, source) pair. Coordinates are rounded to the
    /// server's own 0.1° lattice for the *key only* so two nearby saved places
    /// share a cache entry the same way they share the CDN's.
    public static func key(for request: ForecastRequest) -> String {
        let lat = (request.latitude * 10).rounded() / 10
        let lon = (request.longitude * 10).rounded() / 10
        return String(format: "%.1f_%.1f_%@", lat, lon, request.source.rawValue)
    }

    private func fileURL(_ key: String) -> URL {
        directory.appendingPathComponent("\(key).json", isDirectory: false)
    }

    public func store(_ data: Data, for request: ForecastRequest) {
        let key = Self.key(for: request)
        queue.sync {
            try? data.write(to: fileURL(key), options: .atomic)
        }
    }

    /// Raw bodies only, deliberately: re-encoding a decoded payload would drop
    /// the unknown fields an additive contract change is allowed to add, and
    /// the next app version would never see them.
    public func load(for request: ForecastRequest) -> CachedForecast? {
        let key = Self.key(for: request)
        let url = fileURL(key)
        return queue.sync { () -> CachedForecast? in
            guard let data = try? Data(contentsOf: url),
                  let envelope = try? ForecastDecoder.decode(data),
                  case .forecast(let forecast) = envelope
            else { return nil }
            let attributes = try? fileManager.attributesOfItem(atPath: url.path)
            let storedAt = attributes?[.modificationDate] as? Date
            return CachedForecast(
                forecast: forecast,
                storedAt: storedAt ?? forecast.generatedAt,
                requestKey: key
            )
        }
    }

    public func clear() {
        queue.sync {
            let contents = (try? fileManager.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: nil
            )) ?? []
            for url in contents { try? fileManager.removeItem(at: url) }
        }
    }
}
