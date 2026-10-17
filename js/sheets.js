// Export helpers for schedules (and anything else that is a table = array of rows).
import { SHEETS_WEBAPP_URL } from './sheets-config.js';
import { toCSV, toTSV } from './schedule.js';
import { download } from './ui.js';

export const sheetsConfigured = () => Boolean(SHEETS_WEBAPP_URL);

export const downloadCSV = (name, table) => download(name, toCSV(table));

export async function copyForSheets(table) {
  const text = toTSV(table);
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); return ok;
  }
}

// POSTs { sheetName, rows } to an Apps Script web app (see README). 'no-cors' → we can't read the reply, only that it left.
export async function sendToSheets(sheetName, table) {
  if (!sheetsConfigured()) throw Object.assign(new Error('Google Sheets isn’t connected yet — use “Copy for Google Sheets” or the CSV for now.'), { code: 'sheets-not-configured' });
  await fetch(SHEETS_WEBAPP_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ sheetName, rows: table }) });
}
