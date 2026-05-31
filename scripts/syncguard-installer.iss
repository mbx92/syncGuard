; SyncGuard - Windows Installer
; Requires Inno Setup 6+ (https://jrsoftware.org/isinfo.php)
; Build: iscc "scripts\syncguard-installer.iss"

#define MyAppName "SyncGuard"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "SyncGuard"
#define MyAppURL "https://syncguard.local"
#define MyAppExeName "SyncGuard.exe"
#define MyAppAssocName "SyncGuard Agent"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={localappdata}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir={#SourcePath}\..\dist
OutputBaseFilename=SyncGuard-Setup-{#MyAppVersion}
SetupIconFile={#SourcePath}\..\assets\icon.ico
UninstallDisplayIcon={app}\SyncGuard.exe
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=110,120
DisableWelcomePage=no
PrivilegesRequired=lowest
CloseApplications=no
ChangesEnvironment=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

; ─── Files ─────────────────────────────────────────────────────────────────────

[Files]
; Core backend
Source: "{#SourcePath}\..\backend\*.js"; DestDir: "{app}\backend"; Flags: ignoreversion
Source: "{#SourcePath}\..\backend\tools\*.cmd"; DestDir: "{app}\backend\tools"; Flags: ignoreversion

; Frontend (agent UI)
Source: "{#SourcePath}\..\frontend\*"; DestDir: "{app}\frontend"; Flags: ignoreversion recursesubdirs

; Hub server
Source: "{#SourcePath}\..\hub\server.js"; DestDir: "{app}\hub"; Flags: ignoreversion
Source: "{#SourcePath}\..\hub\store.js"; DestDir: "{app}\hub"; Flags: ignoreversion
Source: "{#SourcePath}\..\hub\auth.js"; DestDir: "{app}\hub"; Flags: ignoreversion
Source: "{#SourcePath}\..\hub\log-policy.js"; DestDir: "{app}\hub"; Flags: ignoreversion
Source: "{#SourcePath}\..\hub\hub-postgres.js"; DestDir: "{app}\hub"; Flags: ignoreversion
Source: "{#SourcePath}\..\hub\config.json"; DestDir: "{app}\hub"; Flags: ignoreversion
Source: "{#SourcePath}\..\hub\data\.gitkeep"; DestDir: "{app}\hub\data"; Flags: ignoreversion

; Hub built UI
Source: "{#SourcePath}\..\hub\public\*"; DestDir: "{app}\hub\public"; Flags: ignoreversion recursesubdirs

; Hub web source (for rebuild)
Source: "{#SourcePath}\..\hub\web\package.json"; DestDir: "{app}\hub\web"; Flags: ignoreversion
Source: "{#SourcePath}\..\hub\web\vite.config.js"; DestDir: "{app}\hub\web"; Flags: ignoreversion
Source: "{#SourcePath}\..\hub\web\index.html"; DestDir: "{app}\hub\web"; Flags: ignoreversion
Source: "{#SourcePath}\..\hub\web\src\*"; DestDir: "{app}\hub\web\src"; Flags: ignoreversion recursesubdirs

; Assets
Source: "{#SourcePath}\..\assets\*"; DestDir: "{app}\assets"; Flags: ignoreversion

; Scripts
Source: "{#SourcePath}\..\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs
; Exclude Linux scripts from default — they go to a subdir anyway
; Exclude build-launcher dependencies (C# compiler not always available)

; Tools placeholder (README only — actual tools downloaded post-install)
Source: "{#SourcePath}\..\tools\cwrsync\README.md"; DestDir: "{app}\tools\cwrsync"; Flags: ignoreversion
Source: "{#SourcePath}\..\tools\node\README.md"; DestDir: "{app}\tools\node"; Flags: ignoreversion

; Root launchers and config
Source: "{#SourcePath}\..\start.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\stop.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\start-hub.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\stop-hub.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\SyncGuard.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\SyncGuard-Stop.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\install-node.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\install-cwrsync.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\setup-portable.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\install-startup.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\remove-startup.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\refresh-icon-cache.bat"; DestDir: "{app}"; Flags: ignoreversion

; Package manifests
Source: "{#SourcePath}\..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\package-lock.json"; DestDir: "{app}"; Flags: ignoreversion

; Docs
Source: "{#SourcePath}\..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\PORTABLE.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\LINUX.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}\..\HUB.md"; DestDir: "{app}"; Flags: ignoreversion

; ─── Post-install script ───────────────────────────────────────────────────────

[Run]
; Download Node.js portable
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install-node.ps1"""; \
  StatusMsg: "Mengunduh Node.js portable..."; Flags: runhidden; Check: not NodeExists

; Install npm dependencies
Filename: "{cmd}"; Parameters: "/C ""cd /d ""{app}"" && ""{app}\scripts\node-env.bat"" && call ""%SYNCGUARD_NPM%"" install --omit=dev"""; \
  StatusMsg: "Menginstal dependensi npm..."; Flags: runhidden; Check: not DirExists(ExpandConstant('{app}\node_modules'))

; Build launcher EXE
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\build-launcher.ps1"" -AppDir ""{app}"""; \
  StatusMsg: "Membangun SyncGuard.exe..."; Flags: runhidden; Check: not LauncherExists

; Create desktop shortcut (optional)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\create-shortcut.ps1"" -Desktop -AppDir ""{app}"""; \
  StatusMsg: "Membuat shortcut Desktop..."; Flags: runhidden; Check: not ShortcutExists

; Show finished message — open the app
Filename: "{app}\SyncGuard.exe"; Description: "Jalankan SyncGuard sekarang"; Flags: postinstall nowait skipifsilent unchecked

; ─── Icons ─────────────────────────────────────────────────────────────────────

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\SyncGuard.exe"; WorkingDir: "{app}"; Comment: "NAS Backup Manager"; IconFilename: "{app}\assets\icon.ico"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{group}\Dashboard (browser)"; Filename: "http://localhost:7432"
Name: "{group}\Hub Dashboard (browser)"; Filename: "http://localhost:7443"
Name: "{group}\Buka folder aplikasi"; Filename: "{app}"

; ─── RunOrder ──────────────────────────────────────────────────────────────────

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\stop-port.ps1"" -Port 7432 -Quiet"; RunOnceId: "StopAgent"
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\stop-port.ps1"" -Port 7443 -Quiet"; RunOnceId: "StopHub"

; ─── Code ──────────────────────────────────────────────────────────────────────

[Code]

function NodeExists: Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\tools\node\node.exe'));
end;

function LauncherExists: Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\SyncGuard.exe'));
end;

function ShortcutExists: Boolean;
var
  DeskPath: String;
begin
  DeskPath := ExpandConstant('{userdesktop}');
  Result := FileExists(DeskPath + '\SyncGuard.lnk');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigDir: String;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigDir := ExpandConstant('{app}\config');
    if not DirExists(ConfigDir) then
      CreateDir(ConfigDir);
    if not DirExists(ConfigDir + '\keys') then
      CreateDir(ConfigDir + '\keys');
    if not DirExists(ExpandConstant('{app}\logs')) then
      CreateDir(ExpandConstant('{app}\logs'));
    if not DirExists(ExpandConstant('{app}\data')) then
      CreateDir(ExpandConstant('{app}\data'));
    if not DirExists(ExpandConstant('{app}\data\db-dumps')) then
      CreateDir(ExpandConstant('{app}\data\db-dumps'));
  end;
end;
