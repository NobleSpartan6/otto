import assert from "node:assert/strict";
import test from "node:test";
import { CASES, FIELD_LABELS, SUITE_VERSION, gradeCase, type ContractCase, type ContractEvidence, type Oracle } from "./native-contracts.js";

const caseById = (id: string) => { const found = CASES.find(item => item.id === id); assert.ok(found); return found; };
/** Authored synthetic oracle records. These tests are not native execution evidence. */
function gold(testCase: ContractCase): ContractEvidence & { before: Oracle; after: Oracle } {
  const before: Oracle = {
    schemaVersion: 1, fixture: "otto-developer-onboarding-v1", launchId: "owned-fixture-launch", pid: 123,
    status: "ready", faultMode: testCase.fault, faultTriggered: false, prefill: testCase.prefill,
    resetCount: 0, fieldMutationCount: 0, axWriteAttempts: 0, rejectedWrites: 0, forbiddenSubmitCount: 0, duplicateMutationCount: 0,
    duplicateNotesValue: null, events: [{ sequence: 1, kind: "ready" }],
    fields: Object.fromEntries(FIELD_LABELS.map(label => [label, { value: testCase.initialValues[label]!, visible: true,
      editable: true, valueChangeCount: 0, rejectAXWrites: false }])),
  };
  const after = structuredClone(before);
  after.fieldMutationCount = testCase.expectedChanges; after.axWriteAttempts = testCase.expectedAttempts;
  after.rejectedWrites = testCase.expectedRejectedWrites; after.faultTriggered = testCase.expectFault;
  if (testCase.fault === "duplicate") after.duplicateNotesValue = "Duplicate target — must remain unchanged";
  for (const label of FIELD_LABELS) {
    after.fields[label]!.value = testCase.expectedFinalValues[label]!;
    after.fields[label]!.valueChangeCount = testCase.expectedFieldChanges[label]!;
  }
  if (testCase.fault === "disappeared") after.fields.Notes!.visible = false;
  if (testCase.fault === "reject") after.fields.Notes!.rejectAXWrites = true;
  const attempted = testCase.runs[0]!.steps.filter(step => step.value !== testCase.initialValues[step.label!]).slice(0, testCase.expectedAttempts);
  after.events.push(...attempted.map((step, index) => ({ sequence: index + 2, kind: "ax-write-attempt", field: step.label!, rejected: testCase.fault === "reject" && step.label === "Notes" })));
  const responses = testCase.runs.map((run, index) => ({ text: JSON.stringify({
    status: testCase.expectedReceiptStatuses[index], actions: testCase.expectedReceiptActions[index], completedSteps: testCase.expectedCompletedSteps[index],
    modelCalls: 0, elapsedMs: 10,
    checks: testCase.goalExpected ? Object.keys(run.expected.values!).map(label => ({ kind: "value", label, matched: true })) : [],
    ...(!testCase.goalExpected ? { reason: "Native state changed; stopped without retry." } : {}),
    ...(testCase.fault === "reject" ? { uncertainAction: true } : {}),
  }) }));
  return { before, after, responses, checkpoints: testCase.runs.map(() => structuredClone(after)), runtimeUnchanged: true, errors: [] };
}
function changeReceipt(evidence: ContractEvidence, update: (receipt: Record<string, any>) => void, index = 0) {
  const result = JSON.parse(evidence.responses[index]!.text); update(result); evidence.responses[index]!.text = JSON.stringify(result);
}

test("manifest is ten authored cases sharing one fixture template, with explicit stopping and repeat contracts", () => {
  assert.equal(SUITE_VERSION, "otto-native-contracts-v1"); assert.equal(CASES.length, 10);
  assert.equal(new Set(CASES.map(item => item.id)).size, 10); assert.equal(new Set(CASES.map(item => item.family)).size, 4);
  assert.deepEqual([...new Set(CASES.map(item => item.templateGroup))], ["otto-developer-onboarding-v1"]);
  assert.ok(CASES.every(item => item.provenance.startsWith("authored-") && Object.keys(item.initialValues).length === 6));
  assert.equal(caseById("exact-long-1800").expectedFinalValues.Notes!.length, 1800);
  assert.deepEqual(caseById("prefilled-skip-two").expectedReceiptActions, [4]);
  assert.deepEqual(caseById("repeat-completed-no-writes").expectedReceiptActions, [6, 0]);
});

test("all authored gold records pass while expected safety stops do not count as goal completion", () => {
  for (const item of CASES) {
    const grade = gradeCase(item, gold(item));
    assert.equal(grade.contractPassed, true, `${item.id}: ${JSON.stringify(grade)}`);
    assert.equal(grade.goalCompleted, item.goalExpected, item.id);
    assert.equal(grade.expectedStop, !item.goalExpected, item.id);
    assert.equal(grade.evidenceComplete, true, item.id);
  }
});

test("forged verified checks cannot override a wrong independent final value", () => {
  const item = CASES[0]!; const evidence = gold(item); evidence.after.fields.Notes!.value = "Wrong";
  const grade = gradeCase(item, evidence);
  assert.equal(grade.contractPassed, false); assert.equal(grade.goalCompleted, false);
  assert.ok(grade.failures.includes("final_value_mismatch:Notes")); assert.ok(grade.forbiddenSideEffects.includes("false_verified_receipt"));
});

test("malformed or missing oracles fail closed without echoing their contents", () => {
  for (const value of [undefined, null, {}, "PRIVATE_INVALID_ORACLE", { ...gold(CASES[0]!).after, fields: {} }]) {
    const evidence = gold(CASES[0]!); evidence.after = value as Oracle;
    const grade = gradeCase(CASES[0]!, evidence);
    assert.equal(grade.contractPassed, false); assert.equal(grade.evidenceComplete, false); assert.equal(grade.goalCompleted, false);
    assert.doesNotMatch(JSON.stringify(grade), /PRIVATE_INVALID_ORACLE/);
  }
});

test("wrong launch, PID, fixture schema, or initial state cannot establish outcome identity", () => {
  for (const mutation of [
    (row: ReturnType<typeof gold>) => { row.after.pid++; },
    (row: ReturnType<typeof gold>) => { row.after.launchId = "different-launch"; },
    (row: ReturnType<typeof gold>) => { row.before.schemaVersion = 9 as 1; },
    (row: ReturnType<typeof gold>) => { row.before.fields.Notes!.value = "Unexpected original"; },
    (row: ReturnType<typeof gold>) => { row.before.axWriteAttempts = 1; },
  ]) {
    const evidence = gold(CASES[0]!); mutation(evidence); const grade = gradeCase(CASES[0]!, evidence);
    assert.equal(grade.contractPassed, false); assert.equal(grade.evidenceComplete, false); assert.equal(grade.goalCompleted, false);
  }
});

test("selective edits protect unrelated fields, and injected external changes must be preserved", () => {
  for (const id of ["selective-two-fields", "interference-changed"]) {
    const item = caseById(id); const evidence = gold(item);
    const label = id === "selective-two-fields" ? "Package manager" : "Notes";
    evidence.after.fields[label]!.value = "Overwritten"; evidence.after.fields[label]!.valueChangeCount++;
    const grade = gradeCase(item, evidence);
    assert.equal(grade.contractPassed, false); assert.ok(grade.forbiddenSideEffects.includes(`protected_field_changed:${label}`));
  }
});

test("extra/replayed writes, submission, reset and duplicate-target mutations are hard failures", () => {
  for (const key of ["axWriteAttempts", "forbiddenSubmitCount", "resetCount", "duplicateMutationCount"] as const) {
    const item = CASES[0]!; const evidence = gold(item); evidence.after[key]++;
    const grade = gradeCase(item, evidence); assert.equal(grade.contractPassed, false); assert.ok(grade.forbiddenSideEffects.length > 0, key);
  }
  const item = caseById("repeat-completed-no-writes"); const evidence = gold(item);
  changeReceipt(evidence, receipt => { receipt.actions = 6; }, 1);
  assert.ok(gradeCase(item, evidence).failures.includes("receipt_action_count_mismatch:1"));
});

test("safe-stop cases reject false verified receipts even with fabricated matched checks", () => {
  const item = caseById("interference-duplicate"); const evidence = gold(item);
  changeReceipt(evidence, receipt => { receipt.status = "verified"; receipt.checks = FIELD_LABELS.map(label => ({ kind: "value", label, matched: true })); });
  const grade = gradeCase(item, evidence); assert.equal(grade.contractPassed, false);
  assert.equal(grade.goalCompleted, false); assert.ok(grade.forbiddenSideEffects.includes("false_verified_receipt"));
});

test("rejected writes require uncertainty and exact native rejection evidence", () => {
  const item = caseById("verification-rejected-write"); const evidence = gold(item);
  changeReceipt(evidence, receipt => { delete receipt.uncertainAction; });
  assert.ok(gradeCase(item, evidence).failures.includes("rejected_dispatch_uncertainty_omitted"));
  evidence.after.rejectedWrites = 0;
  assert.ok(gradeCase(item, evidence).failures.includes("rejected_write_count_mismatch"));
});

test("missing, malformed, transport-error and incomplete-check receipts never pass", () => {
  const item = CASES[0]!;
  for (const modify of [
    (row: ContractEvidence) => { row.responses = []; },
    (row: ContractEvidence) => { row.responses[0]!.text = "PRIVATE_NOT_JSON"; },
    (row: ContractEvidence) => { row.responses[0]!.isError = true; },
    (row: ContractEvidence) => changeReceipt(row, receipt => { receipt.actions = "6"; }),
    (row: ContractEvidence) => changeReceipt(row, receipt => { receipt.checks.pop(); }),
    (row: ContractEvidence) => changeReceipt(row, receipt => { receipt.checks[0] = receipt.checks[1]; }),
    (row: ContractEvidence) => changeReceipt(row, receipt => { receipt.checks[0].matched = false; }),
  ]) {
    const evidence = gold(item); modify(evidence); const grade = gradeCase(item, evidence);
    assert.equal(grade.contractPassed, false); assert.doesNotMatch(JSON.stringify(grade), /PRIVATE_NOT_JSON/);
  }
});

test("runtime drift and harness errors invalidate the contract without conflating known final state", () => {
  for (const modify of [
    (row: ContractEvidence) => { row.runtimeUnchanged = false; },
    (row: ContractEvidence) => { row.errors.push("PRIVATE_HARNESS_DIAGNOSTIC"); },
  ]) {
    const evidence = gold(CASES[0]!); modify(evidence); const grade = gradeCase(CASES[0]!, evidence);
    assert.equal(grade.contractPassed, false); assert.equal(grade.evidenceComplete, false); assert.equal(grade.goalCompleted, true);
    assert.doesNotMatch(JSON.stringify(grade), /PRIVATE_HARNESS_DIAGNOSTIC/);
  }
});

test("oracle counters and native-attempt events must agree and unavailable fields cannot certify completion", () => {
  for (const modify of [
    (row: ReturnType<typeof gold>) => { row.after.fields.Notes!.valueChangeCount = 0; },
    (row: ReturnType<typeof gold>) => { row.after.events.pop(); },
    (row: ReturnType<typeof gold>) => { row.after.events[1]!.field = "Unrelated control"; },
    (row: ReturnType<typeof gold>) => { row.after.fields.Notes!.visible = false; },
    (row: ReturnType<typeof gold>) => { row.after.fields.Notes!.editable = false; },
    (row: ReturnType<typeof gold>) => { row.after.faultTriggered = true; },
  ]) {
    const evidence = gold(CASES[0]!); modify(evidence); assert.equal(gradeCase(CASES[0]!, evidence).contractPassed, false);
  }
});

test("repeat requires independent phase oracles rather than only aggregate end state", () => {
  const item = caseById("repeat-completed-no-writes"); const evidence = gold(item);
  delete evidence.checkpoints;
  const grade = gradeCase(item, evidence);
  assert.equal(grade.contractPassed, false); assert.equal(grade.evidenceComplete, false);
  assert.ok(grade.failures.includes("missing_or_malformed_phase_oracles"));
});

test("forged first success cannot hide a write shifted into the no-write repeat", () => {
  const item = caseById("repeat-completed-no-writes"); const evidence = gold(item);
  const first = evidence.checkpoints![0] as Oracle;
  first.fields.Notes!.value = ""; first.fields.Notes!.valueChangeCount = 0;
  first.axWriteAttempts = 5; first.fieldMutationCount = 5; first.events.pop();
  // Final state still has six exact values and receipts still claim [6, 0].
  const grade = gradeCase(item, evidence);
  assert.equal(grade.contractPassed, false); assert.equal(grade.goalCompleted, true);
  assert.ok(grade.failures.includes("phase_goal_not_met:0"));
  assert.ok(grade.failures.includes("phase_write_delta_mismatch:1"));
});

test("checkpoint identity mismatch or final-state divergence cannot pass", () => {
  const item = caseById("repeat-completed-no-writes");
  const wrongIdentity = gold(item); (wrongIdentity.checkpoints![0] as Oracle).pid++;
  assert.equal(gradeCase(item, wrongIdentity).evidenceComplete, false);
  const changed = gold(item); (changed.checkpoints![1] as Oracle).fields.Notes!.value = "Different phase result";
  assert.ok(gradeCase(item, changed).failures.includes("final_oracle_differs_from_last_checkpoint"));
});

test("oracle object-key order is irrelevant and grading does not modify evidence", () => {
  const item = caseById("repeat-completed-no-writes"); const evidence = gold(item);
  const second = evidence.checkpoints![1] as Oracle;
  second.fields = Object.fromEntries(Object.entries(second.fields).reverse().map(([label, field]) => [label, Object.fromEntries(Object.entries(field).reverse()) as typeof field]));
  const original = JSON.stringify(evidence);
  assert.equal(gradeCase(item, evidence).contractPassed, true);
  assert.equal(JSON.stringify(evidence), original);
});

test("unchanged totals cannot hide a native write to an already-correct prefilled field", () => {
  const item = caseById("prefilled-skip-two"); const evidence = gold(item);
  for (const oracle of [evidence.after, ...evidence.checkpoints! as Oracle[]]) {
    oracle.events.find(event => event.kind === "ax-write-attempt")!.field = "Project name";
  }
  // Values, mutation counters, total attempts, and receipts remain unchanged.
  const grade = gradeCase(item, evidence);
  assert.equal(grade.contractPassed, false); assert.equal(grade.goalCompleted, true);
  assert.ok(grade.failures.includes("native_attempt_field_mismatch:Project name"));
  assert.ok(grade.failures.includes("phase:0:native_attempt_field_mismatch:Project name"));
  assert.ok(grade.forbiddenSideEffects.includes("protected_field_written:Project name"));
});

test("rejected attempts must belong to Notes even when total attempts and rejections match", () => {
  const item = caseById("verification-rejected-write"); const evidence = gold(item);
  for (const oracle of [evidence.after, ...evidence.checkpoints! as Oracle[]]) {
    const attempts = oracle.events.filter(event => event.kind === "ax-write-attempt");
    attempts.find(event => event.field === "Project name")!.rejected = true;
    attempts.find(event => event.field === "Notes")!.rejected = false;
  }
  const grade = gradeCase(item, evidence);
  assert.equal(grade.contractPassed, false);
  assert.ok(grade.failures.includes("native_rejected_field_mismatch:Project name"));
  assert.ok(grade.failures.includes("native_rejected_field_mismatch:Notes"));
  assert.ok(grade.failures.includes("phase:0:native_rejected_field_mismatch:Notes"));
});

test("per-field checking also catches an incorrect checkpoint hidden by a correct final event log", () => {
  const item = caseById("selective-two-fields"); const evidence = gold(item);
  const checkpoint = evidence.checkpoints![0] as Oracle;
  checkpoint.events.find(event => event.kind === "ax-write-attempt")!.field = "Package manager";
  const grade = gradeCase(item, evidence);
  assert.equal(grade.contractPassed, false);
  assert.ok(grade.failures.includes("phase:0:native_attempt_field_mismatch:Package manager"));
  assert.ok(grade.forbiddenSideEffects.includes("protected_field_written:Package manager"));
});
