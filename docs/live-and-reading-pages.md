# Live pages and Reading pages

The site's two templates, named. This is the canonical description of the page
system after the consolidation (PR #70, Aug 2026), and the doc to point a
session at when working on any page the site serves. The audit that led here,
with the full inventory and the reasoning, is `docs/page-templates-audit.md`.

## The two templates

**Live pages** have coordinates and boot the app. The sky is the instrument:
it paints the real hour for the real place, light blue at noon, near-black at
night, and it is supposed to change. These are the homepage and the 25 city
pages.

**Reading pages** have no coordinates and boot no React. They sit on the
static masthead: the resting clear-midday gradient, the soft sun, the
feathered ridge. These are the directory hub, the three corridor pages,
/about/, the 404, the /guides/ hub and every guide article.

What makes them one site rather than two: every page ends in the same
reading surface. The cream sheet (fixed ink, never flips with the air), the
hills on the horizon behind it, the same FAQ treatment, the same centered
mono footer, the same header type scale with a mono eyebrow above the h1.
On a Reading page the hills belong to the masthead; on a Live page they are
`sheetRidge()`, the same geometry fixed to the viewport bottom, hidden under
the stage until the reader scrolls into the reference material. The ridge
fills ride `--ink`, so night air lightens the hills instead of swallowing
them.

## Who owns what

One rule: anything that must be identical on every page lives in ONE file.

| Piece | One home |
| --- | --- |
| Document head (analytics, og, icons, web-app metas) | `pageHead()` in `scripts/lib/page.mjs` |
| Footer markup + links | `footer()` / `FOOTER_LINKS` in `scripts/lib/page.mjs` |
| Disclaimer | `DISCLAIMER` in `scripts/lib/page.mjs` (verbatim from the brief, never paraphrase) |
| Masthead sky + ridge geometry | `mastheadSky()` / `sheetRidge()` / `RIDGE_PATHS` in `scripts/lib/page.mjs` |
| Breadcrumb / escaping / JSON-for-script | `scripts/lib/page.mjs` |
| FAQ styles, footer styles, ridge fills | `src/styles/shell.css` |
| Header type scale | `.map-intro` in `shell.css`, `.guide__header` in `article.css` — same measured ramps, keep them matching |
| Cream sheet surface | `.seo-sheet` in `seo.css`, `.guide__sheet` in `article.css` — same tokens, same radius/shadow |
| Live-page-only furniture (landmarks, citylinks, citylist, sheet-ridge placement) | `src/styles/seo.css` |
| Reading-page-only furniture (prose, short-answer, related, guide index) | `src/styles/article.css` |

Generators: `scripts/gen-location-pages.mjs` writes the homepage
(`homePage()`), the 25 city pages, the hub, the corridors, /about/ and the
404; `scripts/gen-articles.mjs` writes /guides/ from `content/articles/*.md`.
`npm run pages` runs both; `npm run build` runs pages first.

**The homepage is generated now.** `index.html` stays committed because Vite
dev serves it directly, but `npm run pages` rewrites it and the build always
regenerates it, so never edit `index.html` by hand — edit `homePage()` (or
`HOME_QUESTIONS` for its FAQ) in `gen-location-pages.mjs`.

## What landed in the consolidation

1. City pages (and the homepage) carry `sheetRidge()` behind the reading half.
2. One footer ruleset (guides' centered mono), one FAQ ruleset, in `shell.css`.
3. One header scale; every page has an eyebrow ("Smoke forecast", "Directory",
   "Corridor", "About", "Not found", "Field guide"/"Guides").
4. One `pageHead()`; the homepage's og tags exist because of it.
5. The homepage folded into the generator; both hand-mirrors (FAQ JSON-LD,
   footer) deleted.
6. Strays deleted: `/asdfasdf/` (the front-end review candidate — its proposal
   shipped as the Sky/Map stage), `src/proto/`, `public/ifhghs/demo/`,
   `scripts/build-review-artifact.mjs`, and the `#map-slot` CSS that served
   them.

## Open threads for a next session

- **`.map-intro` vs `.guide__header` and `.seo-sheet` vs `.guide__sheet` are
  matched pairs, not one class.** They are kept identical by hand today.
  Collapsing each pair onto one class (probably the guide's name) would make
  the match structural; it touches tests that assert `map-intro__title`
  markup, so it was left out of the consolidation PR.
- **`editorial.js` and `article.js` could be one entry.** They differ only in
  which page-specific stylesheet they pull. One entry importing both
  stylesheets costs a few KB of CSS on each page and deletes a file.
- **Mobile polish pass.** The system is responsive, but nobody has walked all
  38 pages at phone width on purpose. Worth a deliberate pass now that they
  share one design: header padding at small sizes, FAQ tap targets, the ridge
  height on short viewports.
- **The five-state illustration crossfade** (CLAUDE.md, assets section) is
  still the preferred implementation for the rating art and is untouched by
  any of this.

## The rules that still bind every page

From CLAUDE.md, restated because every new surface must obey them: no AQI or
concentration numbers in copy, level NAMES only. The static payload never
asserts a current condition (empty slots, filled at load, stamped with the
read time). No em-dashes anywhere the site serves. Canadian pages metric.
Landmarks hand-written against real sightlines or absent. Everything labeled
forecast/model estimate; the disclaimer verbatim.
