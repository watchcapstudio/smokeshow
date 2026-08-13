// Generates the /guides/ articles and their hub, one static HTML page per
// markdown file in content/articles/. Runs in `npm run pages`, before the city
// generator writes the sitemap and before `vite build` globs its inputs.
//
// The point of this file is that writing a post is writing a markdown file and
// nothing else. The frontmatter carries the pieces SEO needs; the body is prose.
// Everything that has to be right on every post — the BlogPosting and FAQPage
// schema, the canonical, the answer-first structure, the on-brand shell — is
// baked in here so a post cannot ship without it. The validator below turns the
// mechanical rules into a red build rather than a thing a writer has to remember.
//
// See docs/writing-a-post.md for the author-facing contract.

import { mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { marked } from 'marked';
import { LEVELS } from '../src/lib/rating.js';
import {
  ORIGIN,
  STUDIO_ORIGIN,
  esc,
  escAttr,
  jsonForScript,
  DISCLAIMER,
  ANALYTICS_HEAD,
  APP_ICON_HEAD,
  footer,
  sourceLinks,
  breadcrumbJsonLd,
} from './lib/page.mjs';

// Body token: {{sources:forecast}} expands to the credited source links for a
// role, read from src/data/sources.js. Lets a post cite the data sources
// without hardcoding names or URLs that would drift from the canonical list.
function expandTokens(markdown) {
  return markdown.replace(/\{\{sources:(\w+)\}\}/g, (_, role) => sourceLinks(role));
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = join(ROOT, 'content', 'articles');
const SECTION = 'guides'; // URL segment: /guides/<slug>/
const SITE_SUFFIX = ' | SMOKESHOW';

// Level key -> canonical name, sourced from rating.js so the verdict component
// can never print a name the app does not use. The five keys are the only ones
// a `verdict` row may name; anything else is a build error, because a made-up
// level name is exactly the failure the whole level system exists to prevent.
const LEVEL_NAME = Object.fromEntries(LEVELS.map((l) => [l.key, l.name]));
const LEVEL_KEYS = LEVELS.map((l) => l.key);

// -------------------------------------------------------------- validation

// The guardrails, applied to everything that ships in the payload: title,
// description, tldr, verdict calls, faq, and the body. These mirror the rules
// the city pages enforce in locations.test.js, kept here so an article cannot
// break them either.
function assertGuardrails(slug, servedText) {
  // Em-dashes read as an AI tell and the site bans them everywhere it serves.
  // En-dashes are allowed (numeric ranges), so only the em-dash is caught.
  if (servedText.includes('—')) {
    throw new Error(
      `[${slug}] contains an em-dash (—). The site serves none; use a comma, a period, or an en-dash for a numeric range.`,
    );
  }
  // Never cite an AQI or concentration number in copy. Level NAMES only. The
  // chip the app paints comes from a different scale, so any named value
  // eventually contradicts it. Catches "AQI 150", "150 AQI", "35 µg/m³",
  // "PM2.5 of 55", and bare "µg/m3" readings.
  const numberClaims = [
    /\bAQI\b[^.]{0,12}?\d/i,
    /\d[^.]{0,12}?\bAQI\b/i,
    /\bPM ?2\.?5\b[^.]{0,12}?\d/i,
    /\d\s*(?:µg|ug)\s*\/\s*m/i,
  ];
  for (const re of numberClaims) {
    const m = servedText.match(re);
    if (m) {
      throw new Error(
        `[${slug}] cites an air-quality number ("${m[0].trim()}"). Copy uses level names only (${LEVELS.map((l) => l.name).join(', ')}), never AQI or concentration values.`,
      );
    }
  }
}

function requireField(slug, data, field) {
  const v = data[field];
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    throw new Error(`[${slug}] is missing required frontmatter: "${field}".`);
  }
  return v;
}

// Read and validate one markdown file into a fully-checked article object. Every
// throw here is a build failure with a message that says what to fix.
async function parseArticle(file) {
  const raw = await readFile(join(CONTENT_DIR, file), 'utf8');
  const fileSlug = basename(file, '.md');
  const { data, content } = matter(raw);

  const slug = requireField(fileSlug, data, 'slug');
  if (slug !== fileSlug) {
    throw new Error(
      `[${fileSlug}] frontmatter slug "${slug}" does not match its filename. They must match so the URL is predictable.`,
    );
  }

  const title = requireField(slug, data, 'title');
  // The <title> tag and BlogPosting headline target the search keyword; the on-
  // page h1 can be a warmer, more human phrasing. `heading` overrides the h1
  // only; default it to the title so most posts set one thing.
  const heading = data.heading || title;
  const description = requireField(slug, data, 'description');
  const datePublished = requireField(slug, data, 'datePublished');
  const tldr = requireField(slug, data, 'tldr');
  const dateModified = data.dateModified || datePublished;
  const eyebrow = data.eyebrow || 'Field guide';
  const answerStyle = data.answer_style || 'lead';
  const faq = Array.isArray(data.faq) ? data.faq : [];
  const related = Array.isArray(data.related) ? data.related : [];
  const verdict = Array.isArray(data.verdict) ? data.verdict : [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(datePublished))) {
    throw new Error(`[${slug}] datePublished "${datePublished}" must be an ISO date (YYYY-MM-DD).`);
  }
  if (answerStyle !== 'lead' && answerStyle !== 'verdict') {
    throw new Error(`[${slug}] answer_style "${answerStyle}" must be "lead" (default) or "verdict".`);
  }
  if (answerStyle === 'verdict') {
    if (!verdict.length) {
      throw new Error(`[${slug}] answer_style is "verdict" but no "verdict" rows were given.`);
    }
    for (const row of verdict) {
      if (!LEVEL_KEYS.includes(row.level)) {
        throw new Error(
          `[${slug}] verdict row level "${row.level}" is not a real level. Use one of: ${LEVEL_KEYS.join(', ')}.`,
        );
      }
      if (!row.call || !String(row.call).trim()) {
        throw new Error(`[${slug}] verdict row for "${row.level}" has no "call".`);
      }
    }
  }
  for (const item of faq) {
    if (!item.q || !item.a) {
      throw new Error(`[${slug}] every faq entry needs a "q" and an "a".`);
    }
  }

  // Guardrail scan over everything that reaches the reader.
  const served = [
    title,
    description,
    tldr,
    content,
    ...verdict.map((v) => v.call),
    ...faq.flatMap((f) => [f.q, f.a]),
  ].join('\n');
  assertGuardrails(slug, served);

  return {
    slug,
    title,
    heading,
    description,
    datePublished: String(datePublished),
    dateModified: String(dateModified),
    eyebrow,
    tldr,
    answerStyle,
    verdict,
    faq,
    related,
    bodyHtml: marked.parse(expandTokens(content)),
    url: `${ORIGIN}/${SECTION}/${slug}/`,
  };
}

// ------------------------------------------------------------------ schema

function blogPostingJsonLd(a) {
  return jsonForScript({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: a.title,
    description: a.description,
    datePublished: a.datePublished,
    dateModified: a.dateModified,
    author: { '@type': 'Organization', name: 'SMOKESHOW', url: `${ORIGIN}/` },
    publisher: {
      '@type': 'Organization',
      name: 'WatchCap Studio',
      url: STUDIO_ORIGIN,
      logo: { '@type': 'ImageObject', url: `${ORIGIN}/icon-512.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': a.url },
    url: a.url,
    image: `${ORIGIN}/api/og`,
  });
}

function faqJsonLd(faq) {
  return jsonForScript({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  });
}

// ---------------------------------------------------------------- fragments

// The shared document head. og:type is "article" here (the editorial pages use
// "website"), which is the pairing Google and the social unfurlers expect for a
// dated post carrying BlogPosting data.
function articleHead(a) {
  const title = `${a.title}${SITE_SUFFIX}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
${ANALYTICS_HEAD}

    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <meta name="theme-color" content="#8ba9c4" />
    <title>${escAttr(title)}</title>
    <meta name="description" content="${escAttr(a.description)}" />
    <link rel="canonical" href="${escAttr(a.url)}" />

    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="SMOKESHOW" />
    <meta property="og:title" content="${escAttr(a.title)}" />
    <meta property="og:description" content="${escAttr(a.description)}" />
    <meta property="og:url" content="${escAttr(a.url)}" />
    <meta property="og:image" content="${escAttr(`${ORIGIN}/api/og`)}" />
    <meta property="article:published_time" content="${escAttr(a.datePublished)}" />
    <meta property="article:modified_time" content="${escAttr(a.dateModified)}" />
    <meta name="twitter:card" content="summary_large_image" />
${APP_ICON_HEAD}
  </head>
  <body>`;
}

// The decorative masthead sky. A static resting sky (clear midday, the same
// palette the live SkyBackdrop paints before any air arrives), plus a soft sun
// and a feathered ridge. It carries no reading and no location — it is a
// masthead, not an instrument — so it never asserts a condition. The live
// SkyBackdrop is a later upgrade; this is the resting frame, drawn in CSS.
const MASTHEAD_SKY = `
      <div class="guide-sky" aria-hidden="true">
        <div class="guide-sky__gradient"></div>
        <div class="guide-sky__sun"></div>
        <svg class="guide-sky__ridge" viewBox="0 0 1440 300" preserveAspectRatio="none">
          <path d="M0,300 L0,150 C160,120 300,175 470,150 C640,125 760,80 940,110 C1120,140 1280,130 1440,105 L1440,300 Z" class="guide-sky__ridge-far" />
          <path d="M0,300 L0,200 C200,175 360,215 560,195 C760,175 900,140 1120,165 C1280,183 1360,180 1440,170 L1440,300 Z" class="guide-sky__ridge-near" />
        </svg>
      </div>`;

// Short answer, style A (default): a larger, quieter lead bracketed by two
// hairlines under a mono kicker. No box, no accent bar — that pattern reads as
// generic AI house style. Works for any article, including ones whose answer is
// not level-shaped.
function shortAnswerLead(a) {
  return `
        <aside class="short-answer">
          <p class="short-answer__kicker">The short answer</p>
          <div class="short-answer__body">
            <p>${a.tldr}</p>
          </div>
        </aside>`;
}

// Short answer, style B: the reusable smoke-verdict component. One row per air
// level, each dotted with that level's real rating color (from the same token
// the map and chips read, keyed by level key so it cannot drift) and named with
// the level's canonical name. The tldr follows as the one-line "why". Native to
// the product and cleanly structured for an AI engine to lift.
function smokeVerdict(a) {
  const rows = a.verdict
    .map(
      ({ level, call }) => `
            <li class="smoke-verdict__row">
              <span class="smoke-verdict__level">
                <span class="smoke-verdict__dot" data-level="${escAttr(level)}"></span>${esc(LEVEL_NAME[level])}
              </span>
              <span class="smoke-verdict__call">${esc(call)}</span>
            </li>`,
    )
    .join('');
  return `
        <aside class="short-answer short-answer--verdict">
          <p class="short-answer__kicker">The short answer</p>
          <ul class="smoke-verdict">${rows}
          </ul>
          <p class="smoke-verdict__why">${a.tldr}</p>
        </aside>`;
}

function shortAnswer(a) {
  return a.answerStyle === 'verdict' ? smokeVerdict(a) : shortAnswerLead(a);
}

function faqSection(a) {
  if (!a.faq.length) return '';
  const items = a.faq
    .map(
      ({ q, a: ans }) => `
          <details class="faq__item">
            <summary><h3>${esc(q)}</h3></summary>
            <p>${esc(ans)}</p>
          </details>`,
    )
    .join('');
  return `
        <section class="faq">
          <h2>Common questions</h2>${items}
        </section>`;
}

// "Keep reading" links. A related entry is either a bare guide slug (string) or
// an explicit { href, label, tag } object for pointing off into the city and
// corridor pages. Explicit rather than guessed: a label inferred from a URL is
// how you ship "Wildfire smoke in Smoke-forecast" to production.
function relatedSection(a) {
  if (!a.related.length) return '';
  const items = a.related
    .map((ref) => {
      const { href, label, tag } =
        typeof ref === 'string'
          ? { href: `/${SECTION}/${ref}/`, label: slugToTitle(ref), tag: 'Guide' }
          : { href: ref.href, label: ref.label, tag: ref.tag || 'Page' };
      return `
            <li class="related__item">
              <a href="${escAttr(href)}"><span>${esc(label)}</span><span class="related__tag">${esc(tag)}</span></a>
            </li>`;
    })
    .join('');
  return `
        <section class="related">
          <h2>Keep reading</h2>
          <ul class="related__list">${items}
          </ul>
        </section>`;
}

function slugToTitle(slug) {
  return String(slug)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ------------------------------------------------------------------- pages

function articlePage(a) {
  const dateLabel = formatDate(a.datePublished);
  return `${articleHead(a)}
    <div class="guide">
${MASTHEAD_SKY}
      <header class="guide__header">
        <p class="eyebrow">${esc(a.eyebrow)}</p>
        <h1 class="guide__title">${esc(a.heading)}</h1>
        <p class="guide__lead">${esc(a.description)}</p>
        <p class="guide__meta"><span>Updated ${esc(dateLabel)}</span></p>
      </header>

      <article class="guide__sheet">
        <div class="prose">
${shortAnswer(a)}
${a.bodyHtml}
        </div>
${faqSection(a)}
${relatedSection(a)}
        <div class="disclaimer"><p>${DISCLAIMER}</p></div>
      </article>${footer()}
    </div>
    <script type="application/ld+json">
${blogPostingJsonLd(a)}
    </script>${a.faq.length ? `\n    <script type="application/ld+json">\n${faqJsonLd(a.faq)}\n    </script>` : ''}
    <script type="application/ld+json">
${breadcrumbJsonLd([
  ['SMOKESHOW', '/'],
  ['Guides', `/${SECTION}/`],
  [a.title, a.url.replace(ORIGIN, '')],
])}
    </script>
    <script type="module" src="/src/article.js"></script>
  </body>
</html>
`;
}

// The pillar hub: /guides/. Lists every article, newest first. It is the page
// that turns a folder of posts into a topic cluster — every post gets a
// crawlable internal link from one authoritative page, and a hub linking N
// smoke guides is how the site states topical authority.
function hubPage(articles) {
  const url = `${ORIGIN}/${SECTION}/`;
  const title = `Wildfire Smoke Guides${SITE_SUFFIX}`;
  const description =
    'Plain-language guides to living with wildfire smoke: how forecasts work, what the air-quality levels mean, and how to make everyday calls when the air is bad.';
  const head = articleHeadForHub({ title, description, url });
  const rows = articles
    .map(
      (a) => `
          <li class="guide-index__item">
            <a href="${escAttr(`/${SECTION}/${a.slug}/`)}">
              <span class="guide-index__title">${esc(a.title)}</span>
              <span class="guide-index__desc">${esc(a.description)}</span>
            </a>
          </li>`,
    )
    .join('');

  return `${head}
    <div class="guide">
${MASTHEAD_SKY}
      <header class="guide__header">
        <p class="eyebrow">Guides</p>
        <h1 class="guide__title">Wildfire smoke, explained</h1>
        <p class="guide__lead">${esc(description)}</p>
      </header>

      <div class="guide__sheet">
        <ul class="guide-index">${rows}
        </ul>
        <div class="disclaimer"><p>${DISCLAIMER}</p></div>
      </div>${footer()}
    </div>
    <script type="application/ld+json">
${jsonForScript({
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'Wildfire Smoke Guides',
  description,
  url,
  isPartOf: { '@type': 'WebSite', name: 'SMOKESHOW', url: `${ORIGIN}/` },
  hasPart: articles.map((a) => ({ '@type': 'BlogPosting', name: a.title, url: a.url })),
})}
    </script>
    <script type="application/ld+json">
${breadcrumbJsonLd([
  ['SMOKESHOW', '/'],
  ['Guides', `/${SECTION}/`],
])}
    </script>
    <script type="module" src="/src/article.js"></script>
  </body>
</html>
`;
}

// The hub head reuses the article head shape but with og:type website — it is a
// directory, not a post.
function articleHeadForHub({ title, description, url }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
${ANALYTICS_HEAD}

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
${APP_ICON_HEAD}
  </head>
  <body>`;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

// ------------------------------------------------------------------ collect

// Read every article, validated and sorted newest-first. Shared by the emitter
// and by the sitemap in gen-location-pages, so both see the same set.
export async function loadArticles() {
  let files;
  try {
    files = (await readdir(CONTENT_DIR)).filter((f) => f.endsWith('.md'));
  } catch {
    return []; // no content dir yet is a supported state
  }
  const articles = await Promise.all(files.map(parseArticle));
  return articles.sort((a, b) => (a.datePublished < b.datePublished ? 1 : -1));
}

// URLs for the sitemap: the hub plus every article. Empty if there are no posts.
export async function articleRoutes() {
  const articles = await loadArticles();
  if (!articles.length) return [];
  return [`${ORIGIN}/${SECTION}/`, ...articles.map((a) => a.url)];
}

export async function generateArticles() {
  const articles = await loadArticles();

  // Wipe first so a renamed or deleted slug cannot orphan a page.
  await rm(join(ROOT, SECTION), { recursive: true, force: true });
  if (!articles.length) return [];

  const written = [];
  const emit = async (dir, html) => {
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'index.html');
    await writeFile(file, html, 'utf8');
    written.push(file);
  };

  for (const a of articles) {
    await emit(join(ROOT, SECTION, a.slug), articlePage(a));
  }
  await emit(join(ROOT, SECTION), hubPage(articles));
  return written;
}

// Exported for the tests; they assert on markup without touching disk.
export const _internal = {
  parseArticle,
  articlePage,
  hubPage,
  smokeVerdict,
  shortAnswerLead,
  blogPostingJsonLd,
  assertGuardrails,
  SECTION,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const written = await generateArticles();
  console.log(`articles: ${written.length} written (${Math.max(0, written.length - 1)} posts + hub)`);
}
