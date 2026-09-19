import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { PlatformDriver } from '../../desktop/native-driver.js';
import { DeveloperSession, formatObservation } from '../../core/developer.js';
import type { NativeAction, NativeControl, NativeSnapshot } from '../../shared/types.js';

// Manual integration test. All native effects are confined to the child PID this
// process launches. It never requests permissions, reads keys, or calls providers.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const driver = new PlatformDriver(root, false);
const checks: string[] = [];
let directory: string | undefined;
let fixture: ReturnType<typeof spawn> | undefined;
let exited: Promise<number | null> | undefined;
let fixtureId = '';
let fixturePID = 0;

function target(snapshot: NativeSnapshot, label: string, capability: string): NativeControl {
  assert.equal(snapshot.app.pid, fixturePID);
  assert.equal(snapshot.app.id, fixtureId);
  assert.equal(snapshot.title, 'Otto Native Smoke Fixture');
  const matches = snapshot.controls.filter(c => c.source === 'accessibility' && c.label === label && c.actions.includes(capability));
  assert.equal(matches.length, 1, `Exactly one fixture control: ${label}`);
  return matches[0]!;
}
function action(snapshot: NativeSnapshot, control: NativeControl, kind: 'press' | 'fill', value?: string): NativeAction {
  assert.equal(snapshot.app.pid, fixturePID);
  return { id: randomUUID(), kind, label: control.label, appId: fixtureId,
    targetId: control.id, snapshotId: snapshot.snapshotId, nativeAction: kind, ...(value === undefined ? {} : { value }) };
}
async function dispatch(value: NativeAction) {
  // The harness's own guard is independent of the native helper's allowlist.
  assert.equal(value.appId, fixtureId);
  assert.equal(Number(value.appId), fixturePID);
  assert.ok(fixture && fixture.exitCode === null && !fixture.killed, 'The launched fixture is still running');
  await driver.act(value);
}

try {
  assert.equal(process.platform, 'darwin', 'This smoke test requires macOS.');
  const permissions = await driver.permissions();
  if (!permissions.accessibility) {
    console.log(JSON.stringify({ status: 'blocked', reason: 'Accessibility permission is unavailable; no permission prompt or action attempted.', permissions }, null, 2));
    process.exitCode = 2;
  } else {
    directory = await mkdtemp(join(tmpdir(), 'otto-native-smoke-'));
    const contents = join(directory, 'OttoSmokeFixture.app', 'Contents');
    const executable = join(contents, 'MacOS', 'OttoSmokeFixture');
    await mkdir(dirname(executable), { recursive: true });
    await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>ai.otto.native-smoke-fixture</string><key>CFBundleName</key><string>Otto Smoke Fixture</string><key>CFBundleExecutable</key><string>OttoSmokeFixture</string><key>CFBundlePackageType</key><string>APPL</string><key>NSHighResolutionCapable</key><true/></dict></plist>`);
    const environment: NodeJS.ProcessEnv = { ...process.env, TYPESAFE_API_KEY: '', OPENAI_API_KEY: '' };
    if (!environment.DEVELOPER_DIR && existsSync('/Applications/Xcode.app/Contents/Developer')) environment.DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
    const compiled = spawnSync('xcrun', ['swiftc', '-swift-version', '6', '-strict-concurrency=complete', '-parse-as-library',
      join(root, 'tests/native/SmokeFixture.swift'), '-o', executable, '-framework', 'AppKit'], { env: environment, stdio: 'inherit', timeout: 60_000 });
    assert.equal(compiled.status, 0, 'The disposable fixture compiled.');
    fixture = spawn(executable, [], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    fixturePID = fixture.pid!;
    assert.ok(Number.isInteger(fixturePID) && fixturePID > 1 && fixturePID !== process.pid);
    fixtureId = String(fixturePID);
    exited = new Promise((resolveExit, reject) => { fixture!.once('exit', resolveExit); fixture!.once('error', reject); });
    fixture.stderr?.resume();
    await new Promise<void>((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error('The disposable fixture did not open in time.')), 10_000);
      fixture!.stdout!.once('data', () => { clearTimeout(timeout); resolveReady(); });
      fixture!.once('exit', () => { clearTimeout(timeout); reject(new Error('The disposable fixture exited before opening.')); });
    });
    let discovered = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      discovered = (await driver.apps()).apps.some(app => app.id === fixtureId && app.pid === fixturePID);
      if (discovered) break;
      await delay(100);
    }
    assert.ok(discovered, 'The exact launched fixture PID is discoverable.');
    await driver.configure([fixtureId]);
    let snapshot = await driver.observe(fixtureId);
    const field = target(snapshot, 'Fixture text input', 'fill');
    target(snapshot, 'Apply fixture text', 'press');
    target(snapshot, 'Close fixture', 'press');
    checks.push('AX editable field and buttons discovered in the launched fixture PID');

    const inspection = new DeveloperSession();
    const compact = inspection.inspect(snapshot);
    const prepared = inspection.prepareFill({ snapshotToken: compact.snapshotToken,
      fields: { 'Fixture text input': 'Prepared without typing' } });
    assert.equal(prepared.executed, false);
    assert.equal(prepared.plan.length, 1);
    assert.equal(prepared.plan[0]!.value, 'Prepared without typing');
    assert.equal(prepared.unresolved.length, 0);
    assert.ok(!formatObservation(compact).includes('data:image/'));
    const afterPreparation = await driver.observe(fixtureId);
    assert.equal(target(afterPreparation, 'Fixture text input', 'fill').value, 'Initial fixture text');
    snapshot = afterPreparation;
    checks.push('Native snapshot compacted and literal fill prepared without changing the fixture');

    // PID 0 is not a desktop app and is never configured. This verifies rejection
    // without addressing any running user application, even in a faulty helper.
    await assert.rejects(driver.observe('0'));
    await assert.rejects(driver.act({ ...action(snapshot, field, 'fill', 'must not apply'), appId: '0' }));
    checks.push('Observe and act outside the fixture allowlist rejected');
    const fill = action(snapshot, target(snapshot, 'Fixture text input', 'fill'), 'fill', 'Otto smoke verified');
    await dispatch(fill);
    await assert.rejects(driver.act(fill), /expired|again/i);
    checks.push('A consumed native action snapshot cannot be reused');
    snapshot = await driver.observe(fixtureId);
    assert.equal(target(snapshot, 'Fixture text input', 'fill').value, 'Otto smoke verified');
    checks.push('AX fill applied the exact text inside the fixture');
    await dispatch(action(snapshot, target(snapshot, 'Apply fixture text', 'press'), 'press'));
    snapshot = await driver.observe(fixtureId);
    assert.ok(snapshot.text.includes('Applied: Otto smoke verified'), 'The fixture button copied the field into its own status.');
    checks.push('AX press updated fixture status');

    const ocr = snapshot.controls.filter(c => c.source === 'ocr');
    if (permissions.screenCapture) {
      assert.ok(snapshot.screenshot?.startsWith('data:image/jpeg;base64,'), 'Only the fixture window image was captured.');
      assert.ok(snapshot.windowBounds && snapshot.screenshotSize);
      const frame = snapshot.windowBounds!;
      assert.ok(frame.width > 0 && frame.height > 0 && snapshot.screenshotSize!.width > 0 && snapshot.screenshotSize!.height > 0);
      assert.ok(ocr.some(c => c.label.includes('OCR Geometry Sample')), 'The painted fixture label was found by local OCR.');
      for (const control of ocr) {
        const b = control.bounds!;
        assert.ok(Object.values(b).every(Number.isFinite));
        assert.ok(b.x >= frame.x - 1 && b.y >= frame.y - 1 && b.width > 0 && b.height > 0);
        assert.ok(b.x + b.width <= frame.x + frame.width + 1 && b.y + b.height <= frame.y + frame.height + 1);
      }
      checks.push('Selected-window capture and local OCR coordinates remain inside fixture bounds');
    }
    let closeAcknowledgement = 'confirmed by Accessibility';
    try { await dispatch(action(snapshot, target(snapshot, 'Close fixture', 'press'), 'press')); }
    catch (error) {
      // Termination may destroy the AX connection before the OS acknowledges the
      // press. Never retry: the independently observed child exit is the evidence.
      assert.match(error instanceof Error ? error.message : '', /app did not confirm the action/);
      closeAcknowledgement = 'OS acknowledgement uncertain; verified launched child exited successfully; no retry';
    }
    const exitCode = await Promise.race([exited, delay(5_000).then(() => { throw new Error('The fixture did not close.'); })]);
    assert.equal(exitCode, 0);
    checks.push('Close fixture action exited only the launched app');
    console.log(JSON.stringify({ status: 'passed', platform: process.platform, permissions, checks,
      screenshot: snapshot.screenshot ? 'selected fixture window captured; image not retained' : 'unavailable',
      ocrControls: ocr.length, closeAcknowledgement, providerRequests: 0 }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', checks, error: error instanceof Error ? error.message : 'Unknown fixture failure' }, null, 2));
  process.exitCode = 1;
} finally {
  driver.cancel();
  if (fixture && fixture.exitCode === null && !fixture.killed) { fixture.kill('SIGTERM'); await Promise.race([exited, delay(2_000)]); }
  if (directory) await rm(directory, { recursive: true, force: true });
}
