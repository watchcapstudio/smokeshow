// Copy that is *not* server-supplied.
//
// Almost all product prose arrives in `scale[]` — level names, notices,
// not-lines, and both guidance variants — precisely so it cannot drift into a
// Swift file. What is left is the disclaimer (which CLAUDE.md requires to ship
// verbatim from docs/smokeshow-build-brief.md), the labels that keep every
// forecast honest, and the store-mandated purchase disclosures.
//
// Rules encoded here, not left to a designer:
//   • every forecast number carries "model estimate";
//   • past hours are "model estimate", never "observed";
//   • no invented symptom dose-response — smell, visibility, and the cigarette
//     heuristic are the only experience anchors, and they come from `scale[]`.

import Foundation

public enum Copy {

    // MARK: - Disclaimer (verbatim, docs/smokeshow-build-brief.md § "Disclaimer copy")

    /// Ships word-for-word. Do not rewrite, shorten, or "tighten" it.
    ///
    /// Note for copy sign-off (platform plan §10.1): the live web page renders
    /// this with "Smokeshow" in sentence case and a comma where the brief has
    /// an em dash. The brief is the verbatim source per CLAUDE.md, so the brief
    /// is what ships here. If the web's variant is the intended one, change the
    /// brief and both surfaces together.
    public static let disclaimer = """
        SMOKESHOW is for informational and educational purposes only. It is not health, medical, \
        or safety advice. Forecasts are model estimates and can be wrong — sometimes by a lot. \
        Descriptions of what you might smell, see, or feel are generalizations, not predictions \
        about your body. For decisions about your health, outdoor activity, or air quality \
        safety, rely on official sources like AirNow.gov, the National Weather Service, and your \
        local health authorities, and talk to a medical professional about your own situation.
        """

    /// The bolded lead of the disclaimer, for surfaces that style it.
    public static let disclaimerLead = "SMOKESHOW is for informational and educational purposes only."

    // MARK: - Honesty labels

    /// The required word on every forecast reading, present or past.
    public static let modelEstimate = "model estimate"

    /// Past hours. Never "observed", never "measured" — the past series is
    /// model reanalysis (CLAUDE.md hard rule, contract §2 `window`).
    public static let pastHours = "past hours · model estimate"

    /// Attached to a reading, e.g. "41 µg/m³ PM2.5 · model estimate".
    public static func reading(_ value: String) -> String {
        "\(value) · \(modelEstimate)"
    }

    /// A missing hour. Never "0" — zero µg/m³ is a claim about clean air.
    public static let noData = "—"
    public static let noDataLong = "No model value for this hour"

    /// Measured rows are the one measured claim in the payload, and each
    /// carries its own provenance. Never averaged with each other.
    public static let officialRowTitle = "Nearest station"
    public static let localRowTitle = "Neighborhood sensors"
    public static let modelRowTitle = "Model"

    public static let agreementFallback = "Single-model forecast. Confidence fades past 36 hours."

    // MARK: - Freshness

    public static func asOf(_ date: Date, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = timeZone
        formatter.dateFormat = "MMM d, h:mm a"
        return "Forecast from \(formatter.string(from: date))"
    }

    public static let unavailable = "Forecast unavailable"
    public static let unavailableDetail =
        "We couldn't reach the forecast. This is the last one we had — check the time on it."

    // MARK: - Loading / offline states

    /// The verdict-area headline while the first forecast is on its way.
    public static let loadingHeadline = "Pulling forecast"

    /// The subline under it, rotated one at a time so the (brief) wait reads as
    /// steps of real work rather than a spinner.
    public static let loadingLines = [
        "Building forecast",
        "Checking winds",
        "Reading the smoke",
    ]

    /// The verdict-area headline when we have a place but can't reach the
    /// service and have nothing cached to fall back on.
    public static let offlineHeadline = "Can't reach the forecast"
    public static let offlineDetail = "Check your connection — we'll try again."

    /// The inline offline tag shown under the explainer when a (stale)
    /// forecast is still on screen.
    public static let offlineTag = "OFFLINE"
    public static let offlineTagDetail = "Check connection"

    // MARK: - Notifications posture (platform plan §5, ships as written)

    public static let notificationsPosture =
        "Threshold alerts only. No digests, no streaks, no engagement pings."

    // MARK: - Support (everything is free; this is the thank-you jar)

    public enum Support {
        public static let title = "Support Smokeshow"
        public static let body = """
            Smokeshow is free: the forecast, the widgets, the alerts. No ads, no account. If it \
            got you through a smoky week, a tip keeps the forecast running.
            """
        public static let tipsHeading = "Leave a tip"
        public static let reward = "Any tip unlocks the supporter app icons."
        /// Fallback names if the store has not answered yet. The store's own
        /// display names win when they arrive.
        public static let tipFallbackNames = ["Small tip", "Medium tip", "Large tip"]

        public static let monthlyHeading = "Or support monthly"
        public static let monthlyButton = "Support monthly"
        /// Price, period, and that it auto-renews: App Review checks for all
        /// three on any auto-renewing subscription, support or not.
        public static func monthlyTerms(price: String, period: String) -> String {
            """
            \(price) per \(period). Renews automatically until you cancel in Settings. Payment \
            is charged to your Apple Account. It unlocks the supporter icons and nothing else: \
            everything in the app is free either way.
            """
        }
        public static let subscribedLine = "You support Smokeshow monthly. Thank you."
        public static let tippedLine = "You've tipped. Thank you."
        public static let manageSubscription = "Manage subscription"

        public static let thanks = "Thank you. The supporter icons are unlocked."
        public static let pending = "Waiting on approval for this purchase."
        public static let failed = "That didn't go through. Nothing was charged."

        public static let iconsHeading = "App icon"
        public static let iconsLocked = "Leave a tip to unlock these."

        public static let restore = "Restore purchases"
        public static let termsURL = URL(string: "https://watchcapstudio.com/terms")!
        public static let privacyURL = URL(string: "https://watchcapstudio.com/privacy")!
        public static let noAccounts = "No account, no email. Purchases are tied to your Apple ID."

        /// Shown once to anyone who was paying when the app went free. They
        /// are still being billed and we cannot cancel it for them, so they
        /// hear it from us, with the way out one tap away.
        public static let freeNoticeTitle = "Smokeshow is free now"
        public static let freeNoticeBody = """
            Widgets, alerts and Live Activities are free for everyone. Your subscription is \
            still active and now counts as support, with the supporter app icons unlocked. Keep \
            it or cancel it any time; nothing in the app changes either way.
            """
        public static let freeNoticeKeep = "Keep supporting"
    }

    // MARK: - Onboarding (day 0's job is a widget on the home screen)

    public enum Onboarding {
        public static let widgetTitle = "Put it on your home screen"
        public static let widgetBody = """
            The point of Smokeshow is not opening Smokeshow. Add the widget and the answer is \
            just there, next to the weather.
            """

        #if os(macOS)
        public static let widgetSteps = [
            "Click the date and time in the menu bar to open Notification Center.",
            "Scroll to the bottom and click Edit Widgets.",
            "Find Smokeshow, then drag the size you want into place.",
        ]
        #else
        public static let widgetSteps = [
            "Touch and hold the home screen until the icons jiggle.",
            "Tap the + in the corner, then search for Smokeshow.",
            "Pick a size and tap Add Widget.",
        ]
        #endif

        public static let lockScreenTitle = "And the lock screen"
        public static let lockScreenBody = """
            The inline and circular widgets sit under the clock. That's the glance this app is \
            for.
            """
    }
}
