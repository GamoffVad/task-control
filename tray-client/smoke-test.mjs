import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let auth = 0, polls = 0;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/windows-login' && req.method === 'POST') { auth++; res.end(JSON.stringify({ token: 'test-token', user: { employeeId: 12 } })); return; }
  if (req.url.startsWith('/api/notices') && req.headers['x-tc-token'] === 'test-token') {
    polls++;
    if (polls === 2 && !req.url.includes('since=')) { res.statusCode = 400; res.end('{}'); return; }
    res.end(JSON.stringify({ now: '2026-11-14T10:00:00.000Z', notices: polls === 1 ? [{ title: 'Test notice', body: 'Example', url: '//untrusted.example' }] : [] })); return;
  }
  res.statusCode = 404; res.end('{}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const executable = path.join(root, 'output', 'tray-build', 'TaskControlNotifications.exe');
  const process = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'tray-client', 'smoke-test.ps1'), '-Executable', executable, '-BaseUrl', `http://127.0.0.1:${server.address().port}/`], { stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { process.on('error', reject); process.on('exit', resolve); });
  if (code !== 0 || auth !== 1 || polls !== 2) throw new Error(`Smoke test failed: exit=${code}, login=${auth}, polls=${polls}`);
} finally { server.close(); }
