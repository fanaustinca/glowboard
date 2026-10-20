// The scoring form, shared by the Judge page (official) and the Practice page (team).
import { TOKEN_POINTS, MAX_TOKENS, EQUIPMENT_INSPECTION_POINTS, GP_LEVELS, MATCHES_PER_TEAM, EDITIONS, EDITION_IDS, FUTURE_PENALTIES } from './missions.js';
import { defaultState, normalizeMission, normalizeState, scoreAll, maxScores, missionsOf, editionOf } from './scoring.js';
import { SigPad } from './sigpad.js';
import { slim, initials as makeInitials, eventTeams, eventEditions, teamEdition } from './store.js';
import { esc, toast } from './ui.js';

const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

function fieldHTML(m, f) {
  const base = `data-m="${m.id}" data-k="${f.key}"`;
  const note = f.note ? `<em class="note ${f.danger ? 'danger' : ''}">${esc(f.note)}</em>` : '';
  if (f.type === 'check') {
    const pts = f.pts ? `<span class="pts ${f.bonus ? 'bonus' : ''}">${f.bonus ? 'bonus ' : ''}${sign(f.pts)}</span>` : '';
    return `<button type="button" class="opt chk ${f.danger ? 'danger' : ''}" role="checkbox" aria-checked="false" ${base}>
      <span class="box" aria-hidden="true"></span><span class="lbl">${esc(f.label)}${note}</span>${pts}</button>`;
  }
  if (f.type === 'count') {
    return `<div class="opt cnt" ${base}>
      <span class="lbl">${esc(f.label)}<em class="note">${f.each} pts each · max <b data-role="max">${f.max}</b></em></span>
      ${f.slider ? `<span class="slidr"><input type="range" min="0" max="${f.max}" value="0" data-act="range" aria-label="${esc(f.label)}"><input type="number" inputmode="numeric" min="0" max="${f.max}" value="0" data-act="num" aria-label="${esc(f.label)} (type a number)"></span>` : ''}
      <span class="stepper"><button type="button" data-act="dec" aria-label="Fewer: ${esc(f.label)}">−</button><output aria-live="polite">0</output><button type="button" data-act="inc" aria-label="More: ${esc(f.label)}">+</button></span></div>`;
  }
  const opts = f.options.map((o, i) => `<button type="button" role="radio" aria-checked="false" data-i="${i}">${esc(o.label)}${o.pts ? `<small>${sign(o.pts)}</small>` : ''}</button>`).join('');
  return `<div class="opt segf" ${base}><span class="lbl">${esc(f.label)}</span><div class="seg" role="radiogroup" aria-label="${esc(f.label)}">${opts}</div></div>`;
}

function missionHTML(m) {
  const eq = m.noEquipment ? `<button type="button" class="eqflag" role="checkbox" aria-checked="false" data-m="${m.id}" data-k="eq" title="No Equipment Constraint: a mission model cannot earn points if it is touching equipment at the end of the match.">
      <span class="ico" aria-hidden="true">🚫</span><span>Model touching equipment at end <small>→ 0 pts</small></span></button>` : '';
  return `<section class="mission card" id="mission-${m.id}" data-mission="${m.id}" aria-labelledby="mh-${m.id}">
    <header>
      <img class="mimg" src="${m.image}" alt="Mission ${m.num} reference image" loading="lazy" width="320" height="220" data-fallback="${m.placeholder}">
      <div class="mtitle"><span class="mnum">M${String(m.num).padStart(2, '0')}</span><h3 id="mh-${m.id}">${esc(m.name)}</h3>
        <span class="mscore" data-role="mscore" aria-live="polite">0 / 0</span></div>
    </header>
    <div class="fields">${m.fields.map((f) => fieldHTML(m, f)).join('')}${eq}</div>
    ${m.notes.length ? `<details class="mnotes"><summary>Rule notes</summary><ul>${m.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

export function mountScorer(root, { mode, store, teams, scores, events = () => [], user, lockedTeamId = null, editRun = null, onDone = () => {} }) {
  const official = mode === 'official';
  const tool = mode === 'tool'; // calculator only: nothing is saved anywhere
  const DRAFT = `gb-draft-${mode}`;
  // Scoring edition: Founders (standard, the default) or Future. Each edition keeps its own form while you flip between them.
  let edition = 'founders';
  let state = defaultState(edition);
  const stash = {};
  let teamId = lockedTeamId || '';
  let eventId = '';
  let round = 1;
  let table = '';
  let busy = false;
  const MS = () => missionsOf(edition);
  const future = () => edition === 'future';

  if (editRun) { edition = editionOf(editRun); state = normalizeState(editRun.state, edition); }
  else {
    if (lockedTeamId) { const t = teams().find((x) => x.id === lockedTeamId); if (t) { edition = teamEdition(t); state = defaultState(edition); } }
    if (!tool) try {
      const d = JSON.parse(localStorage.getItem(DRAFT) || 'null');
      if (d) { edition = editionOf(d.edition); state = normalizeState(d.state, edition); if (!lockedTeamId) teamId = d.teamId || ''; eventId = d.eventId || ''; round = d.round || 1; table = d.table || ''; }
    } catch { /* ignore corrupt draft */ }
  }

  const curEvent = () => events().find((e) => e.id === eventId);
  const defaultEvent = () => (events().find((e) => e.live) || events().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || {}).id || '';
  const eventOptions = () => events().slice().sort((a, b) => (b.live - a.live) || (b.createdAt || 0) - (a.createdAt || 0))
    .map((e) => `<option value="${esc(e.id)}">${esc(e.name)}${e.live ? ' (live)' : ''}</option>`).join('');
  const teamOptions = () => eventTeams(curEvent(), teams()).filter((t) => teamEdition(t) === edition).slice().sort((a, b) => a.number - b.number)
    .map((t) => `<option value="${esc(t.id)}">${t.number} — ${esc(t.name)}</option>`).join('');

  const edButtons = () => EDITION_IDS.map((id) => `<button type="button" role="radio" aria-checked="false" data-ed="${id}">${EDITIONS[id].long}</button>`).join('');

  // The part of the form that depends on the edition: total bar, edition-only sections, missions, final review.
  const dynHTML = () => {
    const max = maxScores(edition);
    const rules = future() ? `<details class="card rules-ref"><summary>Scoring rules reminder (Future Edition Rulebook, Scoring &amp; Penalties)</summary><ul>
      <li><b>Scoring:</b> scores are based on the final visible conditions on your team’s side of the shared field when time ends. Lines and the airspace above an area count as “in” it.</li>
      <li><b>Interference penalties (rule 21):</b> 1st = −10 points, 2nd = −20 more (−30 in total), 3rd = the match score is zero.</li>
      <li><b>Rule 20:</b> points an interfering team gains from it do not count; points the other team lost are restored.</li>
      <li><b>Central Haven</b> is cooperative: tokens in it score for both teams, whoever delivered them.</li>
      <li>The referee and team agree the result; the head referee decides disputes. Unclear? The team gets the benefit of the doubt.</li>
      <li><b>Ranking:</b> the <i>average</i> of a team’s official matches decides its rank.</li></ul></details>`
      : `<details class="card rules-ref"><summary>Scoring rules reminder (Robot Game Rulebook, rules 15–25)</summary><ul>
      <li><b>Rule 22–23:</b> requirements must be <i>visibly met at the end of the match</i> (2.5 min, rule 21). Lines and airspace above an area count as “in” it.</li>
      <li><b>Rule 15:</b> if the robot or anything it touches is even partly outside home when interrupted, the team loses one precision token. Stopping the robot in place when not launching again is free.</li>
      <li><b>Rules 16, 18, 19:</b> points earned by interrupting the robot to score, by separating Dual Lock / breaking a model, or via a combination that can’t be freed in one motion do not count.</li>
      <li><b>Rule 20:</b> points lost to interference from the opposing team score automatically for the other team.</li>
      <li><b>No Equipment Constraint (🚫):</b> a model can’t score in that mission if it touches equipment at the end.</li>
      <li><b>Rule 25:</b> referee and team agree the result; the head referee decides disputes. Only a team’s best official match counts; ties use the 2nd then 3rd best score.</li>
      <li>Updates supersede the rulebook (e.g. Update 01 for Lucky Leaves, Oct 14 2026 updates for docks and the taped tree).</li></ul></details>`;
    const pre = future() ? `
    <section class="card pre">
      <h2>Penalties</h2>
      <div class="opt segf tokens"><span class="lbl">Interference penalties received<em class="note">1st = −10 · 2nd = −30 in total · 3rd = match score zero</em></span>
        <div class="seg" role="radiogroup" aria-label="Interference penalties" id="sc-pen">
          ${FUTURE_PENALTIES.map((p) => `<button type="button" role="radio" aria-checked="false" data-i="${p.v}">${p.label}<small>${p.pts === null ? 'zero' : sign(p.pts)}</small></button>`).join('')}
        </div></div>
    </section>` : `
    <section class="card pre">
      <h2>Before &amp; during the match</h2>
      <button type="button" class="opt chk" role="checkbox" aria-checked="false" id="sc-equip"><span class="box" aria-hidden="true"></span>
        <span class="lbl">Equipment inspection<em class="note">Robot and all equipment fit completely in one launch area and under the 12 in. (305 mm) height limit</em></span><span class="pts">+${EQUIPMENT_INSPECTION_POINTS}</span></button>
      <div class="opt segf tokens"><span class="lbl">Precision tokens remaining<em class="note">Start with ${MAX_TOKENS}; the referee removes one each time the robot is interrupted outside home</em></span>
        <div class="seg" role="radiogroup" aria-label="Precision tokens remaining" id="sc-tokens">
          ${TOKEN_POINTS.map((p, i) => `<button type="button" role="radio" aria-checked="false" data-i="${i}">${i}<small>${sign(p)}</small></button>`).join('')}
        </div></div>
    </section>`;
    return `
    <div class="totalbar" role="status" aria-label="Running total"><div><span class="tl">Total</span><b id="sc-total" class="tv">0</b><span class="tmax">/ ${max.total}</span></div>
      <div class="tbar"><i id="sc-bar"></i></div></div>
    ${pre}
    ${rules}
    <div class="missions">${MS().map(missionHTML).join('')}</div>

    <section class="card review" aria-labelledby="rv-h">
      <h2 id="rv-h">Final score review</h2>
      <table class="rv-table"><thead><tr><th>Item</th><th class="num">Points</th></tr></thead><tbody id="rv-body"></tbody>
        <tfoot><tr><th>Final score</th><th class="num" id="rv-total">0</th></tr></tfoot></table>
      <div class="opt segf gp"><span class="lbl">Gracious Professionalism® at the table<em class="note">Recorded for judging (Core Values) — not part of the Robot Game score. Default is Accomplished.</em></span>
        <div class="seg" role="radiogroup" aria-label="Gracious Professionalism" id="sc-gp">
          ${Object.entries(GP_LEVELS).map(([v, l]) => `<button type="button" role="radio" aria-checked="false" data-v="${v}">${l}<small>${v}</small></button>`).join('')}
        </div></div>
    </section>`;
  };

  root.innerHTML = `
  <div class="scorer ${official ? 'official' : tool ? 'practice tool' : 'practice'}">
    <section class="card setup">
      <h2>${official ? 'Match details' : tool ? 'Scoring tool' : 'Practice run'}</h2>
      <div class="edsel"><span class="lbl">Scoring edition</span><div class="seg" role="radiogroup" aria-label="Scoring edition" id="sc-ed" ${editRun ? 'hidden' : ''}>${edButtons()}</div></div>
      <div class="grid-setup">
        ${official ? `
        <label class="field"><span>Event</span><select id="sc-event" required>${eventOptions()}</select></label>
        <label class="field"><span>Team</span><select id="sc-team" required><option value="">Select a team…</option>${teamOptions()}</select></label>
        <label class="field"><span>Match</span><select id="sc-round">${Array.from({ length: MATCHES_PER_TEAM }, (_, i) => `<option value="${i + 1}">Official match ${i + 1}</option>`).join('')}</select></label>
        <label class="field"><span>Table</span><input id="sc-table" inputmode="text" maxlength="12" placeholder="e.g. 3" autocomplete="off"></label>` : `
        ${tool ? '<p class="muted">Add up a score with the official rules. Nothing is saved — it clears when you leave or refresh.</p>' : `<p class="muted">Score a practice run with the official rules.</p>
        <label class="field"><span>Note <small>(optional — what were you testing?)</small></span><input id="sc-note" maxlength="80" autocomplete="off" placeholder="e.g. new attachment for M05" value="${esc(editRun?.note || '')}"></label>`}`}
      </div>
      <div id="sc-status" class="status" hidden></div>
    </section>

    <div id="sc-dyn"></div>

    ${official ? `
    <section class="card sign" aria-labelledby="sg-h">
      <h2 id="sg-h">Team signature</h2>
      <p class="muted">Team and referee sign to confirm the score.</p>
      <label class="field"><span>Team initials</span><input id="sc-initials" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="e.g. RR"></label>
      <div class="field"><span>Sign below</span>
        <div class="sigwrap"><canvas id="sc-sig" aria-label="Team signature pad. Draw with a finger, stylus or mouse."></canvas><span class="sighint" id="sc-sighint">Sign here</span></div>
        <button type="button" class="btn ghost small" id="sc-sigclear">Clear signature</button></div>
      <label class="agree"><input type="checkbox" id="sc-agree"><span>The team and referee agree this score is correct.</span></label>
    </section>` : ''}

    <div class="actions">
      <div id="sc-error" class="error" role="alert" hidden></div>
      ${tool ? '' : `<button type="button" class="btn primary big" id="sc-submit">${official ? 'Submit official score' : editRun ? 'Save changes' : 'Save practice run'}</button>`}
      ${editRun ? '<button type="button" class="btn ghost" id="sc-cancel">Cancel</button>' : `<button type="button" class="btn ${tool ? 'primary big' : 'ghost'}" id="sc-reset">${tool ? 'Start over' : 'Reset form'}</button>`}
    </div>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const pad = official ? new SigPad($('#sc-sig'), () => { $('#sc-sighint').hidden = !pad.isEmpty; }) : null;
  const bindImages = () => root.querySelectorAll('img.mimg').forEach((img) => img.addEventListener('error', () => { img.src = img.dataset.fallback; }, { once: true }));

  // ---------- state helpers ----------
  const fieldDef = (mid, k) => MS().find((m) => m.id === mid).fields.find((f) => f.key === k);
  function mutate(fn) { fn(state); sync(); saveDraft(); }
  function saveDraft() { if (editRun || tool) return; try { localStorage.setItem(DRAFT, JSON.stringify({ state, edition, teamId, eventId, round, table })); } catch { /* ignore */ } }

  // ---------- render sync ----------
  function sync() {
    // Clear dependents whose base condition was removed (e.g. un-tick drone → bonus clears).
    for (const m of MS()) state.m[m.id] = normalizeMission(m, state.m[m.id], state.m);
    const res = scoreAll(state, edition);
    const max = maxScores(edition);

    $('#sc-ed').querySelectorAll('button').forEach((b) => { b.setAttribute('aria-checked', String(b.dataset.ed === edition)); b.disabled = official && !eventEditions(curEvent()).includes(b.dataset.ed); });
    if (future()) $('#sc-pen').querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.i === state.penalties)));
    else {
      $('#sc-equip').setAttribute('aria-checked', String(state.equip));
      $('#sc-tokens').querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.i === state.tokens)));
    }
    $('#sc-gp').querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.v === state.gp)));

    for (const m of MS()) {
      const card = root.querySelector(`#mission-${m.id}`);
      const ms = state.m[m.id];
      const r = res.missions.find((x) => x.id === m.id);
      const voided = !!r.voided;
      card.classList.toggle('scored', r.points > 0);
      card.classList.toggle('voided', voided);
      card.querySelector('[data-role=mscore]').textContent = `${r.points} / ${max.perMission[m.id]}`;
      for (const f of m.fields) {
        const el = card.querySelector(`[data-k="${f.key}"]`);
        const locked = f.requires ? !f.requires(ms) : false;
        el.classList.toggle('locked', locked);
        el.querySelectorAll('button').forEach((b) => { b.disabled = locked; });
        if (f.type === 'check') el.setAttribute('aria-checked', String(ms[f.key]));
        else if (f.type === 'count') {
          let cap = f.maxFn ? Math.min(f.max, f.maxFn(ms)) : f.max;
          if (f.poolFn) cap = Math.max(0, Math.min(cap, f.poolFn(state.m)));
          el.querySelector('output').textContent = ms[f.key];
          const rg = el.querySelector('[data-act=range]'), nm = el.querySelector('[data-act=num]');
          if (rg) { rg.value = ms[f.key]; rg.max = cap; rg.disabled = locked; }
          if (nm && document.activeElement !== nm) nm.value = ms[f.key];
          if (nm) { nm.max = cap; nm.disabled = locked; }
          el.querySelector('[data-role=max]').textContent = cap;
          el.querySelector('[data-act=dec]').disabled = locked || ms[f.key] <= 0;
          el.querySelector('[data-act=inc]').disabled = locked || ms[f.key] >= cap;
        } else el.querySelectorAll('[role=radio]').forEach((b) => b.setAttribute('aria-checked', String(f.options[+b.dataset.i].v === ms[f.key])));
      }
      const eq = card.querySelector('[data-k=eq]');
      if (eq) eq.setAttribute('aria-checked', String(ms.eq));
    }

    $('#sc-total').textContent = res.total;
    $('#sc-bar').style.width = `${Math.min(100, (res.total / max.total) * 100)}%`;
    $('#rv-total').textContent = res.total;
    const rows = [
      ...(future()
        ? (res.penalties ? [[`Interference penalties (${res.penalties}${res.penalties >= 3 ? '+' : ''})`, res.zeroed ? `−${res.subtotal}` : res.penaltyPoints, res.zeroed ? 'third penalty — match score is zero' : '']] : [])
        : [['Equipment inspection', res.equipment, state.equip ? '' : 'not met'], [`Precision tokens (${state.tokens} left)`, res.tokens, '']]),
      ...res.missions.map((r) => [`M${String(r.num).padStart(2, '0')} ${r.name}`, r.points, r.voided ? `voided — ${r.voided.toLowerCase()}` : r.lines.map((l) => `${l.label} (${sign(l.pts)})`).join('; ')]),
    ];
    $('#rv-body').innerHTML = rows.map(([a, p, d]) => `<tr class="${p ? 'has' : ''}"><td>${esc(a)}${d ? `<small>${esc(d)}</small>` : ''}</td><td class="num">${p}</td></tr>`).join('');
    updateStatus();
  }

  // Table comes from the event's saved match schedule for this team + round (still editable by the referee).
  function scheduledTable() {
    const row = (curEvent()?.schedule?.rows || []).find((r) => r.teamId === teamId && r.round === round);
    return row ? String(row.table) : '';
  }
  function autoTable() {
    if (!official || !teamId) return;
    const t = scheduledTable(); if (!t) return;
    table = t; $('#sc-table').value = t; saveDraft();
  }
  function scoredRounds(id) { return new Set(scores().filter((s) => s.teamId === id && s.eventId === eventId).map((s) => s.round)); }
  function updateStatus() {
    if (!official) return;
    const sel = $('#sc-round');
    const done = teamId ? scoredRounds(teamId) : new Set();
    [...sel.options].forEach((o) => {
      const r = +o.value;
      o.textContent = `Official match ${r}${done.has(r) ? (user().role === 'admin' ? ' — scored (overwrite)' : ' — already scored') : ''}`;
      o.disabled = done.has(r) && user().role !== 'admin';
    });
    if (sel.selectedOptions[0]?.disabled) {
      const free = [...sel.options].find((o) => !o.disabled);
      if (free) { round = +free.value; sel.value = free.value; }
    }
    const st = $('#sc-status');
    if (teamId && done.size >= MATCHES_PER_TEAM && user().role !== 'admin') {
      st.hidden = false; st.className = 'status warn'; st.textContent = 'All three official matches are already scored for this team. A host or admin can delete it so it can be scored again.';
    } else if (teamId && done.has(round)) {
      st.hidden = false; st.className = 'status warn'; st.textContent = 'This match already has an official score — submitting will overwrite it (admin only).';
    } else { st.hidden = true; }
  }

  // ---------- edition ----------
  function draw() { $('#sc-dyn').innerHTML = dynHTML(); bindImages(); sync(); }
  function switchTo(ed) { stash[edition] = state; edition = ed; state = stash[ed] || defaultState(ed); }
  function refillTeams() {
    teamId = ''; table = '';
    if (!official) return;
    $('#sc-team').innerHTML = `<option value="">Select a team…</option>${teamOptions()}`; $('#sc-table').value = '';
  }
  function setEdition(ed) {
    ed = editionOf(ed); if (ed === edition) return;
    if (official && !eventEditions(curEvent()).includes(ed)) return; // the event doesn't run that edition
    switchTo(ed); refillTeams(); draw(); saveDraft();
  }
  // An event only offers the editions it runs: move to one of them if the current one isn't.
  function ensureEdition() {
    if (!official) return;
    const eds = eventEditions(curEvent());
    if (!eds.includes(edition)) { switchTo(eds[0]); refillTeams(); draw(); }
  }

  // ---------- events ----------
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.matches || !t.matches('input[data-act=range], input[data-act=num]')) return;
    const host = t.closest('[data-m][data-k]');
    const v = Math.max(0, Math.floor(+t.value) || 0);
    mutate((s) => { s.m[host.dataset.m][host.dataset.k] = v; });
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.closest('#sc-ed')) return setEdition(b.dataset.ed);
    if (b.closest('#sc-pen')) return mutate((s) => { s.penalties = +b.dataset.i; });
    if (b.id === 'sc-equip') return mutate((s) => { s.equip = !s.equip; });
    if (b.closest('#sc-tokens')) return mutate((s) => { s.tokens = +b.dataset.i; });
    if (b.closest('#sc-gp')) return mutate((s) => { s.gp = +b.dataset.v; });
    const host = b.closest('[data-m][data-k]');
    if (!host) return;
    const { m: mid, k } = host.dataset;
    if (k === 'eq') return mutate((s) => { s.m[mid].eq = !s.m[mid].eq; });
    const f = fieldDef(mid, k);
    if (f.type === 'check') mutate((s) => { s.m[mid][k] = !s.m[mid][k]; });
    else if (f.type === 'count') mutate((s) => { s.m[mid][k] += b.dataset.act === 'inc' ? 1 : -1; });
    else if (f.type === 'seg') mutate((s) => { s.m[mid][k] = f.options[+b.dataset.i].v; });
  });
  if (official) {
    if (!events().some((e) => e.id === eventId)) eventId = defaultEvent();
    $('#sc-event').value = eventId;
    if (!eventEditions(curEvent()).includes(edition)) switchTo(eventEditions(curEvent())[0]);
    $('#sc-team').innerHTML = `<option value="">Select a team…</option>${teamOptions()}`;
    if (!teamOptions().includes(`value="${teamId}"`)) teamId = '';
    $('#sc-event').addEventListener('change', (e) => { eventId = e.target.value; refillTeams(); ensureEdition(); saveDraft(); updateStatus(); sync(); });
    $('#sc-team').value = teamId; $('#sc-round').value = String(round); $('#sc-table').value = table;
    $('#sc-team').addEventListener('change', (e) => { teamId = e.target.value;
      const free = [1, 2, 3].find((r) => !scoredRounds(teamId).has(r));
      if (free) { round = free; $('#sc-round').value = String(free); }
      autoTable(); saveDraft(); updateStatus(); });
    $('#sc-round').addEventListener('change', (e) => { round = +e.target.value; autoTable(); saveDraft(); updateStatus(); });
    $('#sc-table').addEventListener('input', (e) => { table = e.target.value; saveDraft(); });
    $('#sc-sigclear').addEventListener('click', () => pad.clear());
    const onResize = () => pad.resize();
    window.addEventListener('resize', onResize);
    requestAnimationFrame(() => pad.resize());
    root._cleanup = () => window.removeEventListener('resize', onResize);
  }

  function showError(msg) { const el = $('#sc-error'); el.hidden = !msg; el.textContent = msg || ''; if (msg) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }

  function reset(keepTeam) {
    for (const k of Object.keys(stash)) delete stash[k];
    state = defaultState(edition);
    if (!keepTeam) teamId = lockedTeamId || '';
    if (official) {
      if (!keepTeam) $('#sc-team').value = '';
      $('#sc-initials').value = ''; $('#sc-agree').checked = false; pad.clear();
    }
    saveDraft(); sync(); showError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $('#sc-cancel')?.addEventListener('click', () => onDone());
  $('#sc-reset')?.addEventListener('click', () => { if (confirm('Clear everything entered so far?')) reset(true); });

  $('#sc-submit')?.addEventListener('click', async () => {
    if (busy) return;
    showError('');
    const res = scoreAll(state, edition);
    const u = user();
    const team = teams().find((t) => t.id === teamId);
    if (official) {
      if (!u || !['judge', 'admin', 'host'].includes(u.role)) return showError('Only judges, event hosts and admins can submit official scores.');
      if (!curEvent()) return showError('Choose an event first.');
      if (!team) return showError('Choose a team first.');
      if (!eventEditions(curEvent()).includes(edition) || teamEdition(team) !== edition) return showError(`Team #${team.number} plays the ${EDITIONS[teamEdition(team)].long} edition — switch the scoring edition above.`);
      if (scoredRounds(teamId).has(round) && u.role !== 'admin') return showError('That match already has an official score.');
      const ini = $('#sc-initials').value.trim();
      if (!ini) return showError('Enter the team initials.');
      if (pad.isEmpty) return showError('The team must sign before the score can be submitted.');
      if (!$('#sc-agree').checked) return showError('Confirm that the team and referee agree on the score.');
    } else if (!u) return showError('Sign in to save practice runs.');
    busy = true; $('#sc-submit').disabled = true;
    try {
      if (official) {
        await store.submitScore({
          eventId, eventName: curEvent().name, teamId: team.id, number: team.number, name: team.name, round, total: res.total, gp: res.gp, edition,
          state: res.state, result: slim(res), initials: $('#sc-initials').value.trim().toUpperCase() || makeInitials(team.name),
          judgeUid: u.uid, judgeName: u.name, table: table.trim(), createdAt: Date.now(),
        }, pad.toDataURL());
        toast(`Submitted: ${team.name} — match ${round} — ${res.total} pts`, 'ok');
        round = 1; $('#sc-round').value = '1'; table = ''; $('#sc-table').value = '';
        reset(false);
      } else if (editRun) {
        const { id, ...rest } = editRun;
        await store.put('practice', id, { ...rest, note: ($('#sc-note')?.value || '').trim(), total: res.total, gp: res.gp, edition, state: res.state, result: slim(res), editedAt: Date.now(), editedBy: u.name });
        toast(`Practice run updated: ${res.total} pts`, 'ok');
        onDone();
      } else {
        const id = store.newId('p');
        await store.put('practice', id, {
          uid: u.uid, by: u.name, teamId: u.teamId, note: ($('#sc-note')?.value || '').trim(), total: res.total, gp: res.gp, edition, state: res.state, result: slim(res), createdAt: Date.now(),
        });
        toast(`Practice run saved: ${res.total} pts`, 'ok');
        if ($('#sc-note')) $('#sc-note').value = '';
        reset(true);
        onDone();
      }
    } catch (e) { showError(e.message || 'Could not save.'); } finally { busy = false; $('#sc-submit').disabled = false; }
  });

  draw();
  return {
    refresh() { // teams/scores changed live
      if (official) {
        const ev = $('#sc-event'); ev.innerHTML = eventOptions(); if (!events().some((e) => e.id === eventId)) eventId = defaultEvent(); ev.value = eventId;
        const sel = $('#sc-team'); const cur = sel.value; sel.innerHTML = `<option value="">Select a team…</option>${teamOptions()}`; sel.value = cur || teamId;
      }
      updateStatus();
      if (teamId && !table.trim()) autoTable(); // schedule may have been published after the team was picked
    },
    destroy() { root._cleanup?.(); },
  };
}
