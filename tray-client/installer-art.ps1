param([Parameter(Mandatory=$true)][string]$OutputDir, [Parameter(Mandatory=$true)][string]$IconPath)
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$navy = [System.Drawing.ColorTranslator]::FromHtml('#1C2738')
$muted = [System.Drawing.ColorTranslator]::FromHtml('#A3B5CF')
$blue = [System.Drawing.ColorTranslator]::FromHtml('#93B9F0')
$line = [System.Drawing.ColorTranslator]::FromHtml('#425A76')
$light = [System.Drawing.ColorTranslator]::FromHtml('#F5F8FC')
function Draw-Logo([System.Drawing.Graphics]$graphics, [int]$left, [int]$top) {
  $saved = $graphics.Save()
  $graphics.TranslateTransform($left + 15, $top + 1)
  $graphics.RotateTransform(45)
  $bright = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#93B9F0'))
  $dim = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#6094D3'))
  foreach ($cell in @(@(2,3,1),@(1,3,1),@(0,3,0),@(2,2,1),@(1,2,0),@(2,1,1),@(1,1,0),@(2,0,0),@(1,0,1))) {
    $brush = if ($cell[2]) { $bright } else { $dim }
    $graphics.FillRectangle($brush, [single]($cell[0]*6.2), [single]($cell[1]*6.2), [single]5.8, [single]5.8)
  }
  $graphics.Restore($saved); $bright.Dispose(); $dim.Dispose()
}

$dialog = New-Object System.Drawing.Bitmap(493,312)
$g = [System.Drawing.Graphics]::FromImage($dialog)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::White)
$g.FillRectangle((New-Object System.Drawing.SolidBrush($navy)),0,0,164,312)
Draw-Logo $g 19 23
$font = New-Object System.Drawing.Font('Segoe UI',9,[System.Drawing.FontStyle]::Bold)
$small = New-Object System.Drawing.Font('Segoe UI',7.5,[System.Drawing.FontStyle]::Regular)
$g.DrawString('Контроль задач',$font,(New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)),52,27)
$g.DrawLine((New-Object System.Drawing.Pen($line,1)),20,66,144,66)

# Calendar and notification: an illustration built from the application's visual language.
$pen = New-Object System.Drawing.Pen($line,2)
$accentPen = New-Object System.Drawing.Pen($blue,2)
$g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#202F43'))),25,102,112,105)
$g.DrawRectangle($pen,25,102,112,105)
$g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#2A405B'))),26,103,110,25)
$g.DrawLine($accentPen,46,96,46,111); $g.DrawLine($accentPen,116,96,116,111)
foreach($x in @(45,65,85,105)) { foreach($y in @(145,163,181)) { $g.FillEllipse((New-Object System.Drawing.SolidBrush($line)),$x,$y,5,5) } }
$g.FillRectangle((New-Object System.Drawing.SolidBrush($blue)),77,156,21,19)
$g.DrawString('5',(New-Object System.Drawing.Font('Segoe UI',9,[System.Drawing.FontStyle]::Bold)),(New-Object System.Drawing.SolidBrush($navy)),83,157)
$g.FillEllipse((New-Object System.Drawing.SolidBrush($navy)),99,184,45,45)
$g.DrawEllipse($accentPen,99,184,45,45)
$g.DrawArc($accentPen,112,195,17,19,180,180)
$g.DrawLine($accentPen,112,204,110,211); $g.DrawLine($accentPen,129,204,131,211)
$g.DrawLine($accentPen,110,211,131,211); $g.DrawArc($accentPen,117,210,7,6,0,180)
$g.DrawString('УВЕДОМЛЕНИЯ',$small,(New-Object System.Drawing.SolidBrush($blue)),20,250)
$g.DrawString('События и задачи',$small,(New-Object System.Drawing.SolidBrush($muted)),20,268)
$g.Dispose(); $dialog.Save((Join-Path $OutputDir 'installer-dialog.bmp'),[System.Drawing.Imaging.ImageFormat]::Bmp); $dialog.Dispose()

$banner = New-Object System.Drawing.Bitmap(493,58)
$g = [System.Drawing.Graphics]::FromImage($banner)
$g.Clear($light)
$g.FillRectangle((New-Object System.Drawing.SolidBrush($navy)),368,0,125,58)
$g.FillRectangle((New-Object System.Drawing.SolidBrush($blue)),368,0,2,58)
Draw-Logo $g 386 13
$g.DrawString('КОНТРОЛЬ',$small,(New-Object System.Drawing.SolidBrush($blue)),423,15)
$g.DrawString('ЗАДАЧ',$small,(New-Object System.Drawing.SolidBrush($muted)),423,30)
$g.Dispose(); $banner.Save((Join-Path $OutputDir 'installer-banner.bmp'),[System.Drawing.Imaging.ImageFormat]::Bmp); $banner.Dispose()
$font.Dispose(); $small.Dispose(); $pen.Dispose(); $accentPen.Dispose()
