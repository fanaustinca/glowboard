// Match-schedule generator + exporters. Pure functions (no DOM / Firebase) so they are easy to test.
//
// Model: every team plays `rounds` matches. A "slot" is one time block in which up to `tables` teams
// run at once (one team per table). Each round is ceil(N / tables) slots, rounds run back to back with a break.
// Goals, in priority order:
//   1. every team plays exactly `rounds` matches, never twice in one slot, never more than `tables` per slot
//   2. nobody plays back-to-back across a round boundary (maximise the smallest gap between a team's matches)
//   3. teams change tables from round to round
// The result is reproducible for a given seed (different seeds reshuffle which teams are grouped together).

export const SCHEDULE_DEFAULTS = { rounds: 3, tables: 4, start: '09:00', interval: 10, breakMin: 15 };
export const LIMITS = { rounds: [1, 8], tables: [1, 24], interval: [3, 60], breakMin: [0, 120] };

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const shuffle = (arr, rand) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

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

// Teams are shuffled (seeded) and cut into S groups of `tables` teams. In round r group g runs in slot (g - r) mod S:
// with S >= 3 slots per round that keeps the gap between a team's consecutive matches at S-1 slots or more
// (never back-to-back) while still moving every team earlier/later each round. With S <= 2 every round reuses
// the same slots (a gap of S is then the best possible). Table numbers rotate by one each round.
function build(teamIds, cfg, rand) {
  const T = cfg.tables, base = shuffle(teamIds, rand), S = Math.ceil(base.length / T);
  const groups = Array.from({ length: S }, (_, g) => base.slice(g * T, g * T + T));
  const step = S >= 3 ? S - 1 : 0;
  return Array.from({ length: cfg.rounds }, (_, r) => groups.flatMap((group, g) => group.map((teamId, i) => (
    { round: r + 1, slotInRound: (g + step * r) % S, table: ((i + r) % T) + 1, teamId }))));
}

function evaluate(rounds, N, T) {
  const S = Math.ceil(N / T);
  const slots = new Map(); // teamId -> [absolute slot indexes], tables
  const tablesUsed = new Map();
  rounds.forEach((rows, r) => rows.forEach((x) => {
    const abs = r * S + x.slotInRound;
    (slots.get(x.teamId) || slots.set(x.teamId, []).get(x.teamId)).push(abs);
    (tablesUsed.get(x.teamId) || tablesUsed.set(x.teamId, []).get(x.teamId)).push(x.table);
  }));
  let minGap = Infinity, repeats = 0;
  for (const [id, list] of slots) {
    list.sort((a, b) => a - b);
    for (let i = 1; i < list.length; i++) minGap = Math.min(minGap, list[i] - list[i - 1]);
    const t = tablesUsed.get(id); repeats += t.length - new Set(t).size;
  }
  return { minGap: Number.isFinite(minGap) ? minGap : Infinity, repeats };
}

export function generateSchedule(teamIds, config = {}, seed = 1) {
  const cfg = clampConfig(config);
  const ids = [...new Set(teamIds)];
  const N = ids.length;
  if (!N) return { config: cfg, rows: [], stats: { teams: 0, slotsPerRound: 0, totalSlots: 0, minGap: null, tableRepeats: 0, endsAt: cfg.start } };
  const S = Math.ceil(N / cfg.tables);
  const cand = build(ids, cfg, rng(seed * 7919 + 1));
  const best = { cand, ev: evaluate(cand, N, cfg.tables) };
  const rows = [];
  best.cand.forEach((list, r) => list.forEach((x) => {
    const minutes = (r * S + x.slotInRound) * cfg.interval + r * cfg.breakMin;
    rows.push({ round: x.round, slot: r * S + x.slotInRound + 1, time: fmtTime(cfg.start, minutes), table: x.table, teamId: x.teamId });
  }));
  rows.sort((a, b) => a.slot - b.slot || a.table - b.table);
  const lastMinutes = ((cfg.rounds * S - 1) * cfg.interval) + (cfg.rounds - 1) * cfg.breakMin + cfg.interval;
  return { config: cfg, rows, stats: { teams: N, slotsPerRound: S, totalSlots: cfg.rounds * S, minGap: best.ev.minGap, tableRepeats: best.ev.repeats, endsAt: fmtTime(cfg.start, lastMinutes) } };
}

// Rows grouped as [{ round, slots: [{ slot, time, tables: {1: teamId, …} }] }] for display.
export function groupSchedule(rows) {
  const rounds = new Map();
  for (const r of rows) {
    const round = rounds.get(r.round) || rounds.set(r.round, new Map()).get(r.round);
    const slot = round.get(r.slot) || round.set(r.slot, { slot: r.slot, time: r.time, tables: {} }).get(r.slot);
    slot.tables[r.table] = r.teamId;
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
