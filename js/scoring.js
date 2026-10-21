// Pure scoring engine — no DOM, no Firebase. Runs in the browser and in Node tests.
import {
  MISSIONS, FUTURE_MISSIONS, EQUIPMENT_INSPECTION_POINTS, MAX_TOKENS, TOKEN_POINTS, GP_LEVELS, PENALTY_DEDUCTION,
} from './missions.js';

// Two editions share one engine: Founders (the standard Challenge) and Future. Anything that isn't 'future' is Founders.
export const editionOf = (x) => ((x && typeof x === 'object' ? x.edition : x) === 'future' ? 'future' : 'founders');
export const missionsOf = (ed) => (editionOf(ed) === 'future' ? FUTURE_MISSIONS : MISSIONS);

const toInt = (v) => (Number.isFinite(+v) ? Math.trunc(+v) : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, toInt(v)));

export function defaultMissionState(m) {
  const s = { eq: false };
  for (const f of m.fields) s[f.key] = f.def;
  return s;
}

export function defaultState(ed = 'founders') {
  const m = Object.fromEntries(missionsOf(ed).map((x) => [x.id, defaultMissionState(x)]));
  if (editionOf(ed) === 'future') return { penalties: 0, gp: 3, m };
  return {
    equip: false,
    tokens: MAX_TOKENS, // every match starts with six precision tokens
    gp: 3,
    m,
  };
}

// Coerce one mission's raw state into a rule-consistent one (clamp counts, drop
// bonuses whose base condition is missing, etc.). Returns a new object.
export function normalizeMission(m, input, all) {
  const raw = input && typeof input === 'object' ? input : {};
  const s = { ...defaultMissionState(m) };
  s.eq = raw.eq === true;
  for (const f of m.fields) {
    const v = raw[f.key];
    if (f.type === 'check') s[f.key] = v === true;
    else if (f.type === 'count') s[f.key] = clamp(v, 0, f.max);
    else s[f.key] = f.options.some((o) => o.v === v) ? v : f.def;
    if (f.type === 'count' && f.maxFn) s[f.key] = Math.min(s[f.key], f.maxFn(s));
    if (f.requires && !f.requires(s)) s[f.key] = f.def;
  }
  return s;
}

// Missions share a limited pool of pieces, so they are normalised in order and later ones see earlier ones.
function futureMissions(input) {
  const out = {};
  for (const m of FUTURE_MISSIONS) out[m.id] = normalizeMission(m, input?.[m.id], out);
  return out;
}

export function normalizeState(input, ed = 'founders') {
  const raw = input && typeof input === 'object' ? input : {};
  if (editionOf(ed) === 'future') {
    return {
      penalties: clamp(raw.penalties, 0, 3),
      gp: [2, 3, 4].includes(toInt(raw.gp)) ? toInt(raw.gp) : 3,
      m: futureMissions(raw.m),
    };
  }
  return {
    equip: raw.equip === true,
    tokens: clamp(raw.tokens ?? MAX_TOKENS, 0, MAX_TOKENS),
    gp: [2, 3, 4].includes(toInt(raw.gp)) ? toInt(raw.gp) : 3,
    m: Object.fromEntries(MISSIONS.map((m) => [m.id, normalizeMission(m, raw.m?.[m.id])])),
  };
}

// Score one (already normalised) mission. Returns { points, lines:[{label,pts}], voided }.
export function scoreMission(m, s) {
  const lines = [];
  for (const f of m.fields) {
    if (f.type === 'check' && s[f.key] && f.pts) lines.push({ label: f.label, pts: f.pts });
    else if (f.type === 'count' && s[f.key]) lines.push({ label: `${f.label} × ${Math.min(s[f.key], f.scoreCap ?? Infinity)}`, pts: Math.min(s[f.key], f.scoreCap ?? Infinity) * f.each });
    else if (f.type === 'seg') {
      const o = f.options.find((x) => x.v === s[f.key]);
      if (o && o.pts) lines.push({ label: `${f.label}: ${o.label}`, pts: o.pts });
    }
  }
  if (m.extra) lines.push(...m.extra(s));
  const voidReason = (s.eq && m.noEquipment) ? 'Model touching equipment at end of match'
    : (m.voidIf ? m.voidIf(s) : null);
  const points = voidReason ? 0 : lines.reduce((a, l) => a + l.pts, 0);
  return { points, lines: voidReason ? [] : lines, voided: voidReason };
}

// Score a full match. Never throws on odd input: it normalises first.
export function scoreAll(raw, ed = 'founders') {
  if (editionOf(ed) === 'future') {
    const st = normalizeState(raw, 'future');
    const missions = FUTURE_MISSIONS.map((m) => ({ id: m.id, num: m.num, name: m.name, ...scoreMission(m, st.m[m.id]) }));
    const sum = missions.reduce((a, x) => a + x.points, 0);
    const zeroed = st.penalties >= 3; // a third interference penalty zeroes the whole match
    const penaltyPoints = zeroed ? 0 : -PENALTY_DEDUCTION[st.penalties];
    const total = zeroed ? 0 : Math.max(0, sum + penaltyPoints);
    return { edition: 'future', state: st, equipment: 0, tokens: 0, missions, penalties: st.penalties, penaltyPoints, zeroed, subtotal: sum, total, gp: st.gp, gpLabel: GP_LEVELS[st.gp] };
  }
  const st = normalizeState(raw);
  const equipment = st.equip ? EQUIPMENT_INSPECTION_POINTS : 0;
  const tokens = TOKEN_POINTS[st.tokens];
  const missions = MISSIONS.map((m) => ({ id: m.id, num: m.num, name: m.name, ...scoreMission(m, st.m[m.id]) }));
  const total = equipment + tokens + missions.reduce((a, x) => a + x.points, 0);
  return { edition: 'founders', state: st, equipment, tokens, missions, total, gp: st.gp, gpLabel: GP_LEVELS[st.gp] };
}

// ---- Maximum possible points (enumerated, so it can never drift from the rules) ----
function* domain(m, i = 0, cur = {}) {
  if (i === m.fields.length) { yield { ...cur }; return; }
  const f = m.fields[i];
  const vals = f.type === 'check' ? [false, true]
    : f.type === 'count' ? Array.from({ length: f.max + 1 }, (_, k) => k)
      : f.options.map((o) => o.v);
  for (const v of vals) { cur[f.key] = v; yield* domain(m, i + 1, cur); }
}
export function* missionDomain(m) { for (const d of domain(m)) for (const eq of [false, true]) yield { ...d, eq }; }

const _max = {};
export function maxScores(ed = 'founders') {
  ed = editionOf(ed);
  if (_max[ed]) return _max[ed];
  const perMission = {};
  for (const m of missionsOf(ed)) {
    let best = 0;
    for (const raw of missionDomain(m)) best = Math.max(best, scoreMission(m, normalizeMission(m, raw)).points);
    perMission[m.id] = best;
  }
  const sum = Object.values(perMission).reduce((a, b) => a + b, 0);
  const total = ed === 'future' ? sum : EQUIPMENT_INSPECTION_POINTS + Math.max(...TOKEN_POINTS) + sum;
  return (_max[ed] = { perMission, total });
}

// ---- Standings ----
// Founders: only a team's best official match counts; ties are broken by 2nd then 3rd best.
// Future: the AVERAGE of a team's official matches decides the rank (Future Rulebook, Scoring).
// Equal results share a rank (local officials decide). Each row has `value` (the number it is ranked on) and `best`/`avg`.
export function standings(teams, scores, ed = 'founders') {
  const future = editionOf(ed) === 'future';
  const byTeam = new Map(teams.map((t) => [t.id, { team: t, rounds: {}, list: [] }]));
  for (const s of scores) {
    const row = byTeam.get(s.teamId);
    if (!row) continue;
    row.rounds[s.round] = s;
    row.list.push(s.total);
  }
  const rows = [...byTeam.values()].map((r) => {
    const sorted = [...r.list].sort((a, b) => b - a);
    const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null;
    const best = sorted.length ? sorted[0] : null;
    return { ...r, sorted, best, avg, metric: future ? 'avg' : 'best', value: future ? (avg === null ? null : Math.round(avg * 10) / 10) : best };
  });
  const cmp = (a, b) => {
    if (future) return Math.round(b.avg * 100) - Math.round(a.avg * 100);
    for (let i = 0; i < 3; i++) {
      const x = a.sorted[i] ?? -1, y = b.sorted[i] ?? -1;
      if (x !== y) return y - x;
    }
    return 0;
  };
  const ranked = rows.filter((r) => r.best !== null).sort((a, b) => cmp(a, b) || (a.team.number - b.team.number));
  let rank = 0;
  ranked.forEach((r, i) => {
    if (i === 0 || cmp(ranked[i - 1], r) !== 0) rank = i + 1;
    r.rank = rank;
    r.tied = (ranked[i - 1] && cmp(ranked[i - 1], r) === 0) || (ranked[i + 1] && cmp(ranked[i + 1], r) === 0);
  });
  const unranked = rows.filter((r) => r.best === null).sort((a, b) => a.team.number - b.team.number);
  unranked.forEach((r) => { r.rank = null; r.tied = false; });
  return [...ranked, ...unranked];
}
