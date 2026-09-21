import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PlatformDriver } from "../../desktop/native-driver.js";
import { AgentLease } from "../../desktop/agent-lease.js";
import { writeProgress } from "../../evals/progress.js";
import { waitForFixtureReady } from "../../evals/fixture-readiness.js";
import { PAIRED_VERSION, PLAN, VALUES, resultText, observation, gradeOutcome, workflowReceiptFailures, summarizePaired, type PairedTrial, type Exchange } from "../../evals/agent-bridge-paired.js";
import { parseLaunch } from "./contract-suite.js";

// Plan-only unless --run is explicit. Only new disposable fixture PIDs; no model.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const environment = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
type Launch = ReturnType<typeof parseLaunch>;
type Trial = PairedTrial & { launch?: Launch; processIdentity?: string; phase?: string; readiness?: unknown; fixtureSHA256?: string; stderr?: string };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const protocolNames = ["list_apps", "inspect", "act", "run_steps", "delegate", "release_control"];
export function parsePairedArgs(args: string[]): { run: boolean; filledValues: boolean } {
  if (new Set(args).size !== args.length || args.some(arg => !["--run", "--filled-values"].includes(arg)))
    throw new Error("Usage: tsx tests/native/agent-bridge-paired.ts [--run] [--filled-values]");
  return { run: args.includes("--run"), filledValues: args.includes("--filled-values") };
}
export const candidateExpected = (filledValues: boolean) => filledValues ? "filled_values" : { values: VALUES };
async function runtime() {
  const paths = ["tests/native/agent-bridge-paired.ts", "tests/native/contract-suite.ts", "tests/native/FormFixture.swift", "scripts/launch-form-fixture.ts",
    "evals/agent-bridge-paired.ts", "evals/native-contracts.ts", "evals/progress.ts", "evals/fixture-readiness.ts", "evals/plan.ts",
    "core/developer.ts", "core/agent-workflow.ts", "core/agent-session.ts", "core/observation.ts", "shared/types.ts",
    "desktop/agent-server.ts", "desktop/native-driver.ts", "desktop/ocr.ts", "desktop/agent-lease.ts",
    "desktop/native/macos/OttoAX.swift", "desktop/native/macos/otto-ax", "scripts/build-native.mjs", "package-lock.json"];
  async function collect(directory: string) {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await collect(path); else if (entry.isFile()) paths.push(path);
    }
  }
  await collect("dist-desktop");
  return Object.fromEntries(await Promise.all(paths.sort().map(async path => [path, hash(await readFile(join(root, path)))])));
}
/** Empty and zombie rows cannot execute and must never be signaled by cleanup. */
export function parseProcessIdentity(output: string, executable: string): string {
  const value = output.trim();
  if (!value) return "";
  const row = /^([A-Z][A-Za-z+<>=-]*)\s+([^\r\n]+)$/.exec(value);
  assert.ok(row, "Cannot parse fixture process identity.");
  if (row[1]!.startsWith("Z")) return "";
  const identity = row[2]!;
  assert.ok(identity.endsWith(" " + executable), "The PID no longer belongs to the owned fixture.");
  const started = identity.slice(0, -executable.length).trim();
  assert.match(started, /^\S+\s+\S+\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}$/, "Cannot establish fixture start time.");
  return started + " " + executable;
}
function identity(launch: Launch): string {
  const result = spawnSync("ps", ["-p", String(launch.pid), "-o", "stat=,lstart=,comm="], { encoding: "utf8", timeout: 3000 });
  assert.ok(!result.error && [0, 1].includes(result.status ?? -1), "Cannot establish fixture process identity.");
  return parseProcessIdentity(result.stdout, launch.executable);
}
async function cleanup(row: Trial, retained: boolean) {
  if (!row.launch) return;
  const launch = row.launch, current = identity(launch);
  if (current) {
    assert.ok(row.processIdentity && current === row.processIdentity, "Refuse cleanup of an unverified or reused PID.");
    try { process.kill(launch.pid, "SIGTERM"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    // ps fields can become incomplete while a process exits. After our only
    // signal, poll existence without interpreting those transient fields or
    // signaling again. A reused/live PID causes a bounded failure, not a kill.
    const exists = () => {
      try { process.kill(launch.pid, 0); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
    };
    for (let i = 0; i < 50; i++) {
      if (!exists()) break;
      await delay(100);
    }
    assert.equal(exists(), false, "Owned fixture PID still present; retain evidence and stop.");
  }
  if (!retained) await rm(dirname(launch.appPath), { recursive: true, force: true });
  row.cleanup = retained ? "Owned fixture exited; temporary evidence retained." : "Owned fixture exited; temporary directory removed.";
}
export function pairedMarkdown(rows: PairedTrial[], fatal?: string, filledValues = false): string {
  const summary = summarizePaired(rows);
  return ["# Paired native tool-exchange measurement", "",
    `${summary.completePairs}/3 pairs passed both independent outcome checks. Six scheduled trials; failures and unrun entries remain below.`, "",
    "Scripted baseline: inspect + six individual fills. Candidate: one run_steps call. Both use fresh blank copies of the same six-field AppKit form; no host agent or model ran.", "",
    `Candidate verification setting: ${filledValues ? 'expected: "filled_values" shortcut' : "explicit expected.values map (default)"}. The independent six-field oracle remains identical.`, "",
    "| Pair | Arm | Status | Task calls | Serialized tokens | Tokens + schema once | Task MCP elapsed ms |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: |",
    ...summary.pairs.flatMap(pair => [pair.baseline, pair.workflow].filter(Boolean).map(row =>
      `| ${pair.pair} | ${row!.arm} | ${row!.status} | ${row!.calls} | ${row!.payload.tokens} | ${row!.includingSchema?.tokens ?? "unknown"} | ${row!.taskElapsedMs ?? "unknown"} |`)), "",
    `Median paired deltas (workflow minus baseline): ${JSON.stringify(summary.medianPairedDelta)}. Suppressed unless all three pairs pass.`, "",
    `All-attempt totals and medians, including measured failures: ${JSON.stringify(summary.arms)}.`, "",
    ...(fatal ? [`Suite error: ${fatal.replaceAll("\n", " ")}`, ""] : []),
    "Tokens use js-tiktoken 1.0.21 / o200k_base on exact serialized task requests and complete returned MCP results. Missing responses make totals partial. Schema and instructions are counted once separately; initialization/listTools are excluded. Release-control exchanges are retained as separate maintenance for both arms.", "",
    "Primary elapsed time sums task MCP roundtrips, including failed calls, and excludes compilation, launch/readiness, schema discovery, journal writes, oracle reads, and cleanup. Task-window wall time is also retained and includes harness journaling. These are different from end-to-end user latency.", "",
    "Order is AB/BA/AB: deterministic and partly counterbalanced, not randomized or perfectly balanced. Three repetitions of one authored fixture do not establish a population success rate, general desktop quality, actual host-input token savings, provider billing savings, or Jev performance. No model runs inside Otto or in this harness; actual host/provider usage and billed cost remain null.", "",
  ].join("\n");
}
export async function main(args = process.argv.slice(2)) {
  const options = parsePairedArgs(args);
  if (!options.run) {
    console.log(JSON.stringify({ mode: "plan-only", version: PAIRED_VERSION, schedule: PLAN, values: VALUES,
      options, candidateExpected: candidateExpected(options.filledValues), order: "AB/BA/AB (partial balance)", instruction: "No apps launched. Reserve the desktop and explicitly pass --run for six fresh owned-fixture trials. No model/provider calls." }, null, 2)); return;
  }
  const output = join(root, "output/agent-bridge-paired", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(output, { recursive: true, mode: 0o700 });
  const rows: Trial[] = PLAN.map(item => ({ ...item, status: "not_run", calls: [], maintenance: [], errors: [] }));
  let hashes: Record<string, string> = {}, canonicalProtocol: string | undefined, fatal: string | undefined;
  const abort = new AbortController(), interrupt = () => abort.abort();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  const snapshot = (status: string) => ({ version: PAIRED_VERSION, status, fatal, schedule: PLAN, hashes, options, candidateExpected: candidateExpected(options.filledValues),
    environment: { platform: process.platform, arch: process.arch, osRelease: release(), node: process.version }, summary: summarizePaired(rows), rows,
    accounting: { tokenizer: "js-tiktoken1.0.21/o200k_base", payload: "Exact JSON task request + newline + complete MCP result; join exchanges with newlines. Missing or non-text responses make totals partial.",
      schema: "Identical tools and instructions counted once separately; initialization/listTools excluded; release_control counted separately as maintenance.",
      taskElapsedMs: "Sum of task MCP roundtrips including failed calls; excludes setup, compilation, journal, independent oracle, and cleanup.", taskWindowMs: "First task dispatch through final task handling, including harness journaling." },
    caveats: ["One authored form,3paired repetitions; AB/BA/AB is only partly counterbalanced and not randomized.", "Scripted caller; no host agent or Jev inference. Serialized counts are not actual host input, provider billing, or general token savings.", "All failed/blocked/not-run trials are retained. Aggregate paired reduction withheld unless all3pairs pass; no population confidence interval claimed."] });
  const save = () => writeProgress(join(output, "progress.json"), snapshot("running"));
  try {
    await save(); assert.equal(process.platform, "darwin", "This fixture comparison requires macOS.");
    hashes = await runtime();
    await writeProgress(join(output, "plan.json"), { version: PAIRED_VERSION, schedule: PLAN, values: VALUES, hashes, options, candidateExpected: candidateExpected(options.filledValues) });
    for (const [path, expected] of Object.entries(hashes)) {
      const bytes = await readFile(join(root, path)); assert.equal(hash(bytes), expected);
      const destination = join(output, "runtime", path); await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, bytes, { mode: 0o600 });
    }
    for (const row of rows) {
      if (abort.signal.aborted) { fatal = "Interrupted; remaining trials not run."; break; }
      const directory = join(output, `pair-${row.pair}-${row.position}-${row.arm}`); await mkdir(directory, { mode: 0o700 });
      row.status = "running"; row.phase = "setup";
      let client: Client | undefined, transport: StdioClientTransport | undefined, taskStart: number | undefined;
      const setupStart = performance.now();
      try {
        await save(); assert.deepEqual(await runtime(), hashes, "Runtime changed between trials.");
        const spawned = spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts/launch-form-fixture.ts")],
          { cwd: root, env: environment, encoding: "utf8", timeout: 90_000, maxBuffer: 1024 * 1024 });
        try { row.launch = parseLaunch(spawned.stdout ?? ""); row.processIdentity = identity(row.launch); assert.ok(row.processIdentity); }
        catch { abort.abort(); }
        await save(); await writeFile(join(directory, "launcher.json"), JSON.stringify({ stdout: spawned.stdout, stderr: spawned.stderr, status: spawned.status }), { mode: 0o600 });
        assert.equal(spawned.status, 0, "Fixture launch failed."); assert.ok(row.launch && row.processIdentity, "Fixture ownership unavailable; no unknown PID will be signaled.");
        if (abort.signal.aborted) throw new Error("Interrupted before native work.");
        const launch = row.launch;
        row.fixtureSHA256 = hash(await readFile(launch.executable));
        row.before = JSON.parse(await readFile(launch.statePath, "utf8"));
        const native = new PlatformDriver(root, false), lease = new AgentLease();
        try {
          lease.acquire(); const available = await native.apps(); assert.ok(available.permissions.accessibility, "Accessibility unavailable.");
          await native.configure([launch.appId]);
          row.readiness = await waitForFixtureReady(native, launch.appId, Object.fromEntries(Object.keys(VALUES).map(key => [key, ""])), { signal: abort.signal });
          assert.deepEqual(JSON.parse(await readFile(launch.statePath, "utf8")), row.before, "Readiness must not change fixture state.");
        } finally { native.cancel(); lease.release(); }
        client = new Client({ name: "otto-paired-native-eval", version: PAIRED_VERSION });
        transport = new StdioClientTransport({ command: process.execPath, args: [join(root, "dist-desktop/desktop/agent-server.js"), "--app", launch.appId, "--allow-actions"], env: environment, cwd: root, stderr: "pipe" });
        transport.stderr?.on("data", data => { row.stderr = ((row.stderr ?? "") + String(data)).slice(-16000); });
        await client.connect(transport, { signal: abort.signal, timeout: 30_000 });
        const manifest = await client.listTools({}, { signal: abort.signal, timeout: 30_000 });
        assert.deepEqual(manifest.tools.map(tool => tool.name).sort(), [...protocolNames].sort());
        row.protocol = JSON.stringify({ instructions: client.getInstructions() ?? "", tools: manifest.tools });
        canonicalProtocol ??= row.protocol; assert.equal(row.protocol, canonicalProtocol, "Both arms must expose the same schemas/instructions.");
        row.setupElapsedMs = Math.round(performance.now() - setupStart); await save();
        const call = async (name: string, args: Record<string, unknown>, maintenance = false) => {
          const request = { name, arguments: args }, entry: Exchange = { request: JSON.stringify(request), dispatched: false };
          (maintenance ? row.maintenance : row.calls).push(entry); row.phase = "dispatch_pending"; await save();
          if (abort.signal.aborted) throw new Error("Interrupted before dispatch.");
          const start = performance.now(); if (!maintenance) taskStart ??= start; entry.dispatched = true;
          try {
            const result = await client!.callTool(request, undefined, { signal: abort.signal, timeout: 150_000 }); entry.result = JSON.stringify(result);
            entry.excludeResponseFromTextMeasurement = !Array.isArray(result.content) || result.content.some(item => item.type !== "text" || typeof item.text !== "string") || entry.result.includes("data:image/");
            return result;
          }
          catch (error) { entry.error = errorText(error); throw error; }
          finally { entry.elapsedMs = performance.now() - start; if (!maintenance) row.taskElapsedMs = (row.taskElapsedMs ?? 0) + entry.elapsedMs; row.phase = "response_received"; await save(); }
        };
        try {
          if (row.arm === "baseline") {
            let frame = observation(await call("inspect", { appId: launch.appId }));
            for (const [label, value] of Object.entries(VALUES)) {
              const matches = frame.controls.filter(control => control[2] === label && control[4] === true && control[5] === true && control[6] === "accessibility" && Array.isArray(control[7]) && control[7].includes("fill"));
              assert.equal(matches.length, 1, "Baseline needs one exact enabled native editable target.");
              const result = await call("act", { snapshotToken: frame.snapshotToken, ref: matches[0]![0], operation: "fill", value });
              assert.equal(JSON.parse(resultText(result).split("\n")[0]!).outcome, "verified"); frame = observation(result);
              assert.equal(frame.controls.find(control => control[2] === label && control[6] === "accessibility" && control[5] === true)?.[3], value);
            }
          } else {
            const receipt = JSON.parse(resultText(await call("run_steps", { appId: launch.appId, steps: Object.entries(VALUES).map(([label, value]) => ({ operation: "fill", label, value })), expected: candidateExpected(options.filledValues) })));
            assert.deepEqual(workflowReceiptFailures(receipt), [], "Workflow receipt must be complete and internally consistent.");
          }
        } finally { if (taskStart !== undefined) row.taskWindowMs = performance.now() - taskStart; }
        resultText(await call("release_control", {}, true));
      } catch (error) {
        row.errors.push(errorText(error));
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        row.status = ["desktop_busy", "desktop_unavailable"].includes(String(code)) || /desktop_busy|desktop_unavailable|Accessibility unavailable/.test(errorText(error)) ? "blocked" : "failed";
      } finally {
        try { await client?.close(); await transport?.close(); } catch (error) { row.errors.push("Transport cleanup: " + errorText(error)); abort.abort(); }
        if (row.launch) try { await delay(150); row.after = JSON.parse(await readFile(row.launch.statePath, "utf8")); } catch (error) { row.errors.push("Final oracle: " + errorText(error)); }
        row.outcomeFailures = gradeOutcome(row.before, row.after, row.launch?.pid ?? -1);
        row.phase = "cleanup_pending"; let saved = false;
        try { await save(); saved = row.after !== undefined; } catch (error) { row.errors.push("Evidence persistence: " + errorText(error)); abort.abort(); }
        try { await cleanup(row, !saved); } catch (error) { row.errors.push("Fixture cleanup: " + errorText(error)); abort.abort(); }
        try { row.runtimeUnchanged = JSON.stringify(await runtime()) === JSON.stringify(hashes); } catch { row.runtimeUnchanged = false; }
        if (!row.runtimeUnchanged) { row.errors.push("Runtime changed or unavailable."); abort.abort(); }
        if (row.status !== "blocked") row.status = row.errors.length || row.outcomeFailures.length ? "failed" : "passed";
        row.phase = "complete"; await writeProgress(join(directory, "result.json"), row); await save();
        console.log(JSON.stringify({ pair: row.pair, arm: row.arm, status: row.status, errors: row.errors, outcomeFailures: row.outcomeFailures }));
      }
    }
  } catch (error) { fatal = errorText(error); }
  finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
    const status = !fatal && summarizePaired(rows).completePairs === 3 ? "passed" : "failed";
    await writeProgress(join(output, "report.json"), snapshot(status)); await writeProgress(join(output, "progress.json"), snapshot(status));
    await writeFile(join(output, "report.md"), pairedMarkdown(rows, fatal, options.filledValues), { mode: 0o600 });
    console.log(JSON.stringify({ status, output, summary: summarizePaired(rows) })); process.exitCode = status === "passed" ? 0 : 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
