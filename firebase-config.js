/* ============================================================
   FIREBASE CONFIGURATION
   ============================================================
   1. Go to https://console.firebase.google.com
   2. Create a new project (e.g. "smartbite-demo")
   3. Add a Web App (</> icon) inside the project
   4. Copy the config object Firebase gives you and paste the
      values below, replacing the YOUR_... placeholders.
   5. In the Firebase Console, enable "Firestore Database"
      (Build > Firestore Database > Create database > test mode
      is fine for a college demo).
   6. Paste the security rules from README.md > Firestore Rules
      into Firestore > Rules, so tables/menu/orders can be read
      and written during your demo.
   ============================================================ */

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// FIREBASE_READY becomes true only if a real config was pasted above.
// This lets the whole app fall back to an in-memory DEMO_DB so the
// project still runs (on one device) even before Firebase is set up.
const FIREBASE_READY = firebaseConfig.apiKey !== "YOUR_API_KEY";

let db = null;

if (FIREBASE_READY) {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  console.log("[SmartBite] Firebase connected. Real-time sync is ON.");
} else {
  console.warn(
    "[SmartBite] Firebase NOT configured yet — running in LOCAL DEMO MODE.\n" +
    "Data will only be visible on this device/tab. Paste your Firebase\n" +
    "config into firebase-config.js to enable real-time sync between\n" +
    "the customer phone and the admin laptop."
  );
}
