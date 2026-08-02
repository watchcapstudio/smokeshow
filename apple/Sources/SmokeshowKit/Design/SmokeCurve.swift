// The 61-hour curve: −12 to +48, the shape of the smoke.
//
// The one rule that matters here: **a null hour is a gap, not a zero.** The
// model returns null for hours it has no value for (contract §4), and a curve
// that draws those at the baseline invents clean air. This shape breaks the
// line instead, and `CurveView` shades the gap so it reads as missing.

import SwiftUI

struct SmokeCurveShape: Shape {
    let points: [CurvePoint]
    let maxValue: Double
    /// Close the path to the baseline for the filled area beneath the line.
    let closed: Bool

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard points.count > 1, maxValue > 0 else { return path }

        let step = rect.width / CGFloat(points.count - 1)
        func point(_ index: Int, _ value: Double) -> CGPoint {
            let x = rect.minX + CGFloat(index) * step
            let clamped = min(max(value / maxValue, 0), 1)
            let y = rect.maxY - CGFloat(clamped) * rect.height
            return CGPoint(x: x, y: y)
        }

        // Each run of non-nil values is its own subpath. Gaps break the line.
        var runStart: Int?
        for (index, item) in points.enumerated() {
            guard let value = item.value else {
                closeRun(&path, from: runStart, to: index - 1, rect: rect, step: step)
                runStart = nil
                continue
            }
            if runStart == nil {
                runStart = index
                path.move(to: point(index, value))
            } else {
                path.addLine(to: point(index, value))
            }
        }
        closeRun(&path, from: runStart, to: points.count - 1, rect: rect, step: step)
        return path
    }

    private func closeRun(_ path: inout Path, from start: Int?, to end: Int, rect: CGRect, step: CGFloat) {
        guard closed, let start, end > start else { return }
        let xEnd = rect.minX + CGFloat(end) * step
        let xStart = rect.minX + CGFloat(start) * step
        path.addLine(to: CGPoint(x: xEnd, y: rect.maxY))
        path.addLine(to: CGPoint(x: xStart, y: rect.maxY))
        path.closeSubpath()
    }
}

public struct CurveView: View {
    private let points: [CurvePoint]
    private let nowIndex: Int
    private let ink: Color
    private let thin: Bool
    private let showsNowMark: Bool

    public init(
        points: [CurvePoint],
        nowIndex: Int,
        ink: Color,
        thin: Bool = false,
        showsNowMark: Bool = true
    ) {
        self.points = points
        self.nowIndex = nowIndex
        self.ink = ink
        self.thin = thin
        self.showsNowMark = showsNowMark
    }

    /// Headroom so the peak never touches the top edge. The 55 floor keeps a
    /// clear day's curve from being amplified into drama.
    private var maxValue: Double {
        let peak = points.compactMap(\.value).max() ?? 0
        return max(55, peak * 1.18)
    }

    public var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                SmokeCurveShape(points: points, maxValue: maxValue, closed: true)
                    .fill(LinearGradient(
                        colors: [ink.opacity(thin ? 0.30 : 0.34), ink.opacity(0.02)],
                        startPoint: .top,
                        endPoint: .bottom
                    ))

                SmokeCurveShape(points: points, maxValue: maxValue, closed: false)
                    .stroke(
                        ink.opacity(thin ? 0.6 : 0.7),
                        style: StrokeStyle(
                            lineWidth: thin ? 1.2 : 1.5,
                            lineCap: .round,
                            lineJoin: .round
                        )
                    )

                if showsNowMark, points.indices.contains(nowIndex) {
                    nowMark(in: geometry.size)
                }

                gapMarkers(in: geometry.size)
            }
        }
        .accessibilityHidden(true)
    }

    private func nowMark(in size: CGSize) -> some View {
        let step = size.width / CGFloat(max(points.count - 1, 1))
        let x = CGFloat(nowIndex) * step
        let value = points[nowIndex].value
        return ZStack {
            Rectangle()
                .fill(ink.opacity(0.18))
                .frame(width: 1)
                .position(x: x, y: size.height / 2)
            if let value {
                Circle()
                    .fill(ink.opacity(0.9))
                    .frame(width: thin ? 3.6 : 4.8, height: thin ? 3.6 : 4.8)
                    .position(
                        x: x,
                        y: size.height - CGFloat(min(max(value / maxValue, 0), 1)) * size.height
                    )
            }
        }
    }

    /// A hatched band where the model has nothing to say. Without it a gap
    /// reads as a rendering bug; with it, it reads as "we don't know", which
    /// is the truth.
    private func gapMarkers(in size: CGSize) -> some View {
        let step = size.width / CGFloat(max(points.count - 1, 1))
        return ForEach(Array(points.enumerated()), id: \.offset) { index, point in
            if point.value == nil {
                Rectangle()
                    .fill(ink.opacity(0.08))
                    .frame(width: step, height: size.height)
                    .position(x: CGFloat(index) * step, y: size.height / 2)
            }
        }
    }
}
