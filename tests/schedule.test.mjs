// Property tests for the schedule generator across many team / table / round combinations.
import assert from 'node:assert/strict';
import { generateSchedule, groupSchedule, clampConfig, scheduleTable, toCSV, toTSV, fmtTime } from '../js/schedule.js';

let passed = 0;
const test = (n, f) => { f(); passed++; console.log('  ok  ' + n); };
const ids = (n) => Array.from({ length: n }, (_, i) => `t${100 + i}`);
console.log('schedule generator');

test('every team plays exactly `rounds` matches; ≤ tables per slot; no team twice in a slot; one table per team per slot', () => {
  let cases = 0;
  for (let N = 1; N <= 60; N += (N < 12 ? 1 : 5)) for (const T of [1, 2, 3, 4, 6, 8, 12]) for (const R of [1, 2, 3, 4, 5]) {
    const s = generateSchedule(ids(N), { rounds: R, tables: T }, N * 31 + T);
    cases++;
    const per = {};
    const slotTeams = {}; const slotTables = {};
    for (const r of s.rows) {
      per[r.teamId] = (per[r.teamId] || 0) + 1;
      (slotTeams[r.slot] ||= []).push(r.teamId); (slotTables[r.slot] ||= []).push(r.tableNo);
      assert.ok(r.tableNo >= 1 && r.tableNo <= T, `table in range (N=${N},T=${T})`);
    }
    assert.equal(Object.keys(per).length, N, `all ${N} teams scheduled`);
    for (const id of Object.keys(per)) assert.equal(per[id], R, `${id} plays ${R} (N=${N},T=${T},R=${R})`);
    for (const k of Object.keys(slotTeams)) {
      assert.ok(slotTeams[k].length <= T, 'at most one team per table per slot');
      assert.equal(new Set(slotTeams[k]).size, slotTeams[k].length, 'no team twice in a slot');
      assert.equal(new Set(slotTables[k]).size, slotTables[k].length, 'no two teams on a table in a slot');
    }
    assert.equal(s.rows.length, N * R);
  }
  assert.ok(cases > 300);
});
test('each round has every team exactly once', () => {
  const s = generateSchedule(ids(23), { rounds: 4, tables: 5 }, 9);
  for (let r = 1; r <= 4; r++) { const t = s.rows.filter((x) => x.round === r).map((x) => x.teamId); assert.equal(new Set(t).size, 23); assert.equal(t.length, 23); }
});
test('nobody plays back-to-back across rounds when each round has ≥ 3 slots', () => {
  for (let N = 9; N <= 48; N++) for (const T of [2, 3, 4]) {
    if (Math.ceil(N / T) < 3) continue;
    for (const R of [2, 3, 4]) {
      const s = generateSchedule(ids(N), { rounds: R, tables: T }, N);
      assert.ok(s.stats.minGap >= 2, `N=${N} T=${T} R=${R}: min gap ${s.stats.minGap} slots`);
    }
  }
});
test('typical event: 24 teams, 4 tables, 3 rounds → 6 slots/round, healthy rest gaps, tables rotate', () => {
  const s = generateSchedule(ids(24), { rounds: 3, tables: 4 }, 5);
  assert.equal(s.stats.slotsPerRound, 6); assert.equal(s.stats.totalSlots, 18); assert.ok(s.stats.minGap >= 3, 'min gap ' + s.stats.minGap);
  assert.equal(s.stats.tableRepeats, 0, 'no team uses the same table twice');
});
test('times: start + interval per slot + break between rounds', () => {
  const s = generateSchedule(ids(8), { rounds: 2, tables: 4, start: '09:30', interval: 10, breakMin: 20 }, 1);
  assert.equal(s.stats.slotsPerRound, 2);
  const times = [...new Set(s.rows.map((r) => r.time))];
  assert.deepEqual(times, ['09:30', '09:40', '10:10', '10:20']);
  assert.equal(s.stats.endsAt, '10:30');
  assert.equal(fmtTime('23:50', 20), '00:10');
});
test('deterministic for the same seed, different for another', () => {
  const a = generateSchedule(ids(20), {}, 3), b = generateSchedule(ids(20), {}, 3), c = generateSchedule(ids(20), {}, 4);
  assert.deepEqual(a.rows, b.rows); assert.notDeepEqual(a.rows, c.rows);
});
test('config is clamped and sanitised; empty / single-team / duplicate inputs are safe', () => {
  assert.deepEqual(clampConfig({ rounds: 99, tables: 0, interval: 'x', breakMin: -5, start: '25:99' }), { rounds: 8, tables: 1, interval: 10, breakMin: 0, start: '09:00' });
  assert.equal(generateSchedule([], {}).rows.length, 0);
  assert.equal(generateSchedule(['a'], { rounds: 3, tables: 4 }).rows.length, 3);
  assert.equal(generateSchedule(['a', 'a', 'b'], { rounds: 1, tables: 2 }).rows.length, 2);
});
test('grouping and exports: CSV quoting, TSV for Google Sheets paste', () => {
  const teams = [{ id: 't1', number: 1, name: 'Alpha, "Prime"' }, { id: 't2', number: 2, name: 'Beta' }];
  const s = generateSchedule(['t1', 't2'], { rounds: 1, tables: 2 }, 1);
  const g = groupSchedule(s.rows); assert.equal(g.length, 1); assert.equal(Object.keys(g[0].slots[0].tables).length, 2);
  const table = scheduleTable(s, teams, 'Reg');
  assert.deepEqual(table[0], ['Event', 'Round', 'Time', 'Table', 'Team number', 'Team name']); assert.equal(table.length, 3);
  assert.match(toCSV(table), /"Alpha, ""Prime"""/); assert.ok(toTSV(table).split('\n')[1].split('\t').length === 6);
});
console.log(`\n${passed} schedule checks passed`);
{
  const { generateSchedule: gen, tableLabel } = await import('../js/schedule.js');
  const two = gen(['a', 'b', 'c', 'd'], { tables: 2, rounds: 3 }, 1);
  assert.deepEqual([...new Set(two.rows.map((r) => r.table))].sort(), ['A', 'B'], 'two tables are called A and B');
  assert.equal(tableLabel(3, 4), '3');
  // teams do not meet the same opponents every round
  const ids = Array.from({ length: 12 }, (_, i) => `t${i}`);
  const s = gen(ids, { tables: 4, rounds: 3 }, 5);
  const groups = [1, 2, 3].map((r) => { const by = {}; s.rows.filter((x) => x.round === r).forEach((x) => (by[x.slot] ||= []).push(x.teamId)); return Object.values(by).map((g) => g.sort().join()); });
  assert.ok(groups[1].some((g) => !groups[0].includes(g)) && groups[2].some((g) => !groups[0].includes(g)), 'groups are re-dealt each round');
  assert.equal(s.stats.tableRepeats <= 2, true, `table repeats stay low (${s.stats.tableRepeats})`);
  console.log('schedule: A/B tables and mixed opponents ok');
}
