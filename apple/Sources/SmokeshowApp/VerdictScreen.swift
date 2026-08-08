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
    @State private var showsMap = false
    /// Index into the curve, not into `hours`. Nil means "now".
    @State private var scrubbed: Int?

    private var forecast: Forecast? { model.forecast }
    private var nowHour: Forecast.Hour? { forecast?.nowHour }

    /// Where the curve window starts inside `hours`, so a curve index can be
    /// turned back into the hour it belongs to.
    private var curveStart: Int {
        guard let forecast else { return 0 }
        return max(0, forecast.now.index - TimelineBuilder.curveLookback)
    }

    /// The hour the screen is currently describing: the scrubbed one while a
    /// thumb is on the curve, otherwise now.
    private var shownHour: Forecast.Hour? {
        guard let forecast, let scrubbed else { return nowHour }
        let index = curveStart + scrubbed
        guard forecast.hours.indices.contains(index) else { return nowHour }
        return forecast.hours[index]
    }

    /// Dragging the curve moves the sun. Every hour carries its own sky in the
    /// payload, so scrubbing forward into tonight genuinely sets it — this is
    /// the thing that made the demo feel like a window rather than a chart.
    private var sky: Forecast.Sky? { shownHour?.sky }

    var body: some View {
        ZStack {
            // The screen is a window. Sky behind, land in front, and the
            // verdict sitting on the horizon between them — the demo rig's
            // whole idea, and the reason the app is not a list of readings.
            SkyBackdrop(sky: sky)
                .ignoresSafeArea()

            VStack {
                Spacer(minLength: 0)
                RidgeView(pm25: shownHour?.pm25, strength: 0.55)
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
                    TimelineBlock(
                        forecast: forecast,
                        unit: model.preferences.unit,
                        scrubbed: $scrubbed,
                        ink: sky?.ink ?? Palette.dark.text
                    )
                    // Clear of the curve. Sitting tight under it, the pills
                    // read as part of the chart rather than a row of controls.
                    .padding(.bottom, 26)

                    // The days stand on their own at the bottom, off the
                    // curve. Tapping one sends the scrubber there, which is
                    // how the demo let a day pill drive the whole screen.
                    FiveDayBlock(
                        forecast: forecast,
                        selection: $scrubbed,
                        ink: sky?.ink ?? Palette.dark.text
                    )

                    locationRow
                        .padding(.top, 16)
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
        .fullScreenCover(isPresented: $showsMap) {
            SmokeMapView()
                .environmentObject(model)
        }
    }

    private var header: some View {
        HStack {
            // The demo's "NOW" — the clock that says which moment the screen
            // is describing. It matters more once the curve can be scrubbed
            // away from the present.
            Text(clockLabel)
                .font(Typography.eyebrow)
                .opacity(0.45)

            Spacer()

            Button { showsSettings = true } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 15, weight: .semibold))
                    .opacity(0.6)
            }
            .buttonStyle(.plain)
        }
    }

    /// The place sits at the foot of the screen, under the days, because it is
    /// the answer to "where" and everything above it is the answer to "how
    /// bad". It is also the door to the map, exactly as the location name was
    /// in the demo — so it is a bar you can hit, not an eyebrow you can miss.
    ///
    /// A long-press changes the place; the tap goes to the map. The map is the
    /// thing people come back for, so it gets the primary gesture.
    private var locationRow: some View {
        HStack(spacing: 10) {
            Button {
                showsMap = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "map")
                        .font(.system(size: 13, weight: .medium))
                    Text((model.place?.shortName ?? "Choose a place").uppercased())
                        .font(Typography.eyebrow)
                    Spacer(minLength: 4)
                    Text("SEE THE SMOKE")
                        .font(Typography.eyebrow)
                        .opacity(0.6)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .opacity(0.6)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 13)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill((sky?.ink ?? Palette.dark.text).opacity(0.09))
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(model.place == nil)
            .simultaneousGesture(LongPressGesture().onEnded { _ in showsPlaces = true })

            Button { showsPlaces = true } label: {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .opacity(0.55)
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill((sky?.ink ?? Palette.dark.text).opacity(0.09))
                    )
            }
            .buttonStyle(.plain)
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

            if let hour = shownHour, let trend = hour.trend {
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
        guard let hour = shownHour else { return Copy.reading(Copy.noData) }
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

    /// Owned by the screen, not by this block: the sky, the ridge and the
    /// reading all follow the scrubbed hour, so the state has to live above
    /// all of them.
    @Binding var scrubbed: Int?
    /// The ink of the sky currently *behind* the curve, which is the scrubbed
    /// hour's, not now's. Pinning it to now drew a dark line on a night sky
    /// the moment a daytime reader scrubbed into the small hours.
    var ink: Color = Palette.dark.text

    private var points: [CurvePoint] {
        TimelineBuilder.curve(around: forecast.now.index, in: forecast)
    }

    private var nowIndex: Int {
        min(forecast.now.index, TimelineBuilder.curveLookback)
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
                    Text("Now").font(Typography.sm)
                    Spacer()
                    Text("−12h · +48h").font(Typography.eyebrow).opacity(0.5)
                }
            }
            CurveView(
                points: points,
                nowIndex: nowIndex,
                ink: ink,
                selection: $scrubbed
            )
            // Was 74pt, which made the whole point of the screen — the shape
            // of the smoke — the smallest thing on it.
            .frame(height: 150)
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

/// The five days, standing on their own under the curve. Each is a tap
/// target: it sends the scrubber to that day's worst hour, which is the hour
/// a person means when they point at a day and ask "what about then?".
///
/// Days past the curve's +48h window cannot be scrubbed to, so they are dimmed
/// rather than silently doing nothing.
struct FiveDayBlock: View {
    let forecast: Forecast
    var selection: Binding<Int?>?
    /// The sky's ink. Pills tinted with white vanish the moment the sky goes
    /// light, which is exactly when scrubbing into daylight makes them matter.
    var ink: Color = Palette.dark.text

    private var points: [CurvePoint] {
        TimelineBuilder.curve(around: forecast.now.index, in: forecast)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ForEach(forecast.days) { day in
                    dayPill(day)
                }
            }

            if !forecast.pastDays.isEmpty {
                Text("Before today: \(forecast.pastDays.map(\.weekday).joined(separator: " · ")) · \(Copy.modelEstimate)")
                    .font(Typography.eyebrow)
                    .opacity(0.45)
            }
        }
    }

    @ViewBuilder
    private func dayPill(_ day: Forecast.Day) -> some View {
        let target = curveIndex(for: day)
        let isSelected = target != nil && target == selection?.wrappedValue

        Button {
            guard let target else { return }
            selection?.wrappedValue = (selection?.wrappedValue == target) ? nil : target
        } label: {
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
                                ?? ink.opacity(0.12))
                            .frame(height: 5)
                    }
                }
            }
            .padding(.vertical, 9)
            .padding(.horizontal, 6)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(ink.opacity(isSelected ? 0.16 : 0.07))
            )
            .opacity(target == nil ? 0.45 : 1)
        }
        .buttonStyle(.plain)
        .disabled(target == nil)
    }

    /// The day's worst hour, expressed as a curve index. Nil when the day
    /// falls outside the scrubbable window.
    private func curveIndex(for day: Forecast.Day) -> Int? {
        var formatter: DateFormatter {
            let f = DateFormatter()
            f.timeZone = forecast.location.timeZone
            f.dateFormat = "yyyy-MM-dd"
            return f
        }
        let key = formatter
        let matches = points.enumerated().filter { key.string(from: $0.element.t) == day.key }
        guard !matches.isEmpty else { return nil }
        let worst = matches.max { ($0.element.value ?? -1) < ($1.element.value ?? -1) }
        return worst?.offset
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
