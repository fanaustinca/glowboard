// Google Sheets integration — OPTIONAL, add later.
// Until SHEETS_WEBAPP_URL is set, "Export" produces a CSV download and "Copy for Google Sheets" puts tab-separated
// rows on the clipboard (paste straight into a sheet). To enable one-click "Send to Google Sheets":
//   1. Create a Google Sheet → Extensions → Apps Script → paste the snippet from README → "Google Sheets export".
//   2. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone. Copy the /exec URL here.
export const SHEETS_WEBAPP_URL = '';
