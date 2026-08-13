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
import {
  ORIGIN,
  STUDIO_ORIGIN,
  esc,
  escAttr,
  jsonForScript,
  DISCLAIMER,
  footer,
  FOOTER_LINKS,
  sourceLinks,
  breadcrumbJsonLd,
} from './lib/page.mjs';
import { generateArticles, articleRoutes } from './gen-articles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECTION = 'smoke-forecast'; // URL segment: /smoke-forecast/<slug>/
const CORRIDOR_SEGMENT = 'corridor'; // /smoke-forecast/corridor/<slug>/

// The shared footer, its link list, esc/escAttr, jsonForScript, the disclaimer,
// sourceLinks and breadcrumbJsonLd now live in scripts/lib/page.mjs — the pieces
// that have to be byte-identical across every page the site serves, including
// the /guides/ articles, which is why they moved to one home. FOOTER_LINKS' "How
// smoke forecasts work" link points at /guides/how-smoke-forecasts-work/ there.

// Said in the same words on every directory page, so a reader landing on any of
// them gets the same promise, and one test can check one string.
//
// This replaced "This is a directory and reports conditions nowhere", which was
// true when the rows were bare links and became false the moment they carried a
// live level. The sentence has to describe what the page does, and the honest
// description of a dated reading is that it is dated: read at load, stamped, and
// not the whole forecast.
const LIVE_NOTE =
  'Each level here is read when this page loads and carries the time it was read. Open a city for its clear time and the rest of the forecast.';

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
  // Dedup precedence: a city named twice appears once, under the FIRST tag it
  // earns. Spokane is both upwind of Missoula and nearby it, and "Upwind" is the
  // row worth keeping, because it is the one carrying a reason.
  const seen = new Set([loc.slug]);

  const flowRow = (entries, tag) => {
    for (const { slug, note } of entries ?? []) {
      const dest = locationBySlug(slug);
      if (!dest || seen.has(slug)) continue;
      seen.add(slug);
      items.push(`
              <li class="citylinks__item">
                <a class="citylinks__link" href="/${SECTION}/${escAttr(dest.slug)}/"
                  >Wildfire smoke in ${esc(dest.name)}</a
                >
                <span class="citylinks__tag">${esc(tag)}</span>
                <p class="citylinks__note">${esc(note)}</p>
              </li>`);
    }
  };

  flowRow(loc.upwind, 'Upwind');
  // Downwind only exists on the source-end cities, which have no upwind at all.
  // For a reader there the question is inverted — not "what is coming" but "who
  // gets this next" — and their own provenance already answers it.
  flowRow(loc.downwind, 'Downwind');

  for (const slug of loc.nearby ?? []) {
    const dest = locationBySlug(slug);
    if (!dest || seen.has(slug)) continue;
    seen.add(slug);
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

  // The hub closes the block because it is the answer to the question this
  // section provokes and cannot itself satisfy: "my city isn't listed." The
  // footer carries it too, but a reader who has just read five city names is at
  // the exact point of wanting the full list, and making them hunt the footer
  // for it is worse than one more row.
  items.push(`
              <li class="citylinks__item">
                <a class="citylinks__link" href="/${SECTION}/">Every city we cover</a>
                <span class="citylinks__tag">All cities</span>
              </li>`);

  items.push(`
              <li class="citylinks__item">
                <a class="citylinks__link" href="/guides/how-smoke-forecasts-work/"
                  >Why smoke is hard to forecast</a
                >
                <span class="citylinks__tag">Explainer</span>
              </li>`);

  if (!items.length) return '';

  // The lead has to match the direction of the rows under it. On an upwind city
  // these links are places the smoke appears BEFORE it gets here; on a
  // source-end city they are places it appears AFTER. One sentence describing
  // both is wrong on one of them, and it was wrong on Winnipeg, Toronto and
  // Fresno — the three pages where the block is the most interesting thing on
  // the page and least deserved a backwards caption.
  const lead = (loc.upwind ?? []).length
    ? `Where ${esc(loc.name)}'s smoke usually shows up first, and the places that share its air.`
    : `Where ${esc(loc.name)}'s smoke goes after it leaves, and the places that share its air.`;

  return `
        <section class="citylinks">
          <h2>Smoke near ${esc(loc.name)}</h2>
          <p>${lead}</p>
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

// CollectionPage for the hub and the corridors, AboutPage for /about/. The
// editorial pages shipped with no structured data at all while every city page
// carried two blocks, which left the four pages that explain the system as the
// only ones a crawler had to infer from prose.
//
// `hasPart` on a collection names the city pages it holds. That is the same claim
// the visible list makes, which is the point: the machine-readable version should
// not be able to disagree with the page.
function collectionJsonLd({ type, name, description, url, parts = [] }) {
  return jsonForScript(
    {
      '@context': 'https://schema.org',
      '@type': type,
      name,
      description,
      url,
      isPartOf: { '@type': 'WebSite', name: 'SMOKESHOW', url: `${ORIGIN}/` },
      ...(parts.length
        ? {
            hasPart: parts.map((loc) => ({
              '@type': 'WebPage',
              name: `Wildfire smoke forecast for ${loc.label}`,
              url: `${ORIGIN}/${SECTION}/${loc.slug}/`,
            })),
          }
        : {}),
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
  const title = `Wildfire Smoke in ${loc.name}: When Will It Clear? | SMOKESHOW`;
  const description = `Live wildfire smoke forecast for ${loc.label}. See the smoke over the city right now, where it came from, and the clear time, meaning when the air is forecast to stay cleaner for six straight hours.`;
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
         as it can be. \`async\` keeps it off the critical path, because the verdict must
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

      <!-- The live map now rides in the top canvas (Sky/Map toggle), so there
           is no separate map section here. The heading above is SEO copy for
           the flip map. The live app CTA still React-portals into this slot;
           it has to exist on this template too, or a location page loses it. -->
      <div id="cta-slot"></div>

      <!-- Section order, and the reasoning, because it moved once already:
           landmarks -> provenance -> (what isn't smoke) -> (valley) -> FAQ ->
           links -> disclaimer.

           Landmarks lead because they are the only section that lets a reader
           check the verdict above with their own eyes, which is the whole
           premise of a visibility-anchored scale. It reads as the payoff of the
           canvas at the top of the page, which is where the live map now sits
           behind the Sky/Map toggle. Provenance answers the question that
           lands next ("why is it here"), and the two optional sections are both
           refinements of that same "where from" pair, so they follow it: what
           isn't smoke first, since it can invalidate the reader's premise
           entirely, then the valley/gateway widening.

           The FAQ is last of the content. It used to be first, which put the
           most generic block on the page ahead of the two that are specific to
           this city.

           Links are navigation rather than content, so they come after the
           reading and before the fine print. The disclaimer is always last. -->
      <div class="seo-sheet">
        <div class="seo-sheet__grab" aria-hidden="true"></div>

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
        </section>${notSmokeSection(loc)}${valleySection(loc)}

        <section class="faq">
          <h2>Smoke in ${esc(loc.name)}? Common questions.</h2>${faqItems(loc)}
        </section>${linkBlock(loc)}

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
    <script type="application/ld+json">
${breadcrumbJsonLd([
  ['SMOKESHOW', '/'],
  ['Smoke forecasts by city', `/${SECTION}/`],
  [loc.label, `/${SECTION}/${loc.slug}/`],
])}
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

// One row per city: the link, and an EMPTY slot the browser fills with a live
// level (src/lib/cityLevels.js).
//
// This column has now been wrong twice, in the same position, for the same
// reason. First it read "All clear: 50+ miles", which put a LEVEL NAME beside 25
// city names and rendered as a status board claiming every city was clear.
// Relabelling it "clean day: 50+ miles" fixed the wording and not the problem:
// six cities were reading "In the air" on their own pages while the directory
// showed a number, and a reader compares those two and concludes the directory is
// stale or lying.
//
// The lesson is about the POSITION, not the words. A right-aligned value beside a
// place name on a page about air quality is a status slot, and readers scan it as
// one no matter what the prose above says. No third phrasing was going to hold.
// The per-city calibration those numbers carried is worth saying, so it is said in
// prose in the scale explainer, where it reads as an explanation instead of a
// reading.
//
// The slot now has something real in it, and note what did NOT change: the static
// HTML still ships it empty, so a crawler, a JS-off reader, and a stale CDN copy
// all see a plain link list that claims nothing. The level arrives at load, from
// the same levelForPM25 the city page calls, stamped with the time it was read.
// That is the difference between this and the two attempts above: not a constant,
// not baked by a build, and dated so a reader can judge it.
function cityRows(slugs) {
  return slugs
    .map((slug) => locationBySlug(slug))
    .filter(Boolean)
    .map(
      (loc) => `
            <li class="citylist__item">
              <a class="citylist__link" href="/${SECTION}/${escAttr(loc.slug)}/"
                >Wildfire smoke in ${esc(loc.label)}</a
              ><span class="citylist__band" data-city-level="${escAttr(loc.slug)}"></span>
            </li>`,
    )
    .join('');
}

function hubPage() {
  const url = `${ORIGIN}/${SECTION}/`;
  const title = 'Wildfire Smoke Forecasts by City: When Will It Clear? | SMOKESHOW';
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
          does it clear. ${LIVE_NOTE} Every hour shown on any of these pages is a model estimate,
          not a measurement.
        </p>
      </header>

      <div class="seo-sheet">
        <div class="seo-sheet__grab" aria-hidden="true"></div>

        <section class="explainer">
          <h2>What a clear time is</h2>
          <p>
            Every city page leads with one answer: the clear time. It is the first stretch of at
            least six straight hours where the forecast drops below the Hazy threshold
            and stays there. The six-hour hold is the whole point of the rule. Smoke does not leave
            cleanly. It thins for an hour, comes back, thins again, and a forecast that announced
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
          <h2 id="visibility-scale">How the visibility scale works</h2>
          <p>
            There are five levels, and they run All clear, In the air, Hazy, Heavy haze, Smokeshow.
            Each one is a concentration threshold, and the names never move: All clear means the
            same air in Fresno as it does in Toronto.
          </p>
          <p>
            Every one of those names describes what the sky is doing rather than what you will
            smell, and that is deliberate. Fine particles scatter light long before anyone catches a
            campfire note, and smoke that has travelled for a day or more arrives with most of what
            you could have smelled already stripped out of it and the particles still there. Plenty
            of people have stepped outside into a genuinely smoky afternoon and smelled nothing at
            all. What they could do was see less far, which is why that is what these names track.
          </p>
          <p>
            What changes city to city is what that air looks like out your window, and that is
            deliberate. The scale is anchored to visibility because visibility is the one reading you
            can take yourself without trusting a model, and you do not need an instrument to notice a
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
          <p>
            The size of that difference is worth stating plainly. A clean day in Seattle shows you
            Rainier at about sixty miles; a clean day in Detroit reaches Windsor across the river.
            Both are All clear. That is why each city page carries its own distances, and why this
            directory carries none: a number next to a city name gets read as today's reading, and
            the honest place for today's reading is the city's own page.
          </p>
        </section>${groups}

        <div class="disclaimer">
          <p>
            ${DISCLAIMER}
          </p>
        </div>
      </div>${footer()}
    </div>
    <script type="application/ld+json">
${collectionJsonLd({
  type: 'CollectionPage',
  name: 'Wildfire smoke forecasts by city',
  description,
  url,
  parts: LOCATIONS,
})}
    </script>
    <script type="application/ld+json">
${breadcrumbJsonLd([
  ['SMOKESHOW', '/'],
  ['Smoke forecasts by city', `/${SECTION}/`],
])}
    </script>
    <script type="module" src="/src/editorial.js"></script>
  </body>
</html>
`;
}

// /about/ — the only page on the site that is allowed to be about us, and it
// earns that by answering the two questions a reader has no other way to check:
// why this exists, and what it refuses to do.
//
// Sits at the root rather than under /smoke-forecast/, because it is not a
// forecast. The studio's own identity, the Privacy page and the Terms all live
// on watchcapstudio.com and are linked rather than retold here — this page is
// about the product.
function aboutPage() {
  const url = `${ORIGIN}/about/`;
  const title = 'About Smokeshow: Why We Made It | SMOKESHOW';
  const description =
    'Why we built a wildfire smoke forecast that answers one question, where its data comes from, and what it will not do.';

  return `${editorialHead({ title, description, url })}
    <div class="app app--bottom">
      <header class="map-intro">
        <h1 class="map-intro__title">Why we made Smokeshow</h1>
        <p class="map-intro__sub">
          One page, one question. How bad is the air here, and when does it clear.
        </p>
      </header>

      <div class="seo-sheet">
        <div class="seo-sheet__grab" aria-hidden="true"></div>

        <section class="explainer">
          <h2>We wanted to go outside</h2>
          <p>
            That is most of it. The data for whether that is a good idea already exists, in public:
            a federal smoke model, a European one, federal fire reporting, satellite heat
            detections. It is just scattered across separate agencies, in formats built for people
            who do this for a living. Getting a straight answer meant digging, every time, and by
            the time you had it the afternoon was gone.
          </p>
          <p>
            So we stopped digging and built the thing we wanted. One page, one question.
          </p>
          <p>
            We like being outside. The activity, the weather, the feeling of being in it. Smoke
            turns that inside out. The air you went out for becomes the reason to stay in, and it
            takes the run, the game, the trip, the weekend with it. You end up resenting a sky. What
            you want in that moment is not a dashboard. It is an answer you can plan around.
          </p>
          <p>
            Which is why this site leads with a clear time rather than a reading. It is the first
            stretch of at least six straight hours the forecast holds cleaner, and the six-hour rule
            is there because smoke does not leave cleanly. It thins, comes back, thins again. An
            answer you can make a plan on has to be longer than the next dip.
          </p>
        </section>

        <section class="explainer">
          <h2>The name</h2>
          <p>
            A watch cap is the wool cap North Atlantic fishermen wore for centuries before it became
            standard issue at sea. Hand made, simple, still worn by the most elite operators and
            sometimes by baristas in Brooklyn. It is for noticing. That is the idea. Notice.
          </p>
          <p>
            Which is what this site asks of you. Every level on the scale is anchored to how far you
            can see, and every city page names the hill, the tower or the peak that goes at each
            step, because visibility is the one reading you can take yourself without trusting us.
            Look out the window. That is the instrument.
          </p>
        </section>

        <section class="explainer">
          <h2>What we will not do</h2>
          <p>
            Dress up a guess. Everything here is a model estimate, including the hours before now.
            Those are the model's account of the past, not measurements. Where the models disagree,
            the page says so instead of showing you the prettier one.
          </p>
          <p>
            There is no account, no email capture, nothing sold, and no advertising against your
            weather. The site is free to use, and nothing here starts costing money without us
            telling you the price first.
          </p>
          <p>
            And Smokeshow is information, not advice. It cannot tell you whether the air is safe for
            you to breathe, and it does not try. For that, use AirNow.gov, the National Weather
            Service, your local health authorities, and a professional who knows your situation.
          </p>
        </section>

        <section class="explainer">
          <h2>Where the numbers come from</h2>
          <p>
            Forecast: ${sourceLinks('forecast')}. Fires: ${sourceLinks('fires')}. Thermal hotspots:
            ${sourceLinks('hotspots')}. The hotspots are heat detections rather than confirmed
            fires, and the fire cards carry the date each fact was reported, because a fire report
            is not a forecast and does not move with the timeline.
          </p>
          <p class="colophon">Generated using Copernicus Atmosphere Monitoring Service information.</p>
          <p>
            Smokeshow is made by
            <a href="${escAttr(STUDIO_ORIGIN)}">WatchCap Studio</a>. A studio because we like to
            make. Live with attention. Make with attention. Enjoy it.
          </p>
        </section>

        <div class="disclaimer">
          <p>
            ${DISCLAIMER}
          </p>
        </div>
      </div>${footer()}
    </div>
    <script type="application/ld+json">
${collectionJsonLd({ type: 'AboutPage', name: 'Why we made Smokeshow', description, url })}
    </script>
    <script type="application/ld+json">
${breadcrumbJsonLd([
  ['SMOKESHOW', '/'],
  ['About', '/about/'],
])}
    </script>
    <script type="module" src="/src/editorial.js"></script>
  </body>
</html>
`;
}

// The explainer moved out of this file. It shipped for months as an anchor in
// index.html, then briefly as /how-smoke-forecasts-work/ generated here; it now
// lives as the first post in the /guides/ article system
// (content/articles/how-smoke-forecasts-work.md, rendered by gen-articles.mjs)
// at /guides/how-smoke-forecasts-work/, inside the topic cluster with the rest
// of the evergreen content. A 301 in vercel.json redirects the old URL, and the
// internal links above and in the footer point at the new one.

// 404. Vercel serves dist/404.html for any path that matches nothing, so this is
// the page a reader lands on after a typo or a guessed slug — and guessed slugs
// are a real case here: "air quality kalispell" outranks Whitefish on volume and
// Kalispell has no page of its own, so /smoke-forecast/kalispell-mt/ is a URL
// people will type. Vercel's default 404 is a dead end; this one hands them the
// directory.
function notFoundPage() {
  const title = 'Page not found | SMOKESHOW';
  return `${editorialHead({
    title,
    description: 'That page does not exist. Every city we cover is listed here.',
    url: `${ORIGIN}/404`,
  })}
    <div class="app app--bottom">
      <header class="map-intro">
        <h1 class="map-intro__title">That page does not exist</h1>
        <p class="map-intro__sub">
          Probably a city we do not cover yet, or a typo in the address. Both are fixable from here.
        </p>
      </header>

      <div class="seo-sheet">
        <div class="seo-sheet__grab" aria-hidden="true"></div>

        <section class="explainer">
          <h2>Where to go instead</h2>
          <p>
            The forecast for wherever you are is on the front page, and it needs no address: allow
            location access, or search for a city. Every city with a page of its own is listed in the
            directory, grouped by the corridor its smoke travels down.
          </p>
          <p>
            If you were looking for a city that is not there, it does not have a page yet. The front
            page still forecasts it: the city pages exist to describe what each level looks like from
            a particular set of windows, and that has to be written by hand for each one.
          </p>
        </section>

        <section class="citylinks">
          <h2>Try one of these</h2>
          <ul class="citylinks__list">
            <li class="citylinks__item">
              <a class="citylinks__link" href="/">Smoke where you are</a>
              <span class="citylinks__tag">Forecast</span>
            </li>
            <li class="citylinks__item">
              <a class="citylinks__link" href="/${SECTION}/">Every city we cover</a>
              <span class="citylinks__tag">All cities</span>
            </li>
            <li class="citylinks__item">
              <a class="citylinks__link" href="/guides/how-smoke-forecasts-work/"
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

function corridorPage(corridor) {
  const url = `${ORIGIN}/${SECTION}/${CORRIDOR_SEGMENT}/${corridor.slug}/`;
  // No separator before SMOKESHOW beyond the pipe: every corridor name already
  // contains a colon ("Canadian smoke: Great Lakes and Northeast"), so the
  // "<name>: Live Forecasts" shape this replaced produced a double colon.
  const title = `${corridor.name} | Live Forecasts | SMOKESHOW`;
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
            Listed in the order the smoke reaches them, not alphabetically. ${LIVE_NOTE} Each page
            also carries that city's own distances and its own named sightlines, so you can check a
            level against what you can actually see from there.
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
              <a class="citylinks__link" href="/guides/how-smoke-forecasts-work/"
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
    <script type="application/ld+json">
${collectionJsonLd({
  type: 'CollectionPage',
  name: corridor.name,
  description: corridor.description,
  url,
  parts: corridor.cities.map((s) => locationBySlug(s)).filter(Boolean),
})}
    </script>
${'    '}<script type="application/ld+json">
${breadcrumbJsonLd([
  ['SMOKESHOW', '/'],
  ['Smoke forecasts by city', `/${SECTION}/`],
  [corridor.name, `/${SECTION}/${CORRIDOR_SEGMENT}/${corridor.slug}/`],
])}
    </script>
    <script type="module" src="/src/editorial.js"></script>
  </body>
</html>
`;
}

// `guides` is the list of /guides/ URLs (the hub plus each article), passed in
// from generate() so the two generators keep one sitemap between them. The old
// /how-smoke-forecasts-work/ URL is gone: it 301s to its /guides/ home, and a
// redirected URL does not belong in the sitemap.
function sitemap(locations, guides = []) {
  const urls = [
    `${ORIGIN}/`,
    `${ORIGIN}/about/`,
    `${ORIGIN}/${SECTION}/`,
    ...CORRIDORS.map((c) => `${ORIGIN}/${SECTION}/${CORRIDOR_SEGMENT}/${c.slug}/`),
    ...locations.map((l) => `${ORIGIN}/${SECTION}/${l.slug}/`),
    ...guides,
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

  // /about/ sits outside SECTION, so the wipe at the top of this function does
  // not reach it. Overwriting is enough: it is one file at a fixed path, with no
  // slug that can be renamed and leave an orphan behind.
  await emit(join(ROOT, 'about'), aboutPage());

  // The /guides/ articles are a separate generator with its own content source
  // and its own wipe. Run here so one `npm run pages` builds everything and the
  // sitemap below can name the article routes.
  const articleFiles = await generateArticles();
  written.push(...articleFiles);

  // 404.html sits at the output root rather than in a directory: that exact path
  // is what Vercel serves for an unmatched route. It is deliberately absent from
  // the sitemap.
  await mkdir(ROOT, { recursive: true });
  await writeFile(join(ROOT, '404.html'), notFoundPage(), 'utf8');
  written.push(join(ROOT, '404.html'));

  await mkdir(join(ROOT, 'public'), { recursive: true });
  await writeFile(join(ROOT, 'public', 'sitemap.xml'), sitemap(LOCATIONS, await articleRoutes()), 'utf8');

  return written;
}

// Exported for the tests; they assert on the markup without touching disk.
export const _internal = {
  page,
  hubPage,
  corridorPage,
  aboutPage,
  notFoundPage,
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
    `pages: ${written.length} written (${LOCATIONS.length} cities, 1 hub, ${CORRIDORS.length} corridors, 1 about, /guides/, 1 404), sitemap.xml updated`,
  );
}
