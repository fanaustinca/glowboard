// Team setup helpers shared by the Admin page, the host Event page and the Teams tab.
import { normEmail, rosterId } from './store.js';

// 6-digit random team password (100000–999999: no leading zero to mistype).
export const genCode = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(100000 + (a[0] % 900000)); };

// Put someone on a team's roster. They need an access doc to sign in: a brand-new person gets one (the attempt is
// silently skipped when the account already exists — it keeps whatever role it has, e.g. an admin who also coaches).
export async function addTeamPerson(store, actor, teamId, email, role, name = '') {
  email = normEmail(email);
  // Never touch an account that already exists (an admin who also coaches keeps being an admin). Non-admins can't read the
  // access list, so for them "can't tell" falls through to a create, which the rules only allow for brand-new accounts.
  let exists = false;
  try { exists = Boolean(await store.get('access', email)); } catch { /* can't tell */ }
  // a designated coach's account is labelled "coach" when the rules allow it (admin / the team's host), else "member"
  if (!exists) for (const r of role === 'coach' ? ['coach', 'member'] : ['member']) {
    try { await store.put('access', email, { role: r, teamId, name, addedBy: actor.email, addedAt: Date.now() }); break; } catch { /* exists, or not allowed with this label */ }
  }
  await store.put('roster', rosterId(teamId, email), { teamId, email, role, name, addedBy: actor.email, addedAt: Date.now() });
}

// Creates the team, its shared password (ON by default; the coach can turn it off) and its designated coach.
// coach: 'added' | 'failed' | 'none'
export async function createTeam(store, actor, { number, name, coachEmail, edition = 'founders' }) {
  const id = `t${number}`;
  await store.put('teams', id, { number, name, edition: edition === 'future' ? 'future' : 'founders', createdBy: actor.email });
  const password = genCode();
  await store.put('teamSecrets', id, { password, enabled: true, isDefault: true, updatedBy: actor.email, updatedAt: Date.now() });
  let coach = 'none';
  const email = normEmail(coachEmail);
  if (email) {
    try { await addTeamPerson(store, actor, id, email, 'coach'); coach = 'added'; } catch { coach = 'failed'; }
  }
  return { id, number, name, password, coach, coachEmail: email };
}
