@echo off
title InfraShield Bengaluru — Startup
color 0A

echo.
echo  ============================================================
echo   INFRASHIELD BENGALURU  ^|  POLYBRAIN tm
echo  ============================================================
echo.

:: ── Kill anything holding port 8501 (Streamlit) ──────────────
echo [1/3] Clearing port 8501 (Streamlit)...
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":8501 " ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)

:: ── Kill anything holding port 8003 (FastAPI backend) ────────
echo [2/3] Clearing port 8003 (FastAPI backend)...
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":8003 " ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)

timeout /t 1 /nobreak >nul

:: ── Start FastAPI backend in background ──────────────────────
echo [3/3] Starting InfraShield backend on port 8003...
set "PROJ=C:\Users\kbasu\KBCowork\POLYBRAIN tm\infrashield-bengaluru"
start "InfraShield-Backend" /MIN cmd /c "cd /d "%PROJ%\backend" && python -m uvicorn main:app --host 0.0.0.0 --port 8003 --reload 2>&1"

timeout /t 3 /nobreak >nul

:: ── Launch Streamlit investor demo ───────────────────────────
echo.
echo  Launching Streamlit investor demo...
echo  URL: http://localhost:8501
echo.

:: Open browser after 4s delay (Streamlit needs a moment to spin up)
start "" /B timeout /t 4 /nobreak >nul & start "" "http://localhost:8501"

:: Run Streamlit in this window so the user sees logs + can Ctrl+C
cd /d "%PROJ%"
python -m streamlit run streamlit_app.py --server.port 8501 --server.headless true --browser.gatherUsageStats false

echo.
echo  InfraShield stopped. Press any key to close.
pause >nul
