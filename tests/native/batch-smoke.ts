import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rm, mkdtemp, copyFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { BatchEngine } from "../../core/batch.js";
import { PlatformDriver } from "../../desktop/native-driver.js";
import type { NativeAction, NativeDriver } from "../../shared/types.js";
import type { BatchRun } from "../../shared/batch.js";

// Manual integration test: only newly launched fixture PIDs can receive fills.
// No user app, provider credentials, model request, or CUA runtime is involved.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = join(root, "output", "native-batch", stamp);
await mkdir(output, { recursive: true });
const sourceFiles = ["tests/native/FormFixture.swift", "scripts/launch-form-fixture.ts", "core/batch.ts", "desktop/native-driver.ts", "desktop/native/macos/OttoAX.swift", "desktop/native/macos/otto-ax"];
const hashes: Record<string, string> = {};
for (const file of sourceFiles) {
  try { hashes[file] = createHash("sha256").update(await readFile(join(root, file))).digest("hex"); }
  catch { hashes[file] = "unavailable"; }
}
const resources = await mkdtemp(join(tmpdir(), "otto-batch-helper-"));
const pinnedHelper = join(resources, "desktop/native/macos/otto-ax");
await mkdir(dirname(pinnedHelper), { recursive: true });
await copyFile(join(root, "desktop/native/macos/otto-ax"), pinnedHelper);
await chmod(pinnedHelper, 0o700);
hashes["pinned-native-helper"] = createHash("sha256").update(await readFile(pinnedHelper)).digest("hex");
type Oracle = {
  launchId: string; pid: number; resetCount: number; faultMode: string; faultTriggered: boolean;
  status: string; fieldMutationCount: number; axWriteAttempts: number; rejectedWrites: number;
  forbiddenSubmitCount: number; duplicateMutationCount: number; duplicateNotesValue: string | null;
  fields: Record<string, { value: string; visible: boolean; editable: boolean; valueChangeCount: number }>;
  events: Array<{ sequence: number; kind: string; field?: string }>;
};
type Launch = { appPath: string; executable: string; statePath: string; pid: number; appId: string; literalFields: Record<string, string> };
type Case = { name: string; fault: string; prefill?: boolean; unicode?: boolean };
type Evidence = { case: string; status: "passed" | "failed" | "blocked"; error?: string; launch?: Launch; fixtureExecutableSHA256?: string;
  before?: Oracle; after?: Oracle; review?: BatchRun; receipt?: BatchRun; dispatched: NativeAction[]; elapsedMs?: number; cleanup?: string;
  observationChecks?: { count: number; menuControls: number; zeroSizeMenuControls: number; appleMenuPresent: boolean } };
const cases: Case[] = [
  { name: "blank", fault: "none" }, { name: "prefilled", fault: "none", prefill: true },
  { name: "unicode", fault: "none", unicode: true }, { name: "changed", fault: "changed" },
  { name: "disappeared", fault: "disappeared" }, { name: "duplicate", fault: "duplicate" },
  { name: "reject", fault: "reject" },
];
const evidence: Evidence[] = [];
let fetchAttempts = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { fetchAttempts++; throw new Error("Network requests are prohibited in the native batch fixture harness."); };
const environment: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG };
async function oracle(launch: Launch): Promise<Oracle> {
  const state = JSON.parse(await readFile(launch.statePath, "utf8")) as Oracle;
  assert.equal(state.pid, launch.pid);
  assert.equal(state.status, "ready");
  return state;
}
async function cleanup(launch: Launch): Promise<string> {
  const command = spawnSync("ps", ["-p", String(launch.pid), "-o", "comm="], { encoding: "utf8" }).stdout.trim();
  if (command) {
    assert.equal(command, launch.executable, "Never terminate a PID that no longer belongs to this fixture.");
    process.kill(launch.pid, "SIGTERM");
    for (let attempt = 0; attempt < 50; attempt++) {
      try { process.kill(launch.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") break; throw error; }
      await delay(100);
    }
    const remaining = spawnSync("ps", ["-p", String(launch.pid), "-o", "comm="], { encoding: "utf8" }).stdout.trim();
    assert.equal(remaining, "", "The exact fixture child must exit after cleanup.");
  }
  await rm(dirname(launch.appPath), { recursive: true, force: true });
  return "Exact launched fixture PID exited; its temporary directory removed.";
}

try {
  if (process.platform !== "darwin") throw new Error("This integration suite requires macOS.");
  const probe = new PlatformDriver(resources, false);
  const permissions = await probe.permissions().finally(() => probe.cancel());
  if (!permissions.accessibility) {
    evidence.push({ case: "preflight", status: "blocked", error: "Accessibility permission unavailable. No permission request or native action attempted.", dispatched: [] });
  } else for (const testCase of cases) {
    const row: Evidence = { case: testCase.name, status: "failed", dispatched: [],
      observationChecks: { count: 0, menuControls: 0, zeroSizeMenuControls: 0, appleMenuPresent: false } };
    evidence.push(row);
    let native: PlatformDriver | undefined;
    let engine: BatchEngine | undefined;
    let launch: Launch | undefined;
    try {
      const args = ["--import", "tsx", join(root, "scripts/launch-form-fixture.ts"), "--fault", testCase.fault];
      if (testCase.prefill) args.push("--prefill");
      const spawned = spawnSync(process.execPath, args, { cwd: root, env: environment, encoding: "utf8", timeout: 90_000 });
      assert.equal(spawned.status, 0, "The disposable form launcher must compile and start successfully: " + spawned.stderr.slice(-1000));
      launch = JSON.parse(spawned.stdout) as Launch;
      row.launch = launch;
      assert.ok(Number.isSafeInteger(launch.pid) && launch.pid > 1 && launch.pid !== process.pid);
      assert.equal(launch.appId, String(launch.pid));
      assert.ok(dirname(launch.appPath).startsWith(join(tmpdir(), "otto-form-eval-")), "Only this launcher's temporary fixture directory is eligible for cleanup.");
      assert.equal(launch.statePath, join(dirname(launch.appPath), "state.json"));
      assert.equal(launch.executable, join(launch.appPath, "Contents/MacOS/OttoFormFixture"));
      row.fixtureExecutableSHA256 = createHash("sha256").update(await readFile(launch.executable)).digest("hex");
      const before = await oracle(launch);
      row.before = before;
      assert.equal(before.resetCount, 0);
      assert.equal(before.fieldMutationCount, 0, "A user edit or stray keystroke invalidates the initial state.");
      assert.equal(before.forbiddenSubmitCount, 0);
      assert.equal(before.faultTriggered, false);
      const fieldLabels = Object.keys(launch.literalFields);
      assert.equal(fieldLabels.length, 6);
      for (const [index, label] of fieldLabels.entries()) {
        assert.equal(before.fields[label]!.value, testCase.prefill && index < 2 ? launch.literalFields[label] : "");
        assert.equal(before.fields[label]!.visible, true);
      }
      const fields = { ...launch.literalFields };
      if (testCase.unicode) {
        fields["Project name"] = "Otto Démo 日本語 🪴";
        fields.Notes = "مرحبا — café\nLiteral text: $(do-not-execute); `no-command`";
      }
      native = new PlatformDriver(resources, false);
      const selected = launch;
      const driver: NativeDriver = {
        async apps() {
          const discovery = await native!.apps();
          return { ...discovery, apps: discovery.apps.filter(app => app.id === selected.appId && app.pid === selected.pid) };
        },
        async configure(ids) { assert.deepEqual(ids, [selected.appId]); await native!.configure(ids); },
        async observe(appId) {
          assert.equal(appId, selected.appId);
          const snapshot = await native!.observe(appId);
          assert.equal(snapshot.app.pid, selected.pid);
          assert.equal(snapshot.title, "Otto Developer Onboarding Fixture");
          const menus = snapshot.controls.filter(control => ["AXMenuItem", "AXMenuBarItem"].includes(control.role));
          row.observationChecks!.count++;
          row.observationChecks!.menuControls += menus.length;
          row.observationChecks!.zeroSizeMenuControls += menus.filter(control => !control.bounds || control.bounds.width <= 0 || control.bounds.height <= 0).length;
          row.observationChecks!.appleMenuPresent ||= menus.some(control => control.role === "AXMenuBarItem" && control.label === "Apple");
          assert.equal(row.observationChecks!.zeroSizeMenuControls, 0, "Hidden zero-sized menu controls must not appear as actionable targets.");
          assert.equal(row.observationChecks!.appleMenuPresent, false, "The shared Apple menu subtree must stay outside selected-app observations.");
          return snapshot;
        },
        async act(action) {
          assert.equal(action.appId, selected.appId);
          assert.equal(action.kind, "fill"); assert.equal(action.nativeAction, "fill");
          process.kill(selected.pid, 0);
          row.dispatched.push(structuredClone(action));
          await native!.act(action);
        },
        cancel() { native!.cancel(); },
      };
      engine = new BatchEngine(driver);
      const started = performance.now();
      const initial = await engine.prepare({ appId: selected.appId, fields, consent: true });
      const review = await engine.awaitIdle(initial.id);
      row.review = review;
      assert.equal(review.status, "awaiting_approval", review.error);
      const afterPreparation = await oracle(selected);
      assert.equal(afterPreparation.launchId, before.launchId);
      assert.equal(afterPreparation.fieldMutationCount, 0, "Preparing a review must not change native fields.");
      await engine.approve(review.id, review.approvalId!);
      const receipt = await engine.awaitIdle(review.id);
      row.receipt = receipt;
      row.elapsedMs = Math.round(performance.now() - started);
      // Allow the fixture's own periodic change recorder to flush independently.
      await delay(150);
      const after = await oracle(selected);
      row.after = after;
      assert.equal(after.launchId, before.launchId);
      assert.equal(after.resetCount, before.resetCount);
      assert.equal(after.forbiddenSubmitCount, 0);
      assert.equal(receipt.metrics.modelCalls, 0);
      assert.equal(fetchAttempts, 0);
      assert.equal(receipt.metrics.nativeActions, row.dispatched.length);
      if (testCase.fault === "none") {
        assert.equal(receipt.status, "completed", receipt.error);
        assert.equal(receipt.verification, "native_readback");
        for (const [label, value] of Object.entries(fields)) assert.equal(after.fields[label]!.value, value, label);
        assert.equal(after.fieldMutationCount, testCase.prefill ? 4 : 6);
        assert.equal(row.dispatched.length, testCase.prefill ? 4 : 6);
        if (testCase.prefill) {
          assert.equal(after.fields["Project name"]!.valueChangeCount, 0);
          assert.equal(after.fields["Repository URL"]!.valueChangeCount, 0);
        }
      } else {
        assert.equal(receipt.status, "failed", "Faults must not be reported as completed.");
        assert.equal(receipt.verification, undefined);
        assert.equal(after.faultTriggered, true);
        assert.equal(after.fields["Project name"]!.value, fields["Project name"]);
        if (testCase.fault === "reject") {
          assert.equal(row.dispatched.length, 6);
          assert.equal(after.fieldMutationCount, 5);
          assert.equal(after.rejectedWrites, 1);
          assert.equal(after.fields.Notes!.value, "");
        } else {
          assert.equal(row.dispatched.length, 1);
          assert.equal(after.fieldMutationCount, 1);
          for (const label of fieldLabels.slice(1, 5)) assert.equal(after.fields[label]!.value, "");
          if (testCase.fault === "changed") assert.equal(after.fields.Notes!.value, "Edited by fixture after preview — preserve this value");
          if (testCase.fault === "disappeared") assert.equal(after.fields.Notes!.visible, false);
          if (testCase.fault === "duplicate") {
            assert.equal(after.duplicateNotesValue, "Duplicate target — must remain unchanged");
            assert.equal(after.duplicateMutationCount, 0);
          }
        }
      }
      row.status = "passed";
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
      if (launch && !row.after) row.after = await oracle(launch).catch(() => undefined);
    } finally {
      engine?.stopAll(); native?.cancel();
      if (launch) {
        try { row.cleanup = await cleanup(launch); }
        catch (error) { row.status = "failed"; row.cleanup = String(error); }
      }
      await writeFile(join(output, `${testCase.name}.json`), JSON.stringify(row, null, 2) + "\n");
      console.log(JSON.stringify({ case: row.case, status: row.status, error: row.error, nativeActions: row.dispatched.length, elapsedMs: row.elapsedMs }));
    }
  }
} catch (error) {
  evidence.push({ case: "harness", status: "failed", error: String(error), dispatched: [] });
} finally {
  globalThis.fetch = originalFetch;
  await rm(resources, { recursive: true, force: true });
  const status = evidence.some(row => row.status === "failed") ? "failed" : evidence.some(row => row.status === "blocked") ? "blocked" : "passed";
  const report = { status, startedAt: stamp, platform: process.platform, architecture: process.arch,
    os: spawnSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).stdout.trim(), hashes,
    providerRequests: fetchAttempts, scope: "Seven authored native form cases; one run each. No provider call or billing/savings comparison. Every failure retained. Only newly launched fixture PIDs can receive fill actions.",
    cases: evidence, output };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status, cases: evidence.length, providerRequests: fetchAttempts, output }));
  process.exitCode = status === "passed" ? 0 : status === "blocked" ? 2 : 1;
}
