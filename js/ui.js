export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, kind = 'info') {
  const host = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = `toast ${kind}`; t.textContent = msg; t.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  host.append(t);
  setTimeout(() => t.classList.add('out'), 3800);
  setTimeout(() => t.remove(), 4300);
}

export function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function modal(html, { title = '' } = {}) {
  const d = document.createElement('dialog');
  d.className = 'modal';
  d.innerHTML = `<div class="modal-in"><header><h2>${esc(title)}</h2><button class="btn ghost small" data-close aria-label="Close">✕</button></header><div class="modal-body">${html}</div></div>`;
  document.body.append(d);
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}

export function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
export function download(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Theme: light unless the person picked dark (remembered in this browser).
export function applyTheme() {
  let t = null; try { t = localStorage.getItem('gb-theme'); } catch { /* ignore */ }
  document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light';
}
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('gb-theme', next); } catch { /* ignore */ }
}
