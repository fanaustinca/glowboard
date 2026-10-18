// In-memory stand-in for the Firebase web SDK (app + auth + firestore), used by tests/firebase-mock.mjs.
// Shared state lives on globalThis.__fb so the three "modules" see the same data.
const fb = (globalThis.__fb ||= {
  docs: { access: {}, events: {}, teams: {}, scores: {}, signatures: {}, practice: {} },
  google: null, // the Google account the next popup signs in as: { uid, email }
  log: [], listeners: new Set(),
});
// access list (document ID = lowercase gmail). ghost@gmail.com is deliberately NOT listed.
fb.docs.access['boss@gmail.com'] ||= { role: 'admin', name: 'Boss' };
fb.docs.access['judge@gmail.com'] ||= { role: 'judge' };
fb.docs.access['host@gmail.com'] ||= { role: 'host' };
fb.docs.eventHosts ||= {};
fb.docs.eventJudges ||= {};
fb.docs.eventHosts.ev1 ||= { emails: ['host@gmail.com'] };
fb.docs.access['coach@gmail.com'] ||= { role: 'coach', teamId: 't1', name: 'Coach C' };
fb.docs.events.ev1 ||= { name: 'Regional', live: true, createdAt: 1 };
fb.docs.teams.t1 ||= { number: 1, name: 'Alpha' };
fb.docs.teams.t2 ||= { number: 2, name: 'Beta' };
fb.docs.teamSecrets ||= {}; fb.docs.teamMembers ||= {}; fb.docs.roster ||= {};
fb.docs.roster['t1__coach@gmail.com'] ||= { teamId: 't1', email: 'coach@gmail.com', role: 'coach', name: 'Coach C', addedBy: 'boss@gmail.com', addedAt: 1 };
fb.docs.teamSecrets.t1 ||= { password: '123456', enabled: true, isDefault: false, updatedBy: 'boss@gmail.com', updatedAt: 1 };
fb.docs.teamSecrets.t2 ||= { password: '654321', enabled: true, isDefault: false, updatedBy: 'boss@gmail.com', updatedAt: 1 };
const notify = () => fb.listeners.forEach((f) => f());
const err = (code) => Object.assign(new Error(code), { code });

// ---- app ----
export const initializeApp = (cfg, name = '[DEFAULT]') => { fb.log.push(['initializeApp', name, cfg.projectId]); return { name }; };
export const deleteApp = async () => {};

// ---- auth ----
const auths = new Map();
export const getAuth = (app) => { if (!auths.has(app.name)) auths.set(app.name, { app, user: null, subs: new Set() }); return auths.get(app.name); };
const setUser = (a, u) => { a.user = u; a.currentUser = u; fb.currentEmail = u?.email?.toLowerCase() || null; fb.currentUid = u?.uid || null; a.subs.forEach((f) => f(u)); };
let anonN = 0;
export const signInAnonymously = async (a) => { if (fb.anonDisabled) throw err('auth/admin-restricted-operation'); const u = { uid: 'anon-' + (++anonN), email: null, isAnonymous: true }; fb.log.push(['signInAnonymously']); setUser(a, u); return { user: u }; };
export const onAuthStateChanged = (a, cb) => { a.subs.add(cb); setTimeout(() => cb(a.user), 0); return () => a.subs.delete(cb); };
export class GoogleAuthProvider {}
export const signInWithPopup = async (a, provider) => {
  fb.log.push(['googlePopup', provider instanceof GoogleAuthProvider]);
  const g = fb.google;
  if (!g) throw err('auth/popup-closed-by-user');
  setUser(a, { uid: g.uid, email: g.email });
  return { user: { uid: g.uid, email: g.email } };
};
export const signOut = async (a) => setUser(a, null);

// ---- firestore ----
export const getFirestore = () => ({ db: true });
export const collection = (_db, name) => ({ kind: 'col', name });
export const doc = (a, b, c) => (a.kind === 'col' ? { kind: 'doc', col: a.name, id: Math.random().toString(36).slice(2, 12) } : { kind: 'doc', col: b, id: c });
export const where = (f, op, v) => ({ f, op, v });
export const query = (col, ...w) => ({ ...col, w });
export const limit = (n) => ({ limit: n });
// mirrors rules: a practice query for a team needs a roster entry, or a team-password membership that still matches AND is switched on
const teamOk = (teamId) => {
  if (fb.docs.roster?.[`${teamId}__${fb.currentEmail}`]) return true;
  const m = fb.docs.teamMembers?.[`${fb.currentUid}_${teamId}`], sec = fb.docs.teamSecrets?.[teamId];
  return Boolean(m && sec && m.password === sec.password && sec.enabled !== false);
};
const blocked = (q) => q.name === 'practice' && (fb.expirePractice || ((q.w || []).filter((c) => c.f === 'teamId' && c.op === '==').some((c) => !teamOk(c.v))));
const match = (d, c) => (c.op === 'array-contains' ? (d[c.f] || []).includes(c.v) : d[c.f] === c.v);
const rows = (q) => Object.entries(fb.docs[q.name] || {}).filter(([, d]) => (q.w || []).every((c) => match(d, c))).map(([id, d]) => ({ id, data: () => d }));
export const getDocs = async (q) => { if (blocked(q)) throw err('permission-denied'); return { docs: rows(q) }; };
export const onSnapshot = (q, cb, errCb) => { if (blocked(q)) { setTimeout(() => errCb?.({ code: 'permission-denied' }), 0); return () => {}; } const run = () => cb({ docs: rows(q) }); fb.listeners.add(run); setTimeout(run, 0); return () => fb.listeners.delete(run); };
export const getDoc = async (ref) => {
  if (fb.blockAccessReads && ref.col === 'access') throw err('permission-denied'); const d = fb.docs[ref.col]?.[ref.id]; return { exists: () => !!d, id: ref.id, data: () => d }; };
export const setDoc = async (ref, data) => {
  // mirrors the rules: only admins may overwrite an existing access/{email} document
  if (ref.col === 'access' && fb.docs.access?.[ref.id] && fb.docs.access[fb.currentEmail]?.role !== 'admin') throw err('permission-denied');
  // mirrors the rules: a team-password session can only be created with the team's CURRENT password
  if (ref.col === 'teamMembers' && (fb.docs.teamSecrets?.[data.teamId]?.password !== data.password || fb.docs.teamSecrets[data.teamId].enabled === false || ref.id !== `${data.uid}_${data.teamId}` || data.uid !== fb.currentUid)) throw err('permission-denied');
  fb.log.push(['setDoc', ref.col, ref.id]); (fb.docs[ref.col] ||= {})[ref.id] = JSON.parse(JSON.stringify(data)); notify();
};
export const updateDoc = async (ref, fields) => { fb.log.push(['updateDoc', ref.col, ref.id]); const d = fb.docs[ref.col]?.[ref.id]; if (!d) throw err('not-found'); Object.assign(d, JSON.parse(JSON.stringify(fields))); notify(); };
export const deleteDoc = async (ref) => { fb.log.push(['deleteDoc', ref.col, ref.id]); delete fb.docs[ref.col]?.[ref.id]; notify(); };
export const writeBatch = () => {
  const ops = [];
  return { set: (ref, data) => { ops.push([ref, data]); }, commit: async () => {
    fb.log.push(['commit', ops.map(([r]) => `${r.col}/${r.id}`).join(',')]);
    if (fb.rejectBatch) throw err('permission-denied');
    for (const [r, d] of ops) (fb.docs[r.col] ||= {})[r.id] = JSON.parse(JSON.stringify(d));
    notify();
  } };
};
