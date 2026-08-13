# Smokeshow, for agents

Smokeshow is a wildfire smoke forecast web app: how bad is the air here, and when
does it clear. This file orients any coding agent working in the repo.

## Start here, by task

- **Writing an article / guide / blog post** → follow `docs/writing-a-post.md`.
  It is the complete, self-contained playbook. Posts are one markdown file in
  `content/articles/`; the build does the SEO, schema, and layout. Do not
  hand-write HTML for a post.
- **Adding or editing a covered city** → edit `src/data/locations.js` only. The
  rules are enforced by `src/data/locations.test.js` (a red build tells you what
  broke).
- **Anything else** → read `CLAUDE.md`, which carries the full architecture, the
  hard rules, and the build order. `CLAUDE.md` is the deep reference; this file is
  the index. The two are meant to agree.

## Ground rules that bite

- Static-first: pages must ship their words in the initial HTML payload, so a
  crawler and an AI engine see them without running JS.
- Copy never cites an AQI or concentration number; it uses air-level names only.
- Nothing the site serves contains an em-dash. En-dashes for numeric ranges are
  fine.
- A static page never asserts the current condition anywhere a reader could take
  it for today's answer.

## Build and test

- `npm run build` — generates every static page (`/smoke-forecast/`, `/about/`,
  `/guides/`) and the sitemap, then runs Vite.
- `npm run pages` — just the static-page generation.
- `npm run test` — the full suite. Adding content should keep it green.
