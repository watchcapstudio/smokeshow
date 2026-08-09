// Entry for the /asdfasdf/ review page. Two roots, matching production's own
// split: the live window mounts in #root, and the footer mounts into a slot
// underneath the static reference material — the same reason App.jsx portals
// the map and the CTA rather than rendering the FAQ from React. Crawlers see
// the questions in the initial payload either way.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Proto from './Proto.jsx';
import Footer from './Footer.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Proto />
  </StrictMode>,
);

const footerSlot = document.getElementById('footer-slot');
if (footerSlot) {
  createRoot(footerSlot).render(
    <StrictMode>
      <Footer />
    </StrictMode>,
  );
}
