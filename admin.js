/* ============================================================
   SmartBite — QR-Automated Restaurant Service Ecosystem
   admin.js — Configuration + Data Layer + Admin/Kitchen Dashboard
   (CONFIG/data layer mirrors app.js so this file also runs standalone)
   ============================================================ */

const CONFIG = {
  restaurantId: "smartbite_main",
  restaurantName: "SmartBite Restaurant",
  restaurantPhoto: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&q=80",
  restaurantRating: 4.3,
  restaurantLatitude: 9.9252,
  restaurantLongitude: 78.1198,
  geofenceRadius: 100,
  tableCount: 20,
  bookingFee: 10,
  arrivalTimeMinutes: 15,
  idleTableMinutes: 30,
  lowRushOrders: 5,
  mediumRushOrders: 10,
  breakfastEndHour: 11,
  whatsappNumber: "919999999999"
};

const MENU_SEED = [
  { id: "veg_puff", name: "Veg Puff", price: 25, category: "Snacks", stock: 10, available: true, timeSlot: "all", img: "🥟" },
  { id: "chicken_puff", name: "Chicken Puff", price: 35, category: "Snacks", stock: 10, available: true, timeSlot: "all", img: "🥟" },
  { id: "cream_bun", name: "Cream Bun", price: 20, category: "Bakery", stock: 10, available: true, timeSlot: "breakfast", img: "🍞" },
  { id: "chicken_biryani", name: "Chicken Biryani", price: 180, category: "Main Course", stock: 15, available: true, timeSlot: "lunch", img: "🍛" },
  { id: "veg_biryani", name: "Veg Biryani", price: 140, category: "Main Course", stock: 15, available: true, timeSlot: "lunch", img: "🍛" },
  { id: "chicken_65", name: "Chicken 65", price: 120, category: "Starters", stock: 12, available: true, timeSlot: "all", img: "🍗" },
  { id: "french_fries", name: "French Fries", price: 90, category: "Starters", stock: 20, available: true, timeSlot: "all", img: "🍟" },
  { id: "lime_juice", name: "Fresh Lime Juice", price: 50, category: "Beverages", stock: 20, available: true, timeSlot: "all", img: "🍋" },
  { id: "coffee", name: "Coffee", price: 30, category: "Beverages", stock: 25, available: true, timeSlot: "breakfast", img: "☕" },
  { id: "tea", name: "Tea", price: 20, category: "Beverages", stock: 25, available: true, timeSlot: "breakfast", img: "🍵" }
];

const LOCAL_PREFIX = "smartbite_";
function localGetAll(collection) {
  const raw = localStorage.getItem(LOCAL_PREFIX + collection);
  return raw ? JSON.parse(raw) : {};
}
function localSetAll(collection, obj) {
  localStorage.setItem(LOCAL_PREFIX + collection, JSON.stringify(obj));
  window.dispatchEvent(new CustomEvent("local-db-change", { detail: { collection } }));
}
async function dbSet(collection, id, data) {
  if (FIREBASE_READY) {
    await db.collection(collection).doc(String(id)).set(data, { merge: true });
  } else {
    const all = localGetAll(collection);
    all[id] = { ...(all[id] || {}), ...data, id };
    localSetAll(collection, all);
  }
}
async function dbGet(collection, id) {
  if (FIREBASE_READY) {
    const snap = await db.collection(collection).doc(String(id)).get();
    return snap.exists ? snap.data() : null;
  } else {
    const all = localGetAll(collection);
    return all[id] || null;
  }
}
async function dbGetAll(collection) {
  if (FIREBASE_READY) {
    const snap = await db.collection(collection).get();
    return snap.docs.map((d) => d.data());
  } else {
    return Object.values(localGetAll(collection));
  }
}
function dbListenAll(collection, callback) {
  if (FIREBASE_READY) {
    return db.collection(collection).onSnapshot((snap) => callback(snap.docs.map((d) => d.data())));
  } else {
    const fire = () => callback(Object.values(localGetAll(collection)));
    fire();
    const onStorage = (e) => { if (!e || e.key === LOCAL_PREFIX + collection) fire(); };
    const onLocal = (e) => { if (e.detail.collection === collection) fire(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("local-db-change", onLocal);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("local-db-change", onLocal); };
  }
}
function newId(prefix) { return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ---------- ADMIN DASHBOARD LOGIC ----------
let tablesCache = [];
let ordersCache = [];
let menuCache = [];
let paymentsCache = [];
let bookingsCache = [];

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("adminDbBadge").textContent = FIREBASE_READY ? "Live Sync" : "Demo (offline)";
  document.getElementById("adminDbBadge").classList.toggle("offline", !FIREBASE_READY);
  await seedIfNeededAdmin();

  dbListenAll("tables", (rows) => { tablesCache = rows.sort((a, b) => a.number - b.number); renderTables(); renderDashboard(); checkIdleTables(); });
  dbListenAll("orders", (rows) => { ordersCache = rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); renderOrders(); renderDashboard(); });
  dbListenAll("menuItems", (rows) => { menuCache = rows; renderInventory(); });
  dbListenAll("payments", (rows) => { paymentsCache = rows.sort((a, b) => (b.time || 0) - (a.time || 0)); renderPayments(); renderDashboard(); });
  dbListenAll("bookings", (rows) => { bookingsCache = rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); renderBookings(); });

  setInterval(checkIdleTables, 20000);
});

async function seedIfNeededAdmin() {
  const existingTables = await dbGetAll("tables");
  if (existingTables.length === 0) {
    for (let i = 1; i <= CONFIG.tableCount; i++) {
      await dbSet("tables", "table_" + i, { id: "table_" + i, number: i, status: "available", bookingId: null, lastActivity: Date.now() });
    }
  }
  const existingMenu = await dbGetAll("menuItems");
  if (existingMenu.length === 0) for (const item of MENU_SEED) await dbSet("menuItems", item.id, item);
}

function showPanel(name) {
  document.querySelectorAll(".admin-panel").forEach((p) => p.classList.remove("active"));
  document.getElementById("panel-" + name).classList.add("active");
  document.querySelectorAll(".admin-sidebar button[data-panel]").forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------- DASHBOARD ----------
function renderDashboard() {
  const total = tablesCache.length;
  const available = tablesCache.filter((t) => t.status === "available").length;
  const occupied = tablesCache.filter((t) => t.status === "occupied").length;
  // Active Orders excludes SERVED, COMPLETED, and CANCELLED (per admin requirements)
  const activeOrders = ordersCache.filter((o) => !["SERVED", "COMPLETED", "CANCELLED"].includes(o.status)).length;
  const revenue = paymentsCache.reduce((sum, p) => sum + (p.amount || 0), 0);

  document.getElementById("statTotalTables").textContent = total;
  document.getElementById("statAvailTables").textContent = available;
  document.getElementById("statOccTables").textContent = occupied;
  document.getElementById("statActiveOrders").textContent = activeOrders;
  document.getElementById("statRevenue").textContent = "₹" + revenue;

  let level = "🟢 LOW RUSH", cls = "pill-low";
  if (activeOrders > CONFIG.mediumRushOrders) { level = "🔴 HIGH RUSH"; cls = "pill-high"; }
  else if (activeOrders > CONFIG.lowRushOrders) { level = "🟡 MEDIUM RUSH"; cls = "pill-medium"; }
  const el = document.getElementById("dashRush");
  el.textContent = level; el.className = "pill " + cls;
}

// ---------- TABLES ----------
function renderTables() {
  const grid = document.getElementById("adminTableGrid");
  grid.innerHTML = "";
  tablesCache.forEach((t) => {
    const div = document.createElement("div");
    div.className = "admin-table-card";
    div.innerHTML = `
      <div class="mono" style="font-weight:700;font-size:1.1rem">T${t.number}</div>
      <span class="pill pill-${t.status}">${t.status}</span>
      <div style="margin-top:8px"><button class="btn btn-ghost btn-sm" onclick="resetTable(${t.number})">Reset</button></div>
    `;
    grid.appendChild(div);
  });
}
async function resetTable(num) {
  await dbSet("tables", "table_" + num, { status: "available", bookingId: null, lastActivity: Date.now() });
  toast(`Table ${num} reset to available.`);
}

// ---------- IDLE TABLE DETECTION ----------
function checkIdleTables() {
  const box = document.getElementById("idleAlerts");
  const now = Date.now();
  const alerts = tablesCache.filter(
    (t) => t.status === "occupied" && t.lastActivity && now - t.lastActivity > CONFIG.idleTableMinutes * 60 * 1000
  );
  box.innerHTML = alerts
    .map(
      (t) => `<div class="card" style="border-color:var(--chili);margin-bottom:10px">
        ⚠ Table ${t.number} has been occupied for ${CONFIG.idleTableMinutes}+ minutes without a new order.
        <button class="btn btn-danger btn-sm" style="margin-left:10px" onclick="resetTable(${t.number})">Reset Table</button>
      </div>`
    )
    .join("");
}

// ---------- ORDERS / KITCHEN ----------
// Order status stays UPPERCASE (NEW/ACCEPTED/PREPARING/READY/SERVED/COMPLETED) —
// this matches the customer-side step tracker in index.html/app.js exactly,
// so the live customer UI keeps working without any changes on that side.
const ORDER_STAGES = ["NEW", "ACCEPTED", "PREPARING", "READY", "SERVED"];
const ORDER_STAGE_BUTTONS = [
  { status: "ACCEPTED", label: "✓ Accept" },
  { status: "PREPARING", label: "👨‍🍳 Preparing" },
  { status: "READY", label: "🔔 Ready" },
  { status: "SERVED", label: "🍽 Served" }
];
function renderOrders() {
  const box = document.getElementById("kitchenOrders");
  const live = ordersCache.filter((o) => o.status !== "COMPLETED");
  box.innerHTML = live.length ? "" : `<p class="muted">No active orders.</p>`;
  live.forEach((o) => {
    const div = document.createElement("div");
    div.className = "order-card";
    const itemsStr = (o.items || []).map((i) => `${i.name} × ${i.qty}`).join(", ");
    const currentIdx = ORDER_STAGES.indexOf(o.status);
    const btnsHtml = ORDER_STAGE_BUTTONS.map((b) => {
      const stageIdx = ORDER_STAGES.indexOf(b.status);
      const alreadyReached = stageIdx <= currentIdx;
      return `<button class="btn btn-sm ${alreadyReached ? "btn-ghost" : "btn-primary"}"
                ${alreadyReached ? "disabled" : ""}
                onclick="setOrderStatus('${o.id}','${b.status}')">${b.label}</button>`;
    }).join("");
    div.innerHTML = `
      <div class="row"><b>${o.id}</b><span class="pill pill-${o.status === "READY" ? "available" : "reserved"}">${o.status}</span></div>
      <div class="muted">Table ${o.tableNumber} · ${o.mobile}</div>
      <div class="order-items">${itemsStr}</div>
      <div class="row"><span class="muted">Total</span><b class="mono">₹${o.total}</b></div>
      ${o.paymentStatus === "PAID" ? `<span class="pill pill-paid">PAID</span>` : `<span class="pill pill-reserved">UNPAID</span>`}
      <div class="status-btns">${btnsHtml}</div>
    `;
    box.appendChild(div);
  });
}
// Updates the SAME existing order document — never creates a new one.
// Real-time: this write is picked up by the customer's onSnapshot listener
// on that same orders/{orderId} document, so their status updates instantly.
async function setOrderStatus(orderId, status) {
  const updatedAt = FIREBASE_READY ? firebase.firestore.FieldValue.serverTimestamp() : Date.now();
  await dbSet("orders", orderId, { status, updatedAt });
  toast(`${orderId} → ${status}`);
}

// ---------- INVENTORY / KILL SWITCH ----------
function renderInventory() {
  const box = document.getElementById("inventoryList");
  box.innerHTML = "";
  menuCache.forEach((item) => {
    const row = document.createElement("div");
    row.className = "inv-row";
    row.innerHTML = `
      <div><b>${item.img || ""} ${item.name}</b><div class="muted">${item.category}</div></div>
      <div class="mono">${item.stock}</div>
      <div>
        <button class="btn btn-ghost btn-sm" onclick="adjustStock('${item.id}',-1)">−</button>
        <button class="btn btn-ghost btn-sm" onclick="adjustStock('${item.id}',1)">+</button>
        <button class="btn btn-ghost btn-sm" onclick="adjustStock('${item.id}',5)">+5</button>
      </div>
      <div>
        <button class="btn ${item.available ? "btn-success" : "btn-danger"} btn-sm" onclick="toggleAvailable('${item.id}')">
          ${item.available ? "AVAILABLE" : "UNAVAILABLE"}
        </button>
      </div>
      <div class="muted">${item.timeSlot}</div>
    `;
    box.appendChild(row);
  });
}
async function adjustStock(id, delta) {
  const item = menuCache.find((i) => i.id === id);
  const next = Math.max(0, item.stock + delta);
  await dbSet("menuItems", id, { stock: next });
}
async function toggleAvailable(id) {
  const item = menuCache.find((i) => i.id === id);
  await dbSet("menuItems", id, { available: !item.available });
  toast(`${item.name} is now ${!item.available ? "AVAILABLE" : "UNAVAILABLE"}`);
}

// ---------- PAYMENTS ----------
function renderPayments() {
  const box = document.getElementById("paymentsList");
  box.innerHTML = paymentsCache.length ? "" : `<p class="muted">No payments yet.</p>`;
  paymentsCache.forEach((p) => {
    const div = document.createElement("div");
    div.className = "order-card";
    div.innerHTML = `
      <div class="row"><b>${p.type === "booking" ? "Booking Fee" : "Order Payment"}</b><span class="pill pill-paid">${p.status}</span></div>
      <div class="muted">${p.bookingId || p.orderId || ""} · ${new Date(p.time).toLocaleString()}</div>
      <div class="row"><span class="muted">Amount</span><b class="mono">₹${p.amount}</b></div>
    `;
    box.appendChild(div);
  });
}

// ---------- BOOKINGS ----------
function renderBookings() {
  const box = document.getElementById("bookingsList");
  box.innerHTML = bookingsCache.length ? "" : `<p class="muted">No bookings yet.</p>`;
  bookingsCache.forEach((b) => {
    const div = document.createElement("div");
    div.className = "order-card";
    div.innerHTML = `
      <div class="row"><b>${b.id}</b><span class="pill pill-${b.status === "CANCELLED" ? "cancelled" : "paid"}">${b.status}</span></div>
      <div class="muted">Table ${b.tableNumber} · Token ${b.token} · ${b.mobile}</div>
      <div class="muted">Booked: ${new Date(b.createdAt).toLocaleString()}</div>
    `;
    box.appendChild(div);
  });
}
