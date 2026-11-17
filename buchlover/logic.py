"""Fachlogik: Suche, Gruppen, Internetabfrage, Statistik, Export."""
from __future__ import annotations

import csv
import datetime as dt
import html
import io
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

from .db import Database, sniff_mime

# Suchfelder in Original-Reihenfolge (PRIV/Such_05): (Anzeige, SQL, Standard an)
SEARCH_FIELDS = [
    ("Autor", "SELECT id, author FROM books WHERE fold(author) LIKE :t", True),
    ("Titel", "SELECT id, title FROM books WHERE fold(title) LIKE :t", True),
    ("Mitwirkende", """SELECT bp.book_id, p.display_name FROM book_persons bp
        JOIN persons p ON p.id=bp.person_id
        WHERE fold(p.display_name) LIKE :t OR fold(p.sort_name) LIKE :t""", True),
    ("Übersetzer", "SELECT id, translator FROM books WHERE fold(translator) LIKE :t", True),
    ("Reihe", "SELECT id, series FROM books WHERE fold(series) LIKE :t", True),
    ("ISBN", "SELECT id, isbn FROM books WHERE fold(isbn) LIKE :t OR fold(ean) LIKE :t", True),
    ("Buchindex", "SELECT id, bx FROM books WHERE fold(bx) LIKE :t", True),
    ("Autorenindex", "SELECT id, ax FROM books WHERE fold(ax) LIKE :t", True),
    ("Klassifikation", "SELECT id, class FROM books WHERE fold(class) LIKE :t", True),
    ("Verlag", "SELECT id, publisher FROM books WHERE fold(publisher) LIKE :t", True),
    ("Bindung", "SELECT id, binding FROM books WHERE fold(binding) LIKE :t", False),
    ("Datum", "SELECT id, pub_date FROM books WHERE fold(pub_date) LIKE :t", False),
    ("Sprache", "SELECT id, language FROM books WHERE fold(language) LIKE :t", False),
    ("Originaltitel", "SELECT id, original_title FROM books WHERE fold(original_title) LIKE :t", True),
    ("Thema", "SELECT id, topic FROM books WHERE fold(topic) LIKE :t", True),
    ("Buchart", "SELECT id, book_type FROM books WHERE fold(book_type) LIKE :t", False),
    ("Standort", "SELECT id, location FROM books WHERE fold(location) LIKE :t", True),
    ("Schlagwort", "SELECT book_id, keyword FROM keywords WHERE fold(keyword) LIKE :t", True),
    ("Barcode", "SELECT id, barcode FROM books WHERE fold(barcode) LIKE :t", True),
    ("verliehen an", "SELECT book_id, borrower FROM loans WHERE fold(borrower) LIKE :t", True),
    ("Verleihnotiz", "SELECT book_id, note FROM loans WHERE fold(note) LIKE :t", False),
    ("Rezension", """SELECT book_id, coalesce(summary,'')||' '||coalesce(content,'') FROM reviews
        WHERE fold(summary) LIKE :t OR fold(content) LIKE :t""", True),
    ("Zitat", """SELECT book_id, coalesce(category,'')||' '||coalesce(text,'') FROM quotes
        WHERE fold(text) LIKE :t OR fold(category) LIKE :t""", True),
    ("Notizen", "SELECT id, notes FROM books WHERE fold(notes) LIKE :t", True),
    ("Inhalt", "SELECT id, content FROM books WHERE fold(content) LIKE :t", False),
    ("Biographie", """SELECT bp.book_id, p.biography FROM book_persons bp
        JOIN persons p ON p.id=bp.person_id WHERE fold(p.biography) LIKE :t""", False),
    ("eBook", "SELECT id, ebook_path FROM books WHERE fold(ebook_path) LIKE :t", False),
]
SEARCH_BY_LABEL = {f[0].lower(): f for f in SEARCH_FIELDS}
# Feldnamen aus Original-Gruppenaktionen (BLH_G1.Suchfeld)
SEARCH_ALIASES = {"autor": "autor", "title": "titel", "titel": "titel", "übersetzer": "übersetzer",
                  "reihe": "reihe", "standort": "standort", "verlag": "verlag", "isbn": "isbn",
                  "klassifizierung": "klassifikation", "klassifikation": "klassifikation",
                  "thema": "thema", "schlagwort": "schlagwort", "inhalt": "inhalt",
                  "mitwirkenden": "mitwirkende", "biographie": "biographie",
                  "buchindex": "buchindex", "autorenindex": "autorenindex"}


def fold(s):
    if s is None:
        return None
    return str(s).casefold()


def _snippet(text, term, width=60):
    text = re.sub(r"\s+", " ", str(text or ""))
    i = text.casefold().find(term)
    if i < 0 or len(text) <= width:
        return text[:width]
    start = max(0, i - width // 3)
    return ("…" if start else "") + text[start:start + width] + "…"


def search(db: Database, term: str, fields=None):
    """Liefert {book_id: 'Feld: Fundstelle'} – erstes Feld in Suchreihenfolge gewinnt."""
    term = (term or "").strip().casefold()
    if not term:
        return {}
    found = {}
    like = "%" + term.replace("%", r"\%").replace("_", r"\_") + "%"
    enabled = set(f.lower() for f in fields) if fields else {f[0].lower() for f in SEARCH_FIELDS if f[2]}
    for label, sql, _ in SEARCH_FIELDS:
        if label.lower() not in enabled:
            continue
        with db._lock:
            rows = db.conn.execute(sql, {"t": like}).fetchall()
        for bid, val in rows:
            if bid not in found:
                found[bid] = f"{label}: {_snippet(val, term)}"
    return found


def search_field(db: Database, field: str, term: str):
    key = SEARCH_ALIASES.get((field or "").strip().lower(), (field or "").strip().lower())
    f = SEARCH_BY_LABEL.get(key)
    if not f:
        return set(search(db, term).keys())
    return set(search(db, term, [f[0]]).keys())


# ------------------------------------------------------------------ Gruppen

GROUP_ACTIONS = [
    # code, Art, Beschreibung, Zusatz
    (10, "=", "Nimm alle Bücher", None),
    (40, "=", "Nimm alle gerade angezeigten Bücher", None),
    (50, "=", "Nimm nur Bücher mit Eigenschaft", "property"),
    (70, "=", "Nimm gar keine Bücher, fange leer an", None),
    (100, "±", "Einzelne Bücher per Mausklick an-/abwählen (Hervorhebungsmodus)", None),
    (200, "+", "Suche in Feld nach Begriff – addiere Treffer", "search"),
    (300, "-", "Suche in Feld nach Begriff – entferne Treffer", "search"),
    (400, "*", "Suche in Feld nach Begriff – belasse nur Treffer", "search"),
    (2100, "+", "Füge alle Bücher mit Eigenschaft hinzu", "property"),
    (2200, "-", "Entferne alle Bücher mit Eigenschaft", "property"),
    (2300, "*", "Belasse nur Bücher mit Eigenschaft", "property"),
    (3000, "E", "Vergebe an die Gruppenmitglieder zusätzlich die Eigenschaft", "property"),
    (3100, "E", "Vergebe nur den Gruppenmitgliedern die Eigenschaft (bei allen anderen löschen)", "property"),
    (3200, "E", "Nehme den Gruppenmitgliedern die Eigenschaft", "property"),
]
ACTION_INFO = {a[0]: a for a in GROUP_ACTIONS}


def apply_group(db: Database, gid: int, view_ids=None):
    actions = db.q("SELECT * FROM group_actions WHERE group_id=? ORDER BY nr, id", (gid,))
    all_ids = {r["id"] for r in db.q("SELECT id FROM books")}
    manual = {r["book_id"]: r["sign"] for r in
              db.q("SELECT book_id, sign FROM group_manual WHERE group_id=?", (gid,))}
    cur = set()
    manual_done = False

    def with_prop(bit):
        if bit is None:
            return set()
        return {r["id"] for r in db.q("SELECT id FROM books WHERE properties & ? <> 0", (1 << bit,))}

    def apply_manual(s):
        s = set(s)
        for b, sign in manual.items():
            if sign > 0:
                s.add(b)
            else:
                s.discard(b)
        return s & all_ids

    for a in actions:
        t0 = time.perf_counter()
        before = set(cur)
        code, bit = a["action"], a["property_bit"]
        if code == 10:
            cur = set(all_ids)
        elif code == 40:
            cur = set(view_ids or []) & all_ids
        elif code == 50:
            cur = with_prop(bit)
        elif code == 70:
            cur = set()
        elif code == 100:
            cur = apply_manual(cur)
            manual_done = True
        elif code == 200:
            cur |= search_field(db, a["field"], a["option"])
        elif code == 300:
            cur -= search_field(db, a["field"], a["option"])
        elif code == 400:
            cur &= search_field(db, a["field"], a["option"])
        elif code == 2100:
            cur |= with_prop(bit)
        elif code == 2200:
            cur -= with_prop(bit)
        elif code == 2300:
            cur &= with_prop(bit)
        elif code in (3000, 3100, 3200) and bit is not None:
            m = 1 << bit
            with db.tx() as c:
                if code == 3100:
                    c.execute("UPDATE books SET properties = properties & ~?", (m,))
                if code in (3000, 3100):
                    c.executemany("UPDATE books SET properties = properties | ? WHERE id=?",
                                  [(m, b) for b in cur])
                else:
                    c.executemany("UPDATE books SET properties = properties & ~? WHERE id=?",
                                  [(m, b) for b in cur])
        ms = int((time.perf_counter() - t0) * 1000)
        db.x("UPDATE group_actions SET count=?, moves=?, ms=? WHERE id=?",
             (len(cur), len(cur ^ before), ms, a["id"]))
    if not manual_done and manual:
        cur = apply_manual(cur)
    with db.tx() as c:
        c.execute("DELETE FROM group_members WHERE group_id=?", (gid,))
        c.executemany("INSERT INTO group_members VALUES(?,?)", [(gid, b) for b in cur])
    return len(cur)


def toggle_manual(db: Database, gid: int, book_id: int):
    """Hervorhebungsmodus: Klick schaltet Mitgliedschaft um und merkt sich die Aktion."""
    member = db.one("SELECT 1 FROM group_members WHERE group_id=? AND book_id=?", (gid, book_id))
    with db.tx() as c:
        if member:
            c.execute("DELETE FROM group_members WHERE group_id=? AND book_id=?", (gid, book_id))
            c.execute("INSERT OR REPLACE INTO group_manual VALUES(?,?,-1)", (gid, book_id))
        else:
            c.execute("INSERT INTO group_members VALUES(?,?)", (gid, book_id))
            c.execute("INSERT OR REPLACE INTO group_manual VALUES(?,?,1)", (gid, book_id))
        if not c.execute("SELECT 1 FROM group_actions WHERE group_id=? AND action=100",
                         (gid,)).fetchone():
            nr = (c.execute("SELECT MAX(nr) FROM group_actions WHERE group_id=?",
                            (gid,)).fetchone()[0] or 0) + 10
            c.execute("INSERT INTO group_actions(group_id,nr,action) VALUES(?,?,100)", (gid, nr))
    return not member


# ------------------------------------------------------------- ISBN-Abfrage

UA = "Buchlover/1.0 (+local book catalogue)"


def _get(url, timeout=12):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def clean_isbn(s):
    return re.sub(r"[^0-9Xx]", "", s or "").upper()


def lookup(query: str):
    """Sucht Buchdaten zu ISBN/EAN (DNB, dann Open Library). Liefert dict oder None."""
    isbn = clean_isbn(query)
    results = []
    errors = []
    if len(isbn) in (10, 13):
        for fn in (_lookup_dnb, _lookup_openlibrary):
            try:
                r = fn(isbn)
                if r:
                    results.append(r)
            except Exception as e:  # noqa
                errors.append(f"{fn.__name__[8:]}: {e}")
    else:
        try:
            results.extend(_search_dnb(query))
        except Exception as e:  # noqa
            errors.append(f"dnb: {e}")
    return {"results": results, "errors": errors}


_MARC = "{http://www.loc.gov/MARC21/slim}"
NONFILING = re.compile(r"[\x88\x89\x98\x9c]")


def _sru(query, maximum=1):
    url = ("https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&"
           "recordSchema=MARC21-xml&maximumRecords=%d&query=%s"
           % (maximum, urllib.parse.quote(query)))
    root = ET.fromstring(_get(url))
    return root.iter(_MARC + "record")


def _lookup_dnb(isbn):
    for rec in _sru("num=" + isbn):
        r = _parse_marc(rec)
        r["isbn"] = r.get("isbn") or isbn
        r["cover_url"] = f"https://portal.dnb.de/opac/mvb/cover?isbn={isbn}"
        return r
    return None


def _search_dnb(text):
    out = []
    words = " and ".join("woe=" + w for w in re.findall(r"\w+", text))
    for rec in _sru(words, maximum=10):
        r = _parse_marc(rec)
        if r.get("isbn"):
            r["cover_url"] = f"https://portal.dnb.de/opac/mvb/cover?isbn={r['isbn']}"
        out.append(r)
    return out


def _parse_marc(rec):
    def sub(tag, code):
        vals = []
        for df in rec.findall(f"{_MARC}datafield[@tag='{tag}']"):
            for sf in df.findall(f"{_MARC}subfield[@code='{code}']"):
                if sf.text:
                    vals.append(re.sub(NONFILING, "", sf.text).strip())
        return vals

    def first(tag, code):
        v = sub(tag, code)
        return v[0] if v else None

    r = {"source": "Deutsche Nationalbibliothek"}
    isbns = [clean_isbn(x) for x in sub("020", "a") + sub("020", "9")]
    isbns = [x for x in isbns if len(x) in (10, 13)]
    if isbns:
        r["isbn"] = isbns[0]
        r["ean"] = next((x for x in isbns if len(x) == 13), None)
    price = first("020", "c")
    if price:  # z.B. "Broschur : EUR 22.00 (DE), EUR 24.00 (AT)"
        if ":" in price:
            r["binding"], price = [x.strip() for x in price.split(":", 1)]
        m = re.search(r"EUR\s*[\d.,]+", price)
        r["list_price"] = m.group(0).replace(".", ",") if m else price
    persons = []
    for tag in ("100", "700"):
        for df in rec.findall(f"{_MARC}datafield[@tag='{tag}']"):
            name = None
            roles = []
            for sf in df:
                if sf.get("code") == "a":
                    name = (sf.text or "").strip()
                elif sf.get("code") in ("4", "e"):
                    roles.append((sf.text or "").strip())
            if name:
                role = "Autor"
                if any(x in ("trl", "Übersetzer") for x in roles):
                    role = "Übersetzer"
                elif any(x in ("edt", "Herausgeber") for x in roles):
                    role = "Herausgeber"
                elif any(x in ("ill", "Illustrator") for x in roles):
                    role = "Illustrator"
                persons.append({"sort_name": name, "display_name": _display_name(name),
                                "role": role})
    r["persons"] = persons
    authors = [p["display_name"] for p in persons if p["role"] == "Autor"]
    if authors:
        r["author"] = ", ".join(authors[:3])
        r["ax"] = next(p["sort_name"] for p in persons if p["role"] == "Autor")
    tr = [p["display_name"] for p in persons if p["role"] == "Übersetzer"]
    if tr:
        r["translator"] = ", ".join(tr)
    title = first("245", "a")
    subtitle = first("245", "b")
    if title:
        r["title"] = title.rstrip(" /:") + (f": {subtitle.rstrip(' /')}" if subtitle else "")
    ed = first("250", "a")
    if ed:
        r["auflage"] = ed
    pub = first("264", "b") or first("260", "b")
    if pub:
        r["publisher"] = pub
    date = first("264", "c") or first("260", "c")
    if date:
        r["pub_date"] = re.sub(r"[^\d-]", "", date)[:10] or date
    pages = first("300", "a")
    if pages:
        m = re.search(r"(\d+)\s*S", pages) or re.search(r"(\d+)", pages)
        if m:
            r["pages"] = int(m.group(1))
    series = first("490", "a")
    if series:
        vol = first("490", "v")
        r["series"] = series + (f" {vol}" if vol else "")
    lang = first("041", "a")
    if lang:
        r["language"] = {"ger": "Deutsch", "eng": "Englisch", "fre": "Französisch",
                         "spa": "Spanisch", "ita": "Italienisch"}.get(lang, lang)
    orig = first("240", "a") or first("246", "a")
    if orig:
        r["original_title"] = orig
    binding = first("020", "q")
    if binding:
        r["binding"] = binding
    for df in rec.findall(f"{_MARC}datafield[@tag='856']"):
        u = df.find(f"{_MARC}subfield[@code='u']")
        three = df.find(f"{_MARC}subfield[@code='3']")
        if u is not None and three is not None and "Inhaltstext" in (three.text or ""):
            r["content_url"] = u.text
    kw = sub("689", "a")
    if kw:
        r["keywords"] = list(dict.fromkeys(kw))[:10]
    return r


def _display_name(sort_name):
    if "," in sort_name:
        last, first = [x.strip() for x in sort_name.split(",", 1)]
        return f"{first} {last}".strip()
    return sort_name


def _lookup_openlibrary(isbn):
    data = json.loads(_get(
        f"https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data"))
    d = data.get(f"ISBN:{isbn}")
    if not d:
        return None
    r = {"source": "Open Library", "isbn": isbn}
    r["title"] = d.get("title", "") + (f": {d['subtitle']}" if d.get("subtitle") else "")
    authors = [a["name"] for a in d.get("authors", [])]
    if authors:
        r["author"] = ", ".join(authors)
        r["persons"] = [{"display_name": a, "sort_name": _sort_name(a), "role": "Autor"}
                        for a in authors]
        r["ax"] = _sort_name(authors[0])
    if d.get("publishers"):
        r["publisher"] = d["publishers"][0]["name"]
    if d.get("publish_date"):
        r["pub_date"] = d["publish_date"]
    if d.get("number_of_pages"):
        r["pages"] = d["number_of_pages"]
    if d.get("cover", {}).get("large"):
        r["cover_url"] = d["cover"]["large"]
    else:
        r["cover_url"] = f"https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg?default=false"
    subj = [s["name"] for s in d.get("subjects", [])][:10]
    if subj:
        r["keywords"] = subj
    return r


def _sort_name(display):
    parts = display.strip().split()
    if len(parts) < 2:
        return display
    return f"{parts[-1]}, {' '.join(parts[:-1])}"


def fetch_content_text(url):
    """DNB 'Inhaltstext' Seite -> reiner Text."""
    raw = _get(url).decode("utf-8", "replace")
    raw = re.sub(r"(?is)<(script|style).*?</\1>", "", raw)
    text = re.sub(r"<br\s*/?>|</p>", "\n", raw, flags=re.I)
    text = html.unescape(re.sub(r"<[^>]+>", "", text))
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    return text[:20000]


def fetch_image(url):
    data = _get(url, timeout=15)
    mime = sniff_mime(data)
    if not mime or not mime.startswith("image/") or len(data) < 500:
        return None
    return data


# ------------------------------------------------------------------ Statistik

def stats(db: Database):
    def grp(col, limit=12):
        return db.q(f"""SELECT coalesce(nullif(trim({col}),''),'(leer)') AS k, count(*) AS n
            FROM books GROUP BY k ORDER BY n DESC LIMIT {limit}""")
    total = db.one("SELECT count(*) n, sum(pages) pages FROM books")
    price_sum = 0.0
    for r in db.q("SELECT list_price FROM books WHERE list_price IS NOT NULL"):
        m = re.search(r"(\d+(?:[.,]\d{1,2})?)", r["list_price"].replace(".", "").replace(",", ".")
                      if re.search(r"\d,\d{2}\b", r["list_price"]) else r["list_price"])
        if m:
            try:
                price_sum += float(m.group(1).replace(",", "."))
            except ValueError:
                pass
    return {
        "books": total["n"], "pages": total["pages"] or 0,
        "value": round(price_sum, 2),
        "persons": db.one("SELECT count(*) n FROM persons")["n"],
        "loaned": db.one("SELECT count(DISTINCT book_id) n FROM loans WHERE return_date IS NULL")["n"],
        "wishlist": db.one("SELECT count(*) n FROM wishlist")["n"],
        "ebooks": db.one("SELECT count(*) n FROM books WHERE ebook_path IS NOT NULL "
                         "AND ebook_path<>''")["n"],
        "read": db.one("SELECT count(*) n FROM books WHERE read_status='gelesen' OR id IN "
                       "(SELECT book_id FROM reviews)")["n"],
        "by_class": grp("class"), "by_binding": grp("binding"),
        "by_language": grp("language"), "by_location": grp("location"),
        "by_status": grp("read_status"),
        "by_year": db.q("""SELECT substr(pub_date,1,4) AS k, count(*) n FROM books
            WHERE pub_date GLOB '[12][0-9][0-9][0-9]*' GROUP BY k ORDER BY k"""),
        "top_authors": db.q("""SELECT coalesce(nullif(ax,''),author) AS k, count(*) n FROM books
            WHERE coalesce(nullif(ax,''),author) IS NOT NULL GROUP BY k ORDER BY n DESC LIMIT 15"""),
        "reading_per_year": db.q("""SELECT substr(date,1,4) AS k, count(*) n FROM reviews
            WHERE date GLOB '[12][0-9][0-9][0-9]*' GROUP BY k ORDER BY k"""),
    }


def duplicates(db: Database):
    from .importer import _dupe_keys
    seen, out = {}, []
    for r in db.q("SELECT id,isbn,ean,author,title FROM books ORDER BY id"):
        for k in _dupe_keys(r["isbn"], r["ean"], r["author"], r["title"]):
            seen.setdefault(k, []).append(r)
    done = set()
    for k, rows in seen.items():
        ids = tuple(sorted(x["id"] for x in rows))
        if len(ids) > 1 and ids not in done:
            done.add(ids)
            out.append({"key": "ISBN" if k.startswith("i:") else "Autor+Titel", "books": rows})
    return out


# ------------------------------------------------------------------ Export

EXPORT_COLUMNS = [
    ("id", "Buchnummer"), ("isbn", "ISBN"), ("ean", "EAN"), ("bx", "BX"), ("ax", "AX"),
    ("class", "Klassifikation"), ("author", "Autor"), ("title", "Titel"), ("pages", "Seiten"),
    ("publisher", "Verlag"), ("binding", "Bindung"), ("list_price", "Listenpreis"),
    ("pub_date", "Datum"), ("translator", "Übersetzer"), ("original_title", "Originaltitel"),
    ("auflage", "Auflage"), ("language", "Sprache"), ("original_language", "Originalsprache"),
    ("series", "Reihe"), ("topic", "Thema"), ("book_type", "Buchart"),
    ("first_published", "Ersterscheinung"), ("location", "Standort"), ("condition", "Zustand"),
    ("barcode", "Barcode"), ("read_status", "Lesestatus"), ("my_rating", "Bewertung"),
    ("notes", "Notiz"), ("content", "Inhalt"), ("ebook_path", "eBook"),
]


def export_csv(db: Database, ids=None):
    rows = _rows(db, ids)
    props = {r["bit"]: r["name"] for r in db.q("SELECT bit,name FROM property_defs") if r["name"]}
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    w.writerow([c[1] for c in EXPORT_COLUMNS] + ["Eigenschaften", "Schlagwörter"])
    kw = {}
    for r in db.q("SELECT book_id, keyword FROM keywords"):
        kw.setdefault(r["book_id"], []).append(r["keyword"])
    for r in rows:
        p = ", ".join(n for b, n in props.items() if r["properties"] & (1 << b))
        w.writerow([r.get(c[0]) if r.get(c[0]) is not None else "" for c in EXPORT_COLUMNS]
                   + [p, ", ".join(kw.get(r["id"], []))])
    return ("﻿" + buf.getvalue()).encode("utf-8")


def _rows(db, ids):
    rows = db.q("SELECT * FROM books ORDER BY coalesce(bx, author, title)")
    if ids:
        order = {b: i for i, b in enumerate(ids)}
        rows = sorted((r for r in rows if r["id"] in order), key=lambda r: order[r["id"]])
    return rows


# Texte der HTML-Buchliste: von, Bücher, Stand, Datumsformat
HTML_EXPORT_TEXT = {
    "de": ("von", "Bücher", "Stand", "%d.%m.%Y"),
    "en": ("by", "books", "as of", "%Y-%m-%d"),
    "es": ("de", "libros", "a fecha de", "%d/%m/%Y"),
    "fr": ("de", "livres", "au", "%d/%m/%Y"),
    "ru": ("—", "книг", "на", "%d.%m.%Y"),
    "zh": ("—", "本书", "截至", "%Y-%m-%d"),
}


def export_html(db: Database, ids=None, title="Bücherliste", with_covers=True, lang="de"):
    """Kompakte HTML-Liste (wie 'mobile Buchliste' des Originals), Bilder eingebettet."""
    import base64
    rows = _rows(db, ids)
    by, books_w, asof, datefmt = HTML_EXPORT_TEXT.get(lang, HTML_EXPORT_TEXT["de"])
    owner = db.settings().get("owner") or ""
    parts = [f"""<!doctype html><html lang="{lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title>
<style>body{{font-family:system-ui,sans-serif;margin:0;padding:12px;background:#f6f4ef;color:#222}}
h1{{font-size:20px}} .b{{display:flex;gap:12px;background:#fff;border-radius:8px;padding:10px;margin:8px 0;
box-shadow:0 1px 2px #0002}} img{{width:64px;height:auto;border-radius:3px;flex:none}}
.t{{font-weight:600}} .m{{color:#666;font-size:13px}}
@media print{{.b{{break-inside:avoid;box-shadow:none;border:1px solid #ccc}}}}</style></head><body>
<h1>{html.escape(title)}{(f' {by} ' + html.escape(owner)) if owner else ''}</h1>
<p class="m">{len(rows)} {books_w} · {asof} {dt.date.today().strftime(datefmt)}</p>"""]
    for r in rows:
        img = ""
        if with_covers:
            im = db.one("SELECT mime,data FROM book_images WHERE book_id=? AND kind='cover'",
                        (r["id"],))
            if im and im["data"] and len(im["data"]) < 600000:
                img = (f'<img alt="" src="data:{im["mime"]};base64,'
                       f'{base64.b64encode(im["data"]).decode()}">')
        meta = " · ".join(html.escape(str(x)) for x in
                          (r["publisher"], r["pub_date"], r["isbn"], r["location"]) if x)
        parts.append(f'<div class="b">{img}<div><div class="t">{html.escape(r["title"] or "")}</div>'
                     f'<div>{html.escape(r["author"] or "")}</div><div class="m">{meta}</div></div></div>')
    parts.append("</body></html>")
    return "".join(parts).encode("utf-8")


def backup(db: Database, target_dir: str):
    os.makedirs(target_dir, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M")
    path = os.path.join(target_dir, f"{stamp}_buchlover.zip")
    tmp = path + ".sqlite"
    with db._lock:
        dst = __import__("sqlite3").connect(tmp)
        db.conn.backup(dst)
        dst.close()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(tmp, "buchlover.sqlite")
    os.remove(tmp)
    return path
