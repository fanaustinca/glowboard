// Scoring verification against an INDEPENDENT oracle transcribed by hand from the official
// BIOGLOW scoresheet (+ Challenge Update 01). Every raw input combination of every mission
// is checked, including invalid ones (bonus ticked without its base condition, etc).
import assert from 'node:assert/strict';
import { MISSIONS, FUTURE_MISSIONS } from '../js/missions.js';
import {
  scoreAll, scoreMission, normalizeMission, normalizeState, defaultState, missionDomain, maxScores, standings, editionOf, missionsOf,
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


// ───────────── Future Edition (BIOGLOW Future scoresheet, rulebook rules 20-21) ─────────────
// Independent oracle, written straight from the printed scoresheet.
const clampN = (v, hi) => Math.max(0, Math.min(hi, Math.trunc(+v || 0)));
function futureOracle(r) {
  const m = r.m;
  // 20 keystone species: the young forest takes up to 4 (the 4th triggers the queen and scores nothing), grand and hollow up to 3
  const young = clampN(m.f01.young, 4), grand = clampN(m.f01.grand, 3), hollow = clampN(m.f01.hollow, 3);
  let f01 = 20 * (Math.min(young, 3) + grand + hollow);
  if (m.f01.queen === true && young >= 4) f01 += 40; // bonus: the 4th species in the young forest knocks the queen down
  const baseN = clampN(m.f02.base, 20); // 20 resources exist: base + canopy <= 20, canopy <= 15
  const canopyN = Math.min(clampN(m.f02.canopy, 15), 20 - baseN);
  const f02 = 5 * baseN + 10 * canopyN;
  const f03 = 5 * clampN(m.f03.cycled, 50);
  const f04 = (m.f04.species === true ? 30 : 0) + (m.f04.resources === true ? 20 : 0);
  const havenMax = Math.max(0, 80 - young - grand - hollow - baseN - canopyN); // 80 tokens exist in all
  const f05 = 5 * Math.min(clampN(m.f05.haven, 80), havenMax);
  const f06 = 20 * clampN(m.f06.added, 5) + 10 * clampN(m.f06.contained, 21);
  const sum = f01 + f02 + f03 + f04 + f05 + f06;
  const p = clampN(r.penalties, 3);
  return p >= 3 ? 0 : Math.max(0, sum - [0, 10, 30][p]);
}
test('future: missions match the printed scoresheet (names, point values, caps)', () => {
  assert.deepEqual(FUTURE_MISSIONS.map((m) => m.name), ['Mighty Microbiomes', 'Roots of Renewal', 'Cave Waterfall', 'Rainforest Awakening', 'Central Haven', 'Level Up: Invasive Attack']);
  const f = (id, k) => FUTURE_MISSIONS.find((m) => m.id === id).fields.find((x) => x.key === k);
  assert.equal(f('f01', 'young').each, 20); assert.equal(f('f01', 'young').max, 4); assert.equal(f('f01', 'grand').max, 3); assert.equal(f('f01', 'queen').pts, 40);
  assert.equal(f('f02', 'base').each, 5); assert.equal(f('f02', 'canopy').each, 10); assert.equal(f('f02', 'canopy').max, 15);
  assert.equal(f('f03', 'cycled').each, 5); assert.equal(f('f03', 'cycled').max, 50);
  assert.equal(f('f04', 'species').pts, 30); assert.equal(f('f04', 'resources').pts, 20);
  assert.equal(f('f05', 'haven').each, 5); assert.equal(f('f05', 'haven').max, 80);
  assert.equal(f('f06', 'added').each, 20); assert.equal(f('f06', 'added').max, 5); assert.equal(f('f06', 'contained').each, 10);
});
test('future: an empty form scores 0 and has no equipment inspection or precision tokens', () => {
  const r = scoreAll(defaultState('future'), 'future');
  assert.equal(r.total, 0); assert.equal(r.equipment, 0); assert.equal(r.tokens, 0); assert.equal(r.edition, 'future');
  assert.ok(!('equip' in r.state) && !('tokens' in r.state));
});
test('future: every mission state agrees with the oracle (all counts, all bonus/invalid combinations)', () => {
  let n = 0;
  for (const m of FUTURE_MISSIONS) for (const raw of missionDomain(m)) {
    const st = defaultState('future'); st.m[m.id] = { ...st.m[m.id], ...raw };
    assert.equal(scoreAll(st, 'future').total, futureOracle(st), `${m.id} ${JSON.stringify(raw)}`); n++;
  }
  console.log(`        (${n} future mission states checked)`);
});
test('future: the invasive-queen bonus needs the 4th keystone species in the young forest', () => {
  const st = defaultState('future'); st.m.f01.queen = true; st.m.f01.young = 2;
  assert.equal(scoreAll(st, 'future').total, 40, 'bonus ignored: only the 2 species score');
  st.m.f01.young = 3; assert.equal(scoreAll(st, 'future').total, 60, 'three species and no 4th: no queen defeat, no bonus');
  st.m.f01.young = 4; assert.equal(scoreAll(st, 'future').total, 100, '3 score + the 4th triggers the bonus');
  st.m.f01.grand = 3; st.m.f01.hollow = 3; assert.equal(scoreAll(st, 'future').total, 220);
});
test('future: penalties — 1st −10, 2nd −30 in total, 3rd zeroes the match, never below 0', () => {
  const st = defaultState('future'); st.m.f03.cycled = 20; // 100 pts
  const t = (p) => { st.penalties = p; return scoreAll(st, 'future'); };
  assert.equal(t(0).total, 100); assert.equal(t(1).total, 90); assert.equal(t(2).total, 70); assert.equal(t(3).total, 0); assert.equal(t(3).zeroed, true);
  st.m.f03.cycled = 1; assert.equal(t(2).total, 0, 'a small score cannot go negative');
});
test('future: random full matches agree with the oracle and the Future maximum is the sum of the mission maxima', () => {
  let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 4000; i++) {
    const st = defaultState('future');
    for (const m of FUTURE_MISSIONS) for (const f of m.fields) st.m[m.id][f.key] = f.type === 'check' ? rnd() < 0.5 : Math.floor(rnd() * (f.max + 1));
    st.penalties = Math.floor(rnd() * 4);
    assert.equal(scoreAll(st, 'future').total, futureOracle(st));
  }
  const mx = maxScores('future');
  assert.equal(mx.perMission.f01, 220, '3+3+3 score at 20 each, plus the 40-point bonus');
  assert.equal(mx.perMission.f02, 175, '20 resources: 15 in the canopy (10 each), 5 in the base (5 each)');
  assert.ok(mx.total < Object.values(mx.perMission).reduce((a, b) => a + b, 0), 'shared pieces: the best match is below the sum of the mission maxima'); assert.equal(mx.perMission.f03, 250); assert.equal(mx.perMission.f04, 50);
  assert.equal(maxScores().total, maxScores('founders').total, 'Founders max unchanged');
});
test('editions: anything that is not "future" scores as Founders; the two engines do not mix', () => {
  assert.equal(editionOf(undefined), 'founders'); assert.equal(editionOf({ edition: 'future' }), 'future'); assert.equal(editionOf('future'), 'future'); assert.equal(editionOf('x'), 'founders');
  assert.equal(missionsOf('future'), FUTURE_MISSIONS); assert.equal(missionsOf(), MISSIONS);
  const st = normalizeState({ equip: true, tokens: 0, penalties: 1, m: { f03: { cycled: 4 } } }, 'future');
  assert.deepEqual(Object.keys(st).sort(), ['gp', 'm', 'penalties']); assert.equal(st.m.f03.cycled, 4);
});
test('future standings rank by the AVERAGE of the matches (Founders by best); equal averages share a rank', () => {
  const ts = [{ id: 'a', number: 1 }, { id: 'b', number: 2 }, { id: 'c', number: 3 }, { id: 'd', number: 4 }];
  const sc2 = (id, round, total) => ({ teamId: id, round, total });
  const scs = [sc2('a', 1, 300), sc2('a', 2, 0), sc2('a', 3, 0), sc2('b', 1, 150), sc2('b', 2, 140), sc2('b', 3, 130), sc2('c', 1, 200), sc2('c', 2, 80), sc2('d', 1, 140), sc2('d', 2, 140), sc2('d', 3, 140)];
  const fut = standings(ts, scs, 'future');
  // averages: a=100, b=140, c=140, d=140  → b, c, d tie for 1st (and a is 4th)
  assert.deepEqual(fut.map((r) => r.rank), [1, 1, 1, 4]); assert.ok(fut.slice(0, 3).every((r) => r.tied)); assert.equal(fut[3].team.id, 'a');
  assert.equal(fut[3].value, 100); assert.equal(fut[0].metric, 'avg');
  const fnd = standings(ts, scs, 'founders'); assert.equal(fnd[0].team.id, 'a'); assert.equal(fnd[0].value, 300);
});

console.log(`\n${passed} scoring tests passed`);
