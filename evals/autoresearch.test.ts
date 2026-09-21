import assert from "node:assert/strict";
import test from "node:test";
import { researchArgs } from "./autoresearch.js";

test("research defaults cannot launch native work or request a provider run", () => {
  assert.deepEqual(researchArgs([]), { run: false, jev: false, baseline: undefined });
  assert.equal(researchArgs(["--jev"]).run, false);
});
test("execution requires an explicit frozen baseline and rejects ambiguous flags", () => {
  for (const args of [["--run"], ["--run", "--baseline-protocol"], ["--run", "--baseline-protocol", "--jev"], ["--run", "--run"], ["--publish"]])
    assert.throws(() => researchArgs(args));
  assert.deepEqual(researchArgs(["--run", "--baseline-protocol", "baseline.json", "--jev"]), { run: true, jev: true, baseline: "baseline.json" });
});
