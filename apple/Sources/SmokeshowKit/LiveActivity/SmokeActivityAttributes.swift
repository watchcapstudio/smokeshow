// The Live Activity / Dynamic Island countdown during an active smoke event.
//
// "Clears in 4h", counting down on the lock screen — the platform plan calls
// this the most differentiated thing on the roadmap, and it is cheap here
// because the endpoint already hands us the instant to count to.
//
// The countdown itself costs *zero* updates: `Text(timerInterval:)` ticks in
// the system's process. An activity is only pushed a new content state when
// the server's answer changes — a new clear-time, a level change, or the event
// ending. That matters as much as the widget budget: a Live Activity that
// updates every minute is an activity iOS will throttle.

import Foundation

#if canImport(ActivityKit) && os(iOS)
import ActivityKit

public struct SmokeActivityAttributes: ActivityAttributes {

    public struct ContentState: Codable, Hashable {
        /// Server copy: `scale[levelIndex].name`.
        public let levelName: String
        public let levelIndex: Int
        /// Server copy: the verdict headline, verbatim.
        public let headline: String
        /// The instant the countdown runs to — `verdict.clearAtUTC` or
        /// `arrivalAtUTC`. Nil when the air never crosses the line inside the
        /// window, in which case the activity shows the headline and no timer.
        public let changeAt: Date?
        public let isClearing: Bool
        /// Current reading in the user's unit. Nil is a model gap and renders
        /// as "—", never as 0.
        public let reading: Double?
        public let unitLabel: String
        public let generatedAt: Date

        public init(
            levelName: String,
            levelIndex: Int,
            headline: String,
            changeAt: Date?,
            isClearing: Bool,
            reading: Double?,
            unitLabel: String,
            generatedAt: Date
        ) {
            self.levelName = levelName
            self.levelIndex = levelIndex
            self.headline = headline
            self.changeAt = changeAt
            self.isClearing = isClearing
            self.reading = reading
            self.unitLabel = unitLabel
            self.generatedAt = generatedAt
        }

        public var readingText: String {
            guard let reading else { return Copy.noData }
            return "\(Int(reading.rounded()))"
        }
    }

    /// Fixed for the life of the activity.
    public let placeName: String

    public init(placeName: String) {
        self.placeName = placeName
    }
}
#endif
