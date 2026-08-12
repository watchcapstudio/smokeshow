// Entry for the editorial pages: the hub at /smoke-forecast/ and the three
// corridor pages under it. Stylesheets only — no React, no App.
//
// Those pages are directories, not forecasts. They have no coordinates, so
// booting App.jsx on them would land in requestLocation() and fire a geolocation
// prompt at a reader who asked for a list of cities. The hard rule in the brief
// is that a location page must never prompt; a page with no location has even
// less business doing it.
//
// Same import order as main.jsx and App.jsx: tokens, then sky re-pointing the
// palette at the ink, then shell, then the static-page surfaces. Without
// SkyBackdrop running there is no live ink to re-point at, so these pages paint
// the registered @property initial values — a clear midday sky, which is the
// correct resting state for reference material.
import './styles/tokens.css';
import './styles/sky.css';
import './styles/shell.css';
import './styles/seo.css';

// The directory's live levels. Additive by design: the pages ship as plain link
// lists and stay that way if this fetch fails, if the endpoint is down, or if
// JS never runs. Nothing below throws into the page.
//
// Only the hub and the corridor pages carry [data-city-level] slots, so this
// no-ops on /about/ and /how-smoke-forecasts-work/ without a branch.
import { applyCityLevels } from './lib/cityLevels.js';

if (document.querySelector('[data-city-level]')) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  fetch('/api/levels')
    .then((r) => (r.ok ? r.json() : null))
    .then((payload) => {
      if (payload) applyCityLevels(document, payload, { timeZone });
    })
    .catch(() => {});
}
