// Routing. Subscribe-to-use means there are exactly three destinations:
// the verdict, the paywall, and the widget-install flow that the trial exists
// to reach (platform plan §4).

import SwiftUI
import SmokeshowKit

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    @State private var showsPaywall = false
    @State private var showsWidgetOnboarding = false
    @State private var showsSettings = false
    @State private var showsExplain = false

    @State private var acknowledged = PreferencesStore.shared.acknowledgedDisclaimer

    var body: some View {
        ZStack {
            if !acknowledged {
                // Ahead of everything: ahead of the entitlement switch, ahead
                // of the widget nudge, and ahead of the location prompt. A
                // consent screen that arrives third is not consent, and the
                // OS prompt on top of it looks like the app asking twice.
                OnboardingFlow {
                    PreferencesStore.shared.acknowledgedDisclaimer = true
                    acknowledged = true
                    Task {
                        await model.refreshEntitlement()
                        await model.refresh()
                        await evaluateNudges()
                    }
                }
            } else {
                content
            }
        }
        .task {
            guard acknowledged else { return }
            await model.onLaunch()
            await evaluateNudges()
        }
        .sheet(isPresented: $showsWidgetOnboarding) {
            WidgetOnboardingView()
        }
        .sheet(isPresented: $showsPaywall) {
            PaywallView(isModal: true)
        }
        .sheet(isPresented: $showsSettings) {
            SettingsView()
        }
        .sheet(isPresented: $showsExplain) {
            ExplainSheet(forecast: model.forecast)
        }
        .onReceive(NotificationCenter.default.publisher(for: .smokeshowDeepLink)) { note in
            guard let destination = note.object as? DeepLink.Destination else { return }
            switch destination {
            case .paywall: showsPaywall = true
            case .widgetSetup: showsWidgetOnboarding = true
            case .settings: showsSettings = true
            case .verdict(let placeName):
                guard let placeName,
                      let place = PlaceStore.shared.places.first(where: { $0.shortName == placeName })
                else { return }
                Task { await model.select(place) }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        ZStack {
            switch model.entitlement.status {
            case .unknown:
                // Checking with the store. Not a lock — just not decided yet.
                LoadingView()
            case .trial, .subscribed:
                VerdictScreen(
                    showsExplain: $showsExplain,
                    showsSettings: $showsSettings
                )
            case .lapsed, .never:
                PaywallView(isModal: false)
            }
        }
    }

    /// Day 0 asks for a widget; day 12–14 asks again, or asks for the money.
    /// Both come out of `TrialInstrumentation`, which is local-only.
    private func evaluateNudges() async {
        let installed = await model.installedWidgetCount()
        let nudge = TrialInstrumentation.evaluate(
            entitlement: model.entitlement,
            installedWidgetCount: installed
        )
        switch nudge {
        case .installWidget:
            guard model.entitlement.status.isActive else { return }
            // Not on arrival. Someone who has not yet seen a forecast has no
            // reason to want a widget of it, and a sheet between the welcome
            // and the product reads as a third thing to dismiss. Let them use
            // the app first; the ask lands better once the answer has proved
            // useful. Settings has the same flow for anyone who says no.
            try? await Task.sleep(for: .seconds(20))
            guard !Task.isCancelled, model.entitlement.status.isActive else { return }
            TrialInstrumentation.record(.widgetPromptShown)
            showsWidgetOnboarding = true
        case .subscribe:
            guard !model.entitlement.status.isActive else { return }
            showsPaywall = true
        case nil:
            break
        }
    }
}

struct LoadingView: View {
    var body: some View {
        ZStack {
            Palette.dark.bg.ignoresSafeArea()
            ProgressView()
                .tint(Palette.dark.text)
        }
    }
}
