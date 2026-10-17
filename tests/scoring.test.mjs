// Scoring verification against an INDEPENDENT oracle transcribed by hand from the official
// BIOGLOW scoresheet (+ Challenge Update 01). Every raw input combination of every mission
// is checked, including invalid ones (bonus ticked without its base condition, etc).
import assert from 'node:assert/strict';
import { MISSIONS } from '../js/missions.js';
import {
  scoreAll, scoreMission, normalizeMission, normalizeState, defaultState, missionDomain, maxScores, standings,
} from '../js/scoring.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

// ---- oracle: scoresheet rules, one function per mission, written from the PDF text ----
const T = (v) => v === true;
const n = (v, max) => Math.max(0, Math.min(max, Math.trunc(v) || 0));
const oracle = {
  m01: (s) => (T(s.drone) ? 20 + (T(s.lidar) ? 10 : 0) : 0),
  m02: (s) => 10 * n(s.seeds, 3),
  m03: (s) => (T(s.flag) ? 20 + (T(s.rock) ? 10 : 0) : 0),
  m04: (s) => {
    if (T(s.katOutEnd)) return 0;                              // zero if katydid completely outside habitat at end
    const leaves = s.leaves;
    if (leaves !== 1 && leaves !== 2) return 0;
    let p = 10;                                                // one leaf removed
    if (leaves === 2 && T(s.katOriginal) && !T(s.katLeft)) p += 20; // bonus
    return p;
  },
  m05: (s) => ({ partial: 10, full: 20 }[s.root] || 0),        // only one condition possible
  m06: (s) => (T(s.ant) ? 10 * n(s.fragments, 4) : 0),
  m07: (s) => (T(s.mycelium) ? 20 + (T(s.noOpp) ? 0 : 10 * n(s.connections, 2)) : 0),
  m08: (s) => (T(s.vine) ? 30 : 0),
  m09: (s) => 10 * [s.platform, s.camera, s.seed].filter(T).length,
  m10: (s) => 10 * [s.spider, s.snail].filter(T).length,
  m11: (s) => (T(s.cover) ? 20 : 0),
  m12: (s) => (T(s.cane) ? 20 : 0) + (T(s.tie) ? 10 : 0),
  m13: (s) => (T(s.species) && T(s.trees) ? 30 : 0),
  m14: (s) => {
    const c = n(s.contained, 4);
    const mat = Math.min(n(s.onMat, 4), c);                    // "and are touching the mat" ⊂ contained
    return 5 * c + 5 * mat;
  },
  m15: (s) => {
    let p = 10 * [s.canopy, s.skylight, s.hatch].filter(T).length;
    if ((s.dock === 'mine' && T(s.canopy)) || (s.dock === 'city' && T(s.skylight)) || (s.dock === 'farm' && T(s.hatch))) p += 10;
    return p;
  },
};
const NO_EQ = ['m01', 'm04', 'm05', 'm07', 'm09', 'm10', 'm12', 'm15'];
const oracleMission = (id, raw) => (T(raw.eq) && NO_EQ.includes(id) ? 0 : oracle[id](raw));

console.log('scoring');

test('every mission has an oracle, and the oracle list matches the scoresheet (15 missions)', () => {
  assert.equal(MISSIONS.length, 15);
  assert.deepEqual(MISSIONS.map((m) => m.id), Object.keys(oracle));
  assert.deepEqual(MISSIONS.filter((m) => m.noEquipment).map((m) => m.id), NO_EQ);
});

test('exhaustive: engine == oracle for every raw input of every mission', () => {
  let cases = 0;
  for (const m of MISSIONS) {
    for (const raw of missionDomain(m)) {
      const got = scoreMission(m, normalizeMission(m, raw)).points;
      const want = oracleMission(m.id, raw);
      assert.equal(got, want, `${m.id} ${JSON.stringify(raw)}: engine ${got}, oracle ${want}`);
      cases++;
    }
  }
  console.log(`        (${cases} mission states checked)`);
});

test('garbage input never crashes or exceeds the maximum', () => {
  const max = maxScores().total;
  for (const raw of [undefined, null, {}, { m: null }, { tokens: 99, gp: 9, m: { m02: { seeds: 1e9 }, m14: { contained: -5, onMat: 'x' } } },
    { tokens: '3', equip: 'yes', m: { m05: { root: 'banana' } } }]) {
    const r = scoreAll(raw);
    assert.ok(Number.isInteger(r.total) && r.total >= 0 && r.total <= max);
  }
});

test('precision tokens table: 0→0 1→10 2→15 3→25 4→35 5→50 6→50', () => {
  const want = [0, 10, 15, 25, 35, 50, 50];
  want.forEach((p, t) => assert.equal(scoreAll({ tokens: t }).tokens, p));
  assert.equal(scoreAll({ tokens: -3 }).tokens, 0);
  assert.equal(scoreAll({ tokens: 12 }).tokens, 50);
});

test('equipment inspection is worth 20', () => {
  assert.equal(scoreAll({ equip: true }).equipment, 20);
  assert.equal(scoreAll({ equip: false }).equipment, 0);
});

test('empty match with no interruptions = 50 (six tokens), nothing else', () => {
  assert.equal(scoreAll(defaultState()).total, 50);
});

test('maximum possible score is derived and per-mission maxima match the scoresheet', () => {
  const { perMission, total } = maxScores();
  assert.deepEqual(perMission, {
    m01: 30, m02: 30, m03: 30, m04: 30, m05: 20, m06: 40, m07: 40, m08: 30,
    m09: 30, m10: 20, m11: 20, m12: 30, m13: 30, m14: 40, m15: 40,
  });
  assert.equal(total, 20 + 50 + 460);
});

test('perfect match scores the maximum', () => {
  const s = defaultState();
  Object.assign(s, { equip: true, tokens: 6 });
  Object.assign(s.m.m01, { drone: true, lidar: true });
  s.m.m02.seeds = 3;
  Object.assign(s.m.m03, { flag: true, rock: true });
  Object.assign(s.m.m04, { leaves: 2, katOriginal: true });
  s.m.m05.root = 'full';
  Object.assign(s.m.m06, { ant: true, fragments: 4 });
  Object.assign(s.m.m07, { mycelium: true, connections: 2 });
  s.m.m08.vine = true;
  Object.assign(s.m.m09, { platform: true, camera: true, seed: true });
  Object.assign(s.m.m10, { spider: true, snail: true });
  s.m.m11.cover = true;
  Object.assign(s.m.m12, { cane: true, tie: true });
  Object.assign(s.m.m13, { species: true, trees: true });
  Object.assign(s.m.m14, { contained: 4, onMat: 4 });
  Object.assign(s.m.m15, { canopy: true, skylight: true, hatch: true, dock: 'city' });
  assert.equal(scoreAll(s).total, maxScores().total);
});

test('Lucky Leaves (Update 01) edge cases', () => {
  const m = MISSIONS.find((x) => x.id === 'm04');
  const sc = (o) => scoreMission(m, normalizeMission(m, o)).points;
  assert.equal(sc({ leaves: 1 }), 10);
  assert.equal(sc({ leaves: 2, katOriginal: true }), 30);
  assert.equal(sc({ leaves: 2, katOriginal: false }), 10, 'bonus needs katydid in original position');
  assert.equal(sc({ leaves: 2, katOriginal: true, katLeft: true }), 10, 'katydid left habitat at any time: bonus gone, base stays');
  assert.equal(sc({ leaves: 2, katOriginal: true, katOutEnd: true }), 0, 'outside at end: zero for whole mission');
  assert.equal(sc({ leaves: 0, katOriginal: true }), 0);
});

test('mission 05 allows only one condition; mission 15 only one environmental bonus', () => {
  const m5 = MISSIONS.find((x) => x.id === 'm05');
  assert.equal(scoreMission(m5, normalizeMission(m5, { root: 'full' })).points, 20);
  const m15 = MISSIONS.find((x) => x.id === 'm15');
  const all = { canopy: true, skylight: true, hatch: true };
  for (const dock of ['mine', 'city', 'farm']) assert.equal(scoreMission(m15, normalizeMission(m15, { ...all, dock })).points, 40);
  assert.equal(scoreMission(m15, normalizeMission(m15, { canopy: true, dock: 'city' })).points, 10, 'bonus needs the dock-matching item');
  assert.equal(scoreMission(m15, normalizeMission(m15, { ...all, dock: 'none' })).points, 30);
});

test('mission 07 bonuses vanish without an opponent', () => {
  const m = MISSIONS.find((x) => x.id === 'm07');
  const sc = (o) => scoreMission(m, normalizeMission(m, o)).points;
  assert.equal(sc({ mycelium: true, connections: 2 }), 40);
  assert.equal(sc({ mycelium: true, connections: 2, noOpp: true }), 20);
  assert.equal(sc({ mycelium: false, connections: 2 }), 0);
});

test('no-equipment constraint voids a mission, only that mission', () => {
  const s = defaultState();
  Object.assign(s.m.m09, { platform: true, camera: true, seed: true, eq: true });
  s.m.m08.vine = true;
  s.m.m08.eq = true; // m08 carries no icon: flag must be ignored
  const r = scoreAll(s);
  assert.equal(r.missions.find((x) => x.id === 'm09').points, 0);
  assert.equal(r.missions.find((x) => x.id === 'm08').points, 30);
});

test('normalizeState is idempotent', () => {
  const s = defaultState();
  s.m.m14.contained = 2; s.m.m14.onMat = 9;
  const a = normalizeState(s), b = normalizeState(a);
  assert.deepEqual(a, b);
  assert.equal(a.m.m14.onMat, 2);
});

test('gracious professionalism is recorded but never added to the robot game score', () => {
  assert.equal(scoreAll({ gp: 4 }).total, scoreAll({ gp: 2 }).total);
  assert.equal(scoreAll({ gp: 4 }).gp, 4);
  assert.equal(scoreAll({ gp: 7 }).gp, 3);
});

console.log('standings');
const teams = [1, 2, 3, 4, 5].map((i) => ({ id: 't' + i, number: 100 + i, name: 'Team ' + i }));
const sc = (teamId, round, total) => ({ teamId, round, total });

test('best of three counts, not the sum', () => {
  const r = standings(teams, [sc('t1', 1, 200), sc('t1', 2, 100), sc('t2', 1, 150), sc('t2', 2, 150), sc('t2', 3, 150)]);
  assert.deepEqual(r.slice(0, 2).map((x) => x.team.id), ['t1', 't2']);
  assert.equal(r[0].best, 200);
});

test('ties broken by 2nd then 3rd best score', () => {
  const r = standings(teams, [
    sc('t1', 1, 300), sc('t1', 2, 200), sc('t1', 3, 100),
    sc('t2', 1, 300), sc('t2', 2, 250), sc('t2', 3, 0),
    sc('t3', 1, 300), sc('t3', 2, 200), sc('t3', 3, 120),
  ]);
  assert.deepEqual(r.slice(0, 3).map((x) => x.team.id), ['t2', 't3', 't1']);
  assert.deepEqual(r.slice(0, 3).map((x) => x.rank), [1, 2, 3]);
});

test('identical score sets share a rank and are flagged as tied', () => {
  const r = standings(teams, [sc('t1', 1, 100), sc('t2', 1, 100), sc('t3', 1, 90)]);
  assert.deepEqual(r.slice(0, 3).map((x) => x.rank), [1, 1, 3]);
  assert.ok(r[0].tied && r[1].tied && !r[2].tied);
});

test('unscored teams are listed last with no rank; unknown team ids are ignored', () => {
  const r = standings(teams, [sc('t3', 1, 50), sc('ghost', 1, 999)]);
  assert.equal(r.length, 5);
  assert.equal(r[0].team.id, 't3');
  assert.ok(r.slice(1).every((x) => x.rank === null && x.best === null));
});

console.log(`\n${passed} scoring tests passed`);
