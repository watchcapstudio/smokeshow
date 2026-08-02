import { useState } from 'react';
import { searchPlaces } from '../lib/geocoding.js';
import './LocationSearch.css';

export default function LocationSearch({ onSelect, hint }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  async function handleChange(e) {
    const value = e.target.value;
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const found = await searchPlaces(value);
    setLoading(false);
    setResults(found);
  }

  return (
    <div className="location-search">
      <p className="location-search__hint">
        {hint ?? 'Location access was denied or unavailable. Search for a place instead.'}
      </p>
      <input
        type="text"
        value={query}
        onChange={handleChange}
        placeholder="City, town, or ZIP…"
        aria-label="Search for a location"
      />
      {loading && <p className="location-search__loading">Searching…</p>}
      {results.length > 0 && (
        <ul className="location-search__results">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <button type="button" onClick={() => onSelect(r)}>
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
