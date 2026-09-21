import assert from "node:assert/strict";
import test from "node:test";
import { runSteps, delegateTask, validateWorkflow, WorkflowError } from "./agent-workflow.js";
import type { AgentSession, AgentActionInput } from "./agent-session.js";
import type { CompactObservation } from "./developer.js";
import type { DecisionInput } from "./typesafe.js";

function fixture(options: { interfere?: boolean; reject?: boolean; omit?: boolean; redact?: boolean; noChange?: boolean } = {}) {
  let values = ["", ""];
  let dispatched = 0;
  let inspected = 0;
  const frame = (): CompactObservation => ({ controlCoverage: "complete", version: 1, snapshotToken: `s${inspected}`, app: { id: "fixture", name: "Fixture", pid: 1 }, title: "Form", capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30000).toISOString(), text: values.join(" "),
    controls: values.map((value, i) => ({ ref: `c${i + 1}`, role: "text", label: ["Name", "City"][i]!, value, enabled: true, editable: true, source: "accessibility", actions: ["fill"] })),
    redacted: options.redact ?? false, sensitiveControlsOmitted: 0, truncation: { controlsOmitted: options.omit ? 1 : 0, text: { originalChars: 0, sanitizedChars: 0, returnedChars: 0, truncated: false }, title: false, details: [] } });
  const session = {
    get dispatchCount() { return dispatched; },
    async inspect() { inspected++; return frame(); },
    matchesValues(expected: Record<string, string>) {
      return Object.entries(expected).map(([label, value]) => ({ label, matched: !options.redact && !options.omit && values[["Name", "City"].indexOf(label)] === value }));
    },
    pinFields(refs: string[]) {
      if (options.redact) throw new WorkflowError("Protected field values.");
      return { refs, values: refs.map(ref => values[Number(ref.slice(1)) - 1]) };
    },
    validateFields(guard: { refs: string[] }, expected: string[]) {
      if (guard.refs.some((ref, i) => values[Number(ref.slice(1)) - 1] !== expected[i])) throw new WorkflowError("A field changed unexpectedly.");
    },
    async act(input: AgentActionInput) {
      dispatched++;
      if (options.reject) throw new Error("private native details must not escape");
      if (!options.noChange && input.ref) values[Number(input.ref.slice(1)) - 1] = input.value!;
      if (options.interfere && dispatched === 1) values[1] = "User changed this";
      return { outcome: "verified" as const, observation: frame() };
    },
    invalidate() {},
  } as unknown as AgentSession;
  return { session, get dispatched() { return dispatched; }, get inspected() { return inspected; }, get values() { return values; } };
}
const steps = [{ operation: "fill" as const, label: "Name", value: "Ada" }, { operation: "fill" as const, label: "City", value: "London" }];
const expected = { values: { Name: "Ada", City: "London" } };
test("exact workflow verifies final state with no model calls", async () => {
  const fake = fixture();
  const result = await runSteps(fake.session, { appId: "fixture", steps, expected });
  assert.equal(result.status, "verified"); assert.equal(result.modelCalls, 0); assert.equal(result.actions, 2);
  assert.equal(fake.inspected, 2); assert.deepEqual(fake.values, ["Ada", "London"]);
  assert.ok(result.checks.every(check => check.matched));
});
test("filled_values derives the same exact checks as explicit expectations, including empty literals", async () => {
  for (const fillSteps of [steps, [{ operation: "fill" as const, label: "Name", value: "" }, steps[1]!]]) {
    const explicit = fixture(), shorthand = fixture();
    const baseline = await runSteps(explicit.session, { appId: "fixture", steps: fillSteps,
      expected: { values: Object.fromEntries(fillSteps.map(step => [step.label, step.value])) } });
    const candidate = await runSteps(shorthand.session, { appId: "fixture", steps: fillSteps, expected: "filled_values" });
    assert.deepEqual({ ...candidate, elapsedMs: 0 }, { ...baseline, elapsedMs: 0 });
    assert.equal(candidate.status, "verified");
    assert.deepEqual(shorthand.values, explicit.values);
  }
});
test("filled_values rejects mixed operations and duplicate normalized labels before inspection", async () => {
  for (const fillSteps of [
    [steps[0]!, { operation: "key" as const, value: "tab" }],
    [steps[0]!, { operation: "press" as const, label: "Submit" }],
    [steps[0]!, { ...steps[0]!, label: " Name " }],
    [{ operation: "fill" as const, label: "Café", value: "one" }, { operation: "fill" as const, label: " Cafe\u0301 ", value: "two" }],
  ]) {
    const fake = fixture();
    await assert.rejects(runSteps(fake.session, { appId: "fixture", steps: fillSteps, expected: "filled_values" }), WorkflowError);
    assert.equal(fake.inspected, 0); assert.equal(fake.dispatched, 0);
  }
});
test("filled_values cannot be used by delegate and unknown expectation strings remain invalid", async () => {
  const fake = fixture();
  await assert.rejects(delegateTask(fake.session, { appId: "fixture", goal: "Fill", allowedActions: steps,
    expected: "filled_values" } as never, "fake-unit-key"), WorkflowError);
  assert.equal(fake.inspected, 0); assert.equal(fake.dispatched, 0);
  assert.throws(() => validateWorkflow({ appId: "fixture", steps, expected: "filled" }), WorkflowError);
});
test("filled_values keeps its literal actions and checks fixed while inspection awaits", async () => {
  const fake = fixture();
  const input = { appId: "fixture", steps: structuredClone(steps), expected: "filled_values" as const };
  const inspect = fake.session.inspect.bind(fake.session);
  fake.session.inspect = async (...args) => {
    input.steps[0]!.value = "Changed by caller";
    input.steps.push({ operation: "fill", label: "Other", value: "Unauthorized" });
    return inspect(...args);
  };
  const result = await runSteps(fake.session, input);
  assert.equal(result.status, "verified"); assert.equal(result.actions, 2);
  assert.deepEqual(fake.values, ["Ada", "London"]);
  assert.deepEqual(result.checks.map(check => check.label), ["Name", "City"]);
});
test("all-field preflight prevents partial writes when a later target is missing", async () => {
  const fake = fixture();
  const result = await runSteps(fake.session, { appId: "fixture", steps: [steps[0]!, { operation: "fill", label: "Missing", value: "x" }] });
  assert.equal(result.status, "stopped"); assert.equal(fake.dispatched, 0);
  assert.deepEqual(result.targetResolution, { code: "target_missing", matchCount: 0, controlsOmitted: 0, truncatedIdentity: false, controlCoverage: "complete" });
});
test("target diagnostics distinguish ambiguity from incomplete observations without dispatch or app text", async () => {
  for (const mode of ["duplicate", "omitted", "truncated", "partial", "unknown"] as const) {
    const fake = fixture({ omit: mode === "omitted" });
    const inspect = fake.session.inspect.bind(fake.session);
    fake.session.inspect = async (...args) => {
      const frame = await inspect(...args);
      if (mode === "partial" || mode === "unknown") frame.controlCoverage = mode;
      if (mode === "duplicate") frame.controls.push({ ...frame.controls[0]!, ref: "other" });
      if (mode === "truncated") frame.truncation.details.push({ ref: "c1", fields: ["label"] });
      return frame;
    };
    const result = await runSteps(fake.session, { appId: "fixture", steps });
    assert.equal(result.status, "stopped"); assert.equal(fake.dispatched, 0); assert.equal(fake.inspected, 1);
    assert.deepEqual(result.targetResolution, {
      code: mode === "duplicate" ? "target_ambiguous" : "incomplete_observation",
      matchCount: mode === "duplicate" ? 2 : null,
      controlsOmitted: mode === "omitted" ? 1 : 0, truncatedIdentity: mode === "truncated",
      controlCoverage: mode === "partial" || mode === "unknown" ? mode : "complete",
    });
    assert.ok(!JSON.stringify(result.targetResolution).includes("Name"));
  }
});
test("interference stops the remaining writes and preserves user changes", async () => {
  const fake = fixture({ interfere: true });
  const result = await runSteps(fake.session, { appId: "fixture", steps, expected });
  assert.equal(result.status, "stopped"); assert.equal(fake.dispatched, 1); assert.deepEqual(fake.values, ["Ada", "User changed this"]);
});
test("dispatch failures never claim rollback or replay and don't leak native error text", async () => {
  const fake = fixture({ reject: true });
  const result = await runSteps(fake.session, { appId: "fixture", steps, expected });
  assert.equal(result.status, "stopped"); assert.equal(result.uncertainAction, true); assert.equal(fake.dispatched, 1);
  assert.doesNotMatch(JSON.stringify(result), /private native/);
});
test("omission and redaction cannot certify field equality", async () => {
  for (const options of [{ omit: true }, { redact: true }]) {
    const fake = fixture(options);
    const result = await runSteps(fake.session, { appId: "fixture", steps, expected });
    assert.equal(result.status, "stopped"); assert.equal(fake.dispatched, 0);
  }
});
test("completion is limited to supplied checks and pre-aborted work does nothing", async () => {
  const fake = fixture();
  assert.equal((await runSteps(fake.session, { appId: "fixture", steps })).status, "completed");
  const other = fixture();
  const cancelled = await runSteps(other.session, { appId: "fixture", steps }, AbortSignal.abort());
  assert.equal(cancelled.status, "stopped"); assert.equal(other.inspected, 0);
});
test("invalid task schemas cannot reach native work", () => {
  for (const input of [null, {}, { appId: "fixture", steps: [] }, { appId: "fixture", steps, unsafe: true }, { appId: "fixture", steps: [{ operation: "key", value: "cmd+a" }] }, { appId: "fixture", steps, expected: {} }])
    assert.throws(() => validateWorkflow(input), WorkflowError);
});
test("delegate requires its own configured key before observing an app", async () => {
  const fake = fixture();
  await assert.rejects(delegateTask(fake.session, { appId: "fixture", goal: "Fill the fields", allowedActions: steps, expected }, ""), /TYPESAFE_API_KEY/);
  assert.equal(fake.inspected, 0);
});
test("Jev choices are bounded and probability of completion cannot certify success", async () => {
  const fake = fixture();
  let calls = 0;
  const decider = async (input: DecisionInput) => {
    calls++;
    assert.ok(input.candidates.some(candidate => candidate.id === "stop"));
    const choice = calls === 1 ? "a1" : "a2";
    const now = new Date().toISOString();
    input.onRequest?.({ id: `request-${calls}`, requestedModel: "jev", model: "jev", startedAt: now, completedAt: now, outcome: "succeeded", responseReceived: true, httpStatus: 200, inputTokens: 20, outputTokens: 0, latencyMs: 4 });
    return { choice, confidence: 0.9, probabilities: {}, complete: 1, latencyMs: 4, inputTokens: 20 };
  };
  const result = await delegateTask(fake.session, { appId: "fixture", goal: "Fill the fields", allowedActions: steps, expected }, "fake-unit-key", undefined, decider);
  assert.equal(result.status, "verified"); assert.equal(calls, 2); assert.equal(fake.dispatched, 2);
  assert.deepEqual(result.usage, { inputTokens: 40, outputTokens: 0, unknownUsageRequests: 0, requestLatencyMs: 8 });
});
test("delegation abstains without replaying and preserves missing usage", async () => {
  for (const choice of ["stop", "made-up"]) {
    const fake = fixture();
    const result = await delegateTask(fake.session, { appId: "fixture", goal: "Fill", allowedActions: steps, expected }, "fake-unit-key", undefined,
      async () => ({ choice, confidence: 0.9, complete: 1, probabilities: {}, latencyMs: 1, inputTokens: 20 }));
    assert.equal(result.status, "stopped"); assert.equal(fake.dispatched, 0);
    assert.equal(result.usage?.inputTokens, null); assert.equal(result.usage?.unknownUsageRequests, 1);
  }
});
test("no-progress stops the delegated loop after one action", async () => {
  const fake = fixture({ noChange: true });
  const result = await delegateTask(fake.session, { appId: "fixture", goal: "Fill", allowedActions: steps, expected }, "fake-unit-key", undefined,
    async () => ({ choice: "a1", confidence: 0.9, complete: 1, probabilities: {}, latencyMs: 1, inputTokens: 20 }));
  assert.equal(result.status, "stopped"); assert.equal(fake.dispatched, 1);
  assert.match(result.reason!, /no observed progress/);
});
test("each delegated permission is single-use even when repeated presses could change the UI", async () => {
  const fake = fixture();
  const original = fake.session.act.bind(fake.session);
  fake.session.act = async input => {
    await original(input);
    fake.values[1] = `Progress ${fake.dispatched}`;
    return { outcome: "dispatched", observation: await fake.session.inspect("fixture") };
  };
  const result = await delegateTask(fake.session, { appId: "fixture", goal: "Press once", allowedActions: [{ operation: "key", value: "enter" }], expected, maxSteps: 3 }, "fake-unit-key", undefined,
    async () => ({ choice: "a1", confidence: 0.9, complete: 0, probabilities: {}, latencyMs: 1, inputTokens: 20 }));
  assert.equal(result.status, "stopped"); assert.equal(fake.dispatched, 1); assert.equal(result.modelCalls, 1);
});
