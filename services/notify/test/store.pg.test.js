import { describe, expect, it, vi } from 'vitest';
import { createPgStore } from '../src/store.pg.js';

describe('Postgres store schema isolation', () => {
  it('fully qualifies tables for transaction-pooled connections', async () => {
    const query = vi.fn(async () => ({
      rows: [{ devices: '0', cells: '0', entitlements: '0' }],
      rowCount: 0,
    }));
    const store = createPgStore({ query }, { schema: 'smokeshow_notify' });

    await expect(store.stats()).resolves.toEqual({ devices: 0, cells: 0, entitlements: 0 });
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('"smokeshow_notify"."devices"');
    expect(sql).toContain('"smokeshow_notify"."device_locations"');
    expect(sql).toContain('"smokeshow_notify"."entitlements"');
  });

  it('rejects an unsafe schema identifier', () => {
    expect(() => createPgStore({ query: vi.fn() }, { schema: 'public; drop schema public' })).toThrow(
      'valid unquoted identifier',
    );
  });
});
