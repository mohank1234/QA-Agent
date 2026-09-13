Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""D:\qa-agent\scripts\start-dev-server.ps1""", 0, True
