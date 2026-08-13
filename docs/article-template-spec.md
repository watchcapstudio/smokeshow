# Article template spec

The goal: one place to drop a markdown file so a new post ships as a static,
crawlable, AI-citable page that looks like the rest of the app. Whoever writes
the post (usually Claude) fills frontmatter and prose. The build does the rest.

Priorities, in order:

1. **SEO.** Static HTML in the initial payload, correct schema, clean meta,
   canonical, internal links. Nothing about the design may cost this.
2. **AI search (AEO/GEO).** Answer-first structure, question-shaped headings,
   an FAQ block. This is what gets a page quoted by an AI engine.
3. **Beauty.** The page inherits the app's living sky and cream reading sheet.
   It should feel like Smokeshow, not a generic blog. Third priority, not zero.

No Astro. The existing generator already emits static HTML with JSON-LD, which
is the only thing Astro would buy us. We add a markdown loader to it, not a
framework around it.

## Content source

```
content/articles/<slug>.md
```

One file per post. The filename is the slug, so `content/articles/is-it-safe-to-run-in-wildfire-smoke.md`
becomes `/is-it-safe-to-run-in-wildfire-smoke/`.

Frontmatter (YAML). Required fields fail the build if missing, the same way a
bad city page fails today, so a post literally cannot ship without them.

```yaml
---
title: "Is It Safe to Run Outside in Wildfire Smoke?"   # required, the <h1> and <title> base
description: "..."            # required, 140-160 chars, the meta description and the answer-first lead
slug: "is-it-safe-to-run-in-wildfire-smoke"  # required, matches filename
datePublished: "2026-08-13"  # required, ISO date
dateModified: "2026-08-13"   # optional, defaults to datePublished
tldr: "..."                  # required, one to three sentences, the direct answer up top
faq:                         # optional but strongly encouraged, feeds FAQPage schema
  - q: "What AQI is too high to run in?"
    a: "..."
  - q: "Does an N95 help while running?"
    a: "..."
related:                     # optional, slugs of other articles or city pages to link
  - "/smoke-forecast/seattle-wa/"
  - "how-smoke-forecasts-work"
---
```

Body is plain markdown. `##` headings become `<h2>`, and the writer is told to
phrase them as questions where it fits, because that is what AEO rewards.

## Build

Add to `scripts/`:

- `gray-matter` parses frontmatter.
- `marked` renders the body to HTML.
- A new `articles.mjs` reads `content/articles/*.md`, validates frontmatter
  (throw on missing required fields), and emits one page per file through the
  shared `articleTemplate()`.
- `npm run pages` also builds articles. `npm run build` already runs pages.
- Each article is added to `sitemap.xml` and to the article index automatically.

The FAQ copy and the FAQPage JSON-LD are generated from the same `faq` array, so
they can never disagree. This is the existing rule on the city pages, kept.

## The template (one responsive layout)

One HTML template. CSS handles mobile and desktop. Never two templates, they
drift.

### Head, meta, schema

- `<title>`: `{title} | SMOKESHOW`
- `<meta name="description">`: the `description` field
- `<link rel="canonical">`: the article URL
- OG + Twitter card, same block the editorial pages already use
- **JSON-LD, three scripts:**
  - `BlogPosting`: `headline`, `description`, `datePublished`, `dateModified`,
    `author` (Organization, SMOKESHOW / Watchcap Studio), `publisher`,
    `mainEntityOfPage`, `url`. This is the upgrade over today's `WebPage` type
    and is what earns article rich results and AI citation.
  - `FAQPage`: from the `faq` array, only if present.
  - `BreadcrumbList`: SMOKESHOW / Articles / this post.

### Page structure (semantic, answer-first)

```
<header>            live sky behind it, same as every page
  <p eyebrow>       mono small-caps: "Field guide" or the section label
  <h1>              the title
  <p lead>          the description, verbatim, so the answer starts above the fold
</header>

<article>           the cream reading sheet
  <aside class="short-answer">   the tldr field. Default style A (see below)
  ...markdown body, <h2> question headings...
  <section faq>     the accordion, if faq present. Same +/- pattern as today.
  <section related> "Keep reading" links from the related field
  <disclaimer>      the site DISCLAIMER, unchanged
</article>

<footer>            existing footer
```

### Mobile vs desktop

Same markup. The differences are CSS only:

- **Reading measure.** Cap the prose column at ~68ch (roughly 640px), centered,
  not the app's 720px. 720px of running prose is a touch wide to read
  comfortably. City pages keep 720px, articles get the tighter measure.
- **The grab handle goes.** The little pill at the top of the sheet is a phone
  bottom-sheet idiom. It made sense when this copy was a sheet under the map. On
  a standalone article at desktop width it reads as a leftover. Drop it here.
- **Header on desktop.** More vertical air above the `h1`, the sky given room to
  breathe as a hero band behind the title, then the sheet rises into it. On
  mobile the header compresses and the sheet starts sooner.
- **Short-answer block.** See its own section below. Same on both widths, just
  reflowed.
- Type scale steps up one notch at desktop for the lead and h2s. Body stays
  ~1.05rem for reading.

### The short-answer block

Every article opens with a pulled-out answer, above the first `h2`, so a skimmer
and an AI engine both hit the answer in the first screen. This is the single most
important element for AEO. Two styles:

- **A · Editorial lead (default).** No box, no accent bar. The answer set as a
  larger, quieter paragraph bracketed by two hairline rules, under a mono
  "The short answer" kicker. It reads as the site's own voice and works for any
  article, including essays whose answer is not level-shaped. This is the default
  and covers most posts. Deliberately not the tinted-card-with-left-bar pattern,
  which reads as generic AI house style.

- **B · Verdict rows (reusable component).** When the answer maps to the air
  levels ("should I run / mow / let the kids out"), the answer renders as a small
  decision table: one row per level, each with the level's real rating color as a
  dot, the level name in mono, and the call. It is native to the product, more
  useful than prose, and cleanly structured for an AI engine to lift. Built as a
  **reusable component** (`smoke-verdict`), not article-only, so the city pages
  and future surfaces can use the same block from one source. The rating colors
  come from the same tokens the map and chips use, so it can never drift from the
  app's palette.

Frontmatter selects: default is A; `answer_style: verdict` with a `verdict` array
(level + call per row) renders B. A short lead sentence can follow B for the
"why."

```yaml
answer_style: verdict          # omit for the default editorial lead
verdict:
  - level: clear
    call: "Run normally."
  - level: hazy
    call: "Keep it easy and short."
  - level: smells
    call: "Skip the outdoor run."
  - level: tastes
    call: "Stay in. No question."
```

### Design language (the "sexy," kept honest)

Everything here already exists in the app, nothing new invented:

- **Living sky** (`SkyBackdrop`) behind the header. It is the app's signature and
  it is free here. Article pages do not need the map, but the sky ties them to
  the product.
- **Cream reading sheet**, scoped fixed ink, 24px radius, the surface the
  editorial pages already use. Reference material sits on paper, not on the live
  air. That contrast is the design idea, kept.
- **Mono small-caps eyebrows and h2 kickers** (the typewriter voice), body in the
  system sans already loaded. No web fonts, no new network cost.
- Accent orange for links and the FAQ +/- only.

## Guardrails (inherited from the site's existing rules)

These already govern city pages. Articles obey them too, enforced in the
frontmatter/body validator where possible:

- **No AQI or concentration numbers in copy.** Level names only. Same reason: the
  chip the app paints comes from a different scale and any named value eventually
  contradicts it.
- **No em-dashes in anything served.** En-dashes for numeric ranges are fine.
- **No asserting a current condition.** An article is evergreen. It must never
  read as today's answer for a place.
- Level names are the five canonical ones, spelled as the app spells them.

## The workflow this creates

To publish a post, Claude (or anyone):

1. Writes `content/articles/<slug>.md`, frontmatter and prose.
2. Runs `npm run build`. Validator passes or tells them exactly what is missing.
3. The page ships static, with BlogPosting + FAQPage schema, on brand, indexed in
   the sitemap and the article index, desktop and mobile both handled.

No template decisions per post. No SEO checklist to remember. The template holds
the standard so the content can't drop it.

## Decisions (locked 2026-08-13)

1. **URL shape: folder.** Articles live at `/guides/<slug>/`. A subdirectory is a
   topical-cluster signal to Google and AI crawlers; root scatters the pages and
   `/blog/` reads as marketing. `/guides/` says evergreen reference.
2. **Index hub: yes.** Build `/guides/` as a pillar page listing every article.
   It is the pillar in a pillar-and-cluster structure: every post gets a crawlable
   internal link, link equity flows through one page, and a hub linking N smoke
   guides is how the site signals topical authority, which is what makes an AI
   engine cite it. Cheap to build, models the existing city directory.
3. **Byline: no visible byline.** Keep `author`/`publisher` in the JSON-LD only.
   Show a visible published/updated date (helps freshness signals) but no name.
4. **Migrate the explainer.** Once the template is right, move
   `/how-smoke-forecasts-work/` into this system as post #1. It proves the
   template on real copy and removes the one-off. (Its URL may move under
   `/guides/`; add a redirect from the old path.)
