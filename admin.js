/* ============================================================
   SmartBite — admin.js  (staff / kitchen dashboard)
   Depends on: firebase-config.js, common.js
   All buttons use data-act attributes + one delegated click handler
   (safe against odd characters in IDs).
   ============================================================ */

let tablesCache = [], ordersCache = [], menuCache = [], paymentsCache = [], bookingsCache = [];
let started = false;

function $(id) { return document.getElementById(id); }
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}
async function safely(fn) { try { return await fn(); } catch (e) { console.error(e); toast(friendlyError(e)); } }

// ---------- PIN gate (demo-level; real access control needs Firebase Auth — see README) ----------
document.addEventListener("DOMContentLoaded", () => {
  if (sessionStorage.getItem("smartbite_admin_ok") === "1") return unlock();
  const tryPin = () => {
    if ($("pinInput").value === CONFIG.adminPin) { sessionStorage.setItem("smartbite_admin_ok", "1"); unlock(); }
    else { $("pinMsg").textContent = "Wrong PIN."; $("pinInput").value = ""; }
  };
  $("pinBtn").onclick = tryPin;
  $("pinInput").addEventListener("keydown", (e) => { if (e.key === "Enter") tryPin(); });
  $("pinInput").focus();
});
function unlock() { $("gate").style.display = "none"; $("adminShell").style.display = "flex"; if (!started) { started = true; startAdmin(); } }

async function startAdmin() {
  $("adminDbBadge").textContent = FIREBASE_READY ? "Live Sync" : "Demo (offline)";
  $("adminDbBadge").classList.toggle("offline", !FIREBASE_READY);
  try { await seedIfNeeded(); } catch (e) { console.error(e); toast(friendlyError(e)); }

  listenSettings(() => { fillSettingsForm(false); checkIdleTables(); });
  dbListenAll("tables", (r) => { tablesCache = r.sort((a, b) => a.number - b.number); renderTables(); renderDashboard(); checkIdleTables(); });
  dbListenAll("orders", (r) => { ordersCache = r.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); renderOrders(); renderDashboard(); renderReports(); });
  dbListenAll("menuItems", (r) => { menuCache = r.sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name)); renderInventory(); renderMenuEditor(); });
  dbListenAll("payments", (r) => { paymentsCache = r.sort((a, b) => (b.time || 0) - (a.time || 0)); renderPayments(); renderDashboard(); renderReports(); });
  dbListenAll("bookings", (r) => { bookingsCache = r.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); renderBookings(); sweepExpiredBookings(); });
  fillSettingsForm(true);

  setInterval(() => { checkIdleTables(); sweepExpiredBookings(); }, 15000);
  $("reportRange").onchange = renderReports;
  $("showDone").onchange = renderOrders;
  document.querySelectorAll(".admin-sidebar button[data-panel]").forEach((b) => b.addEventListener("click", () => showPanel(b.dataset.panel)));
}

function showPanel(name) {
  document.querySelectorAll(".admin-panel").forEach((p) => p.classList.remove("active"));
  $("panel-" + name).classList.add("active");
  document.querySelectorAll(".admin-sidebar button[data-panel]").forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
}

// ---------- delegated click handling ----------
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]"); if (!el || el.disabled) return;
  const id = el.dataset.id, act = el.dataset.act;
  const map = {
    orderStatus: () => safely(async () => { const ok = await setOrderStatusAtomic(id, el.dataset.status); toast(ok ? id + " → " + el.dataset.status : "Order already at or past that step."); }),
    cancelOrder: () => { if (confirm("Reject/cancel " + id + "? Stock will be returned.")) safely(async () => { await cancelOrderAtomic(id); toast(id + " cancelled, stock restored."); }); },
    resetTable: () => { if (confirm("Reset table " + id + "? Any active booking on it will be cancelled.")) safely(async () => { await resetTableAtomic(+id); toast("Table " + id + " reset."); }); },
    stock: () => safely(() => adjustStockAtomic(id, +el.dataset.delta)),
    toggle: () => safely(async () => { const it = menuCache.find((i) => i.id === id); await dbSet("menuItems", id, { available: !it.available }); toast(it.name + " is now " + (!it.available ? "AVAILABLE" : "UNAVAILABLE")); }),
    saveItem: () => saveMenuRow(id),
    deleteItem: () => { const it = menuCache.find((i) => i.id === id); if (confirm("Delete " + (it ? it.name : id) + " from the menu? (Past orders keep their own copy.)")) safely(async () => { await dbDelete("menuItems", id); toast("Item deleted."); }); },
    addItem: addMenuItem,
    cancelBooking: () => { if (confirm("Cancel booking " + id + " and free its table?")) safely(async () => { const ok = await cancelBookingAtomic(id, "Cancelled by staff"); toast(ok ? "Booking cancelled." : "Booking was not active."); }); },
    showQrs: showQrs, printQrs: () => window.print(),
    saveSettings: saveSettings, rebuildRec: rebuildRecommendations, exportCsv: exportCsv
  };
  if (map[act]) map[act]();
});

// ---------- dashboard ----------
function renderDashboard() {
  const active = ordersCache.filter((o) => !DONE_STATES.includes(o.status)).length;
  $("statTotalTables").textContent = tablesCache.length;
  $("statAvailTables").textContent = tablesCache.filter((t) => t.status === "available").length;
  $("statOccTables").textContent = tablesCache.filter((t) => t.status === "occupied").length;
  $("statActiveOrders").textContent = active;
  $("statRevenue").textContent = money(paymentsCache.reduce((s, p) => s + (p.amount || 0), 0));
  const r = rushLevel(active); $("dashRush").textContent = r.label + " · wait " + r.wait; $("dashRush").className = "pill " + r.cls;
}
function checkIdleTables() {
  const now = Date.now(), limit = SETTINGS.idleTableMinutes * 60000;
  const alerts = tablesCache.filter((t) => t.status === "occupied" && t.lastActivity && now - t.lastActivity > limit);
  $("idleAlerts").innerHTML = alerts.map((t) => '<div class="card" style="border-color:var(--chili);margin-bottom:10px">⚠ Table ' + t.number +
    " has been occupied for " + Math.floor((now - t.lastActivity) / 60000) + " minutes without an order or activity. " +
    '<button class="btn btn-danger btn-sm" style="margin-left:10px" data-act="resetTable" data-id="' + t.number + '">Reset Table</button></div>').join("");
}
function sweepExpiredBookings() { // staff-side safety net so unattended bookings still expire
  bookingsCache.filter((b) => b.status === "CONFIRMED" && Date.now() > b.arrivalDeadline).forEach((b) => expireBookingAtomic(b.id).catch(() => {}));
}

// ---------- tables ----------
async function resetTableAtomic(num) {
  return runTx(async (tx) => {
    const t = await tx.get("tables", "table_" + num);
    const b = t && t.bookingId ? await tx.get("bookings", t.bookingId) : null;
    tx.set("tables", "table_" + num, { status: "available", bookingId: null, lastActivity: Date.now() });
    if (b && ["CONFIRMED", "CHECKED_IN"].includes(b.status)) tx.set("bookings", b.id, { status: "CANCELLED", cancelledAt: Date.now(), cancelReason: "Table reset by staff" });
  });
}
function renderTables() {
  const grid = $("adminTableGrid"); grid.innerHTML = "";
  const orderByTable = {};
  ordersCache.filter((o) => !["COMPLETED", "CANCELLED"].includes(o.status)).forEach((o) => { orderByTable[o.tableNumber] = o; });
  tablesCache.forEach((t) => {
    const o = orderByTable[t.number];
    let extra = "";
    if (o) extra = o.status === "SERVED" ? '<div class="pill pill-reserved" style="margin-top:4px">Bill pending</div>' : '<div class="pill pill-reserved" style="margin-top:4px">Order ' + esc(o.status) + "</div>";
    const div = document.createElement("div"); div.className = "admin-table-card";
    div.innerHTML = '<div class="mono" style="font-weight:700;font-size:1.1rem">T' + t.number + '</div><span class="pill pill-' + esc(t.status) + '">' + esc(t.status) + "</span>" + extra +
      '<div style="margin-top:8px"><select data-table="' + t.number + '" style="padding:6px;font-size:.8rem">' +
      ["available", "reserved", "occupied", "cleaning"].map((s) => '<option value="' + s + '"' + (s === t.status ? " selected" : "") + ">" + s + "</option>").join("") +
      '</select></div><div style="margin-top:6px"><button class="btn btn-ghost btn-sm" data-act="resetTable" data-id="' + t.number + '">Reset</button></div>';
    grid.appendChild(div);
  });
  grid.querySelectorAll("select[data-table]").forEach((sel) => sel.onchange = () => safely(async () => {
    const st = sel.value; const patch = { status: st, lastActivity: Date.now() }; if (st === "available" || st === "cleaning") patch.bookingId = null;
    await dbSet("tables", "table_" + sel.dataset.table, patch); toast("Table " + sel.dataset.table + " → " + st);
  }));
}
function showQrs() {
  $("qrSection").style.display = "block"; const grid = $("qrGrid"); grid.innerHTML = "";
  if (typeof QRCode === "undefined") { grid.innerHTML = '<p class="muted">QR library could not load (offline).</p>'; return; }
  const base = location.href.split("?")[0].replace(/admin\.html.*$/, "") + "index.html";
  for (let i = 1; i <= CONFIG.tableCount; i++) {
    const cell = document.createElement("div"); cell.className = "qr-cell";
    const box = document.createElement("div"); cell.appendChild(box);
    cell.appendChild(document.createTextNode("TABLE-" + String(i).padStart(2, "0")));
    grid.appendChild(cell);
    new QRCode(box, { text: base + "?table=" + i, width: 120, height: 120 });
  }
}

// ---------- orders / kitchen ----------
const STAGE_BTNS = [["ACCEPTED", "✓ Accept"], ["PREPARING", "👨‍🍳 Preparing"], ["READY", "🔔 Ready"], ["SERVED", "🍽 Served"]];
function renderOrders() {
  const showDone = $("showDone").checked;
  const live = ordersCache.filter((o) => showDone || !["COMPLETED", "CANCELLED"].includes(o.status));
  const box = $("kitchenOrders"); box.innerHTML = live.length ? "" : '<p class="muted">No active orders.</p>';
  live.forEach((o) => {
    const idx = ORDER_FLOW.indexOf(o.status), closed = ["COMPLETED", "CANCELLED"].includes(o.status);
    const btns = closed ? "" : STAGE_BTNS.map(([st, label]) => {
      const reached = ORDER_FLOW.indexOf(st) <= idx;
      return '<button class="btn btn-sm ' + (reached ? "btn-ghost" : "btn-primary") + '"' + (reached ? " disabled" : "") + ' data-act="orderStatus" data-id="' + esc(o.id) + '" data-status="' + st + '">' + label + "</button>";
    }).join("") + (["NEW", "ACCEPTED"].includes(o.status) ? '<button class="btn btn-sm btn-danger" data-act="cancelOrder" data-id="' + esc(o.id) + '">✕ Reject</button>' : "");
    const div = document.createElement("div"); div.className = "order-card";
    div.innerHTML = '<div class="row"><b class="mono">' + esc(o.id) + '</b><span class="pill pill-' + (o.status === "READY" ? "available" : o.status === "CANCELLED" ? "cancelled" : "reserved") + '">' + esc(o.status) + "</span></div>" +
      '<div class="muted">Table ' + esc(o.tableNumber) + " · " + esc(o.mobile) + " · " + new Date(o.createdAt).toLocaleTimeString() + "</div>" +
      '<div class="order-items">' + (o.items || []).map((i) => esc(i.name) + " × " + i.qty).join(", ") + "</div>" +
      '<div class="row"><span class="muted">Subtotal ' + money(o.subtotal != null ? o.subtotal : o.total) + " + GST " + money(o.taxAmount || 0) + '</span><b class="mono">Total ' + money(o.total) + "</b></div>" +
      (o.paymentStatus === "PAID" ? '<span class="pill pill-paid">✓ PAID</span>' : '<span class="pill pill-reserved">UNPAID</span>') +
      '<div class="status-btns">' + btns + "</div>";
    box.appendChild(div);
  });
}

// ---------- inventory ----------
async function adjustStockAtomic(id, delta) { // read-modify-write inside a transaction so it can't clash with customer orders
  return runTx(async (tx) => { const it = await tx.get("menuItems", id); if (!it) return; tx.set("menuItems", id, { stock: Math.max(0, (it.stock || 0) + delta) }); });
}
function renderInventory() {
  const box = $("inventoryList"); box.innerHTML = "";
  menuCache.forEach((it) => {
    const row = document.createElement("div"); row.className = "inv-row";
    const reason = itemUnavailableReason(it);
    row.innerHTML = "<div><b>" + esc(it.img || "") + " " + esc(it.name) + '</b><div class="muted">' + esc(it.category) + (reason ? " · " + esc(reason) : "") + "</div></div>" +
      '<div class="mono">' + it.stock + "</div>" +
      '<div><button class="btn btn-ghost btn-sm" data-act="stock" data-id="' + esc(it.id) + '" data-delta="-1">−</button> <button class="btn btn-ghost btn-sm" data-act="stock" data-id="' + esc(it.id) + '" data-delta="1">+</button> <button class="btn btn-ghost btn-sm" data-act="stock" data-id="' + esc(it.id) + '" data-delta="5">+5</button></div>' +
      '<div><button class="btn ' + (it.available ? "btn-success" : "btn-danger") + ' btn-sm" data-act="toggle" data-id="' + esc(it.id) + '">' + (it.available ? "AVAILABLE" : "UNAVAILABLE") + "</button></div>" +
      '<div class="muted">' + esc(it.timeSlot) + "</div>";
    box.appendChild(row);
  });
}

// ---------- menu management ----------
function validItem(f) {
  if (!f.name || f.name.length > 40) return "Name is required (max 40 characters).";
  if (!Number.isInteger(f.price) || f.price < 1 || f.price > 10000) return "Price must be a whole number between 1 and 10000.";
  if (!f.category) return "Category is required.";
  if (!Number.isInteger(f.stock) || f.stock < 0 || f.stock > 100000) return "Stock must be 0 or more.";
  if (!Number.isInteger(f.prepMinutes) || f.prepMinutes < 1 || f.prepMinutes > 120) return "Prep minutes must be between 1 and 120.";
  return null;
}
function addMenuItem() {
  const f = { name: $("newName").value.trim(), price: parseInt($("newPrice").value, 10), category: $("newCategory").value.trim(),
    stock: parseInt($("newStock").value, 10), timeSlot: $("newSlot").value, prepMinutes: parseInt($("newPrep").value, 10) || 5, img: $("newEmoji").value.trim() || "🍽️" };
  const err = validItem(f); if (err) return toast(err);
  let id = f.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "item";
  if (menuCache.some((m) => m.id === id)) id += "_" + Date.now().toString(36).slice(-4);
  safely(async () => {
    await dbSet("menuItems", id, { id, ...f, available: true });
    ["newName", "newPrice", "newCategory", "newStock", "newPrep", "newEmoji"].forEach((k) => ($(k).value = ""));
    toast(f.name + " added.");
  });
}
function renderMenuEditor() {
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest("#menuEditor")) return; // don't wipe fields while typing
  const box = $("menuEditor"); box.innerHTML = '<div class="menu-row muted"><div>Emoji</div><div>Name</div><div>Price</div><div>Category</div><div>Stock</div><div>Slot</div><div>Prep min</div><div></div></div>';
  menuCache.forEach((it) => {
    const row = document.createElement("div"); row.className = "menu-row"; row.dataset.row = it.id;
    row.innerHTML = '<input data-f="img" value="' + esc(it.img) + '" maxlength="4" /><input data-f="name" value="' + esc(it.name) + '" /><input data-f="price" type="number" value="' + esc(it.price) + '" />' +
      '<input data-f="category" value="' + esc(it.category) + '" /><input data-f="stock" type="number" value="' + esc(it.stock) + '" />' +
      '<select data-f="timeSlot">' + ["all", "breakfast", "lunch"].map((s) => '<option value="' + s + '"' + (s === it.timeSlot ? " selected" : "") + ">" + s + "</option>").join("") + "</select>" +
      '<input data-f="prepMinutes" type="number" value="' + esc(it.prepMinutes || 5) + '" />' +
      '<span><button class="btn btn-primary btn-sm" data-act="saveItem" data-id="' + esc(it.id) + '">Save</button> <button class="btn btn-danger btn-sm" data-act="deleteItem" data-id="' + esc(it.id) + '">Delete</button></span>';
    box.appendChild(row);
  });
}
function saveMenuRow(id) {
  const row = document.querySelector('[data-row="' + CSS.escape(id) + '"]'); if (!row) return;
  const g = (k) => row.querySelector('[data-f="' + k + '"]').value;
  const f = { img: g("img").trim() || "🍽️", name: g("name").trim(), price: parseInt(g("price"), 10), category: g("category").trim(), stock: parseInt(g("stock"), 10), timeSlot: g("timeSlot"), prepMinutes: parseInt(g("prepMinutes"), 10) };
  const err = validItem(f); if (err) return toast(err);
  safely(async () => { await dbSet("menuItems", id, f); toast(f.name + " saved."); });
}

// ---------- payments ----------
function renderPayments() {
  const booking = paymentsCache.filter((p) => p.type === "booking"), fin = paymentsCache.filter((p) => p.type === "final");
  const sum = (a) => a.reduce((s, p) => s + (p.amount || 0), 0);
  const paidIds = new Set(fin.map((p) => p.orderId));
  const pending = ordersCache.filter((o) => !paidIds.has(o.id) && o.status !== "CANCELLED");
  $("paySummary").innerHTML = [["Booking fees", money(sum(booking))], ["Food bills paid", money(sum(fin))], ["Tax collected", money(fin.reduce((s, p) => s + (p.taxAmount || 0), 0))], ["Pending bills", pending.length + " · " + money(pending.reduce((s, o) => s + o.total, 0))]]
    .map(([k, v]) => '<div class="stat-card"><div class="muted">' + k + '</div><div class="num" style="font-size:1.3rem">' + v + "</div></div>").join("");
  const box = $("paymentsList"); box.innerHTML = paymentsCache.length ? "" : '<p class="muted">No payments yet.</p>';
  paymentsCache.forEach((p) => {
    const d = document.createElement("div"); d.className = "order-card";
    d.innerHTML = '<div class="row"><b>' + (p.type === "booking" ? "Booking Fee" : "Order Payment") + '</b><span class="pill pill-paid">✓ ' + esc(p.status) + " (DEMO)</span></div>" +
      '<div class="muted">' + esc(p.bookingId || p.orderId || "") + " · " + esc(p.id || "") + " · " + new Date(p.time).toLocaleString() + "</div>" +
      '<div class="row"><span class="muted">Amount</span><b class="mono">' + money(p.amount) + "</b></div>";
    box.appendChild(d);
  });
}

// ---------- bookings ----------
function renderBookings() {
  const c = (s) => bookingsCache.filter((b) => s.includes(b.status)).length;
  $("bookSummary").innerHTML = [["Active (awaiting arrival)", c(["CONFIRMED"])], ["Checked in", c(["CHECKED_IN"])], ["Completed", c(["COMPLETED"])], ["Cancelled", c(["CANCELLED"])]]
    .map(([k, v]) => '<div class="stat-card"><div class="muted">' + k + '</div><div class="num">' + v + "</div></div>").join("");
  const box = $("bookingsList"); box.innerHTML = bookingsCache.length ? "" : '<p class="muted">No bookings yet.</p>';
  bookingsCache.forEach((b) => {
    const d = document.createElement("div"); d.className = "order-card";
    const cls = b.status === "CANCELLED" ? "cancelled" : b.status === "CONFIRMED" ? "reserved" : "paid";
    d.innerHTML = '<div class="row"><b class="mono">' + esc(b.id) + '</b><span class="pill pill-' + cls + '">' + esc(b.status) + "</span></div>" +
      '<div class="muted">Table ' + esc(b.tableNumber) + " · Token " + esc(b.token) + " · " + esc(b.mobile) + " · Fee " + money(b.bookingFee || 0) + " (" + esc(b.paymentStatus || "") + ")</div>" +
      '<div class="muted">Booked ' + new Date(b.createdAt).toLocaleString() + (b.status === "CONFIRMED" ? " · arrive by " + new Date(b.arrivalDeadline).toLocaleTimeString() : "") + (b.cancelReason ? " · " + esc(b.cancelReason) : "") + "</div>" +
      (["CONFIRMED", "CHECKED_IN"].includes(b.status) ? '<div class="status-btns"><button class="btn btn-sm btn-danger" data-act="cancelBooking" data-id="' + esc(b.id) + '">Cancel booking</button></div>' : "");
    box.appendChild(d);
  });
}

// ---------- reports ----------
function inRange(ts) {
  if ($("reportRange").value === "all") return true;
  const d = new Date(); d.setHours(0, 0, 0, 0); return (ts || 0) >= d.getTime();
}
function renderReports() {
  const paid = ordersCache.filter((o) => o.status === "COMPLETED" && inRange(o.paidAt || o.createdAt));
  const fin = paymentsCache.filter((p) => p.type === "final" && inRange(p.time)), book = paymentsCache.filter((p) => p.type === "booking" && inRange(p.time));
  const sum = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0);
  const kpis = [["Paid orders", paid.length], ["Food revenue (incl. tax)", money(sum(fin, "amount"))], ["Tax collected", money(sum(fin, "taxAmount"))], ["Booking fees", money(sum(book, "amount"))], ["Avg order value", paid.length ? money(sum(fin, "amount") / paid.length) : "—"]];
  $("reportKpis").innerHTML = kpis.map(([k, v]) => '<div class="stat-card"><div class="muted">' + k + '</div><div class="num" style="font-size:1.3rem">' + v + "</div></div>").join("");
  const items = {};
  paid.forEach((o) => (o.items || []).forEach((i) => { items[i.name] = items[i.name] || { qty: 0, rev: 0 }; items[i.name].qty += i.qty; items[i.name].rev += i.qty * i.price; }));
  const top = Object.entries(items).sort((a, b) => b[1].qty - a[1].qty).slice(0, 8);
  $("topItems").innerHTML = top.length ? top.map(([n, v]) => '<div class="kv-row"><span>' + esc(n) + "</span><span>" + v.qty + " sold · " + money(v.rev) + "</span></div>").join("") : '<p class="muted">No completed orders in this range yet.</p>';
  const st = {}; ordersCache.filter((o) => inRange(o.createdAt)).forEach((o) => { st[o.status] = (st[o.status] || 0) + 1; });
  $("statusBreak").innerHTML = Object.keys(st).length ? Object.entries(st).map(([k, v]) => '<div class="kv-row"><span>' + esc(k) + "</span><span>" + v + "</span></div>").join("") : '<p class="muted">No orders in this range.</p>';
}
async function rebuildRecommendations() {
  return safely(async () => {
    const matrix = buildCooccurrence(ordersCache);
    await dbSet("recommendationData", "cooccurrence", { matrix, updatedAt: Date.now(), basedOnOrders: ordersCache.filter((o) => o.status === "COMPLETED").length });
    $("recMsg").textContent = "Built suggestions for " + Object.keys(matrix).length + " items from " + ordersCache.filter((o) => o.status === "COMPLETED").length + " completed orders.";
    toast("Recommendations rebuilt.");
  });
}
function exportCsv() {
  const rows = [["order_id", "table", "mobile", "status", "subtotal", "tax", "total", "payment", "created"]];
  ordersCache.forEach((o) => rows.push([o.id, o.tableNumber, o.mobile, o.status, o.subtotal != null ? o.subtotal : o.total, o.taxAmount || 0, o.total, o.paymentStatus || "", new Date(o.createdAt).toISOString()]));
  const csv = rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "smartbite-orders.csv"; a.click();
}

// ---------- settings ----------
function fillSettingsForm(force) {
  if (!force && document.activeElement && document.activeElement.id && document.activeElement.id.startsWith("set")) return;
  $("setFee").value = SETTINGS.bookingFee; $("setTax").value = SETTINGS.taxPercent; $("setIdle").value = SETTINGS.idleTableMinutes; $("setArrival").value = SETTINGS.arrivalTimeMinutes;
}
function saveSettings() {
  const s = { bookingFee: parseFloat($("setFee").value), taxPercent: parseFloat($("setTax").value), idleTableMinutes: parseInt($("setIdle").value, 10), arrivalTimeMinutes: parseInt($("setArrival").value, 10) };
  const bad = (v, lo, hi) => !isFinite(v) || v < lo || v > hi;
  if (bad(s.bookingFee, 0, 5000)) return toast("Booking fee must be between 0 and 5000.");
  if (bad(s.taxPercent, 0, 50)) return toast("Tax must be between 0% and 50%.");
  if (bad(s.idleTableMinutes, 1, 600)) return toast("Idle minutes must be 1–600.");
  if (bad(s.arrivalTimeMinutes, 1, 120)) return toast("Arrival window must be 1–120 minutes.");
  safely(async () => { await dbSet("restaurants", CONFIG.restaurantId, { settings: s }); $("setMsg").textContent = "Saved. New bookings and orders use these values; existing ones keep theirs."; toast("Settings saved."); });
}
