import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { appendFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { DesktopApp, NativeAction, NativeControl, NativeSnapshot, Permissions } from '../../../shared/types.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const reportPath = resolve(process.env.OTTO_WINDOWS_SMOKE_REPORT ?? join(root, 'test-results/windows-native-smoke.json'));
const environment = { ...process.env, TYPESAFE_API_KEY: '', OPENAI_API_KEY: '', OTTO_PARENT_PID: String(process.pid) };
type FixtureState = { status: string; reason?: string; pid: number; ready?: boolean; text?: string; pressCount?: number; applied?: string; label?: string };
const report: { status: 'passed' | 'blocked' | 'failed'; reason?: string; checks: string[]; screenshot?: object; cleanup?: string } = { status: 'failed', checks: [] };
class Blocked extends Error {}

class Helper {
  child: ChildProcessWithoutNullStreams;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }>();
  constructor(command: string) {
    this.child = spawn(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'desktop/native/windows/otto-uia.ps1')], { env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.resume();
    createInterface({ input: this.child.stdout }).on('line', line => {
      try {
        const response = JSON.parse(line);
        const pending = this.pending.get(response.id);
        if (!pending) return;
        this.pending.delete(response.id); clearTimeout(pending.timer);
        if (response.ok === true) pending.resolve(response.result);
        else pending.reject(new Error(response.error ?? 'Native helper rejected the request.'));
      } catch { this.stop(new Error('The helper emitted invalid JSON.')); }
    });
    this.child.once('error', error => this.stop(error));
    this.child.once('exit', () => this.stop(new Error('Native helper exited.')));
  }
  call<T>(op: string, args: object = {}): Promise<T> {
    const id = randomUUID();
    return new Promise((resolveCall, reject) => {
      const timer = setTimeout(() => this.stop(new Error(`Native ${op} timed out; no retry was attempted.`)), 15_000);
      this.pending.set(id, { resolve: value => resolveCall(value as T), reject, timer });
      this.child.stdin.write(JSON.stringify({ id, op, ...args }) + '\n', error => { if (error) this.stop(error); });
    });
  }
  stop(error = new Error('Test helper stopped.')) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    if (this.child.exitCode === null && !this.child.killed) this.child.kill();
  }
}

let directory: string | undefined;
let fixture: ReturnType<typeof spawn> | undefined;
let fixtureExit: Promise<number | null> | undefined;
let helper: Helper | undefined;
let statePath = '';
let stopPath = '';
let fixtureId = '';
let fixturePID = 0;
async function state(): Promise<FixtureState | undefined> {
  try { return JSON.parse(await readFile(statePath, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function waitForState(predicate: (value: FixtureState) => boolean, timeout = 5_000): Promise<FixtureState> {
  const deadline = Date.now() + timeout;
  do {
    const value = await state();
    if (value && predicate(value)) return value;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error('The disposable fixture did not reach the expected state. No action was retried.');
}
function target(snapshot: NativeSnapshot, label: string, capability: string): NativeControl {
  assert.equal(snapshot.app.id, fixtureId); assert.equal(snapshot.app.pid, fixturePID);
  assert.equal(snapshot.title, 'Otto Windows Native Smoke Fixture');
  const controls = snapshot.controls.filter(control => control.label === label && control.actions.includes(capability));
  assert.equal(controls.length, 1, `Expected one native ${capability} control: ${label}`);
  return controls[0]!;
}
function action(snapshot: NativeSnapshot, control: NativeControl, kind: 'fill' | 'press', value?: string): NativeAction {
  return { id: randomUUID(), appId: fixtureId, snapshotId: snapshot.snapshotId, targetId: control.id, kind, nativeAction: kind, label: control.label, ...(value === undefined ? {} : { value }) };
}
async function dispatch(value: NativeAction) {
  assert.equal(value.appId, fixtureId);
  assert.ok(fixture && fixture.pid === fixturePID && fixture.exitCode === null && !fixture.killed, 'Only the live child fixture may receive effects.');
  await helper!.call('act', { action: value });
}

try {
  if (process.platform !== 'win32') throw new Blocked('This integration test requires an interactive Windows desktop.');
  directory = await mkdtemp(join(tmpdir(), 'otto-windows-native-'));
  statePath = join(directory, 'state.json'); stopPath = join(directory, 'close-fixture');
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const compiled = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'tests/native/windows/build-fixture.ps1'), '-OutputDirectory', directory], { env: environment, encoding: 'utf8', timeout: 45_000 });
  assert.equal(compiled.status, 0, `Fixture compilation failed: ${compiled.error?.message ?? compiled.stderr}`);
  report.checks.push('Disposable WinForms fixture compiled with Windows PowerShell.');
  fixture = spawn(join(directory, 'OttoSmokeFixture.exe'), [statePath, stopPath, String(process.pid)], { env: environment, windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] });
  fixture.stderr?.resume();
  fixturePID = fixture.pid!;
  assert.ok(Number.isInteger(fixturePID) && fixturePID > 1 && fixturePID !== process.pid);
  fixtureExit = new Promise((resolveExit, rejectExit) => { fixture!.once('exit', resolveExit); fixture!.once('error', rejectExit); });
  // Attach a rejection handler immediately; startup errors are surfaced below.
  void fixtureExit.catch(() => undefined);
  const ready = await waitForState(value => value.status === 'blocked' || value.ready === true, 10_000);
  assert.equal(ready.pid, fixturePID);
  if (ready.status === 'blocked') throw new Blocked(ready.reason ?? 'An interactive desktop is unavailable.');
  report.checks.push('Fixture has a visible interactive Windows desktop and its own window.');
  helper = new Helper(powershell);
  const permissions = await helper.call<Permissions>('permissions');
  if (!permissions.accessibility) throw new Blocked('Windows UI Automation is unavailable in this runner session.');
  let discovered: DesktopApp | undefined;
  for (let attempt = 0; attempt < 20 && !discovered; attempt++) {
    discovered = (await helper.call<{ apps: DesktopApp[] }>('apps')).apps.find(app => app.pid === fixturePID);
    if (!discovered) await delay(100);
  }
  assert.ok(discovered, 'The exact launched fixture PID must be discoverable.');
  fixtureId = discovered.id;
  await helper.call('configure', { appIds: [fixtureId] });
  report.checks.push('Only the launched fixture PID was configured for native actions.');
  let snapshot = await helper.call<NativeSnapshot>('observe', { appId: fixtureId });
  const input = target(snapshot, 'Fixture text input', 'fill');
  target(snapshot, 'Apply fixture text', 'press');
  if (snapshot.screenshot) {
    assert.ok(snapshot.windowBounds && snapshot.screenshotSize);
    assert.ok(snapshot.screenshotSize.width > 0 && snapshot.screenshotSize.height > 0);
    report.screenshot = { available: true, windowBounds: snapshot.windowBounds, screenshotSize: snapshot.screenshotSize };
  } else report.screenshot = { available: false, note: 'PrintWindow capture is optional; no OCR or coordinate-input claim is made.' };
  report.checks.push('UIA ValuePattern field and InvokePattern-capable button observed in the selected child.');

  // The fake app ID addresses no running user application. Even a broken guard
  // would only have a target handle from this disposable fixture.
  await assert.rejects(helper.call('observe', { appId: '0' }));
  await assert.rejects(helper.call('act', { action: { ...action(snapshot, input, 'fill', 'must not apply'), appId: '0' } }));
  assert.equal((await state())?.text, 'Initial fixture text');
  report.checks.push('Unconfigured app observation/action rejected without changing the fixture.');

  const literal = 'Otto Windows native smoke verified';
  const fill = action(snapshot, input, 'fill', literal);
  await dispatch(fill);
  await waitForState(value => value.text === literal);
  await assert.rejects(dispatch(fill));
  report.checks.push('Actual UIA ValuePattern fill changed fixture text; the consumed snapshot rejected reuse.');
  snapshot = await helper.call<NativeSnapshot>('observe', { appId: fixtureId });
  assert.equal(target(snapshot, 'Fixture text input', 'fill').value, literal);
  const press = action(snapshot, target(snapshot, 'Apply fixture text', 'press'), 'press');
  await dispatch(press);
  await waitForState(value => value.pressCount === 1 && value.applied === literal);
  await assert.rejects(dispatch(press));
  assert.equal((await state())?.pressCount, 1);
  report.checks.push('Actual UIA button invocation applied the literal exactly once; repeated invocation was rejected.');

  snapshot = await helper.call<NativeSnapshot>('observe', { appId: fixtureId });
  assert.ok(snapshot.text.includes(`Applied: ${literal}`), 'The native observation must reflect the actual changed status.');
  const stale = action(snapshot, target(snapshot, 'Apply fixture text', 'press'), 'press');
  await helper.call('observe', { appId: fixtureId });
  await assert.rejects(dispatch(stale));
  assert.equal((await state())?.pressCount, 1);
  report.checks.push('A replaced snapshot was rejected; fresh native observation confirmed the changed fixture status.');
  await helper.call('configure', { appIds: [] });
  await assert.rejects(helper.call('observe', { appId: fixtureId }));
  report.checks.push('Empty configuration revoked access to the fixture.');
  report.status = 'passed';
} catch (error) {
  report.status = error instanceof Blocked ? 'blocked' : 'failed';
  report.reason = error instanceof Error ? error.message : String(error);
} finally {
  helper?.stop();
  if (fixture && fixture.exitCode === null && !fixture.killed) {
    try {
      await writeFile(stopPath, 'close only this disposable fixture\n');
      const result = await Promise.race([fixtureExit, delay(5_000).then(() => 'timeout' as const)]);
      if (result === 'timeout') throw new Error('Fixture did not close after its private shutdown signal.');
      if (report.status === 'passed') assert.equal(result, 0, 'The disposable fixture must exit successfully.');
      report.cleanup = 'The disposable fixture closed through its private shutdown signal.';
    } catch (error) {
      fixture.kill();
      await Promise.race([fixtureExit?.catch(() => undefined), delay(1_000)]);
      report.cleanup = 'The exact launched fixture process required termination; no native action was retried.';
      if (report.status === 'passed') { report.status = 'failed'; report.reason = String(error); }
    }
  } else {
    report.cleanup = 'The disposable fixture was already closed, or no fixture was launched.';
    if (report.status === 'passed' && fixture?.exitCode !== 0) { report.status = 'failed'; report.reason = 'The fixture exited unexpectedly.'; }
  }
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(error => {
    report.cleanup += ` Temporary directory cleanup failed: ${error.message}`;
    if (report.status === 'passed') { report.status = 'failed'; report.reason = 'Fixture cleanup failed.'; }
  });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ ...report, platform: process.platform, at: new Date().toISOString(), claimScope: 'Disposable WinForms UIA discovery/fill/invoke only; no model, OCR-click, global key, or arbitrary-app compatibility claim.' }, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `status=${report.status}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'passed' ? 0 : report.status === 'blocked' ? 2 : 1;
}
