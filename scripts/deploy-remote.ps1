# Публикация «Контроля задач» в IIS с любого компьютера сети.
# Комплект (dist-iis + deploy-iis.bat) передаётся на сервер по PowerShell Remoting (WinRM), и deploy-iis.bat
# выполняется на самом сервере с теми же шагами, что и при локальной публикации. Интернет не нужен.
#
#   deploy-iis-remote.bat -Server SRV-IIS
#   deploy-iis-remote.bat -Server SRV-IIS -AskCredential                      # войти другой учётной записью (окно логина и пароля)
#   deploy-iis-remote.bat -Server SRV-IIS -Check                              # только проверить сервер
#   deploy-iis-remote.bat -Server SRV-IIS -NoSql                              # базу настроил вручную (create-database.sql)
#
# Что нужно: учётная запись с правами администратора на сервере и включённый на нём WinRM
# (в Windows Server включён по умолчанию; иначе на сервере:  Enable-PSRemoting -Force).
# Если SQL Server стоит на другом компьютере, а не на сервере IIS, выполните скрипт create-database.sql
# вручную и публикуйте с ключом -NoSql: учётные данные не передаются с сервера IIS на третий компьютер.
[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$Server,
  [System.Management.Automation.PSCredential]$Credential,
  # Запросить логин и пароль окном вместо текущей учётной записи.
  [switch]$AskCredential,
  # Переопределения настроек deploy-iis.bat (без правки файла).
  [string]$Site,
  [string]$Pool,
  [string]$Ip,
  [string]$Port,
  [string]$Target,
  [string]$SqlServer,
  [string]$SqlDb,
  [string]$SqlLogin,
  [switch]$NoSql,
  [switch]$ResetSql,
  # Собрать комплект заново из исходников (нужны npm install и интернет на этом компьютере).
  [switch]$Build,
  # Только проверить сервер: связь, права, Node.js, iisnode, URL Rewrite, установленная версия.
  [switch]$Check,
  # Ключи в стиле deploy-iis.bat: /nosql, /resetsql, /nobuild.
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'

foreach ($item in $Rest) {
  if (-not $item) { continue }
  switch -Regex ($item) {
    '^/nosql$' { $NoSql = $true }
    '^/resetsql$' { $ResetSql = $true }
    '^/nobuild$' { }
    '^/check$' { $Check = $true }
    default { throw "Неизвестный параметр: $item" }
  }
}

function Say([string]$text) { Write-Host $text }
function Stop-With([string]$text, [int]$code = 1) {
  Write-Host ''
  Write-Host "ОШИБКА: $text" -ForegroundColor Red
  exit $code
}

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist-iis'
$bat = Join-Path $root 'deploy-iis.bat'

Say ''
Say '=== Контроль задач: публикация в IIS с другого компьютера ==='

if (-not $Server) { $Server = Read-Host 'Имя или адрес сервера IIS' }
if (-not $Server) { Stop-With 'не указан сервер: -Server ИМЯ_СЕРВЕРА.' 2 }
if ($AskCredential -and -not $Credential) { $Credential = Get-Credential -Message "Администратор сервера $Server" }

$auth = @{}
if ($Credential) { $auth.Credential = $Credential }

# --- Комплект ---------------------------------------------------------------
if (-not (Test-Path $bat)) { Stop-With "не найден $bat. Запускайте скрипт из папки проекта или распакованного архива." 2 }
if (-not $Check) {
  $haveSources = Test-Path (Join-Path $root 'node_modules')
  if ($Build -and -not $haveSources) { Stop-With 'ключ -Build требует исходников проекта с установленными пакетами (npm install).' 2 }
  if ($haveSources -and ($Build -or -not (Test-Path (Join-Path $dist 'server.cjs')))) {
    Say 'Сборка комплекта (npm run build:iis)...'
    Push-Location $root
    try { & npm run build:iis; if ($LASTEXITCODE -ne 0) { Stop-With 'сборка комплекта не выполнена.' 3 } } finally { Pop-Location }
  }
  if (-not (Test-Path (Join-Path $dist 'server.cjs'))) {
    Stop-With ("не найден готовый комплект $dist." + [Environment]::NewLine +
      '  Папки dist-iis в репозитории нет: это результат сборки. Возьмите архив task-control-iis-ВЕРСИЯ.zip (npm run pack:iis на компьютере с интернетом, либо выпуск проекта на GitHub) и запускайте скрипт из его распакованной папки.') 3
  }
}
$newVersion = if (Test-Path (Join-Path $dist 'version.txt')) { (Get-Content -Raw (Join-Path $dist 'version.txt')).Trim() } else { 'неизвестна' }

# --- Связь ------------------------------------------------------------------
Say "Сервер: $Server"
if ($Credential) { Say "Учётная запись: $($Credential.UserName)" } else { Say "Учётная запись: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)" }
Say 'Подключение по WinRM...'
try {
  $session = New-PSSession -ComputerName $Server @auth
} catch {
  $reason = $_.Exception.Message
  Stop-With ("не удалось подключиться к $Server." + [Environment]::NewLine +
    "  $reason" + [Environment]::NewLine +
    '  Проверьте: 1) сервер включён и доступен по сети (порт 5985);' + [Environment]::NewLine +
    '  2) на сервере включён WinRM:  Enable-PSRemoting -Force;' + [Environment]::NewLine +
    '  3) у вашей учётной записи есть права администратора на сервере (или укажите другую: -AskCredential);' + [Environment]::NewLine +
    '  4) если сервер не в домене или указан адрес, а не имя: на этом компьютере  Set-Item WSMan:\localhost\Client\TrustedHosts -Value "' + $Server + '"') 4
}

try {
  $targetPath = if ($Target) { $Target } else { 'C:\inetpub\wwwroot\PLAN' }

  # --- Проверка сервера ------------------------------------------------------
  $info = Invoke-Command -Session $session -ArgumentList $targetPath -ScriptBlock {
    param($target)
    $appcmd = Join-Path $env:windir 'system32\inetsrv\appcmd.exe'
    $modules = if (Test-Path $appcmd) { (& $appcmd list config /section:system.webServer/globalModules) -join ' ' } else { '' }
    $node = $null
    try { $node = (& node -v) } catch { $node = $null }
    $installed = $null
    $versionFile = Join-Path $target 'version.txt'
    if (Test-Path $versionFile) { $installed = (Get-Content -Raw $versionFile).Trim() }
    [pscustomobject]@{
      Computer = $env:COMPUTERNAME
      User = [Security.Principal.WindowsIdentity]::GetCurrent().Name
      Admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
      Iis = (Test-Path $appcmd)
      IisNode = ($modules -match 'iisnode')
      Rewrite = ($modules -match 'RewriteModule')
      Node = $node
      Installed = $installed
    }
  }
  $mark = { param($ok) if ($ok) { 'да' } else { 'НЕТ' } }
  Say ''
  Say "  Компьютер:               $($info.Computer)"
  Say "  Работает под:            $($info.User)"
  Say "  Права администратора:    $(& $mark $info.Admin)"
  Say "  Роль «Веб-сервер IIS»:   $(& $mark $info.Iis)"
  Say "  Модуль iisnode:          $(& $mark $info.IisNode)"
  Say "  Модуль URL Rewrite:      $(& $mark $info.Rewrite)"
  Say "  Node.js:                 $(if ($info.Node) { $info.Node } else { 'НЕТ' })"
  Say "  Версия на сервере:       $(if ($info.Installed) { $info.Installed } else { 'не установлено' })"
  if (-not $Check) { Say "  Версия комплекта:        $newVersion" }
  # Роли Windows Server deploy-iis.bat ставит сам, а Node.js, URL Rewrite и iisnode — из папки installers.
  $installers = Join-Path $root 'installers'
  $hasMsi = { param($mask) [bool](Get-ChildItem -Path $installers -Filter $mask -ErrorAction SilentlyContinue) }
  $missing = @()
  if (-not $info.Admin) { $missing += 'права администратора на сервере' }
  if (-not $info.IisNode -and -not (& $hasMsi 'iisnode*x64.msi')) { $missing += 'модуль iisnode (или iisnode-full-v0.2.26-x64.msi в папке installers)' }
  if (-not $info.Rewrite -and -not (& $hasMsi 'rewrite*.msi')) { $missing += 'модуль URL Rewrite (или rewrite_amd64_*.msi в папке installers)' }
  if (-not $info.Node -and -not (& $hasMsi 'node-v*-x64.msi')) { $missing += 'Node.js 18 или новее (или node-v*-x64.msi в папке installers)' }
  if ($missing.Count) {
    Stop-With ('на сервере не хватает: ' + ($missing -join ', ') + '. Положите установщики .msi в папку installers рядом с deploy-iis.bat и повторите.') 5
  }
  if (-not ($info.Iis -and $info.IisNode -and $info.Rewrite -and $info.Node)) { Say '  Недостающее установит deploy-iis.bat.' }
  if ($Check) { Say ''; Say 'Сервер готов к публикации.'; exit 0 }

  # --- Передача комплекта -----------------------------------------------------
  Say ''
  Say 'Подготовка комплекта к передаче...'
  $zip = Join-Path ([IO.Path]::GetTempPath()) ("task-control-iis-" + [guid]::NewGuid().ToString('N') + '.zip')
  $parts = @($dist, $bat)
  if (Test-Path $installers) { $parts += $installers }
  Compress-Archive -Path $parts -DestinationPath $zip -Force
  $sizeMb = [math]::Round((Get-Item $zip).Length / 1MB, 1)

  $remoteDir = Invoke-Command -Session $session -ScriptBlock {
    $dir = Join-Path ([IO.Path]::GetTempPath()) 'task-control-deploy'
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    New-Item -ItemType Directory -Path $dir | Out-Null
    $dir
  }
  Say "Передача комплекта на сервер ($sizeMb МБ)..."
  Copy-Item -Path $zip -Destination (Join-Path $remoteDir 'package.zip') -ToSession $session
  Remove-Item $zip -Force

  # --- Выполнение на сервере --------------------------------------------------
  $envs = @{}
  if ($Site) { $envs.TC_IIS_SITE = $Site }
  if ($Pool) { $envs.TC_IIS_POOL = $Pool }
  if ($Ip) { $envs.TC_IIS_IP = $Ip }
  if ($Port) { $envs.TC_IIS_PORT = $Port }
  if ($Target) { $envs.TC_IIS_TARGET = $Target }
  if ($SqlServer) { $envs.TC_SQLSERVER = $SqlServer }
  if ($SqlDb) { $envs.TC_SQLDB = $SqlDb }
  if ($SqlLogin) { $envs.TC_SQLLOGIN = $SqlLogin }
  # Пул запускается под учётной записью публикующего; окна для пароля на сервере нет — передаём его отсюда.
  if ($Credential) { $envs.TC_IIS_POOL_PASSWORD = $Credential.GetNetworkCredential().Password }
  $flags = @()
  if ($NoSql) { $flags += '/nosql' }
  if ($ResetSql) { $flags += '/resetsql' }

  Say 'Публикация на сервере (deploy-iis.bat)...'
  $result = Invoke-Command -Session $session -ArgumentList $remoteDir, $envs, ($flags -join ' ') -ScriptBlock {
    param($dir, $envs, $flags)
    Expand-Archive -Path (Join-Path $dir 'package.zip') -DestinationPath $dir -Force
    foreach ($key in $envs.Keys) { Set-Item -Path "Env:$key" -Value $envs[$key] }
    $log = Join-Path $dir 'deploy.log'
    Push-Location $dir
    try {
      # Вывод батника — в файл: так кириллица доходит без искажений.
      & cmd.exe /c ('deploy-iis.bat ' + $flags + ' > "' + $log + '" 2>&1')
      $code = $LASTEXITCODE
    } finally { Pop-Location }
    $bytes = if (Test-Path $log) { [IO.File]::ReadAllBytes($log) } else { [byte[]]@() }
    [pscustomobject]@{ Code = $code; Bytes = $bytes; Oem = [Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage }
  }

  # Журнал: UTF-8 (батник включает кодовую страницу 65001); если не получилось — кодовая страница консоли сервера.
  $text = $null
  try { $text = (New-Object System.Text.UTF8Encoding($false, $true)).GetString([byte[]]$result.Bytes) }
  catch { $text = [Text.Encoding]::GetEncoding([int]$result.Oem).GetString([byte[]]$result.Bytes) }
  $text = $text.TrimStart([char]0xFEFF)
  Say ''
  Say '--- Вывод deploy-iis.bat на сервере ---'
  Say $text.TrimEnd()
  Say '---------------------------------------'
  $logFile = Join-Path $root ("deploy-remote-" + ($Server -replace '[^\w.-]', '_') + '.log')
  [IO.File]::WriteAllText($logFile, $text, (New-Object System.Text.UTF8Encoding($true)))

  Invoke-Command -Session $session -ArgumentList $remoteDir -ScriptBlock {
    param($dir)
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  }

  if ($result.Code -ne 0) {
    Stop-With "deploy-iis.bat на сервере завершился с ошибкой (код $($result.Code)). Журнал сохранён: $logFile" 6
  }

  # --- Итог: версия на сервере и ответ приложения -----------------------------
  $after = Invoke-Command -Session $session -ArgumentList $targetPath -ScriptBlock {
    param($target)
    $f = Join-Path $target 'version.txt'
    if (Test-Path $f) { (Get-Content -Raw $f).Trim() } else { $null }
  }
  Say ''
  Say "Готово. Версия на сервере: $(if ($after) { $after } else { 'неизвестна' })."
  $address = [regex]::Match($text, 'http://\S+?/(?=\s|$)')
  if ($address.Success) {
    $url = $address.Value.TrimEnd('/')
    try {
      $health = Invoke-RestMethod -Uri "$url/api/health" -UseDefaultCredentials -TimeoutSec 20
      Say "Проверка $url/api/health: storage = $($health.storage)."
    } catch {
      Say "Приложение опубликовано, но ответ $url/api/health с этого компьютера получить не удалось: $($_.Exception.Message)"
    }
  }
  Say "Журнал: $logFile"
} finally {
  if ($session) { Remove-PSSession $session -ErrorAction SilentlyContinue }
}
