// The provider. One network call per refresh, many entries per call.
//
// Read TimelineBuilder.swift for the budget arithmetic this implements. The
// short version: WidgetKit allows roughly 40–70 reloads per widget per day,
// this asks for 8–16, and every reload fetches a whole timeline rather than a
// point. Nothing here polls, and nothing here computes a verdict.

import WidgetKit
import SwiftUI
import SmokeshowKit

struct ForecastEntry: TimelineEntry {
    let date: Date
    let model: WidgetEntryModel
}

struct ForecastTimelineProvider: AppIntentTimelineProvider {

    /// Consecutive failures, so the retry backs off instead of burning the
    /// day's reloads against a backend that is down.
    private static let failureCountKey = "widget.failureCount.v1"

    func placeholder(in context: Context) -> ForecastEntry {
        let model = TimelineBuilder.placeholder(place: PlaceStore.shared.selected ?? .preview)
        return ForecastEntry(date: model.date, model: model)
    }

    /// The gallery snapshot. It must render instantly and must never show a
    /// number as current that we have not verified — so it uses the cache if
    /// there is one and the placeholder if there is not.
    func snapshot(for configuration: SelectPlaceIntent, in context: Context) async -> ForecastEntry {
        let place = configuration.resolvedPlace
        let request = ForecastRequest(place: place, source: PreferencesStore.shared.current.source)
        let cached = await ForecastRepository.shared.cachedOnly(request)

        guard let forecast = cached.forecast else { return placeholder(in: context) }
        let timeline = TimelineBuilder.build(forecast: forecast, place: place)
        guard let first = timeline.entries.first else { return placeholder(in: context) }
        return ForecastEntry(date: first.date, model: first)
    }

    func timeline(for configuration: SelectPlaceIntent, in context: Context) async -> Timeline<ForecastEntry> {
        let place = configuration.resolvedPlace
        let preferences = PreferencesStore.shared.current
        let entitlement = EntitlementCache.shared.snapshot

        // A lapsed subscriber gets the designed lapse tile and a cheap refresh
        // cadence. No fetch: we are not going to render the forecast anyway,
        // and the network call would be pure cost (platform plan §4).
        guard entitlement.widgetsMayRenderForecast else {
            return timeline(from: TimelineBuilder.lapsedTimeline(place: place))
        }

        let request = ForecastRequest(place: place, source: preferences.source)
        let repository = ForecastRepository(
            client: ForecastClient(timeout: ForecastClient.widgetTimeout)
        )
        let result = await repository.load(request)

        guard let forecast = result.forecast else {
            let attempt = bumpFailureCount()
            return timeline(from: TimelineBuilder.unavailableTimeline(
                place: place,
                reason: result.error?.userFacingMessage ?? Copy.unavailableDetail,
                attempt: attempt
            ))
        }

        resetFailureCount()
        return timeline(from: TimelineBuilder.build(
            forecast: forecast,
            place: place,
            preferences: preferences,
            entitlement: entitlement
        ))
    }

    private func timeline(from built: WidgetTimeline) -> Timeline<ForecastEntry> {
        Timeline(
            entries: built.entries.map { ForecastEntry(date: $0.date, model: $0) },
            policy: .after(built.refreshAt)
        )
    }

    // MARK: Failure backoff

    private func bumpFailureCount() -> Int {
        let defaults = AppGroup.defaults
        let next = defaults.integer(forKey: Self.failureCountKey) + 1
        defaults.set(next, forKey: Self.failureCountKey)
        return next - 1
    }

    private func resetFailureCount() {
        AppGroup.defaults.set(0, forKey: Self.failureCountKey)
    }
}
