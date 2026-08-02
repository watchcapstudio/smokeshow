import { trendAt } from '../lib/trend.js';
import './TrendChip.css';

const QUIET_FLOOR = 12; // keep in sync with lib/trend.js — below this, "steady" means "clear," not "worth a chip"

const TREND_COPY = {
  rising: { text: 'Getting worse', modifier: 'rising' },
  falling: { text: 'Improving', modifier: 'falling' },
  steady: { text: 'Holding steady', modifier: 'steady' },
};

export default function TrendChip({ pm25, index, verdict }) {
  if (!pm25 || pm25[index] == null) return null;
  const trend = trendAt(pm25, index, verdict);
  if (trend === 'steady' && pm25[index] < QUIET_FLOOR) return null; // clear and steady — nothing to say

  const { text, modifier } = TREND_COPY[trend];
  return (
    <div className={`trend-chip trend-chip--${modifier}`}>
      <span className="trend-chip__pip" />
      {text}
    </div>
  );
}
