// Watch complications — the same accessory views the iOS lock screen uses.
//
// Families: accessoryCircular (the reading), accessoryCorner, accessoryInline,
// and accessoryRectangular. The provider is a straight reuse of the phone's,
// with one difference that matters: the watch's reload budget is *tighter*
// than the phone's, so the calm cadence is what it gets by default and a
// paired-phone refresh is preferred over the watch fetching for itself.

import WidgetKit
import SwiftUI
import SmokeshowKit

@main
struct SmokeshowWatchWidgetBundle: WidgetBundle {
    var body: some Widget {
        SmokeshowComplication()
    }
}

struct WatchForecastEntry: TimelineEntry {
    let date: Date
    let model: WidgetEntryModel
}

struct WatchForecastProvider: TimelineProvider {

    func placeholder(in context: Context) -> WatchForecastEntry {
        let model = TimelineBuilder.placeholder(place: PlaceStore.shared.selected ?? .preview)
        return WatchForecastEntry(date: model.date, model: model)
    }

    func getSnapshot(in context: Context, completion: @escaping (WatchForecastEntry) -> Void) {
        Task {
            let place = PlaceStore.shared.selected ?? .preview
            let request = ForecastRequest(place: place, source: PreferencesStore.shared.current.source)
            let cached = await ForecastRepository.shared.cachedOnly(request)
            guard let forecast = cached.forecast,
                  let first = TimelineBuilder.build(forecast: forecast, place: place).entries.first
            else {
                completion(placeholder(in: context))
                return
            }
            completion(WatchForecastEntry(date: first.date, model: first))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchForecastEntry>) -> Void) {
        Task {
            let place = PlaceStore.shared.selected ?? .preview
            let preferences = PreferencesStore.shared.current
            let entitlement = EntitlementCache.shared.snapshot

            guard entitlement.widgetsMayRenderForecast else {
                completion(timeline(from: TimelineBuilder.lapsedTimeline(place: place)))
                return
            }

            let request = ForecastRequest(place: place, source: preferences.source)
            let result = await ForecastRepository(
                client: ForecastClient(timeout: ForecastClient.widgetTimeout)
            ).load(request)

            guard let forecast = result.forecast else {
                completion(timeline(from: TimelineBuilder.unavailableTimeline(
                    place: place,
                    reason: result.error?.userFacingMessage ?? Copy.unavailableDetail
                )))
                return
            }

            completion(timeline(from: TimelineBuilder.build(
                forecast: forecast,
                place: place,
                preferences: preferences,
                entitlement: entitlement
            )))
        }
    }

    private func timeline(from built: WidgetTimeline) -> Timeline<WatchForecastEntry> {
        Timeline(
            entries: built.entries.map { WatchForecastEntry(date: $0.date, model: $0) },
            policy: .after(built.refreshAt)
        )
    }
}

struct SmokeshowComplication: Widget {
    let kind = "SmokeshowComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WatchForecastProvider()) { entry in
            // The entry view reads the family from the environment, so one
            // configuration serves all four watch families.
            WatchComplicationEntryView(entry: entry)
                .containerBackground(for: .widget) { Color.clear }
        }
        .configurationDisplayName("Smokeshow")
        .description("The air, and when it clears. Model estimate.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryCorner,
            .accessoryInline,
            .accessoryRectangular,
        ])
    }

}

/// Reads the family from the environment so one entry view serves all four
/// watch families.
struct WatchComplicationEntryView: View {
    let entry: WatchForecastEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        SmokeshowWidgetView(entry: entry.model, layout: layout)
    }

    private var layout: WidgetLayout {
        switch family {
        case .accessoryCircular: return .accessoryCircularPM
        case .accessoryCorner: return .accessoryCorner
        case .accessoryInline: return .accessoryInline
        case .accessoryRectangular: return .accessoryRectangular
        default: return .accessoryInline
        }
    }
}
