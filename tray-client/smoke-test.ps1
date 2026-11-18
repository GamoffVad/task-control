param([Parameter(Mandatory=$true)][string]$Executable, [Parameter(Mandatory=$true)][string]$BaseUrl)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web.Extensions
$assembly = [Reflection.Assembly]::LoadFile($Executable)
$type = $assembly.GetType('TaskControlTray.TrayContext', $true)
$flags = [Reflection.BindingFlags]'Instance,NonPublic'
$instance = [Runtime.Serialization.FormatterServices]::GetUninitializedObject($type)
$type.GetField('baseUrl', $flags).SetValue($instance, $BaseUrl)
$type.GetField('cursorFile', $flags).SetValue($instance, [IO.Path]::Combine([IO.Path]::GetTempPath(), [Guid]::NewGuid().ToString()))
$type.GetField('json', $flags).SetValue($instance, (New-Object System.Web.Script.Serialization.JavaScriptSerializer))
$fetch = $type.GetMethod('Fetch', $flags)
$first = $fetch.Invoke($instance, @())
if ($first.Count -ne 1 -or $first[0].Item1 -ne 'Test notice' -or $first[0].Item3 -ne '/') { throw 'Unexpected first notification.' }
$second = $fetch.Invoke($instance, @())
if ($second.Count -ne 0) { throw 'Unexpected second notification.' }
Write-Output 'Windows login, notification parsing, unsafe path handling and cursor polling passed.'
