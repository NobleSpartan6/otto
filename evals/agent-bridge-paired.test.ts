import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PLAN, VALUES, exchangeText, gradeOutcome, measure, median, observation, summarizePaired, workflowReceiptFailures, type PairedTrial } from "./agent-bridge-paired.js";
import { parsePairedArgs, pairedMarkdown, candidateExpected, parseProcessIdentity } from "../tests/native/agent-bridge-paired.js";

function evidence() {
  const initial = { schemaVersion: 1, fixture: "otto-developer-onboarding-v1", status: "ready", pid: 12345, launchId: "owned-launch",
    faultMode: "none", faultTriggered: false, prefill: false, resetCount: 0, forbiddenSubmitCount: 0, rejectedWrites: 0,
    duplicateMutationCount: 0, duplicateNotesValue: null, axWriteAttempts: 0, fieldMutationCount: 0,
    fields: Object.fromEntries(Object.keys(VALUES).map(label => [label, { value: "", valueChangeCount: 0, visible: true, editable: true, rejectAXWrites: false }])),
    events: [{ sequence: 1, elapsedMs: 0, kind: "ready" }] as Array<Record<string, unknown>> };
  const final = structuredClone(initial); final.axWriteAttempts = 6; final.fieldMutationCount = 6;
  for (const [label, value] of Object.entries(VALUES)) {
    final.fields[label]!.value = value; final.fields[label]!.valueChangeCount = 1;
    final.events.push({ sequence: final.events.length + 1, elapsedMs: final.events.length, kind: "ax-write-attempt", field: label, rejected: false });
    final.events.push({ sequence: final.events.length + 1, elapsedMs: final.events.length, kind: "field-change", field: label, before: "", after: value });
  }
  return { initial, final };
}
const receipt = () => ({ status: "verified", actions: 6, completedSteps: 6, modelCalls: 0, elapsedMs: 10,
  checks: Object.keys(VALUES).map(label => ({ kind: "value", label, matched: true })) });
const response = (text: string) => JSON.stringify({ content: [{ type: "text", text }] });
function rows(): PairedTrial[] {
  return PLAN.map(item => {
    const { initial, final } = evidence(), total = item.arm === "baseline" ? 20 : 10;
    const compact = '{"snapshotToken":"fresh"}\n' + Object.entries(VALUES).map(([label, value], index) => JSON.stringify(["c" + index, "AXTextField", label, value, true, true, "accessibility", ["fill"]])).join("\n");
    return { ...item, status: "passed", errors: [], outcomeFailures: [], runtimeUnchanged: true, launch: { pid: 12345 }, before: initial, after: final,
      protocol: "same schema", maintenance: [], taskElapsedMs: total,
      calls: Array.from({ length: item.arm === "baseline" ? 7 : 1 }, (_, index) => ({
        request: JSON.stringify({ name: item.arm === "workflow" ? "run_steps" : index === 0 ? "inspect" : "act" }),
        result: response(item.arm === "workflow" ? JSON.stringify(receipt()) : (index ? '{"outcome":"verified"}\n' : "") + compact),
        elapsedMs: total / (item.arm === "baseline" ? 7 : 1), dispatched: true })) };
  });
}

test("default is plan-only and three fresh pairs have deterministic partial counterbalance", () => {
  assert.equal(parsePairedArgs([]).run, false); assert.equal(parsePairedArgs(["--run"]).run, true);
  for (const args of [["--run", "--run"], ["--retries", "3"], ["--unknown"]]) assert.throws(() => parsePairedArgs(args));
  assert.deepEqual(PLAN.map(row => row.arm), ["baseline", "workflow", "workflow", "baseline", "baseline", "workflow"]);
  for (const pair of [1, 2, 3]) assert.equal(PLAN.filter(row => row.pair === pair).length, 2);
});

test("filled-values experiment is explicit, remains plan-only without run, and labels reports", () => {
  assert.deepEqual(parsePairedArgs([]), { run: false, filledValues: false });
  assert.deepEqual(parsePairedArgs(["--filled-values"]), { run: false, filledValues: true });
  assert.deepEqual(parsePairedArgs(["--run", "--filled-values"]), { run: true, filledValues: true });
  assert.deepEqual(parsePairedArgs(["--filled-values", "--run"]), { run: true, filledValues: true });
  assert.throws(() => parsePairedArgs(["--filled-values", "--filled-values"]));
  assert.deepEqual(candidateExpected(false), { values: VALUES }); assert.equal(candidateExpected(true), "filled_values");
  assert.match(pairedMarkdown(rows(), undefined, true), /expected: "filled_values" shortcut/);
  assert.match(pairedMarkdown(rows()), /explicit expected.values map \(default\)/);
});

test("actual default CLI prints six planned trials without invoking native prerequisites", { timeout: 15000 }, () => {
  const script = fileURLToPath(new URL("../tests/native/agent-bridge-paired.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx", script], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, "plan-only"); assert.equal(plan.schedule.length, 6); assert.match(plan.instruction, /No apps launched/);
});

test("independent native oracle grades full values, exact per-field writes, and no forbidden effects", () => {
  const { initial, final } = evidence(); assert.deepEqual(gradeOutcome(initial, final, 12345), []);
  for (const mutate of [
    (row: typeof final) => { row.pid++; }, (row: typeof final) => { row.launchId = "wrong"; },
    (row: typeof final) => { row.fields.Notes!.value = "incorrect"; }, (row: typeof final) => { row.forbiddenSubmitCount++; },
    (row: typeof final) => { row.resetCount++; }, (row: typeof final) => { row.axWriteAttempts++; },
    (row: typeof final) => { row.events[1]!.field = "Notes"; }, (row: typeof final) => { row.events[1]!.rejected = true; },
    (row: typeof final) => { row.fields.Notes!.visible = false; }, (row: typeof final) => { row.fields.Notes!.valueChangeCount = 2; },
  ]) { const after = structuredClone(final); mutate(after); assert.ok(gradeOutcome(initial, after, 12345).length > 0); }
  assert.ok(gradeOutcome(undefined, final, 12345).length > 0);
});

test("serialized payload includes complete dispatched requests/results and excludes unsent and image responses", () => {
  const calls = [{ request: "first", result: "complete result", dispatched: true }, { request: "unsent", result: "none", dispatched: false },
    { request: "second", error: "local diagnostic", dispatched: true }, { request: "third", result: "data:image/png;base64,xxx", dispatched: true, excludeResponseFromTextMeasurement: true }];
  assert.equal(exchangeText(calls), "first\ncomplete result\nsecond\nthird");
  const size = measure(exchangeText(calls)); assert.equal(size.bytes, Buffer.byteLength(exchangeText(calls))); assert.ok(size.tokens > 0);
});

test("all three paired passes yield medians and deltas while real provider/billing metrics remain unknown", () => {
  const result = summarizePaired(rows()); assert.equal(result.completePairs, 3);
  assert.equal(result.medianPairedDelta?.taskElapsedMs, -10); assert.ok(result.medianPairedDelta!.payloadTokens! < 0);
  assert.equal(result.arms[0]!.attemptedCalls, 21); assert.equal(result.arms[1]!.attemptedCalls, 3);
  assert.equal(result.actualHostInputTokens, null); assert.equal(result.billedCost, null); assert.equal(result.modelCalls, 0);
  assert.equal(median([9, 1, 5]), 5); assert.equal(median([6, 2]), 4); assert.equal(median([]), null);
});

test("failures and missing responses retain incurred usage and suppress selected-success aggregate claims", () => {
  const trials = rows(); trials[0]!.status = "failed"; trials[0]!.calls[0]!.result = undefined;
  trials[1]!.status = "blocked"; trials[1]!.calls = []; trials[1]!.taskElapsedMs = undefined;
  trials[5]!.status = "not_run"; trials[5]!.calls = []; trials[5]!.taskElapsedMs = undefined;
  const result = summarizePaired(trials);
  assert.equal(result.completePairs, 1); assert.equal(result.medianPairedDelta, null);
  assert.ok(result.arms[0]!.recordedFailedPayloadTokens > 0);
  assert.equal(result.arms[0]!.receivedResponses, 20); assert.equal(result.arms[0]!.attemptedCalls, 21);
  assert.equal(result.arms[1]!.blocked, 1); assert.equal(result.arms[1]!.notRun, 1); assert.equal(result.scheduledTrials, 6);
  assert.match(pairedMarkdown(trials), /Missing responses make totals partial/);
});

test("compact parsing preserves source and current refs; images and tool errors fail closed", () => {
  const result = { content: [{ type: "text", text: 'Otto inspect\n{"snapshotToken":"fresh"}\n["c1","AXTextField","Name","",true,true,"accessibility",["fill"]]' }] };
  assert.equal(observation(result).snapshotToken, "fresh"); assert.equal(observation(result).controls[0]![6], "accessibility");
  assert.throws(() => observation({ content: [{ type: "image", data: "fake" }] }));
  assert.throws(() => observation({ content: [{ type: "text", text: '{"code":"desktop_busy"}' }], isError: true }), /desktop_busy/);
});


test("oracle events require initial ready and complete ordered well-formed evidence", () => {
  const { initial, final } = evidence();
  for (const events of [undefined, null, [], [null], [{ kind: "ready", sequence: 1 }]]) {
    assert.ok(gradeOutcome({ ...initial, events }, final, 12345).length);
    assert.ok(gradeOutcome(initial, { ...final, events }, 12345).length);
  }
  for (const mutate of [
    (events: typeof final.events) => { events[0]!.kind = "ax-write-attempt"; },
    (events: typeof final.events) => { events[2]!.sequence = 2; },
    (events: typeof final.events) => { events[2]!.sequence = 4; },
    (events: typeof final.events) => { events[2]!.elapsedMs = -1; },
    (events: typeof final.events) => { events[2]!.elapsedMs = Number.NaN; },
    (events: typeof final.events) => { events[3]!.elapsedMs = 0; },
    (events: typeof final.events) => { events[2]!.after = "wrong"; },
    (events: typeof final.events) => { events[2]!.kind = "reset"; },
  ]) { const after = structuredClone(final); mutate(after.events); assert.ok(gradeOutcome(initial, after, 12345).length); }
  assert.ok(gradeOutcome(initial, final, -1).length);
});

test("forged passed labels cannot qualify incomplete or contradictory paired evidence", () => {
  const mutations: Array<(row: PairedTrial) => void> = [
    row => { row.calls.pop(); }, row => { row.calls.push(structuredClone(row.calls[0]!)); },
    row => { row.calls[0]!.result = undefined; }, row => { row.calls[0]!.dispatched = false; },
    row => { row.calls[0]!.error = "transport failed"; }, row => { row.calls[0]!.result = response("{}"); },
    row => { row.calls[0]!.excludeResponseFromTextMeasurement = true; },
    row => { row.calls[0]!.elapsedMs = undefined; }, row => { row.taskElapsedMs = Number.NaN; },
    row => { row.taskElapsedMs = Infinity; }, row => { row.taskElapsedMs = -1; }, row => { row.taskElapsedMs = 1; },
    row => { row.errors.push("failure"); }, row => { row.outcomeFailures = undefined; }, row => { row.outcomeFailures!.push("bad oracle"); },
    row => { row.runtimeUnchanged = undefined; }, row => { row.runtimeUnchanged = false; },
    row => { row.launch = undefined; }, row => { row.launch!.pid++; },
    row => { row.before = undefined; }, row => { row.after = undefined; },
    row => { (row.after as ReturnType<typeof evidence>["final"]).fields.Notes!.value = "forged"; },
    row => { (row.after as ReturnType<typeof evidence>["final"]).pid++; },
    row => { row.protocol = undefined; }, row => { row.protocol = "different schema"; },
  ];
  for (const mutate of mutations) {
    const trials = rows(); mutate(trials[0]!); const summary = summarizePaired(trials);
    assert.equal(summary.pairs[0]!.complete, false); assert.equal(summary.medianPairedDelta, null);
  }
  const duplicates = rows(); duplicates.push(structuredClone(duplicates[0]!));
  assert.equal(summarizePaired(duplicates).pairs[0]!.complete, false);
});

test("workflow success cannot include uncertainty, failure diagnostics, or malformed checks", () => {
  assert.deepEqual(workflowReceiptFailures(receipt()), []);
  for (const changes of [{ uncertainAction: true }, { uncertainAction: "false" }, { reason: "failed" }, { validationCode: "invalid" },
    { error: "failed" }, { errors: [] }, { isError: true }, { checks: [] }, { modelCalls: 1 }, { elapsedMs: null }, { status: "stopped" }]) {
    const forged = { ...receipt(), ...changes }; assert.ok(workflowReceiptFailures(forged).length);
    const trials = rows(); trials[1]!.calls[0]!.result = response(JSON.stringify(forged));
    assert.equal(summarizePaired(trials).pairs[0]!.complete, false);
  }
  const trials = rows(); trials[1]!.calls[0]!.result = JSON.stringify({ content: [{ type: "text", text: JSON.stringify(receipt()) }], isError: true });
  assert.equal(summarizePaired(trials).pairs[0]!.complete, false);
});


test("cleanup identity recognizes exited zombies without weakening live executable/start-time checks", () => {
  const executable = "/tmp/otto-form-eval-owned/OttoFormFixture.app/Contents/MacOS/OttoFormFixture";
  const started = "Sun Sep 20 00:44:41 2026";
  const living = parseProcessIdentity(`S   ${started}     ${executable}\n`, executable);
  assert.equal(living, `${started} ${executable}`);
  assert.equal(parseProcessIdentity(`R+  ${started}     ${executable}`, executable), living);
  assert.notEqual(parseProcessIdentity(`S   Sun Sep 20 00:44:42 2026     ${executable}`, executable), living);
  for (const state of ["Z", "Z+"]) assert.equal(parseProcessIdentity(`${state}   ${started}     <defunct>`, executable), "");
  assert.equal(parseProcessIdentity("", executable), "");
  assert.equal(parseProcessIdentity("  \n", executable), "");
  for (const invalid of [`S   ${started} /tmp/unrelated`, `S   ${started} ${executable}-other`, `S   <defunct>`,
    `S   ${executable}`, `S   invalid-date ${executable}`, `S   ${started} ${executable}\nS   ${started} ${executable}`]) {
    assert.throws(() => parseProcessIdentity(invalid, executable));
  }
});
