import { createStore } from './store.js';
import { dashboardView, loginView, judgeView, practiceView, statsView, teamView, adminView, scheduleView, eventView } from './views.js';
import { hostedEvents } from './store.js';
import { esc, toast } from './ui.js';
import { SEASON } from './missions.js';

const ROUTES = {
  '': { view: dashboardView, label: 'Standings', roles: null, nav: true },
  schedule: { view: scheduleView, label: 'Schedule', roles: null, nav: true },
  judge: { view: judgeView, label: 'Judge', roles: ['judge', 'admin', 'host'], nav: true },
  event: { view: eventView, label: 'Event', roles: ['host', 'admin'], nav: true },
  practice: { view: practiceView, label: 'Practice', roles: ['coach', 'member'], nav: true },
  stats: { view: statsView, label: 'Stats', roles: ['coach', 'member'], nav: true },
  team: { view: teamView, label: 'Team', roles: ['coach', 'member'], nav: true },
  admin: { view: adminView, label: 'Admin', roles: ['admin'], nav: true },
  login: { view: loginView, label: 'Sign in', roles: null, nav: false },
};

const main = document.getElementById('main');
let store, data = { teams: [], scores: [], events: [], eventHosts: [] }, current = null, ctx;

async function boot() {
  try { store = await createStore(); } catch (e) {
    main.innerHTML = `<section class="card narrow"><h1>Can’t reach Firebase</h1><p class="muted">${esc(e.message)}. Check js/firebase-config.js and your connection.</p></section>`;
    return;
  }
  ctx = {
    store, teams: () => data.teams, scores: () => data.scores, events: () => data.events, eventHosts: () => data.eventHosts,
    scoringEvents: () => (['judge', 'admin'].includes(store.user?.role) ? data.events : hostedEvents(store.user, data.events, data.eventHosts)),
    user: () => store.user, go: (h) => { location.hash = h; }, afterLogin: '#/',
  };
  store.subscribe('teams', (r) => { data.teams = r; refresh(); });
  store.subscribe('scores', (r) => { data.scores = r; refresh(); });
  store.subscribe('events', (r) => { data.events = r; refresh(); });
  let lastRole, unsubHosts = null;
  store.onAuth((u) => {
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
  const links = Object.entries(ROUTES).filter(([, r]) => r.nav && (!r.roles || (u && r.roles.includes(u.role))));
  const hash = (location.hash.replace(/^#\/?/, '') || '').split('?')[0];
  const html = links.map(([k, r]) => `<a href="#/${k}" ${hash === k ? 'aria-current="page"' : ''}>${esc(r.label)}</a>`).join('');
  document.getElementById('nav').innerHTML = html;
  document.getElementById('who').innerHTML = u
    ? `<span class="user"><b>${esc(u.name)}</b><span class="badge">${esc(u.role)}</span></span>`
    : '<a class="btn primary small" id="signin-link" href="#/login">Sign in</a>';
  document.getElementById('signout').hidden = !u;
  document.getElementById('modebar').hidden = store.mode !== 'demo';
}

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
