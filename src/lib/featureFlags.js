// Gates the Google Play badge only (the iOS app is live and its badge always
// shows). A live badge pointing at a dead listing is worse than no badge at
// all. Flip via VITE_STORE_BADGES_ENABLED=true once the Play listing is live,
// and fill in the real Play URL in AppWidgetCTA.jsx alongside it.
export const STORE_BADGES_ENABLED = import.meta.env?.VITE_STORE_BADGES_ENABLED === 'true';
