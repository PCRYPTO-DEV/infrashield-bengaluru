$vbs     = 'C:\Users\kbasu\KBCowork\POLYBRAIN tm\infrashield-bengaluru\start_backend_silent.vbs'
$startup = 'C:\Users\kbasu\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup'
$lnkPath = $startup + '\InfraShield Backend.lnk'

$shell = New-Object -ComObject WScript.Shell
$link  = $shell.CreateShortcut($lnkPath)
$link.TargetPath   = 'wscript.exe'
$link.Arguments    = '"' + $vbs + '"'
$link.Description  = 'InfraShield Backend Auto-Start'
$link.Save()

Write-Host "Shortcut installed: $lnkPath"
Test-Path $lnkPath
