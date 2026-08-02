// Store badges are built but off by default: the iOS/Android apps don't
// exist yet, and a live badge pointing at a dead listing is worse than no
// badge at all. Flip via VITE_STORE_BADGES_ENABLED=true once both listings
// are live, and fill in the real store URLs in AppWidgetCTA.jsx alongside it.
export const STORE_BADGES_ENABLED = import.meta.env?.VITE_STORE_BADGES_ENABLED === 'true';
