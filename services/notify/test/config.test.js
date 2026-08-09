import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('notification configuration', () => {
  it('requires entitlements by default', () => {
    expect(loadConfig({}).requireEntitlement).toBe(true);
  });

  it('can explicitly open delivery before RevenueCat is connected', () => {
    expect(loadConfig({ NOTIFY_REQUIRE_ENTITLEMENT: 'false' }).requireEntitlement).toBe(false);
  });
});
