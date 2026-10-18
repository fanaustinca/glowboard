// Team practice analytics. Pure functions over saved practice runs ({ total, state, result, createdAt, by }).
// "Success" for a mission = the run scored FULL points on it. "Reliable" missions are the ones a team gets right
// run after run; "least reliable" are the ones it keeps missing — the best things to practise next.
import { MISSIONS, TOKEN_POINTS, MAX_TOKENS } from './missions.js';
import { maxScores } from './scoring.js';

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const pct = (a, b) => (b ? (a / b) * 100 : 0);

export function filterRuns(runs, range) {
  const sorted = runs.slice().sort((a, b) => a.createdAt - b.createdAt);
  if (range === 'all' || !range) return sorted;
  return sorted.slice(-Number(range));
}

// Per-task description for each mission field (what counts as "got it").
function taskStat(field, runs, mid) {
  const vals = runs.map((r) => r.state?.m?.[mid]?.[field.key]);
  if (field.type === 'check') {
    if (field.danger) return null; // "katydid left habitat" style flags are penalties, not tasks to succeed at
    return { key: field.key, label: field.label, kind: 'check', rate: pct(vals.filter(Boolean).length, runs.length) };
  }
  if (field.type === 'count') {
    const nums = vals.map((v) => Number(v) || 0);
    const cap = Math.max(...runs.map((r) => (field.maxFn ? field.maxFn(r.state.m[mid]) : field.max)), 0) || field.max;
    return { key: field.key, label: field.label, kind: 'count', avg: mean(nums), max: field.max, rate: pct(mean(nums), cap || field.max) };
  }
  // segmented: success = the best option
  const best = field.options[field.options.length - 1];
  if (!best.pts) return null; // e.g. dock selector: not a scoring step by itself
  return { key: field.key, label: field.label, kind: 'seg', rate: pct(vals.filter((v) => v === best.v).length, runs.length) };
}

export function computeStats(runsIn) {
  const runs = runsIn.slice().sort((a, b) => a.createdAt - b.createdAt);
  const n = runs.length;
  const mx = maxScores();
  const totals = runs.map((r) => r.total);
  const last5 = totals.slice(-5), prev5 = totals.slice(-10, -5);
  const overall = {
    n, best: n ? Math.max(...totals) : null, worst: n ? Math.min(...totals) : null, avg: mean(totals), median: median(totals), std: std(totals),
    last5Avg: last5.length ? mean(last5) : null, trend: last5.length && prev5.length ? mean(last5) - mean(prev5) : null,
    avgPctOfMax: pct(mean(totals), mx.total), max: mx.total,
  };
  const equip = { rate: pct(runs.filter((r) => r.state?.equip).length, n) };
  const tokens = { avgRemaining: mean(runs.map((r) => r.state?.tokens ?? 0)), avgPoints: mean(runs.map((r) => r.result?.tokens ?? TOKEN_POINTS[r.state?.tokens ?? 0] ?? 0)), max: MAX_TOKENS };

  const missions = MISSIONS.map((m) => {
    const pts = runs.map((r) => r.result?.missions?.find((x) => x.id === m.id)?.points ?? 0);
    const full = mx.perMission[m.id];
    const a = mean(pts);
    return {
      id: m.id, num: m.num, name: m.name, max: full, n, avg: a, avgPct: pct(a, full), std: std(pts),
      fullRate: pct(pts.filter((p) => p >= full).length, n), zeroRate: pct(pts.filter((p) => p === 0).length, n),
      scoredRate: pct(pts.filter((p) => p > 0).length, n), best: n ? Math.max(...pts) : 0,
      tasks: m.fields.map((f) => taskStat(f, runs, m.id)).filter(Boolean),
    };
  });

  const ranked = missions.filter((m) => n > 0);
  // reliability = how often it scores full marks, then how much of its points it averages
  const byReliable = ranked.slice().sort((a, b) => b.fullRate - a.fullRate || b.avgPct - a.avgPct || a.num - b.num);
  const byUnreliable = ranked.slice().sort((a, b) => a.fullRate - b.fullRate || a.avgPct - b.avgPct || a.num - b.num);
  const inconsistent = ranked.filter((m) => m.n >= 3 && m.std > 0).sort((a, b) => b.std / b.max - a.std / a.max || a.num - b.num);
  const tasks = missions.flatMap((m) => m.tasks.map((t) => ({ ...t, mission: m.name, num: m.num, mid: m.id })));
  return {
    overall, equip, tokens, missions,
    mostReliable: byReliable.slice(0, 3), leastReliable: byUnreliable.slice(0, 3),
    neverFull: ranked.filter((m) => m.fullRate === 0).sort((a, b) => a.avgPct - b.avgPct),
    inconsistent: inconsistent.slice(0, 3),
    weakestTasks: tasks.slice().sort((a, b) => a.rate - b.rate || a.num - b.num).slice(0, 5),
    pointsLeft: ranked.map((m) => ({ id: m.id, num: m.num, name: m.name, left: m.max - m.avg })).sort((a, b) => b.left - a.left).slice(0, 3),
  };
}
