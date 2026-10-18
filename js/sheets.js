// Export helpers for schedules (and anything else that is a table = array of rows).
import { toCSV, toTSV } from './schedule.js';
import { download } from './ui.js';

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
