// Smokeshow is free. These tests pin the parts of that which a later change
// could quietly undo: the widget always renders the forecast, nothing routes a
// reader to a purchase, and supporter state switches icons and nothing else.

import XCTest
@testable import SmokeshowKit

final class FreeAppTests: XCTestCase {

    private let place = Place(name: "Bend", latitude: 44.06, longitude: -121.31)

    private func isolatedDefaults() -> (UserDefaults, String) {
        let suite = "test.\(UUID().uuidString)"
        return (UserDefaults(suiteName: suite)!, suite)
    }

    // MARK: Widgets

    func testWidgetAlwaysCarriesTheForecastAndItsOwnHeadline() throws {
        let forecast = try XCTUnwrap(MockForecast.load(.smokeNowClearing))
        let timeline = TimelineBuilder.build(
            forecast: forecast, place: place, preferences: .default, now: forecast.now.exactUTC
        )
        let entry = try XCTUnwrap(timeline.entries.first)
        XCTAssertTrue(entry.isForecast)
        XCTAssertNotNil(entry.levelName)
        // No trial line, no conversion prompt: the subtitle is the verdict.
        XCTAssertEqual(entry.subtitle, forecast.verdict.headline)
    }

    func testWidgetTapGoesToTheVerdictNeverToAPurchase() throws {
        let url = try XCTUnwrap(DeepLink.widgetTap(place: "Bend"))
        XCTAssertEqual(DeepLink.destination(for: url), .verdict(place: "Bend"))
    }

    func testOldSubscribeLinksLandOnSupport() throws {
        // Lapsed-trial widgets from the paid builds carry smokeshow://subscribe
        // until their timeline reloads.
        let old = try XCTUnwrap(URL(string: "smokeshow://subscribe"))
        XCTAssertEqual(DeepLink.destination(for: old), .support)
        let current = try XCTUnwrap(DeepLink.url(.support))
        XCTAssertEqual(DeepLink.destination(for: current), .support)
    }

    // MARK: Widget nudge

    func testWidgetNudgeAsksOnceAndNeverNagsSomeoneWithAWidget() {
        let (defaults, suite) = isolatedDefaults()
        WidgetNudge.defaults = defaults
        defer {
            UserDefaults().removePersistentDomain(forName: suite)
            WidgetNudge.defaults = AppGroup.defaults
        }
        WidgetNudge.reset()

        XCTAssertTrue(WidgetNudge.shouldAsk(installedWidgetCount: 0))
        WidgetNudge.record(.widgetPromptShown)
        XCTAssertFalse(WidgetNudge.shouldAsk(installedWidgetCount: 0))

        WidgetNudge.reset()
        XCTAssertFalse(WidgetNudge.shouldAsk(installedWidgetCount: 1))
        XCTAssertTrue(WidgetNudge.hasInstalledWidget)
    }

    func testWidgetNudgeKeepsThePaidBuildsKeys() {
        // A reader already asked in a paid build must not be asked again.
        let (defaults, suite) = isolatedDefaults()
        WidgetNudge.defaults = defaults
        defer {
            UserDefaults().removePersistentDomain(forName: suite)
            WidgetNudge.defaults = AppGroup.defaults
        }
        defaults.set(1, forKey: "trial.count.widgetPromptShown")
        XCTAssertFalse(WidgetNudge.shouldAsk(installedWidgetCount: 0))
    }

    // MARK: Supporters

    func testOnlyTipsAndTheSubscriptionMakeASupporter() {
        XCTAssertFalse(SupporterStatus.unknown.isSupporter)
        XCTAssertFalse(SupporterStatus.notSupporting.isSupporter)
        XCTAssertTrue(SupporterStatus.tipped.isSupporter)
        XCTAssertTrue(SupporterStatus.subscribed(renewsAt: nil).isSupporter)
    }

    func testStubPurchasesUnlockSupport() async throws {
        let (defaults, suite) = isolatedDefaults()
        defer { UserDefaults().removePersistentDomain(forName: suite) }
        let provider = StubSupportProvider(cache: SupporterCache(defaults: defaults))

        let products = await provider.products()
        XCTAssertEqual(products.map(\.id), StoreConfiguration.tipProductIDs + [StoreConfiguration.monthlyProductID])

        let tip = try XCTUnwrap(products.first { $0.kind == .tip })
        _ = try await provider.purchase(tip)
        XCTAssertEqual(provider.snapshot.status, .tipped)

        let monthly = try XCTUnwrap(products.first { $0.kind == .monthly })
        _ = try await provider.purchase(monthly)
        XCTAssertTrue(provider.snapshot.status.isSubscribed)

        // A tip on top of a subscription does not downgrade it.
        _ = try await provider.purchase(tip)
        XCTAssertTrue(provider.snapshot.status.isSubscribed)
    }

    func testFreeNoticeIsForSubscribersAndShowsOnce() {
        let (defaults, suite) = isolatedDefaults()
        defer { UserDefaults().removePersistentDomain(forName: suite) }
        let cache = SupporterCache(defaults: defaults)

        XCTAssertFalse(cache.shouldShowFreeNotice(for: .notSupporting))
        XCTAssertFalse(cache.shouldShowFreeNotice(for: .tipped))
        XCTAssertTrue(cache.shouldShowFreeNotice(for: .subscribed(renewsAt: nil)))
        cache.hasShownFreeNotice = true
        XCTAssertFalse(cache.shouldShowFreeNotice(for: .subscribed(renewsAt: nil)))
    }

    func testIconsRoundTripAndOnlyTheStandardOneIsFree() {
        for icon in SupporterIcon.allCases {
            XCTAssertEqual(SupporterIcon(assetName: icon.assetName), icon)
        }
        XCTAssertNil(SupporterIcon.standard.assetName)
        XCTAssertEqual(SupporterIcon.allCases.filter { !$0.requiresSupport }, [.standard])
        XCTAssertEqual(SupporterIcon(assetName: "AppIcon-Unknown"), .standard)
        // scripts/gen_alt_icons.py writes these names.
        XCTAssertEqual(SupporterIcon.standard.previewAssetName, "IconPreview-Standard")
        XCTAssertEqual(SupporterIcon.smokeshow.previewAssetName, "IconPreview-Smokeshow")
    }
}
