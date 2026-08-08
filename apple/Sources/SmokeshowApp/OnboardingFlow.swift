// Three screens before the first forecast.
//
// The order is the argument: what this is, what it isn't, and only then the
// ask. A location prompt that arrives before the reader knows what the app
// does is a prompt they decline, and the disclaimer buried under every launch
// was furniture nobody read. One of each, in the order a person would ask.
//
// The words in step two are `Copy.disclaimer` verbatim — the brief's text,
// enforced by `ParityTests`. What changed is that it is read once, deliberately,
// instead of scrolled past daily.

import SwiftUI
import SmokeshowKit

struct OnboardingFlow: View {
    /// Called once the reader has been through all three screens. The location
    /// answer is deliberately not reported: declining is a valid way to finish,
    /// and the place picker is the other door.
    let onFinish: () -> Void

    @EnvironmentObject private var model: AppModel
    @State private var step = 0
    @State private var isLocating = false

    var body: some View {
        ZStack {
            SkyBackdrop(sky: sky).ignoresSafeArea()

            VStack(alignment: .leading, spacing: 20) {
                progress

                Spacer(minLength: 0)

                switch step {
                case 0: whatItDoes
                case 1: whatItIsNot
                default: theAsk
                }

                Spacer(minLength: 0)

                actions
            }
            .padding(24)
            .foregroundStyle(Palette.dark.text)
        }
        .animation(.easeInOut(duration: 0.25), value: step)
    }

    /// A calm sky for the first two screens; the third sits under the same one
    /// so the ask does not feel like a different app.
    private var sky: Forecast.Sky? { model.forecast?.nowHour?.sky }

    private var progress: some View {
        HStack(spacing: 6) {
            ForEach(0..<3, id: \.self) { index in
                Capsule()
                    .fill(Color.white.opacity(index == step ? 0.75 : 0.22))
                    .frame(width: index == step ? 22 : 8, height: 4)
            }
        }
    }

    // MARK: The three screens

    private var whatItDoes: some View {
        VStack(alignment: .leading, spacing: 16) {
            // The product's own picture, not a stock icon: a smoke event
            // arriving and lifting, drawn by the same view the verdict screen
            // uses. (`RidgeView` is the other candidate and the wrong one here
            // — it paints dark haze, which is invisible against this sky.)
            CurveView(
                points: Self.exampleCurve,
                nowIndex: 18,
                ink: Palette.dark.text,
                showsNowMark: false
            )
            .frame(height: 132)
            .frame(maxWidth: .infinity)

            Text("When does the smoke clear?")
                .font(Typography.display)
                .minimumScaleFactor(0.6)
                .lineLimit(3)

            Text("""
                Smokeshow answers one question about wildfire smoke where you \
                are: how bad is the air, and when does it lift. No accounts, no \
                feed. Put the widget on your home screen and you never have to \
                open the app at all.
                """)
                .font(Typography.base)
                .opacity(0.82)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var whatItIsNot: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Before you rely on it")
                .font(Typography.display)
                .minimumScaleFactor(0.6)
                .lineLimit(2)

            Text(Copy.disclaimer)
                .font(Typography.base)
                .opacity(0.82)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var theAsk: some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: "location")
                .font(.system(size: 34, weight: .light))
                .opacity(0.85)

            Text("Where should we watch?")
                .font(Typography.display)
                .minimumScaleFactor(0.6)
                .lineLimit(2)

            Text("""
                Smokeshow needs a place to forecast. Your location is used once \
                to fetch the air where you are — it is never stored on a server \
                and never tied to an account.
                """)
                .font(Typography.base)
                .opacity(0.82)
                .fixedSize(horizontal: false, vertical: true)

            Text("You can search for a place instead, any time.")
                .font(Typography.eyebrow)
                .opacity(0.55)
        }
    }

    // MARK: Buttons

    @ViewBuilder
    private var actions: some View {
        VStack(spacing: 10) {
            switch step {
            case 0:
                primary("Continue") { step = 1 }
            case 1:
                primary("I understand") { step = 2 }
            default:
                primary(isLocating ? "Finding you…" : "Use my location") {
                    Task {
                        isLocating = true
                        await model.useCurrentLocation()
                        isLocating = false
                        onFinish()
                    }
                }
                .disabled(isLocating)

                Button("I'll pick a place myself") { onFinish() }
                    .font(Typography.sm)
                    .buttonStyle(.plain)
                    .opacity(0.6)
                    .padding(.top, 2)
            }
        }
    }

    /// Illustration only: a smoke event rising and clearing. Explicitly not a
    /// forecast, and never labelled as one.
    private static let exampleCurve: [CurvePoint] = {
        let shape: [Double] = [
            6, 6, 7, 7, 8, 9, 11, 14, 19, 26, 35, 46, 58, 70, 80, 87, 91, 92,
            90, 85, 77, 67, 56, 45, 36, 28, 22, 17, 13, 11, 9, 8, 7, 7, 6, 6
        ]
        let start = Date(timeIntervalSince1970: 0)
        return shape.enumerated().map { index, value in
            CurvePoint(t: start.addingTimeInterval(TimeInterval(index) * 3600), value: value)
        }
    }()

    private func primary(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(Typography.md)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(.white.opacity(0.16))
                )
        }
        .buttonStyle(.plain)
    }
}
