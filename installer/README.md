# Installer bauen

Voraussetzungen: Python 3 und [Inno Setup 6](https://jrsoftware.org/isinfo.php).

```
python installer/build.py
```

Ergebnis: `dist/Buchlover-Setup-<version>.exe` – eigenständig (enthält ein
eingebettetes Python, auf dem Zielrechner muss nichts installiert sein).

* Installation pro Benutzer, ohne Administratorrechte
* Verknüpfungen im Startmenü (und optional auf dem Desktop)
* Daten in `%LOCALAPPDATA%\Buchlover` – bleiben bei Deinstallation/Update erhalten
* Option: vorhandene Buchliebhaber-Daten aus `C:\Buchliebhaber` übernehmen
* Ein laufendes Buchlover wird vor Update/Deinstallation beendet
