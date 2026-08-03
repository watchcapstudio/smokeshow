# Watch complications and the Live Activity — scope

The brief asked for these to be scoped "while you're here, in this order".
Both are implemented far enough to be real; what remains is listed honestly.

---

## 1. Apple Watch complications

**Claim from the platform plan:** "nearly free once the `accessory*` SwiftUI
views exist." That held. The watch targets add ~180 lines and no new views: the
complications render `AccessoryCircularPMView`, `AccessoryRectangularView`,
`AccessoryInlineView`, and a new `AccessoryCornerView`, from the same
`TimelineBuilder`.

### Built

- `SmokeshowWatch` — a minimal watch app, mostly so the complications have
  somewhere to tap through to.
- `SmokeshowWatchWidgets` — a complication bundle supporting
  `accessoryCircular`, `accessoryCorner`, `accessoryInline`, and
  `accessoryRectangular`.
- Shared everything: contract, cache, preferences, entitlement snapshot.

### Not built, and what it costs

| Gap | Why it matters | Estimate |
| --- | --- | --- |
| **WatchConnectivity payload transfer** | Today the watch fetches for itself. It should prefer the phone's already-fetched payload and only fetch when the phone is unreachable. The watch's reload budget is tighter than the phone's and its radio is more expensive. | 1–2 d |
| **App Group across the pairing** | A watch app does not share the phone's App Group container. The entitlement snapshot and preferences need to arrive over WatchConnectivity, not be assumed present. **This is the one real correctness gap**: as written, an unpaired-launch watch reads an empty snapshot, which is `.unknown`, which renders the forecast. Generous, but not the designed behaviour. | 1 d |
| **Complication tinting audit** | Watch faces tint aggressively; the arcs need checking against the full-colour and tinted rendering modes. | 0.5 d |
| **watchOS-specific layouts** | 41 mm vs 49 mm, and the corner family's curved text. | 1 d |

Total: roughly **a week**, and none of it blocks the iOS launch.

---

## 2. Live Activity / Dynamic Island

**The most differentiated thing on the roadmap** — nothing else in weather does
smoke this way. It is also the cheapest big feature in the app, because the
endpoint already returns the instant to count to.

### Built

- `SmokeActivityAttributes` — shared between app and widget extension.
- `SmokeLiveActivityWidget` — lock-screen presentation plus all four Dynamic
  Island regions (expanded leading/trailing/bottom, compact, minimal).
- `LiveActivityController` — the whole lifecycle in one place:
  - **start** when the server says `verdict.above` is true. A smoke event is
    something the *server* declares; the app never decides it from a series;
  - **update** only when the content state actually differs — same headline,
    same clear-time, same level means no update at all;
  - **end** when it clears, leaving the final frame up for 30 minutes so the
    user sees the payoff the product has been promising, then dismissing;
  - **end immediately** on a lapsed entitlement.
- Push token observation, so B7 can update an activity without the app running.

### The design decision that matters

The countdown is `Text(timerInterval:)`. It ticks in the system's process and
costs **zero** updates. An implementation that pushed a new content state every
minute to move a number would be throttled by iOS, drain the battery, and — via
B7 — cost a push per subscriber per minute during exactly the event when every
subscriber is watching.

### Not built

| Gap | Estimate |
| --- | --- |
| B7 activity-push endpoint (register the activity token, push a content update on a verdict change) | 1–2 d, mostly on the B7 side |
| Staleness presentation — the activity dims after `Forecast.staleAfter`, but the dimmed frame has not been designed | 0.5 d |
| An "it cleared" celebratory final frame distinct from the running one | 0.5 d |
| iPad Live Activity presentation (iPadOS 17+) | 0.5 d |

---

## Suggested order

1. **WatchConnectivity + entitlement transfer** — it is the only item on either
   list that is a correctness gap rather than a polish gap.
2. **B7 activity push** — turns the Live Activity from "accurate while the app
   runs" into "accurate always", which is the whole claim.
3. Everything else, by taste.
