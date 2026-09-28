@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  Публикация приложения «Контроль задач» в IIS
rem  Адрес: http://10.199.127.27:1500  Папка: C:\inetpub\wwwroot\PLAN
rem  Запускать от имени администратора.
rem  Ключ /nobuild — только копирование и настройка IIS, без пересборки.
rem ============================================================

set "SITE=PLAN"
set "POOL=PLAN"
set "IP=10.199.127.27"
set "PORT=1500"
set "TARGET=C:\inetpub\wwwroot\PLAN"
set "SOURCE=%~dp0dist-iis"
set "APPCMD=%windir%\system32\inetsrv\appcmd.exe"
set "SECTION=system.webServer/security/authentication"

echo.
echo === Контроль задач: публикация в IIS ===
echo Сайт:   %SITE%
echo Адрес:  http://%IP%:%PORT%/
echo Папка:  %TARGET%
echo.

rem --- Проверки окружения -------------------------------------
net session >nul 2>&1
if errorlevel 1 (
  echo ОШИБКА: запустите файл от имени администратора.
  goto :fail
)

if not exist "%APPCMD%" (
  echo ОШИБКА: не найден %APPCMD%. Установите роль "Веб-сервер IIS".
  goto :fail
)

for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%i"
if not defined NODE_EXE (
  echo ОШИБКА: не найден node.exe. Установите Node.js 18 или новее.
  goto :fail
)

rem Список установленных модулей: appcmd при пустом ответе возвращает 0, поэтому ищем по имени.
"%APPCMD%" list config /section:system.webServer/globalModules | findstr /i "iisnode" >nul
if errorlevel 1 (
  echo ОШИБКА: не установлен модуль iisnode. Скачайте и установите iisnode для IIS, затем повторите запуск.
  goto :fail
)

"%APPCMD%" list config /section:system.webServer/globalModules | findstr /i "RewriteModule" >nul
if errorlevel 1 (
  echo ОШИБКА: не установлен модуль URL Rewrite. Установите его и повторите запуск.
  goto :fail
)

rem --- Сборка комплекта ---------------------------------------
if /i "%~1"=="/nobuild" goto :copy

echo [1/6] Сборка комплекта...
pushd "%~dp0"
call npm run build:iis
set "BUILD=%errorlevel%"
popd
if not "%BUILD%"=="0" (
  echo ОШИБКА: сборка не выполнена.
  goto :fail
)

:copy
if not exist "%SOURCE%\server.cjs" (
  echo ОШИБКА: не найден комплект %SOURCE%. Запустите файл без ключа /nobuild.
  goto :fail
)

echo [2/6] Копирование файлов...
if not exist "%TARGET%" mkdir "%TARGET%"
if not exist "%TARGET%\web.config" (
  copy /y "%SOURCE%\web.config" "%TARGET%\web.config" >nul
  rem iisnode по умолчанию ищет node.exe в Program Files; записываем найденный путь.
  powershell -NoProfile -Command "$p='%TARGET%\web.config'; $t=Get-Content -Raw -Encoding UTF8 $p; $t=$t -replace '<iisnode ', '<iisnode nodeProcessCommandLine=''\"%NODE_EXE%\"'' '; Set-Content -Path $p -Value $t -Encoding UTF8 -NoNewline"
)
rem Настройки и данные сохраняются: web.config и папка data не перезаписываются и не удаляются.
robocopy "%SOURCE%" "%TARGET%" /MIR /XF web.config /XD data iisnode /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo ОШИБКА: копирование не выполнено.
  goto :fail
)
if not exist "%TARGET%\data" mkdir "%TARGET%\data"
rem Журналы iisnode пишутся в папку рядом с приложением.
if not exist "%TARGET%\iisnode" mkdir "%TARGET%\iisnode"

echo [3/6] Права доступа...
icacls "%TARGET%" /grant "IIS_IUSRS:(OI)(CI)(RX)" /T /C >nul
icacls "%TARGET%\data" /grant "IIS_IUSRS:(OI)(CI)(M)" /T /C >nul
icacls "%TARGET%\iisnode" /grant "IIS_IUSRS:(OI)(CI)(M)" /T /C >nul

rem --- Пул приложений -----------------------------------------
echo [4/6] Пул приложений...
"%APPCMD%" list apppool "%POOL%" >nul 2>&1
if errorlevel 1 "%APPCMD%" add apppool /name:"%POOL%" >nul
rem Без управляемого кода, без простоя и перезапусков по расписанию: сервер Node.js держится постоянно.
"%APPCMD%" set apppool "%POOL%" /managedRuntimeVersion:"" /startMode:"AlwaysRunning" /processModel.idleTimeout:"00:00:00" /recycling.periodicRestart.time:"00:00:00" >nul
icacls "%TARGET%\data" /grant "IIS AppPool\%POOL%:(OI)(CI)(M)" /T /C >nul
icacls "%TARGET%\iisnode" /grant "IIS AppPool\%POOL%:(OI)(CI)(M)" /T /C >nul

rem --- Сайт ----------------------------------------------------
echo [5/6] Сайт и привязка...
"%APPCMD%" list site "%SITE%" >nul 2>&1
if errorlevel 1 (
  "%APPCMD%" add site /name:"%SITE%" /bindings:"http/%IP%:%PORT%:" /physicalPath:"%TARGET%" >nul
) else (
  "%APPCMD%" set site "%SITE%" /bindings:"http/%IP%:%PORT%:" >nul
  "%APPCMD%" set vdir "%SITE%/" /physicalPath:"%TARGET%" >nul
)
"%APPCMD%" set app "%SITE%/" /applicationPool:"%POOL%" >nul

rem --- Windows-аутентификация ----------------------------------
echo [6/6] Windows-аутентификация...
"%APPCMD%" set config "%SITE%" /section:%SECTION%/anonymousAuthentication /enabled:false /commit:apphost >nul
"%APPCMD%" set config "%SITE%" /section:%SECTION%/basicAuthentication /enabled:false /commit:apphost >nul
"%APPCMD%" set config "%SITE%" /section:%SECTION%/windowsAuthentication /enabled:true /commit:apphost >nul
rem Negotiate должен стоять выше NTLM: удаляем NTLM и добавляем его заново в конец списка.
"%APPCMD%" set config "%SITE%" /section:%SECTION%/windowsAuthentication /-"providers.[value='NTLM']" /commit:apphost >nul 2>&1
"%APPCMD%" set config "%SITE%" /section:%SECTION%/windowsAuthentication /+"providers.[value='NTLM']" /commit:apphost >nul 2>&1

rem Правило передаёт приложению подтверждённого доменного пользователя.
"%APPCMD%" set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_WINDOWS_USER']" /commit:apphost >nul 2>&1
"%APPCMD%" set config "%SITE%" -section:system.webServer/rewrite/rules /+"[name='Windows user',patternSyntax='ECMAScript',stopProcessing='False']" /commit:apphost >nul 2>&1
"%APPCMD%" set config "%SITE%" -section:system.webServer/rewrite/rules /"[name='Windows user'].match.url:.*" /commit:apphost >nul 2>&1
"%APPCMD%" set config "%SITE%" -section:system.webServer/rewrite/rules /+"[name='Windows user'].serverVariables.[name='HTTP_X_WINDOWS_USER',value='{LOGON_USER}',replace='True']" /commit:apphost >nul 2>&1
"%APPCMD%" set config "%SITE%" -section:system.webServer/rewrite/rules /"[name='Windows user'].action.type:None" /commit:apphost >nul 2>&1

rem --- Брандмауэр и запуск -------------------------------------
netsh advfirewall firewall show rule name="TaskControl %PORT%" >nul 2>&1
if errorlevel 1 netsh advfirewall firewall add rule name="TaskControl %PORT%" dir=in action=allow protocol=TCP localport=%PORT% >nul

"%APPCMD%" start apppool "%POOL%" >nul 2>&1
"%APPCMD%" start site "%SITE%" >nul 2>&1

echo.
echo Готово. Приложение доступно по адресу http://%IP%:%PORT%/
echo.
echo Дальше:
echo  1. Задать настройки в разделе appSettings файла %TARGET%\web.config:
echo     MSSQL_SERVER — имя SQL Server, MSSQL_USER и MSSQL_PASSWORD — учётная запись SQL Server,
echo     AUTH_SECRET — длинная случайная строка. База и таблицы создадутся при первом запуске.
echo  2. Войти администратором, открыть Администрирование ^> Аутентификация
echo     и нажать «Проверить настройку»: там видно, какой доменный логин получил сервер.
echo  3. Заполнить Windows-логины сотрудников и включить режим «Windows-аутентификация».
echo  4. Полная инструкция: docs\corporate-offline.md
echo.
goto :end

:fail
echo.
echo Публикация прервана.
endlocal
exit /b 1

:end
endlocal
exit /b 0
