// Analytics page: over-time charts + an animated, sortable data table for the active team's practice runs.
// Every chart/table has a "Copy data" button that puts a tab-separated table on the clipboard (pastes into Google Sheets).
import { computeSeries, seriesTables, filterRuns } from './stats.js';
import { copyForSheets, downloadCSV } from './sheets.js';
import { toCSV, toTSV } from './schedule.js';
import { esc, toast } from './ui.js';

const COLORS = ['#2b8a3e', '#1c7ed6', '#e8590c', '#9c36b5', '#c2255c', '#0c8599', '#f08c00', '#5c7cfa'];
const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : '—');
const sgn = (n) => (n > 0 ? `+${r1(n)}` : `${r1(n)}`);
const CARD_TITLES = {
  summary: 'Summary', score: 'Score over time', gain: 'Points gained per run', missionRate: 'Mission success rate over time', heatmap: 'Accuracy per mission per run',
  overall: 'Overall success, equipment and tokens', missions: 'Mission improvement', histogram: 'Score distribution', consistency: 'Consistency over time',
  days: 'Practice by day', official: 'Official matches', runs: 'All runs (data table)',
};
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ───────── SVG helpers ─────────
const W = 640, H = 220, PL = 38, PR = 10, PT = 10, PB = 24;
function frame(n, ymin, ymax, yfmt = (v) => v) {
  const w = W - PL - PR, h = H - PT - PB;
  const x = (i) => PL + (n <= 1 ? w / 2 : (i * w) / (n - 1));
  const y = (v) => PT + h - ((v - ymin) / ((ymax - ymin) || 1)) * h;
  const grid = [0, 1, 2, 3, 4].map((k) => { const v = ymin + ((ymax - ymin) * k) / 4; return `<line x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${PL - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${esc(yfmt(Math.abs(ymax - ymin) >= 8 ? Math.round(v) : Math.round(v * 10) / 10))}</text>`; }).join('');
  const step = Math.max(1, Math.ceil(n / 8));
  const xs = Array.from({ length: n }, (_, i) => i).filter((i) => i % step === 0 || i === n - 1).map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="ax">${i + 1}</text>`).join('');
  return { x, y, base: grid + xs };
}
function lineChart(series, { ymin = 0, ymax, yfmt, label }) {
  const n = Math.max(...series.map((s) => s.vals.length), 0);
  const top = ymax ?? Math.max(1, ...series.flatMap((s) => s.vals)) * 1.05;
  const f = frame(n, ymin, top, yfmt);
  const paths = series.map((s, k) => {
    const pts = s.vals.map((v, i) => `${f.x(i).toFixed(1)},${f.y(v).toFixed(1)}`);
    const col = s.color || COLORS[k % COLORS.length];
    return `<polyline class="ln ${s.dash ? 'dash' : ''}" pathLength="1" fill="none" stroke="${col}" stroke-width="${s.w || 2.5}" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(' ')}" style="--d:${k * 0.12}s"/>`
      + (s.dots ? s.vals.map((v, i) => `<circle class="dt" cx="${f.x(i)}" cy="${f.y(v)}" r="3.2" fill="${col}" style="--d:${0.5 + i * 0.02}s"><title>${esc(s.name)} · run ${i + 1}: ${r1(v)}</title></circle>`).join('') : '');
  }).join('');
  const legend = series.length > 1 ? `<ul class="legend">${series.map((s, k) => `<li><i style="background:${s.color || COLORS[k % COLORS.length]}"></i>${esc(s.name)}</li>`).join('')}</ul>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${f.base}${paths}</svg>${legend}`;
}
function barChart(vals, { labels, signed = false, label, fmt = r1 }) {
  const n = vals.length;
  const lo = signed ? Math.min(0, ...vals) : 0, hi = Math.max(1, ...vals, 0);
  const f = frame(n, lo, hi * 1.05, (v) => v);
  const bw = Math.max(2, ((W - PL - PR) / Math.max(n, 1)) * 0.7);
  const bars = vals.map((v, i) => {
    const y0 = f.y(0), y1 = f.y(v);
    return `<rect class="bar" x="${(f.x(i) - bw / 2).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(y0 - y1)).toFixed(1)}" rx="2" fill="${signed && v < 0 ? '#c92a2a' : 'var(--accent)'}" style="--d:${Math.min(i * 0.03, 1)}s"><title>${esc(labels?.[i] ?? `Run ${i + 1}`)}: ${fmt(v)}</title></rect>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${f.base}${bars}</svg>`;
}
function heatmap(s) {
  const n = s.n;
  const cells = s.per.map((m, mi) => `<div class="hm-l" title="${esc(m.name)}">M${String(m.num).padStart(2, '0')}</div>${m.pct.map((p, i) => `<i class="hm-c" style="--p:${Math.round(p)}%;--d:${Math.min((i + mi) * 0.012, 1.2)}s" title="M${String(m.num).padStart(2, '0')} ${esc(m.name)} · run ${i + 1}: ${Math.round(p)}% of max (${m.pts[i]}/${m.max})"></i>`).join('')}`).join('');
  return `<div class="hm-wrap"><div class="hm" style="--n:${n}">${cells}</div></div><p class="muted small">Darker = more of that mission’s points. Runs go left to right.</p>`;
}

export function analyticsView(root, ctx) {
  const u = ctx.user();
  if (!u?.teamId) return { destroy() {} };
  root.innerHTML = '<div id="an"></div>';
  let runs = [], range = 'all', win = 5, sortKey = 'i', sortDir = 1, picked = null, series = null, tables = null, anim = true;
  const el = root.querySelector('#an');

  const copyBtn = (key) => `<span class="row-actions"><button class="btn ghost small" data-copy="${key}">Copy data</button><button class="btn ghost small" data-csv="${key}">CSV</button></span>`;
  const card = (key, body, note = '') => `<section class="card"><div class="cardhead"><h2>${esc(CARD_TITLES[key])}</h2>${copyBtn(key)}</div>${note ? `<p class="muted small">${note}</p>` : ''}${body}</section>`;

  function compute() {
    const set = filterRuns(runs, range);
    const official = ctx.scores().filter((x) => x.teamId === u.teamId);
    series = computeSeries(set, win, official); tables = seriesTables(series);
    if (!picked) picked = new Set(series.per.slice().sort((a, b) => b.avgPct - a.avgPct).slice(0, 5).map((m) => m.id));
  }

  function tableHTML() {
    const s = series;
    const cols = [['i', 'Run'], ['t', 'Date'], ['total', 'Score'], ['delta', 'Change'], ['rolling', `Avg (${s.win})`], ['best', 'Best so far'], ['pctMax', '% of max'], ['equip', 'Equip.'], ['tokens', 'Tokens'], ['missionsFull', '% full'],
      ...s.per.map((m) => [`m:${m.id}`, `M${String(m.num).padStart(2, '0')}`])];
    const val = (r, k) => (k.startsWith('m:') ? r.pts[k.slice(2)] : r[k]);
    const rows = s.rows.slice().sort((a, b) => (val(a, sortKey) - val(b, sortKey)) * sortDir);
    const cell = (r, k) => {
      const v = val(r, k);
      if (k === 't') return new Date(v).toLocaleDateString();
      if (k === 'total') return `<span class="cbar"><i style="--w:${(v / s.max) * 100}%"></i></span><b>${v}</b>`;
      if (k === 'delta') return `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '▲' : v < 0 ? '▼' : ''} ${sgn(v)}</span>`;
      if (k === 'equip') return v ? '✓' : '—';
      if (['rolling', 'pctMax', 'missionsFull'].includes(k)) return r1(v);
      return v;
    };
    return `<div class="table-scroll"><table class="data an-table"><thead><tr>${cols.map(([k, l]) => `<th data-sort="${k}" class="${k === sortKey ? 'sorted' : ''}" aria-sort="${k === sortKey ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}" tabindex="0">${esc(l)}${k === sortKey ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, idx) => `<tr class="${anim ? 'rowin' : ''}" style="--d:${Math.min(idx * 0.025, 1.5)}s">${cols.map(([k]) => `<td${k.startsWith('m:') ? ` class="${val(r, k) ? 'has' : 'zero'}"` : ''}>${cell(r, k)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function render() {
    if (!series) return;
    const s = series, i = s.improvement;
    if (!s.n) { el.innerHTML = '<section class="card"><p class="empty">No practice runs yet. Tap <b>➕ Practice run</b> above to add one.</p></section>'; return; }
    const mchips = s.per.map((m, k) => `<label class="chip ${picked.has(m.id) ? 'on' : ''}"><input type="checkbox" data-pick="${m.id}" ${picked.has(m.id) ? 'checked' : ''}><i style="background:${COLORS[k % COLORS.length]}"></i>M${String(m.num).padStart(2, '0')}</label>`).join('');
    const sel = s.per.filter((m) => picked.has(m.id));
    const gainBest = Math.max(...s.rows.map((r) => r.delta));
    el.innerHTML = `
      <div class="toolbar">
        <label class="field evsel"><span>Runs</span><select id="an-range">${[['all', 'All runs'], ['10', 'Last 10'], ['20', 'Last 20'], ['50', 'Last 50']].map(([v, l]) => `<option value="${v}" ${range === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field evsel"><span>Rolling window</span><select id="an-win">${[3, 5, 10].map((v) => `<option value="${v}" ${win === v ? 'selected' : ''}>${v} runs</option>`).join('')}</select></label>
        <span class="row-actions"><button class="btn primary" id="an-copyall">Copy everything for Google Sheets</button><button class="btn ghost" id="an-csvall">Download CSV</button></span></div>
      <section class="kpis">
        <div class="kpi"><span>Runs</span><b data-count="${s.n}">${s.n}</b></div>
        <div class="kpi"><span>Best</span><b data-count="${i.best}">${i.best}</b><small>of ${s.max}</small></div>
        <div class="kpi"><span>Trend</span><b>${sgn(i.slope)}</b><small>points per run</small></div>
        <div class="kpi"><span>First half → second</span><b>${r1(i.firstHalf)} → ${r1(i.lastHalf)}</b></div>
        <div class="kpi"><span>Biggest jump</span><b>${sgn(gainBest)}</b></div>
      </section>
      ${card('score', lineChart([{ name: 'Score', vals: s.rows.map((r) => r.total), dots: true }, { name: `Average (${s.win})`, vals: s.rolling.score, w: 2.5 }, { name: 'Best so far', vals: s.rows.map((r) => r.best), dash: true, w: 2 }], { ymax: s.max, label: 'Score per run with rolling average and best so far' }))}
      ${card('gain', barChart(s.rows.map((r) => r.delta), { signed: true, label: 'Change in score from the previous run', fmt: sgn }), 'Points up or down compared with the run before.')}
      <section class="card"><div class="cardhead"><h2>${CARD_TITLES.missionRate}</h2>${copyBtn('missionRate')}</div>
        <div class="chips-pick">${mchips}</div>
        ${lineChart(sel.map((m) => ({ name: `M${String(m.num).padStart(2, '0')} ${m.name}`, vals: m.rollFull, color: COLORS[s.per.indexOf(m) % COLORS.length] })), { ymax: 100, yfmt: (v) => `${v}%`, label: 'Rolling full-marks rate per mission' })}
        <p class="muted small">Share of the last ${s.win} runs where the mission got full marks.</p></section>
      ${card('heatmap', heatmap(s))}
      ${card('overall', lineChart([{ name: '% missions full marks', vals: s.rolling.missionsFull }, { name: 'Equipment inspection %', vals: s.rolling.equip }, { name: 'Tokens left (of 6, as %)', vals: s.rolling.tokens.map((t) => (t / 6) * 100) }], { ymax: 100, yfmt: (v) => `${v}%`, label: 'Rolling success rates' }))}
      ${card('missions', `<ul class="bars">${s.per.slice().sort((a, b) => (b.lastHalf - b.firstHalf) - (a.lastHalf - a.firstHalf)).map((m) => `<li><span class="bl">M${String(m.num).padStart(2, '0')} ${esc(m.name)}</span><span class="bt"><i class="grow" style="width:${m.lastHalf}%"></i></span><span class="bv">${r1(m.lastHalf)}%<small> ${sgn(m.lastHalf - m.firstHalf)}</small></span></li>`).join('')}</ul>`, 'Average accuracy in the second half of the runs, and the change from the first half.')}
      <div class="cols">
        ${card('histogram', barChart(s.hist.map((b) => b.count), { labels: s.hist.map((b) => `${b.from}–${b.to}`), label: 'Score distribution' }))}
        ${card('consistency', lineChart([{ name: 'Rolling std', vals: s.rolling.std, dots: s.n < 30 }], { label: 'Rolling standard deviation of score' }), 'Lower = more consistent.')}
      </div>
      ${card('days', barChart(s.byDay.map((d) => d.avg), { labels: s.byDay.map((d) => `${d.day} (${d.runs} runs)`), label: 'Average score per practice day' }), 'Average score on each day you practised.')}
      ${s.official.length ? card('official', `<ul class="chips">${s.official.map((o) => `<li>Match ${o.round}: <b>${o.total}</b></li>`).join('')}</ul>`) : ''}
      ${card('runs', tableHTML())}`;
    anim = false;
    if (!reduced()) el.querySelectorAll('[data-count]').forEach((b) => countUp(b, +b.dataset.count));
  }
  function countUp(node, to) {
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 700); node.textContent = Math.round(to * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  const allTable = () => Object.keys(CARD_TITLES).filter((k) => tables[k] && (k !== 'official' || series.official.length)).flatMap((k) => [[CARD_TITLES[k]], ...tables[k], []]);
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'an-range') { range = t.value; picked = null; anim = true; compute(); render(); }
    else if (t.id === 'an-win') { win = +t.value; anim = true; compute(); render(); }
    else if (t.dataset.pick) { t.checked ? picked.add(t.dataset.pick) : picked.delete(t.dataset.pick); render(); }
  });
  const sortBy = (k) => { if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'i' || k === 't' ? 1 : -1; } anim = true; render(); };
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button, th[data-sort]'); if (!b || !tables) return;
    if (b.dataset.sort) return sortBy(b.dataset.sort);
    if (b.dataset.copy) toast((await copyForSheets(tables[b.dataset.copy])) ? 'Copied — paste into Google Sheets (Ctrl+V)' : 'Couldn’t copy; use CSV', 'ok');
    if (b.dataset.csv) downloadCSV(`analytics-${b.dataset.csv}.csv`, tables[b.dataset.csv]);
    if (b.id === 'an-copyall') toast((await copyForSheets(allTable())) ? 'Copied everything — paste into Google Sheets (Ctrl+V)' : 'Couldn’t copy; use the CSV', 'ok');
    if (b.id === 'an-csvall') downloadCSV('analytics-all.csv', allTable());
  });
  el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('th[data-sort]')) { e.preventDefault(); sortBy(e.target.dataset.sort); } });
  const unsub = ctx.store.subscribe('practice', (r) => { runs = r.filter((x) => x.teamId === u.teamId); compute(); render(); });
  return { update: () => { compute(); render(); }, destroy: unsub };
}
