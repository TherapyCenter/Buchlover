/* Buchlover – Oberfläche (Nachbau "Buchliebhaber") */
"use strict";

// ------------------------------------------------------------ Hilfen
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (s) => {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  if (LANG === "de") return `${m[3]}.${m[2]}.${m[1]}`;
  try { return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(locale()); } catch (e) { return s; }
};
const nf = (n) => Number(n || 0).toLocaleString(locale());
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fmtSize = (n) => n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toLocaleString(locale(), { maximumFractionDigits: 1 })} MB`;

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "cls") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(k));
  return el;
}

async function api(method, url, body, raw) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    if (raw) { opt.body = body; }
    else { opt.body = JSON.stringify(body); opt.headers["Content-Type"] = "application/json"; }
  }
  const r = await fetch(url, opt);
  const ct = r.headers.get("Content-Type") || "";
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch (e) { /* */ }
    msg = tMsg(msg);
    toast(msg, true);
    throw new Error(msg);
  }
  return ct.includes("json") ? r.json() : r.blob();
}
/** Servermeldung übersetzen – auch „Text: Detail“. */
function tMsg(msg) {
  if (!msg) return msg;
  if (t(msg) !== msg) return t(msg);
  const i = msg.indexOf(": ");
  return i > 0 ? t(msg.slice(0, i)) + msg.slice(i) : msg;
}

let toastTimer;
function toast(msg, err) {
  const tt = $("#toast");
  tt.textContent = msg; tt.className = "show" + (err ? " err" : "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (tt.className = ""), err ? 5000 : 2200);
}

/** Dialog: buttons = [{label, value, primary}] -> Promise(value|null) */
function dialog(title, body, buttons, opts = {}) {
  buttons = buttons || [{ label: t("OK"), value: "ok", primary: true }, { label: t("Abbrechen"), value: null }];
  const d = $("#dlg");
  d.className = opts.cls || "";
  $("#dlgTitle").textContent = title;
  const b = $("#dlgBody"); b.innerHTML = "";
  if (typeof body === "string") b.innerHTML = body; else if (body) b.append(body);
  const bb = $("#dlgBtns"); bb.innerHTML = "";
  return new Promise((resolve) => {
    let result = null;
    for (const btn of buttons) {
      bb.append(h("button", { type: "button", cls: btn.primary ? "primary" : (btn.danger ? "danger" : ""),
        onclick: () => { result = btn.value; d.close(); } }, btn.label));
    }
    d.onclose = () => resolve(result);
    d.showModal();
    const first = b.querySelector("input,select,textarea");
    if (first) first.focus();
  });
}
async function confirmDlg(title, text) {
  return (await dialog(title, `<p>${esc(text)}</p>`, [{ label: t("Ja"), value: true, primary: true }, { label: t("Nein"), value: null }])) === true;
}
async function prompt2(title, lbl, value = "") {
  const inp = h("input", { type: "text", value, style: "width:100%" });
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#dlgBtns button").click(); } });
  const r = await dialog(title, h("div", {}, h("label", {}, lbl), inp));
  return r ? inp.value : null;
}
function download(blob, name) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ------------------------------------------------------------ Zustand
const S = {
  meta: null, books: [], sel: -1, sort: "id", dir: "desc", q: "", fields: null,
  props: 0, pmode: "any", group: "", gmode: "show", view: localGet("view", "table"), onlyEbooks: false,
  bookId: null, book: null, dirty: false, personsCache: null, personSel: null, groupSel: null,
};
function localGet(k, d) { try { return localStorage.getItem("bl." + k) ?? d; } catch (e) { return d; } }
function localSet(k, v) { try { localStorage.setItem("bl." + k, v); } catch (e) { /* */ } }
/** Frei benennbare Feldbezeichnung; unveränderte Standardbezeichnung wird übersetzt. */
const label = (k, def) => { const v = S.meta?.settings?.["label." + k]; return !v || v === def ? t(def) : v; };
const propName = (bit) => { const n = S.meta.properties.find((p) => p.bit === bit)?.name; return n ? t(n) : n; };
const isYes = (v) => !/^(nein|no|non|нет|否|0|false)$/i.test(String(v ?? "").trim());

// ------------------------------------------------------------ Start
async function loadMeta() {
  S.meta = await api("GET", "/api/meta");
  $("#btnQuit").classList.toggle("hidden", S.meta.can_quit === false);
  const gf = $("#groupFilter"); const gv = gf.value; gf.innerHTML = '<option value="">–</option>';
  for (const g of S.meta.groups) if (g.name) gf.append(h("option", { value: g.id }, `${g.id}: ${g.name} (${g.members})`));
  gf.value = gv;
}

function initTheme() {
  const th = localGet("theme", "");
  if (th) document.documentElement.dataset.theme = th;
  $("#btnTheme").onclick = () => {
    const dark = getComputedStyle(document.documentElement).colorScheme.includes("dark");
    const nt = dark ? "light" : "dark";
    document.documentElement.dataset.theme = nt; localSet("theme", nt);
  };
}

function initLang() {
  const sel = $("#langSel");
  sel.innerHTML = "";
  for (const [k, n] of Object.entries(LANGS)) sel.append(h("option", { value: k }, n));
  sel.value = LANG;
  sel.onchange = async () => {
    await autoSave();
    localSet("lang", sel.value);
    try { await api("PUT", "/api/settings", { ui_language: sel.value }); } catch (e) { /* */ }
    location.reload();
  };
  $("#btnHelp").href = "/handbuch?lang=" + LANG;
  applyI18n();
  $("#appVer").textContent = "v" + S.meta.version;
}

// ------------------------------------------------------------ Version / Update
/** Beim Start (abschaltbar) und auf Knopfdruck: neuere Version auf GitHub? */
async function checkUpdate(manual) {
  if (!manual && !isYes(S.meta.settings.update_check)) return null;
  let u;
  try {
    const r = await fetch("/api/update" + (manual ? "?force=1" : ""));
    u = await r.json();
    if (!r.ok) throw new Error(tMsg(u.error || r.statusText));
  } catch (e) { if (manual) toast(t("Update-Prüfung nicht möglich") + ": " + e.message, true); return null; }
  S.update = u;
  const b = $("#btnUpdate");
  b.classList.toggle("hidden", !u.newer);
  if (u.newer) { b.textContent = "⬆ " + t("Update {v}", { v: u.latest }); b.onclick = updateDialog; }
  if (manual && !u.newer) toast(t("Buchlover ist aktuell (Version {v}).", { v: u.current }));
  return u;
}
async function updateDialog() {
  const u = S.update; if (!u) return;
  const body = h("div", { style: "max-width:640px" },
    h("p", {}, t("Version {new} ist verfügbar – installiert ist {old}.", { new: u.latest, old: u.current })),
    u.notes ? h("div", { cls: "relnotes" }, u.notes.replace(/\r/g, "")) : "");
  let buttons;
  if (u.can_install) {
    body.append(h("p", { cls: "hint" }, t("Buchlover lädt den Installer, prüft ihn, beendet sich, installiert das Update und startet danach neu. Ihre Daten bleiben erhalten.")));
    buttons = [{ label: t("Jetzt aktualisieren"), value: "install", primary: true }, { label: t("Release-Seite"), value: "page" }, { label: t("Später"), value: null }];
  } else if (u.platform === "docker") {
    body.append(h("p", {}, t("Im Docker-Betrieb aktualisieren Sie den Container:")), h("div", { cls: "cmd" }, "docker compose pull && docker compose up -d"));
    buttons = [{ label: t("Release-Seite"), value: "page", primary: true }, { label: t("Schließen"), value: null }];
  } else {
    body.append(h("p", { cls: "hint" }, u.asset ? t("Laden Sie das Paket für Ihr System herunter und installieren Sie es wie gewohnt. Ihre Daten bleiben erhalten.") + " (" + u.asset.name + ")" : t("Laden Sie das Paket für Ihr System von der Release-Seite herunter.")));
    buttons = [...(u.asset ? [{ label: t("Herunterladen"), value: "download", primary: true }] : []), { label: t("Release-Seite"), value: "page", primary: !u.asset }, { label: t("Später"), value: null }];
  }
  const r = await dialog(t("Update verfügbar"), body, buttons);
  const open = (url) => S.meta.window_mode ? api("POST", "/api/open", { url }).then(() => toast(t("Im Browser geöffnet"))) : window.open(url, "_blank", "noopener");
  if (r === "page") open(u.url);
  else if (r === "download") open(u.asset.url);
  else if (r === "install") {
    await autoSave();
    toast(t("Update wird geladen …"));
    try { await api("POST", "/api/update/install"); } catch (e) { return; }
    document.body.innerHTML = `<div class="empty" style="margin:auto;text-align:center">${esc(t("Das Update wird installiert. Buchlover startet danach automatisch neu – dieses Fenster schließt sich gleich."))}</div>`;
  }
}

function showTab(name) {
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$("main > .tab").forEach((s) => s.classList.toggle("active", s.id === "tab-" + name));
  localSet("tab", name);
  history.replaceState(null, "", name === "book" && S.book ? `#book=${S.book.id}` : `#tab=${name}`);
  const loaders = { all: () => renderBooks(), book: () => renderBook(), persons: loadPersons, reading: loadReading,
    loans: loadLoansView, wish: loadWishView, quotes: loadQuotesView, groups: loadGroups, stats: loadStats, tools: loadTools };
  loaders[name]?.();
}

async function init() {
  initTheme();
  await loadMeta();
  setLang(localGet("lang", "") || S.meta.settings.ui_language || navigator.language);
  initLang();
  $$("#tabs button").forEach((b) => (b.onclick = async () => { await autoSave(); showTab(b.dataset.tab); }));
  $("#globalSearch").onsubmit = (e) => { e.preventDefault(); S.q = $("#q").value.trim(); S.fields = null; S.sort = S.q ? "fundstelle" : S.sort; S.dir = "asc"; showTab("all"); loadBooks(); };
  $("#btnAll").onclick = () => { S.q = ""; S.fields = null; $("#q").value = ""; S.props = 0; S.group = ""; $("#groupFilter").value = ""; S.onlyEbooks = false; $("#onlyEbooks").checked = false; updateFilterBtn(); S.sort = "id"; S.dir = "desc"; loadBooks(); showTab("all"); };
  $("#btnNew").onclick = newBook;
  $("#btnQuit").onclick = async () => {
    if (!(await confirmDlg(t("Beenden"), t("Buchlover beenden? Ungespeicherte Änderungen werden vorher gespeichert.")))) return;
    await autoSave();
    await api("POST", "/api/shutdown", {});
    document.body.innerHTML = `<div class="empty" style="margin:auto">${esc(t("Buchlover wurde beendet. Dieses Fenster kann geschlossen werden."))}</div>`;
  };
  $("#propFilter").onclick = filterDialog;
  $("#onlyEbooks").onchange = (e) => { S.onlyEbooks = e.target.checked; loadBooks(); };
  $("#groupFilter").onchange = (e) => { S.group = e.target.value; loadBooks(); };
  $("#groupMode").onchange = (e) => { S.gmode = e.target.value; loadBooks(); };
  $("#viewTable").onclick = () => setView("table");
  $("#viewTiles").onclick = () => setView("tiles");
  $("#btnExportView").onclick = exportDialog;
  initBookPage();
  initReader();
  setTimeout(() => checkUpdate(false), 2500);
  document.addEventListener("keydown", globalKeys);
  // Eigenes Programmfenster: externe Links (DNB, Wikipedia …) im normalen Browser öffnen
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || !S.meta?.window_mode) return;
    const url = new URL(a.href, location.href);
    if (/^https?:$/.test(url.protocol) && url.host !== location.host) {
      e.preventDefault();
      api("POST", "/api/open", { url: url.href }).then(() => toast(t("Im Browser geöffnet")));
    }
  });
  // Fenster wird geschlossen: ungespeicherte Änderungen noch sichern
  window.addEventListener("pagehide", () => {
    if (!S.dirty || !S.book || !$("#bookForm [name]")) return;
    const d = collectForm();
    navigator.sendBeacon(`/api/books/${S.book.id}/beacon`, new Blob([JSON.stringify(d)], { type: "application/json" }));
  });
  setView(S.view, true);
  await loadBooks();
  const hp = new URLSearchParams(location.hash.slice(1));
  if (hp.get("book")) { await openBook(+hp.get("book")); if (hp.get("sub")) subTab(hp.get("sub")); }
  else if (hp.get("read")) { await openBook(+hp.get("read")); openReader(+hp.get("read")); }
  else showTab(hp.get("tab") || (localGet("tab", "all") === "book" ? "all" : localGet("tab", "all")));
}

function globalKeys(e) {
  if (!$("#reader").classList.contains("hidden")) { readerKeys(e); return; }
  if (e.key === "F1") { e.preventDefault(); window.open("/handbuch?lang=" + LANG, "_blank"); return; }
  if (e.altKey && e.key.toLowerCase() === "s") { e.preventDefault(); $("#q").focus(); $("#q").select(); }
  else if (e.altKey && e.key.toLowerCase() === "n") { e.preventDefault(); newBook(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && S.book) { e.preventDefault(); saveBook(); }
  else if (e.altKey && e.key === "ArrowLeft" && S.book) { e.preventDefault(); stepBook(-1); }
  else if (e.altKey && e.key === "ArrowRight" && S.book) { e.preventDefault(); stepBook(1); }
  else if (e.altKey && e.key.toLowerCase() === "r" && S.book) { e.preventDefault(); showTab("book"); subTab("reviews"); addSub("reviews"); }
  else if (e.altKey && e.key.toLowerCase() === "l") {
    const id = $("#tab-book").classList.contains("active") ? S.book?.id : S.books[S.sel]?.id;
    if (id) { e.preventDefault(); openReader(id); }
  }
}

// ------------------------------------------------------------ Alle Bücher
const COLS = () => [
  { k: "props", l: "E", title: t("Eigenschaften – Klick zum Zuordnen") },
  { k: "ebook_path", l: "📖", title: t("eBook – Klick zum Lesen"), cls: "c-ebook" },
  { k: "id", l: t("Nr") }, { k: "author", l: t("Autor") }, { k: "title", l: t("Titel") },
  { k: "bx", l: "BX", title: t("Buchindex") }, { k: "class", l: t("Klassifikation") },
  { k: "location", l: label("location", "Standort") }, { k: "pub_date", l: t("Datum") },
  { k: "ax", l: "AX", title: t("Autorenindex") }, { k: "publisher", l: t("Verlag") },
  { k: "fundstelle", l: t("Fundstelle"), search: true }, { k: "isbn", l: "ISBN" }, { k: "barcode", l: t("Barcode") },
];

async function loadBooks() {
  const p = new URLSearchParams({ sort: S.sort, dir: S.dir });
  if (S.q) p.set("q", S.q);
  if (S.fields) p.set("fields", S.fields.join("|"));
  if (S.props) { p.set("props", S.props); p.set("pmode", S.pmode); }
  if (S.group !== "") { p.set("group", S.group); p.set("gmode", S.gmode); }
  const r = await api("GET", "/api/books?" + p);
  S.books = S.onlyEbooks ? r.books.filter((b) => b.ebook_path) : r.books;
  S.total = r.total;
  const idx = S.books.findIndex((b) => b.id === S.bookId);
  S.sel = idx >= 0 ? idx : (S.books.length ? 0 : -1);
  renderBooks();
}

function setView(v, silent) {
  S.view = v; localSet("view", v);
  $("#viewTable").classList.toggle("on", v === "table");
  $("#viewTiles").classList.toggle("on", v === "tiles");
  $("#bookTableWrap").classList.toggle("hidden", v !== "table");
  $("#bookTiles").classList.toggle("hidden", v !== "tiles");
  if (!silent) renderBooks();
}

/** „Autor: Fundstelle“ – Feldname übersetzen */
function fundText(v) {
  if (!v) return "";
  const i = v.indexOf(": ");
  return i > 0 ? t(v.slice(0, i)) + v.slice(i) : v;
}

function renderBooks() {
  const parts = [];
  if (S.q) parts.push(t("Suche „{q}“", { q: S.q }));
  if (S.props) parts.push(t("gefiltert"));
  if (S.onlyEbooks) parts.push(t("nur eBooks"));
  if (S.group !== "") parts.push(t("Gruppe") + " " + S.group);
  $("#viewInfo").textContent = t("{n} von {total} Büchern", { n: nf(S.books.length), total: S.total == null ? "?" : nf(S.total) }) + (parts.length ? " · " + parts.join(" · ") : "");
  if (S.view === "tiles") return renderTiles();
  const cols = COLS().filter((c) => !c.search || S.q);
  const hl = S.group !== "" && S.gmode === "highlight";
  const thead = $("#bookTable thead");
  thead.innerHTML = "<tr>" + (hl ? `<th title="${esc(t("Gruppenmitglied (Klick schaltet um)"))}">G</th>` : "") + cols.map((c) =>
    `<th data-k="${c.k}" class="${S.sort === c.k ? "sorted" : ""} ${c.cls || ""}" title="${esc(c.title || t("Sortieren"))}">${esc(c.l)}${S.sort === c.k ? (S.dir === "asc" ? " ▲" : " ▼") : ""}</th>`).join("") + "</tr>";
  thead.onclick = (e) => {
    const th = e.target.closest("th[data-k]"); if (!th) return;
    const k = th.dataset.k;
    if (k === "props") { S.sort = "id"; S.dir = "desc"; } // "E" hebt Sortierung auf
    else if (S.sort === k) S.dir = S.dir === "asc" ? "desc" : "asc";
    else { S.sort = k; S.dir = "asc"; }
    loadBooks();
  };
  const html = S.books.map((b, i) => {
    const cls = [i === S.sel ? "sel" : "", b.loaned ? "loaned" : "", b.wish ? "wish" : "", hl ? (b.member ? "member" : "nonmember") : ""].join(" ");
    const cells = cols.map((c) => {
      if (c.k === "props") return `<td class="c-props"><span class="pbox ${b.properties ? "on" : ""}" data-props="${b.id}" title="${esc(propList(b.properties))}"></span></td>`;
      if (c.k === "ebook_path") return `<td class="c-ebook">${b.ebook_path ? `<span class="ebk" data-read="${b.id}" title="${esc(t("Lesen") + ": " + b.ebook_path)}">📖</span>` : ""}</td>`;
      const v = c.k === "fundstelle" ? fundText(b[c.k]) : b[c.k];
      return `<td class="c-${c.k === "fundstelle" ? "fund" : c.k}" title="${esc(v)}">${esc(v)}</td>`;
    }).join("");
    return `<tr data-i="${i}" class="${cls}">${hl ? `<td><input type="checkbox" data-tg="${b.id}" ${b.member ? "checked" : ""}></td>` : ""}${cells}</tr>`;
  }).join("");
  const tb = $("#bookTable tbody");
  tb.innerHTML = html || `<tr><td colspan="${cols.length + 1}" class="empty">${esc(t("Keine Bücher."))} ${esc(S.total ? t("Suche/Filter mit „Alle Datensätze“ aufheben.") : t("Über „Werkzeug → Import“ vorhandene Buchliebhaber-Daten übernehmen oder „+ Neues Buch“."))}</td></tr>`;
  tb.onclick = async (e) => {
    const pb = e.target.closest("[data-props]");
    if (pb) { await propertyDialog(+pb.dataset.props); return; }
    const rd = e.target.closest("[data-read]");
    if (rd) { openReader(+rd.dataset.read); return; }
    const tg = e.target.closest("[data-tg]");
    if (tg) { const r = await api("POST", `/api/groups/${S.group}/toggle/${tg.dataset.tg}`); const b = S.books.find((x) => x.id === +tg.dataset.tg); b.member = r.member; renderBooks(); return; }
    const tr = e.target.closest("tr[data-i]"); if (tr) selectRow(+tr.dataset.i);
  };
  tb.ondblclick = (e) => { if (e.target.closest("[data-read],[data-props]")) return; const tr = e.target.closest("tr[data-i]"); if (tr) openBook(S.books[+tr.dataset.i].id); };
  $("#bookTableWrap").tabIndex = 0;
  $("#bookTableWrap").onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); selectRow(Math.min(S.books.length - 1, S.sel + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); selectRow(Math.max(0, S.sel - 1)); }
    else if (e.key === "Enter" && S.sel >= 0) openBook(S.books[S.sel].id);
  };
  const selRow = tb.querySelector("tr.sel"); if (selRow) selRow.scrollIntoView({ block: "nearest" });
}
function propList(mask) {
  return S.meta.properties.filter((p) => p.name && mask & (1 << p.bit)).map((p) => t(p.name)).join(", ") || t("keine Eigenschaften");
}
function selectRow(i) {
  if (i < 0 || i >= S.books.length) return;
  const tb = $("#bookTable tbody");
  tb.querySelector("tr.sel")?.classList.remove("sel");
  const tr = tb.querySelector(`tr[data-i="${i}"]`); tr?.classList.add("sel"); tr?.scrollIntoView({ block: "nearest" });
  S.sel = i; S.bookId = S.books[i].id;
}

function renderTiles() {
  const wrap = $("#bookTiles");
  wrap.innerHTML = S.books.map((b, i) => `<div class="tile ${i === S.sel ? "sel" : ""}" data-i="${i}" tabindex="0">
    ${b.ebook_path ? `<span class="ebadge" data-read="${b.id}" title="${esc(t("eBook lesen"))}">📖</span>` : ""}
    <div class="ph">${b.cover ? `<img loading="lazy" alt="" src="/api/books/${b.id}/image/cover">` : esc(b.title || "")}</div>
    <div class="t">${esc(b.title || t("(ohne Titel)"))}</div><div class="a">${esc(b.author || "")}</div></div>`).join("")
    || `<div class="empty">${esc(t("Keine Bücher."))}</div>`;
  wrap.onclick = (e) => {
    const rd = e.target.closest("[data-read]"); if (rd) { openReader(+rd.dataset.read); return; }
    const tl = e.target.closest(".tile"); if (tl) { $$(".tile.sel", wrap).forEach((x) => x.classList.remove("sel")); tl.classList.add("sel"); S.sel = +tl.dataset.i; S.bookId = S.books[S.sel].id; }
  };
  wrap.ondblclick = (e) => { if (e.target.closest("[data-read]")) return; const tl = e.target.closest(".tile"); if (tl) openBook(S.books[+tl.dataset.i].id); };
  wrap.onkeydown = (e) => { if (e.key === "Enter") { const tl = e.target.closest(".tile"); if (tl) openBook(S.books[+tl.dataset.i].id); } };
}

async function propertyDialog(bookId) {
  const b = S.books.find((x) => x.id === bookId) || (S.book?.id === bookId ? S.book : null);
  let mask = b?.properties || 0;
  const box = h("div", { cls: "chips" });
  for (const p of S.meta.properties) {
    if (!p.name) continue;
    const c = h("span", { cls: "chip" + (mask & (1 << p.bit) ? " on" : ""), onclick: () => { mask ^= 1 << p.bit; c.classList.toggle("on"); } }, t(p.name));
    box.append(c);
  }
  const body = h("div", {}, h("p", { cls: "hint" }, `${b?.title || ""} – ${t("neue Eigenschaften unter Werkzeug → Eigenschaften definieren.")}`), box);
  if (await dialog(t("Eigenschaften"), body)) {
    await api("PUT", `/api/books/${bookId}/properties`, { properties: mask });
    if (b) b.properties = mask;
    if (S.book?.id === bookId) { S.book.properties = mask; renderBook(); }
    renderBooks();
  }
}

function updateFilterBtn() {
  const n = S.meta.properties.filter((p) => S.props & (1 << p.bit)).length;
  const b = $("#propFilter");
  b.textContent = n ? t("Gefiltert ({n})", { n }) : t("Filtern …");
  b.classList.toggle("primary", !!n);
}
async function filterDialog() {
  let mask = S.props;
  const box = h("div", { cls: "chips" });
  for (const p of S.meta.properties) {
    if (!p.name) continue;
    const c = h("span", { cls: "chip" + (mask & (1 << p.bit) ? " on" : ""), onclick: () => { mask ^= 1 << p.bit; c.classList.toggle("on"); } }, t(p.name));
    box.append(c);
  }
  const mode = h("select", {}, h("option", { value: "any" }, t("mindestens eine der Eigenschaften")), h("option", { value: "all" }, t("alle gewählten Eigenschaften")));
  mode.value = S.pmode;
  const r = await dialog(t("Nach Eigenschaften filtern"), h("div", {}, box, h("div", { cls: "row", style: "margin-top:12px" }, h("span", {}, t("Bücher mit")), mode)),
    [{ label: t("Filtern"), value: "ok", primary: true }, { label: t("Filter aufheben"), value: "clear" }, { label: t("Abbrechen"), value: null }]);
  if (!r) return;
  S.props = r === "clear" ? 0 : mask; S.pmode = mode.value;
  updateFilterBtn(); loadBooks();
}

async function exportDialog() {
  const body = h("div", {},
    h("p", {}, t("Exportiert werden die {n} angezeigten Bücher in der angezeigten Reihenfolge.", { n: nf(S.books.length) })),
    h("label", {}, h("input", { type: "radio", name: "ex", value: "csv", checked: true }), " " + t("CSV (Excel, LibreOffice; Trennzeichen ;)")), h("br"),
    h("label", {}, h("input", { type: "radio", name: "ex", value: "html" }), " " + t("Buchliste als HTML mit Covern (Smartphone, E-Mail, Drucken/PDF)")));
  if (!(await dialog(t("Ansicht exportieren"), body))) return;
  const kind = $("input[name=ex]:checked", body).value;
  const blob = await api("POST", `/api/export/${kind}`, { ids: S.books.map((b) => b.id), title: t("Bücherliste"), lang: LANG });
  download(blob, kind === "csv" ? "buchliste.csv" : "buchliste.html");
}

// ------------------------------------------------------------ Ein Buch
const BOOK_FORM = () => [
  { sect: t("Autor & Titel") },
  { k: "author", l: t("Autor"), cls: "w2", dl: true },
  { k: "title", l: t("Titel"), cls: "w2" },
  { k: "isbn", l: "ISBN", btn: ["↓", t("Daten zu dieser ISBN abfragen"), () => lookupDialog()] },
  { k: "ean", l: "EAN" },
  { k: "id", l: t("Buchnummer"), ro: true },
  { k: "barcode", l: t("Barcode") },
  { k: "bx", l: t("Buchindex (BX)"), dl: true, btn: ["⟲", t("BX aus „Nachname, Titel“ bilden"), makeBX] },
  { k: "ax", l: t("Autorenindex (AX)"), dl: true, btn: ["⟲", t("AX aus Autor bilden (Nachname, Vorname)"), makeAX] },
  { k: "class", l: t("Klassifikation / Signatur"), dl: true },
  { sect: "eBook" }, { custom: "ebook" },
  { sect: t("Ausgabe") },
  { k: "publisher", l: t("Verlag"), dl: true },
  { k: "binding", l: t("Bindung"), pick: "binding" },
  { k: "pages", l: t("Seiten"), type: "number" },
  { k: "list_price", l: t("Listenpreis") },
  { k: "pub_date", l: t("Erscheinungsdatum") },
  { k: "auflage", l: t("Auflage"), dl: true },
  { k: "ausgabe", l: t("Ausgabe"), dl: true },
  { k: "language", l: t("Sprache"), pick: "language" },
  { k: "condition", l: t("Zustand"), pick: "condition" },
  { sect: t("Weitere Angaben (Bezeichnungen unter Werkzeug änderbar)") },
  { k: "series", l: label("series", "Reihe"), dl: true },
  { k: "book_type", l: label("book_type", "Buchart"), pick: "book_type" },
  { k: "location", l: label("location", "Standort"), dl: true },
  { k: "topic", l: label("topic", "Thema"), dl: true },
  { k: "translator", l: label("translator", "Übersetzer"), dl: true },
  { k: "original_title", l: label("original_title", "Originaltitel") },
  { k: "original_language", l: label("original_language", "Originalsprache"), pick: "language" },
  { k: "first_published", l: label("first_published", "Ersterscheinung") },
  { sect: t("Mitwirkende") }, { custom: "persons" },
  { sect: t("Eigenschaften") }, { custom: "props" },
  { sect: t("Lesen & Bewerten") },
  { k: "read_status", l: t("Lesestatus"), pick: "read_status", select: true },
  { custom: "rating" },
  { k: "keywords_text", l: t("Schlagwörter (durch Komma getrennt)"), cls: "w2" },
  { sect: t("Inhalt & Notizen") },
  { k: "content", l: t("Inhaltsangabe"), cls: "full", area: true },
  { k: "notes", l: t("Eigene Notizen"), cls: "full", area: true, small: true },
];

function initBookPage() {
  $("#btnSave").onclick = saveBook;
  $("#btnDelete").onclick = deleteBook;
  $("#btnRead").onclick = () => S.book && openReader(S.book.id);
  $("#btnCopy").onclick = async () => { await autoSave(); const b = await api("POST", `/api/books/${S.book.id}/copy`); toast(t("Kopie angelegt: Nr. {n}", { n: b.id })); await loadBooks(); openBook(b.id); };
  $("#btnLookup").onclick = () => lookupDialog();
  $("#prevBook").onclick = () => stepBook(-1);
  $("#nextBook").onclick = () => stepBook(1);
  $$("#bookSubtabs button").forEach((b) => (b.onclick = () => subTab(b.dataset.sub)));
  // Cover
  const drop = $("#coverDrop");
  drop.onclick = () => $("#coverFile").click();
  drop.onkeydown = (e) => { if (e.key === "Enter") $("#coverFile").click(); };
  $("#coverUpload").onclick = () => $("#coverFile").click();
  $("#coverFile").onchange = (e) => { if (e.target.files[0]) uploadCover(e.target.files[0]); e.target.value = ""; };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("drag"); };
  drop.ondragleave = () => drop.classList.remove("drag");
  drop.ondrop = (e) => {
    e.preventDefault(); drop.classList.remove("drag");
    const f = e.dataTransfer.files[0];
    if (f) uploadCover(f);
    else { const u = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain"); if (/^https?:/.test(u)) fetchCover(u); }
  };
  document.addEventListener("paste", (e) => {
    if (!$("#tab-book").classList.contains("active") || !S.book) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item && !(e.target.matches && e.target.matches("input,textarea"))) { e.preventDefault(); uploadCover(item.getAsFile()); }
  });
  $("#coverUrl").onclick = async () => { const u = await prompt2(t("Cover aus dem Internet"), t("Bildadresse (URL):")); if (u) fetchCover(u.trim()); };
  $("#coverDel").onclick = async () => { if (await confirmDlg(t("Cover entfernen"), t("Coverbild wirklich entfernen?"))) { await api("DELETE", `/api/books/${S.book.id}/image/cover`); await api("DELETE", `/api/books/${S.book.id}/image/cover_small`); S.book.images = []; renderCover(); markListCover(false); } };
  for (const k of ["Review", "Loan", "Att", "Quote"]) $("#add" + k).onclick = () => addSub({ Review: "reviews", Loan: "loans", Att: "attachments", Quote: "quotes" }[k]);
}
function subTab(name) {
  $$("#bookSubtabs button").forEach((b) => b.classList.toggle("active", b.dataset.sub === name));
  $$("#tab-book .sub").forEach((s) => s.classList.toggle("active", s.id === "sub-" + name));
}

async function openBook(id) {
  await autoSave();
  S.bookId = id;
  S.book = await api("GET", "/api/books/" + id);
  S.dirty = false;
  const i = S.books.findIndex((b) => b.id === id); if (i >= 0) S.sel = i;
  showTab("book");
}
async function stepBook(d) {
  if (!S.books.length) return;
  let i = S.books.findIndex((b) => b.id === S.book?.id);
  i = i < 0 ? 0 : Math.max(0, Math.min(S.books.length - 1, i + d));
  await openBook(S.books[i].id);
}
async function newBook() {
  await autoSave();
  const lang = S.meta.settings.default_language || null;
  const b = await api("POST", "/api/books", { language: lang });
  S.total = (S.total || 0) + 1;
  S.books.unshift({ id: b.id, properties: 0 });
  await openBook(b.id);
  subTab("data");
  setTimeout(() => $('#bookForm [name="author"]')?.focus(), 50);
  loadBooks();
}
async function deleteBook() {
  if (!S.book) return;
  if (isYes(S.meta.settings.confirm_delete) && !(await confirmDlg(t("Buch löschen"), t("„{title}“ mit allen Rezensionen, Verleihvorgängen und Bildern löschen?", { title: S.book.title || t("(ohne Titel)") })))) return;
  await api("DELETE", "/api/books/" + S.book.id);
  const i = S.books.findIndex((b) => b.id === S.book.id);
  if (i >= 0) S.books.splice(i, 1);
  S.book = null; S.dirty = false;
  toast(t("Buch gelöscht"));
  if (S.books.length) openBook(S.books[Math.max(0, Math.min(i, S.books.length - 1))].id); else renderBook();
  loadBooks();
}

function renderBook() {
  const b = S.book;
  $("#bookEmpty").classList.toggle("hidden", !!b);
  $("#bookView").classList.toggle("hidden", !b);
  if (!b) return;
  $("#bookHeading").textContent = (b.title || t("(ohne Titel)")) + (b.author ? " – " + b.author : "");
  $("#btnRead").classList.toggle("hidden", !b.ebook_path);
  setSaveState();
  const counts = { reviews: b.reviews.length, loan: b.loans.length + (b.sale ? 1 : 0) + (b.wishlist ? 1 : 0), web: b.attachments.length, quotes: b.quotes.length };
  $$("#bookSubtabs button").forEach((btn) => {
    const n = counts[btn.dataset.sub];
    btn.innerHTML = esc(t(btn.dataset.label)) + (n ? ` <span class="badge">${n}</span>` : "");
  });
  renderCover();
  renderLinks();
  $("#bookMeta").innerHTML = `${esc(t("angelegt"))} ${esc(fmtDate(b.created_at))}<br>${esc(t("geändert"))} ${esc(fmtDate(b.updated_at))} ${esc((b.updated_at || "").slice(11, 16))}`;
  // Formular
  const form = $("#bookForm"); form.innerHTML = "";
  b.keywords_text = b.keywords.map((k) => k.keyword).join(", ");
  for (const f of BOOK_FORM()) {
    if (f.sect) { form.append(h("div", { cls: "sect" }, f.sect)); continue; }
    if (f.custom === "persons") { form.append(personsWidget()); continue; }
    if (f.custom === "props") { form.append(propsWidget()); continue; }
    if (f.custom === "rating") { form.append(ratingWidget()); continue; }
    if (f.custom === "ebook") { form.append(ebookWidget()); continue; }
    const id = "f_" + f.k;
    let input;
    if (f.area) input = h("textarea", { id, name: f.k, rows: f.small ? 4 : 10 });
    else if (f.select) {
      const vals = S.meta.picklists[f.pick] || [];
      input = h("select", { id, name: f.k }, h("option", { value: "" }, "–"), ...vals.map((v) => h("option", { value: v }, t(v))));
      if (b[f.k] && !vals.includes(b[f.k])) input.append(h("option", { value: b[f.k] }, b[f.k]));
    } else {
      input = h("input", { id, name: f.k, type: f.type || "text", readonly: f.ro, list: (f.dl || f.pick) ? "dl_" + f.k : null });
      if (f.dl || f.pick) {
        const dl = h("datalist", { id: "dl_" + f.k });
        for (const v of S.meta.picklists[f.pick] || []) dl.append(h("option", { value: v }));
        input.addEventListener("focus", () => fillDatalist(f.k, dl, f.pick), { once: true });
        form.append(dl);
      }
    }
    input.value = b[f.k] ?? "";
    input.addEventListener("input", markDirty);
    if (f.k === "isbn") input.addEventListener("change", onIsbnChange);
    const fx = f.btn ? h("div", { cls: "fx" }, input, h("button", { type: "button", title: f.btn[1], onclick: f.btn[2] }, f.btn[0])) : input;
    form.append(h("div", { cls: "f " + (f.cls || "") }, h("label", { for: id }, f.l), fx));
  }
  form.onsubmit = (e) => { e.preventDefault(); saveBook(); };
  renderSubLists();
  checkEbook();
}
async function fillDatalist(field, dl) {
  if (field === "author") {
    const ps = await personsAll();
    for (const p of ps) dl.append(h("option", { value: p.display_name || p.sort_name }));
    return;
  }
  const vals = await api("GET", "/api/distinct/" + field);
  const have = new Set([...dl.options].map((o) => o.value));
  for (const v of vals) if (!have.has(v)) dl.append(h("option", { value: v }));
}
async function personsAll() {
  if (!S.personsCache) S.personsCache = await api("GET", "/api/persons");
  return S.personsCache;
}
function markDirty() { S.dirty = true; setSaveState(); }
function setSaveState() { $("#saveState").textContent = S.dirty ? t("ungespeichert") : t("gespeichert"); }

function collectForm() {
  const d = {};
  for (const el of $$("#bookForm [name]")) if (!el.readOnly) d[el.name] = el.value;
  d.properties = S.book.properties;
  d.my_rating = S.book.my_rating;
  return d;
}
async function saveBook() {
  if (!S.book) return;
  const d = collectForm();
  if (isYes(S.meta.settings.bx_from_author) && !d.bx && d.author && d.title) d.bx = bxFrom(d.author, d.title);
  if (!d.ax && d.author) d.ax = sortName(d.author.split(/[,;]| und | and /)[0]);
  const nb = await api("PUT", "/api/books/" + S.book.id, d);
  S.book = nb; S.dirty = false;
  const lb = S.books.find((x) => x.id === nb.id);
  if (lb) Object.assign(lb, { author: nb.author, title: nb.title, bx: nb.bx, ax: nb.ax, class: nb.class, location: nb.location, pub_date: nb.pub_date, publisher: nb.publisher, isbn: nb.isbn, barcode: nb.barcode, properties: nb.properties, ebook_path: nb.ebook_path });
  renderBook();
  toast(t("Gespeichert"));
}
async function autoSave() { if (S.dirty && S.book && $("#bookForm [name]")) await saveBook(); }

function sortName(display) {
  display = (display || "").trim();
  if (!display || display.includes(",")) return display;
  const p = display.split(/\s+/);
  return p.length < 2 ? display : `${p[p.length - 1]}, ${p.slice(0, -1).join(" ")}`;
}
function bxFrom(author, title) { return `${sortName(author.split(/[,;]| und | and /)[0]).split(",")[0]}, ${title}`.slice(0, 120); }
function makeBX() { const f = $("#bookForm"); f.bx.value = bxFrom(f.author.value, f.title.value); markDirty(); }
function makeAX() { const f = $("#bookForm"); f.ax.value = sortName(f.author.value.split(/[,;]| und | and /)[0]); markDirty(); }

async function onIsbnChange(e) {
  const v = e.target.value.replace(/[^0-9Xx]/g, "");
  if ((v.length === 10 || v.length === 13) && !$("#bookForm").title.value && isYes(S.meta.settings.isbn_autolookup)) lookupDialog();
}

function personsWidget() {
  const b = S.book;
  const wrap = h("div", { cls: "f full persons" });
  for (const p of b.persons) {
    wrap.append(h("div", { cls: "person-row" },
      h("a", { onclick: () => { showTab("persons"); selectPerson(p.id); } }, p.display_name || p.sort_name),
      h("span", { cls: "role" }, t(p.role || "")),
      h("button", { type: "button", title: t("Verknüpfung entfernen"), onclick: async () => { S.book = await api("DELETE", `/api/books/${b.id}/persons/${p.id}?role=${encodeURIComponent(p.role || "")}`); renderBook(); } }, "×")));
  }
  const name = h("input", { placeholder: t("Name (Vorname Nachname oder Nachname, Vorname)"), list: "dl_persons" });
  const dl = h("datalist", { id: "dl_persons" });
  name.addEventListener("focus", async () => { if (dl.options.length) return; for (const p of await personsAll()) dl.append(h("option", { value: p.display_name || p.sort_name })); }, { once: true });
  const role = h("select", {}, ...(S.meta.picklists.role || ["Autor"]).map((r) => h("option", { value: r }, t(r))));
  if (S.meta.settings.default_role) role.value = S.meta.settings.default_role;
  const add = async () => {
    if (!name.value.trim()) return;
    await autoSave();
    S.book = await api("POST", `/api/books/${b.id}/persons`, { name: name.value.trim(), role: role.value });
    S.personsCache = null;
    renderBook();
  };
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  wrap.append(h("div", { cls: "person-row" }, name, role, h("button", { type: "button", onclick: add }, t("Hinzufügen"))), dl);
  if (!b.persons.length && b.author) {
    wrap.append(h("button", { type: "button", style: "align-self:flex-start", onclick: async () => {
      await autoSave();
      for (const n of b.author.split(/;| und | and /).map((s) => s.trim()).filter(Boolean)) S.book = await api("POST", `/api/books/${b.id}/persons`, { name: n, role: "Autor" });
      S.personsCache = null; renderBook();
    } }, t("„{name}“ als Mitwirkenden anlegen", { name: b.author })));
  }
  return wrap;
}
function propsWidget() {
  const box = h("div", { cls: "f full chips" });
  for (const p of S.meta.properties) {
    if (!p.name) continue;
    const on = S.book.properties & (1 << p.bit);
    const c = h("span", { cls: "chip" + (on ? " on" : ""), tabindex: 0, role: "checkbox", "aria-checked": on ? "true" : "false" }, t(p.name));
    const tog = () => { S.book.properties ^= 1 << p.bit; c.classList.toggle("on"); c.setAttribute("aria-checked", c.classList.contains("on")); markDirty(); };
    c.onclick = tog; c.onkeydown = (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); tog(); } };
    box.append(c);
  }
  return box;
}
function ratingWidget() {
  const st = h("div", { cls: "stars", role: "radiogroup", "aria-label": t("Eigene Bewertung") });
  const draw = () => [...st.children].forEach((s, i) => s.classList.toggle("on", i < (S.book.my_rating || 0)));
  for (let i = 1; i <= 5; i++) st.append(h("span", { title: t(i > 1 ? "{n} Sterne" : "{n} Stern", { n: i }), onclick: () => { S.book.my_rating = S.book.my_rating === i ? null : i; draw(); markDirty(); } }, "★"));
  draw();
  return h("div", { cls: "f" }, h("label", {}, t("Eigene Bewertung")), st);
}

// --- eBook im Buch ------------------------------------------------------
function ebookWidget() {
  const inp = h("input", { id: "f_ebook_path", name: "ebook_path", placeholder: t("Pfad zur eBook-Datei (EPUB, PDF, TXT, MOBI …)") });
  inp.value = S.book.ebook_path || "";
  inp.addEventListener("input", markDirty);
  inp.addEventListener("change", checkEbook);
  // Datei aus dem Explorer hineinziehen: nur Name verfügbar – Hinweis
  const btn = (txt, title, fn, cls) => h("button", { type: "button", title, cls, onclick: fn }, txt);
  return h("div", { cls: "f full ebookbox" },
    h("label", { for: "f_ebook_path" }, t("eBook-Datei (Pfad)")),
    h("div", { cls: "fx" }, inp,
      btn("📂 " + t("Durchsuchen …"), t("eBook-Datei auswählen"), pickEbookFile),
      btn("🔍 " + t("eBook finden"), t("Passende eBook-Datei in den eBook-Ordnern suchen (Titel, Autor, ISBN)"), findEbookDialog)),
    h("div", { cls: "ebtns" },
      btn("📖 " + t("Lesen"), t("eBook lesen (Alt+L)"), () => openReaderFromForm(), "primary"),
      btn(t("Extern öffnen"), t("Mit dem Standardprogramm des Systems öffnen"), () => openExternal(S.book.id)),
      btn(t("Herunterladen"), t("eBook-Datei herunterladen"), async () => { await autoSave(); location.href = `/api/books/${S.book.id}/ebook/file?download=1`; }),
      btn(t("Daten aus eBook übernehmen"), t("Titel, Autor, ISBN, Verlag, Beschreibung und Cover aus den eBook-Metadaten (EPUB)"), ebookMetaDialog),
      btn("✕", t("eBook-Verknüpfung entfernen (die Datei bleibt erhalten)"), () => { inp.value = ""; markDirty(); checkEbook(); })),
    h("div", { cls: "estate", id: "ebookState" }));
}
async function checkEbook() {
  const st = $("#ebookState"); if (!st || !S.book) return;
  const v = $("#f_ebook_path")?.value.trim();
  st.className = "estate"; st.textContent = "";
  if (!v) { st.textContent = t("Kein eBook hinterlegt."); return; }
  if (v !== (S.book.ebook_path || "")) { st.textContent = t("Noch nicht gespeichert."); return; }
  try {
    const i = await api("GET", `/api/books/${S.book.id}/ebook`);
    if (!i.exists) { st.className = "estate bad"; st.textContent = t("Datei nicht gefunden – Pfad prüfen oder „eBook finden“."); return; }
    const fmt = (i.ext || "").replace(".", "").toUpperCase();
    st.textContent = `${fmt} · ${fmtSize(i.size)}` + (i.kind ? "" : " · " + t("wird mit dem Standardprogramm geöffnet")) + (i.spine ? " · " + t("{n} Kapitel", { n: i.spine.length }) : "");
  } catch (e) { st.className = "estate bad"; st.textContent = e.message; }
}
async function setEbookPath(p) {
  const inp = $("#f_ebook_path"); if (!inp) return;
  inp.value = p;
  const f = $("#bookForm");
  if (f.binding && !f.binding.value) f.binding.value = "eBook";
  markDirty();
  await saveBook();
}
async function openReaderFromForm() {
  await autoSave();
  if (!S.book.ebook_path) return toast(t("Kein eBook hinterlegt."), true);
  openReader(S.book.id);
}
async function openExternal(id) {
  await autoSave();
  await api("POST", `/api/books/${id}/ebook/open`);
  toast(t("Mit Standardprogramm geöffnet"));
}

/** Dateiauswahl über den Server (der Browser liefert keine vollständigen Pfade). */
async function fileDialog({ start = "", dirMode = false, title } = {}) {
  let cur = null, selected = null, showAll = false;
  const pathInp = h("input", { type: "text", placeholder: t("Pfad eingeben und Enter") });
  const roots = h("div", { cls: "fsroots" });
  const list = h("ul", { cls: "fslist", tabindex: 0 });
  const all = h("input", { type: "checkbox" });
  const info = h("span", { cls: "info" });
  const go = async (p) => {
    let r;
    try { r = await api("GET", "/api/fs?" + new URLSearchParams({ path: p || "", all: showAll ? "1" : "0" })); } catch (e) { return; }
    cur = r; selected = null; pathInp.value = r.path;
    roots.innerHTML = "";
    for (const x of r.roots) roots.append(h("button", { type: "button", onclick: () => go(x.path) }, x.name === "Home" ? "🏠 " + t("Persönlicher Ordner") : x.name));
    list.innerHTML = "";
    if (r.parent !== null && r.path) list.append(h("li", { onclick: () => go(r.parent || ""), cls: "dim" }, "⬆ ..", h("span", { cls: "sz" }, t("übergeordneter Ordner"))));
    for (const d of r.dirs) list.append(h("li", { ondblclick: () => go(join(r.path, d)), onclick: (e) => { mark(e.currentTarget); selected = { dir: join(r.path, d) }; } }, "📁 " + d));
    if (!dirMode) for (const f of r.files) {
      list.append(h("li", { cls: f.readable ? "" : "dim", title: f.readable ? t("im eingebauten Leser lesbar") : t("wird mit dem Standardprogramm geöffnet"),
        onclick: (e) => { mark(e.currentTarget); selected = { file: join(r.path, f.name) }; },
        ondblclick: () => { selected = { file: join(r.path, f.name) }; $("#dlgBtns button.primary").click(); } },
      (f.readable ? "📘 " : "📄 ") + f.name, h("span", { cls: "sz" }, fmtSize(f.size))));
    }
    if (!r.path) list.append(h("li", { cls: "dim" }, t("Bitte einen Ort oben auswählen.")));
    info.textContent = r.path ? t("{d} Ordner, {f} Dateien", { d: r.dirs.length, f: dirMode ? "–" : r.files.length }) : "";
  };
  const join = (a, b) => a.endsWith("/") || a.endsWith("\\") ? a + b : a + (cur?.sep || "/") + b;
  const mark = (li) => { $$("li.sel", list).forEach((x) => x.classList.remove("sel")); li.classList.add("sel"); };
  pathInp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(pathInp.value); } });
  all.onchange = () => { showAll = all.checked; go(cur?.path || ""); };
  const body = h("div", { cls: "fsdlg" }, roots, h("div", { cls: "fspath" }, pathInp, h("button", { type: "button", onclick: () => go(pathInp.value) }, t("Öffnen"))), list,
    h("div", { cls: "row", style: "margin-top:6px" }, dirMode ? "" : h("label", {}, all, " " + t("alle Dateitypen zeigen")), h("div", { cls: "spacer" }), info));
  await go(start);
  const r = await dialog(title || (dirMode ? t("Ordner wählen") : t("eBook-Datei auswählen")), body,
    [{ label: dirMode ? t("Diesen Ordner wählen") : t("Auswählen"), value: "ok", primary: true }, { label: t("Abbrechen"), value: null }]);
  if (!r) return null;
  if (dirMode) return selected?.dir || cur?.path || null;
  if (selected?.file) return selected.file;
  if (selected?.dir) { toast(t("Bitte eine Datei auswählen (Doppelklick öffnet Ordner)."), true); return null; }
  return null;
}
async function pickEbookFile() {
  const curPath = $("#f_ebook_path")?.value.trim();
  const start = curPath ? curPath.replace(/[\\/][^\\/]*$/, "") : (localGet("ebookDir", "") || (S.meta.settings.ebook_dirs || "").split(/[;\n]/)[0] || "");
  const p = await fileDialog({ start });
  if (!p) return;
  localSet("ebookDir", p.replace(/[\\/][^\\/]*$/, ""));
  await setEbookPath(p);
  toast(t("eBook verknüpft"));
}
async function findEbookDialog() {
  await autoSave();
  const f = $("#bookForm");
  const res = h("div", {}, h("p", { cls: "hint" }, t("Suche läuft …")));
  let results = [], chosen = 0;
  const run = async (dir) => {
    res.innerHTML = ""; res.append(h("p", { cls: "hint" }, t("Suche läuft …")));
    const r = await api("POST", `/api/books/${S.book.id}/ebook/find`, { dir, title: f.title.value, author: f.author.value, isbn: f.isbn.value, ean: f.ean.value });
    results = r.results; chosen = 0; res.innerHTML = "";
    res.append(h("p", { cls: "hint" }, t("Durchsuchte Ordner:") + " " + (r.dirs.join(" · ") || "–")));
    if (!results.length) res.append(h("p", {}, t("Keine passende eBook-Datei gefunden. Ordner unter Werkzeug → eBook-Bibliothek einstellen oder anderen Ordner durchsuchen.")));
    results.forEach((x, i) => {
      res.append(h("div", { cls: "findres" + (i === 0 ? " sel" : ""), onclick: (e) => { chosen = i; $$(".findres", res).forEach((el, j) => el.classList.toggle("sel", j === i)); }, ondblclick: () => $("#dlgBtns button.primary").click() },
        h("div", {}, h("strong", {}, x.title || ""), x.author ? " – " + x.author : "", h("span", { cls: "info" }, `  ${Math.round(x.score * 100)} % · ${fmtSize(x.size)}`)),
        h("div", { cls: "p" }, x.path)));
    });
  };
  // Ein <dialog> lässt sich nicht verschachteln – anderer Ordner daher per Eingabefeld
  const dirInp = h("input", { type: "text", style: "flex:1", value: localGet("ebookDir", ""), placeholder: t("Ordner (Pfad):") });
  dirInp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (dirInp.value.trim()) run(dirInp.value.trim()); } });
  const other = h("button", { type: "button", onclick: () => dirInp.value.trim() && run(dirInp.value.trim()) }, t("Anderen Ordner durchsuchen …"));
  setTimeout(() => run(""), 0);
  const ok = await dialog(t("eBook finden"), h("div", { style: "min-width:min(640px,80vw)" }, res, h("div", { cls: "row", style: "margin-top:8px" }, dirInp, other)),
    [{ label: t("Übernehmen"), value: "ok", primary: true }, { label: t("Abbrechen"), value: null }]);
  if (!ok || !results.length) return;
  await setEbookPath(results[chosen].path);
  toast(t("eBook verknüpft"));
}
async function ebookMetaDialog() {
  await autoSave();
  if (!S.book.ebook_path) return toast(t("Kein eBook hinterlegt."), true);
  const r = await api("GET", `/api/books/${S.book.id}/ebook/meta`);
  const dlx = h("dl", {});
  for (const [k, l] of [["author", "Autor"], ["title", "Titel"], ["publisher", "Verlag"], ["pub_date", "Jahr"], ["isbn", "ISBN"], ["language", "Sprache"]])
    if (r[k]) dlx.append(h("dt", {}, t(l)), h("dd", { style: "margin:0" }, String(r[k])));
  if (r.content) dlx.append(h("dt", {}, t("Inhalt")), h("dd", { style: "margin:0" }, r.content.slice(0, 300) + (r.content.length > 300 ? " …" : "")));
  const ow = h("input", { type: "checkbox", checked: false });
  const cov = h("input", { type: "checkbox", checked: !S.book.images.includes("cover") });
  const body = h("div", {}, h("div", { cls: "lookup-res sel" }, dlx), h("div", { cls: "row wrap", style: "margin-top:10px" },
    h("label", {}, ow, " " + t("vorhandene Felder überschreiben")), h("label", {}, cov, " " + t("Cover übernehmen"))));
  if (!(await dialog(t("Daten aus eBook übernehmen"), body, [{ label: t("Übernehmen"), value: "ok", primary: true }, { label: t("Abbrechen"), value: null }]))) return;
  r.cover_ebook = true;
  await applyLookup(r, ow.checked, cov.checked, true);
}

function renderCover() {
  const b = S.book, img = $("#coverImg");
  const has = b.images.includes("cover") || b.images.includes("cover_small");
  img.classList.toggle("hidden", !has); $("#coverHint").classList.toggle("hidden", has);
  if (has) img.src = `/api/books/${b.id}/image/cover?t=${Date.now()}`; else img.removeAttribute("src");
}
function markListCover(v) { const lb = S.books.find((x) => x.id === S.book.id); if (lb) lb.cover = v; }
async function uploadCover(file) {
  if (!file.type.startsWith("image/")) return toast(t("Keine Bilddatei"), true);
  const data = await downscale(file, +(S.meta.settings.cover_height || 800));
  await api("PUT", `/api/books/${S.book.id}/image/cover`, data, true);
  S.book.images = [...new Set([...S.book.images, "cover"])]; renderCover(); markListCover(true); toast(t("Cover gespeichert"));
}
async function fetchCover(url) {
  await api("POST", `/api/books/${S.book.id}/image/cover/fetch`, { url });
  S.book.images = [...new Set([...S.book.images, "cover"])]; renderCover(); markListCover(true); toast(t("Cover geladen"));
}
/** Bild auf max. Höhe verkleinern (Original normiert auf 475 px) – als JPEG. */
function downscale(file, maxH) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.height <= maxH) { resolve(file); return; }
      const c = document.createElement("canvas");
      c.height = maxH; c.width = Math.round(img.width * maxH / img.height);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((bl) => resolve(bl || file), "image/jpeg", 0.88);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}
function renderLinks() {
  const b = S.book, q = encodeURIComponent, isbn = (b.isbn || b.ean || "").replace(/[^0-9Xx]/g, "");
  const tt = [b.author, b.title].filter(Boolean).join(" ");
  const wl = { de: "de", en: "en", es: "es", fr: "fr", ru: "ru", zh: "zh" }[LANG] || "en";
  const links = [
    ["DNB", isbn ? `https://portal.dnb.de/opac/simpleSearch?query=${q(isbn)}` : `https://portal.dnb.de/opac/simpleSearch?query=${q(tt)}`],
    ["Google", `https://www.google.com/search?q=${q(isbn || tt)}`],
    ["Google Books", `https://www.google.com/search?tbm=bks&q=${q(isbn ? "isbn:" + isbn : tt)}`],
    ["Wikipedia", `https://${wl}.wikipedia.org/w/index.php?search=${q(b.title || "")}`],
    ["Open Library", `https://openlibrary.org/search?q=${q(isbn || tt)}`],
    ["Booklooker", `https://www.booklooker.de/B%C3%BCcher/Angebote/isbn=${q(isbn)}`],
    ["Gutenberg", `https://www.gutenberg.org/ebooks/search/?query=${q(tt)}`],
  ];
  for (let i = 1; i <= 3; i++) {
    const n = S.meta.settings[`shop${i}_name`], u = S.meta.settings[`shop${i}_url`];
    if (n && u) links.push([n, u + q(isbn || tt)]);
  }
  $("#webLinks").innerHTML = links.filter((l) => !l[1].endsWith("isbn=")).map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n)}</a>`).join("");
}

// --- Internetabfrage --------------------------------------------------
async function lookupDialog() {
  if (!S.book) return;
  const f = $("#bookForm");
  const q0 = (f.isbn?.value || f.ean?.value || "").trim() || [f.author?.value, f.title?.value].filter(Boolean).join(" ");
  const inp = h("input", { type: "text", value: q0, style: "flex:1", placeholder: t("ISBN, EAN oder Autor + Titel") });
  const res = h("div", {}, h("p", { cls: "hint" }, t("Abfrage bei der Deutschen Nationalbibliothek und Open Library.")));
  const ow = h("input", { type: "checkbox", checked: S.meta.settings.lookup_overwrite === "Ja" });
  const cov = h("input", { type: "checkbox", checked: true });
  const cont = h("input", { type: "checkbox", checked: true });
  let results = [], chosen = 0;
  const run = async () => {
    res.innerHTML = `<p class="hint">${esc(t("Suche läuft …"))}</p>`;
    const r = await api("GET", "/api/lookup?q=" + encodeURIComponent(inp.value));
    results = r.results; chosen = 0;
    res.innerHTML = "";
    if (!results.length) res.append(h("p", { cls: "hint" }, t("Nichts gefunden.") + (r.errors.length ? " (" + r.errors.join("; ") + ")" : "")));
    results.forEach((x, i) => {
      const dlx = h("dl", {});
      for (const [k, l] of [["author", "Autor"], ["title", "Titel"], ["publisher", "Verlag"], ["pub_date", "Jahr"], ["pages", "Seiten"], ["isbn", "ISBN"], ["series", "Reihe"], ["list_price", "Preis"], ["source", "Quelle"]])
        if (x[k]) dlx.append(h("dt", {}, t(l)), h("dd", { style: "margin:0" }, String(x[k])));
      const el = h("div", { cls: "lookup-res" + (i === 0 ? " sel" : ""), onclick: () => { chosen = i; $$(".lookup-res", res).forEach((e, j) => e.classList.toggle("sel", j === i)); } },
        x.cover_url ? h("img", { src: x.cover_url, alt: "", referrerpolicy: "no-referrer", onerror: (e) => e.target.remove() }) : "", dlx);
      res.append(el);
    });
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } });
  const body = h("div", {}, h("div", { cls: "row" }, inp, h("button", { type: "button", onclick: run }, t("Suchen"))), res,
    h("div", { cls: "row wrap", style: "margin-top:10px" },
      h("label", {}, ow, " " + t("vorhandene Felder überschreiben")), h("label", {}, cov, " " + t("Cover übernehmen")), h("label", {}, cont, " " + t("Inhaltstext laden"))));
  if (q0) setTimeout(run, 0);
  const ok = await dialog(t("Buchdaten abfragen"), body, [{ label: t("Übernehmen"), value: "ok", primary: true }, { label: t("Abbrechen"), value: null }]);
  if (!ok || !results.length) return;
  await applyLookup(results[chosen], ow.checked, cov.checked, cont.checked);
}
async function applyLookup(r, overwrite, cover, content) {
  const f = $("#bookForm");
  for (const k of ["author", "title", "isbn", "ean", "publisher", "pub_date", "pages", "binding", "list_price", "series", "language", "translator", "auflage", "original_title", "ax"]) {
    if (r[k] == null || !f[k]) continue;
    if (overwrite || !f[k].value) f[k].value = r[k];
  }
  if (r.keywords?.length && f.keywords_text && (overwrite || !f.keywords_text.value)) f.keywords_text.value = r.keywords.join(", ");
  if (!f.bx.value || overwrite) f.bx.value = bxFrom(f.author.value, f.title.value);
  markDirty();
  if (content && r.content && (overwrite || !f.content.value)) f.content.value = r.content;
  if (content && r.content_url && (overwrite || !f.content.value)) {
    try { const c = await api("GET", "/api/lookup/content?url=" + encodeURIComponent(r.content_url)); if (c.text) f.content.value = c.text; } catch (e) { /* */ }
  }
  await saveBook();
  for (const p of r.persons || []) {
    if (S.book.persons.some((x) => (x.sort_name || "").toLowerCase() === (p.sort_name || "").toLowerCase())) continue;
    S.book = await api("POST", `/api/books/${S.book.id}/persons`, { name: p.display_name, sort_name: p.sort_name, role: p.role });
  }
  S.personsCache = null;
  if (cover && (r.cover_url || r.cover_ebook) && (overwrite || !S.book.images.includes("cover"))) {
    try {
      if (r.cover_ebook) await api("POST", `/api/books/${S.book.id}/ebook/cover`);
      else await api("POST", `/api/books/${S.book.id}/image/cover/fetch`, { url: r.cover_url });
      S.book.images.push("cover"); markListCover(true);
    } catch (e) { /* kein Cover */ }
  }
  renderBook();
}

// --- Unterlisten des Buches ---------------------------------------------
const SUB_DEF = () => ({
  reviews: { list: "#reviewsList", fields: [["date", t("Gelesen am / Datum"), "date"], ["rating", t("Bewertung (1–5)"), "number"], ["summary", t("Zusammenfassung"), "text", "w2"], ["content", t("Rezension / Kommentar"), "area", "full"]] },
  loans: { list: "#loansList", fields: [["borrower", t("Leihnehmer"), "text"], ["loan_date", t("verliehen am"), "date"], ["due_date", t("Rückgabe bis"), "date"], ["return_date", t("zurück am"), "date"], ["remind", t("mahnen?"), "text"], ["rating", t("Bewertung Leihnehmer (1–5)"), "number"], ["note", t("Verleihnotiz"), "area", "full"], ["rating_comment", t("Wertungskommentar"), "text", "full"]] },
  attachments: { list: "#attList", fields: [["kind", t("Art (Web, Datei …)"), "text"], ["name", t("Adresse / URL"), "text", "w2"], ["path", t("Dateipfad"), "text", "w2"], ["description", t("Beschreibung"), "text", "w2"], ["date", t("Datum"), "date"]] },
  quotes: { list: "#quoteList", fields: [["category", t("Beschreibung / Kategorie"), "text", "w2"], ["date", t("Datum"), "date"], ["text", t("Zitat / Anmerkung"), "area", "full"]] },
});
function renderSubLists() {
  for (const [tb, def] of Object.entries(SUB_DEF())) {
    const box = $(def.list); box.innerHTML = "";
    const rows = S.book[tb];
    if (!rows.length) box.append(h("p", { cls: "hint" }, t("Noch keine Einträge.")));
    for (const r of rows) box.append(subCard(tb, def, r));
  }
  // Verkauf
  const sale = S.book.sale || {};
  const sf = $("#saleForm"); sf.innerHTML = "";
  for (const [k, l, ty] of [["acquired", "Erworben am", "date"], ["purchase_price", "Einkaufspreis"], ["purchase_source", "Kaufquelle"], ["sale_place", "Verkaufsort"], ["sale_price", "Verkaufspreis"], ["currency", "Währung"], ["buyer", "Käufer"], ["shipping", "Versandart"], ["postage", "Porto"], ["weight", "Gewicht"], ["dimensions", "H×B×T"], ["condition", "Zustand"], ["note", "Verkaufsnotiz", "area"]]) {
    const inp = ty === "area" ? h("textarea", { name: k, rows: 3 }) : h("input", { name: k, type: ty || "text" });
    inp.value = sale[k] ?? "";
    sf.append(h("div", { cls: "f" + (ty === "area" ? " full" : "") }, h("label", {}, t(l)), inp));
  }
  sf.append(h("div", { cls: "f full" }, h("div", { cls: "cardbtns" }, h("button", { type: "button", cls: "primary", onclick: async () => {
    const d = Object.fromEntries($$("[name]", sf).map((e) => [e.name, e.value]));
    S.book = await api("PUT", "/api/books/" + S.book.id, { sale: d }); toast(t("Gespeichert")); renderBook(); subTab("loan");
  } }, t("Verkauf/Erwerb speichern")))));
  // Wunschliste
  const w = S.book.wishlist;
  const wf = $("#wishForm"); wf.innerHTML = "";
  const on = h("input", { type: "checkbox", checked: !!w });
  const rank = h("input", { type: "number", value: w?.rank ?? "" });
  const reason = h("textarea", { rows: 3 }); reason.value = w?.reason ?? "";
  wf.append(h("div", { cls: "f" }, h("label", {}, on, " " + t("Auf der Wunschliste"))), h("div", { cls: "f" }, h("label", {}, t("Rang")), rank),
    h("div", { cls: "f full" }, h("label", {}, t("Grund / Notiz")), reason),
    h("div", { cls: "f full" }, h("div", { cls: "cardbtns" }, h("button", { type: "button", cls: "primary", onclick: async () => {
      S.book = await api("PUT", "/api/books/" + S.book.id, { wishlist: on.checked ? { rank: rank.value, reason: reason.value } : null });
      const lb = S.books.find((x) => x.id === S.book.id); if (lb) lb.wish = on.checked;
      toast(t("Gespeichert")); renderBook(); subTab("loan");
    } }, t("Wunschliste speichern")))));
}
function subCard(tb, def, r) {
  const form = h("form", { cls: "form" });
  for (const [k, l, ty, cls] of def.fields) {
    const inp = ty === "area" ? h("textarea", { name: k, rows: 5 }) : h("input", { name: k, type: ty });
    inp.value = r[k] ?? "";
    form.append(h("div", { cls: "f " + (cls || "") }, h("label", {}, l), inp));
  }
  const extra = [];
  if (tb === "loans" && !r.return_date) extra.push(h("button", { type: "button", onclick: async () => { form.return_date.value = today(); save(); } }, t("Heute zurückgegeben")));
  if (tb === "attachments" && /^https?:/.test(r.name || "")) extra.push(h("a", { href: r.name, target: "_blank", rel: "noopener noreferrer", cls: "links" }, t("öffnen ↗")));
  if (tb === "attachments" && r.path && /\.(epub|pdf|txt|mobi|azw3?|fb2|djvu|cbz|html?)$/i.test(r.path) && r.path !== S.book.ebook_path)
    extra.push(h("button", { type: "button", title: t("Diesen Dateipfad als eBook des Buches übernehmen"), onclick: async () => { await setEbookPath(r.path); subTab("data"); toast(t("eBook verknüpft")); } }, "📖 " + t("als eBook übernehmen")));
  const save = async () => {
    const d = Object.fromEntries($$("[name]", form).map((e) => [e.name, e.value]));
    await api("PUT", `/api/sub/${tb}/${r.id}`, d);
    Object.assign(r, d); toast(t("Gespeichert"));
    if (tb === "loans") { const lb = S.books.find((x) => x.id === S.book.id); if (lb) lb.loaned = S.book.loans.some((l) => !l.return_date); }
  };
  return h("div", { cls: "card" }, form, h("div", { cls: "cardbtns" }, ...extra,
    h("button", { type: "button", cls: "danger", onclick: async () => {
      if (!(await confirmDlg(t("Eintrag löschen"), t("Diesen Eintrag löschen?")))) return;
      await api("DELETE", `/api/sub/${tb}/${r.id}`); S.book = await api("GET", "/api/books/" + S.book.id); renderBook(); subTab(subOf(tb));
    } }, t("Löschen")),
    h("button", { type: "button", cls: "primary", onclick: save }, t("Speichern"))));
}
const subOf = (tb) => ({ reviews: "reviews", loans: "loan", attachments: "web", quotes: "quotes" }[tb]);
async function addSub(tb) {
  const d = { book_id: S.book.id };
  if (tb === "reviews") d.date = today();
  if (tb === "loans") { d.loan_date = today(); const n = await prompt2(t("Buch verleihen"), t("An wen wird das Buch verliehen?")); if (n === null) return; d.borrower = n; d.remind = t("Ja"); }
  if (tb === "quotes") d.date = today();
  if (tb === "attachments") { d.kind = "Web"; d.date = today(); }
  await api("POST", "/api/sub/" + tb, d);
  S.book = await api("GET", "/api/books/" + S.book.id);
  if (tb === "loans") { const lb = S.books.find((x) => x.id === S.book.id); if (lb) lb.loaned = true; }
  renderBook(); subTab(subOf(tb));
  const cards = $$(SUB_DEF()[tb].list + " .card");
  cards[cards.length - 1]?.querySelector("input,textarea")?.focus();
}

// ------------------------------------------------------------ eBook-Leser
const R = { id: null, info: null, idx: 0, size: +localGet("rSize", "110"), theme: localGet("rTheme", "light"), saveT: null, pendingY: null };
function initReader() {
  $("#rClose").onclick = closeReader;
  $("#rPrev").onclick = () => readerPage(-1);
  $("#rNext").onclick = () => readerPage(1);
  $("#rSmaller").onclick = () => { R.size = Math.max(60, R.size - 10); localSet("rSize", R.size); styleFrame(); };
  $("#rBigger").onclick = () => { R.size = Math.min(260, R.size + 10); localSet("rSize", R.size); styleFrame(); };
  $("#rTheme").onclick = () => { R.theme = { light: "sepia", sepia: "dark", dark: "light" }[R.theme] || "light"; localSet("rTheme", R.theme); applyReaderTheme(); styleFrame(); };
  $("#rExternal").onclick = () => R.id && openExternal(R.id);
  $("#rToc").onchange = (e) => { const [i, frag] = e.target.value.split("#"); loadChapter(+i, 0, frag); };
  $("#rFrame").addEventListener("load", onFrameLoad);
}
function applyReaderTheme() { const r = $("#reader"); r.classList.toggle("sepia", R.theme === "sepia"); r.classList.toggle("dark", R.theme === "dark"); }
async function openReader(id) {
  await autoSave();
  let info;
  try { info = await api("GET", `/api/books/${id}/ebook`); } catch (e) { return; }
  if (!info.path) return toast(t("Kein eBook hinterlegt."), true);
  if (!info.exists) return toast(t("eBook-Datei nicht gefunden") + ": " + info.path, true);
  Object.assign(R, { id, info, idx: 0, pendingY: null });
  const rd = $("#reader"), fr = $("#rFrame"), msg = $("#rMsg");
  rd.classList.remove("hidden"); applyReaderTheme();
  $("#rTitle").textContent = info.title || info.path.split(/[\\/]/).pop();
  $("#rExternal").classList.toggle("hidden", !info.can_open);
  msg.classList.add("hidden"); fr.classList.remove("hidden");
  const paged = info.kind === "epub" || info.kind === "cbz";
  for (const id2 of ["#rToc", "#rPrev", "#rNext"]) $(id2).classList.toggle("hidden", !(paged || info.kind === "text" || info.kind === "html"));
  $("#rToc").classList.toggle("hidden", !paged);
  for (const id2 of ["#rSmaller", "#rBigger", "#rTheme"]) $(id2).classList.toggle("hidden", info.kind === "pdf" || !info.kind);
  $("#rPos").textContent = "";
  history.replaceState(null, "", `#read=${id}`);
  let pos = {};
  try { pos = JSON.parse(info.position || "{}") || {}; } catch (e) { pos = {}; }
  if (paged) {
    const toc = $("#rToc"); toc.innerHTML = "";
    if (info.toc?.length) {
      for (const x of info.toc) {
        const i = info.spine.indexOf(x.href);
        if (i >= 0) toc.append(h("option", { value: i + (x.frag ? "#" + x.frag : "") }, " ".repeat(x.depth * 2) + x.label));
      }
    }
    if (!toc.options.length) info.spine.forEach((s, i) => toc.append(h("option", { value: String(i) }, (info.kind === "cbz" ? t("Seite") : t("Kapitel")) + " " + (i + 1))));
    if (!info.spine.length) return readerMessage(t("Dieses eBook enthält keine lesbaren Kapitel."));
    loadChapter(Math.min(+(pos.i || 0), info.spine.length - 1), pos.y || 0);
  } else if (info.kind === "pdf") {
    fr.removeAttribute("sandbox");
    fr.src = `/api/books/${id}/ebook/file`;
  } else if (info.kind === "text" || info.kind === "html") {
    fr.setAttribute("sandbox", "allow-same-origin allow-downloads");
    R.pendingY = pos.y || 0;
    fr.src = info.kind === "text" ? `/api/books/${id}/ebook/text` : `/api/books/${id}/ebook/file`;
  } else {
    readerMessage(t("Das Format {fmt} kann nicht direkt angezeigt werden.", { fmt: (info.ext || "?").toUpperCase() }), true);
  }
}
function readerMessage(text, offerExternal) {
  const fr = $("#rFrame"), msg = $("#rMsg");
  fr.classList.add("hidden"); fr.removeAttribute("src");
  msg.innerHTML = "";
  msg.append(h("div", {}, h("p", {}, text), offerExternal && R.info?.can_open ? h("button", { cls: "primary", onclick: () => openExternal(R.id) }, t("Mit Standardprogramm öffnen")) : "",
    " ", h("a", { href: `/api/books/${R.id}/ebook/file?download=1` }, t("Herunterladen"))));
  msg.classList.remove("hidden");
}
const zipUrl = (id, member) => `/api/books/${id}/ebook/z/` + member.split("/").map(encodeURIComponent).join("/");
function loadChapter(i, y = 0, frag) {
  const info = R.info; if (!info || i < 0 || i >= info.spine.length) return;
  const fr = $("#rFrame");
  fr.setAttribute("sandbox", "allow-same-origin allow-downloads");
  R.idx = i; R.pendingY = frag ? null : y;
  fr.src = zipUrl(R.id, info.spine[i]) + (frag ? "#" + encodeURIComponent(frag) : "");
  updateReaderPos();
}
function frameDoc() { try { return $("#rFrame").contentDocument; } catch (e) { return null; } }
function onFrameLoad() {
  if (!R.info || $("#reader").classList.contains("hidden")) return;
  const doc = frameDoc(); if (!doc) return;
  // Kapitelwechsel über Links im Buch erkennen
  if (R.info.spine?.length) {
    const p = decodeURIComponent(($("#rFrame").contentWindow.location.pathname || "").split("/ebook/z/")[1] || "");
    const i = R.info.spine.indexOf(p);
    if (i >= 0) R.idx = i;
  }
  styleFrame();
  const se = doc.scrollingElement || doc.documentElement;
  if (R.pendingY != null) {
    const y = R.pendingY; R.pendingY = null;
    requestAnimationFrame(() => { se.scrollTop = y < 0 ? se.scrollHeight : y * se.scrollHeight; updateReaderPos(); });
  }
  doc.addEventListener("keydown", readerKeys);
  doc.addEventListener("scroll", () => { updateReaderPos(); clearTimeout(R.saveT); R.saveT = setTimeout(saveReaderPos, 800); }, { passive: true });
  doc.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (/^(https?:|mailto:)/i.test(href)) { e.preventDefault(); if (/^https?:/i.test(href)) api("POST", "/api/open", { url: href }).then(() => toast(t("Im Browser geöffnet"))); }
  });
  updateReaderPos();
  saveReaderPos();
}
function styleFrame() {
  const doc = frameDoc(); if (!doc || !doc.documentElement || R.info?.kind === "pdf") return;
  let st = doc.getElementById("bl-reader-style");
  if (!st) { st = doc.createElementNS("http://www.w3.org/1999/xhtml", "style"); st.id = "bl-reader-style"; (doc.head || doc.documentElement).append(st); }
  const col = { light: ["#ffffff", "#1f1f1f", "#2a5d8f"], sepia: ["#f6efdf", "#3b3022", "#7a4b19"], dark: ["#1d1d1d", "#dcdcdc", "#8fb8e0"] }[R.theme] || ["#fff", "#111", "#25c"];
  const cbz = R.info?.kind === "cbz";
  st.textContent = cbz
    ? `html,body{margin:0;background:${col[0]}!important;height:100%}img{display:block;margin:auto;max-width:100%;max-height:100vh;object-fit:contain}`
    : `html{background:${col[0]}!important;color:${col[1]}!important}
       body{font-size:${R.size}%!important;line-height:1.6!important;max-width:44em!important;margin:0 auto!important;padding:1.2em 1.4em 3em!important;background:transparent!important;color:inherit!important;word-wrap:break-word}
       body *{color:inherit!important;background-color:transparent!important}
       a,a *{color:${col[2]}!important}
       img,svg,video{max-width:100%!important;height:auto!important}
       pre{white-space:pre-wrap}`;
}
function updateReaderPos() {
  const doc = frameDoc(); const info = R.info; if (!info) return;
  let pct = "";
  if (doc && doc.documentElement) {
    const se = doc.scrollingElement || doc.documentElement;
    const max = se.scrollHeight - se.clientHeight;
    pct = max > 0 ? Math.round((se.scrollTop / max) * 100) + " %" : "";
  }
  if (info.spine?.length) {
    $("#rPos").textContent = `${info.kind === "cbz" ? t("Seite") : t("Kapitel")} ${R.idx + 1} / ${info.spine.length}` + (pct && info.kind !== "cbz" ? " · " + pct : "");
    const toc = $("#rToc");
    let best = null;
    for (const o of toc.options) { const i = +o.value.split("#")[0]; if (i <= R.idx) best = o; }
    if (best) toc.value = best.value;
  } else $("#rPos").textContent = pct;
}
function saveReaderPos() {
  if (!R.id || !R.info || R.info.kind === "pdf") return;
  const doc = frameDoc(); if (!doc || !doc.documentElement) return;
  const se = doc.scrollingElement || doc.documentElement;
  const y = se.scrollHeight ? +(se.scrollTop / se.scrollHeight).toFixed(4) : 0;
  api("PUT", `/api/books/${R.id}/ebook/position`, { position: JSON.stringify({ i: R.idx, y }) }).catch(() => {});
}
function readerPage(d) {
  const info = R.info; if (!info) return;
  const doc = frameDoc();
  const se = doc && (doc.scrollingElement || doc.documentElement);
  if (info.kind === "cbz" || !se) { loadChapter(R.idx + d, d < 0 && info.kind !== "cbz" ? -1 : 0); return; }
  const max = se.scrollHeight - se.clientHeight;
  if (d > 0 && se.scrollTop >= max - 2) { if (info.spine && R.idx < info.spine.length - 1) loadChapter(R.idx + 1, 0); return; }
  if (d < 0 && se.scrollTop <= 2) { if (info.spine && R.idx > 0) loadChapter(R.idx - 1, -1); return; }
  se.scrollBy({ top: d * (se.clientHeight - 48), behavior: "smooth" });
}
function readerKeys(e) {
  if (e.key === "Escape") { e.preventDefault(); closeReader(); }
  else if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) { e.preventDefault(); readerPage(1); }
  else if (e.key === "ArrowLeft" || e.key === "PageUp" || (e.key === " " && e.shiftKey)) { e.preventDefault(); readerPage(-1); }
  else if (e.key === "+" ) { $("#rBigger").click(); }
  else if (e.key === "-") { $("#rSmaller").click(); }
}
function closeReader() {
  saveReaderPos();
  $("#reader").classList.add("hidden");
  const fr = $("#rFrame"); fr.removeAttribute("src"); fr.setAttribute("sandbox", "allow-same-origin allow-downloads");
  R.info = null;
  history.replaceState(null, "", S.book ? `#book=${S.book.id}` : "#tab=all");
}

// ------------------------------------------------------------ Mitwirkende
async function loadPersons() {
  const q = $("#personQ").value || "";
  const rows = await api("GET", "/api/persons?q=" + encodeURIComponent(q));
  const ul = $("#personList");
  ul.innerHTML = rows.map((p) => `<li data-id="${p.id}" class="${p.id === S.personSel ? "sel" : ""}"><span>${esc(p.sort_name || p.display_name)}</span><span class="n">${p.books}</span></li>`).join("") || `<li class="empty-slot">${esc(t("keine Treffer"))}</li>`;
  ul.onclick = (e) => { const li = e.target.closest("li[data-id]"); if (li) selectPerson(+li.dataset.id); };
  $("#personQ").oninput = debounce(loadPersons, 250);
  $("#personNew").title = t("Neuer Mitwirkender");
  $("#personNew").onclick = async () => { const n = await prompt2(t("Neuer Mitwirkender"), t("Name (z.B. „Nachname, Vorname“):")); if (n) { const p = await api("POST", "/api/persons", { display_name: n }); S.personsCache = null; await loadPersons(); selectPerson(p.id); } };
  if (!S.personSel && rows.length) S.personSel = rows[0].id;
  if (S.personSel) selectPerson(S.personSel, true);
}
function debounce(fn, ms) { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; }
async function selectPerson(id, keepList) {
  S.personSel = id;
  $$("#personList li").forEach((li) => li.classList.toggle("sel", +li.dataset.id === id));
  let p;
  try { p = await api("GET", "/api/persons/" + id); } catch (e) { $("#personDetail").innerHTML = `<div class="empty">${esc(t("Mitwirkenden auswählen."))}</div>`; return; }
  const box = $("#personDetail"); box.innerHTML = "";
  const img = h("div", { cls: "pimg", title: t("Bild hochladen (klicken) oder hierher ziehen") }, p.has_image ? h("img", { src: `/api/persons/${id}/image?t=${Date.now()}`, alt: "" }) : h("span", {}, t("Kein Bild"), h("br"), t("klicken zum Hochladen")));
  const file = h("input", { type: "file", accept: "image/*", hidden: true });
  const up = async (f) => { const data = await downscale(f, 500); await api("PUT", `/api/persons/${id}/image`, data, true); selectPerson(id); };
  img.onclick = () => file.click(); file.onchange = () => file.files[0] && up(file.files[0]);
  img.ondragover = (e) => e.preventDefault(); img.ondrop = (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) up(e.dataTransfer.files[0]); };
  const sn = h("input", { value: p.sort_name || "" }), dn = h("input", { value: p.display_name || "" });
  const bio = h("textarea", { rows: 10 }); bio.value = p.biography || "";
  const al = h("textarea", { rows: 4, placeholder: t("eine Schreibweise pro Zeile") }); al.value = p.aliases.join("\n");
  box.append(h("div", { cls: "personhead" }, img, file, h("div", { cls: "form", style: "flex:1" },
    h("div", { cls: "f" }, h("label", {}, t("Nachname, Vorname")), sn),
    h("div", { cls: "f" }, h("label", {}, t("Anzeigename")), dn),
    h("div", { cls: "f full" }, h("label", {}, t("Biographie")), bio),
    h("div", { cls: "f full" }, h("label", {}, t("Weitere Schreibweisen (werden beim Zuordnen erkannt)")), al))));
  box.append(h("div", { cls: "cardbtns", style: "margin:10px 0" },
    p.has_image ? h("button", { type: "button", onclick: async () => { await api("DELETE", `/api/persons/${id}/image`); selectPerson(id); } }, t("Bild entfernen")) : "",
    h("button", { type: "button", title: t("Doppelte Einträge/Schreibfehler bereinigen"), onclick: () => mergePerson(p) }, t("Zusammenführen mit …")),
    h("button", { type: "button", cls: "danger", onclick: async () => {
      if (!(await confirmDlg(t("Mitwirkenden löschen"), t("„{name}“ inkl. Bild überall löschen? Die Bücher bleiben erhalten.", { name: p.display_name })))) return;
      await api("DELETE", "/api/persons/" + id); S.personSel = null; S.personsCache = null; loadPersons(); box.innerHTML = "";
    } }, t("Löschen")),
    h("button", { type: "button", cls: "primary", onclick: async () => {
      await api("PUT", "/api/persons/" + id, { sort_name: sn.value, display_name: dn.value, biography: bio.value, aliases: al.value.split("\n") });
      S.personsCache = null; toast(t("Gespeichert")); if (!keepList) loadPersons();
    } }, t("Speichern"))));
  box.append(h("h3", {}, t("Bücher ({n})", { n: p.books.length })));
  const tbl = h("table", { cls: "grid" }, h("thead", {}, h("tr", {}, h("th", {}, t("Titel")), h("th", {}, t("Rolle")), h("th", {}, t("Datum")))));
  const tb = h("tbody");
  for (const b of p.books) tb.append(h("tr", { style: "cursor:pointer", ondblclick: () => openBook(b.id), onclick: () => openBook(b.id) }, h("td", {}, b.title || ""), h("td", {}, t(b.role || "")), h("td", {}, b.pub_date || "")));
  tbl.append(tb); box.append(tbl);
}
async function mergePerson(p) {
  const all = (await personsAll()).filter((x) => x.id !== p.id);
  const sel = h("select", { style: "width:100%" }, ...all.map((x) => h("option", { value: x.id }, x.sort_name || x.display_name)));
  const r = await dialog(t("Zusammenführen"), h("div", {}, h("p", {}, t("„{name}“ wird gelöscht; Bücher und Schreibweisen gehen über auf:", { name: p.sort_name || p.display_name })), sel));
  if (!r) return;
  const np = await api("POST", `/api/persons/${p.id}/merge/${sel.value}`);
  S.personsCache = null; S.personSel = np.id; loadPersons(); toast(t("Zusammengeführt"));
}

// ------------------------------------------------------------ Listen-Ordner
function bookTable(rows, cols, opts = {}) {
  if (!rows.length) return h("p", { cls: "empty" }, opts.empty || t("Keine Einträge."));
  const tbl = h("table", { cls: "grid" });
  tbl.append(h("thead", {}, h("tr", {}, ...cols.map((c) => h("th", {}, c[1])))));
  const tb = h("tbody");
  for (const r of rows) {
    const tr = h("tr", { style: "cursor:pointer", title: t("Doppelklick öffnet das Buch"), ondblclick: () => openBook(r.book_id), class: opts.rowCls ? opts.rowCls(r) : null });
    for (const c of cols) tr.append(h("td", { title: String(r[c[0]] ?? "") }, c[2] ? c[2](r) : String(r[c[0]] ?? "")));
    tb.append(tr);
  }
  tbl.append(tb);
  return h("div", { cls: "tablewrap" }, tbl);
}
const stars = (n) => n ? "★".repeat(n) + "☆".repeat(5 - n) : "";
async function loadReading() {
  const rows = await api("GET", "/api/lists/reviews");
  const v = $("#readingView"); v.innerHTML = "";
  const years = [...new Set(rows.map((r) => (r.date || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  const ys = h("select", {}, h("option", { value: "" }, t("alle Jahre")), ...years.map((y) => h("option", {}, y)));
  const body = h("div");
  const draw = () => { body.innerHTML = ""; const f = rows.filter((r) => !ys.value || (r.date || "").startsWith(ys.value)); body.append(h("p", { cls: "info" }, t("{n} gelesene Bücher / Rezensionen", { n: nf(f.length) })), bookTable(f, [["date", t("Datum"), (r) => fmtDate(r.date)], ["author", t("Autor")], ["title", t("Titel")], ["rating", t("Bewertung"), (r) => stars(r.rating)], ["summary", t("Zusammenfassung")]], { empty: t("Noch keine Lesevermerke. Im Buch unter „Rezensionen“ (Alt+R) anlegen.") })); };
  ys.onchange = draw;
  v.append(h("div", { cls: "toolbar" }, h("h2", {}, t("Lesehistorie")), h("div", { cls: "spacer" }), ys), body);
  draw();
}
async function loadLoansView() {
  const rows = await api("GET", "/api/lists/loans");
  const sales = await api("GET", "/api/lists/sales");
  const td = today();
  const v = $("#loansView"); v.innerHTML = "";
  const open = rows.filter((r) => !r.return_date);
  v.append(h("div", { cls: "toolbar" }, h("h2", {}, t("Verleih")), h("span", { cls: "info" }, t("{n} Bücher unterwegs, {m} überfällig", { n: open.length, m: open.filter((r) => r.due_date && r.due_date < td).length }))));
  v.append(bookTable(rows, [["borrower", t("Leihnehmer")], ["title", t("Titel")], ["author", t("Autor")], ["loan_date", t("verliehen am"), (r) => fmtDate(r.loan_date)], ["due_date", t("Rückgabe bis"), (r) => (r.due_date && !r.return_date && r.due_date < td ? "⚠ " : "") + fmtDate(r.due_date)], ["return_date", t("zurück am"), (r) => fmtDate(r.return_date)], ["remind", t("mahnen")],
    ["id", "", (r) => r.return_date ? "" : h("button", { onclick: async (e) => { e.stopPropagation(); await api("PUT", "/api/sub/loans/" + r.id, { return_date: today() }); loadLoansView(); loadBooks(); } }, t("zurückgegeben"))]],
  { empty: t("Keine Verleihvorgänge."), rowCls: (r) => (!r.return_date ? "loaned" : "") }));
  v.append(h("h3", {}, t("Verkauf / Erwerb")), bookTable(sales, [["title", t("Titel")], ["author", t("Autor")], ["acquired", t("erworben"), (r) => fmtDate(r.acquired)], ["purchase_price", t("Einkauf")], ["sale_place", t("Verkaufsort")], ["sale_price", t("Verkaufspreis")], ["buyer", t("Käufer")]], { empty: t("Keine Einträge.") }));
}
async function loadWishView() {
  const rows = await api("GET", "/api/lists/wishlist");
  const v = $("#wishView"); v.innerHTML = "";
  v.append(h("div", { cls: "toolbar" }, h("h2", {}, t("Wunschliste")), h("span", { cls: "info" }, t("{n} Bücher", { n: rows.length })), h("div", { cls: "spacer" }),
    h("button", { onclick: async () => { const blob = await api("POST", "/api/export/html", { ids: rows.map((r) => r.book_id), title: t("Wunschliste"), lang: LANG }); download(blob, "wunschliste.html"); } }, t("Als HTML-Liste exportieren"))));
  const shops = [1, 2, 3].map((i) => [S.meta.settings[`shop${i}_name`], S.meta.settings[`shop${i}_url`]]).filter((s) => s[0] && s[1]);
  v.append(bookTable(rows, [["rank", t("Rang")], ["author", t("Autor")], ["title", t("Titel")], ["list_price", t("Preis")], ["reason", t("Grund")],
    ["isbn", t("Suchen"), (r) => h("span", { cls: "links" }, ...[["Booklooker", "https://www.booklooker.de/B%C3%BCcher/Angebote/isbn="], ...shops].map(([n, u]) => h("a", { href: u + encodeURIComponent(r.isbn || r.title), target: "_blank", rel: "noopener noreferrer" }, n)))]],
  { empty: t("Die Wunschliste ist leer. Bücher im Ordner „Ein Buch“ → „Verleih / Verkauf“ auf die Wunschliste setzen.") }));
}
async function loadQuotesView() {
  const [quotes, kws] = await Promise.all([api("GET", "/api/lists/quotes"), api("GET", "/api/lists/keywords")]);
  const v = $("#quotesView"); v.innerHTML = "";
  v.append(h("h2", {}, t("Schlagwörter")));
  const cloud = h("div", { cls: "chips", style: "margin:8px 0 18px" });
  for (const k of kws) cloud.append(h("span", { cls: "chip", title: t("Bücher mit diesem Schlagwort anzeigen"), onclick: () => { S.q = k.keyword; S.fields = ["Schlagwort"]; $("#q").value = k.keyword; S.sort = "author"; S.dir = "asc"; loadBooks(); showTab("all"); } }, `${k.keyword} (${k.n})`));
  if (!kws.length) cloud.append(h("span", { cls: "hint" }, t("Noch keine Schlagwörter – im Buch unter „Lesen & Bewerten“ eintragen.")));
  v.append(cloud, h("h2", {}, t("Zitate & Anmerkungen")));
  v.append(bookTable(quotes, [["category", t("Beschreibung")], ["text", t("Zitat")], ["title", t("Buch")], ["author", t("Autor")], ["date", t("Datum"), (r) => fmtDate(r.date)]], { empty: t("Noch keine Zitate.") }));
}

// ------------------------------------------------------------ Gruppen
async function loadGroups() {
  await loadMeta();
  const ul = $("#groupList");
  ul.innerHTML = S.meta.groups.map((g) => `<li data-id="${g.id}" class="${g.id === S.groupSel ? "sel" : ""} ${g.name ? "" : "empty-slot"}"><span>${g.id}: ${esc(g.name || t("(frei)"))}</span><span class="n">${g.name ? g.members : ""}</span></li>`).join("");
  ul.onclick = (e) => { const li = e.target.closest("li[data-id]"); if (li) selectGroup(+li.dataset.id); };
  if (S.groupSel != null) selectGroup(S.groupSel);
}
async function selectGroup(id) {
  S.groupSel = id;
  $$("#groupList li").forEach((li) => li.classList.toggle("sel", +li.dataset.id === id));
  const g = await api("GET", "/api/groups/" + id);
  const box = $("#groupDetail"); box.innerHTML = "";
  const name = h("input", { value: g.name || "", placeholder: t("Gruppenbeschreibung, z.B. „Inhalt Regal 10“"), style: "flex:1" });
  name.onchange = async () => { await api("PUT", "/api/groups/" + id, { name: name.value }); loadGroups(); };
  const show = async (mode) => { S.group = String(id); S.gmode = mode; $("#groupMode").value = mode; await loadMeta(); $("#groupFilter").value = String(id); await loadBooks(); showTab("all"); };
  box.append(h("div", { cls: "row" }, h("strong", {}, `${t("Gruppe")} ${id}`), name));
  box.append(h("div", { cls: "toolbar", style: "margin-top:10px" },
    h("button", { cls: "primary", onclick: async () => { const r = await api("POST", `/api/groups/${id}/apply`, { view_ids: S.books.map((b) => b.id) }); toast(t("{n} Bücher in der Gruppe", { n: r.members })); selectGroup(id); loadMeta(); } }, t("Anwenden / wiederholen")),
    h("button", { onclick: () => show("show") }, t("Gruppe anzeigen")),
    h("button", { onclick: () => show("highlight"), title: t("Alle Bücher zeigen, Gruppe hervorheben; Mitgliedschaft per Klick umschalten") }, t("Hervorheben")),
    h("button", { onclick: () => addActionDialog(id) }, t("+ Aktion hinzufügen")),
    h("div", { cls: "spacer" }),
    h("button", { onclick: async () => { const n = await prompt2(t("Gruppe kopieren"), t("Auf Gruppe Nr. (0–30, muss leer sein):")); if (n !== null && n !== "") { await api("POST", `/api/groups/${id}/copy/${+n}`); loadGroups(); } } }, t("Kopieren")),
    h("button", { onclick: async () => { const n = await prompt2(t("Reihenfolge tauschen"), t("Tauschen mit Gruppe Nr. (0–30):")); if (n !== null && n !== "" && +n >= 0 && +n <= 30) { await api("POST", `/api/groups/${id}/swap/${+n}`); S.groupSel = +n; loadGroups(); } } }, t("Tauschen")),
    h("button", { cls: "danger", onclick: async () => { if (await confirmDlg(t("Gruppe löschen"), t("Gruppe mit allen Aktionen und Mausklicks löschen?"))) { await api("DELETE", "/api/groups/" + id); loadGroups(); } } }, t("Löschen"))));
  box.append(h("p", { cls: "info" }, t("{n} Bücher in der Gruppe", { n: g.members }) + (g.manual ? ", " + t("{n} per Mausklick gesetzt", { n: g.manual }) : "")));
  const actions = S.meta.group_actions;
  const tbl = h("table", { cls: "grid" }, h("thead", {}, h("tr", {}, ...[t("Nr"), t("Art"), t("Aktion"), t("Suchfeld"), t("Option"), t("Anzahl"), "Moves", "ms", ""].map((x) => h("th", {}, x)))));
  const tb = h("tbody");
  for (const a of g.actions) {
    const info = actions.find((x) => x.code === a.action) || { art: "?", label: `${t("Aktion")} ${a.action}` };
    const nr = h("input", { type: "number", value: a.nr, style: "width:64px" });
    const opt = h("input", { value: a.option || "", style: "width:100%" });
    const upd = () => api("PUT", "/api/group_actions/" + a.id, { nr: nr.value, option: opt.value });
    nr.onchange = upd; opt.onchange = upd;
    const desc = t(info.label) + (a.property_bit != null ? ` „${propName(a.property_bit) || "Bit " + a.property_bit}“` : "");
    tb.append(h("tr", {}, h("td", {}, nr), h("td", { cls: "arts" }, info.art), h("td", { title: desc, style: "white-space:normal" }, desc),
      h("td", {}, info.extra === "search" ? t(a.field || "") : ""), h("td", {}, info.extra === "search" ? opt : ""),
      h("td", {}, a.count ?? ""), h("td", {}, a.moves ?? ""), h("td", {}, a.ms ?? ""),
      h("td", {}, h("button", { cls: "danger", title: t("Aktion löschen"), onclick: async () => { await api("DELETE", "/api/group_actions/" + a.id); selectGroup(id); } }, "×"))));
  }
  tbl.append(tb);
  box.append(g.actions.length ? h("div", { cls: "tablewrap" }, tbl) : h("p", { cls: "empty" }, t("Noch keine Aktionen. Beginnen Sie z.B. mit „Nimm alle Bücher“ (=) und schränken Sie dann ein (*, -).")));
  box.append(h("p", { cls: "hint", style: "margin-top:10px" }, t("Art: = Anfangsmenge · + hinzufügen · - entfernen · * nur Treffer behalten · ± Mausklicks · E Eigenschaften setzen. Reihenfolge über die Spalte Nr.")));
}
async function addActionDialog(gid) {
  const sel = h("select", { style: "width:100%" }, ...S.meta.group_actions.map((a) => h("option", { value: a.code }, `${a.art}  ${t(a.label)}`)));
  const fld = h("select", {}, ...S.meta.search_fields.map((f) => h("option", { value: f.label }, t(f.label))));
  const opt = h("input", { placeholder: t("Suchbegriff") });
  const prop = h("select", {}, ...S.meta.properties.filter((p) => p.name).map((p) => h("option", { value: p.bit }, t(p.name))));
  const xs = h("div", { cls: "row" }, fld, opt), xp = h("div", { cls: "row" }, h("span", {}, t("Eigenschaft:")), prop);
  const upd = () => { const a = S.meta.group_actions.find((x) => x.code === +sel.value); xs.classList.toggle("hidden", a.extra !== "search"); xp.classList.toggle("hidden", a.extra !== "property"); };
  sel.onchange = upd; upd();
  if (!(await dialog(t("Aktion hinzufügen"), h("div", {}, sel, h("div", { style: "height:10px" }), xs, xp)))) return;
  const a = S.meta.group_actions.find((x) => x.code === +sel.value);
  await api("POST", `/api/groups/${gid}/actions`, { action: a.code, field: a.extra === "search" ? fld.value : null, option: a.extra === "search" ? opt.value : null, property_bit: a.extra === "property" ? +prop.value : null });
  await loadGroups();
}

// ------------------------------------------------------------ Statistik
async function loadStats() {
  const s = await api("GET", "/api/stats");
  const v = $("#statsView"); v.innerHTML = "";
  const kpi = (val, l) => h("div", { cls: "kpi" }, h("div", { cls: "v" }, val), h("div", { cls: "l" }, l));
  const cur = S.meta.settings.currency || "EUR";
  let money; try { money = s.value.toLocaleString(locale(), { style: "currency", currency: cur }); } catch (e) { money = nf(s.value); }
  v.append(h("div", { cls: "kpis" }, kpi(nf(s.books), t("Bücher")), kpi(nf(s.read), t("gelesen")), kpi(nf(s.pages), t("Seiten gesamt")),
    kpi(money, t("Listenpreis gesamt (ca.)")),
    kpi(nf(s.persons), t("Mitwirkende")), kpi(nf(s.loaned), t("verliehen")), kpi(nf(s.wishlist), t("auf Wunschliste")), kpi(nf(s.ebooks), "eBooks")));
  const bars = (title, rows, tr) => {
    const max = Math.max(1, ...rows.map((r) => r.n));
    const g = h("div", { cls: "bars" });
    for (const r of rows) { const k = r.k === "(leer)" || tr ? t(r.k) : r.k; g.append(h("span", { cls: "k", title: k }, k), h("span", { cls: "t", title: `${k}: ${r.n}` }, h("i", { style: `width:${(r.n / max) * 100}%` })), h("span", { cls: "n" }, nf(r.n))); }
    return h("div", { cls: "chart panel" }, h("h4", {}, title), rows.length ? g : h("p", { cls: "hint" }, t("keine Daten")));
  };
  const cols = (title, rows) => {
    const max = Math.max(1, ...rows.map((r) => r.n));
    const c = h("div", { cls: "cols", role: "img", "aria-label": title });
    for (const r of rows) c.append(h("i", { title: `${r.k}: ${r.n}`, style: `height:${(r.n / max) * 100}%` }));
    return h("div", { cls: "chart panel" }, h("h4", {}, title), rows.length ? h("div", {}, c, h("div", { cls: "colaxis" }, h("span", {}, rows[0].k), h("span", {}, rows[rows.length - 1].k))) : h("p", { cls: "hint" }, t("keine Daten")));
  };
  v.append(h("div", { cls: "charts" }, bars(t("Klassifikation"), s.by_class), bars(t("Häufigste Autoren"), s.top_authors), bars(t("Bindung"), s.by_binding),
    bars(label("location", "Standort"), s.by_location), bars(t("Sprache"), s.by_language), bars(t("Lesestatus"), s.by_status, true),
    cols(t("Bücher nach Erscheinungsjahr"), s.by_year), cols(t("Gelesen pro Jahr (Lesehistorie)"), s.reading_per_year)));
}

// ------------------------------------------------------------ Werkzeug
const LABEL_DEFAULTS = { "label.series": "Reihe", "label.book_type": "Buchart", "label.location": "Standort", "label.topic": "Thema", "label.translator": "Übersetzer", "label.original_title": "Originaltitel", "label.original_language": "Originalsprache", "label.first_published": "Ersterscheinung" };
async function loadTools() {
  await loadMeta();
  const v = $("#toolsView"); v.innerHTML = "";
  const st = S.meta.settings;
  const kv = (o) => Object.entries(o).map(([k, n]) => `${t(k)}: ${typeof n === "number" ? nf(n) : n}`).join("\n");

  // Import Buchliebhaber
  const path = h("input", { type: "text", value: localGet("importPath", "C:\\Buchliebhaber") });
  const mode = h("select", {}, h("option", { value: "merge" }, t("zusammenführen (vorhandene Bücher behalten)")), h("option", { value: "replace" }, t("ersetzen (Datenbank leeren, Nummern übernehmen)")));
  const skip = h("input", { type: "checkbox", checked: true });
  const out = h("div", { cls: "result hidden" });
  const show = (o) => { out.classList.remove("hidden"); out.textContent = typeof o === "string" ? o : kv(o); };
  const zip = h("input", { type: "file", accept: ".zip", hidden: true });
  zip.onchange = async () => { const f = zip.files[0]; if (!f) return; show(t("Import läuft …")); const r = await api("POST", `/api/import/upload/zip?mode=${mode.value}&skip=${skip.checked ? 1 : 0}`, f, true); show(r); afterImport(); zip.value = ""; };
  v.append(h("div", { cls: "panel" }, h("h3", {}, t("Buchliebhaber-Datenbank importieren")),
    h("p", { cls: "hint" }, t("Ordner der Buchliebhaber-Installation (enthält WORK und PRIV), den WORK-Ordner selbst oder ein Backup-ZIP (z.B. C:\\backup\\20240101_1200_BLH_W.zip – zugehörige ZIPs werden automatisch mitgelesen). Übernommen werden Bücher, Cover, Mitwirkende inkl. Bilder und Biographien, Inhalte, Rezensionen, Verleih, Verkauf, Wunschliste, Web/Ablage, Schlagwörter, Zitate, Eigenschaften, Gruppen, Signaturen und Auswahllisten. Ablage-Einträge, die auf eBook-Dateien zeigen, werden als eBook-Pfad übernommen.")),
    h("div", { cls: "row" }, path,
      h("button", { type: "button", title: t("Ordner wählen"), onclick: async () => { const d = await fileDialog({ start: path.value, dirMode: true }); if (d) path.value = d; } }, "📂"),
      h("button", { onclick: async () => { localSet("importPath", path.value); show(t("Lese …")); const r = await api("POST", "/api/import/preview", { path: path.value }); show(`${t("Gefunden:")} ${r.work}\n` + r.tables.map((x) => `${t(x.label)}: ${typeof x.records === "number" ? nf(x.records) : x.records}`).join("\n") + `\n${t("Cover-Dateien:")} ${nf(r.covers)}\n${t("Autorenbilder:")} ${nf(r.author_images)}`); } }, t("Vorschau"))),
    h("div", { cls: "row" }, mode), h("label", { cls: "row" }, skip, t("Dubletten überspringen (gleiche ISBN/EAN oder gleicher Autor+Titel)")),
    h("div", { cls: "row" }, h("button", { cls: "primary", onclick: async () => {
      localSet("importPath", path.value);
      if (mode.value === "replace" && !(await confirmDlg(t("Datenbank ersetzen"), t("Alle vorhandenen Bücher in Buchlover werden gelöscht und durch den Import ersetzt. Fortfahren?")))) return;
      show(t("Import läuft …")); const r = await api("POST", "/api/import/blh", { path: path.value, mode: mode.value, skip_duplicates: skip.checked }); show(r); afterImport();
    } }, t("Importieren")), h("button", { onclick: () => zip.click() }, t("Backup-ZIP hochladen …")), zip), out));

  // eBook-Bibliothek
  const edirs = h("textarea", { rows: 3, style: "width:100%", placeholder: t("ein Ordner pro Zeile, z.B. C:\\Users\\Name\\Documents\\eBooks") });
  edirs.value = (st.ebook_dirs || "").split(/[;\n]/).filter(Boolean).join("\n");
  const eOut = h("div", { cls: "result hidden" });
  const create = h("input", { type: "checkbox" });
  let lastScan = null;
  const saveDirs = async () => { await api("PUT", "/api/settings", { ebook_dirs: edirs.value.split("\n").map((x) => x.trim()).filter(Boolean).join(";") }); await loadMeta(); };
  const scan = async (apply) => {
    await saveDirs();
    eOut.classList.remove("hidden"); eOut.textContent = t("Suche läuft …");
    const r = await api("POST", "/api/ebooks/scan", { apply, create: apply && create.checked });
    lastScan = r;
    const lines = [`${t("Durchsuchte Ordner:")} ${r.dirs.join(" · ") || "–"}`, `${t("eBook-Dateien gefunden:")} ${nf(r.files)}`,
      `${t("passende Bücher ohne eBook:")} ${nf(r.matched.length)}`, `${t("ohne passendes Buch:")} ${nf(r.unmatched.length)}`];
    if (apply) lines.push("", `${t("verknüpft:")} ${nf(r.linked)}`, `${t("neu angelegt:")} ${nf(r.created)}`);
    else {
      if (r.matched.length) lines.push("", t("Zuordnungen:"), ...r.matched.slice(0, 200).map((x) => `  ${x.author || ""} – ${x.title || ""}  ⇐  ${x.file}`));
      if (r.unmatched.length) lines.push("", t("Ohne passendes Buch:"), ...r.unmatched.slice(0, 200).map((x) => `  ${x.file}`));
    }
    eOut.textContent = lines.join("\n");
    if (apply) afterImport();
  };
  v.append(h("div", { cls: "panel" }, h("h3", {}, t("eBook-Bibliothek")),
    h("p", { cls: "hint" }, t("Ordner mit eBooks (EPUB, PDF, MOBI, AZW3, TXT, CBZ …). „eBook finden“ im Buch sucht hier; der Abgleich ordnet Dateien über ISBN bzw. Titel und Autor den Büchern zu und kann für übrige Dateien neue Bücher mit Metadaten und Cover anlegen.")),
    edirs,
    h("div", { cls: "row wrap", style: "margin-top:6px" },
      h("button", { onclick: async () => { const d = await fileDialog({ start: edirs.value.split("\n")[0] || "", dirMode: true }); if (d) { edirs.value = (edirs.value.trim() ? edirs.value.trim() + "\n" : "") + d; saveDirs(); } } }, "📂 " + t("Ordner hinzufügen …")),
      h("button", { onclick: async () => { await saveDirs(); toast(t("Gespeichert")); } }, t("Speichern")),
      h("button", { onclick: () => scan(false) }, t("Abgleich – Vorschau")),
      h("button", { cls: "primary", onclick: async () => { if (!lastScan && !(await confirmDlg(t("eBooks zuordnen"), t("Ohne Vorschau zuordnen?")))) return; scan(true); } }, t("Zuordnen"))),
    h("label", { cls: "row" }, create, t("eBooks ohne passendes Buch als neue Bücher anlegen (Titel, Autor, ISBN, Verlag, Beschreibung, Cover aus dem EPUB)")),
    eOut));

  // CSV / DBF
  const csvOut = h("div", { cls: "result hidden" });
  const cf = h("input", { type: "file", accept: ".csv,.txt,.dbf" });
  v.append(h("div", { cls: "panel" }, h("h3", {}, t("Import aus Tabellenkalkulation (CSV / DBF)")),
    h("p", { cls: "hint" }, t("Erste Zeile = Spaltenüberschriften. Erkannt werden u.a.: ISBN, EAN, BX, Class, Autor, Titel, Seiten, Verlag, Bindung, Listenpreis, Datum, Originaltitel, Sprache, Reihe, Thema, Standort, Übersetzer, Auflage, Inhalt, Notiz, Lesestatus, Bewertung, eBook. Englische Spaltennamen (Author, Title, Publisher …) werden ebenfalls erkannt. Mindestens ISBN, Autor oder Titel.")),
    h("div", { cls: "row" }, cf, h("button", { cls: "primary", onclick: async () => {
      const f = cf.files[0]; if (!f) return toast(t("Bitte Datei wählen"), true);
      const kind = f.name.toLowerCase().endsWith(".dbf") ? "dbf" : "csv";
      const r = await api("POST", `/api/import/upload/${kind}?skip=1`, f, true);
      csvOut.classList.remove("hidden"); csvOut.textContent = kv(r); afterImport();
    } }, t("Importieren"))), csvOut));

  // Export & Sicherung
  const bOut = h("div", { cls: "result hidden" });
  v.append(h("div", { cls: "panel" }, h("h3", {}, t("Export & Datensicherung")),
    h("p", { cls: "hint" }, t("Datenbank:") + " " + S.meta.db_path),
    h("div", { cls: "row wrap" },
      h("button", { onclick: async () => download(await api("POST", "/api/export/csv", {}), "buchliste.csv") }, t("Alle Bücher als CSV")),
      h("button", { onclick: async () => download(await api("POST", "/api/export/html", { title: t("Bücherliste"), lang: LANG }), "buchliste.html") }, t("Buchliste als HTML")),
      h("button", { cls: "primary", onclick: async () => { const r = await api("POST", "/api/backup"); bOut.classList.remove("hidden"); bOut.textContent = t("Sicherung erstellt:") + "\n" + r.path; } }, t("Backup erstellen"))),
    h("p", { cls: "hint", style: "margin-top:8px" }, t("Das Backup ist eine ZIP-Datei mit der kompletten Datenbank (inkl. Bilder). Zum Wiederherstellen die Datei buchlover.sqlite aus dem ZIP in den data-Ordner kopieren. eBook-Dateien selbst sind nicht enthalten – nur ihre Pfade.")), bOut));

  // Eigenschaften
  const plist = h("div", { cls: "proplist" });
  for (const p of S.meta.properties) plist.append(h("span", {}, p.bit + 1), h("input", { value: p.name || "", "data-bit": p.bit, placeholder: t("(frei)") }));
  v.append(h("div", { cls: "panel" }, h("h3", {}, t("Eigenschaften definieren")),
    h("p", { cls: "hint" }, t("30 frei benennbare Eigenschaften. Je Buch wird die Nummer gespeichert – eine Umbenennung gilt für alle Bücher.")), plist,
    h("div", { cls: "cardbtns", style: "margin-top:8px" }, h("button", { cls: "primary", onclick: async () => {
      await api("PUT", "/api/properties", $$("input[data-bit]", plist).map((i) => ({ bit: +i.dataset.bit, name: i.value })));
      await loadMeta(); toast(t("Eigenschaften gespeichert"));
    } }, t("Speichern")))));

  // Einstellungen
  const setFields = [["owner", t("Name des Buchliebhabers (für Listen)")], ["label.series", t("Bezeichnung Feld „{f}“", { f: t("Reihe") })], ["label.book_type", t("Bezeichnung Feld „{f}“", { f: t("Buchart") })], ["label.location", t("Bezeichnung Feld „{f}“", { f: t("Standort") })], ["label.topic", t("Bezeichnung Feld „{f}“", { f: t("Thema") })], ["label.translator", t("Bezeichnung Feld „{f}“", { f: t("Übersetzer") })], ["label.original_title", t("Bezeichnung Feld „{f}“", { f: t("Originaltitel") })], ["label.original_language", t("Bezeichnung Feld „{f}“", { f: t("Originalsprache") })], ["label.first_published", t("Bezeichnung Feld „{f}“", { f: t("Ersterscheinung") })],
    ["default_language", t("Sprache für neue Bücher")], ["default_role", t("Standard-Rolle neuer Mitwirkender")], ["confirm_delete", t("Löschbestätigung"), "bool"], ["bx_from_author", t("BX automatisch „Nachname, Titel“"), "bool"], ["isbn_autolookup", t("ISBN-Eingabe fragt automatisch ab"), "bool"], ["lookup_overwrite", t("Abfrage überschreibt Felder"), "bool"], ["cover_height", t("max. Coverhöhe in Pixel")], ["currency", t("Währung (ISO-Code, z.B. EUR, USD)")], ["backup_dir", t("Backup-Verzeichnis")],
    ["shop1_name", t("Shop {n} Name", { n: 1 })], ["shop1_url", t("Shop {n} Such-URL (Suchbegriff wird angehängt)", { n: 1 })], ["shop2_name", t("Shop {n} Name", { n: 2 })], ["shop2_url", t("Shop {n} Such-URL (Suchbegriff wird angehängt)", { n: 2 })]];
  const sf = h("div", { cls: "form" });
  for (const [k, l, ty] of setFields) {
    if (ty === "bool") {
      const def = k === "lookup_overwrite" ? "Nein" : "Ja";
      sf.append(h("div", { cls: "f" }, h("label", {}, h("input", { type: "checkbox", "data-k": k, "data-bool": 1, checked: isYes(st[k] ?? def) && (st[k] ?? def) !== "" }), " " + l)));
    } else {
      // unveränderte Standardbezeichnungen in der Oberflächensprache zeigen
      const val = k.startsWith("label.") ? label(k.slice(6), LABEL_DEFAULTS[k]) : (st[k] ?? "");
      sf.append(h("div", { cls: "f" }, h("label", {}, l), h("input", { "data-k": k, value: val })));
    }
  }
  v.append(h("div", { cls: "panel" }, h("h3", {}, t("Einstellungen")), sf,
    h("div", { cls: "cardbtns", style: "margin-top:8px" }, h("button", { cls: "primary", onclick: async () => {
      const val = (i) => i.dataset.bool ? (i.checked ? "Ja" : "Nein")
        : LABEL_DEFAULTS[i.dataset.k] && i.value.trim() === t(LABEL_DEFAULTS[i.dataset.k]) ? LABEL_DEFAULTS[i.dataset.k] : i.value;
      await api("PUT", "/api/settings", Object.fromEntries($$("input[data-k]", sf).map((i) => [i.dataset.k, val(i)])));
      await loadMeta(); toast(t("Einstellungen gespeichert"));
    } }, t("Speichern")))));

  // Auswahllisten
  const names = { role: "Rollen der Mitwirkenden", binding: "Bindung", book_type: "Buchart", language: "Sprache", condition: "Zustand", read_status: "Lesestatus", sale_place: "Verkaufsort", shipping: "Versandart" };
  const psel = h("select", {}, ...Object.entries(names).map(([k, l]) => h("option", { value: k }, t(l))));
  const pta = h("textarea", { rows: 8, style: "width:100%" });
  const fillP = () => (pta.value = (S.meta.picklists[psel.value] || []).join("\n"));
  psel.onchange = fillP; fillP();
  v.append(h("div", { cls: "panel" }, h("h3", {}, t("Auswahllisten")), h("div", { cls: "row" }, psel), pta,
    h("div", { cls: "cardbtns" }, h("button", { cls: "primary", onclick: async () => { await api("PUT", "/api/picklists/" + psel.value, pta.value.split("\n")); await loadMeta(); toast(t("Gespeichert")); } }, t("Speichern")))));

  // Dubletten
  const dOut = h("div");
  v.append(h("div", { cls: "panel" }, h("h3", {}, t("Dublettenprüfung")),
    h("p", { cls: "hint" }, t("Findet Bücher mit gleicher ISBN/EAN oder gleichem Autor + Titel.")),
    h("button", { onclick: async () => {
      const r = await api("GET", "/api/duplicates"); dOut.innerHTML = "";
      if (!r.length) dOut.append(h("p", { cls: "hint" }, t("Keine Dubletten gefunden.")));
      for (const d of r) dOut.append(h("div", { cls: "card" }, h("div", { cls: "info" }, t("gleich:") + " " + t(d.key)), ...d.books.map((b) => h("div", {}, h("a", { href: "#", onclick: (e) => { e.preventDefault(); openBook(b.id); } }, `${t("Nr.")} ${b.id}: ${b.author || ""} – ${b.title || ""}`)))));
    } }, t("Dubletten suchen")), dOut));

  // Signaturen
  if (S.meta.signatures.length) {
    v.append(h("div", { cls: "panel" }, h("h3", {}, t("Signaturen (aus Buchliebhaber übernommen)")),
      h("div", { cls: "result" }, S.meta.signatures.map((s) => `${"  ".repeat(s.level - 1)}${[s.sig1, s.sig2, s.sig3].filter(Boolean).join(" ")}  ${s.name || ""}`).join("\n"))));
  }
  // Version & Updates
  const auto = h("input", { type: "checkbox", checked: isYes(st.update_check) });
  auto.onchange = async () => { await api("PUT", "/api/settings", { update_check: auto.checked ? "Ja" : "Nein" }); await loadMeta(); toast(t("Gespeichert")); };
  const uOut = h("div", { cls: "hint" });
  v.append(h("div", { cls: "panel" }, h("h3", {}, t("Programmversion & Updates")),
    h("p", {}, t("Installierte Version:") + " ", h("strong", {}, S.meta.version)),
    h("label", { cls: "row" }, auto, t("beim Start nach Updates suchen (fragt nur die Versionsnummer bei GitHub ab)")),
    h("div", { cls: "row wrap" }, h("button", { onclick: async () => {
      uOut.textContent = t("Suche läuft …");
      const u = await checkUpdate(true);
      uOut.textContent = !u ? "" : u.newer ? t("Version {new} ist verfügbar – installiert ist {old}.", { new: u.latest, old: u.current }) : t("Buchlover ist aktuell (Version {v}).", { v: u.current });
      if (u?.newer) updateDialog();
    } }, t("Nach Updates suchen")), uOut)));
}
async function afterImport() { S.personsCache = null; await loadMeta(); await loadBooks(); toast(t("Import abgeschlossen")); }

init().catch((e) => { console.error(e); toast(t("Fehler beim Start:") + " " + e.message, true); });
