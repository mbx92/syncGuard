' SyncGuard — double-click launcher (tanpa jendela konsol)
Option Explicit

Dim sh, fso, appDir, ps1

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = appDir & "\scripts\portable-run.ps1"

If Not fso.FileExists(ps1) Then
    MsgBox "File tidak ditemukan: scripts\portable-run.ps1", vbCritical, "SyncGuard"
    WScript.Quit 1
End If

sh.CurrentDirectory = appDir
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """ -AppDir """ & appDir & """", 0, False
