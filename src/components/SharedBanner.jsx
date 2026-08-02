import './SharedBanner.css';

export default function SharedBanner({ placeName, fromShare, onCheckYourAir }) {
  return (
    <div className="shared-banner">
      <span className="shared-banner__text">
        {fromShare ? 'Sent by a friend? ' : ''}This is <strong>{placeName}</strong>.
      </span>
      <button type="button" className="shared-banner__cta" onClick={onCheckYourAir}>
        Check your air →
      </button>
    </div>
  );
}
