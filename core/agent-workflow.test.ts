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
  const frame = (): CompactObservation => ({ version: 1, snapshotToken: `s${inspected}`, app: { id: "fixture", name: "Fixture", pid: 1 }, title: "Form", capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30000).toISOString(), text: values.join(" "),
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
test("all-field preflight prevents partial writes when a later target is missing", async () => {
  const fake = fixture();
  const result = await runSteps(fake.session, { appId: "fixture", steps: [steps[0]!, { operation: "fill", label: "Missing", value: "x" }] });
  assert.equal(result.status, "stopped"); assert.equal(fake.dispatched, 0);
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
