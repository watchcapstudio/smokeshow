// "Clears in 4h", on the lock screen and in the Dynamic Island.
//
// The countdown is `Text(timerInterval:)`, which ticks in the system's own
// process — the activity is never updated just to move a number. Content
// updates arrive only when the *server's answer* changes, which is the same
// discipline the widget timeline follows and for the same reason.

#if os(iOS)
import ActivityKit
import WidgetKit
import SwiftUI
import SmokeshowKit

struct SmokeLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SmokeActivityAttributes.self) { context in
            LockScreenLiveActivityView(
                place: context.attributes.placeName,
                state: context.state
            )
            .activityBackgroundTint(Color(Tokens.Color.Dark.bg))
            .activitySystemActionForegroundColor(Color(Tokens.Color.Dark.text))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(context.state.readingText)
                            .font(.system(size: 22, weight: .bold, design: .rounded))
                            .monospacedDigit()
                        Text(context.state.unitLabel)
                            .font(.system(size: 9, weight: .medium, design: .monospaced))
                            .opacity(0.6)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    CountdownText(state: context.state)
                        .font(.system(size: 20, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.levelName)
                            .font(.system(size: 16, weight: .bold))
                        // The server's sentence, verbatim.
                        Text(context.state.headline)
                            .font(.system(size: 12, weight: .semibold))
                            .opacity(0.7)
                        Text("\(context.attributes.placeName.uppercased()) · \(Copy.modelEstimate)")
                            .font(.system(size: 9, weight: .medium, design: .monospaced))
                            .opacity(0.45)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                Text(context.state.readingText)
                    .monospacedDigit()
            } compactTrailing: {
                CountdownText(state: context.state)
                    .monospacedDigit()
            } minimal: {
                Text(context.state.readingText)
                    .monospacedDigit()
            }
            .widgetURL(DeepLink.url(.verdict(place: context.attributes.placeName)))
        }
    }
}

/// Ticks without an update. When there is no crossing in the window there is
/// nothing to count to, and the activity says so instead of inventing one.
struct CountdownText: View {
    let state: SmokeActivityAttributes.ContentState

    var body: some View {
        if let changeAt = state.changeAt, changeAt > Date() {
            Text(timerInterval: Date()...changeAt, countsDown: true)
        } else {
            Text(state.isClearing ? "—" : "5d+")
        }
    }
}

struct LockScreenLiveActivityView: View {
    let place: String
    let state: SmokeActivityAttributes.ContentState

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(place.uppercased())
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .opacity(0.45)
                Text(state.levelName)
                    .font(.system(size: 19, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                // One line, sharing the row with the countdown column. The
                // activity only runs while above=true, so the longest sentence
                // that can land here is "No clear air as far as the forecast
                // goes" — scale it down rather than clip the sentence that
                // matters most in exactly that state.
                Text(state.headline)
                    .font(.system(size: 12, weight: .semibold))
                    .opacity(0.7)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text("\(state.readingText) \(state.unitLabel) · \(Copy.modelEstimate)")
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .opacity(0.45)
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 1) {
                CountdownText(state: state)
                    .font(.system(size: 26, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                Text(state.isClearing ? "TO CLEAR" : "TO SMOKE")
                    .font(.system(size: 8, weight: .semibold, design: .monospaced))
                    .opacity(0.6)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .foregroundStyle(Color(Tokens.Color.Dark.text))
    }
}
#endif
