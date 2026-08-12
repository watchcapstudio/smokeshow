# SMOKESHOW — Share & Spread Spec (Claude Code instructions)

Companion to `smokeshow-build-brief.md`. These features ship in v1. The product's growth mechanic is: the verdict gets screenshotted/linked into group chats, and the link preview itself sells the tap. Build accordingly.

## Priorities, in order
1. Live-verdict link previews (OG tags)
2. Shared-link location handoff
3. Share card generator
4. Clear-time as headline stat
5. Zero-friction rules (these are constraints, not a feature)

---

## 1. Live-verdict link previews (highest leverage — do not skip)

When a SMOKESHOW link lands in iMessage/WhatsApp/Slack, the preview must show the actual current verdict for the shared location, e.g.:

> **Cumberland, WI — Smells like fire**
> Clears Thursday 6 PM · SMOKESHOW

**Constraint:** OG scrapers do not execute JS, so a purely static page cannot do this. Use the lightest serverless option on whatever host is chosen:
- Cloudflare Pages → Pages Function on `/` that reads URL params, fetches the point forecast from Open-Meteo server-side, and injects `og:title`, `og:description`, and `og:image` into the HTML shell before returning it. Everything else stays static.
- Vercel → same pattern with an edge function; use `@vercel/og` (satori) for the image.

**OG image:** generated per-request. Layout: rating word huge, place name, clear-time line, 5-day mini-strip, wordmark. Dark background, smoke-toned. Cache generated images aggressively (KV or cache API, keyed on location + forecast run) — scrapers hit repeatedly.

**Fallback:** if the edge function errors, serve static OG tags ("SMOKESHOW — see the smoke coming, and when it clears"). Never block page load on OG generation.

## 2. Shared-link location handoff

URL scheme: `/?lat=45.53&lon=-92.02&name=Cumberland%2C%20WI`

- Opening a link with params shows THAT location's full page immediately — recipient sees exactly what the sender saw. No permission prompt on first paint.
- A persistent banner sits above the map: **"This is [Cumberland, WI]. Check your air →"** — tapping it triggers the geolocation grant and swaps to the recipient's location. This banner is the viewer→user conversion moment; make it impossible to miss but not modal.
- After grant, their location becomes the cached default; the shared location is forgotten.
- Every share action (section 3) writes the sender's current lat/lon/name into the shared URL.

## 3. Share card generator

One-tap share button near the rating chip. Flow:
1. Render a PNG client-side (canvas or html-to-image) — the designed version of the screenshot people would take anyway.
2. Card contents: rating word huge, place name + date/time, the clear-time line ("Clears Thursday 6 PM"), 5-day strip, small model-agreement note when models are split ("models split on timing"), URL + wordmark.
3. Invoke `navigator.share({ files: [...], url })` — Web Share API Level 2 with files works on iOS/Android Safari/Chrome. The URL in the payload carries the location params.
4. Fallback (desktop / unsupported): copy-link button + download-image button, side by side.

Card variants by state — the copy writes itself from the forecast:
- Clearing soon: lead with the clear-time.
- Getting worse: lead with the arrival/peak ("Tastes like fire by Wednesday morning").
- Top level: the card says **SMOKESHOW** as the rating. The name doing the work.

## 4. Clear-time as the headline stat

- "When does it end" is the question. Compute first crossing below the Smells-like-fire threshold (35 µg/m³) that HOLDS for 6+ consecutive hours (prevents "clears at 3 AM" head-fakes from one-hour dips).
- Display prominently in the rating chip area: "Clears Thursday ~6 PM" with the ~ always present.
- If no clearing anywhere in the window: "No clear air as far as the forecast goes" — that's a shareable verdict too. The headline never counts the window's width; a number in it means the model found a crossing (see the headline table in `docs/forecast-api-contract.md`).
- This same string feeds the OG description and the share card. One function, three surfaces: `getVerdict(location) → { rating, clearTime, trend }`.

## 5. Zero-friction rules (constraints)

- No accounts. No email capture. No cookie banner beyond what's legally unavoidable. No app-store anything. No install prompts on first visit.
- First meaningful paint with a verdict in under 3 seconds on cellular. Budget accordingly: defer the map layer; the rating chip + clear-time render first from a single point fetch, grid/map hydrates after.
- The page must be fully useful with geolocation denied (search box path) — a share recipient who denies permission still sees the sender's location page.
- No interstitials, ever. The link IS the ad; anything between tap and verdict kills the loop.

## Nice-to-have if trivial, skip if not
- `?utm_source=share` on generated links so basic analytics (a lightweight, cookieless counter like Plausible/GoatCounter or Cloudflare Web Analytics) can distinguish shared-link arrivals from direct. No personal data.
- A subtle "Sent by a friend?" microcopy variant of the check-your-air banner when `utm_source=share` is present.

## Explicitly out of scope for v1
- "Text me when it clears" notifications (needs backend + phone numbers; v2)
- Social accounts, embeds, widgets
- Any leaderboard/streak/gamification — wrong product

## Definition of done
- Paste a link with location params into iMessage: preview shows live rating + clear-time for that place.
- Tap share on a phone: native share sheet opens with card image + parameterized link.
- Open a shared link on a second device: sender's location renders, banner converts to my location in two taps (tap banner, allow).
- Lighthouse mobile performance ≥ 90 on the landing render.
