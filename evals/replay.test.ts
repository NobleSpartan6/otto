import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { SUITE_VERSION } from "./native-contracts.js";
import { MAX_REPORT_BYTES, readReport, regradeReport } from "./replay.js";
import { schedule } from "./plan.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifact = new URL("../docs/evidence/native-contracts-2026-09-20.json", import.meta.url);
const currentHash = createHash("sha256").update(await readFile(new URL("./native-contracts.ts", import.meta.url))).digest("hex");
const saved = JSON.parse(await readFile(artifact, "utf8"));
const copy = () => structuredClone(saved);

test("published native evidence regrades all ten cases without changing the original artifact", () => {
  const report = copy(), before = JSON.stringify(report);
  const result = regradeReport(report, currentHash);
  assert.equal(result.currentResult, "passed");
  assert.equal(result.summary.scheduled, 10); assert.equal(result.summary.contractPassed, 10);
  assert.deepEqual(result.summary.nominalGoals, { completed: 6, scheduled: 6 });
  assert.deepEqual(result.summary.expectedStops, { passed: 4, scheduled: 4 });
  assert.equal(result.originalGraderSha256, report.hashes["evals/native-contracts.ts"]);
  assert.equal(result.currentGraderSha256, currentHash);
  assert.equal(result.graderChanged, true);
  assert.equal(JSON.stringify(report), before);
});

test("forged stored grades and summary cannot hide wrong independent evidence", () => {
  const report = copy();
  const row = report.trials.find((item: { caseId: string }) => item.caseId === "exact-standard-six");
  row.evidence.after.fields.Notes.value = "PRIVATE_WRONG_VALUE";
  row.grade = { contractPassed: true, goalCompleted: true }; report.summary = { contractPassed: 10 };
  const result = regradeReport(report, currentHash);
  assert.equal(result.originalReportedStatus, "passed"); assert.equal(result.currentResult, "failed");
  assert.equal(result.summary.contractPassed, 9); assert.equal(result.summary.contractFailed, 1);
  assert.equal(result.summary.forbiddenSideEffectCases, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_WRONG_VALUE/);
});

test("not_run stays ungraded even with complete evidence and a forged passing grade", () => {
  const report = copy(); report.trials[0].status = "not_run";
  const result = regradeReport(report, currentHash);
  assert.equal(result.summary.scheduled, 10); assert.equal(result.summary.notRun, 1);
  assert.equal(result.summary.started, 9); assert.equal(result.summary.contractPassed, 9);
  assert.equal(result.trials[0]!.status, "not_run"); assert.equal(result.trials[0]!.grade, undefined);
  assert.equal(result.currentResult, "failed");
});

test("dropping a failed or unrun trial cannot shrink the planned denominator", () => {
  for (const status of ["failed", "not_run"]) {
    const report = copy();
    report.trials[0].status = status;
    report.trials[0].evidence.errors.push("Synthetic harness failure");
    assert.equal(regradeReport(report, currentHash).currentResult, "failed");
    report.trials.shift();
    report.trials.forEach((row: any, index: number) => { row.index = index + 1; });
    assert.throws(() => regradeReport(report, currentHash), /Trial count differs/);
  }
});

test("missing or invalid options and altered schedule identities are rejected", () => {
  for (const mutate of [
    (report: any) => { delete report.options; },
    (report: any) => { report.options = {}; },
    (report: any) => { report.options.seed = "42"; },
    (report: any) => { report.options.seed = 0; },
    (report: any) => { report.options.repetitions = 2; },
    (report: any) => { report.options.caseId = "unknown"; },
    (report: any) => { report.options.run = false; },
    (report: any) => { report.options.seed = 42; },
    (report: any) => { [report.trials[0].index, report.trials[1].index] = [report.trials[1].index, report.trials[0].index]; },
    (report: any) => { report.trials[0].family = "invented"; },
  ]) { const report = copy(); mutate(report); assert.throws(() => regradeReport(report, currentHash)); }
});

test("legitimate selected-case and three-repetition schedules keep their full denominators", () => {
  for (const repetitions of [1, 3]) {
    const report = copy();
    report.options = { run: true, repetitions, seed: 42, ...(repetitions === 1 ? { caseId: "exact-standard-six" } : {}) };
    // Synthetic protocol records exercise scheduling, not new native execution.
    report.trials = schedule(report.options).map(item => {
      const row = structuredClone(saved.trials.find((entry: any) => entry.caseId === item.caseId));
      for (const oracle of [row.evidence.before, row.evidence.after, ...row.evidence.checkpoints]) oracle.launchId += `-synthetic-r${item.repetition}`;
      return { ...row, ...item };
    });
    const result = regradeReport(report, currentHash);
    assert.equal(result.currentResult, "passed"); assert.equal(result.planValidated, true);
    assert.equal(result.summary.scheduled, repetitions === 1 ? 1 : 30);
  }
});

test("the same fixture evidence cannot be counted as another fresh trial", () => {
  const report = copy();
  const launch = report.trials[0].evidence.before.launchId;
  for (const oracle of [report.trials[1].evidence.before, report.trials[1].evidence.after, ...report.trials[1].evidence.checkpoints]) oracle.launchId = launch;
  assert.throws(() => regradeReport(report, currentHash), /reuse the same recorded fixture launch/);
});

test("an interrupted trial cannot pass even when its saved final values look correct", () => {
  const report = copy(); report.status = "running";
  report.trials[0].status = "running";
  report.trials[0].phase = "cleanup_pending";
  const result = regradeReport(report, currentHash);
  assert.equal(result.currentResult, "failed"); assert.equal(result.reportComplete, false);
  assert.equal(result.summary.scheduled, 10); assert.equal(result.summary.unfinished, 1);
  assert.equal(result.summary.evidenceIncomplete, 1); assert.equal(result.summary.contractPassed, 9);
  assert.equal(result.trials[0]!.grade?.goalCompleted, true);
  assert.ok(result.trials[0]!.grade?.failures.includes("trial_interrupted_before_finalization"));
});

test("an unfinished report is not promoted to completed by passing terminal rows", () => {
  const report = copy(); report.status = "running";
  const result = regradeReport(report, currentHash);
  assert.equal(result.summary.contractPassed, 10); assert.equal(result.currentResult, "failed");
  assert.equal(result.reportComplete, false);
});

test("suite-level infrastructure failure cannot be hidden by passing trial grades", () => {
  const report = copy(); report.status = "failed"; report.fatal = "PRIVATE_STORAGE_FAILURE";
  const result = regradeReport(report, currentHash);
  assert.equal(result.summary.contractPassed, 10); assert.equal(result.currentResult, "failed");
  assert.equal(result.harnessFailed, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_STORAGE_FAILURE/);
});

test("missing evidence fails every started record while retaining unrun counts", () => {
  const report = copy();
  report.trials[0].status = "not_run";
  for (const row of report.trials) delete row.evidence;
  const result = regradeReport(report, currentHash);
  assert.equal(result.summary.notRun, 1); assert.equal(result.summary.contractFailed, 9);
  assert.equal(result.summary.evidenceIncomplete, 9); assert.equal(result.summary.contractPassed, 0);
  assert.equal(result.summary.goalCompleted, 0);
});

test("invalid schema, suite, hashes, scheduling identity and status are rejected", () => {
  for (const mutate of [
    (report: any) => { report.schemaVersion = 2; },
    (report: any) => { report.suiteVersion = SUITE_VERSION + "-different"; },
    (report: any) => { report.hashes = []; },
    (report: any) => { report.hashes = { grader: "invalid" }; },
    (report: any) => { report.trials[0].caseId = "unknown"; },
    (report: any) => { report.trials[1] = { ...report.trials[0], index: 2 }; },
    (report: any) => { report.trials[1].index = report.trials[0].index; },
    (report: any) => { report.trials[0].repetition = 0; },
    (report: any) => { report.trials[0].status = "success"; },
    (report: any) => { report.trials = []; },
  ]) {
    const report = copy(); mutate(report);
    assert.throws(() => regradeReport(report, currentHash));
  }
  for (const report of [undefined, null, [], {}, "not a report"]) assert.throws(() => regradeReport(report, currentHash));
});

test("missing historical hash is unknown, and equal hashes are explicitly unchanged", () => {
  const report = copy(); report.hashes = {};
  const unknown = regradeReport(report, currentHash);
  assert.equal(unknown.originalGraderSha256, null); assert.equal(unknown.graderChanged, null);
  report.hashes["evals/native-contracts.ts"] = currentHash;
  assert.equal(regradeReport(report, currentHash).graderChanged, false);
});

test("reader permits the exact byte limit and rejects large, non-file, invalid UTF-8 and invalid JSON inputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "otto-replay-test-"));
  try {
    const path = join(directory, "report.json");
    await writeFile(path, "{}" + " ".repeat(MAX_REPORT_BYTES - 2));
    assert.deepEqual(await readReport(path), {});
    await writeFile(path, Buffer.alloc(MAX_REPORT_BYTES + 1));
    await assert.rejects(readReport(path), /4 MiB/);
    await assert.rejects(readReport(directory), /regular file/);
    await writeFile(path, Buffer.from([0xc3, 0x28]));
    await assert.rejects(readReport(path), /valid UTF-8/);
    await writeFile(path, "PRIVATE_NOT_JSON");
    await assert.rejects(readReport(path), { message: "Report must contain valid JSON." });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("CLI help needs no report, and one saved file prints recomputed counts and hashes", () => {
  const cli = fileURLToPath(new URL("./replay.ts", import.meta.url));
  for (const args of [[], ["--help"]]) {
    const text = execFileSync(process.execPath, ["--import", "tsx", cli, ...args], { cwd: root, encoding: "utf8" });
    assert.match(text, /Usage: npm run eval:replay/); assert.doesNotMatch(text, /currentResult/);
  }
  const text = execFileSync(process.execPath, ["--import", "tsx", cli, fileURLToPath(artifact)], { cwd: root, encoding: "utf8" });
  const result = JSON.parse(text);
  assert.equal(result.currentResult, "passed"); assert.equal(result.graderChanged, true);
  assert.equal(result.summary.contractPassed, 10);
  assert.match(result.replaySha256, /^[a-f0-9]{64}$/); assert.match(result.scheduleSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => execFileSync(process.execPath, ["--import", "tsx", cli, "one.json", "two.json"], { cwd: root, stdio: "pipe" }));
});
