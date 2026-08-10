// The footer Joe asked for: links to the city pages, plus the site furniture
// that currently has nowhere to live.
//
// It reads `LOCATIONS` rather than listing cities by hand, for the same reason
// vite.config.js globs the generated pages instead of enumerating them — a
// hand-kept list here would be a second place to forget when a city is added.
// Today that table holds one entry, so the footer renders one link. That is
// the honest state of it, not a placeholder to be filled with fake cities.

import { LOCATIONS } from '../data/locations.js';
import { sourcesByRole } from '../data/sources.js';

// The credits, linked. Read from src/data/sources.js rather than written out
// here, for the same reason the city list is mapped rather than typed: the map's
// attribution control and the About page name the same feeds, and three
// hardcoded copies of a credit is three chances to link the wrong thing.
function Credits({ label, role }) {
  const sources = sourcesByRole(role);
  return (
    <span>
      {label}:{' '}
      {sources.map((s, i) => (
        <span key={s.key}>
          {i > 0 ? ' · ' : ''}
          <a href={s.href}>{s.name}</a>
        </span>
      ))}
    </span>
  );
}

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
        <Credits label="Forecast" role="forecast" />
        <Credits label="Fires" role="fires" />
        <Credits label="Hotspots" role="hotspots" />
      </div>

      {/* Licence wording, not a courtesy: the CAMS terms require this sentence
          wherever the data is shown, and the footer is the one place on the page
          guaranteed to be present whether or not the map has been opened. */}
      <p className="proto-footer__note">
        Generated using Copernicus Atmosphere Monitoring Service information.
      </p>
    </footer>
  );
}
