// The bridge from design/tokens.json to SwiftUI.
//
// Tokens.generated.swift is machine-written from the same JSON the web's
// tokens.css is generated from. This file turns those numbers into SwiftUI
// types and adds nothing of its own: if a colour is not in the JSON, it does
// not belong in the app.

import SwiftUI

public extension Color {
    init(_ token: Tokens.TokenColor) {
        self.init(
            .sRGB,
            red: Double(token.r) / 255,
            green: Double(token.g) / 255,
            blue: Double(token.b) / 255,
            opacity: 1
        )
    }

    /// `#rrggbb` strings only ever arrive from the server (`dayParts[].bucket.color`).
    init?(serverHex hex: String) {
        var value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("#") { value.removeFirst() }
        guard value.count == 6, let int = UInt32(value, radix: 16) else { return nil }
        self.init(
            .sRGB,
            red: Double((int >> 16) & 0xFF) / 255,
            green: Double((int >> 8) & 0xFF) / 255,
            blue: Double(int & 0xFF) / 255,
            opacity: 1
        )
    }
}

/// Theme-aware palette. Dark is the product's default — the web sets
/// `color-scheme: dark` — but the sky and the widgets can land either side of
/// the ink inversion, so both palettes ship.
public enum Palette {

    public struct Scheme: Sendable {
        public let bg: Color
        public let bgPanel: Color
        public let border: Color
        public let text: Color
        public let textDim: Color
        public let accent: Color
    }

    public static let dark = Scheme(
        bg: Color(Tokens.Color.Dark.bg),
        bgPanel: Color(Tokens.Color.Dark.bgPanel),
        border: Color(Tokens.Color.Dark.border),
        text: Color(Tokens.Color.Dark.text),
        textDim: Color(Tokens.Color.Dark.textDim),
        accent: Color(Tokens.Color.Dark.accent)
    )

    public static let light = Scheme(
        bg: Color(Tokens.Color.Light.bg),
        bgPanel: Color(Tokens.Color.Light.bgPanel),
        border: Color(Tokens.Color.Light.border),
        text: Color(Tokens.Color.Light.text),
        textDim: Color(Tokens.Color.Light.textDim),
        accent: Color(Tokens.Color.Light.accent)
    )

    public static func scheme(for colorScheme: ColorScheme) -> Scheme {
        colorScheme == .light ? light : dark
    }

    /// The rating ladder's colours, addressed by the server's stable `key`.
    /// Level *names* and all prose come from `scale[]`; only the colour is
    /// local, because colour is design-system state and copy is not.
    public static func color(for key: Forecast.ScaleEntry.Key?) -> Color {
        switch key {
        case .some(.allClear): return Color(Tokens.Color.Dark.allClear)
        case .some(.something): return Color(Tokens.Color.Dark.something)
        case .some(.smells): return Color(Tokens.Color.Dark.smells)
        case .some(.tastes): return Color(Tokens.Color.Dark.tastes)
        case .some(.smokeshow): return Color(Tokens.Color.Dark.smokeshow)
        case .some(.unknown), .none: return Color(Tokens.Color.Dark.textDim)
        }
    }

    /// Index-addressed variant for the day strip, where only `levelIndex` ships.
    public static func color(forLevelIndex index: Int?) -> Color {
        switch index ?? -1 {
        case 0: return Color(Tokens.Color.Dark.allClear)
        case 1: return Color(Tokens.Color.Dark.something)
        case 2: return Color(Tokens.Color.Dark.smells)
        case 3: return Color(Tokens.Color.Dark.tastes)
        case 4: return Color(Tokens.Color.Dark.smokeshow)
        default: return Color(Tokens.Color.Dark.textDim)
        }
    }
}

/// The web's rem scale, as Dynamic Type-aware fonts. Sizes come from the
/// tokens; `relativeTo` keeps accessibility sizes working, which a raw
/// `.system(size:)` would not.
public enum Typography {
    public static var display: Font { .system(size: Tokens.TypeScale.display, weight: .bold) }
    public static var xl: Font { .system(size: Tokens.TypeScale.xl, weight: .bold) }
    public static var lg: Font { .system(size: Tokens.TypeScale.lg, weight: .semibold) }
    public static var md: Font { .system(size: Tokens.TypeScale.md, weight: .semibold) }
    public static var base: Font { .system(size: Tokens.TypeScale.base) }
    public static var sm: Font { .system(size: Tokens.TypeScale.sm, weight: .semibold) }
    public static var xs: Font { .system(size: Tokens.TypeScale.xs, weight: .medium) }

    /// The monospaced eyebrow used for place names and unit labels.
    public static var eyebrow: Font {
        .system(size: Tokens.TypeScale.xs, weight: .medium, design: .monospaced)
    }

    /// Widget tiles are small enough that the app's display size does not fit;
    /// these are the family-scaled variants used inside WidgetKit.
    public static func widgetWord(_ size: CGFloat) -> Font {
        .system(size: size, weight: .heavy)
    }
}

public enum Motion {
    public static var base: Animation { animation(Tokens.Motion.base) }
    public static var slow: Animation { animation(Tokens.Motion.slow) }
    public static var bounce: Animation { animation(Tokens.Motion.bounce) }

    private static func animation(_ token: Tokens.MotionToken) -> Animation {
        switch token.easing {
        case .ease: return .easeInOut(duration: token.duration)
        case .easeInOut: return .easeInOut(duration: token.duration)
        }
    }
}
