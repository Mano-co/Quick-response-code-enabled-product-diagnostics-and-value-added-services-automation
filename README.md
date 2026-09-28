# SmartBite — QR-Automated Restaurant Service Ecosystem (college demo)

Restaurant map → 20-table availability → ₹10 demo booking → check-in (geofence / demo) → table QR → menu & cart →
kitchen → inventory → bill with tax → demo payment → receipt → checkout.
**All payments are simulated. No real money or financial details are ever collected.**

## Files (put ALL of them in the repo root)
| File | Purpose |
|---|---|
| `index.html`, `app.js` | Customer app (mobile-first) |
| `admin.html`, `admin.js` | Staff dashboard: Dashboard, Tables (+QR sheet), Orders/Kitchen, Inventory, Menu Management, Payments, Bookings, Reports, Settings |
| `common.js` | **NEW** — shared config, data layer (Firestore or offline fallback), atomic transactions, tax, algorithms |
| `firebase-config.js` | Your Firebase project config + one-time init (compat SDK) |
| `style.css` | Styles for both apps |
| `firestore.rules` | Demo-level Firestore rules |

`common.js` replaced the duplicated CONFIG/data-layer code that used to live in both `app.js` and `admin.js` (the two copies had drifted apart). **You must upload `common.js` too**, or both pages will break.

## Run in VS Code
1. Open the folder in VS Code → install the **Live Server** extension.
2. Right-click `index.html` → *Open with Live Server*. Open `admin.html` the same way (staff PIN: `1234`, change `adminPin` in `common.js`).
3. Phone on the same Wi-Fi: open `http://<your-PC-IP>:5500/index.html` (find the IP with `ipconfig` / `ifconfig`). GPS on a phone needs HTTPS — on GitHub Pages it works; on plain LAN HTTP use **Demo Location / Demo Check-In**.

## Firebase setup (project `qr-services-and-products`, already in `firebase-config.js`)
1. Firebase Console → **Build → Firestore Database → Create database** (production or test mode).
2. **Rules** tab → paste the contents of `firestore.rules` → **Publish**.
3. Reload both pages. The badge must say **Live Sync** (green/marigold). If it says **Demo (offline)**, Firebase did not load — data then stays on that one device and the two dashboards will NOT sync across devices.
4. Collections are created automatically on first load: `restaurants` (with `settings`), `tables`, `menuItems`, `bookings`, `orders`, `payments`, `users`, `meta`, `recommendationData`.
5. Existing data is kept (old orders without tax fields display fine; old menu items get a default 5-minute prep time).

## Deploy (GitHub Pages)
Commit and push: `index.html admin.html style.css common.js app.js admin.js firebase-config.js firestore.rules README.md`. Pages URLs stay:
`…/index.html` (customer) and `…/admin.html` (staff). Hard-refresh (Ctrl+Shift+R) after the deploy.
Table QR codes: Admin → Tables → **Table QR codes** → Print. Each QR opens `index.html?table=N`.

## What the system enforces
* **Atomic table booking** — one Firestore transaction checks the table is `available`, reserves it, and writes booking + demo payment. Two people clicking the same table: one wins, the other gets "table just taken".
* **Atomic ordering + stock** — one transaction verifies the table is checked in *for this booking*, every item exists / is available / is inside its time window / has enough stock; prices come from the database (not the browser); stock is deducted; tax added; a sequential order ID (`ORD-1001…`) is issued.
* **Tax** — configurable in Admin → Settings (default 5%). Each order stores its own subtotal, tax % and total, so later changes never alter old bills.
* **Bill/payment** — payment amount is read from the stored order; paying twice cannot create two payments; must be `SERVED` first.
* **Booking expiry** — customer timer *and* an admin-side sweep cancel unarrived bookings and free the table. Checkout frees a table only if it still belongs to that booking.
* **Offline** — Firestore offline cache for reads; if Firebase can't load, a clearly labelled local fallback (localStorage, one device/browser only) keeps the demo runnable. Transactions in fallback mode are serialized.
* **Errors** — every action shows a friendly message (table taken, sold out, expired, offline, rules blocked).

## Algorithms (all live in `common.js`, visible in the UI)
| # | Algorithm | Where you see it | Complexity |
|---|---|---|---|
| 1 | Haversine distance + geofence (100 m) | Check-in screen | O(1) |
| 2 | Frequency-based recommendation (customer's most-ordered item, completed orders only) | "Recommended for You" + *Order again* | O(N) |
| 3 | Item-based collaborative filtering (co-occurrence matrix, precomputed by staff: Admin → Reports → *Rebuild recommendations*) | "Goes well with" in the cart | build O(N·k²), lookup O(1) |
| 4 | Queue-weighted preparation ETA: `ceil(work of earlier open orders ÷ kitchen stations) + longest item time` (an estimate, not a promise) | Order status page | O(K) |
| 5 | Rush meter (active orders: ≤5 low, 6–10 medium, 11+ high) + idle-table detection | Map card, dashboard, alerts | O(K) / O(T) |
| — | Time-based menu (breakfast < 11:00, lunch ≥ 11:00) | Menu, with reason shown | O(M) |

## Known limits (be upfront about these in the viva)
* No user authentication: `admin.html` is protected only by a **client-side PIN** — that is a demo gate, not security. Real protection needs Firebase Authentication + owner-only rules.
* The customer is identified by an unverified mobile number.
* Geofence and price checks run in the browser/transactions using open rules; a determined user could bypass them. Real enforcement needs Cloud Functions (paid Blaze plan).
* One active order per visit (a second order is blocked until the first is paid).
* Firestore rules in `firestore.rules` are demo-level.

## Testing checklist
See `TESTING.md`.
