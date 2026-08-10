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

    // Downwind is the mirror of upwind, and only the source-end cities carry it —
    // the ones with nothing upstream that has a page. Winnipeg, Toronto and
    // Chicago's own provenance all describe the chain outward from them, so the
    // link is as editorially earned as an upwind one and answers a real question:
    // if it is bad here now, who gets it next.
    downwind: [],

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
        a: 'The verdict at the top of this page answers that for Missoula specifically. It reads the forecast model over the valley floor, which is the part that matters here, because the valley caps itself overnight, the air on the valley floor and the air above the inversion up on Snowbowl can be two different stories on the same morning, and the one you breathe is the low one. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Missoula?',
        a: "That is the headline answer above: the clear time, meaning the first stretch of at least six straight hours where the forecast drops below the Smells-like-fire threshold and stays there. The six-hour rule matters more in Missoula than in most places, because a valley that has capped itself will give up an hour of cleaner air and then take it straight back. What the model has to show before it calls an all-clear here is the valley actually flushing, not the wind upwind changing its mind.",
      },
      {
        q: "Why is Missoula's air quality bad today?",
        a: "There are two different reasons and they need different answers. Either something new arrived from western Montana, the Idaho panhandle, or a westerly push out of Washington, Oregon, or interior British Columbia. Or nothing new arrived and the valley simply never let go of what came in days ago. That second case is the one Missoula is known for, and it is why the air here often stays bad after the fire behavior upwind has calmed down. Scrub the timeline backward twelve hours: if the plume is not moving, you are looking at the valley, not at a fire.",
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

  {
    slug: 'whitefish-mt',
    name: 'Whitefish',
    region: 'MT',
    label: 'Whitefish, MT',
    lat: 48.4111,
    lon: -114.3376,
    timezone: 'America/Denver',
    corridor: 'wildfire-smoke-pacific-northwest-northern-rockies',

    upwind: [
      {
        slug: 'spokane-wa',
        note: 'The westerly flow that carries Washington and Oregon smoke into the Flathead crosses Spokane first. It does not cover the Flathead’s real problem, which comes straight down from BC.',
      },
    ],

    nearby: ['missoula-mt', 'bozeman-mt'],

    bands: ['25+ miles', '12-25 miles', '5-12 miles', '1.5-5 miles', 'under 1.5 miles'],

    source:
      'The Flathead has a different upwind neighbour than the rest of Montana. Interior British Columbia sits directly north, and a bad BC fire season puts smoke over Whitefish and Kalispell repeatedly without a single acre burning in the United States. On top of that come the usual western Montana and Idaho panhandle fires, plus Washington and Oregon smoke on westerly flow, and fires inside Glacier itself.',

    memory:
      'The valley then does what mountain valleys do. Cool air settles overnight, caps the basin, and holds smoke at ground level after the flow upwind has already shifted. The 2017 season is the local marker, when the Sprague Fire burned in Glacier and took Sperry Chalet with it, and the valley spent weeks without a clear view of the park.',

    valley: {
      heading: 'The Flathead breathes as one valley',
      body: 'Whitefish is one town in a valley that breathes as a single unit. Kalispell sits fifteen miles south and is the valley’s population centre, Columbia Falls holds the western entrance to Glacier, and Bigfork sits at the top of Flathead Lake. The lake and the surrounding ranges mean smoke that settles into the Flathead tends to stay in the Flathead, so a bad stretch in Whitefish is a bad stretch in all of them. Glacier National Park sits immediately east, and on smoky weeks the Going-to-the-Sun corridor loses the views it exists for.',
    },

    landmarks: [
      'The Glacier peaks read sharp to the east, twenty-five miles and more across the Flathead, and the Swan Range holds its whole ridgeline south of them.',
      'The Glacier skyline has flattened into one blue band and the Swans have lost their notches, though Big Mountain still shows its runs.',
      'The ranges across the valley are gone. Big Mountain, five miles north of downtown, is a silhouette with the ski runs barely readable on it.',
      'From City Beach the far shore of Whitefish Lake, about two miles up, disappears into grey.',
      'Big Mountain goes. From Central Avenue you lose the mountain the whole town is built to look at.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Whitefish right now?',
        a: 'The verdict at the top of this page answers that for Whitefish and, in practice, for the Flathead. Kalispell, Columbia Falls, and Bigfork are close enough and low enough in the same basin that a bad hour here is a bad hour there. It reads the forecast model over the valley floor and states the level in plain language, from All clear through Smokeshow. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Whitefish?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours where the forecast drops below the Smells-like-fire threshold and stays there. The Flathead is slow to give that up. The lake and the ranges around it mean smoke that settles into this basin tends to stay in this basin, so the clear time here can land well after the flow over British Columbia has already turned.',
      },
      {
        q: "Why is Whitefish's air quality bad today?",
        a: 'The answer is usually British Columbia, and that surprises people who are watching American fire maps. Interior BC sits directly north of the Flathead, and a bad season up there puts smoke over Whitefish and Kalispell repeatedly with nothing burning in the United States at all. The rest of the time it is western Montana, the Idaho panhandle, a westerly push out of Washington or Oregon, or a fire inside Glacier itself.',
      },
      {
        q: 'Where is the wildfire smoke in Whitefish coming from?',
        a: 'Four sources, and they do not behave alike. Interior British Columbia is the dominant one and comes almost straight down from the north. Western Montana and the Idaho panhandle are close enough to change the air the same day. Washington and Oregon smoke arrives aged on westerly flow. And fires inside Glacier put smoke over the valley from a few miles east, which is the case where the park itself is both the source and the thing you can no longer see. Run the timeline backward on the map to see which one you are in.',
      },
      {
        q: 'Will the air quality in Whitefish be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers the next forty-eight hours hour by hour. If you are planning a Glacier day, watch the strip rather than the current hour: on smoky weeks the Going-to-the-Sun corridor loses the views it exists for well before the air is bad enough to change anyone’s plans, and the model is sharpest one to two days out.',
      },
      {
        q: 'How can I tell how smoky it is in Whitefish without an app?',
        a: 'Look east across the Flathead at the Glacier peaks first. When they flatten into one blue band with the Swan Range losing its notches, something has arrived. Then check Big Mountain to the north: whether you can still read the ski runs on it is the middle of the scale, and when the mountain the whole town is built to look at disappears from Central Avenue, you are at the top of it.',
      },
    ],
  },

  {
    slug: 'bozeman-mt',
    name: 'Bozeman',
    region: 'MT',
    label: 'Bozeman, MT',
    lat: 45.6796,
    lon: -111.0471,
    timezone: 'America/Denver',
    corridor: 'wildfire-smoke-pacific-northwest-northern-rockies',

    upwind: [
      {
        slug: 'missoula-mt',
        note: 'Two hundred miles west on the same westerly flow. Smoke that has crossed the Missoula valley is often over the Gallatin by the next day.',
      },
      {
        slug: 'boise-id',
        note: 'The central Idaho fires that reach Bozeman ride the same southwesterly flow through the Treasure Valley on the way.',
      },
    ],

    nearby: ['missoula-mt', 'whitefish-mt', 'jackson-wy'],

    bands: ['30+ miles', '15-30 miles', '5-15 miles', '1.5-5 miles', 'under 1.5 miles'],

    source:
      'Bozeman sits in the Gallatin Valley with fire country on every side. Smoke arrives from central Idaho, western Montana, the Yellowstone country to the south, and from Washington, Oregon, and interior British Columbia on westerly flow that carries it hundreds of miles. Like Missoula, the valley traps what lands in it: clear high-country nights settle cool air into the basin and hold smoke at ground level into the following morning.',

    memory:
      'The 2017, 2020, and 2021 seasons all produced stretches where the Bridgers were not visible from town for days at a time, and the summer fire season now overlaps almost exactly with the months the valley is most used.',

    valley: {
      heading: 'Bozeman and the Yellowstone gateway towns',
      body: 'Bozeman is the north end of a corridor of towns that all breathe the same summer air. Livingston sits twenty-six miles east in Paradise Valley, where the wind that scours the town most of the year can also flush smoke out faster than it leaves the Gallatin. Big Sky is forty-five miles south under Lone Peak. Gardiner and West Yellowstone hold the park’s north and west entrances, both deep in valleys that pool smoke overnight the same way Bozeman’s does. When a plume settles over southwest Montana it rarely picks one of these towns, and a bad week in Bozeman usually means a bad week in all of them.',
    },

    landmarks: [
      'The Spanish Peaks read clean to the southwest, about thirty miles out, and the Bridgers hold every gully along the northeast wall of the valley.',
      'The Spanish Peaks have flattened into one blue shape and Sacagawea has lost its detail, though the Bridger ridgeline still separates from the sky.',
      'The Gallatins reduce to a silhouette south of town. The M on the Bridger foothills, about three miles from Main Street, is the furthest thing with texture.',
      'From Main Street the Bridgers are a suggestion, and the benchland east of town, roughly two miles out, disappears into grey.',
      'The M goes. From downtown you lose the mountain faces that frame the entire Gallatin Valley.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Bozeman right now?',
        a: 'The verdict at the top of this page answers that for Bozeman specifically, and it reads the model over the valley floor rather than the high country. That distinction is worth knowing here: clear high-country nights settle cool air into the Gallatin basin, so the air on Main Street and the air on a ridge above it can be genuinely different on the same morning. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Bozeman?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. Bozeman has a neighbour worth comparing it against. Paradise Valley, twenty-six miles east, is wind country, and the wind that scours Livingston most of the year can flush a plume out faster than it leaves the Gallatin, so a clear time there is not a clear time here, and the difference is the basin.',
      },
      {
        q: "Why is Bozeman's air quality bad today?",
        a: 'Bozeman has fire country on every side, which means the honest answer is usually "several places at once." Central Idaho, western Montana, and the Yellowstone country to the south are the near sources; Washington, Oregon, and interior British Columbia feed it from hundreds of miles out on westerly flow. And the valley itself is half the story on any given morning, because it holds what arrived yesterday, so a bad day here does not require anything new to be burning.',
      },
      {
        q: 'Where is the wildfire smoke in Bozeman coming from?',
        a: 'The near sources are central Idaho, western Montana, and the Yellowstone country immediately south, close enough that a new start changes the air within a day. The far ones are Washington, Oregon, and interior British Columbia, and that smoke has been in the air long enough to spread thin and arrive aloft. Scrub the timeline backward twelve hours and the direction it came from is visible on the map rather than asserted in a sentence.',
      },
      {
        q: 'Will the air quality in Bozeman be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read, and the timeline covers forty-eight hours hour by hour. The awkward truth for anyone planning around it is that the fire season now overlaps almost exactly with the months the Gallatin Valley is most used, so "better tomorrow" is a question worth asking every day of August rather than once a summer. Forecasts are sharpest one to two days out and the page shows where the models disagree.',
      },
      {
        q: 'How can I tell how smoky it is in Bozeman without an app?',
        a: 'Start with the Spanish Peaks to the southwest, thirty miles out, so they are the first thing to flatten. Then look at whether Sacagawea still has detail and whether the Bridger ridgeline still separates from the sky. The M on the Bridger foothills is the close check from Main Street, and when the M itself goes you have lost the mountain faces that frame the entire valley, which is as clear a reading as any instrument will give you.',
      },
    ],
  },

  {
    slug: 'jackson-wy',
    name: 'Jackson',
    region: 'WY',
    label: 'Jackson, WY',
    lat: 43.4799,
    lon: -110.7624,
    timezone: 'America/Denver',
    corridor: 'wildfire-smoke-pacific-northwest-northern-rockies',

    upwind: [
      {
        slug: 'boise-id',
        note: 'Central and southern Idaho smoke rides westerly and southwesterly flow into the valley, and the Treasure Valley reads it first.',
      },
      {
        slug: 'salt-lake-city-ut',
        note: 'The Great Basin smoke that reaches Jackson on southwesterly flow crosses the Salt Lake bowl on the way north.',
      },
    ],

    nearby: ['bozeman-mt'],

    bands: ['20+ miles', '10-20 miles', '4-10 miles', '1.5-4 miles', 'under 1.5 miles'],

    source:
      'Jackson takes smoke from central and southern Idaho, the Great Basin, and western Montana on westerly and southwesterly flow, plus whatever burns in the Bridger-Teton and the parks immediately north. In heavy California and Pacific Northwest seasons, smoke also arrives aloft from a thousand miles away and settles.',

    memory:
      "The valley's name describes the problem. A hole rimmed by mountains pools cold air overnight and holds smoke at the valley floor into the morning, so the town can read worse than the passes above it. The 2016, 2018, and 2021 seasons all produced stretches where the Tetons were not visible from town for days, which in a valley built entirely around looking at them is the whole story.",

    landmarks: [
      'The Grand stands sharp to the northwest, about twenty miles up the valley, and the Teton range separates peak by peak along the whole skyline.',
      'The Tetons have flattened into one blue wall with no couloirs showing, though Sleeping Indian still reads across the valley to the east.',
      'The Tetons are gone. Sleeping Indian, about eight miles east, is a silhouette with no rock left in it.',
      'From the Town Square Snow King holds a mile south, while the ridgeline above the runs fades out entirely.',
      'Snow King goes. From downtown you lose the mountain sitting directly above the town.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Jackson right now?',
        a: 'The verdict at the top of this page answers that for Jackson specifically, and it reads the model at the valley floor. That is the number that matters and the one that flatters the town least: a hole rimmed by mountains pools cold air overnight, so the air in town can read worse than the air on the passes above it. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Jackson?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. The hole is why the six-hour hold matters here. Cold air settles into the valley overnight and holds smoke at the floor into the morning, so a forecast that dipped for one hour and called it clear would be describing the passes, not the Town Square.',
      },
      {
        q: "Why is Jackson's air quality bad today?",
        a: 'Either something is burning close, in the Bridger-Teton or the parks immediately north, or smoke has ridden westerly and southwesterly flow in from central and southern Idaho, the Great Basin, or western Montana. In heavy California and Pacific Northwest seasons there is a third case that catches people out: smoke arrives aloft from a thousand miles away and then settles into the valley, so the air goes bad with no fire within several states.',
      },
      {
        q: 'Where is the wildfire smoke in Jackson coming from?',
        a: 'Central and southern Idaho and the Great Basin are the usual answer, arriving on westerly and southwesterly flow, with western Montana adding to it and the Bridger-Teton supplying the local case. The long-range one is California and the Pacific Northwest, a thousand miles out, and that smoke comes in high before it comes down. Run the timeline backward on the map and you can see which of those you are breathing.',
      },
      {
        q: 'Will the air quality in Jackson be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. In a valley built entirely around looking at the Tetons, the question people are usually asking is when the range comes back, and that is not quite the same question as when the air is cleaner. Visibility recovers from the top of the scale downward, so the Grand reappears well before an all-clear. Forecasts are sharpest one to two days out.',
      },
      {
        q: 'How can I tell how smoky it is in Jackson without an app?',
        a: 'Look northwest up the valley at the Grand first: when the range stops separating peak by peak and flattens into one blue wall with no couloirs showing, smoke has arrived. Then look east at Sleeping Indian across the valley, and when that has no rock left in it the Tetons are already gone. The last check is Snow King, directly above town. When the mountain sitting on top of you goes, that is the bottom of the scale.',
      },
    ],
  },

  {
    slug: 'winnipeg-mb',
    name: 'Winnipeg',
    region: 'MB',
    label: 'Winnipeg, MB',
    lat: 49.8951,
    lon: -97.1384,
    timezone: 'America/Winnipeg',
    corridor: 'canadian-smoke-great-lakes-northeast',

    // Winnipeg is the source end of the corridor. Nothing upstream of it has a
    // page, and inventing one to fill the slot would be a fabricated claim
    // about flow. What it has instead is a downwind chain, stated outright in its
    // own provenance: "What lands here thick reaches Minneapolis within a day and
    // Chicago, Detroit, and the Great Lakes a day after that."
    upwind: [],

    downwind: [
      {
        slug: 'minneapolis-mn',
        note: 'What lands here thick reaches the Twin Cities within a day, which is why Minnesota alerts often follow a bad Manitoba week.',
      },
      {
        slug: 'chicago-il',
        note: 'A day behind Minneapolis on the same plume, thinned out by the extra distance.',
      },
      {
        slug: 'detroit-mi',
        note: 'The far end of this leg. Smoke that is over the Forks today is a Great Lakes problem the day after next.',
      },
    ],

    nearby: ['minneapolis-mn'],

    bands: ['16+ km', '8-16 km', '5-8 km', '2-5 km', 'under 2 km'],

    source:
      'Winnipeg is usually the source end of the corridor, not the receiving end. Fires in northern Manitoba, northwestern Ontario, and Saskatchewan burn a few hundred kilometres north and northwest, which means Winnipeg gets smoke fresh and concentrated rather than aged and thinned. What lands here thick reaches Minneapolis within a day and Chicago, Detroit, and the Great Lakes a day after that.',

    memory:
      // The original second clause here cited repeated large-scale evacuations
      // from northern Manitoba communities without a year behind it. Cut rather
      // than dated: an undated "in recent summers" is the kind of claim that
      // reads authoritative and cannot be checked, and the paragraph makes its
      // point without it.
      'That proximity is why Manitoba’s worst fire seasons register as national air quality events rather than provincial ones.',

    landmarks: [
      'From the Forks the downtown towers are sharp and the prairie horizon reads as a hard line in every direction, which on flat ground is the cleanest visibility test there is.',
      'The skyline still reads from the Forks but has flattened, and the horizon has dissolved into a soft band with no edge.',
      'The Golden Boy still catches light on the Legislative Building about a kilometre off, but the buildings behind it have merged into one mass.',
      'From the Esplanade Riel the near downtown towers hold while their tops fade into the haze.',
      'The top of 201 Portage goes. From the Forks you can lose downtown entirely.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Winnipeg right now?',
        a: 'The verdict at the top of this page answers that for Winnipeg specifically. What makes this city different from most on this corridor is that its smoke has not travelled far. The fires are a few hundred kilometres north and northwest, so what arrives here is fresh and concentrated rather than aged and thinned out. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Winnipeg?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. Winnipeg has no valley to flush and no lake breeze to fight, so a clear time here is mostly a wind question and it tends to be a cleaner answer than the same forecast further down the corridor. What it does not tell you is what is still burning to the north.',
      },
      {
        q: "Why is Winnipeg's air quality bad today?",
        a: 'Because Winnipeg is upwind of almost everyone else and downwind of the boreal forest. Fires in northern Manitoba, northwestern Ontario, and Saskatchewan sit a few hundred kilometres north and northwest, and their smoke does not need days in transit to get here. That is also why a bad Manitoba fire season registers as a national air quality event rather than a provincial one. What starts here does not stay here.',
      },
      {
        q: 'Where is the wildfire smoke in Winnipeg coming from?',
        a: 'Northern Manitoba, northwestern Ontario, and Saskatchewan, on northerly and northwesterly flow. Winnipeg is the near end of the chain rather than the far end: what lands here thick reaches Minneapolis within a day, and Chicago, Detroit, and the rest of the Great Lakes a day after that. Run the timeline backward on the map and the plume comes down from the north rather than in from anywhere.',
      },
      {
        q: 'Will the air quality in Winnipeg be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. Proximity cuts both ways here: fresh smoke means a wind shift can improve things fast, and it also means a new start a few hundred kilometres north can undo a good forecast inside a day. That is why the page shows where the models disagree rather than hiding the spread.',
      },
      {
        q: 'How can I tell how smoky it is in Winnipeg without an app?',
        a: 'Use the horizon, which is a luxury most cities on this list do not have. From the Forks the prairie edge reads as a hard line in every direction on a clean day, and flat ground makes that the most sensitive visibility test there is. The edge softens into a band before any downtown building looks different. After that it is the Golden Boy on the Legislative Building, then the top of 201 Portage.',
      },
    ],
  },

  {
    slug: 'minneapolis-mn',
    name: 'Minneapolis',
    region: 'MN',
    label: 'Minneapolis, MN',
    lat: 44.9778,
    lon: -93.265,
    timezone: 'America/Chicago',
    corridor: 'canadian-smoke-great-lakes-northeast',

    upwind: [
      {
        slug: 'winnipeg-mb',
        note: 'The Manitoba and northwestern Ontario fires that reach the Twin Cities put smoke over Winnipeg first, usually less than a day earlier.',
      },
    ],

    nearby: ['milwaukee-wi', 'chicago-il'],

    bands: ['9+ miles', '5-9 miles', '3-5 miles', '1.5-3 miles', 'under 1.5 miles'],

    source:
      "Minneapolis is one of the first major American cities Canadian smoke reaches. Fires in Manitoba, northwestern Ontario, and Saskatchewan sit almost directly upwind, and on northerly flow their smoke crosses the border and reaches the Twin Cities in under a day. That proximity is why Minnesota's air quality alerts often fire before Chicago's, and why the same plume that arrives here fresh reaches the East Coast a day or two later, thinned out.",

    memory:
      // The original middle sentence here compared Minnesota's 2021 air quality
      // alert count against the previous fifteen years combined. It was the most
      // specific quantitative claim on the site and the hardest to source, so it
      // is cut rather than hedged. The season it was there to mark is still named.
      'The 2021 and 2023 seasons both put Minneapolis among the worst air quality readings in the country for stretches of days, and 2021 is the season most people here mean when they say the summers changed.',

    landmarks: [
      'The downtown skyline is sharp from Bde Maka Ska, about three miles southwest, and from the Mendota Bridge you can pick out both downtowns nine miles apart.',
      'The skyline still reads from Lake Nokomis, roughly five miles out, but it has gone flat and grey and St. Paul has disappeared behind it.',
      'From Bde Maka Ska the IDS Center is still the tallest thing there, three miles off, but the buildings behind it have merged into one shape.',
      'From the Stone Arch Bridge the near towers hold while the tops of the tallest ones, a bit over a mile away, fade into the haze.',
      'The upper floors of the IDS Center disappear. From the West River Parkway you can lose downtown entirely.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Minneapolis right now?',
        a: 'The verdict at the top of this page answers that for Minneapolis specifically. The Twin Cities are close enough to the source that the answer changes fast. Manitoba and northwestern Ontario smoke crosses the border and gets here in under a day, so a clean morning and a bad evening on the same plume is an ordinary Minneapolis pattern rather than an unusual one. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Minneapolis?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. Being near the front of this corridor makes that answer more volatile than it is on the East Coast. Smoke that reaches New York has spent two days spreading out and arrives as a broad haze; smoke that reaches the Twin Cities is still shaped like a plume, so it can leave as sharply as it came.',
      },
      {
        q: "Why is Minneapolis's air quality bad today?",
        a: 'Because Manitoba, northwestern Ontario, and Saskatchewan sit almost directly upwind and northerly flow is a short trip. This is the reason Minnesota’s air quality alerts often fire before Chicago’s do, and the reason people here date the change to the 2021 season rather than to anything more recent. Scrub the timeline backward twelve hours to see the plume come down across the border.',
      },
      {
        q: 'Where is the wildfire smoke in Minneapolis coming from?',
        a: 'Almost always the Canadian boreal forest, and specifically Manitoba, northwestern Ontario, and Saskatchewan rather than the western states. Minneapolis is near the front of that corridor: the same plume that arrives here fresh reaches the East Coast a day or two later, thinned out. Run the timeline backward on the map and the path comes down from the northwest, not in from the Rockies.',
      },
      {
        q: 'Will the air quality in Minneapolis be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers the next forty-eight hours hour by hour. Minneapolis sits at the sharp end of the forecast, which helps: at under a day from the source, the model is working inside the window where it is most reliable. It also means the model has less warning, so the page shows where the runs disagree rather than pretending to one answer.',
      },
      {
        q: 'How can I tell how smoky it is in Minneapolis without an app?',
        a: 'The Twin Cities give you a two-downtown test nothing else on this list has: from the Mendota Bridge you can normally pick out both skylines nine miles apart, and St. Paul disappearing behind Minneapolis is the first real step down. After that it is the IDS Center from Bde Maka Ska, still the tallest thing there or merged into one mass with the buildings behind it, and finally its upper floors going from the West River Parkway.',
      },
    ],
  },

  {
    slug: 'seattle-wa',
    name: 'Seattle',
    region: 'WA',
    label: 'Seattle, WA',
    lat: 47.6062,
    lon: -122.3321,
    timezone: 'America/Los_Angeles',
    corridor: 'wildfire-smoke-pacific-northwest-northern-rockies',

    upwind: [
      {
        slug: 'portland-or',
        note: 'The Oregon and California smoke that settles into Puget Sound comes up the I-5 corridor, and Portland is under it first.',
      },
      {
        slug: 'spokane-wa',
        note: 'Cascade and eastern Washington fires push smoke west through the passes. Spokane sits on the other side of them, reading the same fires from the inland end.',
      },
    ],

    nearby: ['portland-or'],

    bands: ['50+ miles', '15-50 miles', '5-15 miles', '2-5 miles', 'under 2 miles'],

    source:
      'Seattle gets smoke from two directions and they behave differently. Fires in the Cascades and eastern Washington push smoke west through the passes on easterly flow, which arrives fast and clears fast. Fires in Oregon, California, and interior British Columbia deliver smoke aloft that settles into the Puget Sound basin and sits, sometimes for a week, because the same marine geography that keeps the city mild also keeps air from moving.',

    memory:
      'August and September 2020 is the reference event. Smoke from the Oregon and California fires pushed Seattle to the worst air quality of any major city on earth for several days, and the sky stayed a flat orange-grey for the better part of two weeks.',

    landmarks: [
      'The mountain is out. Rainier stands clear to the southeast, about sixty miles off, and the Olympics hold their ridgeline across the Sound.',
      'Rainier is gone and the Olympics have flattened to a grey band, but Bainbridge reads clean across Elliott Bay.',
      'The Olympics have disappeared entirely. Bainbridge, about five miles west, is still there but has lost its trees.',
      'From Alki the downtown towers hold, two and a half miles across the bay, while the Space Needle softens against the sky.',
      'The tops of the downtown towers go. From the waterfront you lose the far side of Elliott Bay completely.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Seattle right now?',
        a: 'The verdict at the top of this page answers that for Seattle specifically. The city has the longest sightline of any page on this site, which makes the top of the scale unusually informative: Rainier at roughly sixty miles is a check no skyline city can offer, and "the mountain is out" is a genuine reading rather than a figure of speech. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Seattle?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. Seattle produces two very different versions of that answer. Smoke pushed west through the Cascade passes on easterly flow arrives fast and leaves fast. Smoke that settled into the Puget Sound basin from Oregon or California can sit for a week, because the marine geography that keeps the city mild also keeps its air from moving.',
      },
      {
        q: "Why is Seattle's air quality bad today?",
        a: 'It depends which of Seattle’s two mechanisms is running, and they do not feel alike. An easterly flow event means the Cascades or eastern Washington are burning and the passes are funnelling it west: sharp, fast, over quickly. A settled event means Oregon, California, or interior British Columbia smoke came in aloft and dropped into the basin, and that is the one that turns the sky flat orange-grey for days, as it did through August and September 2020.',
      },
      {
        q: 'Where is the wildfire smoke in Seattle coming from?',
        a: 'From the east through the Cascade passes, or from the south and north aloft. The Cascades and eastern Washington are the near source; Oregon, California, and interior British Columbia are the far ones, and their smoke arrives high before it settles. Run the timeline backward on the map and the two are easy to tell apart: pass-driven smoke comes over the crest in a line, and settled smoke is already everywhere when it appears.',
      },
      {
        q: 'Will the air quality in Seattle be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. The honest caveat for Seattle is that "better tomorrow" is a much safer bet on an easterly-flow event than on a settled one. 2020 is the reference for how long the basin can hold smoke once it has it. Forecasts are sharpest one to two days out and the page shows where the models disagree.',
      },
      {
        q: 'How can I tell how smoky it is in Seattle without an app?',
        a: 'Look for Rainier to the southeast first. It is sixty miles out, so it goes before anything else does, and losing it is the earliest real signal you get. Then the Olympics across the Sound: flattened to a grey band, then gone. Then Bainbridge: still there but with its trees gone is the middle of the scale. When the tops of the downtown towers go and you lose the far side of Elliott Bay from the waterfront, that is the bottom.',
      },
    ],
  },

  {
    slug: 'denver-co',
    name: 'Denver',
    region: 'CO',
    label: 'Denver, CO',
    lat: 39.7392,
    lon: -104.9903,
    timezone: 'America/Denver',
    corridor: 'wildfire-smoke-california-great-basin',

    upwind: [
      {
        slug: 'salt-lake-city-ut',
        note: 'Utah and Great Basin smoke reaching the Front Range crosses the Salt Lake bowl first, a day or so ahead on the same westerly flow.',
      },
      {
        slug: 'reno-nv',
        note: 'The northern Sierra and northern California smoke that arrives over Denver aloft passes the Truckee Meadows on its way east.',
      },
    ],

    nearby: ['salt-lake-city-ut'],

    bands: ['40+ miles', '15-40 miles', '5-15 miles', '2-5 miles', 'under 2 miles'],

    source:
      "Denver's haze has two separate causes and they get confused constantly. The Front Range produces its own summer ozone and brown cloud from traffic and industry trapped against the mountains, which is a local problem with local timing. Wildfire smoke is different: it arrives from Colorado's own western slope, from Utah and the Great Basin, and increasingly from California and the Pacific Northwest on upper-level flow that carries it a thousand miles east.",

    memory:
      'The 2020 season is the marker, when the Cameron Peak and East Troublesome fires burned close enough to drop ash on the metro. But the more common modern pattern is high smoke from somewhere else entirely, which is why the mountains disappear on days when nothing in Colorado is burning.',

    notSmoke:
      "Denver's brown cloud is not wildfire smoke. Traffic and industry emissions get trapped against the Front Range and cook into ozone through the summer, which produces a brown-tinged haze on hot afternoons with nothing burning anywhere. It looks like smoke, it hurts to breathe like smoke, and it is a separate problem with separate timing. Smoke arrives and leaves with the wind. The brown cloud builds through the day and breaks with a front.",

    landmarks: [
      'Longs Peak is sharp to the northwest, about forty-five miles out, and on the best days Pikes Peak reads south at over sixty.',
      'Longs is gone. Mount Blue Sky still marks the west, roughly thirty-five miles off, but the range behind it has gone to one grey wall.',
      'The Front Range flattens to a silhouette. The foothills above Golden, about fifteen miles west, are the furthest thing you can still resolve.',
      "From Sloan's Lake the downtown skyline holds two miles east, while the foothills behind it vanish entirely.",
      'The tops of the downtown towers go. From City Park you can lose the skyline that sits three miles away.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Denver right now?',
        a: 'The verdict at the top of this page answers that for Denver specifically, and it is a smoke forecast rather than a haze forecast, which in this city is a meaningful distinction. Denver has a native brown cloud that looks like smoke and is not, so the verdict can read All clear on an afternoon when the Front Range has genuinely disappeared. The section above on what is not smoke covers the tell. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Denver?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. Smoke and the brown cloud clear on completely different schedules, and confusing them is the standard Denver mistake. Smoke arrives and leaves with the wind, so a clear time is a wind forecast. The brown cloud builds through the day and breaks with a front, which no clear time on this page is describing.',
      },
      {
        q: "Why is Denver's air quality bad today?",
        a: 'There are two answers and the page will not pretend they are one. If it is a hot summer afternoon with no wind and a brown tinge at the horizon, that is most likely ozone off Front Range traffic and industry, trapped against the mountains, a local problem with nothing burning anywhere. If it is smoke, it has usually travelled: Colorado’s western slope, Utah and the Great Basin, or California and the Pacific Northwest on upper-level flow a thousand miles east.',
      },
      {
        q: 'Where is the wildfire smoke in Denver coming from?',
        a: 'Increasingly from a very long way away. The near sources are Colorado’s own western slope and the Utah and Great Basin fires; the far one, and now the more common pattern, is California and the Pacific Northwest arriving on upper-level flow. That is why the mountains disappear on days when nothing in Colorado is burning. The local exception was 2020, when Cameron Peak and East Troublesome burned close enough to drop ash on the metro.',
      },
      {
        q: 'Will the air quality in Denver be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. For smoke, "better tomorrow" is a question about upper-level flow a thousand miles west, which is why the page shows where the models disagree. For the brown cloud it is a question about whether a front is coming, and that is a plain weather forecast rather than anything this page computes.',
      },
      {
        q: 'How can I tell how smoky it is in Denver without an app?',
        a: 'Longs Peak to the northwest is the first check at about forty-five miles, and Pikes Peak south of it at over sixty is the best-day-only test. When Longs goes but Mount Blue Sky still marks the west, something has arrived. When the Front Range flattens to a silhouette and the foothills above Golden are the furthest thing you can resolve, it is well in. And watch the colour while you do it: smoke goes grey-brown and carries a smell, the brown cloud does not.',
      },
    ],
  },

  {
    slug: 'spokane-wa',
    name: 'Spokane',
    region: 'WA',
    label: 'Spokane, WA',
    lat: 47.6588,
    lon: -117.426,
    timezone: 'America/Los_Angeles',
    corridor: 'wildfire-smoke-pacific-northwest-northern-rockies',

    upwind: [
      {
        slug: 'portland-or',
        note: 'The Columbia Basin funnels westerly and southwesterly flow into the Spokane valley, and Portland sits at the mouth of the same system.',
      },
      {
        slug: 'boise-id',
        note: 'Central Idaho smoke arriving on southwesterly flow crosses the Treasure Valley before it reaches eastern Washington.',
      },
    ],

    nearby: ['missoula-mt', 'whitefish-mt', 'boise-id'],

    bands: ['25+ miles', '10-25 miles', '4-10 miles', '1.5-4 miles', 'under 1.5 miles'],

    source:
      'Spokane sits downwind of nearly everything that burns in the interior Northwest. Smoke arrives from central and eastern Washington, the Idaho panhandle, western Montana, and interior British Columbia, and the Columbia Basin funnels it into the valley on westerly and southwesterly flow. British Columbia is the one people underestimate: a bad BC season puts smoke over Spokane repeatedly without a single fire burning in Washington.',

    memory:
      'The 2015 and 2020 seasons both produced multi-week stretches of degraded air, and Spokane has spent parts of recent summers with the worst measured air quality in the United States.',

    landmarks: [
      'Mount Spokane stands clean to the northeast, about twenty-five miles out, and the Selkirks behind it hold their layers.',
      'Mount Spokane has gone flat and blue, and the ridgelines north of the valley are losing their edges.',
      'The hills above the valley reduce to silhouettes. Five Mile Prairie, about five miles north, is the furthest thing with any texture left.',
      'From the South Hill the downtown towers hold about two miles below, while the far side of the valley fades out.',
      'Downtown goes soft from the South Hill. From Riverfront Park you lose the ridge that frames the whole city.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Spokane right now?',
        a: 'The verdict at the top of this page answers that for Spokane specifically. Spokane is worth checking more often than most cities on this site, because it sits downwind of nearly everything that burns in the interior Northwest. Four separate source regions feed it, so the odds that at least one is active in August are high. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Spokane?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. The Columbia Basin is the complication. It funnels westerly and southwesterly flow straight into the valley, which means the wind that would clear another city is also the wind that delivers the next wave, and a clear time here can be a genuinely short window.',
      },
      {
        q: "Why is Spokane's air quality bad today?",
        a: 'Because almost everything upwind of Spokane is fire country. Central and eastern Washington, the Idaho panhandle, and western Montana all feed it, and British Columbia is the one people underestimate. A bad BC season puts smoke over Spokane repeatedly with nothing burning in Washington at all. Spokane has spent parts of recent summers with the worst measured air quality in the United States, which is not a ranking anyone here is surprised by.',
      },
      {
        q: 'Where is the wildfire smoke in Spokane coming from?',
        a: 'Four places, and the Columbia Basin brings them all to the same door. Central and eastern Washington and the Idaho panhandle are close enough to change the air the same day. Western Montana adds to it from the east on the rarer setups. Interior British Columbia comes down from the north and is the source most often missed, because nothing on an American fire map explains it. Scrub the timeline backward and the direction answers the question.',
      },
      {
        q: 'Will the air quality in Spokane be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. Spokane’s bad stretches have historically run in weeks rather than days. 2015 and 2020 both produced multi-week runs of degraded air, so the five-day view is the one worth reading here, not the next hour. Forecasts are sharpest one to two days out and the page shows the spread.',
      },
      {
        q: 'How can I tell how smoky it is in Spokane without an app?',
        a: 'Mount Spokane to the northeast is the far check at about twenty-five miles, with the Selkirks behind it holding their layers on a genuinely clean day. When Mount Spokane goes flat and blue and the ridgelines north of the valley lose their edges, smoke has arrived. Five Mile Prairie is the middle reading. The last one is from the South Hill: when downtown goes soft two miles below you, that is the bottom of the scale.',
      },
    ],
  },

  {
    slug: 'detroit-mi',
    name: 'Detroit',
    region: 'MI',
    label: 'Detroit, MI',
    lat: 42.3314,
    lon: -83.0458,
    timezone: 'America/Detroit',
    corridor: 'canadian-smoke-great-lakes-northeast',

    upwind: [
      {
        slug: 'toronto-on',
        note: 'Northern Ontario and Quebec smoke crosses Toronto and Lake Huron before it reaches the Detroit River, usually about a day earlier.',
      },
    ],

    nearby: ['cleveland-oh', 'chicago-il'],

    bands: ['8+ miles', '4-8 miles', '2-4 miles', '1-2 miles', 'under 1 mile'],

    source:
      'Detroit sits at the downwind end of a corridor running from the Canadian boreal forest through Ontario. Most smoke here originates in northern Ontario or Quebec and arrives on northerly and northeasterly flow, often after crossing Lake Huron. Because the source is usually east of the Rockies, Detroit frequently gets smoke on days when nothing in the American West is burning.',

    memory:
      'June 2023 is the reference event, when Quebec smoke pushed Detroit to among the worst air quality readings in the world for parts of two days and turned the sky a flat orange.',

    landmarks: [
      'From Belle Isle the Renaissance Center is sharp three miles west, and the Windsor skyline reads clean across the river with the far shoreline holding.',
      'The Ren Cen still reads from Belle Isle but has gone flat, and the Ambassador Bridge towers, about five miles out, have lost their cables.',
      'From the riverfront the Ambassador Bridge is a shape without detail. Windsor is still there across the water but its buildings have merged.',
      'The Ren Cen holds from Hart Plaza, under a mile off, while the towers behind it on the Detroit skyline fade out.',
      'The top of the Ren Cen goes. From the riverfront you can lose Windsor entirely, a half mile across the water.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Detroit right now?',
        a: 'The verdict at the top of this page answers that for Detroit specifically. One thing worth knowing before you read it: because Detroit’s smoke comes from east of the Rockies, this city frequently has bad air on days when nothing in the American West is burning and the national fire map looks quiet. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Detroit?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. Detroit is far enough down the Ontario corridor that plumes tend to arrive as broad haze rather than sharp fronts, which usually makes the clear time a steadier answer here than it is in Winnipeg or Minneapolis, and a slower one.',
      },
      {
        q: "Why is Detroit's air quality bad today?",
        a: 'Almost always northern Ontario or Quebec, arriving on northerly and northeasterly flow after crossing Lake Huron. That is the whole reason Detroit’s smoke days do not line up with western fire news. June 2023 is the event people here date it from, when Quebec smoke pushed the city to among the worst air quality readings in the world for parts of two days and turned the sky a flat orange.',
      },
      {
        q: 'Where is the wildfire smoke in Detroit coming from?',
        a: 'The Canadian boreal forest by way of Ontario: northern Ontario or Quebec for most events, on northerly and northeasterly flow, usually crossing Lake Huron on the way. Toronto sits under the same plumes about a day earlier, which is why it is the upwind link on this page. Run the timeline backward on the map and the path comes down and across rather than in from the west.',
      },
      {
        q: 'Will the air quality in Detroit be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. Because the source is a day or more upwind in Ontario, the useful move here is to watch what is happening over Toronto and the Lake Huron crossing rather than the current hour over the Detroit River. Forecasts are sharpest one to two days out and the page shows where the models disagree.',
      },
      {
        q: 'How can I tell how smoky it is in Detroit without an app?',
        a: 'Detroit has an international sightline that does the work for you: from Belle Isle, Windsor across the river should read clean with the far shoreline holding. The Ambassador Bridge is the next step. When its towers lose their cables at about five miles, something has arrived. Then the Ren Cen from Hart Plaza. When you can lose Windsor entirely from the riverfront, a half mile across the water, that is the bottom of the scale.',
      },
    ],
  },

  {
    slug: 'milwaukee-wi',
    name: 'Milwaukee',
    region: 'WI',
    label: 'Milwaukee, WI',
    lat: 43.0389,
    lon: -87.9065,
    timezone: 'America/Chicago',
    corridor: 'canadian-smoke-great-lakes-northeast',

    upwind: [
      {
        slug: 'minneapolis-mn',
        note: 'Ontario and Manitoba smoke moving southeast across the upper Midwest reaches the Twin Cities before it reaches the Milwaukee lakefront.',
      },
    ],

    nearby: ['chicago-il', 'minneapolis-mn'],

    bands: ['8+ miles', '4-8 miles', '2-4 miles', '1-2 miles', 'under 1 mile'],

    source:
      'Milwaukee sits on the same Canadian corridor as Chicago and Minneapolis, taking smoke from Ontario, Manitoba, and Quebec on northerly flow across the upper Midwest. Lake Michigan adds a wrinkle: the lake breeze can hold a plume against the shoreline or push it inland depending on the hour, so conditions downtown and conditions ten miles west can differ noticeably.',

    memory:
      'June 2023 put Milwaukee under the same Quebec smoke that hit Chicago and Detroit, with air quality among the worst in the country for parts of two days.',

    landmarks: [
      'From South Shore Park the downtown skyline is sharp three miles north, the Hoan Bridge reads clean, and the horizon over the lake is a hard line.',
      'Downtown still reads from South Shore but has gone flat and grey, and the lake horizon has softened into nothing.',
      'The US Bank Center is still the tallest thing from the south side, three miles off, but the buildings around it have merged into one mass.',
      'From the Art Museum the Hoan Bridge holds about a mile and a half south, while the towers behind downtown fade out.',
      'The top of the US Bank Center goes. From the lakefront you lose the Hoan Bridge under a mile away.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Milwaukee right now?',
        a: 'The verdict at the top of this page answers that for Milwaukee specifically, and Milwaukee is a city where "specifically" carries weight. The lake breeze can hold a plume against the shoreline or push it inland depending on the hour, so the air on the lakefront and the air ten miles west can differ noticeably at the same moment. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Milwaukee?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. Milwaukee has a local reason that answer can wobble. The lake breeze turns through the day, so a plume can be pinned against the shore in the afternoon and released in the evening without anything upwind changing at all, which is exactly the kind of hour-long dip the six-hour hold exists to ignore.',
      },
      {
        q: "Why is Milwaukee's air quality bad today?",
        a: 'The source is the same Canadian corridor that feeds Chicago and Minneapolis: Ontario, Manitoba, and Quebec on northerly flow across the upper Midwest. What Lake Michigan adds is timing rather than cause: it can keep the smoke over the shoreline for hours after the inland air has improved. June 2023 is the local marker, when Quebec smoke put Milwaukee among the worst air quality in the country for parts of two days.',
      },
      {
        q: 'Where is the wildfire smoke in Milwaukee coming from?',
        a: 'Ontario, Manitoba, and Quebec, travelling southeast across the upper Midwest on northerly flow. Minneapolis usually sees it first, which is why it is the upwind link on this page, and Chicago sits under the same plume ninety miles down the shoreline. Run the timeline backward on the map and the plume tracks down across Wisconsin rather than in off the lake.',
      },
      {
        q: 'Will the air quality in Milwaukee be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. One practical note for Milwaukee: if you are choosing between a lakefront plan and an inland one, the lake breeze means the strip is a better guide to the day than the current hour is to the afternoon. Forecasts are sharpest one to two days out and the page shows where the models disagree.',
      },
      {
        q: 'How can I tell how smoky it is in Milwaukee without an app?',
        a: 'The lake horizon is the most sensitive test you have. From South Shore Park it reads as a hard line on a clean day, and it softens into nothing before the skyline looks much different. After that, whether the US Bank Center is still the tallest distinct thing from the south side or has merged into one mass with the buildings around it. The Hoan Bridge from the Art Museum is the close check, and losing it under a mile away is the bottom.',
      },
    ],
  },

  {
    slug: 'cleveland-oh',
    name: 'Cleveland',
    region: 'OH',
    label: 'Cleveland, OH',
    lat: 41.4993,
    lon: -81.6944,
    timezone: 'America/New_York',
    corridor: 'canadian-smoke-great-lakes-northeast',

    upwind: [
      {
        slug: 'detroit-mi',
        note: 'On northwesterly flow the Ontario plume crosses the Detroit River before it crosses Lake Erie to Cleveland.',
      },
      {
        slug: 'toronto-on',
        note: 'Toronto sits at the near end of the same Ontario corridor and gets the smoke thick, a day or so before it reaches the Erie shore.',
      },
    ],

    nearby: ['detroit-mi', 'pittsburgh-pa'],

    bands: ['8+ miles', '4-8 miles', '2-4 miles', '1-2 miles', 'under 1 mile'],

    source:
      'Cleveland sits on the Ontario corridor, taking smoke that crosses Lake Erie on northerly and northwesterly flow from fires in Ontario and Quebec. The lake matters twice: it gives the plume a clean run with nothing to break it up, and the lake breeze can pin it against the shoreline through the afternoon.',

    memory:
      'June 2023 put Cleveland among the worst air quality in the country for parts of two days on Quebec smoke, and it is the event most people here reference.',

    landmarks: [
      'From Edgewater Park the downtown skyline is sharp three miles east, Terminal Tower and Key Tower separate cleanly, and the lake horizon is a hard line.',
      'Downtown still reads from Edgewater but has flattened, and the horizon over Lake Erie has dissolved into grey.',
      'Key Tower is still the tallest thing from Edgewater, three miles off, but the buildings beside it have merged into one shape.',
      'From the lakefront the near downtown buildings hold while the top of Key Tower, a mile out, fades into the haze.',
      'The top of Terminal Tower goes. From Edgewater you can lose the skyline entirely.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Cleveland right now?',
        a: 'The verdict at the top of this page answers that for Cleveland specifically. Lake Erie is the reason it can be a sharper answer here than inland: the lake gives an approaching plume a clean run with nothing to break it up, so smoke crossing the water tends to arrive whole rather than diluted. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Cleveland?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. Lake Erie complicates it at the back end as much as the front. The lake breeze can pin a plume against the shoreline through the afternoon, so the Edgewater lakefront can stay bad while the air a few miles south has already turned, and a clear time is a forecast for the point, not for the county.',
      },
      {
        q: "Why is Cleveland's air quality bad today?",
        a: 'Ontario or Quebec, arriving on northerly and northwesterly flow across Lake Erie. Nothing in the American West needs to be involved, which is why Cleveland smoke days often come as a surprise. June 2023 is the reference here as it is across this whole corridor: Quebec smoke put the city among the worst air quality in the country for parts of two days.',
      },
      {
        q: 'Where is the wildfire smoke in Cleveland coming from?',
        a: 'Ontario and Quebec, with Lake Erie as the last leg. Detroit sits upwind on northwesterly setups and Toronto sits at the near end of the same corridor, getting the smoke thick a day or so earlier, and both are linked below for exactly that reason. Run the timeline backward on the map and the plume comes down over the lake rather than in overland.',
      },
      {
        q: 'Will the air quality in Cleveland be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. The most useful thing to watch for Cleveland is the Lake Erie crossing: once a plume is over the water there is nothing left to break it up, so the question is already answered a day out. Forecasts are sharpest one to two days out and the page shows where the models disagree.',
      },
      {
        q: 'How can I tell how smoky it is in Cleveland without an app?',
        a: 'From Edgewater Park, two things: whether Terminal Tower and Key Tower still separate cleanly three miles east, and whether the lake horizon is still a hard line. The horizon goes first. When Key Tower is still the tallest thing but the buildings beside it have merged into one shape, you are in the middle of the scale. When the top of Terminal Tower goes and the skyline disappears from Edgewater, that is the bottom.',
      },
    ],
  },

  {
    slug: 'toronto-on',
    name: 'Toronto',
    region: 'ON',
    label: 'Toronto, ON',
    lat: 43.6532,
    lon: -79.3832,
    timezone: 'America/Toronto',
    corridor: 'canadian-smoke-great-lakes-northeast',

    // Near the source end: the fires are a few hundred kilometres north and
    // northeast, and no city upwind of that has a page. The downwind chain is
    // taken from this city's own provenance: "What Toronto gets fresh, Detroit and
    // Cleveland get a day later and Boston and New York get a day after that."
    upwind: [],

    downwind: [
      {
        slug: 'detroit-mi',
        note: 'Gets this city’s plume about a day later, after it has crossed Lake Huron.',
      },
      {
        slug: 'cleveland-oh',
        note: 'Same day as Detroit on most setups, arriving across Lake Erie.',
      },
      {
        slug: 'new-york-ny',
        note: 'Two days out. By the time it gets there it has spread into a haze that mixes down through the afternoon.',
      },
      {
        slug: 'boston-ma',
        note: 'The far end of the corridor, and the last stop for smoke that is thick over the Islands today.',
      },
    ],

    nearby: ['detroit-mi', 'cleveland-oh'],

    bands: ['13+ km', '6-13 km', '3-6 km', '1.5-3 km', 'under 1.5 km'],

    source:
      'Toronto is close enough to the source that smoke often arrives thick rather than aged. Fires in northern Ontario and Quebec sit a few hundred kilometres north and northeast, and their smoke reaches the city in well under a day on northerly flow. What Toronto gets fresh, Detroit and Cleveland get a day later and Boston and New York get a day after that.',

    memory:
      'June 2023 gave Toronto some of the worst air quality readings in the world, and the 2023 season overall was the worst wildfire year in Canadian history by area burned.',

    landmarks: [
      'From the Toronto Islands the downtown skyline is sharp three kilometres north, the CN Tower reads clean top to bottom, and the lake horizon is a hard line.',
      'The skyline still reads from the Islands but has gone flat and grey, and the lake horizon has softened out of existence.',
      'The CN Tower is still there from the Islands, three kilometres off, but the bank towers around it have merged into one mass.',
      'From Harbourfront the near towers hold while the top of the CN Tower, a kilometre up, fades into the haze.',
      'The pod on the CN Tower disappears. From the ferry docks you can lose the skyline entirely.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Toronto right now?',
        a: 'The verdict at the top of this page answers that for Toronto specifically. Toronto is near the front of this corridor rather than the end of it: the fires are a few hundred kilometres north and northeast, so smoke gets here in well under a day and arrives thick rather than aged. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Toronto?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. Proximity makes it a more volatile answer here than downwind. Smoke that reaches Boston has spent two days spreading into a broad haze; smoke over Toronto is still shaped like a plume, so it can clear as sharply as it arrived and come back the same way.',
      },
      {
        q: "Why is Toronto's air quality bad today?",
        a: 'Northern Ontario or Quebec, a few hundred kilometres north and northeast, on northerly flow. There is rarely anything more complicated to it, and that is the point: Toronto does not need a long-range transport story to have bad air. June 2023 gave the city some of the worst air quality readings in the world, and the 2023 season overall was the worst wildfire year in Canadian history by area burned.',
      },
      {
        q: 'Where is the wildfire smoke in Toronto coming from?',
        a: 'Northern Ontario and Quebec, a few hundred kilometres away rather than a few thousand. Toronto is the near end of a chain, not a stop on it: what this city gets fresh, Detroit and Cleveland get a day later and Boston and New York get a day after that, thinned out. Run the timeline backward on the map and the plume comes down from the north and northeast.',
      },
      {
        q: 'Will the air quality in Toronto be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers the next forty-eight hours hour by hour. Being close to the source cuts both ways: the model is working inside the window where it is most reliable, and it also has less warning, so a new start a few hundred kilometres north can rewrite the day. The page shows where the models disagree rather than hiding the spread.',
      },
      {
        q: 'How can I tell how smoky it is in Toronto without an app?',
        a: 'The CN Tower is the most legible visibility instrument on this corridor, because you can read it vertically as well as horizontally. From the Islands, three kilometres north, it should read clean top to bottom on a good day. When the bank towers around it merge into one mass, you are in the middle. When the pod itself disappears from Harbourfront and the skyline goes from the ferry docks, that is the bottom of the scale.',
      },
    ],
  },

  {
    slug: 'boston-ma',
    name: 'Boston',
    region: 'MA',
    label: 'Boston, MA',
    lat: 42.3601,
    lon: -71.0589,
    timezone: 'America/New_York',
    corridor: 'canadian-smoke-great-lakes-northeast',

    upwind: [
      {
        slug: 'toronto-on',
        note: 'Quebec and Ontario smoke reaches Toronto thick and unaged, roughly two days before the same plume arrives over New England as a high haze.',
      },
    ],

    nearby: ['new-york-ny'],

    bands: ['10+ miles', '5-10 miles', '2-5 miles', '1-2 miles', 'under 1 mile'],

    source:
      'Boston is at the far downwind end of the Quebec corridor. Fires in Quebec and Ontario sit north and northwest, and their smoke reaches New England on northerly flow after a day or more aloft, which means it often arrives as a high haze before descending. Boston also catches smoke from Nova Scotia and New Brunswick on the rarer easterly setups.',

    memory:
      'June 2023 is the event that changed local awareness, when Quebec smoke pushed Boston into unhealthy air for multiple days and the sun went orange in the middle of the afternoon.',

    landmarks: [
      'From Castle Island the downtown skyline is sharp three miles northwest, and the Blue Hills read clean on the southern horizon about ten miles out.',
      'The Blue Hills have gone. Downtown still reads from Castle Island but has flattened, and the harbor islands have lost their trees.',
      'The Prudential and 200 Clarendon still mark the skyline from South Boston, three miles off, but everything behind them has merged.',
      'From the Harborwalk the near towers hold while the tops of the tallest buildings, a bit over a mile away, fade into the haze.',
      'The top of 200 Clarendon goes. From the waterfront you can lose the far side of the harbor entirely.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Boston right now?',
        a: 'The verdict at the top of this page answers that for Boston specifically. Boston sits at the far end of the Quebec corridor, and distance changes the shape of the problem: smoke arriving here has usually spent a day or more aloft, so it often shows up as a high haze overhead before it is anything you are breathing. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Boston?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. Being far downwind makes it a steadier answer than it is in Toronto. An aged plume is broad rather than sharp, so it comes and goes slowly. The trade is that it also lingers, which is what June 2023 looked like here: multiple days rather than one bad afternoon.',
      },
      {
        q: "Why is Boston's air quality bad today?",
        a: 'Usually Quebec or Ontario, north and northwest, after a day or more in transit. There is a second, rarer case worth knowing about that no other page on this site has: on easterly setups Boston catches smoke from Nova Scotia and New Brunswick, coming in off the water rather than down from the interior. June 2023 is the event that changed local awareness, when the sun went orange in the middle of the afternoon.',
      },
      {
        q: 'Where is the wildfire smoke in Boston coming from?',
        a: 'Quebec and Ontario for most events, arriving on northerly flow after a day or more aloft. Nova Scotia and New Brunswick supply the rarer easterly version. Toronto is the useful upwind check on the common case, sitting under the same Quebec plumes roughly two days earlier and getting them thick. Run the timeline backward on the map and the transit shows.',
      },
      {
        q: 'Will the air quality in Boston be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. Boston gets the longest warning of any city on this corridor, because the smoke has to cross Ontario and New York State first, so the five-day view here is worth more than it is upwind. Forecasts are sharpest one to two days out and the page shows where the models disagree.',
      },
      {
        q: 'How can I tell how smoky it is in Boston without an app?',
        a: 'The Blue Hills on the southern horizon are the far check at about ten miles from Castle Island, and they go first. Then the harbor islands losing their trees while downtown flattens. Then whether the Prudential and 200 Clarendon still mark the skyline from South Boston or everything behind them has merged. When the top of 200 Clarendon goes and the far side of the harbor disappears from the waterfront, that is the bottom.',
      },
    ],
  },

  {
    slug: 'new-york-ny',
    name: 'New York',
    region: 'NY',
    label: 'New York, NY',
    lat: 40.7128,
    lon: -74.006,
    timezone: 'America/New_York',
    corridor: 'canadian-smoke-great-lakes-northeast',

    upwind: [
      {
        slug: 'toronto-on',
        note: 'The Quebec and Ontario plumes that reach New York cross Toronto about two days earlier, thick and unaged, before spreading out over the Northeast.',
      },
    ],

    nearby: ['philadelphia-pa', 'boston-ma'],

    bands: ['10+ miles', '5-10 miles', '2-5 miles', '1-2 miles', 'under 1 mile'],

    source:
      'New York sits at the end of the same Quebec and Ontario corridor that runs through the Great Lakes, but far enough downwind that smoke usually arrives aloft and then mixes down. That delay is why the city often gets clear morning air followed by a visibly bad afternoon on the same plume.',

    memory:
      'June 7, 2023 is the reference. Quebec smoke gave New York the worst air quality of any major city in the world, turned the sky orange, grounded flights, and produced the images that most Americans now picture when they hear the phrase wildfire smoke.',

    landmarks: [
      'From the Brooklyn Heights Promenade the Lower Manhattan skyline is sharp a mile across the East River, and the Verrazzano reads clean about six miles south.',
      'The Verrazzano has flattened to a silhouette and the harbor has gone grey, but One World Trade holds its shape from Brooklyn.',
      'From Brooklyn the Manhattan skyline is still there but the buildings have merged into one mass, and the Statue of Liberty has gone soft.',
      'The near towers hold from the Promenade while the top of One World Trade, a mile off, fades into the haze.',
      'The upper floors of One World Trade and the Empire State Building disappear. From Brooklyn you can lose Manhattan entirely.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in New York right now?',
        a: 'The verdict at the top of this page answers that for New York specifically, and the hour matters more here than almost anywhere. Because the city is far enough downwind that smoke arrives aloft and then mixes down, a clean morning and a visibly bad afternoon on the same plume is an ordinary New York pattern, so a reading taken at 8am does not describe 3pm. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in New York?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. The mixing-down pattern is why the six-hour hold earns its keep here. Smoke sitting aloft can leave the surface air briefly clean while the plume is still overhead, and a forecast that called that the all-clear would be reversed by mid-afternoon.',
      },
      {
        q: "Why is New York's air quality bad today?",
        a: 'Quebec and Ontario, at the end of the same corridor that runs through the Great Lakes, usually a couple of days after the fires put the smoke in the air. June 7, 2023 is the reference and the reason most Americans have a mental image for this at all: Quebec smoke gave New York the worst air quality of any major city in the world, turned the sky orange, and grounded flights.',
      },
      {
        q: 'Where is the wildfire smoke in New York coming from?',
        a: 'Quebec and Ontario, arriving aloft after a day or more in transit down the Great Lakes corridor. New York is the far end rather than a waypoint: Toronto sits under the same plumes about two days earlier and gets them thick, which is why it is the upwind link here. Run the timeline backward on the map and the plume comes down from the northwest, spreading out as it travels.',
      },
      {
        q: 'Will the air quality in New York be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. New York gets a long warning. The smoke has to cross Ontario, the Lakes, and upstate New York first, so the five-day view is unusually useful here. The thing it cannot tell you cleanly is what time of day the plume mixes down, which is why the hour-by-hour timeline is worth reading alongside it.',
      },
      {
        q: 'How can I tell how smoky it is in New York without an app?',
        a: 'From the Brooklyn Heights Promenade the Verrazzano about six miles south is the far check and goes first. Then the Statue of Liberty going soft while the Manhattan buildings merge into one mass. Then the top of One World Trade a mile off. When its upper floors and the Empire State Building disappear and you can lose Manhattan entirely from Brooklyn, that is the bottom of the scale, and it is exactly what June 2023 looked like.',
      },
    ],
  },

  {
    slug: 'philadelphia-pa',
    name: 'Philadelphia',
    region: 'PA',
    label: 'Philadelphia, PA',
    lat: 39.9526,
    lon: -75.1652,
    timezone: 'America/New_York',
    corridor: 'canadian-smoke-great-lakes-northeast',

    upwind: [
      {
        slug: 'new-york-ny',
        note: 'The Quebec plumes that reach Philadelphia arrive on the same northerly flow that crosses the New York metro first.',
      },
      {
        slug: 'pittsburgh-pa',
        note: 'On northwesterly setups the Ontario smoke crosses the state and sits in the Pittsburgh river valleys before it reaches the Delaware.',
      },
    ],

    nearby: ['new-york-ny', 'pittsburgh-pa'],

    bands: ['8+ miles', '4-8 miles', '2-4 miles', '1-2 miles', 'under 1 mile'],

    source:
      "Philadelphia takes Canadian smoke on the same northerly flow that brings it to New York and Boston, arriving from Quebec and Ontario after a day or more in transit. The city's own summer haze from humidity and ozone is a separate thing, which is why hazy days here are not automatically smoke days and the source matters.",

    memory:
      'June 2023 is the local marker, when Quebec smoke pushed Philadelphia into the worst air quality category and the skyline went orange-brown for parts of two days.',

    notSmoke:
      'Most hazy summer days in Philadelphia are humidity, not smoke. Mid-Atlantic moisture scatters light the same way fine particles do, which flattens the skyline and softens the horizon on a perfectly clean air day. The tell is colour and smell: humid haze stays white or blue-grey and smells like nothing. Smoke goes yellow-brown at the horizon and you can smell it before you can see it.',

    landmarks: [
      'From Belmont Plateau the Center City skyline is sharp about four miles southeast, and the towers read individually against a clean sky.',
      'The skyline still reads from Belmont Plateau but has gone flat, and the buildings behind Comcast have lost their separation.',
      'From the Art Museum steps the Comcast towers hold a mile and a half off, while City Hall and the buildings around it soften.',
      'From the Camden waterfront the near Center City towers hold across the river, a mile out, while the tops start to disappear.',
      'The crown of the Comcast Technology Center goes. From the Schuylkill banks you can lose Center City entirely.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Philadelphia right now?',
        a: 'The verdict at the top of this page answers that for Philadelphia specifically, and in this city it is worth reading against your own eyes rather than instead of them. Most hazy summer days here are Mid-Atlantic humidity rather than smoke, so the verdict can read All clear on an afternoon when the skyline has genuinely flattened. The section above on what is not smoke gives you the tell. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Philadelphia?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. It is a smoke clear time and nothing else. Humid haze runs on its own schedule and a muggy Philadelphia afternoon can stay soft for a week regardless of what this page says, because moisture scatters light the same way fine particles do without being fine particles.',
      },
      {
        q: "Why is Philadelphia's air quality bad today?",
        a: 'The question splits in two here more than on most pages. If the horizon is white or blue-grey and smells like nothing, that is humidity and ozone, and it is a local Mid-Atlantic summer problem. If the horizon is yellow-brown and you could smell it before you saw it, that is Quebec or Ontario smoke on northerly flow after a day or more in transit, which is what June 2023 was, when the skyline went orange-brown for parts of two days.',
      },
      {
        q: 'Where is the wildfire smoke in Philadelphia coming from?',
        a: 'Quebec and Ontario, on the same northerly flow that brings it to New York and Boston, arriving after a day or more aloft. New York usually sits under it first, and on northwesterly setups Pittsburgh gets it earlier still and holds it in the river valleys, and both are linked below. Run the timeline backward on the map and the smoke path is visible, which is the fastest way to separate a smoke day from a humid one.',
      },
      {
        q: 'Will the air quality in Philadelphia be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. If the current haze is humidity rather than smoke, this page is the wrong instrument for the question and a plain weather forecast is the right one. The strip will happily show clean air behind a sky that stays soft. Smoke forecasts are sharpest one to two days out and the page shows the spread.',
      },
      {
        q: 'How can I tell how smoky it is in Philadelphia without an app?',
        a: 'Belmont Plateau is the far vantage: about four miles to Center City, with the towers reading individually against a clean sky. When the buildings behind Comcast lose their separation, something is in the air. Then the Comcast towers from the Art Museum steps, then the crown of the Comcast Technology Center. But check colour at every step: white or blue-grey is water, yellow-brown at the horizon is smoke.',
      },
    ],
  },

  {
    slug: 'pittsburgh-pa',
    name: 'Pittsburgh',
    region: 'PA',
    label: 'Pittsburgh, PA',
    lat: 40.4406,
    lon: -79.9959,
    timezone: 'America/New_York',
    corridor: 'canadian-smoke-great-lakes-northeast',

    upwind: [
      {
        slug: 'cleveland-oh',
        note: 'Ontario smoke crossing Lake Erie hits the Cleveland shoreline before it reaches the Allegheny plateau and settles into the valleys here.',
      },
      {
        slug: 'detroit-mi',
        note: 'On northwesterly flow the same Ontario plume passes Detroit a day or so ahead of the Pittsburgh river valleys.',
      },
    ],

    nearby: ['cleveland-oh', 'philadelphia-pa'],

    bands: ['8+ miles', '4-8 miles', '2-4 miles', '0.75-2 miles', 'under 0.75 miles'],

    source:
      'Pittsburgh gets Canadian smoke on northerly flow from Ontario and Quebec, but the city has a second problem that makes it unusual: river valley inversions. Cool air settles into the valleys overnight and caps them, holding whatever is in the air at ground level well into the morning. That means a smoke plume that would pass over a flatter city can sit here.',

    memory:
      'The inversion behavior predates wildfire smoke by a century and is the reason Pittsburgh has an air quality culture at all. June 2023 layered Quebec smoke on top of it and produced some of the worst readings in the country.',

    notSmoke:
      "Pittsburgh's valley fog and inversion haze predate wildfire smoke by a century. Cool air settles into the river valleys overnight and holds moisture and local emissions at ground level well into the morning, which flattens the view from Mount Washington on days with clean regional air. Fog burns off by late morning. Smoke does not.",

    landmarks: [
      'From the Mount Washington overlook the Golden Triangle is sharp below, the Cathedral of Learning reads clean three miles east, and the river valleys hold their far bends.',
      'The Cathedral of Learning has gone flat, and the Allegheny and Monongahela valleys lose their far ends into grey.',
      'From Mount Washington the downtown towers still separate but the hills behind them, three miles out, have become one silhouette.',
      'The Point holds from the overlook, under a mile below, while the tops of the tallest downtown buildings fade.',
      'The top of the US Steel Tower goes. From Mount Washington you can lose the Golden Triangle a half mile below you.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Pittsburgh right now?',
        a: 'The verdict at the top of this page answers that for Pittsburgh specifically, and it is reading the valley floor rather than the plateau. That is the number that matters here: cool air settles into the river valleys overnight and caps them, so the air down at the Point and the air up on the ridge can be two different readings at the same hour. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Pittsburgh?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. Pittsburgh is the eastern city where that answer is least about the wind. The valleys cap themselves overnight and hold whatever is in them well into the morning, so a plume that would have passed over a flatter city sits here, and the clear time has to wait for the cap to break, not just for the flow to change.',
      },
      {
        q: "Why is Pittsburgh's air quality bad today?",
        a: 'Two mechanisms, and the honest answer is often both at once. The smoke comes from Ontario and Quebec on northerly flow, the same as the rest of this corridor. The valleys then keep it. June 2023 is the local marker precisely because it layered Quebec smoke on top of an inversion and produced some of the worst readings in the country. The fire was in Canada, but the reason it was that bad here was the terrain.',
      },
      {
        q: 'Where is the wildfire smoke in Pittsburgh coming from?',
        a: 'Ontario and Quebec, on northerly flow. Cleveland sits upwind across Lake Erie and Detroit sits upwind on northwesterly setups, both a day or so ahead, and both are linked below. What Pittsburgh adds is not a source but a trap: the inversion behaviour predates wildfire smoke by a century and is the reason this city has an air quality culture at all. Run the timeline backward on the map to see the plume arrive.',
      },
      {
        q: 'Will the air quality in Pittsburgh be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. The pattern to watch for in Pittsburgh is mornings: an inversion means the day often starts worse than it ends, so a bad 7am reading is not necessarily a bad afternoon. Forecasts are sharpest one to two days out and the page shows where the models disagree.',
      },
      {
        q: 'How can I tell how smoky it is in Pittsburgh without an app?',
        a: 'Mount Washington is the vantage and it gives you two axes: out to the Cathedral of Learning three miles east, and down into the Allegheny and Monongahela valleys to see whether their far bends still hold. Then whether the hills behind downtown have become one silhouette. One local caveat the other cities on this corridor do not need: valley fog does all of this too, and the difference is that fog burns off by late morning and smoke does not.',
      },
    ],
  },

  {
    slug: 'portland-or',
    name: 'Portland',
    region: 'OR',
    label: 'Portland, OR',
    lat: 45.5152,
    lon: -122.6784,
    timezone: 'America/Los_Angeles',
    corridor: 'wildfire-smoke-pacific-northwest-northern-rockies',

    upwind: [
      {
        slug: 'sacramento-ca',
        note: 'Northern California smoke reaching the Willamette Valley on southerly flow crosses the Central Valley first, where it pools before moving north.',
      },
      {
        slug: 'fresno-ca',
        note: 'In heavy California seasons the San Joaquin is the far upwind end of the same north-bound flow that eventually reaches Oregon.',
      },
    ],

    nearby: ['seattle-wa', 'bend-or'],

    bands: ['45+ miles', '15-45 miles', '5-15 miles', '2-5 miles', 'under 2 miles'],

    source:
      "Portland's smoke comes from the Cascades, southern and eastern Oregon, northern California, and on the worst setups from all of them at once. The Columbia River Gorge is the local wrinkle: east winds funnel smoke straight down the gorge into the metro, which is fast, concentrated, and hard to forecast more than a day out.",

    memory:
      'September 2020 is the event nobody here has forgotten. East winds drove the Riverside, Beachie Creek, and Holiday Farm fires toward the valley and gave Portland the worst air quality on earth for several days, with ash falling in the city.',

    landmarks: [
      'Mount Hood is sharp to the east, about fifty miles out, and St. Helens reads clean to the north across the Columbia.',
      'Hood has gone. St. Helens is a flat grey shape, and the West Hills have lost their depth.',
      'Both volcanoes are gone entirely. The West Hills, about five miles west of downtown, are the furthest thing with any texture.',
      'From the Eastbank Esplanade the downtown towers hold a mile across the river, while the hills behind them vanish.',
      'The top of the US Bancorp Tower goes. From the east side you can lose downtown across the Willamette.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Portland right now?',
        a: 'The verdict at the top of this page answers that for Portland specifically, and it is a city where checking again in six hours is genuinely worth doing. The Columbia River Gorge can funnel east winds and smoke straight into the metro fast enough that the morning forecast is out of date by afternoon. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Portland?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. Portland has the least reliable version of that answer on this corridor, and the gorge is why. East-wind events are fast, concentrated, and hard to forecast more than a day out, so the page shows the model disagreement rather than pretending to a confidence it does not have.',
      },
      {
        q: "Why is Portland's air quality bad today?",
        a: 'The Cascades, southern and eastern Oregon, or northern California, and on the worst setups all of them at once. But the mechanism people here watch for is the gorge: east winds turn it into a funnel and deliver smoke to the metro directly rather than letting it drift in. September 2020 is the reference, when east winds drove the Riverside, Beachie Creek, and Holiday Farm fires toward the valley and ash fell in the city.',
      },
      {
        q: 'Where is the wildfire smoke in Portland coming from?',
        a: 'The Cascade crest, southern and eastern Oregon, and northern California, with the Columbia River Gorge as the delivery mechanism on east-wind setups. Sacramento is the useful upwind check in a bad California year, since northern California smoke pools in the Central Valley before it moves north. Run the timeline backward on the map: gorge-driven smoke comes in as a line down the river, not as a general haze.',
      },
      {
        q: 'Will the air quality in Portland be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. The gorge caveat applies to the whole forecast: east-wind events are the hardest thing on this corridor to see coming, so a clean five-day strip is less of a guarantee in Portland than the same strip would be in Seattle. Forecasts are sharpest one to two days out.',
      },
      {
        q: 'How can I tell how smoky it is in Portland without an app?',
        a: 'Two volcanoes, which is a check almost nowhere else gets. Mount Hood to the east at about fifty miles goes first; St. Helens to the north across the Columbia goes next, flattening to a grey shape. When both are gone entirely and the West Hills are the furthest thing with any texture left, it is well in. When the top of the US Bancorp Tower goes and downtown disappears across the Willamette, that is the bottom.',
      },
    ],
  },

  {
    slug: 'bend-or',
    name: 'Bend',
    region: 'OR',
    label: 'Bend, OR',
    lat: 44.0582,
    lon: -121.3153,
    timezone: 'America/Los_Angeles',
    corridor: 'wildfire-smoke-pacific-northwest-northern-rockies',

    upwind: [
      {
        slug: 'fresno-ca',
        note: 'Northern and central California smoke that reaches the high desert rides north up the same interior flow that fills the San Joaquin first.',
      },
      {
        slug: 'sacramento-ca',
        note: 'Sacramento sits at the Central Valley end of that flow, and a bad northern California year shows up there before it crosses into central Oregon.',
      },
    ],

    nearby: ['portland-or'],

    bands: ['25+ miles', '12-25 miles', '5-12 miles', '1.5-5 miles', 'under 1.5 miles'],

    source:
      'Bend sits on the dry east side of the Cascades, surrounded by fire country in every direction. Smoke arrives from the Cascade crest, from central and southern Oregon, from northern California, and from as far as Idaho and Washington. The high desert also means clear, cold nights that settle smoke into the basin overnight, so mornings often read worse than afternoons.',

    memory:
      'The 2017, 2020, and 2021 seasons all produced multi-week stretches where the Sisters were not visible from town, which is the local shorthand for how bad a summer was.',

    landmarks: [
      'The Three Sisters stand clean to the west, about twenty-five miles out, and Broken Top and Bachelor separate individually along the ridge.',
      'The Sisters have flattened into one blue shape and Broken Top has lost its notch, though Bachelor still marks the southwest.',
      'The Cascades are gone. Awbrey Butte, a couple of miles from downtown, is the furthest thing that still has trees on it.',
      'From the top of Pilot Butte the town holds below, but the west side of Bend, three miles out, disappears into grey.',
      'From downtown you lose Pilot Butte, a mile east, and the mountains might as well not exist.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Bend right now?',
        a: 'The verdict at the top of this page answers that for Bend specifically, and the time of day it says matters. High desert nights are clear and cold, which settles smoke into the basin overnight, so Bend mornings often read worse than Bend afternoons on the same plume. A 7am reading and a 3pm reading are two different answers rather than one drifting. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Bend?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. The overnight settling is why the six-hour hold is worth its cost here. Bend can improve through an afternoon and then fill again after dark without a single thing changing upwind, so a one-hour dip is a very poor guide to the next day in this basin.',
      },
      {
        q: "Why is Bend's air quality bad today?",
        a: 'Bend is surrounded by fire country in every direction: the Cascade crest to the west, central and southern Oregon around it, northern California to the south, and Idaho and Washington far enough out to still count. So the arriving-smoke question usually has more than one answer. The second half is the basin: clear cold nights settle it in, which means a bad Bend morning does not require anything new to have started.',
      },
      {
        q: 'Where is the wildfire smoke in Bend coming from?',
        a: 'The Cascade crest immediately west, central and southern Oregon, northern California, and on the longer setups Idaho and Washington. Being on the dry east side of the Cascades means Bend does not get the marine air that flushes the Willamette Valley, so what arrives tends to stay. Run the timeline backward on the map and the direction it came in from is visible rather than inferred.',
      },
      {
        q: 'Will the air quality in Bend be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. Bend’s bad seasons have run in weeks rather than days. 2017, 2020, and 2021 all produced multi-week stretches, so the strip is the more honest instrument here than the next hour. Forecasts are sharpest one to two days out and the page shows the spread.',
      },
      {
        q: 'How can I tell how smoky it is in Bend without an app?',
        a: 'Look west at the Three Sisters, twenty-five miles out, with Broken Top and Bachelor separating individually along the ridge on a clean day. When the Sisters flatten into one blue shape and Broken Top loses its notch, something has arrived. Awbrey Butte still having trees on it is the middle. When you lose Pilot Butte from downtown, a mile east, the mountains might as well not exist.',
      },
    ],
  },

  {
    slug: 'boise-id',
    name: 'Boise',
    region: 'ID',
    label: 'Boise, ID',
    lat: 43.615,
    lon: -116.2023,
    timezone: 'America/Boise',
    corridor: 'wildfire-smoke-pacific-northwest-northern-rockies',

    upwind: [
      {
        slug: 'reno-nv',
        note: 'Great Basin and northern Sierra smoke arriving on southwesterly flow crosses the Truckee Meadows before it reaches the Treasure Valley.',
      },
      {
        slug: 'sacramento-ca',
        note: 'In a bad California year the northern California smoke that ends up over Boise pools in the Central Valley first.',
      },
    ],

    nearby: ['spokane-wa', 'salt-lake-city-ut'],

    bands: ['16+ miles', '8-16 miles', '3-8 miles', '1-3 miles', 'under 1 mile'],

    source:
      "Boise is surrounded by fire country and sits in a valley that holds what arrives. Smoke comes from central Idaho, eastern Oregon, Nevada, and on bad years from California and the Pacific Northwest, riding southwesterly and westerly flow into the Treasure Valley. The valley's own geometry does the rest, trapping smoke against the foothills for days after the flow shifts.",

    memory:
      'The 2020 and 2021 seasons both put Boise into extended stretches of unhealthy air, and the Treasure Valley has repeatedly recorded some of the worst readings in the country during peak weeks.',

    landmarks: [
      'Shafer Butte reads clean above Bogus Basin, about sixteen miles north, and the Owyhees hold the far southwest horizon.',
      'Shafer Butte has flattened to a blue shape and the Owyhees are gone, though the Boise Front still shows its ridgelines.',
      'The foothills reduce to a silhouette. Table Rock, about three miles east of downtown, is the furthest thing with texture.',
      'From the Greenbelt the downtown towers hold about a mile off, while the foothills behind them vanish entirely.',
      'The top of the Zions Bank building goes. From the Boise River you lose downtown.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Boise right now?',
        a: 'The verdict at the top of this page answers that for Boise specifically, reading the model over the Treasure Valley floor. That is the number worth having, because the valley traps smoke against the foothills, so the air along the Greenbelt can be meaningfully worse than the air a few hundred feet up the Boise Front on the same afternoon. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Boise?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. The Treasure Valley’s geometry is the reason it can lag. Smoke gets held against the foothills for days after the flow that delivered it has shifted, so the clear time here is a forecast about the valley emptying rather than about the wind turning.',
      },
      {
        q: "Why is Boise's air quality bad today?",
        a: 'Central Idaho, eastern Oregon, and Nevada are the near sources, with California and the Pacific Northwest adding to it in bad years on southwesterly and westerly flow. But the Treasure Valley is half the answer on any given day, because it holds what it is given, which is how this valley has repeatedly recorded some of the worst readings in the country during peak weeks without being the closest place to a fire.',
      },
      {
        q: 'Where is the wildfire smoke in Boise coming from?',
        a: 'Central Idaho and eastern Oregon most often, Nevada and the Great Basin on southerly setups, and California and the Pacific Northwest on the bad years. Reno is the upwind check on the Great Basin and northern Sierra case, sitting on the same southwesterly flow a step earlier. Run the timeline backward on the map and the approach direction sorts the near sources from the far ones.',
      },
      {
        q: 'Will the air quality in Boise be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. Boise’s bad stretches have run long. 2020 and 2021 both produced extended runs of unhealthy air, and because the valley holds smoke after the flow shifts, "the wind changed" is not the same as "tomorrow is clear." Forecasts are sharpest one to two days out and the page shows the spread.',
      },
      {
        q: 'How can I tell how smoky it is in Boise without an app?',
        a: 'Shafer Butte above Bogus Basin is the north check at about sixteen miles, and the Owyhees on the far southwest horizon are the other end of the same reading. When Shafer flattens and the Owyhees go but the Boise Front still shows its ridgelines, smoke has arrived. Table Rock three miles east is the middle. When the top of the Zions Bank building goes and downtown disappears from the Boise River, that is the bottom.',
      },
    ],
  },

  {
    slug: 'salt-lake-city-ut',
    name: 'Salt Lake City',
    region: 'UT',
    label: 'Salt Lake City, UT',
    lat: 40.7608,
    lon: -111.891,
    timezone: 'America/Denver',
    corridor: 'wildfire-smoke-california-great-basin',

    upwind: [
      {
        slug: 'reno-nv',
        note: 'The westerly and southwesterly flow that fills the Salt Lake bowl crosses the Truckee Meadows first, straight off the Sierra crest.',
      },
      {
        slug: 'sacramento-ca',
        note: 'Northern California smoke bound for Utah pools in the Central Valley before it rides east over the Great Basin.',
      },
    ],

    nearby: ['boise-id', 'denver-co'],

    bands: ['20+ miles', '10-20 miles', '4-10 miles', '1.5-4 miles', 'under 1.5 miles'],

    source:
      'Salt Lake sits in a bowl between two ranges, which is the whole story. Smoke arrives from California, Nevada, Oregon, and Idaho on westerly and southwesterly flow, and once it is in the valley the mountains keep it there. The city already has a winter inversion problem for the same geographic reason, so the mechanism is familiar even when the source is new.',

    memory:
      'The 2020 and 2021 seasons put Salt Lake among the worst air quality in the world on multiple days, and the 2021 summer in particular ran long stretches where the Oquirrhs were not visible from downtown.',

    notSmoke:
      "Salt Lake's winter inversion is the same trapping mechanism as summer smoke and a completely different pollutant. Cold air settles into the valley, caps it, and holds local emissions at ground level for days. It looks identical from the Avenues. The season tells you which one you are in: inversions run December through February, smoke runs July through September.",

    landmarks: [
      'Twin Peaks and the Wasatch crest read sharp to the southeast, and the Oquirrhs hold their ridgeline about fifteen miles west across the valley.',
      'The Oquirrhs have gone flat and grey, and the canyons in the Wasatch have lost their shadows.',
      'The Oquirrhs disappear. The Wasatch front reduces to a silhouette four miles east with no canyon detail at all.',
      'From Liberty Park the downtown towers hold two miles north, while the mountains behind them vanish.',
      'The top of the Wells Fargo Center goes. From the Avenues you can lose the valley floor below you.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Salt Lake City right now?',
        a: 'The verdict at the top of this page answers that for Salt Lake specifically, and it answers the smoke question rather than the haze question. Those come apart here twice a year: a capped valley in January looks identical from the Avenues to a capped valley in August, and only one of them is smoke. The section above on what is not smoke covers it. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Salt Lake City?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. A bowl between two ranges is slow to give that up. Once smoke is in this valley the mountains keep it there, so the clear time is usually a forecast about the bowl emptying rather than about the flow off the Sierra turning, and 2021 ran long stretches where it did not empty at all.',
      },
      {
        q: "Why is Salt Lake City's air quality bad today?",
        a: 'If it is July through September, the likely answer is smoke from California, Nevada, Oregon, or Idaho on westerly and southwesterly flow, held in the valley by the ranges on either side. If it is December through February, the same trapping mechanism is holding local emissions instead and nothing is burning. Salt Lake residents already know the mechanism from winter; the summer version just changes what is in the air.',
      },
      {
        q: 'Where is the wildfire smoke in Salt Lake City coming from?',
        a: 'California, Nevada, Oregon, and Idaho, arriving on westerly and southwesterly flow across the Great Basin. Reno is the upwind check on the Sierra cases and Sacramento on the northern California ones, both linked below. Once it is here the source stops mattering much, because the bowl treats all of it the same way. Run the timeline backward on the map to see which door it came in.',
      },
      {
        q: 'Will the air quality in Salt Lake City be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. In a valley that holds what it is given, the five-day view is the one worth reading. 2020 and 2021 both put Salt Lake among the worst air quality in the world on multiple days, and those were not single-day events. Forecasts are sharpest one to two days out and the page shows the spread.',
      },
      {
        q: 'How can I tell how smoky it is in Salt Lake City without an app?',
        a: 'Look west across the valley at the Oquirrhs, about fifteen miles out. They are the far check and they go first, while Twin Peaks and the Wasatch crest are still readable to the southeast. Then whether the Wasatch canyons still have shadows in them. When the Wasatch front is a silhouette four miles east with no canyon detail, it is well in. From the Avenues, losing the valley floor below you is the bottom.',
      },
    ],
  },

  {
    slug: 'reno-nv',
    name: 'Reno',
    region: 'NV',
    label: 'Reno, NV',
    lat: 39.5296,
    lon: -119.8138,
    timezone: 'America/Los_Angeles',
    corridor: 'wildfire-smoke-california-great-basin',

    upwind: [
      {
        slug: 'sacramento-ca',
        note: 'Northern Sierra and northern California smoke crosses the Central Valley before it comes over the crest into the Truckee Meadows.',
      },
      {
        slug: 'fresno-ca',
        note: 'On southerly setups the San Joaquin is the upwind end of the flow that carries California smoke up into western Nevada.',
      },
    ],

    nearby: ['sacramento-ca', 'salt-lake-city-ut'],

    bands: ['15+ miles', '7-15 miles', '3-7 miles', '1-3 miles', 'under 1 mile'],

    source:
      "Reno sits directly downwind of the northern Sierra and northern California, which is the worst possible address in a bad California fire year. Smoke crosses the crest on westerly flow and drops into the Truckee Meadows, and the surrounding ridges hold it. Nevada's own Great Basin fires add to it on southerly and easterly setups.",

    memory:
      'The 2018 Camp Fire, the 2020 season, and the 2021 Dixie Fire all buried Reno for extended stretches, with 2021 producing weeks of degraded air and repeated school and event cancellations.',

    landmarks: [
      'Mount Rose is sharp to the southwest, about fifteen miles out, and Peavine Peak holds its ridgeline to the northwest.',
      'Mount Rose has flattened to a blue shape and Slide Mountain beside it has lost its scar, though Peavine still reads.',
      'The Sierra crest is gone entirely. Peavine, about seven miles northwest, is a silhouette with no texture left.',
      'From the Truckee River path the downtown towers hold a mile off, while the hills ringing the valley vanish.',
      'The top of the Grand Sierra goes. From midtown you can lose downtown Reno.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Reno right now?',
        a: 'The verdict at the top of this page answers that for Reno specifically. Reno is the one city on this site whose address is the whole problem: it sits directly downwind of the northern Sierra and northern California, so in a bad California fire year the answer here is bad more often than almost anywhere. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Reno?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. Reno gets the worst of both halves. Smoke crosses the Sierra crest on westerly flow, and then the ridges ringing the Truckee Meadows hold it, so the arrival is fast and the departure is not. The 2021 Dixie Fire ran weeks of degraded air here, with repeated school and event cancellations.',
      },
      {
        q: "Why is Reno's air quality bad today?",
        a: 'Most likely the northern Sierra or northern California, with the smoke coming over the crest on westerly flow and dropping into the Truckee Meadows. Nevada’s own Great Basin fires add to it on southerly and easterly setups. The 2018 Camp Fire, the 2020 season, and the 2021 Dixie Fire are the three events people here measure against, and all of them buried the valley for extended stretches.',
      },
      {
        q: 'Where is the wildfire smoke in Reno coming from?',
        a: 'Over the Sierra crest from the northern Sierra and northern California on westerly flow, which is the common case, or up out of the Great Basin on southerly and easterly setups. Sacramento is the upwind check on the California case, sitting in the Central Valley a step earlier on the same flow. Run the timeline backward on the map and you can watch the plume come over the crest.',
      },
      {
        q: 'Will the air quality in Reno be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. In Reno the strip is the one to read, because the ridges mean a plume that has arrived does not leave on the next shift. 2021 is the reference for how long that can run. Forecasts are sharpest one to two days out and the page shows where the models disagree.',
      },
      {
        q: 'How can I tell how smoky it is in Reno without an app?',
        a: 'Mount Rose to the southwest is the far check at about fifteen miles, and Slide Mountain beside it is the fine one. When its scar stops reading, something has arrived even if Peavine to the northwest still looks fine. When the Sierra crest is gone entirely and Peavine is a silhouette with no texture, it is well in. Losing downtown from midtown is the bottom of the scale.',
      },
    ],
  },

  {
    slug: 'sacramento-ca',
    name: 'Sacramento',
    region: 'CA',
    label: 'Sacramento, CA',
    lat: 38.5816,
    lon: -121.4944,
    timezone: 'America/Los_Angeles',
    corridor: 'wildfire-smoke-california-great-basin',

    upwind: [
      {
        slug: 'fresno-ca',
        note: 'The Central Valley drains as one system, so on southerly flow the San Joaquin fills before the Sacramento Valley does.',
      },
    ],

    nearby: ['fresno-ca', 'reno-nv'],

    bands: ['40+ miles', '15-40 miles', '5-15 miles', '1.5-5 miles', 'under 1.5 miles'],

    source:
      'Sacramento sits at the bottom of a valley with mountains on three sides, which means it collects smoke from all of them. Fires in the northern Sierra, the Coast Range, and the foothills all drain into the Central Valley, and the valley holds smoke the way a bowl holds water. The Delta breeze is the only reliable flush, and when it fails the air stays put.',

    memory:
      'The 2018 Camp Fire is the reference: smoke from Paradise, ninety miles north, gave Sacramento the worst air quality in the world for days and closed schools across the region. The 2020 August Complex season repeated it.',

    notSmoke:
      'Central Valley haze is not always smoke. Agricultural dust, valley fog in the cooler months, and trapped local emissions all close the horizon the same way. When the Delta breeze fails, whatever is in the valley stays in the valley regardless of source. Colour is the tell: valley haze reads tan or white, smoke reads grey-brown and carries a smell.',

    landmarks: [
      'The Sutter Buttes read clean about forty miles north, and on the best mornings the Sierra crest shows to the east.',
      'The Sierra is gone and the Sutter Buttes have flattened to a grey lump, though the Coast Range still marks the west.',
      'The Buttes disappear. The valley closes in and nothing beyond about ten miles resolves at all.',
      'From the Tower Bridge the Capitol dome holds a mile east, while the downtown towers behind it fade.',
      'The Capitol dome goes soft from across the river. From Old Sacramento you can lose the skyline entirely.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Sacramento right now?',
        a: 'The verdict at the top of this page answers that for Sacramento specifically, and it is a smoke reading rather than a haze reading. Those differ often here: agricultural dust and valley fog close the horizon exactly the same way smoke does, so the verdict can read All clear on a day when the Sutter Buttes have gone. The section above on what is not smoke gives you the tell. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Sacramento?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. In Sacramento the answer is very often a question about the Delta breeze, which is the valley’s only reliable flush. When it runs, the valley empties. When it fails, whatever is in the valley stays in the valley, and the clear time slides out with it.',
      },
      {
        q: "Why is Sacramento's air quality bad today?",
        a: 'Sacramento sits at the bottom of a valley with mountains on three sides and collects from all of them: the northern Sierra, the Coast Range, and the foothills all drain in here. The 2018 Camp Fire is the reference for how far that reaches: smoke from Paradise, ninety miles north, gave the city the worst air quality in the world for days and closed schools across the region. If the sky is tan or white rather than grey-brown, though, check the dust and fog explanation above first.',
      },
      {
        q: 'Where is the wildfire smoke in Sacramento coming from?',
        a: 'The northern Sierra, the Coast Range, and the Sierra foothills, all of which drain into the Central Valley. Fresno is the upwind check on southerly setups, because the valley works as one system and the San Joaquin fills before the Sacramento Valley does. Run the timeline backward on the map and you can see whether the smoke came over a range or up the valley floor.',
      },
      {
        q: 'Will the air quality in Sacramento be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. The single most useful thing to watch in Sacramento is whether the Delta breeze is forecast to run, because that decides whether a plume leaves or settles. 2018 and the 2020 August Complex both show what a valley that will not flush looks like. Forecasts are sharpest one to two days out.',
      },
      {
        q: 'How can I tell how smoky it is in Sacramento without an app?',
        a: 'The Sutter Buttes about forty miles north are the far check, with the Sierra crest visible east on the very best mornings. When the Sierra goes and the Buttes flatten to a grey lump while the Coast Range still marks the west, something has arrived. When the Buttes disappear and nothing past about ten miles resolves, the valley has closed in. And watch colour: tan or white is dust or fog, grey-brown with a smell is smoke.',
      },
    ],
  },

  {
    slug: 'fresno-ca',
    name: 'Fresno',
    region: 'CA',
    label: 'Fresno, CA',
    lat: 36.7378,
    lon: -119.7871,
    timezone: 'America/Los_Angeles',
    corridor: 'wildfire-smoke-california-great-basin',

    // The Central Valley reverses, and the source data reflects that from both
    // ends: Sacramento's page lists Fresno as its upwind city on southerly flow
    // ("the San Joaquin fills before the Sacramento Valley does"), while Fresno's
    // own provenance describes fires hundreds of miles NORTH draining south down
    // the valley — which makes Sacramento upwind of Fresno on that pattern.
    //
    // Both are true of a valley that vents poorly in every direction, but the site
    // cannot state both as the flow relationship, so this page takes the
    // direction Sacramento's page already asserts and says it from this end:
    // downwind, not upwind. FLAGGED for review — if the north-to-south drain is
    // the dominant pattern, this and Sacramento's upwind array both flip.
    upwind: [],

    downwind: [
      {
        slug: 'sacramento-ca',
        note: 'On southerly flow the San Joaquin fills first and the Sacramento Valley takes it next, so a bad stretch here is often a warning for up-valley.',
      },
    ],

    nearby: ['sacramento-ca'],

    bands: ['50+ miles', '20-50 miles', '6-20 miles', '2-6 miles', 'under 2 miles'],

    source:
      'Fresno has the hardest air in the country to begin with, and wildfire smoke lands on top of that. The San Joaquin Valley is ringed by mountains and vents poorly, so agricultural dust, traffic, and industry already sit in the air before a single fire starts. Smoke arrives from the Sierra, from the Coast Range, and from fires hundreds of miles north that drain south down the valley.',

    memory:
      'The 2020 Creek Fire burned in the Sierra directly east and put Fresno under some of the worst readings ever recorded in the valley. Locals here measure a good day by whether the mountains are visible at all, because in a bad stretch they are not visible for weeks.',

    notSmoke:
      "Fresno's air is hard before anything is burning. Agricultural dust, diesel, and valley industry sit in the air year-round because the San Joaquin vents poorly in every direction. On a bad non-fire day the mountains are already gone. The difference is smell and colour: dust reads tan and dry, smoke reads grey-brown and you can taste it.",

    landmarks: [
      'You can see the mountains. The Sierra crest reads clean to the east, fifty miles and more out, and the Coast Range marks the western horizon.',
      'The Sierra has gone to a flat blue band with no snow or canyon detail, and the Coast Range has disappeared.',
      'The mountains are gone in both directions. Nothing past about ten miles resolves and the valley feels closed.',
      'From downtown the near towers hold while anything past a few miles disappears into a flat grey wall.',
      'The tops of the downtown buildings go. From the freeway you lose the city a mile ahead.',
    ],

    questions: [
      {
        q: 'Is there wildfire smoke in Fresno right now?',
        a: 'The verdict at the top of this page answers that for Fresno specifically, and Fresno needs the distinction more than any city on this site. The San Joaquin vents poorly in every direction, so agricultural dust, diesel, and valley industry are already in the air before a single fire starts. The mountains can be gone on a day with no smoke in the forecast at all. Everything shown is a model estimate rather than a measurement at your address.',
      },
      {
        q: 'When will the smoke clear in Fresno?',
        a: 'That is the headline answer above: the clear time, the first stretch of at least six straight hours below the Smells-like-fire threshold. It is worth being precise about what that promises in Fresno. It is the point at which the smoke component drops, not the point at which the valley is clean. The baseline this city starts from does not go anywhere, and a clear time here often arrives with the mountains still missing.',
      },
      {
        q: "Why is Fresno's air quality bad today?",
        a: 'It may not be smoke at all. Fresno has the hardest air in the country to begin with, and on a bad non-fire day the dust and diesel alone will close the valley. When it is smoke, it comes off the Sierra directly east, off the Coast Range to the west, or down the valley from fires hundreds of miles north. The 2020 Creek Fire is the local marker: it burned in the Sierra directly east and produced some of the worst readings ever recorded here.',
      },
      {
        q: 'Where is the wildfire smoke in Fresno coming from?',
        a: 'Three directions. The Sierra immediately east, which is the close and worst case. The Coast Range to the west. And fires hundreds of miles north that drain south down the Central Valley, which is the case where nothing near Fresno is burning and the air is still full. Run the timeline backward on the map and the direction sorts them, which also helps separate a smoke day from a dust day.',
      },
      {
        q: 'Will the air quality in Fresno be better tomorrow?',
        a: 'The five-day strip above gives the day-by-day read and the timeline covers forty-eight hours hour by hour. The realistic frame for Fresno is that the strip is showing the smoke on top of the baseline rather than the whole picture, and in a bad stretch the mountains are not visible for weeks. Forecasts are sharpest one to two days out and the page shows where the models disagree.',
      },
      {
        q: 'How can I tell how smoky it is in Fresno without an app?',
        a: 'Can you see the mountains. The Sierra crest to the east is fifty miles and more out and the Coast Range marks the west, and having both is the top of the scale here. When the Sierra flattens to a blue band with no snow or canyon detail and the Coast Range has gone, something is in the air. Then use your nose and the colour: dust reads tan and dry, smoke reads grey-brown and you can taste it.',
      },
    ],
  },
];

export function locationBySlug(slug) {
  return LOCATIONS.find((l) => l.slug === slug) ?? null;
}
