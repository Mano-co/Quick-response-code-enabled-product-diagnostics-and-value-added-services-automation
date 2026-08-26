/* ============================================================
   FIREBASE CONFIGURATION — qr-services-and-products
   ============================================================
   This file ONLY holds Firebase config + initialization.
   It is loaded once, before app.js / admin.js, on both
   index.html and admin.html. Do not initialize Firebase
   anywhere else — app.js and admin.js both just use the
   `db` and `FIREBASE_READY` globals defined here.
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

// Guards against double-initialization if this script is ever
// accidentally included twice on the same page.
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();

// FIREBASE_READY is used throughout app.js/admin.js to decide between
// live Firestore sync and the local-fallback (offline demo) data path.
// With real credentials above, this is now always true.
const FIREBASE_READY = firebaseConfig.apiKey !== "YOUR_API_KEY";

console.log("[SmartBite] Firebase connected to qr-services-and-products. Real-time sync is ON.");
