/* ============================================================
   SmartBite — QR-Automated Restaurant Service Ecosystem
   app.js — Configuration + Data Layer + Customer App Logic
   ============================================================ */

// ---------- 1. CONFIGURATION (edit these to customize the demo) ----------
const CONFIG = {
  restaurantId: "smartbite_main",
  restaurantName: "SmartBite Restaurant",
  restaurantPhoto: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&q=80",
  restaurantRating: 4.3,
  restaurantLatitude: 9.9252,
  restaurantLongitude: 78.1198,     // edit to your demo location
  geofenceRadius: 100,               // meters
  tableCount: 20,
  bookingFee: 10,                    // rupees, DEMO ONLY
  arrivalTimeMinutes: 15,
  idleTableMinutes: 30,
  lowRushOrders: 5,
  mediumRushOrders: 10,
  breakfastEndHour: 11,              // 24h — items tagged "breakfast" show before this hour
  whatsappNumber: "919999999999"     // demo restaurant WhatsApp number, edit me
};

// ---------- 2. DEMO MENU SEED (loaded into Firestore once, on first run) ----------
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

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------- 3. DATA LAYER ----------
// Every read/write goes through these functions. If Firebase is configured
// (see firebase-config.js) they talk to Firestore in real time. If not,
// they fall back to localStorage + a custom event, so the whole flow still
// works on ONE device before Firebase is set up (topbar shows "Demo (offline)").
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
function dbListenOne(collection, id, callback) {
  if (FIREBASE_READY) {
    return db.collection(collection).doc(String(id)).onSnapshot((snap) => callback(snap.exists ? snap.data() : null));
  } else {
    const fire = () => { const all = localGetAll(collection); callback(all[id] || null); };
    fire();
    const onStorage = (e) => { if (!e || e.key === LOCAL_PREFIX + collection) fire(); };
    const onLocal = (e) => { if (e.detail.collection === collection) fire(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("local-db-change", onLocal);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("local-db-change", onLocal); };
  }
}
function newId(prefix) { return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ---------- 4. CUSTOMER APP LOGIC ----------
// ---------- session state (this device only, not shared data) ----------
const SESSION_KEY = "smartbite_session";
let state = Object.assign(
  { mobile: null, tableNumber: null, bookingId: null, orderId: null, cart: {} },
  JSON.parse(localStorage.getItem(SESSION_KEY) || "{}")
);
function saveSession() { localStorage.setItem(SESSION_KEY, JSON.stringify(state)); }

let navHistory = ["home"];
let menuItemsCache = [];
let tablesCache = [];
let unsubBooking = null, unsubOrder = null, unsubMenu = null, unsubTables = null;
let arrivalIntervalId = null;

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("dbBadge").textContent = FIREBASE_READY ? "Live Sync" : "Demo (offline)";
  document.getElementById("dbBadge").classList.toggle("offline", !FIREBASE_READY);
  await seedIfNeeded();
  listenTablesGlobal();
  if (state.mobile) checkWelcomeBack();
});

// ---------- seeding ----------
async function seedIfNeeded() {
  const existingTables = await dbGetAll("tables");
  if (existingTables.length === 0) {
    for (let i = 1; i <= CONFIG.tableCount; i++) {
      await dbSet("tables", "table_" + i, { id: "table_" + i, number: i, status: "available", bookingId: null, lastActivity: Date.now() });
    }
  }
  const existingMenu = await dbGetAll("menuItems");
  if (existingMenu.length === 0) {
    for (const item of MENU_SEED) await dbSet("menuItems", item.id, item);
  }
  const existingRestaurant = await dbGet("restaurants", CONFIG.restaurantId);
  if (!existingRestaurant) {
    await dbSet("restaurants", CONFIG.restaurantId, {
      id: CONFIG.restaurantId, name: CONFIG.restaurantName, lat: CONFIG.restaurantLatitude,
      lng: CONFIG.restaurantLongitude, rating: CONFIG.restaurantRating
    });
  }
}

// ---------- navigation ----------
function go(name, replace) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");
  if (!replace) {
    if (navHistory[navHistory.length - 1] !== name) navHistory.push(name);
  } else {
    navHistory[navHistory.length - 1] = name;
  }
  document.getElementById("backBtn").style.visibility = navHistory.length > 1 ? "visible" : "hidden";
  document.querySelectorAll(".bottom-nav button").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));

  const titles = {
    home: "SmartBite", map: "Discover", tables: "Book a Table", bookingPay: "Payment",
    arrival: "Arrival Timer", checkin: "Check-In", tableQr: "Scan Table", profile: "Your Profile",
    menu: "Menu", cart: "Your Cart", orderStatus: "Order Status", bill: "My Bill",
    finalPay: "Payment", receipt: "Receipt", checkout: "Checkout"
  };
  document.getElementById("topbarTitle").textContent = titles[name] || "SmartBite";

  if (name === "map") initMap();
  if (name === "tables") renderTableGrid();
  if (name === "menu") openMenuScreen();
  if (name === "cart") renderCart();
  if (name === "orderStatus") listenOrderStatus();
  if (name === "checkin") { document.getElementById("checkinSuccessCard").style.display = "none"; }
  if (name === "bookingPay") {
    document.getElementById("payTableNum").textContent = selectedTable;
    document.getElementById("payFeeAmt").textContent = CONFIG.bookingFee;
    document.getElementById("payBtnAmt").textContent = CONFIG.bookingFee;
    document.getElementById("payProcessing").style.display = "none";
    document.getElementById("paySuccess").style.display = "none";
    document.getElementById("payBtn").style.display = "block";
  }
  if (name === "arrival") startArrivalTimer();
}
function goBack() {
  if (navHistory.length > 1) { navHistory.pop(); go(navHistory[navHistory.length - 1], true); }
}
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------- MAP / DISCOVERY ----------
let leafletMap = null;
function initMap() {
  if (leafletMap) { leafletMap.invalidateSize(); return; }
  leafletMap = L.map("map").setView([CONFIG.restaurantLatitude, CONFIG.restaurantLongitude], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(leafletMap);
  const marker = L.marker([CONFIG.restaurantLatitude, CONFIG.restaurantLongitude]).addTo(leafletMap);
  marker.on("click", showRestaurantCard);
  showRestaurantCard();
}
async function showRestaurantCard() {
  const card = document.getElementById("restaurantCard");
  card.style.display = "block";
  document.getElementById("rName").textContent = CONFIG.restaurantName;
  document.getElementById("rRating").textContent = "⭐ " + CONFIG.restaurantRating;
  await updateRushMeter();
  const free = tablesCache.filter((t) => t.status === "available").length;
  document.getElementById("rTablesFree").textContent = `Tables available: ${free} / ${CONFIG.tableCount}`;
  document.getElementById("rQr").innerHTML = "";
  new QRCode(document.getElementById("rQr"), { text: location.href.split("#")[0] + "#book", width: 110, height: 110 });
}
async function updateRushMeter() {
  const orders = await dbGetAll("orders");
  const active = orders.filter((o) => !["COMPLETED"].includes(o.status)).length;
  let level = "🟢 LOW RUSH", wait = "~5 min", cls = "pill-low";
  if (active > CONFIG.mediumRushOrders) { level = "🔴 HIGH RUSH"; wait = "~25 min"; cls = "pill-high"; }
  else if (active > CONFIG.lowRushOrders) { level = "🟡 MEDIUM RUSH"; wait = "~12 min"; cls = "pill-medium"; }
  const rushEl = document.getElementById("rRush");
  rushEl.textContent = level; rushEl.className = "pill " + cls;
  document.getElementById("rWait").textContent = "Estimated wait: " + wait;
}

// ---------- TABLE BOOKING ----------
function listenTablesGlobal() {
  unsubTables = dbListenAll("tables", (rows) => {
    tablesCache = rows.sort((a, b) => a.number - b.number);
    if (document.getElementById("screen-tables").classList.contains("active")) renderTableGrid();
  });
}
let selectedTable = null;
function renderTableGrid() {
  const grid = document.getElementById("tableGrid");
  grid.innerHTML = "";
  tablesCache.forEach((t) => {
    const btn = document.createElement("button");
    btn.className = "table-chip " + t.status + (selectedTable === t.number ? " selected" : "");
    btn.disabled = t.status !== "available";
    btn.innerHTML = `<span class="num">T${t.number}</span><span>${t.status}</span>`;
    btn.onclick = () => selectTable(t.number);
    grid.appendChild(btn);
  });
}
function selectTable(num) {
  selectedTable = num;
  renderTableGrid();
  document.getElementById("bookingFeeCard").style.display = "block";
  document.getElementById("selTableLabel").textContent = "Table " + num;
  document.getElementById("feeAmt").textContent = CONFIG.bookingFee;
}

// ---------- BOOKING PAYMENT (SIMULATED) ----------
async function simulateBookingPayment() {
  document.getElementById("payBtn").style.display = "none";
  document.getElementById("payProcessing").style.display = "block";

  const bookingId = newId("BKG").toUpperCase();
  const token = Math.floor(1000 + Math.random() * 9000);
  const now = Date.now();
  const deadline = now + CONFIG.arrivalTimeMinutes * 60 * 1000;

  await dbSet("tables", "table_" + selectedTable, { status: "reserved", bookingId, lastActivity: now });
  await dbSet("bookings", bookingId, {
    id: bookingId, tableNumber: selectedTable, mobile: state.mobile || "guest",
    status: "CONFIRMED", token, bookingFee: CONFIG.bookingFee, createdAt: now, arrivalDeadline: deadline
  });
  await dbSet("payments", newId("PAY"), {
    type: "booking", bookingId, amount: CONFIG.bookingFee, status: "PAID", time: now
  });

  state.bookingId = bookingId; state.tableNumber = selectedTable; saveSession();

  setTimeout(() => {
    document.getElementById("payProcessing").style.display = "none";
    document.getElementById("paySuccess").style.display = "block";
    document.getElementById("sumBookingId").textContent = bookingId;
    document.getElementById("sumToken").textContent = token;
    document.getElementById("sumTable").textContent = "Table " + selectedTable;
  }, 1100);
}

// ---------- ARRIVAL TIMER ----------
function startArrivalTimer() {
  document.getElementById("arrTableNum").textContent = state.tableNumber;
  if (arrivalIntervalId) clearInterval(arrivalIntervalId);
  if (unsubBooking) unsubBooking();
  unsubBooking = dbListenOne("bookings", state.bookingId, (booking) => {
    if (!booking) return;
    if (booking.status === "CANCELLED") {
      document.getElementById("arrivalStatus").textContent = "Booking expired and was cancelled.";
      document.getElementById("arrivalTimer").textContent = "00:00";
      clearInterval(arrivalIntervalId);
      return;
    }
    arrivalIntervalId = setInterval(async () => {
      const remaining = booking.arrivalDeadline - Date.now();
      if (remaining <= 0) {
        clearInterval(arrivalIntervalId);
        document.getElementById("arrivalTimer").textContent = "00:00";
        await dbSet("bookings", state.bookingId, { status: "CANCELLED" });
        await dbSet("tables", "table_" + state.tableNumber, { status: "available", bookingId: null });
        toast("Your booking window expired.");
        return;
      }
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      document.getElementById("arrivalTimer").textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }, 1000);
  });
}

// ---------- CHECK-IN ----------
let lastKnownDistance = null;
function checkGeolocation() {
  if (!navigator.geolocation) { toast("Geolocation not supported — use Demo Location."); return; }
  document.getElementById("distanceText").textContent = "Locating you...";
  navigator.geolocation.getCurrentPosition(
    (pos) => evaluateDistance(pos.coords.latitude, pos.coords.longitude),
    () => { toast("Location permission denied. Use Demo Location instead."); document.getElementById("distanceText").textContent = "Could not get your location."; },
    { timeout: 8000 }
  );
}
function useDemoLocation() { evaluateDistance(CONFIG.restaurantLatitude, CONFIG.restaurantLongitude); }
function evaluateDistance(lat, lng) {
  const d = haversineMeters(lat, lng, CONFIG.restaurantLatitude, CONFIG.restaurantLongitude);
  lastKnownDistance = d;
  const within = d <= CONFIG.geofenceRadius;
  document.getElementById("distanceText").textContent = within
    ? "✓ You are near the restaurant"
    : `You are approximately ${Math.round(d)} meters away.`;
  document.getElementById("checkinSuccessCard").style.display = within ? "block" : "none";
}
async function confirmCheckIn(isDemo) {
  if (!state.bookingId) { toast("No active booking found."); return; }
  clearInterval(arrivalIntervalId);
  await dbSet("bookings", state.bookingId, { status: "CHECKED_IN" });
  await dbSet("tables", "table_" + state.tableNumber, { status: "occupied", lastActivity: Date.now() });
  toast(isDemo ? "Demo check-in complete ✓" : "Checked in ✓");
  go("tableQr");
}

// ---------- TABLE QR ----------
function demoScanTable() {
  if (!state.tableNumber) { toast("No table assigned yet — book a table first."); return; }
  document.getElementById("tableNumberInput").value = state.tableNumber;
  openMenuForTable();
}
async function openMenuForTable() {
  const num = parseInt(document.getElementById("tableNumberInput").value, 10);
  if (!num || num < 1 || num > CONFIG.tableCount) { toast("Enter a valid table number (1-" + CONFIG.tableCount + ")."); return; }
  const table = await dbGet("tables", "table_" + num);
  if (!table || table.status === "available" || table.status === "cleaning") {
    toast("This table isn't checked in yet. Please check in first.");
    return;
  }
  state.tableNumber = num; saveSession();
  if (!state.mobile) go("profile"); else go("menu");
}

// ---------- PROFILE / RECOMMENDATIONS ----------
async function saveProfile() {
  const mobile = document.getElementById("mobileInput").value.trim();
  if (!/^\d{10}$/.test(mobile)) { toast("Enter a valid 10-digit mobile number."); return; }
  state.mobile = mobile; saveSession();
  const existing = await dbGet("users", mobile);
  await dbSet("users", mobile, { mobile, lastVisit: Date.now() });
  toast(existing ? "Welcome back!" : "Welcome to SmartBite!");
  go("menu");
}
async function checkWelcomeBack() {
  const existing = await dbGet("users", state.mobile);
  if (existing) toast("Welcome back!");
}
async function getRecommendation() {
  if (!state.mobile) return null;
  const orders = await dbGetAll("orders");
  const mine = orders.filter((o) => o.mobile === state.mobile);
  const counts = {};
  mine.forEach((o) => (o.items || []).forEach((it) => { counts[it.name] = (counts[it.name] || 0) + it.qty; }));
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted.length ? sorted[0][0] : null;
}

// ---------- MENU + INVENTORY ----------
async function openMenuScreen() {
  document.getElementById("menuTableNum").textContent = state.tableNumber || "—";
  if (unsubMenu) unsubMenu();
  unsubMenu = dbListenAll("menuItems", (items) => { menuItemsCache = items; renderMenu(); });
  const rec = await getRecommendation();
  const recCard = document.getElementById("recommendCard");
  if (rec) { recCard.style.display = "block"; document.getElementById("recommendItem").textContent = rec; }
  else recCard.style.display = "none";
}
function isItemInTimeWindow(item) {
  const hour = new Date().getHours();
  if (item.timeSlot === "breakfast") return hour < CONFIG.breakfastEndHour;
  if (item.timeSlot === "lunch") return hour >= CONFIG.breakfastEndHour;
  return true;
}
function renderMenu() {
  const list = document.getElementById("menuList");
  list.innerHTML = "";
  const cats = [...new Set(menuItemsCache.map((i) => i.category))];
  cats.forEach((cat) => {
    const h = document.createElement("h3"); h.textContent = cat; h.style.marginTop = "6px";
    list.appendChild(h);
    menuItemsCache.filter((i) => i.category === cat).forEach((item) => {
      const inTime = isItemInTimeWindow(item);
      const soldOut = !item.available || item.stock <= 0 || !inTime;
      const qty = state.cart[item.id] || 0;
      const div = document.createElement("div");
      div.className = "card food-card" + (soldOut ? " soldout" : "");
      div.innerHTML = `
        <div class="food-emoji">${item.img || "🍴"}</div>
        <div style="flex:1">
          <div class="row"><b>${item.name}</b><b class="mono">₹${item.price}</b></div>
          <div class="muted">${soldOut ? soldOutReason(item, inTime) : "In stock: " + item.stock}</div>
        </div>`;
      if (soldOut) {
        div.innerHTML += `<span class="pill pill-soldout">SOLD OUT</span>`;
      } else {
        const ctrl = document.createElement("div");
        ctrl.className = "qty-control";
        ctrl.innerHTML = `<button onclick="changeQty('${item.id}',-1)">−</button><span class="qty-val">${qty}</span><button onclick="changeQty('${item.id}',1)">+</button>`;
        div.appendChild(ctrl);
      }
      list.appendChild(div);
    });
  });
  const cartCount = Object.values(state.cart).reduce((a, b) => a + b, 0);
  document.getElementById("cartCountPill").textContent = "🛒 " + cartCount;
}
function soldOutReason(item, inTime) {
  if (!inTime) return item.timeSlot === "breakfast" ? "Available during breakfast only" : "Available from lunch onward";
  if (!item.available) return "Currently unavailable";
  return "Sold out";
}
function changeQty(itemId, delta) {
  const item = menuItemsCache.find((i) => i.id === itemId);
  const current = state.cart[itemId] || 0;
  const next = current + delta;
  if (next < 0) return;
  if (next > item.stock) { toast(`Only ${item.stock} left in stock.`); return; }
  if (next === 0) delete state.cart[itemId]; else state.cart[itemId] = next;
  saveSession();
  renderMenu();
}

// ---------- CART ----------
function renderCart() {
  const list = document.getElementById("cartList");
  list.innerHTML = "";
  let total = 0;
  const entries = Object.entries(state.cart);
  if (entries.length === 0) list.innerHTML = `<p class="muted">Your cart is empty.</p>`;
  entries.forEach(([id, qty]) => {
    const item = menuItemsCache.find((i) => i.id === id);
    if (!item) return;
    const sub = item.price * qty;
    total += sub;
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${item.name} × ${qty}</span><b class="mono">₹${sub}</b>`;
    list.appendChild(row);
  });
  document.getElementById("cartTotal").textContent = "₹" + total;
  document.getElementById("placeOrderBtn").disabled = entries.length === 0;
}

// ---------- PLACE ORDER ----------
async function placeOrder() {
  const entries = Object.entries(state.cart);
  if (entries.length === 0) return;
  const items = [];
  let total = 0;
  for (const [id, qty] of entries) {
    const item = menuItemsCache.find((i) => i.id === id);
    if (!item || qty > item.stock) { toast(`${item ? item.name : "An item"} is no longer available in that quantity.`); return; }
    items.push({ id, name: item.name, qty, price: item.price });
    total += item.price * qty;
  }
  const orderId = "ORD-" + Math.floor(1000 + Math.random() * 9000);
  await dbSet("orders", orderId, {
    id: orderId, mobile: state.mobile || "guest", tableNumber: state.tableNumber,
    items, total, status: "NEW", createdAt: Date.now()
  });
  // deduct inventory
  for (const [id, qty] of entries) {
    const item = menuItemsCache.find((i) => i.id === id);
    await dbSet("menuItems", id, { stock: item.stock - qty });
  }
  await dbSet("tables", "table_" + state.tableNumber, { lastActivity: Date.now() });
  state.orderId = orderId; state.cart = {}; saveSession();
  toast("Order placed! #" + orderId);
  go("orderStatus");
}

// ---------- ORDER STATUS ----------
let orderElapsedIntervalId = null;
function listenOrderStatus() {
  if (orderElapsedIntervalId) clearInterval(orderElapsedIntervalId);
  if (!state.orderId) {
    showOrderEmptyState();
    return;
  }
  if (unsubOrder) unsubOrder();
  unsubOrder = dbListenOne("orders", state.orderId, (order) => {
    if (!order || order.status === "COMPLETED") { showOrderEmptyState(); return; }
    renderOrderStatus(order);
    if (order.status === "SERVED") prepareBill(order);
  });
}
function showOrderEmptyState() {
  document.getElementById("orderEmptyState").style.display = "block";
  document.getElementById("orderActiveCard").style.display = "none";
}
const ORDER_STEPS = ["NEW", "ACCEPTED", "PREPARING", "READY", "SERVED"];
function renderOrderStatus(order) {
  document.getElementById("orderEmptyState").style.display = "none";
  document.getElementById("orderActiveCard").style.display = "block";

  const idx = ORDER_STEPS.indexOf(order.status);
  document.querySelectorAll("#orderStepTrack .step").forEach((el, i) => {
    el.classList.toggle("done", i < idx);
    el.classList.toggle("active", i === idx);
  });

  // live elapsed time since the order was placed, ticking every second
  if (orderElapsedIntervalId) clearInterval(orderElapsedIntervalId);
  const tick = () => {
    if (!order.createdAt) { document.getElementById("orderElapsed").textContent = ""; return; }
    const mins = Math.floor((Date.now() - order.createdAt) / 60000);
    const secs = Math.floor(((Date.now() - order.createdAt) % 60000) / 1000);
    document.getElementById("orderElapsed").textContent =
      order.status === "SERVED" ? "Served ✓" : `Placed ${mins}m ${secs}s ago`;
  };
  tick();
  orderElapsedIntervalId = setInterval(tick, 1000);

  const list = document.getElementById("orderStatusList");
  list.innerHTML = `
    <div class="row"><span class="muted">Order ID</span><b class="mono">${order.id}</b></div>
    <div class="row"><span class="muted">Table</span><b>${order.tableNumber}</b></div>
    <hr style="border:none;border-top:1px solid var(--border);margin:2px 0" />
    ${(order.items || []).map((i) => `<div class="row"><span>${i.name} × ${i.qty}</span><span class="mono">₹${i.price * i.qty}</span></div>`).join("")}
    <hr style="border:none;border-top:1px solid var(--border);margin:2px 0" />
    <div class="row"><b>Total</b><b class="mono">₹${order.total}</b></div>
    ${order.status === "SERVED" ? `<button class="btn btn-primary" onclick="go('bill')">View Bill</button>` : `<p class="muted center-text">We'll update this page automatically — no need to refresh.</p>`}
  `;
}

// ---------- BILL ----------
function prepareBill(order) {
  document.getElementById("billTable").textContent = order.tableNumber;
  document.getElementById("billOrderId").textContent = order.id;
  document.getElementById("billItems").innerHTML = (order.items || [])
    .map((i) => `<div class="line"><span>${i.name} × ${i.qty}</span><span>₹${i.price * i.qty}</span></div>`).join("");
  document.getElementById("billTotal").textContent = "₹" + order.total;
  document.getElementById("finalPayAmt").textContent = order.total;
}

// ---------- FINAL PAYMENT (SIMULATED) ----------
async function simulateFinalPayment() {
  document.getElementById("finalPayProcessing").style.display = "block";
  const order = await dbGet("orders", state.orderId);
  const payId = newId("PAY").toUpperCase();
  const now = Date.now();
  setTimeout(async () => {
    await dbSet("payments", payId, { type: "final", orderId: order.id, amount: order.total, status: "PAID", time: now });
    await dbSet("orders", order.id, { status: "COMPLETED", paymentStatus: "PAID", paymentId: payId, paidAt: now });
    document.getElementById("finalPayProcessing").style.display = "none";
    buildReceipt(order, payId, now);
    go("receipt");
  }, 1100);
}
function buildReceipt(order, payId, time) {
  document.getElementById("receiptCard").innerHTML = `
    <div class="line"><b>${CONFIG.restaurantName}</b></div>
    <hr />
    <div class="line"><span>Order ID</span><span>${order.id}</span></div>
    <div class="line"><span>Table</span><span>${order.tableNumber}</span></div>
    <div class="line"><span>Payment ID</span><span>${payId}</span></div>
    <div class="line"><span>Time</span><span>${new Date(time).toLocaleString()}</span></div>
    <hr />
    ${(order.items || []).map((i) => `<div class="line"><span>${i.name} × ${i.qty}</span><span>₹${i.price * i.qty}</span></div>`).join("")}
    <hr />
    <div class="line"><b>TOTAL</b><b>₹${order.total}</b></div>
    <div class="line"><span>Status</span><span>✓ PAID (DEMO)</span></div>
    <p class="center-text" style="margin-top:10px">Thank you for dining with us!</p>
  `;
  window._lastReceipt = { order, payId, time };
}
function sendReceiptWhatsapp() {
  const r = window._lastReceipt;
  if (!r) return;
  const lines = [
    `*${CONFIG.restaurantName}*`, `Order: ${r.order.id}`, `Table: ${r.order.tableNumber}`,
    ...r.order.items.map((i) => `${i.name} x${i.qty} - ₹${i.price * i.qty}`),
    `Total: ₹${r.order.total}`, `Status: PAID (Demo)`, `Thank you for visiting!`
  ];
  const msg = encodeURIComponent(lines.join("\n"));
  window.open(`https://wa.me/${CONFIG.whatsappNumber}?text=${msg}`, "_blank");
}

// ---------- CHECKOUT ----------
async function finishVisit() {
  if (state.tableNumber) await dbSet("tables", "table_" + state.tableNumber, { status: "available", bookingId: null });
  if (state.bookingId) await dbSet("bookings", state.bookingId, { status: "COMPLETED" });
  state = { mobile: state.mobile, tableNumber: null, bookingId: null, orderId: null, cart: {} };
  saveSession();
  go("home", true);
  navHistory = ["home"];
  toast("Table is now free. See you again!");
}

// ---------- MY BOOKING shortcut ----------
async function openMyBooking() {
  if (!state.bookingId) { toast("No active booking. Book a table to get started."); go("map"); return; }
  const booking = await dbGet("bookings", state.bookingId);
  if (!booking || booking.status === "CANCELLED") { toast("Your last booking is no longer active."); go("map"); return; }
  if (booking.status === "CONFIRMED") go("arrival");
  else if (booking.status === "CHECKED_IN") go("tableQr");
  else go("map");
}
