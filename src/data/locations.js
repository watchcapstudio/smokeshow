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
//
// `bands` overrides those universal distances per city, and is the reason these
// pages are not one page repeated. The LEVEL NAMES map to PM2.5 thresholds and
// never move. What a threshold LOOKS like does move: "All clear" in Chicago is
// a clean line over the lake at ten miles, and "All clear" in Seattle is
// Rainier standing at about sixty. Forcing one band set on every city throws
// away the strongest local signal in the mountain markets. Omit `bands` to fall
// back to LEVELS — Chicago does, because its bands and the universal ones are
// the same numbers.
//
// HARD RULE, and it is a rule about honesty rather than style: no copy on these
// pages — not the landmarks, not the provenance, not a single FAQ answer, not
// the meta description — may cite an AQI number. Level NAMES only. The
// thresholds in lib/rating.js are deliberately rounder than the EPA PM2.5
// breakpoints and diverge from them at both ends, and the AQI chip the app
// paints comes from ugm3ToAqi(), a different scale again. So the chip and the
// level name do not always change at the same moment, and any sentence naming
// an AQI value will eventually contradict the chip sitting above it on the same
// page. ARRIVAL_THRESHOLD is verdict logic, not a display level; it does not
// belong in copy either.
//
// Canadian cities are metric throughout — bands, landmarks, and any distance in
// an FAQ answer. Do not convert the US pages.
export const LOCATIONS = [
  {
    slug: 'chicago-il',
    name: 'Chicago',
    region: 'IL',
    label: 'Chicago, IL',
    lat: 41.8781,
    lon: -87.6298,
    timezone: 'America/Chicago',
    corridor: 'canadian-smoke-great-lakes-northeast',

    // Upwind: the cities a plume headed here usually crosses FIRST. This is the
    // one link on the page a scraper cannot fake, because it is a claim about
    // flow rather than about proximity — and it is the reason a reader clicks.
    // Each note has to be true of this pair specifically.
    upwind: [
      {
        slug: 'minneapolis-mn',
        note: 'Ontario and Manitoba smoke usually reaches the Twin Cities a day before it reaches the Chicago lakefront.',
      },
      {
        slug: 'milwaukee-wi',
        note: 'Ninety miles up the same shoreline, on the same northerly flow. What Milwaukee gets in the morning, Chicago often gets by evening.',
      },
    ],

    // Nearby: cities that share this one's weather rather than feed it.
    nearby: ['milwaukee-wi', 'detroit-mi'],

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

  {
    slug: 'missoula-mt',
    name: 'Missoula',
    region: 'MT',
    label: 'Missoula, MT',
    lat: 46.8721,
    lon: -113.994,
    timezone: 'America/Denver',
    corridor: 'wildfire-smoke-pacific-northwest-northern-rockies',

    upwind: [
      {
        slug: 'spokane-wa',
        note: 'Directly upwind on the westerly flow that carries Washington, Oregon, and interior BC smoke into western Montana. Spokane reads it first.',
      },
      {
        slug: 'boise-id',
        note: 'The central Idaho fires that reach Missoula pass over the Treasure Valley on the way, so Boise is an early look at the same air.',
      },
    ],

    nearby: ['whitefish-mt', 'bozeman-mt', 'spokane-wa'],

    // Per-city visibility bands. Missoula's valley is narrow and its anchors are
    // close, so the ladder is compressed relative to Seattle's or Portland's.
    bands: ['15+ miles', '8-15 miles', '3-8 miles', '1-3 miles', 'under 1 mile'],

    source:
      "Missoula sits in a valley that traps what blows into it. Smoke here arrives from fires across western Montana and the Idaho panhandle, and from as far as Washington, Oregon, and interior British Columbia on westerly flow. The valley's own geography is the second half of the story: cool air settles overnight, caps the valley, and holds smoke at ground level long after the fire behavior upwind has calmed down.",

    memory:
      "The August and September inversions are why Missoula's bad air often outlasts the event that caused it. Residents here have measured their summers by it for decades, and the 2017 and 2021 seasons both produced multi-week stretches where the valley never fully cleared.",

    landmarks: [
      'Lolo Peak stands clean on the south horizon, about fifteen miles out, and the Bitterroots behind it hold their layers.',
      'Lolo Peak has gone flat and blue, and Snowbowl on the north side of the valley, about eight miles up, is losing its ridgeline.',
      'Blue Mountain still reads southwest at roughly five miles, but the valley walls have turned into silhouettes with no texture.',
      'From downtown the M on Mount Sentinel is still there, about a mile off, while the top of the ridge above it fades out.',
      'Mount Sentinel goes. From the Higgins Avenue bridge you lose the hillside that defines the whole town.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Missoula right now?',
        a: 'The verdict at the top of this page answers that for Missoula specifically. It reads the forecast model over the valley floor, which is the part that matters here — because the valley caps itself overnight, the air on the valley floor and the air above the inversion up on Snowbowl can be two different stories on the same morning, and the one you breathe is the low one. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Missoula?',
        a: "That is the headline answer above: the clear time, meaning the first stretch of at least six straight hours where the forecast drops below the Smells-like-fire threshold and stays there. The six-hour rule matters more in Missoula than in most places, because a valley that has capped itself will give up an hour of cleaner air and then take it straight back. What the model has to show before it calls an all-clear here is the valley actually flushing, not the wind upwind changing its mind.",
      },
      {
        q: "Why is Missoula's air quality bad today?",
        a: "There are two different reasons and they need different answers. Either something new arrived — western Montana, the Idaho panhandle, or a westerly push out of Washington, Oregon, or interior British Columbia — or nothing new arrived and the valley simply never let go of what came in days ago. That second case is the one Missoula is known for, and it is why the air here often stays bad after the fire behavior upwind has calmed down. Scrub the timeline backward twelve hours: if the plume is not moving, you are looking at the valley, not at a fire.",
      },
      {
        q: 'Where is the wildfire smoke in Missoula coming from?',
        a: 'Most of it is western Montana and the Idaho panhandle, close enough that a new start can change the air the same day. The rest arrives on westerly flow from Washington, Oregon, and interior British Columbia, hundreds of miles out, and that smoke is aged and spread thin by the time it crosses the Bitterroot divide. Run the timeline backward on the map and the direction of travel is visible rather than asserted.',
      },
      {
        q: 'Will the air quality in Missoula be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the detailed timeline covers the next forty-eight hours hour by hour. One Missoula-specific caution: a wind shift upwind does not automatically buy you a clear morning here, because the valley has to flush before the ground-level air changes. Smoke forecasts are sharpest one to two days out, and the page shows where the models disagree rather than hiding the spread.',
      },
      {
        q: 'How can I tell how smoky it is in Missoula without an app?',
        a: 'Run the valley from the outside in, which is what the landmark list above does. Look south for Lolo Peak first, then check whether the valley walls still have texture or have gone to flat silhouettes, then look at the M on Mount Sentinel from the Higgins Avenue bridge. When Sentinel itself goes, you have lost the hillside the whole town is oriented around, and you do not need a number to tell you that is the worst of it.',
      },
    ],
  },
];

export function locationBySlug(slug) {
  return LOCATIONS.find((l) => l.slug === slug) ?? null;
}
