@echo off
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\SyncGuard.lnk"
if exist "%LNK%" (
    del /f /q "%LNK%"
    echo SyncGuard dihapus dari Startup Windows.
) else (
    echo Shortcut Startup tidak ditemukan.
)
pause
