// Location pages: one static, crawlable page per place, booting the same app
// pre-pointed at that place's coordinates.
//
// Nothing in this table describes current conditions, and nothing ever should.
// A location page is a static shell; the air over a city changes hourly. Every
// number a reader sees about today comes from the live verdict the app paints
// into #root, never from this file. That constraint is what keeps these pages
// honest as they age — a page that hardcoded "smoke clears Thursday" is a lie
// by Friday, and Google is very good at noticing.
//
// The landmarks are the reason these pages are worth writing at all. The rating
// scale in lib/rating.js is anchored to VISIBILITY, which is the one reading a
// person can take from their own window without trusting us. Naming the actual
// buildings and shorelines that vanish at each step turns an abstract scale
// into a local one. It is also the part that cannot be mass-generated from a
// coordinate table — which is precisely why it earns the page its place.
//
// Adding a city: write the landmarks by hand against real sightlines, or leave
// them out. A wrong landmark is worse than none, because it breaks the one
// check the reader can actually run.

// Level indices match LEVELS in lib/rating.js: 0 all-clear (10+ mi), 1 in the
// air (5-10 mi), 2 smells like fire (3-5 mi), 3 tastes like fire (1.5-3 mi),
// 4 smokeshow (under 1.5 mi).
export const LOCATIONS = [
  {
    slug: 'chicago-il',
    name: 'Chicago',
    region: 'IL',
    label: 'Chicago, IL',
    lat: 41.8781,
    lon: -87.6298,
    timezone: 'America/Chicago',

    // One sentence on where this city's smoke usually comes from. Evergreen
    // geography and prevailing flow, not a forecast.
    source:
      'Chicago sits at the downwind end of a long corridor from the Canadian boreal forest. Most smoke here has traveled from fires in Ontario, Manitoba, or Quebec, riding northerly and northwesterly flow south across the Great Lakes over a day or more.',

    // The one historical anchor a reader will remember. Facts only, dated.
    // No superlatives we cannot source.
    memory:
      'In late June 2023, smoke from Quebec wildfires pushed Chicago to among the worst air quality of any major city in the world for parts of two days. That event is why a lot of people in this city now check before opening a window.',

    // Sightlines, shortest first within each band. Distances are approximate
    // and deliberately hedged — they anchor the scale, they do not measure it.
    landmarks: [
      'The Loop skyline is sharp from Montrose Harbor, about six miles up the lakefront, and the horizon over the lake is a clean line.',
      'The skyline still reads from Montrose Harbor, but it has gone flat and grey at the edges and the far shoreline is gone.',
      'From the lakefront the Willis Tower is still there but soft, and the far end of the Loop is losing its outline.',
      'From Navy Pier the near towers hold, while the tops of the tallest buildings, roughly a mile and a half off, fade into the haze.',
      'The upper floors of the Loop towers disappear. From the river you can lose the Willis Tower entirely.',
    ],

    // Each question is a real search with real volume, checked in Ahrefs.
    // The answers point at the live verdict rather than asserting a condition,
    // because this file is static and the air is not.
    questions: [
      {
        q: 'Is there wildfire smoke in Chicago right now?',
        a: 'The verdict at the top of this page answers that for Chicago specifically. It reads the forecast model over the city and states the level in plain language, from All clear through Smokeshow, alongside what that level typically looks and smells like. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Chicago?',
        a: "That is the headline answer above. Smokeshow reports a clear time: the first stretch of at least six straight hours where the forecast drops below the Smells-like-fire threshold and stays there. The six-hour rule exists so a single hour's dip does not get announced as the all-clear.",
      },
      {
        q: "Why is Chicago's air quality bad today?",
        a: 'When Chicago air turns hazy outside of a local source, wildfire smoke is the usual reason, and it has almost always traveled. Scrub the timeline backward twelve hours to watch where the smoke over the city came from, and forward forty-eight to see where the model sends it next.',
      },
      {
        q: 'Where is the wildfire smoke in Chicago coming from?',
        a: 'Most smoke events here originate in the Canadian boreal forest, in Ontario, Manitoba, or Quebec, and arrive on northerly or northwesterly flow after a day or more in transit. The map shows the plume rather than a guess: run the timeline backward and the path it took is visible.',
      },
      {
        q: 'Will the air quality in Chicago be better tomorrow?',
        a: 'The five-day strip above gives a day-by-day read, and the detailed timeline covers the next forty-eight hours hour by hour. Smoke forecasts are sharpest one to two days out and get fuzzier after that, so the page also shows where the models disagree instead of hiding the spread.',
      },
      {
        q: 'How can I tell how smoky it is in Chicago without an app?',
        a: 'Look at how far you can see, which is the anchor the whole scale is built on. The landmark list above turns each level into a specific Chicago sightline, so you can check the forecast against your own window.',
      },
    ],
  },
];

export function locationBySlug(slug) {
  return LOCATIONS.find((l) => l.slug === slug) ?? null;
}
