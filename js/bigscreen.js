import { MATCHES_PER_TEAM } from './missions.js';
import { esc } from './ui.js';

// Full-screen projector scoreboard. `get()` returns { title, sub, rows } (rows = standings(), best first).
// Every team is always on screen: the grid has one equal-height row per team and the font is sized to fit.
export function openBigScreen(get, onClose = () => {}) {
  const el = document.createElement('div');
  el.className = 'bs'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Big screen scoreboard');
  el.innerHTML = `<header class="bs-head"><div><h1 id="bs-title"></h1><p id="bs-sub"></p></div><button type="button" class="bs-x" id="bs-x">✕ Exit</button></header><div class="bs-table" id="bs-table"></div>`;
  document.body.append(el);
  document.body.classList.add('bs-open');
  const table = el.querySelector('#bs-table');
  let closed = false;

  function fit() {
    const n = table.children.length || 1;
    const h = table.clientHeight / n, w = table.clientWidth;
    // the row height and the width both limit the text; names are clipped with … rather than wrapped
    table.style.fontSize = `${Math.max(8, Math.min(h * 0.52, w / 30, 80))}px`;
  }
  function render() {
    if (closed) return;
    const { title, sub, rows } = get();
    el.querySelector('#bs-title').textContent = title;
    el.querySelector('#bs-sub').textContent = sub;
    const head = `<div class="bs-r bs-h"><span>Rank</span><span>#</span><span>Team</span>${Array.from({ length: MATCHES_PER_TEAM }, (_, i) => `<span class="bs-n">Match ${i + 1}</span>`).join('')}<span class="bs-n">Best</span></div>`;
    table.style.gridTemplateRows = `repeat(${rows.length + 1}, minmax(0, 1fr))`;
    table.innerHTML = head + rows.map((r) => {
      const cells = Array.from({ length: MATCHES_PER_TEAM }, (_, i) => {
        const s = r.rounds[i + 1];
        return `<span class="bs-n ${s && s.total === r.best ? 'bs-top' : ''}">${s ? s.total : '–'}</span>`;
      }).join('');
      return `<div class="bs-r${r.rank && r.rank <= 3 ? ` m${r.rank}` : ''}"><span class="bs-rk">${r.rank ?? '–'}</span><span class="bs-tn">${esc(r.team.number)}</span><span class="bs-nm">${esc(r.team.name)}</span>${cells}<span class="bs-n bs-best">${r.best ?? '–'}</span></div>`;
    }).join('') || '<p class="bs-empty">No teams yet.</p>';
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
  // Go truly full screen where the browser allows it; the overlay already covers the page if it doesn't.
  Promise.resolve(el.requestFullscreen?.()).then(() => document.addEventListener('fullscreenchange', onFs)).catch(() => {});
  render();
  return { render, close };
}
