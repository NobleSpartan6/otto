import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CASES } from "./native-contracts.js";
import { parseLaunch, parseOptions, schedule, summary } from "../tests/native/contract-suite.js";

test("native evaluation defaults to a non-executing plan and bounds explicit runs", () => {
  assert.equal(parseOptions([]).run, false);
  assert.equal(parseOptions(["--run", "--repetitions", "3", "--seed", "42"]).run, true);
  for (const args of [["--repetitions", "0"], ["--repetitions", "4"], ["--seed", "0"], ["--seed", "4294967296"], ["--case", "missing"], ["--run", "--run"], ["--unknown"], ["--seed", "1.5"]])
    assert.throws(() => parseOptions(args));
});

test("fixture cleanup accepts only complete identities inside the launcher's temporary directory", () => {
  const directory = join(tmpdir(), "otto-form-eval-owned-test");
  const appPath = join(directory, "OttoFormFixture.app");
  const launch = { pid: 12345, appId: "12345", appPath, executable: join(appPath, "Contents/MacOS/OttoFormFixture"), statePath: join(directory, "state.json") };
  assert.deepEqual(parseLaunch(JSON.stringify(launch)), launch);
  for (const value of [null, {}, { ...launch, pid: process.pid }, { ...launch, appId: "other" },
    { ...launch, statePath: join(tmpdir(), "unrelated.json") }, { ...launch, executable: process.execPath }, { ...launch, appPath: "relative/path" }])
    assert.throws(() => parseLaunch(JSON.stringify(value)));
  assert.throws(() => parseLaunch("not JSON"));
});

test("seeded scheduling preserves every case/repetition without treating repeats as new cases", () => {
  const options = parseOptions(["--seed", "42", "--repetitions", "3"]);
  const rows = schedule(options);
  assert.deepEqual(rows, schedule(options));
  assert.equal(rows.length, CASES.length * 3);
  assert.equal(new Set(rows.map(row => `${row.caseId}:${row.repetition}`)).size, rows.length);
  for (const item of CASES) assert.equal(rows.filter(row => row.caseId === item.id).length, 3);
  assert.deepEqual(schedule(parseOptions(["--case", CASES[0]!.id])).map(row => row.caseId), [CASES[0]!.id]);
});

test("summary retains unrun trials and separates expected refusal from goal completion", () => {
  const plan = schedule(parseOptions([]));
  const rows = plan.map(item => ({ ...item, status: "not_run" as const, toolCalls: 0,
    evidence: { before: undefined, after: undefined, responses: [], runtimeUnchanged: false, errors: [] } }));
  const totals = summary(rows);
  assert.equal(totals.scheduled, CASES.length); assert.equal(totals.started, 0);
  assert.equal(totals.notRun, CASES.length); assert.equal(totals.contractPassed, 0);
  assert.equal(totals.nominalGoals.scheduled + totals.expectedStops.scheduled, CASES.length);
  assert.equal(totals.goalCompleted, 0); assert.equal(totals.providerTokenUsage, null); assert.equal(totals.billedCost, null);
});

test("the actual default CLI prints its complete plan without a native prerequisite", { timeout: 15_000 }, () => {
  const script = fileURLToPath(new URL("../tests/native/contract-suite.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx", script], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, "plan-only"); assert.equal(plan.modelCalls, 0);
  assert.equal(plan.trials.length, CASES.length);
  assert.match(plan.instruction, /No apps launched/);
});
