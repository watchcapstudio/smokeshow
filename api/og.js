import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const LEVEL_ACCENTS = {
  'all-clear': '#7fae8a',
  something: '#c9b46a',
  smells: '#d68a4a',
  tastes: '#b85c3a',
  smokeshow: '#a04a34',
};

const LEVEL_NAMES = [
  'All clear',
  'In the air',
  'Smells like fire',
  'Tastes like fire',
  'Smokeshow',
];

// Plain element objects instead of JSX — satori accepts {type, props} trees,
// and a .js file keeps Vercel's zero-config function detection happy.
function h(type, style, ...children) {
  return { type, props: { style, children: children.length === 1 ? children[0] : children } };
}

// Pure presentation: every string arrives via query params from /s, so this
// function does no data fetching and caches hard.
const cap = (v, n) => (v || '').slice(0, n);

export default function handler(req) {
  const { searchParams } = new URL(req.url);
  // Cap every input: this endpoint is directly reachable, and satori lays out
  // whatever it's given — an unbounded string or strip would spike CPU/memory
  // per request. Values are text nodes in a PNG, so this is cost, not XSS.
  const rating = cap(searchParams.get('rating'), 40) || 'SMOKESHOW';
  const key = LEVEL_ACCENTS[searchParams.get('key')] ? searchParams.get('key') : 'smells';
  const aqi = cap(searchParams.get('aqi'), 4);
  const place = cap(searchParams.get('place'), 80);
  const line = cap(searchParams.get('line'), 120);
  const strip = cap(searchParams.get('strip'), 200)
    .split(',')
    .filter(Boolean)
    .slice(0, 6)
    .map((entry) => {
      const [day, idx] = entry.split(':');
      return { day: cap(day, 6), name: LEVEL_NAMES[Number(idx)] || '' };
    });

  const accent = LEVEL_ACCENTS[key] || '#e8823a';

  const root = h(
    'div',
    {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#16130f',
      color: '#f1ece3',
      padding: '48px 60px',
      borderLeft: `14px solid ${accent}`,
      fontFamily: 'sans-serif',
    },
    h(
      'div',
      { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
      place ? h('div', { fontSize: 30, color: '#b8ada0' }, place) : h('div', {}, ''),
      aqi ? h('div', { fontSize: 44, fontWeight: 800 }, `AQI ${aqi}`) : null,
    ),
    h(
      'div',
      { fontSize: rating.length > 14 ? 88 : 120, fontWeight: 800, lineHeight: 1.05 },
      rating,
    ),
    line ? h('div', { fontSize: 46, fontWeight: 700, color: accent, marginTop: 18 }, line) : null,
    h(
      'div',
      { display: 'flex', gap: 14, marginTop: 'auto', marginBottom: 26 },
      ...strip.map((d) =>
        h(
          'div',
          {
            display: 'flex',
            flexDirection: 'column',
            background: '#201b16',
            border: '2px solid #3a322a',
            borderRadius: 12,
            padding: '14px 18px',
            width: 200,
          },
          h('div', { fontSize: 24, color: '#b8ada0' }, d.day),
          h('div', { fontSize: 22, fontWeight: 700 }, d.name),
        ),
      ),
    ),
    h(
      'div',
      { display: 'flex', alignItems: 'baseline', gap: 20 },
      h('div', { fontSize: 34, fontWeight: 800, letterSpacing: 2 }, 'SMOKESHOW'),
      h('div', { fontSize: 24, color: '#b8ada0' }, 'smokeshow.earth'),
    ),
  );

  return new ImageResponse(root, {
    width: 1200,
    height: 630,
    headers: {
      'cache-control': 'public, s-maxage=600, stale-while-revalidate=1800',
    },
  });
}
