// Degrade, do not crash (contract §9) — with the emphasis on *degrade*: a
// cached payload is shown with its age visible, and when there is nothing
// usable the answer is an explicit unavailable state, not a guess.

import XCTest
@testable import SmokeshowKit

private struct FailingClient: ForecastFetching {
    let error: ForecastUnavailable
    func fetch(_ request: ForecastRequest) async throws -> FetchedForecast { throw error }
}

private actor CallCounter {
    private(set) var count = 0
    func increment() { count += 1 }
}

private struct CountingClient: ForecastFetching {
    let fixture: MockForecast.Case
    let counter: CallCounter

    func fetch(_ request: ForecastRequest) async throws -> FetchedForecast {
        await counter.increment()
        let data = MockForecast.data(fixture)
        guard case .forecast(let forecast) = try ForecastDecoder.decode(data) else {
            throw ForecastUnavailable.malformed
        }
        return FetchedForecast(forecast: forecast, body: data)
    }
}

final class RepositoryTests: XCTestCase {

    private let request = ForecastRequest(latitude: 44.9778, longitude: -93.2650)
    private var cache: ForecastCache!
    private var directory: URL!

    override func setUpWithError() throws {
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent(UUID().uuidString)
        cache = ForecastCache(directory: directory)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testURLSendsRealCoordinatesAndTheSourceParameter() {
        let client = ForecastClient()
        let url = client.url(for: ForecastRequest(
            latitude: 44.9778,
            longitude: -93.2650,
            source: .local
        ))
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        // Not pre-snapped: the server owns the lattice (contract §1).
        XCTAssertEqual(query.first(where: { $0.name == "lat" })?.value, "44.9778")
        XCTAssertEqual(query.first(where: { $0.name == "lon" })?.value, "-93.265")
        XCTAssertEqual(query.first(where: { $0.name == "source" })?.value, "local")
        XCTAssertEqual(url.path, "/api/forecast")
    }

    func testNearbyCoordinatesShareOneCacheEntry() {
        let a = ForecastRequest(latitude: 44.9778, longitude: -93.2650)
        let b = ForecastRequest(latitude: 45.0121, longitude: -93.3004)
        XCTAssertEqual(ForecastCache.key(for: a), ForecastCache.key(for: b))

        let differentSource = ForecastRequest(latitude: 44.9778, longitude: -93.2650, source: .local)
        XCTAssertNotEqual(ForecastCache.key(for: a), ForecastCache.key(for: differentSource))
    }

    func testFailureFallsBackToCacheWithTheErrorStillReported() async throws {
        cache.store(MockForecast.shiftedToNow(.smokeNowClearing), for: request)

        let repository = ForecastRepository(
            client: FailingClient(error: .api(ForecastAPIError(code: .upstreamFailed, message: "down"))),
            cache: cache
        )
        let result = await repository.load(request)

        XCTAssertNotNil(result.forecast, "a cached payload is better than nothing")
        XCTAssertTrue(result.fromCache)
        // The caller still learns it failed, so the UI can show the age.
        XCTAssertNotNil(result.error)
    }

    func testFailureWithNoCacheIsExplicitlyUnavailable() async {
        let repository = ForecastRepository(
            client: FailingClient(error: .transport("offline")),
            cache: cache
        )
        let result = await repository.load(request)

        XCTAssertNil(result.forecast)
        XCTAssertEqual(result.error, .transport("offline"))
        XCTAssertFalse(result.error!.userFacingMessage.isEmpty)
    }

    func testRepositoryHonoursTheTenMinutePollFloor() async throws {
        let counter = CallCounter()
        let repository = ForecastRepository(
            client: CountingClient(fixture: .smokeNowClearing, counter: counter),
            cache: cache
        )

        // Anchored to the fixture's own clock so the floor is exercised
        // against a payload that is still live, today and in five years.
        let start = try XCTUnwrap(MockForecast.load(.smokeNowClearing)).now.exactUTC
        _ = await repository.load(request, now: start)
        // Five minutes later there is nothing new to see (contract §1).
        _ = await repository.load(request, now: start.addingTimeInterval(300))
        var calls = await counter.count
        XCTAssertEqual(calls, 1)

        // Eleven minutes later there might be.
        _ = await repository.load(request, now: start.addingTimeInterval(660))
        calls = await counter.count
        XCTAssertEqual(calls, 2)

        // An explicit user refresh always goes out.
        _ = await repository.load(request, force: true, now: start.addingTimeInterval(661))
        calls = await counter.count
        XCTAssertEqual(calls, 3)
    }

    func testCacheRoundTripsRawBodies() throws {
        let body = MockForecast.data(.sensorsDiverge)
        cache.store(body, for: request)

        let cached = try XCTUnwrap(cache.load(for: request))
        XCTAssertEqual(cached.forecast.verdict.headline,
                       MockForecast.load(.sensorsDiverge)?.verdict.headline)
        XCTAssertNotNil(cached.forecast.measured.official)
        XCTAssertNotNil(cached.forecast.measured.local)
    }
}
