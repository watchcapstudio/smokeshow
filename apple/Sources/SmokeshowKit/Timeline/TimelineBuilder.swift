// One fetch, many entries. This file is where the WidgetKit reload budget is
// respected or blown.
//
// WidgetKit grants roughly 40–70 timeline reloads per widget per day. A widget
// that fetches a *point* needs a reload for every value it wants to show and
// runs out before lunch. `/api/forecast` returns a timeline precisely so that
// one network call can feed a whole day of entries — contract §1: "Widget
// timelines should fetch once and schedule locally off `hours[]`."
//
// The arithmetic this file commits to, per widget:
//
//   state          refresh cadence     network calls/day     entries per call
//   ─────────────  ─────────────────   ───────────────────   ────────────────
//   smoke active   90 minutes          16                    24 (12h @ 30min)
//   calm           3 hours             8                     24 (12h @ 30min)
//   unavailable    20 min, backing     ≤ 12 (capped)         1
//                  off to 2h
//
// Sixteen reloads a day is a quarter of the low end of the budget, which
// leaves headroom for the reloads we ask for explicitly: app foreground, place
// change, preference change, and a push that says the
// verdict moved. Those are events, not polling. Nothing in this codebase polls.

import Foundation

public struct WidgetTimeline: Sendable {
    public let entries: [WidgetEntryModel]
    /// When WidgetKit should come back for a new payload.
    public let refreshAt: Date

    public init(entries: [WidgetEntryModel], refreshAt: Date) {
        self.entries = entries
        self.refreshAt = refreshAt
    }
}

public enum TimelineBuilder {

    // MARK: Budget constants

    /// One entry every half hour. Entries are free; reloads are not.
    public static let entryInterval: TimeInterval = 30 * 60
    /// How far ahead entries are scheduled from a single payload.
    public static let entrySpan: TimeInterval = 12 * 3600

    public static let activeRefresh: TimeInterval = 90 * 60
    public static let calmRefresh: TimeInterval = 3 * 3600
    /// First retry after a failure. Doubles up to `maxErrorRefresh`, so a
    /// backend outage costs a bounded number of reloads rather than a
    /// tight retry loop that exhausts the budget in an hour.
    public static let minErrorRefresh: TimeInterval = 20 * 60
    public static let maxErrorRefresh: TimeInterval = 2 * 3600

    // MARK: Building

    /// Build the entries a single payload can honestly support.
    ///
    /// - Parameters:
    ///   - forecast: the payload, fetched once.
    ///   - place: the name to print. The contract carries no place name.
    ///   - preferences: unit and sensitive-household choice.
    ///   - now: the instant to build from (injected for tests).
    public static func build(
        forecast: Forecast,
        place: Place,
        preferences: Preferences = PreferencesStore.shared.current,
        now: Date = Date()
    ) -> WidgetTimeline {

        var entries: [WidgetEntryModel] = []
        var cursor = now
        let horizon = min(
            now.addingTimeInterval(entrySpan),
            forecast.hours.last?.t ?? now.addingTimeInterval(entrySpan)
        )

        while cursor <= horizon {
            if let entry = entry(
                at: cursor,
                forecast: forecast,
                place: place,
                preferences: preferences
            ) {
                entries.append(entry)
            }
            cursor = cursor.addingTimeInterval(entryInterval)
        }

        if entries.isEmpty {
            // The payload has nothing left to say about the present — every
            // hour in it is behind us. Show the unavailable state rather than
            // the last hour dressed up as now.
            return WidgetTimeline(
                entries: [unavailableEntry(
                    at: now,
                    place: place,
                    reason: Copy.unavailableDetail,
                    generatedAt: forecast.generatedAt
                )],
                refreshAt: now.addingTimeInterval(minErrorRefresh)
            )
        }

        let cadence = forecast.verdict.above || forecast.verdict.arrivalAtUTC != nil
            ? activeRefresh
            : calmRefresh

        // Never schedule a refresh past the point where the payload goes
        // stale: a widget that renders a four-hour-old number as current is
        // exactly what contract §9.3 forbids.
        let staleAt = forecast.generatedAt.addingTimeInterval(Forecast.staleAfter)
        let refreshAt = min(now.addingTimeInterval(cadence), max(staleAt, now.addingTimeInterval(minErrorRefresh)))

        return WidgetTimeline(entries: entries, refreshAt: refreshAt)
    }

    /// One entry, resolved from the hour bucket nearest `date`.
    static func entry(
        at date: Date,
        forecast: Forecast,
        place: Place,
        preferences: Preferences
    ) -> WidgetEntryModel? {
        guard let index = forecast.index(nearest: date), let hour = forecast.hour(at: index) else {
            return nil
        }

        let scaleEntry = forecast.scaleEntry(at: hour.levelIndex)
        let reading = hour.reading(in: preferences.unit)
        let changeAt = forecast.nextChangeAt
        let hoursToChange = changeAt.map { target -> Int in
            Int((target.timeIntervalSince(date) / 3600).rounded())
        }

        return WidgetEntryModel(
            date: date,
            state: .forecast,
            placeName: place.shortName,
            levelName: scaleEntry?.name,
            levelIndex: hour.levelIndex,
            levelKey: scaleEntry?.key,
            headline: forecast.verdict.headline,
            changeLabel: forecast.nextChangeLabel,
            changeAt: changeAt,
            changeIsClearing: forecast.nextChangeIsClearing,
            // A countdown that has run out is not a countdown; the next
            // payload will carry the new verdict.
            hoursToChange: (hoursToChange ?? 0) > 0 ? hoursToChange : nil,
            reading: reading,
            unit: preferences.unit,
            readingFraction: fraction(for: reading, unit: preferences.unit),
            sky: hour.sky,
            curve: curve(around: index, in: forecast),
            curveNowIndex: min(index, curveLookback),
            days: forecast.days.map(pip(for:)),
            generatedAt: forecast.generatedAt,
            isStale: forecast.isStale(asOf: date),
            agreementLabel: forecast.agreement.label
        )
    }

    // MARK: Non-forecast timelines

    /// No payload we are willing to show as current. `attempt` backs the
    /// retry off so an outage cannot drain the day's reloads.
    public static func unavailableTimeline(
        place: Place,
        reason: String,
        cached: Forecast? = nil,
        attempt: Int = 0,
        now: Date = Date()
    ) -> WidgetTimeline {
        let backoff = min(maxErrorRefresh, minErrorRefresh * pow(2, Double(max(0, attempt))))
        return WidgetTimeline(
            entries: [unavailableEntry(
                at: now,
                place: place,
                reason: reason,
                generatedAt: cached?.generatedAt
            )],
            refreshAt: now.addingTimeInterval(backoff)
        )
    }

    static func unavailableEntry(
        at date: Date,
        place: Place,
        reason: String,
        generatedAt: Date?
    ) -> WidgetEntryModel {
        WidgetEntryModel(
            date: date,
            state: .unavailable(reason),
            placeName: place.shortName,
            generatedAt: generatedAt,
            isStale: true
        )
    }

    public static func placeholder(place: Place = .preview) -> WidgetEntryModel {
        WidgetEntryModel(date: Date(), state: .placeholder, placeName: place.shortName)
    }

    // MARK: Curve

    /// The demo's 61-hour window: 12 hours behind, 48 ahead.
    public static let curveLookback = 12
    public static let curveLookahead = 48

    public static func curve(around index: Int, in forecast: Forecast) -> [CurvePoint] {
        let lower = max(0, index - curveLookback)
        let upper = min(forecast.hours.count - 1, index + curveLookahead)
        guard lower <= upper else { return [] }
        return forecast.hours[lower...upper].map { CurvePoint(t: $0.t, value: $0.pm25) }
    }

    static func pip(for day: Forecast.Day) -> DayPip {
        DayPip(
            key: day.key,
            weekday: day.weekday,
            levelIndex: day.levelIndex,
            partColors: day.dayParts.map { $0.bucket?.color }
        )
    }

    /// Arc fill for the circular accessory. A *display* scale, not a rating
    /// boundary: the rating ladder lives in `scale[]` and is never re-derived.
    static func fraction(for reading: Double?, unit: MeasurementUnit) -> Double? {
        guard let reading else { return nil }
        let ceiling: Double = unit == .aqi ? 300 : 250
        return min(max(reading / ceiling, 0), 1)
    }
}
