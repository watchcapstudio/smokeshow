// The watch app exists to give the complications somewhere to tap through to.
//
// Scoping note (platform plan §3): complications were called "nearly free once
// the accessory* SwiftUI views exist", and that is what this proves — the
// watch renders the same `AccessoryRectangularView` and
// `AccessoryCircularPMView` the phone's lock screen does, from the same
// timeline builder. What is *not* free is listed in
// apple/docs/watch-and-live-activity.md: the watch fetches independently when
// the phone is out of range, and its own reload budget is tighter.

import SwiftUI
import SmokeshowKit

@main
struct SmokeshowWatchApp: App {
    var body: some Scene {
        WindowGroup {
            WatchVerdictView()
        }
    }
}

struct WatchVerdictView: View {
    @State private var forecast: Forecast?
    @State private var place: Place = PlaceStore.shared.selected ?? .preview
    @State private var error: ForecastUnavailable?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Text(place.shortName.uppercased())
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .opacity(0.55)

                Text(forecast?.nowScaleEntry?.name ?? Copy.unavailable)
                    .font(.system(size: 20, weight: .bold))
                    .minimumScaleFactor(0.6)

                // The server's sentence, verbatim, on every surface.
                Text(forecast?.verdict.headline ?? error?.userFacingMessage ?? "")
                    .font(.system(size: 13, weight: .semibold))
                    .opacity(0.75)

                if let hour = forecast?.nowHour {
                    Text(hour.pm25.map { Copy.reading("\(Int($0.rounded())) µg/m³") }
                        ?? Copy.reading(Copy.noData))
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .opacity(0.55)
                }

                if let generatedAt = forecast?.generatedAt, forecast?.isStale() == true {
                    Text(Copy.asOf(generatedAt))
                        .font(.system(size: 9, design: .monospaced))
                        .opacity(0.5)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task { await load() }
    }

    private func load() async {
        let request = ForecastRequest(place: place, source: PreferencesStore.shared.current.source)
        let result = await ForecastRepository.shared.load(request)
        forecast = result.forecast
        error = result.error
    }
}
