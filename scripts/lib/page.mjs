// Shared page primitives for the static generators. Extracted so the two
// generators — gen-location-pages.mjs (the 30 city/corridor/about pages) and
// gen-articles.mjs (the /guides/ articles) — cannot drift on the things that
// have to be identical across every page the site serves: the escaping, the
// analytics tags, the disclaimer, the footer, and the breadcrumb shape.
//
// Before this file, the footer and analytics lived in gen-location-pages and
// were hand-mirrored into index.html with a "keep in sync" comment. A second
// generator would have been a third copy. These are the pieces that MUST match,
// so they get one home.

import { sourcesByRole } from '../../src/data/sources.js';

export const ORIGIN = 'https://smokeshow.earth';
export const STUDIO_ORIGIN = 'https://watchcapstudio.com';

// Text -> HTML text node. Attributes get the same treatment plus quotes.
export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
export function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}

// JSON destined for a <script> body. JSON.stringify does not escape '<', so a
// value containing "</script>" would close the block and everything after it
// would parse as markup. The HTML parser does not decode entities inside script
// elements either, which rules out esc() here — the fix has to be a JSON-level
// escape that survives JSON.parse unchanged.
// `indent` is passed through to JSON.stringify. The generators call this with no
// indent (minified), which is what every JSON-LD block on the site has always
// shipped; the argument stays so a caller can pretty-print if it ever wants.
export function jsonForScript(value, indent) {
  return JSON.stringify(value, null, indent)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

// The disclaimer, reproduced verbatim from the brief. index.html carries the
// same words. It is not paraphrased per page and must not be.
export const DISCLAIMER = `<strong>Smokeshow is for informational and educational purposes only.</strong> It is
            not health, medical, or safety advice. Forecasts are model estimates and can be wrong,
            sometimes by a lot. Descriptions of what you might smell, see, or feel are
            generalizations, not predictions about your body. For decisions about your health,
            outdoor activity, or air quality safety, rely on official sources like AirNow.gov, the
            National Weather Service, and your local health authorities, and talk to a medical
            professional about your own situation.`;

// The analytics tags, byte-for-byte the same on every page: charset is expected
// to precede this, both scripts async so neither is ever on a critical path.
export const ANALYTICS_HEAD = `
    <!-- Same analytics tags, same reasoning, on every page the site serves. -->
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
    ></script>`;

// The icon / manifest / web-app furniture, identical everywhere.
export const APP_ICON_HEAD = `
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-title" content="SMOKESHOW" />
    <link rel="manifest" href="/site.webmanifest" />`;

// The shared footer. Five sitewide links, deliberately NOT the 25 city links:
// a footer that lists every city on every page dilutes the one signal these
// pages have. Privacy and Terms point OFF-SITE to watchcapstudio.com on purpose
// — those documents cover every product the studio ships, and a second copy on
// this domain would drift from the canonical one.
//
// Hand-mirrored in index.html, same as the FAQ already is. Keep them in sync.
export const FOOTER_LINKS = [
  { href: '/smoke-forecast/', text: 'All cities' },
  { href: '/guides/how-smoke-forecasts-work/', text: 'How smoke forecasts work' },
  {
    href: '/smoke-forecast/corridor/canadian-smoke-great-lakes-northeast/',
    text: 'Canadian smoke explained',
  },
  { href: '/about/', text: 'About' },
  { href: `${STUDIO_ORIGIN}/privacy`, text: 'Privacy' },
  { href: `${STUDIO_ORIGIN}/terms`, text: 'Terms' },
];

export function footer() {
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

// Source names as links, comma-joined, read from src/data/sources.js so no two
// pages can credit different URLs for the same role.
export function sourceLinks(role) {
  return sourcesByRole(role)
    .map((s) => `<a href="${escAttr(s.href)}">${esc(s.name)}</a>`)
    .join(', ');
}

// BreadcrumbList. Takes [label, path] pairs, root first, and omits the item URL
// on the last entry per schema.org's guidance that the current page needs no
// link. The structured data is the only place the URL hierarchy is written down.
export function breadcrumbJsonLd(trail) {
  return jsonForScript({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, path], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      ...(i === trail.length - 1 ? {} : { item: `${ORIGIN}${path}` }),
    })),
  });
}
