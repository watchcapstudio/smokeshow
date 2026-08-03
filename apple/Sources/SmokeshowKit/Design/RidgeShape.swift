// The ridgeline is the visibility gauge.
//
// Two silhouettes: the far ridge dissolves first, the near one goes soft, then
// both are gone. It is the demo's mechanic (`setRidge`, demo:1045) and it is
// the only place in the app where a PM value drives a visual directly — which
// is fine, because "how far can you see" is exactly what PM2.5 means to a
// person, and the ladder itself still comes from `scale[]`.

import SwiftUI

struct RidgeShape: Shape {
    enum Layer { case far, near }

    let layer: Layer

    /// Both paths are drawn in a 100×40 space and scaled, so they match the
    /// SVG the web renders point for point.
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 100
        let sy = rect.height / 40
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy)
        }

        var path = Path()
        switch layer {
        case .far:
            path.move(to: p(0, 40))
            path.addLine(to: p(0, 26))
            path.addQuadCurve(to: p(22, 20), control: p(12, 13))
            path.addQuadCurve(to: p(44, 11), control: p(32, 27))
            path.addQuadCurve(to: p(68, 16), control: p(56, 1))
            path.addQuadCurve(to: p(88, 17), control: p(79, 27))
            path.addQuadCurve(to: p(100, 20), control: p(95, 12))
            path.addLine(to: p(100, 40))
        case .near:
            path.move(to: p(0, 40))
            path.addLine(to: p(0, 33))
            path.addQuadCurve(to: p(34, 30), control: p(18, 24))
            path.addQuadCurve(to: p(62, 26), control: p(48, 36))
            path.addQuadCurve(to: p(88, 28), control: p(76, 17))
            path.addQuadCurve(to: p(100, 30), control: p(95, 34))
            path.addLine(to: p(100, 40))
        }
        path.closeSubpath()
        return path
    }
}

public struct RidgeView: View {
    private let pm25: Double?
    private let strength: Double

    /// - Parameters:
    ///   - pm25: the delivered reading for the hour being drawn. Nil (a model
    ///     gap) draws the ridge at full clarity rather than inventing haze.
    ///   - strength: overall opacity multiplier; the phone screen uses 0.55,
    ///     widgets use 1.
    public init(pm25: Double?, strength: Double = 1) {
        self.pm25 = pm25
        self.strength = strength
    }

    public var body: some View {
        let value = pm25 ?? 0
        // Haze pools in the valleys: solid at the peaks, dissolving toward the
        // base. Same curve constants as the web.
        let far = (1 - clamp01((value - 6) / 26)) * 0.42 * strength
        let near = (1 - clamp01((value - 20) / 110)) * 0.58 * strength
        let inkTop = Color(.sRGB, red: 0.118, green: 0.102, blue: 0.078, opacity: 1)

        ZStack {
            RidgeShape(layer: .far)
                .fill(LinearGradient(
                    colors: [inkTop.opacity(far), inkTop.opacity(0)],
                    startPoint: .top,
                    endPoint: .bottom
                ))
            RidgeShape(layer: .near)
                .fill(LinearGradient(
                    colors: [inkTop.opacity(near), inkTop.opacity(0)],
                    startPoint: .top,
                    endPoint: .bottom
                ))
        }
        .allowsHitTesting(false)
    }

    private func clamp01(_ v: Double) -> Double { min(max(v, 0), 1) }
}
