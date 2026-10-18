# GlowBoard

Live score tracking for **FIRST® LEGO® League Challenge** events — currently loaded with the **BIOGLOW 2026-27** Robot Game.

* **Public dashboard** – anyone can see live standings, per-match scores and mission breakdowns. No login.
* **Closed system, Google sign-in only.** Everyone needs a Google account on the access list. **Admins** create events, add coaches (any number per team), judges and other admins by gmail, and give people the **host** modifier for specific events. **Host** and **referee** are *per-event modifiers* — a coach or team member can be the host or a referee of one event and stays a coach everywhere else. Hosts add teams, pick which teams compete, generate the **match schedule**, add referees and enter scores for their event. **Coaches** add their own team members/parents/anyone. Coaches and members submit **practice runs** (the same scoring form judges use, saved under the team) and see **team stats**: averages, success rates per mission and per task, most/least reliable missions, trends. Standings are per event.
* **Judge scoring page** – team dropdown (number + name), every mission with the exact scoresheet rules, counters, live total, review table, Gracious Professionalism®, digital team signature.
* Works on phones first (48 px touch targets, sticky live total, bottom nav) and scales up to desktop. Light/dark.
* **Runs with zero setup in demo mode** (data in `localStorage`, seeded with 8 fake teams). Add your Firebase config to go live.

Try it: `npm run serve` then open the printed URL. Demo mode simulates Google sign-in with one button per role (admin, judge, coach, team member).

## Go live with Firebase

1. Create a Firebase project → **Authentication → Sign-in method → Google: enable**.
2. **Firestore Database → create** (production mode), then paste `firestore.rules` into *Rules* (or `firebase deploy --only firestore:rules`).
3. Project settings → *Your apps* → Web app → copy the config into **`js/firebase-config.js`**. These values are public by design (every Firebase web app ships them); the Firestore rules are what protect the data.
4. Add your site's domain (e.g. `<you>.github.io`) to **Authentication → Settings → Authorized domains**.
5. Optional hardening: in Google Cloud Console → *APIs & Services → Credentials*, restrict the browser key to HTTP referrers `https://<you>.github.io/*` and `https://<project>.firebaseapp.com/*`, and set a billing budget alert.
6. **First admin** (one-time bootstrap, nobody can promote themselves): in Firestore create collection `access`, document ID = your **lowercase gmail**, string field `role` = `admin`. Sign in with Google → **Admin** → add an event, then **Hosts** on that event (they get access automatically), teams (number + name required), coaches (by gmail + team), judges, more admins. Hosts then use the **Event** page.

### Data model
| Collection | Who reads | Who writes |
|---|---|---|
| `access/{gmail}` `{role,teamId?,name?,host?,eventIds?,addedBy}` | self; admin; a coach reads their team's list; a host reads the referees they added | admin (anyone); coach adds/removes **members** of their team; a host adds referee-only accounts for their event |
| `events/{id}` `{name,date,live,teamIds?,schedule?}` | everyone | admin; a host of that event only `teamIds` + `schedule` |
| `eventHosts/{eventId}` `{emails:[…]}` | admin, the listed hosts | admin |
| `eventJudges/{eventId}` `{emails:[…]}` (event referees) | admin, that event's hosts, the listed referees | admin, that event's hosts |
| `teams/{t<number>}` `{number,name,createdBy}` | everyone | admin; hosts create (and edit/delete the ones they created); a coach may change only `name` |
| `scores/{eventId}_{teamId}_R{1-3}` | everyone | judge/admin/host-of-event **create once**; admin update/delete |
| `signatures/{same id}` | judge/host/admin only | judge/host/admin create; admin update/delete |
| `practice/{id}` `{teamId,uid,…}` | that team's coaches/members, admin | that team create; coach/owner delete |

## Troubleshooting sign-in
* **“… isn't on the access list”** – there is no Firestore document `access/<your lowercase gmail>`. The message shows the exact ID to use. First admin: collection `access`, Document ID = your gmail in lowercase, string field `role` = `admin`.
* **“Firestore blocked reading the access list”** – the rules aren't published yet. Paste `firestore.rules` into Firestore → Rules → Publish.
* **“domain isn't authorized”** – add `<you>.github.io` under Authentication → Settings → Authorized domains.

## Match schedule
Hosts (and admins) open **Event**, choose rounds, number of tables, first-match time, minutes per match and the break between rounds, then **Generate**. Every team plays every round, teams rotate tables, and with 3+ slots per round nobody plays back-to-back (`js/schedule.js`, property-tested). **Save** publishes it on the public **Schedule** page (with team search).

### Google Sheets export
Works today without setup: **Download CSV**, or **Copy for Google Sheets** and paste. For one-click *Send to Google Sheets* later: create a Sheet → Extensions → Apps Script, paste

```js
function doPost(e) {
  const { sheetName, rows } = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sh.clearContents();
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  return ContentService.createTextOutput('ok');
}
```
then Deploy → Web app (Execute as *me*, access *Anyone*) and put the `/exec` URL in `js/sheets-config.js`.

## Scoring (and where it comes from)
All rules live in **`js/missions.js`** (data) and **`js/scoring.js`** (pure engine), transcribed from the official 2026-27 scoresheet, Robot Game Rulebook and Challenge Updates (Oct 14 2026). Highlights implemented: equipment inspection (20), precision tokens table (0/10/15/25/35/50/50), per-mission bonuses that require their base condition, Mission 5 single-condition, Mission 7 bonuses (0-2, none without an opponent), Mission 15 single environmental bonus tied to the dock, Update 01 Lucky Leaves katydid rules, the **No Equipment Constraint** on M01/04/05/07/09/10/12/15, best-of-three ranking with 2nd/3rd best tie-breaks, GP (2/3/4) recorded but not added to the robot score.

> **Check on the physical field:** the rulebook doesn't state object counts, so `COUNTS` in `missions.js` uses what the artwork shows — 3 seeds (M02), 4 leaf fragments (M06), 4 seeds (M14: 3 pictured + the Research Platform seed). Edit them if your table differs. Max possible score is derived automatically (currently 530).
> If FIRST issues a new update, edit `missions.js` — the UI, max score, tests and rules adapt.

### Mission images
Mission photos (`assets/missions/mNN.png`) are cut from the official Robot Game Rulebook (© FIRST; used for scoring reference). `mNN.svg` placeholders remain as fallback; to swap art, replace the PNG. Ids listed in `OFFICIAL_IMAGES` in `js/missions.js` use the PNG.

## Tests
```
npm ci
npm test            # scoring + rules + firebase-mock + headless-browser UI
npm run test:scoring   # 284 mission states vs. an independent scoresheet oracle, standings/tie-breaks
npm run test:schedule  # schedule generator properties (every team every round, no double-booking, rest gaps)
npm run test:rules     # static review of firestore.rules (tests/rules-emulator.mjs = 26 checks in the real Firestore emulator, see file header)
npm run test:firebase  # real FirebaseStore code path against a faked SDK
npm run test:ui        # headless Chrome: 5 viewports (320→1280) × every page + full flows
SHOTS=1 npm run test:ui   # also writes screenshots to tests/shots/
```
Set `CHROME_PATH` if Chrome isn't auto-detected. CI runs all of it, then deploys to GitHub Pages.

*GlowBoard is unofficial. The FIRST® LEGO® League Robot Game Rulebook and Challenge Updates always take precedence.*
