@echo off
title POLYMATH INFRASHIELD — Stop
echo Stopping InfraShield services...
taskkill /FI "WINDOWTITLE eq InfraShield Backend*" /T /F > nul 2>&1
taskkill /FI "WINDOWTITLE eq InfraShield Frontend*" /T /F > nul 2>&1
echo Done.
timeout /t 2 /nobreak > nul
