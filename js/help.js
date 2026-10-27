// Help tab: explains what the signed-in person can do and where. Only sections for powers they actually have are shown.
import { esc, toast } from './ui.js';
import { ROLE_LABEL, canScore, coachTeamIds, HELP_MAX, newHelpId, validHelpId } from './store.js';

const li = (items) => `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
const sec = (title, where, items) => `<section class="card help-sec"><h2>${title}</h2>${where ? `<p class="where">Where: ${where}</p>` : ''}${li(items)}</section>`;

export function helpSections(u, scoreable = []) {
  const out = [];
  out.push(sec('Everyone', 'Standings · Schedule · Scoring tool · Timer', [
    '<b>Standings</b> shows each event’s leaderboard. Pick an event at the top; Founders ranks by a team’s best match, Future by the average of its matches. <b>Big screen</b> fills a projector with every team’s three round scores.',
    '<b>Schedule</b> lists each event’s published match schedule and tables.',
    '<b>Scoring tool</b> is a calculator for either edition. Nothing is saved, and it is separate from practice runs and official scoring.',
    '<b>Timer</b> runs the 2:30 match with a start horn, reminders at 1:00 and 0:30 and an end horn. Turn the sound up first.',
    '<b>Resources</b> links to the Founders and Future rulebooks, scoresheets and referee training. It is open to everyone.',
    '<b>Sample team</b> has made-up practice runs so you can try the Stats and Advanced tools. It is read-only.',
    '<b>Teams → Register a team</b> lets anyone add their team with its number, name and coach Gmail to track practice runs. A new registration is <b>unofficial</b> until an event host or admin adds it to an event.',
    '<b>Live help</b> (below) lets you message the admins with a question. You don’t need to sign in.',
  ]));
  if (!u) {
    out.push(sec('Signing in', 'Sign in (top right)', [
      'Coaches, referees, event hosts and admins sign in with the Google account they were added with.',
      'Team members sign in with their team number and the team password their coach gives them.',
    ]));
    return out;
  }
  const coachOf = coachTeamIds(u).length > 0, member = (u.teams || []).length > 0;
  const admin = u.role === 'admin', host = Boolean(u.host) || u.role === 'host', scorer = canScore(u, scoreable);

  if (scorer) {
    out.push(sec('Scoring matches', 'Referee', [
      'Choose the <b>event</b>, <b>team</b>, <b>round</b> and <b>table</b>, and the <b>scoring edition</b> (Founders or Future) at the top. Only teams of that edition are listed.',
      'Tap each mission as the referee reads it out, then have the team sign and press submit.',
      'A submitted score cannot be edited. If it was wrong, an event host or admin deletes it and it can be scored again.',
      admin || host ? '' : 'You can only score events you have been given access to.',
    ].filter(Boolean)));
  }
  if (admin) {
    out.push(sec('Admin', 'Admin', [
      '<b>Events:</b> create events and choose their editions (Founders, Future or both). Change the editions of an existing event with the selector on its row. Make an event live, assign hosts, or delete it.',
      '<b>Teams:</b> add teams (one at a time or in bulk), rename them, switch a team between Founders and Future, delete them, and see or change a team’s password.',
      '<b>People:</b> give people Referee, Coach or Admin access by Gmail address, and remove them again.',
      '<b>Events:</b> rename an event from its row. A <b>test event</b> has tools to add demo teams and generate random scores.',
      '<b>Scores:</b> delete an official score so the match can be re-scored.',
      '<b>Give help</b> (below): read live-help messages from anyone, see their name, table or team and sign-in, reply, mark them resolved or delete them. Only admins can reply.',
      'You also have everything an event host has, in the <b>Event</b> tab.',
    ]));
  }
  if (host) {
    out.push(sec('Running an event', 'Event', [
      'You see only the events you host. Pick one at the top.',
      '<b>Teams:</b> only the teams you add to the event play in it. Add them one at a time or in bulk by team number — a number that already exists is the same team, so it is reused. A new team needs a name and its coach’s Gmail.',
      '<b>Team passwords:</b> you can set a new password for a team, but you cannot see the current one. The coach reads it on the Teams tab.',
      '<b>Schedule:</b> generate a match schedule (teams are shuffled so they meet different opponents each round), edit it by hand if you need to, print it, then publish it on the Schedule page.',
      '<b>Scoring:</b> you can enter official scores for your events from the Referee tab, and delete a score so a match can be re-scored.',
      '<b>Referees:</b> add or remove the people who may score at your event.',
    ]));
  }
  if (coachOf) {
    out.push(sec('Coaching a team', 'Teams', [
      '<b>Stats</b> and <b>Advanced</b> show your team’s results and trends. Advanced can be copied straight into Google Sheets.',
      '<b>Practice</b> records unofficial runs for your team (choose the edition). You can edit or delete your team’s runs. They stay private to your team.',
      '<b>Manage:</b> see the team password, add or remove team members and other coaches, rename the team and choose its colors.',
    ]));
  } else if (member) {
    out.push(sec('On a team', 'Teams', [
      '<b>Stats</b> and <b>Advanced</b> show your team’s results and trends.',
      '<b>Practice</b> records unofficial runs for your team. You can edit or delete the team’s runs.',
      'The <b>Manage</b> tab lets you leave the team. Your coach looks after the team password and the member list.',
    ]));
  }
  if (!scorer && !admin && !host && !coachOf && !member) {
    out.push(sec('Your account', '', ['You are signed in, but you have not been given a role yet. Ask an admin or event host to add your Gmail address.']));
  }
  return out;
}

// ---- live chat ----
const TID_KEY = 'glowboard-help-thread';
const POLL_MIN = 15000, POLL_SPAN = 15000; // refresh every 15–30 seconds
const nextDelay = () => POLL_MIN + Math.random() * POLL_SPAN;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const when = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Calls fn now and then every 15–30 s (only while the tab is visible). Returns a stop function.
function poll(fn) {
  let stopped = false, timer = null;
  const run = async () => { if (!document.hidden) { try { await fn(); } catch { /* offline: try again next time */ } } if (!stopped) timer = setTimeout(run, nextDelay()); };
  run();
  return () => { stopped = true; clearTimeout(timer); };
}

function bubbles(msgs, mine) {
  return msgs.map((m) => `<div class="hb ${m.from === mine ? 'me' : 'them'}"><div class="hb-t">${esc(m.text)}</div><small>${m.from === 'admin' ? 'Support' : 'You'} · ${esc(when(m.createdAt))}</small></div>`).join('');
}

function mountAsk(el, store, user) {
  let tid = lsGet(TID_KEY);
  if (!validHelpId(tid)) { tid = newHelpId(); lsSet(TID_KEY, tid); }
  const saved = (() => { try { return JSON.parse(lsGet(TID_KEY + '-who')) || {}; } catch { return {}; } })();
  el.innerHTML = `<section class="card chat" id="chat">
    <h2>Live help</h2>
    <p class="muted">Ask the event staff a question — no sign-in needed. Text only, and please don’t share passwords. An admin will reply here; this page checks for replies every 15–30 seconds.</p>
    <div class="chat-log" id="chat-log" aria-live="polite" aria-label="Conversation"><p class="empty">No messages yet.</p></div>
    <form id="chat-form" class="chat-form">
      <div class="row2">
        <label class="field"><span>Your name <i class="muted">(optional)</i></span><input id="chat-name" maxlength="60" autocomplete="name" value="${esc(saved.name || user?.name || '')}"></label>
        <label class="field"><span>Table number or team number / name <i class="muted">(if it applies)</i></span><input id="chat-contact" maxlength="80" value="${esc(saved.contact || '')}" placeholder="e.g. Table 3 or Team 1234"></label>
      </div>
      <label class="field"><span>Message</span><textarea id="chat-text" maxlength="${HELP_MAX}" rows="3" required placeholder="How can we help?"></textarea></label>
      <div class="chat-act"><button class="btn primary" id="chat-send" type="submit">Send</button><span class="muted" id="chat-err" role="alert"></span></div>
    </form></section>`;
  const $ = (q) => el.querySelector(q);
  const draw = async () => {
    const { msgs } = await store.helpFetch(tid);
    const log = $('#chat-log'); if (!log) return;
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
    log.innerHTML = msgs.length ? bubbles(msgs, 'user') : '<p class="empty">No messages yet.</p>';
    if (stick) log.scrollTop = log.scrollHeight;
  };
  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#chat-text').value.trim(); if (!text) return;
    const btn = $('#chat-send'); btn.disabled = true; $('#chat-err').textContent = '';
    try {
      const who = { name: $('#chat-name').value, contact: $('#chat-contact').value };
      lsSet(TID_KEY + '-who', JSON.stringify(who));
      await store.helpSend(tid, { ...who, text });
      $('#chat-text').value = '';
      await draw(); const log = $('#chat-log'); log.scrollTop = log.scrollHeight;
    } catch (er) { $('#chat-err').textContent = er.message || 'Could not send — try again.'; } finally { btn.disabled = false; }
  });
  return poll(draw);
}

function mountInbox(el, store) {
  el.innerHTML = `<section class="card chat" id="inbox"><h2>Give help</h2>
    <p class="where">Where: Help (this page). Messages from anyone — signed in or not — appear here. Only admins can reply.</p>
    <div class="inbox"><ul class="threads" id="in-list" aria-label="Conversations"></ul>
      <div class="thread" id="in-thread"><p class="empty">Pick a conversation.</p></div></div></section>`;
  const $ = (q) => el.querySelector(q);
  let threads = [], sel = null, msgs = [];
  const label = (t) => esc(t.name || 'Anonymous') + (t.contact ? ` · ${esc(t.contact)}` : '');
  const drawList = () => {
    $('#in-list').innerHTML = threads.map((t) => `<li><button type="button" class="th ${t.id === sel ? 'on' : ''} ${t.lastFrom === 'user' && !t.resolved ? 'new' : ''}" data-t="${esc(t.id)}">
      <b>${label(t)}</b><small>${t.resolved ? '✓ resolved' : t.lastFrom === 'user' ? '● needs reply' : 'replied'} · ${esc(when(t.lastAt))}</small><span class="muted">${esc(t.last || '')}</span></button></li>`).join('') || '<li class="empty">No messages yet.</li>';
  };
  const drawThread = () => {
    const t = threads.find((x) => x.id === sel);
    if (!t) { $('#in-thread').innerHTML = '<p class="empty">Pick a conversation.</p>'; return; }
    const keep = $('#in-text')?.value || '';
    const had = Boolean($('#in-text'));
    const log = $('#in-log'), stick = !log || log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
    if (!had || $('#in-thread').dataset.t !== t.id) {
      $('#in-thread').dataset.t = t.id;
      $('#in-thread').innerHTML = `<div class="th-head"><div><b>${esc(t.name || 'Anonymous')}</b><small class="block">${t.contact ? `Table / team: ${esc(t.contact)}` : 'No table or team given'} · ${t.email ? `Signed in as ${esc(t.email)}` : 'Not signed in'} · started ${esc(when(t.createdAt))}</small></div>
        <div class="acts"><button class="btn ghost small" id="in-res" type="button"></button><button class="btn ghost small danger" id="in-del" type="button">Delete</button></div></div>
        <div class="chat-log" id="in-log"></div>
        <form id="in-form" class="chat-form"><label class="field"><span>Reply</span><textarea id="in-text" maxlength="${HELP_MAX}" rows="2" required></textarea></label>
          <div class="chat-act"><button class="btn primary" type="submit">Send reply</button><span class="muted" id="in-err" role="alert"></span></div></form>`;
    }
    $('#in-res').textContent = t.resolved ? 'Reopen' : 'Mark resolved';
    $('#in-log').innerHTML = bubbles(msgs, 'admin');
    if (stick) $('#in-log').scrollTop = $('#in-log').scrollHeight;
    if (had) $('#in-text').value = keep;
  };
  const load = async () => {
    threads = await store.helpThreads();
    if (sel && !threads.some((t) => t.id === sel)) sel = null;
    drawList();
    if (sel) { msgs = (await store.helpFetch(sel)).msgs; }
    drawThread();
  };
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.t) { sel = b.dataset.t; msgs = (await store.helpFetch(sel)).msgs; $('#in-thread').dataset.t = ''; drawList(); drawThread(); }
      else if (b.id === 'in-res') { const t = threads.find((x) => x.id === sel); await store.helpResolve(sel, !t.resolved); await load(); }
      else if (b.id === 'in-del' && confirm('Delete this whole conversation?')) { await store.helpDelete(sel); sel = null; await load(); }
    } catch (er) { toast(er.message || 'Failed', 'err'); }
  });
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#in-text').value.trim(); if (!text || !sel) return;
    try { await store.helpReply(sel, text); $('#in-text').value = ''; await load(); const l = $('#in-log'); l.scrollTop = l.scrollHeight; } catch (er) { $('#in-err').textContent = er.message || 'Could not send.'; }
  });
  return poll(load);
}

export function helpView(root, ctx) {
  root.innerHTML = '<h1 class="page-title">Help</h1><div id="help-top"></div><div id="help-chat"></div><div id="help-inbox"></div>';
  let sig = null, stops = [];
  const draw = () => {
    const u = ctx.user();
    const nsig = `${u?.uid || ''}|${u?.role || ''}|${Boolean(u?.host)}|${coachTeamIds(u).join()}|${(u?.teams || []).length}|${ctx.scoringEvents().length}`;
    if (nsig === sig) return; // data refreshes must not wipe a message being typed
    sig = nsig; stops.forEach((f) => f()); stops = [];
    root.querySelector('#help-top').innerHTML = `
      ${u ? `<p class="muted help-you">Signed in as <b>${esc(u.name || u.email || '')}</b> · ${esc(ROLE_LABEL[u.role] || u.role)}${u.host && u.role !== 'host' ? ' · event host' : ''}${coachTeamIds(u).length && u.role !== 'coach' ? ' · coach' : ''}. This page only covers what you can do.</p>` : ''}
      <div class="help">${helpSections(u, ctx.scoringEvents()).join('')}</div>`;
    root.querySelector('#help-chat').innerHTML = ''; root.querySelector('#help-inbox').innerHTML = '';
    if (u?.role === 'admin') stops.push(mountInbox(root.querySelector('#help-inbox'), ctx.store));
    else stops.push(mountAsk(root.querySelector('#help-chat'), ctx.store, u));
  };
  draw();
  return { update: draw, destroy: () => stops.forEach((f) => f()) };
}
