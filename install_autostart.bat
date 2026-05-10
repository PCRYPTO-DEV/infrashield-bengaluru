@echo off
title InfraShield — Install Auto-Start
setlocal

set VBS=%~dp0start_backend_silent.vbs
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT=%STARTUP%\InfraShield Backend.lnk

echo Installing InfraShield backend auto-start...

:: Create a shortcut in the Windows Startup folder using PowerShell
powershell -Command ^
  "$s=(New-Object -COM WScript.Shell).CreateShortcut('%SHORTCUT%');^
   $s.TargetPath='wscript.exe';^
   $s.Arguments='\"%VBS%\"';^
   $s.WorkingDirectory='%~dp0';^
   $s.Description='InfraShield Backend Auto-Start';^
   $s.Save()"

if exist "%SHORTCUT%" (
    echo.
    echo  Backend will now start automatically on Windows login.
    echo  Shortcut: %SHORTCUT%
    echo.
    echo  Starting backend now...
    wscript.exe "%VBS%"
    echo  Backend starting in background on port 8000.
) else (
    echo  ERROR: Could not create startup shortcut. Try running as Administrator.
)

echo.
pause
