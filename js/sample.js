// A public, read-only "sample team": made-up practice runs (generated, never stored) so anyone can try Stats and Advanced.
import { randomState, scoreAll } from './scoring.js';
import { slim } from './store.js';
import { statsView } from './views.js';
import { analyticsView } from './analytics.js';

const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const DAY = 86400e3;
export const SAMPLE_TEAM = { id: 'sample', number: 1234, name: 'Sample Team', edition: 'founders', colors: ['#2b8a3e', '#f4c20d'] };
const NOTES = ['first full run', 'new arm attachment', 'faster route to M05', 'trying the other launch area', '', '', 'practice with the timer', ''];

// 16 Founders runs that improve over six weeks, plus 6 Future runs, all scored through the real rules.
export function sampleRuns(now = Date.now()) {
  const rand = rng(1234), runs = [];
  const make = (ed, n, from, to, spanDays, tag) => {
    for (let i = 0; i < n; i++) {
      const skill = from + (to - from) * (i / Math.max(1, n - 1)) + (rand() - 0.5) * 0.12;
      const res = scoreAll(randomState(ed, rand, Math.min(0.95, Math.max(0.15, skill))), ed);
      runs.push({ id: `${tag}${i}`, teamId: SAMPLE_TEAM.id, uid: 'sample', by: ['Sam', 'Alex', 'Jordan'][i % 3], total: res.total, gp: res.gp, edition: ed, state: res.state, result: slim(res),
        note: NOTES[i % NOTES.length], createdAt: now - (n - i) * (spanDays / n) * DAY });
    }
  };
  make('founders', 16, 0.3, 0.8, 42, 'sf');
  make('future', 6, 0.3, 0.6, 21, 'sx');
  return runs;
}

// What statsView / analyticsView need from the app context, pointed at the sample team and made read-only.
export function sampleContext(ctx) {
  const runs = sampleRuns();
  const official = [1, 2, 3].map((round, i) => { const res = scoreAll(randomState('founders', rng(99 + i), 0.5 + i * 0.12), 'founders'); return { id: `sample_R${round}`, teamId: 'sample', eventId: 'sample', round, total: res.total, edition: 'founders', createdAt: Date.now() - (3 - i) * DAY }; });
  const user = { uid: 'sample', name: 'Sample Team', role: 'member', teamId: 'sample', teams: [{ teamId: 'sample', role: 'member' }] };
  return {
    ...ctx, user: () => user, teams: () => [SAMPLE_TEAM], scores: () => official,
    store: { subscribe: (col, cb) => { cb(col === 'practice' ? runs : []); return () => {}; }, remove: async () => { throw new Error('The sample team is read-only.'); }, put: async () => { throw new Error('The sample team is read-only.'); } },
  };
}

export function sampleView(root, ctx) {
  const sctx = sampleContext(ctx);
  root.innerHTML = `<h1 class="page-title">Sample team</h1>
    <section class="card"><h2>#${SAMPLE_TEAM.number} ${SAMPLE_TEAM.name}</h2>
      <p class="muted">A made-up team so you can try the <b>Stats</b> and <b>Advanced</b> tools. Its practice runs are examples — you can’t add or change runs here. Your own team’s stats work the same way, from the runs your team saves under <b>Teams</b>.</p>
      <div class="tabs" role="tablist"><button type="button" role="tab" data-tab="stats">📊 Stats</button><button type="button" role="tab" data-tab="advanced">📈 Advanced</button></div></section>
    <div id="sp-stats" class="tabpanel"></div><div id="sp-advanced" class="tabpanel" hidden></div>`;
  const panels = {};
  const show = (name) => {
    root.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === name; b.setAttribute('aria-selected', String(on)); b.classList.toggle('on', on); });
    root.querySelector('#sp-stats').hidden = name !== 'stats'; root.querySelector('#sp-advanced').hidden = name !== 'advanced';
    if (name === 'advanced' && !panels.advanced) panels.advanced = analyticsView(root.querySelector('#sp-advanced'), sctx);
  };
  panels.stats = statsView(root.querySelector('#sp-stats'), sctx, { readOnly: true });
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
  show('stats');
  return { destroy: () => Object.values(panels).forEach((p) => p?.destroy?.()) };
}
