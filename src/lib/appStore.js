// The one place the App Store listing is described. Every badge, link, smart
// banner and price sentence on the site reads from here, so the listing and
// the site cannot drift the way the placeholder URL in AppWidgetCTA.jsx did
// (it pointed at /app/smokeshow, which is not the listing).
export const APP_STORE_ID = '6799511809';
export const APP_STORE_SLUG = 'smokeshow-wildfire-forecast';
export const APP_STORE_BASE = `https://apps.apple.com/us/app/${APP_STORE_SLUG}/id${APP_STORE_ID}`;

// Price and trial, mirrored from Configuration/Smokeshow.storekit. If the
// subscription is repriced, that file and this constant move together.
export const PRICE_LABEL = '$2.99/month';
export const TRIAL_LABEL = '14-day free trial';

// Which devices the listing actually serves. Named explicitly rather than
// written into prose, because "coming soon to iOS, macOS & Android" outlived
// the launch by shipping in the page after the app was live.
export const PLATFORMS = 'iPhone and iPad';

// Apple's App Analytics campaign tokens. `ct` is ours to choose and shows up
// as the campaign name; `pt` is the provider token from App Store Connect
// (App Analytics -> Campaigns). Until PROVIDER_TOKEN is filled in, Apple
// reports these clicks as generic web referrals, so the GA4 event below is
// the only attribution we have. Both halves are wanted: GA4 tells us which
// placement was clicked, Apple tells us which click became a download.
export const PROVIDER_TOKEN = '';

/**
 * Store link for one placement. `campaign` names where the tap came from
 * ('forecast-cta', 'city-page', 'install-nudge') so downloads can be traced
 * back to the surface that earned them.
 */
export function appStoreUrl(campaign) {
  const params = new URLSearchParams();
  if (PROVIDER_TOKEN) params.set('pt', PROVIDER_TOKEN);
  if (campaign) params.set('ct', campaign);
  const q = params.toString();
  return q ? `${APP_STORE_BASE}?${q}` : APP_STORE_BASE;
}
