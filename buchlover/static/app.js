/* Buchlover – Oberfläche (Nachbau "Buchliebhaber") */
"use strict";

// ------------------------------------------------------------ Hilfen
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (s) => { if (!s) return ""; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? `${m[3]}.${m[2]}.${m[1]}` : s; };
const today = () => new Date().toISOString().slice(0, 10);

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
    toast(msg, true);
    throw new Error(msg);
  }
  return ct.includes("json") ? r.json() : r.blob();
}

let toastTimer;
function toast(msg, err) {
  const t = $("#toast");
  t.textContent = msg; t.className = "show" + (err ? " err" : "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ""), err ? 5000 : 2200);
}

/** Dialog: buttons = [{label, value, primary}] -> Promise(value|null) */
function dialog(title, body, buttons = [{ label: "OK", value: "ok", primary: true }, { label: "Abbrechen", value: null }]) {
  const d = $("#dlg");
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
  return (await dialog(title, `<p>${esc(text)}</p>`, [{ label: "Ja", value: true, primary: true }, { label: "Nein", value: null }])) === true;
}
async function prompt2(title, label, value = "") {
  const inp = h("input", { type: "text", value, style: "width:100%" });
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#dlgBtns button").click(); } });
  const r = await dialog(title, h("div", {}, h("label", {}, label), inp));
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
  props: 0, pmode: "any", group: "", gmode: "show", view: localGet("view", "table"),
  bookId: null, book: null, dirty: false, personsCache: null, personSel: null, groupSel: null,
};
function localGet(k, d) { try { return localStorage.getItem("bl." + k) ?? d; } catch (e) { return d; } }
function localSet(k, v) { try { localStorage.setItem("bl." + k, v); } catch (e) { /* */ } }
const label = (k, def) => (S.meta?.settings?.["label." + k]) || def;
const propName = (bit) => S.meta.properties.find((p) => p.bit === bit)?.name;

// ------------------------------------------------------------ Start
async function loadMeta() {
  S.meta = await api("GET", "/api/meta");
  $("#btnQuit").classList.toggle("hidden", S.meta.can_quit === false);
  const gf = $("#groupFilter"); const gv = gf.value; gf.innerHTML = '<option value="">–</option>';
  for (const g of S.meta.groups) if (g.name) gf.append(h("option", { value: g.id }, `${g.id}: ${g.name} (${g.members})`));
  gf.value = gv;
}

function initTheme() {
  const t = localGet("theme", "");
  if (t) document.documentElement.dataset.theme = t;
  $("#btnTheme").onclick = () => {
    const dark = getComputedStyle(document.documentElement).colorScheme.includes("dark");
    const nt = dark ? "light" : "dark";
    document.documentElement.dataset.theme = nt; localSet("theme", nt);
  };
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
  $$("#tabs button").forEach((b) => (b.onclick = async () => { await autoSave(); showTab(b.dataset.tab); }));
  $("#globalSearch").onsubmit = (e) => { e.preventDefault(); S.q = $("#q").value.trim(); S.fields = null; S.sort = S.q ? "fundstelle" : S.sort; S.dir = "asc"; showTab("all"); loadBooks(); };
  $("#btnAll").onclick = () => { S.q = ""; S.fields = null; $("#q").value = ""; S.props = 0; S.group = ""; $("#groupFilter").value = ""; updateFilterBtn(); S.sort = "id"; S.dir = "desc"; loadBooks(); showTab("all"); };
  $("#btnNew").onclick = newBook;
  $("#btnQuit").onclick = async () => {
    if (!(await confirmDlg("Beenden", "Buchlover beenden? Ungespeicherte Änderungen werden vorher gespeichert."))) return;
    await autoSave();
    await api("POST", "/api/shutdown", {});
    document.body.innerHTML = '<div class="empty" style="margin:auto">Buchlover wurde beendet. Dieses Fenster kann geschlossen werden.</div>';
  };
  $("#propFilter").onclick = filterDialog;
  $("#groupFilter").onchange = (e) => { S.group = e.target.value; loadBooks(); };
  $("#groupMode").onchange = (e) => { S.gmode = e.target.value; loadBooks(); };
  $("#viewTable").onclick = () => setView("table");
  $("#viewTiles").onclick = () => setView("tiles");
  $("#btnExportView").onclick = exportDialog;
  initBookPage();
  document.addEventListener("keydown", globalKeys);
  // Eigenes Programmfenster: externe Links (DNB, Wikipedia …) im normalen Browser öffnen
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || !S.meta?.window_mode) return;
    const url = new URL(a.href, location.href);
    if (/^https?:$/.test(url.protocol) && url.host !== location.host) {
      e.preventDefault();
      api("POST", "/api/open", { url: url.href }).then(() => toast("Im Browser geöffnet"));
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
  else showTab(hp.get("tab") || (localGet("tab", "all") === "book" ? "all" : localGet("tab", "all")));
}

function globalKeys(e) {
  if (e.key === "F1") { e.preventDefault(); window.open("/handbuch", "_blank"); return; }
  if (e.altKey && e.key.toLowerCase() === "s") { e.preventDefault(); $("#q").focus(); $("#q").select(); }
  else if (e.altKey && e.key.toLowerCase() === "n") { e.preventDefault(); newBook(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && S.book) { e.preventDefault(); saveBook(); }
  else if (e.altKey && e.key === "ArrowLeft" && S.book) { e.preventDefault(); stepBook(-1); }
  else if (e.altKey && e.key === "ArrowRight" && S.book) { e.preventDefault(); stepBook(1); }
  else if (e.altKey && e.key.toLowerCase() === "r" && S.book) { e.preventDefault(); showTab("book"); subTab("reviews"); addSub("reviews"); }
}

// ------------------------------------------------------------ Alle Bücher
const COLS = [
  { k: "props", l: "E", title: "Eigenschaften – Klick zum Zuordnen" },
  { k: "id", l: "Nr" }, { k: "author", l: "Autor" }, { k: "title", l: "Titel" },
  { k: "bx", l: "BX", title: "Buchindex" }, { k: "class", l: "Klassifikation" },
  { k: "location", l: "Standort", lk: "location" }, { k: "pub_date", l: "Datum" },
  { k: "ax", l: "AX", title: "Autorenindex" }, { k: "publisher", l: "Verlag" },
  { k: "fundstelle", l: "Fundstelle", search: true }, { k: "isbn", l: "ISBN" }, { k: "barcode", l: "Barcode" },
];

async function loadBooks() {
  const p = new URLSearchParams({ sort: S.sort, dir: S.dir });
  if (S.q) p.set("q", S.q);
  if (S.fields) p.set("fields", S.fields.join("|"));
  if (S.props) { p.set("props", S.props); p.set("pmode", S.pmode); }
  if (S.group !== "") { p.set("group", S.group); p.set("gmode", S.gmode); }
  const r = await api("GET", "/api/books?" + p);
  S.books = r.books;
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

function renderBooks() {
  const parts = [];
  if (S.q) parts.push(`Suche „${S.q}“`);
  if (S.props) parts.push("gefiltert");
  if (S.group !== "") parts.push("Gruppe " + S.group);
  $("#viewInfo").textContent = `${S.books.length} von ${S.total ?? "?"} Büchern` + (parts.length ? " · " + parts.join(" · ") : "");
  if (S.view === "tiles") return renderTiles();
  const cols = COLS.filter((c) => !c.search || S.q);
  const hl = S.group !== "" && S.gmode === "highlight";
  const thead = $("#bookTable thead");
  thead.innerHTML = "<tr>" + (hl ? '<th title="Gruppenmitglied (Klick schaltet um)">G</th>' : "") + cols.map((c) =>
    `<th data-k="${c.k}" class="${S.sort === c.k ? "sorted" : ""}" title="${esc(c.title || "Sortieren")}">${esc(c.lk ? label(c.lk, c.l) : c.l)}${S.sort === c.k ? (S.dir === "asc" ? " ▲" : " ▼") : ""}</th>`).join("") + "</tr>";
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
      const v = b[c.k];
      return `<td class="c-${c.k === "fundstelle" ? "fund" : c.k}" title="${esc(v)}">${esc(v)}</td>`;
    }).join("");
    return `<tr data-i="${i}" class="${cls}">${hl ? `<td><input type="checkbox" data-tg="${b.id}" ${b.member ? "checked" : ""}></td>` : ""}${cells}</tr>`;
  }).join("");
  const tb = $("#bookTable tbody");
  tb.innerHTML = html || `<tr><td colspan="${cols.length + 1}" class="empty">Keine Bücher. ${S.total ? "Suche/Filter mit „Alle Datensätze“ aufheben." : "Über „Werkzeug → Import“ vorhandene Buchliebhaber-Daten übernehmen oder „+ Neues Buch“."}</td></tr>`;
  tb.onclick = async (e) => {
    const pb = e.target.closest("[data-props]");
    if (pb) { await propertyDialog(+pb.dataset.props); return; }
    const tg = e.target.closest("[data-tg]");
    if (tg) { const r = await api("POST", `/api/groups/${S.group}/toggle/${tg.dataset.tg}`); const b = S.books.find((x) => x.id === +tg.dataset.tg); b.member = r.member; renderBooks(); return; }
    const tr = e.target.closest("tr[data-i]"); if (tr) selectRow(+tr.dataset.i);
  };
  tb.ondblclick = (e) => { const tr = e.target.closest("tr[data-i]"); if (tr) openBook(S.books[+tr.dataset.i].id); };
  $("#bookTableWrap").tabIndex = 0;
  $("#bookTableWrap").onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); selectRow(Math.min(S.books.length - 1, S.sel + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); selectRow(Math.max(0, S.sel - 1)); }
    else if (e.key === "Enter" && S.sel >= 0) openBook(S.books[S.sel].id);
  };
  const selRow = tb.querySelector("tr.sel"); if (selRow) selRow.scrollIntoView({ block: "nearest" });
}
function propList(mask) {
  return S.meta.properties.filter((p) => p.name && mask & (1 << p.bit)).map((p) => p.name).join(", ") || "keine Eigenschaften";
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
    <div class="ph">${b.cover ? `<img loading="lazy" alt="" src="/api/books/${b.id}/image/cover">` : esc(b.title || "")}</div>
    <div class="t">${esc(b.title || "(ohne Titel)")}</div><div class="a">${esc(b.author || "")}</div></div>`).join("")
    || '<div class="empty">Keine Bücher.</div>';
  wrap.onclick = (e) => { const t = e.target.closest(".tile"); if (t) { $$(".tile.sel", wrap).forEach((x) => x.classList.remove("sel")); t.classList.add("sel"); S.sel = +t.dataset.i; S.bookId = S.books[S.sel].id; } };
  wrap.ondblclick = (e) => { const t = e.target.closest(".tile"); if (t) openBook(S.books[+t.dataset.i].id); };
  wrap.onkeydown = (e) => { if (e.key === "Enter") { const t = e.target.closest(".tile"); if (t) openBook(S.books[+t.dataset.i].id); } };
}

async function propertyDialog(bookId) {
  const b = S.books.find((x) => x.id === bookId) || (S.book?.id === bookId ? S.book : null);
  let mask = b?.properties || 0;
  const box = h("div", { cls: "chips" });
  for (const p of S.meta.properties) {
    if (!p.name) continue;
    const c = h("span", { cls: "chip" + (mask & (1 << p.bit) ? " on" : ""), onclick: () => { mask ^= 1 << p.bit; c.classList.toggle("on"); } }, p.name);
    box.append(c);
  }
  const body = h("div", {}, h("p", { cls: "hint" }, `${b?.title || ""} – neue Eigenschaften unter Werkzeug → Eigenschaften definieren.`), box);
  if (await dialog("Eigenschaften", body)) {
    await api("PUT", `/api/books/${bookId}/properties`, { properties: mask });
    if (b) b.properties = mask;
    if (S.book?.id === bookId) { S.book.properties = mask; renderBook(); }
    renderBooks();
  }
}

function updateFilterBtn() {
  const n = S.meta.properties.filter((p) => S.props & (1 << p.bit)).length;
  const b = $("#propFilter");
  b.textContent = n ? `Gefiltert (${n})` : "Filtern …";
  b.classList.toggle("primary", !!n);
}
async function filterDialog() {
  let mask = S.props;
  const box = h("div", { cls: "chips" });
  for (const p of S.meta.properties) {
    if (!p.name) continue;
    const c = h("span", { cls: "chip" + (mask & (1 << p.bit) ? " on" : ""), onclick: () => { mask ^= 1 << p.bit; c.classList.toggle("on"); } }, p.name);
    box.append(c);
  }
  const mode = h("select", {}, h("option", { value: "any" }, "mindestens eine der Eigenschaften"), h("option", { value: "all" }, "alle gewählten Eigenschaften"));
  mode.value = S.pmode;
  const r = await dialog("Nach Eigenschaften filtern", h("div", {}, box, h("div", { cls: "row", style: "margin-top:12px" }, h("span", {}, "Bücher mit"), mode)),
    [{ label: "Filtern", value: "ok", primary: true }, { label: "Filter aufheben", value: "clear" }, { label: "Abbrechen", value: null }]);
  if (!r) return;
  S.props = r === "clear" ? 0 : mask; S.pmode = mode.value;
  updateFilterBtn(); loadBooks();
}

async function exportDialog() {
  const body = h("div", {},
    h("p", {}, `Exportiert werden die ${S.books.length} angezeigten Bücher in der angezeigten Reihenfolge.`),
    h("label", {}, h("input", { type: "radio", name: "ex", value: "csv", checked: true }), " CSV (Excel, LibreOffice; Trennzeichen ;)"), h("br"),
    h("label", {}, h("input", { type: "radio", name: "ex", value: "html" }), " Buchliste als HTML mit Covern (Smartphone, E-Mail, Drucken/PDF)"));
  if (!(await dialog("Ansicht exportieren", body))) return;
  const kind = $("input[name=ex]:checked", body).value;
  const blob = await api("POST", `/api/export/${kind}`, { ids: S.books.map((b) => b.id), title: "Bücherliste" });
  download(blob, kind === "csv" ? "buchliste.csv" : "buchliste.html");
}

// ------------------------------------------------------------ Ein Buch
const BOOK_FORM = () => [
  { sect: "Autor & Titel" },
  { k: "author", l: "Autor", cls: "w2", dl: true },
  { k: "title", l: "Titel", cls: "w2" },
  { k: "isbn", l: "ISBN", btn: ["↓", "Daten zu dieser ISBN abfragen", () => lookupDialog()] },
  { k: "ean", l: "EAN" },
  { k: "id", l: "Buchnummer", ro: true },
  { k: "barcode", l: "Barcode" },
  { k: "bx", l: "Buchindex (BX)", dl: true, btn: ["⟲", "BX aus „Nachname, Titel“ bilden", makeBX] },
  { k: "ax", l: "Autorenindex (AX)", dl: true, btn: ["⟲", "AX aus Autor bilden (Nachname, Vorname)", makeAX] },
  { k: "class", l: "Klassifikation / Signatur", dl: true },
  { sect: "Ausgabe" },
  { k: "publisher", l: "Verlag", dl: true },
  { k: "binding", l: "Bindung", pick: "binding" },
  { k: "pages", l: "Seiten", type: "number" },
  { k: "list_price", l: "Listenpreis" },
  { k: "pub_date", l: "Erscheinungsdatum" },
  { k: "auflage", l: "Auflage", dl: true },
  { k: "ausgabe", l: "Ausgabe", dl: true },
  { k: "language", l: "Sprache", pick: "language" },
  { k: "condition", l: "Zustand", pick: "condition" },
  { sect: "Weitere Angaben (Bezeichnungen unter Werkzeug änderbar)" },
  { k: "series", l: label("series", "Reihe"), dl: true },
  { k: "book_type", l: label("book_type", "Buchart"), pick: "book_type" },
  { k: "location", l: label("location", "Standort"), dl: true },
  { k: "topic", l: label("topic", "Thema"), dl: true },
  { k: "translator", l: label("translator", "Übersetzer"), dl: true },
  { k: "original_title", l: label("original_title", "Originaltitel") },
  { k: "original_language", l: label("original_language", "Originalsprache"), pick: "language" },
  { k: "first_published", l: label("first_published", "Ersterscheinung") },
  { sect: "Mitwirkende" }, { custom: "persons" },
  { sect: "Eigenschaften" }, { custom: "props" },
  { sect: "Lesen & Bewerten" },
  { k: "read_status", l: "Lesestatus", pick: "read_status", select: true },
  { custom: "rating" },
  { k: "keywords_text", l: "Schlagwörter (durch Komma getrennt)", cls: "w2" },
  { sect: "Inhalt & Notizen" },
  { k: "content", l: "Inhaltsangabe", cls: "full", area: true },
  { k: "notes", l: "Eigene Notizen", cls: "full", area: true, small: true },
];

function initBookPage() {
  $("#btnSave").onclick = saveBook;
  $("#btnDelete").onclick = deleteBook;
  $("#btnCopy").onclick = async () => { await autoSave(); const b = await api("POST", `/api/books/${S.book.id}/copy`); toast("Kopie angelegt: Nr. " + b.id); await loadBooks(); openBook(b.id); };
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
  $("#coverUrl").onclick = async () => { const u = await prompt2("Cover aus dem Internet", "Bildadresse (URL):"); if (u) fetchCover(u.trim()); };
  $("#coverDel").onclick = async () => { if (await confirmDlg("Cover entfernen", "Coverbild wirklich entfernen?")) { await api("DELETE", `/api/books/${S.book.id}/image/cover`); await api("DELETE", `/api/books/${S.book.id}/image/cover_small`); S.book.images = []; renderCover(); markListCover(false); } };
  for (const t of ["Review", "Loan", "Att", "Quote"]) $("#add" + t).onclick = () => addSub({ Review: "reviews", Loan: "loans", Att: "attachments", Quote: "quotes" }[t]);
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
  if (S.meta.settings.confirm_delete !== "Nein" && !(await confirmDlg("Buch löschen", `„${S.book.title || "(ohne Titel)"}“ mit allen Rezensionen, Verleihvorgängen und Bildern löschen?`))) return;
  await api("DELETE", "/api/books/" + S.book.id);
  const i = S.books.findIndex((b) => b.id === S.book.id);
  S.books.splice(i, 1); S.book = null; S.dirty = false;
  toast("Buch gelöscht");
  if (S.books.length) openBook(S.books[Math.min(i, S.books.length - 1)].id); else renderBook();
  loadBooks();
}

function renderBook() {
  const b = S.book;
  $("#bookEmpty").classList.toggle("hidden", !!b);
  $("#bookView").classList.toggle("hidden", !b);
  if (!b) return;
  $("#bookHeading").textContent = (b.title || "(ohne Titel)") + (b.author ? " – " + b.author : "");
  setSaveState();
  const counts = { reviews: b.reviews.length, loan: b.loans.length + (b.sale ? 1 : 0) + (b.wishlist ? 1 : 0), web: b.attachments.length, quotes: b.quotes.length };
  $$("#bookSubtabs button").forEach((btn) => {
    const n = counts[btn.dataset.sub];
    btn.innerHTML = esc(btn.textContent.replace(/\d+$/, "").trim()) + (n ? ` <span class="badge">${n}</span>` : "");
  });
  renderCover();
  renderLinks();
  $("#bookMeta").innerHTML = `angelegt ${esc(fmtDate(b.created_at))}<br>geändert ${esc(fmtDate(b.updated_at))} ${esc((b.updated_at || "").slice(11, 16))}`;
  // Formular
  const form = $("#bookForm"); form.innerHTML = "";
  b.keywords_text = b.keywords.map((k) => k.keyword).join(", ");
  for (const f of BOOK_FORM()) {
    if (f.sect) { form.append(h("div", { cls: "sect" }, f.sect)); continue; }
    if (f.custom === "persons") { form.append(personsWidget()); continue; }
    if (f.custom === "props") { form.append(propsWidget()); continue; }
    if (f.custom === "rating") { form.append(ratingWidget()); continue; }
    const id = "f_" + f.k;
    let input;
    if (f.area) input = h("textarea", { id, name: f.k, rows: f.small ? 4 : 10 });
    else if (f.select) {
      input = h("select", { id, name: f.k }, h("option", { value: "" }, "–"), ...(S.meta.picklists[f.pick] || []).map((v) => h("option", { value: v }, v)));
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
}
async function fillDatalist(field, dl, pick) {
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
function setSaveState() { $("#saveState").textContent = S.dirty ? "ungespeichert" : "gespeichert"; }

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
  if (S.meta.settings.bx_from_author !== "Nein" && !d.bx && d.author && d.title) d.bx = bxFrom(d.author, d.title);
  if (!d.ax && d.author) d.ax = sortName(d.author.split(/[,;]| und /)[0]);
  const nb = await api("PUT", "/api/books/" + S.book.id, d);
  S.book = nb; S.dirty = false;
  const lb = S.books.find((x) => x.id === nb.id);
  if (lb) Object.assign(lb, { author: nb.author, title: nb.title, bx: nb.bx, ax: nb.ax, class: nb.class, location: nb.location, pub_date: nb.pub_date, publisher: nb.publisher, isbn: nb.isbn, barcode: nb.barcode, properties: nb.properties });
  renderBook();
  toast("Gespeichert");
}
async function autoSave() { if (S.dirty && S.book && $("#bookForm [name]")) await saveBook(); }

function sortName(display) {
  display = (display || "").trim();
  if (!display || display.includes(",")) return display;
  const p = display.split(/\s+/);
  return p.length < 2 ? display : `${p[p.length - 1]}, ${p.slice(0, -1).join(" ")}`;
}
function bxFrom(author, title) { return `${sortName(author.split(/[,;]| und /)[0]).split(",")[0]}, ${title}`.slice(0, 120); }
function makeBX() { const f = $("#bookForm"); f.bx.value = bxFrom(f.author.value, f.title.value); markDirty(); }
function makeAX() { const f = $("#bookForm"); f.ax.value = sortName(f.author.value.split(/[,;]| und /)[0]); markDirty(); }

async function onIsbnChange(e) {
  const v = e.target.value.replace(/[^0-9Xx]/g, "");
  if ((v.length === 10 || v.length === 13) && !$("#bookForm").title.value && S.meta.settings.isbn_autolookup !== "Nein") lookupDialog();
}

function personsWidget() {
  const b = S.book;
  const wrap = h("div", { cls: "f full persons" });
  for (const p of b.persons) {
    wrap.append(h("div", { cls: "person-row" },
      h("a", { onclick: () => { showTab("persons"); selectPerson(p.id); } }, p.display_name || p.sort_name),
      h("span", { cls: "role" }, p.role || ""),
      h("button", { type: "button", title: "Verknüpfung entfernen", onclick: async () => { S.book = await api("DELETE", `/api/books/${b.id}/persons/${p.id}?role=${encodeURIComponent(p.role || "")}`); renderBook(); } }, "×")));
  }
  const name = h("input", { placeholder: "Name (Vorname Nachname oder Nachname, Vorname)", list: "dl_persons" });
  const dl = h("datalist", { id: "dl_persons" });
  name.addEventListener("focus", async () => { if (dl.options.length) return; for (const p of await personsAll()) dl.append(h("option", { value: p.display_name || p.sort_name })); }, { once: true });
  const role = h("select", {}, ...(S.meta.picklists.role || ["Autor"]).map((r) => h("option", {}, r)));
  if (S.meta.settings.default_role) role.value = S.meta.settings.default_role;
  const add = async () => {
    if (!name.value.trim()) return;
    await autoSave();
    S.book = await api("POST", `/api/books/${b.id}/persons`, { name: name.value.trim(), role: role.value });
    S.personsCache = null;
    renderBook();
  };
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  wrap.append(h("div", { cls: "person-row" }, name, role, h("button", { type: "button", onclick: add }, "Hinzufügen")), dl);
  if (!b.persons.length && b.author) {
    wrap.append(h("button", { type: "button", style: "align-self:flex-start", onclick: async () => {
      await autoSave();
      for (const n of b.author.split(/;| und /).map((s) => s.trim()).filter(Boolean)) S.book = await api("POST", `/api/books/${b.id}/persons`, { name: n, role: "Autor" });
      S.personsCache = null; renderBook();
    } }, `„${b.author}“ als Mitwirkenden anlegen`));
  }
  return wrap;
}
function propsWidget() {
  const box = h("div", { cls: "f full chips" });
  for (const p of S.meta.properties) {
    if (!p.name) continue;
    const on = S.book.properties & (1 << p.bit);
    const c = h("span", { cls: "chip" + (on ? " on" : ""), tabindex: 0, role: "checkbox", "aria-checked": on ? "true" : "false" }, p.name);
    const tog = () => { S.book.properties ^= 1 << p.bit; c.classList.toggle("on"); c.setAttribute("aria-checked", c.classList.contains("on")); markDirty(); };
    c.onclick = tog; c.onkeydown = (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); tog(); } };
    box.append(c);
  }
  return box;
}
function ratingWidget() {
  const st = h("div", { cls: "stars", role: "radiogroup", "aria-label": "Eigene Bewertung" });
  const draw = () => [...st.children].forEach((s, i) => s.classList.toggle("on", i < (S.book.my_rating || 0)));
  for (let i = 1; i <= 5; i++) st.append(h("span", { title: `${i} Stern${i > 1 ? "e" : ""}`, onclick: () => { S.book.my_rating = S.book.my_rating === i ? null : i; draw(); markDirty(); } }, "★"));
  draw();
  return h("div", { cls: "f" }, h("label", {}, "Eigene Bewertung"), st);
}

function renderCover() {
  const b = S.book, img = $("#coverImg");
  const has = b.images.includes("cover") || b.images.includes("cover_small");
  img.classList.toggle("hidden", !has); $("#coverHint").classList.toggle("hidden", has);
  if (has) img.src = `/api/books/${b.id}/image/cover?t=${Date.now()}`; else img.removeAttribute("src");
}
function markListCover(v) { const lb = S.books.find((x) => x.id === S.book.id); if (lb) lb.cover = v; }
async function uploadCover(file) {
  if (!file.type.startsWith("image/")) return toast("Keine Bilddatei", true);
  const data = await downscale(file, +(S.meta.settings.cover_height || 800));
  await api("PUT", `/api/books/${S.book.id}/image/cover`, data, true);
  S.book.images = [...new Set([...S.book.images, "cover"])]; renderCover(); markListCover(true); toast("Cover gespeichert");
}
async function fetchCover(url) {
  await api("POST", `/api/books/${S.book.id}/image/cover/fetch`, { url });
  S.book.images = [...new Set([...S.book.images, "cover"])]; renderCover(); markListCover(true); toast("Cover geladen");
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
  const t = [b.author, b.title].filter(Boolean).join(" ");
  const links = [
    ["DNB", isbn ? `https://portal.dnb.de/opac/simpleSearch?query=${q(isbn)}` : `https://portal.dnb.de/opac/simpleSearch?query=${q(t)}`],
    ["Google", `https://www.google.de/search?q=${q(isbn || t)}`],
    ["Google Books", `https://www.google.de/search?tbm=bks&q=${q(isbn ? "isbn:" + isbn : t)}`],
    ["Wikipedia", `https://de.wikipedia.org/w/index.php?search=${q(b.title || "")}`],
    ["Open Library", `https://openlibrary.org/search?q=${q(isbn || t)}`],
    ["Booklooker", `https://www.booklooker.de/B%C3%BCcher/Angebote/isbn=${q(isbn)}`],
  ];
  for (let i = 1; i <= 3; i++) {
    const n = S.meta.settings[`shop${i}_name`], u = S.meta.settings[`shop${i}_url`];
    if (n && u) links.push([n, u + q(isbn || t)]);
  }
  $("#webLinks").innerHTML = links.filter((l) => !l[1].endsWith("isbn=")).map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n)}</a>`).join("");
}

// --- Internetabfrage --------------------------------------------------
async function lookupDialog() {
  if (!S.book) return;
  const f = $("#bookForm");
  const q0 = (f.isbn?.value || f.ean?.value || "").trim() || [f.author?.value, f.title?.value].filter(Boolean).join(" ");
  const inp = h("input", { type: "text", value: q0, style: "flex:1", placeholder: "ISBN, EAN oder Autor + Titel" });
  const res = h("div", {}, h("p", { cls: "hint" }, "Abfrage bei der Deutschen Nationalbibliothek und Open Library."));
  const ow = h("input", { type: "checkbox", checked: S.meta.settings.lookup_overwrite === "Ja" });
  const cov = h("input", { type: "checkbox", checked: true });
  const cont = h("input", { type: "checkbox", checked: true });
  let results = [], chosen = 0;
  const run = async () => {
    res.innerHTML = '<p class="hint">Suche läuft …</p>';
    const r = await api("GET", "/api/lookup?q=" + encodeURIComponent(inp.value));
    results = r.results; chosen = 0;
    res.innerHTML = "";
    if (!results.length) res.append(h("p", { cls: "hint" }, "Nichts gefunden." + (r.errors.length ? " (" + r.errors.join("; ") + ")" : "")));
    results.forEach((x, i) => {
      const dlx = h("dl", {});
      for (const [k, l] of [["author", "Autor"], ["title", "Titel"], ["publisher", "Verlag"], ["pub_date", "Jahr"], ["pages", "Seiten"], ["isbn", "ISBN"], ["series", "Reihe"], ["list_price", "Preis"], ["source", "Quelle"]])
        if (x[k]) dlx.append(h("dt", {}, l), h("dd", { style: "margin:0" }, String(x[k])));
      const el = h("div", { cls: "lookup-res" + (i === 0 ? " sel" : ""), onclick: () => { chosen = i; $$(".lookup-res", res).forEach((e, j) => e.classList.toggle("sel", j === i)); } },
        x.cover_url ? h("img", { src: x.cover_url, alt: "", referrerpolicy: "no-referrer", onerror: (e) => e.target.remove() }) : "", dlx);
      res.append(el);
    });
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } });
  const body = h("div", {}, h("div", { cls: "row" }, inp, h("button", { type: "button", onclick: run }, "Suchen")), res,
    h("div", { cls: "row wrap", style: "margin-top:10px" },
      h("label", {}, ow, " vorhandene Felder überschreiben"), h("label", {}, cov, " Cover übernehmen"), h("label", {}, cont, " Inhaltstext laden")));
  if (q0) setTimeout(run, 0);
  const ok = await dialog("Buchdaten abfragen", body, [{ label: "Übernehmen", value: "ok", primary: true }, { label: "Abbrechen", value: null }]);
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
  if (content && r.content_url && (overwrite || !f.content.value)) {
    try { const c = await api("GET", "/api/lookup/content?url=" + encodeURIComponent(r.content_url)); if (c.text) f.content.value = c.text; } catch (e) { /* */ }
  }
  await saveBook();
  for (const p of r.persons || []) {
    if (S.book.persons.some((x) => (x.sort_name || "").toLowerCase() === p.sort_name.toLowerCase())) continue;
    S.book = await api("POST", `/api/books/${S.book.id}/persons`, { name: p.display_name, sort_name: p.sort_name, role: p.role });
  }
  S.personsCache = null;
  if (cover && r.cover_url && (overwrite || !S.book.images.includes("cover"))) {
    try { await api("POST", `/api/books/${S.book.id}/image/cover/fetch`, { url: r.cover_url }); S.book.images.push("cover"); markListCover(true); } catch (e) { /* kein Cover */ }
  }
  renderBook();
}

// --- Unterlisten des Buches ---------------------------------------------
const SUB_DEF = {
  reviews: { list: "#reviewsList", fields: [["date", "Gelesen am / Datum", "date"], ["rating", "Bewertung (1–5)", "number"], ["summary", "Zusammenfassung", "text", "w2"], ["content", "Rezension / Kommentar", "area", "full"]] },
  loans: { list: "#loansList", fields: [["borrower", "Leihnehmer", "text"], ["loan_date", "verliehen am", "date"], ["due_date", "Rückgabe bis", "date"], ["return_date", "zurück am", "date"], ["remind", "mahnen?", "text"], ["rating", "Bewertung Leihnehmer (1–5)", "number"], ["note", "Verleihnotiz", "area", "full"], ["rating_comment", "Wertungskommentar", "text", "full"]] },
  attachments: { list: "#attList", fields: [["kind", "Art (Web, Datei …)", "text"], ["name", "Adresse / URL", "text", "w2"], ["path", "Dateipfad", "text", "w2"], ["description", "Beschreibung", "text", "w2"], ["date", "Datum", "date"]] },
  quotes: { list: "#quoteList", fields: [["category", "Beschreibung / Kategorie", "text", "w2"], ["date", "Datum", "date"], ["text", "Zitat / Anmerkung", "area", "full"]] },
};
function renderSubLists() {
  for (const [t, def] of Object.entries(SUB_DEF)) {
    const box = $(def.list); box.innerHTML = "";
    const rows = S.book[t];
    if (!rows.length) box.append(h("p", { cls: "hint" }, "Noch keine Einträge."));
    for (const r of rows) box.append(subCard(t, def, r));
  }
  // Verkauf
  const sale = S.book.sale || {};
  const sf = $("#saleForm"); sf.innerHTML = "";
  for (const [k, l, ty] of [["acquired", "Erworben am", "date"], ["purchase_price", "Einkaufspreis"], ["purchase_source", "Kaufquelle"], ["sale_place", "Verkaufsort"], ["sale_price", "Verkaufspreis"], ["currency", "Währung"], ["buyer", "Käufer"], ["shipping", "Versandart"], ["postage", "Porto"], ["weight", "Gewicht"], ["dimensions", "H×B×T"], ["condition", "Zustand"], ["note", "Verkaufsnotiz", "area"]]) {
    const inp = ty === "area" ? h("textarea", { name: k, rows: 3 }) : h("input", { name: k, type: ty || "text" });
    inp.value = sale[k] ?? "";
    sf.append(h("div", { cls: "f" + (ty === "area" ? " full" : "") }, h("label", {}, l), inp));
  }
  sf.append(h("div", { cls: "f full" }, h("div", { cls: "cardbtns" }, h("button", { type: "button", cls: "primary", onclick: async () => {
    const d = Object.fromEntries($$("[name]", sf).map((e) => [e.name, e.value]));
    S.book = await api("PUT", "/api/books/" + S.book.id, { sale: d }); toast("Gespeichert"); renderBook(); subTab("loan");
  } }, "Verkauf/Erwerb speichern"))));
  // Wunschliste
  const w = S.book.wishlist;
  const wf = $("#wishForm"); wf.innerHTML = "";
  const on = h("input", { type: "checkbox", checked: !!w });
  const rank = h("input", { type: "number", value: w?.rank ?? "" });
  const reason = h("textarea", { rows: 3 }); reason.value = w?.reason ?? "";
  wf.append(h("div", { cls: "f" }, h("label", {}, on, " Auf der Wunschliste")), h("div", { cls: "f" }, h("label", {}, "Rang"), rank),
    h("div", { cls: "f full" }, h("label", {}, "Grund / Notiz"), reason),
    h("div", { cls: "f full" }, h("div", { cls: "cardbtns" }, h("button", { type: "button", cls: "primary", onclick: async () => {
      S.book = await api("PUT", "/api/books/" + S.book.id, { wishlist: on.checked ? { rank: rank.value, reason: reason.value } : null });
      const lb = S.books.find((x) => x.id === S.book.id); if (lb) lb.wish = on.checked;
      toast("Gespeichert"); renderBook(); subTab("loan");
    } }, "Wunschliste speichern"))));
}
function subCard(t, def, r) {
  const form = h("form", { cls: "form" });
  for (const [k, l, ty, cls] of def.fields) {
    const inp = ty === "area" ? h("textarea", { name: k, rows: 5 }) : h("input", { name: k, type: ty });
    inp.value = r[k] ?? "";
    form.append(h("div", { cls: "f " + (cls || "") }, h("label", {}, l), inp));
  }
  const extra = [];
  if (t === "loans" && !r.return_date) extra.push(h("button", { type: "button", onclick: async () => { form.return_date.value = today(); save(); } }, "Heute zurückgegeben"));
  if (t === "attachments" && /^https?:/.test(r.name || "")) extra.push(h("a", { href: r.name, target: "_blank", rel: "noopener noreferrer", cls: "links" }, "öffnen ↗"));
  const save = async () => {
    const d = Object.fromEntries($$("[name]", form).map((e) => [e.name, e.value]));
    await api("PUT", `/api/sub/${t}/${r.id}`, d);
    Object.assign(r, d); toast("Gespeichert");
    if (t === "loans") { const lb = S.books.find((x) => x.id === S.book.id); if (lb) lb.loaned = S.book.loans.some((l) => !l.return_date); }
  };
  return h("div", { cls: "card" }, form, h("div", { cls: "cardbtns" }, ...extra,
    h("button", { type: "button", cls: "danger", onclick: async () => {
      if (!(await confirmDlg("Eintrag löschen", "Diesen Eintrag löschen?"))) return;
      await api("DELETE", `/api/sub/${t}/${r.id}`); S.book = await api("GET", "/api/books/" + S.book.id); renderBook(); subTab(subOf(t));
    } }, "Löschen"),
    h("button", { type: "button", cls: "primary", onclick: save }, "Speichern")));
}
const subOf = (t) => ({ reviews: "reviews", loans: "loan", attachments: "web", quotes: "quotes" }[t]);
async function addSub(t) {
  const d = { book_id: S.book.id };
  if (t === "reviews") d.date = today();
  if (t === "loans") { d.loan_date = today(); const n = await prompt2("Buch verleihen", "An wen wird das Buch verliehen?"); if (n === null) return; d.borrower = n; d.remind = "Ja"; }
  if (t === "quotes") d.date = today();
  if (t === "attachments") { d.kind = "Web"; d.date = today(); }
  await api("POST", "/api/sub/" + t, d);
  S.book = await api("GET", "/api/books/" + S.book.id);
  if (t === "loans") { const lb = S.books.find((x) => x.id === S.book.id); if (lb) lb.loaned = true; }
  renderBook(); subTab(subOf(t));
  const cards = $$(SUB_DEF[t].list + " .card");
  cards[cards.length - 1]?.querySelector("input,textarea")?.focus();
}

// ------------------------------------------------------------ Mitwirkende
async function loadPersons() {
  const q = $("#personQ").value || "";
  const rows = await api("GET", "/api/persons?q=" + encodeURIComponent(q));
  const ul = $("#personList");
  ul.innerHTML = rows.map((p) => `<li data-id="${p.id}" class="${p.id === S.personSel ? "sel" : ""}"><span>${esc(p.sort_name || p.display_name)}</span><span class="n">${p.books}</span></li>`).join("") || '<li class="empty-slot">keine Treffer</li>';
  ul.onclick = (e) => { const li = e.target.closest("li[data-id]"); if (li) selectPerson(+li.dataset.id); };
  $("#personQ").oninput = debounce(loadPersons, 250);
  $("#personNew").onclick = async () => { const n = await prompt2("Neuer Mitwirkender", "Name (z.B. „Nachname, Vorname“):"); if (n) { const p = await api("POST", "/api/persons", { display_name: n }); S.personsCache = null; await loadPersons(); selectPerson(p.id); } };
  if (!S.personSel && rows.length) S.personSel = rows[0].id;
  if (S.personSel) selectPerson(S.personSel, true);
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
async function selectPerson(id, keepList) {
  S.personSel = id;
  $$("#personList li").forEach((li) => li.classList.toggle("sel", +li.dataset.id === id));
  let p;
  try { p = await api("GET", "/api/persons/" + id); } catch (e) { $("#personDetail").innerHTML = '<div class="empty">Mitwirkenden auswählen.</div>'; return; }
  const box = $("#personDetail"); box.innerHTML = "";
  const img = h("div", { cls: "pimg", title: "Bild hochladen (klicken) oder hierher ziehen" }, p.has_image ? h("img", { src: `/api/persons/${id}/image?t=${Date.now()}`, alt: "" }) : h("span", {}, "Kein Bild", h("br"), "klicken zum Hochladen"));
  const file = h("input", { type: "file", accept: "image/*", hidden: true });
  const up = async (f) => { const data = await downscale(f, 500); await api("PUT", `/api/persons/${id}/image`, data, true); selectPerson(id); };
  img.onclick = () => file.click(); file.onchange = () => file.files[0] && up(file.files[0]);
  img.ondragover = (e) => e.preventDefault(); img.ondrop = (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) up(e.dataTransfer.files[0]); };
  const sn = h("input", { value: p.sort_name || "" }), dn = h("input", { value: p.display_name || "" });
  const bio = h("textarea", { rows: 10 }); bio.value = p.biography || "";
  const al = h("textarea", { rows: 4, placeholder: "eine Schreibweise pro Zeile" }); al.value = p.aliases.join("\n");
  box.append(h("div", { cls: "personhead" }, img, file, h("div", { cls: "form", style: "flex:1" },
    h("div", { cls: "f" }, h("label", {}, "Nachname, Vorname"), sn),
    h("div", { cls: "f" }, h("label", {}, "Anzeigename"), dn),
    h("div", { cls: "f full" }, h("label", {}, "Biographie"), bio),
    h("div", { cls: "f full" }, h("label", {}, "Weitere Schreibweisen (werden beim Zuordnen erkannt)"), al))));
  box.append(h("div", { cls: "cardbtns", style: "margin:10px 0" },
    p.has_image ? h("button", { type: "button", onclick: async () => { await api("DELETE", `/api/persons/${id}/image`); selectPerson(id); } }, "Bild entfernen") : "",
    h("button", { type: "button", title: "Doppelte Einträge/Schreibfehler bereinigen", onclick: () => mergePerson(p) }, "Zusammenführen mit …"),
    h("button", { type: "button", cls: "danger", onclick: async () => {
      if (!(await confirmDlg("Mitwirkenden löschen", `„${p.display_name}“ inkl. Bild überall löschen? Die Bücher bleiben erhalten.`))) return;
      await api("DELETE", "/api/persons/" + id); S.personSel = null; S.personsCache = null; loadPersons(); box.innerHTML = "";
    } }, "Löschen"),
    h("button", { type: "button", cls: "primary", onclick: async () => {
      await api("PUT", "/api/persons/" + id, { sort_name: sn.value, display_name: dn.value, biography: bio.value, aliases: al.value.split("\n") });
      S.personsCache = null; toast("Gespeichert"); if (!keepList) loadPersons();
    } }, "Speichern")));
  box.append(h("h3", {}, `Bücher (${p.books.length})`));
  const t = h("table", { cls: "grid" }, h("thead", {}, h("tr", {}, h("th", {}, "Titel"), h("th", {}, "Rolle"), h("th", {}, "Datum"))));
  const tb = h("tbody");
  for (const b of p.books) tb.append(h("tr", { style: "cursor:pointer", ondblclick: () => openBook(b.id), onclick: () => openBook(b.id) }, h("td", {}, b.title || ""), h("td", {}, b.role || ""), h("td", {}, b.pub_date || "")));
  t.append(tb); box.append(t);
}
async function mergePerson(p) {
  const all = (await personsAll()).filter((x) => x.id !== p.id);
  const sel = h("select", { style: "width:100%" }, ...all.map((x) => h("option", { value: x.id }, x.sort_name || x.display_name)));
  const r = await dialog("Zusammenführen", h("div", {}, h("p", {}, `„${p.sort_name || p.display_name}“ wird gelöscht; Bücher und Schreibweisen gehen über auf:`), sel));
  if (!r) return;
  const np = await api("POST", `/api/persons/${p.id}/merge/${sel.value}`);
  S.personsCache = null; S.personSel = np.id; loadPersons(); toast("Zusammengeführt");
}

// ------------------------------------------------------------ Listen-Ordner
function bookTable(rows, cols, opts = {}) {
  if (!rows.length) return h("p", { cls: "empty" }, opts.empty || "Keine Einträge.");
  const t = h("table", { cls: "grid" });
  t.append(h("thead", {}, h("tr", {}, ...cols.map((c) => h("th", {}, c[1])))));
  const tb = h("tbody");
  for (const r of rows) {
    const tr = h("tr", { style: "cursor:pointer", title: "Doppelklick öffnet das Buch", ondblclick: () => openBook(r.book_id), class: opts.rowCls ? opts.rowCls(r) : null });
    for (const c of cols) tr.append(h("td", { title: String(r[c[0]] ?? "") }, c[2] ? c[2](r) : String(r[c[0]] ?? "")));
    tb.append(tr);
  }
  t.append(tb);
  return h("div", { cls: "tablewrap" }, t);
}
const stars = (n) => n ? "★".repeat(n) + "☆".repeat(5 - n) : "";
async function loadReading() {
  const rows = await api("GET", "/api/lists/reviews");
  const v = $("#readingView"); v.innerHTML = "";
  const years = [...new Set(rows.map((r) => (r.date || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  const ys = h("select", {}, h("option", { value: "" }, "alle Jahre"), ...years.map((y) => h("option", {}, y)));
  const body = h("div");
  const draw = () => { body.innerHTML = ""; const f = rows.filter((r) => !ys.value || (r.date || "").startsWith(ys.value)); body.append(h("p", { cls: "info" }, `${f.length} gelesene Bücher / Rezensionen`), bookTable(f, [["date", "Datum", (r) => fmtDate(r.date)], ["author", "Autor"], ["title", "Titel"], ["rating", "Bewertung", (r) => stars(r.rating)], ["summary", "Zusammenfassung"]], { empty: "Noch keine Lesevermerke. Im Buch unter „Rezensionen“ (Alt+R) anlegen." })); };
  ys.onchange = draw;
  v.append(h("div", { cls: "toolbar" }, h("h2", {}, "Lesehistorie"), h("div", { cls: "spacer" }), ys), body);
  draw();
}
async function loadLoansView() {
  const rows = await api("GET", "/api/lists/loans");
  const sales = await api("GET", "/api/lists/sales");
  const t = today();
  const v = $("#loansView"); v.innerHTML = "";
  const open = rows.filter((r) => !r.return_date);
  v.append(h("div", { cls: "toolbar" }, h("h2", {}, "Verleih"), h("span", { cls: "info" }, `${open.length} Bücher unterwegs, ${open.filter((r) => r.due_date && r.due_date < t).length} überfällig`)));
  v.append(bookTable(rows, [["borrower", "Leihnehmer"], ["title", "Titel"], ["author", "Autor"], ["loan_date", "verliehen am", (r) => fmtDate(r.loan_date)], ["due_date", "Rückgabe bis", (r) => (r.due_date && !r.return_date && r.due_date < t ? "⚠ " : "") + fmtDate(r.due_date)], ["return_date", "zurück am", (r) => fmtDate(r.return_date)], ["remind", "mahnen"],
    ["id", "", (r) => r.return_date ? "" : h("button", { onclick: async (e) => { e.stopPropagation(); await api("PUT", "/api/sub/loans/" + r.id, { return_date: today() }); loadLoansView(); loadBooks(); } }, "zurückgegeben")]],
  { empty: "Keine Verleihvorgänge.", rowCls: (r) => (!r.return_date ? "loaned" : "") }));
  v.append(h("h3", {}, "Verkauf / Erwerb"), bookTable(sales, [["title", "Titel"], ["author", "Autor"], ["acquired", "erworben", (r) => fmtDate(r.acquired)], ["purchase_price", "Einkauf"], ["sale_place", "Verkaufsort"], ["sale_price", "Verkaufspreis"], ["buyer", "Käufer"]], { empty: "Keine Einträge." }));
}
async function loadWishView() {
  const rows = await api("GET", "/api/lists/wishlist");
  const v = $("#wishView"); v.innerHTML = "";
  v.append(h("div", { cls: "toolbar" }, h("h2", {}, "Wunschliste"), h("span", { cls: "info" }, `${rows.length} Bücher`), h("div", { cls: "spacer" }),
    h("button", { onclick: async () => { const blob = await api("POST", "/api/export/html", { ids: rows.map((r) => r.book_id), title: "Wunschliste" }); download(blob, "wunschliste.html"); } }, "Als HTML-Liste exportieren")));
  const shops = [1, 2, 3].map((i) => [S.meta.settings[`shop${i}_name`], S.meta.settings[`shop${i}_url`]]).filter((s) => s[0] && s[1]);
  v.append(bookTable(rows, [["rank", "Rang"], ["author", "Autor"], ["title", "Titel"], ["list_price", "Preis"], ["reason", "Grund"],
    ["isbn", "Suchen", (r) => h("span", { cls: "links" }, ...[["Booklooker", "https://www.booklooker.de/B%C3%BCcher/Angebote/isbn="], ...shops].map(([n, u]) => h("a", { href: u + encodeURIComponent(r.isbn || r.title), target: "_blank", rel: "noopener noreferrer" }, n)))]],
  { empty: "Die Wunschliste ist leer. Bücher im Ordner „Ein Buch“ → „Verleih / Verkauf“ auf die Wunschliste setzen." }));
}
async function loadQuotesView() {
  const [quotes, kws] = await Promise.all([api("GET", "/api/lists/quotes"), api("GET", "/api/lists/keywords")]);
  const v = $("#quotesView"); v.innerHTML = "";
  v.append(h("h2", {}, "Schlagwörter"));
  const cloud = h("div", { cls: "chips", style: "margin:8px 0 18px" });
  for (const k of kws) cloud.append(h("span", { cls: "chip", title: "Bücher mit diesem Schlagwort anzeigen", onclick: () => { S.q = k.keyword; S.fields = ["Schlagwort"]; $("#q").value = k.keyword; S.sort = "author"; S.dir = "asc"; loadBooks(); showTab("all"); } }, `${k.keyword} (${k.n})`));
  if (!kws.length) cloud.append(h("span", { cls: "hint" }, "Noch keine Schlagwörter – im Buch unter „Lesen & Bewerten“ eintragen."));
  v.append(cloud, h("h2", {}, "Zitate & Anmerkungen"));
  v.append(bookTable(quotes, [["category", "Beschreibung"], ["text", "Zitat"], ["title", "Buch"], ["author", "Autor"], ["date", "Datum", (r) => fmtDate(r.date)]], { empty: "Noch keine Zitate." }));
}

// ------------------------------------------------------------ Gruppen
async function loadGroups() {
  await loadMeta();
  const ul = $("#groupList");
  ul.innerHTML = S.meta.groups.map((g) => `<li data-id="${g.id}" class="${g.id === S.groupSel ? "sel" : ""} ${g.name ? "" : "empty-slot"}"><span>${g.id}: ${esc(g.name || "(frei)")}</span><span class="n">${g.name ? g.members : ""}</span></li>`).join("");
  ul.onclick = (e) => { const li = e.target.closest("li[data-id]"); if (li) selectGroup(+li.dataset.id); };
  if (S.groupSel != null) selectGroup(S.groupSel);
}
async function selectGroup(id) {
  S.groupSel = id;
  $$("#groupList li").forEach((li) => li.classList.toggle("sel", +li.dataset.id === id));
  const g = await api("GET", "/api/groups/" + id);
  const box = $("#groupDetail"); box.innerHTML = "";
  const name = h("input", { value: g.name || "", placeholder: "Gruppenbeschreibung, z.B. „Inhalt Regal 10“", style: "flex:1" });
  name.onchange = async () => { await api("PUT", "/api/groups/" + id, { name: name.value }); loadGroups(); };
  const show = async (mode) => { S.group = String(id); S.gmode = mode; $("#groupMode").value = mode; await loadMeta(); $("#groupFilter").value = String(id); await loadBooks(); showTab("all"); };
  box.append(h("div", { cls: "row" }, h("strong", {}, `Gruppe ${id}`), name));
  box.append(h("div", { cls: "toolbar", style: "margin-top:10px" },
    h("button", { cls: "primary", onclick: async () => { const r = await api("POST", `/api/groups/${id}/apply`, { view_ids: S.books.map((b) => b.id) }); toast(`${r.members} Bücher in der Gruppe`); selectGroup(id); loadMeta(); } }, "Anwenden / wiederholen"),
    h("button", { onclick: () => show("show") }, "Gruppe anzeigen"),
    h("button", { onclick: () => show("highlight"), title: "Alle Bücher zeigen, Gruppe hervorheben; Mitgliedschaft per Klick umschalten" }, "Hervorheben"),
    h("button", { onclick: () => addActionDialog(id) }, "+ Aktion hinzufügen"),
    h("div", { cls: "spacer" }),
    h("button", { onclick: async () => { const t = await prompt2("Gruppe kopieren", "Auf Gruppe Nr. (0–30, muss leer sein):"); if (t !== null && t !== "") { await api("POST", `/api/groups/${id}/copy/${+t}`); loadGroups(); } } }, "Kopieren"),
    h("button", { onclick: async () => { const t = await prompt2("Reihenfolge tauschen", "Tauschen mit Gruppe Nr. (0–30):"); if (t !== null && t !== "" && +t >= 0 && +t <= 30) { await api("POST", `/api/groups/${id}/swap/${+t}`); S.groupSel = +t; loadGroups(); } } }, "Tauschen"),
    h("button", { cls: "danger", onclick: async () => { if (await confirmDlg("Gruppe löschen", "Gruppe mit allen Aktionen und Mausklicks löschen?")) { await api("DELETE", "/api/groups/" + id); loadGroups(); } } }, "Löschen")));
  box.append(h("p", { cls: "info" }, `${g.members} Bücher in der Gruppe` + (g.manual ? `, ${g.manual} per Mausklick gesetzt` : "")));
  const actions = S.meta.group_actions;
  const t = h("table", { cls: "grid" }, h("thead", {}, h("tr", {}, ...["Nr", "Art", "Aktion", "Suchfeld", "Option", "Anzahl", "Moves", "ms", ""].map((x) => h("th", {}, x)))));
  const tb = h("tbody");
  for (const a of g.actions) {
    const info = actions.find((x) => x.code === a.action) || { art: "?", label: `Aktion ${a.action}` };
    const nr = h("input", { type: "number", value: a.nr, style: "width:64px" });
    const opt = h("input", { value: a.option || "", style: "width:100%" });
    const upd = () => api("PUT", "/api/group_actions/" + a.id, { nr: nr.value, option: opt.value });
    nr.onchange = upd; opt.onchange = upd;
    const desc = info.label + (a.property_bit != null ? ` „${propName(a.property_bit) || "Bit " + a.property_bit}“` : "");
    tb.append(h("tr", {}, h("td", {}, nr), h("td", { cls: "arts" }, info.art), h("td", { title: desc, style: "white-space:normal" }, desc),
      h("td", {}, info.extra === "search" ? a.field || "" : ""), h("td", {}, info.extra === "search" ? opt : ""),
      h("td", {}, a.count ?? ""), h("td", {}, a.moves ?? ""), h("td", {}, a.ms ?? ""),
      h("td", {}, h("button", { cls: "danger", title: "Aktion löschen", onclick: async () => { await api("DELETE", "/api/group_actions/" + a.id); selectGroup(id); } }, "×"))));
  }
  t.append(tb);
  box.append(g.actions.length ? h("div", { cls: "tablewrap" }, t) : h("p", { cls: "empty" }, "Noch keine Aktionen. Beginnen Sie z.B. mit „Nimm alle Bücher“ (=) und schränken Sie dann ein (*, -)."));
  box.append(h("p", { cls: "hint", style: "margin-top:10px" }, "Art: = Anfangsmenge · + hinzufügen · - entfernen · * nur Treffer behalten · ± Mausklicks · E Eigenschaften setzen. Reihenfolge über die Spalte Nr."));
}
async function addActionDialog(gid) {
  const sel = h("select", { style: "width:100%" }, ...S.meta.group_actions.map((a) => h("option", { value: a.code }, `${a.art}  ${a.label}`)));
  const fld = h("select", {}, ...S.meta.search_fields.map((f) => h("option", {}, f.label)));
  const opt = h("input", { placeholder: "Suchbegriff" });
  const prop = h("select", {}, ...S.meta.properties.filter((p) => p.name).map((p) => h("option", { value: p.bit }, p.name)));
  const xs = h("div", { cls: "row" }, fld, opt), xp = h("div", { cls: "row" }, h("span", {}, "Eigenschaft:"), prop);
  const upd = () => { const a = S.meta.group_actions.find((x) => x.code === +sel.value); xs.classList.toggle("hidden", a.extra !== "search"); xp.classList.toggle("hidden", a.extra !== "property"); };
  sel.onchange = upd; upd();
  if (!(await dialog("Aktion hinzufügen", h("div", {}, sel, h("div", { style: "height:10px" }), xs, xp)))) return;
  const a = S.meta.group_actions.find((x) => x.code === +sel.value);
  await api("POST", `/api/groups/${gid}/actions`, { action: a.code, field: a.extra === "search" ? fld.value : null, option: a.extra === "search" ? opt.value : null, property_bit: a.extra === "property" ? +prop.value : null });
  await loadGroups();
}

// ------------------------------------------------------------ Statistik
async function loadStats() {
  const s = await api("GET", "/api/stats");
  const v = $("#statsView"); v.innerHTML = "";
  const nf = (n) => Number(n || 0).toLocaleString("de-DE");
  const kpi = (val, l) => h("div", { cls: "kpi" }, h("div", { cls: "v" }, val), h("div", { cls: "l" }, l));
  v.append(h("div", { cls: "kpis" }, kpi(nf(s.books), "Bücher"), kpi(nf(s.read), "gelesen"), kpi(nf(s.pages), "Seiten gesamt"),
    kpi(s.value.toLocaleString("de-DE", { style: "currency", currency: "EUR" }), "Listenpreis gesamt (ca.)"),
    kpi(nf(s.persons), "Mitwirkende"), kpi(nf(s.loaned), "verliehen"), kpi(nf(s.wishlist), "auf Wunschliste")));
  const bars = (title, rows) => {
    const max = Math.max(1, ...rows.map((r) => r.n));
    const g = h("div", { cls: "bars" });
    for (const r of rows) g.append(h("span", { cls: "k", title: r.k }, r.k), h("span", { cls: "t", title: `${r.k}: ${r.n}` }, h("i", { style: `width:${(r.n / max) * 100}%` })), h("span", { cls: "n" }, nf(r.n)));
    return h("div", { cls: "chart panel" }, h("h4", {}, title), rows.length ? g : h("p", { cls: "hint" }, "keine Daten"));
  };
  const cols = (title, rows) => {
    const max = Math.max(1, ...rows.map((r) => r.n));
    const c = h("div", { cls: "cols", role: "img", "aria-label": title });
    for (const r of rows) c.append(h("i", { title: `${r.k}: ${r.n}`, style: `height:${(r.n / max) * 100}%` }));
    return h("div", { cls: "chart panel" }, h("h4", {}, title), rows.length ? h("div", {}, c, h("div", { cls: "colaxis" }, h("span", {}, rows[0].k), h("span", {}, rows[rows.length - 1].k))) : h("p", { cls: "hint" }, "keine Daten"));
  };
  v.append(h("div", { cls: "charts" }, bars("Klassifikation", s.by_class), bars("Häufigste Autoren", s.top_authors), bars("Bindung", s.by_binding),
    bars("Standort", s.by_location), bars("Sprache", s.by_language), bars("Lesestatus", s.by_status),
    cols("Bücher nach Erscheinungsjahr", s.by_year), cols("Gelesen pro Jahr (Lesehistorie)", s.reading_per_year)));
}

// ------------------------------------------------------------ Werkzeug
async function loadTools() {
  await loadMeta();
  const v = $("#toolsView"); v.innerHTML = "";
  const st = S.meta.settings;

  // Import Buchliebhaber
  const path = h("input", { type: "text", value: localGet("importPath", "C:\\Buchliebhaber") });
  const mode = h("select", {}, h("option", { value: "merge" }, "zusammenführen (vorhandene Bücher behalten)"), h("option", { value: "replace" }, "ersetzen (Datenbank leeren, Nummern übernehmen)"));
  const skip = h("input", { type: "checkbox", checked: true });
  const out = h("div", { cls: "result hidden" });
  const show = (o) => { out.classList.remove("hidden"); out.textContent = typeof o === "string" ? o : Object.entries(o).map(([k, n]) => `${k}: ${n}`).join("\n"); };
  const zip = h("input", { type: "file", accept: ".zip", hidden: true });
  zip.onchange = async () => { const f = zip.files[0]; if (!f) return; show("Import läuft …"); const r = await api("POST", `/api/import/upload/zip?mode=${mode.value}&skip=${skip.checked ? 1 : 0}`, f, true); show(r); afterImport(); zip.value = ""; };
  v.append(h("div", { cls: "panel" }, h("h3", {}, "Buchliebhaber-Datenbank importieren"),
    h("p", { cls: "hint" }, "Ordner der Buchliebhaber-Installation (enthält WORK und PRIV), den WORK-Ordner selbst oder ein Backup-ZIP (z.B. C:\\backup\\20240101_1200_BLH_W.zip – zugehörige ZIPs werden automatisch mitgelesen). Übernommen werden Bücher, Cover, Mitwirkende inkl. Bilder und Biographien, Inhalte, Rezensionen, Verleih, Verkauf, Wunschliste, Web/Ablage, Schlagwörter, Zitate, Eigenschaften, Gruppen, Signaturen und Auswahllisten."),
    h("div", { cls: "row" }, path, h("button", { onclick: async () => { localSet("importPath", path.value); show("Lese …"); const r = await api("POST", "/api/import/preview", { path: path.value }); show(`Gefunden: ${r.work}\n` + r.tables.map((t) => `${t.label}: ${t.records}`).join("\n") + `\nCover-Dateien: ${r.covers}\nAutorenbilder: ${r.author_images}`); } }, "Vorschau")),
    h("div", { cls: "row" }, mode), h("label", { cls: "row" }, skip, "Dubletten überspringen (gleiche ISBN/EAN oder gleicher Autor+Titel)"),
    h("div", { cls: "row" }, h("button", { cls: "primary", onclick: async () => {
      localSet("importPath", path.value);
      if (mode.value === "replace" && !(await confirmDlg("Datenbank ersetzen", "Alle vorhandenen Bücher in Buchlover werden gelöscht und durch den Import ersetzt. Fortfahren?"))) return;
      show("Import läuft …"); const r = await api("POST", "/api/import/blh", { path: path.value, mode: mode.value, skip_duplicates: skip.checked }); show(r); afterImport();
    } }, "Importieren"), h("button", { onclick: () => zip.click() }, "Backup-ZIP hochladen …"), zip), out));

  // CSV / DBF
  const csvOut = h("div", { cls: "result hidden" });
  const cf = h("input", { type: "file", accept: ".csv,.txt,.dbf" });
  v.append(h("div", { cls: "panel" }, h("h3", {}, "Import aus Tabellenkalkulation (CSV / DBF)"),
    h("p", { cls: "hint" }, "Erste Zeile = Spaltenüberschriften. Erkannt werden u.a.: ISBN, EAN, BX, Class, Autor, Titel, Seiten, Verlag, Bindung, Listenpreis, Datum, Originaltitel, Sprache, Reihe, Thema, Standort, Übersetzer, Auflage, Inhalt, Notiz, Lesestatus, Bewertung. Mindestens ISBN, Autor oder Titel."),
    h("div", { cls: "row" }, cf, h("button", { cls: "primary", onclick: async () => {
      const f = cf.files[0]; if (!f) return toast("Bitte Datei wählen", true);
      const kind = f.name.toLowerCase().endsWith(".dbf") ? "dbf" : "csv";
      const r = await api("POST", `/api/import/upload/${kind}?skip=1`, f, true);
      csvOut.classList.remove("hidden"); csvOut.textContent = Object.entries(r).map(([k, n]) => `${k}: ${n}`).join("\n"); afterImport();
    } }, "Importieren")), csvOut));

  // Export & Sicherung
  const bOut = h("div", { cls: "result hidden" });
  v.append(h("div", { cls: "panel" }, h("h3", {}, "Export & Datensicherung"),
    h("p", { cls: "hint" }, "Datenbank: " + S.meta.db_path),
    h("div", { cls: "row wrap" },
      h("button", { onclick: async () => download(await api("POST", "/api/export/csv", {}), "buchliste.csv") }, "Alle Bücher als CSV"),
      h("button", { onclick: async () => download(await api("POST", "/api/export/html", { title: "Bücherliste" }), "buchliste.html") }, "Buchliste als HTML"),
      h("button", { cls: "primary", onclick: async () => { const r = await api("POST", "/api/backup"); bOut.classList.remove("hidden"); bOut.textContent = "Sicherung erstellt:\n" + r.path; } }, "Backup erstellen")),
    h("p", { cls: "hint", style: "margin-top:8px" }, "Das Backup ist eine ZIP-Datei mit der kompletten Datenbank (inkl. Bilder). Zum Wiederherstellen die Datei buchlover.sqlite aus dem ZIP in den data-Ordner kopieren."), bOut));

  // Eigenschaften
  const plist = h("div", { cls: "proplist" });
  for (const p of S.meta.properties) plist.append(h("span", {}, p.bit + 1), h("input", { value: p.name || "", "data-bit": p.bit, placeholder: "(frei)" }));
  v.append(h("div", { cls: "panel" }, h("h3", {}, "Eigenschaften definieren"),
    h("p", { cls: "hint" }, "30 frei benennbare Eigenschaften. Je Buch wird die Nummer gespeichert – eine Umbenennung gilt für alle Bücher."), plist,
    h("div", { cls: "cardbtns", style: "margin-top:8px" }, h("button", { cls: "primary", onclick: async () => {
      await api("PUT", "/api/properties", $$("input[data-bit]", plist).map((i) => ({ bit: +i.dataset.bit, name: i.value })));
      await loadMeta(); toast("Eigenschaften gespeichert");
    } }, "Speichern"))));

  // Einstellungen
  const setFields = [["owner", "Name des Buchliebhabers (für Listen)"], ["label.series", "Bezeichnung Feld „Reihe“"], ["label.book_type", "Bezeichnung „Buchart“"], ["label.location", "Bezeichnung „Standort“"], ["label.topic", "Bezeichnung „Thema“"], ["label.translator", "Bezeichnung „Übersetzer“"], ["label.original_title", "Bezeichnung „Originaltitel“"], ["label.original_language", "Bezeichnung „Originalsprache“"], ["label.first_published", "Bezeichnung „Ersterscheinung“"],
    ["default_language", "Sprache für neue Bücher"], ["default_role", "Standard-Rolle neuer Mitwirkender"], ["confirm_delete", "Löschbestätigung (Ja/Nein)"], ["bx_from_author", "BX automatisch „Nachname, Titel“ (Ja/Nein)"], ["isbn_autolookup", "ISBN-Eingabe fragt automatisch ab (Ja/Nein)"], ["lookup_overwrite", "Abfrage überschreibt Felder (Ja/Nein)"], ["cover_height", "max. Coverhöhe in Pixel"], ["backup_dir", "Backup-Verzeichnis"],
    ["shop1_name", "Shop 1 Name"], ["shop1_url", "Shop 1 Such-URL (Suchbegriff wird angehängt)"], ["shop2_name", "Shop 2 Name"], ["shop2_url", "Shop 2 Such-URL"]];
  const sf = h("div", { cls: "form" });
  for (const [k, l] of setFields) sf.append(h("div", { cls: "f" }, h("label", {}, l), h("input", { "data-k": k, value: st[k] ?? "" })));
  v.append(h("div", { cls: "panel" }, h("h3", {}, "Einstellungen"), sf,
    h("div", { cls: "cardbtns", style: "margin-top:8px" }, h("button", { cls: "primary", onclick: async () => {
      await api("PUT", "/api/settings", Object.fromEntries($$("input[data-k]", sf).map((i) => [i.dataset.k, i.value])));
      await loadMeta(); toast("Einstellungen gespeichert");
    } }, "Speichern"))));

  // Auswahllisten
  const names = { role: "Rollen der Mitwirkenden", binding: "Bindung", book_type: "Buchart", language: "Sprache", condition: "Zustand", read_status: "Lesestatus", sale_place: "Verkaufsort", shipping: "Versandart" };
  const psel = h("select", {}, ...Object.entries(names).map(([k, l]) => h("option", { value: k }, l)));
  const pta = h("textarea", { rows: 8, style: "width:100%" });
  const fillP = () => (pta.value = (S.meta.picklists[psel.value] || []).join("\n"));
  psel.onchange = fillP; fillP();
  v.append(h("div", { cls: "panel" }, h("h3", {}, "Auswahllisten"), h("div", { cls: "row" }, psel), pta,
    h("div", { cls: "cardbtns" }, h("button", { cls: "primary", onclick: async () => { await api("PUT", "/api/picklists/" + psel.value, pta.value.split("\n")); await loadMeta(); toast("Gespeichert"); } }, "Speichern"))));

  // Dubletten
  const dOut = h("div");
  v.append(h("div", { cls: "panel" }, h("h3", {}, "Dublettenprüfung"),
    h("p", { cls: "hint" }, "Findet Bücher mit gleicher ISBN/EAN oder gleichem Autor + Titel."),
    h("button", { onclick: async () => {
      const r = await api("GET", "/api/duplicates"); dOut.innerHTML = "";
      if (!r.length) dOut.append(h("p", { cls: "hint" }, "Keine Dubletten gefunden."));
      for (const d of r) dOut.append(h("div", { cls: "card" }, h("div", { cls: "info" }, "gleich: " + d.key), ...d.books.map((b) => h("div", {}, h("a", { href: "#", onclick: (e) => { e.preventDefault(); openBook(b.id); } }, `Nr. ${b.id}: ${b.author || ""} – ${b.title || ""}`)))));
    } }, "Dubletten suchen"), dOut));

  // Signaturen
  if (S.meta.signatures.length) {
    v.append(h("div", { cls: "panel" }, h("h3", {}, "Signaturen (aus Buchliebhaber übernommen)"),
      h("div", { cls: "result" }, S.meta.signatures.map((s) => `${"  ".repeat(s.level - 1)}${[s.sig1, s.sig2, s.sig3].filter(Boolean).join(" ")}  ${s.name || ""}`).join("\n"))));
  }
}
async function afterImport() { S.personsCache = null; await loadMeta(); await loadBooks(); toast("Import abgeschlossen"); }

init().catch((e) => { console.error(e); toast("Fehler beim Start: " + e.message, true); });
