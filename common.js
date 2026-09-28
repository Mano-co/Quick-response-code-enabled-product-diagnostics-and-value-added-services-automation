/* ============================================================
   SmartBite — common.js
   Shared by index.html (customer) and admin.html (staff).
   Contains: CONFIG, menu seed, data layer (Firestore OR local
   fallback), ATOMIC transactions (table booking, order + stock),
   billing/tax, algorithms, and helpers.
   All payments in this project are SIMULATED. No real money.
   ============================================================ */

// ---------- 1. CONFIGURATION (edit here) ----------
const CONFIG = {
  restaurantId: "smartbite_main",
  restaurantName: "SmartBite Restaurant",
  restaurantRating: 4.3,
  restaurantLatitude: 9.9252,
  restaurantLongitude: 78.1198,
  geofenceRadius: 100,          // metres
  tableCount: 20,
  bookingFee: 10,               // ₹, DEMO payment (default; owner can change in Admin > Settings)
  taxPercent: 5,                // GST %, configurable in Admin > Settings
  arrivalTimeMinutes: 15,
  idleTableMinutes: 30,
  lowRushOrders: 5,             // 0..5 low, 6..10 medium, 11+ high
  mediumRushOrders: 10,
  breakfastEndHour: 11,         // breakfast items before this hour, lunch items from it
  kitchenStations: 2,           // parallel cooks, used by the ETA algorithm
  whatsappNumber: "919999999999",
  adminPin: "1234"              // demo-level gate for admin.html (NOT real security)
};

// prepMinutes feeds the ETA algorithm
const MENU_SEED = [
  { id: "veg_puff", name: "Veg Puff", price: 25, category: "Snacks", stock: 10, available: true, timeSlot: "all", img: "🥟", prepMinutes: 3 },
  { id: "chicken_puff", name: "Chicken Puff", price: 35, category: "Snacks", stock: 10, available: true, timeSlot: "all", img: "🥟", prepMinutes: 3 },
  { id: "cream_bun", name: "Cream Bun", price: 20, category: "Bakery", stock: 10, available: true, timeSlot: "breakfast", img: "🍞", prepMinutes: 2 },
  { id: "chicken_biryani", name: "Chicken Biryani", price: 180, category: "Main Course", stock: 15, available: true, timeSlot: "lunch", img: "🍛", prepMinutes: 15 },
  { id: "veg_biryani", name: "Veg Biryani", price: 140, category: "Main Course", stock: 15, available: true, timeSlot: "lunch", img: "🍛", prepMinutes: 12 },
  { id: "chicken_65", name: "Chicken 65", price: 120, category: "Starters", stock: 12, available: true, timeSlot: "all", img: "🍗", prepMinutes: 10 },
  { id: "french_fries", name: "French Fries", price: 90, category: "Starters", stock: 20, available: true, timeSlot: "all", img: "🍟", prepMinutes: 6 },
  { id: "lime_juice", name: "Fresh Lime Juice", price: 50, category: "Beverages", stock: 20, available: true, timeSlot: "all", img: "🍋", prepMinutes: 2 },
  { id: "coffee", name: "Coffee", price: 30, category: "Beverages", stock: 25, available: true, timeSlot: "breakfast", img: "☕", prepMinutes: 3 },
  { id: "tea", name: "Tea", price: 20, category: "Beverages", stock: 25, available: true, timeSlot: "breakfast", img: "🍵", prepMinutes: 3 }
];

const ORDER_FLOW = ["NEW", "ACCEPTED", "PREPARING", "READY", "SERVED", "COMPLETED"];
const DONE_STATES = ["SERVED", "COMPLETED", "CANCELLED"]; // not "active" for rush / ETA

// ---------- 2. SMALL HELPERS ----------
function newId(prefix) { return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function esc(s) { // escape text before putting it in innerHTML
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function money(n) { return "₹" + (Math.round(n * 100) / 100).toString(); }
function friendlyError(e) {
  const m = (e && e.message) || String(e);
  if (m === "TABLE_TAKEN") return "Sorry, that table was just taken. Please pick another.";
  if (m === "BOOKING_EXPIRED") return "Your booking window has expired.";
  if (m === "BAD_BOOKING") return "No valid booking found for check-in.";
  if (m === "TABLE_NOT_YOURS") return "This table is not linked to your booking.";
  if (m === "NOT_CHECKED_IN") return "Please check in first before ordering.";
  if (m === "ORDER_ACTIVE") return "You already have an active order for this visit.";
  if (m === "EMPTY_CART") return "Your cart is empty.";
  if (m.startsWith("ITEM:")) return m.slice(5);
  if (m === "ORDER_NOT_SERVED") return "The bill can be paid once the order is served.";
  if (m === "CANNOT_CANCEL") return "This order is already being prepared and cannot be cancelled.";
  if (/offline|unavailable|network/i.test(m)) return "You appear to be offline. Please check your connection and try again.";
  if (/permission/i.test(m)) return "Firestore rules blocked this action. Check the rules in README.md.";
  return "Something went wrong: " + m;
}

function haversineMeters(lat1, lon1, lat2, lon2) { // Algorithm 1: Haversine, O(1)
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------- 3. DATA LAYER (Firestore or local fallback) ----------
const LOCAL_PREFIX = "smartbite_";
function localGetAll(c) { try { return JSON.parse(localStorage.getItem(LOCAL_PREFIX + c) || "{}"); } catch (e) { return {}; } }
function localSetAll(c, obj) {
  localStorage.setItem(LOCAL_PREFIX + c, JSON.stringify(obj));
  window.dispatchEvent(new CustomEvent("local-db-change", { detail: { collection: c } }));
}
const badDocId = (id) => /undefined|null|NaN/.test(String(id));
async function dbSet(c, id, data) {
  if (badDocId(id)) { console.warn("[SmartBite] skipped write to invalid doc id:", c, id); return; }
  if (FIREBASE_READY) return db.collection(c).doc(String(id)).set(data, { merge: true });
  const all = localGetAll(c); all[id] = { ...(all[id] || {}), ...data, id }; localSetAll(c, all);
}
async function dbDelete(c, id) {
  if (FIREBASE_READY) return db.collection(c).doc(String(id)).delete();
  const all = localGetAll(c); delete all[id]; localSetAll(c, all);
}
async function dbGet(c, id) {
  if (FIREBASE_READY) { const s = await db.collection(c).doc(String(id)).get(); return s.exists ? s.data() : null; }
  return localGetAll(c)[id] || null;
}
async function dbGetAll(c) {
  if (FIREBASE_READY) { const s = await db.collection(c).get(); return s.docs.map((d) => d.data()); }
  return Object.values(localGetAll(c));
}
function localListen(c, fire) {
  fire();
  const onS = (e) => { if (!e || e.key === LOCAL_PREFIX + c) fire(); };
  const onL = (e) => { if (e.detail.collection === c) fire(); };
  window.addEventListener("storage", onS); window.addEventListener("local-db-change", onL);
  return () => { window.removeEventListener("storage", onS); window.removeEventListener("local-db-change", onL); };
}
function dbListenAll(c, cb) {
  if (FIREBASE_READY) return db.collection(c).onSnapshot((s) => cb(s.docs.map((d) => d.data())), (err) => console.error("listen " + c, err));
  return localListen(c, () => cb(Object.values(localGetAll(c))));
}
function dbListenOne(c, id, cb) {
  if (FIREBASE_READY) return db.collection(c).doc(String(id)).onSnapshot((s) => cb(s.exists ? s.data() : null), (err) => console.error("listen " + c, err));
  return localListen(c, () => cb(localGetAll(c)[id] || null));
}

/** Atomic transaction. fn receives {get(collection,id), set(collection,id,data)}.
 *  Firestore: db.runTransaction (auto-retry on contention). Local: reads then commits writes together.
 *  Rule: do ALL reads before any set() inside fn. */
async function runTx(fn) {
  if (FIREBASE_READY) {
    return db.runTransaction(async (tx) => {
      const a = {
        get: async (c, id) => { const s = await tx.get(db.collection(c).doc(String(id))); return s.exists ? s.data() : null; },
        set: (c, id, d) => { if (badDocId(id)) return; tx.set(db.collection(c).doc(String(id)), d, { merge: true }); }
      };
      return fn(a);
    });
  }
  // Local fallback: transactions run ONE AT A TIME (queue) so two clicks in the same tab can't both win.
  const run = async () => {
    const writes = [];
    const a = { get: async (c, id) => localGetAll(c)[id] || null, set: (c, id, d) => { if (!badDocId(id)) writes.push([c, id, d]); } };
    const result = await fn(a);
    writes.forEach(([c, id, d]) => { const all = localGetAll(c); all[id] = { ...(all[id] || {}), ...d, id }; localSetAll(c, all); });
    return result;
  };
  const p = localTxChain.then(run, run);
  localTxChain = p.catch(() => {});
  return p;
}
let localTxChain = Promise.resolve();

// ---------- 4. SETTINGS (owner-configurable, stored in restaurants/{id}.settings) ----------
const SETTINGS = { bookingFee: CONFIG.bookingFee, taxPercent: CONFIG.taxPercent, idleTableMinutes: CONFIG.idleTableMinutes, arrivalTimeMinutes: CONFIG.arrivalTimeMinutes };
function mergeSettings(doc) {
  const s = (doc && doc.settings) || {};
  const num = (v, d, min, max) => (typeof v === "number" && isFinite(v) && v >= min && v <= max ? v : d);
  SETTINGS.bookingFee = num(s.bookingFee, CONFIG.bookingFee, 0, 5000);
  SETTINGS.taxPercent = num(s.taxPercent, CONFIG.taxPercent, 0, 50);
  SETTINGS.idleTableMinutes = num(s.idleTableMinutes, CONFIG.idleTableMinutes, 1, 600);
  SETTINGS.arrivalTimeMinutes = num(s.arrivalTimeMinutes, CONFIG.arrivalTimeMinutes, 1, 120);
  return SETTINGS;
}
function listenSettings(cb) {
  return dbListenOne("restaurants", CONFIG.restaurantId, (doc) => { mergeSettings(doc); if (cb) cb(SETTINGS); });
}
function computeBill(subtotal, taxPercent) {
  const taxAmount = Math.round(subtotal * taxPercent) / 100;
  return { subtotal, taxPercent, taxAmount, total: Math.round((subtotal + taxAmount) * 100) / 100 };
}

// ---------- 5. SEEDING ----------
async function seedIfNeeded() {
  const tables = await dbGetAll("tables");
  if (tables.length < CONFIG.tableCount) {
    const have = new Set(tables.map((t) => t.number));
    for (let i = 1; i <= CONFIG.tableCount; i++) {
      if (!have.has(i)) await dbSet("tables", "table_" + i, { id: "table_" + i, number: i, status: "available", bookingId: null, lastActivity: Date.now() });
    }
  }
  if ((await dbGetAll("menuItems")).length === 0) for (const it of MENU_SEED) await dbSet("menuItems", it.id, it);
  if (!(await dbGet("restaurants", CONFIG.restaurantId))) {
    await dbSet("restaurants", CONFIG.restaurantId, {
      id: CONFIG.restaurantId, name: CONFIG.restaurantName, lat: CONFIG.restaurantLatitude, lng: CONFIG.restaurantLongitude,
      rating: CONFIG.restaurantRating,
      settings: { bookingFee: CONFIG.bookingFee, taxPercent: CONFIG.taxPercent, idleTableMinutes: CONFIG.idleTableMinutes, arrivalTimeMinutes: CONFIG.arrivalTimeMinutes }
    });
  }
}

// ---------- 6. TIME-BASED MENU ----------
function isItemInTimeWindow(item, hour) {
  const h = hour == null ? new Date().getHours() : hour;
  if (item.timeSlot === "breakfast") return h < CONFIG.breakfastEndHour;
  if (item.timeSlot === "lunch") return h >= CONFIG.breakfastEndHour;
  return true;
}
function itemUnavailableReason(item) {
  if (!item.available) return "Currently unavailable";
  if (!isItemInTimeWindow(item)) return item.timeSlot === "breakfast" ? "Available during breakfast only" : "Available from lunch onward";
  if (!(item.stock > 0)) return "Sold out";
  return null;
}

// ---------- 7. ATOMIC BUSINESS TRANSACTIONS ----------
/** Book a table + record demo booking payment, atomically. Two customers cannot get the same table. */
async function bookTableAtomic(tableNum, mobile) {
  const now = Date.now();
  return runTx(async (tx) => {
    const table = await tx.get("tables", "table_" + tableNum);
    const rest = await tx.get("restaurants", CONFIG.restaurantId);
    if (!table || table.status !== "available") throw new Error("TABLE_TAKEN");
    const s = mergeSettings(rest);
    const bookingId = newId("BKG").toUpperCase();
    const booking = {
      id: bookingId, tableNumber: tableNum, mobile: mobile || "guest", status: "CONFIRMED",
      token: Math.floor(1000 + Math.random() * 9000), bookingFee: s.bookingFee, paymentStatus: "PAID (DEMO)",
      createdAt: now, arrivalDeadline: now + s.arrivalTimeMinutes * 60000
    };
    tx.set("tables", "table_" + tableNum, { status: "reserved", bookingId, lastActivity: now });
    tx.set("bookings", bookingId, booking);
    tx.set("payments", "PAY_" + bookingId, { id: "PAY_" + bookingId, type: "booking", bookingId, amount: s.bookingFee, status: "PAID", demo: true, time: now });
    return booking;
  });
}

/** Cancel an unpaid-arrival booking whose deadline passed; frees the table. Safe to call repeatedly. */
async function expireBookingAtomic(bookingId) {
  return runTx(async (tx) => {
    const b = await tx.get("bookings", bookingId);
    if (!b || b.status !== "CONFIRMED" || Date.now() < b.arrivalDeadline) return false;
    const t = await tx.get("tables", "table_" + b.tableNumber);
    tx.set("bookings", bookingId, { status: "CANCELLED", cancelledAt: Date.now(), cancelReason: "Arrival window expired" });
    if (t && t.bookingId === bookingId) tx.set("tables", "table_" + b.tableNumber, { status: "available", bookingId: null });
    return true;
  });
}

/** Staff/customer cancel of a CONFIRMED booking (frees the table). */
async function cancelBookingAtomic(bookingId, reason) {
  return runTx(async (tx) => {
    const b = await tx.get("bookings", bookingId);
    if (!b || !["CONFIRMED", "CHECKED_IN"].includes(b.status)) return false;
    const t = await tx.get("tables", "table_" + b.tableNumber);
    tx.set("bookings", bookingId, { status: "CANCELLED", cancelledAt: Date.now(), cancelReason: reason || "Cancelled" });
    if (t && t.bookingId === bookingId) tx.set("tables", "table_" + b.tableNumber, { status: "available", bookingId: null });
    return true;
  });
}

/** Arrival check-in: booking must still be CONFIRMED and inside its window. */
async function checkInAtomic(bookingId, method) {
  return runTx(async (tx) => {
    const b = await tx.get("bookings", bookingId);
    if (!b || b.status !== "CONFIRMED") throw new Error("BAD_BOOKING");
    if (Date.now() > b.arrivalDeadline) throw new Error("BOOKING_EXPIRED");
    tx.set("bookings", bookingId, { status: "CHECKED_IN", checkInMethod: method, checkedInAt: Date.now() });
    tx.set("tables", "table_" + b.tableNumber, { status: "occupied", lastActivity: Date.now() });
    return b;
  });
}

/** Place an order. Server-side-style rules inside ONE transaction:
 *  table must be occupied by THIS booking, every item must exist, be available, in its time window and have
 *  enough stock; prices come from the database (never from the browser); stock is deducted; tax is added. */
async function placeOrderAtomic(cart, tableNum, mobile, bookingId) {
  const ids = Object.keys(cart).filter((id) => cart[id] > 0);
  if (!ids.length) throw new Error("EMPTY_CART");
  return runTx(async (tx) => {
    const table = await tx.get("tables", "table_" + tableNum);
    const rest = await tx.get("restaurants", CONFIG.restaurantId);
    const counter = (await tx.get("meta", "orderCounter")) || { n: 1000 };
    const menu = {};
    for (const id of ids) menu[id] = await tx.get("menuItems", id);
    if (!table || table.status !== "occupied") throw new Error("NOT_CHECKED_IN");
    if (!bookingId || table.bookingId !== bookingId) throw new Error("TABLE_NOT_YOURS");
    const s = mergeSettings(rest);
    const items = []; let subtotal = 0;
    for (const id of ids) {
      const qty = Math.floor(cart[id]); const m = menu[id];
      if (!m || !(qty > 0)) throw new Error("ITEM:An item in your cart no longer exists.");
      const reason = itemUnavailableReason({ ...m, stock: m.stock });
      if (reason) throw new Error("ITEM:" + m.name + " — " + reason.toLowerCase() + ".");
      if (qty > m.stock) throw new Error("ITEM:Only " + m.stock + " " + m.name + " left in stock.");
      items.push({ id, name: m.name, qty, price: m.price, prepMinutes: m.prepMinutes || 5 });
      subtotal += m.price * qty;
    }
    const bill = computeBill(subtotal, s.taxPercent);
    const n = counter.n + 1; const orderId = "ORD-" + n; const now = Date.now();
    for (const it of items) tx.set("menuItems", it.id, { stock: menu[it.id].stock - it.qty });
    tx.set("meta", "orderCounter", { n });
    tx.set("tables", "table_" + tableNum, { lastActivity: now });
    const order = {
      id: orderId, mobile: mobile || "guest", tableNumber: tableNum, bookingId, items,
      subtotal: bill.subtotal, taxPercent: bill.taxPercent, taxAmount: bill.taxAmount, total: bill.total,
      status: "NEW", paymentStatus: "UNPAID", createdAt: now, updatedAt: now
    };
    tx.set("orders", orderId, order);
    return order;
  });
}

/** Staff status change with forward-only rule. */
async function setOrderStatusAtomic(orderId, status) {
  return runTx(async (tx) => {
    const o = await tx.get("orders", orderId);
    if (!o || o.status === "CANCELLED" || o.status === "COMPLETED") return false;
    if (ORDER_FLOW.indexOf(status) <= ORDER_FLOW.indexOf(o.status)) return false;
    tx.set("orders", orderId, { status, updatedAt: Date.now() });
    return true;
  });
}

/** Cancel/reject an order that has not started cooking; restores stock. */
async function cancelOrderAtomic(orderId) {
  return runTx(async (tx) => {
    const o = await tx.get("orders", orderId);
    if (!o) return false;
    if (!["NEW", "ACCEPTED"].includes(o.status)) throw new Error("CANNOT_CANCEL");
    const menu = {};
    for (const it of o.items) menu[it.id] = await tx.get("menuItems", it.id);
    for (const it of o.items) if (menu[it.id]) tx.set("menuItems", it.id, { stock: menu[it.id].stock + it.qty });
    tx.set("orders", orderId, { status: "CANCELLED", updatedAt: Date.now() });
    const t = await tx.get("tables", "table_" + o.tableNumber);
    if (t) tx.set("tables", "table_" + o.tableNumber, { lastActivity: Date.now() });
    return true;
  });
}

/** Simulated final payment. Amount is read from the stored order (never from the browser). Idempotent. */
async function payOrderAtomic(orderId) {
  return runTx(async (tx) => {
    const o = await tx.get("orders", orderId);
    if (!o) throw new Error("ITEM:Order not found.");
    if (o.paymentStatus === "PAID") return o; // already paid — do not double-record
    if (o.status !== "SERVED") throw new Error("ORDER_NOT_SERVED");
    const now = Date.now(); const payId = "PAY_" + orderId;
    tx.set("payments", payId, { id: payId, type: "final", orderId, amount: o.total, subtotal: o.subtotal, taxAmount: o.taxAmount, status: "PAID", demo: true, time: now });
    tx.set("orders", orderId, { status: "COMPLETED", paymentStatus: "PAID", paymentId: payId, paidAt: now, updatedAt: now });
    return { ...o, status: "COMPLETED", paymentStatus: "PAID", paymentId: payId, paidAt: now };
  });
}

/** Checkout: closes the booking and frees the table (only if the table still belongs to this booking). */
async function checkoutAtomic(bookingId, tableNum) {
  return runTx(async (tx) => {
    const t = await tx.get("tables", "table_" + tableNum);
    const b = bookingId ? await tx.get("bookings", bookingId) : null;
    if (t && (t.bookingId === bookingId || !bookingId)) tx.set("tables", "table_" + tableNum, { status: "available", bookingId: null, lastActivity: Date.now() });
    if (b && b.status === "CHECKED_IN") tx.set("bookings", bookingId, { status: "COMPLETED", completedAt: Date.now() });
    return true;
  });
}

// ---------- 8. ALGORITHMS ----------
/** Algorithm 2 — frequency-based recommendation. O(N) over the customer's COMPLETED orders. */
function favouriteItem(orders, mobile) {
  if (!mobile) return null;
  const counts = {};
  orders.filter((o) => o.mobile === mobile && o.status === "COMPLETED")
    .forEach((o) => (o.items || []).forEach((i) => { counts[i.id] = (counts[i.id] || 0) + i.qty; }));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? { id: top[0], count: top[1] } : null;
}

/** Algorithm 3 — item-to-item co-occurrence matrix. Built by staff ("Rebuild recommendations") and stored in
 *  recommendationData/cooccurrence, so the customer app does an O(1) dictionary lookup, not a scan. */
function buildCooccurrence(orders) {
  const m = {};
  orders.filter((o) => o.status === "COMPLETED").forEach((o) => {
    const ids = [...new Set((o.items || []).map((i) => i.id))];
    ids.forEach((a) => ids.forEach((b) => { if (a !== b) { m[a] = m[a] || {}; m[a][b] = (m[a][b] || 0) + 1; } }));
  });
  const out = {};
  Object.keys(m).forEach((a) => { out[a] = Object.entries(m[a]).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([id]) => id); });
  return out; // { itemId: [top 3 partner ids] }
}
function complementaryFor(cartIds, matrix, menu) {
  const seen = new Set(cartIds), out = [];
  cartIds.forEach((id) => (matrix[id] || []).forEach((p) => {
    const it = menu.find((m) => m.id === p);
    if (it && !seen.has(p) && !itemUnavailableReason(it)) { seen.add(p); out.push(it); }
  }));
  return out.slice(0, 3);
}

/** Algorithm 4 — queue-weighted ETA, O(K) over K active orders.
 *  work(order) = sum(qty × prepMinutes) (cooks handle items in parallel: use max item time as floor)
 *  ETA(order) = ceil( workAhead / stations ) + longestItemTime(order).  An estimate, not a guarantee. */
function orderWork(o) { return (o.items || []).reduce((s, i) => s + i.qty * (i.prepMinutes || 5), 0); }
function longestItem(o) { return (o.items || []).reduce((m, i) => Math.max(m, i.prepMinutes || 5), 0); }
function etaMinutes(order, allOrders) {
  if (["READY", "SERVED", "COMPLETED", "CANCELLED"].includes(order.status)) return 0;
  const ahead = allOrders.filter((o) => o.id !== order.id && !["READY", ...DONE_STATES].includes(o.status) && (o.createdAt || 0) < (order.createdAt || 0));
  const workAhead = ahead.reduce((s, o) => s + orderWork(o), 0);
  return Math.ceil(workAhead / CONFIG.kitchenStations) + longestItem(order);
}
function rushLevel(activeCount) { // Rush meter
  if (activeCount > CONFIG.mediumRushOrders) return { label: "🔴 HIGH RUSH", cls: "pill-high", wait: "~25 min" };
  if (activeCount > CONFIG.lowRushOrders) return { label: "🟡 MEDIUM RUSH", cls: "pill-medium", wait: "~12 min" };
  return { label: "🟢 LOW RUSH", cls: "pill-low", wait: "~5 min" };
}
