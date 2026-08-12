import { useEffect, useState } from 'react';
import { installNudgeEligibility, markDismissed } from '../lib/installNudge.js';
import './InstallNudge.css';

const SHOW_DELAY_MS = 6000;

function ShareGlyph() {
  return (
    <svg className="install-nudge__glyph" viewBox="0 0 24 24" aria-hidden="true">
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
    return `${headline}. Keep watch, put SMOKESHOW one tap away.`;
  }
  return 'Coming back to check the smoke? Save the tap. Put SMOKESHOW on your Home Screen.';
}

export default function InstallNudge({ levelIndex, headline }) {
  const [mode, setMode] = useState(null); // null | {kind:'ios'|'android', promptEvent}

  useEffect(() => {
    let timer = null;
    const arm = () => {
      if (timer) return;
      const eligibility = installNudgeEligibility();
      if (!eligibility) return;
      timer = setTimeout(() => setMode(eligibility), SHOW_DELAY_MS);
    };
    arm(); // iOS path (or Android when the prompt event beat us to mount)
    window.addEventListener('smokeshow:install-ready', arm); // Android, event after mount
    return () => {
      clearTimeout(timer);
      window.removeEventListener('smokeshow:install-ready', arm);
    };
  }, []);

  if (!mode) return null;

  function dismiss() {
    markDismissed();
    setMode(null);
  }

  async function installAndroid() {
    try {
      await mode.promptEvent.prompt(); // surfaces NotAllowedError into the catch
      const choice = await mode.promptEvent.userChoice;
      if (choice?.outcome === 'accepted') setMode(null);
      else dismiss();
    } catch {
      dismiss();
    }
  }

  return (
    <div className="install-nudge" role="dialog" aria-label="Add SMOKESHOW to your Home Screen">
      <button type="button" className="install-nudge__close" onClick={dismiss} aria-label="Not now">
        ×
      </button>
      <p className="install-nudge__pitch">{pitch(levelIndex, headline)}</p>
      {mode.kind === 'ios' ? (
        <>
          <p className="install-nudge__how">
            Tap <ShareGlyph /> below, then <strong>“Add to Home Screen”</strong>
          </p>
          <div className="install-nudge__arrow" aria-hidden="true">
            ↓
          </div>
        </>
      ) : (
        <button type="button" className="install-nudge__install" onClick={installAndroid}>
          Add SMOKESHOW
        </button>
      )}
    </div>
  );
}
