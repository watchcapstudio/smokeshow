# Notification backend — design and load estimate

The service behind the paid apps' push notifications. Implementation lives in
`services/notify/`; this document is the *why*, plus the numbers that decide
whether it is affordable.

> **This is server state, and it is deliberately outside `CLAUDE.md`'s
> static-first rule.** That rule governs the web product, which has no
> notifications and never will (platform plan §1: "Web has no notification
> settings — CTA only"). Nothing here touches `src/`, `api/`, or the web
> build. The web app keeps zero server state.

Companion docs: `docs/smokeshow-platform-plan.md` §5 (notifications) and §4
(subscriptions); `docs/forecast-api-contract.md` (the one upstream).

---

## 1. What it does, and what it refuses to do

The demo's settings-sheet posture ships verbatim and is the product spec:

> **Threshold alerts only. No digests, no streaks, no engagement pings.**

The API serves that sentence back to every client in the device record
(`policy`), so all three apps render one string and none of them invents a
fifth notification type.

Four notification types exist. There is no fifth, and adding one is a product
decision, not an implementation detail:

| Type | Fires when | Urgent? |
| --- | --- | --- |
| `threshold-crossed` | The air rises across *the subscriber's* threshold | At `Tastes like fire` (level 3), or level 2 for a sensitive household |
| `cleared` | The air falls back below their threshold | Never — good news can wait until morning |
| `peak-reached` | The forecast peak stops being ahead of us: this is as bad as it gets | Never |
| `incoming` | An arrival newly appears within 36 hours, and it will cross their threshold | Never |

Everything the push says is a string the server already computed. **The title
says what the air is now; the body says what happens next** — the title is the
level name from `scale[]` plus the user's own label for the place, and the body
is `verdict.headline` verbatim, for every one of the four types. The
service never formats a clear-time and never recomputes one — contract §6 is
explicit that a client which re-derives a clear-time is a bug even when it
agrees, and a push is the one surface the user cannot refresh.

**Nothing is scheduled per user.** A run that finds no state change sends
nothing, forever. That is the intended steady state, not a failure mode.

---

## 2. Identity: anonymous, device-scoped, deletable

A device registers a push token, a platform, up to ten locations, a threshold,
quiet hours, and a sensitive-household flag. It gets back an opaque ID
(`dev_…`) and a secret, shown exactly once; the server stores only a SHA-256 of
the secret.

There is no email, no password, no account, and no recovery flow — a device
that loses its secret re-registers. `DELETE /v1/devices/:id` is therefore a
complete erasure: there is no second record of the person anywhere in the
system. RevenueCat's `app_user_id` defaults to the device's own opaque ID, so
the billing provider learns nothing either.

An unauthenticated or wrongly-authenticated device request returns **404, not
401** — a distinguishable 401 would turn the endpoint into an oracle for which
opaque IDs exist.

---

## 3. The lattice, which is the whole cost model

`snapCoord()` from `src/lib/grid.js` snaps every subscribed location onto the
same 0.1° lattice `/api/forecast` snaps to before calling upstream. Two
subscribers in the same cell provably receive the same payload, because the
endpoint would have fetched the same URL for each of them.

So evaluation is **O(unique occupied cells)**, not O(users):

```
listOccupiedCells()  ->  N cells   (entitled, enabled, token-bearing only)
  for each cell:  fetch -> computeVerdict-derived state -> diff
    if changed:   fan out to that cell's subscribers
```

Ten thousand subscribers in Denver is one fetch and one diff. This is asserted,
not assumed: `services/notify/test/evaluate.test.js` registers 10,000 devices
in one cell and proves the run makes exactly one forecast fetch and one verdict
diff — and still delivers 10,000 distinct notifications, one per device.

The tradeoff is honest and bounded: a 0.1° cell is ~11 km, so two subscribers
across a lattice boundary cost two fetches even though they are neighbours.
That is fine. A coarser lattice would start returning the wrong city's air, and
a finer one multiplies run cost by the square of the refinement while buying no
accuracy — CAMS resolves at ~40 km.

---

## 4. Ordering, and the exactly-once guarantee

Inside a cell the order is deliberate:

```
fetch → diff → fan out → THEN store the new state
```

Storing state *last* means a crash mid-fan-out replays the transition on the
next run: the sends that already went out are suppressed by their dedupe
claims, and the rest go out an hour late. Storing state first would lose them
entirely. **Late beats never; duplicate beats neither** — and the claim is what
guarantees the difference.

Four gates stand between a cell transition and a lock screen:

1. **Threshold** — is this change one they asked about?
2. **Quiet hours** — 10 PM–7 AM local, urgent only, applied at *fan-out*.
3. **Rate limit** — 3 hours minimum between non-urgent alerts for the same
   place. A spam guard: it can only ever remove notifications.
4. **Dedupe claim** — `INSERT … ON CONFLICT DO NOTHING` on
   `(device_id, dedupe_key)`. Zero rows back means someone already sent this.

Gate 4 is the guarantee. The claim is keyed by device and by the *transition*,
not by the run, so a retried run, a resumed crash, or a device that subscribed
to the same cell under two labels all collapse to one send. The claim is taken
*before* the send: if the process dies in between, one alert is lost; if it
died after the send instead, nobody is woken twice. Losing one alert beats
sending a duplicate at 3 AM.

A retryable delivery failure releases its claim so the next run tries again. A
dead token or a permanent rejection keeps it, so an undeliverable message is
never re-attempted forever.

**Quiet hours drop, they do not defer.** A suppressed 2 AM alert that has
already reversed by 7 AM correctly produces silence — a morning digest is
exactly the mechanic the product refuses. If the air is still worse at
breakfast, the next upward crossing fires normally.

---

## 5. Entitlement, server-side

Client-side gating is not enough, and the reason is money: a lapsed subscriber
whose app still asks to be notified costs a fetch, a diff, and a delivery every
hour, forever. The gate lives where the compute is spent —
`listOccupiedCells()` filters on it, so **a cell occupied only by lapsed
devices is never fetched at all**.

RevenueCat's webhook feeds it (platform plan §4). The state machine:

| Event | Result |
| --- | --- |
| `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE` | Entitled until `expiration_at_ms` |
| `CANCELLATION` | **Still entitled** until expiry — auto-renew off is not access off |
| `BILLING_ISSUE` | Still entitled; RevenueCat already extends the expiry through the store's grace period |
| `EXPIRATION`, refunds | Revoked immediately |
| `SUBSCRIBER_ALIAS`, `TRANSFER` | Identity rewritten, access untouched — a restore on a new device keeps its subscription |

The gate closes on the timestamp with no webhook required: an entitlement whose
`expires_at` has passed drops out of the query on the next run.

The webhook is authenticated with a shared credential in the `Authorization`
header, compared in constant time. **Unconfigured means closed, never open.**

---

## 6. Load estimate at 1k / 10k / 100k subscribers

### Where the cell count comes from

Subscribers cluster; cells saturate. Assuming ~1.3 locations per subscriber
spread across metro areas of roughly 20 usable cells each, the tenth subscriber
in a metro is nearly free while the first is not:

| Subscribers | Occupied cells | Notes |
| --- | --- | --- |
| 1,000 | ~900 | Early adopters are scattered; almost every one is a new cell |
| 10,000 | ~5,500 | Metros are filling in — 10× the users, 6× the cells |
| 100,000 | ~18,000 | Saturated: 10× the users, 3× the cells |

**10× the subscribers is 2–3× the cost.** That is the entire argument for the
lattice, and it is why the service gets cheaper per subscriber as it grows.

### Measured compute

`node services/notify/bin/loadcheck.js <subscribers> <cells>`, Node 22, one
core, push stubbed (APNs and FCM are free). Timings exclude network.

| Subscribers | Cells | Steady-state run | Worst-case run¹ | ms/cell |
| --- | --- | --- | --- | --- |
| 1,000 | 900 | 0.43 s | 0.44 s (1k notifications) | 0.53 |
| 10,000 | 5,500 | 2.6 s | 3.0 s (10k notifications) | 0.53 |
| 100,000 | 18,000 | 9.1 s | 10.6 s (100k notifications) | 0.49 |

¹ Every occupied cell crosses a threshold in the same hour — a continental
smoke event, and a scenario the real atmosphere does not produce.

Our own compute is not the constraint at any of these scales. **One small
instance, once an hour, is enough at 100,000 subscribers.** Cost is dominated
by the run's I/O, below.

### Upstream calls — the real constraint

One `/api/forecast` call per cell per hour. The endpoint caches at
`s-maxage=600` and `/api/aq` beneath it at `s-maxage=1800`, but an hourly
worker misses both by construction, so plan for one upstream fetch per cell per
hour:

| Subscribers | Fetches/hour | Fetches/day | Fetches/month |
| --- | --- | --- | --- |
| 1,000 | 900 | 21,600 | 648,000 |
| 10,000 | 5,500 | 132,000 | 3,960,000 |
| 100,000 | 18,000 | 432,000 | 12,960,000 |

**Open-Meteo's free tier is 10,000 calls/day. This service exceeds it at
roughly 400 cells — well before 1,000 subscribers.** A paid Open-Meteo plan (or
a self-hosted CAMS mirror) is a launch prerequisite, not a scaling problem. Do
not discover this in production.

The mitigation is already named in `CLAUDE.md`'s build order: Open-Meteo
supports **multi-coordinate batching**. Batching 100 cells per upstream call
turns 13M calls/month at 100k subscribers into 130k. That work belongs behind
`/api/aq`, benefits the web map's grid fetch identically, and should land
before the apps ship.

### Bandwidth, and a recommendation for B1

A full `/api/forecast` payload is **72 KB** — 192 hours, each carrying a sky
object. The service consumes **325 bytes** of it: the verdict, the observation
hour, the timezone, and one level name.

| Subscribers | Ingress/run | Ingress/month |
| --- | --- | --- |
| 1,000 | 65 MB | 47 GB |
| 10,000 | 396 MB | 285 GB |
| 100,000 | 1.3 GB | 933 GB |

**Recommendation:** an additive `?fields=verdict` slim mode on `/api/forecast`
would cut that ~220×, to about 4 GB/month at 100,000 subscribers. Contract §2
permits it without a version bump (additive, optional, decoders ignore unknown
fields), and §4 already reserves exactly this shape for `sky`. It is the single
highest-leverage change available to this service and it costs B1 an afternoon.

### Concurrency

The run is I/O-bound. At a 200 ms round trip and the default concurrency of 8,
18,000 cells take ~7.5 minutes — inside the hour, but not comfortably.
`NOTIFY_CELL_CONCURRENCY` must scale with the cell count: 64 brings the same
run to under a minute.

| Subscribers | Suggested concurrency | Run wall-clock @200 ms |
| --- | --- | --- |
| 1,000 | 8 | ~23 s |
| 10,000 | 32 | ~35 s |
| 100,000 | 64 | ~56 s |

### Delivery

APNs and FCM are free to send. Volume is bounded by the rate limit at 8 alerts
per device per place per day, and the realistic figure during an active smoke
event is 1–2. At 100,000 subscribers with a fifth of them under smoke, that is
~30,000 pushes/day — a rounding error for either provider.

### Storage

| Table | At 100k subscribers |
| --- | --- |
| `devices` + `device_locations` | ~50 MB |
| `cell_states` | 18,000 × 325 B ≈ 6 MB |
| `sent_notifications` (7-day retention) | ~210k rows ≈ 20 MB |

Under 100 MB. The smallest managed Postgres on any provider is oversized for
this, and will be for a long time.

### Summary

| | 1k | 10k | 100k |
| --- | --- | --- | --- |
| Occupied cells | ~900 | ~5,500 | ~18,000 |
| Compute per run | 0.4 s | 2.6 s | 9 s |
| Upstream calls/month | 648k | 4.0M | 13.0M |
| Ingress/month (full payload) | 47 GB | 285 GB | 933 GB |
| Ingress/month (slim mode) | 0.2 GB | 1.3 GB | 4.2 GB |
| Push deliveries | free | free | free |
| Database | <5 MB | ~10 MB | <100 MB |
| Shape of the bill | Open-Meteo plan | Open-Meteo plan | Open-Meteo plan |

At every scale the dominant cost is upstream forecast calls, and at every scale
the fix is batching rather than more machines. Compute, storage, and delivery
stay negligible through 100,000 subscribers.

---

## 7. Deliberate omissions

- **No digests, no streaks, no engagement pings, no re-engagement.** Product
  decision, stated in the demo and enforced by there being nowhere in the code
  to schedule one.
- **No notification on registration.** Subscribing is not a state change; a
  new cell is seeded silently on first sighting. A push at signup would be an
  engagement ping wearing a threshold alert's clothes.
- **No verdict computation.** The service reads `verdict` and diffs it. See
  contract §6.
- **No delivery receipts or open tracking.** Nothing to collect and nobody to
  attribute it to.
- **No web involvement.** The web app has no notifications, no server state,
  and no knowledge that this service exists.

## 8. Still open

1. **Slim-mode `/api/forecast`** (§6) — needs a small additive change in B1.
2. **Upstream batching** — belongs behind `/api/aq`, benefits the web map too.
3. **Place names in notification titles.** Titles use the label the device
   supplied at registration and fall back to no label at all; `/api/forecast`
   carries no place name. Reverse geocoding is the alternative and it is a
   privacy cost — the current design never learns where anyone lives beyond a
   lattice cell.
4. **Per-location quiet hours.** Today quiet hours are per device, resolved in
   the device's own zone with the cell's zone as fallback. Watching a place
   several timezones away is the case that would want more.
