@echo off
rem Публикация «Контроля задач» в IIS с любого компьютера сети (PowerShell Remoting).
rem   deploy-iis-remote.bat -Server ИМЯ_СЕРВЕРА [-AskCredential] [-NoSql] [-Check]
rem Подробности: scripts\deploy-remote.ps1 и docs\corporate-offline.md.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy-remote.ps1" %*
exit /b %errorlevel%
