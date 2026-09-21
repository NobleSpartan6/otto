import { CASES } from "./native-contracts.js";

export type PilotArm = "inspect-and-act" | "run-steps";
export const PILOT_CASES = [
  ["exact-standard-six", "standard"],
  ["exact-unicode-multiline", "unicode-multiline"],
  ["exact-long-1800", "long-1800"],
].map(([caseId, family]) => ({
  caseId: caseId!, family: family!, sameAppKitTemplate: true as const,
  contract: CASES.find(item => item.id === caseId)!,
}));
/** One pair per authored family, AB/BA/AB; all use the same AppKit template. */
export const PLAN = PILOT_CASES.flatMap((item, index) =>
  (index === 1 ? ["run-steps", "inspect-and-act"] : ["inspect-and-act", "run-steps"]).map((arm, offset) =>
    ({ caseId: item.caseId, arm: arm as PilotArm, order: index * 2 + offset + 1 })));
export function parsePilotArgs(args: string[]) {
  if (args.length === 0) return { run: false };
  if (args.length === 1 && args[0] === "--run") return { run: true };
  throw new Error("Use no arguments for the pilot plan, or --run for six authorized Codex trials.");
}
export interface PilotRow {
  caseId: string;
  arm: PilotArm;
  status: "passed" | "failed" | "blocked" | "not_run" | "running";
  errors?: string[];
  grading?: { passed: boolean; failures: string[] };
  process?: { elapsedMs: number };
  transcript?: {
    reportedUsage: { inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null; reasoningOutputTokens: number | null };
    usageCompleteForCompletedTurns?: boolean;
  };
}
const counter = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const duration = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length ? sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2 : null;
};
const reduction = (baseline: number | null, candidate: number | null) =>
  baseline !== null && baseline > 0 && candidate !== null ? 100 * (baseline - candidate) / baseline : null;
function metrics(row: PilotRow) {
  const usage = row.transcript?.reportedUsage;
  const input = counter(usage?.inputTokens) ? usage.inputTokens : null;
  const cached = counter(usage?.cachedInputTokens) ? usage.cachedInputTokens : null;
  return {
    inputTokens: input, cachedInputTokens: cached,
    uncachedInputTokens: input !== null && cached !== null && cached <= input ? input - cached : null,
    outputTokens: counter(usage?.outputTokens) ? usage.outputTokens : null,
    reasoningOutputTokens: counter(usage?.reasoningOutputTokens) ? usage.reasoningOutputTokens : null,
    hostElapsedMs: duration(row.process?.elapsedMs) ? row.process.elapsedMs : null,
  };
}
function complete(row: PilotRow) {
  const measured = metrics(row);
  const reasoning = row.transcript?.reportedUsage.reasoningOutputTokens;
  return row.status === "passed" && row.grading?.passed === true && Array.isArray(row.grading.failures) &&
    row.grading.failures.length === 0 && Array.isArray(row.errors) && row.errors.length === 0 &&
    row.transcript?.usageCompleteForCompletedTurns === true && measured.uncachedInputTokens !== null &&
    measured.outputTokens !== null && measured.hostElapsedMs !== null &&
    (reasoning === null || counter(reasoning));
}
/** Summarizes supplied host counters; it does not independently regrade raw native evidence. */
export function summarizePilot(rows: readonly PilotRow[]) {
  const known = (row: PilotRow) => PLAN.some(item => item.caseId === row.caseId && item.arm === row.arm);
  const scheduleValid = rows.length === PLAN.length && rows.every(known) &&
    PLAN.every(item => rows.filter(row => row.caseId === item.caseId && row.arm === item.arm).length === 1);
  const pairs = PILOT_CASES.map(item => {
    const baseline = rows.filter(row => row.caseId === item.caseId && row.arm === "inspect-and-act");
    const candidate = rows.filter(row => row.caseId === item.caseId && row.arm === "run-steps");
    const isComplete = baseline.length === 1 && candidate.length === 1 && complete(baseline[0]!) && complete(candidate[0]!);
    const a = baseline.length === 1 ? metrics(baseline[0]!) : null, b = candidate.length === 1 ? metrics(candidate[0]!) : null;
    return { caseId: item.caseId, complete: isComplete,
      reductionPercent: isComplete ? {
        uncachedInputTokens: reduction(a!.uncachedInputTokens, b!.uncachedInputTokens),
        hostElapsedMs: reduction(a!.hostElapsedMs, b!.hostElapsedMs),
      } : null };
  });
  const allPlannedComplete = scheduleValid && pairs.every(pair => pair.complete);
  const pairedMedian = (key: "uncachedInputTokens" | "hostElapsedMs") => {
    const values = pairs.map(pair => pair.reductionPercent?.[key]);
    return values.every((value): value is number => typeof value === "number") ? median(values) : null;
  };
  const medianPairedReductionPercent = allPlannedComplete ? {
    uncachedInputTokens: pairedMedian("uncachedInputTokens"), hostElapsedMs: pairedMedian("hostElapsedMs"),
  } : null;
  const totals = (["inspect-and-act", "run-steps"] as const).map(arm => {
    const selected = rows.filter(row => row.arm === arm), measured = selected.map(metrics);
    const fields = ["inputTokens", "cachedInputTokens", "uncachedInputTokens", "outputTokens", "reasoningOutputTokens", "hostElapsedMs"] as const;
    return { arm, recordedRows: selected.length,
      statuses: Object.fromEntries(["passed", "failed", "blocked", "not_run", "running"].map(status => [status, selected.filter(row => row.status === status).length])),
      measurements: Object.fromEntries(fields.map(key => {
        const values = measured.map(item => item[key]).filter((value): value is number => value !== null);
        const sum = values.reduce((total, value) => total + value, 0);
        return [key, { recordedTotal: values.length && Number.isFinite(sum) && (key === "hostElapsedMs" || Number.isSafeInteger(sum)) ? sum : null,
          observedRows: values.length, missingOrInvalidRows: selected.length - values.length }];
      })),
    };
  });
  const target = medianPairedReductionPercent;
  return { rows, scheduledTrials: PLAN.length, scheduleValid, completePairs: pairs.filter(pair => pair.complete).length,
    allPlannedComplete, pairs, totals, medianPairedReductionPercent,
    targets: { uncachedInputReductionPercent: 30, hostElapsedReductionPercent: 20 },
    targetsMet: target?.uncachedInputTokens !== null && target?.uncachedInputTokens !== undefined && target.hostElapsedMs !== null
      ? target.uncachedInputTokens >= 30 && target.hostElapsedMs >= 20 : null,
    limitations: "Actual reported host counters, not serialized token estimates or billed cost. Three authored families share one AppKit template; one pair per family with fixed AB/BA/AB order is a pilot, not a general benchmark.",
  };
}
