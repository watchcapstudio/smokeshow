// Lookups over a decoded payload. Every function here is *indexing* — finding
// the hour nearest an instant, reading the scale entry a level points at,
// clamping a range to the window that actually shipped.
//
// Nothing here decides anything. There is no 35 µg/m³ threshold in this file,
// no 6-hour hold, no trend slope, no rating boundary. If you find yourself
// wanting one, the answer is already in `verdict` or `hours[].levelIndex`.

import Foundation

public extension Forecast {

    // MARK: Hours

    /// Bounds-safe hour lookup. `hours.length` is not 192 — the window can be
    /// short at the end of a model run and may widen additively (§ contract 2).
    func hour(at index: Int) -> Hour? {
        guard hours.indices.contains(index) else { return nil }
        return hours[index]
    }

    var nowHour: Hour? { hour(at: now.index) }

    /// The hour bucket nearest `date`, or nil when `date` falls outside the
    /// window. Used to advance a widget entry through a timeline that was
    /// fetched once — the contract's whole reason for returning a series.
    func index(nearest date: Date) -> Int? {
        guard let first = hours.first?.t, let last = hours.last?.t else { return nil }
        // Half-open guard rails: one bucket of slack at each end so an entry
        // scheduled exactly on the boundary still resolves.
        guard date >= first.addingTimeInterval(-1800),
              date <= last.addingTimeInterval(1800) else { return nil }

        let elapsed = date.timeIntervalSince(first)
        let candidate = Int((elapsed / 3600).rounded())
        return min(max(candidate, 0), hours.count - 1)
    }

    /// Forward slice used by the curve views: `now` back `past` hours and
    /// forward `forward` hours, clamped to what shipped.
    func hourSlice(past: Int, forward: Int) -> ArraySlice<Hour> {
        let lower = max(0, now.index - past)
        let upper = min(hours.count - 1, now.index + forward)
        guard lower <= upper else { return hours[0..<0] }
        return hours[lower...upper]
    }

    // MARK: Scale

    /// The rating rung a level index points at. All copy is server-supplied.
    func scaleEntry(at index: Int?) -> ScaleEntry? {
        guard let index, scale.indices.contains(index) else { return nil }
        return scale[index]
    }

    /// The rung for the hour the server called "now".
    var nowScaleEntry: ScaleEntry? { scaleEntry(at: nowHour?.levelIndex) }

    /// The rung the *verdict* is speaking about. Prefer this for headline
    /// furniture: `verdict.levelIndex` is never null, `hours[].levelIndex` is.
    var verdictScaleEntry: ScaleEntry? { scaleEntry(at: verdict.levelIndex) }

    /// The guidance line for a household preference. Both variants always ship.
    func guidance(at index: Int?, sensitiveHousehold: Bool) -> String? {
        guard let entry = scaleEntry(at: index) else { return nil }
        return sensitiveHousehold ? entry.guidance.sensitive : entry.guidance.general
    }

    // MARK: Freshness

    /// How old the payload is. Widgets show this rather than pretending.
    func age(asOf date: Date = Date()) -> TimeInterval {
        date.timeIntervalSince(generatedAt)
    }

    /// Past this, a cached payload is shown with its `generatedAt` visible and
    /// never as a live reading. Three hours is deliberately generous: it is
    /// long enough to survive a night of failed background refreshes and short
    /// enough that a smoke front cannot pass through it unnoticed.
    static let staleAfter: TimeInterval = 3 * 3600

    func isStale(asOf date: Date = Date()) -> Bool {
        age(asOf: date) > Forecast.staleAfter
    }

    /// Beyond this the payload has nothing left to render at all — every hour
    /// in it is in the past.
    func isExhausted(asOf date: Date = Date()) -> Bool {
        guard let last = hours.last?.t else { return true }
        return date > last
    }

    // MARK: Verdict-adjacent rendering helpers

    /// The instant the verdict is counting toward, whichever direction it runs.
    /// This is a *read* of the server's answer — the countdown never derives
    /// its own crossing.
    var nextChangeAt: Date? {
        verdict.clearAtUTC ?? verdict.arrivalAtUTC
    }

    /// The label that goes with `nextChangeAt`, server-formatted, tilde and all.
    var nextChangeLabel: String? {
        verdict.clearLabel ?? verdict.arrivalLabel
    }

    /// True when the countdown is toward clean air rather than toward smoke.
    var nextChangeIsClearing: Bool { verdict.clearAtUTC != nil }
}

public extension Forecast.Hour {
    /// The reading a client displays for this hour, in the user's unit — or
    /// nil. A nil here must render as "—", never as 0 (contract §4).
    func reading(in unit: MeasurementUnit) -> Double? {
        switch unit {
        case .microgramsPerCubicMetre: return pm25
        case .aqi: return aqi.map(Double.init)
        }
    }
}
