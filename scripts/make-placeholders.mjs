// Generates assets/missions/mXX.svg placeholders. To use official art, drop a file named
// assets/missions/m01.jpg (…m15.jpg) next to them — the app prefers .jpg and falls back to the .svg.
import { writeFileSync } from 'node:fs';
import { MISSIONS } from '../js/missions.js';
for (const m of MISSIONS) {
  const n = String(m.num).padStart(2, '0');
  writeFileSync(new URL(`../assets/missions/${m.id}.svg`, import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" role="img" aria-label="Mission ${n} image placeholder">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9efc9"/><stop offset="1" stop-color="#9fd49a"/></linearGradient></defs>
<rect width="320" height="180" fill="url(#g)"/>
<g fill="none" stroke="#2f7d3b" stroke-opacity=".35" stroke-width="3"><path d="M20 160c40-60 80-60 120-20s80 30 160-70"/><path d="M0 120c50-30 90-10 130 20s100 20 190-30"/></g>
<text x="160" y="84" text-anchor="middle" font-family="system-ui,sans-serif" font-size="46" font-weight="800" fill="#1d5c2a">M${n}</text>
<text x="160" y="112" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" fill="#1d5c2a">${m.name.replace(/&/g, '&amp;')}</text>
<text x="160" y="150" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#1d5c2a" fill-opacity=".75">mission image placeholder — add ${m.id}.jpg</text>
</svg>
`);
}
console.log('wrote', MISSIONS.length, 'placeholders');
