// The data sources, named and linked, in one place.
//
// This table exists because the same credits appear in at least three places
// that had no reason to agree: the map's Leaflet attribution control, the footer
// of the front-end candidate, and the About page. Three hardcoded copies of a
// credit is three chances to link the wrong thing, or to drop one when a feed
// changes.
//
// Copernicus is the reason this matters beyond tidiness. The CAMS licence
// requires the "Generated using Copernicus Atmosphere Monitoring Service
// information" wording wherever the data is shown, which is why `credit` is a
// separate field from `name`: the short name is what reads well in a list, and
// the credit is what the licence asks for. Anywhere CAMS DATA is displayed, use
// `credit`. In a list of where the numbers come from, `name` is enough.
//
// The URLs are the human-facing pages, not the API endpoints. Four of the five
// were already shipping in src/components/SmokeMap.jsx's attribution control
// before this file existed, which is what validates them.

export const SOURCES = [
  {
    key: 'hrrr',
    role: 'forecast',
    name: 'NOAA HRRR-Smoke',
    href: 'https://rapidrefresh.noaa.gov/hrrr/',
    credit: 'NOAA HRRR-Smoke',
  },
  {
    key: 'cams',
    role: 'forecast',
    name: 'Copernicus CAMS',
    href: 'https://atmosphere.copernicus.eu/',
    // Licence wording. Do not shorten this where CAMS data is on screen.
    credit: 'Generated using Copernicus Atmosphere Monitoring Service information',
  },
  {
    key: 'open-meteo',
    role: 'forecast',
    name: 'Open-Meteo',
    href: 'https://open-meteo.com/',
    credit: 'Open-Meteo',
  },
  {
    key: 'nifc',
    role: 'fires',
    name: 'NIFC WFIGS',
    href: 'https://data-nifc.opendata.arcgis.com/',
    credit: 'NIFC WFIGS',
  },
  {
    key: 'firms',
    role: 'hotspots',
    name: 'NASA FIRMS',
    href: 'https://firms.modaps.eosdis.nasa.gov/map/',
    credit: 'NASA FIRMS',
  },
];

export function sourcesByRole(role) {
  return SOURCES.filter((s) => s.role === role);
}
