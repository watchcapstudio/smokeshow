import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('notification configuration', () => {
  it('delivers to every registered device by default, because alerts are free', () => {
    expect(loadConfig({}).requireEntitlement).toBe(false);
  });

  it('can still gate delivery on a RevenueCat entitlement when told to', () => {
    expect(loadConfig({ NOTIFY_REQUIRE_ENTITLEMENT: 'true' }).requireEntitlement).toBe(true);
  });
});
