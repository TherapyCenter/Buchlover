# Buchlover – Handbuch

Buchlover ist eine freie Bücherverwaltung und ein Nachbau des Programms
„Buchliebhaber“. Vorhandene Buchliebhaber-Datenbanken lassen sich direkt
übernehmen. Buchlover läuft unter Windows, Linux und macOS sowie als
Docker-Container. Buchlover öffnet sich in einem eigenen Programmfenster und
wird mit der Maus bedient wie jedes andere Programm – alle Daten bleiben auf
Ihrem Rechner.

Dieses Handbuch öffnen Sie in Buchlover jederzeit mit dem Knopf **?** oben
rechts oder mit der Taste **F1**.

## Installation

Die Installationsdateien finden Sie auf der
[Release-Seite](https://github.com/TherapyCenter/Buchlover/releases).
Alle Varianten bringen ihr eigenes Python mit – auf dem Rechner muss nichts
weiter installiert sein.

### Windows

1. `Buchlover-Setup-<Version>.exe` herunterladen und starten.
2. Windows zeigt eventuell „Der Computer wurde durch Windows geschützt“, weil
   das Programm nicht digital signiert ist: **Weitere Informationen →
   Trotzdem ausführen**.
3. Im Assistenten wählen Sie, ob eine Desktop-Verknüpfung angelegt werden soll.
   Wird eine Buchliebhaber-Installation unter `C:\Buchliebhaber` gefunden,
   bietet der Assistent an, deren Daten gleich zu übernehmen.

Buchlover wird nur für den angemeldeten Benutzer installiert und braucht keine
Administratorrechte. Es erscheint im Startmenü unter **Buchlover**.

### Linux

1. `buchlover-<Version>-linux-x86_64.tar.gz` (bzw. `-aarch64` für ARM, z.B.
   Raspberry Pi 4/5 mit 64-Bit-System) herunterladen und entpacken:
   ```
   tar xzf buchlover-1.0.0-linux-x86_64.tar.gz
   cd buchlover-1.0.0-linux-x86_64
   ```
2. Einrichten für den eigenen Benutzer (Startmenü-Eintrag und Befehl `buchlover`):
   ```
   ./install.sh
   ```
   Alternativ ohne Installation direkt starten: `./buchlover`

Ist Chrome, Chromium oder Edge installiert, öffnet sich Buchlover in einem
eigenen Programmfenster, sonst im Standardbrowser.

Entfernen mit `~/.local/opt/buchlover/uninstall.sh`.

### macOS

1. `Buchlover-<Version>-macos-arm64.dmg` (Apple-Chip M1/M2/M3/M4) bzw.
   `-macos-x86_64.dmg` (Intel) herunterladen und öffnen.
2. **Buchlover** in den Ordner **Programme** ziehen.
3. Beim ersten Start meldet macOS, dass die App nicht von einem verifizierten
   Entwickler stammt. Öffnen Sie dann **Systemeinstellungen → Datenschutz &
   Sicherheit** und klicken Sie bei „Buchlover“ auf **Dennoch öffnen**.
   Falls macOS meldet, die App sei „beschädigt“, hilft im Terminal:
   ```
   xattr -dr com.apple.quarantine /Applications/Buchlover.app
   ```

Ist Google Chrome oder Microsoft Edge installiert, öffnet sich Buchlover in
einem eigenen Programmfenster, sonst in Safari.

### Docker

```
docker run -d --name buchlover -p 127.0.0.1:8765:8765 \
  -v buchlover-data:/data ghcr.io/therapycenter/buchlover:latest
```

oder mit der beiliegenden `docker-compose.yml`:

```
docker compose up -d
```

Dann im Browser `http://localhost:8765` öffnen. Die Datenbank liegt im Volume
`/data`. Zum Import einer Buchliebhaber-Datenbank den Ordner bzw. das
Backup-ZIP in den Ordner `import` neben der `docker-compose.yml` legen und in
Buchlover den Pfad `/import/…` angeben.

> **Achtung:** Buchlover hat keine Benutzeranmeldung. Geben Sie den Port nur
> im eigenen, vertrauenswürdigen Netz frei (Standard in der
> `docker-compose.yml`: nur dieser Rechner).

### Aus dem Quellcode

Mit installiertem Python ab 3.9: `python -m buchlover` im Projektordner
(unter Windows auch `start.bat`).

## Starten und Beenden

**Starten:** Doppelklick auf **Buchlover** auf dem Desktop oder im Startmenü
(Linux: Anwendungsmenü, macOS: Programme). Buchlover öffnet sich in einem
eigenen Fenster mit dem Titel „Buchlover“ – ohne Adresszeile und ohne Tabs,
wie ein gewöhnliches Programm. Größe und Position des Fensters merkt sich
Buchlover für den nächsten Start.

**Beenden:** Fenster wie gewohnt mit dem **X** oben rechts schließen.
Ungespeicherte Änderungen am gerade geöffneten Buch werden vorher gespeichert.
Alternativ beendet auch der Knopf **⏻** in Buchlover das Programm.

Wird Buchlover gestartet, während es schon läuft, öffnet sich kein zweites
Programm, sondern nur ein weiteres Fenster.

Links ins Internet (z.B. Deutsche Nationalbibliothek, Wikipedia) öffnen sich
in Ihrem gewohnten Browser, nicht im Buchlover-Fenster.

> **Technischer Hintergrund:** Das Buchlover-Fenster wird von Microsoft Edge
> (unter Windows immer vorhanden) bzw. Google Chrome dargestellt, mit eigenen
> Einstellungen im Datenordner (Unterordner `fenster`). Ihr normaler Browser,
> seine Lesezeichen und Anmeldungen bleiben davon unberührt. Ist weder Edge
> noch Chrome vorhanden, öffnet sich Buchlover im Standardbrowser; dort beendet
> nur **⏻** das Programm. Den Standardbrowser erzwingen Sie mit der
> Startoption `--browser`.

Buchlover ist nur von diesem Rechner aus erreichbar (Adresse
`http://127.0.0.1:8765/`).

## Wo liegen meine Daten?

Alle Daten einschließlich der Bilder stehen in einer einzigen Datei
`buchlover.sqlite`:

| System  | Ordner |
|---------|--------|
| Windows | `%LOCALAPPDATA%\Buchlover` (Startmenü → Buchlover → „Datenordner öffnen“) |
| Linux   | `~/.local/share/buchlover` |
| macOS   | `~/Library/Application Support/Buchlover` |
| Docker  | Volume `/data` |

Der Datenordner bleibt bei Updates und beim Deinstallieren erhalten. Den Pfad
zeigt auch **Werkzeug → Export & Datensicherung**.

## Vorhandene Buchliebhaber-Daten übernehmen

**Werkzeug → Buchliebhaber-Datenbank importieren**

1. Im Feld den Pfad angeben – möglich sind:
   - der Installationsordner, z.B. `C:\Buchliebhaber` (enthält `WORK` und `PRIV`),
   - der Ordner `WORK` selbst,
   - ein Backup-ZIP des Buchliebhabers, z.B. `C:\backup\20240101_1200_BLH_W.zip`.
     Die übrigen ZIP-Dateien mit demselben Zeitstempel werden automatisch
     mitgelesen.
2. **Vorschau** zeigt, was gefunden wurde (Anzahl Bücher, Mitwirkende, Cover …).
3. Art des Imports wählen:
   - **zusammenführen** – vorhandene Bücher bleiben, die neuen kommen hinzu.
     Doppelte Buchnummern werden neu vergeben; Mitwirkende, Eigenschaften und
     Gruppen werden über den Namen abgeglichen.
   - **ersetzen** – Buchlover wird geleert und die Datenbank 1:1 übernommen
     (Buchnummern bleiben erhalten).
4. **Dubletten überspringen** (empfohlen): Bücher mit gleicher ISBN/EAN oder
   gleichem Autor und Titel werden nicht doppelt angelegt.
5. **Importieren**.

Auf Linux, macOS oder Docker kopieren Sie den Ordner `C:\Buchliebhaber` oder
ein Backup-ZIP vom Windows-Rechner herüber, oder laden ein Backup-ZIP mit
**Backup-ZIP hochladen …** direkt im Browser hoch.

Übernommen werden: Bücher mit allen Feldern, Inhaltsangaben, Cover und
Buchrücken, Mitwirkende mit Rollen, Bildern, Biographien und Schreibweisen,
Rezensionen/Lesehistorie, Verleih, Verkauf/Erwerb, Wunschliste, Web/Ablage,
Schlagwörter, Zitate, Eigenschaften, Gruppen mit Aktionen, Signaturen,
Auswahllisten und die selbst benannten Feldbezeichnungen. Nicht übernommen
werden Registrierungsdaten und Fensterpositionen.

Sie können beliebig viele Datenbanken nacheinander zusammenführen.

### Import aus einer Tabellenkalkulation

**Werkzeug → Import aus Tabellenkalkulation**: CSV-Datei (Excel/LibreOffice:
„Speichern unter → CSV“) oder dBASE-Datei (`.dbf`). Die erste Zeile muss die
Spaltennamen enthalten. Erkannt werden u.a.:

`ISBN, EAN, BX, Class, Autor, Titel, Seiten, Verlag, Bindung, Listenpreis,
Datum, Originaltitel, Sprache, Reihe, Thema, Standort, Übersetzer, Auflage,
Inhalt, Notiz, Lesestatus, Bewertung`

Jede Zeile braucht mindestens ISBN, Autor oder Titel.

## Die Oberfläche

Oben stehen das Suchfeld, **+ Neues Buch**, der Hell/Dunkel-Schalter **◐**,
das Handbuch **?** und **⏻** zum Beenden. Darunter liegen die Ordner
(Reiter): Alle Bücher, Ein Buch, Mitwirkende, Lesehistorie, Verleih,
Wunschliste, Zitate & Schlagwörter, Gruppen, Statistik und Werkzeug.

## Sprache

Buchlover gibt es auf **Deutsch, Englisch, Spanisch, Französisch, Russisch
und Chinesisch**. Die Sprache wählen Sie oben rechts im Auswahlfeld neben
**◐**; Buchlover lädt die Oberfläche dann neu und merkt sich die Wahl. Beim
ersten Start richtet sich die Sprache nach dem Browser bzw. System.

Übersetzt werden Oberfläche, Meldungen und die mitgelieferten Standardwerte
(z.B. Lesestatus, Rollen, Eigenschaften). Ihre eigenen Einträge – Bücher,
Auswahllisten, eigene Eigenschaften und Feldbezeichnungen – bleiben, wie Sie
sie geschrieben haben. Das Handbuch gibt es auf Deutsch und Englisch; bei allen
anderen Sprachen öffnet **?** das englische Handbuch.

## Ordner „Alle Bücher“

Die Tabelle zeigt alle – bzw. die gesuchten, gefilterten oder gruppierten –
Bücher.

- **Öffnen:** Doppelklick auf eine Zeile oder Zeile markieren und **Enter**.
  Mit den Pfeiltasten wandern Sie durch die Tabelle.
- **Sortieren:** Klick auf eine Spaltenüberschrift; nochmals klicken kehrt die
  Reihenfolge um. Klick auf **E** hebt die Sortierung auf (neueste Bücher oben).
- **Farben:** Titel hinterlegt = Buch ist verliehen; Autor hinterlegt = Buch
  steht auf der Wunschliste.
- **Spalte E (Eigenschaften):** Das Kästchen ist gefüllt, wenn das Buch
  Eigenschaften hat. Klick darauf öffnet die Zuordnung.
- **Kachelansicht ▦:** zeigt die Cover; **☰** schaltet zurück zur Tabelle.
- **Export …:** die angezeigten Bücher als CSV (für Excel) oder als
  HTML-Buchliste mit Covern (zum Verschicken aufs Handy, Drucken oder als PDF
  speichern).

### Suchen

Begriff ins Suchfeld oben eingeben (Tastenkürzel **Alt+S**) und **Suchen**.
Teile eines Wortes genügen („goe“ findet Goethe). Gesucht wird in Autor,
Titel, Mitwirkenden, Übersetzer, Reihe, ISBN/EAN, BX, AX, Klassifikation,
Verlag, Originaltitel, Thema, Standort, Schlagwörtern, Barcode, Leihnehmer,
Rezensionen, Zitaten und Notizen. Die Spalte **Fundstelle** zeigt, wo der
Begriff gefunden wurde. **Alle Datensätze** hebt Suche, Filter und Gruppe auf.

### Filtern

**Filtern …** öffnet die Liste der Eigenschaften. Wählen Sie eine oder mehrere
und entscheiden Sie, ob ein Buch *mindestens eine* oder *alle* davon haben
muss. Ist ein Filter aktiv, zeigt der Knopf „Gefiltert (n)“.

### Gruppe anzeigen

Im Feld **Gruppe** wählen Sie eine Gruppe (siehe Ordner Gruppen):
- **nur Gruppe** zeigt nur deren Bücher,
- **hervorheben** zeigt alle Bücher; Gruppenmitglieder sind markiert und
  lassen sich in der Spalte **G** per Klick hinzufügen oder entfernen. Diese
  Klicks merkt sich die Gruppe auch beim erneuten Anwenden.

## Ordner „Ein Buch“

Zeigt das ausgewählte Buch. Mit **◀ ▶** (oder **Alt+←/→**) blättern Sie durch
die Bücher in der Reihenfolge der Tabelle.

- **Speichern** (**Strg+S**). Beim Wechsel zu einem anderen Buch oder Ordner
  wird automatisch gespeichert. Rechts oben steht „gespeichert“ bzw.
  „ungespeichert“.
- **Kopieren** legt ein neues Buch mit denselben Angaben an (z.B. für einen
  zweiten Band).
- **Löschen** entfernt das Buch mit Rezensionen, Verleih und Bildern (mit
  Rückfrage, abschaltbar in den Einstellungen).

### Felder

- **Buchnummer** wird automatisch vergeben.
- **Buchindex (BX)** ist ein frei wählbares Sortierkriterium. Ist es leer,
  bildet Buchlover beim Speichern „Nachname, Titel“. Der Knopf **⟲** daneben
  bildet es neu.
- **Autorenindex (AX)** – üblicherweise „Nachname, Vorname“ (Knopf **⟲**).
- **Klassifikation / Signatur** – z.B. Roman, Sachbuch, oder eine Signatur.
- Viele Felder schlagen beim Tippen bereits verwendete Einträge vor (wie die
  „..“-Funktion des Buchliebhabers).
- Die Bezeichnungen der Felder Reihe, Buchart, Standort, Thema, Übersetzer,
  Originaltitel, Originalsprache und Ersterscheinung können Sie unter
  **Werkzeug → Einstellungen** ändern.
- **Lesestatus**, **eigene Bewertung** (Sterne), **Schlagwörter** (durch Komma
  getrennt), **Inhaltsangabe** und **eigene Notizen**.

### Buchdaten aus dem Internet

**Daten abfragen** (oder **↓** neben der ISBN) sucht bei der Deutschen
Nationalbibliothek und bei Open Library – nach ISBN/EAN oder nach Autor und
Titel. Wählen Sie den passenden Treffer und **Übernehmen**. Optionen:
vorhandene Felder überschreiben, Cover übernehmen, Inhaltstext laden.
Mitwirkende werden dabei automatisch angelegt. Bei einem neuen Buch genügt
es, die ISBN einzugeben – die Abfrage startet dann von selbst.

Darunter stehen Links zur Suche des Buches bei DNB, Google, Google Books,
Wikipedia, Open Library und Booklooker (eigene Shops in den Einstellungen).

### Cover

Klick auf die Coverfläche bzw. **Datei …**, ein Bild hineinziehen, ein Bild
mit **Strg+V** einfügen oder **Aus URL …** eine Bildadresse angeben. Große
Bilder werden automatisch verkleinert (Höhe einstellbar).

### Mitwirkende

Unter „Mitwirkende“ Namen eingeben (als „Vorname Nachname“ oder „Nachname,
Vorname“), Rolle wählen (Autor, Übersetzer, Sprecher …) und **Hinzufügen**.
Ist der Name oder eine seiner Schreibweisen schon bekannt, wird die vorhandene
Person verknüpft. **×** entfernt nur die Verknüpfung. Ein Klick auf den Namen
öffnet die Person im Ordner Mitwirkende.

### Eigenschaften

Klick auf eine Eigenschaft schaltet sie für dieses Buch an oder aus (z.B.
„spannend“, „demnächst lesen“, „verkaufen“). Eigene Eigenschaften legen Sie
unter **Werkzeug → Eigenschaften definieren** an.

### Unterordner des Buches

- **Rezensionen** – Lesevermerke mit Datum, Sterne-Bewertung, Zusammenfassung
  und Text (**Alt+R** legt einen neuen an). Jeder Eintrag zählt als „gelesen“
  und erscheint in der Lesehistorie.
- **Verleih / Verkauf** – **+ Buch verleihen** fragt nach dem Leihnehmer;
  Rückgabetermin, Mahnen, Notiz. **Heute zurückgegeben** schließt den
  Vorgang ab. Darunter die Angaben zu Erwerb/Verkauf und ob das Buch auf der
  **Wunschliste** steht (mit Rang und Grund).
- **Web / Ablage** – Links und Dateipfade zum Buch (Autorenseite,
  Rezensionen im Netz, PDF …).
- **Zitate** – Zitate oder Anmerkungen mit Beschreibung.

## eBooks

Zu jedem Buch lässt sich eine eBook-Datei hinterlegen. Im Ordner „Ein Buch“
steht dafür der Abschnitt **eBook** mit dem Feld **eBook-Datei (Pfad)**.

- **📂 Durchsuchen …** öffnet eine Dateiauswahl: oben die Orte (persönlicher
  Ordner, Dokumente, Laufwerke), darunter Ordner und eBook-Dateien.
  Doppelklick öffnet einen Ordner bzw. übernimmt eine Datei. Den Pfad können
  Sie auch direkt eintippen oder einfügen.
- **🔍 eBook finden** sucht in den eBook-Ordnern (siehe unten) nach einer
  passenden Datei – über die ISBN aus den EPUB-Metadaten oder im Dateinamen,
  sonst über Titel und Autor. Die Treffer stehen mit Übereinstimmung in Prozent
  zur Auswahl; ein anderer Ordner lässt sich im Dialog angeben.
- **📖 Lesen** (oder **Alt+L**, auch in „Alle Bücher“ auf der markierten
  Zeile) öffnet den eingebauten Leser.
- **Extern öffnen** öffnet die Datei mit dem Standardprogramm des Systems
  (z.B. Calibre, Kindle, Adobe Reader). **Herunterladen** speichert eine Kopie.
- **Daten aus eBook übernehmen** liest Titel, Autor, ISBN, Verlag, Jahr,
  Sprache, Schlagwörter, Beschreibung und das Cover aus einem EPUB.
- **✕** löst nur die Verknüpfung, die Datei bleibt unangetastet.

Unter dem Feld steht, ob die Datei gefunden wurde (Format, Größe, Kapitel).
In „Alle Bücher“ zeigt die Spalte **📖** Bücher mit eBook – ein Klick darauf
öffnet den Leser. **nur eBooks** in der Werkzeugleiste blendet alle anderen
Bücher aus, und das Suchfeld „eBook“ durchsucht die Pfade.

### Der eBook-Leser

| Format | Anzeige |
|--------|---------|
| EPUB | eingebauter Leser mit Inhaltsverzeichnis, Kapitelweise |
| PDF | PDF-Betrachter von Edge/Chrome |
| TXT, Markdown, HTML | eingebauter Leser |
| CBZ (Comics) | Seite für Seite |
| MOBI, AZW3, FB2, DJVU, DOCX … | Standardprogramm des Systems |

Im Leser blättern **→ / ←**, **Bild↑/Bild↓** oder die Leertaste seitenweise;
am Kapitelende geht es mit dem nächsten Kapitel weiter. **A− / A+** ändern die
Schriftgröße, **◐** schaltet zwischen Hell, Sepia und Dunkel. Das
Auswahlfeld oben springt zu einem Kapitel. Die Leseposition wird je Buch
gespeichert, beim nächsten Öffnen geht es dort weiter. **Esc** schließt den
Leser. Skripte in eBooks werden aus Sicherheitsgründen nicht ausgeführt.

### eBook-Bibliothek abgleichen

Unter **Werkzeug → eBook-Bibliothek** tragen Sie die Ordner mit Ihren eBooks
ein (einer pro Zeile, **📂 Ordner hinzufügen …**). Unterordner werden
mitdurchsucht, eine Calibre-Bibliothek funktioniert also direkt.

- **Abgleich – Vorschau** zeigt, welche Dateien zu welchen Büchern passen
  (ISBN, sonst Titel und Autor) und welche Dateien kein Buch haben.
- **Zuordnen** trägt die Pfade bei den passenden Büchern ein. Mit
  „eBooks ohne passendes Buch als neue Bücher anlegen“ entstehen für die
  übrigen Dateien neue Bücher mit Titel, Autor, ISBN, Verlag, Beschreibung,
  Schlagwörtern und Cover aus dem EPUB (Bindung „eBook“).

Ist kein Ordner eingetragen, sucht „eBook finden“ in den üblichen Ordnern des
persönlichen Verzeichnisses (Dokumente, Downloads, eBooks, Calibre Library …).

Beim Import aus dem Buchliebhaber werden Einträge aus „Web/Ablage“, die auf
eine eBook-Datei zeigen, automatisch als eBook-Pfad übernommen. Im Unterordner
„Web / Ablage“ übernimmt **als eBook übernehmen** einen solchen Dateipfad
auch nachträglich.

> Buchlover speichert nur den **Pfad** zur Datei, nicht das eBook selbst. Das
> Backup enthält deshalb keine eBook-Dateien – sichern Sie Ihren eBook-Ordner
> separat. Wird der Ordner verschoben, hilft „Zuordnen“ bzw. „eBook finden“.
> Unter Docker sieht Buchlover nur eingebundene Ordner (z.B. `/ebooks`, siehe
> `docker-compose.yml`); „Extern öffnen“ ist dort nicht verfügbar.

## Ordner „Mitwirkende“

Links die Liste aller Personen mit Anzahl ihrer Bücher, oben ein Filterfeld,
**+** legt eine Person an. Rechts: Bild (anklicken oder hineinziehen),
„Nachname, Vorname“, Anzeigename, Biographie und **weitere Schreibweisen**
(eine pro Zeile – sie werden beim Zuordnen erkannt). Unten die Bücher der
Person; Klick öffnet das Buch.

**Zusammenführen mit …** bereinigt Doppelungen und Schreibfehler: Die
markierte Person wird gelöscht, ihre Bücher und Schreibweisen gehen auf die
gewählte Person über.

## Lesehistorie, Verleih, Wunschliste, Zitate & Schlagwörter

- **Lesehistorie** – alle Rezensionen/Lesevermerke, nach Jahr filterbar.
- **Verleih** – alle verliehenen Bücher; überfällige sind mit ⚠ markiert.
  **zurückgegeben** schließt einen Vorgang ab. Darunter Verkauf/Erwerb.
- **Wunschliste** – alle Wunschbücher mit Rang, Preis und Suchlinks; als
  HTML-Liste exportierbar (z.B. zum Weitergeben).
- **Zitate & Schlagwörter** – Schlagwortwolke (Klick zeigt die Bücher mit
  diesem Schlagwort) und alle Zitate.

Doppelklick auf eine Zeile öffnet jeweils das Buch.

## Ordner „Gruppen“

Gruppen sind gespeicherte Zusammenstellungen aus mehreren Schritten – z.B.
„alle Krimis von Autor X, die noch nicht gelesen sind“. Es gibt 31 Plätze
(0–30).

1. Gruppe links auswählen und oben eine Beschreibung eintragen.
2. **+ Aktion hinzufügen** – Schritte in dieser Reihenfolge:

| Art | Bedeutung |
|-----|-----------|
| `=` | Anfangsmenge: alle Bücher, die gerade angezeigten, alle mit Eigenschaft, oder keine |
| `+` | Bücher hinzufügen (Suche in einem Feld oder mit Eigenschaft) |
| `-` | Bücher entfernen (Suche oder Eigenschaft) |
| `*` | nur Treffer behalten (Suche oder Eigenschaft) |
| `±` | einzeln per Mausklick gewählte Bücher (Hervorhebungsmodus) |
| `E` | den Gruppenmitgliedern eine Eigenschaft geben oder nehmen |

3. **Anwenden / wiederholen** berechnet die Gruppe. Das ist nach neuen Büchern
   oder Änderungen erneut nötig. Die Spalten Anzahl, Moves (Änderungen
   gegenüber dem Schritt davor) und ms (Rechenzeit) helfen beim Prüfen.
4. **Gruppe anzeigen** oder **Hervorheben** wechselt zu „Alle Bücher“.

Die Reihenfolge der Schritte ändern Sie über die Spalte **Nr**, den Suchbegriff
in der Spalte **Option**. **Kopieren** überträgt eine Gruppe auf einen freien
Platz, **Tauschen** vertauscht zwei Plätze, **Löschen** leert den Platz.

Beispiel „Inhalt Regal 10“: Aktion `=` „Nimm alle Bücher“, dann `*` „Suche in
Feld“ mit Feld *Standort* und Begriff *Regal 10*, anwenden, anzeigen.

## Ordner „Statistik“

Kennzahlen (Bücher, gelesen, Seiten, Listenpreis gesamt, Mitwirkende,
verliehen, Wunschliste) und Verteilungen nach Klassifikation, Autoren,
Bindung, Standort, Sprache, Lesestatus, Erscheinungsjahr und gelesenen
Büchern pro Jahr. Den genauen Wert zeigt der Mauszeiger über einem Balken.

## Ordner „Werkzeug“

- **Buchliebhaber-Datenbank importieren** und **Import aus
  Tabellenkalkulation** – siehe oben.
- **Export & Datensicherung** – alle Bücher als CSV oder HTML-Liste, und
  **Backup erstellen**.
- **Eigenschaften definieren** – 30 frei benennbare Eigenschaften. Eine
  Umbenennung gilt für alle Bücher, die sie haben.
- **eBook-Bibliothek** – eBook-Ordner festlegen und abgleichen, siehe
  „eBooks“.
- **Einstellungen** – Ihr Name (erscheint auf Listen), Feldbezeichnungen,
  Sprache und Rolle für neue Einträge, Löschbestätigung, automatische
  BX-Bildung, automatische ISBN-Abfrage (Ankreuzfelder), maximale Coverhöhe,
  Währung für die Statistik, Backup-Ordner und bis zu zwei eigene Shop-Links
  (Such-URL, an die der Suchbegriff angehängt wird).
- **Auswahllisten** – die Vorschlagslisten für Rollen, Bindung, Buchart,
  Sprache, Zustand und Lesestatus (ein Eintrag pro Zeile).
- **Dublettenprüfung** – findet Bücher mit gleicher ISBN/EAN oder gleichem
  Autor und Titel.
- **Signaturen** – Anzeige der aus dem Buchliebhaber übernommenen Signaturen.

## Datensicherung und Wiederherstellung

**Werkzeug → Backup erstellen** legt eine ZIP-Datei
`JJJJMMTT_HHMM_buchlover.zip` an – standardmäßig im Unterordner `backup` des
Datenordners, oder im Ordner aus den Einstellungen. Sie enthält die komplette
Datenbank mit allen Bildern. Bewahren Sie Backups auch auf einem anderen
Datenträger auf. eBook-Dateien sind nicht enthalten, nur ihre Pfade.

**Wiederherstellen:**
1. Buchlover beenden (Fenster schließen oder **⏻**).
2. Die Datei `buchlover.sqlite` aus dem ZIP in den Datenordner kopieren
   (vorhandene Datei ersetzen).
3. Buchlover starten.

Zum Umzug auf einen anderen Rechner genügt es ebenso, `buchlover.sqlite` zu
kopieren – auch zwischen Windows, Linux, macOS und Docker.

## Tastenkürzel

| Taste | Funktion |
|-------|----------|
| F1 | Handbuch |
| Alt+S | Suchfeld |
| Alt+N | neues Buch |
| Strg+S | Buch speichern |
| Alt+← / Alt+→ | vorheriges / nächstes Buch |
| Alt+R | neue Rezension zum Buch |
| Alt+L | eBook lesen |
| ← / →, Leertaste, Esc | im eBook-Leser blättern, Leser schließen |
| ↑ / ↓, Enter | in der Tabelle wandern, Buch öffnen |
| Strg+V | Bild aus der Zwischenablage als Cover einfügen (Ordner „Ein Buch“) |

Im normalen Browser lässt sich ein Buch auch direkt aufrufen bzw. als
Lesezeichen speichern:
`http://127.0.0.1:8765/#book=<Buchnummer>`.

## Fragen und Probleme

**Das Fenster zeigt „Seite nicht erreichbar“.**
Buchlover läuft nicht (mehr). Fenster schließen und über die Verknüpfung neu
starten.

**Buchlover öffnet sich im Browser statt im eigenen Fenster.**
Es wurde weder Microsoft Edge noch Google Chrome gefunden (unter Linux auch
Chromium). Nach der Installation eines dieser Programme öffnet sich Buchlover
wieder im eigenen Fenster. Bis dahin beenden Sie Buchlover mit **⏻**.

**Beim Start passiert nichts / Port belegt.**
Ein anderes Programm benutzt Port 8765. Buchlover lässt sich mit
`--port 8766` (oder Umgebungsvariable `BUCHLOVER_PORT`) auf einen anderen Port
legen. Fehlermeldungen stehen in `buchlover.log` im Datenordner.

**Der Import findet keine Datenbank.**
Der Pfad muss auf den Buchliebhaber-Ordner (mit `WORK`), den `WORK`-Ordner
oder ein Backup-ZIP zeigen. Die Datei `WORK\BLH_0.DB` muss vorhanden sein.

**Umlaute oder Sonderzeichen sehen im CSV-Export falsch aus.**
Die Datei ist UTF-8-kodiert. In Excel über *Daten → Aus Text/CSV* öffnen oder
in LibreOffice beim Öffnen „UTF-8“ wählen.

**Daten abfragen findet nichts.**
Ältere Bücher sind nicht immer unter ihrer ISBN erfasst. Versuchen Sie Autor
und Titel. Für die Abfrage ist eine Internetverbindung nötig; es werden nur
der Suchbegriff bzw. die ISBN an die Deutsche Nationalbibliothek und Open
Library übermittelt.

**Das eBook wird nicht gefunden.**
Der gespeicherte Pfad stimmt nicht mehr (Datei verschoben, anderes Laufwerk,
anderer Rechner). **eBook finden** oder **Werkzeug → eBook-Bibliothek →
Zuordnen** stellt die Verknüpfung wieder her.

**Ein EPUB wird nicht richtig angezeigt.**
Manche EPUBs enthalten fehlerhaftes XHTML, das der Browser ablehnt. Dann
**Extern öffnen** (z.B. mit Calibre) benutzen.

**Update installieren.**
Neue Version wie bei der Erstinstallation einspielen; ein laufendes Buchlover
wird dabei beendet. Die Daten bleiben erhalten.

## Deinstallieren

- **Windows:** Startmenü → Buchlover → „Buchlover deinstallieren“ (oder
  Einstellungen → Apps).
- **Linux:** `~/.local/opt/buchlover/uninstall.sh`
- **macOS:** Buchlover aus dem Ordner Programme in den Papierkorb ziehen.
- **Docker:** `docker compose down` bzw. `docker rm -f buchlover`.

Der Datenordner wird dabei nicht gelöscht. Wenn Sie auch Ihre Daten entfernen
möchten, löschen Sie ihn zusätzlich von Hand (siehe „Wo liegen meine Daten?“).
