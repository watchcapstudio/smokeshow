// User display preferences — units and the sensitive-household flag.
// Extends lib/storage.js rather than talking to localStorage directly.
import { getJSON, setJSON } from './storage.js';

const UNITS_KEY = 'units';
const SENSITIVE_KEY = 'sensitive';

export function getUnits() {
  return getJSON(UNITS_KEY) === 'aqi' ? 'aqi' : 'ug';
}

export function setUnits(units) {
  setJSON(UNITS_KEY, units === 'aqi' ? 'aqi' : 'ug');
}

export function getSensitive() {
  return !!getJSON(SENSITIVE_KEY);
}

export function setSensitive(sensitive) {
  setJSON(SENSITIVE_KEY, !!sensitive);
}
