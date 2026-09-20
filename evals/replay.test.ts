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
  assert.throws(() => execFileSync(process.execPath, ["--import", "tsx", cli, "one.json", "two.json"], { cwd: root, stdio: "pipe" }));
});
