import { getJSON, setJSON, clearKey } from './storage.js';

const KEY = 'location';

export function requestLocation() {
  const cached = getJSON(KEY);
  if (cached?.granted && cached.lat != null) return Promise.resolve(cached);

  if (!('geolocation' in navigator)) {
    return Promise.resolve({ granted: false, reason: 'unsupported' });
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = {
          granted: true,
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          source: 'geolocation',
        };
        setJSON(KEY, loc);
        resolve(loc);
      },
      (err) => {
        resolve({
          granted: false,
          reason: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable',
        });
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 3600000 },
    );
  });
}

export function setManualLocation(lat, lon, label) {
  const loc = { granted: true, lat, lon, source: 'manual', label };
  setJSON(KEY, loc);
  return loc;
}

export function clearLocation() {
  clearKey(KEY);
}
