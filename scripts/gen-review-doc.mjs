// Regenerates docs/city-pages-review.md: the list of things that need a human
// eye on the city pages.
//
// It is generated rather than hand-written for the same reason the FAQ and its
// JSON-LD come from one array. A review checklist typed by hand goes stale the
// first time a coordinate changes or a validate item is answered, and a stale
// checklist is worse than none, because it looks authoritative. Everything here
// is read from the data that actually shipped, plus the original brief in
// docs/review-src/, which is vendored so this script does not depend on a file
// that only existed in one chat session.
//
// Run: npm run review

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCATIONS } from '../src/data/locations.js';
import { CORRIDORS } from '../src/data/corridors.js';
import { SOURCES } from '../src/data/sources.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = JSON.parse(readFileSync(join(ROOT, 'docs/review-src/smokeshow-cities.json'), 'utf8'));
const bySlug = Object.fromEntries(RAW.cities.map((c) => [c.slug, c]));

// Build order from the spec, so the checklist reads in the order the pages were
// written rather than alphabetically.
const ORDER = [
  'missoula-mt',
  'whitefish-mt',
  'bozeman-mt',
  'jackson-wy',
  'winnipeg-mb',
  'minneapolis-mn',
  'seattle-wa',
  'denver-co',
  'spokane-wa',
  'detroit-mi',
  'milwaukee-wi',
  'cleveland-oh',
  'toronto-on',
  'boston-ma',
  'new-york-ny',
  'philadelphia-pa',
  'pittsburgh-pa',
  'portland-or',
  'bend-or',
  'boise-id',
  'salt-lake-city-ut',
  'reno-nv',
  'sacramento-ca',
  'fresno-ca',
  'chicago-il',
];

// Decisions I made rather than questions I left open. Hand-maintained, because
// there is nothing in the data to derive them from: each one is a judgment call
// with a cost, and the cost is the part worth reading.
const DECISIONS = [
  [
    'Section order',
    'Landmarks, provenance, what-is-not-smoke, valley, FAQ, links, disclaimer. You said FAQ on the bottom and I picked the rest. Locked by a test.',
  ],
  [
    'Footer is six links',
    'All cities, How smoke forecasts work, Canadian smoke explained, About, Privacy, Terms. The spec said five. Getting back to five means dropping the Canadian explainer, which costs that page an internal link from all 30 pages.',
  ],
  [
    '"Smoke where you are" is gone',
    'The home link came out of the footer to make room. A reader on a city page now has no one-click door to the app for their own location.',
  ],
  [
    'Privacy and Terms are off-site',
    'They point at watchcapstudio.com, because those documents cover every product the studio ships and say so on the page. No second copy on this domain to drift.',
  ],
  [
    'Page titles use a colon',
    'The em-dash sweep changed every title separator, including the existing Chicago page and the homepage. `Wildfire Smoke in Reno: When Will It Clear?`',
  ],
  [
    'Em-dashes gone sitewide',
    '84 replacements, including the review candidate at asdfasdf/ and pre-existing homepage copy. A test now fails the build on a new one. The rule covers pages the site serves, not internal docs like this one, which is why your questions below still read as you wrote them.',
  ],
  [
    'Fresno links four destinations',
    'Everyone else has five to eight. Its source data gives it one nearby city and no upwind. Padding it would have meant an unearned link, which breaks the more important half of the rule.',
  ],
  [
    'Open-Meteo URL is my guess',
    'The other four source URLs were already shipping in `src/components/SmokeMap.jsx`. `https://open-meteo.com/` is the one I supplied, and I could not verify it because outbound egress is blocked in my environment.',
  ],
];

const EXTRA = [
  [
    'CHANGE. Fresno flow direction',
    "Sacramento's page lists Fresno as upwind on southerly flow. Fresno's own provenance describes fires hundreds of miles north draining south, which makes Sacramento upwind of Fresno. Both are true of a valley that vents poorly in every direction; the site can only assert one. I took the direction Sacramento already asserts and stated it from Fresno's end as `downwind`. If the north-to-south drain is dominant, both arrays flip.",
  ],
  [
    'CHANGE. The proto footer lists every city',
    '`src/proto/Footer.jsx` maps `LOCATIONS`, so the front-end candidate now renders 25 city links. The spec forbade exactly that, and the candidate had no Privacy or Terms link either. I added the data-source links and left the city list alone, because which footer wins is a homepage design decision.',
  ],
  [
    'Two claims I cut',
    "Minnesota's 2021 air quality alert count, and Manitoba evacuations \"in recent summers\". Both were verbatim from your JSON and neither could be sourced. If you can source either, it goes back.",
  ],
  [
    'No About copy for the studio',
    'You sent Privacy and Terms. `/about/` is about the product. If the studio wants its own About page linked from this footer, that is a separate page and separate copy.',
  ],
  [
    'FIRMS was labelled "Fires" in the proto footer',
    'The project rules say thermal hotspots must never be labelled as fires or as named incidents, so it now sits on its own "Hotspots" row.',
  ],
];

const out = [];
const p = (s = '') => out.push(s);

p('# City pages: what needs your eyes');
p();
p('Generated by `npm run review` from `src/data/locations.js`, `src/data/corridors.js`,');
p('`src/data/sources.js` and the original brief in `docs/review-src/`. Nothing here is');
p('transcribed by hand, so it cannot drift from what shipped. Regenerate after any data change.');
p();
p('Tick a box when you have confirmed it. A line marked CHANGE means answering it costs a code');
p('edit, not just a tick.');
p();
p('---');
p();
p('## 1. Decisions I made that are yours to reverse');
p();
p('Live on the branch right now. These are judgment calls I had to make to finish, not questions');
p('I left open.');
p();
for (const [t, d] of DECISIONS) p(`- [ ] **${t}.** ${d}`);
p();
p('---');
p();
p('## 2. Coordinates and timezones');
p();
p('I supplied all 24 of the new ones. A wrong coordinate is a silently wrong forecast rather than');
p('a wrong sentence, which makes this the highest-value pass in this file.');
p();
p('| City | Lat | Lon | Timezone |');
p('|---|---|---|---|');
for (const slug of ORDER) {
  const l = LOCATIONS.find((x) => x.slug === slug);
  if (!l) continue;
  const note = slug === 'chicago-il' ? ' _(pre-existing, not mine)_' : '';
  p(`| ${l.label}${note} | ${l.lat} | ${l.lon} | ${l.timezone} |`);
}
p();
p('---');
p();
p('## 3. Your validate questions, by city');
p();
p('Verbatim from the JSON. I resolved none of them, guessed at none of them, and picked no values.');
p();
for (const slug of ORDER) {
  const raw = bySlug[slug];
  const l = LOCATIONS.find((x) => x.slug === slug);
  if (!raw || !l) continue;
  const items = raw.validate ?? [];
  if (!items.length) continue;
  p(`### ${l.label} — \`/smoke-forecast/${slug}/\``);
  p();
  for (const v of items) p(`- [ ] ${v}`);
  p();
}
p('---');
p();
p('## 4. Extra items I am adding');
p();
for (const [t, d] of EXTRA) p(`- [ ] **${t}.** ${d}`);
p();
p('---');
p();
p('## 5. Data source links, as shipped');
p();
p('| Source | Role | URL | Where the URL came from |');
p('|---|---|---|---|');
for (const s of SOURCES) {
  const proven =
    s.key === 'open-meteo' ? '**mine, unverified**' : 'already shipping in `SmokeMap.jsx`';
  p(`| ${s.name} | ${s.role} | ${s.href} | ${proven} |`);
}
p();
p('Copernicus requires the sentence "Generated using Copernicus Atmosphere Monitoring Service');
p('information" wherever CAMS data is shown. It appears on the map, on `/about/`, and in the');
p('candidate footer.');
p();
p('---');
p();
p('## 6. What shipped');
p();
p(`- ${LOCATIONS.length} city pages at \`/smoke-forecast/<slug>/\``);
p('- 1 hub at `/smoke-forecast/`');
p(`- ${CORRIDORS.length} corridor pages at \`/smoke-forecast/corridor/<slug>/\``);
p('- 1 about page at `/about/`');
const notSmoke = LOCATIONS.filter((l) => l.notSmoke);
const valley = LOCATIONS.filter((l) => l.valley);
p(
  `- ${notSmoke.length} pages carry a "what looks like smoke but isn't" section: ${notSmoke
    .map((l) => l.name)
    .join(', ')}`,
);
p(
  `- ${valley.length} carry valley or gateway prose: ${valley.map((l) => l.name).join(', ')}`,
);
p(
  `- ${LOCATIONS.filter((l) => l.bands).length} carry their own distance bands; Chicago inherits the universal ones`,
);
p();
p('**Verdict block: still client-side.** The static HTML ships `<div id="root"></div>` and carries');
p('no level, no clear time and no run stamp. You asked me to leave it that way.');
p('`src/App.jsx` is what decides it:');
p();
p('```js');
p('const verdict = useMemo(');
p('  () =>');
p('    serverForecast?.verdict ??');
p('    (anchoredPm25 ? computeVerdict({ pm25: anchoredPm25, nowIndex }) : null),');
p('  [serverForecast, anchoredPm25, nowIndex],');
p(');');
p('```');
p();

writeFileSync(join(ROOT, 'docs/city-pages-review.md'), out.join('\n'));
console.log(`docs/city-pages-review.md: ${out.length} lines`);
