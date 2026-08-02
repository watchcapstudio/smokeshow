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

    var body: some View {
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
        .task { await evaluateNudges() }
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
            case .verdict: break
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
