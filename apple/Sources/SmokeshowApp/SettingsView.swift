// Settings. Short on purpose.
//
// The notification section ships the platform plan's posture verbatim —
// "Threshold alerts only. No digests, no streaks, no engagement pings." — and
// there is nothing here to switch on that contradicts it.

import SwiftUI
import SmokeshowKit

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var showsWidgetOnboarding = false

    var body: some View {
        ZStack {
            Palette.dark.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HStack {
                        Text("Settings").font(Typography.xl)
                        Spacer()
                        Button("Done") { dismiss() }.font(Typography.sm).opacity(0.6)
                    }

                    // First, because it is the thing the product is for: the
                    // widget is the glance, and the app is the place you go
                    // when the glance is not enough. Anyone who dismissed the
                    // prompt needs a way back to it that is not reinstalling.
                    section("Home screen") {
                        Button("Add a widget") { showsWidgetOnboarding = true }
                            .font(Typography.md)
                        Text("""
                            The point of Smokeshow is not opening Smokeshow. Put the widget \
                            next to the weather and the answer is just there.
                            """)
                            .font(Typography.xs)
                            .opacity(0.6)
                    }

                    section("Units") {
                        Picker("Units", selection: unitBinding) {
                            ForEach(MeasurementUnit.allCases, id: \.self) { unit in
                                Text(unit.shortLabel).tag(unit)
                            }
                        }
                        .pickerStyle(.segmented)
                    }

                    section("Reading") {
                        Picker("Source", selection: sourceBinding) {
                            ForEach(ForecastSourcePreference.allCases, id: \.self) { source in
                                Text(source.displayName).tag(source)
                            }
                        }
                        .pickerStyle(.segmented)
                        Text("""
                            Which instrument the forecast is anchored to. The verdict is recomputed \
                            on the server against your choice, so every device you own agrees.
                            """)
                            .font(Typography.xs)
                            .opacity(0.6)
                    }

                    section("Household") {
                        Toggle("Sensitive household", isOn: sensitiveBinding)
                        Text("""
                            Asthma, young kids, older adults, pregnancy, heart or lung conditions. \
                            Switches to the stricter EPA guidance line. It never leaves this device.
                            """)
                            .font(Typography.xs)
                            .opacity(0.6)
                    }

                    section("Alerts") {
                        Toggle("Smoke on the way", isOn: binding(\.notifyInbound))
                        Toggle("Worst of it", isOn: binding(\.notifyPeak))
                        Toggle("It cleared", isOn: binding(\.notifyClear))
                        Toggle("Quiet hours (10 PM–7 AM)", isOn: binding(\.quietHours))
                        Text(Copy.notificationsPosture)
                            .font(Typography.xs)
                            .opacity(0.6)
                        if model.push.authorizationStatus != .authorized {
                            Button("Turn on notifications") {
                                Task {
                                    await model.push.requestAuthorization()
                                    await model.push.syncRegistration()
                                }
                            }
                            .font(Typography.sm)
                        }
                        if let error = model.push.lastRegistrationError {
                            Text("Alerts aren't registered: \(error)")
                                .font(Typography.xs)
                                .opacity(0.7)
                        }
                    }

                    section("Subscription") {
                        Text(subscriptionLine).font(Typography.sm).opacity(0.8)
                        Button("Restore purchases") { Task { await model.restore() } }
                            .font(Typography.sm)
                    }

                    section("About") {
                        Text("No account, no email. This device is known only by a random ID.")
                            .font(Typography.xs)
                            .opacity(0.6)
                        Button("Forget this device") {
                            Task { await model.push.forgetDevice() }
                        }
                        .font(Typography.sm)
                        Text(Copy.disclaimer)
                            .font(.system(size: 10))
                            .opacity(0.5)
                    }
                }
                .padding(22)
            }
        }
        .foregroundStyle(Palette.dark.text)
        .task { await model.push.refreshAuthorizationStatus() }
        .sheet(isPresented: $showsWidgetOnboarding) {
            WidgetOnboardingView()
        }
    }

    private var subscriptionLine: String {
        switch model.entitlement.status {
        case .trial:
            let days = model.entitlement.trialDaysRemaining() ?? 0
            return "Free trial · \(days) day\(days == 1 ? "" : "s") left"
        case .subscribed: return "Subscribed"
        case .lapsed: return "Subscription ended"
        case .never: return "Not subscribed"
        case .unknown: return "Checking…"
        }
    }

    private func section<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(Typography.eyebrow)
                .opacity(0.5)
            content()
        }
    }

    // MARK: Bindings

    private var unitBinding: Binding<MeasurementUnit> {
        Binding(get: { model.preferences.unit }, set: { model.preferences.unit = $0 })
    }

    private var sourceBinding: Binding<ForecastSourcePreference> {
        Binding(get: { model.preferences.source }, set: { model.preferences.source = $0 })
    }

    private var sensitiveBinding: Binding<Bool> {
        Binding(
            get: { model.preferences.sensitiveHousehold },
            set: { model.preferences.sensitiveHousehold = $0 }
        )
    }

    private func binding(_ keyPath: WritableKeyPath<Preferences, Bool>) -> Binding<Bool> {
        Binding(
            get: { model.preferences[keyPath: keyPath] },
            set: { model.preferences[keyPath: keyPath] = $0 }
        )
    }
}
