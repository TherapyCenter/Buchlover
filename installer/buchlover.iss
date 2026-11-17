; Inno Setup Skript für Buchlover – wird von installer/build.py aufgerufen
#ifndef AppVer
  #define AppVer "1.0.0"
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
ShowLanguageDialog=no

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "desktopicon"; Description: "Verknüpfung auf dem Desktop anlegen"; GroupDescription: "Zusätzlich:"
Name: "importblh"; Description: "Vorhandene Buchliebhaber-Daten übernehmen (aus {code:BlhDir})"; GroupDescription: "Zusätzlich:"; Check: BlhExists

[Files]
Source: "..\build\stage\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Dirs]
Name: "{localappdata}\Buchlover"

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\python\pythonw.exe"; Parameters: "-m buchlover --data ""{localappdata}\Buchlover"""; WorkingDir: "{app}"; IconFilename: "{app}\buchlover.ico"; Comment: "Bücherverwaltung"
Name: "{group}\Datenordner öffnen"; Filename: "{localappdata}\Buchlover"
Name: "{group}\{#AppName} deinstallieren"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\python\pythonw.exe"; Parameters: "-m buchlover --data ""{localappdata}\Buchlover"""; WorkingDir: "{app}"; IconFilename: "{app}\buchlover.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\python\pythonw.exe"; Parameters: "-m buchlover --data ""{localappdata}\Buchlover"" --import ""{code:BlhDir}"" --import-only"; WorkingDir: "{app}"; StatusMsg: "Übernehme Buchliebhaber-Daten …"; Flags: runhidden waituntilterminated; Tasks: importblh
Filename: "{app}\python\pythonw.exe"; Parameters: "-m buchlover --data ""{localappdata}\Buchlover"""; WorkingDir: "{app}"; Description: "{#AppName} jetzt starten"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Invoke-RestMethod -Method Post -Uri http://127.0.0.1:{#Port}/api/shutdown -TimeoutSec 3 }} catch {{}}"""; Flags: runhidden; RunOnceId: "StopServer"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\python"

[Messages]
FinishedLabel=Buchlover wurde installiert. Ihre Daten liegen in %LOCALAPPDATA%\Buchlover und bleiben beim Deinstallieren erhalten.

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
