// Match-schedule generator + exporters. Pure functions (no DOM / Firebase) so they are easy to test.
//
// Model: every team plays `rounds` matches. A "slot" is one time block in which up to `tables` teams
// run at once (one team per table). Each round is ceil(N / tables) slots, rounds run back to back with a break.
// Goals, in priority order:
//   1. every team plays exactly `rounds` matches, never twice in one slot, never more than `tables` per slot
//   2. nobody plays back-to-back across a round boundary (maximise the smallest gap between a team's matches)
//   3. teams change tables from round to round
// 4. teams meet different opponents each round: the groups are re-drawn every round and the schedule with the fewest repeat pairings wins.
// The result is reproducible for a given seed (different seeds reshuffle which teams are grouped together).

export const SCHEDULE_DEFAULTS = { rounds: 3, tables: 4, start: '09:00', interval: 10, breakMin: 15 };
export const LIMITS = { rounds: [1, 8], tables: [1, 24], interval: [3, 60], breakMin: [0, 120] };

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const shuffle = (arr, rand) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// With exactly two tables they are called A and B; otherwise 1, 2, 3…
export const tableLabel = (n, tables) => (tables === 2 ? 'AB'[n - 1] : String(n));

export function clampConfig(c = {}) {
  const num = (k) => { const v = Math.round(Number(c[k] ?? SCHEDULE_DEFAULTS[k])); const [lo, hi] = LIMITS[k]; return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : SCHEDULE_DEFAULTS[k])); };
  const start = /^([01]\d|2[0-3]):[0-5]\d$/.test(c.start || '') ? c.start : SCHEDULE_DEFAULTS.start;
  return { rounds: num('rounds'), tables: num('tables'), interval: num('interval'), breakMin: num('breakMin'), start };
}

export function fmtTime(startHHMM, minutesFromStart) {
  const [h, m] = startHHMM.split(':').map(Number);
  const t = (h * 60 + m + minutesFromStart) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

// Teams are shuffled (seeded) and cut into S groups of `tables` teams. "Fixed" keeps the same groups every round and moves
// them to different slots; "mixed" re-deals the groups each round so teams meet new opponents. Table numbers rotate each round.
function build(teamIds, cfg, rand, mixed) {
  const T = cfg.tables, S = Math.ceil(teamIds.length / T);
  const deal = () => { const base = shuffle(teamIds, rand); return Array.from({ length: S }, (_, g) => base.slice(g * T, g * T + T)); };
  const fixed = mixed ? null : deal();
  const step = S >= 3 ? S - 1 : 0;
  const used = new Map(); // teamId -> table numbers already played
  return Array.from({ length: cfg.rounds }, (_, r) => (mixed ? deal() : fixed).flatMap((group, g) => {
    const free = shuffle(Array.from({ length: T }, (_, i) => i + 1), rand);
    return group.map((teamId, i) => {
      const seen = used.get(teamId) || used.set(teamId, []).get(teamId);
      let table;
      if (mixed) { // a table this team has not used yet (least-used when all have been)
        table = free.slice().sort((a, b) => seen.filter((x) => x === a).length - seen.filter((x) => x === b).length)[0];
        free.splice(free.indexOf(table), 1);
      } else table = ((i + r) % T) + 1;
      seen.push(table);
      return { round: r + 1, slotInRound: mixed ? g : (g + step * r) % S, table, teamId };
    });
  }));
}

function evaluate(rounds, N, T) {
  const S = Math.ceil(N / T);
  const slots = new Map(); // teamId -> [absolute slot indexes], tables
  const tablesUsed = new Map();
  const together = new Map(); // "a|b" -> times those two teams were in the same slot
  rounds.forEach((rows, r) => {
    const bySlot = new Map();
    rows.forEach((x) => {
      const abs = r * S + x.slotInRound;
      (slots.get(x.teamId) || slots.set(x.teamId, []).get(x.teamId)).push(abs);
      (tablesUsed.get(x.teamId) || tablesUsed.set(x.teamId, []).get(x.teamId)).push(x.table);
      (bySlot.get(x.slotInRound) || bySlot.set(x.slotInRound, []).get(x.slotInRound)).push(x.teamId);
    });
    for (const ids of bySlot.values()) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const k = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`; together.set(k, (together.get(k) || 0) + 1);
    }
  });
  let minGap = Infinity, repeats = 0, rematches = 0;
  for (const [id, list] of slots) {
    list.sort((a, b) => a - b);
    for (let i = 1; i < list.length; i++) minGap = Math.min(minGap, list[i] - list[i - 1]);
    const t = tablesUsed.get(id); repeats += t.length - new Set(t).size;
  }
  for (const n of together.values()) rematches += n - 1;
  return { minGap: Number.isFinite(minGap) ? minGap : Infinity, repeats, rematches };
}
const better = (a, b) => (a.minGap !== b.minGap ? a.minGap > b.minGap : a.rematches !== b.rematches ? a.rematches < b.rematches : a.repeats < b.repeats);

export function generateSchedule(teamIds, config = {}, seed = 1) {
  const cfg = clampConfig(config);
  const ids = [...new Set(teamIds)];
  const N = ids.length;
  if (!N) return { config: cfg, rows: [], stats: { teams: 0, slotsPerRound: 0, totalSlots: 0, minGap: null, tableRepeats: 0, endsAt: cfg.start } };
  const S = Math.ceil(N / cfg.tables);
  const rand = rng(seed * 7919 + 1);
  let best = null;
  // keep the best of the fixed-group layout (which guarantees rest between matches) and many re-dealt layouts
  for (let i = 0; i < 400; i++) {
    const cand = build(ids, cfg, rand, i > 0 && N > cfg.tables && cfg.rounds > 1);
    const ev = evaluate(cand, N, cfg.tables);
    if (!best || better(ev, best.ev)) best = { cand, ev };
  }
  const rows = [];
  best.cand.forEach((list, r) => list.forEach((x) => {
    const minutes = (r * S + x.slotInRound) * cfg.interval + r * cfg.breakMin;
    rows.push({ round: x.round, slot: r * S + x.slotInRound + 1, time: fmtTime(cfg.start, minutes), table: tableLabel(x.table, cfg.tables), tableNo: x.table, teamId: x.teamId });
  }));
  rows.sort((a, b) => a.slot - b.slot || a.tableNo - b.tableNo);
  const lastMinutes = ((cfg.rounds * S - 1) * cfg.interval) + (cfg.rounds - 1) * cfg.breakMin + cfg.interval;
  return { config: cfg, rows, stats: { teams: N, slotsPerRound: S, totalSlots: cfg.rounds * S, minGap: best.ev.minGap, tableRepeats: best.ev.repeats, rematches: best.ev.rematches, endsAt: fmtTime(cfg.start, lastMinutes) } };
}

// Problems in a (hand-edited) schedule: a team booked twice in one slot, or not playing exactly `rounds` matches.
export function scheduleIssues(rows, cfg) {
  const out = [], per = new Map(), slotSeen = new Map();
  for (const r of rows) {
    const k = `${r.slot}|${r.teamId}`;
    if (slotSeen.has(k)) out.push(`Team ${r.teamId} is on two tables at ${r.time}.`); slotSeen.set(k, 1);
    (per.get(r.teamId) || per.set(r.teamId, new Set()).get(r.teamId)).add(r.round);
  }
  for (const [id, rs] of per) if (rs.size !== cfg.rounds || ![...rs].every((x) => x >= 1 && x <= cfg.rounds)) out.push(`Team ${id} plays ${rs.size} of ${cfg.rounds} rounds.`);
  const counts = new Map(); rows.forEach((r) => counts.set(r.teamId, (counts.get(r.teamId) || 0) + 1));
  for (const [id, n] of counts) if (n !== cfg.rounds && !out.some((m) => m.includes(`Team ${id} `))) out.push(`Team ${id} has ${n} matches (expected ${cfg.rounds}).`);
  return out;
}

// Fresh stats for edited rows (same fields generateSchedule returns).
export function restat(rows, cfg) {
  const ids = [...new Set(rows.map((r) => r.teamId))], N = ids.length, S = Math.max(1, Math.ceil(N / cfg.tables));
  const rounds = Array.from({ length: cfg.rounds }, (_, r) => rows.filter((x) => x.round === r + 1).map((x) => ({ ...x, slotInRound: x.slot - r * S - 1, table: x.tableNo ?? x.table })));
  const ev = evaluate(rounds, N, cfg.tables);
  return { teams: N, slotsPerRound: S, totalSlots: cfg.rounds * S, minGap: ev.minGap, tableRepeats: ev.repeats, rematches: ev.rematches, endsAt: fmtTime(cfg.start, ((cfg.rounds * S - 1) * cfg.interval) + (cfg.rounds - 1) * cfg.breakMin + cfg.interval) };
}

// Rows grouped as [{ round, slots: [{ slot, time, tables: {1: teamId, …} }] }] for display.
export function groupSchedule(rows) {
  const rounds = new Map();
  for (const r of rows) {
    const round = rounds.get(r.round) || rounds.set(r.round, new Map()).get(r.round);
    const slot = round.get(r.slot) || round.set(r.slot, { slot: r.slot, time: r.time, tables: {} }).get(r.slot);
    slot.tables[r.tableNo ?? r.table] = r.teamId;
  }
  return [...rounds].sort((a, b) => a[0] - b[0]).map(([round, slots]) => ({ round, slots: [...slots.values()].sort((a, b) => a.slot - b.slot) }));
}

const cell = (v) => String(v ?? '');
// Flat export table: one line per team match, sorted by time then table.
export function scheduleTable(schedule, teams, eventName = '') {
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]));
  const head = ['Event', 'Round', 'Time', 'Table', 'Team number', 'Team name'];
  const rows = (schedule?.rows || []).map((r) => [eventName, r.round, r.time, r.table, byId[r.teamId]?.number ?? '', byId[r.teamId]?.name ?? r.teamId]);
  return [head, ...rows];
}
const csvEsc = (v) => (/[",\n\t]/.test(cell(v)) ? `"${cell(v).replace(/"/g, '""')}"` : cell(v));
export const toCSV = (table) => table.map((r) => r.map(csvEsc).join(',')).join('\n');
export const toTSV = (table) => table.map((r) => r.map((v) => cell(v).replace(/[\t\n]/g, ' ')).join('\t')).join('\n'); // pastes straight into Google Sheets
