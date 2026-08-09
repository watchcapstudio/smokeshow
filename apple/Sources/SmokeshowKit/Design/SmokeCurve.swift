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

        // Each run of non-nil values is its own smoothed subpath. Gaps break
        // the line — a null hour is missing data, not a dip to zero.
        var run: [CGPoint] = []
        for (index, item) in points.enumerated() {
            if let value = item.value {
                run.append(point(index, value))
            } else {
                addRun(run, to: &path, rect: rect)
                run = []
            }
        }
        addRun(run, to: &path, rect: rect)
        return path
    }

    /// Draws one run of points as a Catmull-Rom spline (converted to cubic
    /// Béziers), so the smoke reads as a curve rather than a polyline. The
    /// tangents are clamped to the run's own endpoints, so a run never
    /// overshoots into a neighbouring gap.
    private func addRun(_ run: [CGPoint], to path: inout Path, rect: CGRect) {
        guard run.count > 1 else {
            // A lone point can still anchor a filled sliver under it.
            if closed, let only = run.first {
                path.move(to: only)
                path.addLine(to: CGPoint(x: only.x, y: rect.maxY))
                path.closeSubpath()
            }
            return
        }

        path.move(to: run[0])
        for i in 0..<(run.count - 1) {
            let p0 = run[max(i - 1, 0)]
            let p1 = run[i]
            let p2 = run[i + 1]
            let p3 = run[min(i + 2, run.count - 1)]
            let c1 = CGPoint(x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6)
            let c2 = CGPoint(x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6)
            path.addCurve(to: p2, control1: c1, control2: c2)
        }

        if closed {
            path.addLine(to: CGPoint(x: run[run.count - 1].x, y: rect.maxY))
            path.addLine(to: CGPoint(x: run[0].x, y: rect.maxY))
            path.closeSubpath()
        }
    }
}

/// Drag along the curve to move time.
///
/// `minimumDistance: 0` so a tap lands on an hour too, which costs the ability
/// to start a vertical scroll on the curve itself — the same trade a slider
/// makes, and the curve is only 74pt tall.
private struct ScrubGesture: ViewModifier {
    let enabled: Bool
    let width: CGFloat
    let count: Int
    let onScrub: (Int) -> Void

    func body(content: Content) -> some View {
        guard enabled, count > 1, width > 0 else { return AnyView(content) }
        return AnyView(content.gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    let step = width / CGFloat(count - 1)
                    let raw = Int((value.location.x / step).rounded())
                    onScrub(min(max(raw, 0), count - 1))
                }
        ))
    }
}

public struct CurveView: View {
    private let points: [CurvePoint]
    private let nowIndex: Int
    private let ink: Color
    private let thin: Bool
    private let showsNowMark: Bool
    /// The scrubbed hour, or nil when the reader has not moved off *now*.
    /// Passing a binding is what turns the curve from a picture into the
    /// timeline control the demo rig established.
    private let selection: Binding<Int?>?

    public init(
        points: [CurvePoint],
        nowIndex: Int,
        ink: Color,
        thin: Bool = false,
        showsNowMark: Bool = true,
        selection: Binding<Int?>? = nil
    ) {
        self.points = points
        self.nowIndex = nowIndex
        self.ink = ink
        self.thin = thin
        self.showsNowMark = showsNowMark
        self.selection = selection
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

                if let selection, let index = selection.wrappedValue,
                   points.indices.contains(index) {
                    scrubMark(at: index, in: geometry.size)
                }
            }
            .contentShape(Rectangle())
            .modifier(ScrubGesture(
                enabled: selection != nil,
                width: geometry.size.width,
                count: points.count,
                onScrub: { index in
                    guard selection?.wrappedValue != index else { return }
                    selection?.wrappedValue = index
                }
            ))
        }
        .accessibilityHidden(true)
    }

    /// The scrubbed hour: a full-height rule and a filled dot, heavier than the
    /// now mark because it is the thing the reader is currently holding.
    private func scrubMark(at index: Int, in size: CGSize) -> some View {
        let step = size.width / CGFloat(max(points.count - 1, 1))
        let x = CGFloat(index) * step
        let value = points[index].value
        return ZStack {
            Rectangle()
                .fill(ink.opacity(0.45))
                .frame(width: 1)
                .position(x: x, y: size.height / 2)
            if let value {
                Circle()
                    .fill(ink)
                    .frame(width: 7, height: 7)
                    .position(
                        x: x,
                        y: size.height - CGFloat(min(max(value / maxValue, 0), 1)) * size.height
                    )
            }
        }
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
