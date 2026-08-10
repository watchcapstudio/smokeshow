// Corridors: the three regional pages at /smoke-forecast/corridor/<slug>/.
//
// A corridor is not a marketing bucket. It is the actual path smoke takes to
// get to the cities on it, which is why each city page names its corridor and
// why the corridor page is allowed to hold the cities: a reader in Cleveland
// who wants to know what Quebec is doing is asking a corridor question, not a
// city question.
//
// Same honesty constraint as locations.js. Nothing here describes current
// conditions, and nothing ever should. The prose is evergreen geography,
// prevailing flow, and dated events — every claim on these pages is one that
// also appears on a city page in this corridor, because that is where the
// research was done. If you want to add a claim here, add it to the city first.

export const CORRIDORS = [
  {
    slug: 'canadian-smoke-great-lakes-northeast',
    name: 'Canadian smoke: Great Lakes and Northeast',

    // Meta description. Same shape as a city page: what the page is, no
    // condition, no clear time, nothing that goes stale in the SERP.
    description:
      'How Canadian wildfire smoke reaches the Great Lakes and the Northeast: the boreal fires it starts at, the order it crosses the cities, and a live forecast for each one.',

    lede: 'Most smoke in the eastern half of the continent is Canadian, and it is old by the time it arrives.',

    // Editorial body. Paragraphs, rendered in order.
    body: [
      'This corridor starts in the boreal forest of northern Manitoba, northwestern Ontario, Saskatchewan, and Quebec, and runs south and east on northerly and northwesterly flow. Nothing in the American West has to be burning for it to run. That is the single most useful thing to know about it, and the thing that surprises people most: a bad air day in Detroit or Boston often has no upwind fire anywhere in the United States.',
      'The cities on it are not interchangeable, because they sit at different distances from the source. Winnipeg is usually the source end rather than the receiving end, and gets smoke fresh and concentrated a few hundred kilometres from the fire. Minneapolis is one of the first major American cities the same plume reaches, often in under a day, which is why Minnesota air quality alerts frequently fire before anyone else in the corridor issues one. Toronto sits close enough to northern Ontario and Quebec to get smoke thick rather than aged. Chicago, Milwaukee, Detroit, and Cleveland are a day behind that. Boston, New York, and Philadelphia are a day behind again, far enough downwind that smoke usually arrives aloft and then mixes down through the day.',
      'That delay is the reason this corridor is worth reading as a corridor. A plume that is over Winnipeg this afternoon is a forecast problem for Minneapolis tonight and for the Great Lakes tomorrow, and the upwind link on each city page below points at whichever city usually sees it first.',
      'Two local mechanisms then decide how bad it gets after the smoke arrives. The Great Lakes give a plume a clean run with nothing to break it up, and the lake breeze can pin it against a shoreline through the afternoon. Conditions on Milwaukee’s or Cleveland’s lakefront and conditions ten miles inland can differ noticeably on the same hour. Pittsburgh has the opposite problem: cool air settles into the river valleys overnight and caps them, so a plume that would pass over a flatter city sits instead.',
      'June 2023 is the event the whole corridor shares. Quebec smoke put Toronto, Detroit, Cleveland, Milwaukee, Chicago, Pittsburgh, Philadelphia, Boston, and New York into their worst air in living memory inside the same week, and June 7 in New York produced the orange-sky images most Americans now picture when they hear the phrase wildfire smoke. The 2023 season overall was the worst wildfire year in Canadian history by area burned.',
    ],

    // Cities in this corridor, in the order the page lists them: source end
    // first, then outward along the path. This is the corridor's actual
    // geography, not alphabetical.
    cities: [
      'winnipeg-mb',
      'minneapolis-mn',
      'toronto-on',
      'milwaukee-wi',
      'chicago-il',
      'detroit-mi',
      'cleveland-oh',
      'pittsburgh-pa',
      'new-york-ny',
      'philadelphia-pa',
      'boston-ma',
    ],
  },

  {
    slug: 'wildfire-smoke-pacific-northwest-northern-rockies',
    name: 'Wildfire smoke: Pacific Northwest and Northern Rockies',

    description:
      'How wildfire smoke moves through the Pacific Northwest and the Northern Rockies: the fire country it comes from, the valleys that hold it, and a live forecast for each city.',

    lede: 'Out here two separate things decide your air: what arrives, and whether the ground you live on lets it leave.',

    body: [
      'The sources are everywhere and they overlap. The Cascade crest, eastern Washington, central and southern Oregon, northern California, central Idaho and the Idaho panhandle, western Montana, and interior British Columbia all feed this corridor, and on the worst setups several of them feed it at once. British Columbia is the one people consistently underestimate: a bad BC season puts smoke over Spokane and the Flathead repeatedly without a single acre burning in the United States.',
      'Then the terrain takes over. Missoula, Whitefish, Bozeman, Jackson, Spokane, and Boise all sit in valleys or basins that pool cold air overnight, cap themselves, and hold smoke at ground level long after the flow upwind has shifted. This is why bad air in the Rockies routinely outlasts the fire behaviour that caused it, and why a clear forecast upwind is not the same thing as a clear morning at home. Bend, on the dry east side of the Cascades, does the same trick with high-desert nights.',
      'The coastal cities fail differently. Seattle takes smoke from two directions that behave nothing alike. Cascade and eastern Washington fires push it west through the passes on easterly flow, which arrives fast and clears fast, while Oregon, California, and BC smoke arrives aloft and settles into the Puget Sound basin for a week, because the marine geography that keeps the city mild also keeps its air from moving. Portland’s wrinkle is the Columbia River Gorge: east winds funnel smoke straight down it into the metro, fast, concentrated, and hard to forecast more than a day out.',
      'September 2020 is the shared marker on the west side of this corridor. East winds drove the Riverside, Beachie Creek, and Holiday Farm fires toward the Willamette Valley and gave Portland the worst air quality on earth for several days with ash falling in the city, and Seattle sat under Oregon and California smoke with a flat orange-grey sky for the better part of two weeks. Inland, 2017, 2020, and 2021 are the seasons people name.',
      'The visibility scale is at its most useful here, because the targets are mountains. A city page in this corridor tells you which peak goes at which level, and the peaks are far enough out that the top of the scale has somewhere to go: Rainier at roughly sixty miles from Seattle, Mount Hood at fifty from Portland, the Sierra-scale distances that a skyline city simply cannot offer.',
    ],

    cities: [
      'seattle-wa',
      'portland-or',
      'bend-or',
      'spokane-wa',
      'boise-id',
      'missoula-mt',
      'whitefish-mt',
      'bozeman-mt',
      'jackson-wy',
    ],
  },

  {
    slug: 'wildfire-smoke-california-great-basin',
    name: 'Wildfire smoke: California and the Great Basin',

    description:
      'How California and Great Basin wildfire smoke reaches the valleys and the Front Range: where it comes from, which haze is not smoke at all, and a live forecast for each city.',

    lede: 'This is the corridor where the haze is not always smoke, and saying so is most of the job.',

    body: [
      'The fires that drive it are in the northern Sierra, the Coast Range, the Sierra foothills, and northern California, with Nevada’s Great Basin fires adding to it on southerly and easterly setups. Where that smoke ends up is decided by three basins and one long-range ride.',
      'Sacramento sits at the bottom of a valley with mountains on three sides and collects smoke from all of them; fires in the northern Sierra, the Coast Range, and the foothills all drain into the Central Valley, and the valley holds smoke the way a bowl holds water. Fresno, further down the same valley, starts from a worse baseline. The San Joaquin vents poorly in every direction, so agricultural dust, diesel, and industry are already in the air before a single fire starts. Reno has the worst address of all in a bad California year, directly downwind of the northern Sierra with smoke crossing the crest on westerly flow and dropping into the Truckee Meadows, where the surrounding ridges keep it. Salt Lake City takes the same westerly and southwesterly flow into a bowl between two ranges, and the mountains do the rest.',
      'Denver is the long-range end. Colorado’s own western slope and the Utah and Nevada Great Basin feed it, but the increasingly common modern pattern is high smoke from California or the Pacific Northwest carried a thousand miles east on upper-level flow, which is why the Front Range disappears on days when nothing in Colorado is burning.',
      'The named events are 2018, 2020, and 2021. The Camp Fire in November 2018 gave Sacramento the worst air quality in the world for days from ninety miles away and closed schools across the region. The 2020 season repeated it and put the Creek Fire in the Sierra directly east of Fresno. The 2021 Dixie Fire ran Reno through weeks of degraded air and repeated cancellations, and 2020 and 2021 both put Salt Lake among the worst air quality in the world on multiple days.',
      'What makes this corridor different from the other two is that four of its five cities have a native haze that looks exactly like smoke and is not: Denver’s summer ozone and brown cloud, Salt Lake’s winter inversion, Central Valley agricultural dust and fog, and the San Joaquin’s year-round baseline. Every page below that has one says so plainly and gives you the tell, because a page that lets you mistake ozone for smoke has not answered the question you came with.',
    ],

    cities: ['sacramento-ca', 'fresno-ca', 'reno-nv', 'salt-lake-city-ut', 'denver-co'],
  },
];

export function corridorBySlug(slug) {
  return CORRIDORS.find((c) => c.slug === slug) ?? null;
}
