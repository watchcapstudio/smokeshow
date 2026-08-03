// One call, one timeline. The client fetches `/api/forecast` and hands back a
// decoded payload; it does not poll, and it does not fetch a point.
//
// Contract §1: clients send their *real* coordinates (the server snaps to the
// 0.1° lattice and reports what it used), must not poll faster than every ten
// minutes, and widget timelines fetch **once** and schedule locally off
// `hours[]`. That last rule is what keeps the WidgetKit reload budget intact.

import Foundation

public struct ForecastRequest: Sendable, Equatable {
    public let latitude: Double
    public let longitude: Double
    public let source: ForecastSourcePreference

    public init(latitude: Double, longitude: Double, source: ForecastSourcePreference = .official) {
        self.latitude = latitude
        self.longitude = longitude
        self.source = source
    }

    public init(place: Place, source: ForecastSourcePreference = .official) {
        self.init(latitude: place.latitude, longitude: place.longitude, source: source)
    }
}

/// A decoded payload plus the body it came from. The body is what gets
/// cached: re-encoding the model would drop the unknown fields an additive
/// contract change is allowed to add.
public struct FetchedForecast: Sendable {
    public let forecast: Forecast
    public let body: Data

    public init(forecast: Forecast, body: Data) {
        self.forecast = forecast
        self.body = body
    }
}

public protocol ForecastFetching: Sendable {
    func fetch(_ request: ForecastRequest) async throws -> FetchedForecast
}

public struct ForecastClient: ForecastFetching {

    public static let productionBaseURL = URL(string: "https://smokeshow.earth")!

    /// Widgets get a short leash: a WidgetKit refresh that hangs is a reload
    /// spent for nothing, and the previous timeline is still on screen.
    public static let widgetTimeout: TimeInterval = 12
    public static let appTimeout: TimeInterval = 20

    private let baseURL: URL
    private let session: URLSession

    public init(
        baseURL: URL = ForecastClient.productionBaseURL,
        timeout: TimeInterval = ForecastClient.appTimeout,
        session: URLSession? = nil
    ) {
        self.baseURL = baseURL
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = timeout
            configuration.timeoutIntervalForResource = timeout
            configuration.waitsForConnectivity = false
            // The endpoint is CDN-cached for 10 minutes; let the URL cache
            // honour that rather than re-fetching on every widget wake.
            configuration.requestCachePolicy = .useProtocolCachePolicy
            self.session = URLSession(configuration: configuration)
        }
    }

    public func url(for request: ForecastRequest) -> URL {
        var components = URLComponents(
            url: baseURL.appendingPathComponent("api/forecast"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            // Real coordinates, full precision. Pre-snapping forks the lattice.
            URLQueryItem(name: "lat", value: String(request.latitude)),
            URLQueryItem(name: "lon", value: String(request.longitude)),
            URLQueryItem(name: "source", value: request.source.rawValue),
        ]
        return components.url!
    }

    public func fetch(_ request: ForecastRequest) async throws -> FetchedForecast {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(from: url(for: request))
        } catch {
            throw ForecastUnavailable.transport(error.localizedDescription)
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        // Error responses carry the same envelope as success, so try to decode
        // before judging by status — a 502 with `upstream-failed` is more use
        // to the UI than "502".
        let envelope: ForecastEnvelope
        do {
            envelope = try ForecastDecoder.decode(data)
        } catch {
            if (200...299).contains(status) {
                throw (error as? ForecastUnavailable) ?? ForecastUnavailable.malformed
            }
            throw ForecastUnavailable.http(status: status)
        }

        switch envelope {
        case .forecast(let forecast):
            guard (200...299).contains(status) else {
                throw ForecastUnavailable.http(status: status)
            }
            return FetchedForecast(forecast: forecast, body: data)
        case .failure(let apiError):
            throw ForecastUnavailable.api(apiError)
        }
    }
}
