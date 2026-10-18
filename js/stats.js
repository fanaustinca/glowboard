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

// ───────────── Over-time analytics (Analytics page) ─────────────
const rollMean = (a, w) => a.map((_, i) => mean(a.slice(Math.max(0, i - w + 1), i + 1)));
const rollStd = (a, w) => a.map((_, i) => std(a.slice(Math.max(0, i - w + 1), i + 1)));
// least-squares slope of y over 0..n-1 (units of y per run)
const slope = (y) => {
  const n = y.length; if (n < 2) return 0;
  const mx = (n - 1) / 2, my = mean(y);
  let num = 0, den = 0; y.forEach((v, i) => { num += (i - mx) * (v - my); den += (i - mx) ** 2; });
  return den ? num / den : 0;
};
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function computeSeries(runsIn, win = 5, officialIn = []) {
  const runs = runsIn.slice().sort((a, b) => a.createdAt - b.createdAt);
  const n = runs.length, mx = maxScores();
  const totals = runs.map((r) => r.total);
  const roll = rollMean(totals, win), rstd = rollStd(totals, win);
  let top = -Infinity;
  const best = totals.map((t) => (top = Math.max(top, t)));
  const ptsOf = (r, id) => r.result?.missions?.find((x) => x.id === id)?.points ?? 0;
  const per = MISSIONS.map((m) => {
    const full = mx.perMission[m.id];
    const pts = runs.map((r) => ptsOf(r, m.id));
    const pctV = pts.map((p) => pct(p, full));
    const fullV = pts.map((p) => (p >= full ? 100 : 0));
    const h = Math.floor(n / 2);
    return { id: m.id, num: m.num, name: m.name, max: full, pts, pct: pctV, full: fullV, rollFull: rollMean(fullV, win), rollPct: rollMean(pctV, win),
      avgPct: mean(pctV), fullRate: mean(fullV), slope: slope(pctV), firstHalf: mean(pctV.slice(0, h || 1)), lastHalf: mean(pctV.slice(h)) };
  });
  const missionsFull = runs.map((_, i) => pct(per.filter((m) => m.pts[i] >= m.max).length, per.length));
  const equip = runs.map((r) => (r.state?.equip ? 100 : 0));
  const tokensLeft = runs.map((r) => r.state?.tokens ?? 0);
  const rows = runs.map((r, i) => ({
    i: i + 1, t: r.createdAt, by: r.by || '', note: r.note || '', total: r.total, delta: i ? r.total - totals[i - 1] : 0, rolling: roll[i], best: best[i],
    pctMax: pct(r.total, mx.total), equip: equip[i] ? 1 : 0, tokens: tokensLeft[i], missionsFull: missionsFull[i], std: rstd[i], pts: Object.fromEntries(per.map((m) => [m.id, m.pts[i]])),
  }));
  const h = Math.floor(n / 2);
  const bins = 10, bw = Math.max(1, Math.ceil((mx.total + 1) / bins));
  const hist = Array.from({ length: bins }, (_, b) => ({ from: b * bw, to: Math.min(mx.total, (b + 1) * bw - 1), count: totals.filter((t) => Math.floor(t / bw) === b || (b === bins - 1 && t >= (b + 1) * bw)).length }));
  const days = new Map();
  runs.forEach((r) => { const k = dayKey(r.createdAt); (days.get(k) || days.set(k, []).get(k)).push(r.total); });
  const byDay = [...days].map(([day, v]) => ({ day, runs: v.length, avg: mean(v), best: Math.max(...v) }));
  const official = officialIn.slice().sort((a, b) => a.round - b.round).map((s) => ({ round: s.round, total: s.total, event: s.eventName || '' }));
  return {
    n, max: mx.total, win, rows, per, hist, byDay, official,
    rolling: { score: roll, std: rstd, missionsFull: rollMean(missionsFull, win), equip: rollMean(equip, win), tokens: rollMean(tokensLeft, win) },
    improvement: { slope: slope(totals), firstHalf: mean(totals.slice(0, h || 1)), lastHalf: mean(totals.slice(h)), change: n > 1 ? totals[n - 1] - totals[0] : 0, best: n ? Math.max(...totals) : 0 },
  };
}

// Tables (arrays of rows, header first) for copying / downloading. Keys match the cards on the Analytics page.
export function seriesTables(s) {
  const f = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : '');
  const when = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  const mcols = s.per.map((m) => `M${String(m.num).padStart(2, '0')} ${m.name}`);
  return {
    runs: [['Run', 'Date', 'By', 'Note', 'Score', 'Change vs previous', `Rolling avg (${s.win})`, 'Best so far', '% of max', 'Equipment inspection', 'Tokens left', '% missions full marks', `Rolling std (${s.win})`, ...mcols],
      ...s.rows.map((r) => [r.i, when(r.t), r.by, r.note, r.total, r.delta, f(r.rolling), r.best, f(r.pctMax), r.equip, r.tokens, f(r.missionsFull), f(r.std), ...s.per.map((m) => r.pts[m.id])])],
    score: [['Run', 'Score', `Rolling avg (${s.win})`, 'Best so far'], ...s.rows.map((r) => [r.i, r.total, f(r.rolling), r.best])],
    gain: [['Run', 'Change vs previous run'], ...s.rows.map((r) => [r.i, r.delta])],
    missionRate: [['Run', ...mcols.map((c) => `${c} (rolling ${s.win} full-marks %)`)], ...s.rows.map((r, i) => [r.i, ...s.per.map((m) => f(m.rollFull[i]))])],
    heatmap: [['Run', ...mcols.map((c) => `${c} (% of max)`)], ...s.rows.map((r, i) => [r.i, ...s.per.map((m) => f(m.pct[i]))])],
    overall: [['Run', `% missions full marks (rolling ${s.win})`, `Equipment inspection % (rolling ${s.win})`, `Tokens left (rolling ${s.win})`], ...s.rows.map((r, i) => [r.i, f(s.rolling.missionsFull[i]), f(s.rolling.equip[i]), f(s.rolling.tokens[i])])],
    missions: [['Mission', 'Max points', 'Average % of max', 'Full-marks rate %', 'First half avg %', 'Second half avg %', 'Trend (% per run)'],
      ...s.per.map((m, i) => [mcols[i], m.max, f(m.avgPct), f(m.fullRate), f(m.firstHalf), f(m.lastHalf), f(m.slope)])],
    histogram: [['Score from', 'Score to', 'Runs'], ...s.hist.map((b) => [b.from, b.to, b.count])],
    consistency: [['Run', `Rolling std (${s.win})`], ...s.rows.map((r) => [r.i, f(r.std)])],
    days: [['Day', 'Runs', 'Average score', 'Best score'], ...s.byDay.map((d) => [d.day, d.runs, f(d.avg), d.best])],
    official: [['Match', 'Official score', 'Event'], ...s.official.map((o) => [o.round, o.total, o.event])],
    summary: [['Metric', 'Value'], ['Runs', s.n], ['Points per run trend (slope)', f(s.improvement.slope)], ['First half average', f(s.improvement.firstHalf)], ['Second half average', f(s.improvement.lastHalf)], ['Change first → last run', s.improvement.change], ['Best', s.improvement.best], ['Max possible', s.max]],
  };
}
