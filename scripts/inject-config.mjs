// Deploy-time: rewrite the firebaseConfig object in <dir>/js/firebase-config.js from the FIREBASE_CONFIG env var
// (JSON, e.g. {"apiKey":"…","authDomain":"…","projectId":"…","storageBucket":"…","messagingSenderId":"…","appId":"…"}).
// Keeps real project values out of git. No env var → leaves the placeholders (demo mode).
import { readFileSync, writeFileSync } from 'node:fs';
const dir = process.argv[2] || '.';
const raw = process.env.FIREBASE_CONFIG;
if (!raw) { console.log('FIREBASE_CONFIG not set — leaving demo-mode placeholders'); process.exit(0); }
const cfg = JSON.parse(raw);
for (const k of ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId']) if (typeof cfg[k] !== 'string' || !cfg[k]) throw new Error(`FIREBASE_CONFIG is missing "${k}"`);
const file = `${dir}/js/firebase-config.js`;
const src = readFileSync(file, 'utf8');
const out = src.replace(/export const firebaseConfig = \{[\s\S]*?\n\};/, `export const firebaseConfig = ${JSON.stringify({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, storageBucket: cfg.storageBucket, messagingSenderId: cfg.messagingSenderId, appId: cfg.appId }, null, 2)};`);
if (out === src) throw new Error('could not find firebaseConfig in ' + file);
writeFileSync(file, out);
console.log('Injected Firebase config for project', cfg.projectId);
