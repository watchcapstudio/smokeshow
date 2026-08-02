import { useState } from 'react';
import { renderShareCard } from '../lib/shareCard.js';
import './ShareButton.css';

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
        Share this air
      </button>
      <button type="button" className="share-row__copy" onClick={copyLink}>
        {copied ? 'Link copied ✓' : 'Copy link'}
      </button>
    </div>
  );
}
