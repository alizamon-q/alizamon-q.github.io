/* Davomat v5 — ko'p tashkilotli (SaaS) versiya. Backend: Supabase (public.api RPC). */
"use strict";
const C = window.DAVOMAT_CONFIG || {};
const VERSION = "5.0.0";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

/* ================================================================ SESSIYA */
let S = LS.get("dv_session"); // {token, user, org}
function saveSession() { S ? LS.set("dv_session", S) : LS.del("dv_session"); }
function role() { return S?.user?.role || ""; }
function tz() { return S?.org?.tz || "Asia/Tashkent"; }

/* ================================================================ QURILMA */
// Qurilma ID: shu telefonda bir marta yaratiladigan tasodifiy UUID.
// Qurilma izi (fp): telefonning o'zgarmas belgilari. Til, ekran masshtabi kabi
// foydalanuvchi o'zgartira oladigan narsalar ATAYLAB qo'shilmagan — aks holda xodim o'z telefonidan ham kira olmay qoladi.
const Device = {
  id() {
    let id = LS.get("dv_device");
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : "d" + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
      LS.set("dv_device", id);
    }
    return id;
  },
  fp() {
    const n = navigator, ua = n.userAgent || "";
    const os = /Android/i.test(ua) ? "android" : /iPhone|iPad|iPod/i.test(ua) ? "ios" : /Windows/i.test(ua) ? "win" : /Mac/i.test(ua) ? "mac" : "other";
    const s = [os, n.platform || "", n.hardwareConcurrency || 0, n.maxTouchPoints || 0].join("|");
    let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, "0");
  },
  info() {
    const ua = navigator.userAgent || "";
    const os = /Android/i.test(ua) ? "Android " + ((ua.match(/Android ([\d.]+)/) || [])[1] || "") : /iPhone|iPad|iPod/i.test(ua) ? "iOS " + ((ua.match(/OS ([\d_]+)/) || [])[1] || "").replace(/_/g, ".") : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "Mac" : "Boshqa";
    const model = (ua.match(/Android [\d.]+; (?:[a-z]{2}-[a-z]{2}; )?([^;)]+)/i) || [])[1] || (/iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : "");
    const br = /EdgA?\//.test(ua) ? "Edge" : /OPR|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung" : /YaBrowser/.test(ua) ? "Yandex" : /CriOS|Chrome/.test(ua) ? "Chrome" : /FxiOS|Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "";
    const app = matchMedia("(display-mode: standalone)").matches || navigator.standalone ? "ilova" : "brauzer";
    return [os.trim(), model.trim(), br, app].filter(Boolean).join(" · ");
  },
};

/* ================================================================ API */
let busyN = 0;
function busy(on) { busyN = Math.max(0, busyN + (on ? 1 : -1)); $("#busy").classList.toggle("on", busyN > 0); }
async function api(action, params = {}) {
  if (!C.SUPABASE_URL || C.SUPABASE_URL.includes("XXXX")) throw new Error("config.js da SUPABASE_URL sozlanmagan.");
  const p = { action, ...params, device_id: Device.id() };
  if (S?.token && action !== "login") p.token = S.token;
  const headers = { "Content-Type": "application/json", apikey: C.SUPABASE_KEY };
  if (String(C.SUPABASE_KEY || "").startsWith("eyJ")) headers.Authorization = "Bearer " + C.SUPABASE_KEY;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 25000);
  busy(true);
  let r, j;
  try {
    r = await fetch(C.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/api", { method: "POST", headers, body: JSON.stringify({ p }), signal: ctl.signal });
    j = await r.json().catch(() => null);
  } catch (e) {
    throw new Error(navigator.onLine === false ? "Internet aloqasi yo‘q." : e.name === "AbortError" ? "Server javob bermadi. Qayta urinib ko‘ring." : "Server bilan aloqa xatosi.");
  } finally { clearTimeout(timer); busy(false); }
  if (!r.ok || !j || j.ok === false) {
    const e = new Error(j?.message || "Xatolik yuz berdi (" + r.status + ")");
    e.code = j?.hint || "";
    if (e.code === "AUTH" && action !== "login") { setTimeout(() => logout(true, e.message), 0); }
    if (e.code === "SUB_EXPIRED" && S?.org) { S.org.expired = true; saveSession(); setTimeout(() => route(), 0); }
    throw e;
  }
  return j;
}

/* ================================================================ KESH (tezkor ochilish) */
// Sahifa avval oxirgi saqlangan ma'lumot bilan DARHOL chiziladi, so'ng serverdan yangisi kelib yangilanadi.
const mem = new Map();
function ck(k) { return "dv_c_" + (S?.user?.id || "x") + "_" + k; }
function cacheGet(k) { return mem.get(ck(k)) || LS.get(ck(k)); }
function cacheSet(k, v) { const x = { t: Date.now(), v }; mem.set(ck(k), x); LS.set(ck(k), x); }
function cacheDrop(prefix = "") {
  const pre = ck(prefix);
  for (const k of [...mem.keys()]) if (k.startsWith(pre)) mem.delete(k);
  try { Object.keys(localStorage).filter(k => k.startsWith(pre)).forEach(k => localStorage.removeItem(k)); } catch (e) {}
}
function cacheClearAll() { mem.clear(); try { Object.keys(localStorage).filter(k => k.startsWith("dv_c_")).forEach(k => localStorage.removeItem(k)); } catch (e) {} }
let viewSeq = 0;
async function view(key, load, render, ttl = 15000) {
  const seq = ++viewSeq, c = cacheGet(key);
  if (c) render(c.v, true); else page().innerHTML = skeleton();
  if (c && Date.now() - c.t < ttl) return;
  try {
    const v = await load();
    cacheSet(key, v);
    if (seq !== viewSeq) return;
    if (!c || JSON.stringify(c.v) !== JSON.stringify(v)) render(v, false);
  } catch (e) {
    if (seq !== viewSeq) return;
    if (!c) page().innerHTML = `<div class="alert bad">${esc(e.message)}</div><button class="btn ghost" onclick="route()">Qayta urinish</button>`;
    else if (e.code !== "AUTH") toast(e.message, false);
  }
}
const skeleton = () => `<div class="card"><div class="skel" style="width:40%"></div><div class="skel"></div><div class="skel" style="width:70%"></div></div>`;

/* ================================================================ YORDAMCHILAR */
function toast(msg, ok = true) {
  const t = $("#toast"); t.textContent = msg; t.style.background = ok ? "#15805f" : "#b52f2f"; t.style.display = "block";
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.style.display = "none"), 3800);
}
function page() { return $("#page"); }
function parts(d, z = tz()) {
  const o = {}; new Intl.DateTimeFormat("en-GB", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).forEach(p => (o[p.type] = p.value)); return o;
}
function fmtDT(s) { if (!s) return "—"; const d = new Date(s); if (isNaN(d)) return s; const p = parts(d); return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`; }
function fmtT(s) { if (!s) return "—"; const p = parts(new Date(s)); return `${p.hour}:${p.minute}`; }
function fmtD(s) { if (!s) return "—"; const [y, m, d] = String(s).slice(0, 10).split("-"); return `${d}.${m}.${y}`; }
function todayStr() { const p = parts(new Date()); return `${p.year}-${p.month}-${p.day}`; }
function monthStr() { return todayStr().slice(0, 7); }
function money(n) { return Number(n || 0).toLocaleString("ru-RU").replace(/,/g, " ") + " so‘m"; }
function stBadge(s) { return `<span class="badge ${s === "Tasdiqlandi" ? "b-ok" : s === "Rad etildi" ? "b-bad" : "b-warn"}">${esc(s)}</span>`; }
function mapUrl(lat, lon) { return `https://www.google.com/maps?q=${lat},${lon}`; }
function locCell(x) {
  let s = `<a href="${mapUrl(x.lat, x.lon)}" target="_blank" rel="noopener">📍 Xarita</a>`;
  if (x.distance_m != null) s += ` <span class="tiny muted">${x.distance_m < 1000 ? x.distance_m + " m" : (x.distance_m / 1000).toFixed(1) + " km"}</span>`;
  if (x.outside) s += ` <span class="badge b-bad">Hududdan tashqarida</span>`;
  if (x.accuracy > 150) s += ` <span class="badge b-warn" title="GPS aniqligi past">±${x.accuracy} m</span>`;
  return s;
}
function daysCls(n) { return n < 0 ? "days-bad" : n <= 5 ? "days-warn" : "days-ok"; }
function daysTxt(n) { return n < 0 ? `${-n} kun oldin tugagan` : n === 0 ? "bugun tugaydi" : `${n} kun qoldi`; }
function logoOf(o) { return o?.logo || "assets/icon-192.png"; }
function applyBrand(o) {
  const c = o?.color && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : (C.BRAND_COLOR || "#2563eb");
  document.documentElement.style.setProperty("--brand", c);
  $('meta[name="theme-color"]')?.setAttribute("content", c);
}
function csvDownload(name, rows) {
  const s = "﻿" + rows.map(r => r.map(v => { v = String(v ?? ""); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(";")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([s], { type: "text/csv;charset=utf-8" })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function csvParse(text) {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/)[0] || ""; const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
function modal(html, onClose) {
  const m = document.createElement("div"); m.className = "modal";
  m.innerHTML = `<div class="modal-card"><button class="modal-x" aria-label="Yopish">✕</button>${html}</div>`;
  const close = () => { m.remove(); document.removeEventListener("keydown", esc_); onClose && onClose(); };
  const esc_ = e => e.key === "Escape" && close();
  m.addEventListener("click", e => { if (e.target === m) close(); });
  $(".modal-x", m).onclick = close; document.addEventListener("keydown", esc_);
  document.body.appendChild(m); m.close = close; return m;
}
async function withBtn(btn, fn) {
  const t = btn.innerHTML; btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, false); } finally { btn.disabled = false; btn.innerHTML = t; }
}
function vals(root) { const o = {}; $$("[name]", root).forEach(el => (o[el.name] = el.type === "checkbox" ? el.checked : el.value.trim())); return o; }
function passwordCard() {
  return `<div class="card"><h3>🔑 Parolni o‘zgartirish</h3><form id="pwForm" class="grid g3">
  <input name="old" type="password" placeholder="Joriy parol" autocomplete="current-password" required>
  <input name="new" type="password" placeholder="Yangi parol (kamida 6 belgi)" autocomplete="new-password" required minlength="6">
  <input name="new2" type="password" placeholder="Yangi parolni takrorlang" autocomplete="new-password" required>
  <div><button class="btn">Parolni yangilash</button></div></form></div>`;
}
function bindPassword() {
  const f = $("#pwForm"); if (!f) return;
  f.onsubmit = e => {
    e.preventDefault(); const v = vals(f);
    if (v.new.length < 6) return toast("Yangi parol kamida 6 belgi bo‘lsin.", false);
    if (v.new !== v.new2) return toast("Yangi parollar mos kelmadi.", false);
    withBtn($("button", f), async () => { await api("change_password", { old: v.old, new: v.new }); f.reset(); toast("Parol o‘zgartirildi"); });
  };
}
function fileToLogo(file) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const N = 256, k = Math.min(1, N / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      let d = c.toDataURL("image/webp", 0.9); if (!d.startsWith("data:image/webp")) d = c.toDataURL("image/png");
      if (d.length > 290000) d = c.toDataURL("image/jpeg", 0.85);
      res(d);
    };
    img.onerror = () => rej(new Error("Rasmni o‘qib bo‘lmadi."));
    img.src = url;
  });
}

/* ================================================================ KIRISH */
function urlOrg() { const m = location.search.match(/[?&]org=([a-z0-9-]+)/i); return m ? m[1].toLowerCase() : ""; }
let loginMode = "org";
async function renderLogin(msg) {
  const code = LS.get("dv_org") || C.DEFAULT_ORG || "";
  const brand = LS.get("dv_org_brand");
  const known = code && brand && brand.code === code;
  applyBrand(known ? brand : null);
  const sa = loginMode === "sa";
  $("#root").innerHTML = `<div class="login"><div class="login-card">
    <img class="login-logo" src="${esc(known && !sa ? logoOf(brand) : "assets/icon-192.png")}" alt="">
    <h1>${esc(sa ? "Xizmat ko‘rsatuvchi kirishi" : known ? brand.name : (C.APP_NAME || "Davomat"))}</h1>
    <div class="muted small">${sa ? "Super-administrator paneli" : "Xodimlar davomatini nazorat qilish tizimi"}</div>
    <form id="lf">
      <div id="le" class="alert bad ${msg ? "" : "hidden"}">${esc(msg || "")}</div>
      ${sa ? "" : known ? `<div class="org-chip field">Tashkilot kodi: <b>${esc(code)}</b> <button type="button" class="linkbtn" id="chOrg">o‘zgartirish</button></div>`
        : `<div class="field"><label>Tashkilot kodi</label><input name="org" value="${esc(code)}" placeholder="masalan: samqurilish" autocapitalize="off" autocorrect="off" required></div>`}
      <div class="field"><label>Login</label><input name="username" autocomplete="username" autocapitalize="off" autocorrect="off" required></div>
      <div class="field"><label>Parol</label><input name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn wide lg">Kirish</button>
    </form>
    <p class="tiny muted" style="margin:14px 0 0">${sa ? `<button class="linkbtn" id="toOrg">← Tashkilot xodimi sifatida kirish</button>` : "Har bir xodim akkaunti faqat bitta telefonga biriktiriladi."}</p>
    <div class="row" style="justify-content:center;margin-top:10px">${installBtnHTML()}</div>
    ${sa ? "" : `<p class="tiny" style="margin:12px 0 0"><button class="linkbtn muted" id="toSa" style="color:#9aa1b0">Xizmat ko‘rsatuvchi</button></p>`}
  </div></div>`;
  bindInstall();
  $("#chOrg") && ($("#chOrg").onclick = () => { LS.del("dv_org"); LS.del("dv_org_brand"); renderLogin(); });
  $("#toSa") && ($("#toSa").onclick = () => { loginMode = "sa"; renderLogin(); });
  $("#toOrg") && ($("#toOrg").onclick = () => { loginMode = "org"; renderLogin(); });
  if (code && !known && !sa) loadBrand(code);
  const f = $("#lf");
  f.onsubmit = e => {
    e.preventDefault(); const v = vals(f); const org = sa ? "" : (v.org ?? code).toLowerCase();
    withBtn($("button.btn", f), async () => {
      $("#le").classList.add("hidden");
      try {
        const r = await api("login", { org, username: v.username, password: v.password, device_id: Device.id(), device_fp: Device.fp(), device_info: Device.info() });
        S = { token: r.token, user: r.user, org: r.org }; saveSession();
        if (org) { LS.set("dv_org", org); if (r.org) LS.set("dv_org_brand", { code: org, name: r.org.name, logo: r.org.logo, color: r.org.color }); }
        loginMode = "org"; startApp();
      } catch (ex) { $("#le").textContent = ex.message; $("#le").classList.remove("hidden"); }
    });
  };
}
async function loadBrand(code) {
  try {
    const r = await api("org_public", { org: code });
    LS.set("dv_org_brand", { code, name: r.org.name, logo: r.org.logo, color: r.org.color });
    if (!S) renderLogin();
  } catch (e) { /* kod noto'g'ri bo'lsa — login paytida xabar chiqadi */ }
}
async function logout(silent, msg) {
  if (!S) return;
  if (!silent) { try { await api("logout"); } catch (e) {} }
  S = null; saveSession(); cacheClearAll(); location.hash = ""; renderLogin(msg);
}

/* ================================================================ ILOVA QOBIG'I */
const NAV = {
  employee: [["home", "✅", "Davomat"], ["history", "🗓️", "Tarix"], ["profile", "👤", "Profil"]],
  admin: [["dashboard", "📊", "Panel"], ["pending", "⏳", "Tasdiqlash"], ["records", "🗂️", "Davomatlar"], ["users", "👥", "Xodimlar"], ["report", "📅", "Oylik hisobot"], ["settings", "⚙️", "Sozlamalar"], ["billing", "💳", "Obuna"]],
  superadmin: [["orgs", "🏢", "Tashkilotlar"], ["payments", "💰", "To‘lovlar"], ["sasettings", "⚙️", "Sozlamalar"]],
};
const TAB_MAX = 4;
function startApp() {
  applyBrand(S.org);
  const nav = NAV[role()] || [];
  const o = S.org;
  $("#root").innerHTML = `<div class="shell">
    <aside class="side" id="side">
      <div class="side-brand"><img src="${esc(o ? logoOf(o) : "assets/icon-192.png")}" alt=""><b>${esc(o ? (o.short_name || o.name) : "Super-admin")}</b></div>
      <nav>${nav.map(([k, ic, t]) => `<button class="nav-i" data-go="${k}"><span class="ic">${ic}</span>${t}<span class="cnt hidden" data-cnt="${k}"></span></button>`).join("")}</nav>
      <div class="side-foot">${installBtnHTML("nav-i")}<button class="nav-i" id="lo"><span class="ic">↪</span>Chiqish</button>
      <div class="tiny muted" style="padding:6px 12px">v${VERSION}</div></div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <div class="main">
      <header class="top"><button class="menu-btn" id="mb" aria-label="Menyu">☰</button><h2 id="ttl"></h2>
        <div class="who"><b>${esc(S.user.full_name)}</b><br>${esc(role() === "admin" ? "Administrator" : role() === "superadmin" ? "Super-admin" : S.user.position || "Xodim")}</div></header>
      <div id="net" class="offline hidden">Internet aloqasi yo‘q</div>
      <div id="banner"></div>
      <main id="page"></main>
    </div>
    <nav class="tabbar">${nav.slice(0, nav.length > TAB_MAX + 1 ? TAB_MAX : nav.length).map(([k, ic, t]) => `<button data-go="${k}"><span class="ic">${ic}</span>${t.split(" ")[0]}<span class="cnt hidden" data-cnt="${k}"></span></button>`).join("")}
      ${nav.length > TAB_MAX + 1 ? `<button id="more"><span class="ic">☰</span>Yana</button>` : ""}</nav>
  </div>`;
  $$("[data-go]").forEach(b => (b.onclick = () => go(b.dataset.go)));
  const side = $("#side"), scrim = $("#scrim");
  const toggle = on => { side.classList.toggle("open", on); scrim.classList.toggle("open", on); };
  $("#mb").onclick = () => toggle(true); scrim.onclick = () => toggle(false);
  $("#more") && ($("#more").onclick = () => toggle(true));
  $("#lo").onclick = () => { if (confirm("Tizimdan chiqasizmi?")) logout(); };
  bindInstall();
  netState();
  route();
  refreshMe();
}
function go(name) { if (location.hash === "#/" + name) route(); else location.hash = "#/" + name; }
function setNav(name, title) {
  $$("[data-go]").forEach(b => b.classList.toggle("on", b.dataset.go === name));
  $("#ttl").textContent = title; $("#side")?.classList.remove("open"); $("#scrim")?.classList.remove("open");
  document.title = title + " — Davomat";
}
function setCount(name, n) { $$(`[data-cnt="${name}"]`).forEach(el => { el.textContent = n; el.classList.toggle("hidden", !n); }); }
function banner() {
  const b = $("#banner"); if (!b) return; const o = S?.org;
  if (o && role() === "admin" && !o.expired && o.days_left <= 5)
    b.innerHTML = `<div class="alert warn" style="margin:12px 20px 0">⚠️ Obuna muddati ${daysTxt(o.days_left)} (${fmtD(o.paid_until)}). <a href="#/billing">To‘lov ma’lumotlari</a></div>`;
  else b.innerHTML = "";
}
async function refreshMe() {
  try {
    const r = await api("me"); S.user = r.user; S.org = r.org; saveSession(); applyBrand(S.org); banner();
    if (S.org) {
      LS.set("dv_org_brand", { code: S.org.code, name: S.org.name, logo: S.org.logo, color: S.org.color });
      const img = $(".side-brand img"); if (img) img.src = logoOf(S.org);
      const nm = $(".side-brand b"); if (nm) nm.textContent = S.org.short_name || S.org.name;
      if (S.org.expired) route();
    }
  } catch (e) {}
}

const ROUTES = {
  employee: { home: pHome, history: pHistory, profile: pProfile },
  admin: { dashboard: pDashboard, pending: pPending, records: pRecords, users: pUsers, report: pReport, settings: pSettings, billing: pBilling },
  superadmin: { orgs: pOrgs, payments: pPayments, sasettings: pSaSettings },
};
function route() {
  if (!S) return renderLogin();
  if (!$("#page")) return startApp();
  const r = role(); const routes = ROUTES[r] || {};
  let name = (location.hash.match(/^#\/(\w+)/) || [])[1];
  if (!routes[name]) name = Object.keys(routes)[0];
  banner();
  if (S.org?.expired) {
    if (r === "admin") name = "billing";
    else { setNav("", "Obuna tugagan"); page().innerHTML = expiredEmployee(); return; }
  }
  const t = (NAV[r].find(x => x[0] === name) || [, , ""])[2];
  setNav(name, t);
  routes[name]();
}
function expiredEmployee() {
  return `<div class="card hero"><div class="big">⛔</div><h2>Tashkilot obunasi tugagan</h2>
  <p class="muted">Davomat yuborish vaqtincha to‘xtatildi. Iltimos, rahbariyatga murojaat qiling.</p>
  <button class="btn ghost" onclick="refreshMe().then(route)">Qayta tekshirish</button></div>`;
}
window.addEventListener("hashchange", route);
function netState() { const n = $("#net"); if (n) n.classList.toggle("hidden", navigator.onLine !== false); }
window.addEventListener("online", netState); window.addEventListener("offline", netState);

/* ================================================================ XODIM SAHIFALARI */
function pHome() {
  const m = monthStr();
  page().innerHTML = `<div class="card hero">
    <div class="profile" style="justify-content:center;margin-bottom:6px"><img src="${esc(logoOf(S.org))}" alt=""></div>
    <h2 style="margin-bottom:2px">${esc(S.user.full_name)}</h2>
    <div class="muted small">${esc([S.user.position, S.user.department].filter(Boolean).join(" · "))}</div>
    <div class="status-line" id="todayLine"><span class="muted small">Bugungi holat yuklanmoqda…</span></div>
    <div class="field" style="text-align:left"><label>Izoh</label>
      <textarea id="note" rows="3" placeholder="Masalan: ishxonadaman / Oqdaryo tumanidagi obyektdaman"></textarea></div>
    <button class="btn ok lg wide" id="send">✓ Davomatni yuborish</button>
    <div class="tiny muted" id="gps" style="margin-top:10px">Tugmani bosganingizda joylashuvingiz (GPS) avtomatik olinadi.</div>
  </div>`;
  $("#note").value = LS.get("dv_note_draft", "");
  $("#note").oninput = e => LS.set("dv_note_draft", e.target.value);
  $("#send").onclick = sendAttendance;
  const show = d => {
    const t = todayStr(); const items = (d.items || []).filter(x => { const p = parts(new Date(x.sent_at)); return `${p.year}-${p.month}-${p.day}` === t; });
    const el = $("#todayLine"); if (!el) return;
    el.innerHTML = items.length ? `<span class="badge b-ok">Bugun yuborilgan: ${items.length} marta</span><span class="muted small">oxirgisi ${fmtT(items[0].sent_at)}</span> ${stBadge(items[0].status)}`
      : `<span class="badge b-warn">Bugun hali yuborilmagan</span>`;
  };
  const c = cacheGet("my:" + m); if (c) show(c.v);
  api("my_attendance", { month: m }).then(d => { cacheSet("my:" + m, d); show(d); }).catch(() => {});
}
function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("Qurilmangiz GPS lokatsiyani qo‘llamaydi."));
    navigator.geolocation.getCurrentPosition(res, err => rej(new Error(err.code === 1
      ? "Joylashuvga ruxsat berilmagan. Telefon sozlamalaridan ushbu ilova (yoki brauzer) uchun “Joylashuv” ruxsatini yoqing."
      : err.code === 3 ? "GPS signali olinmadi. Ochiq joyga chiqib, qayta urinib ko‘ring." : "Joylashuvni aniqlab bo‘lmadi. GPS yoqilganini tekshiring.")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 });
  });
}
async function sendAttendance() {
  const btn = $("#send"), gps = $("#gps"), note = $("#note").value.trim();
  btn.disabled = true; btn.textContent = "📡 Joylashuv aniqlanmoqda…";
  try {
    const pos = await getPosition();
    gps.textContent = `Aniqlik: ±${Math.round(pos.coords.accuracy)} m`;
    btn.textContent = "Yuborilmoqda…";
    const r = await api("submit_attendance", { note, lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy || 0) });
    LS.del("dv_note_draft"); cacheDrop("my:");
    page().innerHTML = `<div class="card hero"><div class="big">✅</div><h2>Ma’lumot yuborildi</h2>
      <p class="muted">Vaqt: ${fmtDT(new Date().toISOString())}. Holat: <b>Kutilmoqda</b> — administrator tasdiqlagach “Tarix” bo‘limida ko‘rinadi.</p>
      ${r.outside ? `<div class="alert warn">Siz belgilangan ish hududidan tashqaridasiz (${r.distance_m < 1000 ? r.distance_m + " m" : (r.distance_m / 1000).toFixed(1) + " km"}). Ma’lumot administratorga shu belgi bilan yuborildi.</div>` : ""}
      <div class="row" style="justify-content:center"><button class="btn ghost" onclick="go('history')">Tarixni ko‘rish</button><button class="btn plain" onclick="pHome()">Orqaga</button></div></div>`;
  } catch (e) {
    toast(e.message, false); btn.disabled = false; btn.textContent = "✓ Davomatni yuborish";
    if (gps) gps.textContent = e.message;
  }
}
let histMonth = null;
function pHistory() {
  histMonth = histMonth || monthStr();
  const m = histMonth;
  view("my:" + m, () => api("my_attendance", { month: m }), d => {
    page().innerHTML = `<div class="toolbar"><input type="month" id="hm" value="${m}"></div>
    <div class="list">${d.items.map(x => `<div class="item"><div class="row between"><span class="t">${fmtDT(x.sent_at)}</span>${stBadge(x.status)}</div>
      ${x.note ? `<div style="margin-top:6px">${esc(x.note)}</div>` : ""}
      <div class="meta">${locCell(x)}${x.decided_at ? ` · Ko‘rib chiqildi: ${fmtDT(x.decided_at)}` : ""}</div>
      ${x.admin_note ? `<div class="meta">Administrator izohi: <b>${esc(x.admin_note)}</b></div>` : ""}</div>`).join("") || `<div class="card empty">Bu oyda ma’lumot yo‘q.</div>`}</div>`;
    $("#hm").onchange = e => { histMonth = e.target.value || monthStr(); pHistory(); };
  });
}
function pProfile() {
  const u = S.user;
  page().innerHTML = `<div class="card"><div class="profile"><img src="${esc(logoOf(S.org))}" alt=""><div>
    <h2 style="margin:0">${esc(u.full_name)}</h2><div class="muted">${esc(S.org?.name || "")}</div></div></div><hr>
    <div class="grid g2 small"><div><span class="muted">Login:</span> <b>${esc(u.username)}</b></div><div><span class="muted">Tashkilot kodi:</span> <b>${esc(S.org?.code || "")}</b></div>
    <div><span class="muted">Bo‘lim:</span> ${esc(u.department || "—")}</div><div><span class="muted">Lavozim:</span> ${esc(u.position || "—")}</div>
    <div><span class="muted">Biriktirilgan qurilma:</span> ${esc(u.device_info || Device.info())}</div></div></div>
    ${passwordCard()}
    <div class="card row">${installBtnHTML("btn ghost")}<span class="spacer"></span><button class="btn plain" onclick="confirm('Tizimdan chiqasizmi?')&&logout()">↪ Chiqish</button></div>`;
  bindPassword(); bindInstall();
}

/* ================================================================ ADMIN SAHIFALARI */
let dashDate = null, dashFilter = "all";
function pDashboard() {
  dashDate = dashDate || todayStr();
  const d0 = dashDate;
  view("dash:" + d0, () => api("dashboard", { date: d0, month: d0.slice(0, 7) }), d => {
    setCount("pending", d.pending_total);
    const sent = d.daily.filter(x => x.count > 0), not = d.daily.filter(x => !x.count);
    const list = dashFilter === "sent" ? sent : dashFilter === "not" ? not : d.daily;
    page().innerHTML = `
    <div class="kpis">
      <div class="kpi br"><b>${d.daily.length}</b><span>Faol xodimlar</span></div>
      <div class="kpi ok"><b>${sent.length}</b><span>Yuborgan</span></div>
      <div class="kpi bad"><b>${not.length}</b><span>Yubormagan</span></div>
      <div class="kpi warn"><b>${d.pending_total}</b><span>Tasdiqlash kutilmoqda</span></div>
    </div>
    <div class="card"><div class="toolbar"><h3 style="margin:0">Kunlik davomat</h3><span class="spacer"></span>
      <input type="date" id="dd" value="${d0}">
      <div class="seg" id="seg"><button data-f="all">Hammasi</button><button data-f="sent">Yuborgan</button><button data-f="not">Yubormagan</button></div>
      <button class="btn sm ghost" id="cpNot" title="Yubormaganlar ro‘yxatini nusxalash">📋 Yubormaganlar</button></div>
      <div class="tw"><table class="fit"><thead><tr><th>№</th><th>Xodim</th><th class="hide-m">Bo‘lim / lavozim</th><th>Holat</th><th>Vaqt</th></tr></thead><tbody>
      ${list.map((x, i) => `<tr><td>${i + 1}</td><td><b>${esc(x.full_name)}</b></td><td class="small hide-m">${esc([x.department, x.position].filter(Boolean).join(" · "))}</td>
        <td>${x.count ? `<span class="badge b-ok">Yuborgan</span>${x.outside ? ' <span class="badge b-bad">Hududdan tashqarida</span>' : ""}` : '<span class="badge b-bad">Yubormagan</span>'}</td>
        <td>${x.count ? fmtT(x.first) + (x.count > 1 ? ` <span class="tiny muted">(${x.count} marta, oxirgisi ${fmtT(x.last)})</span>` : "") : "—"}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">Xodim yo‘q. “Xodimlar” bo‘limidan qo‘shing.</td></tr>`}
      </tbody></table></div></div>`;
    $$("#seg button").forEach(b => { b.classList.toggle("on", b.dataset.f === dashFilter); b.onclick = () => { dashFilter = b.dataset.f; pDashboard(); }; });
    $("#dd").onchange = e => { dashDate = e.target.value || todayStr(); pDashboard(); };
    $("#cpNot").onclick = () => {
      const txt = `${fmtD(d0)} kuni davomat yubormaganlar (${not.length}):\n` + not.map((x, i) => `${i + 1}. ${x.full_name}`).join("\n");
      navigator.clipboard?.writeText(txt).then(() => toast("Nusxalandi — Telegramga joylashingiz mumkin"), () => toast(txt));
    };
  }, 10000);
}
function pPending() {
  view("pending", () => api("att_list", { status: "Kutilmoqda" }), d => {
    setCount("pending", d.items.length);
    page().innerHTML = `<div class="card"><div class="toolbar">
      <label class="row" style="margin:0;font-weight:500"><input type="checkbox" class="chk" id="all"> Hammasini belgilash</label><span class="spacer"></span>
      <button class="btn ok sm" id="bOk">✓ Belgilanganlarni tasdiqlash</button><button class="btn bad sm" id="bNo">✕ Rad etish</button></div>
      <div class="list">${d.items.map(x => `<div class="item"><div class="row" style="align-items:flex-start;flex-wrap:nowrap">
        <input type="checkbox" class="chk pc" value="${x.id}" style="margin-top:3px">
        <div style="flex:1;min-width:0"><div class="row between"><span class="t">${esc(x.full_name)}</span><span class="small muted">${fmtDT(x.sent_at)}</span></div>
        <div class="meta">${esc([x.department, x.position].filter(Boolean).join(" · "))}</div>
        ${x.note ? `<div style="margin:6px 0">${esc(x.note)}</div>` : ""}
        <div class="meta">${locCell(x)}</div>
        <div class="row" style="margin-top:8px"><input placeholder="Izoh (ixtiyoriy)" data-n="${x.id}" style="flex:1;min-width:140px;padding:7px 10px">
        <button class="btn ok sm" data-ok="${x.id}">Tasdiqlash</button><button class="btn bad sm" data-no="${x.id}">Rad etish</button></div></div></div></div>`).join("")
        || `<div class="empty">🎉 Tasdiqlash kutilayotgan ma’lumot yo‘q.</div>`}</div></div>`;
    const decide = async (ids, decision, note, btn) => withBtn(btn, async () => {
      if (!ids.length) return toast("Hech narsa belgilanmagan.", false);
      await api("att_decide", { ids, decision, admin_note: note || "" });
      cacheDrop("pending"); cacheDrop("dash:"); cacheDrop("rec:"); cacheDrop("rep:");
      toast(`${ids.length} ta yozuv: ${decision}`); pPending();
    });
    $("#all").onchange = e => $$(".pc").forEach(c => (c.checked = e.target.checked));
    const sel = () => $$(".pc:checked").map(c => c.value);
    $("#bOk").onclick = e => decide(sel(), "Tasdiqlandi", "", e.currentTarget);
    $("#bNo").onclick = e => decide(sel(), "Rad etildi", "", e.currentTarget);
    $$("[data-ok]").forEach(b => (b.onclick = () => decide([b.dataset.ok], "Tasdiqlandi", $(`[data-n="${b.dataset.ok}"]`).value, b)));
    $$("[data-no]").forEach(b => (b.onclick = () => decide([b.dataset.no], "Rad etildi", $(`[data-n="${b.dataset.no}"]`).value, b)));
  }, 5000);
}
let recMonth = null, recStatus = "", recUser = "";
function pRecords() {
  recMonth = recMonth || monthStr();
  const m = recMonth, st = recStatus, us = recUser;
  const users = cacheGet("users")?.v?.items?.filter(u => u.role === "employee") || [];
  if (!users.length) api("users_list").then(r => { cacheSet("users", r); if (location.hash === "#/records" && r.items.length) pRecords(); }).catch(() => {});
  view(`rec:${m}:${st}:${us}`, () => api("att_list", { month: m, status: st, user_id: us }), d => {
    page().innerHTML = `<div class="card"><div class="toolbar">
      <input type="month" id="rm" value="${m}">
      <select id="rs"><option value="">Barcha holatlar</option>${["Kutilmoqda", "Tasdiqlandi", "Rad etildi"].map(s => `<option ${s === st ? "selected" : ""}>${s}</option>`).join("")}</select>
      <select id="ru"><option value="">Barcha xodimlar</option>${users.map(u => `<option value="${u.id}" ${u.id === us ? "selected" : ""}>${esc(u.full_name)}</option>`).join("")}</select>
      <span class="spacer"></span><button class="btn ghost sm" id="csv">⬇ Excel (CSV)</button></div>
      <div class="small muted" style="margin-bottom:8px">Jami: ${d.items.length} ta yozuv</div>
      <div class="tw"><table><thead><tr><th>Xodim</th><th>Yuborilgan</th><th>Izoh</th><th>Lokatsiya</th><th>Holat</th><th>Administrator izohi</th></tr></thead><tbody>
      ${d.items.map(x => `<tr><td><b>${esc(x.full_name)}</b><div class="tiny muted">${esc(x.department)}</div></td><td>${fmtDT(x.sent_at)}</td><td>${esc(x.note)}</td><td>${locCell(x)}</td><td>${stBadge(x.status)}</td><td>${esc(x.admin_note)}</td></tr>`).join("")
        || `<tr><td colspan="6" class="empty">Ma’lumot yo‘q.</td></tr>`}</tbody></table></div></div>`;
    $("#rm").onchange = e => { recMonth = e.target.value || monthStr(); pRecords(); };
    $("#rs").onchange = e => { recStatus = e.target.value; pRecords(); };
    $("#ru").onchange = e => { recUser = e.target.value; pRecords(); };
    $("#csv").onclick = () => csvDownload(`davomat_${m}.csv`, [["Xodim", "Bo‘lim", "Lavozim", "Yuborilgan sana", "Izoh", "Kenglik", "Uzunlik", "Masofa (m)", "Aniqlik (m)", "Holat", "Ko‘rib chiqilgan", "Administrator izohi", "Xarita"],
      ...d.items.map(x => [x.full_name, x.department, x.position, fmtDT(x.sent_at), x.note, x.lat, x.lon, x.distance_m ?? "", x.accuracy, x.status, x.decided_at ? fmtDT(x.decided_at) : "", x.admin_note, mapUrl(x.lat, x.lon)])]);
  });
}
let repMonth = null;
function pReport() {
  repMonth = repMonth || monthStr();
  const m = repMonth;
  view("rep:" + m, () => api("dashboard", { month: m }), d => {
    const rows = d.monthly, none = rows.filter(x => !x.total).length;
    const sum = k => rows.reduce((a, x) => a + x[k], 0);
    page().innerHTML = `<div class="card"><div class="toolbar"><input type="month" id="pm" value="${m}"><span class="spacer"></span><button class="btn ghost sm" id="csv">⬇ Excel (CSV)</button></div>
      <div class="kpis"><div class="kpi br"><b>${rows.length}</b><span>Faol xodim</span></div><div class="kpi bad"><b>${none}</b><span>Oy davomida yubormagan</span></div>
      <div class="kpi ok"><b>${sum("approved")}</b><span>Tasdiqlangan</span></div><div class="kpi"><b>${sum("rejected")}</b><span>Rad etilgan</span></div><div class="kpi warn"><b>${sum("pending")}</b><span>Kutilmoqda</span></div></div>
      <div class="tw"><table><thead><tr><th>Xodim</th><th>Bo‘lim</th><th>Kelgan kunlar</th><th>Jami</th><th>Tasdiqlandi</th><th>Rad etildi</th><th>Kutilmoqda</th></tr></thead><tbody>
      ${rows.map(x => `<tr class="click" data-u="${x.id}"><td><b>${esc(x.full_name)}</b></td><td>${esc(x.department)}</td><td><b>${x.days}</b></td><td>${x.total}</td><td>${x.approved}</td><td>${x.rejected}</td><td>${x.pending}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">Ma’lumot yo‘q.</td></tr>`}
      </tbody></table></div><p class="tiny muted">Xodim qatorini bossangiz, uning shu oydagi barcha yozuvlari ochiladi.</p></div>`;
    $("#pm").onchange = e => { repMonth = e.target.value || monthStr(); pReport(); };
    $$("[data-u]").forEach(tr => (tr.onclick = () => { recMonth = m; recUser = tr.dataset.u; recStatus = ""; go("records"); }));
    $("#csv").onclick = () => csvDownload(`oylik_hisobot_${m}.csv`, [["Xodim", "Bo‘lim", "Kelgan kunlar", "Jami", "Tasdiqlandi", "Rad etildi", "Kutilmoqda"], ...rows.map(x => [x.full_name, x.department, x.days, x.total, x.approved, x.rejected, x.pending])]);
  });
}
let userQ = "";
function pUsers() {
  view("users", () => api("users_list"), d => {
    page().innerHTML = `<div class="card"><div class="toolbar">
      <input id="uq" placeholder="🔍 Qidirish (ism, login, bo‘lim)" value="${esc(userQ)}" style="min-width:220px">
      <span class="spacer"></span><span class="small muted">Faol xodimlar: <b>${d.active_employees}</b> / ${d.max_users}</span>
      <button class="btn ghost sm" id="imp">⬆ Excel’dan yuklash</button><button class="btn sm" id="add">+ Xodim qo‘shish</button></div>
      <div class="tw"><table><thead><tr><th>F.I.Sh.</th><th>Login</th><th>Bo‘lim / lavozim</th><th>Telefon</th><th>Holat</th><th></th></tr></thead><tbody id="ub"></tbody></table></div></div>`;
    const body = $("#ub");
    const draw = () => {
      const q = userQ.toLowerCase();
      const list = d.items.filter(u => !q || [u.full_name, u.username, u.department, u.position].join(" ").toLowerCase().includes(q));
      body.innerHTML = list.map(u => `<tr><td><b>${esc(u.full_name)}</b>${u.role === "admin" ? ' <span class="badge b-info">Administrator</span>' : ""}</td><td>${esc(u.username)}</td>
        <td class="small">${esc([u.department, u.position].filter(Boolean).join(" · "))}</td>
        <td class="small">${u.role === "admin" ? '<span class="muted">bog‘lanmaydi</span>' : u.device_bound ? `<span class="badge b-ok">Biriktirilgan</span><div class="tiny muted">${esc(u.device_info)}</div>` : '<span class="badge b-mut">Hali kirmagan</span>'}</td>
        <td>${u.active ? '<span class="badge b-ok">Faol</span>' : '<span class="badge b-mut">Faol emas</span>'}</td>
        <td><div class="row" style="flex-wrap:nowrap"><button class="btn plain sm" data-e="${u.id}">Tahrirlash</button>
        ${u.role === "employee" && u.device_bound ? `<button class="btn ghost sm" data-r="${u.id}">Telefonni almashtirish</button>` : ""}
        ${u.is_me ? "" : `<button class="btn sm ${u.active ? "bad" : "ok"}" data-t="${u.id}" data-a="${u.active ? 0 : 1}">${u.active ? "O‘chirish" : "Faollashtirish"}</button>`}</div></td></tr>`).join("")
        || `<tr><td colspan="6" class="empty">Xodim topilmadi.</td></tr>`;
      $$("[data-e]", body).forEach(b => (b.onclick = () => userModal(d.items.find(u => u.id === b.dataset.e))));
      $$("[data-r]", body).forEach(b => (b.onclick = () => confirm("Xodimning telefon bog‘lanishini tozalaysizmi? Keyingi safar qaysi telefondan kirsa, o‘sha biriktiriladi.") &&
        withBtn(b, async () => { await api("user_reset_device", { id: b.dataset.r }); cacheDrop("users"); toast("Telefon bog‘lanishi tozalandi"); pUsers(); })));
      $$("[data-t]", body).forEach(b => (b.onclick = () => confirm(b.dataset.a === "1" ? "Xodimni faollashtirasizmi?" : "Xodimni faolsizlantirasizmi? U tizimga kira olmaydi.") &&
        withBtn(b, async () => { await api("user_toggle", { id: b.dataset.t, active: b.dataset.a === "1" }); cacheDrop("users"); cacheDrop("dash:"); pUsers(); })));
    };
    draw();
    $("#uq").oninput = e => { userQ = e.target.value; draw(); };
    $("#add").onclick = () => userModal(null);
    $("#imp").onclick = importModal;
  }, 30000);
}
function userModal(u) {
  const m = modal(`<h2>${u ? "Xodimni tahrirlash" : "Yangi xodim"}</h2><form id="uf"><div class="grid g2">
    <div class="field"><label>F.I.Sh.</label><input name="full_name" value="${esc(u?.full_name)}" required></div>
    <div class="field"><label>Login</label><input name="username" value="${esc(u?.username)}" autocapitalize="off" required placeholder="masalan: a.valiyev"></div>
    <div class="field"><label>Bo‘lim</label><input name="department" value="${esc(u?.department)}"></div>
    <div class="field"><label>Lavozim</label><input name="position" value="${esc(u?.position)}"></div>
    <div class="field"><label>${u ? "Yangi parol (o‘zgartirmasangiz bo‘sh qoldiring)" : "Boshlang‘ich parol"}</label><input name="password" type="text" autocomplete="off" ${u ? "" : "required minlength=6"}></div>
    <div class="field"><label>Rol</label><select name="role" ${u?.is_me ? "disabled" : ""}><option value="employee">Xodim (davomat yuboradi)</option><option value="admin" ${u?.role === "admin" ? "selected" : ""}>Administrator</option></select></div>
    </div><div class="row" style="justify-content:flex-end"><button type="button" class="btn plain" id="cx">Bekor qilish</button><button class="btn">Saqlash</button></div></form>`);
  $("#cx", m).onclick = m.close;
  $("#uf", m).onsubmit = e => {
    e.preventDefault(); const v = vals(e.target); if (u?.is_me) v.role = "admin";
    withBtn($("button:last-child", e.target), async () => {
      await api("user_save", { id: u?.id || "", ...v }); cacheDrop("users"); cacheDrop("dash:");
      m.close(); toast(u ? "Saqlandi" : "Xodim qo‘shildi. Login va parolni xodimga bering."); pUsers();
    });
  };
}
function importModal() {
  const m = modal(`<h2>Excel’dan xodimlarni yuklash</h2>
    <p class="small">Excel’da 5 ta ustunli jadval tuzing va <b>“CSV (разделители — точка с запятой)”</b> yoki “CSV UTF-8” formatida saqlang:</p>
    <div class="copy">F.I.Sh.;Login;Parol;Bo‘lim;Lavozim<br>Aliyev Vali;a.aliyev;parol123;Nazorat bo‘limi;Bosh mutaxassis</div>
    <div class="row" style="margin:10px 0"><button class="btn ghost sm" id="tpl">⬇ Namuna faylni yuklab olish</button></div>
    <div class="field"><input type="file" id="cf" accept=".csv,text/csv"></div><div id="pv"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="go" disabled>Yuklash</button></div>`);
  let rows = [];
  $("#tpl", m).onclick = () => csvDownload("xodimlar_namuna.csv", [["F.I.Sh.", "Login", "Parol", "Bo‘lim", "Lavozim"], ["Aliyev Vali", "a.aliyev", "parol123", "Nazorat bo‘limi", "Bosh mutaxassis"]]);
  $("#cf", m).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const data = csvParse(await f.text());
    if (data.length && /f\.?i\.?sh|ism|name|фио/i.test(data[0][0] || "")) data.shift();
    rows = data.map(r => ({ full_name: (r[0] || "").trim(), username: (r[1] || "").trim().toLowerCase(), password: (r[2] || "").trim(), department: (r[3] || "").trim(), position: (r[4] || "").trim() })).filter(r => r.full_name || r.username);
    $("#pv", m).innerHTML = `<div class="alert info">${rows.length} ta xodim topildi.</div>` + (rows.length ? `<div class="tw" style="max-height:220px"><table><tr><th>F.I.Sh.</th><th>Login</th><th>Bo‘lim</th></tr>${rows.slice(0, 50).map(r => `<tr><td>${esc(r.full_name)}</td><td>${esc(r.username)}</td><td>${esc(r.department)}</td></tr>`).join("")}</table></div>` : "");
    $("#go", m).disabled = !rows.length;
  };
  $("#go", m).onclick = e => withBtn(e.currentTarget, async () => {
    const r = await api("users_import", { rows }); cacheDrop("users"); cacheDrop("dash:");
    $("#pv", m).innerHTML = `<div class="alert ok">${r.created} ta xodim qo‘shildi.</div>` + (r.skipped.length ? `<div class="alert warn">O‘tkazib yuborildi (${r.skipped.length}): ${r.skipped.map(s => esc(s.username || "?") + " — " + esc(s.reason)).join("; ")}</div>` : "");
    $("#go", m).disabled = true; pUsers();
  });
}
function pSettings() {
  const o = S.org;
  const link = (C.APP_URL || location.origin + location.pathname).replace(/index\.html$/, "") + "?org=" + o.code;
  page().innerHTML = `<form id="sf"><div class="card"><h3>🏢 Tashkilot ma’lumotlari</h3>
    <div class="row" style="gap:16px;align-items:center;margin-bottom:12px"><img class="logo-prev" id="lp" src="${esc(logoOf(o))}" alt="">
      <div><label class="btn ghost sm" style="margin:0">Logo yuklash<input type="file" id="lf" accept="image/*" hidden></label>
      ${o.logo ? `<button type="button" class="btn plain sm" id="lx">Olib tashlash</button>` : ""}<div class="tiny muted" style="margin-top:6px">Kvadrat shakldagi PNG/JPG rasm (avtomatik kichraytiriladi)</div></div></div>
    <div class="grid g2"><div class="field"><label>To‘liq nomi (kirish oynasida ko‘rinadi)</label><input name="name" value="${esc(o.name)}" required></div>
    <div class="field"><label>Qisqa nomi (menyuda)</label><input name="short_name" value="${esc(o.short_name)}" placeholder="masalan: Samarqand inspeksiyasi"></div>
    <div class="field"><label>Asosiy rang</label><input name="color" type="color" value="${esc(o.color || "#2563eb")}" style="height:44px;padding:4px"></div>
    <div class="field"><label>Kuniga yuborish limiti (0 = cheklanmagan)</label><input name="daily_limit" type="number" min="0" max="50" value="${o.daily_limit || 0}"></div></div></div>
    <div class="card"><h3>📍 Ish joyi hududi (ixtiyoriy)</h3><p class="small muted">Belgilansa, ish joyidan uzoqda yuborilgan davomatlar “Hududdan tashqarida” belgisi bilan ko‘rinadi.</p>
    <div class="grid g3"><div class="field"><label>Kenglik (latitude)</label><input name="office_lat" value="${o.office_lat ?? ""}" inputmode="decimal" placeholder="39.654200"></div>
    <div class="field"><label>Uzunlik (longitude)</label><input name="office_lon" value="${o.office_lon ?? ""}" inputmode="decimal" placeholder="66.959700"></div>
    <div class="field"><label>Radius (metr)</label><input name="office_radius_m" type="number" min="50" value="${o.office_radius_m ?? ""}" placeholder="300"></div></div>
    <div class="row"><button type="button" class="btn ghost sm" id="here">📡 Hozirgi joylashuvimni olish</button>
    ${o.office_lat != null ? `<a class="btn plain sm" target="_blank" rel="noopener" href="${mapUrl(o.office_lat, o.office_lon)}">Xaritada ko‘rish</a>` : ""}<button type="button" class="btn plain sm" id="clr">Hududni o‘chirish</button></div></div>
    <div class="card row" style="justify-content:flex-end"><button class="btn">💾 Saqlash</button></div></form>
    <div class="card"><h3>🔗 Xodimlar uchun kirish havolasi</h3><p class="small muted">Shu havolani xodimlarga yuboring — kirish oynasida tashkilotingiz logosi va nomi chiqadi, tashkilot kodini yozish shart bo‘lmaydi.</p>
    <div class="copy" id="lnk">${esc(link)}</div><div class="row" style="margin-top:8px"><button class="btn ghost sm" id="cp">📋 Nusxalash</button><span class="small muted">Tashkilot kodi: <b>${esc(o.code)}</b></span></div></div>
    ${passwordCard()}`;
  let logo = o.logo;
  $("#lf").onchange = async e => { const f = e.target.files[0]; if (!f) return; try { logo = await fileToLogo(f); $("#lp").src = logo; } catch (x) { toast(x.message, false); } };
  $("#lx") && ($("#lx").onclick = () => { logo = ""; $("#lp").src = "assets/icon-192.png"; });
  $("#here").onclick = e => withBtn(e.currentTarget, async () => {
    const p = await getPosition(); $("[name=office_lat]").value = p.coords.latitude.toFixed(6); $("[name=office_lon]").value = p.coords.longitude.toFixed(6);
    if (!$("[name=office_radius_m]").value) $("[name=office_radius_m]").value = 300; toast(`Joylashuv olindi (±${Math.round(p.coords.accuracy)} m). Saqlashni unutmang.`);
  });
  $("#clr").onclick = () => ["office_lat", "office_lon", "office_radius_m"].forEach(n => ($(`[name=${n}]`).value = ""));
  $("#cp").onclick = () => navigator.clipboard?.writeText(link).then(() => toast("Nusxalandi"));
  $("#sf").onsubmit = e => {
    e.preventDefault(); const v = vals(e.target);
    withBtn($("#sf button.btn:not([type])"), async () => {
      const r = await api("org_settings_save", { ...v, logo }); S.org = r.org; saveSession();
      LS.set("dv_org_brand", { code: o.code, name: r.org.name, logo: r.org.logo, color: r.org.color });
      toast("Sozlamalar saqlandi"); startApp(); location.hash = "#/settings";
    });
  };
  bindPassword();
}
function pBilling() {
  view("billing", () => api("billing"), d => {
    const o = d.org; S.org = { ...S.org, ...o }; saveSession();
    page().innerHTML = `${o.expired ? `<div class="alert bad"><b>Obuna muddati tugagan (${fmtD(o.paid_until)}).</b> Xodimlar davomat yubora olmaydi. Quyidagi rekvizitlar bo‘yicha to‘lovni amalga oshiring — to‘lov tasdiqlangach tizim avtomatik qayta ishga tushadi.</div>` : ""}
    <div class="kpis"><div class="kpi br"><b>${esc(o.plan_name || "—")}</b><span>Tarif</span></div>
      <div class="kpi ${o.expired ? "bad" : o.days_left <= 5 ? "warn" : "ok"}"><b>${fmtD(o.paid_until)}</b><span>${daysTxt(o.days_left)}</span></div>
      <div class="kpi"><b>${d.active_employees} / ${o.max_users}</b><span>Faol xodimlar / limit</span></div>
      <div class="kpi"><b>${money(d.price_month)}</b><span>Oylik to‘lov</span></div></div>
    <div class="card"><h3>💳 To‘lov qanday amalga oshiriladi</h3><div style="white-space:pre-wrap">${esc(d.payment_info || "")}</div>
      ${o.support_phone ? `<p>Aloqa: <a href="tel:${esc(o.support_phone)}">${esc(o.support_phone)}</a></p>` : ""}
      <p class="small muted">To‘lov izohida tashkilot kodini yozing: <b>${esc(o.code)}</b></p>
      ${o.expired ? `<button class="btn ghost" id="rc">🔄 To‘lovni tekshirish</button>` : ""}</div>
    ${(d.plans || []).length ? `<div class="card"><h3>Tariflar</h3><div class="tw"><table><thead><tr><th>Tarif</th><th>Xodimlar soni</th><th>Oylik narx</th></tr></thead><tbody>
      ${d.plans.map(p => `<tr><td><b>${esc(p.name)}</b>${p.name === o.plan_name ? ' <span class="badge b-ok">joriy</span>' : ""}</td><td>${p.max_users} tagacha</td><td>${money(p.price)}</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">Tarifni o‘zgartirish uchun xizmat ko‘rsatuvchiga murojaat qiling.</p></div>` : ""}
    <div class="card"><h3>To‘lovlar tarixi</h3><div class="tw"><table><thead><tr><th>Sana</th><th>Summa</th><th>Davr</th></tr></thead><tbody>
      ${d.payments.map(p => `<tr><td>${fmtDT(p.created_at)}</td><td>${money(p.amount)}</td><td>${fmtD(p.period_from)} — ${fmtD(p.period_to)} (${p.months} oy)</td></tr>`).join("") || `<tr><td colspan="3" class="empty">Hali to‘lov yo‘q.</td></tr>`}
      </tbody></table></div></div>`;
    $("#rc") && ($("#rc").onclick = e => withBtn(e.currentTarget, async () => { cacheDrop("billing"); await refreshMe(); if (!S.org.expired) { toast("Obuna faollashdi!"); go("dashboard"); } else toast("To‘lov hali tasdiqlanmagan.", false); }));
  }, 5000);
}

/* ================================================================ SUPER-ADMIN SAHIFALARI */
let orgQ = "", orgF = "all";
function pOrgs() {
  view("sa", () => api("sa_overview"), d => {
    const t = d.totals;
    page().innerHTML = `<div class="kpis">
      <div class="kpi br"><b>${t.orgs}</b><span>Tashkilotlar</span></div><div class="kpi ok"><b>${t.active}</b><span>Faol obuna</span></div>
      <div class="kpi warn"><b>${t.expiring}</b><span>7 kunda tugaydi</span></div><div class="kpi bad"><b>${t.expired}</b><span>Muddati o‘tgan</span></div>
      <div class="kpi"><b>${t.employees}</b><span>Jami xodimlar</span></div><div class="kpi ok"><b style="font-size:20px">${money(t.mrr)}</b><span>Oylik daromad (MRR)</span></div>
      <div class="kpi"><b style="font-size:20px">${money(t.revenue_month)}</b><span>Shu oy tushum</span></div></div>
    <div class="card"><div class="toolbar"><input id="oq" placeholder="🔍 Qidirish" value="${esc(orgQ)}">
      <div class="seg" id="of"><button data-f="all">Hammasi</button><button data-f="exp">Tugayotgan/tugagan</button><button data-f="off">O‘chirilgan</button></div>
      <span class="spacer"></span><button class="btn" id="no">+ Yangi tashkilot</button></div>
      <div class="tw"><table><thead><tr><th>Tashkilot</th><th>Tarif</th><th>Xodimlar</th><th>Obuna</th><th>Bugun</th><th>Holat</th></tr></thead><tbody id="ob"></tbody></table></div></div>`;
    const draw = () => {
      const q = orgQ.toLowerCase();
      const list = d.orgs.filter(o => (!q || (o.name + " " + o.code + " " + o.contact_name + " " + o.contact_phone).toLowerCase().includes(q))
        && (orgF === "all" || (orgF === "exp" && o.active && o.days_left <= 7) || (orgF === "off" && !o.active)));
      $("#ob").innerHTML = list.map(o => `<tr class="click" data-o="${o.id}"><td><b>${esc(o.name)}</b><div class="tiny muted">kod: ${esc(o.code)}${o.contact_phone ? " · " + esc(o.contact_phone) : ""}</div></td>
        <td>${esc(o.plan_name || "—")}<div class="tiny muted">${money(o.price_month)}/oy</div></td><td>${o.employees} / ${o.max_users}</td>
        <td><span class="${daysCls(o.days_left)}">${fmtD(o.paid_until)}</span><div class="tiny muted">${daysTxt(o.days_left)}</div></td>
        <td>${o.today}</td><td>${o.active ? '<span class="badge b-ok">Faol</span>' : '<span class="badge b-mut">O‘chirilgan</span>'}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">Tashkilot yo‘q. “+ Yangi tashkilot” tugmasini bosing.</td></tr>`;
      $$("[data-o]").forEach(tr => (tr.onclick = () => orgModal(d.orgs.find(o => o.id === tr.dataset.o))));
    };
    draw();
    $("#oq").oninput = e => { orgQ = e.target.value; draw(); };
    $$("#of button").forEach(b => { b.classList.toggle("on", b.dataset.f === orgF); b.onclick = () => { orgF = b.dataset.f; $$("#of button").forEach(x => x.classList.toggle("on", x === b)); draw(); }; });
    $("#no").onclick = () => orgModal(null);
  }, 15000);
}
async function plansList() { const c = cacheGet("sas"); if (c) return c.v.plans || []; try { const r = await api("sa_settings"); cacheSet("sas", r); return r.plans || []; } catch (e) { return []; } }
async function orgModal(o) {
  const plans = await plansList();
  const appUrl = (C.APP_URL || location.origin + location.pathname).replace(/index\.html$/, "");
  const m = modal(`<h2>${o ? esc(o.name) : "Yangi tashkilot"}</h2>
    <form id="orgf"><div class="grid g2">
      <div class="field"><label>Tashkilot nomi</label><input name="name" value="${esc(o?.name)}" required></div>
      <div class="field"><label>Tashkilot kodi (kirishda yoziladi)</label><input name="code" value="${esc(o?.code)}" required pattern="[a-z0-9][a-z0-9\\-]{1,30}" placeholder="samqurilish" autocapitalize="off"></div>
      <div class="field"><label>Tarif</label><select name="plan_name"><option value="">— tanlang —</option>${plans.map(p => `<option value="${esc(p.name)}" data-u="${p.max_users}" data-p="${p.price}" ${p.name === o?.plan_name ? "selected" : ""}>${esc(p.name)} (${p.max_users} xodim, ${money(p.price)})</option>`).join("")}</select></div>
      <div class="field"><label>Xodimlar limiti</label><input name="max_users" type="number" min="1" value="${o?.max_users ?? 30}"></div>
      <div class="field"><label>Oylik narx (so‘m)</label><input name="price_month" type="number" min="0" value="${o?.price_month ?? 0}"></div>
      <div class="field"><label>Obuna tugash sanasi${o ? "" : " (bo‘sh = sinov muddati)"}</label><input name="paid_until" type="date" value="${esc(o?.paid_until || "")}"></div>
      <div class="field"><label>Mas’ul shaxs</label><input name="contact_name" value="${esc(o?.contact_name)}"></div>
      <div class="field"><label>Telefon</label><input name="contact_phone" value="${esc(o?.contact_phone)}" inputmode="tel"></div>
    </div><div class="field"><label>Izoh (faqat sizga ko‘rinadi)</label><textarea name="notes" rows="2">${esc(o?.notes)}</textarea></div>
    ${o ? "" : `<hr><h3>Tashkilot administratori</h3><div class="grid g3">
      <div class="field"><label>F.I.Sh.</label><input name="admin_full_name" placeholder="Administrator"></div>
      <div class="field"><label>Login</label><input name="admin_username" value="admin" required autocapitalize="off"></div>
      <div class="field"><label>Parol</label><input name="admin_password" required minlength="6" value="${Math.random().toString(36).slice(2, 10)}"></div></div>`}
    <div class="row" style="justify-content:flex-end"><button class="btn">💾 Saqlash</button></div></form>
    ${o ? `<hr><h3>💰 To‘lov qo‘shish (obunani uzaytirish)</h3><form id="pf" class="grid g4">
      <div><label>Oylar</label><input name="months" type="number" min="1" max="36" value="1"></div>
      <div><label>Summa (so‘m)</label><input name="amount" type="number" min="0" value="${o.price_month}"></div>
      <div><label>Usul</label><select name="method"><option>Bank o‘tkazmasi</option><option>Naqd</option><option>Payme</option><option>Click</option><option>Uzum</option><option>Boshqa</option></select></div>
      <div><label>&nbsp;</label><button class="btn ok wide">+ Qo‘shish</button></div>
      <input name="note" placeholder="Izoh (masalan: hisob-faktura №)" style="grid-column:1/-1"></form>
      <div id="opl" class="small" style="margin-top:10px"></div>
      <hr><h3>👤 Administratorlar</h3><div id="adl">${o.admins.map(a => `<div class="item row" style="margin-bottom:8px"><b>${esc(a.username)}</b><span class="muted small">${esc(a.full_name)}</span><span class="spacer"></span>
        <input placeholder="Yangi parol" data-pw="${a.id}" style="width:150px;padding:6px 9px"><button class="btn sm ghost" data-sp="${a.id}" data-un="${esc(a.username)}">Parolni tiklash</button></div>`).join("")}
        <div class="row"><input id="nau" placeholder="Yangi admin logini" style="width:170px;padding:7px 9px"><input id="nap" placeholder="Parol" style="width:140px;padding:7px 9px"><button class="btn sm plain" id="naa">+ Admin qo‘shish</button></div></div>
      <hr><h3>🔗 Kirish havolasi</h3><div class="copy">${esc(appUrl + "?org=" + o.code)}</div>
      <hr><div class="row"><button class="btn ${o.active ? "bad" : "ok"}" id="tg">${o.active ? "⛔ Tashkilotni o‘chirish" : "✅ Faollashtirish"}</button>
      <span class="small muted">O‘chirilsa, tashkilotning hech bir foydalanuvchisi tizimga kira olmaydi (ma’lumotlar saqlanib qoladi).</span></div>` : ""}`);
  const f = $("#orgf", m);
  $("[name=plan_name]", f).onchange = e => { const op = e.target.selectedOptions[0]; if (op?.dataset.u) { $("[name=max_users]", f).value = op.dataset.u; $("[name=price_month]", f).value = op.dataset.p; } };
  const done = msg => { cacheDrop("sa"); cacheDrop("sap"); toast(msg); m.close(); pOrgs(); };
  f.onsubmit = e => {
    e.preventDefault(); const v = vals(f);
    withBtn($("button.btn", f), async () => {
      await api("sa_org_save", { id: o?.id || "", ...v });
      if (!o) {
        cacheDrop("sa"); m.close(); pOrgs();
        modal(`<h2>✅ Tashkilot yaratildi</h2><p>Quyidagi ma’lumotlarni tashkilot administratoriga yuboring:</p>
          <div class="copy" id="cred">Kirish havolasi: ${esc(appUrl + "?org=" + v.code)}\nTashkilot kodi: ${esc(v.code)}\nLogin: ${esc(v.admin_username)}\nParol: ${esc(v.admin_password)}</div>
          <div class="row" style="margin-top:10px"><button class="btn" id="cc">📋 Nusxalash</button></div>`);
        $("#cred").style.whiteSpace = "pre-wrap";
        $("#cc").onclick = () => navigator.clipboard?.writeText($("#cred").textContent).then(() => toast("Nusxalandi"));
      } else done("Saqlandi");
    });
  };
  if (!o) return;
  const pf = $("#pf", m);
  $("[name=months]", pf).oninput = e => ($("[name=amount]", pf).value = (o.price_month || 0) * (+e.target.value || 1));
  pf.onsubmit = e => {
    e.preventDefault(); const v = vals(pf);
    withBtn($("button", pf), async () => { const r = await api("sa_payment_add", { org_id: o.id, ...v }); done(`To‘lov qo‘shildi. Obuna ${fmtD(r.paid_until)} gacha uzaytirildi.`); });
  };
  api("sa_payments", { org_id: o.id }).then(r => {
    const el = $("#opl", m); if (!el) return;
    el.innerHTML = r.items.length ? `<div class="tw"><table><tr><th>Sana</th><th>Summa</th><th>Davr</th><th>Usul</th><th></th></tr>${r.items.map(p => `<tr><td>${fmtD(p.created_at)}</td><td>${money(p.amount)}</td><td>${fmtD(p.period_from)}—${fmtD(p.period_to)}</td><td>${esc(p.method)}</td><td><button class="btn sm plain" data-dp="${p.id}" title="O‘chirish">🗑</button></td></tr>`).join("")}</table></div>` : `<span class="muted">Hali to‘lov yo‘q.</span>`;
    $$("[data-dp]", el).forEach(b => (b.onclick = () => confirm("To‘lov yozuvini o‘chirasizmi? (Agar bu oxirgi to‘lov bo‘lsa, obuna sanasi orqaga qaytariladi)") && withBtn(b, async () => { await api("sa_payment_delete", { id: b.dataset.dp }); done("To‘lov o‘chirildi"); })));
  }).catch(() => {});
  $$("[data-sp]", m).forEach(b => (b.onclick = () => { const pw = $(`[data-pw="${b.dataset.sp}"]`, m).value.trim(); if (pw.length < 6) return toast("Parol kamida 6 belgi.", false);
    withBtn(b, async () => { await api("sa_admin_save", { org_id: o.id, user_id: b.dataset.sp, username: b.dataset.un, password: pw }); toast("Parol yangilandi: " + pw); }); }));
  $("#naa", m).onclick = e => withBtn(e.currentTarget, async () => { await api("sa_admin_save", { org_id: o.id, username: $("#nau", m).value, password: $("#nap", m).value }); done("Admin qo‘shildi"); });
  $("#tg", m).onclick = e => confirm(o.active ? "Tashkilotni o‘chirasizmi?" : "Tashkilotni faollashtirasizmi?") && withBtn(e.currentTarget, async () => { await api("sa_org_toggle", { id: o.id, active: !o.active }); done(o.active ? "Tashkilot o‘chirildi" : "Faollashtirildi"); });
}
function pPayments() {
  view("sap", () => api("sa_payments"), d => {
    const total = d.items.reduce((a, p) => a + Number(p.amount), 0);
    page().innerHTML = `<div class="card"><div class="toolbar"><b>Jami: ${money(total)}</b><span class="spacer"></span><button class="btn ghost sm" id="csv">⬇ Excel (CSV)</button></div>
    <div class="tw"><table><thead><tr><th>Sana</th><th>Tashkilot</th><th>Summa</th><th>Davr</th><th>Usul</th><th>Izoh</th></tr></thead><tbody>
    ${d.items.map(p => `<tr><td>${fmtDT(p.created_at)}</td><td>${esc(p.org_name)}</td><td><b>${money(p.amount)}</b></td><td>${fmtD(p.period_from)} — ${fmtD(p.period_to)}</td><td>${esc(p.method)}</td><td>${esc(p.note)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">To‘lovlar yo‘q.</td></tr>`}
    </tbody></table></div></div>`;
    $("#csv").onclick = () => csvDownload("tolovlar.csv", [["Sana", "Tashkilot", "Summa", "Oylar", "Davr boshi", "Davr oxiri", "Usul", "Izoh"], ...d.items.map(p => [fmtDT(p.created_at), p.org_name, p.amount, p.months, fmtD(p.period_from), fmtD(p.period_to), p.method, p.note])]);
  });
}
function pSaSettings() {
  view("sas", () => api("sa_settings"), d => {
    page().innerHTML = `<form id="ss"><div class="card"><h3>💳 To‘lov rekvizitlari</h3><p class="small muted">Obunasi tugayotgan tashkilot administratorlariga “Obuna” sahifasida ko‘rsatiladi.</p>
      <div class="field"><textarea name="payment_info" rows="6">${esc(d.payment_info)}</textarea></div>
      <div class="grid g2"><div class="field"><label>Aloqa telefoni</label><input name="support_phone" value="${esc(d.support_phone)}" placeholder="+998 90 123 45 67"></div>
      <div class="field"><label>Yangi tashkilot uchun sinov muddati (kun)</label><input name="trial_days" type="number" min="0" value="${d.trial_days}"></div></div></div>
      <div class="card"><h3>📦 Tariflar</h3><div id="pl">${(d.plans || []).map(planRow).join("")}</div>
      <button type="button" class="btn plain sm" id="ap">+ Tarif qo‘shish</button></div>
      <div class="card row" style="justify-content:flex-end"><button class="btn">💾 Saqlash</button></div></form>${passwordCard()}`;
    const bindRm = () => $$(".rm").forEach(b => (b.onclick = () => b.closest(".plan-row").remove()));
    bindRm();
    $("#ap").onclick = () => { $("#pl").insertAdjacentHTML("beforeend", planRow({ name: "", max_users: 50, price: 0 })); bindRm(); };
    $("#ss").onsubmit = e => {
      e.preventDefault();
      const plans = $$(".plan-row").map(r => ({ name: $(".pn", r).value.trim(), max_users: +$(".pu", r).value || 0, price: +$(".pp", r).value || 0 })).filter(p => p.name);
      withBtn($("#ss > .card:last-child button"), async () => {
        await api("sa_settings_save", { payment_info: $("[name=payment_info]").value, support_phone: $("[name=support_phone]").value, trial_days: $("[name=trial_days]").value, plans });
        cacheDrop("sas"); toast("Saqlandi");
      });
    };
    bindPassword();
  }, 60000);
}
function planRow(p) {
  return `<div class="plan-row"><input class="pn" placeholder="Tarif nomi" value="${esc(p.name)}"><input class="pu" type="number" min="1" placeholder="Xodimlar" value="${p.max_users}" title="Xodimlar soni">
  <input class="pp" type="number" min="0" placeholder="Narx" value="${p.price}" title="Oylik narx (so‘m)"><button type="button" class="btn plain sm rm">✕</button></div>`;
}

/* ================================================================ O'RNATISH (PWA) */
let deferredPrompt = null;
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone;
function installBtnHTML(cls = "btn ghost sm") {
  if (isStandalone() || (!deferredPrompt && !isIOS)) return "";
  return `<button type="button" class="${cls} js-install"><span class="ic">📲</span>Ilovani o‘rnatish</button>`;
}
function bindInstall() {
  $$(".js-install").forEach(b => (b.onclick = async () => {
    if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $$(".js-install").forEach(x => x.remove()); }
    else if (isIOS) modal(`<h2>iPhone’ga o‘rnatish</h2><ol><li>Safari pastidagi <b>“Ulashish”</b> (⬆️) tugmasini bosing</li><li><b>“На экран «Домой» / Add to Home Screen”</b> ni tanlang</li><li><b>“Qo‘shish”</b> ni bosing</li></ol><p class="small muted">Keyin dasturni faqat bosh ekrandagi belgidan oching.</p>`);
  }));
}
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; if (!S) renderLogin(); });

/* ================================================================ ISHGA TUSHIRISH */
(function boot() {
  const o = urlOrg();
  if (o && o !== LS.get("dv_org")) { LS.set("dv_org", o); LS.del("dv_org_brand"); }
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
  if (S?.token) startApp(); else renderLogin();
})();
