@echo off
rem Builds the offline IIS package: deploy\out\Plan-IIS\ and deploy\out\Plan-IIS-<version>.zip
rem Copy the package to the server (10.199.127.27) and run install.bat there as administrator:
rem   site http://10.199.127.27:1500/  folder C:\inetpub\wwwroot\Plan  database: local SQL Server.
rem Optional argument: a folder to copy the package to, e.g.  publish-iis.bat \10.199.127.27\c$\Deploy
setlocal
cd /d "%~dp0"
if not exist node_modules\msnodesqlv8 (
  call npm ci
  if errorlevel 1 goto :fail
)
call npm run build:iis
if errorlevel 1 goto :fail
if not "%~1"=="" (
  robocopy deploy\out\Plan-IIS "%~1\Plan-IIS" /MIR /R:2 /W:2 /NFL /NDL /NJH /NP
  if errorlevel 8 goto :fail
  echo.
  echo Package copied to %~1\Plan-IIS - run install.bat there on the server.
)
echo.
echo Done. Package: %~dp0deploy\out\Plan-IIS  -  on the server run install.bat as administrator.
exit /b 0
:fail
echo.
echo BUILD FAILED
exit /b 1
