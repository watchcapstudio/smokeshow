// The footer Joe asked for: links to the city pages, plus the site furniture
// that currently has nowhere to live.
//
// It reads `LOCATIONS` rather than listing cities by hand, for the same reason
// vite.config.js globs the generated pages instead of enumerating them — a
// hand-kept list here would be a second place to forget when a city is added.
// Today that table holds one entry, so the footer renders one link. That is
// the honest state of it, not a placeholder to be filled with fake cities.

import { LOCATIONS } from '../data/locations.js';

export default function Footer() {
  return (
    <footer className="proto-footer">
      <div>
        <h2>Smoke forecasts by city</h2>
        <ul className="proto-footer__cities">
          {LOCATIONS.map((loc) => (
            <li key={loc.slug}>
              <a href={`/smoke-forecast/${loc.slug}/`}>{loc.label}</a>
            </li>
          ))}
        </ul>
      </div>

      <p className="proto-footer__note">
        Every forecast on this site is a model estimate, including the hours before now — those
        are model reanalysis, not measurements. Smokeshow is not health, medical, or safety
        advice.
      </p>

      <div className="proto-footer__meta">
        <span>Smokeshow</span>
        <span>Forecast: NOAA HRRR-Smoke · Copernicus CAMS · Open-Meteo</span>
        <span>Fires: NIFC WFIGS · NASA FIRMS</span>
      </div>
    </footer>
  );
}
