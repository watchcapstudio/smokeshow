// A one-line wrapper over the gtag tag already in index.html. Analytics is
// loaded async and blocked outright by plenty of readers, so every call site
// has to survive gtag being absent — hence the guard here instead of at each
// caller.
export function track(event, params) {
  try {
    window.gtag?.('event', event, params || {});
  } catch {
    /* analytics must never break a tap */
  }
}

/**
 * An App Store tap. `placement` is the surface that earned it and matches the
 * `ct` campaign token on the link, so GA4 and App Store Connect can be read
 * side by side.
 */
export function trackStoreClick(placement) {
  track('app_store_click', { placement });
}
