"""eBooks: Dateiauswahl, Suche passender Dateien, EPUB-/CBZ-Leser, Bibliothek einlesen.

Ohne Fremdbibliotheken: EPUB und CBZ sind ZIP-Archive. Der Leser in der
Oberfläche zeigt die Kapitel (Spine) eines EPUB einzeln an; PDF zeigt der
eingebaute PDF-Betrachter von Edge/Chrome, TXT/HTML werden direkt angezeigt.
Andere Formate (MOBI, AZW3, DJVU …) öffnet das Standardprogramm des Systems.
"""
from __future__ import annotations

import os
import posixpath
import re
import string
import subprocess
import sys
import unicodedata
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

EBOOK_EXT = {".epub", ".pdf", ".txt", ".html", ".htm", ".xhtml", ".cbz", ".mobi", ".azw",
             ".azw3", ".kfx", ".fb2", ".djvu", ".djv", ".cbr", ".lit", ".pdb", ".rtf",
             ".doc", ".docx", ".odt", ".md"}
# Was der eingebaute Leser anzeigen kann
READER_KIND = {".epub": "epub", ".pdf": "pdf", ".txt": "text", ".md": "text",
               ".html": "html", ".htm": "html", ".xhtml": "html", ".cbz": "cbz"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"}

MIME = {
    ".xhtml": "application/xhtml+xml", ".html": "text/html", ".htm": "text/html",
    ".css": "text/css", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".bmp": "image/bmp",
    ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
    ".pdf": "application/pdf", ".txt": "text/plain", ".xml": "application/xml",
    ".ncx": "application/xml", ".opf": "application/xml", ".epub": "application/epub+zip",
    ".mobi": "application/x-mobipocket-ebook", ".azw3": "application/vnd.amazon.ebook",
    ".fb2": "application/x-fictionbook+xml", ".djvu": "image/vnd.djvu",
    ".cbz": "application/vnd.comicbook+zip", ".md": "text/plain",
}

MAX_SCAN_FILES = 50000


def norm_path(p):
    """Pfad aus der Eingabe säubern (Anführungszeichen, file://, ~)."""
    p = (p or "").strip().strip('"').strip("'")
    if p.lower().startswith("file://"):
        p = urllib.parse.unquote(urllib.parse.urlparse(p).path)
        if re.match(r"^/[A-Za-z]:", p):          # file:///C:/...
            p = p[1:]
    return os.path.expanduser(p) if p else ""


def ext_of(path):
    return os.path.splitext(path or "")[1].lower()


def kind_of(path):
    return READER_KIND.get(ext_of(path))


def mime_of(path):
    return MIME.get(ext_of(path), "application/octet-stream")


# ------------------------------------------------------------------ Dateiauswahl

def roots():
    out = []
    home = os.path.expanduser("~")
    out.append({"name": "Home", "path": home})
    for sub in ("Documents", "Dokumente", "Downloads", "Books", "Bücher", "eBooks", "Calibre Library",
                "Calibre-Bibliothek"):
        p = os.path.join(home, sub)
        if os.path.isdir(p):
            out.append({"name": sub, "path": p})
    if sys.platform == "win32":
        for d in string.ascii_uppercase:
            p = f"{d}:\\"
            if os.path.exists(p):
                out.append({"name": p, "path": p})
    else:
        out.append({"name": "/", "path": "/"})
        for p in ("/media", "/mnt", "/Volumes", "/ebooks", "/import"):
            if os.path.isdir(p):
                out.append({"name": p, "path": p})
    return out


def list_dir(path, show_all=False):
    """Verzeichnisinhalt für den Dateiauswahl-Dialog (Ordner + eBook-Dateien)."""
    path = norm_path(path)
    if not path:
        return {"path": "", "parent": None, "dirs": [], "files": [], "roots": roots()}
    if os.path.isfile(path):
        path = os.path.dirname(path)
    if not os.path.isdir(path):
        raise FileNotFoundError(path)
    path = os.path.abspath(path)
    dirs, files = [], []
    try:
        with os.scandir(path) as it:
            for e in it:
                if e.name.startswith("."):
                    continue
                try:
                    if e.is_dir():
                        dirs.append(e.name)
                    elif e.is_file() and (show_all or ext_of(e.name) in EBOOK_EXT):
                        files.append({"name": e.name, "size": e.stat().st_size,
                                      "readable": bool(kind_of(e.name))})
                except OSError:
                    continue
    except PermissionError:
        pass
    key = lambda s: s.casefold()  # noqa: E731
    dirs.sort(key=key)
    files.sort(key=lambda f: f["name"].casefold())
    parent = os.path.dirname(path)
    return {"path": path, "parent": parent if parent != path else "", "sep": os.sep,
            "dirs": dirs, "files": files, "roots": roots()}


def open_with_system(path):
    """Datei mit dem Standardprogramm des Betriebssystems öffnen."""
    if sys.platform == "win32":
        os.startfile(path)  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


# ------------------------------------------------------------------ EPUB

def _local(tag):
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _children(el, name):
    return [c for c in el if _local(c.tag) == name]


def _find_all(el, name):
    return [c for c in el.iter() if _local(c.tag) == name]


def _attr(el, name):
    for k, v in el.attrib.items():
        if _local(k) == name:
            return v
    return None


def _join(base, href):
    href = urllib.parse.unquote(href.split("#", 1)[0])
    return posixpath.normpath(posixpath.join(base, href)) if href else ""


def _read_xml(z, name):
    data = z.read(name)
    # ElementTree mag keine DTD-Entities wie &nbsp; – für Metadaten unkritisch entfernen
    data = re.sub(rb"<!DOCTYPE[^>]*>", b"", data, count=1)
    return ET.fromstring(data)


def _member(z, name):
    """Groß-/Kleinschreibung tolerant (manche EPUBs sind unsauber gepackt)."""
    names = z.namelist()
    if name in names:
        return name
    low = name.lower()
    for n in names:
        if n.lower() == low:
            return n
    return None


def epub_info(path):
    """Metadaten, Kapitelfolge (Spine), Inhaltsverzeichnis und Cover eines EPUB."""
    with zipfile.ZipFile(path) as z:
        container = _read_xml(z, "META-INF/container.xml")
        rf = next(iter(_find_all(container, "rootfile")), None)
        opf_path = rf.get("full-path") if rf is not None else None
        if not opf_path:
            opf_path = next((n for n in z.namelist() if n.lower().endswith(".opf")), None)
        if not opf_path:
            raise ValueError("EPUB ohne OPF-Datei")
        opf = _read_xml(z, _member(z, opf_path) or opf_path)
        base = posixpath.dirname(opf_path)
        meta_el = next(iter(_find_all(opf, "metadata")), None)
        meta = {"title": None, "authors": [], "language": None, "publisher": None, "date": None,
                "description": None, "subjects": [], "identifiers": []}
        cover_id = None
        if meta_el is not None:
            for el in meta_el.iter():
                n, txt = _local(el.tag), (el.text or "").strip()
                if n == "title" and txt and not meta["title"]:
                    meta["title"] = txt
                elif n == "creator" and txt:
                    meta["authors"].append({"name": txt, "role": _attr(el, "role"),
                                            "file_as": _attr(el, "file-as")})
                elif n == "language" and txt and not meta["language"]:
                    meta["language"] = txt
                elif n == "publisher" and txt and not meta["publisher"]:
                    meta["publisher"] = txt
                elif n == "date" and txt and not meta["date"]:
                    meta["date"] = txt
                elif n == "description" and txt and not meta["description"]:
                    meta["description"] = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", txt)).strip()
                elif n == "subject" and txt:
                    meta["subjects"].append(txt)
                elif n == "identifier" and txt:
                    meta["identifiers"].append(txt)
                elif n == "meta" and el.get("name") == "cover":
                    cover_id = el.get("content")
        manifest = {}
        cover = None
        nav = None
        for it in _find_all(opf, "item"):
            iid, href = it.get("id"), it.get("href")
            if not href:
                continue
            full = _join(base, href)
            manifest[iid] = {"href": full, "type": it.get("media-type", "")}
            props = (it.get("properties") or "").split()
            if "cover-image" in props:
                cover = full
            if "nav" in props:
                nav = full
        if not cover and cover_id in manifest:
            cover = manifest[cover_id]["href"]
        if not cover:
            cover = next((m["href"] for m in manifest.values() if m["type"].startswith("image/")
                          and "cover" in m["href"].lower()), None)
        spine_el = next(iter(_find_all(opf, "spine")), None)
        spine = []
        ncx = None
        if spine_el is not None:
            toc_id = spine_el.get("toc")
            if toc_id in manifest:
                ncx = manifest[toc_id]["href"]
            for ref in _children(spine_el, "itemref"):
                m = manifest.get(ref.get("idref"))
                if m and ref.get("linear", "yes") != "no":
                    spine.append(m["href"])
        if not ncx:
            ncx = next((m["href"] for m in manifest.values()
                        if m["type"] == "application/x-dtbncx+xml"), None)
        toc = []
        try:
            if nav and _member(z, nav):
                toc = _toc_nav(_read_xml(z, _member(z, nav)), posixpath.dirname(nav))
            if not toc and ncx and _member(z, ncx):
                toc = _toc_ncx(_read_xml(z, _member(z, ncx)), posixpath.dirname(ncx))
        except ET.ParseError:
            toc = []
        spine = [s for s in spine if _member(z, s)]
        spine = [_member(z, s) for s in spine]
        cover = _member(z, cover) if cover else None
    isbn = None
    for i in meta["identifiers"]:
        d = re.sub(r"[^0-9Xx]", "", i)
        if len(d) in (10, 13) and ("isbn" in i.lower() or d.startswith(("978", "979")) or len(d) == 10):
            isbn = d
            break
    meta["isbn"] = isbn
    return {"meta": meta, "spine": spine, "toc": toc, "cover": cover}


def _toc_nav(root, base):
    out = []
    for navel in _find_all(root, "nav"):
        typ = _attr(navel, "type") or ""
        if typ and typ != "toc":
            continue

        def walk(ol, depth):
            for li in _children(ol, "li"):
                a = next((c for c in li if _local(c.tag) in ("a", "span")), None)
                if a is not None:
                    label = re.sub(r"\s+", " ", "".join(a.itertext())).strip()
                    href = a.get("href")
                    if label:
                        out.append({"label": label, "href": _join(base, href) if href else None,
                                    "frag": href.split("#", 1)[1] if href and "#" in href else None,
                                    "depth": depth})
                for sub in _children(li, "ol"):
                    walk(sub, depth + 1)
        for ol in _children(navel, "ol"):
            walk(ol, 0)
        if out:
            break
    return out


def _toc_ncx(root, base):
    out = []

    def walk(el, depth):
        for np in _children(el, "navPoint"):
            lab = next(iter(_find_all(np, "text")), None)
            con = next(iter(_children(np, "content")), None)
            src = con.get("src") if con is not None else None
            label = (lab.text or "").strip() if lab is not None else ""
            if label:
                out.append({"label": label, "href": _join(base, src) if src else None,
                            "frag": src.split("#", 1)[1] if src and "#" in src else None,
                            "depth": depth})
            walk(np, depth + 1)
    for nm in _find_all(root, "navMap"):
        walk(nm, 0)
    return out


def zip_member(path, name):
    """Datei aus EPUB/CBZ lesen -> (bytes, mime)."""
    with zipfile.ZipFile(path) as z:
        m = _member(z, name)
        if not m:
            raise FileNotFoundError(name)
        info = z.getinfo(m)
        if info.file_size > 200 * 1024 * 1024:
            raise ValueError("Datei im eBook zu groß")
        return z.read(m), mime_of(m)


def cbz_info(path):
    with zipfile.ZipFile(path) as z:
        pages = sorted((n for n in z.namelist() if ext_of(n) in IMAGE_EXT and not n.endswith("/")),
                       key=_natural)
    return {"meta": {"title": os.path.splitext(os.path.basename(path))[0], "authors": []},
            "spine": pages, "toc": [], "cover": pages[0] if pages else None}


def _natural(s):
    return [int(x) if x.isdigit() else x.lower() for x in re.split(r"(\d+)", s)]


def info(path):
    k = kind_of(path)
    if k == "epub":
        return epub_info(path)
    if k == "cbz":
        return cbz_info(path)
    return {"meta": {"title": os.path.splitext(os.path.basename(path))[0], "authors": []},
            "spine": [], "toc": [], "cover": None}


def text_page(path, title="", dark=False):
    """TXT/Markdown als lesbare HTML-Seite."""
    import html as _html
    with open(path, "rb") as fh:
        raw = fh.read(30 * 1024 * 1024)
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    paras = re.split(r"\n\s*\n", text.replace("\r\n", "\n"))
    body = "\n".join(f"<p>{_html.escape(p).strip()}</p>" for p in paras if p.strip())
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>{_html.escape(title)}</title>'
            '<style>body{max-width:42em;margin:2em auto;padding:0 1em;line-height:1.6;'
            'font-family:Georgia,serif;white-space:pre-wrap}</style></head>'
            f"<body>{body}</body></html>")


# ------------------------------------------------------------------ Dateien finden

def _fold(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


STOP = {"der", "die", "das", "und", "the", "and", "ein", "eine", "of", "le", "la", "les", "el",
        "los", "las", "de", "du", "des", "a", "an", "von", "im", "in", "zu", "en", "y", "et"}


def _tokens(s):
    return [w for w in _fold(s).split() if len(w) > 1 and w not in STOP]


def walk_ebooks(dirs, limit=MAX_SCAN_FILES):
    n = 0
    for d in dirs:
        d = norm_path(d)
        if not d or not os.path.isdir(d):
            continue
        for root, subdirs, files in os.walk(d):
            subdirs[:] = [s for s in subdirs if not s.startswith(".")]
            for f in files:
                if ext_of(f) in EBOOK_EXT and not f.startswith("."):
                    yield os.path.join(root, f)
                    n += 1
                    if n >= limit:
                        return


_meta_cache = {}


def file_meta(path):
    """Titel/Autor/ISBN einer Datei: aus EPUB-Metadaten, sonst aus dem Dateinamen."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = (path, st.st_mtime, st.st_size)
    if key in _meta_cache:
        return _meta_cache[key]
    m = {"title": None, "authors": [], "isbn": None}
    if ext_of(path) == ".epub":
        try:
            m = epub_info(path)["meta"]
        except Exception:  # noqa - kaputte EPUBs: Dateiname genügt
            pass
    stem = os.path.splitext(os.path.basename(path))[0]
    if not m.get("isbn"):
        d = re.search(r"97[89]\d{10}|\b\d{9}[\dXx]\b", stem.replace("-", ""))
        m["isbn"] = d.group() if d else None
    if not m.get("title"):
        # gängige Schemata "Autor - Titel" bzw. "Titel - Autor"
        parts = [p.strip() for p in re.split(r"\s+[-–]\s+", stem) if p.strip()]
        m["title"] = parts[-1] if len(parts) > 1 else stem
        if len(parts) > 1 and not m.get("authors"):
            m["authors"] = [{"name": parts[0]}]
    m["file"] = path
    m["stem"] = stem
    _meta_cache[key] = m
    return m


def _isbn13(v):
    from .importer import isbn13
    return isbn13(v) if v else None


def score(book, m):
    """0..1 – wie gut passt Datei-Metadaten m zum Buch?"""
    bi = {_isbn13(x) for x in (book.get("isbn"), book.get("ean")) if x}
    if m.get("isbn") and _isbn13(m["isbn"]) in bi:
        return 1.0
    tt = set(_tokens(book.get("title")))
    if not tt:
        return 0.0
    hay = set(_tokens(m.get("title"))) | set(_tokens(m.get("stem")))
    s = len(tt & hay) / len(tt)
    au = set(_tokens(book.get("author")) + _tokens(book.get("ax")))
    if au:
        fa = set(_tokens(" ".join(a.get("name") or "" for a in m.get("authors") or []))) \
            | set(_tokens(m.get("stem")))
        s = s * 0.75 + (0.25 if au & fa else 0)
    return round(s, 3)


def find_for_book(book, dirs, limit=12):
    out = []
    for f in walk_ebooks(dirs):
        m = file_meta(f)
        if not m:
            continue
        sc = score(book, m)
        if sc >= 0.5:
            out.append({"path": f, "score": sc, "title": m.get("title"),
                        "author": ", ".join(a.get("name") or "" for a in m.get("authors") or []),
                        "size": os.path.getsize(f)})
    out.sort(key=lambda x: (-x["score"], x["path"]))
    return out[:limit]


def scan_library(db, dirs, apply=False, create=False, on_create=None):
    """Ordner nach eBooks durchsuchen und Büchern zuordnen bzw. neue Bücher anlegen."""
    books = db.q("SELECT id, isbn, ean, author, ax, title, ebook_path FROM books")
    linked = {os.path.normcase(os.path.abspath(b["ebook_path"])) for b in books if b["ebook_path"]}
    by_isbn, by_title = {}, {}
    for b in books:
        if b["ebook_path"]:
            continue
        for x in (b["isbn"], b["ean"]):
            if x:
                by_isbn.setdefault(_isbn13(x), b)
        k = " ".join(_tokens(b["title"]))
        if k:
            by_title.setdefault(k, []).append(b)
    matched, unmatched, files = [], [], 0
    used = set()
    for f in walk_ebooks(dirs):
        files += 1
        if os.path.normcase(os.path.abspath(f)) in linked:
            continue
        m = file_meta(f)
        if not m:
            continue
        b = by_isbn.get(_isbn13(m["isbn"])) if m.get("isbn") else None
        if not b:
            cands = by_title.get(" ".join(_tokens(m.get("title")))) or []
            cands = [c for c in cands if c["id"] not in used]
            best = max(cands, key=lambda c: score(c, m), default=None)
            if best and score(best, m) >= 0.75:
                b = best
        if b and b["id"] not in used:
            used.add(b["id"])
            matched.append({"file": f, "book_id": b["id"], "title": b["title"], "author": b["author"]})
        else:
            unmatched.append({"file": f, "title": m.get("title"),
                              "author": ", ".join(a.get("name") or "" for a in m.get("authors") or []),
                              "isbn": m.get("isbn")})
    result = {"files": files, "matched": matched, "unmatched": unmatched, "linked": 0, "created": 0}
    if apply:
        for x in matched:
            db.x("UPDATE books SET ebook_path=?, updated_at=datetime('now','localtime') "
                 "WHERE id=? AND (ebook_path IS NULL OR ebook_path='')", (x["file"], x["book_id"]))
            result["linked"] += 1
        if create:
            for x in unmatched:
                bid, rec = create_book_from_file(db, x["file"])
                if on_create:
                    on_create(bid, rec)
                result["created"] += 1
    return result


LANG_NAMES = {"de": "Deutsch", "en": "Englisch", "fr": "Französisch", "es": "Spanisch",
              "it": "Italienisch", "ru": "Russisch", "zh": "Chinesisch", "nl": "Niederländisch",
              "pt": "Portugiesisch", "pl": "Polnisch", "ja": "Japanisch"}


def lookup_record(path):
    """Metadaten einer eBook-Datei im Format der Internetabfrage (logic.lookup)."""
    from .logic import _display_name, _sort_name
    m = file_meta(path) or {}
    persons = []
    for a in m.get("authors") or []:
        name = (a.get("name") or "").strip()
        if not name:
            continue
        if "," in name:
            sort, disp = name, _display_name(name)
        else:
            sort, disp = a.get("file_as") or _sort_name(name), name
        role = {"aut": "Autor", "trl": "Übersetzer", "edt": "Herausgeber", "ill": "Illustrator",
                "nrt": "Sprecher"}.get((a.get("role") or "aut").lower(), "Autor")
        persons.append({"display_name": disp, "sort_name": sort, "role": role})
    authors = [p["display_name"] for p in persons if p["role"] == "Autor"]
    lang = (m.get("language") or "").split("-")[0].lower()
    date = m.get("date") or ""
    return {
        "source": "eBook", "title": m.get("title"),
        "author": "; ".join(authors) or None,
        "ax": persons[0]["sort_name"] if persons else None,
        "isbn": m.get("isbn"), "publisher": m.get("publisher"),
        "pub_date": date[:4] if re.match(r"\d{4}", date) else (date or None),
        "language": LANG_NAMES.get(lang, m.get("language")),
        "binding": "eBook", "keywords": m.get("subjects") or [],
        "content": m.get("description"), "persons": persons,
    }


def cover_bytes(path):
    """Coverbild aus EPUB/CBZ oder None."""
    try:
        inf = info(path)
        if inf.get("cover"):
            data, _ = zip_member(path, inf["cover"])
            return data
    except Exception:  # noqa
        return None
    return None


def create_book_from_file(db, path):
    from .db import sniff_mime
    r = lookup_record(path)
    bid = db.next_book_id()
    author = r.get("author")
    title = r.get("title")
    bx = None
    if title:
        bx = f"{(r.get('ax') or author or '').split(',')[0]}, {title}".strip(", ")[:120]
    db.x("""INSERT INTO books(id,isbn,author,ax,bx,title,publisher,pub_date,language,binding,
        content,ebook_path) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
         (bid, r.get("isbn"), author, r.get("ax"), bx, title, r.get("publisher"), r.get("pub_date"),
          r.get("language"), "eBook", r.get("content"), path))
    for kw in dict.fromkeys(r.get("keywords") or []):
        db.x("INSERT INTO keywords(book_id,keyword) VALUES(?,?)", (bid, kw))
    data = cover_bytes(path)
    if data:
        mime = sniff_mime(data)
        if mime and mime.startswith("image/"):
            db.x("INSERT OR REPLACE INTO book_images VALUES(?,?,?,?)", (bid, "cover", mime, data))
    return bid, r
