import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CASES, SUITE_VERSION, gradeCase, type ContractEvidence } from "./native-contracts.js";

export const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const GRADER_FILE = "evals/native-contracts.ts";
const statuses = ["not_run", "running", "passed", "failed"] as const;
type TrialStatus = typeof statuses[number];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const integer = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= max;
function requireValid(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

/** Rechecks supplied records; it cannot authenticate a log or establish new execution. */
export function regradeReport(report: unknown, currentGraderSha256: string) {
  requireValid(sha256(currentGraderSha256), "Invalid current grader SHA-256.");
  requireValid(record(report) && report.schemaVersion === 1, "Expected a schemaVersion 1 report object.");
  requireValid(report.suiteVersion === SUITE_VERSION, "Report suiteVersion does not match the current suite.");
  requireValid(record(report.hashes) && Object.values(report.hashes).every(sha256), "Report hashes must contain SHA-256 values.");
  requireValid(report.status === undefined || report.status === "passed" || report.status === "failed", "Invalid reported suite status.");
  requireValid(Array.isArray(report.trials) && report.trials.length > 0 && report.trials.length <= CASES.length * 3, "Expected 1–30 scheduled trials.");
  const records = report.trials;
  const seen = new Set<string>(), indexes = new Set<number>();
  const originalStatusCounts = { not_run: 0, running: 0, passed: 0, failed: 0 };
  const trials = records.map((row: unknown) => {
    requireValid(record(row), "Malformed trial record.");
    const testCase = CASES.find(item => item.id === row.caseId);
    requireValid(testCase, "Unknown trial caseId.");
    requireValid(integer(row.index, records.length) && !indexes.has(row.index), "Invalid or duplicated trial index.");
    requireValid(integer(row.repetition, 3), "Trial repetition must be 1–3.");
    requireValid(statuses.includes(row.status as TrialStatus), "Invalid trial status.");
    const identity = `${testCase.id}:${row.repetition}`;
    requireValid(!seen.has(identity), "Duplicated caseId and repetition.");
    seen.add(identity); indexes.add(row.index);
    const originalStatus = row.status as TrialStatus;
    originalStatusCounts[originalStatus]++;
    // A scheduled but unrun row is never promoted using supplied/forged evidence.
    const grade = originalStatus === "not_run" ? undefined : gradeCase(testCase, row.evidence as ContractEvidence);
    return { index: row.index, caseId: testCase.id, repetition: row.repetition, originalStatus,
      status: originalStatus === "not_run" ? "not_run" as const : grade!.contractPassed ? "passed" as const : "failed" as const,
      ...(grade ? { grade } : {}) };
  });
  const nominal = trials.filter(row => CASES.find(item => item.id === row.caseId)!.goalExpected);
  const stops = trials.filter(row => !CASES.find(item => item.id === row.caseId)!.goalExpected);
  const summary = {
    scheduled: trials.length, started: trials.length - originalStatusCounts.not_run, notRun: originalStatusCounts.not_run,
    contractPassed: trials.filter(row => row.grade?.contractPassed).length,
    contractFailed: trials.filter(row => row.grade && !row.grade.contractPassed).length,
    evidenceIncomplete: trials.filter(row => row.grade && !row.grade.evidenceComplete).length,
    goalCompleted: trials.filter(row => row.grade?.goalCompleted).length,
    nominalGoals: { completed: nominal.filter(row => row.grade?.goalCompleted).length, scheduled: nominal.length },
    expectedStops: { passed: stops.filter(row => row.grade?.contractPassed && row.grade.expectedStop).length, scheduled: stops.length },
    forbiddenSideEffectCases: trials.filter(row => row.grade?.forbiddenSideEffects.length).length,
  };
  const originalGraderSha256 = (report.hashes[GRADER_FILE] as string | undefined)?.toLowerCase() ?? null;
  const currentHash = currentGraderSha256.toLowerCase();
  return {
    mode: "offline-regrade", suiteVersion: SUITE_VERSION,
    originalGraderSha256, currentGraderSha256: currentHash,
    graderChanged: originalGraderSha256 === null ? null : originalGraderSha256 !== currentHash,
    originalReportedStatus: report.status ?? null, originalStatusCounts,
    currentResult: summary.contractPassed === summary.scheduled ? "passed" : "failed",
    summary, trials,
    scope: "Regraded supplied evidence only. No native, model, or network execution; this does not authenticate the logs or prove a new run.",
  };
}

/** Bounded, strict UTF-8 read from a regular file, including a post-stat growth bound. */
export async function readReport(path: string): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    requireValid(stat.isFile(), "Report must be a regular file.");
    requireValid(stat.size <= MAX_REPORT_BYTES, "Report exceeds the 4 MiB limit.");
    const bytes = Buffer.alloc(MAX_REPORT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    requireValid(length <= MAX_REPORT_BYTES, "Report exceeds the 4 MiB limit.");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)); }
    catch { throw new Error("Report must contain valid UTF-8."); }
    try { return JSON.parse(text) as unknown; }
    catch { throw new Error("Report must contain valid JSON."); }
  } finally { await file.close(); }
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && args[0] === "--help") {
    console.log("Usage: npm run eval:replay -- PATH/TO/report.json\nRegrade saved native-contract evidence offline (regular UTF-8 JSON file, at most 4 MiB).\nNo desktop or model is used. No arguments reads no report or grader file. Replay cannot authenticate logs.");
    return 0;
  }
  requireValid(args.length === 1 && !args[0]!.startsWith("-"), "Supply exactly one report path, or --help.");
  const report = await readReport(args[0]!);
  const currentGraderSha256 = createHash("sha256").update(await readFile(new URL("./native-contracts.ts", import.meta.url))).digest("hex");
  const result = regradeReport(report, currentGraderSha256);
  console.log(JSON.stringify(result, null, 2));
  return result.currentResult === "passed" ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : "Replay failed." }));
    process.exitCode = 1;
  }
}
