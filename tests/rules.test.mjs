// Static review of firestore.rules (no emulator needed): structure + the guarantees the app relies on.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { maxScores } from '../js/scoring.js';
import { MATCHES_PER_TEAM } from '../js/missions.js';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const code = rules.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
let passed = 0;
const test = (n, f) => { f(); passed++; console.log('  ok  ' + n); };
const block = (name) => {
  const i = code.indexOf(`match /${name}/`); assert.ok(i >= 0, `match /${name}/ exists`);
  let d = 0, j = code.indexOf('{', code.indexOf('}', i)); // skip the {wildcard} in the path
  for (let k = j; k < code.length; k++) { if (code[k] === '{') d++; if (code[k] === '}' && --d === 0) return code.slice(i, k + 1); }
  throw new Error('unbalanced');
};
const allow = (b, kind) => [...b.matchAll(/allow ([a-z, ]+):\s*if ([^;]+);/g)].filter((m) => m[1].split(',').map((s) => s.trim()).includes(kind)).map((m) => m[2]);

console.log('firestore.rules');
test('braces and parens are balanced; rules_version 2', () => {
  assert.match(code, /rules_version = '2'/);
  for (const [a, b] of [['{', '}'], ['(', ')'], ['[', ']']]) assert.equal(code.split(a).length, code.split(b).length, a + b);
});
test('every helper function has a body that returns a value (Firestore requires `return`)', () => {
  const fns = [...code.matchAll(/function (\w+)\([^)]*\) \{([^}]*)\}/g)];
  assert.ok(fns.length >= 10, 'helper functions found');
  for (const [, name, body] of fns) assert.match(body, /^\s*return [^;]+;\s*$/, `function ${name} must be exactly "return <expr>;"`);
  assert.equal([...code.matchAll(/function \w+\(/g)].length, fns.length, 'no function was skipped by the parser');
});
test('every collection the app touches has a match block', () => { for (const c of ['access', 'events', 'eventHosts', 'teams', 'scores', 'signatures', 'practice']) block(c); });
test('no write/create/update/delete is ever open to everyone', () => {
  assert.ok(!/allow [a-z, ]*(write|create|update|delete)[a-z, ]*:\s*if true/.test(code));
});
test('sign-in alone grants nothing: every privilege goes through the access/{gmail} list and a verified email', () => {
  assert.match(code, /email_verified == true/);
  assert.match(code, /exists\(\/databases\/\$\(database\)\/documents\/access\/\$\(request\.auth\.token\.email\)\)/);
  assert.ok(!/request\.auth != null\s*(\)|;|&&\s*(request\.resource|resource))/.test(code.replace(/request\.auth != null && request\.auth\.token\.email_verified == true/, '')), 'no bare "signed in" grant');
});
test('public can read only teams, events and official scores', () => {
  for (const c of ['teams', 'events', 'scores']) assert.deepEqual(allow(block(c), 'read'), ['true'], c);
  for (const c of ['access', 'eventHosts', 'signatures', 'practice']) assert.ok(!allow(block(c), 'read').includes('true'), c + ' not public');
});
test('signatures are readable by judges/hosts/admins only', () => assert.deepEqual(allow(block('signatures'), 'read'), ['isJudge() || isHostAny()']));
test('events: admins create/delete; a host may change ONLY teamIds + schedule of events they host', () => {
  const b = block('events');
  assert.deepEqual(allow(b, 'create'), ['isAdmin()']); assert.deepEqual(allow(b, 'delete'), ['isAdmin()']);
  const upd = allow(b, 'update')[0];
  assert.match(upd, /isHostOf\(eventId\)/); assert.match(upd, /affectedKeys\(\)\.hasOnly\(\['teamIds', 'schedule'\]\)/);
});
test('eventHosts: admin-write only; readable only by admins and the hosts listed (emails stay private)', () => {
  const b = block('eventHosts');
  assert.match(allow(b, 'write')[0], /^isAdmin\(\)/);
  assert.match(allow(b, 'get')[0], /request\.auth\.token\.email in resource\.data\.emails/);
  assert.match(code, /function isHostOf\(eventId\)[\s\S]*?eventHosts\/\$\(eventId\)/);
});
test('hosts create teams like admins but only edit/delete the ones they created', () => {
  const b = block('teams');
  assert.match(allow(b, 'create')[0], /isAdmin\(\) \|\| isHostAny\(\)/); assert.match(allow(b, 'create')[0], /createdBy == request\.auth\.token\.email/);
  assert.match(allow(b, 'delete')[0], /createdBy/); assert.match(allow(b, 'update')[0], /isHostAny\(\) && resource\.data\.get\('createdBy', ''\) == request\.auth\.token\.email/);
});
test('teams: admin creates (number + name required, id pinned to number); coach may change ONLY the name', () => {
  const b = block('teams');
  assert.match(allow(b, 'create')[0], /^\(isAdmin\(\) \|\| isHostAny\(\)\)/); assert.match(allow(b, 'create')[0], /validTeam\(request\.resource\.data\)/);
  assert.match(allow(b, 'create')[0], /teamId == 't' \+ string\(request\.resource\.data\.number\)/);
  const upd = allow(b, 'update')[0];
  assert.match(upd, /coachOf\(teamId\)/); assert.match(upd, /affectedKeys\(\)\.hasOnly\(\['name'\]\)/);
  assert.match(code, /function validTeam\(d\)[\s\S]*?d\.number is int && d\.number > 0 && validName\(d\.name\)/, 'both number and name required');
  assert.match(code, /function validName\(v\)[\s\S]*?v\.size\(\) > 0/, 'name cannot be empty');
});
test('access list: admins manage everyone; coaches can only add/remove plain members of their own team', () => {
  const b = block('access');
  const create = allow(b, 'create')[0];
  assert.match(create, /isAdmin\(\)/); assert.match(create, /role in \['admin', 'host', 'judge', 'coach', 'member'\]/);
  assert.match(create, /coachOf\(request\.resource\.data\.teamId\)/); assert.match(create, /request\.resource\.data\.role == 'member'/);
  assert.match(create, /hasOnly\(\['role', 'teamId', 'name', 'addedBy', 'addedAt'\]\)/, 'coach cannot smuggle extra fields');
  assert.match(create, /email == email\.lower\(\)/, 'document IDs are lowercase emails');
  const upd = allow(b, 'update')[0];
  assert.match(upd, /resource\.data\.role == 'member'/); assert.match(upd, /request\.resource\.data\.role == 'member'/); assert.match(upd, /request\.resource\.data\.teamId == resource\.data\.teamId/, 'coach cannot move a member to another team');
  const del = allow(b, 'delete')[0];
  assert.match(del, /request\.auth\.token\.email != email/, 'an admin cannot lock themselves out');
  assert.match(del, /resource\.data\.role == 'member'/, 'coach cannot delete other coaches/admins');
});
test('access list: you can read your own entry; coaches can list only their own team', () => {
  const b = block('access');
  assert.match(allow(b, 'get')[0], /request\.auth\.token\.email == email/);
  assert.match(allow(b, 'list')[0], /resource\.data\.teamId == myTeam\(\)/);
});
test('scores: judges create once per event+team+match; only admins update/delete', () => {
  const b = block('scores');
  assert.match(allow(b, 'create')[0], /^\(isJudge\(\) \|\| isHostOf\(request\.resource\.data\.eventId\)\)/, 'judges, or hosts of THAT event');
  assert.deepEqual(allow(b, 'update'), ['isAdmin()']); assert.deepEqual(allow(b, 'delete'), ['isAdmin()']);
  assert.match(b, /scoreId == request\.resource\.data\.eventId \+ '_' \+ request\.resource\.data\.teamId \+ '_R' \+ string\(request\.resource\.data\.round\)/, 'doc id pins event+team+round → one score per match');
  assert.match(b, /judgeUid == request\.auth\.uid/, 'judge cannot forge another judge');
  assert.match(b, /gp in \[2, 3, 4\]/);
  assert.match(b, /exists\(\/databases\/\$\(database\)\/documents\/events\//); assert.match(b, /exists\(\/databases\/\$\(database\)\/documents\/teams\//);
});
test('rounds allowed by the rules == MATCHES_PER_TEAM', () => {
  const m = block('scores').match(/round in \[([\d, ]+)\]/); assert.ok(m);
  assert.deepEqual(m[1].split(',').map(Number), Array.from({ length: MATCHES_PER_TEAM }, (_, i) => i + 1));
});
test('score upper bound leaves headroom above the true maximum', () => {
  const m = code.match(/v <= (\d+)/); assert.ok(m);
  assert.ok(+m[1] >= maxScores().total && +m[1] <= maxScores().total * 3, `${m[1]} vs ${maxScores().total}`);
});
test('practice: team-scoped — only that team’s coaches/members (and admins) read, create for own team, update never', () => {
  const b = block('practice');
  assert.match(allow(b, 'read')[0], /isAdmin\(\) \|\| onTeam\(resource\.data\.teamId\)/);
  assert.match(allow(b, 'create')[0], /onTeam\(request\.resource\.data\.teamId\)/); assert.match(b, /request\.resource\.data\.uid == request\.auth\.uid/);
  assert.match(allow(b, 'delete')[0], /coachOf\(resource\.data\.teamId\)/);
  assert.deepEqual(allow(b, 'update'), ['false']);
  assert.match(code, /function onTeam[\s\S]*?\(myRole\(\) == 'coach' \|\| myRole\(\) == 'member'\) && myTeam\(\) == teamId/);
});
console.log(`\n${passed} rules checks passed`);
