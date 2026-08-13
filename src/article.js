// Entry for the /guides/ articles and their hub. Stylesheets only — no React,
// no App. Like the editorial pages, an article has no coordinates, so booting
// App.jsx would land in requestLocation() and fire a geolocation prompt at a
// reader who came to read. The hard rule is that a page with no location never
// prompts.
//
// Same import order as the editorial pages: tokens, then sky re-pointing the
// palette at the ink, then the shell primitives, then the article surfaces.
// Without SkyBackdrop running these pages paint the registered @property
// initial values — a clear midday sky — which is the correct resting state for
// reference material, and what the masthead's own gradient is drawn to match.
import './styles/tokens.css';
import './styles/sky.css';
import './styles/shell.css';
import './styles/article.css';
