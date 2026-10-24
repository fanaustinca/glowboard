// OPTIONAL deep check: runs firestore.rules in the real Firestore emulator and tries every role against it.
// Needs Java 11+, firebase-tools and @firebase/rules-unit-testing (not project dependencies):
//   npx -y -p firebase-tools@13 -p @firebase/rules-unit-testing@3 -p firebase@10 firebase emulators:exec --only firestore --project demo-glow "node tests/rules-emulator.mjs"
// (set NODE_PATH to wherever those packages are installed if node can't resolve them)
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setDoc, getDoc, getDocs, updateDoc, deleteDoc, doc, collection, query, where, writeBatch } from 'firebase/firestore';
import { scoreAll, defaultState } from '../js/scoring.js';
import { slim } from '../js/store.js';

const emu = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8089').split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-glow', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: emu[0], port: +emu[1] } });
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };

await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  const w = (p, d) => setDoc(doc(db, p), d);
  await w('access/admin@x.com', { role: 'admin' });
  await w('access/judge@x.com', { role: 'judge', eventIds: ['ev1', 'ev2'] });
  await w('access/loose@x.com', { role: 'judge' });
  await w('access/host@x.com', { role: 'host' });
  await w('access/host2@x.com', { role: 'host' });
  await w('access/coachhost@x.com', { role: 'coach', teamId: 't1', host: true });
  await w('access/scoped@x.com', { role: 'judge', eventIds: ['ev2'], addedBy: 'host2@x.com' });
  await w('access/coach@x.com', { role: 'coach', teamId: 't1' });
  await w('access/coach2@x.com', { role: 'coach', teamId: 't2' });
  await w('access/mem@x.com', { role: 'member', teamId: 't1' });
  await w('access/g2@x.com', { role: 'member' });
  await w('roster/t1__coach@x.com', { teamId: 't1', email: 'coach@x.com', role: 'coach', name: 'C', addedBy: 'admin@x.com', addedAt: 1 });
  await w('roster/t2__coach2@x.com', { teamId: 't2', email: 'coach2@x.com', role: 'coach', name: 'C2', addedBy: 'admin@x.com', addedAt: 1 });
  await w('roster/t1__mem@x.com', { teamId: 't1', email: 'mem@x.com', role: 'member', name: 'M', addedBy: 'coach@x.com', addedAt: 1 });
  await w('roster/t1__coachhost@x.com', { teamId: 't1', email: 'coachhost@x.com', role: 'coach', name: 'CH', addedBy: 'admin@x.com', addedAt: 1 });
  await w('roster/t3__pro@x.com', { teamId: 't3', email: 'pro@x.com', role: 'coach', name: 'Pro', addedBy: 'admin@x.com', addedAt: 1 });
  await w('roster/t1__pro@x.com', { teamId: 't1', email: 'pro@x.com', role: 'member', name: 'Pro', addedBy: 'coach@x.com', addedAt: 1 });
  await w('access/pro@x.com', { role: 'coach', teamId: 't3' });
  await w('teams/t1', { number: 1, name: 'Alpha' });
  await w('teams/t2', { number: 2, name: 'Beta' });
  await w('teams/t3', { number: 3, name: 'Gamma' });
  await w('teamSecrets/t3', { password: '333333', updatedBy: 'admin@x.com', updatedAt: 1 });
  await w('events/ev1', { name: 'Regional', live: true });
  await w('events/ev2', { name: 'Other event', live: false });
  await w('eventHosts/ev1', { emails: ['host@x.com', 'coachhost@x.com'] });
  await w('eventHosts/ev2', { emails: ['host2@x.com'] });
  await w('teamSecrets/t1', { password: '123456', updatedBy: 'admin@x.com', updatedAt: 1 });
  await w('teamSecrets/t2', { password: '654321', updatedBy: 'admin@x.com', updatedAt: 1 });
  await w('teamSecrets/t7', { password: '777777', updatedBy: 'host@x.com', updatedAt: 1 });
  await w('teams/t7', { number: 7, name: 'Seven', createdBy: 'host@x.com' });
  await w('teams/t8', { number: 8, name: 'Eight', createdBy: 'host2@x.com' });
  await w('practice/p1', { uid: 'u-coach', teamId: 't1', total: 100, createdAt: 1 });
  await w('practice/p2', { uid: 'u-coach2', teamId: 't2', total: 90, createdAt: 1 });
  await w('practice/p3', { uid: 'u-pro', teamId: 't3', total: 60, createdAt: 1 });
  await w('signatures/ev1_t1_R1', { signature: 'data:x' });
  await w('eventJudges/ev1', { emails: ['coach2@x.com'] });
  await w('scores/ev1_t1_R1', { eventId: 'ev1', teamId: 't1', round: 1, total: 100, gp: 3, hasSignature: true, judgeUid: 'u-judge' });
});
const anonCtx = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const as = (uid, email, verified = true) => env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
const anon = env.unauthenticatedContext().firestore();
const admin = as('u-admin', 'admin@x.com'), judge = as('u-judge', 'judge@x.com'), coach = as('u-coach', 'coach@x.com'), coach2 = as('u-coach2', 'coach2@x.com');
const coachHost = as('u-ch', 'coachhost@x.com'), scoped = as('u-sc', 'scoped@x.com');
const host = as('u-host', 'host@x.com'), host2 = as('u-host2', 'host2@x.com');
const judge2 = as('u-sc', 'scoped@x.com');
const mem = as('u-mem', 'mem@x.com'), stranger = as('u-s', 'ghost@gmail.com'), stranger2 = as('u-s2', 'g2@x.com'), unverified = as('u-admin2', 'admin@x.com', false);
const score = (o = {}) => ({ eventId: 'ev1', teamId: 't2', round: 1, total: 120, gp: 3, hasSignature: true, judgeUid: 'u-judge', ...o });

console.log('firestore.rules in the real emulator');
// public + strangers
await assertSucceeds(getDocs(collection(anon, 'teams'))); await assertSucceeds(getDocs(collection(anon, 'events'))); await assertSucceeds(getDocs(collection(anon, 'scores')));
await assertFails(getDocs(collection(anon, 'practice'))); await assertFails(getDoc(doc(anon, 'signatures/ev1_t1_R1'))); await assertFails(getDoc(doc(anon, 'access/admin@x.com')));
ok('public can read teams/events/scores only');
await assertFails(setDoc(doc(stranger, 'teams/t9'), { number: 9, name: 'Z' })); await assertFails(setDoc(doc(stranger, 'scores/ev1_t2_R1'), score()));
await assertFails(setDoc(doc(stranger, 'access/ghost@gmail.com'), { role: 'admin' })); await assertFails(setDoc(doc(stranger, 'practice/px'), { uid: 'u-s', teamId: 't1', total: 1 }));
ok('a signed-in Google account that is NOT on the access list can do nothing');
await assertSucceeds(getDoc(doc(stranger, 'access/ghost@gmail.com'))); await assertFails(getDoc(doc(stranger, 'access/admin@x.com')));
ok('…but can learn whether it is on the list (own entry only)');
await assertFails(setDoc(doc(unverified, 'teams/t9'), { number: 9, name: 'Z' })); ok('an unverified email gets no privileges even if listed');
// admin
await assertSucceeds(setDoc(doc(admin, 'teams/t10'), { number: 10, name: 'Tenth', createdBy: 'admin@x.com' }));
await assertFails(setDoc(doc(admin, 'teams/t4'), { number: 4, createdBy: 'admin@x.com' })); await assertFails(setDoc(doc(admin, 'teams/t5'), { name: 'No number', createdBy: 'admin@x.com' }));
await assertFails(setDoc(doc(admin, 'teams/t6'), { number: 6, name: '', createdBy: 'admin@x.com' })); await assertFails(setDoc(doc(admin, 'teams/tWRONG'), { number: 9, name: 'Mismatch', createdBy: 'admin@x.com' }));
ok('admin adds teams; number AND name are required (id must match number)');
await assertSucceeds(setDoc(doc(admin, 'events/ev2'), { name: 'Scrimmage' })); await assertSucceeds(updateDoc(doc(admin, 'events/ev2'), { live: false })); ok('admin manages events');
await assertSucceeds(setDoc(doc(admin, 'access/newjudge@gmail.com'), { role: 'judge', addedBy: 'admin@x.com' }));
await assertSucceeds(setDoc(doc(admin, 'access/newcoach@gmail.com'), { role: 'coach', teamId: 't3' }));
await assertSucceeds(setDoc(doc(admin, 'access/newadmin@gmail.com'), { role: 'admin' }));
await assertFails(setDoc(doc(admin, 'access/NewCoach@gmail.com'), { role: 'coach', teamId: 't3' })); await assertFails(setDoc(doc(admin, 'access/bad@gmail.com'), { role: 'coach' }));
await assertFails(setDoc(doc(admin, 'access/bad@gmail.com'), { role: 'superuser' }));
ok('admin grants judge / coach / admin by gmail (lowercase IDs, coach needs a team, valid roles only)');
await assertFails(deleteDoc(doc(admin, 'access/admin@x.com'))); await assertSucceeds(deleteDoc(doc(admin, 'access/newjudge@gmail.com'))); ok('admin can remove others but not themself');
await assertSucceeds(getDocs(collection(admin, 'access'))); await assertSucceeds(getDocs(collection(admin, 'practice')));
// judge
await assertSucceeds(setDoc(doc(judge, 'scores/ev1_t2_R1'), score()));
await assertFails(setDoc(doc(judge, 'scores/ev1_t2_R1'), score({ total: 5 }))); // overwrite = update → admins only
await assertFails(setDoc(doc(judge, 'scores/ev1_t2_R2'), score({ round: 1 }))); await assertFails(setDoc(doc(judge, 'scores/ev1_t2_R3'), score({ round: 3, judgeUid: 'someone-else' })));
await assertFails(setDoc(doc(judge, 'scores/ev1_t2_R2'), score({ round: 2, total: 5000 }))); await assertFails(setDoc(doc(judge, 'scores/ev1_t2_R2'), score({ round: 2, hasSignature: false })));
await assertFails(setDoc(doc(judge, 'scores/ev9_t2_R2'), score({ round: 2, eventId: 'ev9' }))); await assertFails(setDoc(doc(judge, 'scores/ev1_t99_R2'), score({ round: 2, teamId: 't99' })));
await assertFails(deleteDoc(doc(judge, 'scores/ev1_t1_R1')));
ok('judge: create-once, bound to event+team+round, own uid, real event/team, signed, sane total; cannot overwrite or delete');
await assertSucceeds(setDoc(doc(judge, 'signatures/ev1_t2_R1'), { signature: 'data:y' })); await assertSucceeds(getDoc(doc(judge, 'signatures/ev1_t1_R1'))); await assertFails(getDoc(doc(coach, 'signatures/ev1_t1_R1')));
await assertFails(setDoc(doc(judge, 'teams/t88'), { number: 88, name: 'x', createdBy: 'judge@x.com' })); await assertFails(setDoc(doc(judge, 'access/x@x.com'), { role: 'admin' })); await assertFails(setDoc(doc(judge, 'events/e9'), { name: 'x' }));
ok('judge reads/writes signatures but cannot manage teams, events or access');
await assertSucceeds(updateDoc(doc(admin, 'scores/ev1_t1_R1'), { total: 110 })); await assertSucceeds(deleteDoc(doc(admin, 'scores/ev1_t2_R1'))); ok('admin can correct and delete scores');
// coach
await assertSucceeds(updateDoc(doc(coach, 'teams/t1'), { name: 'Alpha Prime' }));
await assertFails(updateDoc(doc(coach, 'teams/t1'), { number: 99 })); await assertFails(updateDoc(doc(coach, 'teams/t1'), { name: 'ok', number: 99 }));
await assertFails(updateDoc(doc(coach, 'teams/t2'), { name: 'Hijack' })); await assertFails(updateDoc(doc(coach, 'teams/t1'), { name: '' })); await assertFails(deleteDoc(doc(coach, 'teams/t1')));
ok('coach renames their own team only (never the number, never another team, never to blank)');
await assertSucceeds(setDoc(doc(coach, 'access/parent@gmail.com'), { role: 'member', teamId: 't1', name: 'Mom', addedBy: 'coach@x.com', addedAt: 1 }));
await assertFails(setDoc(doc(coach, 'access/x1@gmail.com'), { role: 'coach', teamId: 't1', addedBy: 'coach@x.com', addedAt: 1 })); // access labels stay plain; coach-ness lives on the roster
await assertFails(setDoc(doc(coach, 'access/x2@gmail.com'), { role: 'admin', addedBy: 'coach@x.com', addedAt: 1 }));
await assertFails(setDoc(doc(coach, 'access/x3@gmail.com'), { role: 'member', teamId: 't2', addedBy: 'coach@x.com', addedAt: 1 }));
await assertFails(setDoc(doc(coach, 'access/x4@gmail.com'), { role: 'member', teamId: 't1', addedBy: 'coach@x.com', addedAt: 1, extra: true }));
await assertFails(setDoc(doc(coach, 'access/admin@x.com'), { role: 'member', teamId: 't1', addedBy: 'coach@x.com', addedAt: 1 })); // can't take over an admin entry
await assertFails(setDoc(doc(coach, 'access/Upper@gmail.com'), { role: 'member', teamId: 't1', addedBy: 'coach@x.com', addedAt: 1 }));
await assertFails(updateDoc(doc(coach, 'access/parent@gmail.com'), { role: 'member', name: 'edit' })); await assertFails(deleteDoc(doc(coach, 'access/parent@gmail.com'))); await assertFails(getDocs(collection(coach, 'access')));
ok('coach creates only brand-new plain-member accounts for their own team — no edits, no deletes, no takeovers, no listing');
const R = (t, e, role, extra = {}) => ({ teamId: t, email: e, role, name: 'n', addedBy: 'coach@x.com', addedAt: 1, ...extra });
await assertSucceeds(setDoc(doc(coach, 'roster/t1__parent@gmail.com'), R('t1', 'parent@gmail.com', 'member')));
await assertSucceeds(setDoc(doc(coach, 'roster/t1__cocoach@gmail.com'), R('t1', 'cocoach@gmail.com', 'coach'))); // coaches may add coaches (own team)
await assertFails(setDoc(doc(coach, 'roster/t2__p@gmail.com'), R('t2', 'p@gmail.com', 'member'))); await assertFails(setDoc(doc(coach, 'roster/t1__q@gmail.com'), R('t1', 'q@gmail.com', 'admin')));
await assertFails(setDoc(doc(coach, 'roster/t1__Up@gmail.com'), R('t1', 'Up@gmail.com', 'member'))); await assertFails(setDoc(doc(coach, 'roster/t1__r@gmail.com'), R('t1', 'r@gmail.com', 'member', { host: true })));
await assertFails(setDoc(doc(coach, 'roster/t1__wrongid'), R('t1', 's@gmail.com', 'member'))); await assertFails(setDoc(doc(coach, 'roster/t1__s@gmail.com'), R('t1', 's@gmail.com', 'member', { addedBy: 'forged@x.com' })));
await assertFails(setDoc(doc(mem, 'roster/t1__t@gmail.com'), R('t1', 't@gmail.com', 'member', { addedBy: 'mem@x.com' }))); await assertFails(setDoc(doc(judge, 'roster/t1__t@gmail.com'), R('t1', 't@gmail.com', 'member', { addedBy: 'judge@x.com' })));
await assertFails(setDoc(doc(coach, 'roster/t1__nobody@gmail.com'), R('t99', 'nobody@gmail.com', 'member')));
ok('roster: a coach adds members/coaches to their own team only (lowercase email, pinned id, pinned keys, real addedBy); members and judges cannot');
await assertSucceeds(updateDoc(doc(coach, 'roster/t1__parent@gmail.com'), { name: 'Mom (renamed)' })); await assertFails(updateDoc(doc(coach, 'roster/t1__parent@gmail.com'), { role: 'coach' })); await assertFails(updateDoc(doc(coach, 'roster/t1__mem@x.com'), { teamId: 't2' }));
await assertSucceeds(deleteDoc(doc(coach, 'roster/t1__parent@gmail.com'))); await assertSucceeds(deleteDoc(doc(coach, 'roster/t1__cocoach@gmail.com'))); await assertFails(deleteDoc(doc(coach, 'roster/t1__coachhost@x.com'))); await assertFails(deleteDoc(doc(coach, 'roster/t1__coach@x.com'))); await assertFails(deleteDoc(doc(coach, 'roster/t2__coach2@x.com')));
ok('coach edits names/removes members and the coaches they added — never promotes through update, never removes themself, other coaches or other teams');
await assertSucceeds(getDocs(query(collection(coach, 'roster'), where('teamId', '==', 't1')))); await assertFails(getDocs(query(collection(coach, 'roster'), where('teamId', '==', 't2')))); await assertFails(getDocs(collection(coach, 'roster')));
await assertSucceeds(getDocs(query(collection(mem, 'roster'), where('email', '==', 'mem@x.com')))); await assertFails(getDocs(query(collection(mem, 'roster'), where('teamId', '==', 't1')))); await assertSucceeds(getDocs(collection(admin, 'roster')));
ok('coach lists their own teams’ rosters; everyone can list their own memberships');
// ---- one person, several teams, a role per team ----
const pro = as('u-pro', 'pro@x.com');
await assertSucceeds(updateDoc(doc(pro, 'teams/t3'), { name: 'Gamma Ray' })); await assertFails(updateDoc(doc(pro, 'teams/t1'), { name: 'Hijack' }));
await assertSucceeds(setDoc(doc(pro, 'roster/t3__kid@gmail.com'), R('t3', 'kid@gmail.com', 'member', { addedBy: 'pro@x.com' }))); await assertFails(setDoc(doc(pro, 'roster/t1__kid@gmail.com'), R('t1', 'kid@gmail.com', 'member', { addedBy: 'pro@x.com' })));
await assertSucceeds(setDoc(doc(pro, 'practice/ppro1'), { uid: 'u-pro', teamId: 't1', total: 40 })); await assertSucceeds(setDoc(doc(pro, 'practice/ppro3'), { uid: 'u-pro', teamId: 't3', total: 45 }));
await assertSucceeds(getDocs(query(collection(pro, 'practice'), where('teamId', '==', 't1')))); await assertSucceeds(getDocs(query(collection(pro, 'practice'), where('teamId', '==', 't3')))); await assertFails(getDocs(query(collection(pro, 'practice'), where('teamId', '==', 't2'))));
await assertFails(getDoc(doc(pro, 'teamSecrets/t1'))); await assertSucceeds(getDoc(doc(pro, 'teamSecrets/t3'))); await assertFails(deleteDoc(doc(pro, 'practice/p2'))); await assertSucceeds(deleteDoc(doc(pro, 'practice/ppro1')));
ok('a coach of t3 who is only a member of t1 gets coach powers on t3 and plain-member powers on t1 (practice yes; rename, password, people no)');
await assertSucceeds(deleteDoc(doc(pro, 'roster/t1__pro@x.com'))); await assertFails(deleteDoc(doc(pro, 'roster/t3__pro@x.com'))); await assertFails(getDocs(query(collection(pro, 'practice'), where('teamId', '==', 't1'))));
ok('a member can leave a team (and loses its data); a coach cannot walk out of their own team');
await assertSucceeds(setDoc(doc(admin, 'roster/t1__admin@x.com'), R('t1', 'admin@x.com', 'coach', { addedBy: 'admin@x.com' }))); await assertSucceeds(setDoc(doc(admin, 'roster/t2__host@x.com'), R('t2', 'host@x.com', 'coach', { addedBy: 'admin@x.com' })));
await assertSucceeds(updateDoc(doc(admin, 'teams/t1'), { colors: ['#112233', '#abcdef'] })); await assertSucceeds(updateDoc(doc(admin, 'teams/t1'), { name: 'Alpha' }));
ok('admins (and hosts, judges…) can also be coaches via the roster without losing their role');
await assertSucceeds(updateDoc(doc(coach, 'teams/t1'), { colors: ['#1a9e6b', '#f4c20d', '#6c4bd1'] })); await assertSucceeds(updateDoc(doc(coach, 'teams/t1'), { colors: [] })); await assertSucceeds(updateDoc(doc(coach, 'teams/t1'), { name: 'Alpha', colors: ['#FFAA00'] }));
await assertFails(updateDoc(doc(coach, 'teams/t1'), { colors: ['#111111', '#222222', '#333333', '#444444'] })); await assertFails(updateDoc(doc(coach, 'teams/t1'), { colors: ['red'] })); await assertFails(updateDoc(doc(coach, 'teams/t1'), { colors: ['#12345'] }));
await assertFails(updateDoc(doc(coach, 'teams/t1'), { colors: ['#12345g'] })); await assertFails(updateDoc(doc(coach, 'teams/t1'), { colors: 'blue' })); await assertFails(updateDoc(doc(coach, 'teams/t1'), { colors: [5] })); await assertFails(updateDoc(doc(coach, 'teams/t1'), { logo: 'x' }));
await assertFails(updateDoc(doc(coach, 'teams/t2'), { colors: ['#112233'] })); await assertFails(updateDoc(doc(mem, 'teams/t1'), { colors: ['#112233'] })); await assertFails(updateDoc(doc(host, 'teams/t7'), { colors: ['#112233'] }));
ok('coaches choose up to 3 hex team colors for their own team; invalid colors, extra fields, other teams, members and hosts are refused');
await assertSucceeds(setDoc(doc(coach, 'practice/pn'), { uid: 'u-coach', teamId: 't1', total: 80 })); await assertFails(setDoc(doc(coach, 'practice/pm'), { uid: 'u-coach', teamId: 't2', total: 80 }));
await assertFails(setDoc(doc(coach, 'practice/pm'), { uid: 'someone', teamId: 't1', total: 80 })); await assertFails(setDoc(doc(coach, 'practice/pm'), { uid: 'u-coach', teamId: 't1', total: 9999 }));
await assertSucceeds(getDocs(query(collection(coach, 'practice'), where('teamId', '==', 't1')))); await assertFails(getDocs(query(collection(coach, 'practice'), where('teamId', '==', 't2')))); await assertFails(getDocs(collection(coach, 'practice')));
await assertSucceeds(deleteDoc(doc(coach, 'practice/pn'))); await assertFails(deleteDoc(doc(coach, 'practice/p2'))); await assertSucceeds(updateDoc(doc(coach, 'practice/p1'), { total: 101, note: 'edited' })); await assertFails(updateDoc(doc(coach, 'practice/p2'), { total: 1 }));
await assertFails(updateDoc(doc(coach, 'practice/p1'), { teamId: 't2' })); await assertFails(updateDoc(doc(coach, 'practice/p1'), { uid: 'u-mem' })); await assertFails(updateDoc(doc(coach, 'practice/p1'), { createdAt: 2 })); await assertFails(updateDoc(doc(coach, 'practice/p1'), { total: 5000 }));
ok('practice runs are private to the team: coach can add/read/edit/delete their own team’s, never another team’s; edits cannot move a run or fake its owner/date');
// member
await assertSucceeds(setDoc(doc(mem, 'practice/pmem'), { uid: 'u-mem', teamId: 't1', total: 70 })); await assertSucceeds(getDocs(query(collection(mem, 'practice'), where('teamId', '==', 't1'))));
await assertSucceeds(updateDoc(doc(mem, 'practice/p1'), { note: 'member edit' })); await assertFails(updateDoc(doc(mem, 'practice/p2'), { note: 'x' }));
await assertSucceeds(setDoc(doc(coach, 'practice/pcr'), { uid: 'u-coach', teamId: 't1', total: 10, createdAt: 5 })); await assertSucceeds(deleteDoc(doc(mem, 'practice/pcr'))); await assertSucceeds(deleteDoc(doc(mem, 'practice/pmem'))); await assertFails(deleteDoc(doc(mem, 'practice/p2')));
await assertFails(updateDoc(doc(mem, 'teams/t1'), { name: 'x' })); await assertFails(setDoc(doc(mem, 'access/friend@gmail.com'), { role: 'member', teamId: 't1', addedBy: 'mem@x.com', addedAt: 1 }));
await assertFails(getDocs(collection(mem, 'access'))); await assertSucceeds(getDoc(doc(mem, 'access/mem@x.com'))); await assertFails(getDoc(doc(mem, 'access/coach@x.com')));
await assertFails(setDoc(doc(mem, 'scores/ev1_t1_R2'), score({ teamId: 't1', round: 2, judgeUid: 'u-mem' })));
ok('team member: practice for own team (edit and delete any of the team’s runs, never another team’s); cannot rename, add people, or score officially');
await assertSucceeds(getDocs(query(collection(coach2, 'practice'), where('teamId', '==', 't2')))); await assertFails(getDoc(doc(coach2, 'practice/p1'))); ok('other teams can’t read this team’s runs');
// host (per-event layer)
await assertSucceeds(setDoc(doc(admin, 'access/newhost@gmail.com'), { role: 'host', addedBy: 'admin@x.com' })); await assertSucceeds(setDoc(doc(admin, 'eventHosts/ev3'), { emails: ['newhost@gmail.com'] }));
await assertFails(setDoc(doc(host, 'eventHosts/ev1'), { emails: ['host@x.com', 'me@x.com'] })); await assertFails(setDoc(doc(coach, 'eventHosts/ev1'), { emails: ['coach@x.com'] }));
await assertFails(setDoc(doc(host, 'access/pal@gmail.com'), { role: 'host' })); await assertFails(setDoc(doc(coach, 'access/x9@gmail.com'), { role: 'host', teamId: 't1', addedBy: 'coach@x.com', addedAt: 1 }));
ok('only admins create hosts / assign event hosts');
await assertSucceeds(getDoc(doc(host, 'eventHosts/ev1'))); await assertFails(getDoc(doc(host, 'eventHosts/ev2'))); await assertFails(getDoc(doc(anon, 'eventHosts/ev1'))); await assertFails(getDoc(doc(coach, 'eventHosts/ev1')));
await assertSucceeds(getDocs(query(collection(host, 'eventHosts'), where('emails', 'array-contains', 'host@x.com')))); await assertFails(getDocs(collection(host, 'eventHosts'))); await assertSucceeds(getDocs(collection(admin, 'eventHosts')));
ok('host lists only the events they host; host emails are not public');
await assertSucceeds(setDoc(doc(host, 'teams/t20'), { number: 20, name: 'Twenty', createdBy: 'host@x.com' }));
await assertFails(setDoc(doc(host, 'teams/t21'), { number: 21, name: 'No creator' })); await assertFails(setDoc(doc(host, 'teams/t22'), { number: 22, name: 'Forged', createdBy: 'admin@x.com' }));
await assertFails(setDoc(doc(host, 'teams/t23'), { number: 23, name: '', createdBy: 'host@x.com' })); await assertFails(setDoc(doc(host, 'teams/t24'), { name: 'No number', createdBy: 'host@x.com' }));
ok('host adds teams the way admins do (number + name required, creator recorded)');
await assertSucceeds(updateDoc(doc(host, 'teams/t7'), { name: 'Seven Up' })); await assertFails(updateDoc(doc(host, 'teams/t7'), { number: 70 })); await assertFails(updateDoc(doc(host, 'teams/t8'), { name: 'Steal' })); await assertFails(updateDoc(doc(host, 'teams/t1'), { name: 'Steal' }));
await assertSucceeds(deleteDoc(doc(host, 'teams/t20'))); await assertFails(deleteDoc(doc(host, 'teams/t8'))); await assertFails(deleteDoc(doc(host, 'teams/t1')));
ok('host renames/deletes only teams they created');
const sched = { config: { rounds: 3, tables: 4 }, rows: [{ round: 1, slot: 1, time: '09:00', table: 1, teamId: 't1' }] };
await assertSucceeds(updateDoc(doc(host, 'events/ev1'), { teamIds: ['t1', 't2'] })); await assertSucceeds(updateDoc(doc(host, 'events/ev1'), { schedule: sched }));
await assertFails(updateDoc(doc(host, 'events/ev1'), { name: 'Renamed' })); await assertFails(updateDoc(doc(host, 'events/ev1'), { live: false })); await assertFails(updateDoc(doc(host, 'events/ev1'), { teamIds: [], name: 'x' }));
await assertFails(updateDoc(doc(host, 'events/ev2'), { teamIds: ['t1'] })); await assertFails(updateDoc(doc(host2, 'events/ev1'), { schedule: sched })); await assertFails(setDoc(doc(host, 'events/ev9'), { name: 'mine' })); await assertFails(deleteDoc(doc(host, 'events/ev1')));
ok('host edits ONLY teamIds + schedule, ONLY on events they host; cannot create/rename/delete events');
await assertSucceeds(setDoc(doc(host, 'scores/ev1_t2_R2'), score({ round: 2, judgeUid: 'u-host' }))); await assertSucceeds(setDoc(doc(host, 'signatures/ev1_t2_R2'), { signature: 'data:z' }));
await assertFails(setDoc(doc(host, 'scores/ev2_t2_R1'), score({ eventId: 'ev2', judgeUid: 'u-host' }))); await assertFails(setDoc(doc(host, 'scores/ev1_t2_R2'), score({ round: 2, total: 1, judgeUid: 'u-host' })));
await assertFails(updateDoc(doc(host, 'scores/ev1_t2_R2'), { total: 1 })); await assertFails(deleteDoc(doc(host2, 'scores/ev1_t2_R2'))); await assertFails(deleteDoc(doc(judge, 'scores/ev1_t2_R2'))); await assertFails(deleteDoc(doc(coach, 'scores/ev1_t2_R2')));
await assertSucceeds(deleteDoc(doc(host, 'signatures/ev1_t2_R2'))); await assertSucceeds(deleteDoc(doc(host, 'scores/ev1_t2_R2'))); await assertFails(deleteDoc(doc(host2, 'signatures/ev1_t1_R1')));
ok('host can enter official scores for their own events only (create-once), never edit; the host (not a judge or another event’s host) can delete a score + its signature so it can be re-scored');
await assertFails(getDocs(collection(host, 'practice'))); await assertFails(getDocs(collection(host, 'access'))); await assertSucceeds(getDoc(doc(host, 'access/host@x.com')));
ok('host has no access to practice runs or the access list');
await assertSucceeds(updateDoc(doc(admin, 'events/ev1'), { name: 'Regional 2026', live: true })); await assertSucceeds(updateDoc(doc(admin, 'teams/t7'), { name: 'Admin edit', number: 7 })); ok('admin still controls everything');
// host is a modifier: a coach can be host of one event
await assertSucceeds(updateDoc(doc(coachHost, 'teams/t1'), { name: 'Alpha (renamed by coach-host)' })); await assertSucceeds(updateDoc(doc(coachHost, 'events/ev1'), { teamIds: ['t1'] }));
await assertSucceeds(setDoc(doc(coachHost, 'teams/t30'), { number: 30, name: 'Thirty', createdBy: 'coachhost@x.com' })); await assertSucceeds(setDoc(doc(coachHost, 'practice/pch'), { uid: 'u-ch', teamId: 't1', total: 60 }));
await assertFails(updateDoc(doc(coachHost, 'events/ev2'), { teamIds: ['t1'] })); await assertFails(setDoc(doc(coachHost, 'scores/ev2_t1_R1'), score({ eventId: 'ev2', teamId: 't1', judgeUid: 'u-ch' })));
await assertSucceeds(setDoc(doc(coachHost, 'scores/ev1_t2_R3'), score({ round: 3, judgeUid: 'u-ch' })));
ok('a coach who is also host of ev1 gets host powers on ev1 only, keeps coach powers, gets nothing on ev2');
await assertFails(updateDoc(doc(coach, 'events/ev1'), { teamIds: ['t1'] })); await assertFails(setDoc(doc(coach, 'teams/t31'), { number: 31, name: 'No', createdBy: 'coach@x.com' }));
await assertFails(setDoc(doc(coach, 'access/self@gmail.com'), { role: 'member', teamId: 't1', host: true, addedBy: 'coach@x.com', addedAt: 1 })); await assertFails(updateDoc(doc(coach, 'access/mem@x.com'), { host: true }));
ok('a plain coach cannot grant host to anyone');
// hosts add referees/judges
await assertSucceeds(setDoc(doc(host, 'access/ref1@gmail.com'), { role: 'judge', name: 'Ref One', eventIds: ['ev1'], addedBy: 'host@x.com', addedAt: 1 }));
await assertSucceeds(setDoc(doc(coachHost, 'access/ref2@gmail.com'), { role: 'judge', eventIds: ['ev1'], addedBy: 'coachhost@x.com', addedAt: 1 }));
await assertFails(setDoc(doc(host, 'access/ref3@gmail.com'), { role: 'judge', eventIds: ['ev2'], addedBy: 'host@x.com', addedAt: 1 }));
await assertFails(setDoc(doc(host, 'access/ref4@gmail.com'), { role: 'judge', eventIds: ['ev1', 'ev2'], addedBy: 'host@x.com', addedAt: 1 }));
await assertFails(setDoc(doc(host, 'access/ref5@gmail.com'), { role: 'judge', addedBy: 'host@x.com', addedAt: 1 }));
await assertFails(setDoc(doc(host, 'access/ref6@gmail.com'), { role: 'admin', eventIds: ['ev1'], addedBy: 'host@x.com', addedAt: 1 })); await assertFails(setDoc(doc(host, 'access/ref7@gmail.com'), { role: 'host', eventIds: ['ev1'], addedBy: 'host@x.com', addedAt: 1 }));
await assertFails(setDoc(doc(host, 'access/ref8@gmail.com'), { role: 'judge', eventIds: ['ev1'], addedBy: 'someone@x.com', addedAt: 1 })); await assertFails(setDoc(doc(host, 'access/ref9@gmail.com'), { role: 'judge', eventIds: ['ev1'], addedBy: 'host@x.com', addedAt: 1, host: true }));
await assertFails(setDoc(doc(host, 'access/scoped@x.com'), { role: 'judge', eventIds: ['ev1'], addedBy: 'host@x.com', addedAt: 1 })); await assertFails(setDoc(doc(host, 'access/admin@x.com'), { role: 'judge', eventIds: ['ev1'], addedBy: 'host@x.com', addedAt: 1 }));
await assertFails(setDoc(doc(judge, 'access/ref10@gmail.com'), { role: 'judge', eventIds: ['ev1'], addedBy: 'judge@x.com', addedAt: 1 }));
ok('hosts add ONLY event-limited judges for events they host (not admins/hosts, no extra fields, no takeovers, plain judges can’t)');
await assertSucceeds(getDocs(query(collection(host, 'access'), where('role', '==', 'judge'), where('addedBy', '==', 'host@x.com')))); await assertFails(getDocs(query(collection(host, 'access'), where('role', '==', 'judge'), where('addedBy', '==', 'host2@x.com')))); await assertFails(getDocs(collection(host, 'access')));
await assertSucceeds(deleteDoc(doc(host, 'access/ref1@gmail.com'))); await assertFails(deleteDoc(doc(host, 'access/scoped@x.com'))); await assertFails(deleteDoc(doc(host, 'access/judge@x.com'))); await assertFails(updateDoc(doc(host, 'access/ref2@gmail.com'), { eventIds: ['ev1', 'ev2'] }));
ok('hosts list/remove only the judges they added; cannot widen a judge’s events');
// event-limited judges
await assertSucceeds(setDoc(doc(scoped, 'scores/ev2_t1_R1'), score({ eventId: 'ev2', teamId: 't1', judgeUid: 'u-sc' }))); await assertFails(setDoc(doc(scoped, 'scores/ev1_t1_R2'), score({ teamId: 't1', round: 2, judgeUid: 'u-sc' })));
await assertSucceeds(setDoc(doc(judge, 'scores/ev2_t2_R1'), score({ eventId: 'ev2', judgeUid: 'u-judge' }))); await assertSucceeds(setDoc(doc(admin, 'scores/ev2_t2_R2'), score({ eventId: 'ev2', round: 2, judgeUid: 'u-admin' })));
await assertFails(setDoc(doc(as('u-loose', 'loose@x.com'), 'scores/ev2_t4_R1'), score({ eventId: 'ev2', teamId: 't4', judgeUid: 'u-loose' })));
ok('referees can only score events they were added to (a referee account with no events scores nothing); admins can score any');
await assertSucceeds(setDoc(doc(admin, 'access/cohost@gmail.com'), { role: 'coach', teamId: 't1', host: true })); await assertSucceeds(updateDoc(doc(admin, 'access/coach@x.com'), { host: true })); ok('admins grant the host flag to anyone');
// referee is a per-event modifier too (a coach can referee)
await assertSucceeds(setDoc(doc(host, 'eventJudges/ev1'), { emails: ['coach2@x.com', 'coach@x.com'] })); await assertSucceeds(getDoc(doc(host, 'eventJudges/ev1')));
await assertFails(setDoc(doc(host, 'eventJudges/ev2'), { emails: ['coach@x.com'] })); await assertFails(setDoc(doc(coach, 'eventJudges/ev1'), { emails: ['coach@x.com', 'mem@x.com'] })); await assertFails(setDoc(doc(judge, 'eventJudges/ev1'), { emails: ['judge@x.com'] }));
await assertSucceeds(setDoc(doc(admin, 'eventJudges/ev2'), { emails: ['coach2@x.com'] })); await assertFails(setDoc(doc(host, 'eventJudges/ev1'), { emails: 'not-a-list' }));
ok('admins and an event’s hosts manage that event’s referee list; nobody else can');
await assertSucceeds(setDoc(doc(coach, 'scores/ev1_t1_R3'), score({ teamId: 't1', round: 3, judgeUid: 'u-coach' }))); await assertFails(setDoc(doc(coach, 'scores/ev2_t1_R1'), score({ eventId: 'ev2', teamId: 't1', judgeUid: 'u-coach' })));
await assertSucceeds(setDoc(doc(coach, 'signatures/ev1_t1_R3'), { signature: 'data:q' })); await assertSucceeds(getDoc(doc(coach, 'signatures/ev1_t1_R1'))); await assertFails(getDoc(doc(coach, 'signatures/ev2_t1_R1'))); await assertFails(setDoc(doc(coach, 'signatures/ev2_t1_R2'), { signature: 'data:q' }));
await assertSucceeds(updateDoc(doc(coach, 'teams/t1'), { name: 'Coach still coaches' })); await assertFails(updateDoc(doc(coach, 'events/ev1'), { teamIds: [] }));
ok('a coach listed as referee of ev1 can score ev1 (+ its signatures) only, and is still just a coach everywhere else');
await assertSucceeds(getDocs(query(collection(coach, 'eventJudges'), where('emails', 'array-contains', 'coach@x.com')))); await assertFails(getDocs(collection(coach, 'eventJudges'))); await assertFails(getDoc(doc(mem, 'eventJudges/ev1'))); await assertSucceeds(getDocs(collection(admin, 'eventJudges')));
ok('people can look up the events they referee, but not the lists');
await assertSucceeds(getDoc(doc(host, 'signatures/ev1_t1_R1'))); await assertFails(getDoc(doc(host2, 'signatures/ev1_t1_R1'))); await assertFails(getDoc(doc(judge2, 'signatures/ev1_t1_R1'))); await assertSucceeds(getDoc(doc(judge, 'signatures/ev1_t1_R1')));
ok('signatures are visible to an event’s referees/hosts/admins and unscoped judges — not to other events’ staff');
// ---- team password sign-in (anonymous session OR a Google account proves it knows the shared password) ----
const anon1 = anonCtx('anon-1'), anon2 = anonCtx('anon-2');
const TM = (uid, t, pw, extra = {}) => ({ uid, teamId: t, password: pw, name: 'Sam', createdAt: 1, ...extra });
await assertSucceeds(setDoc(doc(anon1, 'teamMembers/anon-1_t1'), TM('anon-1', 't1', '123456')));
await assertFails(setDoc(doc(anon2, 'teamMembers/anon-2_t1'), TM('anon-2', 't1', '000000'))); await assertFails(setDoc(doc(anon2, 'teamMembers/anon-2_t1'), TM('anon-2', 't1', '654321')));
await assertFails(setDoc(doc(anon2, 'teamMembers/anon-2_t9'), TM('anon-2', 't9', '123456'))); await assertFails(setDoc(doc(anon2, 'teamMembers/anon-1_t1'), TM('anon-2', 't1', '123456'))); await assertFails(setDoc(doc(anon2, 'teamMembers/anon-2_t1'), TM('anon-1', 't1', '123456')));
await assertFails(setDoc(doc(anon2, 'teamMembers/anon-2_t1'), TM('anon-2', 't1', '123456', { extra: 1 }))); await assertFails(setDoc(doc(anon2, 'teamMembers/anon-2'), TM('anon-2', 't1', '123456')));
ok('joining with the team password needs the right password for that team, under your own uid and the id uid_teamId');
await assertSucceeds(setDoc(doc(anon1, 'teamMembers/anon-1_t2'), TM('anon-1', 't2', '654321')));
await assertSucceeds(setDoc(doc(anon1, 'practice/pa1'), { uid: 'anon-1', teamId: 't1', by: 'Sam', total: 90 })); await assertSucceeds(setDoc(doc(anon1, 'practice/pa2'), { uid: 'anon-1', teamId: 't2', total: 90 })); await assertFails(setDoc(doc(anon1, 'practice/pa3'), { uid: 'someone', teamId: 't1', total: 90 }));
await assertSucceeds(getDocs(query(collection(anon1, 'practice'), where('teamId', '==', 't1')))); await assertSucceeds(getDocs(query(collection(anon1, 'practice'), where('teamId', '==', 't2')))); await assertFails(getDocs(query(collection(anon1, 'practice'), where('teamId', '==', 't3')))); await assertFails(getDocs(collection(anon1, 'practice')));
await assertSucceeds(deleteDoc(doc(anon1, 'practice/pa2'))); await assertSucceeds(updateDoc(doc(anon1, 'practice/p1'), { note: 'anon edit' })); await assertFails(deleteDoc(doc(anon1, 'practice/p3'))); await assertFails(updateDoc(doc(anon1, 'practice/p3'), { note: 'x' })); await assertSucceeds(getDocs(collection(anon1, 'teams'))); await assertSucceeds(getDocs(collection(anon1, 'scores')));
await assertSucceeds(getDocs(query(collection(anon1, 'teamMembers'), where('uid', '==', 'anon-1')))); await assertFails(getDocs(query(collection(anon1, 'teamMembers'), where('uid', '==', 'anon-2'))));
ok('one anonymous visitor can be on several teams by password and gets exactly member powers on each (practice + stats) plus the public data');
await assertFails(setDoc(doc(anon1, 'scores/ev1_t1_R2'), score({ teamId: 't1', round: 2, judgeUid: 'anon-1' }))); await assertFails(setDoc(doc(anon1, 'access/x@gmail.com'), { role: 'admin' })); await assertFails(setDoc(doc(anon1, 'teams/t99'), { number: 99, name: 'x', createdBy: 'a' })); await assertFails(updateDoc(doc(anon1, 'teams/t1'), { name: 'Hijack' })); await assertFails(updateDoc(doc(anon1, 'teams/t1'), { colors: ['#112233'] }));
await assertFails(setDoc(doc(anon1, 'roster/t1__a@gmail.com'), R('t1', 'a@gmail.com', 'coach', { addedBy: 'x' }))); await assertFails(getDocs(query(collection(anon1, 'roster'), where('teamId', '==', 't1'))));
await assertFails(getDoc(doc(anon1, 'teamSecrets/t1'))); await assertFails(getDoc(doc(anon1, 'signatures/ev1_t1_R1'))); await assertFails(setDoc(doc(anon1, 'teamSecrets/t1'), { password: 'newpass', updatedBy: 'x', updatedAt: 1 })); await assertFails(setDoc(doc(anon1, 'events/evX'), { name: 'x' }));
ok('…and never anything elevated: no scoring, no people, no team edits or colors, cannot read or change the team password');
// a Google account on the access list can also join a team with the password (linked to the account by uid)
await assertSucceeds(setDoc(doc(stranger2, 'teamMembers/u-s2_t2'), TM('u-s2', 't2', '654321'))); await assertSucceeds(setDoc(doc(stranger2, 'practice/pgg'), { uid: 'u-s2', teamId: 't2', total: 33 })); await assertFails(setDoc(doc(stranger2, 'practice/pgg2'), { uid: 'u-s2', teamId: 't1', total: 33 }));
await assertFails(setDoc(doc(stranger, 'teamMembers/u-s_t2'), TM('u-s', 't2', '654321'))); await assertFails(setDoc(doc(stranger2, 'roster/t2__ghost2@gmail.com'), R('t2', 'ghost2@gmail.com', 'coach', { addedBy: 'ghost2@gmail.com' })));
await assertFails(updateDoc(doc(stranger2, 'teams/t2'), { name: 'Hijack' })); await assertFails(getDoc(doc(stranger2, 'teamSecrets/t2')));
ok('a listed Google account can add a team by password (member powers only); an unlisted account cannot');
await assertSucceeds(getDoc(doc(coach, 'teamSecrets/t1'))); await assertFails(getDoc(doc(coach, 'teamSecrets/t2'))); await assertFails(getDoc(doc(mem, 'teamSecrets/t1'))); await assertFails(getDoc(doc(judge, 'teamSecrets/t1'))); await assertSucceeds(getDoc(doc(admin, 'teamSecrets/t2')));
await assertSucceeds(setDoc(doc(coach, 'teamSecrets/t1'), { password: '987654', updatedBy: 'coach@x.com', updatedAt: 2, isDefault: false }));
await assertFails(setDoc(doc(coach, 'teamSecrets/t2'), { password: '987654', updatedBy: 'coach@x.com', updatedAt: 2 })); await assertFails(setDoc(doc(coach, 'teamSecrets/t1'), { password: '123', updatedBy: 'coach@x.com', updatedAt: 2 }));
await assertFails(setDoc(doc(coach, 'teamSecrets/t1'), { password: 'abcdefg', updatedBy: 'someone@else.com', updatedAt: 2 })); await assertFails(setDoc(doc(coach, 'teamSecrets/t1'), { password: 'abcdefg', updatedBy: 'coach@x.com', updatedAt: 2, x: 1 })); await assertFails(deleteDoc(doc(coach, 'teamSecrets/t1')));
await assertFails(setDoc(doc(coach, 'teamSecrets/t1'), { password: 'abcdefg', updatedBy: 'coach@x.com', updatedAt: 2, enabled: 'no' }));
ok('only that team’s coaches (and admins, and the host who created the team) can read or change the team password');
await assertFails(getDoc(doc(host, 'teamSecrets/t7'))); await assertFails(getDoc(doc(host, 'teamSecrets/t8'))); await assertFails(getDoc(doc(host, 'teamSecrets/t1'))); await assertSucceeds(setDoc(doc(host, 'teamSecrets/t7'), { password: '135790', updatedBy: 'host@x.com', updatedAt: 3 })); await assertFails(setDoc(doc(host, 'teamSecrets/t8'), { password: '135790', updatedBy: 'host@x.com', updatedAt: 3 }));
ok('a host manages the password only of teams they created');
await assertFails(getDocs(query(collection(anon1, 'practice'), where('teamId', '==', 't1')))); await assertFails(setDoc(doc(anon1, 'practice/pa4'), { uid: 'anon-1', teamId: 't1', total: 50 }));
await assertSucceeds(getDocs(query(collection(anon1, 'practice'), where('teamId', '==', 't2'))));
ok('changing a team’s password locks the old password members of THAT team out immediately (their other teams are unaffected)');
await assertSucceeds(setDoc(doc(anon1, 'teamMembers/anon-1_t1'), TM('anon-1', 't1', '987654'))); await assertSucceeds(setDoc(doc(anon1, 'practice/pa5'), { uid: 'anon-1', teamId: 't1', by: 'Sam', total: 60 }));
await assertSucceeds(getDocs(query(collection(coach, 'teamMembers'), where('teamId', '==', 't1')))); await assertFails(getDocs(query(collection(coach, 'teamMembers'), where('teamId', '==', 't2')))); await assertSucceeds(deleteDoc(doc(coach, 'teamMembers/anon-1_t1')));
ok('signing in again with the new password restores access; coaches can see and remove password members of their team');
// password sign-in ON by default, a coach can turn it off
await assertSucceeds(setDoc(doc(coach, 'teamSecrets/t1'), { password: '987654', enabled: false, isDefault: false, updatedBy: 'coach@x.com', updatedAt: 4 }));
await assertFails(setDoc(doc(anon2, 'teamMembers/anon-2_t1'), TM('anon-2', 't1', '987654'))); await assertFails(setDoc(doc(anon1, 'practice/pa6'), { uid: 'anon-1', teamId: 't1', total: 5 }));
await assertSucceeds(setDoc(doc(coach, 'teamSecrets/t1'), { password: '987654', enabled: true, isDefault: false, updatedBy: 'coach@x.com', updatedAt: 5 })); await assertSucceeds(setDoc(doc(anon2, 'teamMembers/anon-2_t1'), TM('anon-2', 't1', '987654')));
ok('password sign-in is ON unless the coach turns it off; turning it off blocks new joins and cuts off existing password members, turning it on restores them');
// hosts can set up a designated coach for a team they created
await assertSucceeds(setDoc(doc(host, 'access/designated@gmail.com'), { role: 'coach', teamId: 't7', addedBy: 'host@x.com', addedAt: 1 })); await assertFails(setDoc(doc(host, 'access/designated2@gmail.com'), { role: 'coach', teamId: 't8', addedBy: 'host@x.com', addedAt: 1 })); await assertFails(setDoc(doc(host, 'access/designated3@gmail.com'), { role: 'coach', teamId: 't1', addedBy: 'host@x.com', addedAt: 1 }));
await assertFails(setDoc(doc(host, 'access/coach@x.com'), { role: 'coach', teamId: 't7', addedBy: 'host@x.com', addedAt: 1 }));
await assertSucceeds(setDoc(doc(host, 'roster/t7__designated@gmail.com'), R('t7', 'designated@gmail.com', 'coach', { addedBy: 'host@x.com' }))); await assertSucceeds(setDoc(doc(host, 'roster/t7__pro@x.com'), R('t7', 'pro@x.com', 'coach', { addedBy: 'host@x.com' })));
await assertFails(setDoc(doc(host, 'roster/t8__d2@gmail.com'), R('t8', 'd2@gmail.com', 'coach', { addedBy: 'host@x.com' }))); await assertFails(setDoc(doc(host, 'roster/t1__d3@gmail.com'), R('t1', 'd3@gmail.com', 'coach', { addedBy: 'host@x.com' }))); await assertFails(setDoc(doc(host, 'roster/t7__d4@gmail.com'), R('t7', 'd4@gmail.com', 'member', { addedBy: 'host@x.com' })));
ok('a host designates coaches (new accounts, or existing ones such as a pro coach with several teams) for teams they created only — never for others’ teams, never plain members');
await assertSucceeds(updateDoc(doc(pro, 'teams/t7'), { name: 'Seven (by pro)' })); await assertSucceeds(setDoc(doc(pro, 'practice/ppro7'), { uid: 'u-pro', teamId: 't7', total: 12 }));
ok('the pro coach now coaches t3 and t7 at once');
// ---- exactly what the app sends when a judge submits: score + signature in ONE batch ----
{
  const res = scoreAll(defaultState());
  const payload = (eventId, teamId, round, uid) => ({ eventId, eventName: 'Regional', teamId, number: +teamId.slice(1), name: 'Team', round, total: res.total, gp: res.gp, state: res.state, result: slim(res), initials: 'AB', judgeUid: uid, judgeName: 'Jo', table: '3', createdAt: Date.now(), hasSignature: true });
  const sig = 'data:image/png;base64,' + 'A'.repeat(150000);
  const submit = (db, eventId, teamId, round, uid, signature = sig) => { const id = `${eventId}_${teamId}_R${round}`; const b = writeBatch(db); b.set(doc(db, 'scores', id), payload(eventId, teamId, round, uid)); b.set(doc(db, 'signatures', id), { signature, judgeUid: uid, createdAt: Date.now() }); return b.commit(); };
  const can = async (label, p) => { try { await assertSucceeds(p); } catch (e) { console.log('SHOULD WORK BUT FAILED: ' + label); throw e; } };
  const cannot = async (label, p) => { try { await assertFails(p); } catch (e) { console.log('SHOULD FAIL BUT WORKED: ' + label); throw e; } };
  await can('unscoped judge, event without referee list', submit(judge, 'ev2', 't3', 1, 'u-judge'));
  await cannot('judge re-submits same match', submit(judge, 'ev2', 't3', 1, 'u-judge'));
  await can('event-limited judge on own event', submit(scoped, 'ev2', 't2', 3, 'u-sc')); await cannot('event-limited judge on other event', submit(scoped, 'ev1', 't2', 3, 'u-sc'));
  await can('host of ev1', submit(host, 'ev1', 't7', 1, 'u-host')); await cannot('host of another event', submit(host2, 'ev1', 't7', 2, 'u-host2'));
  await can('coach listed as referee', submit(coach2, 'ev1', 't8', 1, 'u-coach2'));
  await cannot('member', submit(mem, 'ev1', 't1', 1, 'u-mem')); await cannot('anonymous team member', submit(anon1, 'ev1', 't1', 2, 'anon-1'));
  await cannot('oversized signature', submit(judge, 'ev2', 't3', 2, 'u-judge', 'data:image/png;base64,' + 'A'.repeat(250000))); await cannot('forged judge uid', submit(judge, 'ev2', 't3', 2, 'someone-else'));
  await can('admin', submit(admin, 'ev2', 't3', 3, 'u-admin'));
  await cannot('judge deletes a score', deleteDoc(doc(judge, 'scores/ev2_t3_R1')));
  await can('host deletes signature', deleteDoc(doc(host2, 'signatures/ev2_t3_R1'))); await can('host deletes score', deleteDoc(doc(host2, 'scores/ev2_t3_R1')));
  await can('judge scores the match again after the host deleted it', submit(judge, 'ev2', 't3', 1, 'u-judge'));
  ok('judges (unscoped, event-limited), hosts, listed referees and admins can submit the real app payload; members/anon/other events cannot; no replacing — a host deletes first');

  // ── editions: Founders (standard) + Future ──
  const fst = defaultState('future'); fst.m.f03.cycled = 50; fst.m.f01.young = 3; fst.m.f01.grand = 3; fst.m.f01.hollow = 3; fst.m.f01.queen = true; fst.m.f02.base = 50; fst.m.f02.canopy = 15; fst.m.f06.added = 5; fst.m.f06.contained = 25; fst.m.f04.species = true; fst.m.f04.resources = true; fst.m.f05.haven = 50;
  const fres = scoreAll(fst, 'future');
  assert.ok(fres.total > 1000, 'a legal Future maximum is above the old 1000 cap');
  const fpayload = (eventId, teamId, round, uid, o = {}) => ({ ...payload(eventId, teamId, round, uid), edition: 'future', total: fres.total, gp: fres.gp, state: fres.state, result: slim(fres), ...o });
  const fsubmit = (db, eventId, teamId, round, uid, o) => { const id = `${eventId}_${teamId}_R${round}`; const b = writeBatch(db); b.set(doc(db, 'scores', id), fpayload(eventId, teamId, round, uid, o)); b.set(doc(db, 'signatures', id), { signature: sig, judgeUid: uid, createdAt: Date.now() }); return b.commit(); };
  await can('judge submits a Future score (above 1000)', fsubmit(judge, 'ev2', 't7', 1, 'u-judge'));
  await cannot('a made-up edition', fsubmit(judge, 'ev2', 't7', 2, 'u-judge', { edition: 'bogus' }));
  await cannot('a total above 5000', fsubmit(judge, 'ev2', 't7', 2, 'u-judge', { total: 5001 }));
  await can('a score with no edition field (data from before editions)', submit(judge, 'ev2', 't7', 3, 'u-judge'));
  await can('admin creates a Future team', setDoc(doc(admin, 'teams/t30'), { number: 30, name: 'Thirty', edition: 'future', createdBy: 'admin@x.com' }));
  await cannot('admin creates a team with a made-up edition', setDoc(doc(admin, 'teams/t31'), { number: 31, name: 'ThirtyOne', edition: 'bogus', createdBy: 'admin@x.com' }));
  await can('host creates a Future team', setDoc(doc(host, 'teams/t32'), { number: 32, name: 'ThirtyTwo', edition: 'future', createdBy: 'host@x.com' }));
  await can('admin switches a team’s edition', updateDoc(doc(admin, 'teams/t30'), { edition: 'founders' })); await cannot('…but not to a made-up one', updateDoc(doc(admin, 'teams/t30'), { edition: 'bogus' }));
  await cannot('a host cannot change a team’s edition', updateDoc(doc(host, 'teams/t32'), { edition: 'founders' })); await cannot('a coach cannot change their team’s edition', updateDoc(doc(coach, 'teams/t1'), { edition: 'future' }));
  await can('admin creates an event for Future only', setDoc(doc(admin, 'events/evF'), { name: 'Future Day', editions: ['future'] })); await can('…for both editions', setDoc(doc(admin, 'events/evB'), { name: 'Both Day', editions: ['founders', 'future'] }));
  await can('admin creates a test event', setDoc(doc(admin, 'events/evT'), { name: 'Test Day', editions: ['founders', 'future'], test: true, teamIds: [] })); await cannot('…but test must be true/false', setDoc(doc(admin, 'events/evT2'), { name: 'T', test: 'yes' }));
  await can('…and an event with no editions field (Founders)', setDoc(doc(admin, 'events/evOld'), { name: 'Old style' }));
  await can('admin changes an existing event\'s editions', updateDoc(doc(admin, 'events/evOld'), { editions: ['future'] })); await cannot('…but not to a made-up edition', updateDoc(doc(admin, 'events/evOld'), { editions: ['bogus'] }));
  await cannot('a host cannot change an event\'s editions', updateDoc(doc(host, 'events/ev1'), { editions: ['future'] }));
  await cannot('an event with a made-up edition', setDoc(doc(admin, 'events/evX'), { name: 'X', editions: ['bogus'] })); await cannot('an event with an empty edition list', setDoc(doc(admin, 'events/evY'), { name: 'Y', editions: [] }));
  await cannot('an event listing editions three times', setDoc(doc(admin, 'events/evZ'), { name: 'Z', editions: ['future', 'future', 'founders'] }));
  await can('a team member saves a Future practice run', setDoc(doc(coach, 'practice/pf1'), { uid: 'u-coach', teamId: 't1', total: 1100, edition: 'future', createdAt: 5 }));
  await cannot('…but not with a made-up edition', setDoc(doc(coach, 'practice/pf2'), { uid: 'u-coach', teamId: 't1', total: 10, edition: 'bogus', createdAt: 5 }));
  ok('editions: Future scores/practice runs/teams/events validate; only admins create events and switch a team’s edition');
}

// ── live help chat ──
{
  const T = 'abcdefghij0123456789abcd', now = Date.now();
  const thread = (o = {}) => ({ name: 'Pat', contact: 'Table 3', email: '', createdAt: now, lastAt: now, lastFrom: 'user', last: 'hi', resolved: false, ...o });
  await assertSucceeds(setDoc(doc(anon, `helpThreads/${T}`), thread())); await assertSucceeds(setDoc(doc(anon, `helpThreads/${T}/msgs/m1`), { from: 'user', text: 'hi', createdAt: now }));
  await assertSucceeds(getDoc(doc(anon, `helpThreads/${T}`))); await assertSucceeds(getDocs(collection(anon, `helpThreads/${T}/msgs`)));
  await assertFails(getDocs(collection(anon, 'helpThreads'))); await assertFails(getDocs(collection(judge, 'helpThreads')));
  await assertSucceeds(getDocs(collection(admin, 'helpThreads')));
  await assertFails(setDoc(doc(anon, 'helpThreads/short'), thread())); await assertFails(setDoc(doc(anon, `helpThreads/${T}x2345678901234567`), thread({ lastFrom: 'admin' })));
  await assertFails(setDoc(doc(anon, `helpThreads/${T}z`), thread({ email: 'admin@x.com' }))); await assertSucceeds(setDoc(doc(as('u-g', 'guest@gmail.com'), `helpThreads/${T}y`), thread({ email: 'guest@gmail.com' })));
  await assertFails(setDoc(doc(anon, `helpThreads/${T}/msgs/m2`), { from: 'admin', text: 'I am support', createdAt: now })); await assertFails(setDoc(doc(judge, `helpThreads/${T}/msgs/m2`), { from: 'admin', text: 'x', createdAt: now }));
  await assertFails(setDoc(doc(anon, `helpThreads/${T}/msgs/m3`), { from: 'user', text: 'x'.repeat(501), createdAt: now })); await assertFails(setDoc(doc(anon, `helpThreads/${T}/msgs/m4`), { from: 'user', text: '', createdAt: now }));
  await assertSucceeds(setDoc(doc(admin, `helpThreads/${T}/msgs/m5`), { from: 'admin', text: 'On our way', createdAt: now + 1 }));
  await assertSucceeds(updateDoc(doc(anon, `helpThreads/${T}`), { lastAt: now + 2, lastFrom: 'user', last: 'again', resolved: false })); await assertFails(updateDoc(doc(anon, `helpThreads/${T}`), { lastFrom: 'admin' }));
  await assertFails(updateDoc(doc(anon, `helpThreads/${T}`), { resolved: true })); await assertFails(deleteDoc(doc(anon, `helpThreads/${T}`))); await assertFails(deleteDoc(doc(anon, `helpThreads/${T}/msgs/m1`)));
  await assertSucceeds(updateDoc(doc(admin, `helpThreads/${T}`), { resolved: true, lastFrom: 'admin' })); await assertSucceeds(deleteDoc(doc(admin, `helpThreads/${T}/msgs/m1`))); await assertSucceeds(deleteDoc(doc(admin, `helpThreads/${T}`)));
  ok('live help: anyone can ask (guests too, email only if it is really theirs); only admins list, reply, resolve and delete');
}
await env.cleanup();
console.log(`\n${passed} emulator checks passed`);
