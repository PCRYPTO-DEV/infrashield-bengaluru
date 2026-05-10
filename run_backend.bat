@echo off
cd /d "%~dp0backend"
if not exist venv\Scripts\python.exe (
    echo Creating venv...
    python -m venv venv
    venv\Scripts\pip install -r requirements.txt -q
)
echo Starting InfraShield backend on port 8003...
venv\Scripts\python.exe -m uvicorn main:app --port 8003 --host 127.0.0.1
