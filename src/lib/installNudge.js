import { getJSON, setJSON } from './storage.js';

// Home-Screen nudge policy (per share-spec zero-friction rules): never on
// first visit, never twice in 14 days after a dismissal, never when already
// installed, never in in-app browsers where the gesture is impossible.
//
// What each platform gets changed when the iOS app shipped. Before that, iOS
// Safari got Add-to-Home-Screen instructions — which now compete with the
// listing for the same tap, and win, sending the reader to a bookmark instead
// of a subscription. So:
//
//   ios-safari  none. Safari's own Smart App Banner (the apple-itunes-app
//               meta in index.html) already makes the ask, natively, on the
//               first visit. A second sheet saying the same thing is noise.
//   ios-other   the store. Chrome/Firefox/Edge on iOS never draw the Smart
//               App Banner, so this is the only ask those readers see.
//   android     unchanged Add-to-Home-Screen, via the real native prompt.
//               There is no Play listing yet; the PWA is the Android product.

const VISITS_KEY = 'visits';
const DISMISS_KEY = 'installNudgeDismissedAt';
const DISMISS_COOLDOWN_DAYS = 14;

let deferredInstallPrompt = null;

// Call once at startup. Chrome fires beforeinstallprompt on its own schedule
// — sometimes before React mounts, sometimes long after — so we both store
// the event and signal any mounted nudge to re-check eligibility.
export function initInstallCapture() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    window.dispatchEvent(new Event('smokeshow:install-ready'));
  });
}

export function recordVisit() {
  const today = new Date().toISOString().slice(0, 10);
  const v = getJSON(VISITS_KEY) || { count: 0, lastDay: null };
  if (v.lastDay !== today) {
    setJSON(VISITS_KEY, { count: v.count + 1, lastDay: today });
    return v.count + 1;
  }
  return v.count;
}

export function markDismissed() {
  setJSON(DISMISS_KEY, Date.now());
}

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true
  );
}

function platform() {
  const ua = navigator.userAgent;
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|Line\/|GSA\/|Twitter/i.test(ua);
  if (inApp) return 'in-app';
  if (/iPhone|iPad|iPod/.test(ua)) {
    // Only Safari gets the share-sheet instructions — other iOS browsers
    // bury the gesture differently and wrong instructions are worse than none.
    const isSafari = !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua);
    return isSafari ? 'ios-safari' : 'ios-other';
  }
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

// Returns { kind: 'ios-store' | 'android', promptEvent? } or null when the
// nudge should not show.
export function installNudgeEligibility() {
  if (isStandalone()) return null;

  const dismissedAt = getJSON(DISMISS_KEY);
  if (dismissedAt && Date.now() - dismissedAt < DISMISS_COOLDOWN_DAYS * 86_400_000) return null;

  const visits = getJSON(VISITS_KEY)?.count ?? 0;
  if (visits < 2) return null; // return visitors only — first visits stay friction-free

  const p = platform();
  if (p === 'ios-other') return { kind: 'ios-store' };
  if (p === 'android' && deferredInstallPrompt) {
    return { kind: 'android', promptEvent: deferredInstallPrompt };
  }
  return null; // ios-safari: the Smart App Banner has it
}
