// Pure scoring engine — no DOM, no Firebase. Runs in the browser and in Node tests.
import {
  MISSIONS, EQUIPMENT_INSPECTION_POINTS, MAX_TOKENS, TOKEN_POINTS, GP_LEVELS,
} from './missions.js';

const toInt = (v) => (Number.isFinite(+v) ? Math.trunc(+v) : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, toInt(v)));

export function defaultMissionState(m) {
  const s = { eq: false };
  for (const f of m.fields) s[f.key] = f.def;
  return s;
}

export function defaultState() {
  return {
    equip: false,
    tokens: MAX_TOKENS, // every match starts with six precision tokens
    gp: 3,
    m: Object.fromEntries(MISSIONS.map((m) => [m.id, defaultMissionState(m)])),
  };
}

// Coerce one mission's raw state into a rule-consistent one (clamp counts, drop
// bonuses whose base condition is missing, etc.). Returns a new object.
export function normalizeMission(m, input) {
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

export function normalizeState(input) {
  const raw = input && typeof input === 'object' ? input : {};
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
    else if (f.type === 'count' && s[f.key]) lines.push({ label: `${f.label} × ${s[f.key]}`, pts: s[f.key] * f.each });
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
export function scoreAll(raw) {
  const st = normalizeState(raw);
  const equipment = st.equip ? EQUIPMENT_INSPECTION_POINTS : 0;
  const tokens = TOKEN_POINTS[st.tokens];
  const missions = MISSIONS.map((m) => ({ id: m.id, num: m.num, name: m.name, ...scoreMission(m, st.m[m.id]) }));
  const total = equipment + tokens + missions.reduce((a, x) => a + x.points, 0);
  return { state: st, equipment, tokens, missions, total, gp: st.gp, gpLabel: GP_LEVELS[st.gp] };
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

let _max;
export function maxScores() {
  if (_max) return _max;
  const perMission = {};
  for (const m of MISSIONS) {
    let best = 0;
    for (const raw of missionDomain(m)) best = Math.max(best, scoreMission(m, normalizeMission(m, raw)).points);
    perMission[m.id] = best;
  }
  const total = EQUIPMENT_INSPECTION_POINTS + Math.max(...TOKEN_POINTS)
    + Object.values(perMission).reduce((a, b) => a + b, 0);
  return (_max = { perMission, total });
}

// ---- Standings ----
// Only a team's best official match counts; ties are broken by 2nd then 3rd best.
// If all three match, teams share a rank (local officials decide).
export function standings(teams, scores) {
  const byTeam = new Map(teams.map((t) => [t.id, { team: t, rounds: {}, list: [] }]));
  for (const s of scores) {
    const row = byTeam.get(s.teamId);
    if (!row) continue;
    row.rounds[s.round] = s;
    row.list.push(s.total);
  }
  const rows = [...byTeam.values()].map((r) => {
    const sorted = [...r.list].sort((a, b) => b - a);
    return { ...r, sorted, best: sorted.length ? sorted[0] : null };
  });
  const cmp = (a, b) => {
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
