@echo off
rem Open BRX Mission Control — double-click to (re)start. Kills any prior MC first.
taskkill /f /fi "WINDOWTITLE eq BRX Mission Control*" >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'brx_mcp' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
ping -n 3 127.0.0.1 >nul
cd /d C:\Users\Tony\.brx-mcp
start "BRX Mission Control" /min cmd /c "C:\Users\Tony\.brx-mcp\venv\Scripts\python.exe -u -m brx_mcp.mc --no-auth > C:\Users\Tony\.brx-mcp\mc.log 2> C:\Users\Tony\.brx-mcp\mc.err.log"
