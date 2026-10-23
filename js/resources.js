// Public Resources tab: rulebooks, scoring sheets and referee/volunteer training, linked from their official sources.
import { esc } from './ui.js';

const FIRST = 'https://firstinspires.blob.core.windows.net/fll/challenge/2026-27/';
const LEGO = 'https://assets.education.lego.com/v3/assets/blt293eea581807678a/';
export const RESOURCE_GROUPS = [
  { title: 'Founders Edition (standard) — rulebook & scoring', items: [
    ['Robot Game Rulebook', 'Missions, scoring and rules for the Founders Edition robot game.', `${FIRST}fll-challenge-bioglow-rgr.pdf`, 'PDF'],
    ['Scoresheet (software)', 'The scoresheet referees use to score a match.', `${FIRST}fll-challenge-bioglow-software-scoresheet.pdf`, 'PDF'],
    ['Class pack scoresheet', 'A printable scoresheet for practice and classrooms.', `${FIRST}fll-challenge-bioglow-classpack-scoresheet.pdf`, 'PDF'],
    ['Table building instructions', 'How to build and set up the game table.', `${FIRST}fll-challenge-bioglow-table-building-instructions.pdf`, 'PDF'],
  ] },
  { title: 'Future Edition — rulebook & scoring', items: [
    ['Future Edition Rulebook', 'Rules, roles, penalties and ranking for the Future Edition (grades 3–8).', `${LEGO}blt0ab6a9966c6b1311/6a69a004d2b04f14a12a973f/fll-future-3-8-bioglow-rulebook.pdf?locale=en-us`, 'PDF'],
    ['Future Edition Game Missions', 'Every mission with its points.', `${LEGO}blt293eea581807678a/blt459e8bb5a19be9e2/6a69a003c5cd7b190e301570/fll-future-3-8-bioglow-game-missions.pdf?locale=en-us`, 'PDF'],
    ['Future Edition Scoresheet', 'The scoresheet for Future matches.', `${LEGO}blt227e82bbf933aaa2/6a69a003b469f6a7193cd8f2/fll-future-3-8-bioglow-scoresheet.pdf?locale=en-us`, 'PDF'],
    ['Future Edition resources', 'The Future Edition resource page (first-lego-league.org).', 'https://www.first-lego-league.org/en/2026-27-season/future-edition-8-resources', 'Web'],
  ] },
  { title: 'Referee & volunteer training', items: [
    ['Volunteer resources', 'Referee toolkit and resources, head referee checklist, score calculators and the referee training slide deck.', 'https://www.firstinspires.org/resource-library/fll/challenge/volunteer-resources', 'Web'],
    ['Robot game resources', 'Robot game guides, videos and updates from FIRST.', 'https://www.firstinspires.org/resource-library/fll/robot-game-resources', 'Web'],
  ] },
  { title: 'Season hubs & others', items: [
    ['FIRST LEGO League Challenge resources', 'The official season page: guides, updates and the latest documents.', 'https://www.firstinspires.org/resource-library/fll/challenge/challenge-and-resources', 'Web'],
    ['LEGO Education season materials', 'Team guidebooks and building instructions.', 'https://education.lego.com/en-us/first-lego-league/season-materials/', 'Web'],
    ['Team management resources', 'Help for coaches and team organisers.', 'https://www.firstinspires.org/resource-library/fll/explore/team-management-resources', 'Web'],
  ] },
];

export function resourcesView(root) {
  const card = (g) => `<section class="card res"><h2>${esc(g.title)}</h2><ul class="reslist">${g.items.map(([t, d, url, kind]) => `<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><b>${esc(t)}</b> <span class="badge">${esc(kind)}</span></a><small class="block">${esc(d)}</small></li>`).join('')}</ul></section>`;
  root.innerHTML = `<h1 class="page-title">Resources</h1>
    <p class="muted">Rulebooks, scoresheets and referee training — open to everyone. These links go to the official documents on FIRST and LEGO Education, so you always get their latest version.</p>
    <div class="help">${RESOURCE_GROUPS.map(card).join('')}
      <section class="card res"><h2>In GlowBoard</h2><ul class="reslist">
        <li><a href="#/tool"><b>Scoring tool</b></a><small class="block">Add up a score for either edition. Nothing is saved.</small></li>
        <li><a href="#/timer"><b>Match timer</b></a><small class="block">The 2:30 timer with start horn, reminders and end horn.</small></li>
        <li><a href="#/sample"><b>Sample team</b></a><small class="block">Try the Stats and Advanced tools with made-up practice runs.</small></li>
        <li><a href="#/help"><b>Help</b></a><small class="block">What you can do here, plus live help from the admins.</small></li></ul></section></div>`;
  return {};
}
