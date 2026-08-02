// Decoding the envelope, and the one rule that governs it: degrade, never crash.
//
// Contract §9: a `v` we do not recognise, an error object, a non-200, a
// non-JSON body, or a timeout all mean *the forecast is unavailable*. They do
// not mean "parse what you can". Nulls, by contrast, are the normal state of a
// real forecast and are never errors.

import Foundation

public enum ForecastDecoder {

    public static func makeJSONDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        // All timestamps are UTC ISO-8601 with a literal Z and second
        // precision. `observedAt` is deliberately a String, not a Date.
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    /// Decode a response body into the envelope.
    ///
    /// - Throws: `ForecastUnavailable` for anything that is not a v1 forecast
    ///   or a v1 error. Never throws a raw `DecodingError` at callers.
    public static func decode(_ data: Data) throws -> ForecastEnvelope {
        let decoder = makeJSONDecoder()

        // Read `v` first. A payload whose version we do not know must not be
        // partially parsed, however familiar its fields look.
        guard let version = try? decoder.decode(VersionProbe.self, from: data).v else {
            throw ForecastUnavailable.malformed
        }
        guard version == Forecast.supportedVersion else {
            throw ForecastUnavailable.unsupportedVersion(version)
        }

        if let failure = try? decoder.decode(ErrorProbe.self, from: data).error {
            return .failure(failure)
        }

        do {
            return .forecast(try decoder.decode(Forecast.self, from: data))
        } catch {
            throw ForecastUnavailable.malformed
        }
    }

    private struct VersionProbe: Decodable { let v: Int }
    private struct ErrorProbe: Decodable { let error: ForecastAPIError? }
}

/// Why a forecast could not be shown. Every case is recoverable by falling
/// back to cache or to an explicit "forecast unavailable" state — never by
/// rendering a stale number as if it were current.
public enum ForecastUnavailable: Error, Sendable, Equatable {
    /// The endpoint answered, in the contract's own error envelope.
    case api(ForecastAPIError)
    /// A `v` this build does not understand.
    case unsupportedVersion(Int)
    /// Not JSON, or JSON that is not the contract.
    case malformed
    /// Non-200 with no usable envelope.
    case http(status: Int)
    /// Network failure or timeout.
    case transport(String)
    /// No coordinates yet — location permission not granted, nothing saved.
    case noLocation

    /// One short line, safe to show a user. Deliberately does not blame them.
    public var userFacingMessage: String {
        switch self {
        case .api(let error):
            switch error.code {
            case .badCoords: return "That location didn't work. Try picking a place."
            case .upstreamFailed, .noSeries: return "The forecast service is having trouble."
            case .internalError, .unknown: return "The forecast service is having trouble."
            }
        case .unsupportedVersion:
            return "This version of the app is out of date."
        case .malformed, .http, .transport:
            return "Couldn't reach the forecast."
        case .noLocation:
            return "Pick a place to see its air."
        }
    }
}
