// The widget, drawn live from the reader's own forecast. Used by the widget
// install flow, where it is a stronger pitch than a screenshot because it is
// the reader's own air (platform plan §3).

import SwiftUI
import SmokeshowKit

/// Live widget mocks, driven by the real payload the app already has — the
/// same trick the web CTA uses, and a far stronger pitch than a screenshot
/// because it is the visitor's own air (platform plan §3).
struct WidgetShowcase: View {
    @EnvironmentObject private var model: AppModel

    /// Onboarding shows this before any real forecast exists, so it can hand in
    /// a mock payload and place. Both default to the live model.
    var forecastOverride: Forecast? = nil
    var placeOverride: Place? = nil

    private var entry: WidgetEntryModel {
        let forecast = forecastOverride ?? model.forecast
        let place = placeOverride ?? model.place
        guard let forecast, let place else {
            return TimelineBuilder.placeholder(place: placeOverride ?? .preview)
        }
        return TimelineBuilder.build(
            forecast: forecast,
            place: place,
            preferences: model.preferences
        ).entries.first ?? TimelineBuilder.placeholder(place: place)
    }

    var body: some View {
        HStack(spacing: 12) {
            SmokeshowWidgetView(entry: entry, layout: .systemSmall)
                .frame(width: 148, height: 148)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            VStack(spacing: 10) {
                SmokeshowWidgetView(entry: entry, layout: .systemMedium)
                    .frame(width: 148, height: 70)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                #if os(iOS)
                AccessoryRectangularView(entry: entry)
                    .frame(width: 148, height: 60)
                    .padding(8)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Color.white.opacity(0.12))
                    )
                #endif
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }
}
