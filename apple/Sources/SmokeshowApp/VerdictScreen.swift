// The app's one screen: how bad is the air here, and when does it clear.
//
// Reading order matches the web, deliberately — a user who has both must not
// have to re-learn the product: place, level word, headline, reading, trend,
// curve, five days, what the instruments say, and the explainer.
//
// Every string on it is server-rendered. There is no `if pm25 > 35` in this
// file, and there must never be one.

import SwiftUI
import SmokeshowKit

struct VerdictScreen: View {
    @EnvironmentObject private var model: AppModel
    @Binding var showsExplain: Bool
    @Binding var showsSettings: Bool
    @State private var showsPlaces = false

    private var forecast: Forecast? { model.forecast }
    private var nowHour: Forecast.Hour? { forecast?.nowHour }
    private var sky: Forecast.Sky? { nowHour?.sky }

    var body: some View {
        ZStack {
            // The screen is a window. Sky behind, land in front, and the
            // verdict sitting on the horizon between them — the demo rig's
            // whole idea, and the reason the app is not a list of readings.
            SkyBackdrop(sky: sky)
                .ignoresSafeArea()

            VStack {
                Spacer(minLength: 0)
                RidgeView(pm25: nowHour?.pm25, strength: 0.55)
                    .frame(height: 260)
            }
            .ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                header

                // Everything above the word is empty sky. That space is the
                // product doing its job: on a clear day you see a lot of it.
                Spacer(minLength: 12)

                verdictBlock

                Spacer(minLength: 12)

                if let forecast {
                    TimelineBlock(forecast: forecast, unit: model.preferences.unit)
                        .padding(.bottom, 10)
                    FiveDayBlock(forecast: forecast)
                }

                if let error = model.loadError {
                    UnavailableBanner(error: error, generatedAt: forecast?.generatedAt)
                        .padding(.top, 12)
                }

                // Without a place there is no product, so the first screen
                // has to carry the way out of that state itself — the
                // eyebrow in the corner is too quiet to be the only one.
                if model.place == nil {
                    Button { showsPlaces = true } label: {
                        Text("Choose a place")
                            .font(Typography.md)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 12)
                            .frame(maxWidth: .infinity)
                            .background(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(.white.opacity(0.14))
                            )
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 12)
                }
            }
            .padding(20)
        }
        .foregroundStyle(sky?.ink ?? Palette.dark.text)
        .sheet(isPresented: $showsPlaces) {
            PlacePickerView()
                .environmentObject(model)
        }
    }

    private var header: some View {
        HStack {
            Button {
                showsPlaces = true
            } label: {
                HStack(spacing: 5) {
                    Text((model.place?.shortName ?? "Choose a place").uppercased())
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                }
                .font(Typography.eyebrow)
                .opacity(0.6)
            }
            .buttonStyle(.plain)

            Spacer()

            // The demo's "NOW" — the clock that says which moment the screen
            // is describing. It matters more once the curve can be scrubbed
            // away from the present.
            Text(clockLabel)
                .font(Typography.eyebrow)
                .opacity(0.45)

            Button { showsSettings = true } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 15, weight: .semibold))
                    .opacity(0.6)
            }
            .buttonStyle(.plain)
            .padding(.leading, 12)
        }
    }

    private var clockLabel: String {
        guard let forecast else { return "NOW" }
        let formatter = DateFormatter()
        formatter.timeZone = forecast.location.timeZone
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: forecast.now.exactUTC).uppercased()
    }

    private var verdictBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(forecast?.nowScaleEntry?.name ?? Copy.unavailable)
                .font(Typography.display)
                .minimumScaleFactor(0.6)
                .lineLimit(2)

            if let hour = nowHour, let trend = hour.trend {
                TrendChip(trend: trend)
                    .padding(.bottom, 2)
            }

            // The one sentence guaranteed identical on the phone and the
            // laptop. Rendered verbatim, never re-derived — and given the
            // accent, because "when does it clear" is the whole question.
            Text(forecast?.verdict.headline ?? "")
                .font(Typography.md)
                .foregroundStyle(Palette.dark.accent)

            Text(forecast?.nowScaleEntry?.notice ?? "")
                .font(Typography.base)
                .opacity(0.78)

            Text(readingLine)
                .font(Typography.eyebrow)
                .opacity(0.55)

            explainButton
                .padding(.top, 6)

            if model.isStale, let generatedAt = forecast?.generatedAt {
                Text(Copy.asOf(generatedAt))
                    .font(Typography.eyebrow)
                    .opacity(0.5)
            }
        }
    }

    private var readingLine: String {
        guard let hour = nowHour else { return Copy.reading(Copy.noData) }
        switch model.preferences.unit {
        case .microgramsPerCubicMetre:
            guard let pm = hour.pm25 else { return Copy.reading(Copy.noData) }
            return Copy.reading("\(Int(pm.rounded())) µg/m³ PM2.5")
        case .aqi:
            guard let aqi = hour.aqi else { return Copy.reading(Copy.noData) }
            return Copy.reading("AQI \(aqi) (approx)")
        }
    }

    /// A text link, not a pill. On a screen that is meant to read as a window,
    /// a bordered control is the one thing that looks pasted on — and this is
    /// also where the instrument rows and the disclaimer now live.
    private var explainButton: some View {
        Button { showsExplain = true } label: {
            Text("What this means ›")
                .font(Typography.sm)
                .opacity(0.75)
        }
        .buttonStyle(.plain)
    }
}

/// `hours[].trend` is already verdict-guarded server-side: it is muted to
/// "steady" wherever it would contradict the headline, so the chip can never
/// read "Improving" next to "No clear air in the 5-day window" (contract §4).
struct TrendChip: View {
    let trend: Forecast.HourTrend

    private var label: String {
        switch trend {
        case .rising: return "Getting worse"
        case .falling: return "Improving"
        case .steady: return "Holding steady"
        case .unknown: return "Holding steady"
        }
    }

    private var color: Color {
        switch trend {
        case .rising: return Color(Tokens.Color.Dark.tastes)
        case .falling: return Color(Tokens.Color.Dark.allClear)
        case .steady, .unknown: return Color(Tokens.Color.Dark.textDim)
        }
    }

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(label).font(Typography.sm)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Capsule().fill(Color.black.opacity(0.14)))
    }
}

struct TimelineBlock: View {
    let forecast: Forecast
    let unit: MeasurementUnit

    /// Nil means "showing now". Any value means the reader has dragged, and
    /// the eyebrow becomes a readout for the hour under their thumb.
    @State private var scrubbed: Int?

    private var points: [CurvePoint] {
        TimelineBuilder.curve(around: forecast.now.index, in: forecast)
    }

    private var nowIndex: Int {
        min(forecast.now.index, TimelineBuilder.curveLookback)
    }

    private var ink: Color {
        forecast.nowHour?.sky?.ink ?? Palette.dark.text
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                if let scrubbed, points.indices.contains(scrubbed) {
                    Text(readout(for: points[scrubbed]))
                        .font(Typography.eyebrow)
                        .opacity(0.8)
                    Spacer()
                    Button("Now") { self.scrubbed = nil }
                        .font(Typography.eyebrow)
                        .buttonStyle(.plain)
                        .opacity(0.6)
                } else {
                    Text("−12h · +48h").font(Typography.eyebrow).opacity(0.5)
                    Spacer()
                    // Past hours are model reanalysis. Never "observed".
                    Text(Copy.pastHours).font(Typography.eyebrow).opacity(0.5)
                }
            }
            CurveView(
                points: points,
                nowIndex: nowIndex,
                ink: ink,
                selection: $scrubbed
            )
            .frame(height: 74)
        }
        .animation(.none, value: scrubbed)
    }

    /// "Sat 9 PM · 24 µg/m³". A null hour prints the dash the contract
    /// requires — scrubbing onto a gap must not invent a number.
    private func readout(for point: CurvePoint) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = forecast.location.timeZone
        formatter.dateFormat = "EEE h a"
        let stamp = formatter.string(from: point.t)

        guard let value = point.value else {
            return "\(stamp) · \(Copy.noData)"
        }
        switch unit {
        case .microgramsPerCubicMetre:
            return "\(stamp) · \(Int(value.rounded())) µg/m³"
        case .aqi:
            let hour = forecast.hours.first { $0.t == point.t }
            guard let aqi = hour?.aqi else { return "\(stamp) · \(Copy.noData)" }
            return "\(stamp) · AQI \(aqi) (approx)"
        }
    }
}

struct FiveDayBlock: View {
    let forecast: Forecast

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                ForEach(forecast.days) { day in
                    VStack(spacing: 5) {
                        Text(day.weekday.uppercased())
                            .font(.system(size: 9, weight: .semibold, design: .monospaced))
                            .opacity(0.7)
                        Text(forecast.scaleEntry(at: day.levelIndex)?.name ?? Copy.noData)
                            .font(.system(size: 9.5, weight: .medium))
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                            .minimumScaleFactor(0.7)
                            .opacity(0.85)
                        HStack(spacing: 2) {
                            ForEach(day.dayParts) { part in
                                RoundedRectangle(cornerRadius: 1.5)
                                    .fill(part.bucket.flatMap { Color(serverHex: $0.color) }
                                        ?? Color.white.opacity(0.12))
                                    .frame(height: 5)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
            }

            if !forecast.pastDays.isEmpty {
                Text("Before today: \(forecast.pastDays.map(\.weekday).joined(separator: " · ")) · \(Copy.modelEstimate)")
                    .font(Typography.eyebrow)
                    .opacity(0.45)
            }
        }
    }
}

struct UnavailableBanner: View {
    let error: ForecastUnavailable
    let generatedAt: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(error.userFacingMessage).font(Typography.sm).fontWeight(.semibold)
            if let generatedAt {
                Text(Copy.asOf(generatedAt)).font(Typography.xs).opacity(0.7)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .fill(Color.black.opacity(0.22))
        )
    }
}
