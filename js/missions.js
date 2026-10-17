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
