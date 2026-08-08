import { describe, expect, it } from 'vitest';
import { LOCATIONS, locationBySlug } from './locations.js';
import { LEVELS } from '../lib/rating.js';
import { _internal } from '../../scripts/gen-location-pages.mjs';

const { page, sitemap } = _internal;

// Parse every ld+json block the page emits. Parsing rather than string-matching
// is the point: if the generator ever escapes its JSON wrongly, this throws.
function jsonLdBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1]),
  );
}

describe('location data', () => {
  it('has a unique slug per location', () => {
    const slugs = LOCATIONS.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses URL-safe slugs', () => {
    for (const l of LOCATIONS) expect(l.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('carries plottable coordinates', () => {
    for (const l of LOCATIONS) {
      expect(Math.abs(l.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(l.lon)).toBeLessThanOrEqual(180);
    }
  });

  // The landmark list is rendered one row per level, zipped by index. A short
  // list would silently drop the worst levels off the bottom of the page --
  // exactly the ones a reader checking a smoky sky needs.
  it('has one landmark sightline per rating level', () => {
    for (const l of LOCATIONS) expect(l.landmarks).toHaveLength(LEVELS.length);
  });

  it('resolves by slug', () => {
    expect(locationBySlug('chicago-il')?.name).toBe('Chicago');
    expect(locationBySlug('nowhere')).toBeNull();
  });
});

describe('generated location page', () => {
  const chicago = locationBySlug('chicago-il');
  const html = page(chicago);

  it('states the place before any script runs', () => {
    expect(html).toContain('<h1 class="map-intro__title">Wildfire smoke in Chicago, IL</h1>');
    expect(html).toContain('window.__SMOKESHOW_PLACE__');
    expect(html).toContain('"lat":41.8781');
  });

  it('self-canonicalises to its own trailing-slash URL', () => {
    expect(html).toContain(
      '<link rel="canonical" href="https://smokeshow.earth/smoke-forecast/chicago-il/" />',
    );
  });

  // The FAQ copy and the FAQPage JSON-LD are generated from one array, so this
  // asserts the property that arrangement is meant to buy: every visible
  // question also appears in the structured data, and vice versa.
  it('keeps FAQ copy and FAQ structured data in lockstep', () => {
    const ld = jsonLdBlocks(html).find((b) => b['@type'] === 'FAQPage');
    expect(ld.mainEntity).toHaveLength(chicago.questions.length);
    for (const { q, a } of chicago.questions) {
      expect(html).toContain(`<h3>${q}</h3>`);
      expect(ld.mainEntity.some((e) => e.name === q && e.acceptedAnswer.text === a)).toBe(true);
    }
  });

  it('publishes coordinates as structured data', () => {
    const ld = jsonLdBlocks(html).find((b) => b['@type'] === 'WebPage');
    expect(ld.about['@type']).toBe('Place');
    expect(ld.about.geo.latitude).toBe(chicago.lat);
    expect(ld.about.geo.longitude).toBe(chicago.lon);
  });

  // Hard rule from the brief: past hours are "model estimate", never
  // "observed", and nothing on the page may read as a measurement.
  it('never calls the forecast a measurement', () => {
    expect(html).toMatch(/model estimate/);
    expect(html).not.toMatch(/\bobserved\b/i);
    expect(html).not.toMatch(/\bmeasured (?:air|smoke|pm)/i);
  });

  // The disclaimer ships verbatim per the brief. A per-city paraphrase would be
  // a health claim we did not clear.
  it('ships the disclaimer verbatim', () => {
    expect(html).toContain(
      '<strong>Smokeshow is for informational and educational purposes only.</strong>',
    );
    expect(html).toContain('talk to a medical\n            professional about your own situation.');
  });

  // A static file cannot know today's air. If one of these ever appears here,
  // the page is asserting a condition it has no way to check.
  it('asserts no current condition', () => {
    expect(html).not.toMatch(/\b(today's air is|currently|right now the)\b/i);
    expect(html).not.toMatch(/AQI \d/);
  });

  it('carries the analytics tags the root page carries', () => {
    expect(html).toContain('analytics.ahrefs.com/analytics.js');
    expect(html).toContain('googletagmanager.com/gtag/js?id=G-XTJYZ1SJCE');
  });

  // A place name is data, not markup. It reaches three sinks with three
  // different escaping rules -- HTML text, an HTML attribute, and two JSON
  // <script> bodies -- and the JSON ones are the easy miss, since
  // JSON.stringify leaves '<' alone and the HTML parser does not decode
  // entities inside a script element.
  it('escapes a hostile place name in every sink', () => {
    const nasty = page({
      ...chicago,
      name: '</script><img src=x onerror=alert(1)>',
      label: '</script><img src=x onerror=alert(1)>, XX',
    });
    expect(nasty).not.toContain('<img src=x');
    expect(nasty).not.toContain('</script><img');
    expect(nasty).toContain('&lt;img src=x');
    // Still valid JSON in both ld+json blocks, and the payload survives intact.
    const blocks = jsonLdBlocks(nasty);
    expect(blocks).toHaveLength(2);
    expect(blocks.find((b) => b['@type'] === 'WebPage').about.name).toContain('<img src=x');
  });
});

describe('sitemap', () => {
  it('lists the root and every location', () => {
    const xml = sitemap(LOCATIONS);
    expect(xml).toContain('<loc>https://smokeshow.earth/</loc>');
    for (const l of LOCATIONS) {
      expect(xml).toContain(`<loc>https://smokeshow.earth/smoke-forecast/${l.slug}/</loc>`);
    }
  });
});
