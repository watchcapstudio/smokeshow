import './LocationBanner.css';

export default function LocationBanner({ placeName, onUpdateLocation }) {
  return (
    <div className="location-banner">
      <span className="location-banner__place">{placeName || 'Locating…'}</span>
      <button type="button" className="location-banner__update" onClick={onUpdateLocation}>
        Update location
      </button>
    </div>
  );
}
