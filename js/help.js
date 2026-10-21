// Help tab: explains what the signed-in person can do and where. Only sections for powers they actually have are shown.
import { esc } from './ui.js';
import { ROLE_LABEL, canScore, coachTeamIds } from './store.js';

const li = (items) => `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
const sec = (title, where, items) => `<section class="card help-sec"><h2>${title}</h2>${where ? `<p class="where">Where: ${where}</p>` : ''}${li(items)}</section>`;

export function helpSections(u, scoreable = []) {
  const out = [];
  out.push(sec('Everyone', 'Standings · Schedule · Scoring tool · Timer', [
    '<b>Standings</b> shows each event’s leaderboard. Pick an event at the top; Founders ranks by a team’s best match, Future by the average of its matches. <b>Big screen</b> fills a projector with every team’s three round scores.',
    '<b>Schedule</b> lists each event’s published match schedule and tables.',
    '<b>Scoring tool</b> is a calculator for either edition. Nothing is saved, and it is separate from practice runs and official scoring.',
    '<b>Timer</b> runs the 2:30 match with 3-2-1 beeps, a start horn, reminders at 1:00 and 0:30 and an end horn. Turn the sound up first.',
  ]));
  if (!u) {
    out.push(sec('Signing in', 'Sign in (top right)', [
      'Coaches, judges, event hosts and admins sign in with the Google account they were added with.',
      'Team members sign in with their team number and the team password their coach gives them.',
    ]));
    return out;
  }
  const coachOf = coachTeamIds(u).length > 0, member = (u.teams || []).length > 0;
  const admin = u.role === 'admin', host = Boolean(u.host) || u.role === 'host', scorer = canScore(u, scoreable);

  if (scorer) {
    out.push(sec('Scoring matches', 'Judge', [
      'Choose the <b>event</b>, <b>team</b>, <b>round</b> and <b>table</b>, and the <b>scoring edition</b> (Founders or Future) at the top. Only teams of that edition are listed.',
      'Tap each mission as the referee reads it out, then have the team sign and press submit.',
      'A submitted score cannot be edited. If it was wrong, an event host or admin deletes it and it can be scored again.',
      admin || host ? '' : 'You can only score events you have been given access to.',
    ].filter(Boolean)));
  }
  if (admin) {
    out.push(sec('Admin', 'Admin', [
      '<b>Events:</b> create events and choose their editions (Founders, Future or both). Change the editions of an existing event with the selector on its row. Make an event live, assign hosts, or delete it.',
      '<b>Teams:</b> add teams (one at a time or in bulk), rename them, switch a team between Founders and Future, delete them, and see or change a team’s password.',
      '<b>People:</b> give people Judge, Coach or Admin access by Gmail address, and remove them again.',
      '<b>Scores:</b> delete an official score so the match can be re-scored.',
      'You also have everything an event host has, in the <b>Event</b> tab.',
    ]));
  }
  if (host) {
    out.push(sec('Running an event', 'Event', [
      'You see only the events you host. Pick one at the top.',
      '<b>Teams:</b> choose which teams play in the event, and add new teams. Set the coach’s Gmail when you add a team. You can rename or delete the teams you created.',
      '<b>Team passwords:</b> you can set a new password for a team, but you cannot see the current one. The coach reads it on the Teams tab.',
      '<b>Schedule:</b> generate a match schedule, review it, then save it to publish it on the Schedule page.',
      '<b>Scoring:</b> you can enter official scores for your events from the Judge tab, and delete a score so a match can be re-scored.',
      '<b>Referees:</b> add or remove the people who may score at your event.',
    ]));
  }
  if (coachOf) {
    out.push(sec('Coaching a team', 'Teams', [
      '<b>Stats</b> and <b>Advanced</b> show your team’s results and trends. Advanced can be copied straight into Google Sheets.',
      '<b>Practice</b> records unofficial runs for your team (choose the edition). You can edit or delete your team’s runs. They stay private to your team.',
      '<b>Manage:</b> see the team password, add or remove team members and other coaches, rename the team and choose its colors.',
    ]));
  } else if (member) {
    out.push(sec('On a team', 'Teams', [
      '<b>Stats</b> and <b>Advanced</b> show your team’s results and trends.',
      '<b>Practice</b> records unofficial runs for your team. You can edit or delete the team’s runs.',
      'The <b>Manage</b> tab lets you leave the team. Your coach looks after the team password and the member list.',
    ]));
  }
  if (!scorer && !admin && !host && !coachOf && !member) {
    out.push(sec('Your account', '', ['You are signed in, but you have not been given a role yet. Ask an admin or event host to add your Gmail address.']));
  }
  return out;
}

export function helpView(root, ctx) {
  const draw = () => {
    const u = ctx.user();
    root.innerHTML = `<h1 class="page-title">Help</h1>
      ${u ? `<p class="muted help-you">Signed in as <b>${esc(u.name || u.email || '')}</b> · ${esc(ROLE_LABEL[u.role] || u.role)}${u.host && u.role !== 'host' ? ' · event host' : ''}${coachTeamIds(u).length && u.role !== 'coach' ? ' · coach' : ''}. This page only covers what you can do.</p>` : ''}
      <div class="help">${helpSections(u, ctx.scoringEvents()).join('')}</div>`;
  };
  draw();
  return { update: draw };
}
