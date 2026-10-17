// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE PLACEHOLDERS — paste your web-app config from
//   Firebase console → Project settings → Your apps → SDK setup and configuration
// While apiKey still says "REPLACE_ME", GlowBoard runs in DEMO MODE: all data lives in
// this browser's localStorage (seeded with fake teams) so you can try everything offline.
// NOTE: the real values are NOT committed. The deploy workflow injects them from the FIREBASE_CONFIG repo secret
// (see scripts/inject-config.mjs and the README). For local use, paste them here but don't commit.
// Sign-in is Google only (enable it in Firebase → Authentication → Sign-in method).
// ─────────────────────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.appspot.com',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};

export const FIREBASE_SDK_VERSION = '10.12.2';
export const isConfigured = () => !String(firebaseConfig.apiKey).includes('REPLACE_ME');
