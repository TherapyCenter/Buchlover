# Buchlover – OpenSource „Buchliebhaber“

🌐 Deutsch · English · Español · Français · Русский · 中文 — *[English manual](MANUAL.md)*

Freie Bücherverwaltung im eigenen Programmfenster für Windows, Linux, macOS
und Docker. Liest die vorhandenen Paradox-Datenbanken des Buchliebhabers direkt
ein – ohne Paradox/BDE.

**[Handbuch](HANDBUCH.md)** · **[Manual (English)](MANUAL.md)** · **[Downloads (Releases)](https://github.com/TherapyCenter/Buchlover/releases)**

## Installation

| System | Paket |
|---|---|
| Windows 10/11 | `Buchlover-Setup-<version>.exe` – Installer, ohne Administratorrechte; übernimmt auf Wunsch `C:\Buchliebhaber` |
| Linux x86_64 / ARM64 | `buchlover-<version>-linux-<arch>.tar.gz` – entpacken, `./install.sh` |
| macOS Apple Silicon / Intel | `Buchlover-<version>-macos-<arch>.dmg` – App in „Programme“ ziehen |
| Docker | `docker run -d -p 127.0.0.1:8765:8765 -v buchlover-data:/data ghcr.io/therapycenter/buchlover` oder `docker compose up -d` |

Alle Pakete bringen ein eigenes Python mit. Details, Datenordner und
Datenübernahme: siehe [Handbuch](HANDBUCH.md).

## Start aus dem Quellcode

`start.bat` doppelklicken (benötigt Python 3.9+; nur die Standardbibliothek).
Der Browser öffnet sich auf http://127.0.0.1:8765/ (nur lokal erreichbar).

```
python -m buchlover [--data ORDNER] [--host 127.0.0.1] [--port 8765] [--browser] [--no-browser] [--import PFAD]
```

Die Daten liegen in einer Datei `buchlover.sqlite` (inkl. Bilder) im Datenordner
des Betriebssystems (siehe Handbuch) – oder in `./data`, falls dieser Ordner
existiert (portabler Betrieb). Umgebungsvariablen: `BUCHLOVER_DATA`,
`BUCHLOVER_HOST`, `BUCHLOVER_PORT`, `BUCHLOVER_NO_BROWSER`.

## Vorhandene Buchliebhaber-Datenbanken übernehmen

Werkzeug → „Buchliebhaber-Datenbank importieren“:

* **Pfad**: Installationsordner (z.B. `C:\Buchliebhaber`), der `WORK`-Ordner
  oder ein Backup-ZIP (`C:\backup\JJJJMMTT_HHMM_BLH_W.zip`, die zugehörigen
  ZIPs mit gleichem Zeitstempel werden automatisch mitgelesen).
* **zusammenführen**: weitere Datenbanken hinzufügen; doppelte Buchnummern
  werden umnummeriert, Mitwirkende und Eigenschaften nach Namen abgeglichen,
  Dubletten (ISBN/EAN bzw. Autor+Titel) wahlweise übersprungen.
* **ersetzen**: Buchlover leeren und 1:1 übernehmen (Buchnummern bleiben).

Zusätzlich: CSV/DBF-Import (Spaltennamen wie beim Original-`import.dbf`).

## Übernommene Original-Logik

| Buchliebhaber (Paradox)                 | Buchlover |
|----------------------------------------|-----------|
| BLH_0/1/2, BLH_7_I, BLH_BC             | Bücher (Index BX/AX, Klassifikation, alle Felder, Inhalt, Barcode) |
| BLH_6, `COVER\<Nr>_L.jpg`, `BR\`       | Cover / Buchrücken |
| OM_M, OM_MM, OM_Z, BLH_6a, `Autor\`    | Mitwirkende, Schreibweisen, Rollen, Bilder, Biographie |
| BLH_8                                  | Rezensionen / Lesehistorie |
| BLH_4, BLH_3                           | Verleih, Verkauf/Erwerb |
| BLH_9_Wu                               | Wunschliste |
| BLH_AW, WW12, T8                       | Web/Ablage, Schlagwörter, Zitate |
| BLH_E_0 (30 Bits)                      | Eigenschaften + Filter |
| BLH_G0/G1/G2, BLH_0s                   | Gruppen mit Aktionen (=, +, -, *, ±, E), Mausklick-Auswahl |
| BLH_S_1..3, BLH_PU_5, Privat 1001xx     | Signaturen, Auswahllisten, frei benennbare Felder |

Suche wie im Original über viele Felder mit Spalte „Fundstelle“ (Alt+S),
Sortierung per Klick auf Spaltenkopf („E“ hebt sie auf), „..“-Funktion als
Vorschlagslisten bereits eingegebener Werte, BX automatisch „Nachname, Titel“.

## Erweiterungen

* **Mehrsprachig:** Oberfläche auf Deutsch, Englisch, Spanisch, Französisch,
  Russisch und Chinesisch (Auswahl oben rechts)
* **eBooks:** eBook-Pfad je Buch (Spalte 📖), Dateiauswahl, „eBook finden“
  in den eBook-Ordnern, eingebauter Leser für EPUB, PDF, TXT/HTML und CBZ
  (Inhaltsverzeichnis, Schriftgröße, Sepia/Dunkel, Leseposition), andere
  Formate über das Standardprogramm, Metadaten und Cover aus EPUB,
  Abgleich ganzer eBook-Bibliotheken (z.B. Calibre)
* ISBN-/Titel-Abfrage bei **Deutscher Nationalbibliothek** und **Open Library**
  (Daten, Mitwirkende, Cover, Inhaltstext) – nur auf Knopfdruck
* Kachelansicht mit Covern, Cover per Drag & Drop / Strg+V / URL
* Lesestatus, eigene Sterne-Bewertung, Notizen
* Statistik, Dublettenprüfung, Mitwirkende zusammenführen
* Export CSV (Excel) und HTML-Buchliste mit Covern (Smartphone/Druck/PDF)
* Backup als ZIP, Hell/Dunkel-Modus, Direktlinks (`#book=Nr`)

## Aufbau

* `buchlover/paradox.py` – Paradox-.DB/.MB-Leser (inkl. Tabellen-Entschlüsselung,
  Chiffriertabellen aus pxlib, GPL-2.0)
* `buchlover/importer.py` – Import Buchliebhaber / CSV / DBF
* `buchlover/ebooks.py` – eBooks: EPUB/CBZ-Leser, Dateiauswahl, Suche und Bibliotheksabgleich
* `buchlover/logic.py` – Suche, Gruppen-Engine, Online-Abfrage, Statistik, Export
* `buchlover/server.py` – lokaler HTTP-Server + JSON-API
* `buchlover/static/` – Oberfläche (HTML/CSS/JS, ohne Fremdbibliotheken),
  Übersetzungen in `static/i18n.js`
* `buchlover/mdview.py` – Anzeige des Handbuchs in der Oberfläche
* `buchlover/window.py` – eigenes Programmfenster (App-Modus von Edge/Chrome), Fenster schließen = beenden
* `installer/` – Windows-Installer (`build.py`, Inno Setup) und Linux/macOS-Pakete (`build_unix.py`)
* `Dockerfile`, `docker-compose.yml` – Container
* `.github/workflows/release.yml` – baut und testet alle Pakete auf Windows, Linux und macOS und veröffentlicht das Release

## Lizenz

GNU General Public License, Version 2 oder (nach Wahl) jede spätere Version
(GPL-2.0-or-later) – siehe [LICENSE](LICENSE).

Die Chiffriertabellen in `buchlover/_crypt_tables.py` stammen aus
[pxlib](https://github.com/steinm/pxlib) (GPL-2.0). Der Installer enthält ein
eingebettetes Python (Python Software Foundation License, siehe
`python\LICENSE.txt` im Installationsordner).
