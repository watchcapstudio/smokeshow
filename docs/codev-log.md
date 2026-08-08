# Co-dev log

Two people and their agents work on this repo. This file is how we stay out of
each other's way. It is a log of decisions, not a spec — if it grows past a
page or two, the oldest entries get deleted, not archived.

**Joe is lead.** His product, his name, his call on anything that reaches a
user. Kelly's changes come in as PRs for Joe to accept or reject.

## The rules we work by

1. **One branch per change, named for the change.** Not `fixes`, not `wip`.
   A branch is the unit Joe can reject, so it has to be one idea.
2. **PR everything. Never push to `main`.** Even a one-line fix.
3. **Say what you verified.** "Builds" is not verification. "Declined the
   location prompt, searched Bend, verdict rendered" is.
4. **Log the decision here, not just in the commit.** A commit explains a
   diff; this file explains why the diff exists six weeks later.
5. **Git authors lie.** Every commit either of us makes through Claude Code is
   authored "Claude". To find out who did something, read the GitHub push
   history, not `git log --author`.

## Decisions

### 2026-08-08 — the iOS app had never been run

Joe built the SwiftUI app on 8/2–8/3. CI was green the whole time and the app
had still never launched on a device or a simulator, because CI builds
`generic/platform=iOS Simulator`, which skips the packaging Validate phase.
The framework had no Info.plist and the app could not be installed at all.

**Green CI on this repo does not mean installable.** Someone runs it before a
build is called done.

- Fixed in #20 along with two first-run bugs: the location prompt was never
  waited on, and there was no way to pick a place other than "where I am".
- Rollback: revert #20. The place picker is a new file, so it drops cleanly.

### 2026-08-08 — the demo's scrubber came back

The demo rig's core mechanic is dragging the timeline. It did not survive into
the app — there was no gesture code anywhere in the iOS target. Kelly's read:
what shipped is a read-only page, not an iOS app.

- #21 adds drag-to-scrub on the curve. Costs the ability to start a vertical
  scroll on the curve itself, which is the trade a slider makes.
- Still missing from the demo, in the order we plan to take them: tappable day
  strip with hourly detail, the map with its own scrubber, the share card.
- Rollback: revert #21. `CurveView`'s selection binding is optional, so every
  other caller is untouched.

### 2026-08-08 — the disclaimer became onboarding

The full disclaimer sat under the verdict on every launch. A wall of legal
text a reader scrolls past daily is furniture, not consent.

Now three screens on first run: what it does, what it isn't, then the location
ask. The disclaimer text itself is unchanged — `Copy.disclaimer` is verbatim
from the brief and `ParityTests` fails the build if it drifts. Only the
frequency changed. The verdict screen keeps one quiet line into the explainer,
where the full text also lives.

Order matters and is the point: a location prompt that arrives before the
reader knows what the app does is a prompt they decline.

- Rollback: revert the onboarding PR. The acknowledgement flag lives under its
  own defaults key, so nothing else reads it.

## Open, and whose call

- **Bundle prefix.** The app is `earth.smokeshow.*`; everything else of
  Kelly's is `com.watchcapstudio.*`. Permanent once it hits the App Store.
  Joe's call.
- **Widget previews truncate.** "In t…", "D…" in the onboarding preview. The
  large families were designed without ever being rendered.
- **Watch entitlement.** An unpaired-launch watch reads an empty snapshot.
  Known, documented in `apple/docs/watch-and-live-activity.md`.
