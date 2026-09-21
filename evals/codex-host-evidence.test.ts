import assert from "node:assert/strict";
import test from "node:test";
import { grade, prompt, summarizeEvents, type Evidence } from "../tests/native/codex-agent-bridge-eval.js";
import { PILOT_CASES, PLAN, summarizePilot } from "./astra-low-pilot.js";

const response = (text: string) => ({ content: [{ type: "text", text }] });
const usage = { type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 20 } };
function fixture(arm: Evidence["arm"] = "inspect-and-act", filledValues = false, long = false) {
  const contract = PILOT_CASES[long ? 2 : 0]!.contract;
  const values = { ...contract.expectedFinalValues };
  const launch = { pid: 12345, appId: "12345", appPath: "/owned/Fixture.app", executable: "/owned/Fixture", statePath: "/owned/state.json", literalFields: values };
  const before = { schemaVersion: 1, fixture: "otto-developer-onboarding-v1", status: "ready", pid: launch.pid, launchId: "owned-launch",
    faultMode: "none", faultTriggered: false, prefill: false, resetCount: 0, forbiddenSubmitCount: 0, rejectedWrites: 0,
    duplicateMutationCount: 0, duplicateNotesValue: null, axWriteAttempts: 0, fieldMutationCount: 0,
    fields: Object.fromEntries(Object.keys(values).map(label => [label, { value: "", valueChangeCount: 0, visible: true, editable: true, rejectAXWrites: false }])),
    events: [{ sequence: 1, elapsedMs: 0, kind: "ready" }] as Array<{ sequence: number; elapsedMs: number; kind: string; field?: string; rejected?: boolean; before?: string; after?: string }> };
  const after = structuredClone(before); after.axWriteAttempts = 6; after.fieldMutationCount = 6;
  for (const [label, value] of Object.entries(values)) {
    after.fields[label]!.value = value; after.fields[label]!.valueChangeCount = 1;
    after.events.push({ sequence: after.events.length + 1, elapsedMs: after.events.length, kind: "ax-write-attempt", field: label, rejected: false });
    after.events.push({ sequence: after.events.length + 1, elapsedMs: after.events.length, kind: "field-change", field: label, before: "", after: value });
  }
  const compact = (index: number) => JSON.stringify({ snapshotToken: `snapshot-${index}` }) + "\n" +
    Object.entries(values).map(([label, value], field) => JSON.stringify([`ref-${index}-${field}`, "AXTextField", label, field < index ? value.slice(0, 120) : "", true, true, "accessibility", ["fill"]])).join("\n");
  const calls: NonNullable<Evidence["transcript"]>["toolCalls"] = [];
  const add = (tool: string, args: unknown, result: unknown) => calls.push({ id: `call-${calls.length}`, server: "otto", tool, arguments: args, status: "completed", result, error: null });
  if (arm === "inspect-and-act") {
    add("inspect", { appId: launch.appId }, response(compact(0)));
    Object.entries(values).forEach(([, value], index) => add("act", { operation: "fill", snapshotToken: `snapshot-${index}`, ref: `ref-${index}-${index}`, value }, response('{"outcome":"verified"}\n' + compact(index + 1))));
  } else {
    add("run_steps", { appId: launch.appId, steps: Object.entries(values).map(([label, value]) => ({ operation: "fill", label, value })), expected: filledValues ? "filled_values" : { values } },
      response(JSON.stringify({ status: "verified", actions: 6, completedSteps: 6, modelCalls: 0, elapsedMs: 20,
        checks: Object.keys(values).map(label => ({ kind: "value", label, matched: true })) })));
  }
  add("release_control", {}, response('{"released":true,"referencesInvalidated":true}'));
  const events = calls.map(call => ({ type: "item.completed", item: { type: "mcp_tool_call", ...call } }));
  const row: Evidence = { caseId: contract.id, arm, status: "passed", errors: [], before, after, launch, runtimeUnchanged: true,
    ...(filledValues ? { expectedMode: "filled_values" as const } : {}),
    process: { exitCode: 0, signal: null, timedOut: false, interrupted: false, elapsedMs: 100, outputLimitReached: false, lingeringProcesses: 0, processInspectionFailed: false },
    transcript: summarizeEvents([...events, usage].map(event => JSON.stringify(event)).join("\n")) };
  return { row, launch, events, after };
}

test("grade accepts baseline and both workflow expectation formats with full native oracle", () => {
  for (const arm of ["inspect-and-act", "run-steps"] as const) {
    for (const filled of arm === "run-steps" ? [false, true] : [false]) {
      const { row, launch } = fixture(arm, filled); assert.doesNotThrow(() => grade(row, launch));
      assert.equal(row.transcript!.toolCalls.length, arm === "inspect-and-act" ? 8 : 2);
    }
  }
});

test("baseline rejects swapped values, wrong current refs, stale snapshots, and unverified actions", () => {
  for (const mutate of [
    (row: Evidence) => { (row.transcript!.toolCalls[1]!.arguments as Record<string, unknown>).value = row.launch!.literalFields.Notes; },
    (row: Evidence) => { (row.transcript!.toolCalls[1]!.arguments as Record<string, unknown>).ref = "ref-0-1"; },
    (row: Evidence) => { (row.transcript!.toolCalls[2]!.arguments as Record<string, unknown>).snapshotToken = "snapshot-0"; },
    (row: Evidence) => {
      const result = row.transcript!.toolCalls[1]!.result as ReturnType<typeof response>;
      result.content[0]!.text = result.content[0]!.text.replace('"verified"', '"unverified"');
    },
  ]) { const { row, launch } = fixture(); mutate(row); assert.throws(() => grade(row, launch)); }
});

test("MCP errors, contradictory receipts and incomplete release cannot pass", () => {
  for (const mutate of [
    (row: Evidence) => { row.transcript!.toolCalls[0]!.result = { ...response("{}"), isError: true }; },
    (row: Evidence) => {
      const result = row.transcript!.toolCalls[0]!.result as ReturnType<typeof response>;
      result.content[0]!.text = JSON.stringify({ ...JSON.parse(result.content[0]!.text), uncertainAction: true });
    },
    (row: Evidence) => { row.transcript!.toolCalls.pop(); },
    (row: Evidence) => { row.process!.processInspectionFailed = true; },
  ]) { const { row, launch } = fixture("run-steps", true); mutate(row); assert.throws(() => grade(row, launch)); }
});

test("long native values require exact full oracle text despite matching truncated previews", () => {
  for (const arm of ["inspect-and-act", "run-steps"] as const) {
    const { row, launch, after } = fixture(arm, arm === "run-steps", true);
    assert.equal(launch.literalFields.Notes!.length, 1800); assert.doesNotThrow(() => grade(row, launch));
    after.fields.Notes!.value = launch.literalFields.Notes!.slice(0, -1) + "違";
    assert.throws(() => grade(row, launch));
  }
});

test("stable call IDs reject conflicting arguments and terminal outcomes", () => {
  for (const mutate of [
    (event: ReturnType<typeof fixture>["events"][number]) => { event.item.arguments = { appId: "outside" }; },
    (event: ReturnType<typeof fixture>["events"][number]) => { event.item.result = response("different terminal result"); },
  ]) {
    const { row, launch, events } = fixture();
    const conflict = structuredClone(events[0]!); mutate(conflict);
    row.transcript = summarizeEvents([...events, conflict, usage].map(event => JSON.stringify(event)).join("\n"));
    assert.ok(row.transcript.unexpectedItems.length > 0); assert.throws(() => grade(row, launch));
  }
  const { events } = fixture();
  const repeated = summarizeEvents([...events, events[0], usage].map(event => JSON.stringify(event)).join("\n"));
  assert.deepEqual(repeated.unexpectedItems, []); assert.equal(repeated.toolCalls.length, 8);
});

test("missing cached usage stays unknown and cannot become false uncached savings", () => {
  const trace = summarizeEvents(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1000, output_tokens: 20 } }));
  assert.equal(trace.reportedUsage.cachedInputTokens, null);
  const rows = PLAN.map(item => ({ ...item, status: "passed" as const, errors: [], grading: { passed: true, failures: [] }, process: { elapsedMs: 100 }, transcript: trace }));
  const summary = summarizePilot(rows);
  assert.equal(summary.targetsMet, null); assert.equal(summary.medianPairedReductionPercent, null);
  assert.equal(summary.totals[0]!.measurements.uncachedInputTokens!.recordedTotal, null);
});

test("prompts preserve literal scope, full readback requirements and terminal release", () => {
  const { launch } = fixture("run-steps", true, true);
  const baseline = prompt("inspect-and-act", launch), workflow = prompt("run-steps", launch, true);
  for (const text of [baseline, workflow]) {
    assert.ok(text.includes(JSON.stringify(launch.literalFields, null, 2)));
    assert.match(text, /Do not submit, reset/); assert.match(text, /release_control once/); assert.match(text, /do not retry or reset/);
  }
  assert.match(baseline, /latest snapshot token/); assert.match(baseline, /matching preview alone is not full-value verification/);
  assert.match(workflow, /expected: "filled_values"/);
  assert.match(prompt("run-steps", launch), /expected.values/);
});
