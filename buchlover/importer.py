"""Import existing Buchliebhaber databases (Paradox) and generic CSV/DBF files."""
from __future__ import annotations

import csv
import datetime as dt
import glob
import io
import os
import re
import shutil
import struct
import tempfile
import zipfile

from . import paradox
from .db import Database, sniff_mime

# ---------------------------------------------------------------- utilities


def _norm(s):
    return (s or "").strip().lower()


class Source:
    """Locates the WORK / PRIV / image folders of a Buchliebhaber installation."""

    def __init__(self, path: str):
        self.tmp = None
        path = os.path.abspath(path)
        if os.path.isfile(path) and path.lower().endswith(".zip"):
            path = self._extract_zips(path)
        self.work = self._find_work(path)
        if not self.work:
            raise FileNotFoundError(
                "Keine Buchliebhaber-Datenbank gefunden (BLH_0.DB fehlt). Bitte den "
                "Buchliebhaber-Ordner (z.B. C:\\Buchliebhaber), den WORK-Ordner oder "
                "ein Backup-ZIP angeben.")
        self.root = os.path.dirname(self.work)
        self.priv = self._subdir(self.root, "PRIV")
        self._files = {}
        for f in os.listdir(self.work):
            self._files[f.lower()] = os.path.join(self.work, f)

    def _extract_zips(self, zpath):
        self.tmp = tempfile.mkdtemp(prefix="blh_import_")
        zips = [zpath]
        m = re.match(r"^(\d{8}_\d{4})_", os.path.basename(zpath))
        if m:  # Original: "alle anderen erforderlichen Dateien werden automatisch dazu geladen"
            zips = sorted(glob.glob(os.path.join(os.path.dirname(zpath), m.group(1) + "_*.zip")))
        for z in zips:
            name = os.path.splitext(os.path.basename(z))[0]
            target = os.path.join(self.tmp, name)
            with zipfile.ZipFile(z) as zf:
                for member in zf.infolist():
                    # zip-slip protection
                    dest = os.path.abspath(os.path.join(target, member.filename))
                    if not dest.startswith(os.path.abspath(target)):
                        continue
                    zf.extract(member, target)
        self._merge_extracted(self.tmp)
        return self.tmp

    def _merge_extracted(self, base):
        """Backups are split per folder (…_BLH_W.zip, …_BLH_P.zip, …). Build a
        virtual installation layout <base>/inst/{WORK,PRIV,COVER,Autor,...}."""
        inst = os.path.join(base, "inst")
        os.makedirs(inst, exist_ok=True)
        for dirpath, _dirs, files in os.walk(base):
            if dirpath.startswith(inst):
                continue
            lower = {f.lower() for f in files}
            if "blh_0.db" in lower:
                dest = "WORK"
            elif "privat.db" in lower:
                dest = "PRIV"
            elif any(re.match(r"\d+_l\.(jpg|jpeg|png|bmp)$", f) for f in lower):
                dest = "COVER"
            elif any(re.match(r"\d+_a\.(jpg|jpeg|png|bmp)$", f) for f in lower):
                dest = "Autor"
            else:
                continue
            tdir = os.path.join(inst, dest)
            os.makedirs(tdir, exist_ok=True)
            for f in files:
                shutil.copy2(os.path.join(dirpath, f), os.path.join(tdir, f))

    @staticmethod
    def _subdir(base, name):
        if not base or not os.path.isdir(base):
            return None
        for d in os.listdir(base):
            if d.lower() == name.lower() and os.path.isdir(os.path.join(base, d)):
                return os.path.join(base, d)
        return None

    def _find_work(self, path):
        if os.path.isfile(os.path.join(path, "BLH_0.DB")) or any(
                f.lower() == "blh_0.db" for f in os.listdir(path)):
            return path
        for cand in ("inst/WORK", "WORK"):
            p = os.path.join(path, cand)
            if os.path.isdir(p):
                return self._find_work(p)
        for dirpath, _dirs, files in os.walk(path):
            if any(f.lower() == "blh_0.db" for f in files):
                return dirpath
        return None

    def table(self, name, priv=False):
        if priv:
            if not self.priv:
                return None
            for f in os.listdir(self.priv):
                if f.lower() == name.lower() + ".db":
                    return paradox.open_table(os.path.join(self.priv, f))
            return None
        p = self._files.get(name.lower() + ".db")
        return paradox.open_table(p) if p else None

    def rows(self, name, priv=False):
        try:
            t = self.table(name, priv)
        except paradox.ParadoxError:
            return []
        return list(t) if t else []

    def image(self, folder, pattern):
        d = self._subdir(self.root, folder)
        if not d:
            return None
        for f in os.listdir(d):
            if re.fullmatch(pattern, f, re.I):
                with open(os.path.join(d, f), "rb") as fh:
                    return fh.read()
        return None

    def images(self, folder):
        d = self._subdir(self.root, folder)
        return [(f, os.path.join(d, f)) for f in os.listdir(d)] if d else []

    def cleanup(self):
        if self.tmp:
            shutil.rmtree(self.tmp, ignore_errors=True)


def _s(v):
    if v is None:
        return None
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    if isinstance(v, str):
        v = v.replace("\r\n", "\n").strip()
        return v or None
    return v


def _bit(value):
    """Original stores bit *values* (1,2,4..). Return bit index."""
    if not value or value <= 0:
        return None
    b = value.bit_length() - 1
    return b if (1 << b) == value else None


# ---------------------------------------------------------------- preview

TABLE_LABELS = {
    "BLH_0": "Bücher", "OM_M": "Mitwirkende", "OM_Z": "Buch↔Mitwirkende",
    "BLH_6": "Cover (klein)", "BLH_7_I": "Inhaltsangaben", "BLH_8": "Rezensionen",
    "BLH_4": "Verleihvorgänge", "BLH_3": "Verkauf/Erwerb", "BLH_9_Wu": "Wunschliste",
    "BLH_AW": "Web/Ablage", "WW12": "Schlagwörter", "T8": "Zitate",
    "BLH_G0": "Gruppen", "BLH_E_0": "Eigenschaften",
}


def preview(path):
    src = Source(path)
    try:
        out = {"work": src.work, "priv": src.priv, "tables": []}
        for name, label in TABLE_LABELS.items():
            try:
                t = src.table(name)
                n = t.num_records if t else 0
            except Exception as e:  # noqa
                n = f"Fehler: {e}"
            out["tables"].append({"table": name, "label": label, "records": n})
        out["covers"] = len([f for f, _ in src.images("COVER") if re.match(r"\d+_", f)])
        out["author_images"] = len([f for f, _ in src.images("Autor") if re.match(r"\d+_", f)])
        return out
    finally:
        src.cleanup()


# ---------------------------------------------------------------- import


def import_buchliebhaber(db: Database, path: str, mode: str = "merge",
                         skip_duplicates: bool = True):
    """mode = 'replace' (Datenbank leeren, Nummern übernehmen) oder 'merge'."""
    src = Source(path)
    stats = {}
    try:
        with db.tx() as c:
            if mode == "replace":
                for t in ("group_manual", "group_members", "group_actions", "field_colors",
                          "keywords", "quotes", "attachments", "wishlist", "reviews",
                          "loans", "sales", "book_persons", "person_aliases",
                          "person_images", "persons", "book_images", "books",
                          "signatures"):
                    c.execute(f"DELETE FROM {t}")
            _Importer(c, src, mode, skip_duplicates, stats).run()
        return stats
    finally:
        src.cleanup()


class _Importer:
    def __init__(self, c, src, mode, skip_dupes, stats):
        self.c, self.src, self.mode, self.skip_dupes, self.stats = c, src, mode, skip_dupes, stats
        self.book_map = {}     # old BLHi -> new id
        self.person_map = {}   # old Im01 -> new id
        self.prop_map = {}     # old bit -> new bit
        self.group_map = {}    # old group bit -> new group id
        self.existing_groups = set()

    def count(self, key, n=1):
        self.stats[key] = self.stats.get(key, 0) + n

    def run(self):
        self.properties()
        self.books()
        self.persons()
        self.subtables()
        self.groups()
        self.lookups()

    # -- Eigenschaften ----------------------------------------------------
    def properties(self):
        c = self.c
        existing = {r[0]: r[1] for r in c.execute("SELECT bit,name FROM property_defs")}
        by_name = {_norm(n): b for b, n in existing.items() if n}
        for r in self.src.rows("BLH_E_0"):
            bit, name = r.get("Stelle"), _s(r.get("Eigenschaft"))
            if bit is None or not (0 <= bit < 30):
                continue
            if self.mode == "replace":
                c.execute("UPDATE property_defs SET name=? WHERE bit=?", (name, bit))
                self.prop_map[bit] = bit
            elif name:
                if _norm(name) in by_name:
                    self.prop_map[bit] = by_name[_norm(name)]
                else:
                    free = [b for b, n in existing.items() if not n]
                    if free:
                        nb = free[0]
                        existing[nb] = name
                        by_name[_norm(name)] = nb
                        c.execute("UPDATE property_defs SET name=? WHERE bit=?", (name, nb))
                        self.prop_map[bit] = nb

    def map_props(self, mask):
        if not mask:
            return 0
        out = 0
        for bit in range(30):
            if mask & (1 << bit):
                nb = self.prop_map.get(bit, bit if self.mode == "replace" else None)
                if nb is not None:
                    out |= 1 << nb
        return out

    # -- Bücher ----------------------------------------------------------
    def books(self):
        c, src = self.c, self.src
        b1 = {r["BLHi"]: r for r in src.rows("BLH_1")}
        b2 = {r["BLHi"]: r for r in src.rows("BLH_2")}
        b7 = {r["BLHi"]: r for r in src.rows("BLH_7_I")}
        bc = {r["BLHi"]: r for r in src.rows("BLH_BC")}
        b6 = {r["BLHi"]: r for r in src.rows("BLH_6")}
        cover_files = {}
        for f, full in src.images("COVER"):
            m = re.match(r"(\d+)_L\.", f, re.I)
            if m:
                cover_files[int(m.group(1))] = full
        spine_files = {}
        for f, full in src.images("BR"):
            m = re.match(r"(\d+)_", f)
            if m:
                spine_files[int(m.group(1))] = full

        existing_keys = {}
        if self.mode == "merge" and self.skip_dupes:
            for r in c.execute("SELECT id,isbn,ean,author,title FROM books"):
                for k in _dupe_keys(r[1], r[2], r[3], r[4]):
                    existing_keys[k] = r[0]
        used_ids = {r[0] for r in c.execute("SELECT id FROM books")}
        next_id = max(used_ids, default=0) + 1

        for r in src.rows("BLH_0"):
            old = r.get("BLHi")
            if old is None:
                continue
            r1, r2 = b1.get(old, {}), b2.get(old, {})
            isbn = _s(r.get("ISBN")) or _s(r.get("ISBNf"))
            ean = _s(r.get("EAN"))
            if ean and len(ean) < 10:   # "978" Platzhalter
                ean = None
            author, title = _s(r1.get("AUTHOR")), _s(r1.get("TITLE"))
            if self.mode == "merge" and self.skip_dupes:
                hit = next((existing_keys[k] for k in _dupe_keys(isbn, ean, author, title)
                            if k in existing_keys), None)
                if hit:
                    self.book_map[old] = None  # übersprungen
                    self.count("Bücher übersprungen (Dublette)")
                    continue
            new = old
            if new in used_ids:
                new = next_id
            used_ids.add(new)
            next_id = max(next_id, new + 1)
            self.book_map[old] = new
            content = _s(b7.get(old, {}).get("Inhalt"))
            barcode = _s(bc.get(old, {}).get("Anzeige")) or _s(bc.get(old, {}).get("Barcode"))
            c.execute("""INSERT INTO books(id,isbn,ean,bx,ax,class,author,title,pages,publisher,
                binding,list_price,pub_date,avg_rating,total_reviews,translator,original_title,
                ausgabe,auflage,language,original_language,condition,series,topic,book_type,
                first_published,location,content,barcode,properties,sort_order)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                new, isbn, ean, _s(r.get("BX")), _s(r.get("AX")), _s(r.get("Class")),
                author, title, r1.get("PAGES"), _s(r1.get("PUBLISHER")),
                _s(r1.get("BINDING")), _s(r1.get("LISTPRICE")), _s(r1.get("PUBDATE")),
                r1.get("AverageRating"), r1.get("TotalReviews"),
                _s(r2.get("Translator")), _s(r2.get("Orginaltitel")), _s(r2.get("Ausgabe")),
                _s(r2.get("Auflage")), _s(r2.get("Sprache")), _s(r2.get("Orginalsprache")),
                _s(r2.get("Zustand")), _s(r2.get("Reihe")), _s(r2.get("Thema")),
                _s(r2.get("Buchart")), _s(r2.get("Ersterscheinung")), _s(r2.get("Standort")),
                content, barcode, self.map_props(r.get("Eigenschaft") or 0), r.get("Sortierung")))
            for k in _dupe_keys(isbn, ean, author, title):
                existing_keys.setdefault(k, new)
            self.count("Bücher")
            # Bilder
            if old in cover_files:
                with open(cover_files[old], "rb") as fh:
                    data = fh.read()
                self._img(new, "cover", data)
                self.count("Cover")
            small = b6.get(old, {}).get("Cover")
            if small:
                self._img(new, "cover_small", small)
                if old not in cover_files:
                    self._img(new, "cover", small)
                    self.count("Cover")
            if old in spine_files:
                with open(spine_files[old], "rb") as fh:
                    self._img(new, "spine", fh.read())

    def _img(self, book_id, kind, data):
        self.c.execute("INSERT OR REPLACE INTO book_images VALUES (?,?,?,?)",
                       (book_id, kind, sniff_mime(data), data))

    def bid(self, old):
        return self.book_map.get(old)

    # -- Mitwirkende ---------------------------------------------------------
    def persons(self):
        c, src = self.c, self.src
        by_name = {}
        for pid, sn, dn in c.execute("SELECT id,sort_name,display_name FROM persons"):
            for n in (sn, dn):
                if n:
                    by_name[_norm(n)] = pid
        for alias, pid in c.execute("SELECT alias,person_id FROM person_aliases"):
            by_name.setdefault(_norm(alias), pid)
        next_id = (c.execute("SELECT MAX(id) FROM persons").fetchone()[0] or 0) + 1
        imgs = {r["Ai"]: r.get("Author_G") for r in src.rows("BLH_6a")}
        files = {}
        for f, full in src.images("Autor"):
            m = re.match(r"(\d+)_A\.", f, re.I)
            if m:
                files[int(m.group(1))] = full
        for r in src.rows("OM_M"):
            old = r.get("Im01")
            sn, dn, bio = _s(r.get("Am11")), _s(r.get("Am12")), _s(r.get("Fm13"))
            hit = by_name.get(_norm(sn)) or by_name.get(_norm(dn))
            if hit and self.mode == "merge":
                self.person_map[old] = hit
                if bio:
                    c.execute("UPDATE persons SET biography=COALESCE(biography,?) WHERE id=?",
                              (bio, hit))
                continue
            new = old
            if c.execute("SELECT 1 FROM persons WHERE id=?", (new,)).fetchone():
                new = next_id
            next_id = max(next_id, new + 1)
            c.execute("INSERT INTO persons(id,sort_name,display_name,biography) VALUES(?,?,?,?)",
                      (new, sn, dn, bio))
            self.person_map[old] = new
            for n in (sn, dn):
                if n:
                    by_name[_norm(n)] = new
            self.count("Mitwirkende")
            data = None
            if old in files:
                with open(files[old], "rb") as fh:
                    data = fh.read()
            elif imgs.get(old):
                data = imgs[old]
            if data:
                c.execute("INSERT OR REPLACE INTO person_images VALUES(?,?,?)",
                          (new, sniff_mime(data), data))
                self.count("Autorenbilder")
        for r in src.rows("OM_MM"):
            pid = self.person_map.get(r.get("Imm02"))
            alias = _s(r.get("Amm01"))
            if pid and alias:
                c.execute("INSERT OR IGNORE INTO person_aliases VALUES(?,?)", (alias, pid))
        for r in src.rows("OM_Z"):
            b, p = self.bid(r.get("Iz01")), self.person_map.get(r.get("Iz04"))
            if b and p:
                c.execute("INSERT OR IGNORE INTO book_persons(book_id,person_id,position,role) "
                          "VALUES(?,?,?,?)", (b, p, r.get("Iz02") or 0, _s(r.get("Az03"))))
                self.count("Buch↔Mitwirkende")

    # -- Unterordner ------------------------------------------------------------
    def subtables(self):
        c, src = self.c, self.src
        for r in src.rows("BLH_3"):
            b = self.bid(r.get("BLHi"))
            if not b:
                continue
            c.execute("INSERT OR REPLACE INTO sales VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                b, _s(r.get("Verkaufsort")), _s(r.get("Verkaufspreis")), _s(r.get("Versandart")),
                _s(r.get("Porto")), _s(r.get("Gewicht")), _s(r.get("HxBxT")), _s(r.get("Zustand")),
                _s(r.get("Waehrung")), _s(r.get("Kaeufer")), _s(r.get("Verkaufsnotiz")),
                _s(r.get("Erwerb")), _s(r.get("Einkaufspreis")), _s(r.get("Kaufquelle"))))
            self.count("Verkauf/Erwerb")
        for r in src.rows("BLH_4"):
            b = self.bid(r.get("BLHi"))
            if not b:
                continue
            c.execute("""INSERT INTO loans(book_id,borrower,loan_date,due_date,return_date,remind,
                note,rating,rating_comment) VALUES(?,?,?,?,?,?,?,?,?)""", (
                b, _s(r.get("Leihnehmer")), _s(r.get("Entleihdatum")), _s(r.get("returnTermin")),
                _s(r.get("returnDatum")), _s(r.get("Mahnen")), _s(r.get("Verleihnotiz")),
                _rating(r.get("Bewertet")), _s(r.get("Wertungskommentar"))))
            self.count("Verleihvorgänge")
        for r in src.rows("BLH_8"):
            b = self.bid(r.get("BLHi"))
            if not b:
                continue
            c.execute("""INSERT INTO reviews(book_id,kind,rating,helpful,total_votes,date,summary,
                content) VALUES(?,?,?,?,?,?,?,?)""", (
                b, r.get("Art"), _rating(r.get("Rating")), r.get("Helpfulvotes"),
                r.get("Totalvotes"), _date_de(r.get("Date")), _s(r.get("Summary")),
                _s(r.get("Content"))))
            self.count("Rezensionen")
        for r in src.rows("BLH_9_Wu"):
            b = self.bid(r.get("BLHi"))
            if b:
                c.execute("INSERT OR REPLACE INTO wishlist VALUES(?,?,?)",
                          (b, r.get("Rang"), _s(r.get("Grund"))))
                self.count("Wunschliste")
        for r in src.rows("BLH_AW"):
            b = self.bid(r.get("BLHi"))
            if b:
                c.execute("""INSERT INTO attachments(book_id,nr,kind,name,path,description,date)
                    VALUES(?,?,?,?,?,?,?)""", (b, r.get("Nrli"), _s(r.get("AWArt")),
                    _s(r.get("AWName")), _s(r.get("AWPfad")), _s(r.get("AWBeschreibung")),
                    _s(r.get("AWDatum"))))
                self.count("Web/Ablage")
        for r in src.rows("WW12"):
            b = self.bid(r.get("i1201"))
            if b and _s(r.get("A1202")):
                c.execute("INSERT INTO keywords(book_id,keyword) VALUES(?,?)",
                          (b, _s(r.get("A1202"))))
                self.count("Schlagwörter")
        orphan = 0
        for r in src.rows("T8"):
            b = self.bid(r.get("I801"))
            if not b:
                orphan += 1
                continue
            c.execute("INSERT INTO quotes(book_id,nr,date,category,text) VALUES(?,?,?,?,?)",
                      (b, r.get("I802"), _s(r.get("D811")), _s(r.get("A812")), _s(r.get("F813"))))
            self.count("Zitate")
        if orphan:
            self.count("Zitate ohne Buch (übersprungen)", orphan)
        for r in src.rows("BLH_1c"):
            b = self.bid(r.get("BLHi"))
            if b:
                c.execute("INSERT OR REPLACE INTO field_colors VALUES(?,?,?,?)",
                          (b, _s(r.get("Feldname")), r.get("Color"), r.get("FontColor")))

    # -- Gruppen -------------------------------------------------------------
    def groups(self):
        c, src = self.c, self.src
        g0 = src.rows("BLH_G0")
        named = {_norm(n): i for i, n in
                 c.execute("SELECT id,name FROM groups WHERE name IS NOT NULL AND name<>''")}
        free = [i for i in range(31) if i not in named.values()]
        for r in g0:
            bit, name = r.get("Stelle"), _s(r.get("Beschreibung"))
            if bit is None or not name:
                continue
            if self.mode == "replace":
                gid = bit
            elif _norm(name) in named:   # gleiche Gruppe existiert schon: Mitglieder ergänzen
                self.group_map[bit] = named[_norm(name)]
                self.existing_groups.add(named[_norm(name)])
                continue
            else:
                if not free:
                    self.count("Gruppen (kein Platz mehr)")
                    continue
                gid = free.pop(0)
            c.execute("UPDATE groups SET name=? WHERE id=?", (name, gid))
            c.execute("DELETE FROM group_actions WHERE group_id=?", (gid,))
            self.group_map[bit] = gid
            self.count("Gruppen")
        for r in src.rows("BLH_G1"):
            gid = self.group_map.get(_bit(r.get("Gi")))
            if gid is None or gid in self.existing_groups:
                continue
            pbit = _bit(r.get("Eigenschaft") or 0)
            c.execute("""INSERT INTO group_actions(group_id,nr,action,option,field,property_bit,
                count,moves,ms) VALUES(?,?,?,?,?,?,?,?,?)""", (
                gid, r.get("Nri") or 0, r.get("Gai"), _s(r.get("Option")),
                _s(r.get("Suchfeld")), self.prop_map.get(pbit, pbit),
                r.get("Anzahl"), r.get("Moves"), r.get("Sekunden")))
        for r in src.rows("BLH_0s"):
            b = self.bid(r.get("BLHi"))
            if not b:
                continue
            for field, kind in (("Selekt", None), ("MausPlus", 1), ("MausMinus", -1)):
                mask = r.get(field) or 0
                for bit, gid in self.group_map.items():
                    if mask & (1 << bit):
                        if kind is None:
                            c.execute("INSERT OR IGNORE INTO group_members VALUES(?,?)", (gid, b))
                        else:
                            c.execute("INSERT OR REPLACE INTO group_manual VALUES(?,?,?)",
                                      (gid, b, kind))

    # -- Signaturen, Auswahllisten, Einstellungen ---------------------------
    def lookups(self):
        c, src = self.c, self.src
        for lvl, tname in ((1, "BLH_S_1"), (2, "BLH_S_2"), (3, "BLH_S_3")):
            for r in src.rows(tname):
                c.execute("INSERT OR REPLACE INTO signatures VALUES(?,?,?,?,?,?)", (
                    lvl, r.get(f"Nr{lvl}"), _s(r.get("Sig1")), _s(r.get("Sig2")),
                    _s(r.get("Sig3")), _s(r.get(f"Eigenschaft{lvl}"))))
        pl_map = {"Az03": "role", "BINDING": "binding", "Buchart": "book_type",
                  "Sprache": "language", "Orginalsprache": "language",
                  "Zustand": "condition", "Verkaufsort": "sale_place", "Versandart": "shipping"}
        for r in src.rows("BLH_PU_5"):
            field = pl_map.get(r.get("Feldname"))
            val = _s(r.get("A50"))
            if not field or not val:
                continue
            if c.execute("SELECT 1 FROM picklists WHERE field=? AND lower(value)=lower(?)",
                         (field, val)).fetchone():
                continue
            nr = (c.execute("SELECT MAX(nr) FROM picklists WHERE field=?", (field,)).fetchone()[0]
                  or 0) + 1
            c.execute("INSERT INTO picklists VALUES(?,?,?)", (field, nr, val))
        labels = {100110: "series", 100111: "book_type", 100112: "location", 100113: "topic",
                  100114: "translator", 100115: "original_title", 100116: "original_language",
                  100117: "first_published"}
        for r in src.rows("Privat", priv=True):
            key = labels.get(r.get("Nr"))
            val = _s(r.get("Wert"))
            if key and val and self.mode == "replace":
                c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",
                          ("label." + key, val.rstrip(":").strip()))
        for r in src.rows("BLH_7_w"):
            name = _s(r.get("Name"))
            if name and not name.startswith("<"):
                c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('owner',?)", (name,))


def _rating(v):
    """Original-Auswahlliste: 1='5 (sehr gut)' … 5='1 (schlecht)' -> Sterne."""
    if not v or not (1 <= v <= 5):
        return None
    return 6 - v


def _date_de(s):
    s = _s(s)
    if not s:
        return None
    m = re.fullmatch(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", s)
    return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}" if m else s


def _dupe_keys(isbn, ean, author, title):
    keys = []
    for v in (isbn, ean):
        v = re.sub(r"[^0-9Xx]", "", v or "")
        if len(v) >= 10:
            keys.append("i:" + isbn13(v))
    if author and title:
        keys.append("t:" + re.sub(r"\W+", "", (author + "|" + title).lower()))
    return list(dict.fromkeys(keys))


def isbn13(v):
    v = re.sub(r"[^0-9Xx]", "", v or "").upper()
    if len(v) == 10:
        core = "978" + v[:9]
        s = sum((1 if i % 2 == 0 else 3) * int(d) for i, d in enumerate(core))
        return core + str((10 - s % 10) % 10)
    return v


# ---------------------------------------------------------------- CSV / DBF

# Feldnamen wie beim Original-Import (import.dbf) plus eigene Spaltennamen
CSV_MAP = {
    "isbn": "isbn", "ean": "ean", "bx": "bx", "ax": "ax", "class": "class",
    "klassifikation": "class", "autor": "author", "author": "author", "titel": "title",
    "title": "title", "seiten": "pages", "pages": "pages", "verlag": "publisher",
    "publisher": "publisher", "bindung": "binding", "einband": "binding",
    "listenpreis": "list_price", "preis": "list_price", "datum": "pub_date", "jahr": "pub_date",
    "originaltitel": "original_title", "orginaltitel": "original_title",
    "sprache": "language", "originalsprache": "original_language", "reihe": "series",
    "thema": "topic", "standort": "location", "übersetzer": "translator",
    "translator": "translator", "auflage": "auflage", "inhalt": "content",
    "kurzinfo": "notes", "notiz": "notes", "notes": "notes", "buchart": "book_type",
    "zustand": "condition", "barcode": "barcode", "ersterscheinung": "first_published",
    "lesestatus": "read_status", "bewertung": "my_rating",
}
INT_FIELDS = {"pages", "my_rating"}


def import_rows(db: Database, rows, skip_duplicates=True):
    stats = {"Bücher": 0, "übersprungen": 0}
    with db.tx() as c:
        keys = {}
        for r in c.execute("SELECT id,isbn,ean,author,title FROM books"):
            for k in _dupe_keys(r[1], r[2], r[3], r[4]):
                keys[k] = r[0]
        next_id = (c.execute("SELECT MAX(id) FROM books").fetchone()[0] or 0) + 1
        for row in rows:
            rec = {}
            for k, v in row.items():
                f = CSV_MAP.get(_norm(k)) if k else None
                if f and v not in (None, ""):
                    v = str(v).strip()
                    if f in INT_FIELDS:
                        m = re.search(r"\d+", v)
                        v = int(m.group()) if m else None
                    rec[f] = v
            if not (rec.get("isbn") or rec.get("author") or rec.get("title")):
                continue
            dk = _dupe_keys(rec.get("isbn"), rec.get("ean"), rec.get("author"), rec.get("title"))
            if skip_duplicates and any(k in keys for k in dk):
                stats["übersprungen"] += 1
                continue
            rec["id"] = next_id
            next_id += 1
            cols = ",".join(rec)
            c.execute(f"INSERT INTO books({cols}) VALUES({','.join('?' * len(rec))})",
                      list(rec.values()))
            for k in dk:
                keys[k] = rec["id"]
            stats["Bücher"] += 1
    return stats


def read_csv(data: bytes):
    for enc in ("utf-8-sig", "cp1252"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t")
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";"
    return list(csv.DictReader(io.StringIO(text), dialect=dialect))


def read_dbf(data: bytes, encoding=None):
    """Minimal dBASE III/IV reader (für import.dbf des Originals)."""
    nrec, hlen, rlen = struct.unpack_from("<IHH", data, 4)
    cp_byte = data[29]
    enc = encoding or {0x01: "cp437", 0x02: "cp850", 0x03: "cp1252", 0x57: "cp1252",
                       0x64: "cp852", 0x7D: "cp1255"}.get(cp_byte, "cp850")
    fields = []
    pos = 32
    while data[pos] != 0x0D and pos < hlen:
        name = data[pos:pos + 11].split(b"\0", 1)[0].decode("ascii", "replace")
        ftype = chr(data[pos + 11])
        flen = data[pos + 16]
        fields.append((name, ftype, flen))
        pos += 32
    rows = []
    p = hlen
    for _ in range(nrec):
        rec = data[p:p + rlen]
        p += rlen
        if not rec or rec[0:1] == b"*":
            continue
        q = 1
        row = {}
        for name, ftype, flen in fields:
            raw = rec[q:q + flen]
            q += flen
            row[name] = raw.decode(enc, "replace").strip()
        rows.append(row)
    return rows
