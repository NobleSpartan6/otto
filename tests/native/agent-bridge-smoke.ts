import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getEncoding } from "js-tiktoken";
import { PlatformDriver } from "../../desktop/native-driver.js";

// Manual integration benchmark. Only freshly launched fixture PIDs are allowed.
// No provider key/model, user app, CUA runtime, or permission request is involved.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const serverPath = join(root, "dist-desktop/desktop/agent-server.js");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = join(root, "output/agent-bridge", stamp);
const encoding = getEncoding("o200k_base");
const environment = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "LANG"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []),
);
const cases = [
  { id: "baseline-six-fields", mode: "baseline", fault: "none" },
  { id: "delegated-six-fields", mode: "delegated", fault: "none" },
  { id: "delegated-changed-field", mode: "delegated", fault: "changed" },
] as const;
type Launch = { appPath: string; executable: string; statePath: string; pid: number; appId: string; literalFields: Record<string, string> };
type Oracle = {
  launchId: string; pid: number; status: string; resetCount: number;
  fieldMutationCount: number; axWriteAttempts: number; rejectedWrites: number;
  forbiddenSubmitCount: number; duplicateMutationCount: number; faultTriggered: boolean;
  fields: Record<string, { value: string; visible: boolean; editable: boolean; valueChangeCount: number }>;
};
type Exchange = { arguments: string; result?: string; error?: string; elapsedMs: number };
type Row = {
  case: string; mode: string; fault: string; status: "failed" | "passed" | "blocked";
  error?: string; launch?: Launch; before?: Oracle; after?: Oracle;
  calls: Exchange[]; protocol?: string; receipt?: Record<string, unknown>;
  elapsedMs?: number; schemaSize?: ReturnType<typeof measure>;
  exchangeSize?: ReturnType<typeof measure>; exchangesPlusSchemaSize?: ReturnType<typeof measure>;
  nativeWrites?: number; cleanup?: string; stderr?: string;
};
const rows: Row[] = [];
const json = (value: unknown) => JSON.stringify(value);
const measure = (value: string) => ({ utf8Bytes: Buffer.byteLength(value, "utf8"), tokens: encoding.encode(value).length });
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const hashFiles = [
  "tests/native/agent-bridge-smoke.ts", "tests/native/FormFixture.swift", "scripts/launch-form-fixture.ts",
  "desktop/agent-server.ts", "core/agent-session.ts", "core/agent-workflow.ts", "core/developer.ts", "desktop/native-driver.ts",
  "desktop/native/macos/otto-ax", "dist-desktop/desktop/agent-server.js", "package-lock.json",
  "dist-desktop/core/agent-session.js", "dist-desktop/core/agent-workflow.js", "dist-desktop/core/developer.js",
  "dist-desktop/desktop/native-driver.js", "dist-desktop/desktop/ocr.js",
];
async function hashes() {
  return Object.fromEntries(await Promise.all(hashFiles.map(async file => {
    try { return [file, createHash("sha256").update(await readFile(join(root, file))).digest("hex")]; }
    catch { return [file, "unavailable"]; }
  })));
}
function resultText(result: unknown) {
  const value = result as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  assert.ok(Array.isArray(value.content), "MCP result must have content.");
  assert.ok(value.content.every(item => item.type === "text"), "This benchmark excludes image payloads.");
  const text = value.content.map(item => item.text ?? "").join("\n");
  assert.doesNotMatch(text, /data:image\//, "Base64 images must not be counted as text tokens.");
  assert.notEqual(value.isError, true, text);
  return text;
}
function observation(result: unknown) {
  const lines = resultText(result).split("\n");
  const metadata = lines.filter(line => line.startsWith("{")).map(line => JSON.parse(line))
    .find(value => typeof value.snapshotToken === "string");
  assert.ok(metadata, "Current observation metadata must include a snapshot token.");
  const controls = lines.filter(line => line.startsWith("[")).map(line => JSON.parse(line) as unknown[]);
  assert.ok(controls.every(row => row.length === 8), "Unexpected compact control columns.");
  return { snapshotToken: metadata.snapshotToken as string, controls };
}
async function oracle(launch: Launch) {
  const state = JSON.parse(await readFile(launch.statePath, "utf8")) as Oracle;
  assert.equal(state.pid, launch.pid);
  assert.equal(state.status, "ready");
  return state;
}
async function cleanup(launch: Launch) {
  assert.ok(Number.isSafeInteger(launch.pid) && launch.pid > 1 && launch.pid !== process.pid);
  assert.ok(dirname(launch.appPath).startsWith(join(tmpdir(), "otto-form-eval-")), "Cleanup is restricted to this launcher's fixture directory.");
  assert.equal(launch.executable, join(launch.appPath, "Contents/MacOS/OttoFormFixture"));
  const command = spawnSync("ps", ["-p", String(launch.pid), "-o", "comm="], { encoding: "utf8" }).stdout.trim();
  if (command) {
    assert.equal(command, launch.executable, "Refuse to terminate a PID that no longer belongs to this fixture.");
    process.kill(launch.pid, "SIGTERM");
    for (let attempt = 0; attempt < 50; attempt++) {
      try { process.kill(launch.pid, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") break; throw error; }
      await delay(100);
    }
    assert.equal(spawnSync("ps", ["-p", String(launch.pid), "-o", "comm="], { encoding: "utf8" }).stdout.trim(), "");
  }
  await rm(dirname(launch.appPath), { recursive: true, force: true });
  return "Exact fixture child exited; its temporary directory removed.";
}
await mkdir(output, { recursive: true });
const hashesBefore = await hashes();
let preflight: { status: string; error?: string } = { status: "pending" };
try {
  assert.equal(process.platform, "darwin", "This native fixture requires macOS; Windows is not evaluated.");
  assert.notEqual(hashesBefore["dist-desktop/desktop/agent-server.js"], "unavailable", "Build the agent server before running this harness.");
  const probe = new PlatformDriver(root, false);
  const permissions = await probe.permissions().finally(() => probe.cancel());
  if (!permissions.accessibility) {
    preflight = { status: "blocked", error: "Accessibility unavailable; no permission request or fixture mutation attempted." };
  } else {
    preflight = { status: "passed" };
    for (const testCase of cases) {
      const row: Row = { case: testCase.id, mode: testCase.mode, fault: testCase.fault, status: "failed", calls: [] };
      rows.push(row);
      let launch: Launch | undefined;
      let client: Client | undefined;
      let taskStarted: number | undefined;
      try {
        const spawned = spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts/launch-form-fixture.ts"), "--fault", testCase.fault], {
          cwd: root, env: environment, encoding: "utf8", timeout: 90_000,
        });
        assert.equal(spawned.status, 0, "Disposable fixture launch failed: " + spawned.stderr.slice(-1500));
        launch = JSON.parse(spawned.stdout) as Launch;
        row.launch = launch;
        assert.ok(Number.isSafeInteger(launch.pid) && launch.pid > 1 && launch.pid !== process.pid);
        assert.equal(launch.appId, String(launch.pid));
        assert.ok(dirname(launch.appPath).startsWith(join(tmpdir(), "otto-form-eval-")));
        assert.equal(launch.statePath, join(dirname(launch.appPath), "state.json"));
        assert.equal(launch.executable, join(launch.appPath, "Contents/MacOS/OttoFormFixture"));
        const before = row.before = await oracle(launch);
        assert.equal(before.resetCount, 0);
        assert.equal(before.fieldMutationCount, 0);
        assert.equal(before.forbiddenSubmitCount, 0);
        assert.equal(before.faultTriggered, false);
        const fields = launch.literalFields;
        assert.equal(Object.keys(fields).length, 6);
        for (const label of Object.keys(fields)) {
          assert.equal(before.fields[label]?.value, "", "Both variants must begin with the same blank fields.");
          assert.equal(before.fields[label]?.visible, true);
        }
        client = new Client({ name: "otto-native-agent-bridge-smoke", version: "1.0.0" }, { capabilities: {} });
        const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath, "--app", launch.appId, "--allow-actions"], env: environment, cwd: root, stderr: "pipe" });
        let stderr = "";
        transport.stderr?.on("data", chunk => { stderr += String(chunk); row.stderr = stderr; });
        await client.connect(transport);
        const manifest = await client.listTools();
        for (const name of ["inspect", "act", "run_steps"]) assert.ok(manifest.tools.some(tool => tool.name === name), `Missing ${name} tool.`);
        row.protocol = json({ instructions: client.getInstructions() ?? "", tools: manifest.tools });
        const call = async (name: string, args: Record<string, unknown>) => {
          const entry: Exchange = { arguments: json({ name, arguments: args }), elapsedMs: 0 };
          row.calls.push(entry);
          const started = performance.now();
          try {
            const result = await client!.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
            entry.result = json(result);
            return result;
          } catch (error) { entry.error = errorText(error); throw error; }
          finally { entry.elapsedMs = Math.round(performance.now() - started); }
        };
        const started = taskStarted = performance.now();
        if (testCase.mode === "baseline") {
          let frame = observation(await call("inspect", { appId: launch.appId }));
          for (const [label, value] of Object.entries(fields)) {
            const matching = frame.controls.filter(control => control[2] === label && control[4] === true && control[5] === true);
            assert.equal(matching.length, 1, `Exactly one enabled editable control must match ${label}.`);
            const result = await call("act", { snapshotToken: frame.snapshotToken, ref: matching[0]![0], operation: "fill", value });
            const outcome = JSON.parse(resultText(result).split("\n")[0]!);
            assert.ok(Object.hasOwn(outcome, "outcome"), "Act must return a delivery outcome.");
            frame = observation(result);
            const filled = frame.controls.find(control => control[2] === label && control[5] === true);
            assert.equal(filled?.[3], value, `Readback must match ${label}.`);
          }
          assert.equal(row.calls.length, 7);
        } else {
          const result = await call("run_steps", {
            appId: launch.appId,
            steps: Object.entries(fields).map(([label, value]) => ({ operation: "fill", label, value })),
            expected: { values: fields },
          });
          row.receipt = JSON.parse(resultText(result)) as Record<string, unknown>;
          assert.equal(row.receipt.status, testCase.fault === "none" ? "verified" : "stopped", String(row.receipt.reason ?? "Unexpected receipt status."));
          assert.equal(row.receipt.modelCalls, 0);
          assert.equal(row.receipt.actions, testCase.fault === "none" ? 6 : 1, "Receipt must count every dispatch attempt.");
          assert.ok(Array.isArray(row.receipt.checks), "Receipt must preserve postcondition checks.");
          if (testCase.fault === "none") {
            assert.equal(row.receipt.checks.length, 6);
            assert.ok(row.receipt.checks.every(check => check.matched === true));
          }
          assert.ok(Number.isSafeInteger(row.receipt.observations) && Number(row.receipt.observations) > 0);
          assert.ok(typeof row.receipt.elapsedMs === "number" && row.receipt.elapsedMs >= 0);
          assert.equal(row.calls.length, 1);
        }
        row.elapsedMs = Math.round(performance.now() - started);
        await delay(150); // Let the fixture's independent recorder flush.
        const after = row.after = await oracle(launch);
        assert.equal(after.launchId, before.launchId);
        assert.equal(after.resetCount, 0);
        assert.equal(after.forbiddenSubmitCount, 0);
        assert.equal(after.duplicateMutationCount, 0);
        row.nativeWrites = after.axWriteAttempts - before.axWriteAttempts;
        if (testCase.fault === "none") {
          for (const [label, value] of Object.entries(fields)) assert.equal(after.fields[label]?.value, value, label);
          assert.equal(after.fieldMutationCount, 6);
          assert.equal(row.nativeWrites, 6);
          assert.equal(after.rejectedWrites, 0);
        } else {
          assert.equal(after.faultTriggered, true);
          assert.equal(after.fieldMutationCount, 1, "Stop before applying any later field after an unsolicited change.");
          assert.equal(row.nativeWrites, 1);
          assert.equal(after.fields["Project name"]?.value, fields["Project name"]);
          assert.equal(after.fields.Notes?.value, "Edited by fixture after preview — preserve this value");
          for (const label of Object.keys(fields).slice(1, 5)) assert.equal(after.fields[label]?.value, "");
        }
        row.status = "passed";
      } catch (error) {
        row.error = errorText(error);
        if (launch && !row.after) {
          await delay(150);
          row.after = await oracle(launch).catch(() => undefined);
        }
      } finally {
        if (taskStarted !== undefined && row.elapsedMs === undefined) row.elapsedMs = Math.round(performance.now() - taskStarted);
        if (row.before && row.after) row.nativeWrites = row.after.axWriteAttempts - row.before.axWriteAttempts;
        try { await client?.close(); } catch (error) { row.status = "failed"; row.error = `${row.error ?? ""} Close: ${errorText(error)}`; }
        if (launch) {
          try { row.cleanup = await cleanup(launch); }
          catch (error) { row.status = "failed"; row.cleanup = errorText(error); }
        }
        const exchange = row.calls.map(call => call.arguments + "\n" + (call.result ?? json({ transportError: call.error }))).join("\n");
        row.schemaSize = measure(row.protocol ?? "");
        row.exchangeSize = measure(exchange);
        row.exchangesPlusSchemaSize = measure((row.protocol ?? "") + "\n" + exchange);
        await writeFile(join(output, `${testCase.id}.json`), json(row) + "\n");
        console.log(json({ case: row.case, status: row.status, error: row.error, calls: row.calls.length, tokens: row.exchangeSize.tokens, nativeWrites: row.nativeWrites }));
      }
    }
  }
} catch (error) { preflight = { status: "failed", error: errorText(error) }; }
finally {
  const hashesAfter = await hashes();
  const sourceChanged = json(hashesBefore) !== json(hashesAfter);
  const status = sourceChanged || preflight.status === "failed" || rows.some(row => row.status === "failed") ? "failed"
    : preflight.status === "blocked" ? "blocked" : rows.length === cases.length ? "passed" : "failed";
  const baseline = rows.find(row => row.mode === "baseline");
  const delegated = rows.find(row => row.mode === "delegated" && row.fault === "none");
  const comparison = baseline?.status === "passed" && delegated?.status === "passed" ? {
    baselineToolCalls: baseline.calls.length, delegatedToolCalls: delegated.calls.length,
    baselineExchangeTokens: baseline.exchangeSize!.tokens, delegatedExchangeTokens: delegated.exchangeSize!.tokens,
    exchangeTokenReductionPercent: Number((100 * (1 - delegated.exchangeSize!.tokens / baseline.exchangeSize!.tokens)).toFixed(2)),
    baselineElapsedMs: baseline.elapsedMs, delegatedElapsedMs: delegated.elapsedMs,
    sameNativeWrites: baseline.nativeWrites === delegated.nativeWrites,
  } : null;
  const report = { status, preflight, startedAt: stamp, platform: process.platform, architecture: process.arch,
    node: process.version, tokenizer: "js-tiktoken 1.0.21 / o200k_base", sourceChanged, hashesBefore, hashesAfter,
    counting: "Exact JSON.stringify({name,arguments}) and complete MCP callTool results, separated by newlines. Runtime IDs are not normalized. Tools+instructions counted once separately. Not model message framing, cumulative context replay, cached tokens, provider billing, image tokens, or measured inference savings.",
    scope: "Three authored native fixture cases, one attempt each. Deterministic caller; no model/provider invocation. Mac fixture coverage only, not a general computer-use benchmark. All failures retained.",
    comparison, rows, output };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(json({ status, comparison, output }));
  process.exitCode = status === "passed" ? 0 : status === "blocked" ? 2 : 1;
}
