import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PlatformDriver } from "../../desktop/native-driver.js";
import { CASES, SUITE_VERSION, gradeCase, type ContractEvidence, type ContractGrade } from "../../evals/native-contracts.js";

// Real native integration checks, with scripted MCP requests and NO model.
// Default invocation prints a plan. --run opts into disposable macOS UI work.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const environment = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
const runtimeFiles = [
  "evals/native-contracts.ts", "tests/native/contract-suite.ts", "tests/native/FormFixture.swift", "scripts/launch-form-fixture.ts",
  "desktop/native/macos/otto-ax", "dist-desktop/desktop/agent-server.js", "dist-desktop/desktop/agent-lease.js",
  "dist-desktop/desktop/native-driver.js", "dist-desktop/desktop/ocr.js", "dist-desktop/core/agent-session.js",
  "dist-desktop/core/agent-workflow.js", "dist-desktop/core/developer.js", "dist-desktop/core/candidates.js", "package-lock.json",
];
type Launch = { appPath: string; executable: string; statePath: string; pid: number; appId: string };
type Trial = {
  index: number; caseId: string; repetition: number; family: string;
  status: "not_run" | "running" | "passed" | "failed";
  evidence: ContractEvidence; grade?: ContractGrade; elapsedMs?: number;
  toolCalls: number; launch?: Launch; cleanup?: string;
};
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

export function parseLaunch(output: string): Launch {
  const value = JSON.parse(output) as Launch;
  assert.ok(value && Number.isSafeInteger(value.pid) && value.pid > 1 && value.pid !== process.pid);
  assert.equal(value.appId, String(value.pid));
  assert.equal(typeof value.appPath, "string");
  assert.equal(value.appPath, resolve(value.appPath));
  assert.ok(dirname(value.appPath).startsWith(join(tmpdir(), "otto-form-eval-")));
  assert.equal(value.appPath, join(dirname(value.appPath), "OttoFormFixture.app"));
  assert.equal(value.executable, join(value.appPath, "Contents/MacOS/OttoFormFixture"));
  assert.equal(value.statePath, join(dirname(value.appPath), "state.json"));
  return value;
}

export function parseOptions(args: string[]) {
  const options = { run: false, repetitions: 1, seed: 20260920, caseId: undefined as string | undefined };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (seen.has(flag)) throw new Error("Repeated option.");
    seen.add(flag);
    if (flag === "--run") options.run = true;
    else if (flag === "--case") {
      options.caseId = args[++i];
      if (!CASES.some(item => item.id === options.caseId)) throw new Error("Unknown contract case.");
    } else if (flag === "--repetitions" || flag === "--seed") {
      const raw = args[++i] ?? "";
      if (!/^[0-9]+$/.test(raw)) throw new Error("Use a positive integer.");
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value < 1 || value > (flag === "--seed" ? 0xffffffff : 3)) throw new Error("Use 1–3 repetitions and a 32-bit positive seed.");
      if (flag === "--seed") options.seed = value; else options.repetitions = value;
    } else throw new Error("Usage: npm run eval:native-contracts -- [--run] [--case ID] [--repetitions 1..3] [--seed INTEGER]");
  }
  return options;
}

export function schedule(options: ReturnType<typeof parseOptions>) {
  let state = options.seed >>> 0;
  const rows = Array.from({ length: options.repetitions }, (_, repetition) => CASES.filter(item => !options.caseId || item.id === options.caseId)
    .map(item => ({ caseId: item.id, family: item.family, repetition: repetition + 1 }))).flat();
  for (let i = rows.length - 1; i > 0; i--) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const j = (state >>> 0) % (i + 1); [rows[i], rows[j]] = [rows[j]!, rows[i]!];
  }
  return rows.map((item, index) => ({ ...item, index: index + 1 }));
}

async function hashes() {
  return Object.fromEntries(await Promise.all(runtimeFiles.map(async file => [file, hash(await readFile(join(root, file)))])));
}

async function preserveRuntime(output: string, fingerprint: Record<string, string>) {
  for (const file of runtimeFiles) {
    const bytes = await readFile(join(root, file));
    assert.equal(hash(bytes), fingerprint[file], "Runtime changed while preserving evaluation inputs.");
    const destination = join(output, "runtime", file);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, bytes, { mode: 0o600 });
  }
}

async function cleanup(launch: Launch) {
  assert.ok(Number.isSafeInteger(launch.pid) && launch.pid > 1 && launch.pid !== process.pid);
  assert.ok(dirname(launch.appPath).startsWith(join(tmpdir(), "otto-form-eval-")));
  assert.equal(launch.executable, join(launch.appPath, "Contents/MacOS/OttoFormFixture"));
  const command = () => {
    const result = spawnSync("ps", ["-p", String(launch.pid), "-o", "comm="], { encoding: "utf8" });
    if (result.error || ![0, 1].includes(result.status ?? -1)) throw new Error("Could not verify fixture process identity for cleanup.");
    return result.stdout.trim();
  };
  if (command()) {
    assert.equal(command(), launch.executable, "Refuse to terminate a different process.");
    process.kill(launch.pid, "SIGTERM");
    for (let i = 0; i < 50 && command(); i++) await delay(100);
    assert.equal(command(), "", "Fixture still running; temporary state retained.");
  }
  await rm(dirname(launch.appPath), { recursive: true, force: true });
  return "Exact fixture process exited; its temporary directory removed.";
}

export function summary(trials: Trial[]) {
  const nominal = trials.filter(row => CASES.find(item => item.id === row.caseId)!.goalExpected);
  const stopCases = trials.filter(row => !CASES.find(item => item.id === row.caseId)!.goalExpected);
  return {
    scheduled: trials.length, started: trials.filter(row => row.status !== "not_run").length,
    contractPassed: trials.filter(row => row.grade?.contractPassed).length,
    contractFailed: trials.filter(row => row.grade && !row.grade.contractPassed).length,
    notRun: trials.filter(row => row.status === "not_run").length,
    evidenceIncomplete: trials.filter(row => row.grade && !row.grade.evidenceComplete).length,
    goalCompleted: trials.filter(row => row.grade?.goalCompleted).length,
    nominalGoals: { completed: nominal.filter(row => row.grade?.goalCompleted).length, scheduled: nominal.length },
    expectedStops: { passed: stopCases.filter(row => row.grade?.contractPassed && row.grade.expectedStop).length, scheduled: stopCases.length },
    forbiddenSideEffectCases: trials.filter(row => row.grade?.forbiddenSideEffects.length).length,
    modelCalls: 0, providerTokenUsage: null, billedCost: null,
  };
}

export function markdown(trials: Trial[], output: string, fatal?: string) {
  const totals = summary(trials);
  return [
    "# Otto native integration contracts", "",
    `${totals.contractPassed}/${totals.scheduled} scheduled contract trials passed. ${totals.nominalGoals.completed}/${totals.nominalGoals.scheduled} nominal goals completed. ${totals.expectedStops.passed}/${totals.expectedStops.scheduled} expected-stop contracts passed.`, "",
    "This is a deterministic native integration evaluation with scripted MCP requests, not an LLM-agent evaluation. All cases share one authored AppKit fixture. No provider or Jev calls were made; token savings and billed cost were not measured.", "",
    ...(fatal ? [`Suite interruption: ${fatal.replaceAll("\n", " ")}`, ""] : []),
    "| Case | Repeat | Contract | Goal completed | Evidence complete | Dispatch attempts |", "| --- | ---: | --- | --- | --- | ---: |",
    ...trials.map(row => {
      const after = row.evidence.after as { axWriteAttempts?: number } | undefined;
      return `| ${row.caseId} | ${row.repetition} | ${row.status} | ${row.grade?.goalCompleted ?? "unknown"} | ${row.grade?.evidenceComplete ?? false} | ${after?.axWriteAttempts ?? "unknown"} |`;
    }), "", `Full evidence: ${output}/report.json`, "",
    "Expected refusal is not task completion. Missing evidence and unrun scheduled trials remain visible. Repetitions and value variants are not independent application samples; no population reliability interval is claimed.", "",
  ].join("\n");
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const planned = schedule(options);
  if (!options.run) {
    console.log(JSON.stringify({ mode: "plan-only", suiteVersion: SUITE_VERSION, trials: planned, modelCalls: 0,
      instruction: "No apps launched. On macOS, reserve desktop access and add --run to execute these disposable native cases. See docs/evaluation-native-contracts.md." }, null, 2));
    return;
  }
  const output = join(root, "output/native-contracts", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(output, { recursive: true, mode: 0o700 });
  const trials: Trial[] = planned.map(item => ({ ...item, status: "not_run", toolCalls: 0,
    evidence: { before: undefined, after: undefined, responses: [], checkpoints: [], runtimeUnchanged: false, errors: [] } }));
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  let fingerprint: Record<string, string> = {}, fatal: string | undefined;
  try {
    assert.equal(process.platform, "darwin", "Live fixture trials require macOS; nothing was dispatched.");
    fingerprint = await hashes();
    await writeFile(join(output, "plan.json"), JSON.stringify({ suiteVersion: SUITE_VERSION, options, cases: CASES, schedule: planned, hashes: fingerprint }, null, 2));
    await preserveRuntime(output, fingerprint);
    const probe = new PlatformDriver(root, false);
    const permissions = await probe.permissions().finally(() => probe.cancel());
    assert.equal(permissions.accessibility, true, "Accessibility unavailable; no permission request or native action attempted.");
    for (const row of trials) {
      if (abort.signal.aborted) { fatal = "Interrupted; remaining scheduled trials were not run."; break; }
      row.status = "running";
      const testCase = CASES.find(item => item.id === row.caseId)!;
      const directory = join(output, `${String(row.index).padStart(2, "0")}-${row.caseId}-r${row.repetition}`);
      await mkdir(directory, { mode: 0o700 });
      let client: Client | undefined, transport: StdioClientTransport | undefined;
      const start = performance.now();
      try {
        assert.deepEqual(await hashes(), fingerprint, "Runtime changed after the scheduled evaluation was frozen.");
        const fixture = spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts/launch-form-fixture.ts"), "--fault", testCase.fault, ...(testCase.prefill ? ["--prefill"] : [])],
          { cwd: root, env: environment, encoding: "utf8", timeout: 90_000, maxBuffer: 1024 * 1024 });
        // Record validated ownership BEFORE any fallible artifact write. A
        // failed launcher may already have started its detached fixture.
        try { row.launch = parseLaunch(fixture.stdout ?? ""); }
        catch { abort.abort(); }
        await writeFile(join(directory, "launch.stdout.txt"), fixture.stdout ?? "");
        await writeFile(join(directory, "launch.stderr.txt"), fixture.stderr ?? "");
        assert.equal(fixture.status, 0, "Fixture launch failed; see retained launcher output.");
        assert.ok(row.launch, "Fixture ownership is uncertain; remaining trials will not run. No unknown process was terminated.");
        row.evidence.before = JSON.parse(await readFile(row.launch.statePath, "utf8"));
        const initial = row.evidence.before as { pid: number; status: string; fields: Record<string, { value: string }>; axWriteAttempts: number; forbiddenSubmitCount: number; resetCount: number };
        assert.equal(initial.pid, row.launch.pid); assert.equal(initial.status, "ready");
        assert.equal(initial.axWriteAttempts, 0); assert.equal(initial.forbiddenSubmitCount, 0); assert.equal(initial.resetCount, 0);
        for (const [label, value] of Object.entries(testCase.initialValues)) assert.equal(initial.fields[label]?.value, value, "Fixture initial state does not match the frozen case.");
        client = new Client({ name: "otto-native-contract-eval", version: SUITE_VERSION });
        transport = new StdioClientTransport({ command: process.execPath,
          args: [join(root, "dist-desktop/desktop/agent-server.js"), "--app", row.launch.appId, "--allow-actions"], cwd: root, env: environment, stderr: "pipe" });
        transport.stderr?.on("data", () => undefined);
        await client.connect(transport, { signal: abort.signal, timeout: 30_000 });
        const manifest = await client.listTools({}, { signal: abort.signal, timeout: 30_000 });
        assert.ok(manifest.tools.some(tool => tool.name === "release_control"), "This evaluation requires coordinated Otto workers.");
        await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
        for (const workflow of testCase.runs) {
          const request = { name: "run_steps", arguments: { appId: row.launch.appId, ...workflow } };
          row.toolCalls++;
          const result = await client.callTool(request, undefined, { signal: abort.signal, timeout: 150_000 });
          assert.ok(Array.isArray(result.content) && result.content.every(item => item.type === "text" && typeof item.text === "string"), "Expected a text-only MCP response.");
          const text = result.content.map(item => item.type === "text" ? item.text : "").join("\n");
          row.evidence.responses.push({ text, isError: result.isError === true });
          await writeFile(join(directory, `exchange-${row.toolCalls}.json`), JSON.stringify({ request, result }, null, 2));
          await delay(100);
          row.evidence.checkpoints!.push(JSON.parse(await readFile(row.launch.statePath, "utf8")));
          // No repetition after a failed or ambiguous request, including the idempotence case.
          if (result.isError || JSON.parse(text).status !== "verified") break;
        }
      } catch (error) { row.evidence.errors.push(errorText(error)); }
      finally {
        // Collect independent final state even when transport or verification failed.
        if (row.launch) {
          await delay(150);
          try { row.evidence.after = JSON.parse(await readFile(row.launch.statePath, "utf8")); }
          catch (error) { row.evidence.errors.push("Final oracle unavailable: " + errorText(error)); }
        }
        try { await client?.close(); await transport?.close(); }
        catch (error) { row.evidence.errors.push("Transport cleanup failed: " + errorText(error)); abort.abort(); }
        if (row.launch) {
          try { row.cleanup = await cleanup(row.launch); }
          catch (error) { row.evidence.errors.push("Fixture cleanup failed: " + errorText(error)); abort.abort(); }
        }
        try { row.evidence.runtimeUnchanged = JSON.stringify(await hashes()) === JSON.stringify(fingerprint); }
        catch (error) { row.evidence.errors.push("Runtime fingerprint unavailable: " + errorText(error)); }
        if (!row.evidence.runtimeUnchanged) abort.abort();
        row.elapsedMs = Math.round(performance.now() - start);
        row.grade = gradeCase(testCase, row.evidence);
        row.status = row.grade.contractPassed ? "passed" : "failed";
        await writeFile(join(directory, "result.json"), JSON.stringify(row, null, 2));
        console.log(JSON.stringify({ case: row.caseId, repetition: row.repetition, status: row.status, grade: row.grade }));
      }
    }
  } catch (error) { fatal = errorText(error); }
  finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
    const totals = summary(trials);
    const status = !fatal && totals.contractPassed === totals.scheduled ? "passed" : "failed";
    const report = { schemaVersion: 1, suiteVersion: SUITE_VERSION, status, fatal, options, summary: totals,
      environment: { platform: process.platform, arch: process.arch, osRelease: release(), node: process.version }, hashes: fingerprint, trials,
      claim: "Scripted native integration contracts on one authored AppKit fixture. No LLM-agent capability, token savings, or production reliability estimate.",
      evidenceLayers: { protocol: "real MCP stdio", driver: "real macOS Accessibility", taskSelection: "scripted", model: "none", split: "public development/regression" } };
    await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
    await writeFile(join(output, "report.md"), markdown(trials, output, fatal));
    console.log(JSON.stringify({ status, summary: totals, output }));
    process.exitCode = status === "passed" ? 0 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
