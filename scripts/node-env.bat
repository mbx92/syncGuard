@echo off
set "SYNCGUARD_ROOT=%~dp0.."
if exist "%SYNCGUARD_ROOT%\tools\node\node.exe" (
    set "PATH=%SYNCGUARD_ROOT%\tools\node;%PATH%"
    set "SYNCGUARD_NODE=%SYNCGUARD_ROOT%\tools\node\node.exe"
    set "SYNCGUARD_NPM=%SYNCGUARD_ROOT%\tools\node\npm.cmd"
    set "SYNCGUARD_NODE_SOURCE=bundled"
    exit /b 0
)
where node >nul 2>&1
if %errorlevel% equ 0 (
    set "SYNCGUARD_NODE=node"
    set "SYNCGUARD_NPM=npm"
    set "SYNCGUARD_NODE_SOURCE=system"
    exit /b 0
)
exit /b 1
