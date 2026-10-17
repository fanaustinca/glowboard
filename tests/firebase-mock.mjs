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
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = async (h) => { await page.evaluate((x) => { location.hash = '#/' + x; }, h); await w(250); };
const fbState = () => page.evaluate(() => ({ docs: globalThis.__fb.docs, log: globalThis.__fb.log }));

console.log('firebase (mocked SDK)');
const google = (uid, email) => page.evaluate((g) => { globalThis.__fb.google = g; }, uid ? { uid, email } : null);
const nav = () => page.$$eval('#nav a', (a) => a.map((x) => x.textContent));
const signIn = async (uid, email) => { await hash('login'); await google(uid, email); await page.click('#lg-google'); await w(600); };
const signOut = async () => { await page.click('#signout'); await w(400); };
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
await google('uid-ghost', 'Ghost@Gmail.com'); await page.click('#lg-google'); await w(600);
assert.match(await page.$eval('#lg-err', (e) => e.textContent), /ghost@gmail\.com isn’t on the access list/);
assert.deepEqual(await nav(), ['Standings', 'Schedule']); assert.equal(await page.$eval('#signout', (e) => getComputedStyle(e).display), 'none'); ok('a Google account that is not on the access list is rejected (and gets no privileges)');
assert.ok((await fbState()).log.some((l) => l[0] === 'googlePopup' && l[1] === true)); ok('uses the Google provider popup');

// judge
await signIn('uid-judge', 'judge@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Judge']); ok('judge on the access list gets Judge only');
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
assert.match(await page.$eval('#sc-error', (e) => e.textContent), /permission/i);
assert.equal((await fbState()).docs.scores.ev1_t2_R1, undefined); ok('a rejected write (rules) shows a clear error and stores nothing');
await page.evaluate(() => { globalThis.__fb.rejectBatch = false; });
await hash('admin'); assert.match(await page.$eval('main', (e) => e.textContent), /Admins only/); ok('judge is blocked from the admin console');
await signOut();

// coach
await signIn('uid-coach', 'coach@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Practice', 'Stats', 'Team']); ok('coach gets Practice, Team stats and My team');
await hash('team');
await page.$eval('#t-name', (e) => { e.value = ''; }); await page.type('#t-name', 'Alpha Prime'); await page.click('#t-rename button'); await w(300);
assert.equal((await fbState()).docs.teams.t1.name, 'Alpha Prime'); assert.equal((await fbState()).docs.teams.t1.number, 1); ok('coach renames their team (only the name changes)');
await page.type('#t-email', 'Parent@Gmail.com'); await page.type('#t-pname', 'Sam’s mom'); await page.click('#t-add button'); await w(400);
st = await fbState();
assert.deepEqual({ ...st.docs.access['parent@gmail.com'], addedAt: 0 }, { role: 'member', teamId: 't1', name: 'Sam’s mom', addedBy: 'coach@gmail.com', addedAt: 0 });
assert.match(await page.$eval('#t-people', (e) => e.textContent), /parent@gmail\.com/); ok('coach adds a member by gmail (lowercased, own team, role=member)');
await page.type('#t-email', 'not-an-email'); await page.click('#t-add button'); await w(200);
assert.match(await page.$eval('#t-err', (e) => e.textContent), /valid Google email/); ok('bad email is rejected');
await hash('practice'); await page.$eval('#sc-equip', (e) => e.click()); await page.$eval('#sc-submit', (e) => e.click()); await page.waitForSelector('.toast.ok');
st = await fbState(); const run = Object.values(st.docs.practice)[0];
assert.equal(run.teamId, 't1'); assert.equal(run.by, 'Coach C'); assert.equal(run.total, 70); ok('practice run is saved against the team');
await hash('judge'); assert.match(await page.$eval('main', (e) => e.textContent), /Judges only/); ok('coach cannot open the judge page');
await signOut();

// member
await page.evaluate(() => { globalThis.__fb.google = { uid: 'uid-parent', email: 'parent@gmail.com' }; });
await signIn('uid-parent', 'parent@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Practice', 'Stats', 'Team']); ok('a member added by their coach can sign in');
await hash('team'); assert.equal(await page.$('#t-add'), null); assert.equal(await page.$('#t-rename'), null); ok('members cannot rename the team or add people (coach-only UI)');
await signOut();

// event host (assigned per event by an admin)
await signIn('uid-host', 'host@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Judge', 'Event']); ok('event host gets Judge + Event (no Admin)');
await hash('admin'); assert.match(await page.$eval('main', (e) => e.textContent), /Admins only/); ok('host is blocked from the admin console');
await hash('event');
assert.match(await page.$eval('#ev', (e) => e.textContent), /Regional/);
await page.type('#e-tn', '77'); await page.type('#e-tname', 'Hosted Team'); await page.click('#e-team button'); await w(400);
assert.deepEqual((await fbState()).docs.teams.t77, { number: 77, name: 'Hosted Team', createdBy: 'host@gmail.com' }); ok('host adds a team (number + name, creator recorded)');
await page.click('#e-team button'); await w(100); assert.match(await page.$eval('#e-terr', (e) => e.textContent), /number is required/); ok('host form also requires a number and a name');
await page.$eval('#c-rounds', (e) => { e.value = '3'; }); await page.$eval('#c-tables', (e) => { e.value = '2'; });
await page.click('#e-gen'); await w(300);
assert.match(await page.$eval('#e-sched', (e) => e.textContent), /Preview \(not saved\)/);
await page.click('#e-save'); await w(400);
st = await fbState(); const sch = st.docs.events.ev1.schedule;
assert.equal(sch.rows.length, 3 * 3, '3 teams (Alpha, Beta, Hosted Team) × 3 rounds'); ok('host generates and saves a schedule on their event');
assert.equal(sch.config.tables, 2); assert.equal(sch.generatedBy, 'host@gmail.com');
await hash('schedule'); assert.match(await page.$eval('#s-body', (e) => e.textContent), /Round 3/); assert.match(await page.$eval('#s-body', (e) => e.textContent), /Hosted Team/); ok('the saved schedule is public on the Schedule page');
await hash('judge'); assert.equal(await page.$eval('#sc-event', (e) => e.value), 'ev1'); ok('host can open the scoring form for their event');
await signOut();

// admin
await signIn('uid-boss', 'boss@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Judge', 'Event', 'Admin']); ok('admin sees Judge, Event and Admin');
await hash('admin');
await page.type('#a-evn', 'State Finals'); await page.click('#a-ev button'); await w(300);
assert.ok(Object.values((await fbState()).docs.events).some((e) => e.name === 'State Finals')); ok('admin adds an event');
await page.click('#a-team button'); await w(100); assert.match(await page.$eval('#a-terr', (e) => e.textContent), /number is required/);
await page.type('#a-tn', '42'); await page.click('#a-team button'); await w(100); assert.match(await page.$eval('#a-terr', (e) => e.textContent), /name is required/);
await page.type('#a-tname', 'Fortytwo'); await page.click('#a-team button'); await w(300);
assert.deepEqual((await fbState()).docs.teams.t42, { number: 42, name: 'Fortytwo', createdBy: 'boss@gmail.com' }); ok('adding a team requires BOTH number and name');
await page.type('#a-ue', 'NewJudge@Gmail.com'); await page.select('#a-ur', 'judge'); await page.click('#a-user button'); await w(300);
await page.type('#a-ue', 'second.coach@gmail.com'); await page.select('#a-ur', 'coach'); await page.select('#a-ut', 't1'); await page.click('#a-user button'); await w(300);
await page.type('#a-ue', 'Friend@Gmail.com'); await page.select('#a-ur', 'admin'); await page.type('#a-un', 'Friend'); await page.click('#a-user button'); await w(300);
st = await fbState();
assert.equal(st.docs.access['newjudge@gmail.com'].role, 'judge'); assert.equal(st.docs.access['second.coach@gmail.com'].teamId, 't1'); assert.equal(st.docs.access['friend@gmail.com'].role, 'admin');
ok('admin grants judge / coach (several per team) / admin by gmail');
assert.equal(await page.$('[data-rmp="boss@gmail.com"]'), null); ok('admin cannot remove their own access in the UI');
await page.click('[data-evhosts="ev1"]'); await page.waitForSelector('dialog[open] #h-email');
await page.type('dialog #h-email', 'New.Host@Gmail.com'); await page.click('dialog #h-add button'); await w(500);
st = await fbState();
assert.deepEqual(st.docs.eventHosts.ev1.emails, ['host@gmail.com', 'new.host@gmail.com']); assert.equal(st.docs.access['new.host@gmail.com'].role, 'host'); ok('admin assigns a second host to an event (host access doc created)');
await page.type('dialog #h-email', 'coach@gmail.com'); await page.click('dialog #h-add button'); await w(300);
assert.match(await page.$eval('dialog #h-err', (e) => e.textContent), /already a coach/); ok('a person with another role can’t be made host');
await page.click('dialog [data-hrm="new.host@gmail.com"]'); await w(500);
st = await fbState(); assert.deepEqual(st.docs.eventHosts.ev1.emails, ['host@gmail.com']); assert.equal(st.docs.access['new.host@gmail.com'], undefined); ok('removing the last event assignment removes the host’s access');
await page.click('dialog [data-close]'); await w(200);
await signOut();
await signIn('uid-friend', 'friend@gmail.com');
assert.deepEqual(await nav(), ['Standings', 'Schedule', 'Judge', 'Event', 'Admin']); ok('a newly granted admin can sign in with admin powers');
await signOut();

await browser.close(); server.close();
assert.deepEqual(errors, [], 'no browser errors'); ok('no browser errors');
console.log(`\n${passed} firebase-mock checks passed`);
