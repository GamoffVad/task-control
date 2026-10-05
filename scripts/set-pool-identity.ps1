# Запускает пул приложений IIS под учётной записью Windows того, кто публикует приложение.
# Под ней же приложение входит в SQL Server (вход Windows, без учётной записи SQL Server и пароля в web.config).
# Пароль спрашивается один раз и проверяется до записи; IIS хранит его в зашифрованном виде.
# Повторная публикация пароль не спрашивает, если пул уже работает под этой учётной записью;
# после смены пароля Windows запустите deploy-iis.bat с ключом /password.
#   powershell -ExecutionPolicy Bypass -File scripts\set-pool-identity.ps1 -Pool PLAN [-Ask]
# Публикация с другого компьютера передаёт пароль в переменной окружения TC_IIS_POOL_PASSWORD.
param(
  [Parameter(Mandatory = $true)][string]$Pool,
  # Спросить пароль, даже если пул уже работает под этой учётной записью (пароль Windows сменился).
  [switch]$Ask
)

$ErrorActionPreference = 'Stop'

function Fail([string]$text, [int]$code) {
  Write-Output "ОШИБКА: $text"
  exit $code
}

$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$admin = Join-Path $env:windir 'system32\inetsrv\Microsoft.Web.Administration.dll'
if (-not (Test-Path $admin)) { Fail "не найден $admin. Установите роль «Веб-сервер IIS»." 2 }
Add-Type -Path $admin
$manager = New-Object Microsoft.Web.Administration.ServerManager
$appPool = $manager.ApplicationPools[$Pool]
if (-not $appPool) { Fail "пул приложений $Pool не найден." 2 }
$model = $appPool.ProcessModel

if (-not $Ask -and $model.IdentityType -eq [Microsoft.Web.Administration.ProcessModelIdentityType]::SpecificUser -and $model.UserName -ieq $me) {
  Write-Output "  Пул $Pool уже работает под учётной записью $me"
  exit 0
}

# Проверка пароля: локальная учётная запись — на этом компьютере, доменная — в домене.
Add-Type -AssemblyName System.DirectoryServices.AccountManagement
$domain, $user = $me.Split('\', 2)
function Test-Password([string]$plain) {
  try {
    $kind = if ($domain -ieq $env:COMPUTERNAME) { 'Machine' } else { 'Domain' }
    $context = New-Object System.DirectoryServices.AccountManagement.PrincipalContext($kind, $domain)
    try { return $context.ValidateCredentials($user, $plain) } finally { $context.Dispose() }
  } catch {
    # Домен недоступен — проверить пароль нельзя; IIS сообщит об ошибке при запуске пула.
    Write-Output "  Пароль проверить не удалось ($($_.Exception.Message)), он будет записан как есть."
    return $true
  }
}

$fromEnv = $env:TC_IIS_POOL_PASSWORD
$plain = $null
for ($attempt = 1; $attempt -le 3; $attempt++) {
  if ($fromEnv) {
    $plain = $fromEnv
  } else {
    try {
      $secure = Read-Host "  Пароль Windows учётной записи $me (пул $Pool будет работать под ней)" -AsSecureString
    } catch {
      Fail "нельзя спросить пароль: окно ввода недоступно. При публикации с другого компьютера используйте ключ -AskCredential." 3
    }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }
  if ($plain -and (Test-Password $plain)) { break }
  Write-Output '  Неверный пароль.'
  $plain = $null
  if ($fromEnv) { break }
}
if (-not $plain) { Fail "пароль учётной записи $me не подошёл. Пул $Pool не изменён." 4 }

$model.IdentityType = [Microsoft.Web.Administration.ProcessModelIdentityType]::SpecificUser
$model.UserName = $me
$model.Password = $plain
$manager.CommitChanges()
Write-Output "  Пул $Pool работает под учётной записью $me"
exit 0
