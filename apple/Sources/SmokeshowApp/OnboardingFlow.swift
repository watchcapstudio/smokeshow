// Five screens before the first forecast.
//
// The order is the argument: what this is, then two screens of what it can do
// once you pay for it, then what it isn't, and only then the ask. The two value
// screens run on a canned Bozeman payload (`smoke-now-clearing`) and a bundled
// map clip, because there is no real forecast yet — the reader has not named a
// place. They are a tease, deliberately ahead of the paywall the trial exists
// to reach.
//
// The words in the disclaimer screen are `Copy.disclaimer` verbatim — the
// brief's text, enforced by `ParityTests`. What changed is that it is read once,
// deliberately, instead of scrolled past daily.

import SwiftUI
import SmokeshowKit

struct OnboardingFlow: View {
    /// Called once the reader has been through all screens. The location answer
    /// is deliberately not reported: declining is a valid way to finish, and the
    /// place picker is the other door.
    let onFinish: () -> Void

    @EnvironmentObject private var model: AppModel
    @State private var step = 0
    @State private var isLocating = false

    private static let lastStep = 4

    /// A canned smoky-then-clearing payload for the two value screens, shifted
    /// onto today's clock so the widget and curve render like the real thing.
    /// Decoded once — a struct's body runs often and this parses JSON.
    private static let mockShowcase: (forecast: Forecast, place: Place)? = {
        let place = Place(name: "Bozeman, Montana", latitude: 45.6796, longitude: -111.0448)
        let data = MockForecast.shiftedToNow(.smokeNowClearing)
        if case .forecast(let forecast)? = try? ForecastDecoder.decode(data) {
            return (forecast, place)
        }
        if let forecast = MockForecast.load(.smokeNowClearing) {
            return (forecast, place)
        }
        return nil
    }()

    var body: some View {
        ZStack {
            SkyBackdrop(sky: sky).ignoresSafeArea()

            VStack(alignment: .leading, spacing: 20) {
                progress

                Spacer(minLength: 0)

                switch step {
                case 0: whatItDoes
                case 1: watchItMove
                case 2: widgets
                case 3: whatItIsNot
                default: theAsk
                }

                Spacer(minLength: 0)

                actions
            }
            .padding(24)
            .foregroundStyle(Palette.dark.text)
        }
        .animation(.easeInOut(duration: 0.25), value: step)
        // The edge swipe people already expect from a navigation stack, which
        // this deliberately is not — it is five states in one view, so the
        // gesture has to be spelled out.
        .gesture(
            DragGesture(minimumDistance: 30)
                .onEnded { value in
                    guard abs(value.translation.height) < 60 else { return }
                    if value.translation.width > 60, step > 0 {
                        step -= 1
                    } else if value.translation.width < -60, step < Self.lastStep {
                        step += 1
                    }
                }
        )
    }

    /// A calm sky for the lead-in; the ask sits under the same one so it does
    /// not feel like a different app.
    private var sky: Forecast.Sky? { model.forecast?.nowHour?.sky }

    private var progress: some View {
        HStack(spacing: 12) {
            // Screens with no way back is a hallway, not an introduction.
            // Someone who skimmed a screen should be able to return to it
            // without deleting the app.
            if step > 0 {
                Button { step -= 1 } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 14, weight: .semibold))
                        .opacity(0.7)
                }
                .buttonStyle(.plain)
                .transition(.opacity)
            }

            HStack(spacing: 6) {
                ForEach(0...Self.lastStep, id: \.self) { index in
                    Capsule()
                        .fill(Color.white.opacity(index == step ? 0.75 : 0.22))
                        .frame(width: index == step ? 22 : 8, height: 4)
                }
            }

            Spacer()
        }
        .frame(height: 20)
    }

    // MARK: The screens

    private var whatItDoes: some View {
        VStack(alignment: .leading, spacing: 16) {
            // The product's own picture, not a stock icon: a smoke event
            // arriving and lifting, drawn by the same view the verdict screen
            // uses.
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

    private var watchItMove: some View {
        VStack(alignment: .leading, spacing: 16) {
            // A short, silent, looping clip of the map running its −12h…+48h
            // sweep. iOS only, which is where the map lives; macOS shows the
            // curve it already has.
            Group {
                #if os(iOS)
                LoopingVideoView(resource: "onboarding-map", ext: "mp4")
                #else
                CurveView(points: Self.exampleCurve, nowIndex: 18, ink: Palette.dark.text, showsNowMark: false)
                    .padding(.vertical, 20)
                #endif
            }
            .frame(height: 200)
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

            eyebrow

            Text("Watch it move.")
                .font(Typography.display)
                .minimumScaleFactor(0.6)
                .lineLimit(2)

            Text("""
                Press play and run the plume forward. Twelve hours back, two \
                days ahead, in one sweep. See where it is going, not just \
                where it is.
                """)
                .font(Typography.base)
                .opacity(0.82)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var widgets: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let mock = Self.mockShowcase {
                WidgetShowcase(forecastOverride: mock.forecast, placeOverride: mock.place)
                    .frame(maxWidth: .infinity)
            }

            eyebrow

            Text("The answer without opening the app.")
                .font(Typography.display)
                .minimumScaleFactor(0.6)
                .lineLimit(2)

            Text("""
                Home and lock screen widgets, plus an alert the moment it \
                changes. Glance down and the answer is already there.
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

    /// The small mono label that marks the two paid screens for what they are.
    private var eyebrow: some View {
        Text("With a subscription")
            .font(Typography.eyebrow)
            .foregroundStyle(Palette.dark.accent)
            .opacity(0.9)
    }

    // MARK: Buttons

    @ViewBuilder
    private var actions: some View {
        VStack(spacing: 10) {
            switch step {
            case 0, 1:
                primary("Continue") { step += 1 }
            case 2:
                primary("Continue") { step = 3 }
            case 3:
                primary("I understand") { step = 4 }
            default:
                primary(isLocating ? "Finding you…" : "Use my location") {
                    Task {
                        isLocating = true
                        // Resolve the place here, but let the main screen run
                        // the first forecast fetch so its loading screen is
                        // actually seen (not spent behind "Finding you…").
                        await model.useCurrentLocation(fetch: false)
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
    ///
    /// The numbers avoid the rating thresholds — `ParityTests` flags any of
    /// them appearing as a literal, and it is right to: a drawing that happens
    /// to contain 35 is one careless edit away from being read as one.
    private static let exampleCurve: [CurvePoint] = {
        let shape: [Double] = [
            6, 6, 7, 7, 8, 9, 11, 14, 19, 26, 34, 46, 58, 70, 80, 87, 91, 92,
            90, 85, 77, 67, 56, 44, 36, 28, 22, 17, 13, 11, 9, 8, 7, 7, 6, 6
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
