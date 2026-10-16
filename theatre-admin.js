let D={shows:[],tickets:[],snackOrders:[],scanLogs:[]},tab="Shows",msg="";
const TABS=["Shows","Bookings","Verify","Canteen","Security Log"];
async function verifyTicket(tok){tok=(tok||"").trim();const log=(r)=>{const id=newId("LOG");return dbSet("scanLogs",id,{id,time:Date.now(),token:tok.slice(0,40)||"(empty)",reason:r});};
if(!/^TK[0-9A-F]{24}$/.test(tok)){await log("INVALID format");return "❌ INVALID ticket";}
const r=await runTx(async tx=>{const t=await tx.get("tickets",tok);if(!t)return "NONE";if(t.status==="USED")return "USED";if(Date.now()>t.expiresAt)return "EXPIRED";tx.set("tickets",tok,{status:"USED",usedAt:Date.now()});return t;});
if(r==="NONE"){await log("INVALID not found");return "❌ INVALID ticket";}
if(r==="USED"){await log("REUSED ticket");return "⚠️ ALREADY USED — entry denied";}
if(r==="EXPIRED"){await log("EXPIRED ticket");return "❌ EXPIRED ticket";}
return "✅ VALID — "+r.showTitle+" · Seats "+r.seats.join(", ")+" · marked USED";}
window.setTab=t=>{tab=t;msg="";draw();};
window.addShow=async()=>{const t=document.getElementById("nt").value.trim(),tm=document.getElementById("nm").value.trim(),p=+document.getElementById("np").value;if(!t||!tm||!(p>0))return alert("Fill title, time and price.");const id=newId("show");await dbSet("shows",id,{id,title:t,emoji:"🎬",time:tm,price:p,taken:[]});};
window.delShow=id=>confirm("Delete this show?")&&dbDelete("shows",id);
window.verify=async()=>{const el=document.getElementById("tok");msg=await verifyTicket(el.value);draw();};
window.adv=async(id,s)=>{const n={PLACED:"PREPARING",PREPARING:"READY",READY:"DELIVERED"}[s];if(n)await dbSet("snackOrders",id,{status:n});};
function draw(){document.getElementById("tabs").innerHTML=TABS.map(t=>`<button class="btn ${t===tab?"btn-primary":"btn-ghost"} btn-sm" onclick="setTab('${t}')">${t}</button>`).join("");const v=document.getElementById("v");
if(tab==="Shows")v.innerHTML=D.shows.map(s=>`<div class="card row"><span><b>${esc(s.title)}</b> · ${esc(s.time)} · ${money(s.price)}<br><span class="muted">${(s.taken||[]).length}/40 seats sold</span></span><button class="btn btn-danger btn-sm" onclick="delShow('${s.id}')">Delete</button></div>`).join("")+`<div class="card"><h3>Add show</h3><div class="row"><input id="nt" placeholder="Title"><input id="nm" placeholder="Time e.g. Today 9 PM"><input id="np" type="number" placeholder="Price"><button class="btn btn-primary btn-sm" onclick="addShow()">Add</button></div></div>`;
else if(tab==="Bookings")v.innerHTML=D.tickets.sort((a,b)=>b.createdAt-a.createdAt).map(t=>`<div class="card"><b>${esc(t.showTitle)}</b> · Seats ${t.seats.join(", ")}<br><span class="muted">${esc(t.mobile)} · ${money(t.amount)} · ${t.status} · ${t.id.slice(0,10)}</span><br><span class="muted" style="user-select:all">${t.token}</span></div>`).join("")||`<p class="muted">No bookings yet.</p>`;
else if(tab==="Verify")v.innerHTML=`<div class="card"><h3>Verify ticket</h3><p class="muted">Paste or type the token under the QR (or scan the QR with any scanner app and paste its text).</p><input id="tok" style="width:100%" placeholder="TK…"><br><br><button class="btn btn-primary" onclick="verify()">Verify & Admit</button><h3>${msg}</h3></div>`;
else if(tab==="Canteen")v.innerHTML=D.snackOrders.sort((a,b)=>b.createdAt-a.createdAt).map(o=>`<div class="card row"><span>Seat <b>${o.seat}</b> · ${esc(o.showTitle)}<br>${o.items.map(i=>i.qty+"× "+i.n).join(", ")} · ${money(o.total)}</span><button class="btn btn-secondary btn-sm" ${o.status==="DELIVERED"?"disabled":""} onclick="adv('${o.id}','${o.status}')">${o.status}${o.status==="DELIVERED"?"":" →"}</button></div>`).join("")||`<p class="muted">No snack orders.</p>`;
else v.innerHTML=D.scanLogs.sort((a,b)=>b.time-a.time).map(l=>`<div class="card"><b>${esc(l.reason)}</b><br><span class="muted">${new Date(l.time).toLocaleString()} · ${esc(l.token)}</span></div>`).join("")||`<p class="muted">No rejected scans.</p>`;}
document.getElementById("dbBadge").textContent=FIREBASE_READY?"Live Sync":"Demo (offline)";
seedShows().catch(()=>{});
Object.keys(D).forEach(k=>dbListenAll(k,r=>{D[k]=r;if(!(tab==="Verify"))draw();}));draw();
