import assert from 'node:assert/strict';
const { helpSections } = await import('../js/help.js');
const txt = (u, sc = []) => helpSections(u, sc).join(' ');
assert.ok(!/Signing in/.test(txt({ role: 'coach', teams: [{ teamId: 't1', role: 'coach' }] })));
assert.match(txt(null), /Signing in/); assert.ok(!/Admin|Running an event|Scoring matches/.test(txt(null)));
const host = txt({ role: 'coach', host: true, teams: [{ teamId: 't1', role: 'coach' }] }, [{ id: 'e' }]);
assert.match(host, /Running an event/); assert.match(host, /cannot see the current one/); assert.ok(!/>Admin</.test(host), 'a host sees no admin help');
assert.match(host, /Coaching a team/);
const member = txt({ role: 'member', teams: [{ teamId: 't1', role: 'member' }] });
assert.match(member, /On a team/); assert.ok(!/Running an event|>Admin<|Coaching/.test(member));
assert.match(txt({ role: 'admin' }, [{ id: 'e' }]), />Admin</);
assert.match(txt({ role: 'judge' }), /Scoring matches/);
console.log('help checks passed');
{
  const { sampleRuns } = await import('../js/sample.js');
  const runs = sampleRuns(1e12);
  assert.equal(runs.length, 22); assert.ok(runs.every((r) => r.teamId === 'sample' && r.total > 0 && r.result?.missions));
  assert.deepEqual(sampleRuns(1e12).map((r) => r.total), runs.map((r) => r.total), 'the sample data is deterministic');
  assert.ok(new Set(runs.map((r) => r.edition)).size === 2, 'both editions, so the edition picker shows');
  console.log('sample team checks passed');
}
{
  const { RESOURCE_GROUPS } = await import('../js/resources.js');
  const all = RESOURCE_GROUPS.flatMap((g) => g.items);
  assert.ok(all.every(([t, d, url]) => t && d && /^https:\/\//.test(url)), 'every resource is an https link');
  assert.ok(RESOURCE_GROUPS.some((g) => /Founders/.test(g.title)) && RESOURCE_GROUPS.some((g) => /Future/.test(g.title)) && RESOURCE_GROUPS.some((g) => /training/i.test(g.title)));
  console.log('resources checks passed');
}
