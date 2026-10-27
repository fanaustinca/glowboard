// Data layer. One tiny interface, two backends:
//   • FirebaseStore — Google sign-in via Firebase Auth + Firestore (closed system: access/{gmail} allow-list)
//   • DemoStore     — localStorage, seeded with fake data; mirrors the Firestore rules in firestore.rules
import { firebaseConfig, FIREBASE_SDK_VERSION, isConfigured } from './firebase-config.js';
import { scoreAll, defaultState, editionOf, standings } from './scoring.js';
import { MISSIONS, MATCHES_PER_TEAM, EDITION_IDS, EDITIONS } from './missions.js';

export const ROLES = ['admin', 'host', 'judge', 'coach', 'member'];
export const ROLE_LABEL = { admin: 'Admin', host: 'Event host', judge: 'Referee', coach: 'Coach', member: 'Team member' };
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Events a signed-in user may run: admins all of them; anyone else only the events whose eventHosts list has their
// email (host is a per-event modifier — a coach or judge can be a host too). eventHosts rows are { id: eventId, emails }.
export const hostedEvents = (user, events, eventHosts) => (user?.role === 'admin' ? events
  : user ? events.filter((e) => eventHosts.some((h) => h.id === e.id && (h.emails || []).includes(user.email))) : []);
// Events the user is a listed referee for (a per-event modifier, so a coach or member can referee too).
export const refereedEvents = (user, events, eventJudges) => (user ? events.filter((e) => eventJudges.some((j) => j.id === e.id && (j.emails || []).includes(user.email))) : []);
// Events a user may enter official scores for: admins all; everyone else only the events they were added to
// (referee list, a referee account's eventIds) or host.
export const scoringEvents = (user, events, eventHosts, eventJudges = []) => {
  if (!user) return [];
  if (user.role === 'admin') return events;
  const own = user.role === 'judge' && user.eventIds ? events.filter((e) => user.eventIds.includes(e.id)) : [];
  return [...new Map([...own, ...hostedEvents(user, events, eventHosts), ...refereedEvents(user, events, eventJudges)].map((e) => [e.id, e])).values()];
};
// Only people who can actually score get the Judge page: a judge account, or anyone with at least one event to score.
export const canScore = (user, scoreable) => Boolean(user) && (user.role === 'judge' || scoreable.length > 0);
// Pseudo-roles: 'host' = host of ≥1 event, 'team' = on ≥1 team, 'signedin' = anyone signed in.
export const hasRole = (u, r) => Boolean(u) && (r === 'host' ? u.host : r === 'team' ? Boolean(u.teams?.length) : r === 'signedin' ? true : u.role === r);
// A person can be on many teams, with a role per team (coach only where the roster says so).
export const isCoachOn = (u, teamId) => Boolean(u?.teams?.some((t) => t.teamId === teamId && t.role === 'coach'));
export const coachTeamIds = (u) => (u?.teams || []).filter((t) => t.role === 'coach').map((t) => t.teamId);
export const HELP_MAX = 500;
export const validHelpId = (t) => typeof t === 'string' && /^[A-Za-z0-9]{20,48}$/.test(t);
export const newHelpId = () => { const a = new Uint8Array(24); (globalThis.crypto || window.crypto).getRandomValues(a); return [...a].map((x) => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join(''); };
export const rosterId = (teamId, email) => `${teamId}__${email}`;
export const memberDocId = (uid, teamId) => `${uid}_${teamId}`;
const ACTIVE_KEY = 'gb-active-team', LOCAL_TEAMS_KEY = 'gb-my-teams';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };
// Teams added with a team password are remembered on this device ([{teamId, password, name}]) and linked to the Google account on sign-in.
export const localTeams = () => { try { return JSON.parse(lsGet(LOCAL_TEAMS_KEY)) || []; } catch { return []; } };
export const setLocalTeams = (list) => lsSet(LOCAL_TEAMS_KEY, JSON.stringify(list));
export const rememberTeam = (e) => setLocalTeams([...localTeams().filter((x) => x.teamId !== e.teamId), e]);
export const forgetTeam = (teamId) => setLocalTeams(localTeams().filter((x) => x.teamId !== teamId));

// base = account facts; roster rows = {teamId, role} from the Google account; pw rows = valid team-password memberships.
// A coach/member base role is just a label: the real role is per team.
export function composeUser(base, rosterRows, pwRows) {
  const teams = [];
  for (const r of rosterRows) teams.push({ teamId: r.teamId, role: r.role === 'coach' ? 'coach' : 'member', via: 'roster', docId: r.id });
  for (const r of pwRows) if (!teams.some((t) => t.teamId === r.teamId)) teams.push({ teamId: r.teamId, role: 'member', via: 'password', docId: r.id });
  const pref = lsGet(ACTIVE_KEY);
  const active = teams.find((t) => t.teamId === pref) || teams.find((t) => t.role === 'coach') || teams[0] || null;
  const role = ['coach', 'member'].includes(base.role) ? (teams.some((t) => t.role === 'coach') ? 'coach' : 'member') : base.role;
  const name = base.viaPassword ? (pwRows.find((r) => r.name)?.name || base.name) : base.name;
  return { ...base, name, role, teams, teamId: active?.teamId || null, teamRole: active?.role || null };
}
export function setActivePref(teamId) { lsSet(ACTIVE_KEY, teamId); }
export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const scoreId = (eventId, teamId, round) => `${eventId}_${teamId}_R${round}`;
// Which editions an event runs ('founders' and/or 'future'); events made before editions existed are Founders-only.
export const eventEditions = (ev) => {
  const e = (Array.isArray(ev?.editions) ? ev.editions : []).filter((x) => EDITION_IDS.includes(x));
  return e.length ? EDITION_IDS.filter((x) => e.includes(x)) : ['founders'];
};
export const teamEdition = (t) => editionOf(t);
// The teams in an event: the ones added to it (events made before team lists existed have none saved and show every official team — public registrations stay out until a host adds them) that play one of its editions.
export const eventTeams = (ev, teams) => {
  const eds = eventEditions(ev);
  return (Array.isArray(ev?.teamIds) ? teams.filter((t) => ev.teamIds.includes(t.id)) : teams.filter((t) => !t.registered)).filter((t) => eds.includes(teamEdition(t)));
};
// One leaderboard per edition the event runs: [{ ed, label, future, rows: standings() }], Founders first.
export const eventBoards = (ev, teams, scores) => {
  const evTeams = eventTeams(ev, teams);
  return eventEditions(ev).map((ed) => ({
    ed, label: EDITIONS[ed].long, short: EDITIONS[ed].label, future: ed === 'future',
    rows: standings(evTeams.filter((t) => teamEdition(t) === ed), scores.filter((x) => x.eventId === ev?.id && editionOf(x) === ed), ed),
  }));
};
export const validEditions = (e) => Array.isArray(e) && e.length >= 1 && e.length <= 2 && e.every((x) => EDITION_IDS.includes(x));

const err = (code, message) => Object.assign(new Error(message || code), { code });
const denied = (m) => err('permission-denied', m || 'Missing or insufficient permissions.');

// ───────────────────────────── Demo backend ─────────────────────────────
const KEY = 'glowboard-demo-v2';
const newCode = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(100000 + (a[0] % 900000)); };
// Validates the public "Register a team" form.
function checkRegistration(f = {}) {
  const number = parseInt(f.number, 10), name = String(f.name || '').trim(), coachEmail = normEmail(f.coachEmail);
  if (!(number > 0 && number <= 999999)) throw err('invalid', 'Enter your team number.');
  if (!name || name.length > 60) throw err('invalid', 'Enter a team name (up to 60 characters).');
  if (!EMAIL_RE.test(coachEmail) || coachEmail.length > 120) throw err('invalid', 'Enter the coach’s Gmail address.');
  return { number, name, coachEmail, edition: f.edition === 'future' ? 'future' : 'founders' };
}

const COLS = ['teams', 'registrations', 'events', 'eventHosts', 'eventJudges', 'teamSecrets', 'teamMembers', 'roster', 'scores', 'signatures', 'practice', 'access'];

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
// `teams` = this person's roster entries ([teamId, role]); a person can be on many teams, with a role per team.
export const DEMO_ACCOUNTS = [
  { email: 'admin@demo.test', role: 'admin', name: 'Dana (admin)', teams: [['t3099', 'coach']] },
  { email: 'host@demo.test', role: 'host', name: 'Harper (host)' },
  { email: 'cohost@demo.test', role: 'coach', teamId: 't5530', host: true, name: 'Coach Cam (also host)', teams: [['t5530', 'coach']] },
  { email: 'judge@demo.test', role: 'judge', name: 'Jo (judge)' },
  { email: 'coach@demo.test', role: 'coach', teamId: 't4201', name: 'Coach Casey', teams: [['t4201', 'coach']] },
  { email: 'pro@demo.test', role: 'coach', teamId: 't1187', name: 'Coach Pat (3 teams)', teams: [['t1187', 'coach'], ['t7742', 'coach'], ['t4201', 'member']] },
  { email: 'member@demo.test', role: 'member', teamId: 't4201', name: 'Sam (parent)', teams: [['t4201', 'member']] },
];
const DEMO_COLORS = { t4201: ['#1a9e6b', '#f4c20d'], t5530: ['#6c4bd1', '#12b5cb', '#ff7a45'], t1187: ['#e5484d'] };

function seedDemo() {
  const rand = mulberry(2026);
  const db = Object.fromEntries(COLS.map((c) => [c, {}]));
  const E1 = 'ev1', E2 = 'ev2';
  db.events[E1] = { id: E1, name: 'Regional Qualifier (demo)', date: '2026-11-14', live: true, teamIds: DEMO_TEAMS.map(([n]) => `t${n}`), createdAt: 2 };
  db.events[E2] = { id: E2, name: 'Season Opener Scrimmage (demo)', date: '2026-10-25', live: false, teamIds: ['t4201', 't5530'], createdAt: 1 };
  db.eventHosts[E2] = { id: E2, emails: ['host@demo.test', 'cohost@demo.test'] };
  db.eventJudges[E1] = { id: E1, emails: ['judge@demo.test'] }; db.eventJudges[E2] = { id: E2, emails: ['judge@demo.test'] };
  DEMO_TEAMS.forEach(([number, name], i) => {
    const id = `t${number}`;
    db.teams[id] = { id, number, name, createdBy: 'demo', ...(DEMO_COLORS[id] ? { colors: DEMO_COLORS[id] } : {}) };
    db.teamSecrets[id] = { id, password: number === 4201 ? '424242' : String(100000 + ((number * 7919) % 900000)), enabled: true, isDefault: false, updatedBy: 'demo', updatedAt: 1 };
    const skill = 0.35 + (i % 4) * 0.12 + rand() * 0.15;
    const rounds = i === 7 ? 0 : (i % 3 === 0 ? 2 : 3);
    for (let r = 1; r <= rounds; r++) {
      const res = randomMatch(rand, skill);
      const sid = scoreId(E1, id, r);
      db.scores[sid] = {
        id: sid, eventId: E1, teamId: id, number, name, round: r, total: res.total, gp: res.gp, state: res.state,
        result: slim(res), hasSignature: true, judgeUid: 'judge@demo.test', judgeName: 'Jo (judge)', judgeEmail: 'judge@demo.test',
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
  DEMO_ACCOUNTS.forEach(({ teams = [], ...a }) => {
    db.access[a.email] = { id: a.email, ...a, addedBy: 'demo' };
    teams.forEach(([teamId, role]) => { const rid = rosterId(teamId, a.email); db.roster[rid] = { id: rid, teamId, email: a.email, role, name: a.name, addedBy: 'demo', addedAt: 1 }; });
  });
  return db;
}

export const initials = (name) => String(name).split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
// Keep score docs small: per-mission points + the lines that earned them.
export const slim = (res) => ({
  edition: editionOf(res), equipment: res.equipment, tokens: res.tokens,
  ...(res.edition === 'future' ? { penalties: res.penalties, penaltyPoints: res.penaltyPoints, zeroed: res.zeroed } : {}),
  missions: res.missions.map((m) => ({ id: m.id, num: m.num, name: m.name, points: m.points, lines: m.lines, voided: m.voided })),
});

class DemoStore {
  mode = 'demo';
  constructor() {
    this.listeners = new Set();
    this.authListeners = new Set();
    try { this.db = JSON.parse(localStorage.getItem(KEY)) || null; } catch { this.db = null; }
    if (!this.db) { this.db = seedDemo(); this.persist(); }
    for (const c of COLS) this.db[c] ||= {}; // data saved before a collection existed
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
  secretOk(row) { const sec = this.db.teamSecrets[row.teamId]; return Boolean(sec) && sec.password === row.password && sec.enabled !== false; }
  pwRows(uid) { return Object.values(this.db.teamMembers).filter((m) => m.uid === uid && this.secretOk(m)); }
  get user() {
    const s = this.session;
    if (!s) return null;
    if (s.startsWith('pw-')) { // anonymous team-password session: only the memberships whose password still matches count
      const rows = this.pwRows(s);
      if (!rows.length) return null;
      return composeUser({ uid: s, email: null, name: rows.find((r) => r.name)?.name || 'Team member', role: 'member', host: false, eventIds: null, viaPassword: true }, [], rows);
    }
    const a = this.db.access[s];
    if (!a) return null;
    return composeUser({ uid: a.id, email: a.id, name: a.name || a.id.split('@')[0], role: a.role, host: a.role === 'host' || a.host === true, eventIds: a.eventIds || null },
      Object.values(this.db.roster).filter((r) => r.email === s), this.pwRows(s));
  }
  emitAuth() { const u = this.user; this.authListeners.forEach((f) => f(u)); }
  onAuth(cb) { this.authListeners.add(cb); cb(this.user); return () => this.authListeners.delete(cb); }
  setSession(id) {
    this.session = id;
    try { id ? sessionStorage.setItem(KEY + '-session', id) : sessionStorage.removeItem(KEY + '-session'); } catch { /* ignore */ }
  }
  async signInAs(email) {
    const e = normEmail(email);
    if (!this.db.access[e]) throw err('not-authorized', `${e} isn’t on the access list. Ask your coach or an admin to add this Google account.`);
    this.setSession(e);
    this.claimRegistrations(e);
    await this.syncLocalTeams();
    this.emitAuth();
  }
  // The Gmail named in a public registration becomes that (still unofficial) team's coach as soon as they sign in.
  claimRegistrations(email) {
    for (const r of Object.values(this.db.registrations)) {
      if (r.coachEmail !== email || !this.db.teams[r.id]?.registered) continue;
      const id = rosterId(r.id, email);
      if (!this.db.roster[id]) this.db.roster[id] = { id, teamId: r.id, email, role: 'coach', name: '', addedBy: email, addedAt: Date.now() };
    }
    this.persist();
  }
  setActiveTeam(teamId) { setActivePref(teamId); this.emitAuth(); }
  // Add a team with its shared password. Stored on this device and — signed in with Google — linked to the account.
  async joinTeam(number, password, name = '') {
    const teamId = `t${parseInt(number, 10)}`;
    const secret = this.db.teamSecrets[teamId];
    if (!this.db.teams[teamId] || !secret || secret.enabled === false || secret.password !== String(password).trim()) throw err('bad-team-login', 'That team number and password don’t match — or the coach has turned password sign-in off.');
    if (!this.session) this.setSession(`pw-${Math.random().toString(36).slice(2, 10)}`);
    const uid = this.session, id = memberDocId(uid, teamId);
    this.db.teamMembers[id] = { id, uid, teamId, password: secret.password, name: String(name).trim().slice(0, 40), createdAt: Date.now() };
    rememberTeam({ teamId, password: secret.password, name: String(name).trim().slice(0, 40) });
    this.persist(); this.emit(); this.emitAuth();
    return this.user;
  }
  // Public registration: anyone creates an UNOFFICIAL team (registered: true) with its own password and joins it. A host or admin
  // makes it official by adding it to an event. The coach's email stays private (registrations/{teamId}).
  async registerTeam(f) {
    const { number, name, coachEmail, edition } = checkRegistration(f);
    const teamId = `t${number}`;
    if (this.db.teams[teamId]) throw err('exists', `Team #${number} already exists. Join it with its team password instead.`);
    if (!this.session) this.setSession(`pw-${Math.random().toString(36).slice(2, 10)}`);
    const password = newCode();
    this.db.teams[teamId] = { id: teamId, number, name, edition, registered: true, registeredBy: this.session };
    this.db.registrations[teamId] = { id: teamId, coachEmail, uid: this.session, createdAt: Date.now() };
    this.db.teamSecrets[teamId] = { id: teamId, password, enabled: true, isDefault: false, updatedAt: Date.now() };
    this.persist();
    await this.joinTeam(number, password, '');
    return { teamId, number, name, password };
  }
  async signInTeam(number, password, name = '') {
    if (this.session && !this.session.startsWith('pw-')) this.setSession(null);
    return this.joinTeam(number, password, name);
  }
  // Link the teams remembered on this device to the Google account (silently drops the ones whose password changed).
  async syncLocalTeams() {
    for (const t of localTeams()) {
      const sec = this.db.teamSecrets[t.teamId];
      if (!sec || sec.password !== t.password || sec.enabled === false) { forgetTeam(t.teamId); continue; }
      const id = memberDocId(this.session, t.teamId);
      if (!this.db.teamMembers[id] && !this.db.roster[rosterId(t.teamId, this.session)]) this.db.teamMembers[id] = { id, uid: this.session, teamId: t.teamId, password: t.password, name: t.name || '', createdAt: Date.now() };
    }
    this.persist(); this.emit();
  }
  async leaveTeam(teamId) {
    const u = this.user; if (!u) return;
    const t = u.teams.find((x) => x.teamId === teamId); if (!t) return;
    if (t.role === 'coach') throw denied('Coaches can’t leave their own team — ask another coach or an admin to remove you.');
    delete this.db.teamMembers[memberDocId(u.uid, teamId)];
    if (t.via === 'roster') delete this.db.roster[rosterId(teamId, u.email)];
    forgetTeam(teamId);
    this.persist(); this.emit(); this.emitAuth();
  }
  async signOut() {
    if (this.session?.startsWith('pw-')) { Object.values(this.db.teamMembers).filter((m) => m.uid === this.session).forEach((m) => delete this.db.teamMembers[m.id]); setLocalTeams([]); this.persist(); this.emit(); }
    this.setSession(null);
    this.emitAuth();
  }

  // ----- rules (mirrors firestore.rules) -----
  need(pred) { const u = this.user; if (!u || !pred(u)) throw denied(); return u; }
  isAdmin(u) { return u?.role === 'admin'; }
  coachOf(u, teamId) { return Boolean(u?.email) && isCoachOn(u, teamId); }
  onTeam(u, teamId) { return Boolean(u?.teams?.some((t) => t.teamId === teamId)); }
  isHost(u) { return Boolean(u?.host); }
  canSecret(u, teamId) { return this.isAdmin(u) || this.coachOf(u, teamId) || (this.isHost(u) && this.db.teams[teamId]?.createdBy === u.email); }
  refereeOf(u, eventId) { return Boolean(u) && (this.db.eventJudges[eventId]?.emails || []).includes(u.email); }
  judgeFor(u, eventId) { return this.isAdmin(u) || this.refereeOf(u, eventId) || (u?.role === 'judge' && Array.isArray(u.eventIds) && u.eventIds.includes(eventId)); }
  hostOf(u, eventId) { return this.isHost(u) && (this.db.eventHosts[eventId]?.emails || []).includes(u.email); }
  validTeam(d) {
    const c = d.colors ?? [];
    return Number.isInteger(d.number) && d.number > 0 && typeof d.name === 'string' && d.name.length > 0 && d.name.length <= 60
      && Array.isArray(c) && c.length <= 3 && c.every((x) => /^#[0-9a-fA-F]{6}$/.test(x))
      && (d.edition === undefined || EDITION_IDS.includes(d.edition));
  }

  // ----- data -----
  subscribe(col, cb) {
    const run = () => {
      const u = this.user;
      let rows = Object.values(this.db[col] || {});
      if (col === 'signatures') rows = [];
      if (col === 'teamSecrets') rows = [];
      if (col === 'registrations') rows = this.isAdmin(u) || this.isHost(u) ? rows : rows.filter((r) => u?.email && r.coachEmail === u.email);
      if (col === 'teamMembers') rows = this.isAdmin(u) ? rows : rows.filter((r) => u && (r.uid === u.uid || this.coachOf(u, r.teamId)));
      if (col === 'roster') rows = this.isAdmin(u) ? rows : rows.filter((r) => u?.email && (r.email === u.email || this.coachOf(u, r.teamId)));
      if (col === 'eventJudges') rows = this.isAdmin(u) ? rows : rows.filter((r) => u && (r.emails || []).includes(u.email));
      if (col === 'eventHosts') rows = this.isAdmin(u) ? rows : (u?.host ? rows.filter((r) => (r.emails || []).includes(u.email)) : []);
      if (col === 'access') rows = this.isAdmin(u) ? rows : rows.filter((r) => u?.host && r.role === 'judge' && r.addedBy === u.email);
      if (col === 'practice') rows = this.isAdmin(u) ? rows : rows.filter((r) => this.onTeam(u, r.teamId));
      cb(rows.map((r) => ({ ...r })));
    };
    this.listeners.add(run);
    run();
    return () => this.listeners.delete(run);
  }
  // Live lists for the app pages. (The local demo data is instant, so this is just subscribe.)
  watch(col, cb) { return this.subscribe(col, cb); }
  async put(col, id, data) {
    const u = this.user, ex = this.db[col][id];
    if (col === 'access') {
      if (id !== id.toLowerCase() || !EMAIL_RE.test(id)) throw denied();
      if (this.isAdmin(u)) {
        if (!ROLES.includes(data.role) || (['coach', 'member'].includes(data.role) && typeof data.teamId !== 'string')) throw denied();
        if (id === u.email && data.role !== 'admin') throw denied('You can’t remove your own admin access.');
      } else {
        // a coach adds a brand-new person (as a plain member); who is on the team is the roster's business
        const asCoach = !ex && this.coachOf(u, data.teamId) && data.role === 'member' && data.addedBy === u?.email
          && Object.keys(data).every((k) => ['role', 'teamId', 'name', 'addedBy', 'addedAt'].includes(k));
        // hosts add referees limited to ONE event they host
        const asHost = this.isHost(u) && !ex && data.role === 'judge' && data.addedBy === u.email && Array.isArray(data.eventIds) && data.eventIds.length === 1 && this.hostOf(u, data.eventIds[0])
          && Object.keys(data).every((k) => ['role', 'name', 'addedBy', 'addedAt', 'eventIds'].includes(k));
        // a host sets up a designated coach for a team they created (new accounts only)
        const asTeamHost = this.isHost(u) && !ex && data.role === 'coach' && data.addedBy === u.email && this.db.teams[data.teamId]?.createdBy === u.email
          && Object.keys(data).every((k) => ['role', 'teamId', 'name', 'addedBy', 'addedAt'].includes(k));
        if (!asCoach && !asHost && !asTeamHost) throw denied();
      }
    } else if (col === 'roster') {
      const okKeys = Object.keys(data).every((k) => ['teamId', 'email', 'role', 'name', 'addedBy', 'addedAt'].includes(k));
      if (!u?.email || !okKeys || typeof data.teamId !== 'string' || id !== rosterId(data.teamId, data.email) || data.email !== data.email.toLowerCase()
        || !['member', 'coach'].includes(data.role) || data.addedBy !== u.email || !this.db.teams[data.teamId]) throw denied();
      if (ex) { if (!(this.isAdmin(u) || (this.coachOf(u, ex.teamId) && ex.role === 'member' && data.role === 'member' && data.teamId === ex.teamId))) throw denied(); }
      else if (!(this.isAdmin(u) || this.coachOf(u, data.teamId) || (this.isHost(u) && this.db.teams[data.teamId].createdBy === u.email && data.role === 'coach'))) throw denied();
    } else if (col === 'teamMembers') {
      throw denied(); // joining goes through joinTeam()
    } else if (col === 'teams') {
      if (!(this.isAdmin(u) || (this.isHost(u) && !ex && data.createdBy === u.email))) throw denied();
      if (!this.validTeam(data) || id !== `t${data.number}`) throw err('invalid', 'A team needs a number and a name.');
      if (!this.isAdmin(u) && data.createdBy !== u.email) throw denied();
    } else if (col === 'teamSecrets') {
      this.need((x) => this.canSecret(x, id));
      if (typeof data.password !== 'string' || data.password.length < 6 || data.password.length > 64) throw err('invalid', 'The team password needs at least 6 characters.');
      if (!Object.keys(data).every((k) => ['password', 'updatedBy', 'updatedAt', 'enabled', 'isDefault'].includes(k)) || data.updatedBy !== u.email) throw denied();
    } else if (col === 'eventJudges') {
      this.need((x) => this.isAdmin(x) || this.hostOf(x, id));
      if (!Array.isArray(data.emails)) throw err('invalid', 'emails must be a list.');
    } else if (col === 'eventHosts') {
      this.need(this.isAdmin);
      if (!Array.isArray(data.emails)) throw err('invalid', 'emails must be a list.');
    } else if (col === 'events') {
      this.need(this.isAdmin);
      if (!String(data.name || '').trim()) throw err('invalid', 'An event needs a name.');
      if (data.editions !== undefined && !validEditions(data.editions)) throw err('invalid', 'Pick Founders, Future or both.');
    } else if (col === 'scores') {
      this.need((x) => this.judgeFor(x, data.eventId) || this.hostOf(x, data.eventId));
      if (ex) this.need(this.isAdmin);
      else if (data.judgeUid !== u.uid || data.hasSignature !== true || ![2, 3, 4].includes(data.gp) || !(Number.isInteger(data.total) && data.total >= 0 && data.total <= 5000) || !(data.edition === undefined || EDITION_IDS.includes(data.edition))) throw denied();
      if (!this.db.events[data.eventId] || !this.db.teams[data.teamId] || ![1, 2, 3].includes(data.round) || id !== scoreId(data.eventId, data.teamId, data.round)) throw denied();
    } else if (col === 'practice') {
      if (!this.onTeam(u, data.teamId) || !(Number.isInteger(data.total) && data.total >= 0 && data.total <= 5000) || !(data.edition === undefined || EDITION_IDS.includes(data.edition))) throw denied();
      if (ex) { if (!this.onTeam(u, ex.teamId) || data.teamId !== ex.teamId || data.uid !== ex.uid || data.createdAt !== ex.createdAt) throw denied(); }
      else if (data.uid !== u.uid) throw denied();
    } else throw denied();
    this.db[col][id] = { ...data, id };
    this.persist(); this.emit();
  }
  async patch(col, id, fields) {
    const u = this.user, ex = this.db[col][id];
    if (!ex) throw err('not-found', 'Not found.');
    if (col === 'teams') {
      const nameOnly = Object.keys(fields).every((k) => k === 'name');
      const nameColors = Object.keys(fields).every((k) => ['name', 'colors'].includes(k));
      const verify = this.isHost(u) && ex.registered === true && fields.registered === false && Object.keys(fields).length === 1; // a host makes a public registration official
      if (!(this.isAdmin(u) || (this.coachOf(u, id) && nameColors) || (this.isHost(u) && ex.createdBy === u.email && nameOnly) || verify)) throw denied();
      if (!this.validTeam({ ...ex, ...fields })) throw err('invalid', 'A team needs a number and a name (max 60 characters), and up to 3 valid colors.');
    } else if (col === 'roster') {
      if (!(this.isAdmin(u) && Object.keys(fields).every((k) => ['role', 'name'].includes(k)) && (!fields.role || ['member', 'coach'].includes(fields.role)))) throw denied();
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
    if (col === 'teamSecrets') this.need((x) => this.isAdmin(x) || this.coachOf(x, id));
    if (col === 'eventJudges') this.need((x) => this.isAdmin(x) || this.hostOf(x, id) || (this.db.eventJudges[id]?.emails || []).includes(x.email));
    const r = this.db[col][id];
    return r ? { ...r } : null;
  }
  async remove(col, id) {
    const u = this.user, row = this.db[col][id];
    if (col === 'access') {
      const ok = (this.isAdmin(u) && id !== u.email) || (this.isHost(u) && row?.role === 'judge' && row.addedBy === u.email);
      if (!ok) throw denied(id === u?.email ? 'You can’t remove your own access.' : undefined);
    } else if (col === 'roster') {
      const ok = this.isAdmin(u) || (this.coachOf(u, row?.teamId) && (row.role === 'member' || (row.role === 'coach' && row.addedBy === u.email && row.email !== u.email)))
        || (u?.email && row?.email === u.email && row.role === 'member');
      if (!ok) throw denied();
    } else if (col === 'practice') {
      if (!(this.isAdmin(u) || this.onTeam(u, row?.teamId))) throw denied();
    } else if (col === 'teams') {
      if (!(this.isAdmin(u) || (this.isHost(u) && row?.createdBy === u.email))) throw denied();
    } else if (col === 'registrations') this.need(this.isAdmin);
    else if (col === 'teamMembers') {
      if (!(this.isAdmin(u) || this.coachOf(u, row?.teamId) || (u && row?.uid === u.uid))) throw denied();
    } else if (col === 'eventJudges') this.need((x) => this.isAdmin(x) || this.hostOf(x, id));
    else if (col === 'scores') this.need((x) => this.isAdmin(x) || this.hostOf(x, row?.eventId));
    else if (['events', 'eventHosts'].includes(col)) this.need(this.isAdmin);
    else throw denied();
    delete this.db[col][id];
    if (col === 'scores') delete this.db.signatures[id];
    this.persist(); this.emit();
  }

  // ----- live help chat (no sign-in needed to ask; only admins reply) -----
  helpDb() { this.db.helpThreads ||= {}; this.db.helpMsgs ||= {}; return this.db; }
  async helpSend(tid, { name = '', contact = '', text }) {
    const d = this.helpDb(), u = this.user, now = Date.now();
    text = String(text || '').trim().slice(0, HELP_MAX);
    if (!u) throw denied('Sign in to use live help.');
    if (!text || !validHelpId(tid)) throw denied('Write a message first.');
    const t = d.helpThreads[tid];
    const info = { name: String(name).trim().slice(0, 60), contact: String(contact).trim().slice(0, 80), email: u?.email || '' };
    d.helpThreads[tid] = { ...(t || { createdAt: now }), ...info, lastAt: now, lastFrom: 'user', last: text.slice(0, 100), resolved: false };
    d.helpMsgs[`${tid}_${now}_${Math.random().toString(36).slice(2, 6)}`] = { tid, from: 'user', text, createdAt: now };
    this.persist(); this.emit();
  }
  async helpFetch(tid) {
    const d = this.helpDb();
    const thread = d.helpThreads[tid] ? { id: tid, ...d.helpThreads[tid] } : null;
    const msgs = Object.entries(d.helpMsgs).filter(([, m]) => m.tid === tid).map(([id, m]) => ({ id, ...m })).sort((a, b) => a.createdAt - b.createdAt);
    return { thread, msgs };
  }
  async helpThreads() {
    this.need(this.isAdmin);
    return Object.entries(this.helpDb().helpThreads).map(([id, t]) => ({ id, ...t })).sort((a, b) => b.lastAt - a.lastAt);
  }
  async helpReply(tid, text) {
    this.need(this.isAdmin);
    const d = this.helpDb(), now = Date.now(); text = String(text || '').trim().slice(0, HELP_MAX);
    if (!text || !d.helpThreads[tid]) throw denied('Write a reply first.');
    d.helpMsgs[`${tid}_${now}_${Math.random().toString(36).slice(2, 6)}`] = { tid, from: 'admin', text, createdAt: now };
    d.helpThreads[tid] = { ...d.helpThreads[tid], lastAt: now, lastFrom: 'admin', last: text.slice(0, 100) };
    this.persist(); this.emit();
  }
  async helpResolve(tid, resolved) { this.need(this.isAdmin); const d = this.helpDb(); if (d.helpThreads[tid]) d.helpThreads[tid].resolved = Boolean(resolved); this.persist(); this.emit(); }
  async helpDelete(tid) {
    this.need(this.isAdmin); const d = this.helpDb();
    delete d.helpThreads[tid]; for (const [id, m] of Object.entries(d.helpMsgs)) if (m.tid === tid) delete d.helpMsgs[id];
    this.persist(); this.emit();
  }
  async resetDemo() { this.need(this.isAdmin); this.db = seedDemo(); this.setSession('admin@demo.test'); this.persist(); this.emit(); this.emitAuth(); }
  newId(prefix = 'x') { return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }
  logEvent() {}
}

// ───────────────────────────── Firebase backend ─────────────────────────────
class FirebaseStore {
  mode = 'firebase';
  constructor() { this.cur = null; this.authListeners = new Set(); this.watchers = new Set(); }
  async init() {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
    const [app, auth, fs] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-firestore.js`),
    ]);
    this.sdk = { app, auth, fs };
    this.fapp = app.initializeApp(firebaseConfig);
    this.auth = auth.getAuth(this.fapp);
    this.fdb = fs.getFirestore(this.fapp);
    if (firebaseConfig.measurementId) {
      this.initAnalytics(base).catch(() => {});
    }
    auth.onAuthStateChanged(this.auth, async (fu) => {
      if (!fu) {
        this.detach(); this.cur = null;
        if (this.analytics && this.sdk.analytics?.setUserId) {
          try { this.sdk.analytics.setUserId(this.analytics, null); } catch {}
        }
        return this.emitAuth();
      }
      if (fu.isAnonymous && this.joining) return; // joinTeam finishes the sign-in itself
      const prof = await this.attach(fu).catch(() => null);
      // Signed in with Google but not on the access list (or an anonymous session with no team) → no permissions: sign back out.
      if (!prof) { this.detach(); this.cur = null; this.emitAuth(); auth.signOut(this.auth).catch(() => {}); return; }
      this.cur = prof;
      if (this.analytics && this.sdk.analytics?.setUserId) {
        try { this.sdk.analytics.setUserId(this.analytics, fu.uid); } catch {}
      }
      this.emitAuth();
    });
  }
  async initAnalytics(base) {
    try {
      const analytics = await import(`${base}/firebase-analytics.js`);
      this.sdk.analytics = analytics;
      if (await analytics.isSupported()) {
        // The router records pageviews, including the initial page.
        this.analytics = analytics.initializeAnalytics(this.fapp, { config: { send_page_view: false } });
        if (this.cur?.uid && this.sdk.analytics?.setUserId) {
          try { this.sdk.analytics.setUserId(this.analytics, this.cur.uid); } catch {}
        }
        if (this._queuedEvents) {
          for (const [name, params] of this._queuedEvents) {
            try { this.sdk.analytics.logEvent(this.analytics, name, params); } catch {}
          }
          this._queuedEvents = null;
        }
      }
    } catch {}
  }
  logEvent(name, params) {
    if (this.analytics && this.sdk.analytics?.logEvent) {
      try { this.sdk.analytics.logEvent(this.analytics, name, params); } catch {}
    } else if (firebaseConfig.measurementId) {
      this._queuedEvents ||= [];
      this._queuedEvents.push([name, params]);
    }
  }
  // Account facts only; the teams come from attach().
  async fetchProfile(fu) {
    const { fs } = this.sdk;
    if (fu.isAnonymous) return { uid: fu.uid, email: null, name: 'Team member', role: 'member', host: false, eventIds: null, viaPassword: true };
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
    return { uid: fu.uid, email, name: a.name || email.split('@')[0], role: a.role, host: a.role === 'host' || a.host === true, eventIds: a.eventIds || null };
  }
  // Load the account, then keep its team memberships live: roster rows (a coach added you) + team-password memberships.
  attach(fu) {
    if (this.attached?.uid === fu.uid) return this.attached.promise;
    this.detach();
    const { fs } = this.sdk;
    const promise = (async () => {
      const base = await this.fetchProfile(fu);
      if (!base) return null;
      if (base.email) await this.claimRegistrations(base.email);
      this.base = base; this.rows = { roster: [], pw: [] };
      const recompute = () => { this.cur = composeUser(this.base, this.rows.roster, this.rows.pw); };
      await new Promise((resolve) => {
        let left = base.email ? 2 : 1;
        const first = () => { if (--left === 0) resolve(); };
        const watch = (key, q) => {
          let got = false;
          const unsub = fs.onSnapshot(q, (snap) => {
            this.rows[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            if (!got) { got = true; first(); return; }
            recompute(); this.emitAuth();
          }, (e) => { console.warn(`[firestore] my ${key}:`, e.code); if (!got) { got = true; first(); } });
          this.unsubs.push(unsub);
        };
        this.unsubs = [];
        if (base.email) watch('roster', fs.query(fs.collection(this.fdb, 'roster'), fs.where('email', '==', base.email)));
        watch('pw', fs.query(fs.collection(this.fdb, 'teamMembers'), fs.where('uid', '==', fu.uid)));
      });
      recompute();
      if (!fu.isAnonymous) this.syncLocalTeams().catch(() => {});
      await this.dropStale();
      if (fu.isAnonymous && !this.cur.teams.length) return null;
      recompute();
      return this.cur;
    })();
    this.attached = { uid: fu.uid, promise };
    const forget = () => { if (this.attached?.promise === promise) this.attached = null; };
    promise.then((p) => { if (!p) forget(); }, forget); // (a failed or refused sign-in can be retried)
    return promise;
  }
  // The Gmail named in a public registration becomes that (still unofficial) team's coach once they sign in with it.
  async claimRegistrations(email) {
    const { fs } = this.sdk;
    try {
      const regs = await fs.getDocs(fs.query(fs.collection(this.fdb, 'registrations'), fs.where('coachEmail', '==', email)));
      for (const r of regs.docs) {
        const rid = rosterId(r.id, email);
        if ((await fs.getDoc(fs.doc(this.fdb, 'roster', rid))).exists()) continue;
        await fs.setDoc(fs.doc(this.fdb, 'roster', rid), { teamId: r.id, email, role: 'coach', name: '', addedBy: email, addedAt: Date.now() }).catch(() => {});
      }
    } catch { /* not claimable (rules not published yet, or nothing to claim) */ }
  }
  detach() { (this.unsubs || []).forEach((f) => f()); this.unsubs = []; this.attached = null; this.base = null; }
  // A team-password membership is stale once the coach changed or switched off the password: delete it.
  async dropStale() {
    const { fs } = this.sdk;
    for (const m of this.rows.pw.slice()) {
      if (this.rows.roster.some((r) => r.teamId === m.teamId)) continue;
      try { await fs.getDocs(fs.query(fs.collection(this.fdb, 'practice'), fs.where('teamId', '==', m.teamId), fs.limit(1))); } catch (e) {
        if (e.code !== 'permission-denied') continue;
        this.rows.pw = this.rows.pw.filter((x) => x.id !== m.id); forgetTeam(m.teamId);
        this.notice = 'The team password for #' + m.teamId.slice(1) + ' was changed or turned off, so you were removed from that team. Add it again with the new password.';
        fs.deleteDoc(fs.doc(this.fdb, 'teamMembers', m.id)).catch(() => {});
      }
    }
  }
  // A team's password was changed or switched off while someone was using it: drop that membership (or sign out).
  async recheck() {
    if (this.rechecking || !this.base) return;
    this.rechecking = true;
    try {
      await this.dropStale();
      this.cur = composeUser(this.base, this.rows.roster, this.rows.pw);
      if (this.base.viaPassword && !this.cur.teams.length) { this.notice = this.notice || 'The team password was changed. Sign in again with the new password.'; await this.signOut(); return; }
      this.emitAuth();
    } finally { this.rechecking = false; }
  }
  get user() { return this.cur; }
  emitAuth() { this.authListeners.forEach((f) => f(this.cur)); }
  onAuth(cb) { this.authListeners.add(cb); cb(this.cur); return () => this.authListeners.delete(cb); }
  setActiveTeam(teamId) { setActivePref(teamId); if (this.base) { this.cur = composeUser(this.base, this.rows.roster, this.rows.pw); this.emitAuth(); } }
  async signInGoogle() {
    const { auth } = this.sdk;
    let cred;
    try { cred = await auth.signInWithPopup(this.auth, new auth.GoogleAuthProvider()); } catch (e) { throw friendly(e); }
    const email = normEmail(cred.user.email);
    const prof = await this.attach(cred.user);
    if (!prof) throw err('not-authorized', `${email} isn’t on the access list. Ask your coach or an admin to add this Google account, then sign in again. (First admin? In Firestore create collection “access”, Document ID exactly “${email}”, field role = admin.)`);
    this.cur = prof; this.emitAuth();
    return prof;
  }
  // Add a team with its shared password (anonymous sign-in first if nobody is signed in). Stored on this device and,
  // with a Google account, linked to it: the membership doc lives under the account's uid.
  async joinTeam(number, password, name = '') {
    const { auth, fs } = this.sdk;
    const teamId = `t${parseInt(number, 10)}`;
    const pw = String(password).trim(), nm = String(name).trim().slice(0, 40);
    const fresh = !this.auth.currentUser;
    this.joining = true;
    try {
      const user = this.auth.currentUser || (await auth.signInAnonymously(this.auth)).user;
      try { await fs.setDoc(fs.doc(this.fdb, 'teamMembers', memberDocId(user.uid, teamId)), { uid: user.uid, teamId, password: pw, name: nm, createdAt: Date.now() }); } catch (e) {
        if (fresh) await auth.signOut(this.auth).catch(() => {});
        throw err(e.code === 'permission-denied' ? 'bad-team-login' : e.code, e.code === 'permission-denied' ? 'That team number and password don’t match — or the coach has turned password sign-in off.' : friendly(e).message);
      }
      rememberTeam({ teamId, password: pw, name: nm });
      this.detach();
      const prof = await this.attach(user);
      if (!prof) throw err('bad-team-login', 'Couldn’t join that team.');
      this.cur = prof; this.emitAuth();
      return prof;
    } catch (e) { throw e.code?.startsWith?.('auth/') ? friendly(e) : e; } finally { this.joining = false; }
  }
  // Public registration (see the demo store): anonymous sign-in if needed, then one atomic batch for the team, the private
  // registration (coach email) and the team's password; finally join the new team like any member would.
  async registerTeam(f) {
    const { auth, fs } = this.sdk;
    const { number, name, coachEmail, edition } = checkRegistration(f);
    const teamId = `t${number}`, password = newCode();
    const fresh = !this.auth.currentUser;
    this.joining = true;
    try {
      const user = this.auth.currentUser || (await auth.signInAnonymously(this.auth)).user;
      try {
        const b = fs.writeBatch(this.fdb);
        b.set(fs.doc(this.fdb, 'teams', teamId), { number, name, edition, registered: true, registeredBy: user.uid });
        b.set(fs.doc(this.fdb, 'registrations', teamId), { coachEmail, uid: user.uid, createdAt: Date.now() });
        b.set(fs.doc(this.fdb, 'teamSecrets', teamId), { password, enabled: true, isDefault: false, updatedAt: Date.now() });
        await b.commit();
      } catch (e) {
        if (fresh) await auth.signOut(this.auth).catch(() => {});
        throw e.code === 'permission-denied' ? err('exists', `Team #${number} already exists (or the latest firestore.rules aren’t published). Join it with its team password instead.`) : friendly(e);
      }
    } finally { this.joining = false; }
    await this.joinTeam(number, password, '');
    return { teamId, number, name, password };
  }
  async signInTeam(number, password, name = '') {
    const cur = this.auth.currentUser;
    if (cur && !cur.isAnonymous) await this.sdk.auth.signOut(this.auth);
    return this.joinTeam(number, password, name);
  }
  async syncLocalTeams() {
    const { fs } = this.sdk;
    const u = this.auth.currentUser; if (!u || u.isAnonymous) return;
    for (const t of localTeams()) {
      if (this.rows.pw.some((m) => m.teamId === t.teamId) || this.rows.roster.some((r) => r.teamId === t.teamId)) continue;
      try { await fs.setDoc(fs.doc(this.fdb, 'teamMembers', memberDocId(u.uid, t.teamId)), { uid: u.uid, teamId: t.teamId, password: t.password, name: t.name || '', createdAt: Date.now() }); } catch (e) { if (e.code === 'permission-denied') forgetTeam(t.teamId); }
    }
  }
  async leaveTeam(teamId) {
    const { fs } = this.sdk; const u = this.cur; if (!u) return;
    const t = u.teams.find((x) => x.teamId === teamId); if (!t) return;
    if (t.role === 'coach') throw denied('Coaches can’t leave their own team — ask another coach or an admin to remove you.');
    try {
      if (this.rows.pw.some((m) => m.teamId === teamId)) await fs.deleteDoc(fs.doc(this.fdb, 'teamMembers', memberDocId(u.uid, teamId)));
      if (t.via === 'roster') await fs.deleteDoc(fs.doc(this.fdb, 'roster', rosterId(teamId, u.email)));
    } catch (e) { throw friendly(e); }
    forgetTeam(teamId);
    if (u.viaPassword && u.teams.length <= 1) await this.signOut();
  }
  async signOut() {
    const u = this.cur;
    if (u?.viaPassword) { // anonymous team-password session: tidy up its memberships
      for (const m of this.rows?.pw || []) { try { await this.sdk.fs.deleteDoc(this.sdk.fs.doc(this.fdb, 'teamMembers', m.id)); } catch { /* best effort */ } }
      setLocalTeams([]);
    }
    this.detach();
    await this.sdk.auth.signOut(this.auth);
  }
  // Public lists (teams, events, scores) are fetched, not streamed: now, then once a minute while the page that shows them is
  // open and the browser tab is visible. `once` fetches a single time. Our own writes refresh the open lists straight away.
  watch(col, cb, { every = 60000, once = false } = {}) {
    const { fs } = this.sdk;
    let stopped = false, timer = null, busy = false;
    const run = async () => {
      if (stopped || busy) return; busy = true;
      try { const snap = await fs.getDocs(fs.collection(this.fdb, col)); if (!stopped) cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); } catch (e) { console.warn(`[firestore] ${col}:`, e.code); } finally { busy = false; }
    };
    const loop = () => { if (stopped || once) return; timer = setTimeout(async () => { if (!document.hidden) await run(); loop(); }, every); };
    const onVisible = () => { if (!document.hidden && !once) run(); };
    document.addEventListener('visibilitychange', onVisible);
    this.watchers.add(run);
    run(); loop();
    return () => { stopped = true; clearTimeout(timer); this.watchers.delete(run); document.removeEventListener('visibilitychange', onVisible); };
  }
  kick() { this.watchers.forEach((r) => r()); }
  subscribe(col, cb) {
    const { fs } = this.sdk;
    const u = this.cur;
    let q = fs.collection(this.fdb, col);
    if (col === 'signatures') { cb([]); return () => {}; }
    if (col === 'access' && u?.role !== 'admin') {
      // a host sees the referees they added
      if (!u?.host) { cb([]); return () => {}; }
      q = fs.query(q, fs.where('role', '==', 'judge'), fs.where('addedBy', '==', u.email));
    }
    if (col === 'eventHosts') {
      if (u?.role === 'admin') { /* all */ } else if (u?.host) q = fs.query(q, fs.where('emails', 'array-contains', u.email));
      else { cb([]); return () => {}; }
    }
    if (col === 'eventJudges') { // admins see every list; everyone else only the events they referee
      if (u?.role === 'admin') { /* all */ } else if (u?.email) q = fs.query(q, fs.where('emails', 'array-contains', u.email));
      else { cb([]); return () => {}; }
    }
    if (col === 'practice') { // the active team's runs (admins: every team's)
      if (u?.teamId) q = fs.query(q, fs.where('teamId', '==', u.teamId));
      else if (u?.role !== 'admin') { cb([]); return () => {}; }
    }
    if (col === 'teamSecrets') { cb([]); return () => {}; }
    if (col === 'teamMembers' || col === 'roster') {
      // the people on the teams I coach (one query per team); admins see everything
      if (u?.role !== 'admin') {
        const ids = coachTeamIds(u);
        if (!ids.length) { cb([]); return () => {}; }
        const parts = ids.map(() => []);
        const emit = () => cb(parts.flat());
        const unsubs = ids.map((tid, i) => fs.onSnapshot(fs.query(q, fs.where('teamId', '==', tid)), (snap) => { parts[i] = snap.docs.map((d) => ({ id: d.id, ...d.data() })); emit(); }, (e) => console.warn(`[firestore] ${col}:`, e.code)));
        return () => unsubs.forEach((f) => f());
      }
    }
    return fs.onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => {
      console.warn(`[firestore] ${col}:`, e.code);
      // a password session whose team password was changed gets "permission-denied" on its team data → sign it out
      if (e.code === 'permission-denied' && col === 'practice' && u?.teams?.some((t) => t.via === 'password')) this.recheck();
    });
  }
  async put(col, id, data) {
    const { fs } = this.sdk;
    const { id: _drop, ...rest } = data;
    try { await fs.setDoc(fs.doc(this.fdb, col, id), rest); } catch (e) { throw friendly(e); }
    this.kick();
  }
  async patch(col, id, fields) {
    const { fs } = this.sdk;
    try { await fs.updateDoc(fs.doc(this.fdb, col, id), fields); } catch (e) { throw friendly(e); }
    this.kick();
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
      this.kick();
    } catch (e) {
      if (e.code !== 'permission-denied') throw friendly(e);
      let exists = false; try { exists = (await fs.getDoc(fs.doc(this.fdb, 'scores', id))).exists(); } catch { /* ignore */ }
      throw err('permission-denied', exists
        ? 'This match already has an official score. The event’s host or an admin has to delete it before it can be scored again.'
        : 'Firestore refused this score. This Google account must be an admin, a referee or a host of this event — and the latest firestore.rules must be published.');
    }
  }
  async get(col, id) {
    const { fs } = this.sdk;
    try { const d = await fs.getDoc(fs.doc(this.fdb, col, id)); return d.exists() ? { id: d.id, ...d.data() } : null; } catch (e) { throw friendly(e); }
  }
  async remove(col, id) {
    if (col === 'scores') { try { await this.sdk.fs.deleteDoc(this.sdk.fs.doc(this.fdb, 'signatures', id)); } catch { /* may not exist */ } }
    try { await this.sdk.fs.deleteDoc(this.sdk.fs.doc(this.fdb, col, id)); } catch (e) { throw friendly(e); }
    this.kick();
  }

  // ----- live help chat -----
  async helpSend(tid, { name = '', contact = '', text }) {
    const { fs } = this.sdk, now = Date.now();
    text = String(text || '').trim().slice(0, HELP_MAX);
    if (!text || !validHelpId(tid)) throw err('invalid', 'Write a message first.');
    const info = { name: String(name).trim().slice(0, 60), contact: String(contact).trim().slice(0, 80), email: this.cur?.email || '' };
    const ref = fs.doc(this.fdb, 'helpThreads', tid);
    try {
      const exists = (await fs.getDoc(ref)).exists();
      const b = fs.writeBatch(this.fdb);
      const fields = { ...info, lastAt: now, lastFrom: 'user', last: text.slice(0, 100), resolved: false };
      if (exists) b.update(ref, fields); else b.set(ref, { ...fields, createdAt: now });
      b.set(fs.doc(fs.collection(ref, 'msgs')), { from: 'user', text, createdAt: now });
      await b.commit();
    } catch (e) { throw friendly(e); }
  }
  async helpFetch(tid) {
    const { fs } = this.sdk, ref = fs.doc(this.fdb, 'helpThreads', tid);
    try {
      const [t, m] = await Promise.all([fs.getDoc(ref), fs.getDocs(fs.query(fs.collection(ref, 'msgs'), fs.orderBy('createdAt')))]);
      return { thread: t.exists() ? { id: t.id, ...t.data() } : null, msgs: m.docs.map((d) => ({ id: d.id, ...d.data() })) };
    } catch (e) { throw friendly(e); }
  }
  async helpThreads() {
    const { fs } = this.sdk;
    try { return (await fs.getDocs(fs.collection(this.fdb, 'helpThreads'))).docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.lastAt - a.lastAt); } catch (e) { throw friendly(e); }
  }
  async helpReply(tid, text) {
    const { fs } = this.sdk, now = Date.now(), ref = fs.doc(this.fdb, 'helpThreads', tid);
    text = String(text || '').trim().slice(0, HELP_MAX);
    if (!text) throw err('invalid', 'Write a reply first.');
    try {
      const b = fs.writeBatch(this.fdb);
      b.set(fs.doc(fs.collection(ref, 'msgs')), { from: 'admin', text, createdAt: now });
      b.update(ref, { lastAt: now, lastFrom: 'admin', last: text.slice(0, 100) });
      await b.commit();
    } catch (e) { throw friendly(e); }
  }
  async helpResolve(tid, resolved) { try { await this.sdk.fs.updateDoc(this.sdk.fs.doc(this.fdb, 'helpThreads', tid), { resolved: Boolean(resolved) }); } catch (e) { throw friendly(e); } }
  async helpDelete(tid) {
    const { fs } = this.sdk, ref = fs.doc(this.fdb, 'helpThreads', tid);
    try {
      const m = await fs.getDocs(fs.collection(ref, 'msgs'));
      for (const d of m.docs) await fs.deleteDoc(d.ref);
      await fs.deleteDoc(ref);
    } catch (e) { throw friendly(e); }
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
    'permission-denied': 'You don’t have permission to do that.',
    'auth/admin-restricted-operation': 'Team-password sign-in isn’t switched on yet. In the Firebase console go to Authentication → Sign-in method and enable “Anonymous”, then try again.',
  };
  return err(c, map[c] || e.message || 'Something went wrong.');
}

export async function createStore() {
  const store = isConfigured() ? new FirebaseStore() : new DemoStore();
  await store.init();
  return store;
}
export { MISSIONS, MATCHES_PER_TEAM };
