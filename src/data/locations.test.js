import { describe, expect, it } from 'vitest';
import { LOCATIONS, locationBySlug } from './locations.js';
import { CORRIDORS, corridorBySlug } from './corridors.js';
import { LEVELS } from '../lib/rating.js';
import { _internal } from '../../scripts/gen-location-pages.mjs';

const { page, hubPage, corridorPage, sitemap, CORRIDOR_SEGMENT, FOOTER_LINKS } = _internal;

// Every string a reader can see on a city page. Used by the copy rules below,
// which have to hold across all of it and not just the parts a spot-check reads.
function allCopy(loc) {
  return [
    loc.name,
    loc.label,
    ...loc.landmarks,
    loc.source,
    loc.memory,
    loc.notSmoke ?? '',
    loc.valley?.heading ?? '',
    loc.valley?.body ?? '',
    ...(loc.bands ?? []),
    ...loc.questions.flatMap(({ q, a }) => [q, a]),
    ...(loc.upwind ?? []).map((u) => u.note),
  ];
}

// Canada is metric, per the spec: bands, landmarks, and any distance in an FAQ
// answer. Region codes for the provinces we cover.
const CANADIAN_REGIONS = new Set(['ON', 'MB']);

// Every slug the site knows about, whether or not a page exists for it yet.
// Cities land in waves, so a reference to one that is planned but unbuilt is a
// legitimate intermediate state and gets skipped at render time. A reference to
// a slug that is in NO corridor's city list is a typo, and that is the thing
// worth failing on — this set is what separates the two.
const KNOWN_SLUGS = new Set([...LOCATIONS.map((l) => l.slug), ...CORRIDORS.flatMap((c) => c.cities)]);
const isBuilt = (slug) => locationBySlug(slug) !== null;

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

  // Bands are optional (omit to inherit LEVELS), but a partial set would zip
  // against the level list and silently mislabel the levels it did not cover.
  it('carries a full band set or none at all', () => {
    for (const l of LOCATIONS) {
      if (l.bands) expect(l.bands, l.slug).toHaveLength(LEVELS.length);
    }
  });

  it('assigns every city to a corridor that exists', () => {
    for (const l of LOCATIONS) expect(corridorBySlug(l.corridor), l.slug).not.toBeNull();
  });

  // A corridor lists its cities and a city names its corridor. Neither is
  // derived from the other, so they can disagree — this is the check that they
  // do not, in both directions.
  it('agrees with the corridors about which cities they hold', () => {
    // Forward: a corridor may list a city that is not built yet, but if it is
    // built it must agree about which corridor it is on.
    for (const c of CORRIDORS) {
      for (const slug of c.cities.filter(isBuilt)) {
        expect(locationBySlug(slug).corridor, slug).toBe(c.slug);
      }
    }
    // Reverse: strict. A built city that its own corridor does not list would
    // never appear on the corridor page or the hub.
    for (const l of LOCATIONS) {
      expect(corridorBySlug(l.corridor).cities, l.slug).toContain(l.slug);
    }
  });

  it('lists no unknown slug on a corridor', () => {
    const slugPattern = /^[a-z0-9-]+$/;
    for (const c of CORRIDORS) {
      expect(new Set(c.cities).size, c.slug).toBe(c.cities.length);
      for (const slug of c.cities) expect(slug, c.slug).toMatch(slugPattern);
    }
  });

  // The URL space is shared: /smoke-forecast/<city>/ and
  // /smoke-forecast/corridor/<corridor>/. A city slugged "corridor" would sit on
  // top of the whole corridor tree.
  it('keeps city slugs clear of the corridor segment', () => {
    for (const l of LOCATIONS) expect(l.slug).not.toBe(CORRIDOR_SEGMENT);
  });

  // Every internal reference has to name a city that exists. A dangling slug is
  // skipped at render time rather than shipped as a 404 (see linkBlock), which
  // makes it invisible in the HTML — so it has to be caught here instead.
  it('points its upwind and nearby references at slugs the site knows', () => {
    for (const l of LOCATIONS) {
      for (const { slug, note } of l.upwind ?? []) {
        expect(KNOWN_SLUGS, `${l.slug} upwind ${slug}`).toContain(slug);
        expect(slug, `${l.slug} upwind`).not.toBe(l.slug);
        expect(note?.length, `${l.slug} upwind ${slug} note`).toBeGreaterThan(20);
      }
      for (const slug of l.nearby ?? []) {
        expect(KNOWN_SLUGS, `${l.slug} nearby ${slug}`).toContain(slug);
        expect(slug, `${l.slug} nearby`).not.toBe(l.slug);
      }
    }
  });

  // HARD COPY RULE. The level thresholds are rounder than the EPA breakpoints and
  // the chip the app paints comes from ugm3ToAqi(), a third scale — so any
  // sentence naming an AQI value will eventually contradict the chip above it.
  // Level names only, everywhere, including the FAQ and the upwind notes.
  it('never cites an AQI or concentration number in copy', () => {
    for (const l of LOCATIONS) {
      for (const s of allCopy(l)) {
        expect(s, `${l.slug}: ${s}`).not.toMatch(/\bAQI\b/i);
        expect(s, `${l.slug}: ${s}`).not.toMatch(/µg|ug\/m|micrograms/i);
        expect(s, `${l.slug}: ${s}`).not.toMatch(/\bPM ?2\.?5\b/i);
      }
    }
  });

  // Canada is metric throughout, and the failure mode is a mile leaking into a
  // km page from a copied US answer. US pages are left alone.
  it('keeps the Canadian pages in kilometres', () => {
    for (const l of LOCATIONS.filter((c) => CANADIAN_REGIONS.has(c.region))) {
      for (const s of allCopy(l)) {
        expect(s, `${l.slug}: ${s}`).not.toMatch(/\bmiles?\b/i);
      }
    }
  });

  // The failure mode that turns 25 pages into one page duplicated 25 times.
  // Normalising the city's own names out of its answers is what makes this a
  // real test rather than a string-inequality no-op: two answers that differ
  // ONLY by the city name collapse to the same string here and fail.
  it('answers every question differently from every other city', () => {
    const seen = new Map();
    for (const l of LOCATIONS) {
      for (const [i, { a }] of l.questions.entries()) {
        const normalised = a
          .replaceAll(l.label, 'CITY')
          .replaceAll(l.name, 'CITY')
          .replaceAll(l.region, 'ST');
        const key = `${i}::${normalised}`;
        expect(seen.has(key), `${l.slug} Q${i} reads identically to ${seen.get(key)} Q${i}`).toBe(
          false,
        );
        seen.set(key, l.slug);
      }
    }
  });

  // Air-quality phrasing runs 5-20x "smoke in {city}" in search volume, so it is
  // a structural element of the FAQ rather than something to leave to whoever
  // writes the next city.
  it('asks an air-quality-phrased question on every page', () => {
    for (const l of LOCATIONS) {
      expect(
        l.questions.some((q) => /air quality/i.test(q.q)),
        l.slug,
      ).toBe(true);
    }
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

describe('per-city landmark bands', () => {
  // The point of the whole exercise: same level names, different visible
  // manifestation. Missoula's All clear is Lolo Peak at fifteen miles; Chicago's
  // inherits the universal ten. If bands ever stop overriding, every mountain
  // page silently reverts to Chicago's ladder.
  it('renders the city band, not the universal one, when the city has bands', () => {
    const missoula = locationBySlug('missoula-mt');
    const html = page(missoula);
    expect(html).toContain('<span class="landmarks__vis">15+ miles</span>');
    expect(html).not.toContain('<span class="landmarks__vis">10+ miles</span>');
  });

  it('falls back to the universal band when the city has none', () => {
    const chicago = locationBySlug('chicago-il');
    expect(chicago.bands).toBeUndefined();
    expect(page(chicago)).toContain(
      `<span class="landmarks__vis">${LEVELS[0].visibility}</span>`,
    );
  });

  it('pairs every band with its level name in order', () => {
    for (const l of LOCATIONS) {
      const html = page(l);
      for (const [i, level] of LEVELS.entries()) {
        const band = l.bands?.[i] ?? level.visibility;
        expect(html, `${l.slug} level ${i}`).toContain(
          `<span class="landmarks__level">${level.name}</span>\n` +
            `              <span class="landmarks__vis">${band}</span>`,
        );
      }
    }
  });
});

describe('internal links', () => {
  // Pointed at a city that is definitely built, so the assertion is about the
  // markup rather than about how far the rollout has got.
  it('anchors an upwind city as "wildfire smoke in {City}" and says why', () => {
    const note = 'Ontario smoke crosses it about a day before it reaches here.';
    const html = page({
      ...locationBySlug('missoula-mt'),
      upwind: [{ slug: 'chicago-il', note }],
      nearby: [],
    });
    expect(html).toContain('href="/smoke-forecast/chicago-il/"');
    expect(html).toContain('>Wildfire smoke in Chicago</a');
    expect(html).toContain(note);
    expect(html).toContain('<span class="citylinks__tag">Upwind</span>');
  });

  it('tags a nearby city without claiming it is upwind', () => {
    const html = page({
      ...locationBySlug('missoula-mt'),
      upwind: [],
      nearby: ['chicago-il'],
    });
    expect(html).toContain('href="/smoke-forecast/chicago-il/"');
    expect(html).toContain('<span class="citylinks__tag">Nearby</span>');
    expect(html).not.toContain('<span class="citylinks__tag">Upwind</span>');
  });

  // A city that is both upwind and nearby (Spokane is both, for Missoula) has to
  // resolve to one row, and it has to be the upwind one — that is the row that
  // carries the reason.
  it('prefers the upwind row when a city is both upwind and nearby', () => {
    const html = page({
      ...locationBySlug('missoula-mt'),
      upwind: [{ slug: 'chicago-il', note: 'Upwind on the flow that matters here.' }],
      nearby: ['chicago-il'],
    });
    expect(html.split('href="/smoke-forecast/chicago-il/"').length - 1).toBe(1);
    expect(html).toContain('<span class="citylinks__tag">Upwind</span>');
    expect(html).not.toContain('<span class="citylinks__tag">Nearby</span>');
  });

  it('links its corridor page', () => {
    const html = page(locationBySlug('missoula-mt'));
    expect(html).toContain(
      'href="/smoke-forecast/corridor/wildfire-smoke-pacific-northwest-northern-rockies/"',
    );
  });

  // Cities land in waves. Until a slug is built, a link to it would be a 404 in
  // the sitemap's own neighbourhood, which is worse than a shorter link block.
  it('omits a reference to a city that has not been built', () => {
    const html = page({
      ...locationBySlug('missoula-mt'),
      upwind: [{ slug: 'nowhere-zz', note: 'A city that does not exist yet.' }],
      nearby: ['also-nowhere-zz'],
    });
    expect(html).not.toContain('nowhere-zz');
    // The corridor and explainer links still carry, so the block is never empty.
    expect(html).toContain('<span class="citylinks__tag">Corridor</span>');
  });

  it('never lists the same city twice in one block', () => {
    for (const l of LOCATIONS) {
      const html = page(l);
      for (const dest of LOCATIONS) {
        const hits = html.split(`href="/smoke-forecast/${dest.slug}/"`).length - 1;
        expect(hits, `${l.slug} -> ${dest.slug}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never links a city to itself', () => {
    for (const l of LOCATIONS) {
      expect(page(l), l.slug).not.toContain(`href="/smoke-forecast/${l.slug}/"`);
    }
  });

  // Sitewide footer, five links maximum. A footer carrying every city would
  // flatten the one signal these pages have.
  it('ships the same short footer on every page', () => {
    expect(FOOTER_LINKS.length).toBeLessThanOrEqual(5);
    const pages = [
      ...LOCATIONS.map((l) => page(l)),
      hubPage(),
      ...CORRIDORS.map((c) => corridorPage(c)),
    ];
    for (const html of pages) {
      expect(html).toContain('class="site-footer"');
      for (const { href } of FOOTER_LINKS) expect(html).toContain(`href="${href}"`);
    }
  });
});

describe('editorial pages', () => {
  // A hub has no coordinates. Booting App.jsx there lands in requestLocation()
  // and prompts a reader who asked for a list of cities.
  it('never boots the app or claims a place', () => {
    for (const html of [hubPage(), ...CORRIDORS.map((c) => corridorPage(c))]) {
      expect(html).not.toContain('__SMOKESHOW_PLACE__');
      expect(html).not.toContain('/src/main.jsx');
      expect(html).toContain('/src/editorial.js');
    }
  });

  it('groups the hub by corridor and links every built city once', () => {
    const html = hubPage();
    expect(html).toContain('<h1 class="map-intro__title">Wildfire smoke forecasts by city</h1>');
    // A corridor with no built cities yet renders no group, which is correct:
    // a heading over an empty list is a thin page.
    for (const c of CORRIDORS.filter((x) => x.cities.some(isBuilt))) {
      expect(html, c.slug).toContain(`href="/smoke-forecast/corridor/${c.slug}/"`);
    }
    for (const l of LOCATIONS) {
      const hits = html.split(`href="/smoke-forecast/${l.slug}/"`).length - 1;
      expect(hits, l.slug).toBe(1);
    }
  });

  it('holds its own cities on each corridor page', () => {
    for (const c of CORRIDORS) {
      const html = corridorPage(c);
      expect(html).toContain(`<h1 class="map-intro__title">${c.name}</h1>`);
      for (const slug of c.cities) {
        if (!locationBySlug(slug)) continue;
        expect(html, `${c.slug} -> ${slug}`).toContain(`href="/smoke-forecast/${slug}/"`);
      }
      for (const other of LOCATIONS.filter((l) => l.corridor !== c.slug)) {
        expect(html, `${c.slug} leaks ${other.slug}`).not.toContain(
          `href="/smoke-forecast/${other.slug}/"`,
        );
      }
    }
  });

  // Same rules as the city pages: no condition, no AQI, forecast never a
  // measurement, disclaimer verbatim.
  it('holds to the sitewide copy rules', () => {
    for (const html of [hubPage(), ...CORRIDORS.map((c) => corridorPage(c))]) {
      expect(html).toContain(
        '<strong>Smokeshow is for informational and educational purposes only.</strong>',
      );
      expect(html).toMatch(/model estimate/);
      expect(html).not.toMatch(/\bobserved\b/i);
      // Word-bounded: the Ahrefs analytics key in <head> happens to contain the
      // letters "aqi", and an unbounded match fails on every page for no reason.
      expect(html).not.toMatch(/\bAQI\b/i);
    }
  });

  it('self-canonicalises', () => {
    expect(hubPage()).toContain(
      '<link rel="canonical" href="https://smokeshow.earth/smoke-forecast/" />',
    );
    for (const c of CORRIDORS) {
      expect(corridorPage(c)).toContain(
        `<link rel="canonical" href="https://smokeshow.earth/smoke-forecast/corridor/${c.slug}/" />`,
      );
    }
  });
});

describe('sitemap', () => {
  it('lists the root, the hub, every corridor and every location', () => {
    const xml = sitemap(LOCATIONS);
    expect(xml).toContain('<loc>https://smokeshow.earth/</loc>');
    expect(xml).toContain('<loc>https://smokeshow.earth/smoke-forecast/</loc>');
    for (const c of CORRIDORS) {
      expect(xml).toContain(
        `<loc>https://smokeshow.earth/smoke-forecast/corridor/${c.slug}/</loc>`,
      );
    }
    for (const l of LOCATIONS) {
      expect(xml).toContain(`<loc>https://smokeshow.earth/smoke-forecast/${l.slug}/</loc>`);
    }
  });
});
