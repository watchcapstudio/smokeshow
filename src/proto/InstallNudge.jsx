// The Home Screen ask.
//
// The live component's copy and its two pitches are carried over unchanged —
// they were already right, and the bad-air variant is the one that earns the
// install. What changed is when it fires (see installPolicy.js) and where it
// sits: a bar at the foot rather than a card floating over the verdict, so it
// never covers the answer the reader came for.
//
// It can always be dismissed, and dismissing buys fourteen days of silence.

import { useEffect, useState } from 'react';
import { eligibility, markDismissed, SHOW_DELAY_MS } from './installPolicy.js';

function ShareGlyph() {
  return (
    <svg className="proto-nudge__glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3 L12 14 M12 3 L8.5 6.5 M12 3 L15.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 10 H5.5 V20.5 H18.5 V10 H17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Bad-air visits get the live-verdict pitch; everyone else gets the
// save-the-tap pitch. levelIndex >= 2 is "Hazy" or worse.
function pitch(levelIndex, headline) {
  if (levelIndex >= 2 && headline) {
    return `${headline}. Keep watch — put SMOKESHOW one tap away.`;
  }
  return 'Coming back to check the smoke? Save the tap. Put SMOKESHOW on your Home Screen.';
}

export default function InstallNudge({ levelIndex, headline, force }) {
  const [mode, setMode] = useState(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (gone) return undefined;
    if (force) {
      setMode({ kind: /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : 'desktop' });
      return undefined;
    }
    const found = eligibility();
    if (!found) {
      setMode(null);
      return undefined;
    }
    const t = setTimeout(() => setMode(found), SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, [force, gone]);

  if (!mode) return null;

  function dismiss() {
    markDismissed();
    setGone(true);
    setMode(null);
  }

  return (
    <div className="proto-nudge" role="dialog" aria-label="Add SMOKESHOW to your Home Screen">
      <div className="proto-nudge__body">
        <p className="proto-nudge__pitch">{pitch(levelIndex, headline)}</p>
        {mode.kind === 'ios' ? (
          <p className="proto-nudge__how">
            Tap <ShareGlyph /> below, then <strong>“Add to Home Screen”</strong>
          </p>
        ) : (
          <button type="button" className="proto-nudge__install" onClick={dismiss}>
            Add SMOKESHOW
          </button>
        )}
      </div>
      <button type="button" className="proto-nudge__close" onClick={dismiss} aria-label="Not now">
        ×
      </button>
    </div>
  );
}
