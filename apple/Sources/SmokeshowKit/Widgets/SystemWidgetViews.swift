// The home-screen and desktop families.
//
// Every one of them is the same three facts in a different amount of room:
// where you are, what the air is doing, and when it changes. The level name
// and the headline are server strings rendered verbatim; the sky, the ridge
// and the curve are the picture. Nothing here decides anything.

import SwiftUI

// MARK: - Small (148×148 in the demo)

public struct SmallWidgetView: View {
    private let entry: WidgetEntryModel

    public init(entry: WidgetEntryModel) { self.entry = entry }

    public var body: some View {
        WidgetSurface(entry: entry) { ink in
            VStack(alignment: .leading, spacing: 0) {
                PlaceEyebrow(entry: entry, ink: ink)
                Spacer(minLength: 0)
                Text(entry.levelName ?? Copy.unavailable)
                    .font(Typography.widgetWord(16))
                    .minimumScaleFactor(0.7)
                    .lineLimit(2)
                Text(entry.subtitle)
                    .font(.system(size: 10.5, weight: .semibold))
                    .opacity(0.68)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                    .padding(.top, 2)
                StaleNote(entry: entry, ink: ink)
            }
            .foregroundStyle(ink)
            .padding(.bottom, 34) // the curve occupies the bottom band
        }
    }
}

// MARK: - Medium (296×140 in the demo)

public struct MediumWidgetView: View {
    private let entry: WidgetEntryModel

    public init(entry: WidgetEntryModel) { self.entry = entry }

    public var body: some View {
        WidgetSurface(entry: entry, curveHeight: 46) { ink in
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 0) {
                    PlaceEyebrow(entry: entry, ink: ink)
                    Spacer(minLength: 0)
                    Text(entry.levelName ?? Copy.unavailable)
                        .font(Typography.widgetWord(20))
                        .minimumScaleFactor(0.7)
                        .lineLimit(2)
                    Text(entry.subtitle)
                        .font(.system(size: 11, weight: .semibold))
                        .opacity(0.68)
                        .lineLimit(1)
                        .padding(.top, 2)
                    StaleNote(entry: entry, ink: ink)
                }
                Spacer(minLength: 0)
                if entry.isForecast {
                    VStack(alignment: .trailing, spacing: 6) {
                        ReadingBadge(entry: entry, ink: ink)
                        DayPipRow(days: Array(entry.days.prefix(5)), ink: ink)
                    }
                }
            }
            .foregroundStyle(ink)
            .padding(.bottom, 30)
        }
    }
}

// MARK: - Large (the demo has no design for this one)

/// systemLarge is where the five-day strip finally fits, so the tile answers
/// "when does it clear" *and* "what does the week look like" — the two
/// questions the app itself opens with. The curve gets real height, and the
/// measured/agreement furniture that the small families cannot carry goes at
/// the foot, because a large tile that says nothing about provenance invites
/// the user to read it as a measurement.
public struct LargeWidgetView: View {
    private let entry: WidgetEntryModel

    public init(entry: WidgetEntryModel) { self.entry = entry }

    public var body: some View {
        WidgetSurface(entry: entry, curveHeight: 92, curveInset: 44) { ink in
            VStack(alignment: .leading, spacing: 0) {
                PlaceEyebrow(entry: entry, ink: ink)
                Spacer(minLength: 8)

                Text(entry.levelName ?? Copy.unavailable)
                    .font(Typography.widgetWord(30))
                    .minimumScaleFactor(0.6)
                    .lineLimit(2)

                Text(entry.subtitle)
                    .font(.system(size: 14, weight: .semibold))
                    .opacity(0.7)
                    .padding(.top, 3)
                    .lineLimit(2)

                if entry.isForecast {
                    Text(entry.readingLine)
                        .font(Typography.eyebrow)
                        .opacity(0.55)
                        .padding(.top, 6)
                }

                Spacer(minLength: 12)

                if entry.isForecast {
                    DayStripRow(days: entry.days, ink: ink)
                        .padding(.bottom, 8)
                    FooterNote(entry: entry, ink: ink)
                }
            }
            .foregroundStyle(ink)
            .padding(.bottom, 96)
        }
    }
}

// MARK: - Extra large (iPad and Mac desktop; also undesigned in the demo)

/// systemExtraLarge is a desktop object, not a glance: it sits on an iPad home
/// screen or a Mac's Notification Center where it is read from feet away and
/// stays visible for hours. So it splits — verdict and curve on the left, the
/// week broken into day-parts on the right — and it is the one family with
/// room to print the agreement line in full.
public struct ExtraLargeWidgetView: View {
    private let entry: WidgetEntryModel

    public init(entry: WidgetEntryModel) { self.entry = entry }

    public var body: some View {
        WidgetSurface(entry: entry, curveHeight: 120, curveInset: 0, curveWidthFraction: 0.56) { ink in
            HStack(alignment: .top, spacing: 22) {
                VStack(alignment: .leading, spacing: 0) {
                    PlaceEyebrow(entry: entry, ink: ink)
                    Spacer(minLength: 10)
                    Text(entry.levelName ?? Copy.unavailable)
                        .font(Typography.widgetWord(38))
                        .minimumScaleFactor(0.6)
                        .lineLimit(2)
                    Text(entry.subtitle)
                        .font(.system(size: 16, weight: .semibold))
                        .opacity(0.72)
                        .padding(.top, 4)
                    if entry.isForecast {
                        Text(entry.readingLine)
                            .font(Typography.eyebrow)
                            .opacity(0.55)
                            .padding(.top, 8)
                    }
                    Spacer(minLength: 0)
                    FooterNote(entry: entry, ink: ink)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 126)

                if entry.isForecast {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(entry.days) { day in
                            DayPartRow(day: day, ink: ink)
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(width: 230, alignment: .leading)
                }
            }
            .foregroundStyle(ink)
        }
    }
}

// MARK: - Shared furniture

/// Sky, ridge, curve, and the two non-forecast states, in one place so every
/// system family is unmistakably the same object.
struct WidgetSurface<Content: View>: View {
    let entry: WidgetEntryModel
    var curveHeight: CGFloat = 54
    /// Distance from the bottom edge at which the ridge sits above the curve.
    var curveInset: CGFloat = 0
    /// Fraction of the width the curve spans (extra-large keeps it left).
    var curveWidthFraction: CGFloat = 1
    @ViewBuilder let content: (Color) -> Content

    private var ink: Color {
        guard let sky = entry.sky else { return Palette.dark.text }
        return sky.ink
    }

    var body: some View {
        ZStack {
            SkyBackdrop(sky: entry.sky)

            if entry.isForecast || entry.state == .placeholder {
                GeometryReader { geometry in
                    ZStack(alignment: .bottom) {
                        RidgeView(pm25: entry.reading, strength: 1)
                            .frame(height: curveHeight * 0.55)
                            .offset(y: -(curveHeight - curveHeight * 0.2))
                            .frame(maxHeight: .infinity, alignment: .bottom)

                        CurveView(
                            points: entry.curve,
                            nowIndex: entry.curveNowIndex,
                            ink: ink
                        )
                        .frame(width: geometry.size.width * curveWidthFraction, height: curveHeight)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, curveInset)
                    }
                }
            }

            switch entry.state {
            case .forecast, .placeholder:
                content(ink)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 13)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            case .lapsed:
                LapsedTile(entry: entry, ink: ink)
            case .unavailable(let reason):
                UnavailableTile(entry: entry, reason: reason, ink: ink)
            }
        }
        .redacted(reason: entry.state == .placeholder ? .placeholder : [])
    }
}

struct PlaceEyebrow: View {
    let entry: WidgetEntryModel
    let ink: Color

    var body: some View {
        HStack(spacing: 5) {
            Text(entry.placeName.uppercased())
                .font(Typography.eyebrow)
                .opacity(0.42)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 0)
        }
        .foregroundStyle(ink)
    }
}

struct ReadingBadge: View {
    let entry: WidgetEntryModel
    let ink: Color

    var body: some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text(entry.compactReading)
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .monospacedDigit()
            Text(entry.unit.shortLabel)
                .font(.system(size: 8.5, weight: .medium, design: .monospaced))
                .opacity(0.55)
            // The label is not decoration: CLAUDE.md requires it on every
            // forecast number, and a widget is the surface most likely to be
            // mistaken for a measurement.
            Text(Copy.modelEstimate)
                .font(.system(size: 7.5, weight: .medium, design: .monospaced))
                .opacity(0.45)
        }
        .foregroundStyle(ink)
    }
}

struct DayPipRow: View {
    let days: [DayPip]
    let ink: Color

    var body: some View {
        HStack(spacing: 9) {
            ForEach(days) { day in
                VStack(spacing: 3) {
                    Text(day.weekday.uppercased())
                        .font(.system(size: 8, weight: .medium, design: .monospaced))
                        .opacity(0.75)
                    Circle()
                        .fill(Palette.color(forLevelIndex: day.levelIndex))
                        .frame(width: 7, height: 7)
                        // A day with no model values gets a hollow pip, not a
                        // green one. Absence is not clean air.
                        .opacity(day.levelIndex == nil ? 0.25 : 1)
                }
            }
        }
        .foregroundStyle(ink)
    }
}

struct DayStripRow: View {
    let days: [DayPip]
    let ink: Color

    var body: some View {
        HStack(spacing: 8) {
            ForEach(days) { day in
                VStack(spacing: 4) {
                    Text(day.weekday.uppercased())
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .opacity(0.75)
                    HStack(spacing: 2) {
                        ForEach(Array(day.partColors.enumerated()), id: \.offset) { _, hex in
                            RoundedRectangle(cornerRadius: 1.5)
                                .fill(hex.flatMap { Color(serverHex: $0) } ?? ink.opacity(0.12))
                                .frame(height: 5)
                        }
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .foregroundStyle(ink)
    }
}

/// One day as a row — extra-large only, where there is room for the day-part
/// names the strip elsewhere can only imply.
struct DayPartRow: View {
    let day: DayPip
    let ink: Color

    private static let partLabels = ["Morning", "Afternoon", "Evening"]

    var body: some View {
        HStack(spacing: 10) {
            Text(day.weekday.uppercased())
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .frame(width: 34, alignment: .leading)
                .opacity(0.8)
            ForEach(Array(day.partColors.enumerated()), id: \.offset) { index, hex in
                VStack(spacing: 3) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(hex.flatMap { Color(serverHex: $0) } ?? ink.opacity(0.12))
                        .frame(height: 7)
                    Text(Self.partLabels[min(index, 2)])
                        .font(.system(size: 7.5, weight: .medium, design: .monospaced))
                        .opacity(0.45)
                }
            }
        }
        .foregroundStyle(ink)
    }
}

struct StaleNote: View {
    let entry: WidgetEntryModel
    let ink: Color

    var body: some View {
        if entry.isStale, let generatedAt = entry.generatedAt {
            Text(Copy.asOf(generatedAt))
                .font(.system(size: 8, weight: .medium, design: .monospaced))
                .opacity(0.5)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.top, 3)
                .foregroundStyle(ink)
        }
    }
}

/// The line that keeps a big tile honest: what the numbers are, and how far
/// out to trust them.
struct FooterNote: View {
    let entry: WidgetEntryModel
    let ink: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let agreement = entry.agreementLabel {
                Text(agreement)
                    .font(.system(size: 9.5, weight: .medium))
                    .italic()
                    .opacity(0.5)
                    .lineLimit(2)
            }
            if let generatedAt = entry.generatedAt {
                Text(Copy.asOf(generatedAt))
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .opacity(entry.isStale ? 0.75 : 0.4)
                    .lineLimit(1)
            }
        }
        .foregroundStyle(ink)
    }
}

/// What the widget shows when the trial lapses. Designed, per platform plan §4:
/// the place and the sky stay so the tile still looks like itself; the forecast
/// is withheld rather than frozen. A blank tile reads as broken and a stale
/// number is a lie, and this is neither.
struct LapsedTile: View {
    let entry: WidgetEntryModel
    let ink: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PlaceEyebrow(entry: entry, ink: ink)
            Spacer(minLength: 0)
            Text(Copy.Lapse.widgetTitle)
                .font(Typography.widgetWord(15))
            Text(Copy.Lapse.widgetBody)
                .font(.system(size: 10.5, weight: .semibold))
                .opacity(0.7)
                .padding(.top, 2)
                .lineLimit(2)
        }
        .foregroundStyle(ink)
        .padding(15)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct UnavailableTile: View {
    let entry: WidgetEntryModel
    let reason: String
    let ink: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PlaceEyebrow(entry: entry, ink: ink)
            Spacer(minLength: 0)
            Text(Copy.unavailable)
                .font(Typography.widgetWord(15))
            Text(reason)
                .font(.system(size: 10, weight: .medium))
                .opacity(0.7)
                .padding(.top, 2)
                .lineLimit(3)
            if let generatedAt = entry.generatedAt {
                Text(Copy.asOf(generatedAt))
                    .font(.system(size: 8.5, weight: .medium, design: .monospaced))
                    .opacity(0.5)
                    .padding(.top, 4)
            }
        }
        .foregroundStyle(ink)
        .padding(15)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
