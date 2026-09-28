/* ============================================================
   FIREBASE CONFIGURATION — qr-based-real-time
   Holds ONLY config + one-time initialization (compat SDK).
   Loaded once on index.html and admin.html BEFORE common.js.
   If the Firebase SDK fails to load (offline / blocked CDN) or
   the config is still a placeholder, FIREBASE_READY is false and
   the app runs in clearly-labelled LOCAL DEMO mode (localStorage,
   one device only — it does NOT sync across devices).
   ============================================================ */

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",                       // <-- paste from Firebase Console > Project settings
  authDomain: "qr-based-real-time.firebaseapp.com",
  projectId: "qr-based-real-time",
  storageBucket: "qr-based-real-time.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID", // <-- paste from Firebase Console
  appId: "YOUR_APP_ID"                           // <-- paste from Firebase Console
};

let db = null;
let FIREBASE_READY = false;

try {
  if (typeof firebase !== "undefined" && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_")) {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    // Offline cache: reads/listeners keep working from cache when the network drops.
    // (Writes/transactions need a connection; the app shows a friendly message if they fail.)
    db.enablePersistence({ synchronizeTabs: true }).catch(() => { /* unsupported browser or multi-tab conflict: ignore */ });
    FIREBASE_READY = true;
    console.log("[SmartBite] Firebase connected (" + firebaseConfig.projectId + "). Real-time sync ON.");
  } else {
    console.warn("[SmartBite] Firebase unavailable — LOCAL DEMO MODE (this device only).");
  }
} catch (e) {
  console.error("[SmartBite] Firebase init failed, using LOCAL DEMO MODE:", e);
  db = null; FIREBASE_READY = false;
}
