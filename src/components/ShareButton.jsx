import { useState } from 'react';
import { renderShareCard } from '../lib/shareCard.js';
import './ShareButton.css';

function ShareGlyph() {
  return (
    <svg className="share-row__glyph" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="15" cy="5" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="5" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15" cy="15" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.1 8.8 L12.9 6.2 M7.1 11.2 L12.9 13.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg className="share-row__glyph" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="7.2" width="8" height="5.6" rx="2.8" transform="rotate(-45 6.5 10)" stroke="currentColor" strokeWidth="1.6" />
      <rect x="9.5" y="7.2" width="8" height="5.6" rx="2.8" transform="rotate(-45 13.5 10)" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export default function ShareButton({ level, aqi, placeName, timeLabel, headline, days, diverged, shareUrl }) {
  const [copied, setCopied] = useState(false);

  async function buildCard() {
    return renderShareCard({
      level,
      aqi,
      placeName,
      timeLabel,
      headline,
      days,
      diverged,
      url: shareUrl.split('?')[0].replace(/\/s$/, ''),
    });
  }

  async function handleShare() {
    const blob = await buildCard();
    const file = new File([blob], 'smokeshow.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], url: shareUrl, title: 'SMOKESHOW' });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // user closed the sheet — not a fallback case
      }
    }
    // Desktop / unsupported: download the card and copy the link
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'smokeshow.png';
    a.click();
    URL.revokeObjectURL(a.href);
    await copyLink();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — the download still happened
    }
  }

  return (
    <div className="share-row">
      <button type="button" className="share-row__share" onClick={handleShare}>
        <ShareGlyph />
        Share this air
      </button>
      <button type="button" className="share-row__copy" onClick={copyLink}>
        <LinkGlyph />
        {copied ? 'Link copied ✓' : 'Copy link'}
      </button>
    </div>
  );
}
