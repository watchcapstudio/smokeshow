// Lock-screen and watch accessories.
//
// These are the families the demo already designed (`.lk-inline`, `.acc-circ`
// ×2, `.acc-rect`) and, because they are the same SwiftUI views, they are also
// the watch complications — which is why complications are nearly free once
// these exist (platform plan §3).
//
// Accessory families render monochrome and are tinted by the system, so none
// of these may lean on the rating colour to carry meaning: the number, the
// word, and the arc do the work. iOS also renders them behind
// `AccessoryWidgetBackground`, never a sky.

// The whole file is iOS/watchOS only: macOS has no lock screen and therefore
// no accessory families at all (platform plan §3).
#if os(iOS) || os(watchOS)
import SwiftUI
import WidgetKit

// MARK: - Inline (one line under the lock-screen clock)

public struct AccessoryInlineView: View {
    private let entry: WidgetEntryModel

    public init(entry: WidgetEntryModel) { self.entry = entry }

    public var body: some View {
        switch entry.state {
        case .lapsed:
            Text(Copy.Lapse.widgetTitle)
        case .unavailable:
            Text(Copy.unavailable)
        case .forecast, .placeholder:
            // Level name plus the server's own sentence. The system truncates;
            // it does not get to invent a shorter one.
            Text("\(entry.levelName ?? Copy.noData) · \(entry.subtitle)")
        }
    }
}

// MARK: - Circular · the PM arc

public struct AccessoryCircularPMView: View {
    private let entry: WidgetEntryModel

    public init(entry: WidgetEntryModel) { self.entry = entry }

    public var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            switch entry.state {
            case .lapsed, .unavailable:
                VStack(spacing: 1) {
                    Image(systemName: "aqi.medium")
                        .font(.system(size: 15, weight: .semibold))
                    Text(Copy.noData)
                        .font(.system(size: 11, weight: .semibold))
                }
            case .forecast, .placeholder:
                Gauge(value: entry.readingFraction ?? 0) {
                    Text(entry.unit.shortLabel)
                } currentValueLabel: {
                    // A gap renders as an em dash inside an empty arc. Zero
                    // would be a claim about clean air (contract §4).
                    Text(entry.compactReading)
                        .minimumScaleFactor(0.6)
                }
                .gaugeStyle(.accessoryCircular)
                // Nothing left to show if the model has a gap: empty the arc.
                .opacity(entry.reading == nil ? 0.55 : 1)
            }
        }
        .accessibilityLabel(Text(entry.levelName ?? Copy.unavailable))
        .accessibilityValue(Text(entry.readingLine))
    }
}

// MARK: - Circular · the countdown arc

public struct AccessoryCircularCountdownView: View {
    private let entry: WidgetEntryModel

    public init(entry: WidgetEntryModel) { self.entry = entry }

    /// Fills as the change approaches. The instant comes from
    /// `verdict.clearAtUTC` / `arrivalAtUTC` — never from a local scan of the
    /// series.
    private var fraction: Double {
        guard let hours = entry.hoursToChange else { return 1 }
        return min(max(Double(48 - min(hours, 48)) / 48, 0), 1)
    }

    public var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            switch entry.state {
            case .lapsed, .unavailable:
                Image(systemName: "lock")
                    .font(.system(size: 16, weight: .semibold))
            case .forecast, .placeholder:
                Gauge(value: fraction) {
                    Text(entry.countdownLabel ?? "")
                } currentValueLabel: {
                    VStack(spacing: -1) {
                        Text(entry.countdownText ?? (entry.changeIsClearing ? "—" : "5d+"))
                            .font(.system(size: 14, weight: .bold))
                            .minimumScaleFactor(0.6)
                        Text(entry.countdownLabel ?? "CLEAR")
                            .font(.system(size: 6.5, weight: .semibold, design: .monospaced))
                            .opacity(0.75)
                    }
                }
                .gaugeStyle(.accessoryCircular)
            }
        }
        .accessibilityLabel(Text(entry.changeIsClearing ? "Time to clear air" : "Time to smoke"))
        .accessibilityValue(Text(entry.changeLabel ?? entry.subtitle))
    }
}

// MARK: - Rectangular

public struct AccessoryRectangularView: View {
    private let entry: WidgetEntryModel

    public init(entry: WidgetEntryModel) { self.entry = entry }

    public var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            switch entry.state {
            case .lapsed:
                Text(Copy.Lapse.widgetTitle).font(.headline)
                Text(Copy.Lapse.widgetBody).font(.caption2).opacity(0.8)
            case .unavailable:
                Text(Copy.unavailable).font(.headline)
                if let generatedAt = entry.generatedAt {
                    Text(Copy.asOf(generatedAt)).font(.caption2).opacity(0.8)
                }
            case .forecast, .placeholder:
                Text(entry.levelName ?? Copy.noData)
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(entry.subtitle)
                    .font(.caption2)
                    .opacity(0.8)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                CurveView(
                    points: entry.curve,
                    nowIndex: entry.curveNowIndex,
                    ink: .primary,
                    thin: true,
                    showsNowMark: true
                )
                .frame(height: 14)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Corner (watchOS)

#if os(watchOS)
public struct AccessoryCornerView: View {
    private let entry: WidgetEntryModel

    public init(entry: WidgetEntryModel) { self.entry = entry }

    public var body: some View {
        Text(entry.compactReading)
            .font(.system(size: 16, weight: .semibold))
            .minimumScaleFactor(0.6)
            .widgetLabel {
                Text(entry.subtitle)
                    .lineLimit(1)
            }
            .accessibilityLabel(Text(entry.levelName ?? Copy.unavailable))
    }
}
#endif
#endif
