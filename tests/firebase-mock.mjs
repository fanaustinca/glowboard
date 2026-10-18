// Exercises the real FirebaseStore code path (js/store.js) against a faked Firebase SDK:
// Google sign-in, access-list lookup, public reads, batch score+signature write, coach/admin people management.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { serve } from '../scripts/serve.mjs';

const CHROME = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'].find((p) => p && existsSync(p));
const fake = readFileSync(new URL('./fixtures/fake-firebase.js', import.meta.url), 'utf8');
const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const cx = await browser.createBrowserContext();
const page = await cx.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await page.setRequestInterception(true);
page.on('request', (r) => {
  const u = r.url();
  if (u.startsWith('https://www.gstatic.com/firebasejs/')) return r.respond({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fake });
  if (u.endsWith('/js/firebase-config.js')) return r.respond({ status: 200, contentType: 'text/javascript', body: `export const firebaseConfig={apiKey:'real-key',authDomain:'x.firebaseapp.com',projectId:'demo-proj',storageBucket:'x',messagingSenderId:'1',appId:'1'};export const EMAIL_DOMAIN='myapp.com';export const FIREBASE_SDK_VERSION='10.12.2';export const isConfigured=()=>true;` });
  r.continue();
});
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const tap = (pg, sel) => pg.$eval(sel, (e) => { e.scrollIntoView({ block: 'center' }); e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); }); // the phone tab bar is fixed at the bottom and can sit over an element's centre
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = async (h) => { await page.evaluate((x) => { location.hash = '#/' + x; }, h); await w(250); if (h === 'team') { await page.evaluate(() => document.getElementById('td-manage')?.click()); await w(100); } }; // coaches land on the Manage tab of the Teams page for these tests
const tab = async (t) => { await page.evaluate((x) => document.getElementById('td-' + x)?.click(), t); await w(150); };
const fbState = () => page.evaluate(() => ({ docs: globalThis.__fb.docs, log: globalThis.__fb.log }));

console.log('firebase (mocked SDK)');
const google = (uid, email) => page.evaluate((g) => { globalThis.__fb.google = g; }, uid ? { uid, email } : null);
const nav = () => page.$$eval('#nav a .nl', (a) => a.map((x) => x.textContent));
const signIn = async (uid, email) => { await hash('login'); await google(uid, email); await tap(page, '#lg-google'); await w(600); };
const signOut = async () => { await tap(page, '#signout'); await w(400); };
const draw = async () => {
  await page.evaluate(() => document.getElementById('sc-sig').scrollIntoView({ block: 'center' }));
  const b = await (await page.$('#sc-sig')).boundingBox();
  await page.mouse.move(b.x + 20, b.y + 40); await page.mouse.down(); for (let i = 0; i < 8; i++) await page.mouse.move(b.x + 20 + i * 20, b.y + 40 + i * 5); await page.mouse.up();
};
await page.goto(base, { waitUntil: 'networkidle0' });
await page.waitForSelector('.standings .row', { timeout: 5000 }).catch(async (e) => { console.log('ERRORS', errors, await page.$eval('main', (m) => m.textContent.slice(0, 300))); throw e; });
assert.equal(await page.$eval('#modebar', (e) => getComputedStyle(e).display), 'none'); ok('configured → no demo banner; public standings render from Firestore without login');
assert.equal((await page.$$('.standings .row')).length, 2);
await hash('login');
assert.equal(await page.$('#lg-u'), null, 'no username/password form'); assert.equal(await page.$('#lg-p'), null); assert.ok(await page.$('#lg-google'));
ok('login page offers Google sign-in only (no username/password)');

// stranger: authenticates with Google but is not on the access list → rejected and signed back out
await google('uid-ghost', 'Ghost@Gmail.com'); await tap(page, '#lg-google'); await w(600);
assert.match(await page.$eval('#lg-err', (e) => e.textContent), /ghost@gmail\.com isn’t on the access list/);
assert.deepEqual(await nav(), ['Standings', 'Schedule']); assert.equal(await page.$eval('#signout', (e) => getComputedStyle(e).display), 'none'); ok('a Google account that is not on the access list is rejected (and gets no privileges)');
assert.ok((await fbState()).log.some((l) => l[0] === 'googlePopup' && l[1] === true)); ok('uses the Google provider popup');
assert.match(await page.$eval('#lg-err', (e) => e.textContent), /Document ID exactly “ghost@gmail\.com”/); ok('the not-listed message tells the first admin the exact Firestore document ID to create (lowercased)');
// rules not published → Firestore refuses the lookup: say THAT, not "not on the list"
await page.evaluate(() => { globalThis.__fb.blockAccessReads = true; });
await google('uid-boss', 'boss@gmail.com'); await tap(page, '#lg-google'); await w(600);
assert.match(await page.$eval('#lg-err', (e) => e.textContent), /Firestore blocked reading the access list[\s\S]*Publish the latest firestore\.rules/); assert.ok(!/isn’t on the access list/.test(await page.$eval('#lg-err', (e) => e.textContent)));
await page.evaluate(() => { globalThis.__fb.blockAccessReads = false; });
ok('a blocked lookup (rules not published) is reported as such, with the fix — not as “not registered”');

// ---- team-password sign-in (members only; elevated roles stay Google-only) ----
await hash('login');
assert.ok(await page.$('#tl')); ok('the login page offers a team-password form next to Google sign-in');
const joinTeam = async (num, pw, name = '') => {
  for (const [sel, v] of [['#tl-num', num], ['#tl-pw', pw], ['#tl-name', name]]) { await page.$eval(sel, (e) => { e.value = ''; }); if (v) await page.type(sel, v); }
  await tap(page, '#tl button'); await w(600);
};
await page.evaluate(() => { globalThis.__fb.anonDisabled = true; });
await joinTeam('1', '123456'); assert.match(await page.$eval('#lg-err', (e) => e.textContent), /Anonymous/); assert.doesNotMatch(await page.$eval('#lg-err', (e) => e.textContent), /admin-restricted/);
await page.evaluate(() => { globalThis.__fb.anonDisabled = false; }); ok('if Anonymous sign-in is switched off in Firebase, team-password sign-in says exactly what to enable (no raw “admin-restricted-operation”)');
await joinTeam('1', '000000'); assert.match(await page.$eval('#lg-err', (e) => e.textContent), /team number and password don’t match/);
await joinTeam('99', '123456'); assert.match(await page.$eval('#lg-err', (e) => e.textContent), /don’t match/);
assert.deepEqual(await nav(), ['Standings', 'Schedule']); assert.equal(Object.keys((await fbState()).docs.teamMembers).length, 0, 'failed attempts leave nothing behind');
ok('a wrong team number or password is rejected (and signed back out)');
await joinTeam('1', '123456', 'Sam');
assert.equal(await page.evaluate(() => location.hash), '#/team');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Teams']); assert.match(await page.$eval('#who', (e) => e.textContent), /Sam[\s\S]*password/i);
ok('the right password signs in as a team member: Practice, Stats, Team — nothing else');
await tap(page, '#td-practice'); await page.waitForSelector('#sc-equip'); await tap(page, '#sc-equip'); await tap(page, '#sc-submit'); await page.waitForSelector('.toast.ok');
const mr = Object.values((await fbState()).docs.practice).find((r) => r.by === 'Sam');
assert.ok(mr && mr.teamId === 't1' && mr.uid.startsWith('anon-') && Object.keys((await fbState()).docs.teamMembers).every((k) => /^anon-\d+_t1$/.test(k))); ok('practice runs from a password member are saved under the team, with their name');
await hash('team'); assert.equal(await page.$('#t-add'), null); assert.equal(await page.$('#t-pw'), null); assert.ok(await page.$('#tm-add')); ok('password members can’t manage people or the team password (they get the Teams tab: their teams + Add a team)');
for (const [h, re] of [['judge', /Referees only/], ['admin', /Admins only/], ['event', /Hosts only/]]) { await hash(h); assert.match(await page.$eval('main', (e) => e.textContent), re, h); }
ok('Judge / Admin / Event pages are closed to password members');
// the coach changes the team password → the old session is signed out on its next read
await page.evaluate(() => { globalThis.__fb.docs.teamSecrets.t1.password = '246810'; globalThis.__fb.expirePractice = true; });
await hash('stats'); await w(500);
assert.deepEqual(await nav(), ['Standings', 'Schedule']); await hash('login');
assert.match(await page.$eval('#lg-err', (e) => e.textContent), /team password for #1 was changed or turned off/); ok('changing the team password signs old password sessions out, with a clear message');
await page.evaluate(() => { globalThis.__fb.expirePractice = false; });
await joinTeam('1', '123456'); assert.match(await page.$eval('#lg-err', (e) => e.textContent), /don’t match/);
await joinTeam('1', '246810', 'Sam again'); assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Teams']); ok('the old password stops working; the new one works');
await signOut(); assert.equal(Object.keys((await fbState()).docs.teamMembers).length, 0); ok('signing out removes the password session');
await page.evaluate(() => { globalThis.__fb.docs.teamSecrets.t1.password = '123456'; });

// judge
await signIn('uid-judge', 'judge@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Judge', 'Teams']); ok('judge on the access list gets Judge (+ the Teams tab every signed-in person has)');
await hash('judge');
assert.equal(await page.$eval('#sc-event', (e) => e.value), 'ev1', 'live event preselected');
await page.select('#sc-team', 't1');
await page.$eval('#sc-equip', (e) => e.click()); await page.$eval('[data-m=m08][data-k=vine]', (e) => e.click());
await page.type('#sc-initials', 'al'); await draw();
await page.$eval('#sc-agree', (e) => e.click());
await page.$eval('#sc-submit', (e) => e.click()); await page.waitForSelector('.toast.ok');
let st = await fbState();
const sc1 = st.docs.scores.ev1_t1_R1;
assert.ok(sc1, 'score doc id is <eventId>_<teamId>_R<round>');
assert.equal(sc1.total, 100); assert.equal(sc1.hasSignature, true); assert.equal(sc1.judgeUid, 'uid-judge'); assert.equal(sc1.eventId, 'ev1'); assert.equal(sc1.eventName, 'Regional');
assert.equal('signature' in sc1, false, 'signature image is NOT stored on the public score doc');
assert.ok(st.docs.signatures.ev1_t1_R1.signature.startsWith('data:image/png'), 'signature stored separately');
assert.ok(st.log.some((l) => l[0] === 'commit' && l[1] === 'scores/ev1_t1_R1,signatures/ev1_t1_R1'), 'written atomically in one batch');
ok('official score + signature written atomically (event-scoped id); signature kept off the public doc');
await hash(''); assert.match(await page.$eval('.standings', (e) => e.textContent), /100/); ok('public dashboard updates from the Firestore snapshot');

await page.evaluate(() => { globalThis.__fb.rejectBatch = true; });
await hash('judge'); await page.select('#sc-team', 't2'); await page.type('#sc-initials', 'be'); await draw();
await page.$eval('#sc-agree', (e) => e.click()); await page.$eval('#sc-submit', (e) => e.click()); await w(400);
assert.match(await page.$eval('#sc-error', (e) => e.textContent), /refused this score/i);
assert.equal((await fbState()).docs.scores.ev1_t2_R1, undefined); ok('a rejected write (rules) shows a clear error and stores nothing');
await page.evaluate(() => { globalThis.__fb.rejectBatch = false; });
await hash('admin'); assert.match(await page.$eval('main', (e) => e.textContent), /Admins only/); ok('judge is blocked from the admin console');
await signOut();

// coach
await signIn('uid-coach', 'coach@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Teams']); ok('coach gets Practice, Team stats and My team');
await hash('team');
await page.$eval('#t-name', (e) => { e.value = ''; }); await page.type('#t-name', 'Alpha Prime'); await tap(page, '#t-rename button'); await w(300);
assert.equal((await fbState()).docs.teams.t1.name, 'Alpha Prime'); assert.equal((await fbState()).docs.teams.t1.number, 1); ok('coach renames their team (only the name changes)');
await page.type('#t-email', 'Parent@Gmail.com'); await page.type('#t-pname', 'Sam’s mom'); await tap(page, '#t-add button'); await w(400);
st = await fbState();
assert.deepEqual({ ...st.docs.access['parent@gmail.com'], addedAt: 0 }, { role: 'member', teamId: 't1', name: 'Sam’s mom', addedBy: 'coach@gmail.com', addedAt: 0 });
assert.deepEqual({ ...st.docs.roster['t1__parent@gmail.com'], addedAt: 0 }, { teamId: 't1', email: 'parent@gmail.com', role: 'member', name: 'Sam’s mom', addedBy: 'coach@gmail.com', addedAt: 0 });
assert.match(await page.$eval('#t-people', (e) => e.textContent), /parent@gmail\.com/); ok('coach adds a member by gmail: an account (if new) + a roster entry for THIS team (lowercased, role=member)');
await page.type('#t-email', 'Second.Coach@Gmail.com'); await page.select('#t-role', 'coach'); await tap(page, '#t-add button'); await w(400);
st = await fbState(); assert.equal(st.docs.roster['t1__second.coach@gmail.com'].role, 'coach'); assert.equal(st.docs.roster['t1__second.coach@gmail.com'].addedBy, 'coach@gmail.com'); assert.ok(st.docs.access['second.coach@gmail.com']);
assert.match(await page.$eval('#t-people', (e) => e.textContent), /second\.coach@gmail\.com[\s\S]*Remove/); ok('a coach can add another coach (and remove coaches they added)');
await tap(page, '#t-pw'); await page.waitForSelector('dialog[open] #pw-code'); assert.equal(await page.$eval('dialog #pw-code', (e) => e.textContent), '123456'); assert.match(await page.$eval('#pw-state', (e) => e.textContent), /ON/); await tap(page, 'dialog [data-close]');
assert.match(await page.$eval('#t-pwcount', (e) => e.textContent), /\(\d+\)/); ok('the coach can see the team password and who has joined with it');
await page.type('#t-email', 'not-an-email'); await tap(page, '#t-add button'); await w(200);
assert.match(await page.$eval('#t-err', (e) => e.textContent), /valid Google email/); ok('bad email is rejected');
await hash('practice'); await page.$eval('#sc-equip', (e) => e.click()); await page.$eval('#sc-submit', (e) => e.click()); await page.waitForSelector('.toast.ok');
st = await fbState(); const run = Object.values(st.docs.practice).find((r) => r.by === 'Coach C');
assert.equal(run.teamId, 't1'); assert.equal(run.by, 'Coach C'); assert.equal(run.total, 70); ok('practice run is saved against the team');
await hash('judge'); assert.match(await page.$eval('main', (e) => e.textContent), /Referees only/); ok('coach (not a referee) cannot open the judge page');
await signOut();

// member
await page.evaluate(() => { globalThis.__fb.google = { uid: 'uid-parent', email: 'parent@gmail.com' }; });
await signIn('uid-parent', 'parent@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Teams']); ok('a member added by their coach can sign in');
await hash('team'); assert.equal(await page.$('#t-add'), null); assert.equal(await page.$('#t-rename'), null); ok('members cannot rename the team or add people (coach-only UI)');
await signOut();

// event host (assigned per event by an admin)
await signIn('uid-host', 'host@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Judge', 'Teams', 'Event']); ok('event host gets Judge + Event (no Admin)');
await hash('admin'); assert.match(await page.$eval('main', (e) => e.textContent), /Admins only/); ok('host is blocked from the admin console');
await hash('event');
assert.match(await page.$eval('#ev', (e) => e.textContent), /Regional/);
await tap(page, '#e-team button'); await w(100); assert.match(await page.$eval('#e-terr', (e) => e.textContent), /number is required/);
await page.type('#e-tn', '77'); await tap(page, '#e-team button'); await w(100); assert.match(await page.$eval('#e-terr', (e) => e.textContent), /name is required/);
await page.type('#e-tname', 'Hosted Team'); await tap(page, '#e-team button'); await w(100); assert.match(await page.$eval('#e-terr', (e) => e.textContent), /coach’s Google email/);
ok('host form requires a number, a name AND a designated coach');
await page.type('#e-tcoach', 'Designated@Gmail.com'); await tap(page, '#e-team button'); await w(500);
st = await fbState();
assert.deepEqual(st.docs.teams.t77, { number: 77, name: 'Hosted Team', createdBy: 'host@gmail.com' });
assert.match(st.docs.teamSecrets.t77.password, /^[1-9]\d{5}$/); assert.equal(st.docs.teamSecrets.t77.updatedBy, 'host@gmail.com');
assert.deepEqual({ ...st.docs.access['designated@gmail.com'], addedAt: 0 }, { role: 'coach', teamId: 't77', name: '', addedBy: 'host@gmail.com', addedAt: 0 });
assert.equal(st.docs.roster['t77__designated@gmail.com'].role, 'coach'); assert.equal(st.docs.teamSecrets.t77.enabled, true, 'team password is ON by default'); assert.equal(st.docs.teamSecrets.t77.isDefault, true);
assert.match(await page.$eval('dialog[open]', (d) => d.textContent), new RegExp(st.docs.teamSecrets.t77.password)); await tap(page, 'dialog [data-close]');
ok('host adds a team: random 6-digit team password created, designated coach added, password shown once');
await page.$eval('#c-rounds', (e) => { e.value = '3'; }); await page.$eval('#c-tables', (e) => { e.value = '2'; });
await tap(page, '#e-gen'); await w(300);
assert.match(await page.$eval('#e-sched', (e) => e.textContent), /Preview \(not saved\)/);
await tap(page, '#e-save'); await w(400);
st = await fbState(); const sch = st.docs.events.ev1.schedule;
assert.equal(sch.rows.length, 3 * 3, '3 teams (Alpha, Beta, Hosted Team) × 3 rounds'); ok('host generates and saves a schedule on their event');
assert.equal(sch.config.tables, 2); assert.equal(sch.generatedBy, 'host@gmail.com');
await hash('schedule'); assert.match(await page.$eval('#s-body', (e) => e.textContent), /Round 3/); assert.match(await page.$eval('#s-body', (e) => e.textContent), /Hosted Team/); ok('the saved schedule is public on the Schedule page');
await hash('judge'); assert.equal(await page.$eval('#sc-event', (e) => e.value), 'ev1'); ok('host can open the scoring form for their event');
await signOut();

// admin
await signIn('uid-boss', 'boss@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Judge', 'Teams', 'Event', 'Admin']); ok('admin sees Judge, Event and Admin');
await hash('admin');
await page.type('#a-evn', 'State Finals'); await tap(page, '#a-ev button'); await w(300);
assert.ok(Object.values((await fbState()).docs.events).some((e) => e.name === 'State Finals')); ok('admin adds an event');
await tap(page, '#a-team button'); await w(100); assert.match(await page.$eval('#a-terr', (e) => e.textContent), /number is required/);
await page.type('#a-tn', '42'); await tap(page, '#a-team button'); await w(100); assert.match(await page.$eval('#a-terr', (e) => e.textContent), /name is required/);
await page.type('#a-tname', 'Fortytwo'); await tap(page, '#a-team button'); await w(100); assert.match(await page.$eval('#a-terr', (e) => e.textContent), /coach’s Google email/);
await page.type('#a-tcoach', 'Parent@Gmail.com'); await tap(page, '#a-team button'); await w(500);   // parent@gmail.com is an existing member → becomes this team's coach
st = await fbState();
assert.deepEqual(st.docs.teams.t42, { number: 42, name: 'Fortytwo', createdBy: 'boss@gmail.com' }); assert.match(st.docs.teamSecrets.t42.password, /^[1-9]\d{5}$/);
assert.equal(st.docs.access['parent@gmail.com'].role, 'member', 'existing account untouched'); assert.equal(st.docs.roster['t42__parent@gmail.com'].role, 'coach'); assert.equal(st.docs.roster['t1__parent@gmail.com'].role, 'member', 'still just a member of t1');
assert.match(await page.$eval('dialog[open]', (d) => d.textContent), new RegExp(st.docs.teamSecrets.t42.password)); await tap(page, 'dialog [data-close]');
ok('admin adds a team: needs number + name + designated coach; 6-digit team password generated; an existing member becomes coach of THIS team only');
await tap(page, '[data-teampw="t42"]'); await page.waitForSelector('dialog[open] #pw-code');
const oldPw = await page.$eval('dialog #pw-code', (e) => e.textContent); await page.$eval('dialog #pw-new', (e) => { window.confirm = () => true; e.click(); }); await w(400);
const newPw = (await fbState()).docs.teamSecrets.t42.password; assert.notEqual(newPw, oldPw); assert.equal(await page.$eval('dialog #pw-code', (e) => e.textContent), newPw);
await page.type('dialog #pw-custom', 'abc'); await page.$eval('dialog #pw-form button', (e) => e.click()); await w(200); assert.match(await page.$eval('dialog #pw-err', (e) => e.textContent), /at least 6/);
await tap(page, 'dialog [data-close]'); ok('admin can view and reset any team’s password (custom ones must be 6+ characters)');
await page.type('#a-ue', 'NewJudge@Gmail.com'); await page.select('#a-ur', 'judge'); await tap(page, '#a-user button'); await w(300);
await page.type('#a-ue', 'second.coach@gmail.com'); await page.select('#a-ur', 'coach'); await page.select('#a-ut', 't42'); await tap(page, '#a-user button'); await w(300);
await page.type('#a-ue', 'Friend@Gmail.com'); await page.select('#a-ur', 'admin'); await page.type('#a-un', 'Friend'); await tap(page, '#a-user button'); await w(300);
st = await fbState();
assert.equal(st.docs.access['newjudge@gmail.com'].role, 'judge'); assert.equal(st.docs.roster['t42__second.coach@gmail.com'].role, 'coach'); assert.equal(st.docs.roster['t1__second.coach@gmail.com'].role, 'coach', 'now coaches two teams'); assert.equal(st.docs.access['friend@gmail.com'].role, 'admin');
ok('admin grants judge / coach (several per team, one coach on several teams) / admin by gmail');
assert.equal(await page.$('[data-rmp="boss@gmail.com"]'), null); ok('admin cannot remove their own access in the UI');
await tap(page, '[data-evhosts="ev1"]'); await page.waitForSelector('dialog[open] #h-email');
await page.type('dialog #h-email', 'New.Host@Gmail.com'); await tap(page, 'dialog #h-add button'); await w(500);
st = await fbState();
assert.deepEqual(st.docs.eventHosts.ev1.emails, ['host@gmail.com', 'new.host@gmail.com']); assert.equal(st.docs.access['new.host@gmail.com'].role, 'host'); ok('admin assigns a second host to an event (host access doc created)');
await page.type('dialog #h-email', 'coach@gmail.com'); await tap(page, 'dialog #h-add button'); await w(500);
st = await fbState();
assert.deepEqual(st.docs.eventHosts.ev1.emails, ['host@gmail.com', 'new.host@gmail.com', 'coach@gmail.com']);
assert.equal(st.docs.access['coach@gmail.com'].role, 'coach'); assert.equal(st.docs.access['coach@gmail.com'].host, true); assert.equal(st.docs.access['coach@gmail.com'].teamId, 't1'); ok('an existing coach can also be made host: role kept, host flag added (host is a modifier)');
await tap(page, 'dialog [data-hrm="new.host@gmail.com"]'); await w(500);
st = await fbState(); assert.deepEqual(st.docs.eventHosts.ev1.emails, ['host@gmail.com', 'coach@gmail.com']); assert.equal(st.docs.access['new.host@gmail.com'], undefined); ok('removing the last event assignment removes the host’s access');
await tap(page, 'dialog [data-close]'); await w(200);
await signOut();
await signIn('uid-friend', 'friend@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Judge', 'Teams', 'Event', 'Admin']); ok('a newly granted admin can sign in with admin powers');
await signOut();

// a coach who is also host of an event, adding a referee limited to that event
await signIn('uid-coach', 'coach@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Judge', 'Teams', 'Event']); ok('coach + host: gets coach pages AND Judge/Event (7 links; phone shows 4 + More)');
assert.equal(await page.$$eval('#nav > a', (a) => a.length), 5); assert.equal(await page.$('#nav-more'), null); ok('a phone fits all five tabs, so no More menu');




await tap(page, '#nav a[href="#/event"]'); await w(300); assert.match(await page.$eval('#ev', (e) => e.textContent), /Regional/); ok('choosing an item opens the page and closes the menu');
await page.type('#r-email', 'Referee@Gmail.com'); await page.type('#r-name', 'Ref Rae'); await tap(page, '#e-ref button'); await w(400);
st = await fbState();
assert.deepEqual({ ...st.docs.access['referee@gmail.com'], addedAt: 0 }, { role: 'judge', name: 'Ref Rae', addedBy: 'coach@gmail.com', addedAt: 0, eventIds: ['ev1'] });
assert.match(await page.$eval('#e-reflist', (e) => e.textContent), /referee@gmail\.com/); ok('a host adds a referee limited to their event');
await hash('team'); assert.ok(await page.$('#t-add')); ok('…and keeps coach powers on the Team page');
// referee is a modifier too: add an EXISTING member (parent) as a referee of this event — no new account, role kept
await hash('event');
await page.type('#r-email', 'Parent@Gmail.com'); await tap(page, '#e-ref button'); await w(500);
st = await fbState();
assert.deepEqual(st.docs.eventJudges.ev1.emails, ['referee@gmail.com', 'parent@gmail.com']); assert.equal(st.docs.access['parent@gmail.com'].role, 'member'); assert.equal(st.docs.access['parent@gmail.com'].eventIds, undefined);
ok('an existing team member can be made a referee of one event (their member role is untouched)');
await signOut();
await signIn('uid-parent', 'parent@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Judge', 'Teams']); await hash('judge');
assert.deepEqual(await page.$$eval('#sc-event option', (o) => o.map((x) => x.value)), ['ev1']); ok('a member who is also a referee gets the Judge page for that event, keeps Practice/Stats/Team');
await signOut();
await signIn('uid-ref', 'referee@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Judge', 'Teams']); await hash('judge');
assert.deepEqual(await page.$$eval('#sc-event option', (o) => o.map((x) => x.value)), ['ev1']); ok('the referee can score only their event (the other event is not offered)');
await signOut();
await signIn('uid-boss', 'boss@gmail.com'); await hash('admin');
await tap(page, '[data-evhosts="ev1"]'); await page.waitForSelector('dialog[open] [data-hrm="coach@gmail.com"]');
await tap(page, 'dialog [data-hrm="coach@gmail.com"]'); await w(500);
st = await fbState(); assert.deepEqual(st.docs.eventHosts.ev1.emails, ['host@gmail.com']); assert.equal(st.docs.access['coach@gmail.com'].role, 'coach'); assert.equal(st.docs.access['coach@gmail.com'].host, undefined);
ok('removing the host assignment keeps the coach but drops the host flag');
await signOut();


// ---- one person, several teams (a role per team), the Teams tab, colors, password switch, reminder popup ----
await page.evaluate(() => {
  const d = globalThis.__fb.docs;
  d.access['pro@gmail.com'] = { role: 'coach', teamId: 't2', name: 'Pro Pat' };
  d.roster['t2__pro@gmail.com'] = { teamId: 't2', email: 'pro@gmail.com', role: 'coach', name: 'Pro Pat', addedBy: 'boss@gmail.com', addedAt: 1 };
  d.roster['t1__pro@gmail.com'] = { teamId: 't1', email: 'pro@gmail.com', role: 'member', name: 'Pro Pat', addedBy: 'coach@gmail.com', addedAt: 1 };
  d.teams.t3 = { number: 3, name: 'Gamma Squad' };
  d.teamSecrets.t3 = { password: '333333', enabled: true, isDefault: false, updatedBy: 'boss@gmail.com', updatedAt: 1 };
  d.roster['t3__pro@gmail.com'] = undefined; delete d.roster['t3__pro@gmail.com'];
});
await signIn('uid-pro', 'pro@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Teams']); await hash('team');
let rowsTxt = await page.$$eval('#tm-list .trow', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ')));
assert.equal(rowsTxt.length, 2); assert.ok(rowsTxt.some((t) => /Beta/.test(t) && /Coach/.test(t) && /Active/.test(t))); assert.ok(rowsTxt.some((t) => /Alpha/.test(t) && /Member/.test(t)));
ok('Teams tab lists every team you are on, with a role PER TEAM (coach of Beta, plain member of Alpha); the team you coach is active');
assert.ok(await page.$('#t-add') && await page.$('#t-pw')); assert.match(await page.$eval('#t-title', (e) => e.textContent), /Manage #2 Beta/);
ok('coach tools appear for the team you coach');
await tab('practice'); assert.match(await page.$eval('#td-title', (e) => e.textContent), /Beta/); assert.ok(await page.$('#tp-practice #sc-submit')); ok('the Practice tab (inside the Teams page) belongs to the active team');
await hash('team'); await tap(page, '[data-use="t1"]'); await w(400);
assert.equal(await page.$('#t-add'), null); assert.equal(await page.$('#t-pw'), null); assert.equal(await page.$('#t-rename'), null);
ok('switching to the team where you are only a member removes the coach tools (your coach role applies to that team only)');
await tab('practice'); assert.match(await page.$eval('#td-title', (e) => e.textContent), /Alpha/);
await page.$eval('#sc-equip', (e) => e.click()); await page.$eval('#sc-submit', (e) => e.click()); await page.waitForSelector('.toast.ok');
assert.ok(Object.values((await fbState()).docs.practice).some((r) => r.by === 'Pro Pat' && r.teamId === 't1')); ok('a practice run is saved under the ACTIVE team');
// add a team by number + name + password
await hash('team');
const useTeam = async (id) => { if (await page.$(`[data-use="${id}"]`)) { await tap(page, `[data-use="${id}"]`); await w(400); } };
const addTeam = async (num, nm, pw) => { for (const [sel, v] of [['#tm-num', num], ['#tm-tname', nm], ['#tm-pw', pw]]) { await page.$eval(sel, (e) => { e.value = ''; }); if (v) await page.type(sel, v); } await tap(page, '#tm-add button.primary'); await w(500); };
await addTeam('3', 'Wrong Name', '333333'); assert.match(await page.$eval('#tm-err', (e) => e.textContent), /Team #3 is called “Gamma Squad”/);
await addTeam('99', 'Nope', '333333'); assert.match(await page.$eval('#tm-err', (e) => e.textContent), /no team #99/);
await addTeam('3', 'gamma squad', '000000'); assert.match(await page.$eval('#tm-err', (e) => e.textContent), /don’t match/); assert.equal((await fbState()).docs.teamMembers['uid-pro_t3'], undefined);
await addTeam('1', 'Alpha Prime', '123456'); assert.match(await page.$eval('#tm-err', (e) => e.textContent), /already on that team|called/);
ok('adding a team needs its number, its name and its password; wrong name / number / password are refused');
await addTeam('3', 'gamma squad', '333333');
let st2 = await fbState(); assert.equal(st2.docs.teamMembers['uid-pro_t3'].teamId, 't3'); assert.equal(st2.docs.teamMembers['uid-pro_t3'].password, '333333'); assert.equal(st2.docs.teamMembers['uid-pro_t3'].uid, 'uid-pro');
assert.equal((await page.$$('#tm-list .trow')).length, 3); assert.match(await page.$eval('#tm-list .trow.on', (e) => e.textContent), /Gamma Squad/);
assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('gb-my-teams')).map((t) => t.teamId)), ['t3']); ok('the team is added to the Google account (membership doc under your uid), saved in local storage, and becomes active');
await page.evaluate(() => { globalThis.confirm = () => true; }); await tap(page, '[data-leave="t3"]'); await w(500);
assert.equal((await fbState()).docs.teamMembers['uid-pro_t3'], undefined); assert.equal((await page.$$('#tm-list .trow')).length, 2); assert.equal(await page.$('[data-leave="t2"]'), null, 'coaches have no Leave button');
ok('you can leave a team you joined (coaches cannot leave the team they coach)');
// colors (coach of Beta)
await useTeam('t2');
for (let i = 0; i < 4; i++) { if (!(await page.$eval('#t-addcolor', (e) => e.disabled))) await tap(page, '#t-addcolor'); }
assert.equal((await page.$$('#t-colors input[type=color]')).length, 3); assert.equal(await page.$eval('#t-addcolor', (e) => e.disabled), true); ok('a coach can pick up to 3 team colors (the add button turns off at 3)');
await page.$eval('#t-colors input[data-ci="0"]', (e) => { e.value = '#ff0000'; e.dispatchEvent(new Event('input', { bubbles: true })); });
await tap(page, '#t-savecolors'); await w(400);
assert.deepEqual((await fbState()).docs.teams.t2.colors, ['#ff0000', '#1a9e6b', '#1a9e6b']);
await hash(''); assert.ok(await page.$('.standings .cdots i')); assert.equal(await page.$eval('.standings .cdots i', (e) => e.style.background), 'rgb(255, 0, 0)'); ok('colors are saved on the team and shown on the public standings');
// password switch (default ON; coach can turn off → joined members cut off)
await signOut();
await hash('login'); await joinTeam('2', '654321', 'Visitor');
let mm = Object.keys((await fbState()).docs.teamMembers).filter((k) => /_t2$/.test(k)); assert.equal(mm.length, 1); ok('password sign-in is ON by default: a visitor joins Beta with its password');
await signOut();
await page.evaluate(() => { globalThis.__fb.docs.teamMembers['anon-77_t2'] = { uid: 'anon-77', teamId: 't2', password: '654321', name: 'Visitor Val', createdAt: Date.now() }; }); // a member who is still signed in elsewhere
await signIn('uid-pro', 'pro@gmail.com'); await hash('team'); await useTeam('t2');
assert.match(await page.$eval('#t-pwstate', (e) => e.textContent), /ON/); assert.match(await page.$eval('#t-pwlist', (e) => e.textContent), /Visitor Val/);
await tap(page, '#t-pwtoggle'); await w(500);
assert.equal((await fbState()).docs.teamSecrets.t2.enabled, false); assert.match(await page.$eval('#t-pwstate', (e) => e.textContent), /OFF/); assert.equal(await page.$eval('#t-pwtoggle', (e) => e.textContent), 'Turn on');
await signOut(); await hash('login'); await joinTeam('2', '654321', 'Late'); assert.match(await page.$eval('#lg-err', (e) => e.textContent), /don’t match[\s\S]*turned password sign-in off/); ok('a coach can turn password sign-in off: nobody can join with the password any more');
await signIn('uid-pro', 'pro@gmail.com'); await hash('team'); await useTeam('t2'); await tap(page, '#t-pwtoggle'); await w(500);
assert.equal((await fbState()).docs.teamSecrets.t2.enabled, true); ok('…and back on again');
await signOut();
// anonymous visitor on several teams, linked to a Google account on sign-in
await hash('login'); await joinTeam('2', '654321', 'Anon Ann'); await hash('team'); await addTeam('3', 'Gamma Squad', '333333');
assert.equal((await page.$$('#tm-list .trow')).length, 2); st2 = await fbState();
assert.ok(Object.keys(st2.docs.teamMembers).filter((k) => k.startsWith('anon-')).length >= 2); assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('gb-my-teams')).map((t) => t.teamId).sort()), ['t2', 't3']);
ok('a visitor without Google can be on several teams by password; they are kept in local storage');
await hash('login'); await google('uid-pro', 'pro@gmail.com'); await tap(page, '#lg-google'); await w(900);
st2 = await fbState(); assert.equal(st2.docs.teamMembers['uid-pro_t3']?.teamId, 't3', 'linked to the Google account'); await hash('team');
assert.ok((await page.$$eval('#tm-list .trow', (r) => r.map((x) => x.textContent))).some((t) => /Gamma Squad/.test(t))); ok('signing in with Google links the teams saved on this device to the account');
await signOut();
// reminder popup for a coach whose team password is still the generated one
await page.evaluate(() => { try { sessionStorage.removeItem('gb-pw-prompted'); } catch {} });
await page.evaluate(() => { globalThis.__fb.docs.access['designated@gmail.com'] ||= { role: 'coach', teamId: 't77', name: '' }; });
await signIn('uid-des', 'designated@gmail.com');
await page.waitForSelector('dialog[open] [data-pwchange]', { timeout: 4000 });
assert.match(await page.$eval('dialog[open]', (d) => d.textContent), /Please change your team password[\s\S]*Hosted Team/); ok('a coach whose team password is still the generated one gets a popup asking them to change it');
await tap(page, 'dialog [data-pwchange="t77"]'); await page.waitForSelector('dialog[open] #pw-custom');
await page.type('dialog #pw-custom', 'my-own-pass'); await page.$eval('dialog #pw-form button', (e) => e.click()); await w(500);
let sec77 = (await fbState()).docs.teamSecrets.t77; assert.equal(sec77.password, 'my-own-pass'); assert.equal(sec77.isDefault, false); assert.equal(sec77.enabled, true); ok('"Change it" opens the password editor; a coach’s own password clears the reminder');
await tap(page, 'dialog [data-close]'); await signOut();
await page.evaluate(() => { try { sessionStorage.removeItem('gb-pw-prompted'); } catch {} globalThis.__fb.docs.teamSecrets.t77.isDefault = true; });
await signIn('uid-des', 'designated@gmail.com'); await page.waitForSelector('dialog[open] [data-pwoff]', { timeout: 4000 });
await tap(page, 'dialog [data-pwoff="t77"]'); await w(500); assert.equal((await fbState()).docs.teamSecrets.t77.enabled, false); assert.equal(await page.$('dialog[open]'), null, 'popup closes when nothing is left'); ok('the popup also lets the coach keep the code or turn password sign-in off');
await signOut();
await page.evaluate(() => { try { sessionStorage.removeItem('gb-pw-prompted'); } catch {} globalThis.__fb.docs.teamSecrets.t77.isDefault = true; globalThis.__fb.docs.teamSecrets.t77.enabled = true; });
await signIn('uid-des', 'designated@gmail.com'); await page.waitForSelector('dialog[open] [data-pwkeep]', { timeout: 4000 }); await tap(page, 'dialog [data-pwkeep="t77"]'); await w(400);
assert.equal((await fbState()).docs.teamSecrets.t77.isDefault, false); ok('"Keep this one" stops the reminder');
await signOut();

await browser.close(); server.close();
assert.deepEqual(errors, [], 'no browser errors'); ok('no browser errors');
console.log(`\n${passed} firebase-mock checks passed`);
