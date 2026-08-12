// Five full-bleed screens before the first forecast.
//
// The design is the mock Kelly signed off: each screen is edge-to-edge media
// with a dark scrim rising from the bottom and the copy set over it, not a
// centered illustration with text beneath. The order is the argument: what this
// is (the app's own sky), two screens of what a subscription buys (the map's
// play sweep, the widgets), what it isn't (the disclaimer), and only then the
// ask. The two value screens run on a canned Bozeman payload and a bundled
// clip, because the reader has not named a place yet.
//
// The disclaimer words are `Copy.disclaimer` verbatim — the brief's text,
// enforced by `ParityTests`.

import SwiftUI
import SmokeshowKit

struct OnboardingFlow: View {
    /// Called once the reader has been through all screens. Declining location
    /// is a valid way to finish, so the answer is not reported.
    let onFinish: () -> Void

    @EnvironmentObject private var model: AppModel
    @State private var step = 0
    @State private var isLocating = false

    private static let lastStep = 4
    private func hasMedia(_ step: Int) -> Bool { step <= 2 }

    /// A canned smoky-then-clearing payload, shifted onto today's clock, for the
    /// sky on screen one and the widgets on screen three. Decoded once.
    private static let mock: (forecast: Forecast, place: Place)? = {
        let place = Place(name: "Bozeman, Montana", latitude: 45.6796, longitude: -111.0448)
        let data = MockForecast.shiftedToNow(.smokeNowClearing)
        if case .forecast(let forecast)? = try? ForecastDecoder.decode(data) {
            return (forecast, place)
        }
        if let forecast = MockForecast.load(.smokeNowClearing) { return (forecast, place) }
        return nil
    }()

    private static let mockEntry: WidgetEntryModel? = {
        guard let mock else { return nil }
        return TimelineBuilder.build(
            forecast: mock.forecast,
            place: mock.place,
            entitlement: EntitlementSnapshot(status: .subscribed(renewsAt: nil))
        ).entries.first ?? TimelineBuilder.placeholder(place: mock.place)
    }()

    /// A warm, low-sun hour from the fixture rather than the midday haze at
    /// `now` — the app's own sky, at its best-looking time of day.
    private static let mockSky: Forecast.Sky? = {
        guard let forecast = mock?.forecast else { return nil }
        let lowSun = forecast.hours.compactMap(\.sky)
            .filter { $0.sun.visible }
            .max { $0.sun.yFrac < $1.sun.yFrac }
        return lowSun ?? forecast.nowHour?.sky
    }()

    /// The video's first frame, shown instantly so the map card never flashes
    /// black while AVPlayer spins up.
    #if os(iOS)
    private static let mapPoster: UIImage? = Bundle.main
        .url(forResource: "onboarding-map-poster", withExtension: "jpg")
        .flatMap { UIImage(contentsOfFile: $0.path) }
    #endif

    var body: some View {
        ZStack(alignment: .bottom) {
            media
                .ignoresSafeArea()

            if hasMedia(step) {
                // The opacity view Kelly wanted back: media reads clean up top,
                // the copy reads clean over the dark foot.
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: Palette.dark.bg.opacity(0.62), location: 0.42),
                        .init(color: Palette.dark.bg, location: 0.86),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(maxHeight: .infinity, alignment: .bottom)
                .ignoresSafeArea(edges: .bottom)
            }

            content
                .padding(24)

            // Progress + back, over a short top scrim so they stay legible on
            // a bright sky.
            VStack {
                LinearGradient(colors: [Palette.dark.bg.opacity(0.55), .clear],
                               startPoint: .top, endPoint: .bottom)
                    .frame(height: 120)
                    .ignoresSafeArea(edges: .top)
                Spacer()
            }
            .allowsHitTesting(false)

            VStack {
                progress.padding(.horizontal, 24).padding(.top, 8)
                Spacer()
            }
        }
        .foregroundStyle(Palette.dark.text)
        .animation(.easeInOut(duration: 0.25), value: step)
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

    // MARK: Media (full-bleed, per screen)

    @ViewBuilder
    private var media: some View {
        switch step {
        case 0:
            // The app's own sky, at a warm hour.
            SkyBackdrop(sky: Self.mockSky, showsSun: true)
        case 1:
            // A short, silent, looping clip of the map running its −12h…+48h
            // sweep. iOS only, which is where the map lives. The poster frame
            // sits underneath so there is no black while the player loads.
            ZStack {
                Palette.dark.bg
                #if os(iOS)
                if let poster = Self.mapPoster {
                    Image(uiImage: poster)
                        .resizable()
                        .scaledToFill()
                }
                LoopingVideoView(resource: "onboarding-map", ext: "mp4")
                #endif
            }
        case 2:
            // Home and lock widgets over a home-screen wash.
            ZStack {
                LinearGradient(colors: [Color(red: 0.23, green: 0.28, blue: 0.35),
                                        Color(red: 0.09, green: 0.11, blue: 0.14)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                widgetPair
                    .frame(maxHeight: .infinity, alignment: .top)
                    .padding(.top, 120)
            }
        default:
            Palette.dark.bg
        }
    }

    /// The two widgets that render cleanly at this size — the small home tile
    /// and the lock-screen rectangular. The medium tile clips its text here and
    /// is deliberately left out.
    @ViewBuilder
    private var widgetPair: some View {
        if let entry = Self.mockEntry {
            VStack(spacing: 18) {
                SmokeshowWidgetView(entry: entry, layout: .systemSmall)
                    .frame(width: 158, height: 158)
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .shadow(color: .black.opacity(0.35), radius: 14, y: 8)
                #if os(iOS)
                AccessoryRectangularView(entry: entry)
                    .frame(width: 236, height: 64)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(.white.opacity(0.14)))
                #endif
            }
        }
    }

    // MARK: Copy (over the scrim / on the dark foot)

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 12) {
            Spacer(minLength: 0)

            switch step {
            case 0:
                eyebrow("Smokeshow", accent: false)
                headline("When does the smoke clear?")
                body("""
                    One question about wildfire smoke where you are: how bad is \
                    the air, and when does it lift. No accounts, no feed.
                    """)
            case 1:
                eyebrow("With a subscription", accent: true)
                headline("Watch it move.")
                body("""
                    Press play and run the plume forward. Twelve hours back, two \
                    days ahead, in one sweep. See where it is going, not just \
                    where it is.
                    """)
            case 2:
                eyebrow("With a subscription", accent: true)
                headline("The answer without opening the app.")
                body("""
                    Home and lock screen widgets, plus an alert the moment it \
                    changes. Glance down and the answer is already there.
                    """)
            case 3:
                headline("Before you rely on it")
                body(Copy.disclaimer)
            default:
                Image(systemName: "location")
                    .font(.system(size: 30, weight: .light))
                    .opacity(0.85)
                headline("Where should we watch?")
                body("""
                    Smokeshow needs a place to forecast. Your location is used \
                    once to fetch the air where you are, never stored on a \
                    server and never tied to an account.
                    """)
                Text("You can search for a place instead, any time.")
                    .font(Typography.eyebrow)
                    .opacity(0.55)
            }

            actions.padding(.top, 6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func eyebrow(_ text: String, accent: Bool) -> some View {
        Text(text)
            .font(Typography.eyebrow)
            .foregroundStyle(accent ? Palette.dark.accent : Palette.dark.textDim)
            .opacity(accent ? 0.95 : 0.85)
    }

    private func headline(_ text: String) -> some View {
        Text(text)
            .font(Typography.display)
            .minimumScaleFactor(0.6)
            .lineLimit(3)
    }

    private func body(_ text: String) -> some View {
        Text(text)
            .font(Typography.base)
            .opacity(0.85)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: Progress + buttons

    private var progress: some View {
        HStack(spacing: 12) {
            if step > 0 {
                Button { step -= 1 } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 14, weight: .semibold))
                        .opacity(0.8)
                }
                .buttonStyle(.plain)
                .transition(.opacity)
            }
            HStack(spacing: 6) {
                ForEach(0...Self.lastStep, id: \.self) { index in
                    Capsule()
                        .fill(Color.white.opacity(index == step ? 0.8 : 0.28))
                        .frame(width: index == step ? 22 : 8, height: 4)
                }
            }
            Spacer()
        }
        .frame(height: 20)
    }

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
