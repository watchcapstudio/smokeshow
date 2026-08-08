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
import { LOCATIONS } from '../src/data/locations.js';
import { LEVELS } from '../src/lib/rating.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECTION = 'smoke-forecast'; // URL segment: /smoke-forecast/<slug>/
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

function landmarkRows(loc) {
  return loc.landmarks
    .map((line, i) => {
      const level = LEVELS[i];
      if (!level) return '';
      return `
            <li class="landmarks__item">
              <span class="landmarks__level">${esc(level.name)}</span>
              <span class="landmarks__vis">${esc(level.visibility)}</span>
              <p class="landmarks__sight">${esc(line)}</p>
            </li>`;
    })
    .join('');
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

      <!-- Section order tracks index.html since #25: the app CTA opens the
           reference sheet, the questions follow. The city-specific blocks sit
           after them, where the root page keeps its explainer. -->
      <div class="seo-sheet">
        <div class="seo-sheet__grab" aria-hidden="true"></div>

        <section class="app-cta">
          <h2>SMOKESHOW is also an app.</h2>
          <p>
            The same forecast, glanceable from a Home Screen or lock-screen widget — no need to open
            anything to check. Plus threshold alerts when smoke arrives, peaks, or clears.
            <strong>Coming soon to iOS, macOS, and Android.</strong> 14-day trial, then
            $2.99/month.
          </p>
        </section>

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
        </section>

        <div class="disclaimer">
          <p>
            ${DISCLAIMER}
          </p>
        </div>
      </div>
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

function sitemap(locations) {
  const urls = [`${ORIGIN}/`, ...locations.map((l) => `${ORIGIN}/${SECTION}/${l.slug}/`)];
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
  for (const loc of LOCATIONS) {
    const dir = join(ROOT, SECTION, loc.slug);
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'index.html');
    await writeFile(file, page(loc), 'utf8');
    written.push(file);
  }

  await mkdir(join(ROOT, 'public'), { recursive: true });
  await writeFile(join(ROOT, 'public', 'sitemap.xml'), sitemap(LOCATIONS), 'utf8');

  return written;
}

// Exported for the tests; they assert on the markup without touching disk.
export const _internal = { page, sitemap, esc, escAttr, SECTION, ORIGIN };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const written = await generate();
  console.log(`location pages: ${written.length} written, sitemap.xml updated`);
}
