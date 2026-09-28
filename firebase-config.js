/* ============================================================
   FIREBASE CONFIGURATION — SmartBite
   Project: qr-based-real-time
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyAe91AZbOeUfsXLBFC6BAGrnK8SMI4g4LU",
  authDomain: "qr-based-real-time.firebaseapp.com",
  projectId: "qr-based-real-time",
  storageBucket: "qr-based-real-time.firebasestorage.app",
  messagingSenderId: "804022221103",
  appId: "1:804022221103:web:c2dfbf29feaa0d08f8c9da",
  measurementId: "G-6DBJ0VSLEQ"
};

let db = null;
let FIREBASE_READY = false;

try {
  if (
    typeof firebase !== "undefined" &&
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith("YOUR_")
  ) {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    db = firebase.firestore();

    db.enablePersistence({ synchronizeTabs: true })
      .catch(() => {});

    FIREBASE_READY = true;

    console.log(
      "[SmartBite] Firebase connected (" +
      firebaseConfig.projectId +
      "). Real-time sync ON."
    );
  } else {
    console.warn(
      "[SmartBite] Firebase unavailable — LOCAL DEMO MODE."
    );
  }
} catch (e) {
  console.error("[SmartBite] Firebase init failed:", e);

  db = null;
  FIREBASE_READY = false;
}
