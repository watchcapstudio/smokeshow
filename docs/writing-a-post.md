# Writing a guide (the /guides/ articles)

This is the playbook for adding an evergreen article to Smokeshow. It is written
so an agent can follow it start to finish. If you are an AI being asked to "write
a Smokeshow post," this file is the whole job.

Writing a post is writing one markdown file. The build turns it into a static,
crawlable, AI-citable page with the right schema, on brand, in the topic cluster.
You do not touch HTML, CSS, or the templates.

## What we optimize for, in order

1. **SEO.** The page ships as static HTML with correct schema and meta.
2. **AI search (AEO).** Answer the question in the first screen. Use question-
   shaped headings and an FAQ. This is what gets the page quoted.
3. **Reading.** It inherits the app's look automatically. You write words.

## Steps

1. Create `content/articles/<slug>.md`. The filename is the URL: the file
   `is-it-safe-to-run-in-wildfire-smoke.md` becomes
   `/guides/is-it-safe-to-run-in-wildfire-smoke/`. Pick a slug that is the search
   phrase, hyphenated, lowercase.
2. Fill the frontmatter (below). Required fields are enforced: a missing one is a
   failed build, not a silent omission.
3. Write the body in markdown. Lead with the answer, then explain.
4. Run `npm run build` (or `npm run pages` for just the HTML). If it is red, the
   message says exactly what to fix. If it is green, the page is live-ready at
   `/guides/<slug>/`, in the sitemap, and linked from the `/guides/` hub.

## Frontmatter

```yaml
---
slug: is-it-safe-to-run-in-wildfire-smoke   # required, must match the filename
title: "Is It Safe to Run in Wildfire Smoke?"  # required; the <title> and search headline
heading: "Should you run when it's smoky?"     # optional; the on-page h1 if you want it warmer than the title
description: "..."                              # required; 140-160 chars; the meta description AND the lead sentence
datePublished: "2026-08-13"                    # required; ISO date
dateModified: "2026-08-13"                     # optional; defaults to datePublished
eyebrow: "Field guide"                         # optional; the small label above the h1
tldr: "The direct answer in one to three plain sentences."   # required; this is the short answer up top
answer_style: lead                             # optional; "lead" (default) or "verdict"
verdict:                                        # required only when answer_style is "verdict"
  - level: all-clear
    call: "Run normally."
  - level: smells
    call: "Keep it easy and short."
  - level: smokeshow
    call: "Stay inside."
faq:                                            # optional but strongly encouraged (feeds FAQPage schema)
  - q: "What air quality is too smoky to run in?"
    a: "..."
related:                                        # optional; "keep reading" links
  - another-guide-slug                          #   a bare slug links to another guide
  - href: /smoke-forecast/seattle-wa/           #   an object links anywhere, with your own label
    label: "Wildfire smoke in Seattle"
    tag: City
---
```

## The two short-answer styles

Every post opens with a pulled-out **short answer** above the first heading. This
is the most important element for AI search: put the real answer here.

- **`lead` (default).** The `tldr` is set as a larger, quieter paragraph between
  two hairlines. Use for almost everything, including any post whose answer is not
  about air levels.
- **`verdict`.** For "should I do X when it's smoky" posts, where the answer
  changes by air level. The `verdict` rows render as a small color-coded table
  (the `smoke-verdict` component), and `tldr` becomes the one-line "why" beneath
  it. Only use a real level; the build rejects anything else.

## The five air levels (use these exact keys in `verdict`)

| key | name |
| --- | --- |
| `all-clear` | All clear |
| `something` | In the air |
| `smells` | Hazy |
| `tastes` | Heavy haze |
| `smokeshow` | Smokeshow |

The component prints the name for you from the key, so you cannot misspell a
level. (The keys are historical; the names are what readers see.)

## The rules (the build enforces the mechanical ones)

- **Never cite an AQI or a concentration number in copy.** No "AQI 150", no
  "35 µg/m³", no "PM2.5 of 55". Use level *names* only. The app paints the number
  from a different scale, so any number you write will eventually contradict the
  chip above it. The build fails on this.
- **No em-dashes.** Anywhere the site serves. Use a comma or a period. An en-dash
  is fine for a numeric range (3–5 miles). The build fails on an em-dash.
- **Never assert today's condition.** A guide is evergreen. Do not write as if you
  know the air right now for any place.
- **Answer first.** The `tldr` and the opening should answer the title before any
  background. Phrase `##` headings as questions where it fits.
- **Cite sources with a token, not by hand.** Write `{{sources:forecast}}`,
  `{{sources:fires}}`, or `{{sources:hotspots}}` and the build expands it to the
  credited links from `src/data/sources.js`. Do not paste source names or URLs.

## What the build does for you

`BlogPosting` + (when present) `FAQPage` + breadcrumb JSON-LD, the canonical, the
Open Graph tags, the living-sky masthead, the cream reading sheet, the mobile and
desktop layouts, the sitemap entry, and the link from the `/guides/` hub. None of
that is your job. Write the file, run the build, read the page.

Template internals live in `scripts/gen-articles.mjs` and `src/styles/article.css`;
the spec is `docs/article-template-spec.md`.
