@echo off
rem Open BRX: set up and start Mission Control on Windows. macOS and Linux: ./start.sh
rem Usage: start.cmd [--demo] [--help]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
if errorlevel 1 pause
exit /b %errorlevel%
