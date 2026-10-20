"use strict";
/* MyGarage — offline vehicle records. Data lives on this device (IndexedDB), with a live copy in Dropbox when connected. */
const APP_ID = "garage-log", BACKUP_VERSION = 1, APP_VERSION = "1.46";

/* ================= storage ================= */
const STORES = ["vehicles", "entries", "files", "meta"];
let _db;
function openDB() { return new Promise((res, rej) => { const r = indexedDB.open("garage-log", 1);
  r.onupgradeneeded = () => { const d = r.result; for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: "id" }); };
  r.onsuccess = () => { _db = r.result; res(_db); }; r.onerror = () => rej(r.error); }); }
function tx(store, mode, fn) { return new Promise((res, rej) => { const t = _db.transaction(store, mode); const os = t.objectStore(store); let out; const r = fn(os); if (r) r.onsuccess = () => { out = r.result; }; t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); }
const dbAll = s => tx(s, "readonly", os => os.getAll());
const dbGet = (s, id) => tx(s, "readonly", os => os.get(id));
const DATA_STORES = ["vehicles", "entries", "files"]; // changes to these are sent to Dropbox
const dirtyAfter = s => r => { if (DATA_STORES.includes(s)) markDirty(); return r; };
const dbPut = (s, o) => { if (!_quiet && o && (s === "vehicles" || s === "entries")) o._t = Date.now(); return tx(s, "readwrite", os => os.put(o)).then(dirtyAfter(s)); }; // _t = when this record last changed (for merging two phones)
const dbDel = (s, id) => { if (!_quiet && DATA_STORES.includes(s)) { S.meta.tomb = S.meta.tomb || {}; S.meta.tomb[id] = Date.now(); } return tx(s, "readwrite", os => os.delete(id)).then(dirtyAfter(s)); };
const dbClear = s => tx(s, "readwrite", os => os.clear()).then(dirtyAfter(s));
const uid = p => (p || "x") + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ================= state & helpers ================= */
const S = { vehicles: [], entries: [], meta: {}, tab: "garage", sheet: null, urls: {}, stat: { vid: "all", period: "12m" }, showSold: false };
const DEFAULT_SETTINGS = {
  categories: ["Registration", "CTP", "Insurance", "Tyres", "Repairs", "Batteries", "Parts & accessories", "Roadside assist", "Cleaning & detailing", "Tolls", "Parking", "Finance", "Other"],
  dueDays: 30, dueKm: 1000, backupDays: 30, jumpKm: 3000, contact: "",
  homeRate: null, effAC: 90, effDC: 95, warnDays: 90, noUpdateDays: 35, lowSoonMonths: 3, lowOverMonths: 6, battFirstMonths: 36, battEveryMonths: 12,
  workshops: []
};
const SET = () => Object.assign({}, DEFAULT_SETTINGS, S.meta.settings || {});
const RENEW = { "Registration": ["regoExpiry", "rego expiry"], "CTP": ["ctpExpiry", "CTP expiry"], "Insurance": ["insExpiry", "insurance expiry"] };
const MAINT_CATS = ["Tyres", "Repairs", "Batteries", "Parts & accessories"];
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const blank = v => v == null || v === "";
const clone = o => JSON.parse(JSON.stringify(o));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = n => String(n).padStart(2, "0");
const isoOf = d => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
const todayISO = () => isoOf(new Date());
const parseISO = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
function addMonths(s, n) { const d = parseISO(s), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return isoOf(d); }
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoOf(d); };
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
const fmtDate = s => { if (!s) return "—"; const [y, m, d] = String(s).split("-"); return d ? `${+d} ${MON[+m - 1]} ${y}` : `${MON[+m - 1]} ${y}`; };
const fmtShort = s => { if (!s) return "—"; const [y, m, d] = s.split("-"); return `${+d} ${MON[+m - 1]}` + (y != new Date().getFullYear() ? ` ${y.slice(2)}` : ""); };
const money = (n, dp = 2) => n == null || isNaN(n) ? "—" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const money0 = n => money(n, 0);
const kmf = n => n == null || isNaN(n) ? "—" : Math.round(n).toLocaleString("en-AU") + " km";
const nf = (n, dp = 1) => n == null || isNaN(n) || !isFinite(n) ? "—" : Number(n).toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const r2 = n => Math.round(n * 100) / 100;
function num(v) { if (v == null) return null; const s = String(v).replace(/[,\s$]/g, ""); if (s === "") return null; const n = Number(s); return isFinite(n) ? n : null; }
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3200); }
const sortedV = () => [...S.vehicles].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || vName(a).localeCompare(vName(b)));
const vById = id => S.vehicles.find(v => v.id === id);
const vName = v => v ? (v.name || [v.make, v.model].filter(Boolean).join(" ") || "Vehicle") : "Vehicle";
const vFull = v => [v.year, v.make, v.model, v.variant].filter(Boolean).join(" ");
const isActive = v => (v.status || "Active") === "Active";
const usesOdo = v => v.tracksOdo !== false;
const usesFuel = v => !!v.tracksFuel;
const isEV = v => /Electric|Plug-in/.test((v && v.powertrain) || "");
const usesCharge = v => isEV(v);

/* ================= icons ================= */
const IC = {
  charge: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M13 2 5 13h6l-1 9 8-11h-6z"/></svg>`,
  fuel: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M3 21h13M4 10h11"/><path d="M15 8h2a2 2 0 0 1 2 2v6.5a1.5 1.5 0 0 0 3 0V8l-3-3"/></svg>`,
  service: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3.5 17.2a1.8 1.8 0 0 0 2.5 2.6l5.8-5.8a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.3-.4-.4-2.3z"/></svg>`,
  expense: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>`,
  odo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4.2 17a9 9 0 1 1 15.6 0"/><path d="m12 13 4-5"/><circle cx="12" cy="13" r="1.3"/></svg>`,
  car: `<svg viewBox="0 0 48 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 22v-5l4-2 5-6h16l7 6 7 1.5V22h-4"/><path d="M14 22h16"/><circle cx="10" cy="22" r="4"/><circle cx="34" cy="22" r="4"/><path d="M15 15h18"/></svg>`,
  motorcycle: `<svg viewBox="0 0 48 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><circle cx="10" cy="22" r="6"/><circle cx="38" cy="22" r="6"/><path d="M10 22l8-9h10l4 3-4 6H16M32 16l6 6M28 13l-3-5h-4M30 9h4"/></svg>`,
  trailer: `<svg viewBox="0 0 48 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 10h30v11H6z"/><circle cx="20" cy="24" r="4"/><path d="M36 18h9M45 18v3"/></svg>`,
  other: `<svg viewBox="0 0 48 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 8h36v14H6z"/><circle cx="14" cy="24" r="3"/><circle cx="34" cy="24" r="3"/></svg>`
};
const FUEL_GRADES = ["ULP 91", "E10", "Premium 95", "Premium 98", "Diesel", "Premium diesel", "LPG", "E85"];
function gradeOptions(cur, allowBlank) { const list = [...FUEL_GRADES]; if (cur && !list.includes(cur)) list.unshift(cur); return (allowBlank || !cur ? `<option value="">—</option>` : "") + list.map(g => `<option ${g === cur ? "selected" : ""}>${esc(g)}</option>`).join(""); }
const SVC_TYPES = ["Scheduled service", "Safety recall", "Warranty repair", "Repair / other", "Battery test"];
/* 12V battery: fitted date = latest "Batteries" expense or the vehicle's "12V battery fitted" date; first test after 3 years, then yearly */
const BT = "Battery test", BT_KEYS = ["volts", "cca", "ccaRated", "battResult"];
const BATT_RESULTS = ["Good", "OK – recharged", "Weak – retest in 3 months", "Replace"];
const isBT = e => e.type === "service" && e.svcType === BT;
function battFit(v) { const d = [v.battFitted, ...ownEntries(v).filter(e => e.type === "expense" && e.category === "Batteries").map(e => e.date)].filter(Boolean).sort(); return d.length ? d[d.length - 1] : null; }
function battTests(v, fit) { return ownEntries(v).filter(e => isBT(e) && (!fit || e.date >= fit)).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0); }
function battText(e) { const p = []; if (e.volts != null) p.push(`${nf(e.volts, 2)} V`); if (e.cca != null) p.push(`${nf(e.cca, 0)}${e.ccaRated ? "/" + nf(e.ccaRated, 0) : ""} CCA` + (e.cca && e.ccaRated ? ` (${nf(e.cca / e.ccaRated * 100, 0)}%)` : "")); if (e.battResult) p.push(e.battResult); return p.join(" · "); }
function battDue(v) {
  if (v.kind === "trailer") return null;
  const fit = battFit(v); if (!fit) return null;
  const st = SET(), tests = battTests(v, fit), last = tests[tests.length - 1], res = last && last.battResult || "";
  const date = !last ? addMonths(fit, st.battFirstMonths) : /^Replace/.test(res) ? last.date : addMonths(last.date, /^Weak/.test(res) ? 3 : st.battEveryMonths);
  return { fit, last, date, replace: /^Replace/.test(res) };
}
const isSched = e => !e.svcType || e.svcType === SVC_TYPES[0]; // only scheduled services restart the service countdown
const kindIcon = v => IC[v.kind] || IC.other;
const TYPE_LABEL = { charge: "Charge", fuel: "Fuel", odo: "Odometer", service: "Service", expense: "Expense" };

/* ================= calculations ================= */
const byDateOdo = (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : ((a.odo ?? 0) - (b.odo ?? 0)) || ((a.created || 0) - (b.created || 0));
function vEntries(vid) { return S.entries.filter(e => e.vehicleId === vid).sort(byDateOdo); }
function isPrev(e, v) { return e.prevOwner != null ? !!e.prevOwner : !!(v.acqDate && e.date < v.acqDate); }
const ownEntries = v => vEntries(v.id).filter(e => !isPrev(e, v));
const costOf = e => (typeof e.cost === "number" && isFinite(e.cost)) ? e.cost : 0;
/* collapsed odometer readings: one per date (highest), forced non-decreasing */
function readings(v, excludeId) {
  const m = new Map();
  for (const e of S.entries) if (e.vehicleId === v.id && e.odo != null && e.id !== excludeId) m.set(e.date, Math.max(m.get(e.date) ?? -Infinity, e.odo));
  if (v.acqOdo != null && v.acqDate && !m.has(v.acqDate)) m.set(v.acqDate, v.acqOdo);
  if (v.sold && v.sold.odo != null && v.sold.date) m.set(v.sold.date, Math.max(m.get(v.sold.date) ?? -Infinity, v.sold.odo));
  const r = [...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([date, odo]) => ({ date, odo }));
  const out = []; for (const x of r) { if (out.length && x.odo < out[out.length - 1].odo) continue; out.push(x); } return out;
}
function curOdo(v) { const r = readings(v); return r.length ? r[r.length - 1] : null; }
function odoAt(r, date) {
  if (!r.length || date < r[0].date || date > r[r.length - 1].date) return null;
  for (let i = 0; i < r.length; i++) { if (r[i].date === date) return r[i].odo; if (r[i].date > date) { const a = r[i - 1], b = r[i]; const f = daysBetween(a.date, date) / Math.max(1, daysBetween(a.date, b.date)); return a.odo + (b.odo - a.odo) * f; } }
  return null;
}
function ownStart(v) { const r = readings(v); if (!r.length) return null; if (!v.acqDate) return r[0]; const o = odoAt(r, v.acqDate); if (o != null) return { date: v.acqDate, odo: o }; const after = r.find(x => x.date >= v.acqDate); return after || null; }
function kmBetween(v, from, to) { const r = readings(v); if (r.length < 2) return null; const st = ownStart(v); let a = from, b = to; if (st && a < st.date) a = st.date; if (a < r[0].date) a = r[0].date; if (b > r[r.length - 1].date) b = r[r.length - 1].date; if (b <= a) return 0; const oa = odoAt(r, a), ob = odoAt(r, b); return oa == null || ob == null ? null : ob - oa; }
function kmPerDay(v) {
  const r = readings(v); const st = ownStart(v); if (!st || r.length < 2) return null; const last = r[r.length - 1];
  let from = addDays(last.date, -365); if (from < st.date) from = st.date; if (daysBetween(from, last.date) < 30) { from = st.date; if (daysBetween(from, last.date) < 30) return null; }
  const k = kmBetween(v, from, last.date); return k == null ? null : k / daysBetween(from, last.date);
}
function estOdoToday(v) { const c = curOdo(v); if (!c) return null; const r = kmPerDay(v); if (!r || !isActive(v)) return c.odo; return c.odo + r * Math.max(0, daysBetween(c.date, todayISO())); }
/* fuel: full-to-full economy. Litres of part fills roll into the next full fill. */
function fuelCalc(v) {
  const fills = vEntries(v.id).filter(e => e.type === "fuel" && e.odo != null).sort((a, b) => a.odo - b.odo || (a.date < b.date ? -1 : 1));
  const info = new Map(); const segs = []; let prev = null, lastFull = null, acc = 0, tow = false, ok = true;
  for (const f of fills) {
    const d = { dist: prev ? f.odo - prev.odo : null, econ: null, tow: false };
    if (lastFull) {
      if (f.litres == null) ok = false; else acc += f.litres; tow = tow || !!f.towing;
      if (f.full !== false) { const k = f.odo - lastFull.odo; if (ok && k > 0 && acc > 0) { d.econ = acc / k * 100; d.tow = tow; d.segKm = k; segs.push({ date: f.date, km: k, l: acc, tow, prev: isPrev(f, v), id: f.id }); } lastFull = f; acc = 0; tow = false; ok = true; }
    } else if (f.full !== false) { lastFull = f; acc = 0; tow = false; ok = true; }
    info.set(f.id, d); prev = f;
  }
  const own = segs.filter(s => !s.prev && !s.tow).map(s => s.l / s.km * 100).sort((a, b) => a - b);
  const med = own.length ? own[Math.floor(own.length / 2)] : null;
  if (med) for (const [id, d] of info) if (d.econ != null && !d.tow && (d.econ < med * 0.6 || d.econ > med * 1.6)) d.odd = true;
  return { info, segs, median: med };
}
const _fcache = new Map();
function fuelOf(v) { if (!_fcache.has(v.id)) _fcache.set(v.id, fuelCalc(v)); return _fcache.get(v.id); }
function econOver(segs, from, to, tow) { let k = 0, l = 0; for (const s of segs) { if (s.prev || s.date < from || s.date > to) continue; if (tow != null && s.tow !== tow) continue; k += s.km; l += s.l; } return k ? { econ: l / k * 100, km: k, l } : null; }

/* servicing & reminders */
function nextService(v) {
  const sv = ownEntries(v).filter(e => e.type === "service" && isSched(e));
  const last = sv[sv.length - 1];
  let km = null, date = null, basis = "";
  if (last) {
    km = last.nextKm ?? (v.svcKm && last.odo != null ? last.odo + v.svcKm : null);
    date = last.nextDate || (v.svcMonths ? addMonths(last.date, v.svcMonths) : null); basis = "last service " + fmtDate(last.date);
  } else if (v.acqDate && (v.svcKm || v.svcMonths)) {
    const st = ownStart(v); km = v.svcKm && st ? st.odo + v.svcKm : null; date = v.svcMonths ? addMonths(v.acqDate, v.svcMonths) : null; basis = "service interval";
  }
  if (km == null && !date) return null;
  return { km, date, basis, last };
}
function reminders(v) {
  if (!isActive(v)) return [];
  const st = SET(), today = todayISO(), out = [];
  const dateItem = (kind, label, date) => { if (!date) return; const d = daysBetween(today, date); out.push({ v, kind, label, date, days: d, status: d < 0 ? "over" : d <= st.dueDays ? "soon" : "ok", text: d < 0 ? `${-d} day${d === -1 ? "" : "s"} overdue` : d === 0 ? "Due today" : `in ${d} day${d === 1 ? "" : "s"}` }); };
  dateItem("rego", "Registration", v.regoExpiry);
  dateItem("ctp", "CTP green slip", v.ctpExpiry);
  dateItem("ins", "Insurance", v.insExpiry);
  const ns = nextService(v);
  if (ns) {
    const est = usesOdo(v) ? estOdoToday(v) : null, rate = kmPerDay(v);
    let status = "ok", parts = [], sortDate = ns.date;
    let dd = ns.date ? daysBetween(today, ns.date) : null;
    let kmLeft = ns.km != null && est != null ? ns.km - est : null;
    let projDate = kmLeft != null && rate ? addDays(today, Math.max(0, Math.round(kmLeft / rate))) : null;
    if (projDate && (!sortDate || projDate < sortDate)) sortDate = projDate;
    if ((dd != null && dd < 0) || (kmLeft != null && kmLeft <= 0)) status = "over";
    else if ((dd != null && dd <= st.dueDays) || (kmLeft != null && kmLeft <= st.dueKm) || (projDate && daysBetween(today, projDate) <= st.dueDays)) status = "soon";
    if (ns.km != null) parts.push(`at ${kmf(ns.km)}` + (kmLeft != null ? (kmLeft > 0 ? ` (~${kmf(kmLeft)} to go)` : ` (~${kmf(-kmLeft)} over)`) : ""));
    if (ns.date) parts.push(`by ${fmtDate(ns.date)}`);
    const d = sortDate ? daysBetween(today, sortDate) : 9999;
    out.push({ v, kind: "service", label: "Service", date: sortDate, days: d, status, text: parts.join(" or "), proj: projDate, ns });
  }
  out.push(...extraReminders(v));
  return out;
}
const allReminders = () => S.vehicles.flatMap(reminders).sort((a, b) => ({ over: 0, soon: 1, ok: 2 }[a.status] - { over: 0, soon: 1, ok: 2 }[b.status]) || a.days - b.days);

/* periods */
function fyStart(d = new Date()) { const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; return y; }
function periodRange(p, v) {
  const t = todayISO(), fy = fyStart();
  if (p === "12m") return [addDays(addMonths(t, -12), 1), t, "Last 12 months"];
  if (p === "fy") return [`${fy}-07-01`, `${fy + 1}-06-30`, `FY ${fy}–${String(fy + 1).slice(2)}`];
  if (p === "lfy") return [`${fy - 1}-07-01`, `${fy}-06-30`, `FY ${fy - 1}–${String(fy).slice(2)}`];
  if (p === "year") return [`${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`, String(new Date().getFullYear())];
  let from = "9999"; for (const x of (v ? [v] : S.vehicles)) { const s = x.acqDate || (vEntries(x.id)[0] || {}).date; if (s && s < from) from = s; }
  return [from === "9999" ? t : from, t, "All time (since bought)"];
}
function vStats(v, from, to) {
  const es = ownEntries(v).filter(e => e.date >= from && e.date <= to);
  const fuel = es.filter(e => e.type === "fuel"), svc = es.filter(e => e.type === "service"), exp = es.filter(e => e.type === "expense");
  const cats = {}; for (const e of exp) cats[e.category || "Other"] = (cats[e.category || "Other"] || 0) + costOf(e);
  const fuelCost = fuel.reduce((s, e) => s + costOf(e), 0), litres = fuel.reduce((s, e) => s + (e.litres || 0), 0);
  const pplL = fuel.filter(e => e.litres && e.cost), ppl = pplL.length ? pplL.reduce((s, e) => s + e.cost, 0) / pplL.reduce((s, e) => s + e.litres, 0) : null;
  const svcCost = svc.reduce((s, e) => s + costOf(e), 0), expCost = exp.reduce((s, e) => s + costOf(e), 0);
  const km = usesOdo(v) ? kmBetween(v, from, to) : null;
  const ch = es.filter(e => e.type === "charge"), chargeCost = ch.reduce((s, e) => s + costOf(e), 0);
  const isHome = e => e.where !== "public";
  const kwh = ch.reduce((s, e) => s + (e.kwh || 0), 0), kwhHome = ch.filter(isHome).reduce((s, e) => s + (e.kwh || 0), 0), kwhPublic = kwh - kwhHome;
  const costHome = ch.filter(isHome).reduce((s, e) => s + costOf(e), 0), costPublic = chargeCost - costHome;
  const homeEst = ch.some(e => e.costEst), homeUncosted = ch.some(e => isHome(e) && e.cost == null);
  const r0 = readings(v)[0]; /* kWh logged at the very first odometer reading has no km before it to divide by */
  const kwhEff = ch.filter(e => !(r0 && e.date === r0.date && e.odo === r0.odo)).reduce((s, e) => s + (e.kwh || 0), 0);
  const total = fuelCost + chargeCost + svcCost + expCost;
  const fc = fuelOf(v);
  return { es, fuel, svc, exp, cats, fuelCost, litres, ppl, svcCost, expCost, total, km, perKm: km ? total / km : null,
    ch, chargeCost, kwh, kwhHome, kwhPublic, costHome, costPublic, homeEst, homeUncosted, kwh100: km && kwhEff ? kwhEff / km * 100 : null,
    econ: econOver(fc.segs, from, to, null), econNoTow: econOver(fc.segs, from, to, false), econTow: econOver(fc.segs, from, to, true) };
}

/* ================= render shell ================= */
function render() {
  _fcache.clear();
  $$("nav.tabs [data-tab]").forEach(b => b.setAttribute("aria-current", b.dataset.tab === S.tab ? "page" : "false"));
  const act = S.vehicles.filter(isActive);
  paintStatus();
  const rem = allReminders(), over = rem.filter(r => r.status === "over").length, soon = rem.filter(r => r.status === "soon").length;
  const b = $("#dueBadge"); b.hidden = !(over || soon); b.textContent = over || soon; b.className = "badge" + (over ? "" : " soon");
  $("#addVehBtn").hidden = S.tab !== "garage";
  const m = $("#main");
  m.innerHTML = S.tab === "due" ? viewDue() : S.tab === "stats" ? viewStats() : S.tab === "more" ? viewMore() : viewGarage();
  hydrateImages(m);
}
async function urlFor(id) { if (!id) return ""; if (S.urls[id]) return S.urls[id]; const f = await dbGet("files", id); if (!f) return ""; S.urls[id] = URL.createObjectURL(f.blob); return S.urls[id]; }
async function hydrateImages(root) { for (const im of $$("img[data-fid]", root)) { const u = await urlFor(im.dataset.fid); if (u) im.src = u; } for (const a of $$("a[data-fid]", root)) { const u = await urlFor(a.dataset.fid); if (u) a.href = u; } }

/* ================= garage ================= */
function backupBanner() {
  if (dbxOn()) {
    const m = S.meta, waitDays = m.dirty && m.lastSync ? (Date.now() - m.lastSync) / 864e5 : 0;
    const msg = m.conflict ? "Dropbox has a different copy from this phone. Choose which one to keep." : m.syncError ? `Dropbox sync didn't work: ${m.syncError}` : waitDays >= 2 ? `${m.changes || 1} change${(m.changes || 1) === 1 ? "" : "s"} waiting to go to Dropbox since ${fmtWhen(m.lastSync)}.` : "";
    return msg ? `<div class="banner ${m.conflict || m.syncError ? "bad" : ""}"><span>${esc(msg)}</span><button type="button" class="btn sm primary" data-act="goBackup">Open</button></div>` : "";
  }
  if (hasData()) return `<div class="banner"><span>Your records live only on this phone. Connect Dropbox so they're kept safe automatically.</span><button type="button" class="btn sm primary" data-act="goBackup">Connect Dropbox</button></div>`;
  const last = S.meta.lastBackup, days = last ? daysBetween(last.slice(0, 10), todayISO()) : null;
  if (!S.entries.length || (last && days < SET().backupDays)) return "";
  return `<div class="banner"><span>${last ? `Last backup was ${days} days ago.` : "No backup made on this phone yet."} A backup file protects your records if the phone is lost or replaced.</span><button type="button" class="btn sm primary" data-act="goBackup">Back up now</button></div>`;
}
function viewGarage() {
  if (!S.vehicles.length) return `<section class="view"><div class="empty"><b>No vehicles on this phone yet</b><span>${dbxOn() ? "Connected to Dropbox, but there are no vehicles there yet." : "Used MyGarage with Dropbox before? Connect it and everything comes back."} Or add your first vehicle, or restore a backup file.</span><div class="row">${dbxOn() ? "" : `<button class="btn primary" type="button" data-act="dbxConnect">Get my vehicles from Dropbox</button>`}<button class="btn primary" type="button" data-act="newVehicle">+ Add vehicle</button><button class="btn" type="button" data-act="pickRestore">Restore backup…</button></div></div></section>`;
  const act = sortedV().filter(isActive);
  const sold = S.vehicles.filter(v => !isActive(v));
  const rem = allReminders().filter(r => r.status !== "ok");
  return `<section class="view">${backupBanner()}
  ${rem.length ? `<button type="button" class="banner ${rem.some(r => r.status === "over") ? "bad" : ""}" data-tab="due" style="text-align:left;cursor:pointer;font:inherit"><span><b>${rem.length} item${rem.length === 1 ? " needs" : "s need"} attention</b> — ${rem.slice(0, 3).map(r => esc(`${vName(r.v)} ${r.label.toLowerCase()}`)).join(", ")}${rem.length > 3 ? "…" : ""}</span><span class="tag">View</span></button>` : ""}
  ${S.reorder ? reorderList(act) : `<div class="list">${act.map(vcard).join("")}</div>${act.length > 1 ? `<div class="row"><button type="button" class="btn ghost sm" data-act="reorderOn">⇅ Reorder vehicles</button></div>` : ""}`}
  ${sold.length ? `<div class="row"><button type="button" class="btn ghost sm" data-act="toggleSold">${S.showSold ? "Hide" : "Show"} sold / archived (${sold.length})</button></div>${S.showSold ? `<div class="list">${sold.map(vcard).join("")}</div>` : ""}` : ""}
  </section>`;
}
function vcard(v) {
  const c = curOdo(v), fc = usesFuel(v) ? fuelOf(v) : null;
  const yr = periodRange("12m"); const st = vStats(v, yr[0], yr[1]);
  const lastFill = fc ? [...fc.segs].reverse().find(s => !s.prev) : null;
  const rem = reminders(v).filter(r => r.status !== "ok");
  const stat3 = usesCharge(v) ? evCardStats(v, st) : usesFuel(v) ? [["Avg L/100km", st.econ ? nf(st.econ.econ) : "—"], ["Last fill", lastFill ? nf(lastFill.l / lastFill.km * 100) : "—"]] : [["Spent 12 mths", money0(st.total)], ["Last entry", fmtShort((vEntries(v.id).slice(-1)[0] || {}).date)]];
  return `<button type="button" class="vcard" data-act="openVehicle" data-id="${v.id}">
    <div class="vtop">${v.photo ? `<img class="thumb" data-fid="${esc(v.photo)}" alt="">` : `<div class="thumb">${kindIcon(v)}</div>`}
    <div style="min-width:0"><h3>${esc(vName(v))}</h3><div class="vmeta">${v.rego ? `<span class="plate">${esc(v.rego)}</span> ` : ""}${esc([v.year, v.make, v.model].filter(Boolean).join(" "))}</div>
    ${!isActive(v) ? `<div class="dues" style="margin-top:4px"><span class="tag">${esc(v.status)}${v.sold && v.sold.date ? " " + fmtDate(v.sold.date) : ""}</span></div>` : rem.length ? `<div class="dues" style="margin-top:4px">${rem.map(r => `<span class="tag ${r.status}">${esc(r.label)} ${r.status === "over" ? "overdue" : "due"}</span>`).join("")}</div>` : ""}</div></div>
    ${usesOdo(v) || usesFuel(v) ? `<div class="vstats"><div><span class="lbl">Odometer</span><b>${c ? kmf(c.odo) : "—"}</b></div>${stat3.map(([k, val]) => `<div><span class="lbl">${k}</span><b>${val}</b></div>`).join("")}</div>`
      : `<div class="vstats"><div><span class="lbl">Spent 12 mths</span><b>${money0(st.total)}</b></div><div><span class="lbl">Rego</span><b>${v.regoExpiry ? fmtShort(v.regoExpiry) : "—"}</b></div><div><span class="lbl">Owned since</span><b>${v.acqDate ? v.acqDate.slice(0, 4) : "—"}</b></div></div>`}
  </button>`;
}

/* ================= vehicle detail ================= */
function sheetHead(title, right = "", back = "close") { return `<div class="sheet-head"><div class="wrap"><button type="button" class="btn ghost sm" data-act="${back}" aria-label="Back">‹ Back</button><h2>${esc(title)}</h2>${right}</div></div>`; }
function openSheet(html) { const sh = $("#sheet"); const keep = sh.hidden ? 0 : null; sh.innerHTML = html; sh.hidden = false; if (keep === 0) sh.scrollTop = 0; document.body.style.overflow = "hidden"; hydrateImages(sh); }
function closeSheet() { const sh = $("#sheet"); sh.hidden = true; sh.innerHTML = ""; S.sheet = null; document.body.style.overflow = ""; }
function goBack() { const b = S.sheet && S.sheet.back; if (b && b.kind === "vehicle" && vById(b.id)) { openVehicle(b.id, b.filter); return; } closeSheet(); render(); }
function openVehicle(id, filter) {
  _fcache.clear();
  const v = vById(id); if (!v) return closeSheet();
  S.sheet = { kind: "vehicle", id, filter: filter || (S.sheet && S.sheet.kind === "vehicle" && S.sheet.id === id ? S.sheet.filter : "all"), more: S.sheet && S.sheet.more };
  const f = S.sheet.filter;
  const c = curOdo(v), all = vEntries(v.id), fc = fuelOf(v);
  const [from, to] = periodRange("all", v), st = vStats(v, from, to);
  const yr = periodRange("12m"), sy = vStats(v, yr[0], yr[1]);
  const rate = kmPerDay(v);
  const tiles = [];
  if (usesOdo(v)) { tiles.push(["Odometer", c ? kmf(c.odo) : "—", c ? fmtDate(c.date) : ""]); tiles.push(["Driven since bought", st.km != null ? kmf(st.km) : "—", v.acqDate ? "since " + fmtDate(v.acqDate) : ""]); tiles.push(["Average", rate ? kmf(rate * 30.44) + "/mth" : "—", rate ? kmf(rate * 365.25) + " a year" : ""]); }
  if (usesFuel(v)) { tiles.push(["Average economy", st.econNoTow ? nf(st.econNoTow.econ) + " L/100" : "—", st.econTow ? `towing ${nf(st.econTow.econ)} L/100` : "not towing"]); tiles.push(["Last 12 months", sy.econ ? nf(sy.econ.econ) + " L/100" : "—", sy.ppl ? `avg ${money(sy.ppl, 3)}/L` : ""]); }
  if (usesCharge(v)) tiles.push(...evTiles(v, st));
  tiles.push(["Spent since bought", money0(st.total), usesCharge(v) ? "charging, service & other" : "fuel, service & other"]);
  if (st.perKm) tiles.push(["Running cost", money(st.perKm) + "/km", "excl. purchase price"]);
  const rem = reminders(v);
  const list = all.filter(e => f === "all" || e.type === f).reverse();
  const lim = S.sheet.more ? list.length : 60;
  let html = "", yr0 = null;
  const yearTot = {}; for (const e of list) { const y = e.date.slice(0, 4); yearTot[y] = (yearTot[y] || 0) + (isPrev(e, v) ? 0 : costOf(e)); }
  for (const e of list.slice(0, lim)) { const y = e.date.slice(0, 4); if (y !== yr0) { html += `<div class="hyear"><span>${y}</span><span>${yearTot[y] ? money0(yearTot[y]) : ""}</span></div>`; yr0 = y; } html += hrow(e, v, fc); }
  const counts = { all: all.length }; for (const e of all) counts[e.type] = (counts[e.type] || 0) + 1;
  const types = typesFor(v);
  openSheet(`${sheetHead(vName(v), `<button type="button" class="btn sm" data-act="editVehicle" data-id="${v.id}">Edit</button>`)}
  <div class="wrap sheet-body">
    <div class="hero"><div><div class="row">${v.rego ? `<span class="plate">${esc(v.rego)}</span>` : ""}${!isActive(v) ? `<span class="tag">${esc(v.status)}</span>` : ""}${v.powertrain ? `<span class="tag acc">${esc(v.powertrain)}</span>` : ""}</div><div class="vmeta" style="font-size:14px;margin-top:6px">${esc(vFull(v) || "")}${v.colour ? " · " + esc(v.colour) : ""}</div></div>${v.photo ? `<img data-fid="${esc(v.photo)}" alt="">` : ""}</div>
    ${isActive(v) ? `<div class="quick" style="grid-template-columns:repeat(${types.length},minmax(0,1fr))">${types.map(t => `<button type="button" data-act="newEntry" data-type="${t}" data-id="${v.id}">${IC[t]}${TYPE_LABEL[t]}</button>`).join("")}</div>` : ""}
    <div class="tiles">${tiles.map(([k, b, s]) => `<div><span class="lbl">${k}</span><b>${b}</b><small>${esc(s)}</small></div>`).join("")}</div>
    ${rem.some(r => r.status !== "ok") ? `<div class="duelist">${rem.filter(r => r.status !== "ok").map(dueRow).join("")}</div>` : ""}
    ${rem.some(r => r.status === "ok") ? `<details class="panel"><summary style="cursor:pointer;font:600 17px var(--f-display)">Coming up (${rem.filter(r => r.status === "ok").length}) — next: ${esc(rem.filter(r => r.status === "ok").sort((a, b) => a.days - b.days)[0].label)}</summary><div class="duelist" style="margin-top:10px">${rem.filter(r => r.status === "ok").sort((a, b) => a.days - b.days).map(dueRow).join("")}</div></details>` : ""}
    ${evPanel(v)}${warrantyPanel(v)}
    <div class="panel"><h3>History<span class="sp"></span><button type="button" class="btn sm ghost" data-act="statsFor" data-id="${v.id}">Stats</button><button type="button" class="btn sm ghost" data-act="reportFor" data-id="${v.id}">Reports</button></h3>
      <div class="chips scroll">${["all", ...types].map(t => `<button type="button" class="chip" aria-pressed="${f === t}" data-act="hfilter" data-f="${t}">${t === "all" ? "All" : TYPE_LABEL[t]} ${counts[t] || 0}</button>`).join("")}</div>
      <div class="hist">${html || `<p class="muted">Nothing recorded yet.</p>`}</div>
      ${list.length > lim ? `<button type="button" class="btn" data-act="hmore">Show all ${list.length}</button>` : ""}
    </div>
    ${detailPanel(v)}
  </div>`);
}
function hrow(e, v, fc) {
  const prev = isPrev(e, v); let t = "", s = [], r = "", rs = "", tags = [];
  if (e.type === "fuel") {
    const d = fc.info.get(e.id) || {};
    t = e.litres != null ? `${nf(e.litres, 2)} L` + (e.full === false ? " · part fill" : "") : (e.full === false ? "Part fill" : "Fill-up");
    s.push(kmf(e.odo)); if (d.dist != null) s.push(`+${nf(d.dist, 0)} km`); if (e.location) s.push(e.location);
    r = e.cost != null ? money(e.cost) : "—"; rs = d.econ != null ? `${nf(d.econ)} L/100${d.tow ? " 🚚" : ""}` : (e.ppl ? `${money(e.ppl, 3)}/L` : "");
    if (d.odd) tags.push(`<span class="tag soon">check</span>`);
  } else if (e.type === "service") { t = e.desc || (isSched(e) ? "Service" : e.svcType); if (!isSched(e)) tags.push(`<span class="tag acc">${esc(e.svcType)}</span>`); if (e.odo != null) s.push(kmf(e.odo)); if (e.workshop) s.push(e.workshop); r = e.cost != null ? money(e.cost) : "—"; if (e.dealerSoh != null) rs = `🔋 ${nf(e.dealerSoh, 0)}% dealer`; if (isBT(e)) { r = e.volts != null ? `${nf(e.volts, 2)} V` : (e.cost != null ? money(e.cost) : ""); rs = e.cca && e.ccaRated ? `${nf(e.cca / e.ccaRated * 100, 0)}% CCA` : ""; if (e.battResult && !/^(Good|OK)/.test(e.battResult)) tags.push(`<span class="tag soon">${esc(e.battResult.split(" ")[0])}</span>`); } }
  else if (e.type === "expense") { t = (e.category || "Expense") + (e.desc ? " — " + e.desc : ""); if (e.odo != null) s.push(kmf(e.odo)); r = e.cost != null ? money(e.cost) : "—"; }
  else if (e.type === "charge") { const cr = capReading(e, v); t = `${nf(e.kwh, 1)} kWh · ${e.where === "public" ? "Public " + (e.current || "DC") : "Home"}`; if (e.odo != null) s.push(kmf(e.odo)); if (e.location) s.push(e.location); r = e.cost != null ? (e.costEst ? "~" : "") + money(e.cost) : "—"; if (cr) rs = `🔋 ${cr.pct != null ? nf(cr.pct, 0) + "%" : nf(cr.cap, 1) + " kWh"}`; }
  else { t = "Odometer " + kmf(e.odo); if (e.notes) s.push(e.notes); }
  if (prev) tags.push(`<span class="tag">prior owner</span>`);
  if ((e.receipts || []).length) tags.push(`<span class="tag">📎${e.receipts.length}</span>`);
  return `<button type="button" class="hrow" data-act="editEntry" data-id="${e.id}"><span class="ic ${e.type}">${IC[e.type]}</span><span style="min-width:0"><span class="t" style="display:block">${esc(t)} ${tags.join(" ")}</span><span class="s" style="display:block">${esc(fmtShort(e.date))}${s.length ? " · " + esc(s.join(" · ")) : ""}</span></span><span class="r">${r}${rs ? `<small>${rs}</small>` : ""}</span></button>`;
}
function dueRow(r) { if (r.custom) return customDueRow(r); const act = r.kind === "service" ? `data-act="newEntry" data-type="service" data-id="${r.v.id}"` : `data-act="renew" data-kind="${r.kind}" data-id="${r.v.id}"`;
  return `<div class="due ${r.status}"><span class="bar"></span><div style="min-width:0"><b>${esc(vName(r.v))} · ${esc(r.label)}</b><div class="s">${r.kind === "service" ? esc(r.text) + (r.proj && (!r.ns.date || r.proj < r.ns.date) ? ` · at your average, around ${fmtDate(r.proj)}` : "") : (r.status === "over" ? "Expired " : "Expires ") + fmtDate(r.date)}</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><span class="when">${r.kind === "service" ? (r.status === "over" ? "Overdue" : r.status === "soon" ? "Due soon" : "OK") : esc(r.text)}</span><button type="button" class="btn sm" ${act}>${r.kind === "service" ? "Log service" : "Renewed"}</button></div></div>`; }
function detailPanel(v) {
  const rows = [["Vehicle", vFull(v)], ["Body", v.body], ["Colour", v.colour], ["Transmission", v.transmission], ["Engine", v.engine], ["Powertrain", v.powertrain], ["Usual fuel", v.fuelGrade], ["Tank", v.tankL ? v.tankL + " L" : ""], ["Battery", v.battKwh ? `${v.battKwh} kWh${v.battType ? " " + v.battType : ""}` : ""], ["Official energy use", v.officialKwh100 ? v.officialKwh100 + " kWh/100km" : ""], ["Tyre pressure", v.tyrePressure], ["VIN / chassis", v.vin], ["Engine no.", v.engineNo],
    ["Tare / ATM", [v.tareKg && v.tareKg + " kg tare", v.atmKg && v.atmKg + " kg ATM"].filter(Boolean).join(" · ")], ["Axles", v.axles],
    ["Registration", [v.rego, v.regoState, v.regoExpiry && "expires " + fmtDate(v.regoExpiry)].filter(Boolean).join(" · ")], ["CTP", [v.ctpInsurer, v.ctpExpiry && "expires " + fmtDate(v.ctpExpiry)].filter(Boolean).join(" · ")],
    ["Insurance", [v.insurer, v.policyNo, v.insExpiry && "expires " + fmtDate(v.insExpiry)].filter(Boolean).join(" · ")], ["Agreed value", v.agreedValue != null ? money0(v.agreedValue) : ""],
    ["Bought", [v.acqDate && fmtDate(v.acqDate), v.acqFrom, v.price != null && money0(v.price), v.acqOdo != null && kmf(v.acqOdo)].filter(Boolean).join(" · ")],
    ["Finance", [v.financeProvider, v.financeMonthly && money(v.financeMonthly) + "/mth", v.financePayout && "payout " + fmtDate(v.financePayout)].filter(Boolean).join(" · ")],
    ["Service interval", [v.svcKm && kmf(v.svcKm), v.svcMonths && v.svcMonths + " months"].filter(Boolean).join(" or ")],
    ["Sold", v.sold && v.sold.date ? [fmtDate(v.sold.date), v.sold.price != null && money0(v.sold.price), v.sold.odo != null && kmf(v.sold.odo), v.sold.buyer].filter(Boolean).join(" · ") : ""]
  ].filter(([, x]) => !blank(x));
  return `<div class="panel"><h3>Details</h3><dl class="kv">${rows.map(([k, x]) => `<dt>${k}</dt><dd>${esc(x)}</dd>`).join("")}</dl>${v.notes ? `<div class="lbl" style="margin-top:6px">Notes</div><div style="white-space:pre-wrap">${esc(v.notes)}</div>` : ""}</div>`;
}

/* ================= vehicle editor ================= */
const VF = [
  ["fs", "Basics"], ["name", "Short name (shown in the app)", "text", "e.g. Kluger"], ["kind", "Type", "select", ["car", "motorcycle", "trailer", "other"]],
  ["rego", "Number plate"], ["regoState", "State", "text", "NSW"], ["year", "Year", "num"], ["make", "Make"], ["model", "Model"], ["variant", "Variant / grade"], ["body", "Body type"], ["colour", "Colour"], ["transmission", "Transmission"], ["engine", "Engine (e.g. 2.5 L)"],
  ["powertrain", "Powertrain", "select", ["", "Petrol", "Petrol hybrid", "Plug-in hybrid", "Diesel", "Electric", "None (trailer)"]], ["fuelGrade", "Usual fuel", "grade"], ["tankL", "Tank size (litres)", "num"],
  ["fs", "What to track"], ["tracksOdo", "Record odometer (km)", "check"], ["tracksFuel", "Record fuel fill-ups & economy", "check"],
  ["fs", "Electric vehicle", "", "", "ev"], ["battKwh", "Battery size (kWh)", "num", "", "ev"], ["battType", "Battery type", "text", "e.g. LFP", "ev"], ["officialKwh100", "Official energy use (kWh/100km)", "num", "", "ev"],
  ["fs", "Identification"], ["vin", "VIN / chassis no.", "text", "", "mono"], ["engineNo", "Engine no.", "text", "", "mono"], ["tareKg", "Tare (kg)", "num", "", "trailer"], ["atmKg", "ATM / GVM (kg)", "num", "", "trailer"], ["axles", "Axles", "text", "", "trailer"],
  ["fs", "Registration & insurance"], ["regoExpiry", "Rego expiry", "date"], ["ctpInsurer", "CTP insurer"], ["ctpExpiry", "CTP expiry", "date"], ["insurer", "Insurer"], ["policyNo", "Policy no."], ["insExpiry", "Insurance expiry", "date"], ["agreedValue", "Agreed value ($)", "num"],
  ["fs", "Purchase"], ["acqDate", "Date bought", "date"], ["acqFrom", "Bought from"], ["price", "Purchase price ($)", "num"], ["acqOdo", "Odometer when bought (km)", "num"],
  ["financeProvider", "Finance provider"], ["financeMonthly", "Finance per month ($)", "num"], ["financePayout", "Finance payout date", "date"],
  ["fs", "Servicing"], ["svcKm", "Service every (km)", "num"], ["svcMonths", "or every (months)", "num"], ["battFitted", "12V battery fitted (date)", "date", "", "powered"],
  ["tyrePressure", "Tyre pressure", "text", "e.g. 250 kPa"],
  ["fs", "Warranty"], ["warStart", "Warranty start (first registration)", "date"], ["warYears", "Car warranty (years)", "num"], ["warKm", "Car warranty km (blank = unlimited)", "num"],
  ["drvYears", "Engine / drive unit (years)", "num"], ["drvKm", "Engine / drive unit km (blank = unlimited)", "num"],
  ["batYears", "Battery warranty (years)", "num"], ["batKm", "Battery km (blank = unlimited)", "num"], ["batMinPct", "Battery minimum capacity %", "num"], ["batExtYears", "Battery extends to (years) with yearly health checks", "num"],
  ["fs", "Status"], ["status", "Status", "select", ["Active", "Sold", "Disposed"]], ["sold.date", "Date sold", "date", "", "sold"], ["sold.price", "Sale price ($)", "num", "", "sold"], ["sold.odo", "Odometer at sale (km)", "num", "", "sold"], ["sold.buyer", "Sold to", "text", "", "sold"],
  ["fs", "Notes"], ["notes", "Notes, known issues, modifications", "area"]
];
const getK = (o, k) => k.split(".").reduce((a, p) => a == null ? a : a[p], o);
const setK = (o, k, val) => { const ps = k.split("."); let a = o; for (let i = 0; i < ps.length - 1; i++) a = a[ps[i]] = a[ps[i]] || {}; a[ps[ps.length - 1]] = val; };
function openVehicleEdit(id) {
  const src = id ? clone(vById(id)) : { kind: "car", status: "Active", tracksOdo: true, tracksFuel: true, regoState: "NSW", order: S.vehicles.length };
  S.sheet = { kind: "editVehicle", id: id || null, draft: src, confirmDel: false, back: id ? { kind: "vehicle", id } : null }; drawVehicleEdit();
}
function drawVehicleEdit() {
  const d = S.sheet.draft, sold = (d.status || "Active") !== "Active", trailer = d.kind === "trailer";
  const fields = VF.map(([k, l, t = "text", opt, cls]) => {
    if (cls === "sold" && !sold) return ""; if (cls === "trailer" && !trailer) return ""; if (cls === "ev" && !isEV(d)) return ""; if (cls === "powered" && trailer) return "";
    if (k === "fs") return `<div class="fs-title">${l}</div>`;
    const val = getK(d, k);
    if (t === "check") return `<label class="check-inline full"><input type="checkbox" data-k="${k}" ${val !== false && (k !== "tracksFuel" || val) ? "checked" : ""}> ${l}</label>`;
    if (t === "select") return `<div class="field"><label>${l}</label><select data-k="${k}" data-redraw="1">${opt.map(o => `<option value="${esc(o)}" ${String(val ?? "") === o ? "selected" : ""}>${esc(o ? o[0].toUpperCase() + o.slice(1) : "—")}</option>`).join("")}</select></div>`;
    if (t === "grade") return `<div class="field"><label>${l}</label><select data-k="${k}">${gradeOptions(val || "", true)}</select></div>`;
    if (t === "area") return `<div class="field full"><label>${l}</label><textarea data-k="${k}">${esc(val)}</textarea></div>`;
    const hint = k === "battFitted" ? `<span class="hint">Only needed if no "Batteries" expense is logged — e.g. the date bought, if bought new. Starts the 12V battery test reminder.</span>` : "";
    return `<div class="field"><label>${l}</label><input data-k="${k}" ${t === "date" ? 'type="date"' : t === "num" ? 'inputmode="decimal" data-num="1"' : 'type="text"'} value="${esc(val ?? "")}" ${opt ? `placeholder="${esc(opt)}"` : ""} ${cls === "mono" ? 'class="mono" autocapitalize="characters"' : ""}>${hint}</div>`;
  }).join("");
  openSheet(`${sheetHead(S.sheet.id ? "Edit " + vName(d) : "New vehicle", `<button type="button" class="btn primary sm" data-act="saveVehicle">Save</button>`, S.sheet.id ? "goBack" : "close")}
  <div class="wrap sheet-body">
    ${S.sheet.id ? "" : `<div class="panel"><h3>Start from a preset</h3><p class="small muted" style="margin:0">Fills in specs, warranty, servicing and scheduled items from the BYD handbook and warranty booklet. You add the plate, VIN and dates.</p><div class="row">${Object.entries(PRESETS).map(([k, x]) => `<button type="button" class="btn" data-act="preset" data-p="${k}">${esc(x._label)}</button>`).join("")}</div></div>`}
    <div class="panel"><h3>Photo</h3><div class="row">${d.photo ? `<div class="fileth" style="width:140px;height:96px"><img data-fid="${esc(d.photo)}" alt=""><button type="button" class="x" data-act="rmPhoto" aria-label="Remove photo">×</button></div>` : `<div class="fileth" style="width:140px;height:96px">${kindIcon(d)}</div>`}<button type="button" class="btn" data-act="pickPhoto">${d.photo ? "Change" : "Add"} photo</button></div></div>
    <div class="panel"><div class="form">${fields}</div></div>
    ${itemsEditor(d)}
    ${sold ? `<div class="panel"><h3>For the sale report</h3><div class="form"><div class="field"><label>Asking price ($)</label><input data-k="askingPrice" inputmode="decimal" data-num="1" value="${esc(d.askingPrice ?? "")}"></div><div class="field full"><label>Seller's notes for buyers</label><textarea data-k="sellerNotes">${esc(d.sellerNotes || "")}</textarea></div></div></div>` : ""}
    ${S.sheet.id ? `<div class="panel"><h3>Remove vehicle</h3><p class="small muted" style="margin:0">To keep the records after selling, change Status to <b>Sold</b> instead — it moves to the archive and its reports still work. Deleting erases the vehicle and all ${S.entries.filter(e => e.vehicleId === S.sheet.id).length} records permanently.</p>
      ${S.sheet.confirmDel ? `<div class="banner bad"><span>Delete ${esc(vName(d))} and all its records? This can't be undone (unless you restore a backup).</span><button type="button" class="btn danger sm" data-act="delVehicleYes">Delete for good</button><button type="button" class="btn ghost sm" data-act="delVehicleNo">Cancel</button></div>` : `<div><button type="button" class="btn danger" data-act="delVehicle">Delete vehicle…</button></div>`}</div>` : ""}
  </div>`);
}
function readVehicleForm() {
  const d = S.sheet.draft;
  for (const el of $$("#sheet [data-k]")) { const k = el.dataset.k; let val = el.type === "checkbox" ? el.checked : el.value.trim(); if (el.dataset.num) val = num(val); if (val === "") val = null; setK(d, k, val); }
  readItems(d);
  return d;
}
async function saveVehicle() {
  const d = readVehicleForm();
  if (!d.name && !d.make && !d.rego) { toast("Give the vehicle a name, make or number plate"); return; }
  if (d.rego) d.rego = d.rego.toUpperCase();
  if (d.vin) d.vin = d.vin.toUpperCase();
  if ((d.status || "Active") === "Active") delete d.sold;
  d.id = d.id || uid("v"); d.updated = new Date().toISOString();
  await dbPut("vehicles", d); await reload(); askPersist(); toast("Saved"); openVehicle(d.id);
}
async function deleteVehicle(id) {
  for (const e of S.entries.filter(e => e.vehicleId === id)) { for (const r of e.receipts || []) await dbDel("files", r.id); await dbDel("entries", e.id); }
  const v = vById(id); if (v && v.photo) await dbDel("files", v.photo);
  await dbDel("vehicles", id); await reload(); closeSheet(); render(); toast("Vehicle deleted");
}

/* ================= entry editor (fuel / odometer / service / expense) ================= */
const SVC_CHIPS = ["Logbook service", "Oil & filter", "Tyre rotation", "Wheel alignment", "Brake pads", "Brake fluid", "Coolant", "Air filter", "Cabin filter", "Spark plugs", "Battery", "Wipers", "Hybrid system check", "Chain & sprockets"];
function lastVehicleId() { const act = S.vehicles.filter(isActive); const l = S.meta.lastVid; return act.some(v => v.id === l) ? l : (act.find(v => usesFuel(v) || usesCharge(v)) || act[0] || {}).id; }
function openEntry({ id, vid, type, back, preset }) {
  let e;
  if (id) { e = clone(S.entries.find(x => x.id === id)); vid = e.vehicleId; }
  else { vid = vid || lastVehicleId(); const v = vById(vid); type = type || (v && usesCharge(v) ? "charge" : v && usesFuel(v) ? "fuel" : v && usesOdo(v) ? "odo" : "expense"); if (v && !typesFor(v).includes(type)) type = typesFor(v)[0]; e = Object.assign({ type, vehicleId: vid, date: todayISO(), full: true, receipts: [] }, preset || {}); if (type === "fuel" && v) e.grade = v.fuelGrade || ""; if (type === "charge" && !e.where) e.where = "home"; }
  if (!vid) { toast("Add a vehicle first"); return; }
  S.sheet = { kind: "entry", id: id || null, draft: e, back: back === undefined ? (S.sheet && S.sheet.kind === "vehicle" ? { kind: "vehicle", id: S.sheet.id, filter: S.sheet.filter } : null) : back, warned: null, confirmDel: false, quick: !id && !back && !(S.sheet && S.sheet.kind === "vehicle") };
  drawEntry();
}
function prevFuelOdo(v, e) { const f = S.entries.filter(x => x.vehicleId === v.id && x.type === "fuel" && x.id !== e.id && x.odo != null && x.date <= e.date).sort((a, b) => a.odo - b.odo); return f.length ? f[f.length - 1] : null; }
function lastReadingBefore(v, e) { const r = readings(v, e.id).filter(x => x.date <= e.date); return r[r.length - 1] || null; }
function drawEntry() {
  const e = S.sheet.draft, v = vById(e.vehicleId), t = e.type, st = SET();
  const act = sortedV().filter(x => isActive(x) || x.id === e.vehicleId);
  const lr = lastReadingBefore(v, e), pf = t === "fuel" ? prevFuelOdo(v, e) : null;
  const types = typesFor(v);
  const locs = [...new Set(S.entries.filter(x => x.location).map(x => x.location))].slice(-60);
  const shops = [...new Set(S.entries.filter(x => x.workshop).map(x => x.workshop))];
  const odoField = usesOdo(v) ? `<div class="field bigodo ${t === "fuel" ? "" : "full"}"><label for="fOdo">Odometer (km)${t === "odo" || t === "fuel" || t === "charge" ? "" : " — optional"}</label><input id="fOdo" data-k="odo" inputmode="numeric" pattern="[0-9]*" value="${e.odo ?? ""}" placeholder="${lr ? Math.round(lr.odo) : ""}" ${S.sheet.id ? "" : "autofocus"}><span class="hint">${lr ? `Last: ${kmf(lr.odo)} on ${fmtDate(lr.date)}` : "No earlier reading"}</span></div>` : "";
  let body = "";
  if (t === "fuel") body = `<div class="form2">${odoField}<div class="field bigodo"><label for="fTrip">or Trip km since last fill</label><input id="fTrip" data-k="_trip" inputmode="numeric" pattern="[0-9]*" placeholder="${pf ? "e.g. 520" : "—"}" ${pf ? "" : "disabled"}><span class="hint">${pf ? `Last fill at ${kmf(pf.odo)}` : "Needs an earlier fill"}</span></div></div>
    <div class="form3"><div class="field mid"><label>Litres</label><input data-k="litres" inputmode="decimal" data-num="1" value="${e.litres ?? ""}"></div><div class="field mid"><label>Total $</label><input data-k="cost" inputmode="decimal" data-num="1" value="${e.cost ?? ""}"></div><div class="field mid"><label>$ per litre</label><input data-k="ppl" inputmode="decimal" data-num="1" value="${e.ppl != null ? r2(e.ppl * 1000) / 1000 : ""}" placeholder="auto"></div></div>
    <div class="toggles"><label class="check-inline"><input type="checkbox" data-k="full" ${e.full !== false ? "checked" : ""}> Filled to full</label><label class="check-inline"><input type="checkbox" data-k="towing" ${e.towing ? "checked" : ""}> Towing since last fill</label></div>
    <div class="form2"><div class="field"><label>Servo / location</label><input data-k="location" list="locs" value="${esc(e.location || "")}"><datalist id="locs">${locs.map(l => `<option value="${esc(l)}">`).join("")}</datalist></div><div class="field"><label>Fuel</label><select data-k="grade">${gradeOptions(e.grade || v.fuelGrade || "")}</select></div></div>`;
  else if (t === "charge") body = chargeBody(e, v, odoField);
  else if (t === "odo") body = odoField;
  else if (t === "service" && isBT(e)) { const prevT = battTests(v).filter(x => x.id !== e.id).pop(), bf = battFit(v);
    body = `<div class="field"><label>Type of work</label><select data-k="svcType" data-redraw="1">${SVC_TYPES.map(x => `<option ${x === e.svcType ? "selected" : ""}>${x}</option>`).join("")}</select><span class="hint">12V battery check with your battery tester.${bf ? ` Battery fitted ${fmtDate(bf)}.` : ""}</span></div>${odoField}
    <div class="form3"><div class="field mid"><label>Voltage (V)</label><input data-k="volts" inputmode="decimal" data-num="1" value="${e.volts ?? ""}" placeholder="e.g. 12.6"></div><div class="field mid"><label>CCA measured</label><input data-k="cca" inputmode="numeric" data-num="1" value="${e.cca ?? ""}"></div><div class="field mid"><label>CCA rated</label><input data-k="ccaRated" inputmode="numeric" data-num="1" value="${e.ccaRated ?? (prevT && prevT.ccaRated) ?? ""}" placeholder="on the label"></div></div>
    <div class="form2"><div class="field"><label>Result</label><select data-k="battResult"><option value="">—</option>${BATT_RESULTS.map(x => `<option ${x === e.battResult ? "selected" : ""}>${x}</option>`).join("")}</select><span class="hint">Next test: 12 months after "Good", 3 months after "Weak". "Replace" keeps the reminder showing until a new battery is logged.</span></div><div class="field"><label>Tested by</label><input data-k="workshop" list="shops" value="${esc(e.workshop || "")}" placeholder="Home"><datalist id="shops">${shops.map(l => `<option value="${esc(l)}">`).join("")}</datalist></div></div>`; }
  else if (t === "service") body = `<div class="field"><label>Type of work</label><select data-k="svcType" data-redraw="1">${SVC_TYPES.map(x => `<option ${x === (e.svcType || SVC_TYPES[0]) ? "selected" : ""}>${x}</option>`).join("")}</select><span class="hint">${isSched(e) ? "Restarts the service countdown." : "Kept in the history and sale report, but doesn't change when the next service is due."}</span></div>${odoField}${svcItemsChecks(e, v)}<div class="field"><label>What was done</label><input data-k="desc" value="${esc(e.desc || "")}" placeholder="e.g. 48 mth / 60k logbook service"><div class="qchips" style="margin-top:4px">${SVC_CHIPS.map(c => `<button type="button" data-act="svcChip" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div></div>
    ${usesCharge(v) ? `<div class="field" style="max-width:260px"><label>Dealer battery health check (%) — optional</label><input data-k="dealerSoh" inputmode="decimal" data-num="1" value="${e.dealerSoh ?? ""}" placeholder="e.g. 98"><span class="hint">If the dealer gives a battery state-of-health figure at this service.</span></div>` : ""}
    <div class="form2"><div class="field"><label>Workshop</label><input data-k="workshop" list="shops" value="${esc(e.workshop || "")}"><datalist id="shops">${shops.map(l => `<option value="${esc(l)}">`).join("")}</datalist></div><div class="field mid"><label>Cost $</label><input data-k="cost" inputmode="decimal" data-num="1" value="${e.cost ?? ""}"></div>
    <div class="field"><label>Invoice / job no.</label><input data-k="invoice" value="${esc(e.invoice || "")}"></div><div></div>
    ${isSched(e) ? `<div class="field"><label>Next service due (km)</label><input data-k="nextKm" inputmode="numeric" data-num="1" value="${e.nextKm ?? ""}" placeholder="${v.svcKm ? "auto: +" + v.svcKm.toLocaleString("en-AU") : ""}"></div><div class="field"><label>Next service due (date)</label><input data-k="nextDate" type="date" value="${esc(e.nextDate || "")}"><span class="hint">${v.svcMonths ? `Left blank = ${v.svcMonths} months after the service` : ""}</span></div>` : ""}</div>`;
  else if (t === "expense") { const cats = st.categories.includes(e.category) || !e.category ? st.categories : [e.category, ...st.categories]; const ren = RENEW[e.category];
    body = `<div class="form2"><div class="field"><label>Category</label><select data-k="category" data-redraw="1"><option value="" disabled ${e.category ? "" : "selected"}>— choose —</option>${cats.map(c => `<option ${c === e.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div><div class="field mid"><label>Amount $</label><input data-k="cost" inputmode="decimal" data-num="1" value="${e.cost ?? ""}"></div></div>
    <div class="field"><label>Description</label><input data-k="desc" value="${esc(e.desc || "")}" placeholder="e.g. 4 × Bridgestone tyres"></div>
    ${e.category === "Batteries" && v.kind !== "trailer" ? `<div class="hint" style="margin-top:-4px">Counts as a new 12V battery fitted on this date — the first battery test will be due ${Math.round(st.battFirstMonths / 12 * 10) / 10} years later.</div>` : ""}
    ${ren && !S.sheet.id ? `<div class="field"><label>New ${ren[1]} date</label><input type="date" data-k="_renew" value="${esc(e._renew ?? addMonths(v[ren[0]] && v[ren[0]] > addMonths(e.date, -6) ? v[ren[0]] : e.date, 12))}"><span class="hint">Updates the vehicle's ${ren[1]} (currently ${v[ren[0]] ? fmtDate(v[ren[0]]) : "not set"}). Clear it to leave unchanged.</span></div>` : ""}
    <div class="form2">${usesOdo(v) ? `<div class="field"><label>Odometer (km) — optional</label><input data-k="odo" inputmode="numeric" value="${e.odo ?? ""}" placeholder="${lr ? Math.round(lr.odo) : ""}"></div>` : ""}<div class="field"><label>Receipt / ref</label><input data-k="ref" value="${esc(e.ref || "")}"></div></div>`; }
  const prevQ = v.acqDate && e.date < v.acqDate;
  openSheet(`${sheetHead(S.sheet.id ? "Edit " + TYPE_LABEL[t].toLowerCase() : "Log " + TYPE_LABEL[t].toLowerCase(), `<button type="button" class="btn primary sm" data-act="saveEntry">Save</button>`, "goBack")}
  <div class="wrap sheet-body">
    ${S.sheet.id ? "" : `<div class="vpick">${act.map(x => `<button type="button" aria-pressed="${x.id === e.vehicleId}" data-act="pickVeh" data-id="${x.id}"><b>${esc(vName(x))}</b><small>${esc(x.rego || "")}</small></button>`).join("")}</div>
    <div class="seg" style="grid-template-columns:repeat(${types.length},minmax(0,1fr))">${types.map(x => `<button type="button" aria-pressed="${x === t}" data-act="pickType" data-t="${x}">${IC[x]}${TYPE_LABEL[x]}</button>`).join("")}</div>`}
    <div class="panel">
      <div class="field" style="max-width:220px"><label>Date</label><input type="date" data-k="date" data-redraw="1" value="${esc(e.date)}" max="${todayISO()}"></div>
      ${body}
      <div id="pv"></div>
      <div class="field"><label>Notes</label><textarea data-k="notes" style="min-height:60px">${esc(e.notes || "")}</textarea></div>
      ${prevQ || e.prevOwner != null ? `<label class="check-inline"><input type="checkbox" data-k="prevOwner" ${isPrev(e, v) ? "checked" : ""}> Done by a previous owner (not counted in my costs)</label>` : ""}
      <div><div class="lbl" style="margin-bottom:6px">Receipts / photos</div><div class="files">${(e.receipts || []).map((r, i) => `<div class="fileth">${String(r.type || "").startsWith("image/") ? `<a data-fid="${esc(r.id)}" target="_blank" rel="noopener"><img data-fid="${esc(r.id)}" alt="${esc(r.name)}"></a>` : `<a data-fid="${esc(r.id)}" target="_blank" rel="noopener" style="color:inherit;padding:4px">📄 ${esc(r.name || "PDF")}</a>`}<button type="button" class="x" data-act="rmReceipt" data-i="${i}" aria-label="Remove">×</button></div>`).join("")}<button type="button" class="fileth" style="cursor:pointer;border-style:dashed" data-act="pickReceipt">+ Add</button></div></div>
    </div>
    <div id="warn"></div>
    <button type="button" class="btn primary big" data-act="saveEntry">Save ${TYPE_LABEL[t].toLowerCase()}</button>
    ${S.sheet.id ? (S.sheet.confirmDel ? `<div class="banner bad"><span>Delete this ${TYPE_LABEL[t].toLowerCase()} record?</span><button type="button" class="btn danger sm" data-act="delEntryYes">Delete</button><button type="button" class="btn ghost sm" data-act="delEntryNo">Cancel</button></div>` : `<button type="button" class="btn danger" data-act="delEntry">Delete record</button>`) : ""}
  </div>`);
  livePreview();
  if (!S.sheet.id) { const f = $("#fOdo") || $("#sheet [data-k=litres]"); if (f && matchMedia("(pointer:fine)").matches) f.focus(); }
}
function readEntryForm() {
  const e = S.sheet.draft;
  for (const el of $$("#sheet .sheet-body [data-k]")) { const k = el.dataset.k; let val = el.type === "checkbox" ? el.checked : el.value.trim(); if (el.dataset.num || k === "odo") val = num(val); if (val === "") val = null; e[k] = val; }
  if ($("#sheet [data-svcitem]")) e.items = $$("#sheet [data-svcitem]").filter(x => x.checked).map(x => x.dataset.svcitem);
  return e;
}
function fuelTrio(e) { let { litres: l, cost: c, ppl: p } = e; if (l && c && !p) p = c / l; else if (l && p && c == null) c = r2(l * p); else if (c && p && !l) l = r2(c / p); else if (l && c && p && Math.abs(l * p - c) > 0.05) p = c / l; return { l, c, p }; }
function livePreview() {
  const pv = $("#pv"); if (!pv || !S.sheet || S.sheet.kind !== "entry") return;
  const e = readEntryForm(), v = vById(e.vehicleId); const bits = [];
  if (e.type === "fuel") {
    const pf = prevFuelOdo(v, e), q = fuelTrio(e);
    const ppl = $("#sheet [data-k=ppl]"); if (ppl) ppl.placeholder = q.p && blank(ppl.value) ? (Math.round(q.p * 1000) / 1000).toFixed(3) : "auto";
    if (e.odo != null && pf) bits.push([`${nf(e.odo - pf.odo, 0)}`, "km since last fill"]);
    if (e.odo != null && q.l && e.full !== false) { const tmp = clone(e); tmp.id = tmp.id || "_preview"; tmp.litres = q.l; const saved = S.entries; S.entries = saved.filter(x => x.id !== tmp.id).concat([tmp]); const d = fuelCalc(v).info.get(tmp.id); S.entries = saved; if (d && d.econ != null) bits.push([nf(d.econ), "L/100km"]); }
    if (q.p) bits.push([money(q.p, 3), "per litre"]); if (q.c != null && e.cost == null) bits.push([money(q.c), "total"]); if (q.l && !e.litres) bits.push([nf(q.l, 2), "litres"]);
  } else if (e.type === "odo" || e.type === "service") {
    const lr = lastReadingBefore(v, e); if (e.odo != null && lr) bits.push([(e.odo - lr.odo >= 0 ? "+" : "") + nf(e.odo - lr.odo, 0), `km since ${fmtShort(lr.date)}`]);
    if (e.type === "service" && isSched(e)) { const nk = e.nextKm ?? (v.svcKm && e.odo != null ? e.odo + v.svcKm : null), nd = e.nextDate || (v.svcMonths ? addMonths(e.date, v.svcMonths) : null); if (nk || nd) bits.push([[nk && kmf(nk), nd && fmtDate(nd)].filter(Boolean).join(" / "), "next service due"]); }
  }
  if (e.type === "charge") bits.push(...chargePreview(e, v));
  pv.innerHTML = bits.length ? `<div class="preview">${bits.map(([b, s]) => `<div><b>${esc(b)}</b><small>${esc(s)}</small></div>`).join("")}</div>` : "";
}
function entryWarnings(e, v) {
  const w = [];
  if (e.odo != null) {
    const r = readings(v, e.id), before = r.filter(x => x.date <= e.date), after = r.filter(x => x.date > e.date);
    const b = before[before.length - 1], a = after[0];
    if (b && e.odo < b.odo) w.push(`Odometer ${kmf(e.odo)} is lower than ${kmf(b.odo)} recorded on ${fmtDate(b.date)}.`);
    if (a && e.odo > a.odo) w.push(`Odometer ${kmf(e.odo)} is higher than ${kmf(a.odo)} recorded later, on ${fmtDate(a.date)}.`);
    if (b && e.odo - b.odo > SET().jumpKm && daysBetween(b.date, e.date) < 60) w.push(`That's ${kmf(e.odo - b.odo)} since ${fmtDate(b.date)} — check for a typo.`);
  }
  if (e.type === "fuel" && v.tankL && e.litres > v.tankL * 1.05) w.push(`${nf(e.litres, 2)} L is more than the ${v.tankL} L tank.`);
  if (e.type === "odo" && e.odo == null) w.push("Enter the odometer reading.");
  if (e.type === "charge") w.push(...chargeWarnings(e, v));
  return w;
}
async function saveEntry() {
  const e = readEntryForm(), v = vById(e.vehicleId);
  if (!e.date) { toast("Enter a date"); return; }
  if (e.type === "odo" && e.odo == null) { toast("Enter the odometer reading"); return; }
  if (e.type === "fuel") { if (e.odo == null && usesOdo(v)) { toast("Enter the odometer or trip km"); return; } const q = fuelTrio(e); e.litres = q.l ?? null; e.cost = q.c ?? null; e.ppl = q.p != null ? Math.round(q.p * 10000) / 10000 : null; }
  if (isBT(e) && !e.desc) e.desc = "12V battery test";
  if (e.type === "service" && !e.desc && e.cost == null && e.odo == null) { toast("Add what was done, the cost or the odometer"); return; }
  if (e.type === "expense" && !e.category) { toast("Choose a category"); $("#sheet [data-k=category]").focus(); return; }
  if (e.type === "expense" && e.cost == null && !e.desc) { toast("Enter an amount or description"); return; }
  if (e.type === "charge") {
    if (e.kwh == null) { toast("Enter the kWh"); return; }
    if (e.odo == null && usesOdo(v)) { toast("Enter the odometer"); return; }
    if (e.lowFull && (e.socStart == null || e.socEnd == null)) { toast("Enter the start and end %"); return; }
  }
  const w = entryWarnings(e, v); const sig = w.join("|");
  if (w.length && S.sheet.warned !== sig) { S.sheet.warned = sig; $("#warn").innerHTML = `<div class="banner bad"><span><b>Please check:</b><ul>${w.map(x => `<li>${esc(x)}</li>`).join("")}</ul>Tap Save again to keep it anyway.</span></div>`; $("#warn").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  if (e.type === "service" && !isSched(e)) { delete e.nextKm; delete e.nextDate; }
  if (e.type === "service" && e.svcType === SVC_TYPES[0]) delete e.svcType;
  if (e.type === "service" && isSched(e)) { if (e.nextKm == null && v.svcKm && e.odo != null) e.nextKm = e.odo + v.svcKm; if (!e.nextDate && v.svcMonths) e.nextDate = addMonths(e.date, v.svcMonths); }
  if (e.prevOwner != null && v.acqDate && (e.date < v.acqDate) === e.prevOwner) delete e.prevOwner;
  const renew = e._renew; const ren = RENEW[e.category];
  for (const k of Object.keys(e)) if (k.startsWith("_") || e[k] === null) delete e[k];
  if (e.type === "charge") prepCharge(e);
  if (e.type !== "charge") for (const k of CH_KEYS) delete e[k];
  if (e.type !== "fuel") { delete e.full; delete e.towing; delete e.litres; delete e.ppl; delete e.grade; if (e.type !== "charge") delete e.location; }
  if (e.type !== "service") { delete e.nextKm; delete e.nextDate; delete e.workshop; delete e.invoice; delete e.items; delete e.dealerSoh; delete e.svcType; }
  if (e.type !== "expense") { delete e.category; delete e.ref; }
  if (!isBT(e)) for (const k of BT_KEYS) delete e[k];
  e.id = e.id || uid("e"); e.created = e.created || Date.now(); e.updated = Date.now();
  await dbPut("entries", e);
  { const pv = vById(e.vehicleId); if (pv && pv.parkedSince) { const nv = clone(pv); delete nv.parkedSince; await dbPut("vehicles", nv); } }
  if (e.type === "expense" && ren && renew && !S.sheet.id) { const nv = clone(v); nv[ren[0]] = renew; await dbPut("vehicles", nv); }
  S.meta.lastVid = e.vehicleId; await saveMeta();
  await reload(); askPersist(); _fcache.clear();
  let msg = "Saved";
  if (e.type === "fuel") { const d = fuelOf(vById(e.vehicleId)).info.get(e.id); msg = d && d.econ != null ? `Saved · ${nf(d.econ)} L/100km over ${nf(d.segKm, 0)} km` : "Fill-up saved"; }
  if (e.type === "charge") { const cr = capReading(e, v), hp = homePeriod(v, e); msg = cr ? `Saved · battery estimate ${nf(cr.cap, 1)} kWh${cr.pct != null ? ` (${nf(cr.pct, 0)}%)` : ""}` : hp ? `Saved · ${nf(hp.econ)} kWh/100km over ${nf(hp.km, 0)} km` : "Charge saved"; }
  toast(msg);
  if (S.sheet.back) goBack(); else if (S.sheet.quick) openVehicle(e.vehicleId); else { closeSheet(); render(); }
}
async function addReceipts(files) {
  readEntryForm(); const e = S.sheet.draft;
  for (const f of files) { let blob = f, type = f.type || "application/octet-stream"; if (type.startsWith("image/")) { try { blob = await resizeImage(f, 2000); type = "image/jpeg"; } catch {} } const id = uid("f"); await dbPut("files", { id, blob, type, name: f.name }); (e.receipts = e.receipts || []).push({ id, name: f.name, type }); }
  drawEntry();
}
async function resizeImage(file, max = 1600) { const bmp = await createImageBitmap(file); const s = Math.min(1, max / Math.max(bmp.width, bmp.height)); const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); return await new Promise(r => c.toBlob(r, "image/jpeg", 0.82)); }

/* ================= due tab ================= */
function viewDue() {
  const r = allReminders();
  if (!r.length) return `<section class="view"><div class="empty">Nothing to track yet. Add rego and insurance expiry dates and a service interval to each vehicle (Edit), and log services.</div></section>`;
  const grp = [["over", "Overdue"], ["soon", "Due soon"], ["ok", "Coming up"]];
  return `<section class="view">${grp.map(([k, l]) => { const x = r.filter(y => y.status === k); return x.length ? `<div><h2 style="font-size:20px;margin-bottom:8px">${l}</h2><div class="duelist">${x.map(dueRow).join("")}</div></div>` : ""; }).join("")}
  <p class="small muted" style="margin:0">"Due soon" means within ${SET().dueDays} days or ${kmf(SET().dueKm)}. Service km is projected from each vehicle's recent average daily km. Change these under More → Settings.</p></section>`;
}

/* ================= stats ================= */
function svgLine(pts, { h = 170, yfmt = x => nf(x), color = "var(--accent)", hlColor = "var(--amber)", avg, lo, hi } = {}) {
  if (pts.length < 2) return `<p class="muted small">Not enough data yet.</p>`;
  const W = 420, H = h, L = 44, R = 8, T = 10, B = 24;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y); let x0 = Math.min(...xs), x1 = Math.max(...xs); let y0 = Math.min(...ys, lo ?? Infinity, avg ?? Infinity), y1 = Math.max(...ys, hi ?? -Infinity, avg ?? -Infinity); if (y1 === y0) { y1 += 1; y0 -= 1; } const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad; if (x1 === x0) x1 = x0 + 1;
  const X = x => L + (x - x0) / (x1 - x0) * (W - L - R), Y = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const ticks = [y0 + (y1 - y0) * 0.1, (y0 + y1) / 2, y1 - (y1 - y0) * 0.1];
  const d = pts.map((p, i) => (i ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.y).toFixed(1)).join("");
  const dt = x => { const z = new Date(x); return MON[z.getMonth()] + " " + String(z.getFullYear()).slice(2); };
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L - 6}" y="${Y(t) + 5}" text-anchor="end">${yfmt(t)}</text>`).join("")}
  ${avg != null ? `<line x1="${L}" x2="${W - R}" y1="${Y(avg)}" y2="${Y(avg)}" stroke="var(--ink-3)" stroke-dasharray="4 4"/>` : ""}
  <path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>${pts.map(p => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p.hl ? 4.5 : 3}" fill="${p.c || (p.hl ? hlColor : color)}"><title>${esc(p.t || "")}</title></circle>`).join("")}
  <text x="${L}" y="${H - 4}">${dt(x0)}</text><text x="${W - R}" y="${H - 4}" text-anchor="end">${dt(x1)}</text></svg>`;
}
function svgBars(labels, vals, { h = 150, yfmt = x => nf(x, 0), color = "var(--accent)" } = {}) {
  if (!vals.some(x => x)) return `<p class="muted small">Nothing in this period.</p>`;
  const W = 420, H = h, L = 44, R = 4, T = 8, B = 24, n = vals.length, max = Math.max(...vals) * 1.08, bw = (W - L - R) / n;
  const Y = y => T + (1 - y / max) * (H - T - B); const every = Math.ceil(n / 6);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${[max / 2, max / 1.08].map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L - 6}" y="${Y(t) + 5}" text-anchor="end">${yfmt(t)}</text>`).join("")}
  ${vals.map((v, i) => `<rect x="${(L + i * bw + bw * 0.14).toFixed(1)}" y="${Y(v).toFixed(1)}" width="${(bw * 0.72).toFixed(1)}" height="${(H - B - Y(v)).toFixed(1)}" rx="2" fill="${color}"><title>${esc(labels[i])}: ${yfmt(v)}</title></rect>`).join("")}
  ${labels.map((l, i) => i % every === 0 ? `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>` : "").join("")}</svg>`;
}
function hbars(obj, fmt = money0) { const e = Object.entries(obj).filter(x => x[1]).sort((a, b) => b[1] - a[1]); if (!e.length) return `<p class="muted small">Nothing in this period.</p>`; const max = Math.max(...e.map(x => x[1])); return `<div class="bars">${e.map(([k, v]) => `<div class="hb"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${(v / max * 100).toFixed(1)}%"></div></div><span class="v">${fmt(v)}</span></div>`).join("")}</div>`; }
function monthsIn(from, to) { const out = []; let d = parseISO(from); d.setDate(1); const end = parseISO(to); while (d <= end && out.length < 600) { out.push(isoOf(d).slice(0, 7)); d.setMonth(d.getMonth() + 1); } return out; }
function viewStats() {
  if (!S.vehicles.length) return `<section class="view"><div class="empty">Add a vehicle first.</div></section>`;
  const vid = S.stat.vid, v = vById(vid), p = S.stat.period;
  const [from, to, plabel] = periodRange(p, v);
  const pick = `<div class="chips scroll"><button type="button" class="chip" aria-pressed="${!v}" data-act="statV" data-id="all">All vehicles</button>${sortedV().filter(x => isActive(x) || x.id === vid).map(x => `<button type="button" class="chip" aria-pressed="${x.id === vid}" data-act="statV" data-id="${x.id}">${esc(vName(x))}</button>`).join("")}</div>
  <div class="chips scroll">${[["12m", "12 months"], ["fy", "This FY"], ["lfy", "Last FY"], ["year", "This year"], ["all", "All time"]].map(([k, l]) => `<button type="button" class="chip" aria-pressed="${p === k}" data-act="statP" data-p="${k}">${l}</button>`).join("")}</div>`;
  const months = monthsIn(from, to > todayISO() ? todayISO() : to); const mlab = months.map(m => MON[+m.slice(5) - 1] + (months.length > 12 ? " " + m.slice(2, 4) : ""));
  if (!v) {
    const rows = sortedV().filter(x => isActive(x) || (x.sold && x.sold.date >= from)).map(x => [x, vStats(x, from, to)]);
    const cats = {}; let tf = 0, ts = 0, te = 0, tk = 0; for (const [, s] of rows) { tf += s.fuelCost + s.chargeCost; ts += s.svcCost; te += s.expCost; tk += s.km || 0; for (const [c, a] of Object.entries(s.cats)) cats[c] = (cats[c] || 0) + a; }
    if (tf) cats["Fuel & charging"] = tf; if (ts) cats["Servicing"] = ts;
    const spend = months.map(m => rows.reduce((s, [, st]) => s + st.es.filter(e => e.date.slice(0, 7) === m).reduce((a, e) => a + costOf(e), 0), 0));
    return `<section class="view">${pick}<div class="lbl">${esc(plabel)} · ${fmtDate(from)} – ${fmtDate(to)}</div>
    <div class="tiles"><div><span class="lbl">Total spent</span><b>${money0(tf + ts + te)}</b><small>all vehicles</small></div><div><span class="lbl">Fuel &amp; charging</span><b>${money0(tf)}</b></div><div><span class="lbl">Servicing</span><b>${money0(ts)}</b></div><div><span class="lbl">Other</span><b>${money0(te)}</b><small>rego, insurance, tyres…</small></div><div><span class="lbl">Km driven</span><b>${kmf(tk)}</b><small>all vehicles</small></div></div>
    <div class="tbl"><table><thead><tr><th>Vehicle</th><th>Km</th><th>Fuel/EV</th><th>Service</th><th>Other</th><th>Total</th><th>$/km</th></tr></thead><tbody>${rows.map(([x, s]) => `<tr><td>${esc(vName(x))}</td><td>${s.km != null ? nf(s.km, 0) : "—"}</td><td>${money0(s.fuelCost + s.chargeCost)}</td><td>${money0(s.svcCost)}</td><td>${money0(s.expCost)}</td><td><b>${money0(s.total)}</b></td><td>${s.perKm ? money(s.perKm) : "—"}</td></tr>`).join("")}</tbody></table></div>
    <div class="panel"><h3>Spending by month</h3>${svgBars(mlab, spend, { yfmt: money0 })}</div>
    <div class="panel"><h3>Where the money went</h3>${hbars(cats)}</div></section>`;
  }
  const s = vStats(v, from, to), fc = fuelOf(v);
  const tiles = [];
  if (usesOdo(v)) { tiles.push(["Km driven", s.km != null ? kmf(s.km) : "—", "estimated from readings"]); const days = Math.max(1, daysBetween(from < (ownStart(v) || {}).date ? ownStart(v).date : from, to > todayISO() ? todayISO() : to)); tiles.push(["Per month", s.km != null ? kmf(s.km / days * 30.44) : "—", ""]); }
  if (usesFuel(v)) { tiles.push(["Economy", s.econNoTow ? nf(s.econNoTow.econ) + " L/100" : "—", s.econNoTow ? `not towing · ${kmf(s.econNoTow.km)}` : "not towing"]); tiles.push(["Towing", s.econTow ? nf(s.econTow.econ) + " L/100" : "—", s.econTow ? kmf(s.econTow.km) : "no towing fills"]); tiles.push(["Fuel bought", nf(s.litres, 0) + " L", s.fuel.length + " fill-ups"]); tiles.push(["Fuel cost", money0(s.fuelCost), s.ppl ? `avg ${money(s.ppl, 3)}/L` : ""]); }
  if (usesCharge(v)) tiles.push(...evStatTiles(v, s));
  tiles.push(["Servicing", money0(s.svcCost), s.svc.length + " service" + (s.svc.length === 1 ? "" : "s")]); tiles.push(["Other costs", money0(s.expCost), Object.keys(s.cats).length ? Object.keys(s.cats).slice(0, 3).join(", ") : ""]); tiles.push(["Total", money0(s.total), s.perKm ? money(s.perKm) + " per km" : ""]);
  const segs = fc.segs.filter(x => !x.prev && x.date >= from && x.date <= to);
  const econPts = segs.map(x => ({ x: parseISO(x.date).getTime(), y: x.l / x.km * 100, hl: x.tow, t: `${fmtDate(x.date)}: ${nf(x.l / x.km * 100)} L/100km${x.tow ? " (towing)" : ""}` }));
  const pplPts = s.fuel.filter(e => e.ppl).map(e => ({ x: parseISO(e.date).getTime(), y: e.ppl, t: `${fmtDate(e.date)}: ${money(e.ppl, 3)}/L` }));
  const r = readings(v); const kmM = months.map(m => { const a = m + "-01", b0 = parseISO(a); b0.setMonth(b0.getMonth() + 1); const b = isoOf(b0); const k = kmBetween(v, a, b); return k || 0; });
  const spend = months.map(m => s.es.filter(e => e.date.slice(0, 7) === m).reduce((a, e) => a + costOf(e), 0));
  const cats = Object.assign({}, s.cats); if (s.fuelCost) cats.Fuel = s.fuelCost; if (s.chargeCost) cats.Charging = s.chargeCost; if (s.svcCost) cats.Servicing = s.svcCost;
  return `<section class="view">${pick}<div class="lbl">${esc(plabel)} · ${fmtDate(from)} – ${fmtDate(to)}</div>
  <div class="tiles">${tiles.map(([k, b, sm]) => `<div><span class="lbl">${k}</span><b>${b}</b><small>${esc(sm)}</small></div>`).join("")}</div>
  ${usesFuel(v) ? `<div class="panel"><h3>Fuel economy per fill (L/100km)</h3>${svgLine(econPts, { avg: s.econNoTow && s.econNoTow.econ })}<div class="legend"><span><i style="background:var(--accent)"></i>Not towing</span><span><i style="background:var(--amber)"></i>Towing</span><span>– – average not towing</span></div></div>` : ""}
  ${usesCharge(v) ? evCharts(v, from, to, months, mlab) : ""}
  ${usesOdo(v) && r.length > 1 ? `<div class="panel"><h3>Km per month</h3>${svgBars(mlab, kmM)}<div class="small muted">Spread between odometer readings, so months between fill-ups are averaged.</div></div>` : ""}
  <div class="panel"><h3>Spending by month</h3>${svgBars(mlab, spend, { yfmt: money0, color: "var(--amber)" })}</div>
  <div class="panel"><h3>Where the money went</h3>${hbars(cats)}</div>
  ${usesFuel(v) ? `<div class="panel"><h3>Fuel price paid ($/L)</h3>${svgLine(pplPts, { yfmt: x => "$" + x.toFixed(2), color: "var(--ink-2)" })}</div>` : ""}
  </section>`;
}

/* ================= more ================= */
const backMore = `<div><button type="button" class="btn ghost sm" data-act="moreHome">‹ More</button></div>`;
function viewMore() {
  const mv = S.moreView;
  if (mv === "backup") return viewBackup(); if (mv === "settings") return viewSettings(); if (mv === "export") return viewExport(); if (mv === "help") return viewHelp(); if (mv === "reports") return viewReportPick();
  return `<section class="view">${backupBanner()}<div class="menu">
    <button type="button" data-act="moreGo" data-v="reports"><b>Reports</b><span class="small muted">Sale report for buyers, full ownership report — print or save as PDF</span></button>
    <button type="button" data-act="moreGo" data-v="backup"><b>Backup &amp; restore</b><span class="small muted">${dbxOn() ? "Kept in Dropbox · " + esc(syncText().t) : S.meta.lastBackup ? "Last backup " + fmtDate(S.meta.lastBackup.slice(0, 10)) : "Not backed up yet"}</span></button>
    <button type="button" data-act="moreGo" data-v="export"><b>Export to Excel (CSV)</b><span class="small muted">Every record as a spreadsheet</span></button>
    <button type="button" data-act="moreGo" data-v="settings"><b>Settings</b><span class="small muted">Expense categories, reminder windows</span></button>
    <button type="button" data-act="newVehicle"><b>Add a vehicle</b><span class="small muted">Car, motorbike, trailer…</span></button>
    <button type="button" data-act="moreGo" data-v="help"><b>How it works</b><span class="small muted">Economy maths, reminders, storage</span></button>
  </div>
  <div class="row small muted"><span>MyGarage version <b>${APP_VERSION}</b></span><span class="sp"></span><button type="button" class="btn sm ghost" data-act="checkUpdate">Check for update</button></div></section>`;
}
function viewSettings() {
  const st = SET();
  return `<section class="view">${backMore}<div class="panel"><h3>Expense categories</h3><p class="small muted" style="margin:0">One per line. Registration, CTP and Insurance also offer to update the expiry date when you log them. Renaming a category doesn't change past records.</p><textarea class="csv" id="setCats" style="font-family:var(--f-body);font-size:14px;min-height:240px">${esc(st.categories.join("\n"))}</textarea></div>
  <div class="panel"><h3>Reminders &amp; checks</h3><div class="form"><div class="field"><label>"Due soon" within (days)</label><input id="setDays" inputmode="numeric" value="${st.dueDays}"></div><div class="field"><label>"Service due soon" within (km)</label><input id="setKm" inputmode="numeric" value="${st.dueKm}"></div><div class="field"><label>Remind me to back up after (days)</label><input id="setBk" inputmode="numeric" value="${st.backupDays}"></div><div class="field"><label>Warn if odometer jumps more than (km)</label><input id="setJump" inputmode="numeric" value="${st.jumpKm}"></div><div class="field"><label>12V battery: first test after (months)</label><input id="setBat1" inputmode="numeric" value="${st.battFirstMonths}"></div><div class="field"><label>…then test every (months)</label><input id="setBat2" inputmode="numeric" value="${st.battEveryMonths}"></div></div></div>
  <div class="panel"><h3>Electric vehicles</h3><div class="form">
    <div class="field full"><label>Home charging rate ($ per kWh)</label><input id="setRate" inputmode="decimal" value="${st.homeRate ?? ""}" placeholder="blank = don't cost home charging"><span class="hint">One blended figure, e.g. 0.08. With Amber, solar surplus is often worth only cents; grid top-ups cost more. Saved entries keep the rate they were costed at.</span></div>
    <div class="field"><label>Home AC charging efficiency %</label><input id="setEffAC" inputmode="numeric" value="${st.effAC}"></div><div class="field"><label>Public DC charging efficiency %</label><input id="setEffDC" inputmode="numeric" value="${st.effDC}"></div>
    <div class="field"><label>Warn before a warranty ends (days)</label><input id="setWarn" inputmode="numeric" value="${st.warnDays}"></div><div class="field"><label>"No update" warning after (days)</label><input id="setNoUpd" inputmode="numeric" value="${st.noUpdateDays}"></div>
    <div class="field"><label>Low-charge reminder due after (months)</label><input id="setLow1" inputmode="numeric" value="${st.lowSoonMonths}"></div><div class="field"><label>…and overdue after (months)</label><input id="setLow2" inputmode="numeric" value="${st.lowOverMonths}"></div></div></div>
  <div class="panel"><h3>Sale report contact line</h3><div class="field"><label>Shown at the bottom of sale reports (optional)</label><input id="setContact" value="${esc(st.contact)}" placeholder="e.g. Shaun — 04xx xxx xxx"></div></div>
  <div><button type="button" class="btn primary" data-act="saveSettings">Save settings</button></div></section>`;
}
async function saveSettings() {
  const s = SET(); s.categories = $("#setCats").value.split("\n").map(x => x.trim()).filter(Boolean); s.dueDays = num($("#setDays").value) ?? 30; s.dueKm = num($("#setKm").value) ?? 1000; s.backupDays = num($("#setBk").value) ?? 30; s.jumpKm = num($("#setJump").value) ?? 3000; s.contact = $("#setContact").value.trim();
  s.homeRate = num($("#setRate").value); s.effAC = num($("#setEffAC").value) ?? 90; s.effDC = num($("#setEffDC").value) ?? 95; s.warnDays = num($("#setWarn").value) ?? 90; s.noUpdateDays = num($("#setNoUpd").value) ?? 35; s.lowSoonMonths = num($("#setLow1").value) ?? 3; s.lowOverMonths = num($("#setLow2").value) ?? 6; s.battFirstMonths = num($("#setBat1").value) ?? 36; s.battEveryMonths = num($("#setBat2").value) ?? 12;
  s._t = Date.now(); S.meta.settings = s; await saveMeta(); markDirty(); toast("Settings saved"); render();
}
function viewHelp() {
  return `<section class="view">${backMore}<div class="panel help"><h3>How it works</h3>
  <h4>Logging a fill-up</h4><p>Tap the round <b>Log</b> button. It opens on your last-used vehicle. Type the odometer — or the trip-meter km since your last fill and the odometer is worked out. Enter any two of litres, total $ and $/L; the third is calculated.</p>
  <h4>Fuel economy</h4><p>Worked out "full to full": the litres you put in, divided by the km since the previous full tank. If you only part-fill, untick <b>Filled to full</b> — those litres are added to the next full fill, so the figure stays right. Fills marked <b>towing</b> are averaged separately. A fill well away from the vehicle's usual figure is tagged <span class="tag soon">check</span> — usually a missed or part fill.</p>
  <h4>Km driven</h4><p>Every record with an odometer reading (fuel, services, odometer-only readings) feeds the km figures. Km per month is spread evenly between readings.</p>
  <h4>Previous owners</h4><p>Anything dated before the purchase date is treated as a previous owner's record: it shows in the service history (and the sale report) but isn't counted in your costs.</p>
  <h4>Reminders</h4><p>Rego, CTP and insurance come from the expiry dates on the vehicle. When you log a Registration, CTP or Insurance expense you can update the expiry in the same step. Service due comes from the last service's "next due" km and date; the km is projected using your recent average.</p>
  <h4>Electric vehicles — logging</h4><p><b>Home:</b> once a month, log a Charge → Home with the month's kWh from the Evnex app and the odometer. <b>Public:</b> log each one from the receipt. Energy use (kWh/100km) is measured at the plug, so it reads a little above the car's own figure — slow solar charging loses a bigger share to the car's electronics.</p>
  <p><b>Battery health:</b> when you do the handbook's full charge from below 10%, tick that box and enter the start %, end % and the kWh for that session. Estimate = kWh × charging efficiency ÷ % charged. Readings below 10°C are less reliable (the handbook notes the % can jump in the cold). A dealer battery check is the authoritative figure.</p>
  <h4>BYD Atto 1 battery rules (owner's handbook)</h4><p>• Charge to full at least once a week, and fully charge from below 10% every 3–6 months (p.83).<br>• Low-power charging helps battery life (p.83).<br>• Parked over 7 days: keep the battery at 40–60%. Parked over 3 months: charge to full, then run down to 40–60%, every 3 months — damage from not doing this isn't covered by warranty (p.84).<br>• If the display reaches 0, recharge within 7 days or the battery is permanently damaged and not covered by warranty (p.86).<br>• The % shown may be wrong when new or after a long idle period — charge to full first (p.83).</p>
  <p>Tap <b>Parked from today</b> on the vehicle when it'll sit unused; the 7-day and 3-month reminders run from then and it clears itself when you next log anything. If nothing at all is logged for ${SET().noUpdateDays} days you'll get a reminder too.</p>
  <h4>Warranty</h4><p>Enter the start date (first registration) and years/km on the vehicle. The Due tab warns ${SET().warnDays} days before a warranty ends, or when your average driving will reach its km limit within that time. Expired cover shows on the vehicle page only.</p>
  <h4>Scheduled items</h4><p>For work not done at every service (brake fluid, coolant, the Kluger's hybrid health check), add items on the vehicle (Edit → Service items). Tick them when you log a service; each tracks its own next due date and km.</p>
  <h4>Where your data is</h4><p>On this phone, in Chrome's storage for this app — and, once connected, in your own Dropbox (Apps › MyGarage), updated within seconds of every change with a snapshot each day. New phone or cleared Chrome: tap <b>Get my vehicles from Dropbox</b>. Nothing is sent anywhere else. Clearing Chrome's <b>Cookies and site data</b> (or uninstalling Chrome) deletes the copy on this phone — Dropbox, or a backup file, is how it comes back.</p></div></section>`;
}
/* backup */
function viewBackup() {
  const last = S.meta.lastBackup;
  return `<section class="view">${backMore}
  ${dropboxPanel()}
  <div class="panel"><h3>Backup file</h3><p style="margin:0">Makes one .zip file with every vehicle, record, photo and receipt${dbxOn() ? " — an extra copy you can keep anywhere, e.g. on the QNAP" : ". Save it to Dropbox, Google Drive or the QNAP, or email it to yourself"}.</p>
    <div class="muted small">${last ? `Last backup: ${fmtDate(last.slice(0, 10))}` : "No backup made on this phone yet."}</div>
    <div class="row"><button type="button" class="btn primary" data-act="makeBackup">Make backup file</button><span class="muted small" id="bkStat"></span></div><div id="bkOut" class="row"></div></div>
  <div class="panel"><h3>Restore from a file</h3><p style="margin:0">Loads a backup file onto this phone. It <b>replaces</b> everything currently in the app.${dbxOn() ? " A snapshot of what's here now is saved to Dropbox first." : ""}</p>
    <div class="row"><button type="button" class="btn" data-act="pickRestore">Choose backup file…</button><span class="muted small" id="rsStat"></span></div><div id="rsConfirm"></div></div>
  <div class="panel"><h3>Storage</h3><dl class="kv" id="storeInfo"></dl></div></section>`;
}
let _backup = null, _restore = null;
async function makeBackup() {
  const st = $("#bkStat"); st.textContent = "Packing…";
  const zip = new JSZip(); const files = await dbAll("files"); const manifest = [];
  for (const f of files) { const ext = (f.type === "image/jpeg" ? "jpg" : f.type === "image/png" ? "png" : f.type === "application/pdf" ? "pdf" : (String(f.name || "").split(".").pop() || "bin")).toLowerCase(); const path = `files/${f.id}.${ext}`; zip.file(path, f.blob); manifest.push({ id: f.id, type: f.type, name: f.name, path }); }
  const data = { app: APP_ID, version: BACKUP_VERSION, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), settings: S.meta.settings || null, vehicles: S.vehicles, entries: S.entries, files: manifest };
  zip.file("backup.json", JSON.stringify(data, null, 1));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const name = `mygarage-backup-${todayISO()}.zip`; _backup = { blob, name };
  const url = URL.createObjectURL(blob); const file = new File([blob], name, { type: "application/zip" });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  $("#bkOut").innerHTML = `<a class="btn primary" href="${url}" download="${esc(name)}" data-act="dlBackup">Save to phone</a>${canShare ? `<button type="button" class="btn" data-act="shareBackup">Share to Drive / email…</button>` : ""}<span class="muted small">${(blob.size / 1048576).toFixed(2)} MB · ${S.vehicles.length} vehicles · ${S.entries.length} records · ${files.length} files</span>`;
  st.textContent = "";
}
async function readRestore(file) {
  const st = $("#rsStat") || {}; st.textContent = "Reading…";
  try {
    const zip = await JSZip.loadAsync(file); const j = zip.file("backup.json"); if (!j) throw new Error("This isn't a MyGarage backup (no backup.json inside).");
    const data = JSON.parse(await j.async("string")); if (data.app !== APP_ID) throw new Error("This file is from a different app.");
    _restore = { zip, data };
    if (S.tab !== "more" || S.moreView !== "backup") { closeSheet(); S.tab = "more"; S.moreView = "backup"; render(); }
    $("#rsConfirm").innerHTML = `<div class="banner" style="margin-top:8px"><span>Backup from ${fmtDate(String(data.exportedAt).slice(0, 10))}: ${data.vehicles.length} vehicles, ${data.entries.length} records, ${data.files.length} photos/receipts. This replaces what's on this phone${S.entries.length ? ` (${S.vehicles.length} vehicles, ${S.entries.length} records)` : ""}.</span><button type="button" class="btn primary sm" data-act="rsYes">Restore</button><button type="button" class="btn ghost sm" data-act="rsNo">Cancel</button></div>`;
    $("#rsStat").textContent = "";
  } catch (e) { if ($("#rsStat")) $("#rsStat").textContent = ""; toast(e.message || "That file couldn't be read."); }
}
async function doRestore() {
  const { zip, data } = _restore; const st = $("#rsStat"); st.textContent = "Restoring…";
  if (!(await snapshotBeforeReplace())) { st.textContent = ""; return; }
  _quiet++;
  try {
  for (const s of ["vehicles", "entries", "files"]) await dbClear(s);
  for (const u of Object.values(S.urls)) URL.revokeObjectURL(u); S.urls = {};
  let n = 0; for (const f of data.files) { const z = zip.file(f.path); if (!z) continue; const b = await z.async("blob"); await dbPut("files", { id: f.id, type: f.type, name: f.name, blob: new Blob([b], { type: f.type }) }); if (++n % 10 === 0) st.textContent = `Restoring files ${n} of ${data.files.length}…`; }
  for (const v of data.vehicles) await dbPut("vehicles", v); for (const e of data.entries) await dbPut("entries", e);
  } finally { _quiet--; }
  if (data.settings) S.meta.settings = data.settings; S.meta.lastBackup = data.exportedAt; S.meta.conflict = null; S.meta.tomb = {}; S.meta.gen = uid("g"); S.meta.genPending = true; await saveMeta(); markDirty();
  _restore = null; await reload(); await migrateData(); askPersist(); S.tab = "garage"; S.moreView = null; render(); toast(`Restored ${data.vehicles.length} vehicles, ${data.entries.length} records`);
}
async function saveMeta() { S.meta.stamp = Date.now(); await dbPut("meta", { id: "main", ...S.meta }); }
async function fillStoreInfo() { const el = $("#storeInfo"); if (!el) return; let used = "Unknown", prot = "Unknown"; try { const e = await navigator.storage.estimate(); used = (e.usage / 1048576).toFixed(1) + " MB"; } catch {} try { prot = (await navigator.storage.persisted()) ? "Yes — Chrome won't clear it to save space" : "Not yet — requested when you save"; } catch {} el.innerHTML = `<dt>Storage used</dt><dd>${used}</dd><dt>Protected storage</dt><dd>${prot}</dd>`; }
async function askPersist() { try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {} }
/* CSV */
const CSV_COLS = [["vehicle", e => vName(vById(e.vehicleId))], ["rego", e => (vById(e.vehicleId) || {}).rego], ["type", e => TYPE_LABEL[e.type]], ["date"], ["odometer", e => e.odo], ["category", e => e.type === "expense" ? e.category : e.type === "fuel" ? "Fuel" : e.type === "charge" ? "Charging" : e.type === "service" ? "Service" : ""], ["description", e => e.desc], ["cost", e => e.cost], ["litres"], ["pricePerLitre", e => e.ppl], ["fullTank", e => e.type === "fuel" ? (e.full !== false ? "Y" : "N") : ""], ["towing", e => e.towing ? "Y" : ""], ["L100km", e => { const d = fuelOf(vById(e.vehicleId)).info.get(e.id); return d && d.econ != null ? d.econ.toFixed(2) : ""; }], ["location"], ["grade"], ["workshop"], ["invoice", e => e.invoice || e.ref], ["nextServiceKm", e => e.nextKm], ["nextServiceDate", e => e.nextDate], ["priorOwner", e => isPrev(e, vById(e.vehicleId)) ? "Y" : ""], ["kWh", e => e.kwh], ["chargeWhere", e => e.where], ["charger", e => e.current], ["socStart"], ["socEnd"], ["sessionKwh", e => e.sessKwh], ["estCapacityKwh", e => { const c = capReading(e, vById(e.vehicleId)); return c ? c.cap.toFixed(2) : ""; }], ["costEstimated", e => e.costEst ? "Y" : ""], ["dealerBatteryPct", e => e.dealerSoh], ["notes"], ["receipts", e => (e.receipts || []).length || ""]];
function toCSV() { const q = v => { v = v == null ? "" : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }; const rows = [...S.entries].sort((a, b) => vName(vById(a.vehicleId)).localeCompare(vName(vById(b.vehicleId))) || byDateOdo(a, b)); return "﻿" + [CSV_COLS.map(c => c[0]).join(","), ...rows.map(e => CSV_COLS.map(([k, fn]) => q(fn ? fn(e) : e[k])).join(","))].join("\r\n"); }
function viewExport() { const csv = toCSV(); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); return `<section class="view">${backMore}<div class="panel"><h3>Export CSV</h3><p style="margin:0">${S.entries.length} records across ${S.vehicles.length} vehicles. Opens in Excel. This is a spreadsheet copy, not a backup — receipts aren't included and it can't be restored.</p><div class="row"><a class="btn primary" href="${url}" download="garage-records-${todayISO()}.csv">Save CSV</a></div><textarea class="csv" readonly aria-label="CSV text">${esc(csv.slice(1, 4000))}${csv.length > 4000 ? "\n…" : ""}</textarea></div></section>`; }

/* ================= reports ================= */
function viewReportPick() { return `<section class="view">${backMore}<div class="panel"><h3>Reports</h3><p class="small muted" style="margin:0">Pick a vehicle. You can then choose a sale report (for buyers) or a full ownership report (for you), preview it and save it as a PDF.</p><div class="list">${sortedV().map(v => `<button type="button" class="vcard" data-act="reportFor" data-id="${v.id}"><div class="vtop"><div class="thumb">${kindIcon(v)}</div><div><h3>${esc(vName(v))}</h3><div class="vmeta">${esc(v.rego || "")} ${!isActive(v) ? "· " + esc(v.status) : ""}</div></div></div></button>`).join("")}</div></div></section>`; }
function openReport(vid) {
  const v = vById(vid); const back = S.sheet && S.sheet.kind === "vehicle" ? { kind: "vehicle", id: vid } : null;
  S.sheet = { kind: "report", id: vid, back, o: Object.assign({ type: "sale", costs: true, prior: true, maint: true, fuel: usesFuel(v), photo: !!v.photo, asking: true, fuelLog: false, contact: true }, (S.meta.reportOpts || {})) };
  drawReport();
}
function drawReport() {
  const v = vById(S.sheet.id), o = S.sheet.o;
  const opt = (k, l) => `<label class="check-inline"><input type="checkbox" data-ro="${k}" ${o[k] ? "checked" : ""}> ${l}</label>`;
  openSheet(`${sheetHead("Report · " + vName(v), `<button type="button" class="btn primary sm" data-act="printReport">Print / PDF</button>`, "goBack")}
  <div class="wrap sheet-body"><div class="panel"><div class="seg" style="grid-template-columns:1fr 1fr"><button type="button" aria-pressed="${o.type === "sale"}" data-act="rtype" data-t="sale">Sale report<span class="small" style="font-weight:400">for buyers</span></button><button type="button" aria-pressed="${o.type === "own"}" data-act="rtype" data-t="own">Ownership report<span class="small" style="font-weight:400">all costs, for me</span></button></div>
  <div class="toggles">${o.type === "sale" ? opt("costs", "Show service costs") + opt("prior", "Include previous owners' services") + opt("maint", "Repairs, tyres &amp; batteries") + (usesFuel(v) ? opt("fuel", "Fuel economy summary") : "") + (v.photo ? opt("photo", "Photo") : "") + opt("asking", "Asking price") + opt("contact", "Contact line") : (usesFuel(v) ? opt("fuelLog", "Include every fill-up") : "") + (v.photo ? opt("photo", "Photo") : "")}</div>
  ${o.type === "sale" && (!v.askingPrice && o.asking || !v.sellerNotes) ? `<p class="small muted" style="margin:0">Add an asking price and seller's notes under <b>Edit</b> (set Status to Sold to see those fields, or fill them in now — they only print on the report).</p><div class="form2"><div class="field"><label>Asking price ($)</label><input data-rv="askingPrice" inputmode="decimal" value="${esc(v.askingPrice ?? "")}"></div><div class="field"><label>Seller's notes</label><input data-rv="sellerNotes" value="${esc(v.sellerNotes || "")}"></div></div>` : ""}
  <p class="small muted" style="margin:0">On the phone: Print / PDF → choose <b>Save as PDF</b> as the printer, then share the PDF.</p></div>
  <div class="paper" id="rpv">${buildReport(v, o)}</div></div>`);
}
function rRows(rows) { return rows.filter(r => r && !blank(r[1]) && r[1] !== "—").map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join(""); }
function buildReport(v, o) {
  const css = `<style>.rpt{font:10pt/1.4 "IBM Plex Sans",Arial,sans-serif;color:#111;max-width:186mm}.rpt h1{font:700 22pt/1.05 "Barlow Condensed","Arial Narrow",Arial,sans-serif;margin:2px 0 0;letter-spacing:.01em}.rpt h2{font:700 12pt "Barlow Condensed","Arial Narrow",Arial,sans-serif;margin:14px 0 4px;text-transform:uppercase;letter-spacing:.07em;border-bottom:1pt solid #111;padding-bottom:2px}
  .rh{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;border-bottom:2.5pt solid #111;padding-bottom:6px;margin-bottom:8px}.rk{font:600 8pt "IBM Plex Mono",monospace;letter-spacing:.14em;text-transform:uppercase;color:#555}.rplate{font:600 13pt "IBM Plex Mono",monospace;letter-spacing:.1em;border:1.5pt solid #111;padding:2px 8px;border-radius:3px;white-space:nowrap}
  .rt{width:100%;border-collapse:collapse;font-size:9pt}.rt th,.rt td{border-bottom:.5pt solid #bbb;padding:3px 5px;text-align:left;vertical-align:top}.rt thead th{border-bottom:1pt solid #111;font-size:7.5pt;text-transform:uppercase;letter-spacing:.05em;color:#333}.rt tr{break-inside:avoid}.rt .n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.rt tr.tot td{border-top:1pt solid #111;border-bottom:0;font-weight:600}.rt .po td{color:#555}
  .kv{width:100%;border-collapse:collapse;font-size:9.5pt}.kv th{width:34%;text-align:left;font-weight:500;color:#555;padding:2px 8px 2px 0;vertical-align:top}.kv td{padding:2px 0}.cols{display:grid;grid-template-columns:1fr 1fr;gap:4px 8mm}.big{display:flex;gap:8mm;flex-wrap:wrap;margin:6px 0}.big div{min-width:30mm}.big b{display:block;font:700 17pt/1.1 "Barlow Condensed",Arial,sans-serif}.big span{font-size:8pt;color:#555;text-transform:uppercase;letter-spacing:.06em}
  .rimg{max-width:100%;max-height:70mm;display:block;margin:6px 0;border-radius:2px}.note{white-space:pre-wrap;border-left:2pt solid #111;padding:2px 0 2px 8px}.rnote{font-size:7.5pt;color:#555;margin-top:12px;border-top:.5pt solid #bbb;padding-top:4px}.sm{font-size:8pt;color:#555}.mono{font-family:"IBM Plex Mono",monospace}</style>`;
  const all = vEntries(v.id), c = curOdo(v), today = todayISO();
  const svc = all.filter(e => e.type === "service" && (o.type === "own" || o.prior || !isPrev(e, v)));
  const maint = all.filter(e => e.type === "expense" && MAINT_CATS.includes(e.category) && (o.type === "own" || o.prior || !isPrev(e, v)));
  const st = vStats(v, ...periodRange("all", v).slice(0, 2));
  const odoNow = v.sold && v.sold.odo != null ? { odo: v.sold.odo, date: v.sold.date } : c;
  const head = `<div class="rh"><div><div class="rk">${o.type === "sale" ? "Vehicle for sale" : "Ownership report"}</div><h1>${esc(vFull(v) || vName(v))}</h1>${o.type === "sale" && o.asking && v.askingPrice ? `<div style="font:700 16pt 'Barlow Condensed',Arial,sans-serif;margin-top:2px">${money0(v.askingPrice)}</div>` : ""}</div>${v.rego ? `<span class="rplate">${esc(v.rego)}</span>` : ""}</div>`;
  const photo = o.photo && v.photo ? `<img class="rimg" data-fid="${esc(v.photo)}" alt="">` : "";
  const ns = nextService(v);
  const details = `<div class="cols"><table class="kv">${rRows([["Make", v.make], ["Model", [v.model, v.variant].filter(Boolean).join(" ")], ["Year", v.year], ["Body", v.body], ["Colour", v.colour], ["Transmission", v.transmission], ["Engine", v.engine], ["Powertrain", v.powertrain], ["Fuel", v.fuelGrade]])}</table>
    <table class="kv">${rRows([["Odometer", usesOdo(v) && odoNow ? `${kmf(odoNow.odo)} (${fmtDate(odoNow.date)})` : ""], ["Registration", [v.rego, v.regoState].filter(Boolean).join(" ")], ["Rego expires", v.regoExpiry && isActive(v) ? fmtDate(v.regoExpiry) : ""], ["VIN", v.vin], ["Engine no.", v.engineNo], ["Tare", v.tareKg ? v.tareKg + " kg" : ""], ["ATM / GVM", v.atmKg ? v.atmKg + " kg" : ""], ["Battery", v.battKwh ? `${v.battKwh} kWh${v.battType ? " " + v.battType : ""}` : ""], ["Owned since", v.acqDate ? fmtDate(v.acqDate) : ""], ["Next service", ns && isActive(v) ? [ns.km && kmf(ns.km), ns.date && fmtDate(ns.date)].filter(Boolean).join(" or ") : ""]])}</table></div>`;
  const svcCostShown = o.type === "own" || o.costs;
  const svcTotal = svc.filter(e => !isPrev(e, v) || o.type === "sale").reduce((s, e) => s + costOf(e), 0);
  const svcTable = svc.length ? `<table class="rt"><thead><tr><th>Date</th><th class="n">Odometer</th><th>Work done</th><th>Workshop</th>${svcCostShown ? `<th class="n">Cost</th>` : ""}${o.type === "own" ? "<th>Invoice</th>" : ""}</tr></thead><tbody>${svc.map(e => `<tr class="${isPrev(e, v) ? "po" : ""}"><td style="white-space:nowrap">${fmtDate(e.date)}</td><td class="n">${e.odo != null ? nf(e.odo, 0) : "—"}</td><td>${esc(e.desc || (isSched(e) ? "Service" : e.svcType))}${isSched(e) ? "" : ` <span class="sm">(${esc(e.svcType.toLowerCase())})</span>`}${isBT(e) && battText(e) ? `<div class="sm">${esc(battText(e))}</div>` : ""}${isPrev(e, v) ? " †" : ""}${e.notes ? `<div class="sm">${esc(e.notes)}</div>` : ""}</td><td>${esc(e.workshop || "")}</td>${svcCostShown ? `<td class="n">${e.cost != null ? money(e.cost) : "—"}</td>` : ""}${o.type === "own" ? `<td class="mono sm">${esc(e.invoice || "")}</td>` : ""}</tr>`).join("")}${svcCostShown ? `<tr class="tot"><td colspan="4">${svc.length} services recorded</td><td class="n">${money(svcTotal)}</td>${o.type === "own" ? "<td></td>" : ""}</tr>` : ""}</tbody></table>${svc.some(e => isPrev(e, v)) ? `<div class="sm">† Before ${o.type === "sale" ? "my" : "your"} ownership, from the service book.${o.type === "own" ? " Not included in your costs." : ""}</div>` : ""}` : `<p>No services recorded.</p>`;
  const maintTable = list => `<table class="rt"><thead><tr><th>Date</th><th class="n">Odometer</th><th>Item</th>${svcCostShown ? `<th class="n">Cost</th>` : ""}</tr></thead><tbody>${list.map(e => `<tr class="${isPrev(e, v) ? "po" : ""}"><td style="white-space:nowrap">${fmtDate(e.date)}</td><td class="n">${e.odo != null ? nf(e.odo, 0) : "—"}</td><td>${esc([e.category, e.desc].filter(Boolean).join(" — "))}${isPrev(e, v) ? " †" : ""}</td>${svcCostShown ? `<td class="n">${e.cost != null ? money(e.cost) : "—"}</td>` : ""}</tr>`).join("")}</tbody></table>`;
  const foot = `<div class="rnote">Records kept by the owner in MyGarage. Report generated ${fmtDate(today)}.${o.type === "sale" ? " Invoices and receipts available on request." : ""}</div>`;
  if (o.type === "sale") {
    const fuel = o.fuel && usesFuel(v) && st.econNoTow ? `<h2>Fuel economy (owner's records)</h2><div class="big"><div><b>${nf(st.econNoTow.econ)} L/100km</b><span>average, ${kmf(st.econNoTow.km)} recorded</span></div>${st.econTow ? `<div><b>${nf(st.econTow.econ)} L/100km</b><span>while towing</span></div>` : ""}<div><b>${st.fuel.length}</b><span>fill-ups logged</span></div></div>` : "";
    return css + `<div class="rpt">${head}${photo}${details}<h2>Service history</h2>${svcTable}${o.maint && maint.length ? `<h2>Repairs, tyres &amp; batteries</h2>${maintTable(maint)}` : ""}${fuel}${evReport(v, "sale")}${v.sellerNotes ? `<h2>Seller's notes</h2><div class="note">${esc(v.sellerNotes)}</div>` : ""}${o.contact && SET().contact ? `<p style="margin-top:10px"><b>Contact:</b> ${esc(SET().contact)}</p>` : ""}${foot}</div>`;
  }
  // ownership report
  const years = {}; for (const e of ownEntries(v)) { const y = e.date.slice(0, 4); const r = years[y] = years[y] || { fuel: 0, svc: 0, other: 0 }; if (e.type === "fuel" || e.type === "charge") r.fuel += costOf(e); else if (e.type === "service") r.svc += costOf(e); else if (e.type === "expense") r.other += costOf(e); }
  const yk = Object.keys(years).sort(); const kmY = y => usesOdo(v) ? kmBetween(v, `${y}-01-01`, `${+y + 1}-01-01`) : null;
  const sale = v.sold && v.sold.price != null ? v.sold.price : null;
  const dep = v.price != null && sale != null ? v.price - sale : null;
  const exps = all.filter(e => e.type === "expense");
  const fills = all.filter(e => e.type === "fuel"); const fc = fuelOf(v);
  return css + `<div class="rpt">${head}${photo}${details}
  <h2>Cost of ownership</h2><div class="big"><div><b>${money0(st.total)}</b><span>running costs</span></div>${st.km ? `<div><b>${kmf(st.km)}</b><span>driven</span></div><div><b>${money(st.perKm)}/km</b><span>running cost</span></div>` : ""}${v.price != null ? `<div><b>${money0(v.price)}</b><span>purchase price</span></div>` : ""}${sale != null ? `<div><b>${money0(sale)}</b><span>sold for</span></div><div><b>${money0(dep + st.total)}</b><span>total cost incl. depreciation</span></div>` : ""}${usesFuel(v) && st.econNoTow ? `<div><b>${nf(st.econNoTow.econ)}</b><span>L/100km not towing</span></div>` : ""}</div>
  <table class="rt"><thead><tr><th>Year</th>${usesOdo(v) ? `<th class="n">Km</th>` : ""}<th class="n">${usesCharge(v) ? "Charging" : "Fuel"}</th><th class="n">Servicing</th><th class="n">Other</th><th class="n">Total</th></tr></thead><tbody>${yk.map(y => { const r = years[y], k = kmY(y); return `<tr><td>${y}</td>${usesOdo(v) ? `<td class="n">${k ? nf(k, 0) : "—"}</td>` : ""}<td class="n">${money0(r.fuel)}</td><td class="n">${money0(r.svc)}</td><td class="n">${money0(r.other)}</td><td class="n">${money0(r.fuel + r.svc + r.other)}</td></tr>`; }).join("")}<tr class="tot"><td>Total</td>${usesOdo(v) ? `<td class="n">${st.km ? nf(st.km, 0) : ""}</td>` : ""}<td class="n">${money0(st.fuelCost + st.chargeCost)}</td><td class="n">${money0(st.svcCost)}</td><td class="n">${money0(st.expCost)}</td><td class="n">${money0(st.total)}</td></tr></tbody></table>
  ${Object.keys(st.cats).length ? `<table class="rt" style="margin-top:6px"><thead><tr><th>Other costs by category</th><th class="n">Total</th></tr></thead><tbody>${Object.entries(st.cats).sort((a, b) => b[1] - a[1]).map(([k, a]) => `<tr><td>${esc(k)}</td><td class="n">${money(a)}</td></tr>`).join("")}</tbody></table>` : ""}
  ${evReport(v, "own")}
  <h2>Service history</h2>${svcTable}
  ${exps.length ? `<h2>Other costs</h2><table class="rt"><thead><tr><th>Date</th><th class="n">Odometer</th><th>Category</th><th>Description</th><th class="n">Amount</th></tr></thead><tbody>${exps.map(e => `<tr class="${isPrev(e, v) ? "po" : ""}"><td style="white-space:nowrap">${fmtDate(e.date)}</td><td class="n">${e.odo != null ? nf(e.odo, 0) : "—"}</td><td>${esc(e.category || "")}</td><td>${esc(e.desc || "")}${isPrev(e, v) ? " †" : ""}</td><td class="n">${e.cost != null ? money(e.cost) : "—"}</td></tr>`).join("")}</tbody></table>` : ""}
  ${o.fuelLog && fills.length ? `<h2>Fuel log</h2><table class="rt"><thead><tr><th>Date</th><th class="n">Odometer</th><th class="n">Km</th><th class="n">Litres</th><th class="n">$/L</th><th class="n">Cost</th><th class="n">L/100</th><th>Where</th></tr></thead><tbody>${fills.map(e => { const d = fc.info.get(e.id) || {}; return `<tr><td style="white-space:nowrap">${fmtDate(e.date)}</td><td class="n">${nf(e.odo, 0)}</td><td class="n">${d.dist != null ? nf(d.dist, 0) : ""}</td><td class="n">${e.litres != null ? nf(e.litres, 2) : ""}${e.full === false ? "*" : ""}</td><td class="n">${e.ppl ? nf(e.ppl, 3) : ""}</td><td class="n">${e.cost != null ? money(e.cost) : ""}</td><td class="n">${d.econ != null ? nf(d.econ) + (d.tow ? " T" : "") : ""}</td><td class="sm">${esc(e.location || "")}</td></tr>`; }).join("")}<tr class="tot"><td colspan="3">${fills.length} fill-ups</td><td class="n">${nf(fills.reduce((s, e) => s + (e.litres || 0), 0), 0)}</td><td></td><td class="n">${money0(fills.reduce((s, e) => s + costOf(e), 0))}</td><td colspan="2"></td></tr></tbody></table><div class="sm">* part fill · T = towing</div>` : ""}
  ${v.notes ? `<h2>Notes</h2><div class="note">${esc(v.notes)}</div>` : ""}${foot}</div>`;
}
async function printReport() {
  const v = vById(S.sheet.id); const r = $("#report"); r.innerHTML = buildReport(v, S.sheet.o); await hydrateImages(r);
  const imgs = $$("img", r); await Promise.all(imgs.map(im => im.complete ? 1 : new Promise(res => { im.onload = im.onerror = res; })));
  const t = document.title; document.title = `${vName(v)} ${S.sheet.o.type === "sale" ? "sale report" : "ownership report"} ${todayISO()}`; window.print(); setTimeout(() => { document.title = t; }, 1000);
}

/* ================= EV charging, warranty, scheduled items, parking ================= */
const CH_KEYS = ["kwh", "where", "current", "lowFull", "socStart", "socEnd", "sessKwh", "tripEcon", "tripKwh", "tripKm", "tempC", "costEst", "rate"];
function typesFor(v) { return ["charge", "fuel", "odo", "service", "expense"].filter(t => (t !== "fuel" || usesFuel(v)) && (t !== "charge" || usesCharge(v)) && (t !== "odo" || usesOdo(v))); }
const ATTO_BASE = { kind: "car", make: "BYD", model: "Atto 1", body: "Hatchback", transmission: "Single-speed reduction", powertrain: "Electric", battType: "LFP (Blade)", officialKwh100: 15.6,
  tracksOdo: true, tracksFuel: false, svcKm: 20000, svcMonths: 12, warYears: 6, warKm: 150000, drvYears: 8, drvKm: 160000, batYears: 8, batKm: 160000, batMinPct: 70,
  items: [{ name: "Brake fluid", months: 24, km: 40000 }, { name: "Gearbox oil", firstMonths: 24, firstKm: 40000, months: 24, km: 48000 }, { name: "High-voltage battery coolant", months: 24, km: 100000 }, { name: "Motor & A/C coolant", months: 48, km: 100000 }] };
const PRESETS = {
  atto1e: Object.assign({}, ATTO_BASE, { _label: "BYD Atto 1 Essential (30 kWh)", name: "Atto 1", variant: "Essential", battKwh: 30, tyrePressure: "Check the tyre placard (handbook p.171: 250 kPa for 175/65R15, 270 kPa for 185/55R16)" }),
  atto1p: Object.assign({}, ATTO_BASE, { _label: "BYD Atto 1 Premium (43.2 kWh)", name: "Atto 1", variant: "Premium", battKwh: 43.2, tyrePressure: "Check the tyre placard (handbook p.171: 250 kPa for 175/65R15, 270 kPa for 185/55R16)" })
};
async function migrateData() {
  const m = S.meta.migr || {}; let ch = false;
  if (!m.klugerWarranty) {
    const k = vById("v-kluger");
    if (k && !k.warStart) { const nk = clone(k); Object.assign(nk, { warStart: "2023-07-05", warYears: 5, drvYears: 7, batYears: 5, batExtYears: 10 }); nk.items = [...(nk.items || []), { id: uid("i"), name: "Hybrid Health Check", firstDate: "2028-07-05", months: 12 }]; await dbPut("vehicles", nk); }
    m.klugerWarranty = true; ch = true;
  }
  if (ch) { S.meta.migr = m; await saveMeta(); await reload(); }
}

/* ---- warranty ---- */
function warranties(v) {
  if (!v.warStart) return [];
  const out = [], add = (key, label, yrs, km, extra) => { if (yrs) out.push({ key, label, date: addMonths(v.warStart, Math.round(yrs * 12)), km: km || null, extra }); };
  add("war", "Car warranty", v.warYears, v.warKm);
  add("drv", "Engine / drive unit", v.drvYears, v.drvKm);
  add("bat", "Battery warranty", v.batYears, v.batKm, [v.batMinPct && `minimum ${v.batMinPct}% capacity`, v.batExtYears && `extends to ${v.batExtYears} years with yearly health checks`].filter(Boolean).join(" · "));
  return out;
}
const yrsMonths = d => { if (d < 0) return "expired"; const y = Math.floor(d / 365.25), m = Math.floor((d - y * 365.25) / 30.44); return [y && `${y} yr`, m && `${m} mth`].filter(Boolean).join(" ") || `${d} days`; };
function warrantyPanel(v) {
  const ws = warranties(v); if (!ws.length) return "";
  const today = todayISO(), est = usesOdo(v) ? estOdoToday(v) : null;
  return `<div class="panel"><h3>Warranty</h3><dl class="kv">${ws.map(w => { const dl = daysBetween(today, w.date), kl = w.km != null && est != null ? w.km - est : null, gone = dl < 0 || (kl != null && kl <= 0);
    return `<dt>${esc(w.label)}</dt><dd>${gone ? `<span class="tag">Expired</span> ` : ""}${fmtDate(w.date)}${w.km ? ` or ${kmf(w.km)}` : " · unlimited km"}${gone ? "" : `<div class="small muted">${yrsMonths(dl)} left${kl != null ? ` · ~${kmf(kl)} to go` : ""}</div>`}${w.extra ? `<div class="small muted">${esc(w.extra)}</div>` : ""}</dd>`; }).join("")}</dl><div class="small muted">From ${fmtDate(v.warStart)}. Transfers to the next owner.</div></div>`;
}

/* ---- scheduled service items ---- */
function itemsDue(v) {
  const items = v.items || []; if (!items.length) return [];
  const sv = ownEntries(v).filter(e => e.type === "service"), st0 = ownStart(v), base = v.warStart || v.acqDate;
  return items.filter(it => it.name).map(it => {
    const done = sv.filter(e => (e.items || []).includes(it.id)), last = done[done.length - 1];
    let date = null, km = null;
    if (last) { date = it.months ? addMonths(last.date, it.months) : null; km = it.km && last.odo != null ? last.odo + it.km : null; }
    else { date = it.firstDate || ((it.firstMonths || it.months) && base ? addMonths(base, it.firstMonths || it.months) : null); km = it.firstKm ?? (it.km && st0 ? st0.odo + it.km : null); }
    return { it, last, date, km };
  });
}
function dueByDateKm(v, date, km) {
  const st = SET(), today = todayISO(), est = usesOdo(v) ? estOdoToday(v) : null, rate = kmPerDay(v);
  const dd = date ? daysBetween(today, date) : null, kmLeft = km != null && est != null ? km - est : null;
  const proj = kmLeft != null && rate ? addDays(today, Math.max(0, Math.round(kmLeft / rate))) : null;
  let sortDate = date; if (proj && (!sortDate || proj < sortDate)) sortDate = proj;
  let status = "ok";
  if ((dd != null && dd < 0) || (kmLeft != null && kmLeft <= 0)) status = "over";
  else if ((dd != null && dd <= st.dueDays) || (kmLeft != null && kmLeft <= st.dueKm) || (proj && daysBetween(today, proj) <= st.dueDays)) status = "soon";
  const parts = []; if (km != null) parts.push(`at ${kmf(km)}` + (kmLeft != null ? (kmLeft > 0 ? ` (~${kmf(kmLeft)} to go)` : ` (~${kmf(-kmLeft)} over)`) : "")); if (date) parts.push(`by ${fmtDate(date)}`);
  return { status, sortDate, days: sortDate ? daysBetween(today, sortDate) : 9999, text: parts.join(" or ") };
}
function itemsEditor(d) {
  const its = d.items || [];
  return `<div class="panel"><h3>Service items with their own schedule</h3><p class="small muted" style="margin:0">For work not done at every service — brake fluid, coolant, a hybrid health check. Tick them when you log a service. Use "first due" only when the first interval differs from later ones.</p>
  ${its.map((x, i) => `<div class="panel" style="padding:10px;gap:8px;background:var(--surface-2)"><div class="row"><input class="inp" style="flex:1" data-it="${i}.name" value="${esc(x.name || "")}" placeholder="Item name" aria-label="Item name"><button type="button" class="btn sm ghost" data-act="rmItem" data-i="${i}" aria-label="Remove item">×</button></div>
    <div class="form3"><div class="field"><label>Every (months)</label><input data-it="${i}.months" inputmode="numeric" value="${x.months ?? ""}"></div><div class="field"><label>or every (km)</label><input data-it="${i}.km" inputmode="numeric" value="${x.km ?? ""}"></div><div class="field"><label>First due (date)</label><input type="date" data-it="${i}.firstDate" value="${esc(x.firstDate || "")}"></div>
    <div class="field"><label>First after (months)</label><input data-it="${i}.firstMonths" inputmode="numeric" value="${x.firstMonths ?? ""}"></div><div class="field"><label>First at (km)</label><input data-it="${i}.firstKm" inputmode="numeric" value="${x.firstKm ?? ""}"></div></div></div>`).join("")}
  <div><button type="button" class="btn" data-act="addItem">+ Add item</button></div></div>`;
}
function readItems(d) { for (const el of $$("#sheet [data-it]")) { const [i, k] = el.dataset.it.split("."); const it = (d.items || [])[+i]; if (!it) continue; let val = el.value.trim(); if (k !== "name" && k !== "firstDate") val = num(val); if (val === "" || val == null) delete it[k]; else it[k] = val; } }
function svcItemsChecks(e, v) { const its = (v.items || []).filter(x => x.name); if (!its.length) return ""; return `<div class="field"><label>Scheduled items done at this service</label><div class="toggles">${its.map(it => `<label class="check-inline"><input type="checkbox" data-svcitem="${it.id}" ${(e.items || []).includes(it.id) ? "checked" : ""}> ${esc(it.name)}</label>`).join("")}</div></div>`; }

/* ---- charging ---- */
function capReading(e, v) {
  if (!e || e.type !== "charge" || !e.lowFull || e.socStart == null || e.socEnd == null || e.socEnd <= e.socStart) return null;
  const k = e.where === "public" ? e.kwh : e.sessKwh; if (!k) return null;
  const st = SET(), eff = (e.where === "public" && e.current !== "AC" ? st.effDC : st.effAC) / 100;
  const cap = k * eff / ((e.socEnd - e.socStart) / 100);
  return { e, k, cap, pct: v && v.battKwh ? cap / v.battKwh * 100 : null, low: e.tempC != null && e.tempC < 10 };
}
const capReadings = v => ownEntries(v).map(e => capReading(e, v)).filter(Boolean);
function homePeriod(v, e) {
  if (!v || e.where === "public" || e.odo == null || !e.kwh) return null;
  const ch = S.entries.filter(x => x.vehicleId === v.id && x.type === "charge" && x.id !== e.id && x.odo != null);
  const prev = ch.filter(x => x.where !== "public" && x.date <= e.date && x.odo < e.odo).sort(byDateOdo).pop(); if (!prev) return null;
  const pub = ch.filter(x => x.where === "public" && x.date > prev.date && x.date <= e.date).reduce((s, x) => s + (x.kwh || 0), 0);
  const km = e.odo - prev.odo; return km > 0 ? { km, kwh: e.kwh + pub, econ: (e.kwh + pub) / km * 100, from: prev.date } : null;
}
function chargeBody(e, v, odoField) {
  const home = e.where !== "public", st = SET();
  const nets = [...new Set(S.entries.filter(x => x.type === "charge" && x.location).map(x => x.location))];
  const costVal = e.costEst ? "" : (e.cost ?? "");
  const costHint = home ? (e.costEst && e.rate != null ? `Blank = kWh × $${e.rate}/kWh (rate when first saved)` : st.homeRate != null ? `Blank = kWh × $${st.homeRate}/kWh (Settings)` : "Optional. Set a home rate in More → Settings to fill this in") : "";
  const trip = e.tripEcon != null || e.tripKwh != null || e.tripKm != null || e.tempC != null;
  return `<div class="seg" style="grid-template-columns:1fr 1fr"><button type="button" aria-pressed="${home}" data-act="chWhere" data-w="home">Home<span class="small" style="font-weight:400">monthly total</span></button><button type="button" aria-pressed="${!home}" data-act="chWhere" data-w="public">Public<span class="small" style="font-weight:400">each charge</span></button></div>
  ${odoField}
  <div class="form2"><div class="field mid"><label>${home ? "kWh this period (Evnex app)" : "kWh (from receipt)"}</label><input data-k="kwh" inputmode="decimal" data-num="1" value="${e.kwh ?? ""}"></div>
  <div class="field mid"><label>Cost $</label><input data-k="cost" inputmode="decimal" data-num="1" value="${costVal}" placeholder="${home ? (e.costEst || st.homeRate != null ? "auto" : "optional") : ""}"><span class="hint">${esc(costHint)}</span></div></div>
  ${home ? "" : `<div class="form2"><div class="field"><label>Network / location</label><input data-k="location" list="nets" value="${esc(e.location || "")}"><datalist id="nets">${nets.map(n => `<option value="${esc(n)}">`).join("")}</datalist></div><div class="field"><label>Charger</label><div class="seg" style="grid-template-columns:1fr 1fr"><button type="button" aria-pressed="${e.current !== "AC"}" data-act="chCur" data-c="DC">DC fast</button><button type="button" aria-pressed="${e.current === "AC"}" data-act="chCur" data-c="AC">AC</button></div></div></div>`}
  <label class="check-inline"><input type="checkbox" data-k="lowFull" data-redraw="1" ${e.lowFull ? "checked" : ""}> Full charge from below 10% — battery health reading</label>
  ${e.lowFull ? `<div class="form3"><div class="field mid"><label>Start %</label><input data-k="socStart" inputmode="decimal" data-num="1" value="${e.socStart ?? ""}"></div><div class="field mid"><label>End %</label><input data-k="socEnd" inputmode="decimal" data-num="1" value="${e.socEnd ?? 100}"></div>${home ? `<div class="field mid"><label>kWh that session</label><input data-k="sessKwh" inputmode="decimal" data-num="1" value="${e.sessKwh ?? ""}"></div>` : ""}</div><span class="hint">${home ? "Session kWh from the Evnex app for this one charge (the monthly total stays in the kWh box above)." : "Uses the kWh on the receipt."} ${v.battKwh ? `Compared with the ${v.battKwh} kWh rated battery.` : "Add the battery size on the vehicle to see health as a %."}</span>` : ""}
  <details ${trip ? "open" : ""}><summary class="small" style="cursor:pointer;color:var(--ink-2)">Trip computer &amp; temperature (optional)</summary><div class="form2" style="margin-top:8px">
    <div class="field"><label>Car's kWh/100km</label><input data-k="tripEcon" inputmode="decimal" data-num="1" value="${e.tripEcon ?? ""}"></div><div class="field"><label>Car's kWh used</label><input data-k="tripKwh" inputmode="decimal" data-num="1" value="${e.tripKwh ?? ""}"></div>
    <div class="field"><label>Trip km</label><input data-k="tripKm" inputmode="decimal" data-num="1" value="${e.tripKm ?? ""}"></div><div class="field"><label>Outside temp °C</label><input data-k="tempC" inputmode="decimal" data-num="1" value="${e.tempC ?? ""}"></div></div></details>`;
}
function chargePreview(e, v) {
  const out = [], lr = lastReadingBefore(v, e);
  if (e.odo != null && lr) out.push([(e.odo - lr.odo >= 0 ? "+" : "") + nf(e.odo - lr.odo, 0), `km since ${fmtShort(lr.date)}`]);
  const hp = homePeriod(v, e); if (hp) out.push([nf(hp.econ), `kWh/100km since ${fmtShort(hp.from)}`]);
  const cr = capReading(e, v); if (cr) out.push([nf(cr.cap, 1) + " kWh", cr.pct != null ? `est. capacity · ${nf(cr.pct, 0)}% of rated` : "est. capacity"]);
  if (e.where !== "public" && e.cost == null && e.kwh) { const r = e.costEst && e.rate != null ? e.rate : SET().homeRate; if (r != null) out.push([money(e.kwh * r), "est. cost"]); }
  return out;
}
function chargeWarnings(e, v) {
  const w = [];
  if (e.lowFull) {
    if (e.socStart != null && e.socEnd != null && e.socEnd <= e.socStart) w.push("End % must be higher than start %.");
    if (e.socStart != null && e.socStart >= 10) w.push(`The handbook calls for a full charge from below 10%; you started at ${e.socStart}%. It'll still be recorded, but bigger swings give better estimates.`);
    if (e.where !== "public" && !e.sessKwh) w.push("Enter the kWh for that one session (from the Evnex app) to get a battery reading.");
    const cr = capReading(e, v); if (cr && cr.pct != null && (cr.pct > 110 || cr.pct < 50)) w.push(`That works out to ${nf(cr.pct, 0)}% of the rated battery — check the kWh and percentages.`);
  }
  return w;
}
function prepCharge(e) {
  e.where = e.where === "public" ? "public" : "home";
  if (e.where === "home") {
    e.current = "AC";
    if (e.cost == null) { const hr = e.costEst && e.rate != null ? e.rate : SET().homeRate; if (hr != null) { e.cost = r2(e.kwh * hr); e.costEst = true; e.rate = hr; } else { delete e.costEst; delete e.rate; } }
    else { delete e.costEst; delete e.rate; }
  } else { e.current = e.current || "DC"; delete e.costEst; delete e.rate; }
  if (!e.lowFull) { delete e.lowFull; delete e.socStart; delete e.socEnd; delete e.sessKwh; }
  if (e.where === "public") delete e.sessKwh;
}

/* ---- EV display ---- */
/* battery health: own estimates from charging + dealer state-of-health figures from services */
function dealerReadings(v) { return ownEntries(v).filter(e => e.type === "service" && e.dealerSoh != null).map(e => ({ e, src: "dealer", pct: e.dealerSoh, cap: v.battKwh ? v.battKwh * e.dealerSoh / 100 : null })); }
function healthReadings(v) { return [...capReadings(v).map(c => Object.assign({ src: "own" }, c)), ...dealerReadings(v)].sort((a, b) => byDateOdo(a.e, b.e)); }
function latestCap(v) { const c = healthReadings(v).filter(x => x.e.date <= todayISO()); return c[c.length - 1] || null; }
const healthVal = c => c ? (c.pct != null ? nf(c.pct, 0) + "%" : nf(c.cap, 1) + " kWh") : "—";
const healthSub = c => c ? (c.src === "dealer" ? `dealer check · ${fmtShort(c.e.date)}` : `${nf(c.cap, 1)} kWh est. · ${fmtShort(c.e.date)}`) : "no reading yet";
function evCardStats(v, st) { return [["kWh/100km", st.kwh100 ? nf(st.kwh100) : "—"], ["Battery", healthVal(latestCap(v))]]; }
function evTiles(v, st) {
  const c = latestCap(v), out = [];
  out.push(["Energy use", st.kwh100 ? nf(st.kwh100) + " kWh/100" : "—", v.officialKwh100 ? `official ${v.officialKwh100}` : "at the plug"]);
  out.push(["Charging", st.km && st.chargeCost ? money(st.chargeCost / st.km) + "/km" : "—", st.homeEst ? "home part estimated" : st.homeUncosted ? "home not costed" : ""]);
  out.push(["Battery health", healthVal(c), healthSub(c)]);
  return out;
}
function evStatTiles(v, s) {
  const c = latestCap(v);
  return [["Energy use", s.kwh100 ? nf(s.kwh100) + " kWh/100" : "—", v.officialKwh100 ? `official ${v.officialKwh100} · at the plug` : "at the plug"],
    ["Charged", nf(s.kwh, 0) + " kWh", `home ${nf(s.kwhHome, 0)} · public ${nf(s.kwhPublic, 0)}`],
    ["Home cost", s.kwhHome ? (s.costHome ? money(s.costHome / s.kwhHome, 3) + "/kWh" : "not costed") : "—", s.homeEst ? "estimated from your rate" : ""],
    ["Public cost", s.kwhPublic ? money(s.costPublic / s.kwhPublic, 3) + "/kWh" : "—", s.kwhPublic ? money0(s.costPublic) + " total" : ""],
    ["Charging per km", s.km && s.chargeCost ? money(s.chargeCost / s.km) + "/km" : "—", s.homeEst ? "home part estimated" : ""],
    ["Battery health", healthVal(c), healthSub(c)]];
}
function evCharts(v, from, to, months, mlab) {
  const ch = ownEntries(v).filter(e => e.type === "charge");
  const pts = ch.filter(e => e.where !== "public" && e.date >= from && e.date <= to).map(e => { const p = homePeriod(v, e); return p ? { x: parseISO(e.date).getTime(), y: p.econ, t: `${fmtDate(e.date)}: ${nf(p.econ)} kWh/100km over ${nf(p.km, 0)} km` } : null; }).filter(Boolean);
  const pc = v.battKwh != null;
  const hs = healthReadings(v).filter(c => c.e.date >= from && c.e.date <= to && (pc || c.cap != null));
  const cpts = hs.map(c => ({ x: parseISO(c.e.date).getTime(), y: pc ? c.pct : c.cap, hl: c.low, c: c.src === "dealer" ? "var(--ink)" : null,
    t: c.src === "dealer" ? `${fmtDate(c.e.date)}: dealer check ${nf(c.pct, 0)}%` : `${fmtDate(c.e.date)}: ${nf(c.cap, 1)} kWh${pc ? ` (${nf(c.pct, 0)}%)` : ""}` }));
  const cost = months.map(m => ch.filter(e => e.date.slice(0, 7) === m).reduce((s, e) => s + costOf(e), 0));
  const one = hs[0];
  const health = hs.length >= 2 ? svgLine(cpts, pc ? { avg: v.batMinPct || null, lo: v.batMinPct ? v.batMinPct - 5 : null, hi: 105, yfmt: x => nf(x, 0) + "%" } : { yfmt: x => nf(x, 0) })
    : hs.length === 1 ? `<p style="margin:0">One reading so far: <b>${healthVal(one)}</b>${one.src === "dealer" ? " (dealer check)" : pc ? ` (${nf(one.cap, 1)} kWh of ${v.battKwh} kWh)` : ""} on ${fmtDate(one.e.date)}.</p>`
    : `<p class="muted small" style="margin:0">No readings yet. Log a charge with "Full charge from below 10%" ticked — the handbook asks for one every 3–6 months — or enter a dealer figure on a service.</p>`;
  return `<div class="panel"><h3>Energy use per home-charging period (kWh/100km)</h3>${svgLine(pts, { avg: v.officialKwh100 || null })}<div class="legend">${v.officialKwh100 ? `<span>– – official ${v.officialKwh100}</span>` : ""}<span>Includes public charges within each period. Measured at the plug.</span></div></div>
  <div class="panel"><h3>Battery health</h3>${health}${hs.length >= 2 ? `<div class="legend"><span><i style="background:var(--accent)"></i>your estimate</span><span><i style="background:var(--ink)"></i>dealer check</span><span><i style="background:var(--amber)"></i>below 10°C</span>${pc && v.batMinPct ? `<span>– – warranty minimum ${v.batMinPct}%</span>` : ""}</div>` : ""}</div>
  <div class="panel"><h3>Charging cost by month</h3>${svgBars(mlab, cost, { yfmt: money0 })}</div>`;
}
function reorderList(act) {
  return `<div class="panel"><h3>Reorder vehicles<span class="sp"></span><button type="button" class="btn primary sm" data-act="reorderOff">Done</button></h3><p class="small muted" style="margin:0">This order is used everywhere — Garage, the vehicle picker when logging, Stats and Reports.</p>
  <div class="lst">${act.map((v, i) => `<div class="due ok" style="grid-template-columns:minmax(0,1fr) auto;padding:8px 12px"><div style="min-width:0"><b>${i + 1}. ${esc(vName(v))}</b><div class="s">${esc([v.rego, vFull(v)].filter(Boolean).join(" · "))}</div></div><div class="row" style="flex-wrap:nowrap"><button type="button" class="btn sm" data-act="moveV" data-id="${v.id}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="Move ${esc(vName(v))} up">▲</button><button type="button" class="btn sm" data-act="moveV" data-id="${v.id}" data-d="1" ${i === act.length - 1 ? "disabled" : ""} aria-label="Move ${esc(vName(v))} down">▼</button></div></div>`).join("")}</div></div>`;
}
function evPanel(v) {
  if (!usesCharge(v) || !isActive(v)) return "";
  return `<div class="panel"><h3>Battery care</h3><p class="small" style="margin:0">Handbook: charge to full at least weekly, and fully charge from below 10% every 3–6 months. Parked over 7 days: keep it at 40–60%.</p>
  <div class="row">${v.parkedSince ? `<span class="tag soon">Parked since ${fmtDate(v.parkedSince)}</span><button type="button" class="btn sm" data-act="unpark" data-id="${v.id}">Driving again</button>` : `<button type="button" class="btn sm" data-act="park" data-id="${v.id}">Parked from today</button><span class="small muted">Starts the 7-day and 3-month storage reminders</span>`}</div></div>`;
}
function customDueRow(r) {
  return `<div class="due ${r.status}"><span class="bar"></span><div style="min-width:0"><b>${esc(vName(r.v))} · ${esc(r.label)}</b><div class="s">${esc(r.text)}</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><span class="when">${esc(r.when || "")}</span>${(r.btns || []).map(b => `<button type="button" class="btn sm" ${b.act}>${esc(b.label)}</button>`).join("")}</div></div>`;
}
function extraReminders(v) {
  if (!isActive(v)) return [];
  const st = SET(), today = todayISO(), out = [], est = usesOdo(v) ? estOdoToday(v) : null, rate = kmPerDay(v);
  for (const w of warranties(v)) {
    const dd = daysBetween(today, w.date), kmLeft = w.km != null && est != null ? w.km - est : null;
    if (dd < 0 || (kmLeft != null && kmLeft <= 0)) continue;
    const proj = kmLeft != null && rate ? addDays(today, Math.max(0, Math.round(kmLeft / rate))) : null;
    const end = proj && proj < w.date ? proj : w.date, de = daysBetween(today, end);
    if (de <= st.warnDays) out.push({ v, custom: true, kind: "war", label: w.label + " ending", date: end, days: de, status: "soon", when: `in ${de} days`,
      text: `Ends ${fmtDate(w.date)}${w.km ? ` or at ${kmf(w.km)}` : ""}${proj && proj < w.date ? ` — at your average, around ${fmtDate(proj)}` : ""}.${w.extra ? " " + w.extra + "." : ""} Get anything under warranty checked before then.` });
  }
  for (const x of itemsDue(v)) {
    const d = dueByDateKm(v, x.date, x.km);
    out.push({ v, custom: true, kind: "item", label: x.it.name, date: d.sortDate, days: d.days, status: d.status, when: d.status === "over" ? "Overdue" : d.status === "soon" ? "Due soon" : "OK",
      text: `${d.text || "No interval set"}${x.last ? ` · last done ${fmtDate(x.last.date)}` : ""}`, btns: [{ label: "Log it", act: `data-act="logItem" data-id="${v.id}" data-item="${x.it.id}"` }] });
  }
  { const b = battDue(v);
    if (b) { const st2 = SET(), dd = daysBetween(today, b.date), status = b.replace || dd < 0 ? "over" : dd <= st2.dueDays ? "soon" : "ok";
      out.push({ v, custom: true, kind: "batt", label: "12V battery test", date: b.date, days: dd, status, when: b.replace ? "Replace" : status === "over" ? "Overdue" : status === "soon" ? "Due soon" : "OK",
        text: b.replace ? `Last test ${fmtDate(b.last.date)} said replace (${battText(b.last)}). Log the new battery as a "Batteries" expense.`
          : `Due ${fmtDate(b.date)} · ${b.last ? `last test ${fmtDate(b.last.date)}: ${battText(b.last) || "no readings"}` : `battery fitted ${fmtDate(b.fit)}`}`,
        btns: [{ label: "Log test", act: `data-act="logBatt" data-id="${v.id}"` }, ...(b.replace ? [{ label: "New battery", act: `data-act="newBatt" data-id="${v.id}"` }] : [])] }); } }
  if (usesCharge(v)) {
    const lows = ownEntries(v).filter(e => e.type === "charge" && e.lowFull), last = lows[lows.length - 1];
    const base = last ? last.date : (v.acqDate || (vEntries(v.id)[0] || {}).date);
    if (base) {
      const soon = addMonths(base, st.lowSoonMonths), over = addMonths(base, st.lowOverMonths), s = today >= over ? "over" : today >= soon ? "soon" : "ok";
      const target = s === "ok" ? soon : over;
      out.push({ v, custom: true, kind: "low", label: "Full charge from below 10%", date: target, days: daysBetween(today, target), status: s, when: s === "over" ? "Overdue" : s === "soon" ? `by ${fmtShort(over)}` : `from ${fmtShort(soon)}`,
        text: `${last ? `Last done ${fmtDate(last.date)}.` : "Not recorded yet."} Handbook: every 3–6 months (p.83). Run it below 10%, charge to 100% in one go, then log it.`, btns: [{ label: "Log it", act: `data-act="logLow" data-id="${v.id}"` }] });
    }
    const unpark = { label: "Driving again", act: `data-act="unpark" data-id="${v.id}"` };
    if (v.parkedSince) {
      const d = daysBetween(v.parkedSince, today);
      if (d >= 90) out.push({ v, custom: true, kind: "park", label: "Parked over 3 months", date: today, days: -d, status: "over", when: `${d} days`, text: `Parked since ${fmtDate(v.parkedSince)}. Every 3 months: charge to full, then run down to 40–60% (handbook p.84). Damage from skipping this isn't covered by warranty.`, btns: [unpark] });
      else if (d >= 7) out.push({ v, custom: true, kind: "park", label: "Parked over 7 days", date: today, days: -d, status: "soon", when: `${d} days`, text: `Parked since ${fmtDate(v.parkedSince)}. Keep the battery at 40–60% (handbook p.84). At 3 months: charge to full, then back to 40–60%.`, btns: [unpark] });
      else out.push({ v, custom: true, kind: "park", label: "Parked", date: addDays(v.parkedSince, 7), days: 7 - d, status: "ok", when: `${d} day${d === 1 ? "" : "s"}`, text: `Since ${fmtDate(v.parkedSince)}. From day 7 keep the battery at 40–60%.`, btns: [unpark] });
    } else {
      const lastE = vEntries(v.id).slice(-1)[0];
      if (lastE) { const d = daysBetween(lastE.date, today); if (d >= st.noUpdateDays) out.push({ v, custom: true, kind: "noupd", label: `No update for ${d} days`, date: today, days: 0, status: "soon", when: "Check",
        text: "Log this month's charging or an odometer reading. If the car has been parked over 7 days, keep the battery at 40–60% (p.84); if the display is at 0%, charge it within 7 days (p.86).",
        btns: [{ label: "Log charge", act: `data-act="newEntry" data-type="charge" data-id="${v.id}"` }, { label: "Parked", act: `data-act="park" data-id="${v.id}"` }] }); }
    }
  }
  return out;
}
function evReport(v, mode) {
  let h = ""; const today = todayISO(), est = usesOdo(v) ? estOdoToday(v) : null;
  const ws = warranties(v);
  if (ws.length) h += `<h2>Warranty${mode === "sale" ? " — transfers to the new owner" : ""}</h2><table class="rt"><thead><tr><th>Cover</th><th>Expires</th><th class="n">Km limit</th><th>Remaining</th></tr></thead><tbody>${ws.map(w => { const dl = daysBetween(today, w.date), kl = w.km != null && est != null ? w.km - est : null, gone = dl < 0 || (kl != null && kl <= 0);
    return `<tr><td>${esc(w.label)}${w.extra ? `<div class="sm">${esc(w.extra)}</div>` : ""}</td><td>${fmtDate(w.date)}</td><td class="n">${w.km ? nf(w.km, 0) : "Unlimited"}</td><td>${gone ? "Expired" : `${yrsMonths(dl)}${kl != null ? ` / ~${kmf(kl)}` : ""}`}</td></tr>`; }).join("")}</tbody></table><div class="sm">From ${fmtDate(v.warStart)}. Subject to the manufacturer's terms.</div>`;
  if (usesCharge(v)) {
    const [f, t] = periodRange("all", v), s = vStats(v, f, t), caps = capReadings(v);
    if (s.kwh100 || caps.length || dealerReadings(v).length) h += `<h2>Battery &amp; energy (owner's records)</h2><div class="big">${s.kwh100 ? `<div><b>${nf(s.kwh100)} kWh/100km</b><span>average at the plug${v.officialKwh100 ? ` · official ${v.officialKwh100}` : ""}</span></div>` : ""}${caps.length ? `<div><b>${caps[caps.length - 1].pct != null ? nf(caps[caps.length - 1].pct, 0) + "%" : nf(caps[caps.length - 1].cap, 1) + " kWh"}</b><span>latest battery estimate</span></div>` : ""}${v.batMinPct ? `<div><b>${v.batMinPct}%</b><span>warranty minimum</span></div>` : ""}</div>
      ${caps.length ? `<table class="rt"><thead><tr><th>Date</th><th class="n">Odometer</th><th class="n">Charged</th><th class="n">kWh</th><th class="n">Est. capacity</th><th class="n">Of rated</th></tr></thead><tbody>${caps.map(c => `<tr><td>${fmtDate(c.e.date)}</td><td class="n">${c.e.odo != null ? nf(c.e.odo, 0) : "—"}</td><td class="n">${nf(c.e.socStart, 0)}→${nf(c.e.socEnd, 0)}%</td><td class="n">${nf(c.k, 1)}</td><td class="n">${nf(c.cap, 1)} kWh</td><td class="n">${c.pct != null ? nf(c.pct, 0) + "%" : "—"}${c.low ? " *" : ""}</td></tr>`).join("")}</tbody></table><div class="sm">Owner's estimates from charging records (kWh × charging efficiency ÷ % charged).${caps.some(c => c.low) ? " * Below 10°C, less reliable." : ""} A dealer battery health check is the authoritative figure.</div>` : ""}`;
    const dl = dealerReadings(v);
    if (dl.length) h += `<h3 style="font:600 10pt 'Barlow Condensed',Arial,sans-serif;text-transform:uppercase;letter-spacing:.06em;margin:10px 0 2px">Dealer battery health checks</h3><table class="rt"><thead><tr><th>Date</th><th class="n">Odometer</th><th>Workshop</th><th class="n">State of health</th></tr></thead><tbody>${dl.map(d => `<tr><td>${fmtDate(d.e.date)}</td><td class="n">${d.e.odo != null ? nf(d.e.odo, 0) : "—"}</td><td>${esc(d.e.workshop || "")}</td><td class="n">${nf(d.pct, 0)}%</td></tr>`).join("")}</tbody></table>`;
    if (mode === "own" && s.kwh) {
      const yrs = {}; for (const e of s.ch) { const y = e.date.slice(0, 4), r = yrs[y] = yrs[y] || { kh: 0, kp: 0, ch: 0, cp: 0 }; if (e.where === "public") { r.kp += e.kwh || 0; r.cp += costOf(e); } else { r.kh += e.kwh || 0; r.ch += costOf(e); } }
      h += `<table class="rt" style="margin-top:6px"><thead><tr><th>Year</th><th class="n">Home kWh</th><th class="n">Home $</th><th class="n">Public kWh</th><th class="n">Public $</th></tr></thead><tbody>${Object.keys(yrs).sort().map(y => `<tr><td>${y}</td><td class="n">${nf(yrs[y].kh, 0)}</td><td class="n">${money0(yrs[y].ch)}</td><td class="n">${nf(yrs[y].kp, 0)}</td><td class="n">${money0(yrs[y].cp)}</td></tr>`).join("")}</tbody></table>${s.homeEst ? `<div class="sm">Home charging costs are estimates at the owner's set rate.</div>` : ""}`;
    }
  }
  const its = itemsDue(v);
  if (its.length) h += `<h2>Scheduled items</h2><table class="rt"><thead><tr><th>Item</th><th>Interval</th><th>Last done</th><th>Next due</th></tr></thead><tbody>${its.map(x => `<tr><td>${esc(x.it.name)}</td><td>${[x.it.months && x.it.months + " months", x.it.km && kmf(x.it.km)].filter(Boolean).join(" or ") || "—"}</td><td>${x.last ? fmtDate(x.last.date) + (x.last.odo != null ? ` · ${kmf(x.last.odo)}` : "") : "—"}</td><td>${[x.date && fmtDate(x.date), x.km && kmf(x.km)].filter(Boolean).join(" or ") || "—"}</td></tr>`).join("")}</tbody></table>`;
  return h;
}

/* ================= Dropbox: live copy + daily snapshots (same approach as Next Up, with photos like MyMaglites) =================
   Dropbox › Apps › MyGarage
     live/mygarage.json          vehicles, records and settings — sent a few seconds after every change
     live/files/<id>.<ext>       photos and receipts, each sent once
     snapshots/mygarage-*.json   one per day, plus one before every restore (kept 60 days)            */
const DBX_APP_KEY = "phvq3v06n9q3l18"; // public App key for the MyGarage Dropbox app (the App secret is never used)
const DBX_TOKEN = "https://api.dropboxapi.com/oauth2/token";
const DBX_REDIRECT = location.origin + location.pathname.replace(/index\.html$/, "");
const LIVE = "/live/mygarage.json";
let syncing = false, syncT = null, retryT = null, lastCheck = 0, _quiet = 0;
const appKey = () => DBX_APP_KEY || S.meta.dbxKey || "";
const dbxOn = () => !!(S.meta.dbx && S.meta.dbx.refresh);
const hasData = () => S.vehicles.length > 0 || S.entries.length > 0;
const ownerName = () => "phone set up " + fmtDate(S.meta.created || todayISO());
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
class DbxErr extends Error { constructor(m, s, sum) { super(m); this.status = s; this.summary = sum || ""; } }
const dbxArg = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cap = t => t ? t[0].toUpperCase() + t.slice(1) : t;
const fmtWhen = s => { if (!s) return "never"; const d = new Date(s); if (isNaN(d)) return "—"; const t = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }); return (isoOf(d) === todayISO() ? "today" : fmtDate(isoOf(d))) + ", " + t; };
const fileExt = f => (f.type === "image/jpeg" ? "jpg" : f.type === "image/png" ? "png" : f.type === "application/pdf" ? "pdf" : (String(f.name || "").split(".").pop() || "bin")).toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
const filePath = f => `/live/files/${f.id}.${fileExt(f)}`;
const notFound = e => e instanceof DbxErr && e.status === 409 && /not_found/.test(e.summary);
function snapName(kind) { const d = new Date(); return `/snapshots/mygarage-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}${kind ? "-" + p2(d.getHours()) + p2(d.getMinutes()) + "-" + kind : ""}.json`; }

/* every change to vehicles, records, photos or settings marks the data as waiting for Dropbox */
function markDirty() { if (_quiet) return; S.meta.dirty = true; S.meta.changes = (S.meta.changes || 0) + 1; S.meta.seq = (S.meta.seq || 0) + 1; saveMeta().catch(() => {}); scheduleSync(); paintStatus(); }
function syncText() {
  if (!dbxOn()) return hasData() ? { t: "not backed up", c: "warn" } : { t: "version " + APP_VERSION, c: "" };
  if (S.meta.conflict) return { t: "Dropbox copy differs · tap", c: "warn" };
  if (syncing) return { t: "syncing…", c: "" };
  if (S.meta.syncError) return { t: "Dropbox sync failed · tap", c: "warn" };
  if (S.meta.dirty) { const n = S.meta.changes || 1; return { t: `${n} change${n === 1 ? "" : "s"} waiting${mobileBlocked() ? " (Wi‑Fi)" : ""}`, c: "" }; }
  return { t: "in Dropbox ✓", c: "ok" };
}
function paintStatus() {
  const el = $("#hdrsub"); if (!el) return; const act = S.vehicles.filter(isActive).length, s = syncText();
  el.textContent = `${act} vehicle${act === 1 ? "" : "s"} · ${s.t}`; el.className = "sync " + s.c;
  const p = $("#dbxStatus"); if (p) p.textContent = cap(s.t.replace(" · tap", ""));
}

/* sign-in: OAuth with PKCE — no password or secret is stored, only a revocable Dropbox token on this phone */
async function dbxConnect() {
  if (!navigator.onLine) { toast("You're offline. Connect Dropbox when you have internet."); return; }
  const key = DBX_APP_KEY || (($("#dbxKey") || {}).value || S.meta.dbxKey || "").trim();
  if (!/^[a-z0-9]{8,}$/i.test(key)) { S.tab = "more"; S.moreView = "backup"; closeSheet(); render(); toast("Paste the App key from the Dropbox App Console first"); return; }
  const v = b64url(crypto.getRandomValues(new Uint8Array(48))), state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  S.meta.dbxKey = key; S.meta.pkce = { v, state }; S.meta.syncError = null; await saveMeta();
  location.href = "https://www.dropbox.com/oauth2/authorize?" + new URLSearchParams({ client_id: key, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", redirect_uri: DBX_REDIRECT, token_access_type: "offline", state });
}
async function dbxReturn() {
  const p = new URLSearchParams(location.search);
  if (!p.has("code") && !p.has("error")) return false;
  history.replaceState(null, "", DBX_REDIRECT);
  if (p.has("error")) { toast("Dropbox not connected: " + (p.get("error_description") || p.get("error")).replace(/\+/g, " ")); return true; }
  if (!S.meta.pkce || p.get("state") !== S.meta.pkce.state) { toast("That Dropbox sign-in didn't match. Tap Connect Dropbox again."); return true; }
  try {
    const r = await fetch(DBX_TOKEN, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: p.get("code"), client_id: appKey(), code_verifier: S.meta.pkce.v, redirect_uri: DBX_REDIRECT }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.refresh_token) throw new Error(j.error_description || j.error || "HTTP " + r.status);
    S.meta.dbx = { refresh: j.refresh_token, access: j.access_token, expires: Date.now() + (j.expires_in || 14400) * 1000 };
    S.meta.pkce = null; S.meta.dbxRev = null; S.meta.syncError = null; S.meta.conflict = null; S.meta.sentFiles = []; await saveMeta();
    toast(matchMedia("(display-mode: standalone)").matches ? "Dropbox connected" : "Dropbox connected. You can close this tab and open MyGarage from your home screen.");
  } catch (e) { S.meta.pkce = null; S.meta.syncError = "Dropbox sign-in failed: " + (e.message || e); await saveMeta(); toast(S.meta.syncError); }
  return true;
}
async function dbxToken() {
  const d = S.meta.dbx; if (!d || !d.refresh) throw new Error("Dropbox is not connected");
  if (d.access && d.expires > Date.now() + 60000) return d.access;
  const r = await fetch(DBX_TOKEN, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: d.refresh, client_id: appKey() }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { if (j.error === "invalid_grant") { S.meta.dbx = null; S.meta.syncError = "Dropbox access was removed or has expired. Connect Dropbox again."; await saveMeta(); } throw new Error(j.error_description || j.error || "HTTP " + r.status); }
  d.access = j.access_token; d.expires = Date.now() + (j.expires_in || 14400) * 1000; await saveMeta(); return d.access;
}
async function dbxCall(url, opt = {}, retry = true) {
  const tok = await dbxToken();
  const r = await fetch(url, { method: "POST", ...opt, headers: { ...(opt.headers || {}), Authorization: "Bearer " + tok } });
  if (r.status === 401 && retry) { S.meta.dbx.access = null; return dbxCall(url, opt, false); }
  if (r.status === 429 && retry) { await sleep(3000); return dbxCall(url, opt, false); }
  if (!r.ok) { const t = await r.text().catch(() => ""); let s = t; try { s = JSON.parse(t).error_summary || t; } catch {} throw new DbxErr("Dropbox " + r.status + ": " + String(s).slice(0, 120), r.status, String(s)); }
  return r;
}
async function dbxApi(ep, arg) { const r = await dbxCall("https://api.dropboxapi.com/2/" + ep, arg === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(arg) }); const t = await r.text(); return t ? JSON.parse(t) : null; }
async function dbxMeta(path) { try { return await dbxApi("files/get_metadata", { path }); } catch (e) { if (notFound(e)) return null; throw e; } }
async function dbxUpload(path, body, mode) { const r = await dbxCall("https://content.dropboxapi.com/2/files/upload", { headers: { "Content-Type": "application/octet-stream", "Dropbox-API-Arg": dbxArg({ path, mode: mode || "overwrite", autorename: false, mute: true }) }, body }); return r.json(); }
async function dbxDownload(path) { const r = await dbxCall("https://content.dropboxapi.com/2/files/download", { headers: { "Dropbox-API-Arg": dbxArg({ path }) } }); return r.blob(); }
async function dbxList(path) { try { let j = await dbxApi("files/list_folder", { path }), out = j.entries; while (j.has_more) { j = await dbxApi("files/list_folder/continue", { cursor: j.cursor }); out = out.concat(j.entries); } return out; } catch (e) { if (notFound(e)) return []; throw e; } }

/* what goes to Dropbox.
   Two phones can add and edit at the same time: each vehicle and record carries the time it was last changed (_t),
   deletions are remembered (deleted: id → time), and on every sync the two copies are merged record by record —
   the most recent change to a record wins, nothing new from either phone is dropped.
   A restore (from a file or a snapshot) starts a new "generation" (gen): it replaces the copy everywhere instead of merging. */
async function localData(files) {
  files = files || await dbAll("files");
  const [vehicles, entries] = await Promise.all([dbAll("vehicles"), dbAll("entries")]); // always what's actually saved
  return { vehicles, entries, settings: S.meta.settings || null, deleted: S.meta.tomb || {}, gen: S.meta.gen || null,
    files: files.map(f => ({ id: f.id, type: f.type, name: f.name, path: filePath(f) })) };
}
const wrap = d => JSON.stringify({ app: APP_ID, schema: 2, appVersion: APP_VERSION, updatedAt: new Date().toISOString(), owner: S.meta.deviceId, ownerName: ownerName(), data: d });
async function payloadJSON(files) { return wrap(await localData(files)); }
function readPayload(j) { const d = j && (j.data || j); if (!d || !Array.isArray(d.vehicles) || !Array.isArray(d.entries)) throw new Error("That isn't a MyGarage copy");
  return { vehicles: d.vehicles, entries: d.entries, settings: d.settings || null, files: Array.isArray(d.files) ? d.files : [], deleted: d.deleted || {}, gen: d.gen || null }; }
async function pushFiles(files) {
  const sent = new Set(S.meta.sentFiles || []); let n = 0;
  for (const f of files) { if (sent.has(f.id)) continue; await dbxUpload(filePath(f), f.blob, "overwrite"); sent.add(f.id); n++; if (n % 5 === 0) { S.meta.sentFiles = [...sent]; await saveMeta(); } }
  if (n) { S.meta.sentFiles = [...sent]; await saveMeta(); }
}
const tOf = r => (r && r._t) || 0;
function mergeData(L, R) {
  const deleted = { ...(R.deleted || {}) }; for (const [id, t] of Object.entries(L.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, t);
  const pick = (a, b) => { const m = new Map(); for (const r of [...a, ...b]) { const c = m.get(r.id); if (!c || tOf(r) > tOf(c)) m.set(r.id, r); } return [...m.values()].filter(r => !(deleted[r.id] && deleted[r.id] >= tOf(r))); };
  const fm = new Map(); for (const f of [...R.files, ...L.files]) if (!deleted[f.id]) fm.set(f.id, f);
  const settings = tOf(L.settings) >= tOf(R.settings) ? L.settings || R.settings : R.settings;
  return { vehicles: pick(L.vehicles, R.vehicles), entries: pick(L.entries, R.entries), files: [...fm.values()], settings, deleted, gen: R.gen || L.gen };
}
const sig = d => JSON.stringify([d.vehicles.map(r => r.id + ":" + tOf(r)).sort(), d.entries.map(r => r.id + ":" + tOf(r)).sort(), d.files.map(f => f.id).sort(), tOf(d.settings), Object.keys(d.deleted || {}).length, d.gen]);
/* write a merged (or downloaded) copy onto the phone, changing only what differs and fetching photos it doesn't have */
async function applyData(d, say, wholesale) {
  const [lv, le, lf] = await Promise.all([dbAll("vehicles"), dbAll("entries"), dbAll("files")]);
  const have = new Set(lf.map(f => f.id)), want = new Set(d.files.map(f => f.id));
  const missing = d.files.filter(f => !have.has(f.id)); let n = 0;
  for (const f of missing) { try { const b = await dbxDownload(f.path || filePath(f)); f._blob = new Blob([b], { type: f.type }); } catch (e) { if (!notFound(e)) throw e; } if (say && ++n % 5 === 0) say(`Downloading photos ${n} of ${missing.length}…`); }
  _quiet++;
  try {
    for (const [store, local, next] of [["vehicles", lv, d.vehicles], ["entries", le, d.entries]]) {
      const lm = new Map(local.map(r => [r.id, r])), nm = new Set(next.map(r => r.id));
      for (const r of next) { const c = lm.get(r.id); if (!c || tOf(c) !== tOf(r) || wholesale) await dbPut(store, r); }
      for (const r of local) if (!nm.has(r.id)) await dbDel(store, r.id);
    }
    for (const f of lf) if (!want.has(f.id)) await dbDel("files", f.id);
    for (const f of missing) if (f._blob) await dbPut("files", { id: f.id, type: f.type, name: f.name, blob: f._blob });
  } finally { _quiet--; }
  if (missing.length || lf.some(f => !want.has(f.id))) { for (const u of Object.values(S.urls)) URL.revokeObjectURL(u); S.urls = {}; }
  if (d.settings) S.meta.settings = d.settings;
  S.meta.tomb = d.deleted || {}; S.meta.gen = d.gen || S.meta.gen;
  const sent = new Set(S.meta.sentFiles || []); for (const f of d.files) if (!missing.includes(f) || f._blob) sent.add(f.id); S.meta.sentFiles = [...sent];
  await saveMeta(); await reload();
}
async function loadFromDropboxData(d, say) { await applyData(d, say, true); }
async function pushLive(mode, data) {
  const seq = S.meta.seq, files = await dbAll("files");
  await pushFiles(files);
  if (!S.meta.gen) S.meta.gen = uid("g");
  const res = await dbxUpload(LIVE, wrap(data || await localData(files)), mode || (S.meta.dbxRev ? { ".tag": "update", update: S.meta.dbxRev } : "add"));
  S.meta.dbxRev = res.rev; S.meta.lastSync = Date.now(); S.meta.syncError = null; S.meta.conflict = null; S.meta.genPending = false;
  if (S.meta.seq === seq) { S.meta.dirty = false; S.meta.changes = 0; }
  await saveMeta();
}
async function adoptRemote() {
  const rm = await dbxMeta(LIVE); if (!rm) return;
  const d = readPayload(JSON.parse(await (await dbxDownload(LIVE)).text()));
  await loadFromDropboxData(d); S.meta.gen = d.gen;
  S.meta.dbxRev = rm.rev; S.meta.dirty = false; S.meta.changes = 0; S.meta.seq = (S.meta.seq || 0) + 1; S.meta.conflict = null; S.meta.genPending = false; S.meta.lastSync = Date.now(); S.meta.syncError = null; await saveMeta();
  refreshScreen();
}
function refreshScreen() { if (!S.sheet) render(); else if (S.sheet.kind === "vehicle") { const sc = $("#sheet").scrollTop; openVehicle(S.sheet.id); $("#sheet").scrollTop = sc; render(); } else paintStatus(); }
const mobileBlocked = () => !!(S.meta.wifiOnly && navigator.connection && navigator.connection.type === "cellular");
function scheduleSync(ms = 4000) { clearTimeout(syncT); if (dbxOn()) syncT = setTimeout(() => dbxSync(), ms); }
/* one sync round: read Dropbox's copy, merge with this phone's, save the result on both sides */
async function syncOnce() {
  const rm = await dbxMeta(LIVE);
  if (!rm) { if (hasData() || S.meta.dirty) await pushLive("add"); else { S.meta.lastSync = Date.now(); S.meta.syncError = null; await saveMeta(); } return "pushed"; }
  if (rm.rev === S.meta.dbxRev && !S.meta.dirty && !S.meta.genPending) { S.meta.lastSync = Date.now(); S.meta.syncError = null; await saveMeta(); return "none"; }
  const R = readPayload(JSON.parse(await (await dbxDownload(LIVE)).text()));
  if (S.meta.genPending) { // this phone was restored: its copy replaces Dropbox's (which is kept as a snapshot)
    try { await dbxApi("files/copy_v2", { from_path: LIVE, to_path: snapName("replaced"), autorename: true }); } catch {}
    await pushLive({ ".tag": "update", update: rm.rev }); return "pushed";
  }
  if (S.meta.gen && R.gen && R.gen !== S.meta.gen) { // Dropbox's copy was restored on the other phone
    if (S.meta.dirty) { S.meta.conflict = { rev: rm.rev, when: rm.server_modified }; await saveMeta(); return "conflict"; }
    await adoptRemote(); return "adopted";
  }
  const L = await localData();
  const M = mergeData(L, R);
  if (sig(M) !== sig(L)) await applyData(M);
  if (sig(M) !== sig(R) || S.meta.dirty) { await pushLive({ ".tag": "update", update: rm.rev }, { ...(await localData()), gen: M.gen }); }
  else { S.meta.dbxRev = rm.rev; S.meta.lastSync = Date.now(); S.meta.syncError = null; S.meta.dirty = false; S.meta.changes = 0; S.meta.gen = M.gen; await saveMeta(); }
  if (sig(M) !== sig(L)) { refreshScreen(); return "merged"; }
  return "pushed";
}
async function dbxSync(opts = {}) {
  if (!dbxOn() || syncing) return;
  if (!navigator.onLine) { if (opts.manual) toast("You're offline. Changes will go to Dropbox when you're back online."); paintStatus(); return; }
  if (mobileBlocked() && !opts.manual) { paintStatus(); return; }
  syncing = true; lastCheck = Date.now(); paintStatus(); let ok = false, failed = false, res = "";
  const firstLoad = !hasData();
  try {
    for (let i = 0; i < 4; i++) { // someone else saved between our read and write: read again and re-merge
      try { res = await syncOnce(); break; } catch (e) { if (e instanceof DbxErr && e.status === 409 && /conflict/.test(e.summary) && i < 3) { await sleep(400 + Math.random() * 800); continue; } throw e; }
    }
    ok = res !== "conflict";
    if (firstLoad && hasData()) toast(`${S.vehicles.length} vehicles and ${S.entries.length} records loaded from Dropbox`);
    else if (res === "merged" || res === "adopted") toast("Updated with changes from the other phone");
  } catch (e) {
    failed = true; S.meta.syncError = (!navigator.onLine || e instanceof TypeError) ? "Couldn't reach Dropbox. It will try again shortly." : String(e.message || e);
    await saveMeta(); if (opts.manual) toast(S.meta.syncError);
  } finally { syncing = false; }
  if (ok && opts.manual) toast("Dropbox is up to date");
  if (ok && hasData()) maybeSnapshot(false).catch(() => {});
  paintStatus(); refreshBackupView();
  clearTimeout(retryT); if (failed && dbxOn()) retryT = setTimeout(() => dbxSync(), 120000);
  if (ok && S.meta.dirty) scheduleSync(1500);
}
async function maybeSnapshot(force) {
  const day = new Date().toDateString(); if (!force && S.meta.lastSnapDay === day) return;
  const files = await dbAll("files"); await pushFiles(files);
  await dbxUpload(snapName(force ? "manual" : ""), await payloadJSON(files), "overwrite");
  S.meta.lastSnapDay = day; S.meta.lastSnap = Date.now(); await saveMeta(); refreshBackupView();
  pruneSnapshots().catch(() => {});
}
async function pruneSnapshots() {
  const cut = Date.now() - 60 * 864e5;
  for (const e of await dbxList("/snapshots")) { const m = e.name.match(/(\d{4})-(\d{2})-(\d{2})/); if (e[".tag"] === "file" && m && new Date(+m[1], m[2] - 1, +m[3]).getTime() < cut) { try { await dbxApi("files/delete_v2", { path: e.path_lower }); } catch {} } }
}
async function snapshotBeforeReplace() { if (!dbxOn() || !hasData()) return true; try { const files = await dbAll("files"); await pushFiles(files); await dbxUpload(snapName("before-restore"), await payloadJSON(files), "overwrite"); return true; } catch (e) { toast("Couldn't save a snapshot to Dropbox first, so nothing was changed. Check you're online."); return false; } }
async function listSnapshots() {
  const el = $("#snapList"); if (!el) return; el.innerHTML = `<p class="small muted" style="margin:0">Looking in Dropbox…</p>`;
  try {
    const list = (await dbxList("/snapshots")).filter(e => e[".tag"] === "file" && /\.json$/i.test(e.name)).sort((a, b) => String(b.server_modified).localeCompare(String(a.server_modified)));
    el.innerHTML = list.length ? `<div class="lst">${list.slice(0, 60).map(e => `<div class="item"><div><b>${esc(fmtWhen(e.server_modified))}</b><div class="small muted">${/before-restore/.test(e.name) ? "Saved before a restore · " : /replaced/.test(e.name) ? "Dropbox copy that was replaced · " : /manual/.test(e.name) ? "Snapshot now · " : "Daily · "}${(e.size / 1024).toFixed(0)} KB</div></div><button type="button" class="btn sm" data-act="dbxUse" data-path="${esc(e.path_lower)}" data-when="${esc(e.server_modified)}">Use this</button></div>`).join("")}</div>` : `<p class="small muted" style="margin:0">No snapshots in Dropbox yet.</p>`;
  } catch (e) { el.innerHTML = `<p class="small" style="color:var(--bad);margin:0">Couldn't list Dropbox snapshots: ${esc(e.message || e)}</p>`; }
}
async function useSnapshot(path) {
  if (!navigator.onLine) { toast("You're offline."); return; }
  const st = $("#rsStat") || {}; st.textContent = "Getting the snapshot…";
  try {
    const d = readPayload(JSON.parse(await (await dbxDownload(path)).text()));
    if (!(await snapshotBeforeReplace())) { st.textContent = ""; return; }
    await loadFromDropboxData(d, m => { st.textContent = m; });
    S.meta.conflict = null; S.meta.gen = uid("g"); S.meta.genPending = true; markDirty(); S.tab = "garage"; S.moreView = null; render();
    toast(`Snapshot restored: ${S.vehicles.length} vehicles, ${S.entries.length} records`);
  } catch (e) { st.textContent = ""; toast("That snapshot couldn't be used: " + (e.message || e)); }
}
async function resolveConflict(useDropbox) {
  if (!navigator.onLine) { toast("You're offline. Try again when you're online."); return; }
  syncing = true; paintStatus();
  try {
    if (useDropbox) { if (hasData()) { const files = await dbAll("files"); await pushFiles(files); await dbxUpload(snapName("before-restore"), await payloadJSON(files), "overwrite"); } syncing = false; await adoptRemote(); toast("Using the Dropbox copy. This phone's copy was saved as a snapshot."); }
    else { try { await dbxApi("files/copy_v2", { from_path: LIVE, to_path: snapName("replaced"), autorename: true }); } catch {} S.meta.gen = uid("g"); await pushLive("overwrite"); toast("Kept this phone's copy. The Dropbox copy was saved as a snapshot."); }
  } catch (e) { toast("That didn't work: " + (e.message || e)); }
  syncing = false; paintStatus(); render();
}
async function dbxDisconnect() {
  try { await dbxApi("auth/token/revoke"); } catch {}
  S.meta.dbx = null; S.meta.dbxRev = null; S.meta.conflict = null; S.meta.syncError = null; S.meta.sentFiles = []; await saveMeta();
  clearTimeout(syncT); paintStatus(); render(); toast("Dropbox disconnected. Everything already in Dropbox is kept.");
}
function refreshBackupView() { if (S.tab === "more" && S.moreView === "backup" && !S.sheet) { const y = scrollY; render(); scrollTo(0, y); if (dbxOn()) fillStoreInfo(); } }
function dropboxPanel() {
  const m = S.meta;
  if (!dbxOn()) return `<div class="panel" id="dbxPanel"><h3>Dropbox</h3>
    <p style="margin:0">Connect Dropbox and your vehicles, records, photos and receipts are kept there as well as on this phone. Every change is sent within seconds, and a full snapshot is saved each day.</p>
    <p style="margin:0">If this phone is cleared, lost or replaced, connect Dropbox on the new one and everything comes back.</p>
    ${DBX_APP_KEY ? "" : `<div class="field"><label for="dbxKey">Dropbox App key</label><input id="dbxKey" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(m.dbxKey || "")}" placeholder="from the Dropbox App Console"><span class="hint">Redirect URI to enter in the App Console: <b>${esc(DBX_REDIRECT)}</b></span></div>`}
    <div class="row"><button type="button" class="btn primary" data-act="dbxConnect">Connect Dropbox</button></div>
    <p class="small muted" style="margin:0">MyGarage can only see its own folder, Dropbox › Apps › MyGarage. It can't see anything else in your Dropbox.</p></div>`;
  const st = syncText();
  return `${m.conflict ? `<div class="panel" style="border-color:var(--warn)"><h3>Which copy do you want to keep?</h3><p style="margin:0">Dropbox has a copy saved ${m.conflict.when ? fmtWhen(m.conflict.when) : "recently"} that's different from this phone, and this phone has changes that haven't been sent yet.</p><p class="small muted" style="margin:0">Whichever you don't keep is saved as a Dropbox snapshot first, so nothing is lost.</p><div class="row"><button type="button" class="btn primary" data-act="conflictDropbox">Use the Dropbox copy</button><button type="button" class="btn" data-act="conflictPhone">Keep this phone's copy</button></div></div>` : ""}
  <div class="panel" id="dbxPanel"><h3>Dropbox</h3>
    <dl class="kv"><dt>Status</dt><dd id="dbxStatus">${esc(cap(st.t.replace(" · tap", "")))}</dd><dt>Last sync</dt><dd>${esc(fmtWhen(m.lastSync))}</dd><dt>Last snapshot</dt><dd>${esc(fmtWhen(m.lastSnap))}</dd><dt>Folder</dt><dd>Dropbox › Apps › MyGarage</dd></dl>
    ${m.syncError ? `<div class="banner bad"><span>${esc(m.syncError)}</span></div>` : ""}
    <div class="row"><button type="button" class="btn primary" data-act="dbxSyncNow" ${syncing ? "disabled" : ""}>Sync now</button><button type="button" class="btn" data-act="dbxSnap">Snapshot now</button></div>
    <label class="check-inline"><input type="checkbox" id="wifiOnly" ${m.wifiOnly ? "checked" : ""}> Only sync on Wi‑Fi</label>
    <div class="row"><button type="button" class="btn" data-act="dbxList">Restore a Dropbox snapshot…</button><button type="button" class="btn danger" data-act="dbxDisconnect">Disconnect</button></div>
    <div id="snapList"></div>
    <p class="small muted" style="margin:0">In Dropbox › Apps › MyGarage: <b>live</b> holds the current copy (with a <b>files</b> folder for photos and receipts), and <b>snapshots</b> holds one full copy per day (plus one before every restore), kept for 60 days.</p></div>`;
}
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "hidden") { if (S.meta.dirty) dbxSync(); return; }
  const m = await dbGet("meta", "main").catch(() => null); // the Dropbox sign-in tab may have saved newer data
  if (m && (m.stamp || 0) > (S.meta.stamp || 0)) { await reload(); if (!S.sheet) render(); paintStatus(); }
  if (Date.now() - lastCheck > 60000) dbxSync();
});
window.addEventListener("online", () => dbxSync());
document.addEventListener("change", e => { if (e.target.id === "wifiOnly") { S.meta.wifiOnly = e.target.checked; saveMeta(); paintStatus(); if (!S.meta.wifiOnly) dbxSync(); } });

/* ================= events ================= */
document.addEventListener("click", async ev => {
  const tab = ev.target.closest("[data-tab]");
  if (tab && !ev.target.closest("[data-act]")) { S.tab = tab.dataset.tab; if (S.tab === "more") S.moreView = null; closeSheet(); render(); window.scrollTo(0, 0); return; }
  const el = ev.target.closest("[data-act]"); if (!el) return;
  const a = el.dataset.act, id = el.dataset.id;
  switch (a) {
    case "close": closeSheet(); render(); break;
    case "goBack": goBack(); break;
    case "newVehicle": openVehicleEdit(null); break;
    case "openVehicle": S.sheet = null; openVehicle(id); break;
    case "editVehicle": openVehicleEdit(id); break;
    case "saveVehicle": saveVehicle(); break;
    case "delVehicle": readVehicleForm(); S.sheet.confirmDel = true; drawVehicleEdit(); break;
    case "delVehicleNo": readVehicleForm(); S.sheet.confirmDel = false; drawVehicleEdit(); break;
    case "delVehicleYes": deleteVehicle(S.sheet.id); break;
    case "pickPhoto": readVehicleForm(); $("#photoIn").click(); break;
    case "rmPhoto": readVehicleForm(); S.sheet.draft.photo = null; drawVehicleEdit(); break;
    case "toggleSold": S.showSold = !S.showSold; render(); break;
    case "hfilter": S.sheet.filter = el.dataset.f; S.sheet.more = false; { const sc = $("#sheet").scrollTop; openVehicle(S.sheet.id, el.dataset.f); $("#sheet").scrollTop = sc; } break;
    case "hmore": S.sheet.more = true; { const sc = $("#sheet").scrollTop; openVehicle(S.sheet.id); $("#sheet").scrollTop = sc; } break;
    case "quickLog": S.sheet = null; openEntry({ back: null }); break;
    case "newEntry": openEntry({ vid: id, type: el.dataset.type }); break;
    case "editEntry": openEntry({ id }); break;
    case "pickVeh": { readEntryForm(); const d = S.sheet.draft, v = vById(id); d.vehicleId = id; if (!typesFor(v).includes(d.type)) d.type = typesFor(v)[0]; if (d.type === "charge" && !d.where) d.where = "home"; if (d.type === "fuel") d.grade = v.fuelGrade || ""; d.odo = null; S.sheet.warned = null; drawEntry(); break; }
    case "pickType": readEntryForm(); S.sheet.draft.type = el.dataset.t; if (el.dataset.t === "charge" && !S.sheet.draft.where) S.sheet.draft.where = "home"; S.sheet.warned = null; drawEntry(); break;
    case "svcChip": { const inp = $("#sheet [data-k=desc]"); inp.value = inp.value ? inp.value.replace(/[,\s]+$/, "") + ", " + el.dataset.c.toLowerCase() : el.dataset.c; break; }
    case "saveEntry": saveEntry(); break;
    case "delEntry": readEntryForm(); S.sheet.confirmDel = true; drawEntry(); break;
    case "delEntryNo": readEntryForm(); S.sheet.confirmDel = false; drawEntry(); break;
    case "delEntryYes": { const e = S.entries.find(x => x.id === S.sheet.id); for (const r of e.receipts || []) await dbDel("files", r.id); await dbDel("entries", e.id); await reload(); toast("Deleted"); goBack(); break; }
    case "pickReceipt": readEntryForm(); $("#receiptIn").click(); break;
    case "rmReceipt": { readEntryForm(); const r = S.sheet.draft.receipts.splice(+el.dataset.i, 1)[0]; if (r && !S.entries.some(x => (x.receipts || []).some(y => y.id === r.id))) await dbDel("files", r.id); drawEntry(); break; }
    case "renew": { const cat = { rego: "Registration", ctp: "CTP", ins: "Insurance" }[el.dataset.kind]; openEntry({ vid: id, type: "expense", preset: { category: cat } }); break; }
    case "statsFor": S.stat.vid = id; S.tab = "stats"; closeSheet(); render(); window.scrollTo(0, 0); break;
    case "reportFor": openReport(id); break;
    case "statV": S.stat.vid = id; render(); break;
    case "statP": S.stat.period = el.dataset.p; render(); break;
    case "moreHome": S.moreView = null; render(); break;
    case "moreGo": S.moreView = el.dataset.v; render(); window.scrollTo(0, 0); if (el.dataset.v === "backup") fillStoreInfo(); break;
    case "goBackup": S.tab = "more"; S.moreView = "backup"; render(); fillStoreInfo(); break;
    case "saveSettings": saveSettings(); break;
    case "makeBackup": makeBackup(); break;
    case "dlBackup": markBackedUp(); break;
    case "shareBackup": try { await navigator.share({ files: [new File([_backup.blob], _backup.name, { type: "application/zip" })], title: _backup.name }); markBackedUp(); } catch {} break;
    case "pickRestore": $("#restoreIn").click(); break;
    case "rsYes": doRestore(); break;
    case "rsNo": _restore = null; $("#rsConfirm").innerHTML = ""; break;
    case "rtype": S.sheet.o.type = el.dataset.t; drawReport(); break;
    case "printReport": printReport(); break;
    case "dbxConnect": el.disabled = true; try { await dbxConnect(); } catch (err) { toast("Couldn't start Dropbox sign-in: " + (err.message || err)); } el.disabled = false; break;
    case "dbxSyncNow": dbxSync({ manual: true }); break;
    case "dbxSnap": el.disabled = true; maybeSnapshot(true).then(() => toast("Snapshot saved to Dropbox")).catch(x => { el.disabled = false; toast("Snapshot didn't save: " + (x.message || x)); }); break;
    case "dbxList": listSnapshots(); break;
    case "dbxUse": $("#rsConfirm").innerHTML = `<div class="banner" style="margin-top:8px"><span>Replace everything on this phone with the Dropbox snapshot from ${esc(fmtWhen(el.dataset.when))}? What's here now is saved as a snapshot first.</span><button type="button" class="btn primary sm" data-act="dbxUseYes" data-path="${esc(el.dataset.path)}">Restore</button><button type="button" class="btn ghost sm" data-act="rsNo">Cancel</button></div>`; $("#rsConfirm").scrollIntoView({ behavior: "smooth", block: "center" }); break;
    case "dbxUseYes": useSnapshot(el.dataset.path); break;
    case "conflictDropbox": resolveConflict(true); break;
    case "conflictPhone": resolveConflict(false); break;
    case "dbxDisconnect": if (confirm("Disconnect Dropbox? Everything already in Dropbox is kept, but new changes will only be on this phone.")) dbxDisconnect(); break;
    case "reorderOn": S.reorder = true; render(); break;
    case "reorderOff": S.reorder = false; render(); toast("Order saved"); break;
    case "moveV": { const list = sortedV().filter(isActive), i = list.findIndex(x => x.id === id), j = i + (+el.dataset.d); if (i < 0 || j < 0 || j >= list.length) break; [list[i], list[j]] = [list[j], list[i]]; for (let k = 0; k < list.length; k++) if (list[k].order !== k) { const nv = clone(list[k]); nv.order = k; await dbPut("vehicles", nv); } await reload(); render(); break; }
    case "checkUpdate": { toast("Checking…"); try { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); } catch {} setTimeout(() => location.reload(), 800); break; }
    case "chWhere": readEntryForm(); S.sheet.draft.where = el.dataset.w; if (el.dataset.w === "public" && !S.sheet.draft.current) S.sheet.draft.current = "DC"; S.sheet.warned = null; drawEntry(); break;
    case "chCur": readEntryForm(); S.sheet.draft.current = el.dataset.c; drawEntry(); break;
    case "park": case "unpark": { const nv = clone(vById(id)); if (a === "park") nv.parkedSince = todayISO(); else delete nv.parkedSince; await dbPut("vehicles", nv); await reload(); toast(a === "park" ? "Parked — storage reminders start now" : "Parking reminders cleared"); if (S.sheet && S.sheet.kind === "vehicle") openVehicle(id); else render(); break; }
    case "logBatt": openEntry({ vid: id, type: "service", preset: { svcType: BT, desc: "12V battery test" } }); break;
    case "newBatt": openEntry({ vid: id, type: "expense", preset: { category: "Batteries", desc: "New 12V battery" } }); break;
    case "logLow": openEntry({ vid: id, type: "charge", preset: { where: "home", lowFull: true } }); break;
    case "logItem": { const v = vById(id), it = (v.items || []).find(x => x.id === el.dataset.item); openEntry({ vid: id, type: "service", preset: { items: [el.dataset.item], desc: it ? it.name : "" } }); break; }
    case "preset": { readVehicleForm(); const pr = clone(PRESETS[el.dataset.p]); delete pr._label; pr.items = pr.items.map(x => Object.assign({ id: uid("i") }, x)); const d = S.sheet.draft; for (const [k, val] of Object.entries(pr)) if (blank(d[k]) || k === "items" || typeof val === "boolean" || k === "kind") d[k] = val; drawVehicleEdit(); toast("Preset applied — check the details"); break; }
    case "addItem": readVehicleForm(); (S.sheet.draft.items = S.sheet.draft.items || []).push({ id: uid("i") }); drawVehicleEdit(); break;
    case "rmItem": readVehicleForm(); S.sheet.draft.items.splice(+el.dataset.i, 1); drawVehicleEdit(); break;
  }
});
async function markBackedUp() { S.meta.lastBackup = new Date().toISOString(); await saveMeta(); }
document.addEventListener("input", ev => {
  if (!S.sheet) return;
  if (S.sheet.kind === "entry") {
    const t = ev.target;
    if (t.id === "fTrip") { const e = S.sheet.draft, v = vById(e.vehicleId); readEntryForm(); const pf = prevFuelOdo(v, e), tr = num(t.value); if (pf && tr != null) $("#fOdo").value = Math.round(pf.odo + tr); }
    if (t.id === "fOdo") { const tr = $("#fTrip"); if (tr) tr.value = ""; }
    S.sheet.warned = null; livePreview();
  }
});
document.addEventListener("change", async ev => {
  const t = ev.target;
  if (t.id === "restoreIn") { const f = t.files[0]; t.value = ""; if (f) readRestore(f); return; }
  if (t.id === "photoIn") { const f = t.files[0]; t.value = ""; if (!f || !S.sheet || S.sheet.kind !== "editVehicle") return; readVehicleForm(); const blob = await resizeImage(f, 1600); const fid = uid("f"); await dbPut("files", { id: fid, blob, type: "image/jpeg", name: f.name }); S.sheet.draft.photo = fid; drawVehicleEdit(); return; }
  if (t.id === "receiptIn") { const fs = [...t.files]; t.value = ""; if (fs.length) addReceipts(fs); return; }
  if (!S.sheet) return;
  if (t.dataset.redraw && S.sheet.kind === "editVehicle") { readVehicleForm(); drawVehicleEdit(); }
  else if (t.dataset.redraw && S.sheet.kind === "entry") { readEntryForm(); if (t.dataset.k === "category") delete S.sheet.draft._renew; drawEntry(); }
  else if (S.sheet.kind === "entry") livePreview();
  if (S.sheet && S.sheet.kind === "report") {
    if (t.dataset.ro) { S.sheet.o[t.dataset.ro] = t.checked; S.meta.reportOpts = Object.fromEntries(Object.entries(S.sheet.o).filter(([k]) => k !== "type")); saveMeta(); }
    if (t.dataset.rv) { const v = clone(vById(S.sheet.id)); v[t.dataset.rv] = t.dataset.rv === "askingPrice" ? num(t.value) : t.value.trim(); await dbPut("vehicles", v); await reload(); }
    const sc = $("#sheet").scrollTop; drawReport(); $("#sheet").scrollTop = sc;
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.sheet) goBack(); });

/* ================= boot ================= */
async function reload() { [S.vehicles, S.entries] = await Promise.all(["vehicles", "entries"].map(dbAll)); const m = await dbGet("meta", "main"); S.meta = m ? (({ id, ...r }) => r)(m) : {}; _fcache.clear(); }
(async () => {
  try { await openDB(); } catch (e) { $("#main").innerHTML = `<section class="view"><div class="empty">This browser can't store data for the app (private mode or storage blocked). Open it in normal Chrome.</div></section>`; return; }
  await reload(); await migrateData();
  if (!S.meta.deviceId) { S.meta.deviceId = uid("dev"); S.meta.created = todayISO(); await saveMeta(); }
  render();
  if (await dbxReturn()) render();
  dbxSync();
  const q = new URLSearchParams(location.search).get("log"); if (q && S.vehicles.length) openEntry({ type: q, back: null });
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
