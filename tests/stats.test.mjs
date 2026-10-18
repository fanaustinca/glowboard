// The team-stats maths, checked on hand-built practice runs with known answers.
import assert from 'node:assert/strict';
import { computeStats, filterRuns } from '../js/stats.js';
import { defaultState, scoreAll, maxScores } from '../js/scoring.js';
import { slim } from '../js/store.js';

let passed = 0;
const test = (n, f) => { f(); passed++; console.log('  ok  ' + n); };
const run = (mutate, t) => { const s = defaultState(); mutate(s.m, s); const res = scoreAll(s); return { total: res.total, state: res.state, result: slim(res), createdAt: t }; };
console.log('team stats');

// Run A: drone+lidar (30), vine (30). Run B: drone only (20), vine (30). Run C: nothing on those, vine. Run D: drone+lidar, no vine.
const A = run((m) => { m.m01.drone = true; m.m01.lidar = true; m.m08.vine = true; }, 1);
const B = run((m) => { m.m01.drone = true; m.m08.vine = true; }, 2);
const C = run((m) => { m.m08.vine = true; }, 3);
const D = run((m) => { m.m01.drone = true; m.m01.lidar = true; }, 4);
const runs = [A, B, C, D];

test('overall: best / average / median / spread', () => {
  const o = computeStats(runs).overall;
  const totals = runs.map((r) => r.total);
  assert.equal(o.n, 4); assert.equal(o.best, Math.max(...totals)); assert.equal(o.worst, Math.min(...totals));
  assert.ok(Math.abs(o.avg - totals.reduce((a, b) => a + b, 0) / 4) < 1e-9);
  assert.ok(o.std > 0); assert.equal(o.max, maxScores().total);
});
test('mission full-mark rate and average points', () => {
  const m01 = computeStats(runs).missions.find((m) => m.id === 'm01');
  assert.equal(m01.max, 30); assert.equal(m01.fullRate, 50);   // A and D scored 30/30
  assert.equal(m01.avg, (30 + 20 + 0 + 30) / 4); assert.equal(m01.zeroRate, 25); assert.equal(m01.scoredRate, 75);
  const m08 = computeStats(runs).missions.find((m) => m.id === 'm08');
  assert.equal(m08.fullRate, 75); assert.equal(m08.avgPct, 75);
});
test('task success rates: checklist items, counters and the bonus chain', () => {
  const m01 = computeStats(runs).missions.find((m) => m.id === 'm01');
  assert.equal(m01.tasks.find((t) => t.key === 'drone').rate, 75);
  assert.equal(m01.tasks.find((t) => t.key === 'lidar').rate, 50);
  const E1 = run((m) => { m.m02.seeds = 3; }, 5), E2 = run((m) => { m.m02.seeds = 1; }, 6);
  const m02 = computeStats([E1, E2]).missions.find((m) => m.id === 'm02').tasks[0];
  assert.equal(m02.kind, 'count'); assert.equal(m02.avg, 2); assert.ok(Math.abs(m02.rate - (2 / 3) * 100) < 1e-9);
});
test('most / least reliable ranking (full-mark rate first, then average %)', () => {
  const s = computeStats(runs);
  assert.equal(s.mostReliable[0].id, 'm08'); // 75% full
  assert.ok(s.mostReliable[0].fullRate >= s.mostReliable[1].fullRate);
  assert.equal(s.leastReliable[0].fullRate, 0);
  assert.ok(s.leastReliable.every((m, i, a) => i === 0 || a[i - 1].fullRate <= m.fullRate));
  assert.ok(s.neverFull.some((m) => m.id === 'm02') && !s.neverFull.some((m) => m.id === 'm08'));
});
test('inconsistent missions (high spread) need ≥3 runs; weakest tasks listed lowest-first', () => {
  assert.equal(computeStats([A, B]).inconsistent.length, 0);
  const s = computeStats(runs);
  assert.deepEqual(s.inconsistent.map((m) => m.id), ['m08', 'm01']); // vine is all-or-nothing (spread 0.43 of max), drone+lidar 0.41
  assert.ok(s.weakestTasks.every((t, i, a) => i === 0 || a[i - 1].rate <= t.rate));
  assert.ok(!s.weakestTasks.some((t) => /outside the habitat/.test(t.label)), 'penalty flags are not "tasks"');
});
test('trend compares the last 5 runs with the 5 before; points left on the table', () => {
  const many = Array.from({ length: 10 }, (_, i) => run((m) => { m.m08.vine = i >= 5; }, i));
  const o = computeStats(many).overall;
  assert.equal(o.last5Avg - many.slice(0, 5)[0].total, 30); assert.equal(o.trend, 30);
  assert.equal(computeStats(runs).overall.trend, null);
  assert.ok(computeStats(runs).pointsLeft[0].left >= computeStats(runs).pointsLeft[2].left);
});
test('equipment inspection and precision tokens', () => {
  const T = [run((m, s) => { s.equip = true; s.tokens = 4; }, 1), run((m, s) => { s.equip = false; s.tokens = 6; }, 2)];
  const s = computeStats(T);
  assert.equal(s.equip.rate, 50); assert.equal(s.tokens.avgRemaining, 5);
});
test('range filter keeps the most recent N runs in time order; empty input is safe', () => {
  const f = filterRuns([D, A, C, B], 2); assert.deepEqual(f.map((r) => r.createdAt), [3, 4]);
  assert.equal(filterRuns([D, A], 'all').length, 2);
  const e = computeStats([]); assert.equal(e.overall.n, 0); assert.equal(e.overall.best, null); assert.equal(e.mostReliable.length, 0);
});
console.log(`\n${passed} stats checks passed`);
