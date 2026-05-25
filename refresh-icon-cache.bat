@echo off
title SyncGuard - Refresh icon cache
echo.
echo  Memperbarui cache icon Windows...
echo.

ie4uinit.exe -show 2>nul
if %errorlevel% equ 0 (
    echo  Cache icon di-refresh.
) else (
    echo  ie4uinit tidak tersedia - coba sign out / login Windows.
)

echo.
echo  Jalankan ulang setup-portable.bat jika shortcut masih buram.
echo.
pause
