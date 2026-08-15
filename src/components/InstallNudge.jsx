import { useEffect, useState } from 'react';
import { installNudgeEligibility, markDismissed } from '../lib/installNudge.js';
import { appStoreUrl, TRIAL_LABEL } from '../lib/appStore.js';
import { trackStoreClick } from '../lib/track.js';
import './InstallNudge.css';

const SHOW_DELAY_MS = 6000;
const STORE_URL = appStoreUrl('install-nudge');

// Bad-air visits get the live-verdict pitch; everyone else gets the
// save-the-tap pitch. levelIndex >= 2 is "Hazy" or worse. The bad-air line
// leads with the reader's own verdict on purpose: the moment someone is
// checking smoky air for the second time is the moment a widget is worth
// something to them, and that is the only argument this sheet has room for.
function pitch(levelIndex, headline, store) {
  if (levelIndex >= 2 && headline) {
    return store
      ? `${headline}. Watch it from your Home Screen, without opening anything.`
      : `${headline}. Keep watch, put SMOKESHOW one tap away.`;
  }
  return store
    ? 'Coming back to check the smoke? The app puts it on your Home Screen and tells you when it changes.'
    : 'Coming back to check the smoke? Save the tap. Put SMOKESHOW on your Home Screen.';
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

  const store = mode.kind === 'ios-store';

  return (
    <div className="install-nudge" role="dialog" aria-label="Put SMOKESHOW on your Home Screen">
      <button type="button" className="install-nudge__close" onClick={dismiss} aria-label="Not now">
        ×
      </button>
      <p className="install-nudge__pitch">{pitch(levelIndex, headline, store)}</p>
      {store ? (
        <>
          <a
            href={STORE_URL}
            className="install-nudge__install"
            onClick={() => trackStoreClick('install-nudge')}
          >
            Get the app
          </a>
          <p className="install-nudge__terms">{TRIAL_LABEL}, cancel any time.</p>
        </>
      ) : (
        <button type="button" className="install-nudge__install" onClick={installAndroid}>
          Add SMOKESHOW
        </button>
      )}
    </div>
  );
}
