// Fetch, cache, degrade. The one place that decides what a surface is allowed
// to show when the network says no.
//
// Contract §9.3 for native clients, implemented literally:
//   • last successfully cached payload, with its `generatedAt` visible; or
//   • an explicit "forecast unavailable" state;
//   • never a stale number dressed as current, never 0 µg/m³ for missing data.

import Foundation

public struct ForecastResult: Sendable {
    public let forecast: Forecast?
    public let error: ForecastUnavailable?
    /// True when `forecast` came off disk rather than the network.
    public let fromCache: Bool
    /// True when the payload is old enough that the UI must say so.
    public let isStale: Bool

    public init(forecast: Forecast?, error: ForecastUnavailable?, fromCache: Bool, isStale: Bool) {
        self.forecast = forecast
        self.error = error
        self.fromCache = fromCache
        self.isStale = isStale
    }
}

public actor ForecastRepository {

    /// Contract §1: "Clients should not poll faster than every 10 minutes;
    /// there is nothing new to see." Enforced here rather than trusted to
    /// every caller.
    public static let minimumFetchInterval: TimeInterval = 10 * 60

    public static let shared = ForecastRepository()

    private let client: ForecastFetching
    private let cache: ForecastCache
    private var lastFetchByKey: [String: Date] = [:]

    public init(
        client: ForecastFetching = ForecastClient(),
        cache: ForecastCache = .shared
    ) {
        self.client = client
        self.cache = cache
    }

    /// - Parameter force: bypass the 10-minute floor for an explicit user
    ///   action (pull to refresh). Never set it on a timer.
    public func load(
        _ request: ForecastRequest,
        force: Bool = false,
        now: Date = Date()
    ) async -> ForecastResult {
        let key = ForecastCache.key(for: request)
        let cached = cache.load(for: request)

        // Inside the floor, the cached payload *is* the answer.
        if !force, let last = lastFetchByKey[key], now.timeIntervalSince(last) < Self.minimumFetchInterval,
           let cached, !cached.forecast.isExhausted(asOf: now) {
            return ForecastResult(
                forecast: cached.forecast,
                error: nil,
                fromCache: true,
                isStale: cached.forecast.isStale(asOf: now)
            )
        }

        do {
            let fetched = try await client.fetch(request)
            cache.store(fetched.body, for: request)
            lastFetchByKey[key] = now
            return ForecastResult(
                forecast: fetched.forecast,
                error: nil,
                fromCache: false,
                isStale: fetched.forecast.isStale(asOf: now)
            )
        } catch {
            let failure = (error as? ForecastUnavailable) ?? .transport(error.localizedDescription)
            guard let cached, !cached.forecast.isExhausted(asOf: now) else {
                // Nothing usable on disk either. The UI says so plainly; it
                // does not guess.
                return ForecastResult(forecast: nil, error: failure, fromCache: false, isStale: true)
            }
            return ForecastResult(
                forecast: cached.forecast,
                error: failure,
                fromCache: true,
                isStale: cached.forecast.isStale(asOf: now)
            )
        }
    }

    /// Cache-only read, for a widget wake that must not spend a network call.
    public func cachedOnly(_ request: ForecastRequest, now: Date = Date()) -> ForecastResult {
        guard let cached = cache.load(for: request), !cached.forecast.isExhausted(asOf: now) else {
            return ForecastResult(forecast: nil, error: .transport("no cache"), fromCache: true, isStale: true)
        }
        return ForecastResult(
            forecast: cached.forecast,
            error: nil,
            fromCache: true,
            isStale: cached.forecast.isStale(asOf: now)
        )
    }
}
