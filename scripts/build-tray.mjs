import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = path.join(root, 'public', 'downloads', 'TaskControlNotificationsSetup-1.0.4.msi');
if (process.platform === 'win32') {
  const staging = path.join(root, 'output', 'tray-build');
  mkdirSync(staging, { recursive: true });
  mkdirSync(path.dirname(installer), { recursive: true });
  const exe = path.join(staging, 'TaskControlNotifications.exe');
  const artScript = path.join(staging, 'installer-art.ps1');
  writeFileSync(artScript, '\ufeff' + readFileSync(path.join(root, 'tray-client', 'installer-art.ps1'), 'utf8'));
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', artScript, '-OutputDir', staging, '-IconPath', path.join(root, 'tray-client', 'app.ico')], { stdio: 'inherit' });
  const license = readFileSync(path.join(root, 'LICENSE'), 'utf8').replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}').replace(/\r?\n/g, '\\par\n');
  writeFileSync(path.join(staging, 'license.rtf'), `{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Segoe UI;}}\\f0\\fs18 ${license}}`);
  execFileSync('dotnet', ['build', path.join(root, 'tray-client', 'TaskControlNotifications.csproj'), '-c', 'Release', '-o', staging, '--nologo'], { stdio: 'inherit' });
  execFileSync('wix', ['build', '-arch', 'x86', '-ext', 'WixToolset.UI.wixext', '-culture', 'ru-RU', '-pdb', path.join(staging, 'installer.wixpdb'), '-d', `TrayExe=${exe}`, '-d', `TrayConfig=${exe}.config`, '-d', `ArtDir=${staging}`, '-o', installer, path.join(root, 'tray-client', 'installer.wxs')], { stdio: 'inherit' });
  rmSync(path.join(root, 'public', 'downloads', 'TaskControlNotifications.exe'), { force: true });
} else if (!existsSync(installer)) throw new Error('Нет готового установщика уведомлений. Соберите его на Windows с WiX 5 и расширением WixToolset.UI.');
console.log('Установщик уведомлений готов.');
