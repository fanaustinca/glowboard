import { createStore } from './store.js';
import { dashboardView, loginView, judgeView, practiceView, statsView, teamView, adminView, scheduleView, eventView } from './views.js';
import { hasRole, scoringEvents, ROLE_LABEL } from './store.js';
import { esc, toast } from './ui.js';
import { SEASON } from './missions.js';

// roles: names of roles, or 'host' = "is host of at least one event" (a modifier, so coaches/judges can be hosts too).
const ROUTES = {
  '': { view: dashboardView, label: 'Standings', short: 'Scores', icon: '🏆', roles: null, nav: true },
  schedule: { view: scheduleView, label: 'Schedule', icon: '🗓️', roles: null, nav: true },
  judge: { view: judgeView, label: 'Judge', icon: '📝', roles: ['judge', 'admin', 'host', 'referee'], nav: true },
  practice: { view: practiceView, label: 'Practice', icon: '🎯', roles: ['coach', 'member'], nav: true },
  stats: { view: statsView, label: 'Stats', icon: '📊', roles: ['coach', 'member'], nav: true },
  team: { view: teamView, label: 'Team', icon: '👥', roles: ['coach', 'member'], nav: true },
  event: { view: eventView, label: 'Event', icon: '🎪', roles: ['host', 'admin'], nav: true },
  admin: { view: adminView, label: 'Admin', icon: '⚙️', roles: ['admin'], nav: true },
  login: { view: loginView, label: 'Sign in', roles: null, nav: false },
};
// 'referee' = listed as a referee of at least one event (also a per-event modifier)
const isReferee = (u) => Boolean(u) && data.eventJudges.some((j) => (j.emails || []).includes(u.email));
const allowed = (r, u) => !r.roles || (u && r.roles.some((x) => (x === 'referee' ? isReferee(u) : hasRole(u, x))));
const phone = matchMedia('(max-width: 719px)');
const MAX_TABS = 5; // bottom tabs on a phone; anything beyond goes under "More"

const main = document.getElementById('main');
let store, data = { teams: [], scores: [], events: [], eventHosts: [], eventJudges: [] }, current = null, ctx;

async function boot() {
  try { store = await createStore(); } catch (e) {
    main.innerHTML = `<section class="card narrow"><h1>Can’t reach Firebase</h1><p class="muted">${esc(e.message)}. Check js/firebase-config.js and your connection.</p></section>`;
    return;
  }
  ctx = {
    store, teams: () => data.teams, scores: () => data.scores, events: () => data.events, eventHosts: () => data.eventHosts,
    eventJudges: () => data.eventJudges,
    scoringEvents: () => scoringEvents(store.user, data.events, data.eventHosts, data.eventJudges),
    user: () => store.user, go: (h) => { location.hash = h; }, afterLogin: '#/',
  };
  store.subscribe('teams', (r) => { data.teams = r; refresh(); });
  store.subscribe('scores', (r) => { data.scores = r; refresh(); });
  store.subscribe('events', (r) => { data.events = r; refresh(); });
  let lastRole, unsubHosts = null, unsubJudges = null;
  store.onAuth((u) => {
    unsubJudges?.(); data.eventJudges = [];
    unsubJudges = store.subscribe('eventJudges', (r) => { data.eventJudges = r; renderChrome(); refresh(); });
    unsubHosts?.(); data.eventHosts = [];
    unsubHosts = store.subscribe('eventHosts', (r) => { data.eventHosts = r; refresh(); });
    renderChrome();
    if (lastRole !== undefined && lastRole !== (u?.role ?? null)) route(); // role changed → re-gate the current page
    lastRole = u?.role ?? null;
  });
  window.addEventListener('hashchange', route);
  document.getElementById('signout').addEventListener('click', async () => { await store.signOut(); ctx.go('#/'); });
  document.getElementById('theme').addEventListener('click', toggleTheme);
  applyTheme();
  renderChrome();
  route();
}

function refresh() { current?.update?.(); }

function renderChrome() {
  const u = store.user;
  const links = Object.entries(ROUTES).filter(([, r]) => r.nav && allowed(r, u));
  const hash = (location.hash.replace(/^#\/?/, '') || '').split('?')[0];
  const link = ([k, r]) => `<a href="#/${k}" ${hash === k ? 'aria-current="page"' : ''}><span class="ni" aria-hidden="true">${r.icon || ''}</span><span class="nl"${r.short ? ` data-short="${esc(r.short)}"` : ''}>${esc(r.label)}</span></a>`;
  const nav = document.getElementById('nav');
  if (phone.matches && links.length > MAX_TABS) {
    const shown = links.slice(0, MAX_TABS - 1), more = links.slice(MAX_TABS - 1);
    const moreActive = more.some(([k]) => k === hash);
    nav.innerHTML = shown.map(link).join('')
      + `<button type="button" id="nav-more" class="more ${moreActive ? 'on' : ''}" aria-haspopup="true" aria-expanded="false" aria-controls="nav-sheet"><span class="ni" aria-hidden="true">⋯</span><span class="nl">More</span></button>`
      + `<div id="nav-sheet" class="nav-sheet" hidden>${more.map(link).join('')}</div>`;
    const btn = nav.querySelector('#nav-more'), sheet = nav.querySelector('#nav-sheet');
    btn.addEventListener('click', (e) => { e.stopPropagation(); sheet.hidden = !sheet.hidden; btn.setAttribute('aria-expanded', String(!sheet.hidden)); });
    sheet.addEventListener('click', () => { sheet.hidden = true; });
  } else nav.innerHTML = links.map(link).join('');
  document.getElementById('who').innerHTML = u
    ? `<span class="user"><b>${esc(u.name)}</b><span class="badge">${esc(ROLE_LABEL[u.role] || u.role)}${u.host && u.role !== 'host' ? ' · host' : ''}${u.viaPassword ? ' · password' : ''}</span></span>`
    : '<a class="btn primary small" id="signin-link" href="#/login">Sign in</a>';
  document.getElementById('signout').hidden = !u;
  document.getElementById('modebar').hidden = store.mode !== 'demo';
}
document.addEventListener('click', () => { const sh = document.getElementById('nav-sheet'); if (sh) { sh.hidden = true; document.getElementById('nav-more')?.setAttribute('aria-expanded', 'false'); } });
phone.addEventListener?.('change', () => store && renderChrome());

function route() {
  current?.destroy?.();
  const key = (location.hash.replace(/^#\/?/, '') || '').split('?')[0];
  const r = ROUTES[key] || ROUTES[''];
  if (key && !ROUTES[key]) ctx.go('#/');
  main.innerHTML = '';
  const el = document.createElement('div'); el.className = 'page'; main.append(el);
  current = r.view(el, ctx) || {};
  renderChrome();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
  document.title = `${r.label === 'Standings' ? 'Live standings' : r.label} · GlowBoard`;
}

function applyTheme() {
  let t = null; try { t = localStorage.getItem('gb-theme'); } catch { /* ignore */ }
  if (t) document.documentElement.dataset.theme = t;
}
function toggleTheme() {
  const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  const next = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('gb-theme', next); } catch { /* ignore */ }
}

document.getElementById('season').textContent = `${SEASON.name} ${SEASON.years}`;
window.addEventListener('error', (e) => toast(`Unexpected error: ${e.message}`, 'err'));
boot();
