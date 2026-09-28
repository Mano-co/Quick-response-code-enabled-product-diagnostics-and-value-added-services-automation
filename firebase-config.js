/* ============================================================
   FIREBASE CONFIGURATION — qr-services-and-products
   Holds ONLY config + one-time initialization (compat SDK).
   Loaded once on index.html and admin.html BEFORE common.js.
   If the Firebase SDK fails to load (offline / blocked CDN) or
   the config is still a placeholder, FIREBASE_READY is false and
   the app runs in clearly-labelled LOCAL DEMO mode (localStorage,
   one device only — it does NOT sync across devices).
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyCEPmya9Ij1FNXbQkE1uC8nGPQtpYw_kk8",
  authDomain: "qr-services-and-products.firebaseapp.com",
  projectId: "qr-services-and-products",
  storageBucket: "qr-services-and-products.firebasestorage.app",
  messagingSenderId: "20494967096",
  appId: "1:20494967096:web:cb940d443c034f53c121cd",
  measurementId: "G-6C5DDD8CZB"
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
