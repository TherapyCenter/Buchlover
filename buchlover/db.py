"""SQLite storage for Buchlover (Nachbau des Buchliebhabers)."""
from __future__ import annotations

import os
import sqlite3
import threading

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS books (
    id              INTEGER PRIMARY KEY,      -- Buchnummer (BLHi)
    isbn            TEXT,
    ean             TEXT,
    bx              TEXT,                     -- Buchindex
    ax              TEXT,                     -- Autorenindex
    class           TEXT,                     -- Klassifikation / Signatur
    author          TEXT,
    title           TEXT,
    pages           INTEGER,
    publisher       TEXT,
    binding         TEXT,
    list_price      TEXT,
    pub_date        TEXT,
    avg_rating      REAL,
    total_reviews   INTEGER,
    translator      TEXT,
    original_title  TEXT,
    ausgabe         TEXT,
    auflage         TEXT,
    language        TEXT,
    original_language TEXT,
    condition       TEXT,
    series          TEXT,
    topic           TEXT,
    book_type       TEXT,
    first_published TEXT,
    location        TEXT,
    content         TEXT,                     -- Inhaltsangabe
    barcode         TEXT,
    properties      INTEGER NOT NULL DEFAULT 0, -- Bitmaske der Eigenschaften
    sort_order      INTEGER,
    -- Erweiterungen
    read_status     TEXT,                     -- ungelesen / lese gerade / gelesen / abgebrochen
    my_rating       INTEGER,                  -- 1..5 Sterne
    notes           TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    updated_at      TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_books_isbn ON books(isbn);
CREATE INDEX IF NOT EXISTS ix_books_ean ON books(ean);

CREATE TABLE IF NOT EXISTS book_images (
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    kind    TEXT NOT NULL,                    -- cover, cover_small, spine
    mime    TEXT,
    data    BLOB,
    PRIMARY KEY (book_id, kind)
);

CREATE TABLE IF NOT EXISTS persons (
    id           INTEGER PRIMARY KEY,
    sort_name    TEXT,                        -- "Nachname, Vorname"
    display_name TEXT,                        -- "Vorname Nachname"
    biography    TEXT
);
CREATE TABLE IF NOT EXISTS person_images (
    person_id INTEGER PRIMARY KEY REFERENCES persons(id) ON DELETE CASCADE,
    mime TEXT, data BLOB
);
CREATE TABLE IF NOT EXISTS person_aliases (
    alias     TEXT PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS book_persons (
    book_id   INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL DEFAULT 0,
    role      TEXT,
    PRIMARY KEY (book_id, person_id, role)
);

CREATE TABLE IF NOT EXISTS sales (               -- Verkauf / Erwerb
    book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    sale_place TEXT, sale_price TEXT, shipping TEXT, postage TEXT, weight TEXT,
    dimensions TEXT, condition TEXT, currency TEXT, buyer TEXT, note TEXT,
    acquired TEXT, purchase_price TEXT, purchase_source TEXT
);

CREATE TABLE IF NOT EXISTS loans (               -- Verleih
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    borrower TEXT, loan_date TEXT, due_date TEXT, return_date TEXT,
    remind TEXT, note TEXT, rating INTEGER, rating_comment TEXT
);

CREATE TABLE IF NOT EXISTS reviews (             -- Rezensionen / Lesehistorie
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    kind INTEGER, rating INTEGER, helpful INTEGER, total_votes INTEGER,
    date TEXT, summary TEXT, content TEXT
);

CREATE TABLE IF NOT EXISTS wishlist (
    book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    rank INTEGER, reason TEXT
);

CREATE TABLE IF NOT EXISTS attachments (         -- Web / Ablage
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    nr INTEGER, kind TEXT, name TEXT, path TEXT, description TEXT, date TEXT
);

CREATE TABLE IF NOT EXISTS keywords (            -- Schlagwörter
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_keywords_book ON keywords(book_id);

CREATE TABLE IF NOT EXISTS quotes (              -- Zitate
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    nr INTEGER, date TEXT, category TEXT, text TEXT
);

CREATE TABLE IF NOT EXISTS property_defs (       -- Eigenschaften (Bit 0..29)
    bit  INTEGER PRIMARY KEY,
    name TEXT
);

CREATE TABLE IF NOT EXISTS groups (              -- Gruppen (max. 31)
    id   INTEGER PRIMARY KEY,                    -- Bit 0..30
    name TEXT
);
CREATE TABLE IF NOT EXISTS group_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    nr INTEGER NOT NULL,
    action INTEGER NOT NULL,                     -- Aktionscode (wie Original: 10, 200, 2100 ...)
    option TEXT, field TEXT, property_bit INTEGER,
    count INTEGER, moves INTEGER, ms INTEGER
);
CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    book_id  INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, book_id)
);
CREATE TABLE IF NOT EXISTS group_manual (         -- Mausklick +/-
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    book_id  INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    sign     INTEGER NOT NULL,                    -- +1 / -1
    PRIMARY KEY (group_id, book_id)
);

CREATE TABLE IF NOT EXISTS signatures (
    level INTEGER, nr INTEGER, sig1 TEXT, sig2 TEXT, sig3 TEXT, name TEXT,
    PRIMARY KEY (level, nr)
);

CREATE TABLE IF NOT EXISTS picklists (
    field TEXT, nr INTEGER, value TEXT,
    PRIMARY KEY (field, nr)
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT, comment TEXT
);

CREATE TABLE IF NOT EXISTS field_colors (
    book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
    field TEXT, color INTEGER, font_color INTEGER,
    PRIMARY KEY (book_id, field)
);
"""

BOOK_FIELDS = [
    "isbn", "ean", "bx", "ax", "class", "author", "title", "pages", "publisher",
    "binding", "list_price", "pub_date", "avg_rating", "total_reviews",
    "translator", "original_title", "ausgabe", "auflage", "language",
    "original_language", "condition", "series", "topic", "book_type",
    "first_published", "location", "content", "barcode", "properties",
    "sort_order", "read_status", "my_rating", "notes",
]

DEFAULT_PROPERTIES = [
    "spannend", "empfehlenswert", "langweilig", "nachgemacht (Plagiat)",
    "für Urlaub aufsparen", "demnächst lesen", "Sachbuch", "Roman", "Novelle",
    "Krimi", "verkaufen",
]

DEFAULT_PICKLISTS = {
    "role": ["Autor", "Autorin", "Herausgeber", "Illustrator", "Übersetzer",
             "Sprecher", "Sprecherin", "Regie", "Vorleser", "Vorleserin"],
    "binding": ["Gebundene Ausgabe", "Taschenbuch", "Broschiert", "eBook",
                "Hörbuch", "CD", "DVD"],
    "book_type": ["Fachbuch", "Unterhaltung", "Roman", "Kinderbuch", "Sachbuch"],
    "language": ["Deutsch", "Englisch", "Französisch"],
    "condition": ["wie neu", "leichte Gebrauchsspuren", "starke Gebrauchsspuren"],
    "read_status": ["ungelesen", "lese gerade", "gelesen", "abgebrochen"],
}

DEFAULT_SETTINGS = {
    "label.series": "Reihe",
    "label.book_type": "Buchart",
    "label.location": "Standort",
    "label.topic": "Thema",
    "label.translator": "Übersetzer",
    "label.original_title": "Originaltitel",
    "label.original_language": "Originalsprache",
    "label.first_published": "Ersterscheinung",
    "confirm_delete": "Ja",
    "owner": "",
    "lookup_overwrite": "Nein",
    "bx_from_author": "Ja",
}


class Database:
    def __init__(self, path: str):
        self.path = path
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.create_function(
            "fold", 1, lambda s: None if s is None else str(s).casefold(), deterministic=True)
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.executescript(SCHEMA)
        self._seed()

    # -- helpers -----------------------------------------------------------
    def q(self, sql, params=()):
        with self._lock:
            return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def one(self, sql, params=()):
        with self._lock:
            r = self.conn.execute(sql, params).fetchone()
            return dict(r) if r else None

    def x(self, sql, params=()):
        with self._lock:
            cur = self.conn.execute(sql, params)
            self.conn.commit()
            return cur

    def tx(self):
        return _Tx(self)

    def _seed(self):
        with self._lock:
            c = self.conn
            if not c.execute("SELECT 1 FROM property_defs LIMIT 1").fetchone():
                for i in range(30):
                    c.execute("INSERT INTO property_defs(bit,name) VALUES(?,?)",
                              (i, DEFAULT_PROPERTIES[i] if i < len(DEFAULT_PROPERTIES) else None))
            if not c.execute("SELECT 1 FROM groups LIMIT 1").fetchone():
                for i in range(31):
                    c.execute("INSERT INTO groups(id,name) VALUES(?,NULL)", (i,))
            if not c.execute("SELECT 1 FROM picklists LIMIT 1").fetchone():
                for field, vals in DEFAULT_PICKLISTS.items():
                    for n, v in enumerate(vals, 1):
                        c.execute("INSERT INTO picklists VALUES(?,?,?)", (field, n, v))
            for k, v in DEFAULT_SETTINGS.items():
                c.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (k, v))
            c.commit()

    def next_book_id(self):
        r = self.one("SELECT MAX(id) AS m FROM books")
        return (r["m"] or 0) + 1

    def next_person_id(self):
        r = self.one("SELECT MAX(id) AS m FROM persons")
        return (r["m"] or 0) + 1

    def settings(self):
        return {r["key"]: r["value"] for r in self.q("SELECT key,value FROM settings")}


class _Tx:
    def __init__(self, db):
        self.db = db

    def __enter__(self):
        self.db._lock.acquire()
        self.db.conn.execute("BEGIN")
        return self.db.conn

    def __exit__(self, et, ev, tb):
        try:
            if et:
                self.db.conn.rollback()
            else:
                self.db.conn.commit()
        finally:
            self.db._lock.release()
        return False


def sniff_mime(data: bytes | None):
    if not data:
        return None
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:2] == b"BM":
        return "image/bmp"
    if data[:4] == b"GIF8":
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"
