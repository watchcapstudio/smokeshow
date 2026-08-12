// The buy screen.
//
// $2.99/month with a 14-day free trial, configured as a StoreKit introductory
// offer so the *store* enforces eligibility — one trial per Apple ID per
// subscription group. The app never decides who is eligible; it asks, and
// shows the terms it is given.
//
// App Review requires three facts on this screen and they are all in
// `Copy.Paywall.terms`: trial length, price after the trial, and that it
// renews automatically. When the store says this Apple ID has already used its
// trial, the no-trial variant ships instead — promising a trial that will not
// be granted is a rejection.

import SwiftUI
import SmokeshowKit

struct PaywallView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    let isModal: Bool

    @State private var product: PaywallProduct?
    @State private var isPurchasing = false
    @State private var message: String?

    private var isLapsed: Bool {
        if case .lapsed = model.entitlement.status { return true }
        return false
    }

    private var hasTrial: Bool { (product?.introductoryOfferDays ?? TrialPolicy.trialDays) > 0 }

    var body: some View {
        ZStack {
            Palette.dark.bg.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if isModal {
                        HStack {
                            Spacer()
                            Button("Close") { dismiss() }
                                .font(Typography.sm)
                                .opacity(0.6)
                        }
                    }

                    Text(isLapsed ? Copy.Lapse.appTitle : Copy.Paywall.title)
                        .font(Typography.xl)

                    Text(isLapsed
                        ? Copy.Lapse.appBody(price: product?.localizedPrice ?? TrialPolicy.monthlyPriceFallback)
                        : Copy.Paywall.subtitle)
                        .font(Typography.base)
                        .opacity(0.75)

                    WidgetShowcase()
                        .padding(.vertical, 4)

                    bullets

                    buyButton

                    Text(hasTrial
                        ? Copy.Paywall.terms(product: product)
                        : Copy.Paywall.termsWithoutTrial(product: product))
                        .font(Typography.xs)
                        .opacity(0.6)

                    Text(Copy.Paywall.noAccounts)
                        .font(Typography.xs)
                        .opacity(0.5)

                    HStack(spacing: 16) {
                        Button(Copy.Paywall.restore) { Task { await model.restore() } }
                        Link("Terms", destination: Copy.Paywall.termsURL)
                        Link("Privacy", destination: Copy.Paywall.privacyURL)
                    }
                    .font(Typography.xs)
                    .opacity(0.6)

                    if let message {
                        Text(message).font(Typography.sm).opacity(0.8)
                    }

                    #if DEBUG
                    // Debug builds only: a way past the gate without a sandbox
                    // purchase, so the app behind it can be reviewed.
                    Button("Unlock (debug)") {
                        model.debugUnlock()
                        if isModal { dismiss() }
                    }
                    .font(Typography.xs)
                    .opacity(0.5)
                    .padding(.top, 8)
                    #endif
                }
                .padding(22)
            }
        }
        .foregroundStyle(Palette.dark.text)
        .task {
            product = await model.product()
            TrialInstrumentation.record(.paywallShown)
        }
    }

    private var bullets: some View {
        VStack(alignment: .leading, spacing: 8) {
            bullet("Home and lock-screen widgets", "The answer without opening anything.")
            bullet("Alerts when it changes", Copy.notificationsPosture)
            bullet("No account, no tracking", "Your air, and nothing else about you.")
        }
    }

    private func bullet(_ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(Palette.dark.accent)
                .frame(width: 6, height: 6)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(Typography.base).fontWeight(.semibold)
                Text(detail).font(Typography.sm).opacity(0.65)
            }
        }
    }

    private var buyButton: some View {
        Button {
            Task {
                isPurchasing = true
                let outcome = await model.subscribe()
                isPurchasing = false
                switch outcome {
                case .some(.purchased):
                    TrialInstrumentation.record(.trialStarted)
                    if isModal { dismiss() }
                case .some(.pending):
                    message = "Waiting on approval for this purchase."
                case .some(.cancelled), .none:
                    message = nil
                }
            }
        } label: {
            HStack {
                Spacer()
                if isPurchasing {
                    ProgressView().tint(.black)
                } else {
                    Text(buttonTitle).font(Typography.md).fontWeight(.semibold)
                }
                Spacer()
            }
            .padding(.vertical, 14)
            .background(
                RoundedRectangle(cornerRadius: Tokens.Radius.md)
                    .fill(Palette.dark.accent)
            )
            .foregroundStyle(Color.black)
        }
        .buttonStyle(.plain)
        .disabled(isPurchasing)
    }

    private var buttonTitle: String {
        let price = product?.localizedPrice ?? TrialPolicy.monthlyPriceFallback
        guard hasTrial else { return "Subscribe · \(price)/month" }
        return "Start \(product?.introductoryOfferDays ?? TrialPolicy.trialDays)-day free trial"
    }
}

/// Live widget mocks, driven by the real payload the app already has — the
/// same trick the web CTA uses, and a far stronger pitch than a screenshot
/// because it is the visitor's own air (platform plan §3).
struct WidgetShowcase: View {
    @EnvironmentObject private var model: AppModel

    /// Onboarding shows this before any real forecast exists, so it can hand in
    /// a mock payload and place. Both default to the live model.
    var forecastOverride: Forecast? = nil
    var placeOverride: Place? = nil

    private var entry: WidgetEntryModel {
        let forecast = forecastOverride ?? model.forecast
        let place = placeOverride ?? model.place
        guard let forecast, let place else {
            return TimelineBuilder.placeholder(place: placeOverride ?? .preview)
        }
        return TimelineBuilder.build(
            forecast: forecast,
            place: place,
            preferences: model.preferences,
            entitlement: EntitlementSnapshot(status: .subscribed(renewsAt: nil))
        ).entries.first ?? TimelineBuilder.placeholder(place: place)
    }

    var body: some View {
        HStack(spacing: 12) {
            SmokeshowWidgetView(entry: entry, layout: .systemSmall)
                .frame(width: 148, height: 148)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            VStack(spacing: 10) {
                SmokeshowWidgetView(entry: entry, layout: .systemMedium)
                    .frame(width: 148, height: 70)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                #if os(iOS)
                AccessoryRectangularView(entry: entry)
                    .frame(width: 148, height: 60)
                    .padding(8)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Color.white.opacity(0.12))
                    )
                #endif
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }
}
