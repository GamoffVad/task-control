@echo off
rem Task Control (Plan): install or update on IIS + SQL Server. Works offline.
rem Run on the server as administrator. Parameters are passed to install.ps1, e.g.:
rem   install.bat -Port 1500 -SitePath C:\inetpub\wwwroot\Plan -SqlServer .\SQLEXPRESS -Database Plan
setlocal
chcp 65001 >nul
net session >nul 2>&1
if errorlevel 1 (
  echo Requesting administrator rights...
  if "%~1"=="" (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  ) else (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  )
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%
