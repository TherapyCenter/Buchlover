# Buchlover – Manual

Buchlover is a free book manager (GPL) for Windows, Linux, macOS and Docker.
It is an open-source re-implementation of the German program
„Buchliebhaber“ and reads existing Buchliebhaber databases directly – no
Paradox/BDE required. Buchlover also manages your **eBooks** and has a
built-in reader.

The user interface is available in **German, English, Spanish, French,
Russian and Chinese**. A more detailed manual in German is in
[HANDBUCH.md](HANDBUCH.md).

## Installation

| System | Package |
|---|---|
| Windows 10/11 | `Buchlover-Setup-<version>.exe` – installer, no admin rights needed; optionally imports `C:\Buchliebhaber` |
| Linux x86_64 / ARM64 | `buchlover-<version>-linux-<arch>.tar.gz` – unpack, run `./install.sh` |
| macOS Apple Silicon / Intel | `Buchlover-<version>-macos-<arch>.dmg` – drag the app to “Applications” |
| Docker | `docker run -d -p 127.0.0.1:8765:8765 -v buchlover-data:/data ghcr.io/therapycenter/buchlover` or `docker compose up -d` |

All packages bring their own Python. The packages are not signed by
Microsoft/Apple: on first start, Windows SmartScreen (“More info → Run
anyway”) and macOS Gatekeeper (right-click → Open) will warn you.

From source: `python -m buchlover` (Python 3.9+, standard library only).

## Starting and quitting

Start Buchlover from the desktop / start menu / application menu. It opens in
its own window (Edge or Chrome app mode, separate profile) – closing the
window quits Buchlover; unsaved changes are saved first. **⏻** also quits.
External links open in your normal browser. Buchlover is only reachable from
this computer (`http://127.0.0.1:8765/`).

## Version and updates

The installed version is shown at the top left next to “Buchlover” (e.g.
`v1.2.0`) and under **Tools → Program version & updates**.

At startup Buchlover asks GitHub whether a newer version exists – only the
latest version number is requested, none of your data is sent. If there is an
update, a green **⬆ Update x.y.z** button appears. Click it to see what is new:

- **Windows:** **Update now** downloads and verifies the installer, closes
  Buchlover, installs the update and restarts Buchlover. Your data is kept; a
  Buchliebhaber import is not repeated.
- **Linux and macOS:** **Download** fetches the matching package; install it
  as usual.
- **Docker:** `docker compose pull && docker compose up -d`.

The automatic check can be switched off under **Tools → Program version &
updates**; **Check for updates** then checks on demand.

## Language

Choose the language in the selector at the top right (next to **◐**). The
interface reloads and remembers your choice. On first start the browser/system
language is used. The interface, messages and the built-in default values
(reading status, roles, properties …) are translated; your own data stays as
you entered it.

## Where is my data?

Everything, including images, is stored in one file `buchlover.sqlite`:

| System  | Folder |
|---------|--------|
| Windows | `%LOCALAPPDATA%\Buchlover` |
| Linux   | `~/.local/share/buchlover` |
| macOS   | `~/Library/Application Support/Buchlover` |
| Docker  | volume `/data` |

The data folder is kept on updates and uninstall.

## Importing Buchliebhaber data

**Tools → Import Buchliebhaber database**. Enter the Buchliebhaber folder
(e.g. `C:\Buchliebhaber`), its `WORK` folder or a backup ZIP, check with
**Preview**, then **Import**:

- **merge** adds the books to your existing ones (duplicate numbers are
  renumbered, contributors and properties matched by name, duplicates by
  ISBN/EAN or author+title optionally skipped);
- **replace** empties Buchlover and imports 1:1 (book numbers are kept).

Imported: books, covers, contributors with images and biographies, summaries,
reviews, loans, sales, wish list, web/files, keywords, quotes, properties,
groups, shelf marks and pick lists. File entries pointing to eBook files
become the book’s eBook path.

**CSV / DBF import:** first row = column headings; German names (Autor, Titel,
Verlag …) and English names (Author, Title, Publisher, Pages, Series,
Language, eBook …) are recognised.

## All books

Double-click a row (or **Enter**) to open a book. Click a column header to
sort; **E** resets sorting. Highlighted title = lent, highlighted author = on
the wish list. Column **📖** marks books with an eBook – click it to read.
**eBooks only** hides all other books. **▦** shows cover tiles. **Export …**
creates CSV or an HTML list with covers.

**Search** (Alt+S) looks in author, title, contributors, translator, series,
ISBN, indexes, classification, publisher, keywords, borrower, reviews, quotes,
notes and more; the **Match** column shows where. **Filter …** filters by
properties, **Group** shows or highlights a group. **All records** clears
everything.

## Book

**◀ ▶** (Alt+←/→) step through the books; saving is automatic when you leave
the book (or **Ctrl+S**). **Look up data** queries the German National
Library and Open Library by ISBN/EAN or author+title, including cover,
contributors and description. Covers can be clicked, dragged, pasted
(Ctrl+V) or loaded from a URL. Sub-tabs: reviews (reading history), lending /
sale / wish list, web / files, quotes.

## eBooks

Every book can have an eBook file. In the **eBook** section of a book:

- **📂 Browse …** opens a file chooser (home folder, documents, drives);
  double-click opens a folder or picks a file. You can also type or paste a
  path.
- **🔍 Find eBook** searches your eBook folders for a matching file – by ISBN
  (EPUB metadata or file name), otherwise by title and author – and lists the
  matches with a score.
- **📖 Read** (or **Alt+L**) opens the built-in reader.
- **Open externally** uses the system’s default application (Calibre, Kindle,
  Adobe Reader …); **Download** saves a copy.
- **Take data from eBook** reads title, author, ISBN, publisher, year,
  language, keywords, description and cover from an EPUB.
- **✕** only removes the link; the file is kept.

### The reader

| Format | Shown by |
|--------|---------|
| EPUB | built-in reader, chapter by chapter, with table of contents |
| PDF | Edge/Chrome PDF viewer |
| TXT, Markdown, HTML | built-in reader |
| CBZ (comics) | page by page |
| MOBI, AZW3, FB2, DJVU, DOCX … | system default application |

Use **→ / ←**, Page Up/Down or Space to turn pages; at the end of a chapter
the next one follows. **A− / A+** change the font size, **◐** switches
light / sepia / dark, the drop-down jumps to a chapter. The reading position is
saved per book. **Esc** closes the reader. Scripts inside eBooks are never
executed.

### eBook library

Under **Tools → eBook library** list the folders containing your eBooks (one
per line; subfolders are included, so a Calibre library works directly).

- **Match – preview** shows which files belong to which books (ISBN, otherwise
  title and author) and which files have no book.
- **Link** stores the paths in the matching books. With “Create new books for
  eBooks without a matching book”, new books are created from the EPUB
  metadata including cover (binding “eBook”).

Buchlover stores only the **path**, not the eBook itself – back up your eBook
folders separately. In Docker, mount your eBooks (e.g. `./ebooks:/ebooks`, see
`docker-compose.yml`) and enter `/ebooks` as the folder.

## Contributors, lists, groups, statistics

- **Contributors:** biography, image, alternative spellings; **Merge with …**
  cleans up duplicates.
- **Reading history, Lending, Wish list, Quotes & keywords:** overviews across
  all books.
- **Groups:** up to 31 groups built from actions (= start set, + add, - remove,
  * keep matches, ± mouse clicks, E set properties) – as in Buchliebhaber.
- **Statistics:** counts, pages, value, eBooks and charts.

## Tools

Import, eBook library, CSV/HTML export, **Create backup**, define the 30
properties, settings (owner name, field labels, defaults, confirmations,
currency, backup folder, shop links), pick lists and duplicate check.

## Backup and restore

**Tools → Create backup** writes `YYYYMMDD_HHMM_buchlover.zip` (complete
database with images, without eBook files). To restore: quit Buchlover, copy
`buchlover.sqlite` from the ZIP into the data folder, start Buchlover. The
file works across Windows, Linux, macOS and Docker.

## Keyboard shortcuts

| Key | Function |
|-----|----------|
| F1 | manual |
| Alt+S | search field |
| Alt+N | new book |
| Ctrl+S | save book |
| Alt+← / Alt+→ | previous / next book |
| Alt+R | new review |
| Alt+L | read eBook |
| ← / →, Space, Esc | turn pages in the reader, close the reader |
| Ctrl+V | paste image as cover |

## Troubleshooting

- **“Page not reachable”:** Buchlover is not running – start it again.
- **Port in use:** start with `--port 8766` (or `BUCHLOVER_PORT`); errors are
  logged to `buchlover.log` in the data folder.
- **Import finds no database:** the path must contain `WORK\BLH_0.DB`.
- **eBook not found:** the file was moved – use **Find eBook** or
  **Tools → eBook library → Link**.
- **EPUB displays incorrectly:** some EPUBs contain invalid XHTML; use
  **Open externally**.

## Uninstall

Windows: Start menu → Buchlover → uninstall. Linux:
`~/.local/opt/buchlover/uninstall.sh`. macOS: move the app to the trash.
Docker: `docker compose down`. The data folder is not deleted.

## License

GNU General Public License, version 2 or later (GPL-2.0-or-later).
