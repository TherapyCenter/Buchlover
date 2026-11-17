"""Lokaler HTTP-Server (nur 127.0.0.1) mit JSON-API und Weboberfläche."""
from __future__ import annotations

import json
import mimetypes
import os
import re
import sys
import threading
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import __version__, ebooks, importer, logic
from .db import BOOK_FIELDS, Database, sniff_mime
from .mdview import markdown_page
from .window import close_window, open_window

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")

SUB_TABLES = {
    "loans": ["book_id", "borrower", "loan_date", "due_date", "return_date", "remind", "note",
              "rating", "rating_comment"],
    "reviews": ["book_id", "kind", "rating", "date", "summary", "content"],
    "attachments": ["book_id", "nr", "kind", "name", "path", "description", "date"],
    "keywords": ["book_id", "keyword"],
    "quotes": ["book_id", "nr", "date", "category", "text"],
}
SALE_FIELDS = ["sale_place", "sale_price", "shipping", "postage", "weight", "dimensions",
               "condition", "currency", "buyer", "note", "acquired", "purchase_price",
               "purchase_source"]
LIST_COLUMNS = ["id", "author", "title", "bx", "ax", "class", "location", "pub_date",
                "publisher", "isbn", "ean", "barcode", "binding", "series", "language",
                "read_status", "my_rating", "properties", "updated_at", "created_at", "pages",
                "ebook_path"]
SORTABLE = set(LIST_COLUMNS) | {"fundstelle"}


class ApiError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


def _clean(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


class App:
    def __init__(self, db: Database, data_dir: str):
        self.db = db
        self.data_dir = data_dir

    # ------------------------------------------------------------------ books
    def list_books(self, qs):
        db = self.db
        q = qs.get("q", "")
        found = logic.search(db, q, qs.get("fields", "").split("|") if qs.get("fields") else None) \
            if q else None
        rows = db.q(f"SELECT {','.join('b.' + c for c in LIST_COLUMNS)} FROM books b")
        loaned = {r["book_id"] for r in db.q(
            "SELECT DISTINCT book_id FROM loans WHERE return_date IS NULL")}
        wish = {r["book_id"] for r in db.q("SELECT book_id FROM wishlist")}
        covers = {r["book_id"] for r in db.q(
            "SELECT book_id FROM book_images WHERE kind='cover'")}
        gid = qs.get("group")
        members = None
        if gid not in (None, ""):
            members = {r["book_id"] for r in db.q(
                "SELECT book_id FROM group_members WHERE group_id=?", (int(gid),))}
        props = int(qs.get("props") or 0)
        pmode = qs.get("pmode", "any")
        mode = qs.get("gmode", "show")  # show | highlight
        out = []
        for r in rows:
            if found is not None:
                if r["id"] not in found:
                    continue
                r["fundstelle"] = found[r["id"]]
            if props:
                hit = (r["properties"] & props) == props if pmode == "all" else r["properties"] & props
                if not hit:
                    continue
            if members is not None:
                r["member"] = r["id"] in members
                if mode == "show" and not r["member"]:
                    continue
            r["loaned"] = r["id"] in loaned
            r["wish"] = r["id"] in wish
            r["cover"] = r["id"] in covers
            out.append(r)
        sort = qs.get("sort") or "id"
        if sort not in SORTABLE:
            sort = "id"
        rev = qs.get("dir") == "desc"
        out.sort(key=lambda r: _sortkey(r.get(sort)), reverse=rev)
        return {"books": out, "total": db.one("SELECT count(*) n FROM books")["n"]}

    def get_book(self, bid):
        db = self.db
        b = db.one("SELECT * FROM books WHERE id=?", (bid,))
        if not b:
            raise ApiError(404, "Buch nicht gefunden")
        b["persons"] = db.q("""SELECT p.id, p.display_name, p.sort_name, bp.role, bp.position
            FROM book_persons bp JOIN persons p ON p.id=bp.person_id WHERE bp.book_id=?
            ORDER BY bp.position, p.sort_name""", (bid,))
        for t in SUB_TABLES:
            order = "keyword" if t == "keywords" else "id"
            b[t] = db.q(f"SELECT * FROM {t} WHERE book_id=? ORDER BY {order}", (bid,))
        b["wishlist"] = db.one("SELECT rank, reason FROM wishlist WHERE book_id=?", (bid,))
        b["sale"] = db.one("SELECT * FROM sales WHERE book_id=?", (bid,))
        b["images"] = [r["kind"] for r in db.q(
            "SELECT kind FROM book_images WHERE book_id=?", (bid,))]
        b["groups"] = [r["group_id"] for r in db.q(
            "SELECT group_id FROM group_members WHERE book_id=?", (bid,))]
        return b

    def save_book(self, bid, data):
        fields = {k: _clean(v) for k, v in data.items() if k in BOOK_FIELDS}
        if "properties" in fields:
            fields["properties"] = int(fields["properties"] or 0)
        for k in ("pages", "my_rating", "sort_order", "total_reviews"):
            if k in fields and fields[k] not in (None, ""):
                try:
                    fields[k] = int(fields[k])
                except (TypeError, ValueError):
                    raise ApiError(400, f"Feld {k}: nur Zahlen erlaubt")
        db = self.db
        if bid is None:
            new_id = data.get("id")
            if new_id:
                new_id = int(new_id)
                if db.one("SELECT 1 FROM books WHERE id=?", (new_id,)):
                    raise ApiError(409, f"Buchnummer {new_id} ist schon vergeben")
            else:
                new_id = db.next_book_id()
            fields["id"] = new_id
            cols = ",".join(fields)
            db.x(f"INSERT INTO books({cols}) VALUES({','.join('?' * len(fields))})",
                 list(fields.values()))
            bid = new_id
        else:
            if fields:
                sets = ",".join(f"{k}=?" for k in fields)
                db.x(f"UPDATE books SET {sets}, updated_at=datetime('now','localtime') WHERE id=?",
                     list(fields.values()) + [bid])
        if "keywords_text" in data:
            kws = [k.strip() for k in re.split(r"[;,\n]", data["keywords_text"] or "") if k.strip()]
            with db.tx() as c:
                c.execute("DELETE FROM keywords WHERE book_id=?", (bid,))
                c.executemany("INSERT INTO keywords(book_id,keyword) VALUES(?,?)",
                              [(bid, k) for k in dict.fromkeys(kws)])
        if "wishlist" in data:
            w = data["wishlist"]
            if w:
                db.x("INSERT OR REPLACE INTO wishlist VALUES(?,?,?)",
                     (bid, _clean(w.get("rank")), _clean(w.get("reason"))))
            else:
                db.x("DELETE FROM wishlist WHERE book_id=?", (bid,))
        if "sale" in data:
            s = data["sale"] or {}
            vals = [_clean(s.get(k)) for k in SALE_FIELDS]
            if any(vals):
                db.x(f"INSERT OR REPLACE INTO sales(book_id,{','.join(SALE_FIELDS)}) "
                     f"VALUES(?{',?' * len(SALE_FIELDS)})", [bid] + vals)
            else:
                db.x("DELETE FROM sales WHERE book_id=?", (bid,))
        return self.get_book(bid)

    def copy_book(self, bid):
        src = self.get_book(bid)
        data = {k: src.get(k) for k in BOOK_FIELDS}
        new = self.save_book(None, data)
        self.db.x("""INSERT INTO book_persons(book_id,person_id,position,role)
            SELECT ?, person_id, position, role FROM book_persons WHERE book_id=?""",
                  (new["id"], bid))
        return self.get_book(new["id"])

    # ---------------------------------------------------------------- persons
    def link_person(self, bid, data):
        db = self.db
        pid = data.get("person_id")
        name = _clean(data.get("name"))
        if not pid:
            if not name:
                raise ApiError(400, "Name fehlt")
            pid = self.find_or_create_person(name, data.get("sort_name"))
        pos = db.one("SELECT coalesce(max(position),0)+10 AS p FROM book_persons WHERE book_id=?",
                     (bid,))["p"]
        db.x("INSERT OR IGNORE INTO book_persons(book_id,person_id,position,role) VALUES(?,?,?,?)",
             (bid, pid, pos, _clean(data.get("role")) or "Autor"))
        return self.get_book(bid)

    def find_or_create_person(self, name, sort_name=None):
        db = self.db
        hit = db.one("""SELECT id FROM persons WHERE fold(display_name)=fold(?) OR
            fold(sort_name)=fold(?) UNION SELECT person_id FROM person_aliases
            WHERE fold(alias)=fold(?) LIMIT 1""", (name, name, name))
        if hit:
            return hit["id"]
        if "," in name:
            sort_name = sort_name or name
            name = logic._display_name(name)
        pid = db.next_person_id()
        db.x("INSERT INTO persons(id,sort_name,display_name) VALUES(?,?,?)",
             (pid, sort_name or logic._sort_name(name), name))
        return pid

    def get_person(self, pid):
        db = self.db
        p = db.one("SELECT * FROM persons WHERE id=?", (pid,))
        if not p:
            raise ApiError(404, "Mitwirkender nicht gefunden")
        p["aliases"] = [r["alias"] for r in db.q(
            "SELECT alias FROM person_aliases WHERE person_id=? ORDER BY alias", (pid,))]
        p["books"] = db.q("""SELECT b.id, b.title, b.author, b.pub_date, bp.role
            FROM book_persons bp JOIN books b ON b.id=bp.book_id WHERE bp.person_id=?
            ORDER BY b.pub_date, b.title""", (pid,))
        p["has_image"] = bool(db.one("SELECT 1 FROM person_images WHERE person_id=?", (pid,)))
        return p

    # ----------------------------------------------------------------- import
    def import_upload(self, kind, body, qs):
        if kind == "csv":
            rows = importer.read_csv(body)
        elif kind == "dbf":
            rows = importer.read_dbf(body)
        elif kind == "zip":
            tmp = os.path.join(self.data_dir, "upload_import.zip")
            with open(tmp, "wb") as fh:
                fh.write(body)
            try:
                return importer.import_buchliebhaber(
                    self.db, tmp, qs.get("mode", "merge"), qs.get("skip", "1") == "1")
            finally:
                os.remove(tmp)
        else:
            raise ApiError(400, "Unbekannter Dateityp")
        return importer.import_rows(self.db, rows, qs.get("skip", "1") == "1")


def _sortkey(v):
    if v is None or v == "":
        return (1, "")
    if isinstance(v, (int, float)):
        return (0, f"{v:020.4f}")
    return (0, str(v).casefold())


# ====================================================================== HTTP

ROUTES = []


def route(method, pattern):
    rx = re.compile("^" + pattern + "$")

    def deco(fn):
        ROUTES.append((method, rx, fn))
        return fn
    return deco


class Handler(BaseHTTPRequestHandler):
    app: App = None
    local_only = False
    server_version = f"Buchlover/{__version__}"

    def log_message(self, fmt, *args):  # quiet
        pass

    # helpers
    def _send(self, status, body, ctype="application/json; charset=utf-8", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path, ctype, headers=None):
        size = os.path.getsize(path)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        with open(path, "rb") as fh:
            while True:
                chunk = fh.read(1 << 20)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def _json(self):
        b = self._body()
        return json.loads(b.decode("utf-8")) if b else {}

    def _dispatch(self, method):
        # Schutz gegen DNS-Rebinding: lokal gebundener Server antwortet nur auf lokale Namen
        if self.local_only:
            hostname = urllib.parse.urlsplit("//" + self.headers.get("Host", "")).hostname or ""
            if hostname not in ("127.0.0.1", "localhost", "::1"):
                return self._send(403, {"error": "Fremder Ursprung"})
        # Nur lokale Zugriffe von der eigenen Oberfläche zulassen (CSRF-Schutz)
        if method != "GET":
            origin = self.headers.get("Origin")
            host = self.headers.get("Host", "")
            if origin and urllib.parse.urlparse(origin).netloc != host:
                return self._send(403, {"error": "Fremder Ursprung"})
        url = urllib.parse.urlparse(self.path)
        qs = {k: v[-1] for k, v in urllib.parse.parse_qs(url.query).items()}
        path = url.path
        try:
            for m, rx, fn in ROUTES:
                if m == method:
                    mt = rx.match(path)
                    if mt:
                        return fn(self, qs, *mt.groups())
            if method == "GET":
                return self._static(path)
            self._send(404, {"error": "Nicht gefunden"})
        except ApiError as e:
            self._send(e.status, {"error": str(e)})
        except FileNotFoundError as e:
            self._send(400, {"error": str(e)})
        except Exception as e:  # noqa
            traceback.print_exc()
            self._send(500, {"error": f"{type(e).__name__}: {e}"})

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def _static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        full = os.path.abspath(os.path.join(STATIC, path.lstrip("/")))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            return self._send(404, {"error": "Nicht gefunden"})
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as fh:
            self._send(200, fh.read(), ctype)


A = lambda h: h.app  # noqa: E731


@route("GET", r"/api/meta")
def _meta(h, qs):
    db = A(h).db
    pl = {}
    for r in db.q("SELECT field, value FROM picklists ORDER BY field, nr"):
        pl.setdefault(r["field"], []).append(r["value"])
    h._send(200, {
        "settings": db.settings(),
        "properties": db.q("SELECT bit, name FROM property_defs ORDER BY bit"),
        "groups": db.q("""SELECT g.id, g.name, (SELECT count(*) FROM group_members m
            WHERE m.group_id=g.id) AS members FROM groups g ORDER BY g.id"""),
        "picklists": pl,
        "search_fields": [{"label": f[0], "default": f[2]} for f in logic.SEARCH_FIELDS],
        "group_actions": [{"code": a[0], "art": a[1], "label": a[2], "extra": a[3]}
                          for a in logic.GROUP_ACTIONS],
        "signatures": db.q("SELECT * FROM signatures ORDER BY level, nr"),
        "total": db.one("SELECT count(*) n FROM books")["n"],
        "db_path": db.path,
        "version": __version__,
        "can_quit": getattr(A(h), "can_quit", True),
        "window_mode": getattr(A(h), "window_proc", None) is not None,
    })


@route("GET", r"/api/books")
def _books(h, qs):
    h._send(200, A(h).list_books(qs))


@route("POST", r"/api/books")
def _book_new(h, qs):
    h._send(200, A(h).save_book(None, h._json()))


@route("GET", r"/api/books/(\d+)")
def _book(h, qs, bid):
    h._send(200, A(h).get_book(int(bid)))


@route("PUT", r"/api/books/(\d+)")
def _book_put(h, qs, bid):
    h._send(200, A(h).save_book(int(bid), h._json()))


@route("DELETE", r"/api/books/(\d+)")
def _book_del(h, qs, bid):
    A(h).db.x("DELETE FROM books WHERE id=?", (int(bid),))
    h._send(200, {"ok": True})


@route("POST", r"/api/books/(\d+)/copy")
def _book_copy(h, qs, bid):
    h._send(200, A(h).copy_book(int(bid)))


@route("PUT", r"/api/books/(\d+)/properties")
def _book_props(h, qs, bid):
    d = h._json()
    A(h).db.x("UPDATE books SET properties=?, updated_at=datetime('now','localtime') WHERE id=?",
              (int(d.get("properties") or 0), int(bid)))
    h._send(200, {"ok": True})


@route("GET", r"/api/books/(\d+)/image/(\w+)")
def _img(h, qs, bid, kind):
    r = A(h).db.one("SELECT mime, data FROM book_images WHERE book_id=? AND kind=?",
                    (int(bid), kind))
    if not r and kind == "cover":
        r = A(h).db.one("SELECT mime, data FROM book_images WHERE book_id=? AND kind='cover_small'",
                        (int(bid),))
    if not r:
        return h._send(404, {"error": "kein Bild"})
    h._send(200, r["data"], r["mime"] or "application/octet-stream",
            {"Cache-Control": "max-age=60"})


@route("PUT", r"/api/books/(\d+)/image/(\w+)")
def _img_put(h, qs, bid, kind):
    data = h._body()
    mime = sniff_mime(data)
    if not mime or not mime.startswith("image/"):
        raise ApiError(400, "Keine Bilddatei")
    A(h).db.x("INSERT OR REPLACE INTO book_images VALUES(?,?,?,?)", (int(bid), kind, mime, data))
    h._send(200, {"ok": True})


@route("POST", r"/api/books/(\d+)/image/(\w+)/fetch")
def _img_fetch(h, qs, bid, kind):
    url = h._json().get("url", "")
    if not re.match(r"^https?://", url):
        raise ApiError(400, "Ungültige URL")
    try:
        data = logic.fetch_image(url)
    except Exception as e:  # noqa
        raise ApiError(502, f"Bild konnte nicht geladen werden: {e}")
    if not data:
        raise ApiError(404, "Unter dieser Adresse wurde kein Bild gefunden")
    A(h).db.x("INSERT OR REPLACE INTO book_images VALUES(?,?,?,?)",
              (int(bid), kind, sniff_mime(data), data))
    h._send(200, {"ok": True})


@route("DELETE", r"/api/books/(\d+)/image/(\w+)")
def _img_del(h, qs, bid, kind):
    A(h).db.x("DELETE FROM book_images WHERE book_id=? AND kind=?", (int(bid), kind))
    h._send(200, {"ok": True})


@route("POST", r"/api/books/(\d+)/persons")
def _bp_add(h, qs, bid):
    h._send(200, A(h).link_person(int(bid), h._json()))


@route("DELETE", r"/api/books/(\d+)/persons/(\d+)")
def _bp_del(h, qs, bid, pid):
    role = qs.get("role")
    db = A(h).db
    if role:
        db.x("DELETE FROM book_persons WHERE book_id=? AND person_id=? AND role=?",
             (int(bid), int(pid), role))
    else:
        db.x("DELETE FROM book_persons WHERE book_id=? AND person_id=?", (int(bid), int(pid)))
    h._send(200, A(h).get_book(int(bid)))


# --- Unterordner (Verleih, Rezensionen, Ablage, Zitate, Schlagwörter) -------
@route("POST", r"/api/sub/(\w+)")
def _sub_new(h, qs, table):
    cols = SUB_TABLES.get(table) or _bad()
    d = h._json()
    vals = [_clean(d.get(c)) for c in cols]
    cur = A(h).db.x(f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join('?' * len(cols))})",
                    vals)
    h._send(200, {"id": cur.lastrowid})


@route("PUT", r"/api/sub/(\w+)/(\d+)")
def _sub_put(h, qs, table, rid):
    cols = [c for c in (SUB_TABLES.get(table) or _bad()) if c != "book_id"]
    d = h._json()
    cols = [c for c in cols if c in d]
    if cols:
        A(h).db.x(f"UPDATE {table} SET {','.join(c + '=?' for c in cols)} WHERE id=?",
                  [_clean(d[c]) for c in cols] + [int(rid)])
    h._send(200, {"ok": True})


@route("DELETE", r"/api/sub/(\w+)/(\d+)")
def _sub_del(h, qs, table, rid):
    SUB_TABLES.get(table) or _bad()
    A(h).db.x(f"DELETE FROM {table} WHERE id=?", (int(rid),))
    h._send(200, {"ok": True})


def _bad():
    raise ApiError(400, "Unbekannte Tabelle")


# --- Listen über alle Bücher (Ordner Verleih, Wunschliste, Rezensionen …) ---
@route("GET", r"/api/lists/(\w+)")
def _lists(h, qs, name):
    db = A(h).db
    sql = {
        "loans": """SELECT l.*, b.title, b.author FROM loans l JOIN books b ON b.id=l.book_id
            ORDER BY (l.return_date IS NOT NULL), l.loan_date DESC""",
        "wishlist": """SELECT w.*, b.title, b.author, b.isbn, b.list_price FROM wishlist w
            JOIN books b ON b.id=w.book_id ORDER BY coalesce(w.rank, 9999), b.title""",
        "reviews": """SELECT r.*, b.title, b.author FROM reviews r JOIN books b ON b.id=r.book_id
            ORDER BY r.date DESC""",
        "quotes": """SELECT q.*, b.title, b.author FROM quotes q JOIN books b ON b.id=q.book_id
            ORDER BY q.category, q.date""",
        "keywords": """SELECT k.keyword, count(*) AS n, group_concat(k.book_id) AS ids
            FROM keywords k GROUP BY fold(k.keyword) ORDER BY fold(k.keyword)""",
        "attachments": """SELECT a.*, b.title, b.author FROM attachments a
            JOIN books b ON b.id=a.book_id ORDER BY a.date DESC""",
        "sales": """SELECT s.*, b.title, b.author FROM sales s JOIN books b ON b.id=s.book_id
            ORDER BY b.title""",
    }.get(name)
    if not sql:
        raise ApiError(404, "Unbekannte Liste")
    h._send(200, db.q(sql))


@route("GET", r"/api/distinct/(\w+)")
def _distinct(h, qs, field):
    """Die '..'-Funktion des Originals: bereits eingegebene Werte eines Feldes."""
    if field not in BOOK_FIELDS:
        raise ApiError(400, "Feld unbekannt")
    h._send(200, [r["v"] for r in A(h).db.q(
        f"SELECT DISTINCT {field} AS v FROM books WHERE {field} IS NOT NULL AND {field}<>'' "
        f"ORDER BY fold({field}) LIMIT 2000")])


# --- Mitwirkende ------------------------------------------------------------
@route("GET", r"/api/persons")
def _persons(h, qs):
    q = qs.get("q", "")
    rows = A(h).db.q("""SELECT p.id, p.sort_name, p.display_name,
        (SELECT count(*) FROM book_persons bp WHERE bp.person_id=p.id) AS books,
        (p.biography IS NOT NULL AND p.biography<>'') AS has_bio,
        EXISTS(SELECT 1 FROM person_images i WHERE i.person_id=p.id) AS has_image
        FROM persons p WHERE ?='' OR fold(p.sort_name) LIKE ? OR fold(p.display_name) LIKE ?
        OR p.id IN (SELECT person_id FROM person_aliases WHERE fold(alias) LIKE ?)
        ORDER BY fold(coalesce(p.sort_name,p.display_name))""",
                     (q,) + ("%" + q.casefold() + "%",) * 3)
    h._send(200, rows)


@route("POST", r"/api/persons")
def _person_new(h, qs):
    d = h._json()
    pid = A(h).find_or_create_person(_clean(d.get("display_name")) or _clean(d.get("sort_name")),
                                     _clean(d.get("sort_name")))
    h._send(200, A(h).get_person(pid))


@route("GET", r"/api/persons/(\d+)")
def _person(h, qs, pid):
    h._send(200, A(h).get_person(int(pid)))


@route("PUT", r"/api/persons/(\d+)")
def _person_put(h, qs, pid):
    d = h._json()
    pid = int(pid)
    db = A(h).db
    db.x("UPDATE persons SET sort_name=?, display_name=?, biography=? WHERE id=?",
         (_clean(d.get("sort_name")), _clean(d.get("display_name")), _clean(d.get("biography")),
          pid))
    if "aliases" in d:
        with db.tx() as c:
            c.execute("DELETE FROM person_aliases WHERE person_id=?", (pid,))
            for a in d["aliases"]:
                if _clean(a):
                    c.execute("INSERT OR REPLACE INTO person_aliases VALUES(?,?)", (a.strip(), pid))
    h._send(200, A(h).get_person(pid))


@route("DELETE", r"/api/persons/(\d+)")
def _person_del(h, qs, pid):
    A(h).db.x("DELETE FROM persons WHERE id=?", (int(pid),))
    h._send(200, {"ok": True})


@route("POST", r"/api/persons/(\d+)/merge/(\d+)")
def _person_merge(h, qs, pid, into):
    """Schreibfehler bereinigen: Person pid in Person 'into' aufgehen lassen."""
    pid, into = int(pid), int(into)
    db = A(h).db
    with db.tx() as c:
        c.execute("UPDATE OR IGNORE book_persons SET person_id=? WHERE person_id=?", (into, pid))
        for n in c.execute("SELECT display_name, sort_name FROM persons WHERE id=?", (pid,)).fetchone() or []:
            if n:
                c.execute("INSERT OR IGNORE INTO person_aliases VALUES(?,?)", (n, into))
        c.execute("UPDATE person_aliases SET person_id=? WHERE person_id=?", (into, pid))
        c.execute("DELETE FROM persons WHERE id=?", (pid,))
    h._send(200, A(h).get_person(into))


@route("GET", r"/api/persons/(\d+)/image")
def _pimg(h, qs, pid):
    r = A(h).db.one("SELECT mime, data FROM person_images WHERE person_id=?", (int(pid),))
    if not r:
        return h._send(404, {"error": "kein Bild"})
    h._send(200, r["data"], r["mime"])


@route("PUT", r"/api/persons/(\d+)/image")
def _pimg_put(h, qs, pid):
    data = h._body()
    mime = sniff_mime(data)
    if not mime or not mime.startswith("image/"):
        raise ApiError(400, "Keine Bilddatei")
    A(h).db.x("INSERT OR REPLACE INTO person_images VALUES(?,?,?)", (int(pid), mime, data))
    h._send(200, {"ok": True})


@route("DELETE", r"/api/persons/(\d+)/image")
def _pimg_del(h, qs, pid):
    A(h).db.x("DELETE FROM person_images WHERE person_id=?", (int(pid),))
    h._send(200, {"ok": True})


# --- Eigenschaften, Gruppen, Einstellungen, Auswahllisten --------------------
@route("PUT", r"/api/properties")
def _props_put(h, qs):
    with A(h).db.tx() as c:
        for p in h._json():
            c.execute("UPDATE property_defs SET name=? WHERE bit=?", (_clean(p.get("name")),
                                                                       int(p["bit"])))
    h._send(200, {"ok": True})


@route("GET", r"/api/groups/(\d+)")
def _group(h, qs, gid):
    db = A(h).db
    g = db.one("SELECT * FROM groups WHERE id=?", (int(gid),))
    if not g:
        raise ApiError(404, "Gruppe unbekannt")
    g["actions"] = db.q("SELECT * FROM group_actions WHERE group_id=? ORDER BY nr, id", (int(gid),))
    g["members"] = db.one("SELECT count(*) n FROM group_members WHERE group_id=?", (int(gid),))["n"]
    g["manual"] = db.one("SELECT count(*) n FROM group_manual WHERE group_id=?", (int(gid),))["n"]
    h._send(200, g)


@route("PUT", r"/api/groups/(\d+)")
def _group_put(h, qs, gid):
    d = h._json()
    A(h).db.x("UPDATE groups SET name=? WHERE id=?", (_clean(d.get("name")), int(gid)))
    h._send(200, {"ok": True})


@route("DELETE", r"/api/groups/(\d+)")
def _group_del(h, qs, gid):
    gid = int(gid)
    with A(h).db.tx() as c:
        for t in ("group_actions", "group_members", "group_manual"):
            c.execute(f"DELETE FROM {t} WHERE group_id=?", (gid,))
        c.execute("UPDATE groups SET name=NULL WHERE id=?", (gid,))
    h._send(200, {"ok": True})


@route("POST", r"/api/groups/(\d+)/actions")
def _gact_new(h, qs, gid):
    d = h._json()
    db = A(h).db
    nr = d.get("nr") or (db.one("SELECT coalesce(max(nr),0)+10 n FROM group_actions WHERE group_id=?",
                                (int(gid),))["n"])
    db.x("""INSERT INTO group_actions(group_id,nr,action,option,field,property_bit)
        VALUES(?,?,?,?,?,?)""", (int(gid), int(nr), int(d["action"]), _clean(d.get("option")),
                                 _clean(d.get("field")), d.get("property_bit")))
    if not db.one("SELECT name FROM groups WHERE id=?", (int(gid),))["name"]:
        db.x("UPDATE groups SET name=? WHERE id=?", (f"Gruppe {int(gid)}", int(gid)))
    h._send(200, {"ok": True})


@route("PUT", r"/api/group_actions/(\d+)")
def _gact_put(h, qs, aid):
    d = h._json()
    A(h).db.x("UPDATE group_actions SET nr=?, option=? WHERE id=?",
              (int(d.get("nr") or 0), _clean(d.get("option")), int(aid)))
    h._send(200, {"ok": True})


@route("DELETE", r"/api/group_actions/(\d+)")
def _gact_del(h, qs, aid):
    db = A(h).db
    a = db.one("SELECT * FROM group_actions WHERE id=?", (int(aid),))
    db.x("DELETE FROM group_actions WHERE id=?", (int(aid),))
    if a and a["action"] == 100:
        db.x("DELETE FROM group_manual WHERE group_id=?", (a["group_id"],))
    h._send(200, {"ok": True})


@route("POST", r"/api/groups/(\d+)/apply")
def _group_apply(h, qs, gid):
    d = h._json()
    n = logic.apply_group(A(h).db, int(gid), d.get("view_ids"))
    h._send(200, {"members": n})


@route("POST", r"/api/groups/(\d+)/toggle/(\d+)")
def _group_toggle(h, qs, gid, bid):
    h._send(200, {"member": logic.toggle_manual(A(h).db, int(gid), int(bid))})


@route("POST", r"/api/groups/(\d+)/copy/(\d+)")
def _group_copy(h, qs, gid, target):
    db = A(h).db
    gid, target = int(gid), int(target)
    if db.one("SELECT name FROM groups WHERE id=?", (target,))["name"]:
        raise ApiError(409, "Zielgruppe ist nicht leer")
    with db.tx() as c:
        name = c.execute("SELECT name FROM groups WHERE id=?", (gid,)).fetchone()[0]
        c.execute("UPDATE groups SET name=? WHERE id=?", ((name or "") + " (Kopie)", target))
        c.execute("""INSERT INTO group_actions(group_id,nr,action,option,field,property_bit)
            SELECT ?,nr,action,option,field,property_bit FROM group_actions WHERE group_id=?""",
                  (target, gid))
        c.execute("INSERT INTO group_manual SELECT ?,book_id,sign FROM group_manual WHERE group_id=?",
                  (target, gid))
        c.execute("INSERT INTO group_members SELECT ?,book_id FROM group_members WHERE group_id=?",
                  (target, gid))
    h._send(200, {"ok": True})


@route("POST", r"/api/groups/(\d+)/swap/(\d+)")
def _group_swap(h, qs, a, b):
    a, b = int(a), int(b)
    tmp = 999
    with A(h).db.tx() as c:
        c.execute("PRAGMA defer_foreign_keys=ON")
        c.execute("INSERT INTO groups(id,name) VALUES(?,NULL)", (tmp,))
        for t in ("group_actions", "group_members", "group_manual"):
            c.execute(f"UPDATE {t} SET group_id=? WHERE group_id=?", (tmp, a))
            c.execute(f"UPDATE {t} SET group_id=? WHERE group_id=?", (a, b))
            c.execute(f"UPDATE {t} SET group_id=? WHERE group_id=?", (b, tmp))
        na = c.execute("SELECT name FROM groups WHERE id=?", (a,)).fetchone()[0]
        nb = c.execute("SELECT name FROM groups WHERE id=?", (b,)).fetchone()[0]
        c.execute("UPDATE groups SET name=? WHERE id=?", (nb, a))
        c.execute("UPDATE groups SET name=? WHERE id=?", (na, b))
        c.execute("DELETE FROM groups WHERE id=?", (tmp,))
    h._send(200, {"ok": True})


@route("PUT", r"/api/settings")
def _settings_put(h, qs):
    with A(h).db.tx() as c:
        for k, v in h._json().items():
            c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (k, v))
    h._send(200, {"ok": True})


@route("PUT", r"/api/picklists/(\w+)")
def _pick_put(h, qs, field):
    vals = [v.strip() for v in h._json() if v and v.strip()]
    with A(h).db.tx() as c:
        c.execute("DELETE FROM picklists WHERE field=?", (field,))
        c.executemany("INSERT INTO picklists VALUES(?,?,?)",
                      [(field, i, v) for i, v in enumerate(dict.fromkeys(vals), 1)])
    h._send(200, {"ok": True})


# --- Import / Export / Werkzeug ------------------------------------------
@route("POST", r"/api/import/preview")
def _imp_prev(h, qs):
    h._send(200, importer.preview(h._json().get("path", "")))


@route("POST", r"/api/import/blh")
def _imp_blh(h, qs):
    d = h._json()
    h._send(200, importer.import_buchliebhaber(
        A(h).db, d.get("path", ""), d.get("mode", "merge"), bool(d.get("skip_duplicates", True))))


@route("POST", r"/api/import/upload/(\w+)")
def _imp_up(h, qs, kind):
    h._send(200, A(h).import_upload(kind, h._body(), qs))


@route("GET", r"/api/lookup")
def _lookup(h, qs):
    h._send(200, logic.lookup(qs.get("q", "")))


@route("GET", r"/api/lookup/content")
def _lookup_content(h, qs):
    url = qs.get("url", "")
    if not url.startswith("https://services.dnb.de/") and not url.startswith("https://d-nb.info/"):
        raise ApiError(400, "Nur DNB-Inhaltstexte werden geladen")
    h._send(200, {"text": logic.fetch_content_text(url)})


@route("GET", r"/api/stats")
def _stats(h, qs):
    h._send(200, logic.stats(A(h).db))


@route("GET", r"/api/duplicates")
def _dupes(h, qs):
    h._send(200, logic.duplicates(A(h).db))


def _ids(qs):
    return [int(x) for x in qs.get("ids", "").split(",") if x.strip().isdigit()] or None


@route("POST", r"/api/export/(csv|html)")
def _export(h, qs, kind):
    d = h._json()
    ids = [int(x) for x in d.get("ids") or []] or None
    if kind == "csv":
        body = logic.export_csv(A(h).db, ids)
        h._send(200, body, "text/csv; charset=utf-8",
                {"Content-Disposition": 'attachment; filename="buchliste.csv"'})
    else:
        lang = re.sub(r"[^a-z]", "", str(d.get("lang") or "de"))[:5] or "de"
        body = logic.export_html(A(h).db, ids, d.get("title") or "Bücherliste", lang=lang)
        h._send(200, body, "text/html; charset=utf-8",
                {"Content-Disposition": 'attachment; filename="buchliste.html"'})


@route("POST", r"/api/backup")
def _backup(h, qs):
    db = A(h).db
    target = db.settings().get("backup_dir") or os.path.join(A(h).data_dir, "backup")
    h._send(200, {"path": logic.backup(db, target)})


@route("GET", r"/handbuch")
def _handbook(h, qs):
    """Handbuch: Deutsch (HANDBUCH.md), für alle anderen Sprachen Englisch (MANUAL.md)."""
    lang = qs.get("lang") or (A(h).db.settings().get("ui_language") or "de")
    names = [("HANDBUCH.md", "Handbuch – Buchlover", "de")]
    if lang != "de":
        names.insert(0, ("MANUAL.md", "Manual – Buchlover", "en"))
    for name, title, hl in names:
        for p in (os.path.join(HERE, name), os.path.join(os.path.dirname(HERE), name)):
            if os.path.isfile(p):
                with open(p, encoding="utf-8") as fh:
                    return h._send(200, markdown_page(fh.read(), title, hl),
                                   "text/html; charset=utf-8")
    h._send(404, "Handbuch nicht gefunden", "text/plain; charset=utf-8")


@route("POST", r"/api/shutdown")
def _shutdown(h, qs):
    if not getattr(A(h), "can_quit", True):
        raise ApiError(403, "Im Docker-Betrieb wird Buchlover über den Container beendet")
    h._send(200, {"ok": True})
    proc = getattr(A(h), "window_proc", None)
    A(h).window_proc = None               # Fenster-Überwachung soll nicht doppelt beenden

    def stop():
        close_window(proc)                 # eigenes Programmfenster mit schließen
        h.server.shutdown()
    threading.Thread(target=stop, daemon=True).start()


@route("POST", r"/api/books/(\d+)/beacon")
def _book_beacon(h, qs, bid):
    """Speichern beim Schließen des Fensters (navigator.sendBeacon)."""
    A(h).save_book(int(bid), h._json())
    h._send(200, {"ok": True})


@route("POST", r"/api/open")
def _open_external(h, qs):
    """Externe Links (DNB, Wikipedia …) im normalen Browser statt im Programmfenster öffnen."""
    import webbrowser as wb
    url = h._json().get("url", "")
    if not re.match(r"^https?://", url) or re.match(r"^https?://(127\.0\.0\.1|localhost)[:/]", url):
        raise ApiError(400, "Ungültige Adresse")
    wb.open(url)
    h._send(200, {"ok": True})


# --- eBooks -----------------------------------------------------------------
EPUB_CSP = ("default-src 'self' data: blob:; script-src 'none'; object-src 'none'; "
            "style-src 'self' 'unsafe-inline' data:; img-src 'self' data: blob:; "
            "font-src 'self' data:; media-src 'self' data:; frame-src 'none'")


def _ebook_path(h, bid, must_exist=True):
    r = A(h).db.one("SELECT ebook_path FROM books WHERE id=?", (int(bid),))
    if not r:
        raise ApiError(404, "Buch nicht gefunden")
    p = ebooks.norm_path(r["ebook_path"])
    if not p:
        raise ApiError(404, "Kein eBook hinterlegt")
    if must_exist and not os.path.isfile(p):
        raise ApiError(404, "eBook-Datei nicht gefunden")
    return p


def _ebook_dirs(db, extra=None):
    raw = db.settings().get("ebook_dirs") or ""
    dirs = [d.strip() for d in re.split(r"[;\n]", raw) if d.strip()]
    if extra:
        dirs = [extra] + dirs
    if not dirs:   # nichts eingestellt: übliche Ordner im Benutzerverzeichnis
        dirs = [r["path"] for r in ebooks.roots()[1:]
                if os.path.dirname(os.path.abspath(r["path"])) != os.path.abspath(r["path"])
                and r["path"] not in ("/media", "/mnt", "/Volumes")]
    return list(dict.fromkeys(dirs))


@route("GET", r"/api/books/(\d+)/ebook")
def _ebook_info(h, qs, bid):
    db = A(h).db
    b = db.one("SELECT ebook_path, ebook_position, title FROM books WHERE id=?", (int(bid),))
    if not b:
        raise ApiError(404, "Buch nicht gefunden")
    p = ebooks.norm_path(b["ebook_path"])
    out = {"path": b["ebook_path"], "exists": bool(p) and os.path.isfile(p),
           "kind": ebooks.kind_of(p), "ext": ebooks.ext_of(p), "position": b["ebook_position"],
           "can_open": getattr(A(h), "can_quit", True), "title": b["title"]}
    if out["exists"]:
        out["size"] = os.path.getsize(p)
        if out["kind"] in ("epub", "cbz"):
            try:
                inf = ebooks.info(p)
            except Exception as e:  # noqa
                raise ApiError(422, f"eBook nicht lesbar: {e}")
            out.update(spine=inf["spine"], toc=inf["toc"], cover=inf["cover"], meta=inf["meta"])
    h._send(200, out)


@route("GET", r"/api/books/(\d+)/ebook/file")
def _ebook_file(h, qs, bid):
    p = _ebook_path(h, bid)
    name = urllib.parse.quote(os.path.basename(p))
    disp = "attachment" if qs.get("download") else "inline"
    kind = ebooks.kind_of(p)
    headers = {"Content-Disposition": f"{disp}; filename*=UTF-8''{name}",
               "X-Content-Type-Options": "nosniff"}
    if kind == "html":
        headers["Content-Security-Policy"] = EPUB_CSP
    elif kind != "pdf":
        headers["Content-Security-Policy"] = "sandbox"
    ctype = ebooks.mime_of(p)
    if ctype.startswith("text/"):
        ctype += "; charset=utf-8"
    h._send_file(p, ctype, headers)


@route("GET", r"/api/books/(\d+)/ebook/text")
def _ebook_text(h, qs, bid):
    p = _ebook_path(h, bid)
    h._send(200, ebooks.text_page(p, os.path.basename(p)), "text/html; charset=utf-8",
            {"Content-Security-Policy": EPUB_CSP})


@route("GET", r"/api/books/(\d+)/ebook/z/(.+)")
def _ebook_member(h, qs, bid, member):
    p = _ebook_path(h, bid)
    if ebooks.kind_of(p) not in ("epub", "cbz"):
        raise ApiError(400, "Kein EPUB/CBZ")
    try:
        data, mime = ebooks.zip_member(p, urllib.parse.unquote(member))
    except (KeyError, FileNotFoundError):
        raise ApiError(404, "Nicht gefunden")
    if mime.startswith("text/"):
        mime += "; charset=utf-8"
    h._send(200, data, mime, {"Content-Security-Policy": EPUB_CSP,
                              "X-Content-Type-Options": "nosniff",
                              "Cache-Control": "max-age=300"})


@route("PUT", r"/api/books/(\d+)/ebook/position")
def _ebook_pos(h, qs, bid):
    pos = h._json().get("position")
    A(h).db.x("UPDATE books SET ebook_position=? WHERE id=?",
              (None if pos is None else str(pos)[:500], int(bid)))
    h._send(200, {"ok": True})


@route("POST", r"/api/books/(\d+)/ebook/open")
def _ebook_open(h, qs, bid):
    if not getattr(A(h), "can_quit", True):
        raise ApiError(403, "Im Docker-Betrieb nicht möglich")
    ebooks.open_with_system(_ebook_path(h, bid))
    h._send(200, {"ok": True})


@route("POST", r"/api/books/(\d+)/ebook/find")
def _ebook_find(h, qs, bid):
    db = A(h).db
    d = h._json()
    b = db.one("SELECT id, isbn, ean, author, ax, title FROM books WHERE id=?", (int(bid),))
    if not b:
        raise ApiError(404, "Buch nicht gefunden")
    for k in ("isbn", "ean", "author", "title"):   # ungespeicherte Eingaben im Formular
        if d.get(k):
            b[k] = d[k]
    dirs = _ebook_dirs(db, ebooks.norm_path(d.get("dir")) or None)
    h._send(200, {"dirs": dirs, "results": ebooks.find_for_book(b, dirs)})


@route("GET", r"/api/books/(\d+)/ebook/meta")
def _ebook_meta(h, qs, bid):
    h._send(200, ebooks.lookup_record(_ebook_path(h, bid)))


@route("POST", r"/api/books/(\d+)/ebook/cover")
def _ebook_cover(h, qs, bid):
    data = ebooks.cover_bytes(_ebook_path(h, bid))
    mime = sniff_mime(data)
    if not data or not mime.startswith("image/"):
        raise ApiError(404, "Kein Cover im eBook")
    A(h).db.x("INSERT OR REPLACE INTO book_images VALUES(?,?,?,?)", (int(bid), "cover", mime, data))
    h._send(200, {"ok": True})


@route("GET", r"/api/fs")
def _fs(h, qs):
    try:
        h._send(200, ebooks.list_dir(qs.get("path", ""), qs.get("all") == "1"))
    except FileNotFoundError:
        raise ApiError(404, "Ordner nicht gefunden")


@route("POST", r"/api/ebooks/scan")
def _ebook_scan(h, qs):
    d = h._json()
    db = A(h).db
    dirs = [ebooks.norm_path(x) for x in (d.get("dirs") or []) if x and x.strip()] or _ebook_dirs(db)

    def link(bid, rec):
        for p in rec.get("persons") or []:
            A(h).link_person(bid, {"name": p["display_name"], "sort_name": p["sort_name"],
                                   "role": p["role"]})
    r = ebooks.scan_library(db, dirs, bool(d.get("apply")), bool(d.get("create")), link)
    r["dirs"] = dirs
    h._send(200, r)

# ====================================================================== main

class _Server(ThreadingHTTPServer):
    # Unter Windows erlaubt SO_REUSEADDR einen doppelten Start auf demselben Port.
    allow_reuse_address = sys.platform != "win32"
    daemon_threads = True

    def server_bind(self):
        import socket
        if sys.platform == "win32" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def _watch_window(proc, srv):
    """Fenster geschlossen -> Buchlover beenden. Endet der Prozess sofort, hat der
    Browser nur an ein schon offenes Fenster übergeben: dann nicht beenden."""
    import time
    t0 = time.monotonic()
    proc.wait()
    if time.monotonic() - t0 < 4:
        print("Programmfenster an laufende Instanz übergeben – Beenden über ⏻.")
        Handler.app.window_proc = None
        return
    time.sleep(1.0)                         # letzte Speicherung (Beacon) abwarten
    print("Programmfenster geschlossen – Buchlover wird beendet.")
    srv.shutdown()


def _already_running(url):
    import urllib.request
    try:
        with urllib.request.urlopen(url + "api/meta", timeout=2) as r:
            return r.status == 200 and b'"db_path"' in r.read()
    except Exception:  # noqa
        return False


def _default_data_dir():
    """Datenordner je Betriebssystem (überschreibbar mit --data / BUCHLOVER_DATA)."""
    portable = os.path.join(os.path.dirname(HERE), "data")
    if os.path.isdir(portable):            # portable Variante: ./data neben dem Programm
        return portable
    home = os.path.expanduser("~")
    if sys.platform == "win32":
        return os.path.join(os.environ.get("LOCALAPPDATA", home), "Buchlover")
    if sys.platform == "darwin":
        return os.path.join(home, "Library", "Application Support", "Buchlover")
    return os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share"),
                        "buchlover")


def main(argv=None):
    import argparse
    env = os.environ.get
    ap = argparse.ArgumentParser(description="Buchlover – OpenSource „Buchliebhaber“")
    ap.add_argument("--data", default=env("BUCHLOVER_DATA"),
                    help="Datenverzeichnis (Standard je Betriebssystem, siehe Handbuch)")
    ap.add_argument("--host", default=env("BUCHLOVER_HOST", "127.0.0.1"),
                    help="Netzwerkadresse (Standard 127.0.0.1 = nur dieser Rechner)")
    ap.add_argument("--port", type=int, default=int(env("BUCHLOVER_PORT", "8765")))
    ap.add_argument("--no-browser", action="store_true", default=bool(env("BUCHLOVER_NO_BROWSER")),
                    help="keine Oberfläche öffnen (nur Server)")
    ap.add_argument("--browser", action="store_true", default=bool(env("BUCHLOVER_BROWSER")),
                    help="im normalen Browser statt im eigenen Programmfenster öffnen")
    ap.add_argument("--import", dest="imp", metavar="PFAD",
                    help="Buchliebhaber-Ordner/Backup-ZIP beim Start importieren (zusammenführen)")
    ap.add_argument("--import-only", action="store_true",
                    help="nur importieren (--import) und beenden, ohne Server")
    ap.add_argument("--version", action="version", version=f"Buchlover {__version__}")
    args = ap.parse_args(argv)
    args.data = args.data or _default_data_dir()
    os.makedirs(args.data, exist_ok=True)
    if sys.stdout is None or sys.stderr is None:   # pythonw/App-Bundle: keine Konsole
        log = open(os.path.join(args.data, "buchlover.log"), "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log
    local_host = "127.0.0.1" if args.host in ("0.0.0.0", "::", "") else args.host
    url = f"http://{local_host}:{args.port}/"
    if not args.import_only and _already_running(url):
        if not args.no_browser:
            open_window(url, args.data, args.browser)
        return 0
    db = Database(os.path.join(args.data, "buchlover.sqlite"))
    if args.imp:
        try:
            print("Import:", importer.import_buchliebhaber(db, args.imp, "merge"))
        except Exception as e:  # noqa
            print("Import fehlgeschlagen:", e)
            if args.import_only:
                return 1
    if args.import_only:
        return 0
    Handler.app = App(db, args.data)
    Handler.local_only = args.host in ("127.0.0.1", "localhost", "::1")
    Handler.app.can_quit = not env("BUCHLOVER_DOCKER")
    try:
        srv = _Server((args.host, args.port), Handler)
    except OSError as e:
        print(f"Port {args.port} ist belegt: {e}")
        return 1
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(f"ACHTUNG: Buchlover ist im Netzwerk erreichbar ({args.host}:{args.port}) – "
              "ohne Passwortschutz. Nur in vertrauenswürdigen Netzen verwenden.")
    print(f"Buchlover {__version__} läuft auf {url}  (Datenbank: {db.path})  – Beenden mit Strg+C")
    Handler.app.window_proc = None
    if not args.no_browser:
        proc = open_window(url, args.data, args.browser)
        Handler.app.window_proc = proc
        if proc is not None:
            threading.Thread(target=_watch_window, args=(proc, srv), daemon=True).start()
    import signal

    def _term(*_):
        threading.Thread(target=srv.shutdown, daemon=True).start()
    try:
        signal.signal(signal.SIGTERM, _term)       # docker stop / systemd
    except (ValueError, AttributeError):
        pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
