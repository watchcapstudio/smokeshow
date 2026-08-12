// The /api/forecast contract v1, as Swift.
//
// This file is a *decoder*, not a model of the domain. Every number in it was
// computed on the edge by src/lib/forecast.js. Nothing here derives a verdict,
// a clear-time, a rating threshold, or a trend — that is the entire reason the
// endpoint exists (docs/forecast-api-contract.md §6, platform plan §2). A
// native app that recomputes a clear-time from `hours` is a bug even when it
// agrees.
//
// Decoding rules the contract imposes, all implemented here:
//   • unknown fields are ignored, never rejected (additive changes ship
//     without a version bump);
//   • unknown *enum cases* decode to `.unknown` rather than throwing;
//   • every documented null is an Optional — a null is not an error;
//   • `v != 1` is "unavailable", not a partial parse (see ForecastEnvelope).

import Foundation

// MARK: - Envelope

/// Either a forecast or the error shape. The endpoint uses one envelope for
/// both so a decoder never sees two shapes (contract §9).
public enum ForecastEnvelope: Sendable {
    case forecast(Forecast)
    case failure(ForecastAPIError)
}

public struct ForecastAPIError: Decodable, Sendable, Equatable {
    public enum Code: String, Decodable, Sendable {
        case badCoords = "bad-coords"
        case upstreamFailed = "upstream-failed"
        case noSeries = "no-series"
        case internalError = "internal"
        case unknown

        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Code(rawValue: raw) ?? .unknown
        }
    }

    public let code: Code
    public let message: String
}

// MARK: - Forecast

public struct Forecast: Decodable, Sendable, Equatable {

    /// The only version this build understands. A payload with any other `v`
    /// must be treated as unavailable — see `ForecastDecoder`.
    public static let supportedVersion = 1

    public let v: Int
    public let generatedAt: Date
    public let location: Location
    public let now: Now
    public let window: Window
    public let source: SourceInfo
    public let scale: [ScaleEntry]
    public let hours: [Hour]
    public let verdict: Verdict
    public let days: [Day]
    public let pastDays: [PastDay]
    public let measured: Measured
    public let agreement: AgreementSummary

    // MARK: Location

    public struct Coordinates: Decodable, Sendable, Equatable {
        public let lat: Double
        public let lon: Double
    }

    public struct Location: Decodable, Sendable, Equatable {
        /// What the client sent. Clients send *real* coordinates and read
        /// `snapped` back; pre-snapping forks a future lattice change.
        public let requested: Coordinates
        /// What was actually fetched — the 0.1° lattice from src/lib/grid.js.
        public let snapped: Coordinates
        /// IANA zone. Never null; "UTC" is the degenerate fallback.
        public let timezone: String
        /// Offset in effect at `now` *only*. Not valid across a DST boundary —
        /// use `timezone` with the platform zone database for arbitrary hours.
        public let utcOffsetSeconds: Int

        /// The zone every label in this payload was formatted in.
        public var timeZone: TimeZone {
            TimeZone(identifier: timezone) ?? TimeZone(secondsFromGMT: utcOffsetSeconds) ?? .gmt
        }
    }

    // MARK: Now

    public struct Now: Decodable, Sendable, Equatable {
        /// Always a valid index into `hours`. Accurate to ±30 minutes by
        /// construction, and may be one bucket stale from the 10-minute cache.
        public let index: Int
        public let timeUTC: Date
        /// The instant the server used.
        public let exactUTC: Date
    }

    public struct Window: Decodable, Sendable, Equatable {
        public let pastHours: Int
        public let forecastHours: Int
    }

    // MARK: Source

    public enum MeasurementSource: String, Decodable, Sendable, Equatable {
        case official, local, model
        case unknown

        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = MeasurementSource(rawValue: raw) ?? .unknown
        }
    }

    public struct SourceInfo: Decodable, Sendable, Equatable {
        public let requested: MeasurementSource
        /// Degrades official → local → model when the requested row is absent.
        public let applied: MeasurementSource
        /// The forecast model behind `pm25Model`, e.g. "cams-global".
        public let model: String
    }

    // MARK: Scale

    /// One rung of the rating ladder. All five ship in every response so that
    /// no client hardcodes health copy — CLAUDE.md requires the disclaimer and
    /// explainer copy to ship verbatim, and copy pasted into a Swift file is
    /// copy that drifts.
    public struct ScaleEntry: Decodable, Sendable, Equatable, Identifiable {
        public enum Key: String, Decodable, Sendable, Equatable {
            case allClear = "all-clear"
            case something
            case smells
            case tastes
            case smokeshow
            case unknown

            public init(from decoder: Decoder) throws {
                let raw = try decoder.singleValueContainer().decode(String.self)
                self = Key(rawValue: raw) ?? .unknown
            }
        }

        public struct Guidance: Decodable, Sendable, Equatable {
            public let general: String
            /// One rung stricter, for sensitive households. Which one a client
            /// shows is a local preference; both always ship.
            public let sensitive: String
        }

        public let index: Int
        public let key: Key
        public let name: String
        public let rangeUg: String
        /// Null on index 4 only (unbounded).
        public let maxUg: Double?
        public let visibility: String
        public let notice: String
        public let notLine: String
        public let guidance: Guidance

        public var id: Int { index }
    }

    // MARK: Hours

    public enum HourTrend: String, Decodable, Sendable, Equatable {
        case rising, falling, steady
        case unknown

        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = HourTrend(rawValue: raw) ?? .unknown
        }
    }

    public enum Agreement: String, Decodable, Sendable, Equatable {
        case agree, fade, diverge
        case unknown

        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Agreement(rawValue: raw) ?? .unknown
        }
    }

    public struct Hour: Decodable, Sendable, Equatable {
        public let t: Date
        /// Delivered series: model plus the measured anchor. **Null is real.**
        /// Render an unknown hour, never 0 — 0 µg/m³ is a claim about clean
        /// air and would be a lie (contract §4).
        public let pm25: Double?
        public let pm25Model: Double?
        public let aqi: Int?
        /// Index into `scale`. Null exactly when `pm25` is null.
        public let levelIndex: Int?
        public let trend: HourTrend?
        public let agreement: Agreement
        /// Never null in v1; Optional so a future `?sky=off` can omit it.
        public let sky: Sky?

        /// True when the model has no value for this hour.
        public var isGap: Bool { pm25 == nil }
    }

    // MARK: Sky

    public struct Sky: Decodable, Sendable, Equatable {
        public struct Smoke: Decodable, Sendable, Equatable {
            public let s1: Double
            public let s2: Double
        }

        public struct Sun: Decodable, Sendable, Equatable {
            public let altitudeDeg: Double
            public let azimuthDeg: Double
            public let visible: Bool
            /// 0 = left/east … 1 = right/west.
            public let xFrac: Double
            /// 0 = top … 1 = bottom.
            public let yFrac: Double
            /// 0 clear → 1 smoke-dimmed.
            public let dim: Double
        }

        /// The moon, computed on the edge next to the sun so every client paints
        /// the identical phase and position rather than each running its own
        /// ephemeris. Emitted even below the horizon (negative altitude) — the
        /// renderer fades it in as it rises.
        public struct Moon: Decodable, Sendable, Equatable {
            public let altitudeDeg: Double
            public let azimuthDeg: Double
            public let visible: Bool
            /// 0 = left/east … 1 = right/west.
            public let xFrac: Double
            /// 0 = top … 1 = bottom.
            public let yFrac: Double
            /// 0 new … 0.5 full … 1 new again.
            public let phaseFraction: Double
        }

        public let zenith: RGB
        public let mid: RGB
        public let horizon: RGB
        /// The ink inversion. Paint the foreground light when true; do not
        /// re-derive it from the colours.
        public let isDark: Bool
        public let starOpacity: Double
        public let smoke: Smoke
        public let sun: Sun
        public let moon: Moon
    }

    /// `[r, g, b]`, each 0–255. Integer triples, not CSS strings, so every
    /// platform builds its own colour type without parsing.
    public struct RGB: Decodable, Sendable, Equatable {
        public let r: Int
        public let g: Int
        public let b: Int

        public init(r: Int, g: Int, b: Int) {
            self.r = r
            self.g = g
            self.b = b
        }

        public init(from decoder: Decoder) throws {
            var container = try decoder.unkeyedContainer()
            r = try container.decode(Int.self)
            g = try container.decode(Int.self)
            b = try container.decode(Int.self)
        }
    }

    // MARK: Verdict

    /// The answer. Every field here was computed once, on the edge. Render
    /// `headline`, `clearLabel`, and `arrivalLabel` verbatim.
    public struct Verdict: Decodable, Sendable, Equatable {
        public enum Trend: String, Decodable, Sendable, Equatable {
            case clearing, stuck, worsening, steady
            case unknown

            public init(from decoder: Decoder) throws {
                let raw = try decoder.singleValueContainer().decode(String.self)
                self = Trend(rawValue: raw) ?? .unknown
            }
        }

        /// PM2.5 at `now` is ≥ 35 µg/m³ ("Hazy").
        public let above: Bool
        public let levelIndex: Int
        public let trend: Trend
        /// One of exactly five sentences. Render as-is: it is the one string
        /// guaranteed identical on a user's phone and their laptop.
        public let headline: String

        /// First hour below 35 µg/m³ that holds for 6. Null together with its
        /// siblings when `above` is false or no sustained clear exists.
        public let clearIndex: Int?
        public let clearAtUTC: Date?
        /// "Thursday ~6 PM". The tilde is required — the forecast is an
        /// estimate and the label must say so.
        public let clearLabel: String?

        /// First hour at or above 35 µg/m³ that holds for 3.
        public let arrivalIndex: Int?
        public let arrivalAtUTC: Date?
        public let arrivalLabel: String?

        /// Never null — worst case the peak is `now` itself.
        public let peakIndex: Int
        public let peakAtUTC: Date
        public let peakPm25: Double?
    }

    // MARK: Days

    public struct DayPart: Decodable, Sendable, Equatable, Identifiable {
        public enum Key: String, Decodable, Sendable, Equatable {
            case morning, afternoon, evening
            case unknown

            public init(from decoder: Decoder) throws {
                let raw = try decoder.singleValueContainer().decode(String.self)
                self = Key(rawValue: raw) ?? .unknown
            }
        }

        /// The coarse 4-step strip scale — *not* the 5-level rating scale.
        /// Do not cross-index them.
        public struct Bucket: Decodable, Sendable, Equatable {
            public let name: String
            /// `#rrggbb`, straight from the server.
            public let color: String
        }

        public let key: Key
        public let label: String
        /// Null when no hour of the day fell in this part — commonly today's
        /// already-elapsed parts.
        public let bucket: Bucket?

        public var id: String { key.rawValue }
    }

    public struct Day: Decodable, Sendable, Equatable, Identifiable {
        /// Local calendar date, `YYYY-MM-DD`, in `location.timezone`.
        public let key: String
        public let weekday: String
        /// Level of the day's *worst* hour. Null when every hour is null.
        public let levelIndex: Int?
        public let minPm25: Double?
        public let maxPm25: Double?
        /// Always exactly 3, in morning/afternoon/evening order.
        public let dayParts: [DayPart]

        public var id: String { key }
    }

    /// Model estimate, never observation. A client that shows these must say
    /// so — `Copy.modelEstimate` exists for exactly this.
    public struct PastDay: Decodable, Sendable, Equatable, Identifiable {
        public let key: String
        public let weekday: String
        public let levelIndex: Int?
        public let minPm25: Double?
        public let maxPm25: Double?

        public var id: String { key }
    }

    // MARK: Measured

    /// Official, local, model. **Never averaged** — during fast-moving smoke a
    /// regulatory monitor 38 miles away and a cluster of consumer sensors 8
    /// miles away legitimately disagree, and blending them yields a number
    /// neither source said.
    public struct Measured: Decodable, Sendable, Equatable {
        public struct Row: Decodable, Sendable, Equatable {
            public let ug: Double
            public let aqi: Int
            public let count: Int
            public let area: String?
            public let distanceMi: Double?
            public let medianDistanceMi: Double?
            /// AirNow's own local wall-clock stamp — no zone, no `Z`.
            /// Display-only. Do not parse it into an instant.
            public let observedAt: String?
        }

        public struct ModelRow: Decodable, Sendable, Equatable {
            public let ug: Double?
            public let aqi: Int?
        }

        /// What was done to the model series to produce `hours[].pm25`.
        public struct Anchor: Decodable, Sendable, Equatable {
            public let source: MeasurementSource
            public let offsetUg: Double
            public let decayHours: Double
        }

        public let official: Row?
        public let local: Row?
        public let model: ModelRow
        /// Never null. `.model` with `offsetUg == 0` means nothing measured
        /// was available.
        public let anchor: Anchor
    }

    // MARK: Agreement

    public struct AgreementSummary: Decodable, Sendable, Equatable {
        /// v1 always false: the endpoint compares one model against lead time,
        /// not against a second model.
        public let multiModel: Bool
        public let diverged: Bool
        /// Display copy — render this string.
        public let label: String
    }
}
