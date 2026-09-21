import assert from "node:assert/strict";
import test from "node:test";
import { PILOT_CASES, PLAN, parsePilotArgs, summarizePilot, type PilotRow } from "./astra-low-pilot.js";

const rows = (): PilotRow[] => PLAN.map(item => ({ ...item, status: "passed", errors: [], grading: { passed: true, failures: [] },
  process: { elapsedMs: item.arm === "inspect-and-act" ? 100 : 70 }, transcript: { usageCompleteForCompletedTurns: true,
    reportedUsage: { inputTokens: item.arm === "inspect-and-act" ? 1000 : 700, cachedInputTokens: 200, outputTokens: 20, reasoningOutputTokens: null } } }));

test("pilot defaults to no execution, reuses three authored families and schedules AB/BA/AB", () => {
  assert.deepEqual(parsePilotArgs([]), { run: false }); assert.deepEqual(parsePilotArgs(["--run"]), { run: true });
  for (const args of [["--run", "--run"], ["--case", "standard"], ["--unknown"]]) assert.throws(() => parsePilotArgs(args));
  assert.equal(PILOT_CASES.length, 3); assert.equal(new Set(PILOT_CASES.map(item => item.family)).size, 3);
  assert.ok(PILOT_CASES.every(item => item.sameAppKitTemplate && item.contract.id === item.caseId));
  assert.equal(new Set(PILOT_CASES.map(item => item.contract.templateGroup)).size, 1);
  assert.deepEqual(PLAN.map(item => item.arm), ["inspect-and-act", "run-steps", "run-steps", "inspect-and-act", "inspect-and-act", "run-steps"]);
});

test("complete host evidence reaches predeclared targets with derived uncached usage", () => {
  const summary = summarizePilot(rows());
  assert.equal(summary.completePairs, 3); assert.equal(summary.allPlannedComplete, true); assert.equal(summary.targetsMet, true);
  assert.deepEqual(summary.medianPairedReductionPercent, { uncachedInputTokens: 37.5, hostElapsedMs: 30 });
  assert.deepEqual(summary.totals[0]!.measurements.uncachedInputTokens, { recordedTotal: 2400, observedRows: 3, missingOrInvalidRows: 0 });
  assert.equal(summary.totals[0]!.measurements.reasoningOutputTokens!.recordedTotal, null);
});

test("medians use paired percentages rather than percentages of arm medians", () => {
  const trials = rows();
  const values = [[100, 10], [200, 300], [1000, 500]];
  PILOT_CASES.forEach((item, i) => {
    for (const row of trials.filter(row => row.caseId === item.caseId)) {
      const value = values[i]![row.arm === "inspect-and-act" ? 0 : 1]!;
      row.process!.elapsedMs = value; row.transcript!.reportedUsage.inputTokens = value; row.transcript!.reportedUsage.cachedInputTokens = 0;
    }
  });
  assert.deepEqual(summarizePilot(trials).medianPairedReductionPercent, { uncachedInputTokens: 50, hostElapsedMs: 50 });
});

test("failed, blocked and not-run rows retain usage and suppress aggregate success", () => {
  const trials = rows(); trials[0]!.status = "failed"; trials[2]!.status = "blocked";
  trials[5]!.status = "not_run"; delete trials[5]!.transcript; delete trials[5]!.process;
  const summary = summarizePilot(trials);
  assert.equal(summary.rows, trials); assert.equal(summary.medianPairedReductionPercent, null); assert.equal(summary.targetsMet, null);
  assert.equal(summary.totals[0]!.measurements.inputTokens!.recordedTotal, 3000);
  assert.equal(summary.totals[1]!.measurements.inputTokens!.recordedTotal, 1400);
  assert.equal(summary.totals[1]!.measurements.inputTokens!.missingOrInvalidRows, 1);
});

test("missing, duplicate, unknown and forged passed rows cannot qualify", () => {
  for (const mutate of [
    (trials: PilotRow[]) => { trials.pop(); },
    (trials: PilotRow[]) => { trials.push(structuredClone(trials[0]!)); },
    (trials: PilotRow[]) => { trials[0]!.caseId = "invented"; },
    (trials: PilotRow[]) => { trials[0]!.arm = trials[1]!.arm; },
    (trials: PilotRow[]) => { delete trials[0]!.grading; },
    (trials: PilotRow[]) => { trials[0]!.grading!.passed = false; },
    (trials: PilotRow[]) => { trials[0]!.grading!.failures.push("wrong native value"); },
    (trials: PilotRow[]) => { trials[0]!.errors!.push("cleanup failed"); },
    (trials: PilotRow[]) => { delete trials[0]!.errors; },
    (trials: PilotRow[]) => { trials[0]!.transcript!.usageCompleteForCompletedTurns = false; },
    (trials: PilotRow[]) => { delete trials[0]!.transcript!.usageCompleteForCompletedTurns; },
  ]) {
    const trials = rows(); mutate(trials); const summary = summarizePilot(trials);
    assert.equal(summary.allPlannedComplete, false); assert.equal(summary.medianPairedReductionPercent, null); assert.equal(summary.targetsMet, null);
  }
});

test("missing, noninteger, negative and inconsistent usage cannot produce claimed savings", () => {
  for (const key of ["inputTokens", "cachedInputTokens", "outputTokens"] as const) {
    for (const value of [null, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const trials = rows(); trials[0]!.transcript!.reportedUsage[key] = value;
      assert.equal(summarizePilot(trials).medianPairedReductionPercent, null);
    }
  }
  const trials = rows(); trials[0]!.transcript!.reportedUsage.cachedInputTokens = 1001;
  assert.equal(summarizePilot(trials).medianPairedReductionPercent, null);
  for (const value of [NaN, Infinity, -1, 1.5]) {
    const invalid = rows(); invalid[0]!.transcript!.reportedUsage.reasoningOutputTokens = value;
    assert.equal(summarizePilot(invalid).medianPairedReductionPercent, null);
  }
  for (const value of [NaN, Infinity, -1]) {
    const invalid = rows(); invalid[0]!.process!.elapsedMs = value;
    assert.equal(summarizePilot(invalid).medianPairedReductionPercent, null);
  }
});

test("zero baseline never fabricates a percent or a winning target result", () => {
  const trials = rows(); trials[0]!.transcript!.reportedUsage.inputTokens = 200; trials[0]!.process!.elapsedMs = 0;
  const summary = summarizePilot(trials);
  assert.equal(summary.allPlannedComplete, true);
  assert.deepEqual(summary.medianPairedReductionPercent, { uncachedInputTokens: null, hostElapsedMs: null });
  assert.equal(summary.targetsMet, null);
});
