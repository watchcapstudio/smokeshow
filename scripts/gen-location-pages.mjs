// Generates one static HTML page per entry in src/data/locations.js, plus the
// sitemap that points at them. Runs before `vite build` (see package.json) so
// the emitted files exist by the time Vite resolves its multi-page inputs.
//
// Why static HTML rather than a client-side route: the whole point of a
// location page is that a crawler sees the city's words in the initial payload.
// A React route would hand Google an empty #root and a promise. This is the
// same reason index.html carries its FAQ as literal HTML.
//
// The FAQ copy and the FAQPage JSON-LD below are both generated from the SAME
// questions array. index.html hand-mirrors those two and has to be kept in sync
// by hand; here they cannot drift, because there is only one copy.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCATIONS, locationBySlug } from '../src/data/locations.js';
import { CORRIDORS, corridorBySlug } from '../src/data/corridors.js';
import { LEVELS } from '../src/lib/rating.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECTION = 'smoke-forecast'; // URL segment: /smoke-forecast/<slug>/
const CORRIDOR_SEGMENT = 'corridor'; // /smoke-forecast/corridor/<slug>/
const ORIGIN = 'https://smokeshow.earth';

// Text -> HTML text node. Attributes get the same treatment plus quotes.
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}

// JSON destined for a <script> body. JSON.stringify does not escape '<', so a
// value containing "</script>" would close the block and everything after it
// would parse as markup. The HTML parser does not decode entities inside
// script elements either, which rules out esc() here — the fix has to be a
// JSON-level escape that survives JSON.parse unchanged.
function jsonForScript(value, indent) {
  return JSON.stringify(value, null, indent)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

// The disclaimer is reproduced verbatim from the brief, exactly as index.html
// carries it. It is not paraphrased per city and must not be.
const DISCLAIMER = `<strong>Smokeshow is for informational and educational purposes only.</strong> It is
            not health, medical, or safety advice. Forecasts are model estimates and can be wrong,
            sometimes by a lot. Descriptions of what you might smell, see, or feel are
            generalizations, not predictions about your body. For decisions about your health,
            outdoor activity, or air quality safety, rely on official sources like AirNow.gov, the
            National Weather Service, and your local health authorities, and talk to a medical
            professional about your own situation.`;

// The shared footer. Five links at most, sitewide, and deliberately NOT 25 city
// links: a footer that lists every city on every city page dilutes the one
// signal these pages have, which is that each of them links a small number of
// places for a stated reason. The hub is where the full list lives.
//
// Hand-mirrored in index.html, same as the FAQ already is. Keep them in sync.
const FOOTER_LINKS = [
  { href: '/', text: 'Smoke where you are' },
  { href: `/${SECTION}/`, text: 'All cities' },
  {
    href: `/${SECTION}/${CORRIDOR_SEGMENT}/canadian-smoke-great-lakes-northeast/`,
    text: 'Canadian smoke explained',
  },
  { href: '/#how-smoke-forecasts-work', text: 'How smoke forecasts work' },
];

function footer() {
  const links = FOOTER_LINKS.map(
    ({ href, text }) => `
          <a href="${escAttr(href)}">${esc(text)}</a>`,
  ).join('');
  return `
      <footer class="site-footer">
        <nav class="site-footer__nav" aria-label="Site">${links}
        </nav>
      </footer>`;
}

function landmarkRows(loc) {
  return loc.landmarks
    .map((line, i) => {
      const level = LEVELS[i];
      if (!level) return '';
      // Per-city band if the city carries one, else the universal distance from
      // LEVELS. The level NAME is never per-city — it is the threshold's name.
      const band = loc.bands?.[i] ?? level.visibility;
      return `
            <li class="landmarks__item">
              <span class="landmarks__level">${esc(level.name)}</span>
              <span class="landmarks__vis">${esc(band)}</span>
              <p class="landmarks__sight">${esc(line)}</p>
            </li>`;
    })
    .join('');
}

// Internal links, all contextually earned. Upwind first, because it is the only
// one of these a reader has a reason to click before they have a reason to
// browse: "what is about to happen to me" is a better question than "what else
// do you cover".
//
// Every destination is resolved against the pages this build actually emits, so
// a slug that is not built yet is skipped rather than shipped as a 404. That
// means the block grows as cities land instead of needing a second pass.
function linkBlock(loc) {
  const items = [];

  for (const { slug, note } of loc.upwind ?? []) {
    const dest = locationBySlug(slug);
    if (!dest) continue;
    items.push(`
              <li class="citylinks__item">
                <a class="citylinks__link" href="/${SECTION}/${escAttr(dest.slug)}/"
                  >Wildfire smoke in ${esc(dest.name)}</a
                >
                <span class="citylinks__tag">Upwind</span>
                <p class="citylinks__note">${esc(note)}</p>
              </li>`);
  }

  const nearby = (loc.nearby ?? [])
    .filter((slug) => slug !== loc.slug && !(loc.upwind ?? []).some((u) => u.slug === slug))
    .map((slug) => locationBySlug(slug))
    .filter(Boolean);

  for (const dest of nearby) {
    items.push(`
              <li class="citylinks__item">
                <a class="citylinks__link" href="/${SECTION}/${escAttr(dest.slug)}/"
                  >Wildfire smoke in ${esc(dest.name)}</a
                >
                <span class="citylinks__tag">Nearby</span>
              </li>`);
  }

  const corridor = corridorBySlug(loc.corridor);
  if (corridor) {
    items.push(`
              <li class="citylinks__item">
                <a class="citylinks__link"
                  href="/${SECTION}/${CORRIDOR_SEGMENT}/${escAttr(corridor.slug)}/"
                  >${esc(corridor.name)}</a
                >
                <span class="citylinks__tag">Corridor</span>
                <p class="citylinks__note">${esc(corridor.lede)}</p>
              </li>`);
  }

  items.push(`
              <li class="citylinks__item">
                <a class="citylinks__link" href="/#how-smoke-forecasts-work"
                  >Why smoke is hard to forecast</a
                >
                <span class="citylinks__tag">Explainer</span>
              </li>`);

  if (!items.length) return '';

  return `
        <section class="citylinks">
          <h2>Smoke near ${esc(loc.name)}</h2>
          <p>
            Where ${esc(loc.name)}'s smoke usually shows up first, and the places that share its
            air.
          </p>
          <ul class="citylinks__list">${items.join('')}
          </ul>
        </section>`;
}

// "What looks like smoke in <City> but isn't" — only for the cities that carry
// the field. Six do. It exists because those cities have a native haze that
// visually mimics smoke and sends people here on days when nothing is burning,
// and answering that honestly is worth more than a page view. Do not invent one
// for a city that does not have it.
function notSmokeSection(loc) {
  if (!loc.notSmoke) return '';
  return `
        <section class="explainer explainer--not-smoke">
          <h2>What looks like smoke in ${esc(loc.name)} but isn't</h2>
          <p>${esc(loc.notSmoke)}</p>
        </section>`;
}

// The valley / gateway section: prose covering nearby towns that share this
// city's air but have no search volume of their own. Two cities have one.
// Catching that long tail inside real prose beats minting thin pages for it.
function valleySection(loc) {
  if (!loc.valley) return '';
  return `
        <section class="explainer explainer--valley">
          <h2>${esc(loc.valley.heading)}</h2>
          <p>${esc(loc.valley.body)}</p>
        </section>`;
}

function faqItems(loc) {
  return loc.questions
    .map(
      ({ q, a }) => `
          <details class="faq__item">
            <summary><h3>${esc(q)}</h3></summary>
            <p>${esc(a)}</p>
          </details>`,
    )
    .join('');
}

function faqJsonLd(loc) {
  return jsonForScript(
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: loc.questions.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
    null,
    2,
  );
}

// WebPage + Place, so the page states which point on earth it is about rather
// than leaving Google to infer it from the city name in the title.
function placeJsonLd(loc, url) {
  return jsonForScript(
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: `Wildfire smoke forecast for ${loc.label}`,
      url,
      isPartOf: { '@type': 'WebSite', name: 'SMOKESHOW', url: `${ORIGIN}/` },
      about: {
        '@type': 'Place',
        name: loc.label,
        geo: {
          '@type': 'GeoCoordinates',
          latitude: loc.lat,
          longitude: loc.lon,
        },
      },
    },
    null,
    2,
  );
}

function page(loc) {
  const url = `${ORIGIN}/${SECTION}/${loc.slug}/`;
  const title = `Wildfire Smoke in ${loc.name} — When Will It Clear? | SMOKESHOW`;
  const description = `Live wildfire smoke forecast for ${loc.label}. See the smoke over the city right now, where it came from, and the clear time — when the air is forecast to stay cleaner for six straight hours.`;
  // Place only. The OG endpoint defaults to the wordmark when no rating is
  // passed, which is what we want: a static page must not stamp a verdict into
  // a share card, because it does not know one.
  const ogImage = `${ORIGIN}/api/og?place=${encodeURIComponent(loc.label)}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />

    <!-- Google tag (gtag.js). Charset stays first so it lands well inside the
         first 1024 bytes the HTML spec requires; the tag is otherwise as early
         as it can be. \`async\` keeps it off the critical path — the verdict must
         still paint in under 3 seconds on cellular. -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-XTJYZ1SJCE"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag() {
        dataLayer.push(arguments);
      }
      gtag('js', new Date());

      gtag('config', 'G-XTJYZ1SJCE');
    </script>

    <!-- Ahrefs Web Analytics. Same deal as gtag above: \`async\` so it never
         blocks the verdict paint. -->
    <script
      src="https://analytics.ahrefs.com/analytics.js"
      data-key="xS18hHzOPE0qaqi0SF8mDA"
      async
    ></script>

    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <meta name="theme-color" content="#8ba9c4" />
    <title>${escAttr(title)}</title>
    <meta name="description" content="${escAttr(description)}" />
    <link rel="canonical" href="${escAttr(url)}" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="SMOKESHOW" />
    <meta property="og:title" content="${escAttr(title)}" />
    <meta property="og:description" content="${escAttr(description)}" />
    <meta property="og:url" content="${escAttr(url)}" />
    <meta property="og:image" content="${escAttr(ogImage)}" />
    <meta name="twitter:card" content="summary_large_image" />

    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-title" content="SMOKESHOW" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="manifest" href="/site.webmanifest" />

    <!-- Read by App.jsx before geolocation is requested: this page already
         knows which place it is about, so it must never prompt for location.
         A reader who landed on a ${esc(loc.name)} page asked for ${esc(loc.name)}. -->
    <script>
      window.__SMOKESHOW_PLACE__ = ${jsonForScript({
        lat: loc.lat,
        lon: loc.lon,
        label: loc.label,
        slug: loc.slug,
      })};
    </script>
  </head>
  <body>
    <div id="root"></div>

    <!-- Server-delivered SEO content. Deliberately static HTML (not
         React-rendered) so crawlers see it in the initial payload. -->
    <div class="app app--bottom">
      <header class="map-intro">
        <h1 class="map-intro__title">Wildfire smoke in ${esc(loc.label)}</h1>
        <p class="map-intro__sub">
          Where the smoke over ${esc(loc.name)} was, and where the model sends it next. Scrub back 12
          hours or forward 48. Every hour shown is a model estimate, not a measurement.
        </p>
      </header>

      <div id="map-slot"></div>

      <!-- Section order tracks index.html: map, then the live app CTA React
           portals in here, then the reference sheet. The slot has to exist on
           this template too — without it App.jsx has nowhere to put the CTA
           and a location page simply loses it. -->
      <div id="cta-slot"></div>

      <!-- The city-specific blocks sit after the questions, where the root
           page keeps its explainer. -->
      <div class="seo-sheet">
        <div class="seo-sheet__grab" aria-hidden="true"></div>

        <section class="faq">
          <h2>Smoke in ${esc(loc.name)}? Common questions.</h2>${faqItems(loc)}
        </section>

        <section class="landmarks">
          <h2>What each level looks like from ${esc(loc.name)}</h2>
          <p>
            The scale is anchored to visibility, because that is the one reading you can take
            yourself without trusting a model. Distances are approximate.
          </p>
          <ul class="landmarks__list">${landmarkRows(loc)}
          </ul>
        </section>

        <section class="explainer">
          <h2>Where ${esc(loc.name)}'s smoke comes from</h2>
          <p>${esc(loc.source)}</p>
          <p>${esc(loc.memory)}</p>
        </section>${notSmokeSection(loc)}${valleySection(loc)}${linkBlock(loc)}

        <div class="disclaimer">
          <p>
            ${DISCLAIMER}
          </p>
        </div>
      </div>${footer()}
    </div>

    <script type="application/ld+json">
${faqJsonLd(loc)}
    </script>
    <script type="application/ld+json">
${placeJsonLd(loc, url)}
    </script>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Editorial pages: the hub and the three corridors.
//
// These have no coordinates, and that is the whole reason they get their own
// head/shell rather than reusing page(). A location page stamps
// __SMOKESHOW_PLACE__ and boots App.jsx pre-pointed at a city. A hub page has no
// city, so booting the app on it would fire a geolocation prompt on what is
// really a directory — the reader asked for a list, not for their own air. So
// they load src/editorial.js: the stylesheets and nothing else.
// ---------------------------------------------------------------------------

function editorialHead({ title, description, url }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />

    <!-- Same analytics tags, same reasoning, as index.html and the city pages:
         charset first, both async so neither is ever on a critical path. -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-XTJYZ1SJCE"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag() {
        dataLayer.push(arguments);
      }
      gtag('js', new Date());

      gtag('config', 'G-XTJYZ1SJCE');
    </script>

    <script
      src="https://analytics.ahrefs.com/analytics.js"
      data-key="xS18hHzOPE0qaqi0SF8mDA"
      async
    ></script>

    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <meta name="theme-color" content="#8ba9c4" />
    <title>${escAttr(title)}</title>
    <meta name="description" content="${escAttr(description)}" />
    <link rel="canonical" href="${escAttr(url)}" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="SMOKESHOW" />
    <meta property="og:title" content="${escAttr(title)}" />
    <meta property="og:description" content="${escAttr(description)}" />
    <meta property="og:url" content="${escAttr(url)}" />
    <meta property="og:image" content="${escAttr(`${ORIGIN}/api/og`)}" />
    <meta name="twitter:card" content="summary_large_image" />

    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-title" content="SMOKESHOW" />
    <link rel="manifest" href="/site.webmanifest" />
  </head>
  <body>`;
}

// One row per city, used by both the hub and the corridor pages. The band shown
// is the city's own All-clear distance, because that single number is the fastest
// way to see that these pages are not one page repeated — ten miles of lakefront
// in Chicago against sixty miles of Rainier in Seattle.
function cityRows(slugs) {
  return slugs
    .map((slug) => locationBySlug(slug))
    .filter(Boolean)
    .map(
      (loc) => `
            <li class="citylist__item">
              <a class="citylist__link" href="/${SECTION}/${escAttr(loc.slug)}/"
                >Wildfire smoke in ${esc(loc.label)}</a
              >
              <span class="citylist__band">All clear: ${esc(
                loc.bands?.[0] ?? LEVELS[0].visibility,
              )}</span>
            </li>`,
    )
    .join('');
}

function hubPage() {
  const url = `${ORIGIN}/${SECTION}/`;
  const title = 'Wildfire Smoke Forecasts by City — When Will It Clear? | SMOKESHOW';
  const description =
    'Wildfire smoke forecasts for cities across the US and Canada. What a clear time is, how the visibility scale works, and a live forecast for every city we cover.';

  // Corridor groups, each holding only the cities that were actually built.
  const groups = CORRIDORS.map((c) => {
    const rows = cityRows(c.cities);
    if (!rows) return '';
    return `
        <section class="citylist">
          <h2>
            <a href="/${SECTION}/${CORRIDOR_SEGMENT}/${escAttr(c.slug)}/">${esc(c.name)}</a>
          </h2>
          <p>${esc(c.lede)}</p>
          <ul class="citylist__list">${rows}
          </ul>
        </section>`;
  })
    .filter(Boolean)
    .join('');

  return `${editorialHead({ title, description, url })}
    <div class="app app--bottom">
      <header class="map-intro">
        <h1 class="map-intro__title">Wildfire smoke forecasts by city</h1>
        <p class="map-intro__sub">
          One page per city, each answering the same question: how bad is the air here, and when
          does it clear. Every hour shown on any of them is a model estimate, not a measurement.
        </p>
      </header>

      <div class="seo-sheet">
        <div class="seo-sheet__grab" aria-hidden="true"></div>

        <section class="explainer">
          <h2>What a clear time is</h2>
          <p>
            Every city page leads with one answer: the clear time. It is the first stretch of at
            least six straight hours where the forecast drops below the Smells-like-fire threshold
            and stays there. The six-hour hold is the whole point of the rule. Smoke does not leave
            cleanly — it thins for an hour, comes back, thins again — and a forecast that announced
            the first dip as the all-clear would be wrong within the hour and right about nothing.
            Six hours is long enough that the answer is usable: it is a window you can open a window
            in.
          </p>
          <p>
            If the forecast never holds that long inside the window, the page says so rather than
            inventing a time. That is a real answer too, and it is the one a person planning a week
            actually needs.
          </p>
        </section>

        <section class="explainer">
          <h2>How the visibility scale works</h2>
          <p>
            There are five levels, and they run All clear, In the air, Smells like fire, Tastes like
            fire, Smokeshow. Each one is a concentration threshold, and the names never move: All
            clear means the same air in Fresno as it does in Toronto.
          </p>
          <p>
            What changes city to city is what that air looks like out your window, and that is
            deliberate. The scale is anchored to visibility because visibility is the one reading you
            can take yourself without trusting a model — you do not need an instrument to notice a
            mountain is gone. But ten miles of visibility is an ordinary clear day on the Chicago
            lakefront and an extraordinary one in the San Joaquin Valley, and in Seattle the top of
            the scale is Rainier standing out at roughly sixty miles. So each city page carries its
            own distance bands and its own named sightlines: the peak that flattens first, the
            skyline that merges into one mass, the hill you finally lose. Forcing one set of numbers
            on every city would throw away the strongest local signal there is.
          </p>
          <p>
            Read the ladder on your city's page from the outside in. The furthest thing you can still
            resolve tells you which level you are in, and it tells you before any app does.
          </p>
        </section>${groups}

        <div class="disclaimer">
          <p>
            ${DISCLAIMER}
          </p>
        </div>
      </div>${footer()}
    </div>
    <script type="module" src="/src/editorial.js"></script>
  </body>
</html>
`;
}

function corridorPage(corridor) {
  const url = `${ORIGIN}/${SECTION}/${CORRIDOR_SEGMENT}/${corridor.slug}/`;
  const title = `${corridor.name} — Live Forecasts | SMOKESHOW`;
  const rows = cityRows(corridor.cities);

  const body = corridor.body.map((p) => `
          <p>${esc(p)}</p>`).join('');

  return `${editorialHead({ title, description: corridor.description, url })}
    <div class="app app--bottom">
      <header class="map-intro">
        <h1 class="map-intro__title">${esc(corridor.name)}</h1>
        <p class="map-intro__sub">${esc(corridor.lede)}</p>
      </header>

      <div class="seo-sheet">
        <div class="seo-sheet__grab" aria-hidden="true"></div>

        <section class="explainer">
          <h2>How this corridor works</h2>${body}
        </section>
${
  rows
    ? `        <section class="citylist">
          <h2>Cities on this corridor</h2>
          <p>
            Listed in the order the smoke reaches them, not alphabetically. Each page carries its own
            visibility bands and its own named sightlines.
          </p>
          <ul class="citylist__list">${rows}
          </ul>
        </section>
`
    : ''
}
        <section class="citylinks">
          <h2>Elsewhere</h2>
          <ul class="citylinks__list">
            <li class="citylinks__item">
              <a class="citylinks__link" href="/${SECTION}/">Every city we cover</a>
              <span class="citylinks__tag">Hub</span>
            </li>
            <li class="citylinks__item">
              <a class="citylinks__link" href="/#how-smoke-forecasts-work"
                >Why smoke is hard to forecast</a
              >
              <span class="citylinks__tag">Explainer</span>
            </li>
          </ul>
        </section>

        <div class="disclaimer">
          <p>
            ${DISCLAIMER}
          </p>
        </div>
      </div>${footer()}
    </div>
    <script type="module" src="/src/editorial.js"></script>
  </body>
</html>
`;
}

function sitemap(locations) {
  const urls = [
    `${ORIGIN}/`,
    `${ORIGIN}/${SECTION}/`,
    ...CORRIDORS.map((c) => `${ORIGIN}/${SECTION}/${CORRIDOR_SEGMENT}/${c.slug}/`),
    ...locations.map((l) => `${ORIGIN}/${SECTION}/${l.slug}/`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`;
}

export async function generate() {
  // Wipe first so a renamed or deleted slug cannot leave an orphan page behind
  // that Vite would happily keep building and Google would happily keep serving.
  await rm(join(ROOT, SECTION), { recursive: true, force: true });

  const written = [];
  const emit = async (dir, html) => {
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'index.html');
    await writeFile(file, html, 'utf8');
    written.push(file);
  };

  for (const loc of LOCATIONS) {
    await emit(join(ROOT, SECTION, loc.slug), page(loc));
  }

  // The hub sits at the section root, so it has to be written after the city
  // directories exist under it — same tree, one level up.
  await emit(join(ROOT, SECTION), hubPage());

  for (const corridor of CORRIDORS) {
    await emit(join(ROOT, SECTION, CORRIDOR_SEGMENT, corridor.slug), corridorPage(corridor));
  }

  await mkdir(join(ROOT, 'public'), { recursive: true });
  await writeFile(join(ROOT, 'public', 'sitemap.xml'), sitemap(LOCATIONS), 'utf8');

  return written;
}

// Exported for the tests; they assert on the markup without touching disk.
export const _internal = {
  page,
  hubPage,
  corridorPage,
  sitemap,
  esc,
  escAttr,
  SECTION,
  CORRIDOR_SEGMENT,
  ORIGIN,
  FOOTER_LINKS,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const written = await generate();
  console.log(
    `pages: ${written.length} written (${LOCATIONS.length} cities, 1 hub, ${CORRIDORS.length} corridors), sitemap.xml updated`,
  );
}
