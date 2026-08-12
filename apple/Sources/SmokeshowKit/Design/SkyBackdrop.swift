// The sky, painted from `hours[].sky`.
//
// There is no solar maths in this file. NOAA/Meeus runs once on the edge
// (src/lib/sky.js) and ships three RGB triples, a sun position in screen
// fractions, a star opacity, and — importantly — `isDark`, the ink inversion.
// Contract §4: "clients should not re-derive it from the colours."

import SwiftUI

public struct SkyBackdrop: View {
    private let sky: Forecast.Sky?
    private let showsSun: Bool
    private let showsStars: Bool

    public init(sky: Forecast.Sky?, showsSun: Bool = true, showsStars: Bool = true) {
        self.sky = sky
        self.showsSun = showsSun
        self.showsStars = showsStars
    }

    public var body: some View {
        GeometryReader { geometry in
            ZStack {
                gradient
                if showsStars, let sky, sky.starOpacity > 0.01 {
                    StarField(opacity: sky.starOpacity)
                }
                if showsSun, let sky, sky.sun.visible {
                    sun(for: sky, in: geometry.size)
                }
            }
        }
    }

    private var gradient: LinearGradient {
        guard let sky else {
            return LinearGradient(
                colors: [Palette.dark.bg, Palette.dark.bgPanel],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        return LinearGradient(
            stops: [
                .init(color: sky.zenith.color, location: 0),
                .init(color: sky.mid.color, location: 0.52),
                .init(color: sky.horizon.color, location: 1),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// Smoke does not hide the sun, it *dims* it: the disc stays put and the
    /// halo tightens and warms as `dim` rises. That is the whole visual idea —
    /// the sky is the illustration now (platform plan §9).
    private func sun(for sky: Forecast.Sky, in size: CGSize) -> some View {
        let dim = sky.sun.dim
        let core = Color(
            .sRGB,
            red: lerp(1.0, 0.808, dim),
            green: lerp(0.965, 0.431, dim),
            blue: lerp(0.878, 0.188, dim),
            opacity: 1
        )
        let diameter = min(size.width, size.height) * 0.55
        return RadialGradient(
            colors: [core, core.opacity(0.85), .clear],
            center: .center,
            startRadius: 0,
            endRadius: diameter * (0.5 - 0.24 * dim)
        )
        .frame(width: diameter, height: diameter)
        .position(
            x: size.width * sky.sun.xFrac,
            y: size.height * sky.sun.yFrac
        )
        .allowsHitTesting(false)
    }

    private func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double {
        a + (b - a) * min(max(t, 0), 1)
    }
}

/// Fixed positions, matching the demo's ten-star field. Randomising them makes
/// the widget flicker between timeline entries.
struct StarField: View {
    let opacity: Double

    private static let positions: [(Double, Double)] = [
        (0.12, 0.10), (0.30, 0.06), (0.52, 0.13), (0.70, 0.08), (0.86, 0.16),
        (0.22, 0.22), (0.62, 0.24), (0.80, 0.30), (0.40, 0.17), (0.08, 0.30),
    ]

    var body: some View {
        GeometryReader { geometry in
            ForEach(Array(Self.positions.enumerated()), id: \.offset) { _, point in
                Circle()
                    .fill(Color.white)
                    .frame(width: 1.6, height: 1.6)
                    .position(x: geometry.size.width * point.0, y: geometry.size.height * point.1)
            }
            .opacity(opacity)
        }
        .allowsHitTesting(false)
    }
}

public extension Forecast.RGB {
    var color: Color {
        Color(.sRGB, red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255, opacity: 1)
    }
}

public extension Forecast.Sky {
    /// Foreground ink for this sky. The server decided; we obey.
    var ink: Color {
        isDark ? Color(Tokens.Color.Dark.text) : Color(Tokens.Color.Light.text)
    }

    var secondaryInk: Color {
        isDark ? Color(Tokens.Color.Dark.textDim) : Color(Tokens.Color.Light.textDim)
    }

    /// The ember accent for text on this sky. It flips with the ink: the bright
    /// token orange reads on a dark smoke sky but washes out on pale blue, so on
    /// a light sky it deepens to a burnt ember that keeps the clear-time line's
    /// pop while staying legible.
    var accent: Color {
        isDark
            ? Color(Tokens.Color.Dark.accent)
            : Color(.sRGB, red: 0.624, green: 0.263, blue: 0.055, opacity: 1)
    }
}
