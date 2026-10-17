# GlowBoard

Live score tracking for **FIRST® LEGO® League Challenge** events — currently loaded with the **BIOGLOW 2026-27** Robot Game.

* **Public dashboard** – anyone can see live standings, per-match scores and mission breakdowns. No login.
* **Closed system, Google sign-in only** – an **admin** adds coaches (any number per team), judges and other admins by gmail; **coaches** add their own team members/parents/anyone; **judges** enter official scores; coaches and members do practice runs and team stats. Admins also create **events**; standings are per event.
* **Judge scoring page** – team dropdown (number + name), every mission with the exact scoresheet rules, counters, live total, review table, Gracious Professionalism®, digital team signature.
* Works on phones first (48 px touch targets, sticky live total, bottom nav) and scales up to desktop. Light/dark.
* **Runs with zero setup in demo mode** (data in `localStorage`, seeded with 8 fake teams). Add your Firebase config to go live.

Try it: `npm run serve` then open the printed URL. Demo mode simulates Google sign-in with one button per role (admin, judge, coach, team member).

## Go live with Firebase

1. Create a Firebase project → **Authentication → Sign-in method → Google: enable**.
2. **Firestore Database → create** (production mode), then paste `firestore.rules` into *Rules* (or `firebase deploy --only firestore:rules`).
3. Project settings → *Your apps* → Web app → copy the config. **Don't commit it.** Add it as a GitHub repo secret named `FIREBASE_CONFIG` (JSON: `apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId`); the deploy workflow injects it (`scripts/inject-config.mjs`). For local use paste it into `js/firebase-config.js` without committing.
4. Add your site's domain (e.g. `<you>.github.io`) to **Authentication → Settings → Authorized domains**.
5. In Google Cloud Console → *APIs & Services → Credentials*, restrict the browser API key to your site (HTTP referrers) and to the Identity Toolkit / Firestore APIs.
6. **First admin** (one-time bootstrap, nobody can promote themselves): in Firestore create collection `access`, document ID = your **lowercase gmail**, string field `role` = `admin`. Sign in with Google → **Admin** → add events, teams (number + name required), coaches (by gmail + team), judges, more admins.

### Data model
| Collection | Who reads | Who writes |
|---|---|---|
| `access/{gmail}` `{role,teamId?,name?,addedBy}` | self; admin; a coach reads their team's list | admin (anyone); coach adds/removes **members** of their team |
| `events/{id}` `{name,date,live,teamIds?}` | everyone | admin |
| `teams/{t<number>}` `{number,name}` | everyone | admin; a coach may change only `name` |
| `scores/{eventId}_{teamId}_R{1-3}` | everyone | judge/admin **create once**; admin update/delete |
| `signatures/{same id}` | judge/admin only | judge/admin create; admin update/delete |
| `practice/{id}` `{teamId,uid,…}` | that team's coaches/members, admin | that team create; coach/owner delete |

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
npm run test:rules     # static review of firestore.rules (tests/rules-emulator.mjs = optional real-emulator check, see file header)
npm run test:firebase  # real FirebaseStore code path against a faked SDK
npm run test:ui        # headless Chrome: 5 viewports (320→1280) × every page + full flows
SHOTS=1 npm run test:ui   # also writes screenshots to tests/shots/
```
Set `CHROME_PATH` if Chrome isn't auto-detected. CI runs all of it, then deploys to GitHub Pages.

*GlowBoard is unofficial. The FIRST® LEGO® League Robot Game Rulebook and Challenge Updates always take precedence.*
