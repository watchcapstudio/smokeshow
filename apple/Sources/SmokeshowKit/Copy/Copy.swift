// Copy that is *not* server-supplied.
//
// Almost all product prose arrives in `scale[]` — level names, notices,
// not-lines, and both guidance variants — precisely so it cannot drift into a
// Swift file. What is left is the disclaimer (which CLAUDE.md requires to ship
// verbatim from docs/smokeshow-build-brief.md), the labels that keep every
// forecast honest, and the store-mandated paywall disclosure.
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
    public static let loadingDetail = "Assembling the sky for this place."

    /// The verdict-area headline when we have a place but can't reach the
    /// service and have nothing cached to fall back on.
    public static let offlineHeadline = "Can't reach the forecast"
    public static let offlineDetail = "Check your connection — we'll try again."

    /// The thin banner pinned to the top when the network is unreachable.
    public static let offlineBar = "You're offline"

    // MARK: - Notifications posture (platform plan §5, ships as written)

    public static let notificationsPosture =
        "Threshold alerts only. No digests, no streaks, no engagement pings."

    // MARK: - Paywall (App Review requires all three facts on the buy screen)

    public enum Paywall {
        public static let title = "Your air, on your home screen"
        public static let subtitle = """
            Widgets on your home and lock screen, and a notification when the smoke arrives, \
            peaks, or clears. Nothing else.
            """

        /// Trial length, price after, and that it auto-renews — the three
        /// disclosures App Review checks for on an introductory offer.
        public static func terms(product: PaywallProduct?) -> String {
            let price = product?.localizedPrice ?? TrialPolicy.monthlyPriceFallback
            let period = product?.localizedPeriod ?? "month"
            let days = product?.introductoryOfferDays ?? TrialPolicy.trialDays
            return """
                \(days)-day free trial, then \(price) per \(period). The subscription renews \
                automatically until you cancel, and you can cancel any time in Settings at least \
                24 hours before the trial ends. Payment is charged to your Apple Account.
                """
        }

        /// Shown when the store says this Apple ID has already used its trial.
        public static func termsWithoutTrial(product: PaywallProduct?) -> String {
            let price = product?.localizedPrice ?? TrialPolicy.monthlyPriceFallback
            let period = product?.localizedPeriod ?? "month"
            return """
                \(price) per \(period). The subscription renews automatically until you cancel, \
                and you can cancel any time in Settings. Payment is charged to your Apple Account.
                """
        }

        public static let restore = "Restore purchases"
        public static let termsURL = URL(string: "https://smokeshow.earth/terms")!
        public static let privacyURL = URL(string: "https://smokeshow.earth/privacy")!
        public static let noAccounts = "No account, no email. The subscription is tied to your Apple ID."
    }

    // MARK: - Onboarding (the trial's job is a widget on the home screen, day 0)

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
            The inline and circular widgets sit under the clock. That's the glance that makes \
            this worth paying for.
            """
    }

    // MARK: - Trial end / lapse (designed, not left to fall out of the code)

    public enum Lapse {
        public static func churnWindow(daysRemaining: Int) -> String {
            daysRemaining <= 1
                ? "Trial ends tomorrow — keep this widget"
                : "Trial ends in \(daysRemaining) days"
        }

        /// What the widget says once the trial has lapsed. It is deliberately
        /// a *state*, not a blank tile and not a stale number: the place name
        /// stays, the sky stays, the forecast does not.
        public static let widgetTitle = "Trial ended"
        public static let widgetBody = "Tap to keep your air on screen"
        public static let appTitle = "Your trial has ended"
        public static func appBody(price: String) -> String {
            """
            The widgets and alerts are off. \(price) a month turns them back on — same air, same \
            forecast, back where you had it.
            """
        }
    }
}
