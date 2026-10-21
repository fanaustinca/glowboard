// FIRST LEGO League Challenge 2026-27 "BIOGLOW" — Robot Game scoring data.
// Source: official Robot Game Rulebook + Scoresheet + Challenge Updates (Oct 14 2026).
// Updates supersede the rulebook (e.g. UPDATE 01 reworded the Lucky Leaves katydid rules).
// Next season: replace this file (and the item counts below) and everything else adapts.

export const SEASON = { name: 'BIOGLOW', years: '2026-27' };

export const EQUIPMENT_INSPECTION_POINTS = 20;
export const MAX_TOKENS = 6;
// Index = precision tokens REMAINING at end of match.
export const TOKEN_POINTS = [0, 10, 15, 25, 35, 50, 50];
export const GP_LEVELS = { 2: 'Developing', 3: 'Accomplished', 4: 'Exceeds' };
export const MATCHES_PER_TEAM = 3; // three official matches, best one counts

// Number of loose scoring objects (verify against the physical field when it changes).
export const COUNTS = {
  m02Seeds: 3,      // Exploding Seeds — pictured: 3 seeds
  m06Fragments: 4,  // Leafcutter Frenzy — pictured: 4 leaf fragments
  m14Seeds: 4,      // Seeds of Renewal — 3 pictured + the Research Platform seed (not stated in rulebook)
};

// Missions that carry the "No Equipment Constraint" icon on the scoresheet:
// "A mission model cannot earn points if it is touching equipment at the end of the match."
const NO_EQUIPMENT = new Set(['m01', 'm04', 'm05', 'm07', 'm09', 'm10', 'm12', 'm15']);

const chk = (key, label, pts, extra = {}) => ({ type: 'check', key, label, pts, def: false, ...extra });
const cnt = (key, label, each, max, extra = {}) => ({ type: 'count', key, label, each, max, def: 0, ...extra });
const seg = (key, label, options, extra = {}) => ({ type: 'seg', key, label, options, def: options[0].v, ...extra });

const RAW = [
  {
    id: 'm01', num: 1, name: 'Drone Survey',
    fields: [
      chk('drone', 'Drone is no longer touching the mat', 20),
      chk('lidar', 'LiDAR map completely flipped over, scan marker at least partly in survey area', 10, { bonus: true, requires: (s) => s.drone }),
    ],
  },
  {
    id: 'm02', num: 2, name: 'Exploding Seeds',
    fields: [cnt('seeds', 'Seeds no longer touching the stalk', 10, COUNTS.m02Seeds)],
  },
  {
    id: 'm03', num: 3, name: 'Flip the Rock',
    fields: [
      chk('flag', 'Research flag is down', 20),
      chk('rock', 'Rock returned to its original starting position', 10, { bonus: true, requires: (s) => s.flag }),
    ],
  },
  {
    id: 'm04', num: 4, name: 'Lucky Leaves',
    notes: [
      'Nest = the model holding the leaves and katydid. Leaf habitat = nest + marked mat area around it.',
      'Katydid completely outside the habitat at ANY time: bonus no longer available.',
      'Katydid completely outside the habitat at END of match: mission scores zero.',
    ],
    fields: [
      seg('leaves', 'Leaves completely removed (no longer touching the nest)', [
        { v: 0, label: 'None', pts: 0 },
        { v: 1, label: 'One leaf', pts: 10 },
        { v: 2, label: 'Both leaves', pts: 10 }, // first leaf = 10; second leaf is scored as part of the bonus
      ]),
      chk('katOriginal', 'Katydid in its original starting position', 0, { note: 'needed for bonus' }),
      chk('katLeft', 'Katydid was completely outside the habitat at any time', 0, { note: 'cancels bonus', danger: true }),
      chk('katOutEnd', 'Katydid completely outside the habitat at end of match', 0, { note: 'mission = 0', danger: true }),
    ],
    extra: (s) => (s.leaves === 2 && s.katOriginal && !s.katLeft
      ? [{ label: 'Bonus: second leaf removed, katydid in original position', pts: 20 }] : []),
    voidIf: (s) => (s.katOutEnd ? 'Katydid completely outside the leaf habitat at end of match' : null),
  },
  {
    id: 'm05', num: 5, name: 'Reaching Roots',
    notes: ['Only one scoring condition is possible.'],
    fields: [seg('root', 'The plant root is…', [
      { v: 'none', label: 'Neither', pts: 0 },
      { v: 'partial', label: 'Partially extended', pts: 10 },
      { v: 'full', label: 'Completely extended', pts: 20 },
    ])],
  },
  {
    id: 'm06', num: 6, name: 'Leafcutter Frenzy',
    fields: [
      chk('ant', 'Ant is touching the nest', 0, { note: 'needed for fragments' }),
      cnt('fragments', 'Leaf fragments contained within the nest', 10, COUNTS.m06Fragments, { requires: (s) => s.ant }),
    ],
  },
  {
    id: 'm07', num: 7, name: 'Humongous Fungus',
    notes: [
      'The mycelium and plant root do not need to touch to form a connection. If each is fully extended, both teams earn the bonus.',
      'Bonus is not possible in remote competitions or with no opposing team.',
    ],
    fields: [
      chk('mycelium', 'Mycelium is completely extended', 20),
      chk('noOpp', 'No opposing team / remote competition', 0, { note: 'bonus unavailable' }),
      cnt('connections', 'Connections: your extended mycelium ↔ opposing fully extended plant root (two possible)', 10, 2,
        { bonus: true, requires: (s) => s.mycelium && !s.noOpp }),
    ],
  },
  {
    id: 'm08', num: 8, name: 'Tangled',
    fields: [chk('vine', 'Vine is touching the mat', 30)],
  },
  {
    id: 'm09', num: 9, name: 'Research Platform',
    fields: [
      chk('platform', 'Research platform is raised', 10),
      chk('camera', 'Camera trap is deployed', 10),
      chk('seed', 'Seed is no longer touching the tree', 10),
    ],
  },
  {
    id: 'm10', num: 10, name: 'Fragile Microhabitats',
    fields: [
      chk('spider', 'Spider habitat is in its original starting position', 10),
      chk('snail', 'Snail habitat is in its original starting position', 10),
    ],
  },
  {
    id: 'm11', num: 11, name: 'Window to the Past',
    fields: [chk('cover', 'Root cover is down, touching the mat', 20)],
  },
  {
    id: 'm12', num: 12, name: 'Forest Elder',
    fields: [
      chk('cane', 'Cane is completely raised, touching the tree', 20),
      chk('tie', 'Support tie is around the post', 10),
    ],
  },
  {
    id: 'm13', num: 13, name: 'Keystone Species',
    notes: ['Both conditions are required for the 30 points. The keystone species counts as equipment at inspection.'],
    fields: [
      chk('species', 'Your team’s keystone species is on the restoration platform', 0, { note: 'both = 30' }),
      chk('trees', 'Young trees are raised', 0, { note: 'both = 30' }),
    ],
    extra: (s) => (s.species && s.trees ? [{ label: 'Keystone species on platform and young trees raised', pts: 30 }] : []),
  },
  {
    id: 'm14', num: 14, name: 'Seeds of Renewal',
    fields: [
      cnt('contained', 'Seeds contained within the replantation station', 5, COUNTS.m14Seeds),
      cnt('onMat', 'Of those, also touching the mat', 5, COUNTS.m14Seeds, { bonus: true, maxFn: (s) => s.contained }),
    ],
  },
  {
    id: 'm15', num: 15, name: 'Biocentric Architecture',
    notes: ['Environmental Bonus: only one bonus is possible — the one matching the dock this model is located in.'],
    fields: [
      chk('canopy', 'Nesting canopy is raised', 10),
      chk('skylight', 'Garden skylight is completely in', 10),
      chk('hatch', 'Compost hatch is completely opened, touching the mat', 10),
      seg('dock', 'Dock the model is located in', [
        { v: 'none', label: 'Unknown', pts: 0 },
        { v: 'mine', label: 'Mine', pts: 0 },
        { v: 'city', label: 'City', pts: 0 },
        { v: 'farm', label: 'Farm', pts: 0 },
      ]),
    ],
    extra: (s) => {
      const ok = (s.dock === 'mine' && s.canopy) || (s.dock === 'city' && s.skylight) || (s.dock === 'farm' && s.hatch);
      const need = { mine: 'nesting canopy', city: 'garden skylight', farm: 'compost hatch' }[s.dock];
      return ok ? [{ label: `Environmental bonus (${s.dock} dock: ${need})`, pts: 10 }] : [];
    },
  },
];

// Mission ids that have official artwork in assets/missions/<id>.png (extracted from the Robot Game Rulebook
// "Missions" pages; others fall back to the SVG placeholder).
export const OFFICIAL_IMAGES = new Set(['m01','m02','m03','m04','m05','m06','m07','m08','m09','m10','m11','m12','m13','m14','m15']);

export const MISSIONS = RAW.map((m) => ({
  ...m,
  noEquipment: NO_EQUIPMENT.has(m.id),
  notes: m.notes || [],
  image: OFFICIAL_IMAGES.has(m.id) ? `assets/missions/${m.id}.png` : `assets/missions/${m.id}.svg`,
  placeholder: `assets/missions/${m.id}.svg`,
}));

export const MISSION_BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));

// ───────────────────────────── FIRST LEGO League Future Edition — BIOGLOW ─────────────────────────────
// Source: Future Edition Rulebook, Game Missions and Scoresheet (LEGO Education, 2026-27).
// Founders = the standard Challenge above; Future = the grade 3-8 / 8+ Future Edition with its own missions,
// penalties (no equipment inspection or precision tokens) and ranking by the AVERAGE of a team's matches.
export const EDITIONS = {
  founders: { id: 'founders', label: 'Founders', long: 'Founders (standard)', rank: 'best' },
  future: { id: 'future', label: 'Future', long: 'Future', rank: 'average' },
};
export const EDITION_IDS = Object.keys(EDITIONS);
export const DEFAULT_EDITION = 'founders';
// Event setting → which editions it runs.
export const EVENT_EDITION_CHOICES = [
  { v: 'founders', label: 'Founders', editions: ['founders'] },
  { v: 'future', label: 'Future', editions: ['future'] },
  { v: 'both', label: 'Founders + Future', editions: ['founders', 'future'] },
];

// The rulebook gives no limit for these piles (only the “max” printed on the scoresheet), so the counters stop at a
// size that no real match can reach.
export const FUTURE_COUNTS = { microbiome: 3, canopy: 15, waterfall: 50, resourcesTotal: 20, speciesTotal: 20, invasiveTotal: 20, young: 4, youngScored: 3, haven: 80, invasiveAdded: 5, containment: 21 };
// Interference penalties: 1st = −10, 2nd = −30 in total, 3rd = the match score is zero.
export const FUTURE_PENALTIES = [
  { v: 0, label: '0', pts: 0 }, { v: 1, label: '1', pts: -10 }, { v: 2, label: '2', pts: -30 }, { v: 3, label: '3+', pts: null },
];
export const PENALTY_DEDUCTION = [0, 10, 30];

const FUTURE_RAW = [
  {
    id: 'f01', num: 1, name: 'Mighty Microbiomes',
    notes: [
      'The fourth keystone species in the young forest triggers the queen bonus and scores nothing itself: at most 3 score in each microbiome.',
      'Keystone species must be placed loose in the microbiome (not touching equipment) to score.',
      'The fourth keystone species in the young forest does not score for placement — it triggers the defeat of the invasive queen for the bonus.',
    ],
    fields: [
      cnt('young', 'Keystone species in the young forest microbiome (the 4th does not score; it knocks down the invasive queen)', 20, FUTURE_COUNTS.young,
        { scoreCap: FUTURE_COUNTS.youngScored, maxFn: (s) => FUTURE_COUNTS.speciesTotal - s.grand - s.hollow }),
      cnt('grand', 'Keystone species in the grand tree microbiome', 20, FUTURE_COUNTS.microbiome,
        { maxFn: (s) => FUTURE_COUNTS.speciesTotal - s.young - s.hollow }),
      cnt('hollow', 'Keystone species in the hollow tree microbiome', 20, FUTURE_COUNTS.microbiome,
        { maxFn: (s) => FUTURE_COUNTS.speciesTotal - s.young - s.grand }),
      chk('queen', 'At least three keystone species in the young forest and the invasive queen on the opposite side of the field is knocked down (needs the 4th species in the young forest)', 40,
        { bonus: true, requires: (s) => s.young >= 4 }),
    ],
  },
  {
    id: 'f02', num: 2, name: 'Roots of Renewal',
    notes: ['There are 20 resources in total, shared between the base and the canopy chamber (the canopy holds at most 15). Resources must be cycled up the tree. Placing resources directly into the canopy chamber will not count.'],
    fields: [
      cnt('base', 'Resources in the grand tree base', 5, FUTURE_COUNTS.resourcesTotal, { maxFn: (s) => FUTURE_COUNTS.resourcesTotal - s.canopy }),
      cnt('canopy', 'Resources in the canopy chamber (max 15)', 10, FUTURE_COUNTS.canopy, { maxFn: (s) => FUTURE_COUNTS.resourcesTotal - s.base }),
    ],
  },
  {
    id: 'f03', num: 3, name: 'Cave Waterfall',
    notes: ['Species cycled through the waterfall advance the counter — the mission result is the number shown on the counter at the end of the match. The counter may not be advanced any other way.'],
    fields: [cnt('cycled', 'Keystone species cycled through the cave waterfall', 5, FUTURE_COUNTS.waterfall, { slider: true })],
  },
  {
    id: 'f04', num: 4, name: 'Rainforest Awakening',
    fields: [
      chk('species', 'All keystone species are released from the nest', 30),
      chk('resources', 'All resources are released from the hollow tree', 20),
    ],
  },
  {
    id: 'f05', num: 5, name: 'Central Haven',
    notes: ['Cooperative: any keystone species or resources resting completely in the central haven at the end of the match score, whichever team delivered them. Both teams get the full shared score. There are 80 tokens in all (20 resources + 20 keystone species per team), so tokens placed elsewhere on your field cannot also be in the haven.'],
    fields: [cnt('haven', 'Keystone species or resources resting completely in the central haven', 5, FUTURE_COUNTS.haven, { poolFn: (all) => FUTURE_COUNTS.haven - all.f01.young - all.f01.grand - all.f01.hollow - all.f02.base - all.f02.canopy })],
  },
  {
    id: 'f06', num: 6, name: 'Level Up: Invasive Attack',
    notes: [
      'Optional. Invasive species are placed during pre-match setup; the invasive queen is required but does not score at setup.',
      'There are 20 invasive species in all, plus the queen; delivering the queen to the containment zone also scores 10.',
    ],
    fields: [
      cnt('added', 'Invasive species added at setup', 20, FUTURE_COUNTS.invasiveAdded),
      cnt('contained', 'Invasive species in the containment zone', 10, FUTURE_COUNTS.containment),
    ],
  },
];

export const FUTURE_MISSIONS = FUTURE_RAW.map((m) => ({
  ...m,
  noEquipment: false,
  notes: m.notes || [],
  image: `assets/missions/${m.id}.jpg`,
  placeholder: 'assets/missions/m01.svg',
}));
