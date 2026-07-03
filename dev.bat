@echo off
setlocal enabledelayedexpansion
set "ONLINE_URL=https://twcardgame-web.pages.dev/"
set "FRIEND_URL=https://twcardgame-web.pages.dev/?auth=dev"

:: ============================================================
::  TWCARDGAME v2 — Dev Launcher
::  d:\GOOGLE\TWCARDGAME\dev.bat
:: ============================================================

:MENU
cls
echo.
echo  ==========================================
echo   TWCARDGAME v2  --  Dev Launcher
echo  ==========================================
echo.
echo   [1] Online URL        copy/open %ONLINE_URL%
echo   [2] Friend URL        copy/open %FRIEND_URL%
echo   [3] LAN URL           start local server, copy http://LAN-IP:5173/?auth=dev
echo.
echo   [4] Start All        (server + web + browser)
echo   [5] Start Server     (ws://localhost:2567)
echo   [6] Start Web        (http://localhost:5173)
echo   [7] Open Browser     (http://localhost:5173)
echo   [8] Run E2E Test     (Playwright game-loop)
echo   [9] Run Reconnect E2E (needs RECONNECT_WINDOW_MS=5000 server)
echo   [A] Restart Server    (normal)
echo   [B] Restart Server    (RECONNECT_WINDOW_MS=5000 for reconnect test)
echo   [C] Restart Web
echo   [0] Stop All / Exit
echo.
set /p CHOICE="  Select: "

if "%CHOICE%"=="1" goto COPY_ONLINE_URL
if "%CHOICE%"=="2" goto COPY_FRIEND_URL
if "%CHOICE%"=="3" goto START_REMOTE_PVP
if "%CHOICE%"=="4" goto START_ALL
if "%CHOICE%"=="5" goto START_SERVER
if "%CHOICE%"=="6" goto START_WEB
if "%CHOICE%"=="7" goto OPEN_BROWSER
if "%CHOICE%"=="8" goto RUN_E2E
if "%CHOICE%"=="9" goto RUN_RECONNECT_E2E
if /i "%CHOICE%"=="A" goto RESTART_SERVER
if /i "%CHOICE%"=="B" goto RESTART_SERVER_SHORT
if /i "%CHOICE%"=="C" goto RESTART_WEB
if "%CHOICE%"=="0" goto STOP_ALL
goto MENU

:: ============================================================
:COPY_ONLINE_URL
echo.
powershell -NoProfile -Command "Set-Clipboard -Value '%ONLINE_URL%'"
echo  Copied:
echo    %ONLINE_URL%
start "" "%ONLINE_URL%"
echo  Press any key to return to menu.
pause >nul
goto MENU

:: ============================================================
:COPY_FRIEND_URL
echo.
powershell -NoProfile -Command "Set-Clipboard -Value '%FRIEND_URL%'"
echo  Copied:
echo    %FRIEND_URL%
start "" "%FRIEND_URL%"
echo  Press any key to return to menu.
pause >nul
goto MENU

:: ============================================================
:START_ALL
echo.
echo  Starting server...
call :KILL_PORT 2567
start "TWCG-Server" cmd /k "cd /d d:\GOOGLE\TWCARDGAME && npm run dev:server"
echo  Waiting for server to initialize...
timeout /t 4 /nobreak >nul

echo  Starting web dev server...
call :KILL_PORT 5173
start "TWCG-Web" cmd /k "cd /d d:\GOOGLE\TWCARDGAME && npm run dev:web"
echo  Waiting for Vite to start...
timeout /t 4 /nobreak >nul

echo  Opening browser...
start "" "http://localhost:5173"
echo.
echo  All started. Press any key to return to menu.
pause >nul
goto MENU

:: ============================================================
:START_SERVER
echo.
call :KILL_PORT 2567
start "TWCG-Server" cmd /k "cd /d d:\GOOGLE\TWCARDGAME && npm run dev:server"
echo  Server started in new window (ws://localhost:2567)
echo  Press any key to return to menu.
pause >nul
goto MENU

:: ============================================================
:START_WEB
echo.
call :KILL_PORT 5173
start "TWCG-Web" cmd /k "cd /d d:\GOOGLE\TWCARDGAME && npm run dev:web"
echo  Web dev server started in new window (http://localhost:5173)
echo  Press any key to return to menu.
pause >nul
goto MENU

:: ============================================================
:OPEN_BROWSER
echo.
echo  Opening two browser windows for P1 and P2...
start "" "http://localhost:5173"
timeout /t 1 /nobreak >nul
start "" "http://localhost:5173"
echo  Press any key to return to menu.
pause >nul
goto MENU

:: ============================================================
:START_REMOTE_PVP
echo.
echo  Starting LAN mode...
call :GET_LAN_IP
set "LAN_URL=http://%LAN_IP%:5173/?auth=dev"
call :KILL_PORT 8787
call :KILL_PORT 5173

echo  Starting realtime server on ws://0.0.0.0:8787 ...
start "TWCG-Realtime-Remote" cmd /k "cd /d d:\GOOGLE\TWCARDGAME && npm run dev -w @twcardgame/realtime -- --ip 0.0.0.0 --port 8787"
echo  Waiting for realtime server to initialize...
timeout /t 5 /nobreak >nul

echo  Starting web dev server on http://0.0.0.0:5173 ...
start "TWCG-Web-Remote" cmd /k "cd /d d:\GOOGLE\TWCARDGAME && npm run dev:web -- --host 0.0.0.0 --port 5173"
echo  Waiting for Vite to start...
timeout /t 4 /nobreak >nul

echo.
echo  Local browser:
echo    http://localhost:5173/?auth=dev
echo.
echo  LAN URL copied. Share this with friends on the same Wi-Fi/LAN:
echo    %LAN_URL%
powershell -NoProfile -Command "Set-Clipboard -Value '%LAN_URL%'"
echo.
echo  Notes:
echo    - Remote players must be able to reach this PC on ports 5173 and 8787.
echo    - Windows Firewall may ask for access; allow Node/Wrangler on private networks.
echo.
start "" "http://localhost:5173/?auth=dev"
echo  Press any key to return to menu.
pause >nul
goto MENU

:: ============================================================
:RUN_E2E
echo.
echo  Running Playwright e2e test...
echo  (server + web must already be running)
echo.
start "TWCG-E2E" cmd /k "cd /d d:\GOOGLE\TWCARDGAME && node e2e\game-loop.spec.mjs & echo. & echo  Done. Close this window when finished. & pause"
echo  Test running in new window.
echo  Press any key to return to menu.
pause >nul
goto MENU

:: ============================================================
:RUN_RECONNECT_E2E
echo.
echo  Running Reconnect e2e test...
echo  (server must be running with RECONNECT_WINDOW_MS=5000)
echo.
start "TWCG-Reconnect-E2E" cmd /k "cd /d d:\GOOGLE\TWCARDGAME && node e2e\reconnect.spec.mjs & echo. & echo  Done. Close when finished. & pause"
echo  Test running in new window.
echo  Press any key to return to menu.
pause >nul
goto MENU

:: ============================================================
:RESTART_SERVER
echo.
echo  Stopping server on port 2567...
call :KILL_PORT 2567
timeout /t 1 /nobreak >nul
echo  Restarting server...
start "TWCG-Server" cmd /k "cd /d d:\GOOGLE\TWCARDGAME && npm run dev:server"
echo  Server restarted.
echo  Press any key to return to menu.
pause >nul
goto MENU

:: ============================================================
:RESTART_SERVER_SHORT
echo.
echo  Stopping server on port 2567...
call :KILL_PORT 2567
timeout /t 1 /nobreak >nul
echo  Restarting server with RECONNECT_WINDOW_MS=5000...
start "TWCG-Server-Short" cmd /k "cd /d d:\GOOGLE\TWCARDGAME && set RECONNECT_WINDOW_MS=5000 && npm run dev:server"
echo  Server restarted (5 s reconnect window).
echo  Press any key to return to menu.
pause >nul
goto MENU

:: ============================================================
:RESTART_WEB
echo.
echo  Stopping web server on port 5173...
call :KILL_PORT 5173
timeout /t 1 /nobreak >nul
echo  Restarting web dev server...
start "TWCG-Web" cmd /k "cd /d d:\GOOGLE\TWCARDGAME && npm run dev:web"
echo  Web server restarted.
echo  Press any key to return to menu.
pause >nul
goto MENU

:: ============================================================
:STOP_ALL
echo.
echo  Stopping all dev servers...
call :KILL_PORT 2567
call :KILL_PORT 8787
call :KILL_PORT 5173
echo  All stopped.
echo  Press any key to return to menu.
pause >nul
goto MENU

:: ============================================================
:SHOW_STATUS
echo.
echo  --- Port 2567 (Colyseus server) ---
netstat -ano | findstr ":2567 " | findstr LISTENING
if errorlevel 1 echo  [offline]
echo.
echo  --- Port 5173 (Vite web) ---
netstat -ano | findstr ":5173 " | findstr LISTENING
if errorlevel 1 echo  [offline]
echo.
pause >nul
goto MENU

:: ============================================================
:: Helper: kill whatever process is listening on %1
:KILL_PORT
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":%1 " ^| findstr LISTENING') do (
  echo  Killing PID %%P on port %1
  taskkill /PID %%P /F >nul 2>&1
)
exit /b 0

:: ============================================================
:: Helper: pick the first non-loopback IPv4 address.
:GET_LAN_IP
set "LAN_IP=YOUR-IP"
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object InterfaceMetric | Select-Object -First 1 -ExpandProperty IPAddress"`) do set "LAN_IP=%%I"
exit /b 0
