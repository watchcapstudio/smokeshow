// The widget bundle: every family the product ships, on both platforms.
//
//   Smokeshow            systemSmall · systemMedium · systemLarge · systemExtraLarge
//   Smokeshow Air        accessoryCircular (the PM arc)          iOS only
//   Smokeshow Countdown  accessoryCircular (hours to change)     iOS only
//   Smokeshow Line       accessoryInline · accessoryRectangular  iOS only
//   Live Activity        Dynamic Island + lock screen            iOS only
//
// The two circular accessories are separate widget kinds on purpose: the demo
// designs both (`.acc-circ` ×2) and iOS only lets a user place one circular
// widget per kind per slot. Splitting them is what makes it possible to have
// the reading *and* the countdown on the lock screen at once.
//
// macOS gets the system families only — it has no lock screen.

import WidgetKit
import SwiftUI
import SmokeshowKit

@main
struct SmokeshowWidgetBundle: WidgetBundle {
    var body: some Widget {
        SmokeshowSystemWidget()
        #if os(iOS)
        SmokeshowAirAccessoryWidget()
        SmokeshowCountdownAccessoryWidget()
        SmokeshowLineAccessoryWidget()
        SmokeLiveActivityWidget()
        #endif
    }
}

// MARK: - Home screen / desktop

struct SmokeshowSystemWidget: Widget {
    let kind = "SmokeshowSystemWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: SelectPlaceIntent.self,
            provider: ForecastTimelineProvider()
        ) { entry in
            SmokeshowWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Smokeshow")
        .description("How bad the air is, and when it clears. Model estimate.")
        .supportedFamilies(systemFamilies)
        // The sky *is* the widget; it must reach the edges.
        .contentMarginsDisabled()
    }

    /// systemExtraLarge exists on iPad and Mac only; WidgetKit ignores a
    /// family the platform does not offer, so one list serves both.
    private var systemFamilies: [WidgetFamily] {
        [.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge]
    }
}

// MARK: - Lock screen (iOS only)

#if os(iOS)
struct SmokeshowAirAccessoryWidget: Widget {
    let kind = "SmokeshowAirAccessory"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: SelectPlaceIntent.self,
            provider: ForecastTimelineProvider()
        ) { entry in
            SmokeshowWidgetEntryView(entry: entry, circularVariant: .pm)
        }
        .configurationDisplayName("Air now")
        .description("The current reading. Model estimate.")
        .supportedFamilies([.accessoryCircular])
    }
}

struct SmokeshowCountdownAccessoryWidget: Widget {
    let kind = "SmokeshowCountdownAccessory"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: SelectPlaceIntent.self,
            provider: ForecastTimelineProvider()
        ) { entry in
            SmokeshowWidgetEntryView(entry: entry, circularVariant: .countdown)
        }
        .configurationDisplayName("Clears in")
        .description("Hours until the smoke clears, or until it arrives.")
        .supportedFamilies([.accessoryCircular])
    }
}

struct SmokeshowLineAccessoryWidget: Widget {
    let kind = "SmokeshowLineAccessory"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: SelectPlaceIntent.self,
            provider: ForecastTimelineProvider()
        ) { entry in
            SmokeshowWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Smokeshow")
        .description("The verdict, on your lock screen.")
        .supportedFamilies([.accessoryInline, .accessoryRectangular])
    }
}
#endif

// MARK: - Entry view

struct SmokeshowWidgetEntryView: View {
    enum CircularVariant { case pm, countdown }

    var entry: ForecastEntry
    var circularVariant: CircularVariant = .pm

    @Environment(\.widgetFamily) private var family

    var body: some View {
        SmokeshowWidgetView(entry: entry.model, layout: layout)
            // The sky is painted inside the view itself (WidgetSurface), so the
            // container background stays clear rather than drawing it twice.
            // iOS 17 still requires the modifier to be present.
            .containerBackground(for: .widget) { Color.clear }
            .widgetURL(DeepLink.widgetTap(place: entry.model.placeName, lapsed: !entry.model.isForecast))
    }

    private var layout: WidgetLayout {
        switch family {
        case .systemSmall: return .systemSmall
        case .systemMedium: return .systemMedium
        case .systemLarge: return .systemLarge
        case .systemExtraLarge: return .systemExtraLarge
        #if os(iOS)
        case .accessoryInline: return .accessoryInline
        case .accessoryRectangular: return .accessoryRectangular
        case .accessoryCircular:
            return circularVariant == .pm ? .accessoryCircularPM : .accessoryCircularCountdown
        #endif
        default: return .systemSmall
        }
    }
}
