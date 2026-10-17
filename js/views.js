// Page views. Each view: (root, ctx) => { update?(), destroy?() }.
// ctx: { store, teams(), scores(), config(), user(), go(hash) }
import { standings, maxScores } from './scoring.js';
import { MISSIONS, MATCHES_PER_TEAM, SEASON } from './missions.js';
import { mountScorer } from './scorer.js';
import { ROLE_LABEL, isTeamSide, eventTeams, normEmail, EMAIL_RE, DEMO_ACCOUNTS, hostedEvents } from './store.js';
import { generateSchedule, groupSchedule, scheduleTable, clampConfig, SCHEDULE_DEFAULTS, LIMITS } from './schedule.js';
import { downloadCSV, copyForSheets, sendToSheets, sheetsConfigured } from './sheets.js';
import { esc, toast, timeAgo, modal, csvCell, download } from './ui.js';

const max = () => maxScores();
const EV_KEY = 'gb-event';
const MANAGE_KEY = 'gb-manage-event';
// The event shown on the public dashboard: the visitor's last pick, else the live one, else the newest.
function pickEvent(events) {
  let saved = null; try { saved = localStorage.getItem(EV_KEY); } catch { /* ignore */ }
  return events.find((e) => e.id === saved) || events.find((e) => e.live)
    || events.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
}

// ───────────────────────────── Public dashboard ─────────────────────────────
export function dashboardView(root, ctx) {
  root.innerHTML = `
    <section class="hero">
      <div><p class="eyebrow"><span class="live" aria-hidden="true"></span> Live standings</p>
        <h1 id="d-event">Event</h1><p class="muted" id="d-sub"></p></div>
      <dl class="stats" id="d-stats"></dl>
    </section>
    <div class="toolbar"><label class="field evsel"><span class="sr">Event</span><select id="d-ev" aria-label="Event"></select></label><label class="search"><span class="sr">Find a team</span><input id="d-q" type="search" placeholder="Find a team or number…" autocomplete="off"></label></div>
    <div class="cols">
      <section class="card"><h2>Team standings</h2><p class="muted small">Ranked by each team’s best official match. Ties are broken by 2nd, then 3rd best.</p>
        <ol class="standings" id="d-rows"></ol><p class="empty" id="d-empty" hidden>No teams yet.</p></section>
      <aside class="card"><h2>Latest scores</h2><ul class="feed" id="d-feed"></ul><p class="empty" id="d-feedempty" hidden>Scores will appear here as judges submit them.</p></aside>
    </div>`;
  const $ = (s) => root.querySelector(s);
  let q = '';
  $('#d-q').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); render(); });
  $('#d-ev').addEventListener('change', (e) => { try { localStorage.setItem(EV_KEY, e.target.value); } catch { /* ignore */ } render(); });

  function render() {
    const events = ctx.events(), ev = pickEvent(events);
    const evSel = $('#d-ev');
    evSel.hidden = events.length < 2;
    evSel.innerHTML = events.slice().sort((a, b) => (b.live - a.live) || (b.createdAt || 0) - (a.createdAt || 0))
      .map((e) => `<option value="${esc(e.id)}">${esc(e.name)}${e.live ? ' · live' : ''}</option>`).join('');
    if (ev) evSel.value = ev.id;
    const teams = eventTeams(ev, ctx.teams()), scores = ctx.scores().filter((x) => x.eventId === ev?.id);
    $('#d-event').textContent = ev?.name || 'FIRST LEGO League';
    $('#d-sub').textContent = `${SEASON.name} ${SEASON.years}${ev?.date ? ` · ${ev.date}` : ''} · best of ${MATCHES_PER_TEAM} official matches`;
    const rows = standings(teams, scores);
    const top = rows[0]?.best;
    $('#d-stats').innerHTML = [
      ['Teams', teams.length], ['Scores in', scores.length], ['High score', top ?? '—'], ['Max possible', max().total],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    const shown = rows.filter((r) => !q || `${r.team.number} ${r.team.name}`.toLowerCase().includes(q));
    $('#d-rows').innerHTML = shown.map((r) => {
      const chips = Array.from({ length: MATCHES_PER_TEAM }, (_, i) => {
        const s = r.rounds[i + 1];
        return `<span class="rd ${s && s.total === r.best ? 'best' : ''}" title="Match ${i + 1}"><i>M${i + 1}</i>${s ? s.total : '—'}</span>`;
      }).join('');
      const medal = r.rank && r.rank <= 3 ? ` medal-${r.rank}` : '';
      return `<li class="row${medal}" tabindex="0" role="button" data-team="${esc(r.team.id)}" aria-label="${esc(r.team.name)}, rank ${r.rank ?? 'none'}, best score ${r.best ?? 'none'}. Open details.">
        <span class="rk">${r.rank ?? '–'}</span>
        <span class="who"><b>${esc(r.team.name)}</b><small>Team #${esc(r.team.number)}${r.tied ? ' · <span class="tie" title="Equal scores — decided by local officials">tied</span>' : ''}</small></span>
        <span class="rounds">${chips}</span>
        <span class="bestv"><b>${r.best ?? '—'}</b><small>best</small></span></li>`;
    }).join('');
    $('#d-empty').hidden = shown.length > 0;
    $('#d-empty').textContent = teams.length ? 'No team matches your search.' : 'No teams yet.';
    const feed = scores.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
    $('#d-feed').innerHTML = feed.map((s) => `<li><span class="fs">${s.total}</span><span><b>${esc(s.name)}</b><small>Match ${s.round}${s.table ? ` · table ${esc(s.table)}` : ''} · ${timeAgo(s.createdAt)}</small></span></li>`).join('');
    $('#d-feedempty').hidden = feed.length > 0;
  }

  function open(id) {
    const t = ctx.teams().find((x) => x.id === id); if (!t) return;
    const ev = pickEvent(ctx.events());
    const rs = ctx.scores().filter((s) => s.teamId === id && s.eventId === ev?.id).sort((a, b) => a.round - b.round);
    const body = rs.length ? rs.map((s) => `
      <details class="round" ${rs.length === 1 ? 'open' : ''}><summary><b>Match ${s.round}</b><span>${s.total} pts</span></summary>
        <table class="rv-table"><tbody>
          <tr><td>Equipment inspection</td><td class="num">${s.result.equipment}</td></tr>
          <tr><td>Precision tokens</td><td class="num">${s.result.tokens}</td></tr>
          ${s.result.missions.map((m) => `<tr class="${m.points ? 'has' : ''}"><td>M${String(m.num).padStart(2, '0')} ${esc(m.name)}</td><td class="num">${m.points}</td></tr>`).join('')}
        </tbody><tfoot><tr><th>Total</th><th class="num">${s.total}</th></tr></tfoot></table>
        <p class="muted small">Gracious Professionalism: ${s.gp} (Core Values) · scored ${timeAgo(s.createdAt)}</p></details>`).join('')
      : '<p class="empty">No official scores yet.</p>';
    modal(body, { title: `#${t.number} ${t.name}` });
  }
  root.addEventListener('click', (e) => { const r = e.target.closest('[data-team]'); if (r) open(r.dataset.team); });
  root.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-team]')) { e.preventDefault(); open(e.target.dataset.team); } });
  const tick = setInterval(render, 30000);
  render();
  return { update: render, destroy: () => clearInterval(tick) };
}

// ───────────────────────────── Login ─────────────────────────────
export function loginView(root, ctx) {
  const demo = ctx.store.mode === 'demo';
  root.innerHTML = `
    <section class="card narrow">
      <h1>Sign in</h1>
      <p class="muted">GlowBoard is a closed system: coaches, team members and judges sign in with the Google account an admin or coach added for them. Viewers don’t need an account — the standings are public.</p>
      ${demo ? '' : '<button id="lg-google" class="btn primary big" type="button">Sign in with Google</button>'}
      <div id="lg-err" class="error" role="alert" hidden></div>
      ${demo ? `<div class="demo-hint"><b>Demo mode</b> — Firebase isn’t configured yet, so Google sign-in is simulated. Try a role:
        <div class="demo-roles">${DEMO_ACCOUNTS.map((a) => `<button class="btn" type="button" data-demo="${esc(a.email)}">${esc(ROLE_LABEL[a.role])}<small>${esc(a.email)}</small></button>`).join('')}</div></div>` : ''}
    </section>`;
  const $ = (s) => root.querySelector(s);
  const fail = (x) => { const er = $('#lg-err'); er.hidden = false; er.textContent = x.message; };
  $('#lg-google')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; $('#lg-err').hidden = true; btn.disabled = true;
    try { await ctx.store.signInGoogle(); ctx.go(ctx.afterLogin || '#/'); } catch (x) { fail(x); } finally { btn.disabled = false; }
  });
  root.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', async () => {
    $('#lg-err').hidden = true;
    try { await ctx.store.signInAs(b.dataset.demo); ctx.go(ctx.afterLogin || '#/'); } catch (x) { fail(x); }
  }));
  return {};
}

const gate = (root, msg, ctx) => { root.innerHTML = `<section class="card narrow"><h1>Sign in required</h1><p class="muted">${esc(msg)}</p><a class="btn primary" href="#/login">Sign in</a></section>`; ctx.afterLogin = location.hash; return {}; };

// ───────────────────────────── Judge ─────────────────────────────
export function judgeView(root, ctx) {
  const u = ctx.user();
  if (!u) return gate(root, 'Judges, event hosts and admins sign in to enter official scores.', ctx);
  if (!['judge', 'admin', 'host'].includes(u.role)) { root.innerHTML = '<section class="card narrow"><h1>Judges only</h1><p class="muted">Your account can’t enter official scores. Teams can use the Practice page.</p></section>'; return {}; }
  root.innerHTML = '<h1 class="page-title">Official scoring</h1><div id="sc"></div>';
  const sc = mountScorer(root.querySelector('#sc'), { mode: 'official', store: ctx.store, teams: ctx.teams, scores: ctx.scores, events: ctx.scoringEvents, user: ctx.user });
  return { update: () => sc.refresh(), destroy: () => sc.destroy() };
}

// ───────────────────────────── Practice ─────────────────────────────
export function practiceView(root, ctx) {
  const u = ctx.user();
  if (!u) return gate(root, 'Coaches and team members sign in to score practice runs.', ctx);
  if (!isTeamSide(u.role)) { root.innerHTML = '<section class="card narrow"><h1>Teams only</h1><p class="muted">Practice runs belong to a team’s coaches and members.</p></section>'; return {}; }
  const team = () => ctx.teams().find((t) => t.id === u.teamId);
  root.innerHTML = `<h1 class="page-title">Practice${team() ? ` · #${esc(team().number)} ${esc(team().name)}` : ''}</h1><div id="sc"></div>`;
  const sc = mountScorer(root.querySelector('#sc'), { mode: 'practice', store: ctx.store, teams: ctx.teams, scores: ctx.scores, user: ctx.user, lockedTeamId: u.teamId });
  return { update: () => sc.refresh(), destroy: () => sc.destroy() };
}

// ───────────────────────────── Team stats ─────────────────────────────
export function statsView(root, ctx) {
  const u = ctx.user();
  if (!u) return gate(root, 'Coaches and team members sign in to see their team’s practice stats.', ctx);
  if (!isTeamSide(u.role)) { root.innerHTML = '<section class="card narrow"><h1>Teams only</h1><p class="muted">Stats are shown for a team’s coaches and members.</p></section>'; return {}; }
  root.innerHTML = '<h1 class="page-title">Team stats</h1><div id="st"></div>';
  let runs = [];
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  function spark(vals) {
    if (vals.length < 2) return '<p class="muted small">Save two or more practice runs to see your trend.</p>';
    const W = 320, H = 90, P = 8, mx = Math.max(...vals, 1), step = (W - 2 * P) / (vals.length - 1);
    const pts = vals.map((v, i) => [P + i * step, H - P - (v / mx) * (H - 2 * P)]);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Practice score trend, from ${vals[0]} to ${vals[vals.length - 1]}">
      <polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" points="${pts.map((p) => p.join(',')).join(' ')}"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="var(--accent)"><title>Run ${i + 1}: ${vals[i]}</title></circle>`).join('')}</svg>`;
  }

  function render() {
    const el = root.querySelector('#st');
    const sorted = runs.slice().sort((a, b) => a.createdAt - b.createdAt);
    const totals = sorted.map((r) => r.total);
    const official = ctx.scores().filter((s) => s.teamId === u.teamId).sort((a, b) => a.round - b.round);
    const avg = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0;
    const per = MISSIONS.map((m) => {
      const pts = sorted.map((r) => r.result?.missions?.find((x) => x.id === m.id)?.points ?? 0);
      const a = pts.length ? pts.reduce((x, y) => x + y, 0) / pts.length : 0;
      const hit = pts.filter((p) => p >= max().perMission[m.id]).length;
      return { m, avg: a, pct: pct(a, max().perMission[m.id]), hit, n: pts.length };
    });
    const weak = per.filter((p) => p.n).sort((a, b) => a.pct - b.pct).slice(0, 3);
    el.innerHTML = `
      <section class="kpis">
        <div class="kpi"><span>Practice runs</span><b>${runs.length}</b></div>
        <div class="kpi"><span>Best practice</span><b>${totals.length ? Math.max(...totals) : '—'}</b></div>
        <div class="kpi"><span>Average</span><b>${totals.length ? avg : '—'}</b></div>
        <div class="kpi"><span>Best official</span><b>${official.length ? Math.max(...official.map((s) => s.total)) : '—'}</b></div>
      </section>
      <div class="cols">
        <section class="card"><h2>Score trend</h2>${spark(totals)}
          ${official.length ? `<h3>Official matches</h3><ul class="chips">${official.map((s) => `<li>Match ${s.round}: <b>${s.total}</b></li>`).join('')}</ul>` : ''}</section>
        <section class="card"><h2>Focus next</h2>${weak.length ? `<ul class="focus">${weak.map((w) => `<li><b>M${String(w.m.num).padStart(2, '0')} ${esc(w.m.name)}</b><small>avg ${w.avg.toFixed(1)} of ${max().perMission[w.m.id]} pts · full marks ${w.hit}/${w.n} runs</small></li>`).join('')}</ul>` : '<p class="muted">Save a practice run to see which missions to practise.</p>'}</section>
      </div>
      <section class="card"><h2>Average points by mission</h2>
        <ul class="bars">${per.map((p) => `<li><span class="bl">M${String(p.m.num).padStart(2, '0')} ${esc(p.m.name)}</span><span class="bt"><i style="width:${p.pct}%"></i></span><span class="bv">${p.avg.toFixed(1)}<small>/${max().perMission[p.m.id]}</small></span></li>`).join('')}</ul></section>
      <section class="card"><h2>Practice history</h2>${sorted.length ? `<ul class="history">${sorted.slice().reverse().map((r, i) => `
        <li><button class="linkish" data-run="${esc(r.id)}"><b>${r.total}</b> pts <small>${new Date(r.createdAt).toLocaleString()}${r.by ? ` · ${esc(r.by)}` : ''}</small></button>
        ${u.role === 'coach' || r.uid === u.uid ? `<button class="btn ghost small" data-del="${esc(r.id)}" aria-label="Delete run from ${new Date(r.createdAt).toLocaleString()}">Delete</button>` : ''}</li>`).join('')}</ul>` : '<p class="empty">No practice runs saved yet — head to Practice.</p>'}</section>`;
  }
  root.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-del]'), v = e.target.closest('[data-run]');
    if (d && confirm('Delete this practice run?')) { try { await ctx.store.remove('practice', d.dataset.del); } catch (x) { toast(x.message, 'err'); } }
    if (v) {
      const r = runs.find((x) => x.id === v.dataset.run); if (!r) return;
      modal(`<table class="rv-table"><tbody><tr><td>Equipment inspection</td><td class="num">${r.result.equipment}</td></tr><tr><td>Precision tokens</td><td class="num">${r.result.tokens}</td></tr>
        ${r.result.missions.map((m) => `<tr class="${m.points ? 'has' : ''}"><td>M${String(m.num).padStart(2, '0')} ${esc(m.name)}</td><td class="num">${m.points}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><th class="num">${r.total}</th></tr></tfoot></table>`, { title: 'Practice run' });
    }
  });
  const unsub = ctx.store.subscribe('practice', (r) => { runs = r; render(); });
  return { update: render, destroy: unsub };
}

// ───────────────────────────── My team (coach / member) ─────────────────────────────
export function teamView(root, ctx) {
  const u = ctx.user();
  if (!u) return gate(root, 'Coaches and team members sign in to see their team.', ctx);
  if (!isTeamSide(u.role)) { root.innerHTML = '<section class="card narrow"><h1>Teams only</h1><p class="muted">This page is for a team’s coaches and members.</p></section>'; return {}; }
  const coach = u.role === 'coach';
  let people = [];
  root.innerHTML = `<h1 class="page-title">My team</h1>
    <section class="card"><h2 id="t-title">Team</h2>
      ${coach ? `<form id="t-rename" class="inline"><label class="field grow"><span>Team name</span><input id="t-name" maxlength="60" required></label><button class="btn primary">Save name</button></form>
        <p class="muted small">Only an admin can change the team number.</p>` : '<p class="muted">Your coach can rename the team and add or remove people.</p>'}
      <p class="muted small">You’re signed in as <b>${esc(u.name)}</b> (${esc(u.email)}) · ${esc(ROLE_LABEL[u.role])}.</p></section>
    ${coach ? `<section class="card"><h2>People on your team</h2>
      <p class="muted small">Add anyone — a parent, a mentor, a teammate — by their Google (gmail) address. They can sign in with that account to use practice runs and team stats.</p>
      <form id="t-add" class="grid-user" novalidate><label class="field"><span>Google email</span><input id="t-email" type="email" inputmode="email" autocapitalize="none" spellcheck="false" autocomplete="off" required></label>
        <label class="field"><span>Name or note <small>(optional)</small></span><input id="t-pname" maxlength="40" placeholder="e.g. Sam’s mom"></label>
        <button class="btn primary">Add person</button></form>
      <div id="t-err" class="error" role="alert" hidden></div>
      <ul class="admin-list" id="t-people"></ul></section>` : ''}`;
  const $ = (q) => root.querySelector(q);
  const team = () => ctx.teams().find((t) => t.id === u.teamId);
  const run = async (fn) => { try { await fn(); } catch (x) { toast(x.message, 'err'); } };
  function render() {
    const t = team();
    $('#t-title').textContent = t ? `#${t.number} ${t.name}` : 'Team';
    if (coach) {
      if (document.activeElement?.id !== 't-name' && t) $('#t-name').value = t.name;
      $('#t-people').innerHTML = people.slice().sort((a, b) => (a.role === 'coach' ? 0 : 1) - (b.role === 'coach' ? 0 : 1) || a.id.localeCompare(b.id)).map((p) => `<li>
        <span><b>${esc(p.name || p.id.split('@')[0])}</b> <span class="badge">${esc(ROLE_LABEL[p.role])}</span><small class="block">${esc(p.id)}</small></span>
        ${p.role === 'member' ? `<button class="btn ghost small danger" data-rm="${esc(p.id)}" aria-label="Remove ${esc(p.id)}">Remove</button>` : ''}</li>`).join('') || '<li class="empty">Nobody yet.</li>';
    }
  }
  if (coach) {
    $('#t-rename').addEventListener('submit', (e) => { e.preventDefault(); const name = $('#t-name').value.trim(); if (!name) return; run(async () => { await ctx.store.patch('teams', u.teamId, { name }); toast('Team name saved', 'ok'); }); });
    $('#t-add').addEventListener('submit', async (e) => {
      e.preventDefault();
      const er = $('#t-err'); er.hidden = true;
      const email = normEmail($('#t-email').value);
      try {
        if (!EMAIL_RE.test(email)) throw new Error('Enter a valid Google email address.');
        if (people.some((p) => p.id === email)) throw new Error('That person is already on your team.');
        await ctx.store.put('access', email, { role: 'member', teamId: u.teamId, name: $('#t-pname').value.trim(), addedBy: u.email, addedAt: Date.now() });
        e.target.reset(); toast(`Added ${email}`, 'ok'); $('#t-email').focus();
      } catch (x) { er.hidden = false; er.textContent = x.code === 'permission-denied' ? 'Couldn’t add that address — it may already belong to another team or role. Ask an admin.' : x.message; }
    });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rm]'); if (!b) return;
      if (confirm(`Remove ${b.dataset.rm} from your team? They will no longer be able to sign in.`)) run(() => ctx.store.remove('access', b.dataset.rm));
    });
  }
  const unsub = coach ? ctx.store.subscribe('access', (r) => { people = r; render(); }) : () => {};
  render();
  return { update: render, destroy: unsub };
}

// ───────────────────────────── Admin ─────────────────────────────
export function adminView(root, ctx) {
  const u = ctx.user();
  if (!u) return gate(root, 'Admins sign in to manage the event.', ctx);
  if (u.role !== 'admin') { root.innerHTML = '<section class="card narrow"><h1>Admins only</h1><p class="muted">Ask an event admin if a score needs correcting.</p></section>'; return {}; }
  let people = [];
  const demo = ctx.store.mode === 'demo';
  root.innerHTML = `<h1 class="page-title">Admin console</h1>
    <section class="card"><h2>Events</h2>
      <form id="a-ev" class="inline"><label class="field grow"><span>Event name</span><input id="a-evn" maxlength="80" required></label>
        <label class="field"><span>Date</span><input id="a-evd" type="date"></label><button class="btn primary">Add event</button></form>
      <p class="muted small">The <b>live</b> event is what visitors see first. Standings are kept separately for each event.</p>
      <ul class="admin-list" id="a-events"></ul></section>
    <section class="card"><h2>Teams</h2>
      <form id="a-team" class="inline" novalidate><label class="field"><span>Number <small>(required)</small></span><input id="a-tn" inputmode="numeric" pattern="[0-9]*" maxlength="6" required></label>
        <label class="field grow"><span>Team name <small>(required)</small></span><input id="a-tname" maxlength="60" required></label><button class="btn primary">Add team</button></form>
      <div id="a-terr" class="error" role="alert" hidden></div>
      <details class="bulk"><summary>Bulk add (paste “number, name” per line)</summary><textarea id="a-bulk" aria-label="Teams to add, one per line" rows="4" placeholder="4201, Robo Rangers&#10;5530, Byte Me"></textarea><button class="btn ghost" id="a-bulkgo" type="button">Add all</button></details>
      <ul class="admin-list" id="a-teams"></ul></section>
    <section class="card"><h2>People &amp; access</h2>
      <p class="muted small">Only Google accounts listed here can sign in. Add <b>coaches</b> to a team (each team can have as many as you like) — coaches then add their own team members. <b>Event hosts</b> are assigned per event in the Events card above. Give <b>admin</b> access to anyone by their gmail.</p>
      <form id="a-user" class="grid-user" novalidate><label class="field"><span>Google email</span><input id="a-ue" type="email" inputmode="email" autocapitalize="none" spellcheck="false" autocomplete="off" required></label>
        <label class="field"><span>Role</span><select id="a-ur"><option value="coach">Coach</option><option value="judge">Judge</option><option value="host">Event host</option><option value="admin">Admin</option></select></label>
        <label class="field" id="a-ut-wrap"><span>Team</span><select id="a-ut"></select></label>
        <label class="field"><span>Name <small>(optional)</small></span><input id="a-un" maxlength="40"></label><button class="btn primary">Add person</button></form>
      <div id="a-uerr" class="error" role="alert" hidden></div>
      <div id="a-users"></div></section>
    <section class="card"><h2>Official scores</h2><div class="row-actions"><button class="btn ghost" id="a-csv">Export CSV</button>${demo ? '<button class="btn ghost danger" id="a-reset">Reset demo data</button>' : ''}</div>
      <div class="table-scroll"><table class="data"><thead><tr><th>Event</th><th>Team</th><th>Match</th><th class="num">Score</th><th>Judge</th><th></th></tr></thead><tbody id="a-scores"></tbody></table></div></section>`;
  const $ = (s) => root.querySelector(s);
  const hostCount = (id) => (ctx.eventHosts().find((h) => h.id === id)?.emails || []).length;
  const evName = (id) => ctx.events().find((e) => e.id === id)?.name || '—';
  const teamName = (id) => { const t = ctx.teams().find((x) => x.id === id); return t ? `#${t.number} ${t.name}` : id; };

  function render() {
    const teams = ctx.teams().slice().sort((a, b) => a.number - b.number);
    const events = ctx.events().slice().sort((a, b) => (b.live - a.live) || (b.createdAt || 0) - (a.createdAt || 0));
    $('#a-events').innerHTML = events.map((e) => `<li><span><b>${esc(e.name)}</b>${e.live ? ' <span class="badge live-b">live</span>' : ''}<small class="block">${e.date ? esc(e.date) + ' · ' : ''}${e.teamIds?.length ? `${e.teamIds.length} teams` : 'all teams'} · ${hostCount(e.id)} host${hostCount(e.id) === 1 ? '' : 's'}${e.schedule?.rows?.length ? ' · schedule ✓' : ''}</small></span>
      <span class="acts"><button class="btn ghost small" data-evmanage="${esc(e.id)}">Manage</button><button class="btn ghost small" data-evhosts="${esc(e.id)}">Hosts</button>${e.live ? '' : `<button class="btn ghost small" data-evlive="${esc(e.id)}">Make live</button>`}<button class="btn ghost small danger" data-delev="${esc(e.id)}" aria-label="Delete event ${esc(e.name)}">Delete</button></span></li>`).join('') || '<li class="empty">No events yet — add one so judges can score.</li>';
    $('#a-teams').innerHTML = teams.map((t) => `<li><span><b>#${esc(t.number)}</b> ${esc(t.name)}</span><span class="acts"><button class="btn ghost small" data-rename="${esc(t.id)}" aria-label="Rename team ${esc(t.name)}">Rename</button><button class="btn ghost small danger" data-delteam="${esc(t.id)}" aria-label="Delete team ${esc(t.name)}">Delete</button></span></li>`).join('') || '<li class="empty">No teams yet.</li>';
    const sel = $('#a-ut'); const cur = sel.value;
    sel.innerHTML = teams.map((t) => `<option value="${esc(t.id)}">${esc(t.number)} ${esc(t.name)}</option>`).join(''); sel.value = cur;
    $('#a-ut-wrap').hidden = $('#a-ur').value !== 'coach';
    const grp = (role, title) => {
      const rows = people.filter((p) => p.role === role).sort((a, b) => (a.teamId || '').localeCompare(b.teamId || '') || a.id.localeCompare(b.id));
      if (!rows.length) return '';
      return `<h3>${title} <small>(${rows.length})</small></h3><ul class="admin-list">${rows.map((p) => `<li><span><b>${esc(p.name || p.id.split('@')[0])}</b>${p.id === u.email ? ' <span class="badge">you</span>' : ''}<small class="block">${esc(p.id)}${p.teamId ? ` · ${esc(teamName(p.teamId))}` : ''}</small></span>
        ${p.id === u.email ? '' : `<button class="btn ghost small danger" data-rmp="${esc(p.id)}" aria-label="Remove ${esc(p.id)}">Remove</button>`}</li>`).join('')}</ul>`;
    };
    $('#a-users').innerHTML = grp('admin', 'Admins') + grp('judge', 'Judges') + grp('coach', 'Coaches') + grp('member', 'Team members') || '<p class="empty">Nobody listed.</p>';
    const sc = ctx.scores().slice().sort((a, b) => (a.eventId || '').localeCompare(b.eventId || '') || a.number - b.number || a.round - b.round);
    $('#a-scores').innerHTML = sc.map((s) => `<tr><td>${esc(evName(s.eventId))}</td><td>#${esc(s.number)} ${esc(s.name)}</td><td>${s.round}</td><td class="num"><b>${s.total}</b></td><td>${esc(s.judgeName || '')}</td>
      <td class="acts"><button class="btn ghost small" data-sig="${esc(s.id)}">Signature</button><button class="btn ghost small danger" data-delscore="${esc(s.id)}" aria-label="Delete score for ${esc(s.name)} match ${s.round}">Delete</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No scores yet.</td></tr>';
  }
  const run = async (fn) => { try { await fn(); } catch (x) { toast(x.message, 'err'); } };

  function openHosts(eventId) {
    const ev = ctx.events().find((x) => x.id === eventId); if (!ev) return;
    const dlg = modal('<div id="h-body"></div>', { title: `Hosts · ${ev.name}` });
    const emails = () => (ctx.eventHosts().find((h) => h.id === eventId)?.emails || []);
    const paint = () => {
      dlg.querySelector('#h-body').innerHTML = `<p class="muted small">Hosts can add teams, choose which teams compete, generate the match schedule and enter scores — for this event only.</p>
        <ul class="admin-list">${emails().map((m) => `<li><span>${esc(m)}</span><button class="btn ghost small danger" data-hrm="${esc(m)}" aria-label="Remove host ${esc(m)}">Remove</button></li>`).join('') || '<li class="empty">No hosts yet.</li>'}</ul>
        <form id="h-add" class="inline" novalidate><label class="field grow"><span>Host’s Google email</span><input id="h-email" type="email" inputmode="email" autocapitalize="none" autocomplete="off" required></label><button class="btn primary">Add host</button></form>
        <div id="h-err" class="error" role="alert" hidden></div>`;
    };
    const fail = (m) => { const er = dlg.querySelector('#h-err'); er.hidden = false; er.textContent = m; };
    dlg.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = normEmail(dlg.querySelector('#h-email').value);
      try {
        if (!EMAIL_RE.test(email)) return fail('Enter a valid Google email address.');
        if (emails().includes(email)) return fail('Already a host of this event.');
        const existing = people.find((p) => p.id === email);
        if (existing && !['host', 'admin'].includes(existing.role)) return fail(`${email} is already a ${ROLE_LABEL[existing.role].toLowerCase()} — one role per person. Remove that first.`);
        if (!existing) await ctx.store.put('access', email, { role: 'host', name: '', addedBy: u.email, addedAt: Date.now() });
        await ctx.store.put('eventHosts', eventId, { emails: [...emails(), email] });
        toast(`${email} is now a host`, 'ok'); paint();
      } catch (x) { fail(x.message); }
    });
    dlg.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-hrm]'); if (!b) return;
      const email = b.dataset.hrm;
      try {
        await ctx.store.put('eventHosts', eventId, { emails: emails().filter((m) => m !== email) });
        const stillHosts = ctx.eventHosts().some((h) => h.id !== eventId && (h.emails || []).includes(email));
        if (!stillHosts && people.find((p) => p.id === email)?.role === 'host') await ctx.store.remove('access', email);
        paint();
      } catch (x) { fail(x.message); }
    });
    dlg.hostsRefresh = paint;
    paint();
  }
  $('#a-ev').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#a-evn').value.trim(); if (!name) return;
    run(async () => {
      const first = ctx.events().length === 0;
      await ctx.store.put('events', ctx.store.newId('e'), { name, date: $('#a-evd').value || '', live: first, createdAt: Date.now() });
      e.target.reset(); toast(`Event “${name}” added`, 'ok');
    });
  });
  $('#a-ur').addEventListener('change', render);
  $('#a-team').addEventListener('submit', (e) => {
    e.preventDefault();
    const er = $('#a-terr'); er.hidden = true;
    const number = parseInt($('#a-tn').value, 10), name = $('#a-tname').value.trim();
    const bad = (m) => { er.hidden = false; er.textContent = m; };
    if (!(number > 0)) return bad('A team number is required.');
    if (!name) return bad('A team name is required.');
    if (ctx.teams().some((t) => t.number === number)) return bad(`Team #${number} already exists.`);
    run(async () => { await ctx.store.put('teams', `t${number}`, { number, name, createdBy: u.email }); e.target.reset(); $('#a-tn').focus(); });
  });
  $('#a-bulkgo').addEventListener('click', () => run(async () => {
    const lines = $('#a-bulk').value.split('\n').map((l) => l.trim()).filter(Boolean);
    let n = 0;
    for (const l of lines) {
      const m = l.match(/^(\d{1,6})\s*[,\t]\s*(.+)$/); if (!m || !+m[1]) continue;
      if (ctx.teams().some((t) => t.number === +m[1])) continue;
      await ctx.store.put('teams', `t${+m[1]}`, { number: +m[1], name: m[2].trim(), createdBy: u.email }); n++;
    }
    $('#a-bulk').value = ''; toast(`Added ${n} team${n === 1 ? '' : 's'}`, 'ok');
  }));
  $('#a-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    const er = $('#a-uerr'); er.hidden = true;
    const email = normEmail($('#a-ue').value), role = $('#a-ur').value;
    try {
      if (!EMAIL_RE.test(email)) throw new Error('Enter a valid Google email address.');
      if (role === 'coach' && !$('#a-ut').value) throw new Error('Pick the team this coach belongs to (add the team first).');
      const doc = { role, name: $('#a-un').value.trim(), addedBy: u.email, addedAt: Date.now() };
      if (role === 'coach') doc.teamId = $('#a-ut').value;
      await ctx.store.put('access', email, doc);
      e.target.reset(); toast(`${email} added as ${ROLE_LABEL[role].toLowerCase()}`, 'ok');
    } catch (x) { er.hidden = false; er.textContent = x.message; }
  });
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if (d.delteam && confirm('Delete this team? Its official scores stay in the database but no longer show.')) run(() => ctx.store.remove('teams', d.delteam));
    if (d.rename) { const cur = ctx.teams().find((x) => x.id === d.rename); const name = prompt('New team name', cur?.name || ''); if (name?.trim()) run(() => ctx.store.patch('teams', d.rename, { name: name.trim() })); }
    if (d.delscore && confirm('Delete this official score? The match can then be re-scored.')) run(() => ctx.store.remove('scores', d.delscore));
    if (d.rmp && confirm(`Remove ${d.rmp}? They will no longer be able to sign in.`)) run(() => ctx.store.remove('access', d.rmp));
    if (d.delev && confirm('Delete this event? Its scores stay in the database but no longer show on the dashboard.')) run(async () => { await ctx.store.remove('events', d.delev); if (ctx.eventHosts().some((h) => h.id === d.delev)) await ctx.store.remove('eventHosts', d.delev); });
    if (d.evmanage) { try { localStorage.setItem(MANAGE_KEY, d.evmanage); } catch { /* ignore */ } ctx.go('#/event'); }
    if (d.evhosts) openHosts(d.evhosts);
    if (d.evlive) run(async () => { for (const ev of ctx.events()) if (!!ev.live !== (ev.id === d.evlive)) await ctx.store.patch('events', ev.id, { live: ev.id === d.evlive }); toast('Live event changed', 'ok'); });
    if (d.sig) run(async () => {
      const g = await ctx.store.get('signatures', d.sig);
      modal(g?.signature && g.signature.startsWith('data:') ? `<img class="sigimg" src="${g.signature}" alt="Team signature">` : '<p class="empty">No drawn signature on file (demo seed data).</p>', { title: 'Team signature' });
    });
  });
  $('#a-csv').addEventListener('click', () => {
    const head = ['event', 'team_number', 'team_name', 'match', 'total', 'gp', 'table', 'judge', 'initials', 'submitted_at', ...MISSIONS.map((m) => m.id)];
    const rows = ctx.scores().slice().sort((a, b) => (a.eventId || '').localeCompare(b.eventId || '') || a.number - b.number || a.round - b.round).map((s) => [
      evName(s.eventId), s.number, s.name, s.round, s.total, s.gp, s.table, s.judgeName, s.initials, new Date(s.createdAt).toISOString(),
      ...MISSIONS.map((m) => s.result.missions.find((x) => x.id === m.id)?.points ?? 0)]);
    download('glowboard-scores.csv', [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'));
  });
  $('#a-reset')?.addEventListener('click', () => { if (confirm('Replace ALL demo data with fresh sample data?')) run(() => ctx.store.resetDemo()); });
  const unsub = ctx.store.subscribe('access', (r) => { people = r; render(); });
  return { update: () => { render(); document.querySelector('dialog[open]')?.hostsRefresh?.(); }, destroy: unsub };
}

// ───────────────────────────── Public schedule ─────────────────────────────
const teamLabel = (t) => (t ? `#${t.number} ${t.name}` : '—');
function scheduleTableHTML(sched, teams, q = '') {
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]));
  const T = sched.config?.tables || 1;
  const hit = (t) => q && t && `${t.number} ${t.name}`.toLowerCase().includes(q);
  return groupSchedule(sched.rows).map((g) => `
    <h3>Round ${g.round}</h3>
    <div class="table-scroll"><table class="data sched"><thead><tr><th>Time</th>${Array.from({ length: T }, (_, i) => `<th>Table ${i + 1}</th>`).join('')}</tr></thead><tbody>
      ${g.slots.map((sl) => `<tr><th scope="row">${esc(sl.time)}</th>${Array.from({ length: T }, (_, i) => {
        const t = byId[sl.tables[i + 1]];
        return `<td class="${hit(t) ? 'hit' : ''}">${t ? `<b>#${esc(t.number)}</b> ${esc(t.name)}` : '<span class="muted">—</span>'}</td>`;
      }).join('')}</tr>`).join('')}
    </tbody></table></div>`).join('');
}

export function scheduleView(root, ctx) {
  root.innerHTML = `<h1 class="page-title">Match schedule</h1>
    <div class="toolbar"><label class="field evsel"><span class="sr">Event</span><select id="s-ev" aria-label="Event"></select></label>
      <label class="search"><span class="sr">Find a team</span><input id="s-q" type="search" placeholder="Find a team or number…" autocomplete="off"></label></div>
    <section class="card"><div id="s-mine"></div><div id="s-body"></div></section>`;
  const $ = (x) => root.querySelector(x);
  let q = '';
  $('#s-q').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); render(); });
  $('#s-ev').addEventListener('change', (e) => { try { localStorage.setItem(EV_KEY, e.target.value); } catch { /* ignore */ } render(); });
  function render() {
    const events = ctx.events(), ev = pickEvent(events);
    const sel = $('#s-ev');
    sel.hidden = events.length < 2;
    sel.innerHTML = events.slice().sort((a, b) => (b.live - a.live) || (b.createdAt || 0) - (a.createdAt || 0)).map((e) => `<option value="${esc(e.id)}">${esc(e.name)}${e.live ? ' · live' : ''}</option>`).join('');
    if (ev) sel.value = ev.id;
    const sched = ev?.schedule;
    if (!sched?.rows?.length) { $('#s-mine').innerHTML = ''; $('#s-body').innerHTML = `<p class="empty">${ev ? 'The schedule for this event hasn’t been published yet.' : 'No events yet.'}</p>`; return; }
    const teams = ctx.teams();
    const matches = q ? teams.filter((t) => `${t.number} ${t.name}`.toLowerCase().includes(q)) : [];
    $('#s-mine').innerHTML = matches.length === 1
      ? `<p class="mine"><b>${esc(teamLabel(matches[0]))}</b> plays: ${sched.rows.filter((r) => r.teamId === matches[0].id).sort((a, b) => a.slot - b.slot).map((r) => `<span class="chip">R${r.round} · ${esc(r.time)} · table ${r.table}</span>`).join(' ')}</p>` : '';
    $('#s-body').innerHTML = `<p class="muted small">${esc(ev.name)} · ${sched.config.rounds} rounds · ${sched.config.tables} tables · ${sched.stats?.teams ?? ''} teams · finishes about ${esc(sched.stats?.endsAt || '')}</p>` + scheduleTableHTML(sched, teams, q);
  }
  render();
  return { update: render };
}

// ───────────────────────────── Event management (hosts + admins) ─────────────────────────────
export function eventView(root, ctx) {
  const u = ctx.user();
  if (!u) return gate(root, 'Event hosts sign in to manage their event.', ctx);
  if (!['host', 'admin'].includes(u.role)) { root.innerHTML = '<section class="card narrow"><h1>Hosts only</h1><p class="muted">Event pages are for event hosts and admins.</p></section>'; return {}; }
  root.innerHTML = '<h1 class="page-title">Event</h1><div id="ev"></div>';
  const host = root.querySelector('#ev');
  let selId = null, picks = null, pickKey = '', draft = null, seed = 1, cfgIn = null;
  try { selId = localStorage.getItem(MANAGE_KEY); } catch { /* ignore */ }
  const run = async (fn) => { try { await fn(); } catch (x) { toast(x.message, 'err'); } };
  const mine = () => hostedEvents(u, ctx.events(), ctx.eventHosts()).sort((a, b) => (b.live - a.live) || (b.createdAt || 0) - (a.createdAt || 0));
  const cur = () => { const list = mine(); return list.find((e) => e.id === selId) || list[0] || null; };

  function draw() {
    const list = mine(), ev = cur();
    if (!ev) { host.innerHTML = `<section class="card narrow"><h2>No events yet</h2><p class="muted">${u.role === 'admin' ? 'Create an event on the Admin page first.' : 'An admin needs to assign you to an event. Ask them to add your Google account under Events → Hosts.'}</p></section>`; return; }
    const teams = ctx.teams().slice().sort((a, b) => a.number - b.number);
    if (pickKey !== ev.id) { picks = new Set(ev.teamIds || []); pickKey = ev.id; draft = null; cfgIn = null; seed = 1; }
    const cfg = cfgIn || ev.schedule?.config || SCHEDULE_DEFAULTS;
    const shown = draft || ev.schedule || null;
    const evTeams = eventTeams(ev, teams);
    host.innerHTML = `
      ${list.length > 1 ? `<label class="field evsel"><span>Event</span><select id="e-sel">${list.map((e) => `<option value="${esc(e.id)}" ${e.id === ev.id ? 'selected' : ''}>${esc(e.name)}${e.live ? ' · live' : ''}</option>`).join('')}</select></label>` : `<h2 class="evtitle">${esc(ev.name)}</h2>`}
      <section class="card"><h2>Teams at this event <small>(${evTeams.length}${ev.teamIds?.length ? '' : ' · all teams'})</small></h2>
        <form id="e-team" class="inline" novalidate><label class="field"><span>Number <small>(required)</small></span><input id="e-tn" inputmode="numeric" pattern="[0-9]*" maxlength="6" required></label>
          <label class="field grow"><span>Team name <small>(required)</small></span><input id="e-tname" maxlength="60" required></label><button class="btn primary">Add team</button></form>
        <div id="e-terr" class="error" role="alert" hidden></div>
        <details class="bulk"><summary>Bulk add (paste “number, name” per line)</summary><textarea id="e-bulk" aria-label="Teams to add, one per line" rows="4" placeholder="4201, Robo Rangers&#10;5530, Byte Me"></textarea><button class="btn ghost" id="e-bulkgo" type="button">Add all</button></details>
        <p class="muted small">Tick the teams competing here, then save. Leave all unticked to include every team.</p>
        <div class="row-actions"><button class="btn ghost small" id="e-all" type="button">Tick all</button><button class="btn ghost small" id="e-none" type="button">Clear</button></div>
        <div class="checklist" id="e-checks">${teams.map((t) => `<label class="check"><input type="checkbox" data-tid="${esc(t.id)}" ${picks.has(t.id) ? 'checked' : ''}> <span><b>#${esc(t.number)}</b> ${esc(t.name)}</span></label>`).join('') || '<p class="empty">No teams yet — add one above.</p>'}</div>
        <button class="btn primary" id="e-saveteams" type="button">Save teams</button></section>
      <section class="card"><h2>Match schedule</h2>
        <p class="muted small">Auto-generates a schedule for the ${evTeams.length} team${evTeams.length === 1 ? '' : 's'} above: every team plays every round, tables rotate, and no team plays back-to-back when it can be avoided.</p>
        <form id="e-cfg" class="sched-form" novalidate>
          <label class="field"><span>Rounds</span><input id="c-rounds" type="number" inputmode="numeric" min="${LIMITS.rounds[0]}" max="${LIMITS.rounds[1]}" value="${cfg.rounds}"></label>
          <label class="field"><span>Tables</span><input id="c-tables" type="number" inputmode="numeric" min="${LIMITS.tables[0]}" max="${LIMITS.tables[1]}" value="${cfg.tables}"></label>
          <label class="field"><span>First match</span><input id="c-start" type="time" value="${esc(cfg.start)}"></label>
          <label class="field"><span>Minutes per match</span><input id="c-interval" type="number" inputmode="numeric" min="${LIMITS.interval[0]}" max="${LIMITS.interval[1]}" value="${cfg.interval}"></label>
          <label class="field"><span>Break between rounds (min)</span><input id="c-break" type="number" inputmode="numeric" min="${LIMITS.breakMin[0]}" max="${LIMITS.breakMin[1]}" value="${cfg.breakMin}"></label>
          <div class="row-actions"><button class="btn primary" id="e-gen" type="submit">${draft ? 'Shuffle again' : 'Generate schedule'}</button></div></form>
        <div id="e-sched">${shown?.rows?.length ? schedBlock(shown, ev, evTeams) : '<p class="empty">No schedule yet — set the options above and generate one.</p>'}</div></section>`;
  }
  function schedBlock(sch, ev, evTeams) {
    const st = sch.stats || {};
    const warn = st.minGap != null && st.minGap < 2 && st.slotsPerRound >= 2;
    return `<div class="sched-meta"><b>${draft ? 'Preview (not saved)' : 'Saved schedule'}</b> · ${st.teams} teams · ${st.slotsPerRound} slot${st.slotsPerRound === 1 ? '' : 's'} per round · ${sch.config.rounds} rounds · ends about ${esc(st.endsAt || '')}
        ${st.minGap != null && Number.isFinite(st.minGap) ? ` · shortest rest between a team’s matches: ${st.minGap - 1} slot${st.minGap - 1 === 1 ? '' : 's'}` : ''}${warn ? ' <span class="badge warnb">tight</span>' : ''}</div>
      <div class="row-actions">
        ${draft ? '<button class="btn primary" id="e-save" type="button">Save schedule</button>' : ''}
        <button class="btn ghost" id="e-csv" type="button">Download CSV</button>
        <button class="btn ghost" id="e-copy" type="button">Copy for Google Sheets</button>
        <button class="btn ghost" id="e-sheets" type="button" ${sheetsConfigured() ? '' : 'title="Google Sheets isn’t connected yet"'}>Send to Google Sheets${sheetsConfigured() ? '' : ' (not set up)'}</button>
        ${!draft && ev.schedule ? '<button class="btn ghost danger" id="e-clear" type="button">Delete saved schedule</button>' : ''}</div>
      ${scheduleTableHTML(sch, evTeams)}`;
  }
  const readCfg = () => clampConfig({ rounds: root.querySelector('#c-rounds').value, tables: root.querySelector('#c-tables').value, start: root.querySelector('#c-start').value, interval: root.querySelector('#c-interval').value, breakMin: root.querySelector('#c-break').value });
  const exportTable = () => { const ev = cur(); return scheduleTable(draft || ev.schedule, eventTeams(ev, ctx.teams()), ev.name); };

  host.addEventListener('change', (e) => {
    if (e.target.id === 'e-sel') { selId = e.target.value; try { localStorage.setItem(MANAGE_KEY, selId); } catch { /* ignore */ } pickKey = ''; draw(); }
    if (e.target.dataset?.tid) { e.target.checked ? picks.add(e.target.dataset.tid) : picks.delete(e.target.dataset.tid); }
  });
  host.addEventListener('submit', (e) => {
    e.preventDefault();
    const ev = cur();
    if (e.target.id === 'e-team') {
      const er = host.querySelector('#e-terr'); er.hidden = true;
      const number = parseInt(host.querySelector('#e-tn').value, 10), name = host.querySelector('#e-tname').value.trim();
      const bad = (m) => { er.hidden = false; er.textContent = m; };
      if (!(number > 0)) return bad('A team number is required.');
      if (!name) return bad('A team name is required.');
      if (ctx.teams().some((t) => t.number === number)) return bad(`Team #${number} already exists — tick it below instead.`);
      run(async () => {
        await ctx.store.put('teams', `t${number}`, { number, name, createdBy: u.email });
        picks.add(`t${number}`);
        if (ev.teamIds?.length) await ctx.store.patch('events', ev.id, { teamIds: [...new Set([...ev.teamIds, `t${number}`])] });
        e.target.reset(); host.querySelector('#e-tn').focus();
      });
    }
    if (e.target.id === 'e-cfg') {
      cfgIn = readCfg();
      const ids = eventTeams(ev, ctx.teams()).map((t) => t.id);
      if (!ids.length) return toast('Add or tick some teams first.', 'err');
      seed = draft ? seed + 1 : seed;
      draft = generateSchedule(ids, cfgIn, seed);
      draw();
    }
  });
  host.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const ev = cur();
    if (b.id === 'e-all') { picks = new Set(ctx.teams().map((t) => t.id)); host.querySelectorAll('[data-tid]').forEach((c) => { c.checked = true; }); }
    if (b.id === 'e-none') { picks = new Set(); host.querySelectorAll('[data-tid]').forEach((c) => { c.checked = false; }); }
    if (b.id === 'e-saveteams') run(async () => { await ctx.store.patch('events', ev.id, { teamIds: [...picks] }); draft = null; draw(); toast(picks.size ? `${picks.size} teams saved` : 'All teams included', 'ok'); });
    if (b.id === 'e-bulkgo') run(async () => {
      const lines = host.querySelector('#e-bulk').value.split('\n').map((l) => l.trim()).filter(Boolean);
      let n = 0; const added = [];
      for (const l of lines) {
        const m = l.match(/^(\d{1,6})\s*[,\t]\s*(.+)$/); if (!m || !+m[1]) continue;
        if (ctx.teams().some((t) => t.number === +m[1])) continue;
        await ctx.store.put('teams', `t${+m[1]}`, { number: +m[1], name: m[2].trim(), createdBy: u.email }); added.push(`t${+m[1]}`); n++;
      }
      added.forEach((id) => picks.add(id));
      if (ev.teamIds?.length && added.length) await ctx.store.patch('events', ev.id, { teamIds: [...new Set([...ev.teamIds, ...added])] });
      host.querySelector('#e-bulk').value = ''; toast(`Added ${n} team${n === 1 ? '' : 's'}`, 'ok');
    });
    if (b.id === 'e-save') run(async () => { await ctx.store.patch('events', ev.id, { schedule: { ...draft, generatedAt: Date.now(), generatedBy: u.email } }); draft = null; draw(); toast('Schedule saved — it’s now public on the Schedule page', 'ok'); });
    if (b.id === 'e-clear' && confirm('Delete the saved schedule?')) run(async () => { await ctx.store.patch('events', ev.id, { schedule: null }); draw(); });
    if (b.id === 'e-csv') downloadCSV(`${ev.name.replace(/\W+/g, '-').toLowerCase()}-schedule.csv`, exportTable());
    if (b.id === 'e-copy') run(async () => { toast((await copyForSheets(exportTable())) ? 'Copied — paste into Google Sheets (Ctrl+V)' : 'Couldn’t copy; use the CSV download', 'ok'); });
    if (b.id === 'e-sheets') run(async () => { await sendToSheets(`${ev.name} schedule`, exportTable()); toast('Sent to Google Sheets', 'ok'); });
  });
  draw();
  return { update: () => { if (host.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return; draw(); } };
}
