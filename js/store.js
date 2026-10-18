// Data layer. One tiny interface, two backends:
//   • FirebaseStore — Google sign-in via Firebase Auth + Firestore (closed system: access/{gmail} allow-list)
//   • DemoStore     — localStorage, seeded with fake data; mirrors the Firestore rules in firestore.rules
import { firebaseConfig, FIREBASE_SDK_VERSION, isConfigured } from './firebase-config.js';
import { scoreAll, defaultState } from './scoring.js';
import { MISSIONS, MATCHES_PER_TEAM } from './missions.js';

export const ROLES = ['admin', 'host', 'judge', 'coach', 'member'];
export const ROLE_LABEL = { admin: 'Admin', host: 'Event host', judge: 'Judge', coach: 'Coach', member: 'Team member' };
export const isTeamSide = (role) => role === 'coach' || role === 'member';
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Events a signed-in user may run: admins all of them; anyone else only the events whose eventHosts list has their
// email (host is a per-event modifier — a coach or judge can be a host too). eventHosts rows are { id: eventId, emails }.
export const hostedEvents = (user, events, eventHosts) => (user?.role === 'admin' ? events
  : user ? events.filter((e) => eventHosts.some((h) => h.id === e.id && (h.emails || []).includes(user.email))) : []);
// Events the user is a listed referee for (a per-event modifier, so a coach or member can referee too).
export const refereedEvents = (user, events, eventJudges) => (user ? events.filter((e) => eventJudges.some((j) => j.id === e.id && (j.emails || []).includes(user.email))) : []);
// Events a user may enter official scores for: admins all; base-role judges all (or just their eventIds);
// plus every event they host or referee.
export const scoringEvents = (user, events, eventHosts, eventJudges = []) => {
  if (!user) return [];
  if (user.role === 'admin') return events;
  const own = user.role === 'judge' ? (user.eventIds ? events.filter((e) => user.eventIds.includes(e.id)) : events) : [];
  return [...new Map([...own, ...hostedEvents(user, events, eventHosts), ...refereedEvents(user, events, eventJudges)].map((e) => [e.id, e])).values()];
};
export const hasRole = (u, r) => Boolean(u) && (r === 'host' ? u.host : u.role === r);
export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const scoreId = (eventId, teamId, round) => `${eventId}_${teamId}_R${round}`;
export const eventTeams = (ev, teams) => (ev?.teamIds?.length ? teams.filter((t) => ev.teamIds.includes(t.id)) : teams);

const err = (code, message) => Object.assign(new Error(message || code), { code });
const denied = (m) => err('permission-denied', m || 'Missing or insufficient permissions.');

// ───────────────────────────── Demo backend ─────────────────────────────
const KEY = 'glowboard-demo-v2';
const COLS = ['teams', 'events', 'eventHosts', 'eventJudges', 'scores', 'signatures', 'practice', 'access'];

function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Plausible random match built through the real rules (so demo data always scores legally).
export function randomMatch(rand, skill = 0.5) {
  const s = defaultState();
  const p = (x = 1) => rand() < Math.min(0.97, skill * x);
  s.equip = p(1.3);
  s.tokens = 6 - Math.floor(rand() * (1 + (1 - skill) * 5));
  const m = s.m;
  m.m01.drone = p(1.2); m.m01.lidar = p(0.6);
  m.m02.seeds = Math.round(rand() * 3 * skill + rand());
  m.m03.flag = p(1.2); m.m03.rock = p(0.5);
  m.m04.leaves = p(1) ? (p(0.7) ? 2 : 1) : 0; m.m04.katOriginal = p(1);
  m.m05.root = p(1) ? (p(0.6) ? 'full' : 'partial') : 'none';
  m.m06.ant = p(1.1); m.m06.fragments = Math.round(rand() * 4 * skill);
  m.m07.mycelium = p(0.9); m.m07.connections = p(0.5) ? Math.round(rand() * 2) : 0;
  m.m08.vine = p(0.8);
  m.m09.platform = p(0.9); m.m09.camera = p(0.7); m.m09.seed = p(0.7);
  m.m10.spider = p(1); m.m10.snail = p(1);
  m.m11.cover = p(1);
  m.m12.cane = p(0.8); m.m12.tie = p(0.6);
  m.m13.species = p(0.7); m.m13.trees = p(0.7);
  m.m14.contained = Math.round(rand() * 4 * skill); m.m14.onMat = Math.round(rand() * m.m14.contained);
  m.m15.canopy = p(0.8); m.m15.skylight = p(0.7); m.m15.hatch = p(0.7);
  m.m15.dock = ['mine', 'city', 'farm'][Math.floor(rand() * 3)];
  return scoreAll(s);
}

const DEMO_TEAMS = [
  [4201, 'Robo Rangers'], [5530, 'Byte Me'], [1187, 'Gear Gliders'], [7742, 'Canopy Coders'],
  [3099, 'Moss Machines'], [6014, 'The Leaf Lords'], [2468, 'Spore Squad'], [9120, 'Vine Divers'],
];
export const DEMO_ACCOUNTS = [
  { email: 'admin@demo.test', role: 'admin', name: 'Dana (admin)' },
  { email: 'host@demo.test', role: 'host', name: 'Harper (host)' },
  { email: 'cohost@demo.test', role: 'coach', teamId: 't5530', host: true, name: 'Coach Cam (also host)' },
  { email: 'judge@demo.test', role: 'judge', name: 'Jo (judge)' },
  { email: 'coach@demo.test', role: 'coach', teamId: 't4201', name: 'Coach Casey' },
  { email: 'member@demo.test', role: 'member', teamId: 't4201', name: 'Sam (parent)' },
];

function seedDemo() {
  const rand = mulberry(2026);
  const db = Object.fromEntries(COLS.map((c) => [c, {}]));
  const E1 = 'ev1', E2 = 'ev2';
  db.events[E1] = { id: E1, name: 'Regional Qualifier (demo)', date: '2026-11-14', live: true, teamIds: DEMO_TEAMS.map(([n]) => `t${n}`), createdAt: 2 };
  db.events[E2] = { id: E2, name: 'Season Opener Scrimmage (demo)', date: '2026-10-25', live: false, teamIds: ['t4201', 't5530'], createdAt: 1 };
  db.eventHosts[E2] = { id: E2, emails: ['host@demo.test', 'cohost@demo.test'] };
  DEMO_TEAMS.forEach(([number, name], i) => {
    const id = `t${number}`;
    db.teams[id] = { id, number, name, createdBy: 'demo' };
    const skill = 0.35 + (i % 4) * 0.12 + rand() * 0.15;
    const rounds = i === 7 ? 0 : (i % 3 === 0 ? 2 : 3);
    for (let r = 1; r <= rounds; r++) {
      const res = randomMatch(rand, skill);
      const sid = scoreId(E1, id, r);
      db.scores[sid] = {
        id: sid, eventId: E1, teamId: id, number, name, round: r, total: res.total, gp: res.gp, state: res.state,
        result: slim(res), hasSignature: true, initials: initials(name), judgeUid: 'judge@demo.test', judgeName: 'Jo (judge)',
        table: String(1 + (i % 4)), createdAt: Date.now() - (rounds - r + 1) * 3600e3 - i * 60e3,
      };
      db.signatures[sid] = { id: sid, signature: '' }; // demo seed has no drawn signature
    }
    // a few practice runs for the first team
    if (i === 0) for (let k = 0; k < 6; k++) {
      const res = randomMatch(rand, 0.25 + k * 0.08);
      const pid = `p${k}`;
      db.practice[pid] = { id: pid, uid: 'coach@demo.test', by: 'Coach Casey', teamId: id, total: res.total, state: res.state, result: slim(res), createdAt: Date.now() - (6 - k) * 86400e3 };
    }
  });
  DEMO_ACCOUNTS.forEach((a) => { db.access[a.email] = { id: a.email, ...a, addedBy: 'demo' }; });
  return db;
}

export const initials = (name) => String(name).split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
// Keep score docs small: per-mission points + the lines that earned them.
export const slim = (res) => ({
  equipment: res.equipment, tokens: res.tokens,
  missions: res.missions.map((m) => ({ id: m.id, num: m.num, name: m.name, points: m.points, lines: m.lines, voided: m.voided })),
});

class DemoStore {
  mode = 'demo';
  constructor() {
    this.listeners = new Set();
    this.authListeners = new Set();
    try { this.db = JSON.parse(localStorage.getItem(KEY)) || null; } catch { this.db = null; }
    if (!this.db) { this.db = seedDemo(); this.persist(); }
    try { this.session = sessionStorage.getItem(KEY + '-session'); } catch { this.session = null; }
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY) return;
      try { this.db = JSON.parse(e.newValue) || this.db; } catch { /* ignore */ }
      this.emit();
    });
  }
  persist() { try { localStorage.setItem(KEY, JSON.stringify(this.db)); } catch { /* quota / private mode */ } }
  emit() { this.listeners.forEach((f) => f()); }
  async init() { this.emitAuth(); }

  // ----- auth -----
  get user() {
    const a = this.db.access[this.session];
    return a ? { uid: a.id, email: a.id, name: a.name || a.id.split('@')[0], role: a.role, teamId: a.teamId || null, host: a.role === 'host' || a.host === true, eventIds: a.eventIds || null } : null;
  }
  emitAuth() { const u = this.user; this.authListeners.forEach((f) => f(u)); }
  onAuth(cb) { this.authListeners.add(cb); cb(this.user); return () => this.authListeners.delete(cb); }
  async signInAs(email) {
    const e = normEmail(email);
    if (!this.db.access[e]) throw err('not-authorized', `${e} isn’t on the access list. Ask your coach or an admin to add this Google account.`);
    this.session = e;
    try { sessionStorage.setItem(KEY + '-session', e); } catch { /* ignore */ }
    this.emitAuth();
  }
  async signOut() {
    this.session = null;
    try { sessionStorage.removeItem(KEY + '-session'); } catch { /* ignore */ }
    this.emitAuth();
  }

  // ----- rules (mirrors firestore.rules) -----
  need(pred) { const u = this.user; if (!u || !pred(u)) throw denied(); return u; }
  isAdmin(u) { return u?.role === 'admin'; }
  coachOf(u, teamId) { return u?.role === 'coach' && u.teamId === teamId; }
  onTeam(u, teamId) { return isTeamSide(u?.role) && u.teamId === teamId; }
  isHost(u) { return Boolean(u?.host); }
  refereeOf(u, eventId) { return Boolean(u) && (this.db.eventJudges[eventId]?.emails || []).includes(u.email); }
  judgeFor(u, eventId) { return this.isAdmin(u) || this.refereeOf(u, eventId) || (u?.role === 'judge' && (!u.eventIds || u.eventIds.includes(eventId))); }
  hostOf(u, eventId) { return this.isHost(u) && (this.db.eventHosts[eventId]?.emails || []).includes(u.email); }
  validTeam(d) { return Number.isInteger(d.number) && d.number > 0 && typeof d.name === 'string' && d.name.length > 0 && d.name.length <= 60; }

  // ----- data -----
  subscribe(col, cb) {
    const run = () => {
      const u = this.user;
      let rows = Object.values(this.db[col] || {});
      if (col === 'signatures') rows = [];
      if (col === 'eventJudges') rows = this.isAdmin(u) ? rows : rows.filter((r) => u && (r.emails || []).includes(u.email));
      if (col === 'eventHosts') rows = this.isAdmin(u) ? rows : (u?.host ? rows.filter((r) => (r.emails || []).includes(u.email)) : []);
      if (col === 'access') rows = this.isAdmin(u) ? rows : rows.filter((r) => (u?.role === 'coach' && r.teamId === u.teamId) || (u?.host && r.role === 'judge' && r.addedBy === u.email));
      if (col === 'practice') rows = this.isAdmin(u) ? rows : (isTeamSide(u?.role) ? rows.filter((r) => r.teamId === u.teamId) : []);
      cb(rows.map((r) => ({ ...r })));
    };
    this.listeners.add(run);
    run();
    return () => this.listeners.delete(run);
  }
  async put(col, id, data) {
    const u = this.user, ex = this.db[col][id];
    if (col === 'access') {
      if (id !== id.toLowerCase() || !EMAIL_RE.test(id)) throw denied();
      if (this.isAdmin(u)) {
        if (!ROLES.includes(data.role) || (['coach', 'member'].includes(data.role) && typeof data.teamId !== 'string')) throw denied();
        if (id === u.email && data.role !== 'admin') throw denied('You can’t remove your own admin access.');
      } else {
        const asCoach = this.coachOf(u, data.teamId) && data.role === 'member' && (!ex || (ex.role === 'member' && ex.teamId === data.teamId)) && data.addedBy === u?.email
          && Object.keys(data).every((k) => ['role', 'teamId', 'name', 'addedBy', 'addedAt'].includes(k));
        // hosts add referees limited to ONE event they host
        const asHost = this.isHost(u) && !ex && data.role === 'judge' && data.addedBy === u.email && Array.isArray(data.eventIds) && data.eventIds.length === 1 && this.hostOf(u, data.eventIds[0])
          && Object.keys(data).every((k) => ['role', 'name', 'addedBy', 'addedAt', 'eventIds'].includes(k));
        if (!asCoach && !asHost) throw denied();
      }
    } else if (col === 'teams') {
      if (!(this.isAdmin(u) || (this.isHost(u) && !ex && data.createdBy === u.email))) throw denied();
      if (!this.validTeam(data) || id !== `t${data.number}`) throw err('invalid', 'A team needs a number and a name.');
      if (!this.isAdmin(u) && data.createdBy !== u.email) throw denied();
    } else if (col === 'eventJudges') {
      this.need((x) => this.isAdmin(x) || this.hostOf(x, id));
      if (!Array.isArray(data.emails)) throw err('invalid', 'emails must be a list.');
    } else if (col === 'eventHosts') {
      this.need(this.isAdmin);
      if (!Array.isArray(data.emails)) throw err('invalid', 'emails must be a list.');
    } else if (col === 'events') {
      this.need(this.isAdmin);
      if (!String(data.name || '').trim()) throw err('invalid', 'An event needs a name.');
    } else if (col === 'scores') {
      this.need((x) => this.judgeFor(x, data.eventId) || this.hostOf(x, data.eventId));
      if (ex) this.need(this.isAdmin);
      else if (data.judgeUid !== u.uid || data.hasSignature !== true || ![2, 3, 4].includes(data.gp) || !(Number.isInteger(data.total) && data.total >= 0 && data.total <= 1000)) throw denied();
      if (!this.db.events[data.eventId] || !this.db.teams[data.teamId] || ![1, 2, 3].includes(data.round) || id !== scoreId(data.eventId, data.teamId, data.round)) throw denied();
    } else if (col === 'practice') {
      if (!this.onTeam(u, data.teamId) || data.uid !== u.uid || ex) throw denied();
    } else throw denied();
    this.db[col][id] = { ...data, id };
    this.persist(); this.emit();
  }
  async patch(col, id, fields) {
    const u = this.user, ex = this.db[col][id];
    if (!ex) throw err('not-found', 'Not found.');
    if (col === 'teams') {
      const nameOnly = Object.keys(fields).every((k) => k === 'name');
      if (!(this.isAdmin(u) || (this.coachOf(u, id) && nameOnly) || (this.isHost(u) && ex.createdBy === u.email && nameOnly))) throw denied();
      if (!this.validTeam({ ...ex, ...fields })) throw err('invalid', 'A team needs a number and a name (max 60 characters).');
    } else if (col === 'events') {
      if (!this.isAdmin(u)) { // hosts may only touch the team list and schedule of events they host
        if (!(this.hostOf(u, id) && Object.keys(fields).every((k) => ['teamIds', 'schedule'].includes(k)))) throw denied();
      }
    } else throw denied();
    this.db[col][id] = { ...ex, ...fields };
    this.persist(); this.emit();
  }
  async submitScore(doc, signature) {
    const id = scoreId(doc.eventId, doc.teamId, doc.round);
    const had = this.db.signatures[id];
    await this.put('scores', id, { ...doc, hasSignature: true }); // throws if not allowed → signature untouched
    if (had && this.user.role !== 'admin') throw denied();
    this.db.signatures[id] = { id, signature, judgeUid: doc.judgeUid };
    this.persist(); this.emit();
  }
  async get(col, id) {
    if (col === 'signatures') { const ev = id.split('_')[0]; this.need((x) => this.judgeFor(x, ev) || this.hostOf(x, ev)); }
    if (col === 'eventJudges') this.need((x) => this.isAdmin(x) || this.hostOf(x, id) || (this.db.eventJudges[id]?.emails || []).includes(x.email));
    const r = this.db[col][id];
    return r ? { ...r } : null;
  }
  async remove(col, id) {
    const u = this.user, row = this.db[col][id];
    if (col === 'access') {
      const ok = (this.isAdmin(u) && id !== u.email) || (this.coachOf(u, row?.teamId) && row?.role === 'member')
        || (this.isHost(u) && row?.role === 'judge' && row.addedBy === u.email);
      if (!ok) throw denied(id === u?.email ? 'You can’t remove your own access.' : undefined);
    } else if (col === 'practice') {
      if (!(this.isAdmin(u) || this.coachOf(u, row?.teamId) || (this.onTeam(u, row?.teamId) && row.uid === u.uid))) throw denied();
    } else if (col === 'teams') {
      if (!(this.isAdmin(u) || (this.isHost(u) && row?.createdBy === u.email))) throw denied();
    } else if (col === 'eventJudges') this.need((x) => this.isAdmin(x) || this.hostOf(x, id));
    else if (['events', 'eventHosts', 'scores'].includes(col)) this.need(this.isAdmin);
    else throw denied();
    delete this.db[col][id];
    if (col === 'scores') delete this.db.signatures[id];
    this.persist(); this.emit();
  }
  async resetDemo() { this.need(this.isAdmin); this.db = seedDemo(); this.session = 'admin@demo.test'; this.persist(); this.emit(); this.emitAuth(); }
  newId(prefix = 'x') { return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }
}

// ───────────────────────────── Firebase backend ─────────────────────────────
class FirebaseStore {
  mode = 'firebase';
  constructor() { this.cur = null; this.authListeners = new Set(); }
  async init() {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
    const [app, auth, fs] = await Promise.all([
      import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`), import(`${base}/firebase-firestore.js`),
    ]);
    this.sdk = { app, auth, fs };
    this.fapp = app.initializeApp(firebaseConfig);
    this.auth = auth.getAuth(this.fapp);
    this.fdb = fs.getFirestore(this.fapp);
    auth.onAuthStateChanged(this.auth, async (fu) => {
      if (!fu) { this.cur = null; return this.emitAuth(); }
      const prof = await this.fetchProfile(fu).catch(() => null);
      // Signed in with Google but not on the access list → no permissions at all: sign straight back out.
      if (!prof) { this.cur = null; this.emitAuth(); auth.signOut(this.auth).catch(() => {}); return; }
      this.cur = prof;
      this.emitAuth();
    });
  }
  async fetchProfile(fu) {
    const { fs } = this.sdk;
    const email = normEmail(fu.email);
    let d;
    try { d = await fs.getDoc(fs.doc(this.fdb, 'access', email)); } catch (e) {
      // Not "you're not listed" — Firestore refused to even answer. Almost always: the rules aren't published yet.
      throw err(e.code || 'unavailable', e.code === 'permission-denied'
        ? `Signed in as ${email}, but Firestore blocked reading the access list. Publish the latest firestore.rules (Firebase console → Firestore Database → Rules → paste → Publish), then try again.`
        : `Signed in as ${email}, but the access list couldn’t be read (${e.code || e.message}). Check your connection and that Firestore is created, then try again.`);
    }
    if (!d.exists()) return null;
    const a = d.data();
    return { uid: fu.uid, email, name: a.name || email.split('@')[0], role: a.role, teamId: a.teamId || null, host: a.role === 'host' || a.host === true, eventIds: a.eventIds || null };
  }
  get user() { return this.cur; }
  emitAuth() { this.authListeners.forEach((f) => f(this.cur)); }
  onAuth(cb) { this.authListeners.add(cb); cb(this.cur); return () => this.authListeners.delete(cb); }
  async signInGoogle() {
    const { auth } = this.sdk;
    let cred;
    try { cred = await auth.signInWithPopup(this.auth, new auth.GoogleAuthProvider()); } catch (e) { throw friendly(e); }
    const email = normEmail(cred.user.email);
    const prof = await this.fetchProfile(cred.user);
    if (!prof) throw err('not-authorized', `${email} isn’t on the access list. Ask your coach or an admin to add this Google account, then sign in again. (First admin? In Firestore create collection “access”, Document ID exactly “${email}”, field role = admin.)`);
    return prof;
  }
  async signOut() { await this.sdk.auth.signOut(this.auth); }
  subscribe(col, cb) {
    const { fs } = this.sdk;
    const u = this.cur;
    let q = fs.collection(this.fdb, col);
    if (col === 'signatures') { cb([]); return () => {}; }
    if (col === 'access' && u?.role !== 'admin') {
      // a coach sees their team; a host sees the referees they added — a coach who is also a host sees both
      const queries = [];
      if (u?.role === 'coach') queries.push(fs.query(q, fs.where('teamId', '==', u.teamId)));
      if (u?.host) queries.push(fs.query(q, fs.where('role', '==', 'judge'), fs.where('addedBy', '==', u.email)));
      if (!queries.length) { cb([]); return () => {}; }
      const parts = queries.map(() => []);
      const emit = () => cb([...new Map(parts.flat().map((r) => [r.id, r])).values()]);
      const unsubs = queries.map((qq, i) => fs.onSnapshot(qq, (snap) => { parts[i] = snap.docs.map((d) => ({ id: d.id, ...d.data() })); emit(); }, (e) => console.warn('[firestore] access:', e.code)));
      return () => unsubs.forEach((f) => f());
    }
    if (col === 'eventHosts') {
      if (u?.role === 'admin') { /* all */ } else if (u?.host) q = fs.query(q, fs.where('emails', 'array-contains', u.email));
      else { cb([]); return () => {}; }
    }
    if (col === 'eventJudges') { // admins see every list; everyone else only the events they referee
      if (u?.role === 'admin') { /* all */ } else if (u) q = fs.query(q, fs.where('emails', 'array-contains', u.email));
      else { cb([]); return () => {}; }
    }
    if (col === 'practice') {
      if (isTeamSide(u?.role)) q = fs.query(q, fs.where('teamId', '==', u.teamId));
      else if (u?.role !== 'admin') { cb([]); return () => {}; }
    }
    return fs.onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => console.warn(`[firestore] ${col}:`, e.code));
  }
  async put(col, id, data) {
    const { fs } = this.sdk;
    const { id: _drop, ...rest } = data;
    try { await fs.setDoc(fs.doc(this.fdb, col, id), rest); } catch (e) { throw friendly(e); }
  }
  async patch(col, id, fields) {
    const { fs } = this.sdk;
    try { await fs.updateDoc(fs.doc(this.fdb, col, id), fields); } catch (e) { throw friendly(e); }
  }
  async submitScore(doc, signature) {
    const { fs } = this.sdk;
    const id = scoreId(doc.eventId, doc.teamId, doc.round);
    const { id: _drop, ...rest } = doc;
    try {
      const b = fs.writeBatch(this.fdb); // atomic: a rejected score never leaves an orphan signature
      b.set(fs.doc(this.fdb, 'scores', id), { ...rest, hasSignature: true });
      b.set(fs.doc(this.fdb, 'signatures', id), { signature, judgeUid: doc.judgeUid, createdAt: doc.createdAt });
      await b.commit();
    } catch (e) { throw friendly(e); }
  }
  async get(col, id) {
    const { fs } = this.sdk;
    try { const d = await fs.getDoc(fs.doc(this.fdb, col, id)); return d.exists() ? { id: d.id, ...d.data() } : null; } catch (e) { throw friendly(e); }
  }
  async remove(col, id) {
    if (col === 'scores') { try { await this.sdk.fs.deleteDoc(this.sdk.fs.doc(this.fdb, 'signatures', id)); } catch { /* may not exist */ } }
    try { await this.sdk.fs.deleteDoc(this.sdk.fs.doc(this.fdb, col, id)); } catch (e) { throw friendly(e); }
  }
  newId(prefix = 'x') { return this.sdk.fs.doc(this.sdk.fs.collection(this.fdb, 'ids')).id.slice(0, 12) || prefix + Date.now(); }
}

function friendly(e) {
  const c = e.code || '';
  const map = {
    'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.', 'auth/cancelled-popup-request': 'Google sign-in was cancelled.',
    'auth/popup-blocked': 'Your browser blocked the Google pop-up — allow pop-ups for this site and try again.',
    'auth/unauthorized-domain': 'This site’s domain isn’t authorized in Firebase → Authentication → Settings → Authorized domains.',
    'auth/operation-not-allowed': 'Google sign-in isn’t enabled yet (Firebase → Authentication → Sign-in method → Google).',
    'auth/too-many-requests': 'Too many attempts — wait a minute and try again.',
    'permission-denied': 'You don’t have permission to do that (or that score already exists — ask an admin to correct it).',
  };
  return err(c, map[c] || e.message || 'Something went wrong.');
}

export async function createStore() {
  const store = isConfigured() ? new FirebaseStore() : new DemoStore();
  await store.init();
  return store;
}
export { MISSIONS, MATCHES_PER_TEAM };
