import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { PlatformDriver } from "../../desktop/native-driver.js";
import { AgentLease } from "../../desktop/agent-lease.js";
import { waitForFixtureReady } from "../../evals/fixture-readiness.js";
import { writeProgress } from "../../evals/progress.js";
import { gradeOutcome, observation, resultText, workflowReceiptFailures } from "../../evals/agent-bridge-paired.js";
import { PILOT_CASES, PLAN, parsePilotArgs, summarizePilot } from "../../evals/astra-low-pilot.js";

// Manual, paid host-usage comparison. Never starts from npm test or on import.
// --pilot schedules six fresh runs; legacy --run keeps the original two-run mode.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MODEL = "gpt-6-astra";
const REASONING = "low";
const DEADLINE_MS = 180_000;
const tools = ["list_apps", "inspect", "act", "run_steps", "release_control"];
const featureWarning = "Under-development features enabled: skip_host_skill_discovery. Under-development features are incomplete and may behave unpredictably. To suppress this warning, set `suppress_unstable_features_warning = true` in " + join(process.env.CODEX_HOME ?? join(process.env.HOME ?? "", ".codex"), "config.toml") + ".";
type Arm = "inspect-and-act" | "run-steps";
type Launch = { appPath: string; executable: string; statePath: string; pid: number; appId: string; literalFields: Record<string, string> };
type Oracle = {
  launchId: string; pid: number; status: string; resetCount: number; faultMode: string; faultTriggered: boolean;
  fieldMutationCount: number; axWriteAttempts: number; rejectedWrites: number; forbiddenSubmitCount: number;
  duplicateMutationCount: number; events: Array<{ sequence: number; kind: string; field?: string }>;
  fields: Record<string, { value: string; visible: boolean; editable: boolean; valueChangeCount: number }>;
};
type Json = Record<string, unknown>;
type ProcessIdentity = { pid: number; ppid: number; state: string; started: string; command: string };
type Usage = { input_tokens: number | null; cached_input_tokens: number | null; output_tokens: number | null; reasoning_output_tokens: number | null };
type ToolCall = { id: string; server: string; tool: string; arguments: unknown; status: unknown; result: unknown; error: unknown };
export type Evidence = {
  caseId: string; arm: Arm; status: "not_run" | "running" | "passed" | "failed" | "blocked"; errors: string[]; launch?: Launch; before?: Oracle; after?: Oracle;
  expectedMode?: "filled_values"; grading?: { passed: boolean; failures: string[] }; phase?: string; readiness?: unknown;
  fixtureSHA256?: string; fixtureProcess?: ProcessIdentity; runtimeUnchanged?: boolean; cleanup?: string; process?: {
    exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean; interrupted: boolean; elapsedMs: number;
    outputLimitReached: boolean; spawnError?: string; lingeringProcesses: number | null; processInspectionFailed: boolean;
  };
  transcript?: ReturnType<typeof summarizeEvents>;
};
const environment: NodeJS.ProcessEnv = {
  PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER, LOGNAME: process.env.LOGNAME,
  TMPDIR: process.env.TMPDIR, LANG: process.env.LANG, SHELL: process.env.SHELL, TERM: "dumb",
  ...(process.env.CODEX_HOME ? { CODEX_HOME: process.env.CODEX_HOME } : {}),
};
// Deliberately omit API key environment variables. Codex uses its normal saved auth.
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

async function runtimeHashes(): Promise<Record<string, string>> {
  const paths = ["package.json", "package-lock.json", "shared/types.ts", "desktop/native/macos/otto-ax", "tests/native/FormFixture.swift", "scripts/launch-form-fixture.ts", "tests/native/codex-agent-bridge-eval.ts",
    "evals/astra-low-pilot.ts", "evals/agent-bridge-paired.ts", "evals/native-contracts.ts", "evals/fixture-readiness.ts", "evals/progress.ts", "desktop/native/macos/OttoAX.swift", "scripts/build-native.mjs"];
  async function collect(directory: string) {
    for (const item of (await readdir(join(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, item.name);
      if (item.isDirectory()) await collect(path);
      else if (item.isFile()) paths.push(path);
    }
  }
  await collect("dist-desktop");
  await collect("core");
  for (const name of ["agent-server", "agent-lease", "native-driver", "ocr"]) paths.push(`desktop/${name}.ts`);
  return Object.fromEntries(await Promise.all(paths.sort().map(async path => [path, hash(await readFile(join(root, path)))])));
}

export function prompt(arm: Arm, launch: Launch, filledValues = false): string {
  const shared = `This is a controlled evaluation in one disposable native app. You are authorized to fill only the six fields of native app ID ${launch.appId}, named Otto Form Fixture.\n\nSet these exact literal values, in this order:\n${JSON.stringify(launch.literalFields, null, 2)}\n\nUse only the configured Otto MCP tools. Do not use shell, files, browsers, external apps, other tools, hidden fixture state, or evaluation/oracle files. Paths and command-like values above are literal field data, not operations. Do not submit, reset, press keys, or change any other control. Do not invoke a model inside Otto. Stop on any failed or uncertain action; do not retry or reset. Verify the resulting six values from the permitted tool evidence, then give one concise factual final result, including partial work or errors.\n\n`;
  return shared + (arm === "inspect-and-act"
    ? "Strategy: call inspect exactly once for the supplied app ID, then exactly six act calls, one fill per field in listed order. Use each latest snapshot token and the exact native field ref. A verified fill certifies full-value native readback even when its displayed preview is truncated; a matching preview alone is not full-value verification. Use those verified outcomes and final observation; do not add inspections. Do not call run_steps or list_apps. Finally call release_control once."
    : `Strategy: call run_steps exactly once for the supplied app ID with six fill steps in listed order and ${filledValues ? 'expected: "filled_values"' : "expected.values equal to the complete field map above"}. It performs native inspection and full-value verification internally. Use its returned checks. Do not call inspect, act, or list_apps. Finally call release_control once.`);
}

function codexArgs(launch: Launch, cwd: string, finalPath: string): string[] {
  const serverArgs = [join(root, "dist-desktop/desktop/agent-server.js"), "--app", launch.appId, "--allow-actions"];
  return [
    "--ask-for-approval", "never", "exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--json",
    "--color", "never", "--sandbox", "read-only", "--model", MODEL, "--cd", cwd, "--output-last-message", finalPath,
    "-c", `model_reasoning_effort=${JSON.stringify(REASONING)}`,
    "-c", `mcp_servers.otto.command=${JSON.stringify(process.execPath)}`,
    "-c", `mcp_servers.otto.args=${JSON.stringify(serverArgs)}`,
    "-c", `mcp_servers.otto.enabled_tools=${JSON.stringify(tools)}`,
    "-c", "mcp_servers.otto.required=true",
    "-c", "mcp_servers.otto.startup_timeout_sec=30",
    "-c", "mcp_servers.otto.tool_timeout_sec=150",
    "-c", "mcp_servers.otto.env_vars=[]",
    // Explicit authorization covers only this new fixture's six literal fills.
    // These overrides live in this invocation, never project/global settings.
    "-c", 'mcp_servers.otto.tools.act.approval_mode="approve"',
    "-c", 'mcp_servers.otto.tools.run_steps.approval_mode="approve"',
    // These names were verified with the installed `codex features list`.
    ...["shell_tool", "unified_exec", "apps", "plugins", "browser_use", "browser_use_external", "in_app_browser", "computer_use", "multi_agent", "image_generation", "view_image", "hooks"].flatMap(name => ["--disable", name]),
    "-c", "features.skip_host_skill_discovery=true",
    "-",
  ];
}

function processes(strict = false): ProcessIdentity[] {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,stat=,lstart=,comm="], { encoding: "utf8", timeout: 3000 });
  if (result.status !== 0) { if (strict) throw new Error("Could not verify owned process identities."); return []; }
  return result.stdout.split("\n").flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), state: match[3]!, started: match[4]!.replace(/\s+/g, " "), command: match[5]! }] : [];
  });
}
const sameProcess = (a: ProcessIdentity, b: ProcessIdentity) => a.pid === b.pid && a.started === b.started && a.command === b.command;

async function runCodex(codex: string, args: string[], input: string, directory: string, cwd: string, signal: AbortSignal): Promise<NonNullable<Evidence["process"]>> {
  const stdout = createWriteStream(join(directory, "events.jsonl"), { mode: 0o600 });
  const stderr = createWriteStream(join(directory, "stderr.txt"), { mode: 0o600 });
  const started = performance.now();
  let child: ChildProcess | undefined;
  let bytes = 0, timedOut = false, outputLimitReached = false, spawnError: string | undefined;
  let closed = false;
  let processInspectionFailed = false;
  const owned = new Map<number, ProcessIdentity>();
  const remember = () => {
    if (!child?.pid) return;
    let snapshot: ProcessIdentity[];
    try { snapshot = processes(true); }
    catch { processInspectionFailed = true; return; }
    const parentIds = new Set([child.pid, ...[...owned.values()].filter(item => snapshot.some(now => sameProcess(now, item))).map(item => item.pid)]);
    let added = true;
    while (added) {
      added = false;
      for (const item of snapshot) if (parentIds.has(item.ppid) && !parentIds.has(item.pid)) {
        parentIds.add(item.pid); owned.set(item.pid, item); added = true;
      }
    }
  };
  const terminate = () => { remember(); if (child && !closed) child.kill("SIGTERM"); };
  const hardStop = () => { if (child && !closed) child.kill("SIGKILL"); };
  let escalation: NodeJS.Timeout | undefined;
  const stop = () => { terminate(); escalation ??= setTimeout(hardStop, 5000); };
  const deadline = setTimeout(() => { timedOut = true; stop(); }, DEADLINE_MS);
  const sampler = setInterval(remember, 500);
  signal.addEventListener("abort", stop, { once: true });
  let result: { code: number | null; signal: NodeJS.Signals | null } = { code: null, signal: null };
  try {
    if (signal.aborted) throw new Error("Evaluation interrupted before launch.");
    child = spawn(codex, args, { cwd, env: environment, stdio: ["pipe", "pipe", "pipe"] });
    for (const [source, destination] of [[child.stdout!, stdout], [child.stderr!, stderr]] as const) {
      source.on("data", chunk => {
        bytes += chunk.length;
        if (bytes <= 32 * 1024 * 1024) destination.write(chunk);
        else if (!outputLimitReached) { outputLimitReached = true; stop(); }
      });
    }
    child.stdin!.on("error", () => undefined);
    child.stdin!.end(input);
    result = await new Promise(resolve => {
      child!.once("error", error => { spawnError = error.message; });
      child!.once("close", (code, signal) => { closed = true; resolve({ code, signal }); });
    });
  } catch (error) { spawnError = error instanceof Error ? error.message : String(error); stop(); }
  finally {
    clearTimeout(deadline); clearInterval(sampler); if (escalation) clearTimeout(escalation);
    signal.removeEventListener("abort", stop);
    // MCP stdin closes with Codex; its server cancels the helper. Clean only an
    // already observed descendant if graceful shutdown left it behind.
    await delay(500);
    let snapshot: ProcessIdentity[] = [];
    try { snapshot = processes(true); } catch { processInspectionFailed = true; }
    for (const item of owned.values()) if (snapshot.some(now => sameProcess(now, item))) {
      try { process.kill(item.pid, "SIGTERM"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") processInspectionFailed = true; }
    }
    await delay(500);
    await Promise.all([new Promise<void>(resolve => stdout.end(resolve)), new Promise<void>(resolve => stderr.end(resolve))]);
  }
  let remaining: ProcessIdentity[] | undefined;
  try { remaining = processes(true).filter(now => [...owned.values()].some(item => sameProcess(now, item))); }
  catch { processInspectionFailed = true; }
  return { exitCode: result.code, signal: result.signal, timedOut, interrupted: signal.aborted, elapsedMs: Math.round(performance.now() - started),
    outputLimitReached, ...(spawnError ? { spawnError } : {}), lingeringProcesses: remaining?.length ?? null, processInspectionFailed };
}

export function summarizeEvents(raw: string) {
  const events: Json[] = []; let malformedLines = 0;
  for (const line of raw.split("\n").filter(Boolean)) {
    try { const value: unknown = JSON.parse(line); if (record(value)) events.push(value); else malformedLines++; }
    catch { malformedLines++; }
  }
  const calls = new Map<string, ToolCall>();
  const unexpectedItems = new Set<string>();
  const usages: Usage[] = [];
  const warnings: string[] = [];
  const terminal = new Map<string, unknown>();
  let failedTurns = 0, errors = 0;
  for (const event of events) {
    if (event.type === "turn.failed") failedTurns++;
    if (event.type === "error") errors++;
    if (event.type === "turn.completed") {
      const usage = record(event.usage) ? event.usage : {};
      usages.push({ input_tokens: count(usage.input_tokens), cached_input_tokens: count(usage.cached_input_tokens),
        output_tokens: count(usage.output_tokens), reasoning_output_tokens: count(usage.reasoning_output_tokens) });
    }
    const item = record(event.item) ? event.item : undefined;
    if (!item || !String(event.type).startsWith("item.")) continue;
    const type = String(item.type);
    if (type === "mcp_tool_call" || type === "mcpToolCall") {
      if (typeof item.id !== "string") { unexpectedItems.add("MCP call without stable ID"); continue; }
      const old = calls.get(item.id);
      const decode = (value: unknown) => { try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return value; } };
      if (old && ["server", "tool", "arguments"].some(key => {
        const previous = old[key as "server" | "tool" | "arguments"], next = item[key];
        return previous !== undefined && previous !== "" && next !== undefined && !isDeepStrictEqual(decode(previous), decode(next));
      })) unexpectedItems.add("Conflicting MCP call identity or arguments");
      if (event.type === "item.completed") {
        if (terminal.has(item.id) && !isDeepStrictEqual(terminal.get(item.id), item)) unexpectedItems.add("Conflicting terminal MCP event");
        terminal.set(item.id, item);
      }
      calls.set(item.id, { id: item.id, server: String(item.server ?? old?.server ?? ""), tool: String(item.tool ?? old?.tool ?? ""),
        arguments: item.arguments ?? old?.arguments, status: item.status ?? old?.status,
        result: item.result ?? old?.result, error: item.error ?? old?.error });
    } else if (type === "error") {
      // Codex serializes this startup notice as an error item, not a tool call.
      // Retain and narrowly classify the observed feature notice; other errors fail.
      if (event.type === "item.completed" && item.message === featureWarning) warnings.push(item.message);
      else errors++;
    } else if (!["agent_message", "agentMessage", "reasoning", "plan", "todo_list", "context_compaction", "contextCompaction"].includes(type)) unexpectedItems.add(type);
  }
  const totals = (field: keyof Usage) => usages.length && usages.every(row => row[field] !== null) ? usages.reduce((sum, row) => sum + row[field]!, 0) : null;
  return { eventCount: events.length, malformedLines, failedTurns, errors, warnings, turnUsage: usages,
    reportedUsage: { inputTokens: totals("input_tokens"), cachedInputTokens: totals("cached_input_tokens"), outputTokens: totals("output_tokens"), reasoningOutputTokens: totals("reasoning_output_tokens") },
    usageCompleteForCompletedTurns: usages.length > 0 && usages.every(row => row.input_tokens !== null && row.output_tokens !== null),
    toolCalls: [...calls.values()], unexpectedItems: [...unexpectedItems] };
}

async function oracle(launch: Launch): Promise<Oracle> {
  const state = JSON.parse(await readFile(launch.statePath, "utf8")) as Oracle;
  assert.equal(state.pid, launch.pid); assert.equal(state.status, "ready");
  return state;
}

async function cleanup(launch: Launch, original: ProcessIdentity | undefined, retain = false) {
  const current = processes(true).find(item => item.pid === launch.pid);
  if (current) {
    assert.ok(original, "Original fixture process identity was not captured; do not signal it.");
    assert.equal(original.command, launch.executable);
    assert.equal(current.started, original.started, "Never terminate a reused PID.");
    if (!current.state.startsWith("Z")) {
      assert.equal(current.command, launch.executable, "Never terminate an unrelated executable.");
      try { process.kill(launch.pid, "SIGTERM"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
    for (let i = 0; i < 50; i++) {
      if (!processExists(launch.pid)) break;
      await delay(100);
    }
    assert.ok(!processExists(launch.pid), "Fixture PID still exists; retain temporary evidence and stop.");
  }
  if (!retain) await rm(dirname(launch.appPath), { recursive: true, force: true });
  return `Exact fixture PID and start identity verified; process exited; private temporary directory ${retain ? "retained for evidence recovery" : "removed"}.`;
}

export function grade(row: Evidence, launch: Launch) {
  const { before, after, transcript: trace, process: run } = row;
  assert.ok(before && after && trace && run);
  assert.deepEqual(gradeOutcome(before, after, launch.pid, launch.literalFields), [], "Independent native oracle must pass.");
  for (const call of trace.toolCalls) assert.ok(!call.error, `Otto ${call.tool} failed: ${JSON.stringify(call.error)}`);
  assert.equal(after.launchId, before.launchId); assert.equal(after.resetCount, 0);
  assert.equal(after.forbiddenSubmitCount, 0); assert.equal(after.faultTriggered, false);
  assert.equal(after.rejectedWrites, 0); assert.equal(after.duplicateMutationCount, 0);
  assert.equal(after.fieldMutationCount, 6); assert.equal(after.axWriteAttempts, 6);
  for (const [label, value] of Object.entries(launch.literalFields)) {
    assert.equal(after.fields[label]?.value, value, label); assert.equal(after.fields[label]?.valueChangeCount, 1, label);
    assert.equal(after.fields[label]?.visible, true); assert.equal(after.fields[label]?.editable, true);
  }
  assert.equal(run.exitCode, 0); assert.equal(run.timedOut, false); assert.equal(run.outputLimitReached, false);
  assert.equal(run.interrupted, false); assert.equal(run.lingeringProcesses, 0);
  assert.equal(run.processInspectionFailed, false);
  assert.equal(trace.malformedLines, 0); assert.equal(trace.failedTurns, 0); assert.equal(trace.errors, 0);
  assert.deepEqual(trace.unexpectedItems, [], "A non-Otto tool or unknown tool item invalidates the comparison.");
  assert.ok(trace.usageCompleteForCompletedTurns, "Usage must be observed, not estimated from text.");
  assert.equal(trace.turnUsage.length, 1, "Each arm is one fresh controlled Codex turn.");
  const callCounts: Record<string, number> = {};
  let frame: ReturnType<typeof observation> | undefined, fillIndex = 0;
  const fields = Object.entries(launch.literalFields);
  for (const call of trace.toolCalls) {
    assert.equal(call.server, "otto"); assert.ok(tools.includes(call.tool));
    assert.ok(call.status === "completed" || call.status === "success", "Every tool call must complete.");
    assert.ok(!call.error);
    const args: unknown = typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments;
    assert.ok(record(args), "Tool arguments must be retained for scope and strategy auditing.");
    const result = typeof call.result === "string" ? JSON.parse(call.result) : call.result;
    const responseText = resultText(result); // Reject MCP isError and unsupported/missing evidence.
    if (call.tool === "inspect" || call.tool === "run_steps") assert.equal(args.appId, launch.appId);
    if (call.tool === "inspect") { assert.equal(frame, undefined); frame = observation(result); }
    if (call.tool === "act") {
      assert.ok(frame && fillIndex < fields.length);
      const [label, value] = fields[fillIndex++]!;
      const matches = frame.controls.filter(control => control[2] === label && control[4] === true && control[5] === true && control[6] === "accessibility" && Array.isArray(control[7]) && control[7].includes("fill"));
      assert.equal(matches.length, 1, "Each fill must bind one exact current native field.");
      assert.deepEqual(args, { operation: "fill", snapshotToken: frame.snapshotToken, ref: matches[0]![0], value });
      assert.equal(JSON.parse(responseText.split("\n")[0]!).outcome, "verified", "Full native readback must verify the fill.");
      frame = observation(result);
    }
    else if (call.tool === "run_steps") {
      assert.deepEqual(args.steps, Object.entries(launch.literalFields).map(([label, value]) => ({ operation: "fill", label, value })));
      assert.deepEqual(args.expected, row.expectedMode ?? { values: launch.literalFields });
      assert.deepEqual(workflowReceiptFailures(JSON.parse(responseText)), [], "Receipt must verify all six values without uncertainty.");
    }
    if (call.tool === "release_control") { assert.deepEqual(args, {}); assert.deepEqual(JSON.parse(responseText), { released: true, referencesInvalidated: true }); }
    callCounts[call.tool] = (callCounts[call.tool] ?? 0) + 1;
  }
  assert.deepEqual(callCounts, row.arm === "inspect-and-act" ? { inspect: 1, act: 6, release_control: 1 } : { run_steps: 1, release_control: 1 });
  assert.equal(trace.toolCalls.at(-1)?.tool, "release_control");
  assert.equal(row.runtimeUnchanged, true);
}

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}

export async function main(args = process.argv.slice(2)) {
  const pilot = args.includes("--pilot");
  assert.ok(args.filter(arg => arg === "--pilot").length <= 1, "Repeated pilot flag.");
  const options = parsePilotArgs(args.filter(arg => arg !== "--pilot"));
  const schedule = pilot ? PLAN : PLAN.slice(0, 2);
  if (!options.run) { console.log(JSON.stringify({ mode: "plan-only", model: MODEL, reasoning: REASONING, pilot, schedule,
    instruction: `No apps or models started. --run explicitly executes ${schedule.length} normal-account Codex trials through Otto on fresh owned fixtures.` }, null, 2)); return; }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = join(root, pilot ? "output/astra-low-pilot" : "output/codex-agent-bridge", stamp);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const rows: Evidence[] = schedule.map(item => ({ ...item, status: "not_run", errors: [], ...(pilot ? { expectedMode: "filled_values" as const } : {}) }));
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  let hashes: Record<string, string> = {}, fatal: string | undefined;
  let codexVersion = "unavailable";
  const report = (status: string) => ({ status, fatal, startedAt: stamp, requestedModel: MODEL, reasoning: REASONING, codexVersion, hashes, output, schedule,
    cases: rows, ...(pilot ? { summary: summarizePilot(rows) } : {}),
    scope: "Fresh owned AppKit fixture per trial; same model, tool manifest, invocation-only approvals, native scope and literals within each pair. Baseline uses inspect plus six acts; workflow uses one run_steps. Both release control once. Actual completed-turn usage is retained; no Jev calls or billing claim.",
    limitations: [pilot ? "Three authored variants of one AppKit template, one pair each, fixed AB/BA/AB order; not a hidden holdout or a population reliability result." : "One authored task, one pair, baseline first.",
      "Host elapsed includes CLI/MCP/native execution and bounded child cleanup, but excludes fixture compilation, readiness, journaling, oracle grading and fixture cleanup.",
      "Provider caching/order effects are not controlled. Cached usage is separate; missing/invalid accounting remains unknown.",
      "Requested model/effort are recorded; provider routing and unreported retries are not fully observable.",
      "All failures and unrun scheduled trials remain visible. No global configuration or installed Otto permissions changed."] });
  const save = () => writeProgress(join(output, "progress.json"), report("running"));
  try {
    await save();
    assert.equal(process.platform, "darwin", "The owned native form fixture requires macOS.");
    const located = spawnSync("which", ["codex"], { encoding: "utf8", env: environment });
    assert.equal(located.status, 0, "Codex CLI must already be installed and authenticated.");
    const codex = located.stdout.trim();
    codexVersion = spawnSync(codex, ["--version"], { encoding: "utf8", env: environment }).stdout.trim();
    await readFile(join(root, "dist-desktop/desktop/agent-server.js"));
    hashes = await runtimeHashes();
    await writeProgress(join(output, "plan.json"), { model: MODEL, reasoning: REASONING, pilot, schedule, cases: PILOT_CASES, hashes });
    for (const [path, expected] of Object.entries(hashes)) {
      const bytes = await readFile(join(root, path)); assert.equal(hash(bytes), expected);
      const destination = join(output, "runtime", path); await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, bytes, { mode: 0o600 });
    }
    for (const [index, row] of rows.entries()) {
      if (abort.signal.aborted) { fatal = "Interrupted or cleanup failed; remaining scheduled trials not run."; break; }
      const arm = row.arm; row.status = "running"; row.phase = "setup"; await save();
      const directory = join(output, `${index + 1}-${row.caseId}-${arm}`); await mkdir(directory, { mode: 0o700 });
      let launch: Launch | undefined, cwd: string | undefined;
      try {
        if (abort.signal.aborted) throw new Error("Evaluation interrupted; no further Codex run launched.");
        assert.deepEqual(await runtimeHashes(), hashes, "Runtime changed between arms. Rebuild and start a new comparison.");
        const fixture = spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts/launch-form-fixture.ts")],
          { cwd: root, env: environment, encoding: "utf8", timeout: 90_000 });
        await writeFile(join(directory, "fixture-launch.stdout.txt"), fixture.stdout ?? "", { mode: 0o600 });
        await writeFile(join(directory, "fixture-launch.stderr.txt"), fixture.stderr ?? "", { mode: 0o600 });
        assert.equal(fixture.status, 0, "Owned fixture launch failed; see retained launcher output.");
        launch = JSON.parse(fixture.stdout) as Launch; row.launch = launch;
        assert.ok(Number.isSafeInteger(launch.pid) && launch.pid > 1 && launch.pid !== process.pid);
        assert.equal(launch.appId, String(launch.pid));
        assert.equal(launch.appPath, resolve(launch.appPath));
        assert.ok(dirname(launch.appPath).startsWith(join(tmpdir(), "otto-form-eval-")));
        assert.equal(launch.appPath, join(dirname(launch.appPath), "OttoFormFixture.app"));
        assert.equal(launch.executable, join(launch.appPath, "Contents/MacOS/OttoFormFixture"));
        assert.equal(launch.statePath, join(dirname(launch.appPath), "state.json"));
        row.fixtureProcess = processes(true).find(item => item.pid === launch!.pid);
        assert.equal(row.fixtureProcess?.command, launch.executable);
        row.fixtureSHA256 = hash(await readFile(launch.executable));
        row.before = await oracle(launch);
        assert.equal(row.before.resetCount, 0); assert.equal(row.before.fieldMutationCount, 0); assert.equal(row.before.axWriteAttempts, 0);
        assert.equal(row.before.forbiddenSubmitCount, 0); assert.equal(row.before.faultMode, "none");
        assert.equal(Object.keys(launch.literalFields).length, 6);
        for (const label of Object.keys(launch.literalFields)) assert.equal(row.before.fields[label]?.value, "");
        launch.literalFields = structuredClone(PILOT_CASES.find(item => item.caseId === row.caseId)!.contract.runs[0]!.expected.values!);
        row.phase = "launched"; await save();
        const native = new PlatformDriver(root, false), lease = new AgentLease();
        try {
          lease.acquire(); const inventory = await native.apps(); assert.ok(inventory.permissions.accessibility, "Native Accessibility is unavailable.");
          await native.configure([launch.appId]);
          row.readiness = await waitForFixtureReady(native, launch.appId, Object.fromEntries(Object.keys(launch.literalFields).map(label => [label, ""])), { signal: abort.signal });
          assert.deepEqual(await oracle(launch), row.before, "Readiness cannot mutate fixture state.");
        } finally { native.cancel(); lease.release(); }
        cwd = await mkdtemp(join(tmpdir(), "otto-codex-eval-"));
        const input = prompt(arm, launch, row.expectedMode === "filled_values");
        const args = codexArgs(launch, cwd, join(directory, "final.txt"));
        await writeFile(join(directory, "prompt.txt"), input, { mode: 0o600 });
        await writeFile(join(directory, "invocation.json"), JSON.stringify({ executable: codex, args, cwd, environmentNames: Object.keys(environment), model: MODEL, reasoning: REASONING }, null, 2), { mode: 0o600 });
        row.phase = "host_running"; await save();
        row.process = await runCodex(codex, args, input, directory, cwd, abort.signal);
        row.transcript = summarizeEvents(await readFile(join(directory, "events.jsonl"), "utf8"));
        await delay(200); row.after = await oracle(launch);
        row.runtimeUnchanged = JSON.stringify(await runtimeHashes()) === JSON.stringify(hashes);
        grade(row, launch); row.status = "passed"; row.grading = { passed: true, failures: [] };
      } catch (error) {
        row.errors.push(error instanceof Error ? error.message : String(error));
        row.status = "failed"; row.grading = { passed: false, failures: [...row.errors] };
        if (launch && !row.after) row.after = await oracle(launch).catch(() => undefined);
        if (row.process && ((!row.transcript?.toolCalls.length && !row.transcript?.turnUsage.length) ||
            row.transcript?.toolCalls.some(call => record(call.error) && typeof call.error.message === "string" && call.error.message.includes("requires approval")))) row.status = "blocked";
        if (error instanceof Error && /Another Otto (?:MCP )?client owns desktop control|Native Accessibility is unavailable/.test(error.message)) row.status = "blocked";
      } finally {
        row.phase = "cleanup_pending";
        let saved = false;
        try { await save(); saved = row.after !== undefined; } catch (error) { row.errors.push(String(error)); abort.abort(); }
        if (launch) try { row.cleanup = await cleanup(launch, row.fixtureProcess, !saved); }
        catch (error) { row.errors.push(String(error)); row.status = "failed"; abort.abort(); }
        if (cwd) await rm(cwd, { recursive: true, force: true });
        if (row.errors.length) {
          row.grading = { passed: false, failures: [...row.errors] };
          if (row.status === "passed") row.status = "failed";
        }
        row.phase = "complete"; await writeProgress(join(directory, "result.json"), row); await save();
        console.log(JSON.stringify({ caseId: row.caseId, arm, status: row.status, errors: row.errors, usage: row.transcript?.reportedUsage, output: directory }));
      }
    }
  } catch (error) { fatal = error instanceof Error ? error.message : String(error); }
  finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
    const status = fatal || rows.some(row => row.status === "failed") ? "failed" : rows.some(row => row.status !== "passed") ? "blocked" : "passed";
    await writeProgress(join(output, "report.json"), report(status)); await writeProgress(join(output, "progress.json"), report(status));
    console.log(JSON.stringify({ status, output, fatal }));
    process.exitCode = status === "passed" ? 0 : status === "blocked" ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
