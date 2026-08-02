// The reload budget, asserted rather than hoped for.
//
// The claim in TimelineBuilder.swift is that one network call feeds ~12 hours
// of entries and that a widget asks for 8–16 reloads a day against a budget of
// 40–70. These tests are what keep that claim true when someone later "just
// bumps the refresh a bit".

import XCTest
@testable import SmokeshowKit

final class TimelineBuilderTests: XCTestCase {

    private let place = Place(name: "Minneapolis", latitude: 44.9778, longitude: -93.2650)

    /// The fixtures are frozen; every test builds from the payload's own `now`.
    private func loadFixture(_ fixture: MockForecast.Case) throws -> (Forecast, Date) {
        let forecast = try XCTUnwrap(MockForecast.load(fixture))
        return (forecast, forecast.now.exactUTC)
    }

    private func subscribed() -> EntitlementSnapshot {
        EntitlementSnapshot(status: .subscribed(renewsAt: nil))
    }

    func testOneFetchProducesManyEntries() throws {
        let (forecast, now) = try loadFixture(.smokeNowClearing)
        let timeline = TimelineBuilder.build(
            forecast: forecast,
            place: place,
            preferences: .default,
            entitlement: subscribed(),
            now: now
        )

        // 12 hours at 30-minute spacing, inclusive of both ends.
        XCTAssertEqual(timeline.entries.count, 25)
        XCTAssertEqual(timeline.entries.first?.date, now)
        for (earlier, later) in zip(timeline.entries, timeline.entries.dropFirst()) {
            XCTAssertEqual(
                later.date.timeIntervalSince(earlier.date),
                TimelineBuilder.entryInterval,
                accuracy: 1
            )
        }
    }

    func testRefreshCadenceStaysInsideTheBudget() throws {
        let (active, activeNow) = try loadFixture(.smokeNowClearing)
        let activeTimeline = TimelineBuilder.build(
            forecast: active, place: place, preferences: .default,
            entitlement: subscribed(), now: activeNow
        )
        let activeGap = activeTimeline.refreshAt.timeIntervalSince(activeNow)
        XCTAssertEqual(activeGap, TimelineBuilder.activeRefresh, accuracy: 60)
        XCTAssertLessThanOrEqual(86400 / activeGap, 20, "more than 20 reloads/day eats the budget")

        let (calm, calmNow) = try loadFixture(.clearStayingClear)
        let calmTimeline = TimelineBuilder.build(
            forecast: calm, place: place, preferences: .default,
            entitlement: subscribed(), now: calmNow
        )
        let calmGap = calmTimeline.refreshAt.timeIntervalSince(calmNow)
        XCTAssertEqual(calmGap, TimelineBuilder.calmRefresh, accuracy: 60)
    }

    func testEntriesAdvanceThroughTheSeriesWithoutRefetching() throws {
        let (forecast, now) = try loadFixture(.smokeNowClearing)
        let timeline = TimelineBuilder.build(
            forecast: forecast, place: place, preferences: .default,
            entitlement: subscribed(), now: now
        )
        // A clearing event must show *different* readings across the day —
        // that is the whole point of building many entries from one payload.
        let readings = timeline.entries.compactMap(\.reading)
        XCTAssertGreaterThan(Set(readings.map { Int($0.rounded()) }).count, 3)

        // …and the countdown must shrink as the entries advance.
        let countdowns = timeline.entries.compactMap(\.hoursToChange)
        XCTAssertTrue(zip(countdowns, countdowns.dropFirst()).allSatisfy { $0 >= $1 })
    }

    func testHeadlineIsIdenticalOnEveryEntry() throws {
        let (forecast, now) = try loadFixture(.smokeNowClearing)
        let timeline = TimelineBuilder.build(
            forecast: forecast, place: place, preferences: .default,
            entitlement: subscribed(), now: now
        )
        // The verdict is the server's, computed once. Entries render the hour
        // they sit on, but the sentence never mutates.
        XCTAssertEqual(Set(timeline.entries.compactMap(\.headline)).count, 1)
        XCTAssertEqual(timeline.entries.first?.headline, forecast.verdict.headline)
    }

    func testGapsRenderAsUnknownNeverZero() throws {
        let (forecast, now) = try loadFixture(.modelGaps)
        let timeline = TimelineBuilder.build(
            forecast: forecast, place: place, preferences: .default,
            entitlement: subscribed(), now: now
        )
        let gapEntries = timeline.entries.filter { $0.reading == nil }
        XCTAssertFalse(gapEntries.isEmpty, "the gap must reach the entries")
        for entry in gapEntries {
            XCTAssertEqual(entry.compactReading, Copy.noData)
            XCTAssertNil(entry.readingFraction)
            XCTAssertTrue(entry.readingLine.contains(Copy.modelEstimate))
            XCTAssertFalse(entry.readingLine.contains("0 µg"))
        }
    }

    func testCurveCarriesGapsThrough() throws {
        let (forecast, now) = try loadFixture(.modelGaps)
        let timeline = TimelineBuilder.build(
            forecast: forecast, place: place, preferences: .default,
            entitlement: subscribed(), now: now
        )
        let curve = try XCTUnwrap(timeline.entries.first?.curve)
        XCTAssertTrue(curve.contains { $0.value == nil })
        XCTAssertFalse(curve.contains { $0.value == 0 })
    }

    func testShortWindowDoesNotOverrunTheSeries() throws {
        let (forecast, now) = try loadFixture(.shortWindow)
        let timeline = TimelineBuilder.build(
            forecast: forecast, place: place, preferences: .default,
            entitlement: subscribed(), now: now
        )
        let lastHour = try XCTUnwrap(forecast.hours.last?.t)
        for entry in timeline.entries {
            XCTAssertLessThanOrEqual(entry.date, lastHour.addingTimeInterval(1800))
        }
    }

    func testExhaustedPayloadDoesNotPretendToBeCurrent() throws {
        let (forecast, _) = try loadFixture(.smokeNowClearing)
        // A year later, every hour in the payload is behind us.
        let later = try XCTUnwrap(forecast.hours.last?.t).addingTimeInterval(365 * 86400)
        let timeline = TimelineBuilder.build(
            forecast: forecast, place: place, preferences: .default,
            entitlement: subscribed(), now: later
        )
        XCTAssertEqual(timeline.entries.count, 1)
        guard case .unavailable = timeline.entries[0].state else {
            return XCTFail("an exhausted payload must render the unavailable state")
        }
    }

    func testStalePayloadRefreshesSoonerThanTheNormalCadence() throws {
        let (forecast, _) = try loadFixture(.smokeNowClearing)
        let late = forecast.generatedAt.addingTimeInterval(Forecast.staleAfter + 600)
        let timeline = TimelineBuilder.build(
            forecast: forecast, place: place, preferences: .default,
            entitlement: subscribed(), now: late
        )
        XCTAssertLessThanOrEqual(
            timeline.refreshAt.timeIntervalSince(late),
            TimelineBuilder.minErrorRefresh + 1
        )
        XCTAssertTrue(timeline.entries.allSatisfy(\.isStale))
    }

    func testAqiPreferenceChangesTheNumberNotTheVerdict() throws {
        let (forecast, now) = try loadFixture(.smokeNowClearing)
        var preferences = Preferences.default
        preferences.unit = .aqi
        let timeline = TimelineBuilder.build(
            forecast: forecast, place: place, preferences: preferences,
            entitlement: subscribed(), now: now
        )
        let entry = try XCTUnwrap(timeline.entries.first)
        XCTAssertEqual(entry.reading.map { Int($0) }, forecast.nowHour?.aqi)
        XCTAssertTrue(entry.readingLine.hasPrefix("AQI "))
        XCTAssertEqual(entry.headline, forecast.verdict.headline)
    }
}
