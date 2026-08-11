import { describe, expect, it } from 'vitest';
import { LOCATIONS, locationBySlug } from './locations.js';
import { CORRIDORS, corridorBySlug } from './corridors.js';
import { SOURCES } from './sources.js';
import { LEVELS } from '../lib/rating.js';
import { _internal } from '../../scripts/gen-location-pages.mjs';

const {
  page,
  hubPage,
  corridorPage,
  aboutPage,
  explainerPage,
  sitemap,
  CORRIDOR_SEGMENT,
  FOOTER_LINKS,
} = _internal;

// Every page the generator writes. Used by the rules that have to hold across
// all of them rather than on a spot-checked one.
const allPages = () => [
  ...LOCATIONS.map((l) => page(l)),
  hubPage(),
  aboutPage(),
  explainerPage(),
  ...CORRIDORS.map((c) => corridorPage(c)),
];

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
    for (const c of CORRIDORS) {
      for (const slug of c.cities) {
        expect(locationBySlug(slug), `${c.slug} lists ${slug}`).not.toBeNull();
        expect(locationBySlug(slug).corridor, slug).toBe(c.slug);
      }
    }
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
  // Now that every city is built, every reference must resolve to a real page.
  // linkBlock() still skips an unresolvable slug rather than emitting a 404 —
  // that is deliberate and covered separately — which is exactly why the data has
  // to be checked here: a broken reference would go silent, not loud.
  it('points every reference at a built city', () => {
    for (const l of LOCATIONS) {
      for (const key of ['upwind', 'downwind']) {
        for (const { slug, note } of l[key] ?? []) {
          expect(isBuilt(slug), `${l.slug} ${key} ${slug}`).toBe(true);
          expect(slug, `${l.slug} ${key}`).not.toBe(l.slug);
          expect(note?.length, `${l.slug} ${key} ${slug} note`).toBeGreaterThan(20);
        }
      }
      for (const slug of l.nearby ?? []) {
        expect(isBuilt(slug), `${l.slug} nearby ${slug}`).toBe(true);
        expect(slug, `${l.slug} nearby`).not.toBe(l.slug);
      }
    }
  });

  // Every city needs a flow link — the thing a scraper cannot fake. Source-end
  // cities have nothing upwind of them with a page, so they carry the inverse:
  // who gets this next. What no city may have is neither.
  it('gives every city a flow link, upwind or downwind', () => {
    for (const l of LOCATIONS) {
      const flow = (l.upwind ?? []).length + (l.downwind ?? []).length;
      expect(flow, `${l.slug} has no upwind and no downwind`).toBeGreaterThan(0);
    }
  });

  // Destination count per city, measured off the rendered HTML rather than the
  // data, so it counts what a reader can actually click. The spec asks for 5-8.
  // The floor here is 4 because one city genuinely lands there on the source data
  // and padding it with an unearned link would break the more important half of
  // that rule ("all contextually earned"). FRESNO is that city, flagged for
  // review rather than quietly accepted — if a second one ever drops below five,
  // this assertion is where it has to be argued.
  // The lead sentence describes the direction of the rows beneath it. On a
  // source-end city those rows are Downwind, and the upwind wording ("shows up
  // first") is not merely awkward there — it says the opposite of what the links
  // mean.
  it('captions the block in the direction its rows actually run', () => {
    for (const l of LOCATIONS) {
      const html = page(l);
      if ((l.upwind ?? []).length) {
        expect(html, l.slug).toContain(`Where ${l.name}'s smoke usually shows up first`);
        expect(html, l.slug).not.toContain('<span class="citylinks__tag">Downwind</span>');
      } else {
        expect(html, l.slug).toContain(`Where ${l.name}'s smoke goes after it leaves`);
        expect(html, l.slug).toContain('<span class="citylinks__tag">Downwind</span>');
        expect(html, l.slug).not.toContain('<span class="citylinks__tag">Upwind</span>');
      }
    }
  });

  it('links four to eight destinations per city, and only Fresno is under five', () => {
    const thin = [];
    for (const l of LOCATIONS) {
      const html = page(l);
      const block = html.slice(html.indexOf(`<h2>Smoke near ${l.name}</h2>`));
      const total = block.split('class="citylinks__link"').length - 1;
      expect(total, `${l.slug} has ${total}`).toBeGreaterThanOrEqual(4);
      expect(total, `${l.slug} has ${total}`).toBeLessThanOrEqual(8);
      if (total < 5) thin.push(l.slug);
    }
    expect(thin).toEqual(['fresno-ca']);
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
    // Still valid JSON in every ld+json block, and the payload survives intact.
    // The count is asserted rather than inferred: adding a block that also
    // interpolates the place name is exactly the change that needs to come back
    // through this test, which is how the BreadcrumbList below got here.
    const blocks = jsonLdBlocks(nasty);
    expect(blocks).toHaveLength(3);
    expect(blocks.find((b) => b['@type'] === 'WebPage').about.name).toContain('<img src=x');
    // The breadcrumb is a third sink for the label. Same rule: escaped in the
    // markup, intact after JSON.parse.
    const crumb = blocks.find((b) => b['@type'] === 'BreadcrumbList');
    expect(crumb.itemListElement.at(-1).name).toContain('<img src=x');
  });
});

describe('section order', () => {
  // Order has moved once and the reasoning is in the template. Locking it here
  // means a future edit that reshuffles the sheet has to argue with a test
  // rather than land quietly across every city page at once.
  it('runs landmarks, provenance, FAQ, links, disclaimer', () => {
    for (const l of LOCATIONS) {
      const html = page(l);
      const at = (needle) => {
        const i = html.indexOf(needle);
        expect(i, `${l.slug} missing ${needle}`).toBeGreaterThan(-1);
        return i;
      };
      const landmarks = at(`<h2>What each level looks like from ${l.name}</h2>`);
      const provenance = at(`<h2>Where ${l.name}'s smoke comes from</h2>`);
      const faq = at(`<h2>Smoke in ${l.name}? Common questions.</h2>`);
      const links = at(`<h2>Smoke near ${l.name}</h2>`);
      const disclaimer = at('class="disclaimer"');

      expect(landmarks, l.slug).toBeLessThan(provenance);
      expect(provenance, l.slug).toBeLessThan(faq);
      expect(faq, l.slug).toBeLessThan(links);
      expect(links, l.slug).toBeLessThan(disclaimer);
    }
  });

  // Both optional sections belong to the "where from" pair and sit between
  // provenance and the FAQ.
  it('places the optional sections after provenance and before the FAQ', () => {
    for (const l of LOCATIONS) {
      const html = page(l);
      const provenance = html.indexOf(`<h2>Where ${l.name}'s smoke comes from</h2>`);
      const faq = html.indexOf(`<h2>Smoke in ${l.name}? Common questions.</h2>`);
      for (const heading of [
        l.notSmoke ? `<h2>What looks like smoke in ${l.name} but isn't</h2>` : null,
        l.valley ? `<h2>${l.valley.heading}</h2>` : null,
      ].filter(Boolean)) {
        const i = html.indexOf(heading);
        expect(i, `${l.slug} missing ${heading}`).toBeGreaterThan(provenance);
        expect(i, `${l.slug} ${heading} after FAQ`).toBeLessThan(faq);
      }
    }
  });

  // Cities without the field get no section. Inventing a native haze for a city
  // that does not have one would be a fabricated claim about its air.
  it('renders no optional section for a city without the data', () => {
    for (const l of LOCATIONS.filter((c) => !c.notSmoke)) {
      expect(page(l), l.slug).not.toContain('explainer--not-smoke');
    }
    for (const l of LOCATIONS.filter((c) => !c.valley)) {
      expect(page(l), l.slug).not.toContain('explainer--valley');
    }
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

  // Every city now states its own bands, so the fallback is exercised with a
  // synthetic one. The path still matters: it is what lets a new city ship
  // without inventing distances before someone has checked the sightlines.
  it('falls back to the universal band when the city has none', () => {
    const bandless = { ...locationBySlug('chicago-il'), bands: undefined };
    expect(page(bandless)).toContain(
      `<span class="landmarks__vis">${LEVELS[0].visibility}</span>`,
    );
  });

  // One separator across the whole site. Chicago inherited LEVELS, which uses
  // en-dashes for its ranges, and was the only page rendering a different
  // character in that column.
  it('writes every band range with the same separator', () => {
    for (const l of LOCATIONS) {
      for (const band of l.bands ?? []) {
        expect(band, `${l.slug}: "${band}"`).not.toContain('\u2013');
        expect(band, `${l.slug}: "${band}"`).not.toContain('\u2014');
      }
    }
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
    // Six: the spec's five plus Terms, which was not in the spec. See the note
    // above FOOTER_LINKS. The bound is here so it stays furniture and never
    // becomes a city list.
    expect(FOOTER_LINKS.length).toBeLessThanOrEqual(6);
    for (const html of allPages()) {
      expect(html).toContain('class="site-footer"');
      for (const { href } of FOOTER_LINKS) expect(html).toContain(`href="${href}"`);
    }
  });
});

describe('structured data', () => {
  // Parsing rather than string-matching, so a bad escape throws here instead of
  // silently shipping an unparseable block.
  it('gives every page type the right schema', () => {
    const expected = [
      [page(locationBySlug('missoula-mt')), ['FAQPage', 'WebPage', 'BreadcrumbList']],
      [hubPage(), ['CollectionPage', 'BreadcrumbList']],
      [aboutPage(), ['AboutPage', 'BreadcrumbList']],
      [corridorPage(CORRIDORS[0]), ['CollectionPage', 'BreadcrumbList']],
    ];
    for (const [html, types] of expected) {
      expect(jsonLdBlocks(html).map((b) => b['@type'])).toEqual(types);
    }
  });

  // The URL space is three levels deep and nothing visible states the hierarchy,
  // so the breadcrumb is the only place it is written down. The last entry
  // deliberately carries no `item`: it is the page you are on.
  it('states the hierarchy on every page', () => {
    const trails = [
      [hubPage(), ['SMOKESHOW', 'Smoke forecasts by city']],
      [aboutPage(), ['SMOKESHOW', 'About']],
      [
        corridorPage(CORRIDORS[0]),
        ['SMOKESHOW', 'Smoke forecasts by city', CORRIDORS[0].name],
      ],
      [
        page(locationBySlug('missoula-mt')),
        ['SMOKESHOW', 'Smoke forecasts by city', 'Missoula, MT'],
      ],
    ];
    for (const [html, names] of trails) {
      const crumb = jsonLdBlocks(html).find((b) => b['@type'] === 'BreadcrumbList');
      expect(crumb.itemListElement.map((i) => i.name)).toEqual(names);
      expect(crumb.itemListElement.map((i) => i.position)).toEqual(
        names.map((_, i) => i + 1),
      );
      expect(crumb.itemListElement.at(-1).item).toBeUndefined();
      for (const i of crumb.itemListElement.slice(0, -1)) {
        expect(i.item).toMatch(/^https:\/\/smokeshow\.earth\//);
      }
    }
  });

  // hasPart makes the same claim the visible list makes. If they can disagree,
  // one of them is lying to a crawler.
  it('lists the same cities in hasPart as on the page', () => {
    for (const c of CORRIDORS) {
      const html = corridorPage(c);
      const collection = jsonLdBlocks(html).find((b) => b['@type'] === 'CollectionPage');
      const built = c.cities.filter(isBuilt);
      expect(collection.hasPart, c.slug).toHaveLength(built.length);
      for (const slug of built) {
        expect(collection.hasPart.some((p) => p.url.endsWith(`/${slug}/`)), slug).toBe(true);
      }
    }
    const hub = jsonLdBlocks(hubPage()).find((b) => b['@type'] === 'CollectionPage');
    expect(hub.hasPart).toHaveLength(LOCATIONS.length);
  });
});

describe('house style', () => {
  // No em-dashes anywhere in a generated page. House rule, and the reason it is a
  // test rather than a note is that em-dashes arrive one sentence at a time: the
  // sweep that removed 83 of them is worth nothing if the next city page adds two.
  //
  // Scoped to the emitted HTML, which includes the comments inside the templates,
  // because those ship in the payload. Comments in .js and .mjs source do not
  // ship and are not covered.
  //
  // En-dashes are a different character and are left alone: LEVELS.visibility
  // uses them for numeric ranges ("5–10 miles"), which is what they are for.
  it('uses no em-dashes in any generated page', () => {
    for (const html of allPages()) {
      const hit = html.indexOf('—');
      if (hit === -1) continue;
      const title = html.match(/<title>([^<]*)</)?.[1] ?? 'unknown page';
      throw new Error(`em-dash in "${title}": ...${html.slice(hit - 70, hit + 70)}...`);
    }
  });
});

describe('the explainer page', () => {
  // It shipped for months as an anchor in the middle of index.html, which every
  // city page and the footer pointed at. A "How smoke forecasts work" link that
  // drops a reader mid-homepage with no title is worse than no link.
  it('is a page, and nothing links at the old anchor', () => {
    const html = explainerPage();
    expect(html).toContain('<h1 class="map-intro__title">Why is smoke so hard to forecast?</h1>');
    expect(html).toContain(
      '<link rel="canonical" href="https://smokeshow.earth/how-smoke-forecasts-work/" />',
    );
    for (const p of allPages()) {
      expect(p, 'still points at the mid-homepage anchor').not.toContain(
        'href="/#how-smoke-forecasts-work"',
      );
    }
  });

  it('is linked from the footer and from every city page', () => {
    expect(FOOTER_LINKS.some((l) => l.href === '/how-smoke-forecasts-work/')).toBe(true);
    for (const l of LOCATIONS) {
      expect(page(l), l.slug).toContain('href="/how-smoke-forecasts-work/"');
    }
  });

  it('holds to the sitewide copy rules', () => {
    const html = explainerPage();
    expect(html).toContain(
      '<strong>Smokeshow is for informational and educational purposes only.</strong>',
    );
    expect(html).toMatch(/model estimate/);
    expect(html).not.toMatch(/\bobserved\b/i);
    expect(html).not.toMatch(/\bAQI\b/i);
    expect(html).not.toContain('\u2014');
  });
});

describe('editorial pages', () => {
  // A directory must not answer today's question. This column used to read
  // "All clear: 50+ miles", which put a level name beside 25 city names on a page
  // about smoke, so the list rendered as a status board claiming every city was
  // currently clear. Level names are the one thing on this site that mean "right
  // now"; a static file may never use one.
  // Asserted on the whole row rather than on one span, because the value slot has
  // been wrong twice and the second fix was to empty it. A row is now a link and
  // nothing else, so anything that reappears in that position has to come back
  // through this test.
  it('never states a condition in a city list row', () => {
    for (const html of [hubPage(), ...CORRIDORS.map((c) => corridorPage(c))]) {
      const rows = [...html.matchAll(/<li class="citylist__item">([\s\S]*?)<\/li>/g)].map(
        (m) => m[1],
      );
      expect(rows.length, 'no rows found, selector drifted').toBeGreaterThan(0);
      for (const row of rows) {
        for (const level of LEVELS) {
          expect(row, `row names the level "${level.name}"`).not.toContain(level.name);
        }
        // No distance either. "clean day: 50+ miles" read as a reading too.
        expect(row, 'row carries a distance').not.toMatch(/\d+\s*\+?\s*(miles|km|mi)\b/i);
      }
    }
  });

  // Same rule, stated positively: the directory says outright that it reports
  // nothing, so the numbers on it cannot be mistaken for a reading.
  it('says on its face that it reports no conditions', () => {
    const promise = 'This is a directory and reports conditions nowhere.';
    expect(hubPage()).toContain(promise);
    for (const c of CORRIDORS) expect(corridorPage(c), c.slug).toContain(promise);
  });

  // A hub has no coordinates. Booting App.jsx there lands in requestLocation()
  // and prompts a reader who asked for a list of cities.
  // /about/ is the only page allowed to be about us. It must still hold to every
  // rule the forecast pages do, and it must not quietly become a second copy of
  // the studio's Privacy or Terms, which live on watchcapstudio.com.
  it('serves an about page that links the studio rather than retelling it', () => {
    const html = aboutPage();
    expect(html).toContain('<h1 class="map-intro__title">Why we made Smokeshow</h1>');
    expect(html).toContain(
      '<link rel="canonical" href="https://smokeshow.earth/about/" />',
    );
    expect(html).toContain('href="https://watchcapstudio.com"');
    // The sources it names are the ones the site actually reads.
    for (const source of ['NOAA HRRR-Smoke', 'Copernicus CAMS', 'NIFC WFIGS', 'NASA FIRMS']) {
      expect(html, source).toContain(source);
    }
    // No store badges yet, so the page must not imply an app you can download.
    expect(html).not.toMatch(/App Store|Google Play|download the app/i);
  });

  // Every credit is a link, and it is the link src/data/sources.js names. A
  // named-but-unlinked source is a dead end for a reader checking our work,
  // which is the whole reason that section exists.
  it('links every data source it credits', () => {
    const html = aboutPage();
    for (const s of SOURCES) {
      expect(html, s.key).toContain(`<a href="${s.href}">${s.name}</a>`);
    }
  });

  // CAMS licence terms require this exact sentence wherever the data is shown.
  it('carries the Copernicus licence wording', () => {
    expect(aboutPage()).toContain(
      'Generated using Copernicus Atmosphere Monitoring Service information',
    );
  });

  it('never boots the app or claims a place', () => {
    for (const html of [hubPage(), aboutPage(), ...CORRIDORS.map((c) => corridorPage(c))]) {
      expect(html).not.toContain('__SMOKESHOW_PLACE__');
      expect(html).not.toContain('/src/main.jsx');
      expect(html).toContain('/src/editorial.js');
    }
  });

  it('groups the hub by corridor and links every built city once', () => {
    const html = hubPage();
    expect(html).toContain('<h1 class="map-intro__title">Wildfire smoke forecasts by city</h1>');
    for (const c of CORRIDORS) {
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
    for (const html of [hubPage(), aboutPage(), ...CORRIDORS.map((c) => corridorPage(c))]) {
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
    expect(xml).toContain('<loc>https://smokeshow.earth/about/</loc>');
    expect(xml).toContain('<loc>https://smokeshow.earth/how-smoke-forecasts-work/</loc>');
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
