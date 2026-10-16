/* ============================================================
   SmartBite — app.js  (customer app)
   Depends on: firebase-config.js, common.js
   ============================================================ */

// ---------- session (this device only; NOT shared data) ----------
const SESSION_KEY = "smartbite_session";
let state = Object.assign(
  { mobile: null, tableNumber: null, bookingId: null, orderId: null, cart: {} },
  (() => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "{}"); } catch (e) { return {}; } })()
);
function saveSession() { localStorage.setItem(SESSION_KEY, JSON.stringify(state)); }

let navHistory = ["home"];
let menuItemsCache = [], tablesCache = [], ordersCache = [], cooccurrence = {};
let selectedTable = null, pendingScreen = null, lastKnownDistance = null, busy = false;
let arrivalIntervalId = null, arrivalBooking = null, unsubBooking = null, orderElapsedIntervalId = null;

function $(id) { return document.getElementById(id); }
function activeScreen() { const el = document.querySelector(".screen.active"); return el ? el.id.replace("screen-", "") : ""; }
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2800);
}
/** Runs an async action with one shared busy-lock and uniform error handling. */
async function safely(fn) {
  if (busy) return; busy = true;
  try { return await fn(); }
  catch (e) { console.error(e); toast(friendlyError(e)); }
  finally { busy = false; }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- startup ----------
document.addEventListener("DOMContentLoaded", async () => {
  $("dbBadge").textContent = FIREBASE_READY ? "Live Sync" : "Demo (offline)";
  $("dbBadge").classList.toggle("offline", !FIREBASE_READY);
  $("dbBadge").title = FIREBASE_READY ? "Connected to Firebase Firestore" : "Local demo mode: data stays on this device only";
  try { await seedIfNeeded(); } catch (e) { console.error(e); toast(friendlyError(e)); }
  startGlobalListeners();
  if (state.bookingId) expireBookingAtomic(state.bookingId).catch(() => {});
  if (state.mobile) dbGet("users", state.mobile).then((u) => { if (u) toast("Welcome back!"); }).catch(() => {});
  const q = new URLSearchParams(location.search).get("table"); // table QR: index.html?table=8
  if (q && /^\d+$/.test(q)) { $("tableNumberInput").value = q; go("tableQr"); }
});

function startGlobalListeners() {
  listenSettings(() => { if (activeScreen() === "tables" && selectedTable) selectTable(selectedTable); if (activeScreen() === "cart") renderCart(); });
  dbListenAll("tables", (rows) => {
    tablesCache = rows.filter((t) => Number.isInteger(t.number)).sort((a, b) => a.number - b.number);
    if (activeScreen() === "tables") renderTableGrid();
    if (activeScreen() === "map") showRestaurantCard();
  });
  dbListenAll("menuItems", (rows) => {
    menuItemsCache = rows.sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name));
    if (activeScreen() === "menu") renderMenu();
    if (activeScreen() === "cart") renderCart();
  });
  dbListenAll("orders", (rows) => {
    ordersCache = rows;
    if (activeScreen() === "orderStatus") refreshOrderStatus();
    if (activeScreen() === "map") showRestaurantCard();
  });
  dbListenOne("recommendationData", "cooccurrence", (doc) => { cooccurrence = (doc && doc.matrix) || {}; if (activeScreen() === "cart") renderCart(); });
}

// ---------- navigation ----------
const TITLES = {
  home: "SmartBite", map: "Discover", tables: "Book a Table", bookingPay: "Payment", arrival: "Arrival Timer",
  checkin: "Check-In", tableQr: "Scan Table", profile: "Your Profile", menu: "Menu", cart: "Your Cart",
  orderStatus: "Order Status", bill: "My Bill", finalPay: "Payment", receipt: "Receipt", checkout: "Checkout"
};
function go(name, replace) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $("screen-" + name).classList.add("active");
  if (!replace) { if (navHistory[navHistory.length - 1] !== name) navHistory.push(name); }
  else navHistory[navHistory.length - 1] = name;
  $("backBtn").style.visibility = navHistory.length > 1 ? "visible" : "hidden";
  document.querySelectorAll(".bottom-nav button").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
  $("topbarTitle").textContent = TITLES[name] || "SmartBite";
  window.scrollTo(0, 0);

  if (name === "map") initMap();
  if (name === "tables") { renderTableGrid(); if (selectedTable) selectTable(selectedTable); }
  if (name === "menu") openMenuScreen();
  if (name === "cart") renderCart();
  if (name === "orderStatus") refreshOrderStatus();
  if (name === "checkin") $("checkinSuccessCard").style.display = "none";
  if (name === "bookingPay") {
    $("payTableNum").textContent = selectedTable;
    $("payFeeAmt").textContent = SETTINGS.bookingFee; $("payBtnAmt").textContent = SETTINGS.bookingFee;
    $("payProcessing").style.display = "none"; $("paySuccess").style.display = "none"; $("payBtn").style.display = "block";
  }
  if (name === "arrival") startArrivalTimer();
  if (name === "bill") { const o = currentOrder(); if (o) prepareBill(o); }
  if (name === "finalPay") { const o = currentOrder(); if (o) $("finalPayAmt").textContent = o.total; $("finalPayProcessing").style.display = "none"; }
}
function goBack() { if (navHistory.length > 1) { navHistory.pop(); go(navHistory[navHistory.length - 1], true); } }
function currentOrder() { return ordersCache.find((o) => o.id === state.orderId) || null; }

// ---------- map / discovery ----------
let leafletMap = null;
function initMap() {
  showRestaurantCard();
  if (typeof L === "undefined") { $("map").innerHTML = '<p class="muted" style="padding:20px">Map could not load (no internet). The restaurant details below still work.</p>'; return; }
  if (leafletMap) { leafletMap.invalidateSize(); return; }
  leafletMap = L.map("map").setView([CONFIG.restaurantLatitude, CONFIG.restaurantLongitude], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(leafletMap);
  L.marker([CONFIG.restaurantLatitude, CONFIG.restaurantLongitude]).addTo(leafletMap).bindPopup("<b>" + esc(CONFIG.restaurantName) + "</b>").on("click", showRestaurantCard);
}
function showRestaurantCard() {
  $("restaurantCard").style.display = "block";
  $("rName").textContent = CONFIG.restaurantName;
  $("rRating").textContent = "⭐ " + CONFIG.restaurantRating;
  const rush = rushLevel(ordersCache.filter((o) => !DONE_STATES.includes(o.status)).length);
  $("rRush").textContent = rush.label; $("rRush").className = "pill " + rush.cls;
  $("rWait").textContent = "Estimated wait: " + rush.wait;
  const free = tablesCache.filter((t) => t.status === "available").length;
  $("rTablesFree").textContent = "Tables available: " + free + " / " + CONFIG.tableCount;
  if (!showRestaurantCard.qr && typeof QRCode !== "undefined") {
    showRestaurantCard.qr = true;
    new QRCode($("rQr"), { text: location.href.split("#")[0].split("?")[0], width: 110, height: 110 });
  }
}

// ---------- table booking ----------
function renderTableGrid() {
  const grid = $("tableGrid"); grid.innerHTML = "";
  tablesCache.forEach((t) => {
    const btn = document.createElement("button");
    btn.className = "table-chip " + t.status + (selectedTable === t.number ? " selected" : "");
    btn.disabled = t.status !== "available";
    btn.innerHTML = '<span class="num">T' + t.number + "</span><span>" + esc(t.status) + "</span>";
    btn.onclick = () => selectTable(t.number);
    grid.appendChild(btn);
  });
  if (selectedTable) { const t = tablesCache.find((x) => x.number === selectedTable); if (t && t.status !== "available") { selectedTable = null; $("bookingFeeCard").style.display = "none"; } }
}
function selectTable(num) {
  selectedTable = num; renderTableGrid();
  $("bookingFeeCard").style.display = "block";
  $("selTableLabel").textContent = "Table " + num;
  $("feeAmt").textContent = SETTINGS.bookingFee;
}
async function continueToPayment() {
  if (!selectedTable) { toast("Please select a table first."); return; }
  if (state.bookingId) {
    const b = await dbGet("bookings", state.bookingId).catch(() => null);
    if (b && ["CONFIRMED", "CHECKED_IN"].includes(b.status)) { toast("You already have an active booking (Table " + b.tableNumber + ")."); openMyBooking(); return; }
  }
  if (!state.mobile) { pendingScreen = "bookingPay"; go("profile"); return; }
  go("bookingPay");
}

// ---------- booking payment (SIMULATED) ----------
function simulateBookingPayment() {
  safely(async () => {
    $("payBtn").style.display = "none"; $("payProcessing").style.display = "block";
    try {
      const [booking] = await Promise.all([bookTableAtomic(selectedTable, state.mobile), wait(1000)]);
      state.bookingId = booking.id; state.tableNumber = booking.tableNumber; state.orderId = null; state.cart = {}; saveSession();
      $("payProcessing").style.display = "none"; $("paySuccess").style.display = "block";
      $("sumBookingId").textContent = booking.id; $("sumToken").textContent = booking.token; $("sumTable").textContent = "Table " + booking.tableNumber;
    } catch (e) {
      $("payProcessing").style.display = "none"; $("payBtn").style.display = "block";
      if (e.message === "TABLE_TAKEN") { selectedTable = null; go("tables", true); }
      throw e;
    }
  });
}

// ---------- arrival timer ----------
function startArrivalTimer() {
  $("arrTableNum").textContent = state.tableNumber || "—";
  if (!state.bookingId) { $("arrivalTimer").textContent = "--:--"; $("arrivalStatus").textContent = "No active booking."; return; }
  if (arrivalIntervalId) clearInterval(arrivalIntervalId);
  if (unsubBooking) unsubBooking();
  arrivalBooking = null;
  unsubBooking = dbListenOne("bookings", state.bookingId, (b) => { arrivalBooking = b; paintArrival(); });
  arrivalIntervalId = setInterval(paintArrival, 1000); // single interval; reads the latest booking
}
function paintArrival() {
  const b = arrivalBooking;
  if (!b) { $("arrivalTimer").textContent = "--:--"; $("arrivalStatus").textContent = "Loading your booking… If this stays, go Home and book a table again."; return; }
  if (b.status === "CANCELLED") { $("arrivalTimer").textContent = "00:00"; $("arrivalStatus").textContent = "Booking cancelled — the table was released."; clearInterval(arrivalIntervalId); return; }
  if (b.status !== "CONFIRMED") { $("arrivalTimer").textContent = "✓"; $("arrivalStatus").textContent = "You are checked in."; clearInterval(arrivalIntervalId); return; }
  const remaining = b.arrivalDeadline - Date.now();
  if (remaining <= 0) {
    clearInterval(arrivalIntervalId); $("arrivalTimer").textContent = "00:00";
    expireBookingAtomic(b.id).then((done) => { if (done) toast("Your booking window expired."); }).catch((e) => toast(friendlyError(e)));
    return;
  }
  const m = Math.floor(remaining / 60000), s = Math.floor((remaining % 60000) / 1000);
  $("arrivalTimer").textContent = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  $("arrivalStatus").textContent = "Table " + b.tableNumber + " is held for you";
}

// ---------- check-in (Algorithm 1: Haversine geofence) ----------
function checkGeolocation() {
  if (!navigator.geolocation) { toast("Geolocation not supported — use Demo Location."); return; }
  $("distanceText").textContent = "Locating you...";
  navigator.geolocation.getCurrentPosition(
    (pos) => evaluateDistance(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
    () => { toast("Location unavailable. Use Demo Location instead."); $("distanceText").textContent = "Could not get your location."; },
    { timeout: 8000, enableHighAccuracy: true }
  );
}
function useDemoLocation() { evaluateDistance(CONFIG.restaurantLatitude, CONFIG.restaurantLongitude); $("distanceText").textContent += " (DEMO LOCATION)"; }
function evaluateDistance(lat, lng, accuracy) {
  const d = haversineMeters(lat, lng, CONFIG.restaurantLatitude, CONFIG.restaurantLongitude);
  lastKnownDistance = d;
  const within = d <= CONFIG.geofenceRadius;
  $("distanceText").textContent = within ? "✓ You are near the restaurant (" + Math.round(d) + " m)"
    : "You are approximately " + Math.round(d) + " meters away. Move within " + CONFIG.geofenceRadius + " m to check in.";
  if (accuracy && accuracy > 100) $("distanceText").textContent += " (GPS accuracy ±" + Math.round(accuracy) + " m)";
  $("checkinSuccessCard").style.display = within ? "block" : "none";
}
function confirmCheckIn(isDemo) {
  safely(async () => {
    if (!state.bookingId) { toast("No active booking found."); return; }
    if (!isDemo && !(lastKnownDistance != null && lastKnownDistance <= CONFIG.geofenceRadius)) { toast("You are too far from the restaurant. Use location check, or Demo Check-In."); return; }
    await checkInAtomic(state.bookingId, isDemo ? "DEMO" : "GPS");
    clearInterval(arrivalIntervalId);
    toast(isDemo ? "Demo check-in complete ✓" : "Checked in ✓");
    $("tableNumberInput").value = state.tableNumber || "";
    go("tableQr");
  });
}

// ---------- table QR ----------
function demoScanTable() {
  if (!state.tableNumber) { toast("No table assigned yet — book a table first."); return; }
  $("tableNumberInput").value = state.tableNumber; openMenuForTable();
}
async function openMenuForTable() {
  const num = parseInt($("tableNumberInput").value, 10);
  if (!num || num < 1 || num > CONFIG.tableCount) { toast("Enter a valid table number (1-" + CONFIG.tableCount + ")."); return; }
  try {
    const t = await dbGet("tables", "table_" + num);
    if (!t) { toast("Unknown table."); return; }
    if (t.status !== "occupied") { toast("This table isn't checked in yet. Please book and check in first."); return; }
    if (!state.bookingId || t.bookingId !== state.bookingId) { toast("Table " + num + " belongs to a different booking."); return; }
    state.tableNumber = num; saveSession();
    if (!state.mobile) { pendingScreen = "menu"; go("profile"); } else go("menu");
  } catch (e) { toast(friendlyError(e)); }
}

// ---------- profile ----------
function saveProfile() {
  safely(async () => {
    const mobile = $("mobileInput").value.trim();
    if (!/^[6-9]\d{9}$/.test(mobile)) { toast("Enter a valid 10-digit mobile number."); return; }
    state.mobile = mobile; saveSession();
    const existing = await dbGet("users", mobile);
    await dbSet("users", mobile, { mobile, lastVisit: Date.now() });
    toast(existing ? "Welcome back!" : "Welcome to SmartBite!");
    const next = pendingScreen || "menu"; pendingScreen = null; go(next);
  });
}

// ---------- menu + inventory + recommendations ----------
function openMenuScreen() {
  $("menuTableNum").textContent = state.tableNumber || "—";
  renderMenu();
}
function renderMenu() {
  const list = $("menuList"); list.innerHTML = "";
  // Algorithm 2: frequency-based "Recommended for You"
  const fav = favouriteItem(ordersCache, state.mobile);
  const favItem = fav && menuItemsCache.find((i) => i.id === fav.id);
  const rc = $("recommendCard");
  if (favItem) {
    rc.style.display = "block";
    const ok = !itemUnavailableReason(favItem);
    $("recommendItem").innerHTML = esc(favItem.name) + " <span class='muted'>(ordered " + fav.count + "×)</span> " +
      (ok ? "<button class='btn btn-sm btn-primary' onclick=\"changeQty('" + esc(favItem.id) + "',1)\">Order again</button>" : "<span class='pill pill-soldout'>unavailable now</span>");
  } else rc.style.display = "none";

  const cats = [...new Set(menuItemsCache.map((i) => i.category))];
  cats.forEach((cat) => {
    const h = document.createElement("h3"); h.textContent = cat; h.style.marginTop = "6px"; list.appendChild(h);
    menuItemsCache.filter((i) => i.category === cat).forEach((item) => {
      const reason = itemUnavailableReason(item);
      const qty = state.cart[item.id] || 0;
      const div = document.createElement("div");
      div.className = "card food-card" + (reason ? " soldout" : "");
      div.innerHTML = '<div class="food-emoji">' + esc(item.img || "🍴") + '</div><div style="flex:1"><div class="row"><b>' + esc(item.name) +
        '</b><b class="mono">₹' + esc(item.price) + '</b></div><div class="muted">' + (reason ? esc(reason) : "In stock: " + item.stock) + "</div></div>";
      if (reason) div.innerHTML += '<span class="pill pill-soldout">SOLD OUT</span>';
      else {
        const ctrl = document.createElement("div"); ctrl.className = "qty-control";
        ctrl.innerHTML = "<button aria-label='decrease' onclick=\"changeQty('" + esc(item.id) + "',-1)\">−</button><span class='qty-val'>" + qty + "</span><button aria-label='increase' onclick=\"changeQty('" + esc(item.id) + "',1)\">+</button>";
        div.appendChild(ctrl);
      }
      list.appendChild(div);
    });
  });
  $("cartCountPill").textContent = "🛒 " + Object.values(state.cart).reduce((a, b) => a + b, 0);
}
function changeQty(itemId, delta) {
  const item = menuItemsCache.find((i) => i.id === itemId);
  if (!item) return;
  const next = (state.cart[itemId] || 0) + delta;
  if (next < 0) return;
  if (delta > 0 && itemUnavailableReason(item)) { toast(item.name + " is not available right now."); return; }
  if (next > item.stock) { toast("Only " + item.stock + " left in stock."); return; }
  if (next === 0) delete state.cart[itemId]; else state.cart[itemId] = next;
  saveSession();
  if (activeScreen() === "cart") renderCart(); else renderMenu();
}

// ---------- cart (with tax preview + Algorithm 3 suggestions) ----------
function renderCart() {
  const list = $("cartList"); list.innerHTML = "";
  // drop items that disappeared from the menu
  Object.keys(state.cart).forEach((id) => { if (menuItemsCache.length && !menuItemsCache.find((i) => i.id === id)) delete state.cart[id]; });
  let subtotal = 0; const entries = Object.entries(state.cart);
  if (!entries.length) list.innerHTML = '<p class="muted">Your cart is empty.</p>';
  entries.forEach(([id, qty]) => {
    const item = menuItemsCache.find((i) => i.id === id); if (!item) return;
    const unavailable = itemUnavailableReason(item);
    subtotal += item.price * qty;
    const row = document.createElement("div"); row.className = "row";
    row.innerHTML = "<span>" + esc(item.name) + " × " + qty + (unavailable ? " <span class='pill pill-soldout'>" + esc(unavailable) + "</span>" : "") + "</span>" +
      "<span class='qty-control'><button onclick=\"changeQty('" + esc(id) + "',-1)\">−</button><button onclick=\"changeQty('" + esc(id) + "',1)\">+</button><b class='mono'>₹" + item.price * qty + "</b></span>";
    list.appendChild(row);
  });
  const bill = computeBill(subtotal, SETTINGS.taxPercent);
  $("cartSubtotal").textContent = money(bill.subtotal);
  $("cartTaxLabel").textContent = "GST (" + bill.taxPercent + "%)";
  $("cartTax").textContent = money(bill.taxAmount);
  $("cartTotal").textContent = money(bill.total);
  $("placeOrderBtn").disabled = !entries.length;
  // Algorithm 3: item-based collaborative filtering — O(1) lookup in the precomputed matrix
  const box = $("cartSuggest");
  const sug = complementaryFor(Object.keys(state.cart), cooccurrence, menuItemsCache);
  box.innerHTML = sug.length ? "<h3>Goes well with</h3>" + sug.map((s) =>
    "<div class='row' style='margin-top:6px'><span>" + esc(s.img) + " " + esc(s.name) + " · ₹" + s.price + "</span><button class='btn btn-sm btn-ghost' onclick=\"changeQty('" + esc(s.id) + "',1)\">+ Add</button></div>").join("") : "";
  box.style.display = sug.length ? "block" : "none";
}

// ---------- place order (atomic, server-priced) ----------
function placeOrder() {
  safely(async () => {
    const existing = currentOrder();
    if (existing && !["COMPLETED", "CANCELLED"].includes(existing.status)) throw new Error("ORDER_ACTIVE");
    $("placeOrderBtn").disabled = true;
    try {
      const order = await placeOrderAtomic(state.cart, state.tableNumber, state.mobile, state.bookingId);
      state.orderId = order.id; state.cart = {}; saveSession();
      ordersCache = ordersCache.filter((o) => o.id !== order.id).concat(order);
      toast("Order placed! " + order.id);
      go("orderStatus");
    } finally { $("placeOrderBtn").disabled = false; }
  });
}

// ---------- order status (live) + Algorithm 4 ETA ----------
const ORDER_STEPS = ["NEW", "ACCEPTED", "PREPARING", "READY", "SERVED"];
function showOrderEmptyState(msg) {
  $("orderEmptyState").style.display = "block"; $("orderActiveCard").style.display = "none";
  $("orderEmptyMsg").textContent = msg || "Your placed orders will appear here.";
  $("orderEmptyTitle").textContent = msg ? "Order update" : "No active orders";
}
function refreshOrderStatus() {
  if (orderElapsedIntervalId) clearInterval(orderElapsedIntervalId);
  const order = currentOrder();
  if (!state.orderId || !order) return showOrderEmptyState();
  if (order.status === "CANCELLED") { state.orderId = null; saveSession(); return showOrderEmptyState("Your order was cancelled by the restaurant. Stock was released; nothing was charged."); }
  if (order.status === "COMPLETED") return showOrderEmptyState("Your order is complete and paid. Thank you!");
  renderOrderStatus(order);
  if (order.status === "SERVED") prepareBill(order);
}
function renderOrderStatus(order) {
  $("orderEmptyState").style.display = "none"; $("orderActiveCard").style.display = "block";
  const idx = ORDER_STEPS.indexOf(order.status);
  document.querySelectorAll("#orderStepTrack .step").forEach((el, i) => { el.classList.toggle("done", i < idx); el.classList.toggle("active", i === idx); });
  const tick = () => {
    const sec = Math.max(0, Math.floor((Date.now() - (order.createdAt || Date.now())) / 1000));
    $("orderElapsed").textContent = order.status === "SERVED" ? "Served ✓" : "Placed " + Math.floor(sec / 60) + "m " + (sec % 60) + "s ago";
  };
  tick(); orderElapsedIntervalId = setInterval(tick, 1000);
  const eta = etaMinutes(order, ordersCache);
  const etaText = order.status === "SERVED" ? "Enjoy your meal!" : order.status === "READY" ? "Your food is ready — it's on its way to you." :
    "Estimated preparation time: about " + eta + " min (estimate, depends on kitchen load)";
  $("orderStatusList").innerHTML =
    '<p class="center-text"><b>' + esc(etaText) + "</b></p>" +
    '<div class="row"><span class="muted">Order ID</span><b class="mono">' + esc(order.id) + "</b></div>" +
    '<div class="row"><span class="muted">Table</span><b>' + esc(order.tableNumber) + "</b></div>" +
    '<hr style="border:none;border-top:1px solid var(--border);margin:2px 0" />' +
    (order.items || []).map((i) => '<div class="row"><span>' + esc(i.name) + " × " + i.qty + '</span><span class="mono">₹' + i.price * i.qty + "</span></div>").join("") +
    '<hr style="border:none;border-top:1px solid var(--border);margin:2px 0" />' +
    '<div class="row"><span class="muted">Subtotal</span><span class="mono">' + money(order.subtotal != null ? order.subtotal : order.total) + "</span></div>" +
    '<div class="row"><span class="muted">GST (' + (order.taxPercent || 0) + '%)</span><span class="mono">' + money(order.taxAmount || 0) + "</span></div>" +
    '<div class="row"><b>Total</b><b class="mono">' + money(order.total) + "</b></div>" +
    (order.status === "SERVED" ? "<button class='btn btn-primary' onclick=\"go('bill')\">View Bill</button>" : "<p class='muted center-text'>This page updates automatically — no refresh needed.</p>");
}

// ---------- bill / final payment (SIMULATED) / receipt ----------
function prepareBill(order) {
  $("billTable").textContent = order.tableNumber; $("billOrderId").textContent = order.id;
  $("billItems").innerHTML = (order.items || []).map((i) => '<div class="line"><span>' + esc(i.name) + " × " + i.qty + "</span><span>₹" + i.price * i.qty + "</span></div>").join("");
  $("billSubtotal").textContent = money(order.subtotal != null ? order.subtotal : order.total);
  $("billTaxLabel").textContent = "GST (" + (order.taxPercent || 0) + "%)";
  $("billTax").textContent = money(order.taxAmount || 0);
  $("billTotal").textContent = money(order.total);
  $("finalPayAmt").textContent = order.total;
}
function simulateFinalPayment() {
  safely(async () => {
    const o = currentOrder();
    if (!o) throw new Error("ITEM:No order to pay for.");
    $("finalPayProcessing").style.display = "block";
    try {
      const [paid] = await Promise.all([payOrderAtomic(o.id), wait(1000)]);
      buildReceipt(paid);
      go("receipt");
    } finally { $("finalPayProcessing").style.display = "none"; }
  });
}
function buildReceipt(order) {
  $("receiptCard").innerHTML =
    '<div class="line"><b>' + esc(CONFIG.restaurantName) + "</b></div><hr />" +
    '<div class="line"><span>Order ID</span><span>' + esc(order.id) + "</span></div>" +
    '<div class="line"><span>Table</span><span>' + esc(order.tableNumber) + "</span></div>" +
    '<div class="line"><span>Payment ID</span><span>' + esc(order.paymentId) + "</span></div>" +
    '<div class="line"><span>Time</span><span>' + new Date(order.paidAt || Date.now()).toLocaleString() + "</span></div><hr />" +
    (order.items || []).map((i) => '<div class="line"><span>' + esc(i.name) + " × " + i.qty + "</span><span>₹" + i.price * i.qty + "</span></div>").join("") + "<hr />" +
    '<div class="line"><span>Subtotal</span><span>' + money(order.subtotal != null ? order.subtotal : order.total) + "</span></div>" +
    '<div class="line"><span>GST (' + (order.taxPercent || 0) + "%)</span><span>" + money(order.taxAmount || 0) + "</span></div>" +
    '<div class="line"><b>TOTAL</b><b>' + money(order.total) + "</b></div>" +
    '<div class="line"><span>Status</span><span>✓ PAID (DEMO — simulated)</span></div>' +
    '<p class="center-text" style="margin-top:10px">Thank you for dining with us!</p>';
  window._lastReceipt = order;
}
function printReceipt() {
  document.body.classList.add("print-receipt");
  window.addEventListener("afterprint", () => document.body.classList.remove("print-receipt"), { once: true });
  window.print();
}
function sendReceiptWhatsapp() {
  const o = window._lastReceipt || currentOrder();
  if (!o) { toast("No receipt to send yet."); return; }
  const lines = ["*" + CONFIG.restaurantName + "*", "Order: " + o.id, "Table: " + o.tableNumber,
    ...(o.items || []).map((i) => i.name + " x" + i.qty + " - ₹" + i.price * i.qty),
    "Subtotal: " + money(o.subtotal != null ? o.subtotal : o.total), "GST (" + (o.taxPercent || 0) + "%): " + money(o.taxAmount || 0),
    "Total: " + money(o.total), "Status: PAID (Demo)", "Thank you for visiting!"];
  const target = /^[6-9]\d{9}$/.test(state.mobile || "") ? "91" + state.mobile : CONFIG.whatsappNumber;
  window.open("https://wa.me/" + target + "?text=" + encodeURIComponent(lines.join("\n")), "_blank"); // opens WhatsApp with the text pre-filled; user must press send
}

// ---------- checkout ----------
function finishVisit() {
  safely(async () => {
    const o = currentOrder();
    if (o && o.status !== "COMPLETED" && o.status !== "CANCELLED") { toast("Please pay your bill before finishing the visit."); return; }
    if (state.bookingId || state.tableNumber) await checkoutAtomic(state.bookingId, state.tableNumber);
    state = { mobile: state.mobile, tableNumber: null, bookingId: null, orderId: null, cart: {} };
    saveSession(); selectedTable = null; window._lastReceipt = null;
    navHistory = ["home"]; go("home", true);
    toast("Table is now free. See you again!");
  });
}

// ---------- my booking shortcut ----------
async function openMyBooking() {
  try {
    if (!state.bookingId) { toast("No active booking. Book a table to get started."); go("map"); return; }
    const b = await dbGet("bookings", state.bookingId);
    if (!b || ["CANCELLED", "COMPLETED"].includes(b.status)) { toast("Your last booking is no longer active."); go("map"); return; }
    if (b.status === "CONFIRMED") go("arrival");
    else if (currentOrder()) go("orderStatus");
    else go("tableQr");
  } catch (e) { toast(friendlyError(e)); }
}
