# MH Mall — SmartBite + MH Cinemas

## Pages
- `index.html` — customer home and restaurant booking/order flow
- `theatre.html` — theatre shows, seat booking, demo ticket/QR, snack orders
- `mall.html` — map-based launcher for the restaurant and theatre modules
- `admin.html` — restaurant admin
- `theatre-admin.html` — theatre show, booking, ticket verification, and canteen admin

## Run locally
Use VS Code Live Server (recommended) or another local static web server. Open `index.html`. Do not test by double-clicking files if browser security blocks APIs.

## Firebase
The project uses the Firebase configuration in `firebase-config.js` for project `qr-based-real-time`. Confirm that the Firebase Console project is yours and that Firestore is enabled. If the configuration is wrong or Firebase cannot load, the restaurant and theatre modules use local demo storage where supported; local storage does not sync between devices.

Publish the included `firestore.rules` in Firebase Console only for a supervised demo. These rules allow unrestricted read/write access and are **not secure for production**. Never use them for real customer data or real payments. Payments in this project are simulations only.

## Admin pages
- Restaurant admin: `admin.html` (demo PIN is configured in `common.js`)
- Theatre admin: `theatre-admin.html`

## Quick smoke test
1. Open `index.html`; click the restaurant flow and confirm the existing screens load.
2. Return home and open `theatre.html`; select a show, select seats, enter a 10-digit mobile number, and use demo checkout.
3. Open `theatre-admin.html`; confirm the show appears under Shows/Bookings and verify the ticket token from the customer ticket page.
4. Place a snack order and confirm it appears under Canteen in theatre admin.
5. Open `mall.html`; select each map marker and open each module.
6. Test in two browsers/devices after Firestore rules are deployed to confirm cross-device sync.

## Important limits
This is a college demonstration prototype, not a production-ready booking or payment system. Admin authentication is demo-level, Firestore rules are open, and real payment/WhatsApp integration is not implemented. Verify Firebase permissions and the full smoke test before presenting.
