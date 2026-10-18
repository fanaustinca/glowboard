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
test('every collection the app touches has a match block', () => { for (const c of ['access', 'events', 'eventHosts', 'eventJudges', 'teamSecrets', 'teamMembers', 'roster', 'teams', 'scores', 'signatures', 'practice']) block(c); });
test('no write/create/update/delete is ever open to everyone', () => {
  assert.ok(!/allow [a-z, ]*(write|create|update|delete)[a-z, ]*:\s*if true/.test(code));
});
test('sign-in alone grants nothing: every privilege goes through the access/{gmail} list and a verified email', () => {
  assert.match(code, /token\.get\('email_verified', false\) == true/);
  assert.match(code, /exists\(\/databases\/\$\(database\)\/documents\/access\/\$\(request\.auth\.token\.email\)\)/);
  assert.ok(!/allow [a-z, ]*(write|create|update|delete)[a-z, ]*:\s*if request\.auth != null\s*;/.test(code), 'no bare "signed in" write grant');
});
test('public can read only teams, events and official scores', () => {
  for (const c of ['teams', 'events', 'scores']) assert.deepEqual(allow(block(c), 'read'), ['true'], c);
  for (const c of ['access', 'eventHosts', 'eventJudges', 'teamSecrets', 'teamMembers', 'roster', 'signatures', 'practice']) assert.ok(!allow(block(c), 'read').includes('true'), c + ' not public');
});
test('signatures are readable only by that event’s referees/hosts/admins (event id parsed from the doc id)', () => {
  assert.deepEqual(allow(block('signatures'), 'read'), ["isJudgeFor(scoreId.split('_')[0]) || isHostOf(scoreId.split('_')[0])"]);
  assert.match(allow(block('signatures'), 'create')[0], /isJudgeFor\(scoreId\.split\('_'\)\[0\]\)/);
});
test('referee is a per-event modifier: eventJudges list (admin/host-of-event write; people see only their own entries)', () => {
  const b = block('eventJudges');
  assert.match(allow(b, 'write')[0], /^\(isAdmin\(\) \|\| isHostOf\(eventId\)\) && request\.resource\.data\.emails is list/);
  assert.match(allow(b, 'list')[0], /request\.auth\.token\.email in resource\.data\.emails/); assert.ok(!allow(b, 'list').includes('true'));
  assert.match(code, /function isRefereeOf\(eventId\)[\s\S]*?eventJudges\/\$\(eventId\)/);
  assert.match(code, /function isJudgeFor\(eventId\)[\s\S]*?isAdmin\(\) \|\| isRefereeOf\(eventId\)/);
});
test('events: admins create/delete; a host may change ONLY teamIds + schedule of events they host', () => {
  const b = block('events');
  assert.deepEqual(allow(b, 'create'), ['isAdmin()']); assert.deepEqual(allow(b, 'delete'), ['isAdmin()']); assert.ok(!/isJudgeFor\(resource/.test(allow(b, 'update')[0] + allow(b, 'delete')[0]), 'judges can never replace or delete');
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
test('teams: admin creates (number + name required, id pinned to number); coach may change ONLY the name and up to 3 hex colors', () => {
  const b = block('teams');
  assert.match(allow(b, 'create')[0], /^\(isAdmin\(\) \|\| isHostAny\(\)\)/); assert.match(allow(b, 'create')[0], /validTeam\(request\.resource\.data\)/);
  assert.match(allow(b, 'create')[0], /teamId == 't' \+ string\(request\.resource\.data\.number\)/);
  const upd = allow(b, 'update')[0];
  assert.match(upd, /coachOf\(teamId\)/); assert.match(upd, /affectedKeys\(\)\.hasOnly\(\['name', 'colors'\]\)/); assert.match(upd, /validColors\(/);
  assert.match(code, /function validColors\(c\)[\s\S]*?c\.size\(\) <= 3/, 'at most 3 colors'); assert.match(code, /function hexColor\(v\)[\s\S]*?\[0-9a-fA-F\]/, 'colors are hex only');
  assert.match(code, /function validTeam\(d\)[\s\S]*?d\.number is int && d\.number > 0 && validName\(d\.name\)/, 'both number and name required');
  assert.match(code, /function validName\(v\)[\s\S]*?v\.size\(\) > 0/, 'name cannot be empty');
});
test('access list: admins manage everyone; a coach may only create brand-new plain-member accounts for their own team', () => {
  const b = block('access');
  const create = allow(b, 'create')[0];
  assert.match(create, /isAdmin\(\)/); assert.match(create, /role in \['admin', 'host', 'judge', 'coach', 'member'\]/);
  assert.match(create, /coachOf\(request\.resource\.data\.teamId\)/); assert.match(create, /request\.resource\.data\.role == 'member'/);
  assert.match(create, /hasOnly\(\['role', 'teamId', 'name', 'addedBy', 'addedAt'\]\)/, 'coach cannot smuggle extra fields');
  assert.match(create, /email == email\.lower\(\)/, 'document IDs are lowercase emails');
  assert.deepEqual(allow(b, 'update'), ['isAdmin()'], 'a coach can never edit an existing account (no promoting, no host flag)');
  const del = allow(b, 'delete')[0];
  assert.match(del, /request\.auth\.token\.email != email/, 'an admin cannot lock themselves out');
  assert.ok(!/coachOf/.test(del), 'coaches remove people from the roster, never delete accounts');
});
test('roster: per-team roles; a coach manages only their own teams; anyone can leave as a member; keys are pinned', () => {
  const b = block('roster');
  assert.match(code, /function rosterDoc\(teamId\)[\s\S]*?roster\/\$\(teamId \+ '__' \+ request\.auth\.token\.email\)/);
  assert.match(code, /function coachOf\(teamId\)[\s\S]*?\.data\.role == 'coach'/);
  const create = allow(b, 'create')[0];
  assert.match(create, /rid == request\.resource\.data\.teamId \+ '__' \+ request\.resource\.data\.email/, 'doc id pins team + email');
  assert.match(create, /role in \['member', 'coach'\]/); assert.match(create, /hasOnly\(\['teamId', 'email', 'role', 'name', 'addedBy', 'addedAt'\]\)/);
  assert.match(create, /isAdmin\(\) \|\| coachOf\(request\.resource\.data\.teamId\)/);
  assert.match(create, /teamCreator\(request\.resource\.data\.teamId\) && request\.resource\.data\.role == 'coach'/, 'a host may only designate coaches of teams they created');
  assert.match(allow(b, 'update')[0], /resource\.data\.role == 'member' && request\.resource\.data\.role == 'member'/, 'a coach cannot promote through update');
  const del = allow(b, 'delete')[0];
  assert.match(del, /resource\.data\.email == request\.auth\.token\.email && resource\.data\.role == 'member'/, 'members can leave; coaches cannot walk out');
  assert.match(allow(b, 'read')[0], /resource\.data\.email == request\.auth\.token\.email \|\| isAdmin\(\) \|\| coachOf\(resource\.data\.teamId\)/);
});
test('host is a modifier: host flag or host role; isHostOf only needs the per-event eventHosts list; judges can be event-limited', () => {
  assert.match(code, /function isHostAny\(\)[\s\S]*?myRole\(\) == 'host' \|\| myDoc\(\)\.data\.get\('host', false\) == true/);
  assert.match(code, /function isHostOf\(eventId\)[\s\S]*?eventHosts\/\$\(eventId\)/);
  assert.ok(!/function isHostOf[^}]*myRole\(\) == 'host'/.test(code), 'a coach/judge who is listed on an event is a host of it');
  assert.match(code, /function isJudgeFor\(eventId\)[\s\S]*?get\('eventIds', null\) == null \|\| eventId in myDoc\(\)\.data\.eventIds/);
});
test('hosts add referees: judge role only, exactly ONE event they host, no extra fields, can’t overwrite; coaches can’t smuggle host/eventIds', () => {
  const b = block('access'); const create = allow(b, 'create')[0];
  assert.match(create, /isHostAny\(\)[\s\S]*?request\.resource\.data\.role == 'judge'/);
  assert.match(create, /hasOnly\(\['role', 'name', 'addedBy', 'addedAt', 'eventIds'\]\)/);
  assert.match(create, /eventIds\.size\(\) == 1[\s\S]*?isHostOf\(request\.resource\.data\.eventIds\[0\]\)/);
  assert.match(allow(b, 'delete')[0], /isHostAny\(\) && resource\.data\.role == 'judge' && resource\.data\.get\('addedBy', ''\) == request\.auth\.token\.email/);
  assert.match(allow(b, 'list')[0], /resource\.data\.role == 'judge' && resource\.data\.addedBy == request\.auth\.token\.email/);
});
test('team password: memberships per team (uid_teamId); must match the team’s CURRENT password and be switched ON, so rotating/turning off locks old ones out', () => {
  assert.match(code, /function isAnon\(\)[\s\S]*?sign_in_provider == 'anonymous'/);
  assert.match(code, /function viaTeamPassword\(teamId\)[\s\S]*?teamMembers\/\$\(request\.auth\.uid \+ '_' \+ teamId\)[\s\S]*?\.data\.password\s*== get\(\/databases\/\$\(database\)\/documents\/teamSecrets\/\$\(teamId\)\)\.data\.password/);
  assert.match(code, /function viaTeamPassword\(teamId\)[\s\S]*?get\('enabled', true\) == true/, 'coach can turn password sign-in off; default is ON');
  assert.match(code, /function onTeam\(teamId\)[\s\S]*?onRoster\(teamId\) \|\| viaTeamPassword\(teamId\)/);
  const m = block('teamMembers');
  const c = allow(m, 'create')[0];
  assert.match(c, /isAnon\(\) \|\| hasAccess\(\)/); assert.match(c, /hasOnly\(\['uid', 'teamId', 'password', 'name', 'createdAt'\]\)/); assert.match(c, /memberId == request\.auth\.uid \+ '_' \+ request\.resource\.data\.teamId/);
  assert.match(c, /request\.resource\.data\.password == get\(.*teamSecrets/, 'joining needs the real password'); assert.match(c, /get\('enabled', true\) == true/, 'cannot join while switched off');
  const t = block('teamSecrets');
  assert.match(allow(t, 'read')[0], /isAdmin\(\) \|\| coachOf\(teamId\) \|\| teamCreator\(teamId\)/); assert.ok(!allow(t, 'read').includes('true'));
  assert.deepEqual(allow(t, 'delete'), ['isAdmin()']);
  assert.match(code, /function validSecret\(d\)[\s\S]*?size\(\) >= 6[\s\S]*?hasOnly\(\['password', 'updatedBy', 'updatedAt', 'enabled', 'isDefault'\]\)/);
});
test('elevated roles never come from a team password: no scoring, access, team, event or secret write depends on viaTeamPassword', () => {
  const uses = [...code.matchAll(/viaTeamPassword/g)].length;
  assert.equal(uses, 2, 'only the definition and onTeam use it');
  for (const c of ['scores', 'signatures', 'access', 'teams', 'events', 'eventHosts', 'eventJudges']) assert.ok(!/onTeam|viaTeamPassword/.test(block(c)), c);
});
test('access list: you can read your own entry; nobody lists it except admins and hosts (their own referees)', () => {
  const b = block('access');
  assert.match(allow(b, 'get')[0], /request\.auth\.token\.email == email/);
  assert.match(allow(b, 'list')[0], /^isAdmin\(\)/); assert.ok(!/myTeam|coachOf/.test(allow(b, 'list')[0]));
});
test('scores: judges create once per event+team+match; only admins update; hosts of the event and admins delete', () => {
  const b = block('scores');
  assert.match(allow(b, 'create')[0], /^\(isJudgeFor\(request\.resource\.data\.eventId\) \|\| isHostOf\(request\.resource\.data\.eventId\)\)/, 'judges for THAT event, or hosts of it');
  assert.deepEqual(allow(b, 'update'), ['isAdmin()']); assert.deepEqual(allow(b, 'delete'), ['isAdmin() || isHostOf(resource.data.eventId)']); assert.ok(!/isJudgeFor\(resource/.test(allow(b, 'update')[0] + allow(b, 'delete')[0]), 'judges can never replace or delete');
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
test('practice: team-scoped — only that team’s members (and admins) read, create, edit and delete', () => {
  const b = block('practice');
  assert.match(allow(b, 'read')[0], /isAdmin\(\) \|\| onTeam\(resource\.data\.teamId\)/);
  assert.match(allow(b, 'create')[0], /onTeam\(request\.resource\.data\.teamId\)/); assert.match(b, /request\.resource\.data\.uid == request\.auth\.uid/);
  assert.match(allow(b, 'delete')[0], /onTeam\(resource\.data\.teamId\)/);
  assert.match(allow(b, 'update')[0], /onTeam\(resource\.data\.teamId\)[\s\S]*request\.resource\.data\.teamId == resource\.data\.teamId[\s\S]*uid == resource\.data\.uid/);
  assert.ok(!/myTeam\(/.test(code), 'team membership comes only from the roster / team-password docs, never from the access role label');
});
console.log(`\n${passed} rules checks passed`);
