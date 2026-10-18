// Team setup helpers shared by the Admin page and the host Event page.
import { normEmail } from './store.js';

// 6-digit random team password (100000–999999: no leading zero to mistype).
export const genCode = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(100000 + (a[0] % 900000)); };

// Creates the team, its shared password, and (optionally) its designated coach.
// coach: 'added' | 'exists' (that Google account already has another role — an admin must change it) | 'blocked' | 'none'
export async function createTeam(store, actor, { number, name, coachEmail }, existingPeople = []) {
  const id = `t${number}`;
  await store.put('teams', id, { number, name, createdBy: actor.email });
  const password = genCode();
  await store.put('teamSecrets', id, { password, updatedBy: actor.email, updatedAt: Date.now() });
  let coach = 'none';
  const email = normEmail(coachEmail);
  if (email) {
    const existing = existingPeople.find((p) => p.id === email);
    if (existing && !['member', 'coach'].includes(existing.role)) coach = 'blocked'; // admins/judges/hosts keep their role
    else {
      try { await store.put('access', email, { role: 'coach', teamId: id, name: '', addedBy: actor.email, addedAt: Date.now() }); coach = 'added'; } catch { coach = 'exists'; }
    }
  }
  return { id, number, name, password, coach, coachEmail: email };
}
