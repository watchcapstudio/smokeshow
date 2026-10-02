// Routing. The app is free, so the verdict is the only destination a launch
// lands on. Everything else is a sheet the reader opens: settings, the widget
// install flow, and the Support screen. The one sheet the app opens on its
// own, besides the single widget ask, is the "Smokeshow is free now" notice
// for people who were paying when the app went free.

import SwiftUI
import SmokeshowKit

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    @State private var showsSupport = false
    @State private var showsFreeNotice = false
    @State private var showsWidgetOnboarding = false
    @State private var showsSettings = false
    @State private var showsExplain = false

    @State private var acknowledged = PreferencesStore.shared.acknowledgedDisclaimer

    var body: some View {
        ZStack {
            if !acknowledged {
                // Ahead of everything: ahead of the widget nudge, and ahead
                // of the location prompt. A consent screen that arrives third
                // is not consent, and the OS prompt on top of it looks like
                // the app asking twice.
                OnboardingFlow {
                    PreferencesStore.shared.acknowledgedDisclaimer = true
                    acknowledged = true
                    Task {
                        await model.refreshSupporter()
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
        .sheet(isPresented: $showsSupport) {
            SupportView()
        }
        .sheet(isPresented: $showsFreeNotice) {
            FreeNoticeView()
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
            case .support: showsSupport = true
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

    private var content: some View {
        VerdictScreen(
            showsExplain: $showsExplain,
            showsSettings: $showsSettings
        )
    }

    /// At most one thing, once: the free notice for a paid-build subscriber,
    /// otherwise the first-session widget ask. Both are local-only.
    private func evaluateNudges() async {
        if SupporterCache.shared.shouldShowFreeNotice(for: model.supporter.status) {
            SupporterCache.shared.hasShownFreeNotice = true
            showsFreeNotice = true
            return
        }

        let installed = await model.installedWidgetCount()
        guard WidgetNudge.shouldAsk(installedWidgetCount: installed) else { return }
        // Not on arrival. Someone who has not yet seen a forecast has no
        // reason to want a widget of it, and a sheet between the welcome and
        // the product reads as a third thing to dismiss. Let them use the app
        // first; the ask lands better once the answer has proved useful.
        // Settings has the same flow for anyone who says no.
        try? await Task.sleep(for: .seconds(20))
        guard !Task.isCancelled else { return }
        WidgetNudge.record(.widgetPromptShown)
        showsWidgetOnboarding = true
    }
}
