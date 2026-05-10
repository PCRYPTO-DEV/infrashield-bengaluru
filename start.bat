@echo off
title POLYMATH INFRASHIELD — Launcher
setlocal

set ROOT=%~dp0
set BACKEND=%ROOT%backend
set FRONTEND=%ROOT%frontend
set BACKEND_PORT=8003
set FRONTEND_PORT=5173

echo.
echo  ██████████████████████████████████████████
echo   POLYMATH INFRASHIELD  ^|  Bengaluru
echo  ██████████████████████████████████████████
echo.

:: ── Backend ──────────────────────────────────────────────────────────────────
echo  [1/3] Starting backend...
if not exist "%BACKEND%\venv" (
    echo  Creating Python virtual environment...
    cd /d "%BACKEND%"
    python -m venv venv
)

start "InfraShield Backend" cmd /k ^
    "cd /d "%BACKEND%" && ^
     venv\Scripts\pip install -r requirements.txt -q --no-warn-script-location && ^
     echo  Backend ready — uvicorn starting... && ^
     venv\Scripts\python.exe -m uvicorn main:app --port %BACKEND_PORT% --host 0.0.0.0"

:: ── Wait for backend health ───────────────────────────────────────────────────
echo  [2/3] Waiting for backend to be ready...
:waitloop
timeout /t 2 /nobreak > nul
curl -s -o nul -w "%%{http_code}" http://localhost:%BACKEND_PORT%/health 2>nul | findstr "200" > nul
if errorlevel 1 goto waitloop
echo  Backend is up.

:: ── Frontend ─────────────────────────────────────────────────────────────────
echo  [3/3] Starting frontend...
if not exist "%FRONTEND%\node_modules" (
    echo  Installing npm packages (first run ~30s)...
    cd /d "%FRONTEND%"
    npm install
)

start "InfraShield Frontend" cmd /k ^
    "cd /d "%FRONTEND%" && npm run dev"

:: ── Open browser ─────────────────────────────────────────────────────────────
echo  Waiting for dev server...
timeout /t 5 /nobreak > nul
start http://localhost:%FRONTEND_PORT%

echo.
echo  InfraShield is running at http://localhost:%FRONTEND_PORT%
echo  Backend API at          http://localhost:%BACKEND_PORT%/docs
echo.
echo  Close the two terminal windows to stop.
pause
