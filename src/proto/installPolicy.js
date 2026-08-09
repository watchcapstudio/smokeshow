// When to ask for the Home Screen — a proposal, and the numbers are the
// proposal.
//
// The live policy (lib/installNudge.js) gates on ONE counter: `visits`, which
// increments at most once per calendar day, and fires at 2. So the ask lands
// on the second day someone opens the site, whether that was a considered
// return or an accidental second tap on the same link.
//
// Joe's ask was "over x sessions and days", which is two counters, and he is
// right that it wants both. A session count alone rewards someone who reloads
// the page five times in one smoky afternoon — the worst moment to interrupt.
// A day count alone can't tell a real return from a stale tab waking up.
//
// So: BOTH must clear.
//
//   sessions ≥ 3   a session is a load separated from the last activity by
//                  SESSION_GAP_MIN, so reloads and tab-switches inside one
//                  sitting count once
//   days     ≥ 2   distinct calendar days, unchanged from the live rule
//
// Everything else is carried over from the live policy because it was already
// right: never when already installed, never in an in-app browser where the
// gesture does not exist, and a 14-day silence after any dismissal.
//
// The pitch is also worth its own rule. Someone whose air is bad has a reason
// to come back tomorrow and the nudge can say so; someone on a clear day does
// not, and gets the quieter line. That logic is the live one, unchanged.

import { getJSON, setJSON } from '../lib/storage.js';

export const MIN_SESSIONS = 3;
export const MIN_DAYS = 2;
export const SESSION_GAP_MIN = 30;
export const DISMISS_COOLDOWN_DAYS = 14;
/// Long enough that the reader has had the answer before being asked for
/// anything. The live site uses 6s; iOS waits 20s for the same reason and is
/// the better instinct — but the web has no session to come back to, so this
/// sits between them.
export const SHOW_DELAY_MS = 12_000;

const KEY = 'protoInstallState';
const DISMISS_KEY = 'protoInstallDismissedAt';

function today() {
  return new Date().toISOString().slice(0, 10);
}

/// Call once per load. Returns the state after recording this visit.
export function recordVisit(nowMs = Date.now()) {
  const s = getJSON(KEY) || { sessions: 0, days: [], lastSeenMs: 0 };
  const newSession = nowMs - (s.lastSeenMs || 0) > SESSION_GAP_MIN * 60_000;
  const day = today();
  const next = {
    sessions: s.sessions + (newSession ? 1 : 0),
    days: s.days.includes(day) ? s.days : [...s.days, day],
    lastSeenMs: nowMs,
  };
  setJSON(KEY, next);
  return next;
}

export function markDismissed() {
  setJSON(DISMISS_KEY, Date.now());
}

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true
  );
}

function platform() {
  const ua = navigator.userAgent;
  if (/Instagram|FBAN|FBAV|FB_IAB|Line\/|GSA\/|Twitter/i.test(ua)) return 'in-app';
  if (/iPhone|iPad|iPod/.test(ua)) {
    return /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua) ? 'ios-other' : 'ios-safari';
  }
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

/// Why the nudge is or is not showing, in words. The review panel prints this
/// so the policy can be argued with, rather than being a number buried in a
/// module nobody opens.
export function explain() {
  const s = getJSON(KEY) || { sessions: 0, days: [] };
  const dismissedAt = getJSON(DISMISS_KEY);
  const cooling =
    dismissedAt && Date.now() - dismissedAt < DISMISS_COOLDOWN_DAYS * 86_400_000;

  const reasons = [];
  if (isStandalone()) reasons.push('already installed');
  if (cooling) reasons.push(`dismissed < ${DISMISS_COOLDOWN_DAYS}d ago`);
  if (s.sessions < MIN_SESSIONS) reasons.push(`sessions ${s.sessions}/${MIN_SESSIONS}`);
  if (s.days.length < MIN_DAYS) reasons.push(`days ${s.days.length}/${MIN_DAYS}`);
  const p = platform();
  if (p === 'in-app' || p === 'ios-other') reasons.push(`no install gesture (${p})`);

  return {
    sessions: s.sessions,
    days: s.days.length,
    platform: p,
    eligible: reasons.length === 0,
    reasons,
  };
}

/// { kind: 'ios' | 'android' | 'desktop' } or null.
export function eligibility() {
  const state = explain();
  if (!state.eligible) return null;
  if (state.platform === 'ios-safari') return { kind: 'ios' };
  if (state.platform === 'android') return { kind: 'android' };
  return { kind: 'desktop' };
}
