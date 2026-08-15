import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_STORE_BASE, APP_STORE_ID, PRICE_LABEL, TRIAL_LABEL, appStoreUrl } from './appStore.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('the App Store listing', () => {
  // The reason this file exists: the CTA shipped for months pointing at
  // apps.apple.com/app/smokeshow, which is not a listing. A dead store link on
  // a live app is worse than no link, because it reads as a broken product
  // rather than a missing one.
  it('links the real listing', () => {
    expect(APP_STORE_BASE).toBe(
      'https://apps.apple.com/us/app/smokeshow-wildfire-forecast/id6799511809',
    );
  });

  // Every placement names itself, so App Store Connect's campaign column and
  // GA4's app_store_click events describe the same taps.
  it('stamps each placement with its own campaign token', () => {
    const url = new URL(appStoreUrl('forecast-cta'));
    expect(url.searchParams.get('ct')).toBe('forecast-cta');
    expect(url.pathname).toContain(`id${APP_STORE_ID}`);
  });

  it('leaves the campaign token off a link that names no placement', () => {
    expect(new URL(appStoreUrl()).searchParams.has('ct')).toBe(false);
  });

  // Three copies of the app id, in three languages that share no build step:
  // the client bundle, the SPA shell, and the static-page generator. They are
  // one fact and they are allowed to be wrong together, never separately.
  it('uses one app id in the bundle, the shell, and the generator', () => {
    const banner = `<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}" />`;
    expect(read('../../index.html')).toContain(banner);
    expect(read('../../scripts/lib/page.mjs')).toContain(banner);
  });

  // The price the site quotes and the price the store charges are the same
  // number, and the store's copy is generated from Smokeshow.storekit.
  it('quotes the price and trial the StoreKit config sells', () => {
    const storekit = JSON.parse(read('../../apple/Configuration/Smokeshow.storekit'));
    const sub = storekit.subscriptionGroups[0].subscriptions[0];
    expect(PRICE_LABEL).toBe(`$${sub.displayPrice}/month`);
    expect(sub.introductoryOffer.subscriptionPeriod).toBe('P2W');
    expect(TRIAL_LABEL).toBe('14-day free trial');
  });
});
