import { describe, expect, it } from 'vitest';
import { fireCard, fireRadius } from './fires.js';
import { normalize } from '../../api/fires.js';

// A locale-independent expectation for the card's dates: the assertions below
// care that a date is present and which one, not how this runtime abbreviates
// the month.
const asShown = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const FULL = {
  id: 'a',
  name: 'Kettle Ridge Fire',
  lat: 45,
  lon: -93,
  acres: 41280,
  contained: 38,
  discovered: '2026-07-24T18:00:00.000Z',
  cause: 'Lightning',
  state: 'MN',
  updated: '2026-08-01T13:00:00.000Z',
};

describe('fireCard', () => {
  it('reads name, containment, size, date and cause when the feed has them', () => {
    const card = fireCard(FULL);
    expect(card.title).toBe('Kettle Ridge Fire, MN');
    expect(card.facts).toBe('38% contained · 41,280 acres');
    expect(card.meta).toBe(`Reported ${asShown(FULL.discovered)} · Lightning`);
    expect(card.stamp).toBe(`Incident report updated ${asShown(FULL.updated)}`);
  });

  it('keeps 0% contained, which is a reported fact and not a missing one', () => {
    expect(fireCard({ ...FULL, contained: 0 }).facts).toBe('0% contained · 41,280 acres');
  });

  it('drops lines the feed does not support rather than guessing at them', () => {
    const card = fireCard({
      ...FULL,
      contained: null,
      acres: null,
      discovered: null,
      cause: null,
      updated: null,
      state: null,
    });
    expect(card.title).toBe('Kettle Ridge Fire');
    // Not "unknown", not "0%", not "—": a fact about the paperwork must never
    // be printed where a reader will take it as a fact about the fire.
    expect(card.facts).toBe('');
    expect(card.meta).toBe('');
    expect(card.stamp).toBeNull();
  });
});

describe('fireRadius', () => {
  it('stays a hittable target for a fire with no reported size', () => {
    expect(fireRadius(null)).toBe(4);
    expect(fireRadius(0)).toBe(4);
  });

  it('grows with acreage and caps, so one megafire cannot swallow the map', () => {
    expect(fireRadius(500)).toBeGreaterThan(fireRadius(50));
    expect(fireRadius(50_000)).toBeGreaterThan(fireRadius(500));
    expect(fireRadius(1_000_000)).toBe(14);
  });

  it('tracks area rather than radius — 4x the acreage is 2x the way up the scale', () => {
    const step = (a) => fireRadius(a) - 4;
    expect(step(40_000) / step(10_000)).toBeCloseTo(2, 5);
  });
});

describe('normalize (edge function)', () => {
  const feature = (attributes, geometry = { x: -93, y: 45 }) => ({ attributes, geometry });

  it('reads WFIGS field names and converts epoch dates to ISO', () => {
    const f = normalize(
      feature({
        IncidentName: 'Birch Coulee Fire',
        PercentContained: 55,
        DailyAcres: 2140,
        FireDiscoveryDateTime: Date.UTC(2026, 6, 30, 2),
        FireCause: 'Human',
        POOState: 'US-MN',
        IrwinID: 'abc',
      }),
    );
    expect(f).toMatchObject({
      id: 'abc',
      name: 'Birch Coulee Fire',
      contained: 55,
      acres: 2140,
      cause: 'Human',
      state: 'MN',
    });
    expect(f.discovered).toBe('2026-07-30T02:00:00.000Z');
  });

  it('translates the feed\'s "Natural" into the word people actually use', () => {
    expect(normalize(feature({ IncidentName: 'A', FireCause: 'Natural' })).cause).toBe('Lightning');
    expect(normalize(feature({ IncidentName: 'A', FireCause: 'Undetermined' })).cause).toBe(
      'Under investigation',
    );
    // An unrecognised cause is dropped, never reworded — guessing at a cause is
    // the one thing this layer must not do.
    expect(normalize(feature({ IncidentName: 'A', FireCause: 'Wildly Novel' })).cause).toBeNull();
  });

  it('clamps containment, because "247% contained" discredits the whole card', () => {
    expect(normalize(feature({ IncidentName: 'A', PercentContained: 247 })).contained).toBe(100);
    expect(normalize(feature({ IncidentName: 'A', PercentContained: -5 })).contained).toBe(0);
  });

  it('drops features with no name or no position — neither can fill a card', () => {
    expect(normalize(feature({ PercentContained: 10 }))).toBeNull();
    expect(normalize(feature({ IncidentName: 'A' }, {}))).toBeNull();
  });

  it('falls back through the alternate field spellings the service has used', () => {
    const f = normalize(
      feature({ attr_IncidentName: 'Little Elk Fire', attr_IncidentSize: 96 }),
    );
    expect(f.name).toBe('Little Elk Fire');
    expect(f.acres).toBe(96);
  });
});
