// Headless-browser UI test: responsiveness on phone → desktop viewports + full user flows (demo mode).
//   node tests/responsive.mjs            (CHROME_PATH=/path/to/chrome to override auto-detect)
//   SHOTS=1 node tests/responsive.mjs    also saves screenshots to tests/shots/
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { serve } from '../scripts/serve.mjs';
import { scoreAll, defaultState, maxScores } from '../js/scoring.js';

const CHROME = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'].find((p) => p && existsSync(p));
if (!CHROME) { console.error('No Chrome/Chromium found. Set CHROME_PATH.'); process.exit(2); }
const SHOTS = process.env.SHOTS ? new URL('./shots/', import.meta.url).pathname : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { name: 'phone-320', width: 320, height: 640, mobile: true },
  { name: 'phone-375', width: 375, height: 667, mobile: true },
  { name: 'phone-414', width: 414, height: 896, mobile: true },
  { name: 'tablet-768', width: 768, height: 1024, mobile: true },
  { name: 'laptop-1280', width: 1280, height: 800, mobile: false },
];

const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
let passed = 0, failed = 0;
const problems = [];
const ok = (n) => { passed++; console.log('  ok  ' + n); };
const bad = (n, e) => { failed++; problems.push(n); console.log('  FAIL ' + n + '\n       ' + String(e.message || e).split('\n').join('\n       ')); };
const check = async (name, fn) => { try { await fn(); ok(name); } catch (e) { bad(name, e); } };

async function forceDemo(page) {
  // Always test in demo mode, even after the real Firebase config is committed.
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.url().endsWith('/js/firebase-config.js')
    ? r.respond({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' },
        body: "export const firebaseConfig={apiKey:'REPLACE_ME'};export const EMAIL_DOMAIN='myapp.com';export const FIREBASE_SDK_VERSION='10.12.2';export const isConfigured=()=>false;" })
    : r.continue()));
}

async function newPage(vp) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 2, isMobile: vp.mobile, hasTouch: vp.mobile });
  page.errors = [];
  await forceDemo(page);
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => { if (!r.url().endsWith('.jpg')) page.errors.push('requestfailed: ' + r.url()); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('.jpg')) page.errors.push(`http ${r.status()}: ${r.url()}`); });
  page.ctx = ctx;
  return page;
}
const go = async (page, hash = '') => { await page.goto(base + (hash ? '#/' + hash : ''), { waitUntil: 'networkidle0' }); await page.waitForSelector('main .page > *'); };
const goHash = async (page, hash) => { await page.evaluate((h) => { location.hash = '#/' + h; }, hash); await page.waitForSelector('main .page > *'); await new Promise((r) => setTimeout(r, 120)); };
async function login(page, email) { // demo mode simulates Google sign-in with one button per demo role
  await goHash(page, 'login');
  await page.click(`[data-demo="${email}"]`);
  await page.waitForFunction(() => !location.hash.includes('login'));
  await new Promise((r) => setTimeout(r, 150));
}
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());

// Layout audit run inside the page.
const audit = (page) => page.evaluate(() => {
  const out = { overflowX: 0, offscreen: [], smallTargets: [], unnamed: [], unlabeled: [] };
  const vw = document.documentElement.clientWidth;
  out.overflowX = document.documentElement.scrollWidth - vw;
  const visible = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const label = (e) => (e.tagName + '.' + [...e.classList].join('.') + '#' + e.id + ' ' + (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 28));
  for (const e of document.querySelectorAll('main *, header *, nav *')) {
    if (!visible(e) || e.closest('.table-scroll') || e.closest('canvas') || e.closest('svg') || e.closest('dialog:not([open])')) continue;
    const r = e.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) out.offscreen.push(label(e) + ` [${Math.round(r.left)}..${Math.round(r.right)}]`);
  }
  for (const e of document.querySelectorAll('button, a[href], select, input:not([type=checkbox]), textarea, summary, [role=button]')) {
    if (!visible(e) || e.disabled || e.classList.contains('skip')) continue;
    const r = e.getBoundingClientRect();
    if (r.height < 39.5 || r.width < 39.5) out.smallTargets.push(label(e) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  for (const e of document.querySelectorAll('button, a[href], [role=button], [role=checkbox], [role=radio]')) {
    if (!visible(e)) continue;
    if (!(e.textContent.trim() || e.getAttribute('aria-label') || e.getAttribute('title'))) out.unnamed.push(label(e));
  }
  for (const e of document.querySelectorAll('input, select, textarea')) {
    if (!visible(e)) continue;
    if (!(e.labels?.length || e.getAttribute('aria-label'))) out.unlabeled.push(label(e));
  }
  return out;
});
async function assertLayout(page, where) {
  const a = await audit(page);
  assert.deepEqual(a.offscreen.slice(0, 5), [], `${where}: elements off-screen`);
  assert.ok(a.overflowX <= 0, `${where}: horizontal overflow of ${a.overflowX}px`);
  assert.deepEqual(a.smallTargets.slice(0, 5), [], `${where}: touch targets under 40px`);
  assert.deepEqual(a.unnamed.slice(0, 5), [], `${where}: controls without an accessible name`);
  assert.deepEqual(a.unlabeled.slice(0, 5), [], `${where}: form fields without labels`);
  assert.deepEqual(page.errors, [], `${where}: browser errors`);
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true }); };

// ── A. responsiveness on every viewport, every page ──
for (const vp of VIEWPORTS) {
  console.log(`\n[${vp.name}] ${vp.width}x${vp.height}`);
  const page = await newPage(vp);
  await go(page);
  await check('public dashboard renders standings without login', async () => {
    assert.ok((await page.$$('.standings .row')).length >= 8);
    assert.match(await text(page, '#d-stats'), /Max possible/);
    assert.equal(await page.$eval('#signout', (e) => getComputedStyle(e).display), 'none', 'Sign out is not rendered for guests');
    await assertLayout(page, 'dashboard'); await shot(page, `${vp.name}-dashboard`);
  });
  await check('team detail dialog opens and fits', async () => {
    await page.click('.standings .row'); await page.waitForSelector('dialog[open] .round');
    const r = await page.$eval('dialog[open]', (d) => { const b = d.getBoundingClientRect(); return { l: b.left, r: b.right, w: innerWidth }; });
    assert.ok(r.l >= 0 && r.r <= r.w, 'dialog within viewport'); await shot(page, `${vp.name}-dialog`);
    await page.click('dialog[open] [data-close]'); await page.waitForFunction(() => !document.querySelector('dialog'));
  });
  await check('login page', async () => { await goHash(page, 'login'); await assertLayout(page, 'login'); await shot(page, `${vp.name}-login`); });
  await login(page, 'judge@demo.test');
  await check('judge scoring page', async () => { await goHash(page, 'judge'); await assertLayout(page, 'judge'); await shot(page, `${vp.name}-judge`); });
  await check('sticky total bar stays visible while scrolling', async () => {
    await page.evaluate(() => window.scrollTo(0, 1800));
    const r = await page.$eval('.totalbar', (e) => e.getBoundingClientRect().top);
    assert.ok(r >= 0 && r < 120, `total bar top=${r}`);
    await page.evaluate(() => window.scrollTo(0, 0));
  });
  await page.evaluate(() => document.getElementById('signout').click());
  await login(page, 'coach@demo.test');
  await check('practice page', async () => { await goHash(page, 'practice'); await assertLayout(page, 'practice'); await shot(page, `${vp.name}-practice`); });
  await check('stats page', async () => { await goHash(page, 'stats'); await assertLayout(page, 'stats'); await shot(page, `${vp.name}-stats`); });
  await check('my team page (coach)', async () => { await goHash(page, 'team'); await assertLayout(page, 'team'); await shot(page, `${vp.name}-team`); });
  await page.evaluate(() => document.getElementById('signout').click());
  await login(page, 'admin@demo.test');
  await check('admin console', async () => { await goHash(page, 'admin'); await assertLayout(page, 'admin'); await shot(page, `${vp.name}-admin`); });
  await page.ctx.close();
}

// ── B. functional flows on a phone ──
console.log('\n[flows] phone-375');
const vp = VIEWPORTS[1];
let page = await newPage(vp);
await go(page);

await check('guests are gated away from judge/practice/stats/admin', async () => {
  for (const r of ['judge', 'practice', 'stats', 'admin']) {
    await goHash(page, r);
    assert.match(await text(page, 'main'), /Sign in required/, r);
    assert.equal(await page.$('#sc-submit'), null, `${r}: no scorer shown`);
  }
});
await check('login is Google-only; an unlisted Google account is refused', async () => {
  await goHash(page, 'login');
  assert.equal(await page.$('#lg-u'), null, 'no username field'); assert.equal(await page.$('#lg-p'), null, 'no password field');
  const r = await page.evaluate(async () => { const { createStore } = await import('./js/store.js'); const s = await createStore(); try { await s.signInAs('stranger@gmail.com'); return 'allowed'; } catch (e) { return e.code; } });
  assert.equal(r, 'not-authorized');
});
await login(page, 'judge@demo.test');

await check('judge nav shows Judge but not Host/Practice/My stats', async () => {
  const links = await page.$$eval('#nav a', (a) => a.map((x) => x.textContent));
  assert.deepEqual(links, ['Standings', 'Judge']);
});

const expect = defaultState();
const tick = async (sel) => page.$eval(sel, (e) => e.click());
const total = async () => +(await text(page, '#sc-total'));
const sc = (m, k) => `[data-m="${m}"][data-k="${k}"]`;

await goHash(page, 'judge');
await check('fresh form = 50 pts (six precision tokens) and review matches', async () => {
  assert.equal(await total(), 50); assert.equal(await text(page, '#rv-total'), '50');
});
await check('live total tracks every control exactly like the scoring engine', async () => {
  await tick('#sc-equip'); expect.equip = true;
  await tick('#sc-tokens [data-i="4"]'); expect.tokens = 4;
  await tick(sc('m01', 'drone')); expect.m.m01.drone = true;
  await tick(sc('m01', 'lidar')); expect.m.m01.lidar = true;
  for (let i = 0; i < 3; i++) await tick(sc('m02', 'seeds') + ' [data-act=inc]'); expect.m.m02.seeds = 3;
  await tick(sc('m03', 'flag')); expect.m.m03.flag = true;
  await tick(sc('m04', 'leaves') + ' [data-i="2"]'); expect.m.m04.leaves = 2;
  await tick(sc('m04', 'katOriginal')); expect.m.m04.katOriginal = true;
  await tick(sc('m05', 'root') + ' [data-i="2"]'); expect.m.m05.root = 'full';
  await tick(sc('m06', 'ant')); expect.m.m06.ant = true;
  for (let i = 0; i < 4; i++) await tick(sc('m06', 'fragments') + ' [data-act=inc]'); expect.m.m06.fragments = 4;
  await tick(sc('m09', 'camera')); expect.m.m09.camera = true;
  await tick(sc('m14', 'contained') + ' [data-act=inc]'); await tick(sc('m14', 'contained') + ' [data-act=inc]'); expect.m.m14.contained = 2;
  await tick(sc('m14', 'onMat') + ' [data-act=inc]'); expect.m.m14.onMat = 1;
  await tick(sc('m15', 'canopy')); await tick(sc('m15', 'dock') + ' [data-i="1"]'); expect.m.m15.canopy = true; expect.m.m15.dock = 'mine';
  const want = scoreAll(expect).total;
  assert.equal(await total(), want, 'total');
  assert.equal(await text(page, '#rv-total'), String(want), 'review total');
  assert.equal(await text(page, '#mission-m02 [data-role=mscore]'), '30 / 30');
});
await check('bonus controls are locked until their base is met, and clear when it is removed', async () => {
  assert.equal(await page.$eval(sc('m01', 'lidar'), (e) => e.disabled || e.classList.contains('locked')), true === false ? 0 : false);
  await tick(sc('m01', 'drone')); // untick drone → lidar must clear
  assert.equal(await page.$eval(sc('m01', 'lidar'), (e) => e.getAttribute('aria-checked')), 'false');
  assert.equal(await page.$eval(sc('m01', 'lidar'), (e) => e.classList.contains('locked')), true);
  assert.equal(await text(page, '#mission-m01 [data-role=mscore]'), '0 / 30');
  expect.m.m01.drone = false; expect.m.m01.lidar = false;
  assert.equal(await total(), scoreAll(expect).total);
});
await check('Lucky Leaves: katydid outside habitat at end zeroes the mission', async () => {
  await tick(sc('m04', 'katOutEnd')); expect.m.m04.katOutEnd = true;
  assert.equal(await text(page, '#mission-m04 [data-role=mscore]'), '0 / 30');
  assert.equal(await total(), scoreAll(expect).total);
  await tick(sc('m04', 'katOutEnd')); expect.m.m04.katOutEnd = false;
});
await check('no-equipment toggle voids the mission', async () => {
  await tick(sc('m09', 'eq')); expect.m.m09.eq = true;
  assert.equal(await text(page, '#mission-m09 [data-role=mscore]'), '0 / 30');
  assert.equal(await total(), scoreAll(expect).total);
  await tick(sc('m09', 'eq')); expect.m.m09.eq = false;
});
await check('a draft survives a page reload (judges never lose a match)', async () => {
  const before = await total();
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('#sc-total');
  assert.equal(await total(), before);
});
await check('submit is blocked: no team / no initials / no signature / not agreed', async () => {
  await page.$eval('#sc-submit', (e) => e.click()); assert.match(await text(page, '#sc-error'), /Choose a team/);
  await page.select('#sc-team', 't9120');
  await page.$eval('#sc-submit', (e) => e.click()); assert.match(await text(page, '#sc-error'), /initials/);
  await page.type('#sc-initials', 'vd');
  await page.$eval('#sc-submit', (e) => e.click()); assert.match(await text(page, '#sc-error'), /sign/);
});
await check('team signature can be drawn with touch/mouse and cleared', async () => {
  const box = await (await page.$('#sc-sig')).boundingBox();
  await page.evaluate(() => document.getElementById('sc-sig').scrollIntoView({ block: 'center' }));
  const b2 = await (await page.$('#sc-sig')).boundingBox();
  await page.mouse.move(b2.x + 20, b2.y + 40); await page.mouse.down();
  for (let i = 0; i < 12; i++) await page.mouse.move(b2.x + 20 + i * 15, b2.y + 40 + Math.sin(i) * 25);
  await page.mouse.up();
  assert.equal(await page.$eval('#sc-sighint', (e) => e.hidden), true);
  await page.$eval('#sc-sigclear', (e) => e.click());
  assert.equal(await page.$eval('#sc-sighint', (e) => e.hidden), false);
  await page.mouse.move(b2.x + 20, b2.y + 40); await page.mouse.down();
  for (let i = 0; i < 12; i++) await page.mouse.move(b2.x + 20 + i * 15, b2.y + 40 + Math.cos(i) * 25);
  await page.mouse.up();
  assert.ok(box.width > 200);
});
await check('submitting needs the agreement tick, then saves the official score', async () => {
  await page.$eval('#sc-submit', (e) => e.click()); assert.match(await text(page, '#sc-error'), /agree/);
  await page.$eval('#sc-agree', (e) => e.click());
  const want = scoreAll(expect).total;
  await page.$eval('#sc-submit', (e) => e.click());
  await page.waitForFunction(() => document.querySelector('.toast.ok'));
  assert.match(await text(page, '.toast.ok'), new RegExp(`${want} pts`));
  assert.equal(await total(), 50, 'form reset to fresh state');
  await goHash(page, '');
  const rows = await page.$$eval('.standings .row', (r) => r.map((x) => x.textContent));
  const mine = rows.find((r) => r.includes('Vine Divers'));
  assert.ok(mine.includes(String(want)), `dashboard shows ${want}: ${mine}`);
  assert.match(await text(page, '#d-feed'), new RegExp(`${want}`));
  await shot(page, 'flow-after-submit');
});
await check('a match cannot be scored twice by a judge', async () => {
  await goHash(page, 'judge'); await page.select('#sc-team', 't9120');
  const opts = await page.$$eval('#sc-round option', (o) => o.map((x) => [x.value, x.disabled]));
  assert.deepEqual(opts, [['1', true], ['2', false], ['3', false]]);
  assert.equal(await page.$eval('#sc-round', (e) => e.value), '2', 'auto-selects next free match');
});
await check('judges cannot overwrite via the store (rules mirrored in demo mode)', async () => {
  const r = await page.evaluate(async () => {
    const { createStore } = await import('./js/store.js'); const s = await createStore();
    try { await s.submitScore({ eventId: 'ev1', teamId: 't9120', round: 1, total: 999, gp: 3, judgeUid: s.user.uid }, 'x'); return 'allowed'; } catch (e) { return e.code; }
  });
  assert.equal(r, 'permission-denied');
});
await check('judges cannot delete scores or touch teams/accounts', async () => {
  const r = await page.evaluate(async () => {
    const { createStore } = await import('./js/store.js'); const s = await createStore(); const out = [];
    for (const f of [() => s.remove('scores', 'ev1_t9120_R1'), () => s.put('teams', 'tX', { number: 1, name: 'x' }), () => s.put('access', 'evil@gmail.com', { role: 'admin' }), () => s.put('events', 'evX', { name: 'hax' })]) {
      try { await f(); out.push('allowed'); } catch (e) { out.push(e.code); }
    }
    return out;
  });
  assert.deepEqual(r, Array(4).fill('permission-denied'));
});

await page.evaluate(() => document.getElementById('signout').click());
await login(page, 'coach@demo.test');
await check('coach nav shows Practice, Team stats and My team only', async () => {
  assert.deepEqual(await page.$$eval('#nav a', (a) => a.map((x) => x.textContent)), ['Standings', 'Practice', 'Team stats', 'My team']);
});
await check('team can save a practice run (no signature needed) and sees it in stats', async () => {
  await goHash(page, 'practice');
  assert.equal(await page.$('#sc-team'), null, 'no team picker for teams');
  assert.equal(await page.$('#sc-sig'), null, 'no signature on practice');
  await tick('#sc-equip'); await tick(sc('m08', 'vine'));
  const want = 20 + 50 + 30;
  assert.equal(await total(), want);
  await page.$eval('#sc-submit', (e) => e.click()); await page.waitForSelector('.toast.ok');
  await goHash(page, 'stats');
  assert.match(await text(page, '.kpis'), /Practice runs\s*7/);
  assert.ok((await page.$$('.history li')).length === 7);
  assert.ok((await page.$$('.bars li')).length === 15);
  await shot(page, 'flow-stats');
});
await check('coaches cannot submit official scores, read signatures or see other teams’ practice runs', async () => {
  const r = await page.evaluate(async () => {
    const { createStore } = await import('./js/store.js'); const s = await createStore(); const out = [];
    try { await s.submitScore({ eventId: 'ev1', teamId: 't9120', round: 2, total: 1, gp: 3, judgeUid: s.user.uid }, 'x'); out.push('allowed'); } catch (e) { out.push(e.code); }
    out.push(await new Promise((res) => { let rows; const un = s.subscribe('practice', (r) => { rows = r; }); un(); res(rows.length > 0 && rows.every((x) => x.teamId === s.user.teamId)); }));
    try { await s.get('signatures', 't9120_R2'); out.push('allowed'); } catch (e) { out.push(e.code); }
    return out;
  });
  assert.deepEqual(r, ['permission-denied', true, 'permission-denied']);
});
await check('team can delete only via UI its own practice run', async () => {
  page.once('dialog', (d) => d.accept());
  await page.$eval('[data-del]', (e) => e.click());
  await page.waitForFunction(() => document.querySelectorAll('.history li').length === 6);
});

await check('coach: renames their team and adds/removes a member (but cannot touch other teams)', async () => {
  await goHash(page, 'team');
  await page.$eval('#t-name', (e) => { e.value = ''; }); await page.type('#t-name', 'Robo Rangers <i>X</i>'); await page.click('#t-rename button');
  await page.waitForFunction(() => document.querySelector('#t-title').textContent.includes('Robo Rangers <i>X</i>'));
  assert.equal(await page.$('#t-title i'), null, 'team name is HTML-escaped');
  await page.type('#t-email', 'Parent@Gmail.com'); await page.type('#t-pname', 'Sam’s mom'); await page.click('#t-add button');
  await page.waitForFunction(() => document.querySelector('#t-people').textContent.includes('parent@gmail.com'));
  await page.type('#t-email', 'parent@gmail.com'); await page.click('#t-add button');
  await page.waitForFunction(() => !document.getElementById('t-err').hidden);
  assert.match(await text(page, '#t-err'), /already on your team/);
  const r = await page.evaluate(async () => {
    const { createStore } = await import('./js/store.js'); const s = await createStore(); const out = [];
    for (const f of [() => s.patch('teams', 't5530', { name: 'Hijack' }), () => s.patch('teams', 't4201', { number: 1 }), () => s.put('access', 'x@gmail.com', { role: 'coach', teamId: 't4201', addedBy: s.user.email }),
      () => s.put('access', 'y@gmail.com', { role: 'member', teamId: 't5530', addedBy: s.user.email }), () => s.remove('access', 'coach@demo.test')]) {
      try { await f(); out.push('allowed'); } catch (e) { out.push(e.code); }
    }
    return out;
  });
  assert.deepEqual(r, Array(5).fill('permission-denied'));
  page.once('dialog', (d) => d.accept());
  await page.$eval('[data-rm="parent@gmail.com"]', (e) => e.click());
  await page.waitForFunction(() => !document.querySelector('#t-people').textContent.includes('parent@gmail.com'));
  await shot(page, 'flow-team');
});
await page.evaluate(() => document.getElementById('signout').click());
await login(page, 'member@demo.test');
await check('member: practice + stats work, team page is read-only, cannot delete a teammate’s run', async () => {
  await goHash(page, 'team'); assert.equal(await page.$('#t-add'), null); assert.equal(await page.$('#t-rename'), null);
  await goHash(page, 'stats'); assert.ok((await page.$$('.history li')).length >= 6);
  const del = await page.$$eval('.history li', (l) => l.filter((x) => x.querySelector('[data-del]')).length);
  assert.ok(del < (await page.$$('.history li')).length, 'member only sees Delete on their own runs');
});
await page.evaluate(() => document.getElementById('signout').click());
await login(page, 'admin@demo.test');
await check('admin: events, teams, people & access, CSV, edit score, delete score', async () => {
  await goHash(page, 'admin');
  await page.type('#a-evn', 'State <b>Finals</b>'); await page.click('#a-ev button');
  await page.waitForFunction(() => document.querySelector('#a-events').textContent.includes('State'));
  assert.equal(await page.$('#a-events b b'), null, 'event names are HTML-escaped');
  await page.$eval('[data-evlive]', (e) => e.click());
  await page.waitForFunction(() => document.querySelectorAll('#a-events .live-b').length === 1);
  await page.click('#a-team button'); assert.match(await text(page, '#a-terr'), /number is required/);
  await page.type('#a-tn', '55'); await page.click('#a-team button'); assert.match(await text(page, '#a-terr'), /name is required/);
  await page.$eval('#a-tn', (e) => { e.value = ''; });
  await page.type('#a-tn', '1234'); await page.type('#a-tname', 'Test <b>Team</b>'); await page.click('#a-team button');
  await page.waitForFunction(() => document.querySelector('#a-teams').textContent.includes('#1234'));
  assert.equal(await page.$('#a-teams b b'), null, 'team names are HTML-escaped');
  await page.$eval('.bulk summary', (e) => e.click());
  await page.type('#a-bulk', '777, Alpha\n888, Beta\nbad line'); await page.$eval('#a-bulkgo', (e) => e.click());
  await page.waitForFunction(() => document.querySelector('#a-teams').textContent.includes('#888'));
  await page.type('#a-ue', 'NewJudge@Gmail.com'); await page.select('#a-ur', 'judge'); await page.click('#a-user button');
  await page.waitForFunction(() => document.querySelector('#a-users').textContent.includes('newjudge@gmail.com'));
  await page.type('#a-ue', 'second.coach@gmail.com'); await page.select('#a-ur', 'coach'); await page.select('#a-ut', 't4201'); await page.click('#a-user button');
  await page.waitForFunction(() => document.querySelector('#a-users').textContent.includes('second.coach@gmail.com'));
  await page.type('#a-ue', 'friend@gmail.com'); await page.select('#a-ur', 'admin'); await page.click('#a-user button');
  await page.waitForFunction(() => document.querySelector('#a-users').textContent.includes('friend@gmail.com'));
  assert.equal(await page.$('[data-rmp="admin@demo.test"]'), null, 'no Remove button for yourself');
  await page.type('#a-ue', 'not an email'); await page.click('#a-user button');
  await page.waitForFunction(() => !document.getElementById('a-uerr').hidden);
  await page.$eval('#a-ue', (e) => { e.value = ''; });
  const csv = await page.evaluate(async () => {
    let captured = ''; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then((t) => { captured = t; }); return orig(b); };
    HTMLAnchorElement.prototype.click = function () {}; document.getElementById('a-csv').click();
    await new Promise((r) => setTimeout(r, 200)); return captured;
  });
  const lines = csv.trim().split('\n');
  assert.ok(lines[0].startsWith('event,team_number,team_name,match,total'), 'csv header');
  assert.ok(lines.length > 15, 'csv has rows');
  page.on('dialog', (d) => d.accept());
  const n0 = (await page.$$('#a-scores tr')).length;
  await page.$eval('[data-delscore="ev1_t9120_R1"]', (e) => e.click());
  await page.waitForFunction((n) => document.querySelectorAll('#a-scores tr').length === n - 1, {}, n0);
  await page.$eval('[data-sig]', (e) => e.click()); await page.waitForSelector('dialog[open]');
  await page.$eval('dialog [data-close]', (e) => e.click());
});
await check('host can re-score a match that was deleted', async () => {
  await goHash(page, 'judge'); await page.select('#sc-team', 't9120');
  assert.equal(await page.$eval('#sc-round', (e) => e.value), '1');
});
await check('theme toggle switches and persists', async () => {
  await page.$eval('#theme', (e) => e.click());
  const t = await page.evaluate(() => document.documentElement.dataset.theme);
  assert.ok(t === 'dark' || t === 'light');
  await shot(page, `flow-theme-${t}`);
});
await check('no browser errors during the whole flow', async () => assert.deepEqual(page.errors, []));
await page.ctx.close();

// ── C. desktop: second tab gets live updates (storage events ≈ Firestore snapshots) ──
console.log('\n[live] two tabs');
{
  const a = await newPage(VIEWPORTS[4]);
  await go(a);
  const b = await a.ctx.newPage(); await forceDemo(b); await b.setViewport({ width: 1280, height: 800 });
  await b.goto(base + '#/login', { waitUntil: 'networkidle0' });
  await b.click('[data-demo="admin@demo.test"]');
  await b.waitForFunction(() => !location.hash.includes('login'));
  await check('public dashboard updates live when another tab changes data', async () => {
    const before = (await a.$$('.standings .row')).length;
    await b.evaluate(async () => { const { createStore } = await import('./js/store.js'); const s = await createStore(); await s.put('teams', 't5', { number: 5, name: 'Live Add' }); const ev = await s.get('events', 'ev1'); await s.patch('events', 'ev1', { teamIds: [...ev.teamIds, 't5'] }); });
    await a.waitForFunction((n) => document.querySelectorAll('.standings .row').length === n + 1, { timeout: 4000 }, before);
  });
  await a.ctx.close();
}

await browser.close(); server.close();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('Failed:\n - ' + problems.join('\n - ')); process.exit(1); }
