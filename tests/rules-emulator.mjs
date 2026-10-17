// OPTIONAL deep check: runs firestore.rules in the real Firestore emulator and tries every role against it.
// Needs Java 11+, firebase-tools and @firebase/rules-unit-testing (not project dependencies):
//   npx -y -p firebase-tools@13 -p @firebase/rules-unit-testing@3 -p firebase@10 firebase emulators:exec --only firestore --project demo-glow "node tests/rules-emulator.mjs"
// (set NODE_PATH to wherever those packages are installed if node can't resolve them)
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { setDoc, getDoc, getDocs, updateDoc, deleteDoc, doc, collection, query, where } from 'firebase/firestore';

const emu = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8089').split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-glow', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: emu[0], port: +emu[1] } });
let passed = 0;
const ok = (n) => { passed++; console.log('  ok  ' + n); };

await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  const w = (p, d) => setDoc(doc(db, p), d);
  await w('access/admin@x.com', { role: 'admin' });
  await w('access/judge@x.com', { role: 'judge' });
  await w('access/host@x.com', { role: 'host' });
  await w('access/host2@x.com', { role: 'host' });
  await w('access/coach@x.com', { role: 'coach', teamId: 't1' });
  await w('access/coach2@x.com', { role: 'coach', teamId: 't2' });
  await w('access/mem@x.com', { role: 'member', teamId: 't1' });
  await w('teams/t1', { number: 1, name: 'Alpha' });
  await w('teams/t2', { number: 2, name: 'Beta' });
  await w('events/ev1', { name: 'Regional', live: true });
  await w('events/ev2', { name: 'Other event', live: false });
  await w('eventHosts/ev1', { emails: ['host@x.com'] });
  await w('eventHosts/ev2', { emails: ['host2@x.com'] });
  await w('teams/t7', { number: 7, name: 'Seven', createdBy: 'host@x.com' });
  await w('teams/t8', { number: 8, name: 'Eight', createdBy: 'host2@x.com' });
  await w('practice/p1', { uid: 'u-coach', teamId: 't1', total: 100 });
  await w('practice/p2', { uid: 'u-coach2', teamId: 't2', total: 90 });
  await w('signatures/ev1_t1_R1', { signature: 'data:x' });
  await w('scores/ev1_t1_R1', { eventId: 'ev1', teamId: 't1', round: 1, total: 100, gp: 3, hasSignature: true, judgeUid: 'u-judge' });
});
const as = (uid, email, verified = true) => env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
const anon = env.unauthenticatedContext().firestore();
const admin = as('u-admin', 'admin@x.com'), judge = as('u-judge', 'judge@x.com'), coach = as('u-coach', 'coach@x.com'), coach2 = as('u-coach2', 'coach2@x.com');
const host = as('u-host', 'host@x.com'), host2 = as('u-host2', 'host2@x.com');
const mem = as('u-mem', 'mem@x.com'), stranger = as('u-s', 'ghost@gmail.com'), unverified = as('u-admin2', 'admin@x.com', false);
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
await assertSucceeds(setDoc(doc(admin, 'teams/t3'), { number: 3, name: 'Gamma', createdBy: 'admin@x.com' }));
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
await assertFails(setDoc(doc(coach, 'access/x1@gmail.com'), { role: 'coach', teamId: 't1', addedBy: 'coach@x.com', addedAt: 1 }));
await assertFails(setDoc(doc(coach, 'access/x2@gmail.com'), { role: 'admin', addedBy: 'coach@x.com', addedAt: 1 }));
await assertFails(setDoc(doc(coach, 'access/x3@gmail.com'), { role: 'member', teamId: 't2', addedBy: 'coach@x.com', addedAt: 1 }));
await assertFails(setDoc(doc(coach, 'access/x4@gmail.com'), { role: 'member', teamId: 't1', addedBy: 'coach@x.com', addedAt: 1, extra: true }));
await assertFails(setDoc(doc(coach, 'access/admin@x.com'), { role: 'member', teamId: 't1', addedBy: 'coach@x.com', addedAt: 1 })); // can't take over an admin entry
await assertFails(setDoc(doc(coach, 'access/Upper@gmail.com'), { role: 'member', teamId: 't1', addedBy: 'coach@x.com', addedAt: 1 }));
ok('coach adds only plain members to their own team — not coaches, not admins, not other teams, no takeovers');
await assertSucceeds(deleteDoc(doc(coach, 'access/parent@gmail.com'))); await assertFails(deleteDoc(doc(coach, 'access/coach2@x.com'))); await assertFails(deleteDoc(doc(coach, 'access/coach@x.com')));
ok('coach removes members of their team, not coaches or other teams');
await assertSucceeds(getDocs(query(collection(coach, 'access'), where('teamId', '==', 't1')))); await assertFails(getDocs(query(collection(coach, 'access'), where('teamId', '==', 't2')))); await assertFails(getDocs(collection(coach, 'access')));
ok('coach lists only their own team’s people');
await assertSucceeds(setDoc(doc(coach, 'practice/pn'), { uid: 'u-coach', teamId: 't1', total: 80 })); await assertFails(setDoc(doc(coach, 'practice/pm'), { uid: 'u-coach', teamId: 't2', total: 80 }));
await assertFails(setDoc(doc(coach, 'practice/pm'), { uid: 'someone', teamId: 't1', total: 80 })); await assertFails(setDoc(doc(coach, 'practice/pm'), { uid: 'u-coach', teamId: 't1', total: 9999 }));
await assertSucceeds(getDocs(query(collection(coach, 'practice'), where('teamId', '==', 't1')))); await assertFails(getDocs(query(collection(coach, 'practice'), where('teamId', '==', 't2')))); await assertFails(getDocs(collection(coach, 'practice')));
await assertSucceeds(deleteDoc(doc(coach, 'practice/pn'))); await assertFails(deleteDoc(doc(coach, 'practice/p2'))); await assertFails(updateDoc(doc(coach, 'practice/p1'), { total: 1 }));
ok('practice runs are private to the team: coach can add/read/delete their own team’s, never another team’s; no edits');
// member
await assertSucceeds(setDoc(doc(mem, 'practice/pmem'), { uid: 'u-mem', teamId: 't1', total: 70 })); await assertSucceeds(getDocs(query(collection(mem, 'practice'), where('teamId', '==', 't1'))));
await assertSucceeds(deleteDoc(doc(mem, 'practice/pmem'))); await assertFails(deleteDoc(doc(mem, 'practice/p1')));
await assertFails(updateDoc(doc(mem, 'teams/t1'), { name: 'x' })); await assertFails(setDoc(doc(mem, 'access/friend@gmail.com'), { role: 'member', teamId: 't1', addedBy: 'mem@x.com', addedAt: 1 }));
await assertFails(getDocs(collection(mem, 'access'))); await assertSucceeds(getDoc(doc(mem, 'access/mem@x.com'))); await assertFails(getDoc(doc(mem, 'access/coach@x.com')));
await assertFails(setDoc(doc(mem, 'scores/ev1_t1_R2'), score({ teamId: 't1', round: 2, judgeUid: 'u-mem' })));
ok('team member: practice for own team (delete own runs only); cannot rename, add people, or score officially');
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
await assertFails(setDoc(doc(host, 'scores/ev2_t2_R1'), score({ eventId: 'ev2', judgeUid: 'u-host' }))); await assertFails(setDoc(doc(host, 'scores/ev1_t2_R2'), score({ round: 2, total: 1, judgeUid: 'u-host' }))); await assertFails(deleteDoc(doc(host, 'scores/ev1_t1_R1')));
ok('host can enter official scores for their own events only (create-once), never edit or delete');
await assertFails(getDocs(collection(host, 'practice'))); await assertFails(getDocs(collection(host, 'access'))); await assertSucceeds(getDoc(doc(host, 'access/host@x.com')));
ok('host has no access to practice runs or the access list');
await assertSucceeds(updateDoc(doc(admin, 'events/ev1'), { name: 'Regional 2026', live: true })); await assertSucceeds(updateDoc(doc(admin, 'teams/t7'), { name: 'Admin edit', number: 7 })); ok('admin still controls everything');
await env.cleanup();
console.log(`\n${passed} emulator checks passed`);
