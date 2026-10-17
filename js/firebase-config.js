// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE PLACEHOLDERS — paste your web-app config from
//   Firebase console → Project settings → Your apps → SDK setup and configuration
// While apiKey still says "REPLACE_ME", GlowBoard runs in DEMO MODE: all data lives in
// this browser's localStorage (seeded with fake teams) so you can try everything offline.
// These values are public by design (they ship in every Firebase web app); Firestore rules are what protect the data.
// Sign-in is Google only (enable it in Firebase → Authentication → Sign-in method).
// ─────────────────────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: 'AIzaSyAc8bjMr7HVwN-vpbeC6eNu5EJ6ZmHL7YQ',
  authDomain: 'glowboard-fd45a.firebaseapp.com',
  projectId: 'glowboard-fd45a',
  storageBucket: 'glowboard-fd45a.firebasestorage.app',
  messagingSenderId: '660421892173',
  appId: '1:660421892173:web:aa129c5a2e898437a4e404',
};

export const FIREBASE_SDK_VERSION = '10.12.2';
export const isConfigured = () => !String(firebaseConfig.apiKey).includes('REPLACE_ME');
