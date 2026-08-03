# SMOKESHOW — release readiness

Audit + hardening pass ahead of a public/press launch. The lens throughout is
the acceptance test: *a local news org runs a story and thousands hit the app
in an hour, many for the same region during an active smoke event.* Almost
everything that matters sorts by "what breaks or costs money at 100× traffic."

Legend: ✅ done this pass · ⬜ open · 🔭 deferred (needs infra or a test pass)

---

## Verdict

The architecture is fundamentally sound: the verdict paints < 3s (map is
genuinely lazy-loaded), escaping is correct (no XSS), secrets are server-only,
and the app degrades cleanly to model-only when sensors/HRRR fail. The risks
were concentrated in the cost/abuse surface of the API layer — most of which
is now closed.

---

## Shipped this pass

### Cost / abuse hardening (was the #1 risk — two audits converged on it)
- ✅ **Server-side coordinate snapping + validation** on `/api/aq`, `/api/sensors`,
  `/api/history`, `/api/s`. The cache lattice that keeps cost bounded was
  enforced only client-side; a direct caller with jittered coords was
  all-cache-miss and could drain the free Open-Meteo quota and the *billed*
  AirNow/PurpleAir keys. `grid.js:parseSnappedCoord/snapCoordList` (unit-tested).
- ✅ **`/api/aq` stampede fix**: error responses now cache 30s instead of
  `no-store`, so one Open-Meteo throttle can't become a per-request retry storm
  that sustains itself (and spills to all users via Vercel's shared egress IPs).
- ✅ **`/api/aq` input bounds**: force `hourly=pm2_5`, clamp past/forecast days,
  cap the grid-batch coordinate count.
- ✅ **CORS lockdown**: dropped `Access-Control-Allow-Origin: *` from the billed
  `/api/sensors` and `/api/history` so third-party sites can't drive them from
  visitors' browsers. (Same-origin app calls need no CORS header.)
- ✅ **`/api/og` input caps + key validation**: satori renders whatever it's
  given; an unbounded string/strip was a per-request CPU/memory DoS.
- ✅ **Observability**: `console.error` on every upstream failure, so a
  throttled/banned key is visible in function logs during a spike instead of
  silently degrading everyone to model-only.

### Performance
- ✅ **Defer HRRR fetch** until the verdict has painted (`centerData` present),
  so its heavy `series.json` no longer races the stage-1 forecast on cellular.
- ✅ **Reuse SmokeLayer raster buffers** (ImageData + lat/lon arrays) across
  frames instead of reallocating every redraw — kills GC churn during scrub.

### Credibility / defense-in-depth
- ✅ **Security headers** (`nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`).
- ✅ **Data-source attribution** line (AirNow, PurpleAir, Open-Meteo/CAMS under
  CC-BY 4.0, NOAA HRRR-Smoke, OpenStreetMap) — required by AirNow's terms and
  Open-Meteo's license; only OSM was credited before.

### Cleanup
- ✅ Deleted 4 unused functions (`cigaretteEquivalent`, `smokeColorForPM25`,
  `getCachedLocation`, `hrrrFrameURL`) and 4 orphan CSS blocks from retired
  features. All mock code is provably DEV-gated / stripped from prod.

---

## Open items

### High — worth doing before a big push
- 🔭 **Proxy + cache the HRRR data-branch fetch.** Every visitor currently pulls
  `manifest.json` + `series.json` straight from `raw.githubusercontent.com`
  (`src/lib/hrrr.js`) — no edge cache, uncapped GitHub egress, and a large
  payload on cellular. It degrades gracefully (falls back to CAMS), so it won't
  *break* under load, but it's the one truly per-visitor uncapped upstream call.
  Fix: serve the frames through a cached Vercel function (same `s-maxage`
  treatment as `/api/aq`) or publish them to static hosting. *(Deferred: it's a
  bigger change than the snapping batch and wants its own test.)*
- 🔭 **Rate limiting** on the keyed endpoints (`/api/sensors`, `/api/history`,
  `/api/s`). Snapping closes the cheap cache-buster, but a determined abuser can
  still loop distinct real regions. A token bucket keyed on IP (Vercel KV /
  Upstash) is the real cap. *(Deferred: needs a KV store — no new infra was in
  scope for this pass.)*

### Medium — before press
- 🔭 **Content-Security-Policy.** The safe headers shipped; a real CSP needs a
  test pass because `/api/s` emits an inline `<script>location.replace(...)</script>`
  with per-request content (can't be hashed — either drop it in favor of the
  existing `<meta refresh>`, or add a nonce), plus allowances for `@vercel/og`,
  `@vercel/analytics`, and OSM tiles. Don't ship it blind to production.
- ⬜ **Lighthouse mobile ≥ 90** on the landing render (share-spec definition of
  done) — verify on the deployed build.

### Low — quick wins, anytime
- ⬜ `sessionStorage` cache of `centerData` for instant warm loads.
- ⬜ Single-flight lock on `/api/aq` cold-region misses (Vercel KV `waitUntil`)
  to fully coalesce the t=0 stampede — the 30s error cache mitigates most of it.

---

## Product surfaces (app / email / SMS)

Decisions for release, consistent with the share spec's zero-friction rules:

- **Native iPhone/Android app — skip, permanently.** Already an installable PWA;
  an app-store detour (link → store → install → open) kills the link-is-the-ad
  growth loop that the whole product is built on.
- **Email list — skip.** Violates the "no email capture" hard rule and is the
  wrong instrument for "how's my air right now." If a public update channel is
  ever wanted, host it off-site (Substack/Buttondown) and link out.
- **SMS alerts — defer; build Web Push instead.** SMS means per-message cost +
  phone-number PII + US A2P 10DLC carrier registration — all antithetical to a
  free, no-capture tool. Web Push on the installed PWA delivers "we'll tell you
  when your air clears" with no account, no PII, no phone number (that's what
  the install nudge is already setting up). Still a v2 feature: it needs a
  push-subscription store + a scheduled forecast-checker. Not a release blocker.

---

## Already solid (going into press)

- Verdict < 3s hard rule ✅ (Leaflet/map genuinely lazy; ~69.5 kB gzip critical
  path, point forecast not blocked behind the grid).
- No reflected XSS ✅ (escaping verified empirically); secrets server-only ✅.
- Clean model-only degradation when sensors/HRRR fail ✅; only a stage-1
  Open-Meteo failure is a hard error screen.
- Edge caching correctly set on every API function ✅.
- Disclaimer present and correctly scoped; "model estimate" vs "measured"
  labeling consistent ✅; server-rendered FAQ + explainer + FAQPage JSON-LD ✅.
