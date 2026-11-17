; Inno Setup Skript für Buchlover – wird von installer/build.py aufgerufen
#ifndef AppVer
  #define AppVer "1.1.0"
#endif
#define AppName "Buchlover"
#define Port "8765"

[Setup]
AppId={{6E3B1C2A-4F7D-4B8E-9C61-2A5D8F0B7E44}
AppName={#AppName}
AppVersion={#AppVer}
AppVerName={#AppName} {#AppVer}
AppPublisher=Buchlover
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=Buchlover-Setup-{#AppVer}
SetupIconFile=buchlover.ico
UninstallDisplayIcon={app}\buchlover.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
ShowLanguageDialog=auto
LanguageDetectionMethod=uilanguage

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"

[CustomMessages]
de.Desktop=Verknüpfung auf dem Desktop anlegen
en.Desktop=Create a desktop shortcut
es.Desktop=Crear un acceso directo en el escritorio
fr.Desktop=Créer un raccourci sur le bureau
ru.Desktop=Создать ярлык на рабочем столе
de.Extra=Zusätzlich:
en.Extra=Additional:
es.Extra=Adicional:
fr.Extra=Supplémentaire :
ru.Extra=Дополнительно:
de.ImportBlh=Vorhandene Buchliebhaber-Daten übernehmen (aus %1)
en.ImportBlh=Import existing Buchliebhaber data (from %1)
es.ImportBlh=Importar los datos existentes de Buchliebhaber (de %1)
fr.ImportBlh=Importer les données Buchliebhaber existantes (depuis %1)
ru.ImportBlh=Импортировать данные Buchliebhaber (из %1)
de.Importing=Übernehme Buchliebhaber-Daten …
en.Importing=Importing Buchliebhaber data …
es.Importing=Importando datos de Buchliebhaber …
fr.Importing=Import des données Buchliebhaber …
ru.Importing=Импорт данных Buchliebhaber …
de.StartNow=%1 jetzt starten
en.StartNow=Start %1 now
es.StartNow=Iniciar %1 ahora
fr.StartNow=Lancer %1 maintenant
ru.StartNow=Запустить %1
de.DataFolder=Datenordner öffnen
en.DataFolder=Open data folder
es.DataFolder=Abrir carpeta de datos
fr.DataFolder=Ouvrir le dossier de données
ru.DataFolder=Открыть папку данных
de.Uninstall=%1 deinstallieren
en.Uninstall=Uninstall %1
es.Uninstall=Desinstalar %1
fr.Uninstall=Désinstaller %1
ru.Uninstall=Удалить %1
de.Comment=Bücherverwaltung
en.Comment=Book manager
es.Comment=Gestor de libros
fr.Comment=Gestionnaire de livres
ru.Comment=Каталог книг

[Tasks]
Name: "desktopicon"; Description: "{cm:Desktop}"; GroupDescription: "{cm:Extra}"
Name: "importblh"; Description: "{cm:ImportBlh,{code:BlhDir}}"; GroupDescription: "{cm:Extra}"; Check: BlhExists

[Files]
Source: "..\build\stage\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Dirs]
Name: "{localappdata}\Buchlover"

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\python\pythonw.exe"; Parameters: "-m buchlover --data ""{localappdata}\Buchlover"""; WorkingDir: "{app}"; IconFilename: "{app}\buchlover.ico"; Comment: "{cm:Comment}"
Name: "{group}\{cm:DataFolder}"; Filename: "{localappdata}\Buchlover"
Name: "{group}\{cm:Uninstall,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\python\pythonw.exe"; Parameters: "-m buchlover --data ""{localappdata}\Buchlover"""; WorkingDir: "{app}"; IconFilename: "{app}\buchlover.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\python\pythonw.exe"; Parameters: "-m buchlover --data ""{localappdata}\Buchlover"" --import ""{code:BlhDir}"" --import-only"; WorkingDir: "{app}"; StatusMsg: "{cm:Importing}"; Flags: runhidden waituntilterminated; Tasks: importblh
Filename: "{app}\python\pythonw.exe"; Parameters: "-m buchlover --data ""{localappdata}\Buchlover"""; WorkingDir: "{app}"; Description: "{cm:StartNow,{#AppName}}"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Invoke-RestMethod -Method Post -Uri http://127.0.0.1:{#Port}/api/shutdown -TimeoutSec 3 }} catch {{}}"""; Flags: runhidden; RunOnceId: "StopServer"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\python"

[Messages]
de.FinishedLabel=Buchlover wurde installiert. Ihre Daten liegen in %LOCALAPPDATA%\Buchlover und bleiben beim Deinstallieren erhalten.
en.FinishedLabel=Buchlover has been installed. Your data is stored in %LOCALAPPDATA%\Buchlover and is kept when uninstalling.
es.FinishedLabel=Buchlover se ha instalado. Sus datos están en %LOCALAPPDATA%\Buchlover y se conservan al desinstalar.
fr.FinishedLabel=Buchlover est installé. Vos données se trouvent dans %LOCALAPPDATA%\Buchlover et sont conservées lors de la désinstallation.
ru.FinishedLabel=Buchlover установлен. Ваши данные хранятся в %LOCALAPPDATA%\Buchlover и сохраняются при удалении.

[Code]
function BlhDir(Param: String): String;
begin
  Result := 'C:\Buchliebhaber';
end;

function BlhExists(): Boolean;
begin
  Result := FileExists(BlhDir('') + '\WORK\BLH_0.DB');
end;

{ Laufendes Buchlover sauber beenden (speichert, schließt die Datenbank) und
  warten, bis der Prozess weg ist – erst danach prüft das Setup, ob Dateien
  in Benutzung sind. Nach 10 Sekunden wird der Prozess notfalls beendet. }
procedure StopRunningServer();
var
  Code: Integer;
begin
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -Command "' +
    'try { Invoke-RestMethod -Method Post -Uri http://127.0.0.1:{#Port}/api/shutdown -TimeoutSec 3 | Out-Null } catch {}; ' +
    'for ($i = 0; $i -lt 40; $i++) { ' +
    '  $p = Get-Process pythonw, python -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ''*\Buchlover\python\*'' }; ' +
    '  if (-not $p) { break }; Start-Sleep -Milliseconds 250 }; ' +
    'if ($p) { $p | Stop-Process -Force }"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function InitializeSetup(): Boolean;
begin
  StopRunningServer();   { vor der Dateiprüfung des Setups, sonst Abbruch beim Update }
  Result := True;
end;

function InitializeUninstall(): Boolean;
begin
  StopRunningServer();
  Result := True;
end;
