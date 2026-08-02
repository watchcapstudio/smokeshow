import { useEffect, useRef, useState } from 'react';
import './PullToRefresh.css';

// Pull-to-refresh for the installed (standalone) app, where there's no
// browser chrome and no reload button. Safari-in-browser keeps its native
// pull-to-refresh, so this only arms in standalone display mode.
const THRESHOLD = 70;

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true
  );
}

export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const pullRef = useRef(0);

  useEffect(() => {
    if (!isStandalone()) return;

    const setPullBoth = (v) => {
      pullRef.current = v;
      setPull(v);
    };

    const onStart = (e) => {
      // Only from the very top of the page, and never from map gestures.
      if (window.scrollY > 0 || e.target.closest?.('.leaflet-container')) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
    };

    const onMove = (e) => {
      if (startY.current == null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0 && window.scrollY <= 0) {
        setPullBoth(Math.min(dy * 0.5, 110)); // resistance curve
        if (dy > 10 && e.cancelable) e.preventDefault(); // suppress rubber-band
      } else {
        setPullBoth(0);
      }
    };

    const onEnd = () => {
      if (startY.current == null) return;
      startY.current = null;
      if (pullRef.current >= THRESHOLD) {
        setRefreshing(true);
        window.location.reload();
      } else {
        setPullBoth(0);
      }
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  if (pull <= 0 && !refreshing) return null;
  return (
    <div className="ptr" style={{ height: refreshing ? 48 : pull }}>
      {refreshing ? 'Refreshing…' : pull >= THRESHOLD ? 'Release to refresh' : '↓ Pull to refresh'}
    </div>
  );
}
