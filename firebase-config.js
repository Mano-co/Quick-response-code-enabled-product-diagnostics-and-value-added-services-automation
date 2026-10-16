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
  apiKey: "AIzaSyAE91AZb0eUFsxLBFC6BAGrnK85MI4g4lU",
  authDomain: "qr-based-real-time.firebaseapp.com",
  projectId: "qr-based-real-time",
  storageBucket: "qr-based-real-time.firebasestorage.app",
  messagingSenderId: "804022221103",
  appId: "1:804022221103:web:99c1f74a3e82f819f8c9da",
  measurementId: "G-NSB673W209"
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
