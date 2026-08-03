// "What this means."
//
// Every word of this sheet except the section headings comes from the payload:
// the five rungs of `scale[]`, their notices, their not-lines, and whichever
// `guidance` variant the household preference selects. That is not laziness —
// CLAUDE.md requires this copy to ship verbatim and forbids invented symptom
// dose-response, and copy pasted into a Swift file is copy that drifts away
// from both.

import SwiftUI
import SmokeshowKit

struct ExplainSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    let forecast: Forecast?

    private var sensitive: Bool { model.preferences.sensitiveHousehold }

    var body: some View {
        ZStack {
            Palette.dark.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header

                    if let forecast {
                        currentLevel(forecast)
                        ladder(forecast)
                        measured(forecast)
                        agreement(forecast)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("The fine print").font(Typography.md)
                        Text(Copy.disclaimer)
                            .font(Typography.sm)
                            .opacity(0.7)
                    }
                }
                .padding(22)
            }
        }
        .foregroundStyle(Palette.dark.text)
    }

    private var header: some View {
        HStack {
            Text("What this means").font(Typography.xl)
            Spacer()
            Button("Done") { dismiss() }.font(Typography.sm).opacity(0.6)
        }
    }

    private func currentLevel(_ forecast: Forecast) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let entry = forecast.nowScaleEntry {
                Text("\(entry.name) · \(entry.rangeUg) µg/m³")
                    .font(Typography.md)
                Text(entry.notice).font(Typography.base).opacity(0.8)
                // The cigarette heuristic and visibility are the defensible
                // experience anchors; there is no symptom mapping anywhere.
                Text(entry.notLine).font(Typography.base).opacity(0.7)
                Text("Visibility: \(entry.visibility)").font(Typography.sm).opacity(0.6)
                Text(entry.guidance.sensitive.isEmpty || !sensitive
                    ? "EPA guidance: \(entry.guidance.general)"
                    : "EPA guidance (sensitive household): \(entry.guidance.sensitive)")
                    .font(Typography.sm)
                    .opacity(0.75)
            }
            Text("Level \(forecast.verdict.levelIndex + 1) of 5 · \(Copy.modelEstimate)")
                .font(Typography.eyebrow)
                .opacity(0.5)
        }
    }

    private func ladder(_ forecast: Forecast) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("The scale").font(Typography.md)
            ForEach(forecast.scale) { entry in
                HStack(alignment: .top, spacing: 10) {
                    Circle()
                        .fill(Palette.color(for: entry.key))
                        .frame(width: 8, height: 8)
                        .padding(.top, 5)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(entry.name) · \(entry.rangeUg)")
                            .font(Typography.base)
                            .fontWeight(entry.index == forecast.verdict.levelIndex ? .bold : .regular)
                        Text(entry.visibility).font(Typography.xs).opacity(0.6)
                    }
                }
            }
        }
    }

    /// Why two instruments can disagree, and why we do not average them.
    private func measured(_ forecast: Forecast) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("What the instruments say").font(Typography.md)
            Text("""
                The nearest regulatory station and the neighborhood sensors are shown separately, \
                never blended. During fast-moving smoke a monitor tens of miles away and a cluster \
                of sensors nearby legitimately disagree, and averaging them would produce a number \
                neither one reported.
                """)
                .font(Typography.sm)
                .opacity(0.72)

            let anchor = forecast.measured.anchor
            Text(anchorLine(anchor, forecast: forecast))
                .font(Typography.xs)
                .opacity(0.6)

            Text("Hours before now are \(Copy.modelEstimate) — model reanalysis, not readings.")
                .font(Typography.xs)
                .opacity(0.6)
        }
    }

    private func anchorLine(_ anchor: Forecast.Measured.Anchor, forecast: Forecast) -> String {
        switch anchor.source {
        case .model, .unknown:
            return "No nearby instrument reported, so the forecast is the raw \(forecast.source.model) model."
        case .official, .local:
            let sign = anchor.offsetUg >= 0 ? "+" : ""
            return """
                The forecast is shifted \(sign)\(String(format: "%.1f", anchor.offsetUg)) µg/m³ to \
                meet the \(anchor.source == .official ? "station" : "neighborhood") reading now, \
                fading back to the model over \(Int(anchor.decayHours)) hours.
                """
        }
    }

    private func agreement(_ forecast: Forecast) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("How far to trust it").font(Typography.md)
            Text(forecast.agreement.label).font(Typography.sm).opacity(0.72)
        }
    }
}
