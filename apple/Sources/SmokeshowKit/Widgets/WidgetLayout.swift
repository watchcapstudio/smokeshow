// The families, named locally.
//
// WidgetKit's `WidgetFamily` is not used inside SmokeshowKit on purpose: the
// kit is shared with the watch target (whose family list differs) and with
// tests (which have no WidgetKit). The extension maps `WidgetFamily` onto this
// enum in one place, and every layout decision downstream is made against it.
//
// Demo → family, from platform plan §3:
//   .w-small 148×148  → systemSmall        (designed)
//   .w-med   296×140  → systemMedium       (designed)
//   .lk-inline        → accessoryInline    (designed)
//   .acc-circ ×2      → accessoryCircular  (designed — PM arc and countdown)
//   .acc-rect         → accessoryRectangular (designed)
//   —                 → systemLarge        (designed here; the demo has none)
//   —                 → systemExtraLarge   (designed here; iPad and Mac)
//
// macOS gets the `system*` families only — it has no lock screen, so no
// accessory family exists there.

import Foundation

public enum WidgetLayout: String, Sendable, CaseIterable {
    case systemSmall
    case systemMedium
    case systemLarge
    case systemExtraLarge
    case accessoryInline
    /// The PM arc: current reading, level colour, one glyph of trend.
    case accessoryCircularPM
    /// The countdown arc: hours to clear, or hours to smoke.
    case accessoryCircularCountdown
    case accessoryRectangular
    /// watchOS corner complication.
    case accessoryCorner

    public var isAccessory: Bool {
        switch self {
        case .systemSmall, .systemMedium, .systemLarge, .systemExtraLarge: return false
        default: return true
        }
    }

    /// Accessory families are tinted by the system and rendered monochrome on
    /// the lock screen; they must not depend on colour to carry meaning.
    public var isMonochrome: Bool { isAccessory }
}
