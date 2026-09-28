# Подготовка SQL Server для приложения «Контроль задач».
# Создаёт базу и учётную запись приложения и прописывает их в web.config.
# Запускается из deploy-iis.bat от имени администратора; можно запустить и отдельно:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-sql.ps1 -Server SQLSRV -ConfigPath C:\inetpub\wwwroot\PLAN\web.config
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$Database = 'TaskControl',
  [string]$Login = 'tc_app',
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  # Задать учётной записи новый пароль, если она уже существует, а пароль неизвестен.
  [switch]$Reset
)

$ErrorActionPreference = 'Stop'

function Fail([string]$text, [int]$code) {
  Write-Output "ОШИБКА: $text"
  exit $code
}

if (-not (Test-Path $ConfigPath)) { Fail "не найден файл $ConfigPath." 2 }

# sqlcmd ставится вместе с SQL Server и с Command Line Utilities.
$sqlcmd = (Get-Command sqlcmd -ErrorAction SilentlyContinue).Source
if (-not $sqlcmd) {
  $found = Get-ChildItem 'C:\Program Files\Microsoft SQL Server' -Filter 'SQLCMD.EXE' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $sqlcmd = $found.FullName }
}
if (-not $sqlcmd) { Fail 'не найден sqlcmd. Установите Microsoft Command Line Utilities for SQL Server и повторите.' 3 }

# Запрос от имени текущего пользователя Windows: -C доверяет сертификату сервера, -b возвращает код ошибки.
function Invoke-Sql([string]$query, [string]$database = 'master') {
  $out = & $sqlcmd -S $Server -E -C -b -d $database -h -1 -W -Q $query 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($out -join ' ') }
  return ($out | Where-Object { $_ -and $_ -notmatch '^\(\d+ rows affected\)$' -and $_ -notmatch 'строк обработано' }) -join "`n"
}

try {
  $who = Invoke-Sql 'set nocount on; select suser_name();'
} catch {
  Fail "не удалось подключиться к $Server от имени Windows: $($_.Exception.Message)" 4
}
Write-Output "  Подключение к $Server от имени $who"

$rights = Invoke-Sql "set nocount on; select cast(is_srvrolemember('sysadmin') as varchar(2)) + '/' + cast(is_srvrolemember('securityadmin') as varchar(2)) + '/' + cast(is_srvrolemember('dbcreator') as varchar(2));"
$parts = $rights.Trim().Split('/')
$sysadmin = $parts[0] -eq '1'
$securityadmin = $parts[1] -eq '1'
$dbcreator = $parts[2] -eq '1'
if (-not ($sysadmin -or $securityadmin)) { Fail "у учётной записи $who нет прав создавать учётные записи SQL Server. Выполните настройку под администратором SQL Server или создайте учётную запись вручную." 5 }
if (-not ($sysadmin -or $dbcreator)) { Fail "у учётной записи $who нет прав создавать базы данных." 5 }

# Настройки из web.config: заполняем только пустые значения, чужие не трогаем.
[xml]$xml = Get-Content -Raw -Encoding UTF8 $ConfigPath
function Get-Setting([string]$key) { ($xml.configuration.appSettings.add | Where-Object { $_.key -eq $key }) }
function Set-Setting([string]$key, [string]$value) {
  $node = Get-Setting $key
  if (-not $node) {
    $node = $xml.CreateElement('add')
    $node.SetAttribute('key', $key)
    [void]$xml.configuration.appSettings.AppendChild($node)
  }
  $node.SetAttribute('value', $value)
}

$passwordNode = Get-Setting 'MSSQL_PASSWORD'
$existingPassword = if ($passwordNode) { $passwordNode.value } else { $null }
$loginExists = (Invoke-Sql "set nocount on; select case when suser_id(N'$Login') is null then '0' else '1' end;").Trim() -eq '1'

$password = $null
if ($loginExists -and -not $Reset) {
  if ([string]::IsNullOrWhiteSpace($existingPassword)) {
    Fail "учётная запись $Login уже существует, а её пароль в web.config не задан. Впишите пароль вручную или перезапустите с ключом -Reset, чтобы задать новый." 6
  }
  Write-Output "  Учётная запись $Login уже есть, пароль из web.config сохранён"
} else {
  # Пароль из случайных байт: буквы и цифры, чтобы он прошёл политику сложности и не мешал разбору файлов.
  # RNGCryptoServiceProvider есть и в Windows PowerShell 5.1, и в PowerShell 7.
  $bytes = New-Object byte[] 18
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $rng.GetBytes($bytes)
  $rng.Dispose()
  $password = 'Tc' + ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', '') + '7q'
  $escaped = $password.Replace("'", "''")
  if ($loginExists) {
    Invoke-Sql "alter login [$Login] with password = N'$escaped';"
    Write-Output "  Учётной записи $Login задан новый пароль"
  } else {
    Invoke-Sql "create login [$Login] with password = N'$escaped', check_expiration = off;"
    Write-Output "  Создана учётная запись $Login"
  }
}

# База создаётся здесь и её владельцем становится учётная запись приложения:
# тогда серверные роли приложению не нужны, а таблицы оно создаёт само при первом запуске.
$created = (Invoke-Sql "set nocount on; if db_id(N'$Database') is null begin create database [$Database]; select 'created'; end else select 'exists';").Trim()
if ($created -eq 'created') { Write-Output "  Создана база $Database" } else { Write-Output "  База $Database уже есть" }
Invoke-Sql "if not exists (select 1 from sys.database_principals where name = N'$Login') create user [$Login] for login [$Login]; alter role [db_owner] add member [$Login];" $Database
Write-Output "  Учётная запись $Login — владелец базы $Database"

Set-Setting 'MSSQL_SERVER' $Server
Set-Setting 'MSSQL_DATABASE' $Database
Set-Setting 'MSSQL_USER' $Login
if ($password) { Set-Setting 'MSSQL_PASSWORD' $password }

# Ключ подписи сеансов: если не задан, создаём случайный, иначе оставляем прежний.
$secretNode = Get-Setting 'AUTH_SECRET'
if ([string]::IsNullOrWhiteSpace($(if ($secretNode) { $secretNode.value } else { '' }))) {
  $secretBytes = New-Object byte[] 32
  $rng2 = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $rng2.GetBytes($secretBytes)
  $rng2.Dispose()
  Set-Setting 'AUTH_SECRET' ([System.BitConverter]::ToString($secretBytes) -replace '-', '').ToLower()
  Write-Output '  Создан ключ подписи сеансов AUTH_SECRET'
}

$xml.Save($ConfigPath)
Write-Output "  Настройки записаны в $ConfigPath"

# Проверка: подключаемся уже учётной записью приложения.
$check = & $sqlcmd -S $Server -U $Login -P ((Get-Setting 'MSSQL_PASSWORD').value) -C -b -d $Database -h -1 -W -Q 'set nocount on; select db_name();' 2>&1
if ($LASTEXITCODE -ne 0) { Fail "учётная запись $Login не смогла подключиться к базе: $($check -join ' ')" 7 }
Write-Output "  Проверка входа: $Login открывает базу $(($check | Select-Object -First 1).Trim())"
exit 0
