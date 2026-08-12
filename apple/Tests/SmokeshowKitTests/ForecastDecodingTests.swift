// Decoding the contract, against the fixtures generated from the real payload
// builder. If these pass, a Swift client can read what the endpoint serves.

import XCTest
@testable import SmokeshowKit

final class ForecastDecodingTests: XCTestCase {

    func testEveryFixtureDecodes() throws {
        for fixture in MockForecast.Case.allCases {
            let envelope = try ForecastDecoder.decode(MockForecast.data(fixture))
            switch (envelope, fixture.isError) {
            case (.forecast, false), (.failure, true):
                continue
            default:
                XCTFail("\(fixture.rawValue) decoded as the wrong envelope case")
            }
        }
    }

    func testHeadlineIsServerCopy() throws {
        let clearing = try XCTUnwrap(MockForecast.load(.smokeNowClearing))
        XCTAssertTrue(clearing.verdict.headline.hasPrefix("Clears "))
        // The tilde is required by the share spec: the label must say it is an
        // estimate.
        XCTAssertTrue(try XCTUnwrap(clearing.verdict.clearLabel).contains("~"))

        let stuck = try XCTUnwrap(MockForecast.load(.smokeNeverClears))
        XCTAssertEqual(stuck.verdict.headline, "No clear air as far as the forecast goes")
        XCTAssertNil(stuck.verdict.clearIndex)
        XCTAssertNil(stuck.verdict.clearLabel)

        let clear = try XCTUnwrap(MockForecast.load(.clearStayingClear))
        XCTAssertEqual(clear.verdict.headline, "Clear as far as the forecast goes")
        XCTAssertFalse(clear.verdict.above)
    }

    func testClearAndArrivalAreMutuallyExclusive() throws {
        for fixture in MockForecast.Case.allCases where !fixture.isError {
            let forecast = try XCTUnwrap(MockForecast.load(fixture))
            XCTAssertFalse(
                forecast.verdict.clearIndex != nil && forecast.verdict.arrivalIndex != nil,
                "\(fixture.rawValue) has both a clear and an arrival"
            )
        }
    }

    func testScaleAlwaysShipsFiveRungsWithCopy() throws {
        let forecast = try XCTUnwrap(MockForecast.load(.smokeNowClearing))
        XCTAssertEqual(forecast.scale.count, 5)
        for entry in forecast.scale {
            XCTAssertFalse(entry.name.isEmpty)
            XCTAssertFalse(entry.notice.isEmpty)
            XCTAssertFalse(entry.notLine.isEmpty)
            XCTAssertFalse(entry.guidance.general.isEmpty)
            XCTAssertFalse(entry.guidance.sensitive.isEmpty)
        }
        // Only the top rung is unbounded.
        XCTAssertNil(forecast.scale[4].maxUg)
        XCTAssertNotNil(forecast.scale[3].maxUg)
    }

    func testModelGapsStayNil() throws {
        let forecast = try XCTUnwrap(MockForecast.load(.modelGaps))
        let gaps = forecast.hours.filter(\.isGap)
        XCTAssertFalse(gaps.isEmpty, "the model-gaps fixture must contain gaps")
        for hour in gaps {
            XCTAssertNil(hour.pm25)
            XCTAssertNil(hour.aqi)
            XCTAssertNil(hour.levelIndex)
            // The sky is still computed for a gap — an hour with no data still
            // has a sun (contract §4).
            XCTAssertNotNil(hour.sky)
        }
    }

    func testNoSensorsDegradesToModelAnchor() throws {
        let forecast = try XCTUnwrap(MockForecast.load(.noSensors))
        XCTAssertNil(forecast.measured.official)
        XCTAssertNil(forecast.measured.local)
        XCTAssertEqual(forecast.measured.anchor.source, .model)
        XCTAssertEqual(forecast.measured.anchor.offsetUg, 0)
        XCTAssertEqual(forecast.source.applied, .model)
        // applied == model implies pm25 === pm25Model for every hour.
        for hour in forecast.hours {
            XCTAssertEqual(hour.pm25, hour.pm25Model)
        }
    }

    func testShortWindowIsNotAssumedTo192() throws {
        let forecast = try XCTUnwrap(MockForecast.load(.shortWindow))
        XCTAssertLessThan(forecast.hours.count, 192)
        XCTAssertLessThanOrEqual(forecast.days.count, 5)
        XCTAssertTrue(forecast.hours.indices.contains(forecast.now.index))
    }

    func testUnknownVersionIsUnavailableNotAPartialParse() {
        let body = Data(#"{"v": 2, "verdict": {"headline": "Clears Thursday ~6 PM"}}"#.utf8)
        XCTAssertThrowsError(try ForecastDecoder.decode(body)) { error in
            XCTAssertEqual(error as? ForecastUnavailable, .unsupportedVersion(2))
        }
    }

    func testUnknownFieldsAreIgnored() throws {
        // Additive changes ship without a version bump, so a decoder that
        // rejects new fields breaks on a deploy it should have survived.
        var text = try XCTUnwrap(String(data: MockForecast.data(.smokeNowClearing), encoding: .utf8))
        text = text.replacingOccurrences(
            of: "\"v\": 1,",
            with: "\"v\": 1,\n  \"somethingNew\": {\"nested\": [1, 2, 3]},"
        )
        guard case .forecast = try ForecastDecoder.decode(Data(text.utf8)) else {
            return XCTFail("a payload with an unknown field must still decode")
        }
    }

    func testUnknownEnumValuesDecodeRatherThanThrow() throws {
        var text = try XCTUnwrap(String(data: MockForecast.data(.smokeNowClearing), encoding: .utf8))
        text = text.replacingOccurrences(of: "\"trend\": \"falling\"", with: "\"trend\": \"plummeting\"")
        guard case .forecast(let forecast) = try ForecastDecoder.decode(Data(text.utf8)) else {
            return XCTFail("an unknown enum case must not fail the decode")
        }
        XCTAssertTrue(forecast.hours.contains { $0.trend == .unknown })
    }

    func testErrorEnvelope() throws {
        guard case .failure(let error) = try ForecastDecoder.decode(
            MockForecast.data(.errorUpstreamFailed)
        ) else {
            return XCTFail("expected the error envelope")
        }
        XCTAssertEqual(error.code, .upstreamFailed)
        XCTAssertFalse(error.message.isEmpty)
    }

    func testMeasuredRowsAreKeptApart() throws {
        let forecast = try XCTUnwrap(MockForecast.load(.sensorsDiverge))
        let official = try XCTUnwrap(forecast.measured.official)
        let local = try XCTUnwrap(forecast.measured.local)
        // The fixture exists to prove the divergent case survives decoding
        // with both rows intact — never merged, never averaged.
        XCTAssertNotEqual(official.ug, local.ug)
        XCTAssertGreaterThan(abs(official.ug - local.ug), 10)
        // observedAt is AirNow's zone-less wall clock and stays a String.
        XCTAssertEqual(official.observedAt, "2026-08-02T16:00")
    }

    func testObservedAtIsNeverParsedIntoAnInstant() throws {
        let forecast = try XCTUnwrap(MockForecast.load(.smokeNowClearing))
        let observedAt = try XCTUnwrap(forecast.measured.official?.observedAt)
        XCTAssertFalse(observedAt.hasSuffix("Z"), "it has no zone, and we must not invent one")
    }
}
