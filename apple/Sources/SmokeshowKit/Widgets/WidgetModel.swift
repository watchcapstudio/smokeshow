// What a widget draws, resolved once when the timeline is built.
//
// Every entry in a WidgetKit timeline is rendered from one of these. They are
// deliberately flat and pre-resolved: a widget view must never reach back into
// a `Forecast`, because a view that indexes into `hours[]` is one refactor away
// from computing something, and computing is the thing the endpoint exists to
// prevent.
//
// Three states, all designed rather than implicit:
//   • `.forecast` — the normal glance.
//   • `.lapsed`   — the trial ended. Place and sky stay; the forecast goes.
//                   Decided, not left to render blank (platform plan §4).
//   • `.unavailable` — no payload we are willing to show as current.

import Foundation

public struct CurvePoint: Sendable, Equatable {
    public let t: Date
    /// Nil is a real model gap. Draw a break, never a zero.
    public let value: Double?

    public init(t: Date, value: Double?) {
        self.t = t
        self.value = value
    }
}

public struct DayPip: Sendable, Equatable, Identifiable {
    public let key: String
    public let weekday: String
    public let levelIndex: Int?
    /// Server-supplied day-part colours, in morning/afternoon/evening order.
    /// Nil entries are parts with no hours left — commonly today's morning.
    public let partColors: [String?]

    public var id: String { key }

    public init(key: String, weekday: String, levelIndex: Int?, partColors: [String?]) {
        self.key = key
        self.weekday = weekday
        self.levelIndex = levelIndex
        self.partColors = partColors
    }
}

public struct WidgetEntryModel: Sendable, Equatable {

    public enum State: Sendable, Equatable {
        case forecast
        case lapsed
        case unavailable(String)
        /// Redacted/placeholder rendering while WidgetKit takes a snapshot.
        case placeholder
    }

    /// When this entry becomes the visible one.
    public let date: Date
    public let state: State

    public let placeName: String

    // — the verdict, as the server said it —
    /// `scale[levelIndex].name`, e.g. "Hazy". Server copy, so a rename on the
    /// server reaches this build without an app update.
    public let levelName: String?
    public let levelIndex: Int?
    public let levelKey: Forecast.ScaleEntry.Key?
    /// One of exactly five sentences. Rendered verbatim.
    public let headline: String?
    /// "Thursday ~6 PM" — the tilde is required.
    public let changeLabel: String?
    public let changeAt: Date?
    public let changeIsClearing: Bool
    /// Whole hours from this entry to `changeAt`, resolved at build time so a
    /// gauge does not need a live clock.
    public let hoursToChange: Int?

    // — the reading —
    /// Already in the user's unit. Nil means the model has a gap at this hour,
    /// and the view must render `Copy.noData`.
    public let reading: Double?
    public let unit: MeasurementUnit
    /// Fraction 0…1 for the PM arc. Nil on a gap — an empty arc, not a zero one.
    public let readingFraction: Double?

    // — the picture —
    public let sky: Forecast.Sky?
    public let curve: [CurvePoint]
    /// Index into `curve` of the hour this entry is "now" at.
    public let curveNowIndex: Int
    public let days: [DayPip]

    // — honesty furniture —
    public let generatedAt: Date?
    public let isStale: Bool
    public let agreementLabel: String?
    /// Set during the trial's last days; the widget carries the conversion
    /// line instead of its usual subtitle (platform plan §4).
    public let trialDaysRemaining: Int?

    public init(
        date: Date,
        state: State,
        placeName: String,
        levelName: String? = nil,
        levelIndex: Int? = nil,
        levelKey: Forecast.ScaleEntry.Key? = nil,
        headline: String? = nil,
        changeLabel: String? = nil,
        changeAt: Date? = nil,
        changeIsClearing: Bool = false,
        hoursToChange: Int? = nil,
        reading: Double? = nil,
        unit: MeasurementUnit = .microgramsPerCubicMetre,
        readingFraction: Double? = nil,
        sky: Forecast.Sky? = nil,
        curve: [CurvePoint] = [],
        curveNowIndex: Int = 0,
        days: [DayPip] = [],
        generatedAt: Date? = nil,
        isStale: Bool = false,
        agreementLabel: String? = nil,
        trialDaysRemaining: Int? = nil
    ) {
        self.date = date
        self.state = state
        self.placeName = placeName
        self.levelName = levelName
        self.levelIndex = levelIndex
        self.levelKey = levelKey
        self.headline = headline
        self.changeLabel = changeLabel
        self.changeAt = changeAt
        self.changeIsClearing = changeIsClearing
        self.hoursToChange = hoursToChange
        self.reading = reading
        self.unit = unit
        self.readingFraction = readingFraction
        self.sky = sky
        self.curve = curve
        self.curveNowIndex = curveNowIndex
        self.days = days
        self.generatedAt = generatedAt
        self.isStale = isStale
        self.agreementLabel = agreementLabel
        self.trialDaysRemaining = trialDaysRemaining
    }

    // MARK: Rendering conveniences (formatting only — no derivation)

    /// The subtitle every system family shows under the level name. During the
    /// churn window it becomes the conversion line; that swap is the single
    /// most valuable pixel in the product's funnel.
    public var subtitle: String {
        if let days = trialDaysRemaining {
            return Copy.Lapse.churnWindow(daysRemaining: days)
        }
        return headline ?? Copy.unavailable
    }

    /// "41 µg/m³ · model estimate", or "— · model estimate" on a gap. The
    /// suffix is not optional: CLAUDE.md requires it on every forecast label.
    public var readingLine: String {
        guard let reading else { return Copy.reading(Copy.noData) }
        switch unit {
        case .microgramsPerCubicMetre:
            return Copy.reading("\(Int(reading.rounded())) µg/m³")
        case .aqi:
            return Copy.reading("AQI \(Int(reading.rounded()))")
        }
    }

    public var compactReading: String {
        guard let reading else { return Copy.noData }
        return "\(Int(reading.rounded()))"
    }

    /// "4h" / "2d" for the countdown accessory, or nil when nothing is coming.
    public var countdownText: String? {
        guard let hoursToChange else { return nil }
        if hoursToChange >= 48 { return "\(hoursToChange / 24)d" }
        return "\(max(hoursToChange, 1))h"
    }

    public var countdownLabel: String? {
        guard hoursToChange != nil else { return nil }
        return changeIsClearing ? "TO CLEAR" : "TO SMOKE"
    }

    public var isForecast: Bool {
        if case .forecast = state { return true }
        return false
    }
}
