' Hentikan SyncGuard (port 7432)
Option Explicit

Dim sh
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\scripts\stop-port.ps1"" -Port 7432", 0, True
MsgBox "SyncGuard dihentikan.", vbInformation, "SyncGuard"
