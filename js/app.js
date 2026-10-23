import { createStore } from './store.js';
import { timerView } from './timer.js';
import { helpView } from './help.js';
import { sampleView } from './sample.js';
import { dashboardView, toolView, loginView, judgeView, teamView, adminView, scheduleView, eventView, promptDefaultPasswords } from './views.js';
import { hasRole, scoringEvents, canScore, ROLE_LABEL } from './store.js';
import { esc, toast, applyTheme, toggleTheme } from './ui.js';
import { SEASON } from './missions.js';

// roles: names of roles, or pseudo-roles: 'host' = host of ≥1 event (a modifier, so coaches/judges can be hosts too),
// 'team' = on at least one team, 'signedin' = anyone signed in.
const ROUTES = {
  '': { view: dashboardView, label: 'Standings', short: 'Scores', icon: '🏆', roles: null, nav: true },
  schedule: { view: scheduleView, label: 'Schedule', icon: '🗓️', roles: null, nav: true },
  tool: { view: toolView, label: 'Scoring tool', short: 'Tool', icon: '🧮', roles: null, nav: true },
  timer: { view: timerView, label: 'Timer', icon: '⏱️', roles: null, nav: true },
  judge: { view: judgeView, label: 'Referee', icon: '📝', roles: ['scorer'], nav: true },
  // practice / stats / analytics used to be separate pages: they now live inside the Teams page
  practice: { view: teamView, label: 'Teams', roles: ['signedin'], nav: false },
  stats: { view: teamView, label: 'Teams', roles: ['signedin'], nav: false },
  analytics: { view: teamView, label: 'Teams', roles: ['signedin'], nav: false },
  team: { view: teamView, label: 'Teams', icon: '👥', roles: ['signedin'], nav: true },
  event: { view: eventView, label: 'Event', icon: '🎪', roles: ['host', 'admin'], nav: true },
  admin: { view: adminView, label: 'Admin', icon: '⚙️', roles: ['admin'], nav: true },
  sample: { view: sampleView, label: 'Sample team', short: 'Sample', icon: '🧪', roles: null, nav: true },
  help: { view: helpView, label: 'Help', icon: '❓', roles: null, nav: true },
  login: { view: loginView, label: 'Sign in', roles: null, nav: false },
};
const scorer = (u) => canScore(u, scoringEvents(u, data.events, data.eventHosts, data.eventJudges));
const allowed = (r, u) => !r.roles || (u && r.roles.some((x) => (x === 'scorer' ? scorer(u) : hasRole(u, x))));
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
  let lastRole, lastTeam, lastUid, unsubHosts = null, unsubJudges = null;
  store.onAuth((u) => {
    if ((u?.uid ?? null) !== lastUid) { // (re)subscribe the per-person lists only when the person changes, not on every team update
      lastUid = u?.uid ?? null;
      document.querySelectorAll('dialog[open]').forEach((d) => d.close()); // pop-ups belong to the person they were opened for
      unsubJudges?.(); data.eventJudges = [];
      unsubJudges = store.subscribe('eventJudges', (r) => { data.eventJudges = r; renderChrome(); refresh(); });
      unsubHosts?.(); data.eventHosts = [];
      unsubHosts = store.subscribe('eventHosts', (r) => { data.eventHosts = r; refresh(); });
    }
    renderChrome();
    // role or active team changed → re-gate / reload the current page
    if (lastRole !== undefined && (lastRole !== (u?.role ?? null) || lastTeam !== (u?.teamId ?? null))) route();
    lastRole = u?.role ?? null; lastTeam = u?.teamId ?? null;
    if (u) promptDefaultPasswords(ctx).catch(() => {});
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
  // `count` = how many buttons the bar gets; when there are more links than that, the last button is "More".
  const draw = (count) => {
    if (links.length <= count) { nav.innerHTML = links.map(link).join(''); return; }
    const shown = links.slice(0, count - 1), more = links.slice(count - 1);
    const moreActive = more.some(([k]) => k === hash);
    nav.innerHTML = shown.map(link).join('')
      + `<button type="button" id="nav-more" class="more ${moreActive ? 'on' : ''}" aria-haspopup="true" aria-expanded="false" aria-controls="nav-sheet"><span class="ni" aria-hidden="true">⋯</span><span class="nl">More</span></button>`
      + `<div id="nav-sheet" class="nav-sheet" hidden>${more.map(link).join('')}</div>`;
    const btn = nav.querySelector('#nav-more'), sheet = nav.querySelector('#nav-sheet');
    btn.addEventListener('click', (e) => { e.stopPropagation(); sheet.hidden = !sheet.hidden; btn.setAttribute('aria-expanded', String(!sheet.hidden)); });
    sheet.addEventListener('click', () => { sheet.hidden = true; });
  };
  const desktop = !phone.matches;
  draw(desktop ? links.length : MAX_TABS);
  document.getElementById('who').innerHTML = u
    ? `<span class="user"><b>${esc(u.name)}</b><span class="badge">${esc(ROLE_LABEL[u.role] || u.role)}${u.host && u.role !== 'host' ? ' · host' : ''}${u.viaPassword ? ' · password' : ''}${u.role !== 'coach' && u.teams?.some((t) => t.role === 'coach') ? ' · coach' : ''}</span></span>`
    : '<a class="btn primary small" id="signin-link" href="#/login">Sign in</a>';
  document.getElementById('signout').hidden = !u;
  document.getElementById('modebar').hidden = store.mode !== 'demo';
  if (desktop) { // show everything that fits the header; the rest goes under "More"
    const bar = document.querySelector('.top-in');
    let n = links.length;
    while (n > 3 && bar.scrollWidth > bar.clientWidth + 1) draw(--n);
  }
}
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => store && renderChrome(), 150); });
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

document.getElementById('season').textContent = `${SEASON.name} ${SEASON.years}`;
window.addEventListener('error', (e) => toast(`Unexpected error: ${e.message}`, 'err'));
boot();
