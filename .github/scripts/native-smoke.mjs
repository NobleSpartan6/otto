import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const command = process.platform === 'win32'
  ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  : join(root, 'desktop/native/macos/otto-ax');
if (!['win32', 'darwin'].includes(process.platform)) throw new Error('Native smoke requires Windows or macOS.');
if (process.platform === 'win32') {
  const syntax = spawnSync(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    'foreach ($file in @("otto-uia.ps1", "otto-voice.ps1")) { $tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD "desktop/native/windows/$file"), [ref]$tokens, [ref]$errors); if ($errors.Count) { $errors | Format-List; exit 1 } }'],
  { encoding: 'utf8', timeout: 15_000 });
  if (syntax.error || syntax.status !== 0) throw new Error(`Windows PowerShell syntax check failed: ${syntax.error?.message ?? syntax.stderr ?? syntax.stdout}`);
}
const args = process.platform === 'win32'
  ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'desktop/native/windows/otto-uia.ps1')]
  : [];
const requests = [{ id: 'permissions-smoke', op: 'permissions' }, { id: 'apps-smoke', op: 'apps' }];
const result = spawnSync(command, args, {
  input: requests.map(request => JSON.stringify(request)).join('\n') + '\n',
  encoding: 'utf8', timeout: 20_000, maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, OTTO_PARENT_PID: String(process.pid), TYPESAFE_API_KEY: '', OPENAI_API_KEY: '' },
});
if (result.error || result.status !== 0) throw new Error(`Native helper failed: ${result.error?.message ?? result.stderr}`);
const responses = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
if (responses.length !== requests.length) throw new Error('Native helper did not produce exactly one JSON response per request.');
for (const [index, response] of responses.entries()) {
  if (response.id !== requests[index].id || response.ok !== true) throw new Error(`Native protocol failure: ${response.error ?? requests[index].op}`);
}
const permissions = responses[0].result;
if (permissions.platform !== process.platform || typeof permissions.accessibility !== 'boolean' || typeof permissions.screenCapture !== 'boolean') throw new Error('Invalid permissions response.');
if (!Array.isArray(responses[1].result.apps)) throw new Error('Invalid application-list response.');
console.log('Read-only native protocol smoke passed. This does not exercise desktop input or screen capture.');
