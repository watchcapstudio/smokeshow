import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/lib/rating.js';
import { _internal, loadArticles } from './gen-articles.mjs';

const { articlePage, hubPage, smokeVerdict, blogPostingJsonLd, assertGuardrails } = _internal;

// A minimal valid article object, the shape parseArticle returns. Individual
// tests override fields. bodyHtml is already-rendered HTML because parseArticle
// runs marked before articlePage ever sees it.
function fakeArticle(overrides = {}) {
  return {
    slug: 'demo',
    title: 'Demo title for search',
    heading: 'A warmer demo heading',
    description: 'A demo description that stands in for the meta description and the lead.',
    datePublished: '2026-08-13',
    dateModified: '2026-08-13',
    eyebrow: 'Field guide',
    tldr: 'The short answer in one or two plain sentences.',
    answerStyle: 'lead',
    verdict: [],
    faq: [],
    related: [],
    bodyHtml: '<h2>A section</h2>\n<p>Body copy.</p>',
    url: 'https://smokeshow.earth/guides/demo/',
    ...overrides,
  };
}

describe('article guardrails (the build wall)', () => {
  it('rejects an em-dash anywhere it would ship', () => {
    expect(() => assertGuardrails('demo', 'a sentence — with an em dash')).toThrow(/em-dash/);
  });

  it('rejects an AQI or concentration number in copy', () => {
    expect(() => assertGuardrails('demo', 'the AQI hit 150 today')).toThrow(/air-quality number/);
    expect(() => assertGuardrails('demo', 'around 35 µg/m³ at noon')).toThrow(/air-quality number/);
    expect(() => assertGuardrails('demo', 'PM2.5 of 55')).toThrow(/air-quality number/);
  });

  it('allows level names and en-dashed ranges', () => {
    expect(() =>
      assertGuardrails('demo', 'Air ran Hazy to Heavy haze, roughly 3–5 miles of visibility.'),
    ).not.toThrow();
  });
});

describe('article page markup and schema', () => {
  it('carries the BlogPosting schema, canonical, and og:type article', () => {
    const html = articlePage(fakeArticle());
    expect(html).toContain('"@type":"BlogPosting"');
    expect(html).toContain('<link rel="canonical" href="https://smokeshow.earth/guides/demo/" />');
    expect(html).toContain('<meta property="og:type" content="article" />');
    expect(html).toContain('"datePublished":"2026-08-13"');
  });

  it('puts the keyword title in the head and the warmer heading in the h1', () => {
    const html = articlePage(fakeArticle());
    expect(html).toContain('<title>Demo title for search | SMOKESHOW</title>');
    expect(html).toContain('<h1 class="guide__title">A warmer demo heading</h1>');
  });

  it('renders the short answer above the body by default (style A, no box)', () => {
    const html = articlePage(fakeArticle());
    expect(html).toContain('short-answer__kicker');
    expect(html).not.toContain('short-answer--verdict');
    expect(html.indexOf('short-answer__kicker')).toBeLessThan(html.indexOf('<h2>A section</h2>'));
  });

  it('emits FAQPage schema only when the post has an faq', () => {
    expect(articlePage(fakeArticle())).not.toContain('"@type":"FAQPage"');
    const withFaq = articlePage(
      fakeArticle({ faq: [{ q: 'Is it safe?', a: 'It depends on the level.' }] }),
    );
    expect(withFaq).toContain('"@type":"FAQPage"');
    expect(withFaq).toContain('Is it safe?');
  });

  it('always carries a Guides breadcrumb', () => {
    const html = articlePage(fakeArticle());
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('"name":"Guides"');
  });
});

describe('the smoke-verdict component (style B)', () => {
  const verdict = [
    { level: 'all-clear', call: 'Run normally.' },
    { level: 'smells', call: 'Keep it easy.' },
    { level: 'smokeshow', call: 'Stay in.' },
  ];

  it('prints each level by its canonical name, never an invented one', () => {
    const html = smokeVerdict(fakeArticle({ answerStyle: 'verdict', verdict }));
    for (const { level } of verdict) {
      const name = LEVELS.find((l) => l.key === level).name;
      expect(html).toContain(name);
    }
    // The names it must never print (the mock's invented ones).
    expect(html).not.toMatch(/Smells-like-fire|Tastes-like-fire/);
  });

  it('colors each dot from the level key, so it tracks the app palette', () => {
    const html = smokeVerdict(fakeArticle({ answerStyle: 'verdict', verdict }));
    expect(html).toContain('data-level="all-clear"');
    expect(html).toContain('data-level="smokeshow"');
  });
});

describe('the migrated explainer, loaded from disk', () => {
  it('is the first guide, at its /guides/ URL, holding the copy rules', async () => {
    const articles = await loadArticles();
    const explainer = articles.find((a) => a.slug === 'how-smoke-forecasts-work');
    expect(explainer, 'explainer article is present').toBeTruthy();
    expect(explainer.url).toBe('https://smokeshow.earth/guides/how-smoke-forecasts-work/');

    const html = articlePage(explainer);
    expect(html).toContain('"@type":"BlogPosting"');
    expect(html).not.toContain('—'); // no em-dash
    expect(html).not.toMatch(/\bAQI\b/i);
    expect(html).not.toMatch(/\bobserved\b/i);
    // The provenance token expanded into real source links, not literal braces.
    expect(html).not.toContain('{{sources');
  });
});

describe('the guides hub', () => {
  it('lists each article and declares a CollectionPage', async () => {
    const articles = await loadArticles();
    const html = hubPage(articles);
    expect(html).toContain('"@type":"CollectionPage"');
    for (const a of articles) {
      expect(html).toContain(`/guides/${a.slug}/`);
    }
  });
});
