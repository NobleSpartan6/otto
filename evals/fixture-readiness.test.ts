import assert from "node:assert/strict";
import test from "node:test";
import type { NativeDriver, NativeSnapshot } from "../shared/types.js";
import { FixtureReadinessError, waitForFixtureReady } from "./fixture-readiness.js";

const appId = "12345", expected = { Name: "", Notes: "Initial literal" };
const snapshot = (): NativeSnapshot => ({ snapshotId: "snapshot", windowToken: "window", app: { id: appId, pid: 12345, name: "Owned fixture" },
  title: "Fixture", text: "", capturedAt: new Date().toISOString(), controls: Object.entries(expected).map(([label, value], index) => ({
    id: `field-${index}`, role: "AXTextField", label, value, enabled: true, editable: true, source: "accessibility", actions: ["fill"],
  })) });
function fake(observe: (attempt: number) => Promise<NativeSnapshot> | NativeSnapshot) {
  let reads = 0, cancels = 0;
  const driver: Pick<NativeDriver, "observe" | "cancel"> = {
    async observe(id) { assert.equal(id, appId); return observe(++reads); },
    cancel() { cancels++; },
  };
  return { driver, reads: () => reads, cancels: () => cancels };
}
const code = (wanted: FixtureReadinessError["code"]) => (error: unknown) => {
  assert.ok(error instanceof FixtureReadinessError); assert.equal(error.code, wanted);
  assert.doesNotMatch(error.message, /PRIVATE/); return true;
};
const quick = { intervalMs: 1, timeoutMs: 1000 };

test("readiness retries only the exact window startup error, then returns counters", async () => {
  const state = fake(attempt => { if (attempt === 1) throw new Error("The app has no accessible window. Open a window, then try again."); return snapshot(); });
  const result = await waitForFixtureReady(state.driver, appId, expected, quick);
  assert.equal(result.attempts, 2); assert.ok(result.elapsedMs >= 0); assert.deepEqual(Object.keys(result).sort(), ["attempts", "elapsedMs"]);
  assert.equal(state.reads(), 2); assert.equal(state.cancels(), 0);
  assert.deepEqual(Object.keys(state.driver).sort(), ["cancel", "observe"]);
});

test("incomplete initial controls or capabilities can settle without writes", async () => {
  for (const mutate of [
    (value: NativeSnapshot) => { value.controls.pop(); },
    (value: NativeSnapshot) => { value.controls[0]!.actions = []; },
    (value: NativeSnapshot) => { value.controls[0]!.enabled = false; },
  ]) {
    const state = fake(attempt => { const value = snapshot(); if (attempt === 1) mutate(value); return value; });
    assert.equal((await waitForFixtureReady(state.driver, appId, expected, quick)).attempts, 2);
    assert.equal(state.cancels(), 0);
  }
});

test("permission and unknown errors stop immediately without leaking native text", async () => {
  for (const message of ["Enable Accessibility permission for Otto in System Settings.", "PRIVATE_NATIVE_FAILURE",
    "The app has no accessible window. Open a window, then try again. PRIVATE_EXTRA"]) {
    const state = fake(() => { throw new Error(message); });
    await assert.rejects(waitForFixtureReady(state.driver, appId, expected, quick), code("native_error"));
    assert.equal(state.reads(), 1); assert.equal(state.cancels(), 0);
  }
});

test("wrong process, changed full values, duplicates and malformed snapshots never retry", async () => {
  const cases: Array<[FixtureReadinessError["code"], (value: NativeSnapshot) => unknown]> = [
    ["scope", value => { value.app.id = "other"; return value; }],
    ["scope", value => { value.app.pid++; return value; }],
    ["state_changed", value => { value.controls[1]!.value = "PRIVATE_CHANGE"; return value; }],
    ["state_changed", value => { value.controls.shift(); value.controls[0]!.value = "PRIVATE_CHANGE"; return value; }],
    ["ambiguous", value => { value.controls.push({ ...value.controls[0]!, id: "duplicate" }); return value; }],
    ["bad_snapshot", value => { delete value.windowToken; return value; }],
    ["bad_snapshot", value => { delete value.controls[0]!.value; return value; }],
    ["bad_snapshot", value => { value.controls[0]!.sensitive = true; return value; }],
    ["bad_snapshot", () => undefined],
    ["bad_snapshot", () => null],
    ["bad_snapshot", () => ({ PRIVATE: "malformed" })],
  ];
  for (const [errorCode, mutate] of cases) {
    const state = fake(() => mutate(snapshot()) as NativeSnapshot);
    await assert.rejects(waitForFixtureReady(state.driver, appId, expected, quick), code(errorCode));
    assert.equal(state.reads(), 1); assert.equal(state.cancels(), 0);
  }
});

test("deadline cancels a hung read once and returns without waiting for it", { timeout: 1000 }, async () => {
  const state = fake(() => new Promise<NativeSnapshot>(() => undefined));
  await assert.rejects(waitForFixtureReady(state.driver, appId, expected, { timeoutMs: 20, intervalMs: 1 }), code("timeout"));
  assert.equal(state.reads(), 1); assert.equal(state.cancels(), 1);
});

test("deadline also bounds repeated incomplete observations", { timeout: 1000 }, async () => {
  const state = fake(() => ({ ...snapshot(), controls: [] }));
  await assert.rejects(waitForFixtureReady(state.driver, appId, expected, { timeoutMs: 25, intervalMs: 1 }), code("timeout"));
  assert.ok(state.reads() >= 1); assert.equal(state.cancels(), 1);
});

test("abort cancels pending reads once; pre-abort performs no read", async () => {
  const controller = new AbortController();
  const state = fake(() => new Promise<NativeSnapshot>(() => undefined));
  const pending = waitForFixtureReady(state.driver, appId, expected, { signal: controller.signal, ...quick });
  controller.abort(); controller.abort();
  await assert.rejects(pending, code("cancelled"));
  assert.equal(state.reads(), 1); assert.equal(state.cancels(), 1);
  const never = fake(snapshot);
  await assert.rejects(waitForFixtureReady(never.driver, appId, expected, { signal: AbortSignal.abort(), ...quick }), code("cancelled"));
  assert.equal(never.reads(), 0); assert.equal(never.cancels(), 1);
});

test("successful completion removes cancellation handler and rejects bad options before reads", async () => {
  const controller = new AbortController(), state = fake(snapshot);
  await waitForFixtureReady(state.driver, appId, expected, { signal: controller.signal, ...quick });
  controller.abort(); assert.equal(state.cancels(), 0);
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: 3001 }, { intervalMs: 0 }, { intervalMs: Infinity }]) {
    const never = fake(snapshot);
    await assert.rejects(waitForFixtureReady(never.driver, appId, expected, options), code("invalid_input"));
    assert.equal(never.reads(), 0);
  }
});
