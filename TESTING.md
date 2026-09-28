# Testing checklist (tick each after trying it)

Use two windows: customer (`index.html`, phone-sized) and staff (`admin.html`). Both badges must say **Live Sync**.

## A. Customer flow
- [ ] Only ONE SmartBite header and ONE bottom nav appear.
- [ ] Discover shows the map (needs internet), "Tables available: 20 / 20", rush level, and a restaurant QR.
- [ ] Book a Table → pick T5 → fee shows ₹10 → a mobile number is requested → Pay → "Payment Successful" with Booking ID, token, table.
- [ ] Staff → Bookings shows it; Tables shows T5 *reserved* (no refresh).
- [ ] Arrival countdown ticks (set arrival window to 1 min in Settings to see expiry: booking → CANCELLED, T5 → available).
- [ ] Check-in: outside 100 m says "approximately N meters away"; *Demo Location* / *Demo Check-In* work; T5 → occupied.
- [ ] Table QR screen: another table's number is refused; *Demo Scan Table* / `index.html?table=5` opens the menu.
- [ ] Menu shows stock; breakfast/lunch items outside their window show the reason.
- [ ] Cart shows subtotal + GST + total; cannot exceed stock; Place Order → order ID (e.g. ORD-1001) and an ETA.

## B. Kitchen, inventory, live sync
- [ ] Staff → Orders shows the order without refreshing; stock in Inventory dropped.
- [ ] Accept → Preparing → Ready → Served: customer tracker follows each step instantly.
- [ ] Reject a NEW order: stock restored, customer sees "cancelled".
- [ ] Inventory: −/+/+5, and AVAILABLE↔UNAVAILABLE (kill switch) update the customer menu live.
- [ ] Two phones try to book the same table together: exactly one succeeds.
- [ ] Two phones order the last 1 item together: one succeeds, the other sees "Only 0 … left / sold out".

## C. Bill, payment, checkout
- [ ] Served → View Bill shows items, subtotal, GST, total → Pay (demo) → Receipt says PAID (DEMO).
- [ ] Receipt: Print works; WhatsApp opens with the message pre-filled (you press send).
- [ ] Finish Visit → table available, booking COMPLETED. Trying to finish before paying is refused.
- [ ] Staff → Payments/Reports show the new payment, tax collected, top items.

## D. Staff tools
- [ ] Menu Management: add, edit price/stock, delete an item; invalid values (price 0, negative stock) are rejected.
- [ ] Settings: change fee/tax → applies to the next booking/order only.
- [ ] Tables: change status by dropdown; Reset; Table QR sheet prints 20 QR codes.
- [ ] Idle alert: set idle minutes to 1, keep a table occupied with no activity → alert with Reset Table.
- [ ] Reports → *Rebuild recommendations* after a few completed orders → cart shows "Goes well with".
- [ ] Offline: turn off Wi-Fi on the phone → friendly "offline" message on actions, no crash.

## What was verified before delivery
Automated: 36 logic checks (booking race, oversell, tax, kill-switch, expiry, idempotent payment, algorithms) and a 33-check headless-browser run of the whole flow in **local demo mode** with zero JS errors.
**Not verified here:** real Firestore transactions and rules against your live project, real GPS, Leaflet map tiles / QR rendering (CDNs were unreachable in my test environment), and the phone experience. Please run sections A–D once on your deployment.
