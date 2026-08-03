// The mock endpoint.
//
// Every fixture in Resources/Fixtures was produced by running a synthetic
// series through the *real* payload builder (src/lib/forecast.js) and
// validated against design/forecast-api-v1.schema.json before it was written —
// see scripts/generate-apple-fixtures.mjs. So the scale copy, the 6-hour hold,
// the sky, and the day strip in these files are the ones production serves.
//
// They cover contract §10's list, which is the list every client is supposed
// to be built against before the real endpoint exists:
//
//   clear-staying-clear · smoke-now-clearing · smoke-never-clears
//   clean-smoke-arriving · no-sensors · sensors-diverge · model-gaps
//   short-window · error-upstream-failed · error-bad-coords
//
// The fixtures are frozen at 2026-08-02T17:03:11Z. `MockForecastClient` can
// shift them onto the current clock so a widget built against a mock still
// advances hour by hour like the real thing.

import Foundation

/// Resource lookup that works under both build systems: SwiftPM synthesises
/// `Bundle.module`, the Xcode framework target does not.
public enum SmokeshowResources {
    public static var bundle: Bundle {
        #if SWIFT_PACKAGE
        return .module
        #else
        return Bundle(for: BundleToken.self)
        #endif
    }
}

private final class BundleToken {}

public enum MockForecast {

    public enum Case: String, CaseIterable, Sendable {
        case clearStayingClear = "clear-staying-clear"
        case smokeNowClearing = "smoke-now-clearing"
        case smokeNeverClears = "smoke-never-clears"
        case cleanSmokeArriving = "clean-smoke-arriving"
        case noSensors = "no-sensors"
        case sensorsDiverge = "sensors-diverge"
        case modelGaps = "model-gaps"
        case shortWindow = "short-window"
        case errorUpstreamFailed = "error-upstream-failed"
        case errorBadCoords = "error-bad-coords"

        public var isError: Bool { rawValue.hasPrefix("error-") }
    }

    /// Raw fixture body, as it would arrive over the wire.
    public static func data(_ fixture: Case, bundle: Bundle = SmokeshowResources.bundle) -> Data {
        guard let url = bundle.url(
            forResource: fixture.rawValue,
            withExtension: "json",
            subdirectory: "Fixtures"
        ) ?? bundle.url(forResource: fixture.rawValue, withExtension: "json"),
            let data = try? Data(contentsOf: url)
        else {
            fatalError("missing fixture \(fixture.rawValue).json — run `npm run fixtures:apple`")
        }
        return data
    }

    public static func load(_ fixture: Case, bundle: Bundle = SmokeshowResources.bundle) -> Forecast? {
        guard let envelope = try? ForecastDecoder.decode(data(fixture, bundle: bundle)),
              case .forecast(let forecast) = envelope
        else { return nil }
        return forecast
    }

    /// The fixtures are frozen at 2026-08-02T17:03:11Z, so `now.index` will not
    /// resolve against today's clock and a widget built on one renders nothing.
    /// This slides every UTC instant in the body forward by a whole number of
    /// hours so the timeline lands on the current hour.
    ///
    /// It is a *layout* mock, not a time machine: `days[].key` and
    /// `days[].weekday` are server-formatted strings and stay at the fixture's
    /// dates. Never use this against anything that asserts on weekday labels.
    public static func shiftedToNow(
        _ fixture: Case,
        bundle: Bundle = SmokeshowResources.bundle,
        now: Date = Date()
    ) -> Data {
        let body = data(fixture, bundle: bundle)
        guard let text = String(data: body, encoding: .utf8),
              let envelope = try? ForecastDecoder.decode(body),
              case .forecast(let forecast) = envelope
        else { return body }

        let hoursDelta = ((now.timeIntervalSince(forecast.now.timeUTC)) / 3600).rounded()
        guard abs(hoursDelta) >= 1 else { return body }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        let pattern = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return body }

        var output = text
        // Walk matches back-to-front so the ranges stay valid as we substitute.
        let matches = regex.matches(in: output, range: NSRange(output.startIndex..., in: output))
        for match in matches.reversed() {
            guard let range = Range(match.range, in: output) else { continue }
            let stamp = String(output[range])
            guard let date = formatter.date(from: stamp) else { continue }
            let moved = date.addingTimeInterval(hoursDelta * 3600)
            output.replaceSubrange(range, with: formatter.string(from: moved))
        }
        return Data(output.utf8)
    }

    /// Previews and SwiftUI canvases. Force-unwraps deliberately: a missing
    /// fixture is a build problem, not a runtime condition.
    public static var preview: Forecast { load(.smokeNowClearing)! }
}

/// Drop-in `ForecastFetching` for the simulator, UI tests, and screenshots.
public struct MockForecastClient: ForecastFetching {
    private let fixture: MockForecast.Case
    private let bundle: Bundle
    private let latency: Duration
    /// Slide the frozen fixture onto today's clock. On by default — a mock
    /// whose timeline is two seasons in the past renders an empty widget.
    private let shiftToNow: Bool

    public init(
        _ fixture: MockForecast.Case = .smokeNowClearing,
        bundle: Bundle = SmokeshowResources.bundle,
        latency: Duration = .milliseconds(120),
        shiftToNow: Bool = true
    ) {
        self.fixture = fixture
        self.bundle = bundle
        self.latency = latency
        self.shiftToNow = shiftToNow
    }

    public func fetch(_ request: ForecastRequest) async throws -> FetchedForecast {
        try? await Task.sleep(for: latency)
        let data = shiftToNow
            ? MockForecast.shiftedToNow(fixture, bundle: bundle)
            : MockForecast.data(fixture, bundle: bundle)
        switch try ForecastDecoder.decode(data) {
        case .forecast(let forecast):
            return FetchedForecast(forecast: forecast, body: data)
        case .failure(let error):
            throw ForecastUnavailable.api(error)
        }
    }
}
