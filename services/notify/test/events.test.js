import { describe, it, expect } from 'vitest';
import { cellStateFrom, diffCellState, hasAnyChange, selectEvent } from '../src/events.js';
import { DENVER, HOUR_MS, flat, mockForecast, step } from './helpers.js';

const NOW = Date.UTC(2026, 7, 2, 18, 0, 0);

const stateFor = (series, nowMs = NOW) => cellStateFrom(mockForecast({ series, nowMs }));

const pick = (transition, next, overrides = {}) =>
  selectEvent({ transition, next, cellKey: DENVER, threshold: 2, label: 'Home', ...overrides });

describe('cellStateFrom', () => {
  it('carries the server verdict and its shipped copy, not a recomputed one', () => {
    const payload = mockForecast({ series: step(4, 60), nowMs: NOW });
    const state = cellStateFrom(payload);

    expect(state.levelIndex).toBe(payload.verdict.levelIndex);
    expect(state.headline).toBe(payload.verdict.headline);
    expect(state.levelName).toBe(payload.scale[payload.verdict.levelIndex].name);
    expect(state.observedAtUTC).toBe(payload.now.timeUTC);
  });
});

describe('diffCellState', () => {
  it('returns null with no history — a first sighting is not a change', () => {
    expect(diffCellState(null, stateFor(flat(60)))).toBeNull();
    expect(hasAnyChange(null)).toBe(false);
  });

  it('reports no change when the level holds', () => {
    const transition = diffCellState(stateFor(flat(60)), stateFor(flat(58)));
    expect(transition.direction).toBe('none');
    expect(hasAnyChange(transition)).toBe(false);
  });

  it('detects an upward crossing', () => {
    const transition = diffCellState(stateFor(flat(4)), stateFor(step(4, 60)));
    expect(transition).toMatchObject({ fromLevel: 0, toLevel: 3, direction: 'up' });
  });

  it('detects a clearing', () => {
    const transition = diffCellState(stateFor(flat(60)), stateFor(step(60, 4)));
    expect(transition.cleared).toBe(true);
    expect(transition.direction).toBe('down');
  });
});

describe('selectEvent — the per-subscriber gate', () => {
  it('fires when the air crosses the subscriber threshold', () => {
    const next = stateFor(step(4, 60));
    const event = pick(diffCellState(stateFor(flat(4)), next), next);

    expect(event.type).toBe('threshold-crossed');
    expect(event.title).toBe('Tastes like fire in Home');
    expect(event.body).toBe(next.headline);
  });

  it('stays silent for a change that never reaches the subscriber threshold', () => {
    // 4 -> 20 µg/m³ is level 0 -> 1. Someone watching for "Smells like fire"
    // (level 2) hears nothing, which is the whole point of a threshold.
    const next = stateFor(step(4, 20));
    expect(pick(diffCellState(stateFor(flat(4)), next), next)).toBeNull();
  });

  it('fires for a low threshold on the same change', () => {
    const next = stateFor(step(4, 20));
    const event = pick(diffCellState(stateFor(flat(4)), next), next, { threshold: 1 });
    expect(event.type).toBe('threshold-crossed');
  });

  it('marks a Tastes-like-fire crossing urgent, and a lesser one not', () => {
    const bad = stateFor(step(4, 60));
    expect(pick(diffCellState(stateFor(flat(4)), bad), bad).urgent).toBe(true);

    const mild = stateFor(step(4, 45));
    expect(pick(diffCellState(stateFor(flat(4)), mild), mild).urgent).toBe(false);
  });

  it('makes the same lesser crossing urgent for a sensitive household', () => {
    const mild = stateFor(step(4, 45));
    const event = pick(diffCellState(stateFor(flat(4)), mild), mild, { sensitiveHousehold: true });
    expect(event.urgent).toBe(true);
  });

  it('fires once when it clears, and never marks good news urgent', () => {
    const next = stateFor(step(60, 4));
    const event = pick(diffCellState(stateFor(flat(60)), next), next);

    expect(event.type).toBe('cleared');
    expect(event.urgent).toBe(false);
  });

  it('drops the label when the location has no name', () => {
    const next = stateFor(step(4, 60));
    const event = pick(diffCellState(stateFor(flat(4)), next), next, { label: null });
    expect(event.title).toBe('Tastes like fire');
  });

  it('gives one event per run even when several changes land together', () => {
    // Crossing up and reaching the peak in the same hour: one notification.
    const prev = { ...stateFor(flat(4)), peakAtUTC: '2026-08-03T06:00:00Z' };
    const next = stateFor(step(4, 60));
    const event = pick(diffCellState(prev, next), next);

    expect(event.type).toBe('threshold-crossed');
    expect(Array.isArray(event)).toBe(false);
  });

  it('gives every event a dedupe key that is stable for the same transition', () => {
    const prev = stateFor(flat(4));
    const next = stateFor(step(4, 60));
    const a = pick(diffCellState(prev, next), next);
    const b = pick(diffCellState(prev, next), next);
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });
});

describe('the peak', () => {
  it('fires once when the forecast peak stops being ahead of us', () => {
    const next = stateFor(flat(60)); // holding steady: the peak is now
    const prev = { ...next, peakAtUTC: new Date(Date.parse(next.observedAtUTC) + 6 * HOUR_MS).toISOString() };

    const transition = diffCellState(prev, next);
    expect(transition.peakReached).toBe(true);

    const event = pick(transition, next);
    expect(event.type).toBe('peak-reached');
    expect(event.urgent).toBe(false);
    expect(event.dedupeKey).toContain(next.peakAtUTC);
  });

  it('stays silent about a peak the subscriber never asked about', () => {
    const next = stateFor(flat(60));
    const prev = { ...next, peakAtUTC: new Date(Date.parse(next.observedAtUTC) + 6 * HOUR_MS).toISOString() };
    expect(pick(diffCellState(prev, next), next, { threshold: 4 })).toBeNull();
  });
});

describe('incoming smoke', () => {
  it('fires when an arrival appears inside the horizon', () => {
    // Clean now, smoke from +12h onward: the endpoint reports an arrival.
    const series = Array.from({ length: 192 }, (_, i) => (i >= 72 + 12 ? 60 : 4));
    const next = cellStateFrom(mockForecast({ series, nowMs: NOW }));
    expect(next.arrivalAtUTC).not.toBeNull();

    const event = pick(diffCellState(stateFor(flat(4)), next), next);
    expect(event.type).toBe('incoming');
    expect(event.urgent).toBe(false);
    expect(event.body).toMatch(/^Smoke arrives/);
  });

  it('does not re-fire while the same arrival episode stands', () => {
    const series = Array.from({ length: 192 }, (_, i) => (i >= 72 + 12 ? 60 : 4));
    const first = cellStateFrom(mockForecast({ series, nowMs: NOW }));
    // An hour later the model nudges the arrival by an hour. Same episode.
    const later = cellStateFrom(mockForecast({ series, nowMs: NOW + HOUR_MS }));

    expect(pick(diffCellState(first, later), later)).toBeNull();
  });

  it('ignores an arrival beyond the horizon', () => {
    const series = Array.from({ length: 192 }, (_, i) => (i >= 72 + 60 ? 60 : 4));
    const next = cellStateFrom(mockForecast({ series, nowMs: NOW }));
    const transition = diffCellState(stateFor(flat(4)), next);
    expect(transition.incoming).toBe(false);
  });
});
