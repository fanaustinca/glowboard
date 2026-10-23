import { MATCHES_PER_TEAM } from './missions.js';
import { esc, toggleTheme } from './ui.js';

// Full-screen projector scoreboard. `get()` returns { title, sub, boards: [{ label, future, rows }] } (rows = standings(), best first).
// One board fills the screen; an event running both editions shows them side by side (Founders left, Future right).
// Every team is always on screen: each board's grid has one equal-height row per team and the font is sized to fit.
export function openBigScreen(get, onClose = () => {}) {
  const el = document.createElement('div');
  el.className = 'bs'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Big screen scoreboard');
  el.innerHTML = `<header class="bs-head"><div><h1 id="bs-title"></h1><p id="bs-sub"></p></div><div class="bs-btns"><button type="button" class="bs-x" id="bs-theme" aria-label="Switch light or dark">◐ Light / Dark</button><button type="button" class="bs-x" id="bs-x">✕ Exit</button></div></header><div class="bs-body" id="bs-body"></div>`;
  document.body.append(el);
  document.body.classList.add('bs-open');
  const body = el.querySelector('#bs-body');
  let closed = false;

  function fit() {
    body.querySelectorAll('.bs-table').forEach((table) => {
      const n = table.children.length || 1;
      const h = table.clientHeight / n, w = table.clientWidth;
      // row height and width both limit the text; the columns are sized in em, so the name column gets what's left
      table.style.fontSize = `${Math.max(8, Math.min(h * 0.52, w / 37, 80))}px`;
    });
  }
  function board(b, split) {
    const head = `<div class="bs-r bs-h"><span>Rank</span><span>#</span><span>Team</span>${Array.from({ length: MATCHES_PER_TEAM }, (_, i) => `<span class="bs-n">Match ${i + 1}</span>`).join('')}<span class="bs-n">${b.future ? 'Avg' : 'Best'}</span></div>`;
    const rows = b.rows.map((r) => {
      const cells = Array.from({ length: MATCHES_PER_TEAM }, (_, i) => {
        const s = r.rounds[i + 1];
        return `<span class="bs-n ${!b.future && s && s.total === r.best ? 'bs-top' : ''}">${s ? s.total : '–'}</span>`;
      }).join('');
      return `<div class="bs-r${r.rank && r.rank <= 3 ? ` m${r.rank}` : ''}"><span class="bs-rk">${r.rank ?? '–'}</span><span class="bs-tn">${esc(r.team.number)}</span><span class="bs-nm">${esc(r.team.name)}</span>${cells}<span class="bs-n bs-best">${r.value ?? '–'}</span></div>`;
    }).join('');
    return `<section class="bs-board" data-ed="${esc(b.ed || '')}">${split ? `<h2 class="bs-label">${esc(b.label)}<small>${b.future ? 'ranked by average' : 'ranked by best match'}</small></h2>` : ''}
      ${b.rows.length ? `<div class="bs-table" style="grid-template-rows:repeat(${b.rows.length + 1},minmax(0,1fr))">${head}${rows}</div>` : '<div class="bs-table"><p class="bs-empty">No teams yet.</p></div>'}</section>`;
  }
  function render() {
    if (closed) return;
    const { title, sub, boards } = get();
    el.querySelector('#bs-title').textContent = title;
    el.querySelector('#bs-sub').textContent = sub;
    body.classList.toggle('split', boards.length > 1);
    body.innerHTML = boards.map((b) => board(b, boards.length > 1)).join('');
    fit();
  }
  function close() {
    if (closed) return; closed = true;
    window.removeEventListener('resize', fit); document.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs);
    document.body.classList.remove('bs-open'); el.remove();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    onClose();
  }
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const onFs = () => { if (!document.fullscreenElement) close(); }; // Esc in real fullscreen only fires this
  window.addEventListener('resize', fit); document.addEventListener('keydown', onKey);
  el.querySelector('#bs-x').addEventListener('click', close);
  el.querySelector('#bs-theme').addEventListener('click', toggleTheme);
  // Go truly full screen where the browser allows it; the overlay already covers the page if it doesn't.
  Promise.resolve(el.requestFullscreen?.()).then(() => document.addEventListener('fullscreenchange', onFs)).catch(() => {});
  render();
  return { render, close };
}
