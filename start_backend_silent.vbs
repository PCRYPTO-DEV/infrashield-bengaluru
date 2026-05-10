Set objShell = CreateObject("WScript.Shell")
Set objFSO   = CreateObject("Scripting.FileSystemObject")

backendDir = objFSO.GetParentFolderName(WScript.ScriptFullName) & "\backend"

' Create venv if missing
If Not objFSO.FolderExists(backendDir & "\venv") Then
    objShell.Run "cmd /c cd /d """ & backendDir & """ && python -m venv venv && venv\Scripts\pip install -r requirements.txt -q", 0, True
End If

' Start uvicorn silently (window hidden)
objShell.Run "cmd /c cd /d """ & backendDir & """ && venv\Scripts\python.exe -m uvicorn main:app --port 8003 --host 0.0.0.0", 0, False
