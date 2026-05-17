@echo off
setlocal enabledelayedexpansion

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
echo   [1] Start All        (server + web + browser)
echo   [2] Start Server     (ws://localhost:2567)
echo   [3] Start Web        (http://localhost:5173)
echo   [4] Open Browser     (http://localhost:5173)
echo   [5] Run E2E Test     (Playwright game-loop)
echo   [6] Run Reconnect E2E (needs RECONNECT_WINDOW_MS=5000 server)
echo   [7] Restart Server    (normal)
echo   [8] Restart Server    (RECONNECT_WINDOW_MS=5000 for reconnect test)
echo   [9] Restart Web
echo   [0] Stop All / Exit
echo.
set /p CHOICE="  Select: "

if "%CHOICE%"=="1" goto START_ALL
if "%CHOICE%"=="2" goto START_SERVER
if "%CHOICE%"=="3" goto START_WEB
if "%CHOICE%"=="4" goto OPEN_BROWSER
if "%CHOICE%"=="5" goto RUN_E2E
if "%CHOICE%"=="6" goto RUN_RECONNECT_E2E
if "%CHOICE%"=="7" goto RESTART_SERVER
if "%CHOICE%"=="8" goto RESTART_SERVER_SHORT
if "%CHOICE%"=="9" goto RESTART_WEB
if "%CHOICE%"=="0" goto STOP_ALL
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
