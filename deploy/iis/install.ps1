<#
.SYNOPSIS
  Установка «Контроля задач» в IIS с базой в локальном SQL Server. Интернет не нужен.

.DESCRIPTION
  1. Включает компоненты Windows: IIS, ASP.NET 4.x, Windows-аутентификацию (из хранилища компонентов, без Windows Update).
  2. Создаёт базу SQL Server и таблицы (db\schema.sql).
  3. Копирует сайт в папку, создаёт пул и сайт IIS на заданном порту.
  4. Даёт учётной записи пула доступ к базе (вход Windows, без паролей), открывает порт в брандмауэре.
  5. Запускает сайт и проверяет, что приложение отвечает и работает с базой.
  Повторный запуск обновляет приложение: база и данные сохраняются, ключ сеансов не меняется.

.EXAMPLE
  install.bat
  install.bat -Port 1600 -SqlServer .\SQLEXPRESS -Database Plan
#>
[CmdletBinding()]
param(
  [string]$SiteName = 'Plan',
  [int]$Port = 1500,
  [string]$SitePath = 'C:\inetpub\wwwroot\Plan',
  # Адрес сервера в сети — для итоговой ссылки.
  [string]$PublicHost = '10.199.127.27',
  # Экземпляр SQL Server; пусто — локальный экземпляр самой новой версии.
  [string]$SqlServer = '',
  [string]$Database = 'Plan',
  # Вход в SQL Server для создания базы; пусто — Windows-вход того, кто запускает установку (нужна роль sysadmin).
  [string]$SqlAdminUser = '',
  [string]$SqlAdminPassword = '',
  # Вход через Windows (Kerberos/NTLM) для адреса /api/windows-login: auto — если компонент IIS доступен.
  [ValidateSet('auto', 'on', 'off')]
  [string]$WindowsAuth = 'auto',
  # Поиск сотрудников в Active Directory (нужен модуль PowerShell ActiveDirectory из RSAT).
  [switch]$AdSearch,
  [string]$AdSearchBase = '',
  [switch]$SkipFeatures,
  [switch]$SkipFirewall
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pool = $SiteName
$poolAccount = "IIS APPPOOL\$pool"
$inetsrv = Join-Path $env:WINDIR 'System32\inetsrv'

function Step([string]$text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "    $text" -ForegroundColor Green }
function Info([string]$text) { Write-Host "    $text" }
function Warn([string]$text) { Write-Host "    $text" -ForegroundColor Yellow }

function New-Secret {
  $bytes = New-Object byte[] 48
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-SqlConnectionString([string]$db) {
  $auth = if ($SqlAdminUser) { "User ID=$SqlAdminUser;Password=$SqlAdminPassword;" } else { 'Integrated Security=SSPI;' }
  return "Server=$SqlServer;Database=$db;${auth}TrustServerCertificate=True;Connect Timeout=20;Application Name=Plan installer"
}

function Invoke-Sql([string]$db, [string]$text, [switch]$Scalar) {
  $connection = New-Object System.Data.SqlClient.SqlConnection (Get-SqlConnectionString $db)
  try {
    $connection.Open()
    $command = $connection.CreateCommand()
    $command.CommandText = $text
    $command.CommandTimeout = 300
    if ($Scalar) { return $command.ExecuteScalar() }
    [void]$command.ExecuteNonQuery()
  } finally {
    $connection.Dispose()
  }
}

function Get-Http([string]$url) {
  $request = [Net.HttpWebRequest]::Create($url)
  $request.Proxy = $null
  $request.Timeout = 90000
  try {
    $response = $request.GetResponse()
  } catch [Net.WebException] {
    $response = $_.Exception.Response
    if (-not $response) { return @{ Status = 0; Body = $_.Exception.Message } }
  }
  try {
    $reader = New-Object IO.StreamReader($response.GetResponseStream(), [Text.Encoding]::UTF8)
    return @{ Status = [int]$response.StatusCode; Body = $reader.ReadToEnd() }
  } finally {
    $response.Close()
  }
}

function Show-LogTail {
  $log = Get-ChildItem (Join-Path $SitePath 'App_Data\logs') -Filter 'node-*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
  if ($log) {
    Warn "Последние строки журнала $($log.FullName):"
    Get-Content $log.FullName -Tail 15 -Encoding UTF8 | ForEach-Object { Info $_ }
  }
}

try {
  # ——— Проверки ———
  Step 'Проверка'
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Запустите установку от имени администратора.' }
  if (-not [Environment]::Is64BitProcess) { throw 'Нужен 64-разрядный PowerShell (Windows x64).' }
  foreach ($name in @('site\web.config', 'site\index.html', 'site\bin\PlanHost.dll', 'site\App_Data\node\node.exe', 'site\App_Data\server\server.cjs', 'db\schema.sql')) {
    if (-not (Test-Path (Join-Path $here $name))) { throw "Пакет неполный: нет $name. Распакуйте архив целиком." }
  }
  if ($SiteName -notmatch '^[A-Za-z0-9_.-]{1,64}$') { throw 'Имя сайта: латинские буквы, цифры, «_», «.», «-».' }
  if ($Database -notmatch '^[A-Za-z0-9_]{1,100}$') { throw 'Имя базы: латинские буквы, цифры и «_».' }
  if ($Port -lt 1 -or $Port -gt 65535) { throw "Неверный порт: $Port" }
  $SitePath = [IO.Path]::GetFullPath($SitePath)
  Get-ChildItem $here -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
  $version = (Get-Content (Join-Path $here 'VERSION.txt') -TotalCount 1 -ErrorAction SilentlyContinue)
  Ok "Пакет версии $version; сайт «$SiteName», порт $Port, папка $SitePath"

  # ——— Компоненты Windows ———
  $windowsAuthReady = $false
  if ($SkipFeatures) {
    Step 'Компоненты Windows — пропущено (-SkipFeatures)'
    $windowsAuthReady = $WindowsAuth -ne 'off'
  } else {
    Step 'Компоненты Windows: IIS и ASP.NET 4.x'
    $required = @('IIS-WebServerRole', 'IIS-WebServer', 'IIS-CommonHttpFeatures', 'IIS-StaticContent', 'IIS-DefaultDocument', 'IIS-HttpErrors',
      'IIS-Security', 'IIS-RequestFiltering', 'IIS-ApplicationDevelopment', 'NetFx4Extended-ASPNET45', 'IIS-NetFxExtensibility45',
      'IIS-ISAPIExtensions', 'IIS-ISAPIFilter', 'IIS-ASPNET45')
    $optional = @('IIS-HttpCompressionStatic', 'IIS-ManagementConsole')
    if ($WindowsAuth -ne 'off') { $optional += 'IIS-WindowsAuthentication' }
    $states = @{}
    Get-WindowsOptionalFeature -Online | ForEach-Object { $states[$_.FeatureName] = [string]$_.State }
    $restart = $false
    foreach ($feature in ($required + $optional)) {
      if (-not $states.ContainsKey($feature)) {
        if ($required -contains $feature) { Warn "Компонент $feature в этой версии Windows не найден — пропуск" }
        continue
      }
      if ($states[$feature] -eq 'Enabled') { continue }
      Info "Включение $feature…"
      try {
        $result = Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart -LimitAccess
        if ($result.RestartNeeded) { $restart = $true }
        $states[$feature] = 'Enabled'
      } catch {
        if ($required -contains $feature) {
          throw "Не удалось включить $feature без интернета: $($_.Exception.Message)`nПодключите дистрибутив Windows Server (например, D:) и выполните:`n  Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -Source D:\sources\sxs -LimitAccess"
        }
        Warn "Не удалось включить $feature — пропуск: $($_.Exception.Message)"
      }
    }
    $windowsAuthReady = $states['IIS-WindowsAuthentication'] -eq 'Enabled'
    if ($restart) { Warn 'Windows просит перезагрузку для завершения установки компонентов. Если сайт не заработает — перезагрузите сервер и запустите установку снова.' }
    Ok 'IIS и ASP.NET 4.x готовы'
  }
  if ($WindowsAuth -eq 'on' -and -not $windowsAuthReady) { throw 'Компонент «Windows-аутентификация» IIS недоступен (-WindowsAuth on).' }
  $useWindowsAuth = ($WindowsAuth -ne 'off') -and $windowsAuthReady
  if (-not (Test-Path (Join-Path $inetsrv 'Microsoft.Web.Administration.dll'))) { throw 'IIS не установлен: нет Microsoft.Web.Administration.dll.' }
  Add-Type -Path (Join-Path $inetsrv 'Microsoft.Web.Administration.dll')

  # ——— SQL Server ———
  Step 'SQL Server'
  if (-not $SqlServer) {
    $names = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL' -ErrorAction SilentlyContinue
    if (-not $names) { throw 'На этом сервере не найден SQL Server. Установите его или укажите -SqlServer.' }
    # Самая новая версия (MSSQL17.* — SQL Server 2025), при равенстве — экземпляр по умолчанию.
    $instance = $names.PSObject.Properties |
      Where-Object { $_.Name -notlike 'PS*' } |
      Sort-Object @{ Expression = { [int](([string]$_.Value) -replace '^MSSQL(\d+)\..*$', '$1') }; Descending = $true }, @{ Expression = { $_.Name -ne 'MSSQLSERVER' } } |
      Select-Object -First 1
    $service = if ($instance.Name -eq 'MSSQLSERVER') { 'MSSQLSERVER' } else { "MSSQL`$$($instance.Name)" }
    $SqlServer = if ($instance.Name -eq 'MSSQLSERVER') { '.' } else { ".\$($instance.Name)" }
    $svc = Get-Service $service -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne 'Running') {
      Info "Запуск службы $service…"
      if ($svc.StartType -eq 'Disabled') { Set-Service $service -StartupType Automatic }
      Start-Service $service
    }
    Info "Экземпляр: $SqlServer ($($instance.Value))"
  }
  $sqlVersion = Invoke-Sql 'master' "select cast(serverproperty('ProductVersion') as nvarchar(40)) + N' ' + cast(serverproperty('Edition') as nvarchar(100))" -Scalar
  Ok "Подключение есть: $sqlVersion"

  # Драйвер ODBC для сервера API: новый, если установлен, иначе встроенный в Windows.
  $drivers = @((Get-ItemProperty 'HKLM:\SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers' -ErrorAction SilentlyContinue).PSObject.Properties | ForEach-Object { $_.Name })
  $driver = @('ODBC Driver 18 for SQL Server', 'ODBC Driver 17 for SQL Server', 'SQL Server Native Client 11.0', 'SQL Server') | Where-Object { $drivers -contains $_ } | Select-Object -First 1
  if (-not $driver) { throw 'Не найден драйвер ODBC для SQL Server.' }
  $encrypt = if ($driver -like 'ODBC Driver*') { 'Encrypt=yes;TrustServerCertificate=yes;' } else { '' }
  $appConnection = "Driver={$driver};Server=$SqlServer;Database=$Database;Trusted_Connection=yes;${encrypt}APP=Plan"
  Info "Драйвер ODBC: $driver"

  Step "База данных [$Database]"
  $created = Invoke-Sql 'master' "if db_id(N'$Database') is null begin create database [$Database] collate Cyrillic_General_CI_AS; select 1; end else select 0;" -Scalar
  if ($created -eq 1) { Ok 'База создана' } else { Ok 'База уже есть — данные сохраняются' }
  $snapshot = Invoke-Sql 'master' "select is_read_committed_snapshot_on from sys.databases where name = N'$Database'" -Scalar
  if (-not $snapshot) { Invoke-Sql 'master' "alter database [$Database] set read_committed_snapshot on with rollback immediate" }
  Invoke-Sql $Database ([IO.File]::ReadAllText((Join-Path $here 'db\schema.sql'), [Text.Encoding]::UTF8))
  $tables = Invoke-Sql $Database "select count(*) from sys.tables where name like N'tc[_]%'" -Scalar
  Ok "Таблиц приложения: $tables"

  # ——— Остановка прежней версии ———
  Step 'IIS: остановка прежней версии'
  $manager = New-Object Microsoft.Web.Administration.ServerManager
  $existingSite = $manager.Sites[$SiteName]
  $existingPool = $manager.ApplicationPools[$pool]
  if ($existingSite -and $existingSite.State -eq 'Started') { [void]$existingSite.Stop(); Info 'Сайт остановлен' }
  if ($existingPool -and $existingPool.State -eq 'Started') {
    [void]$existingPool.Stop()
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Seconds 1
      $state = (New-Object Microsoft.Web.Administration.ServerManager).ApplicationPools[$pool].State
      if ($state -eq 'Stopped') { break }
    }
    Info 'Пул остановлен'
  }
  # Сервер API завершается вместе с пулом; оставшиеся процессы держали бы файлы.
  Start-Sleep -Seconds 1
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($SitePath, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Info "Завершён node.exe ($($_.ProcessId))" }
  if (-not $existingSite -and -not $existingPool) { Info 'Прежней версии нет' }

  # ——— Файлы ———
  Step "Файлы сайта → $SitePath"
  $previous = @{}
  $webConfig = Join-Path $SitePath 'web.config'
  if (Test-Path $webConfig) {
    try {
      $old = New-Object Xml.XmlDocument
      $old.Load($webConfig)
      foreach ($node in $old.SelectNodes('/configuration/appSettings/add')) { $previous[$node.GetAttribute('key')] = $node.GetAttribute('value') }
    } catch { Warn "Прежний web.config не прочитан: $($_.Exception.Message)" }
  }
  New-Item -ItemType Directory -Force $SitePath | Out-Null
  $logs = Join-Path $SitePath 'App_Data\logs'
  & robocopy (Join-Path $here 'site') $SitePath /MIR /XD $logs /R:3 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Ошибка копирования файлов (robocopy, код $LASTEXITCODE). Закрыты ли программы, использующие папку сайта?" }
  New-Item -ItemType Directory -Force $logs | Out-Null
  Ok 'Скопировано'

  # Настройки: строка подключения — новая, ключ сеансов и ручные правки администратора — прежние.
  $config = New-Object Xml.XmlDocument
  $config.PreserveWhitespace = $true
  $config.Load($webConfig)
  $settings = $config.SelectSingleNode('/configuration/appSettings')
  $values = @{
    'WindowsAuth'                 = if ($useWindowsAuth) { 'true' } else { 'false' }
    'env:MSSQL_CONNECTION_STRING' = $appConnection
    'env:AUTH_SECRET'             = if ($previous['env:AUTH_SECRET']) { $previous['env:AUTH_SECRET'] } else { New-Secret }
    'env:AD_SEARCH_ENABLED'       = if ($AdSearch) { 'true' } elseif ($previous['env:AD_SEARCH_ENABLED']) { $previous['env:AD_SEARCH_ENABLED'] } else { 'false' }
    'env:AD_SEARCH_BASE'          = if ($AdSearchBase) { $AdSearchBase } elseif ($previous.ContainsKey('env:AD_SEARCH_BASE')) { $previous['env:AD_SEARCH_BASE'] } else { '' }
  }
  foreach ($key in $previous.Keys) { if (-not $values.ContainsKey($key) -and -not $settings.SelectSingleNode("add[@key='$key']")) { $values[$key] = $previous[$key] } }
  foreach ($key in $values.Keys) {
    $node = $settings.SelectSingleNode("add[@key='$key']")
    if (-not $node) {
      $node = $config.CreateElement('add')
      $node.SetAttribute('key', $key)
      [void]$settings.AppendChild($node)
    }
    $node.SetAttribute('value', [string]$values[$key])
  }
  $config.Save($webConfig)
  Ok "web.config: вход Windows — $(if ($useWindowsAuth) { 'включён' } else { 'выключен' }), поиск в AD — $($values['env:AD_SEARCH_ENABLED'])"

  # ——— Пул и сайт IIS ———
  Step "IIS: пул «$pool» и сайт «$SiteName» на порту $Port"
  $manager = New-Object Microsoft.Web.Administration.ServerManager
  foreach ($other in $manager.Sites) {
    if ($other.Name -eq $SiteName) { continue }
    foreach ($binding in $other.Bindings) {
      if ($binding.Protocol -notin @('http', 'https')) { continue }
      $bindingPort = ($binding.BindingInformation -split ':')[1]
      if ($bindingPort -eq [string]$Port) { throw "Порт $Port уже занят сайтом IIS «$($other.Name)». Укажите другой: install.bat -Port <порт>" }
    }
  }
  $appPool = $manager.ApplicationPools[$pool]
  if (-not $appPool) { $appPool = $manager.ApplicationPools.Add($pool) }
  $appPool.ManagedRuntimeVersion = 'v4.0'
  $appPool.ManagedPipelineMode = [Microsoft.Web.Administration.ManagedPipelineMode]::Integrated
  $appPool.Enable32BitAppOnWin64 = $false
  $appPool.AutoStart = $true
  $appPool.StartMode = [Microsoft.Web.Administration.StartMode]::AlwaysRunning
  $appPool.ProcessModel.IdentityType = [Microsoft.Web.Administration.ProcessModelIdentityType]::ApplicationPoolIdentity
  $appPool.ProcessModel.LoadUserProfile = $true
  # Без остановки по простою: иначе первый запрос после паузы ждал бы запуска сервера API.
  $appPool.ProcessModel.IdleTimeout = [TimeSpan]::Zero
  $site = $manager.Sites[$SiteName]
  if (-not $site) {
    $site = $manager.Sites.Add($SiteName, 'http', "*:${Port}:", $SitePath)
  } else {
    $site.Bindings.Clear()
    [void]$site.Bindings.Add("*:${Port}:", 'http')
    $site.Applications['/'].VirtualDirectories['/'].PhysicalPath = $SitePath
  }
  $site.Applications['/'].ApplicationPoolName = $pool
  $site.ServerAutoStart = $true
  $apphost = $manager.GetApplicationHostConfiguration()
  # Статику читает учётная запись пула (а не IUSR) — права на папку нужны только ей.
  $anonymous = $apphost.GetSection('system.webServer/security/authentication/anonymousAuthentication', $SiteName)
  $anonymous['enabled'] = $true
  $anonymous['userName'] = ''
  # Windows-аутентификация — только для адреса входа через Windows; остальные адреса анонимные.
  $loginPath = "$SiteName/api/windows-login"
  $loginAnonymous = $apphost.GetSection('system.webServer/security/authentication/anonymousAuthentication', $loginPath)
  $loginAnonymous['enabled'] = -not $useWindowsAuth
  if ($windowsAuthReady) {
    $loginWindows = $apphost.GetSection('system.webServer/security/authentication/windowsAuthentication', $loginPath)
    $loginWindows['enabled'] = $useWindowsAuth
  }
  $manager.CommitChanges()
  Ok 'Настроено'

  # ——— Права ———
  Step 'Права доступа'
  & icacls $SitePath /grant "${poolAccount}:(OI)(CI)RX" /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls: не удалось выдать права $poolAccount на $SitePath" }
  & icacls $logs /grant "${poolAccount}:(OI)(CI)M" /Q | Out-Null
  # web.config хранит ключ сеансов: читать его могут только администраторы, система и пул сайта.
  & icacls $webConfig /inheritance:r /grant:r '*S-1-5-32-544:F' '*S-1-5-18:F' "${poolAccount}:R" /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'icacls: не удалось ограничить доступ к web.config' }
  Ok "${poolAccount}: чтение сайта, запись журналов; web.config закрыт от остальных"

  Step "Доступ пула к базе [$Database]"
  Invoke-Sql 'master' "if not exists (select 1 from sys.server_principals where name = N'$poolAccount') create login [$poolAccount] from windows with default_database = [$Database];"
  Invoke-Sql $Database @"
if database_principal_id(N'$poolAccount') is null create user [$poolAccount] for login [$poolAccount];
alter role db_datareader add member [$poolAccount];
alter role db_datawriter add member [$poolAccount];
alter role db_ddladmin add member [$poolAccount];
"@
  Ok "$poolAccount — чтение, запись и изменение структуры таблиц (без прав администратора SQL Server)"

  # ——— Брандмауэр ———
  if ($SkipFirewall) {
    Step 'Брандмауэр — пропущено (-SkipFirewall)'
  } else {
    Step "Брандмауэр: входящие TCP $Port"
    $ruleName = "Plan IIS $SiteName TCP $Port"
    if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
      Ok 'Правило уже есть'
    } else {
      New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Any | Out-Null
      Ok "Правило «$ruleName» создано"
    }
  }

  # ——— Запуск и проверка ———
  Step 'Запуск и проверка'
  $manager = New-Object Microsoft.Web.Administration.ServerManager
  if ($manager.ApplicationPools[$pool].State -ne 'Started') { [void]$manager.ApplicationPools[$pool].Start() }
  try {
    if ($manager.Sites[$SiteName].State -ne 'Started') { [void]$manager.Sites[$SiteName].Start() }
  } catch {
    throw "Сайт не запустился: $($_.Exception.Message). Возможно, порт $Port занят другой программой (netstat -ano | findstr :$Port)."
  }
  $base = "http://localhost:$Port"
  $page = Get-Http "$base/"
  if ($page.Status -ne 200) { throw "Главная страница: HTTP $($page.Status). $($page.Body)" }
  Ok 'Главная страница открывается'
  $route = Get-Http "$base/calendar"
  if ($route.Status -ne 200 -or $route.Body -notmatch '<div id="root">') { throw "Маршрут /calendar: HTTP $($route.Status) — модуль PlanHost не подключился (включён ли ASP.NET 4.x?)." }
  Ok 'Маршруты приложения отдаются модулем IIS'
  $api = $null
  for ($i = 0; $i -lt 3; $i++) {
    $api = Get-Http "$base/api/authentication"
    if ($api.Status -eq 200) { break }
    Start-Sleep -Seconds 3
  }
  if ($api.Status -ne 200) {
    Show-LogTail
    throw "Сервер API: HTTP $($api.Status). $($api.Body)"
  }
  $health = Get-Http "$base/api/health"
  Ok "Сервер API работает с базой: $($health.Body)"

  Write-Host ''
  Write-Host '==================================================================' -ForegroundColor Green
  Write-Host "  Готово: http://${PublicHost}:$Port/" -ForegroundColor Green
  Write-Host '==================================================================' -ForegroundColor Green
  Info "База: $SqlServer / $Database; журнал сервера API: $logs"
  if ($created -eq 1) { Info 'Пустая база заполнена демонстрационными данными. Вход администратора: user@example.com, пароль 123456.' }
  if ($useWindowsAuth) { Info 'Вход через Windows включается администратором приложения: «Администрирование» → «Способ входа».' }
  exit 0
} catch {
  Write-Host ''
  Write-Host "ОШИБКА: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
