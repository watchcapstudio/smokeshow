// The churn cliff, tested.
//
// Platform plan §4: "Day 12–14 is the churn cliff, and the widget is the
// surface it happens on. What it shows at that moment is a deliberate design
// decision — your best conversion prompt, or a blank tile that reads as
// broken. Decide it; don't let it fall out of the implementation."
//
// These tests are that decision, written down.

import XCTest
@testable import SmokeshowKit

final class EntitlementLapseTests: XCTestCase {

    private let place = Place(name: "Bend", latitude: 44.06, longitude: -121.31)
    private let now = Date(timeIntervalSince1970: 1_785_000_000)

    private func trial(daysLeft: Double) -> EntitlementSnapshot {
        EntitlementSnapshot(
            status: .trial(endsAt: now.addingTimeInterval(daysLeft * 86400)),
            checkedAt: now
        )
    }

    func testTrialDaysRemainingRoundsUp() {
        XCTAssertEqual(trial(daysLeft: 13.2).trialDaysRemaining(asOf: now), 14)
        XCTAssertEqual(trial(daysLeft: 1.1).trialDaysRemaining(asOf: now), 2)
        XCTAssertEqual(trial(daysLeft: -1).trialDaysRemaining(asOf: now), 0)
    }

    func testChurnWindowIsTheLastTwoDays() {
        XCTAssertFalse(trial(daysLeft: 5).isInChurnWindow(asOf: now))
        XCTAssertFalse(trial(daysLeft: 2.5).isInChurnWindow(asOf: now))
        XCTAssertTrue(trial(daysLeft: 1.9).isInChurnWindow(asOf: now))
        XCTAssertTrue(trial(daysLeft: 0.2).isInChurnWindow(asOf: now))
    }

    func testWidgetCarriesTheConversionLineInsideTheChurnWindow() throws {
        let forecast = try XCTUnwrap(MockForecast.load(.smokeNowClearing))
        let at = forecast.now.exactUTC

        let normal = TimelineBuilder.build(
            forecast: forecast, place: place, preferences: .default,
            entitlement: EntitlementSnapshot(status: .trial(endsAt: at.addingTimeInterval(9 * 86400))),
            now: at
        )
        XCTAssertEqual(normal.entries.first?.subtitle, forecast.verdict.headline)

        let cliff = TimelineBuilder.build(
            forecast: forecast, place: place, preferences: .default,
            entitlement: EntitlementSnapshot(status: .trial(endsAt: at.addingTimeInterval(1.5 * 86400))),
            now: at
        )
        let subtitle = try XCTUnwrap(cliff.entries.first?.subtitle)
        XCTAssertTrue(subtitle.contains("Trial ends"))
        // The forecast is still rendered — the tile is a prompt, not a lock.
        XCTAssertTrue(cliff.entries.first?.isForecast == true)
        XCTAssertNotNil(cliff.entries.first?.levelName)
    }

    func testLapsedWidgetKeepsThePlaceAndWithholdsTheForecast() throws {
        let timeline = TimelineBuilder.build(
            forecast: MockForecast.preview,
            place: place,
            preferences: .default,
            entitlement: EntitlementSnapshot(status: .lapsed(endedAt: now, hadTrial: true)),
            now: now
        )
        XCTAssertEqual(timeline.entries.count, 1)
        let entry = try XCTUnwrap(timeline.entries.first)
        XCTAssertEqual(entry.state, .lapsed)
        XCTAssertEqual(entry.placeName, "Bend")
        // No stale number, no zero, no blank tile.
        XCTAssertNil(entry.reading)
        XCTAssertNil(entry.levelName)
        XCTAssertNil(entry.headline)
        XCTAssertEqual(entry.subtitle, Copy.unavailable)
    }

    func testUnknownEntitlementStillRenders() {
        // A subscriber whose receipt check was slow must not watch their home
        // screen go blank.
        XCTAssertTrue(EntitlementSnapshot.unknown.widgetsMayRenderForecast)
        XCTAssertFalse(EntitlementSnapshot(status: .never).widgetsMayRenderForecast)
        XCTAssertFalse(
            EntitlementSnapshot(status: .lapsed(endedAt: nil, hadTrial: false))
                .widgetsMayRenderForecast
        )
    }

    func testNudgePolicyAsksOnceOnDayZeroAndAgainAtTheCliff() {
        let suite = "test.\(UUID().uuidString)"
        TrialInstrumentation.defaults = UserDefaults(suiteName: suite)!
        defer {
            UserDefaults().removePersistentDomain(forName: suite)
            TrialInstrumentation.defaults = AppGroup.defaults
        }
        TrialInstrumentation.reset()

        // Day 0, no widget: ask.
        XCTAssertEqual(
            TrialInstrumentation.evaluate(
                entitlement: trial(daysLeft: 14),
                installedWidgetCount: 0,
                now: now
            ),
            .installWidget
        )
        TrialInstrumentation.record(.widgetPromptShown, at: now)

        // Asked already, still no widget, still early: do not nag.
        XCTAssertNil(
            TrialInstrumentation.evaluate(
                entitlement: trial(daysLeft: 8),
                installedWidgetCount: 0,
                now: now
            )
        )

        // Day 12–14 with a widget installed: the ask is for the money.
        XCTAssertEqual(
            TrialInstrumentation.evaluate(
                entitlement: trial(daysLeft: 1.5),
                installedWidgetCount: 2,
                now: now
            ),
            .subscribe
        )

        // Lapsed: always the paywall.
        XCTAssertEqual(
            TrialInstrumentation.evaluate(
                entitlement: EntitlementSnapshot(status: .lapsed(endedAt: now, hadTrial: true)),
                installedWidgetCount: 1,
                now: now
            ),
            .subscribe
        )

        // Subscribed: never nudged about anything.
        XCTAssertNil(
            TrialInstrumentation.evaluate(
                entitlement: EntitlementSnapshot(status: .subscribed(renewsAt: nil)),
                installedWidgetCount: 0,
                now: now
            )
        )
    }
}
