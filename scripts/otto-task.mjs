#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = join(root, 'dist-desktop/desktop/agent-server.js');
const exec = promisify(execFile);
export const MAX_FILE_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const commands = new Set(['list-apps', 'inspect', 'run-steps']);
const operations = new Set(['press', 'fill', 'scrollUp', 'scrollDown', 'key']);
const protectedLabel = /\b(password|passcode|one.time code|verification code|security code|cvv|credit card|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|private key|recovery phrase|secret)\b/i;
const credential = /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passcode|secret)\s*[:=]\s*\S+/i;
class TaskError extends Error { constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; } }
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const literal = (value, max) => typeof value === 'string' && value.length <= max && !value.includes('\0');
const scopeValue = value => literal(value, 256) && !!value.trim() && !/[\x00-\x1f\x7f]/u.test(value) && !value.startsWith('--');
const exactKeys = (value, allowed) => plain(value) && Object.keys(value).every(key => allowed.includes(key));
const invalidWorkflow = () => { throw new TaskError('Invalid workflow. Supply only bounded native steps and optional expected checks; do not include app scope or credentials.'); };

export function parseTaskArgs(args) {
  if (!args.length || (args.length === 1 && ['--help', '-h'].includes(args[0]))) return { help: true };
  const command = args[0];
  if (!commands.has(command)) throw new TaskError('Unknown command. Use --help.');
  const options = { command };
  const seen = new Set();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (!['--app', '--app-name', '--file'].includes(flag) || seen.has(flag)) throw new TaskError('Unknown or repeated argument. Use --help.');
    seen.add(flag);
    const value = args[++i];
    if (typeof value !== 'string' || !value || value.startsWith('--') || /[\x00-\x1f\x7f]/u.test(value)) throw new TaskError('An argument value is missing or invalid.');
    if (flag === '--file') options.file = resolve(value);
    else {
      if (!scopeValue(value)) throw new TaskError('Choose one exact native app ID or running application name.');
      options[flag === '--app' ? 'appId' : 'appName'] = value;
    }
  }
  if (command === 'list-apps') {
    if (seen.size) throw new TaskError('Use list-apps without app scope or a workflow file.');
  } else {
    if (Boolean(options.appId) === Boolean(options.appName)) throw new TaskError('Choose exactly one --app ID or --app-name name.');
    if ((command === 'run-steps') !== Boolean(options.file)) throw new TaskError('Only run-steps requires and accepts --file.');
  }
  return options;
}

export function validateTaskFile(value) {
  if (!exactKeys(value, ['steps', 'expected']) || !Array.isArray(value.steps) || !value.steps.length || value.steps.length > 16) invalidWorkflow();
  let chars = 0;
  for (const step of value.steps) {
    if (!exactKeys(step, ['operation', 'label', 'role', 'value']) || !operations.has(step.operation)) invalidWorkflow();
    if (step.operation === 'key') {
      if (!['enter', 'escape', 'tab'].includes(step.value) || step.label !== undefined || step.role !== undefined) invalidWorkflow();
    } else {
      if (!literal(step.label, 256) || !step.label.trim() || protectedLabel.test(step.label) ||
          (step.role !== undefined && (!literal(step.role, 96) || !step.role || protectedLabel.test(step.role)))) invalidWorkflow();
      if (step.operation === 'fill') {
        if (!literal(step.value, 2000)) invalidWorkflow();
        chars += step.value.length;
      } else if (step.value !== undefined) invalidWorkflow();
    }
  }
  if (chars > 16_000) invalidWorkflow();
  if (value.expected !== undefined) {
    if (!exactKeys(value.expected, ['values', 'textIncludes'])) invalidWorkflow();
    let checks = 0;
    if (value.expected.values !== undefined) {
      if (!plain(value.expected.values)) invalidWorkflow();
      for (const [label, expected] of Object.entries(value.expected.values)) {
        if (!literal(label, 256) || !label.trim() || protectedLabel.test(label) || !literal(expected, 2000)) invalidWorkflow();
        checks++;
      }
    }
    if (value.expected.textIncludes !== undefined) {
      if (!Array.isArray(value.expected.textIncludes) || value.expected.textIncludes.some(text => !literal(text, 1000) || !text.trim())) invalidWorkflow();
      checks += value.expected.textIncludes.length;
    }
    if (checks < 1 || checks > 16) invalidWorkflow();
  }
  // Includes keys as well as values. This is a conservative recognizable-secret
  // check, not a promise to recognize every possible credential format.
  if (credential.test(JSON.stringify(value))) invalidWorkflow();
  return value;
}

export async function readTaskFile(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new TaskError('Workflow file must be a regular file no larger than 64 KiB.');
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > MAX_FILE_BYTES) throw new TaskError('Workflow file exceeds 64 KiB.');
    return validateTaskFile(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total))));
  } catch (error) {
    if (error instanceof TaskError) throw error;
    throw new TaskError('Could not read a valid UTF-8 workflow JSON file. File contents and paths were not logged.');
  } finally { await file?.close(); }
}

export function serverEnvironment() {
  const result = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP']) if (process.env[name] !== undefined) result[name] = process.env[name];
  return result;
}

async function verifyBuild() {
  if (!['darwin', 'win32'].includes(process.platform)) throw new TaskError('Otto native tasks require macOS or Windows.');
  try { if (!(await stat(serverPath)).isFile()) throw new Error(); }
  catch { throw new TaskError('Built Otto agent server is unavailable. Build this checkout with npm run build first.'); }
}

export function serverArguments(options) {
  return [serverPath, options.appId ? '--app' : '--app-name', options.appId ?? options.appName,
    ...(options.command === 'run-steps' ? ['--allow-actions'] : [])];
}

async function connection(options, signal) {
  await verifyBuild();
  const client = new Client({ name: 'otto-current-task', version: '0.1.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: serverArguments(options),
    cwd: root, env: serverEnvironment(), stderr: 'pipe', maxBufferSize: 1024 * 1024 });
  transport.stderr?.on('data', () => undefined); // Native/server stderr may contain selected-app context.
  try { await client.connect(transport, { signal, timeout: 30_000 }); }
  catch (error) { await client.close().catch(() => undefined); await transport.close().catch(() => undefined); throw error; }
  return { client, close: () => client.close() };
}

function toolText(result) {
  if (!plain(result) || !Array.isArray(result.content) || !result.content.length || result.content.some(item => !plain(item) || item.type !== 'text' || typeof item.text !== 'string'))
    throw new TaskError('Otto returned an unsupported response. Inspect before retrying.', 2);
  const output = result.content.map(item => item.text).join('\n');
  if (Buffer.byteLength(output) > MAX_RESPONSE_BYTES) throw new TaskError('Otto response exceeded the output limit. Inspect before retrying.', 2);
  return output;
}
function appList(value) {
  if (!plain(value) || !Array.isArray(value.apps) || value.apps.length > 1024 || value.apps.some(app => !plain(app) || !scopeValue(app.id) || !scopeValue(app.name)))
    throw new TaskError('Otto returned an invalid app list.', 2);
  return value.apps.map(({ id, name }) => ({ id, name }));
}
async function discover(signal) {
  await verifyBuild();
  try {
    const { stdout } = await exec(process.execPath, [serverPath, '--list-apps'], { cwd: root, env: serverEnvironment(),
      encoding: 'utf8', timeout: 30_000, maxBuffer: MAX_RESPONSE_BYTES, signal, windowsHide: true });
    return { apps: appList(JSON.parse(stdout)) };
  } catch { throw new TaskError('App discovery failed or timed out. No permission change or retry was attempted.', 2); }
}

/** Test injection is programmatic only; CLI flags and environment cannot select another server. */
export async function runTask(options, dependencies = {}) {
  const signal = dependencies.signal ? AbortSignal.any([dependencies.signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000);
  if (options.command === 'list-apps') {
    const result = await (dependencies.discover ?? discover)(signal);
    return { output: JSON.stringify({ apps: appList(result) }), exitCode: 0 };
  }
  const workflow = options.command === 'run-steps' ? await readTaskFile(options.file) : undefined;
  if (signal.aborted) throw new TaskError('Otto request cancelled. Inspect before retrying; prior effects may remain.', 2);
  let connected;
  try {
    connected = await (dependencies.connect ?? connection)(options, signal);
    const manifest = await connected.client.listTools({}, { signal, timeout: 30_000 });
    if (!Array.isArray(manifest.tools) || !manifest.tools.some(tool => tool.name === 'release_control'))
      throw new TaskError('This Otto build lacks desktop ownership coordination. Rebuild this checkout before using the one-shot client.', 2);
    const call = (name, args) => connected.client.callTool({ name, arguments: args }, undefined, { signal, timeout: 150_000 });
    let appId = options.appId;
    if (options.appName) {
      const listed = await call('list_apps', {});
      const output = toolText(listed);
      if (listed.isError) return { output, exitCode: 2 };
      const apps = appList(JSON.parse(output));
      if (apps.length !== 1 || apps[0].name !== options.appName) throw new TaskError('The exact scoped app name is missing or ambiguous. Choose its current native ID; no action was attempted.', 2);
      appId = apps[0].id;
    }
    const result = await call(options.command === 'inspect' ? 'inspect' : 'run_steps', { appId, ...(workflow ?? {}) });
    const output = toolText(result);
    if (result.isError) return { output, exitCode: 2 };
    if (options.command === 'run-steps') {
      const receipt = JSON.parse(output);
      if (!plain(receipt) || !['verified', 'completed', 'stopped'].includes(receipt.status)) throw new TaskError('Otto returned an invalid workflow receipt. Inspect before retrying.', 2);
      return { output, exitCode: receipt.status === 'stopped' || receipt.uncertainAction === true ? 2 : 0 };
    }
    return { output, exitCode: 0 };
  } catch (error) {
    if (error instanceof TaskError) throw error;
    throw new TaskError('Otto request failed, was cancelled, or timed out. Inspect before retrying; a dispatched action may have taken effect.', 2);
  } finally { await connected?.close(); }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseTaskArgs(args);
  if (options.help) {
    process.stdout.write('Use Otto in an already-running agent task (one-shot local MCP client).\n  node scripts/otto-task.mjs list-apps\n  node scripts/otto-task.mjs inspect --app <native-id>\n  node scripts/otto-task.mjs inspect --app-name <exact-name>\n  node scripts/otto-task.mjs run-steps --app <native-id> --file <workflow.json>\n  node scripts/otto-task.mjs run-steps --app-name <exact-name> --file <workflow.json>\nWorkflow file: {"steps":[...],"expected":{...}}; no appId, credentials, or provider key.\nrun-steps opts into native writes for that one app. Use only within the user-authorized task.\nNo config changes, retries, fallback executor, or Jev calls.\n'); return;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const result = await runTask(options, { signal: controller.signal });
    process.stdout.write(result.output + '\n');
    if (result.exitCode) process.stderr.write('Otto stopped or returned an error. Inspect before retrying; partial effects may remain. No retry was attempted.\n');
    else if (options.command === 'inspect') process.stderr.write('Read-only context: these refs expire when this command exits. Use a fresh run-steps request with exact labels.\n');
    process.exitCode = result.exitCode;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write((error instanceof TaskError ? error.message : 'Otto command failed. Inspect before retrying; no automatic retry was attempted.') + '\n');
    process.exitCode = error instanceof TaskError ? error.exitCode : 2;
  });
}
