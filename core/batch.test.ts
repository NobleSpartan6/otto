import assert from "node:assert/strict";
import test from "node:test";
import { BatchEngine, BATCH_APPROVAL_TTL_MS } from "./batch.js";
import type { NativeAction, NativeDriver, NativeSnapshot } from "../shared/types.js";
import type { BatchInput } from "../shared/batch.js";

const input: BatchInput = { appId: "fixture", consent: true, fields: { First: "Ada", Last: "Lovelace", Email: "ada@example.test" } };
const app = { id: "fixture", name: "Fixture", pid: 100 };
class Driver implements NativeDriver {
  values = ["Original first", "Original last", "original@example.test"];
  actions: NativeAction[] = [];
  observations = 0;
  cancels = 0;
  snapshotId = "";
  permissions = true;
  mutate = (_snapshot: NativeSnapshot, _count: number) => {};
  async apps() { return { apps: [app], permissions: { accessibility: this.permissions, screenCapture: false, platform: "fixture" } }; }
  async configure(ids: string[]) { assert.deepEqual(ids, ["fixture"]); }
  async observe(): Promise<NativeSnapshot> {
    const count = ++this.observations;
    const snapshot: NativeSnapshot = { controlCoverage: "complete", snapshotId: `snapshot-${count}`, windowToken: "window-one", app: { ...app }, title: "Fixture form", text: "", capturedAt: new Date().toISOString(),
      controls: this.values.map((value, index) => ({ id: `control-${count}-${index}`, identity: `native-element-${index}`, role: "AXTextField", label: ["First", "Last", "Email"][index]!, value,
        enabled: true, editable: true, source: "accessibility", actions: ["fill"], bounds: { x: 20, y: 20 + index * 40, width: 200, height: 28 } })) };
    this.mutate(snapshot, count);
    this.snapshotId = snapshot.snapshotId;
    return snapshot;
  }
  async act(action: NativeAction) {
    assert.equal(action.kind, "fill"); assert.equal(action.nativeAction, "fill");
    assert.equal(action.appId, "fixture"); assert.equal(action.snapshotId, this.snapshotId);
    this.snapshotId = "";
    const index = Number(action.targetId!.split("-").at(-1));
    this.values[index] = action.value!;
    this.actions.push(structuredClone(action));
  }
  cancel() { this.cancels++; }
}
async function ready(engine: BatchEngine, value = input) { return engine.awaitIdle((await engine.prepare(value)).id); }
async function approve(engine: BatchEngine, id: string, approvalId: string) { await engine.approve(id, approvalId); return engine.awaitIdle(id); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

test("one immutable review fills all fields with fresh native bindings, verifies each and performs final readback", async () => {
  const driver = new Driver(); const engine = new BatchEngine(driver);
  const immediate = await engine.prepare(input); assert.equal(immediate.status, "preparing");
  const review = await engine.awaitIdle(immediate.id);
  assert.equal(review.status, "awaiting_approval"); assert.equal(driver.actions.length, 0);
  assert.deepEqual(review.fields.map(field => field.before), driver.values);
  review.fields[0]!.proposed = "Changed outside engine";
  const running = await engine.approve(review.id, review.approvalId!);
  assert.equal(running.status, "running"); assert.equal(running.approvalId, undefined);
  const result = await engine.awaitIdle(review.id);
  assert.equal(result.status, "completed"); assert.equal(result.verification, "native_readback");
  assert.deepEqual(driver.values, Object.values(input.fields));
  assert.deepEqual(result.metrics, { observations: 8, nativeActions: 3, modelCalls: 0 });
  assert.ok(result.fields.every(field => field.status === "verified" && field.after === field.proposed));
  assert.equal(engine.active, false);
});

test("preparation is all-or-nothing and rejects invalid shapes, missing fields, missing permissions and oversized values", async () => {
  const driver = new Driver(); const engine = new BatchEngine(driver);
  await assert.rejects(engine.prepare({ ...input, consent: false }));
  await assert.rejects(engine.prepare({ ...input, fields: { First: "x".repeat(2001) } }));
  await assert.rejects(engine.prepare({ ...input, fields: { First: "a", " First ": "b" } }));
  await assert.rejects(engine.prepare({ ...input, submit: true } as BatchInput));
  const result = await ready(engine, { ...input, fields: { First: "Ada", Unknown: "missing" } });
  assert.equal(result.status, "failed"); assert.equal(result.approvalId, undefined);
  assert.deepEqual(result.fields.map(field => field.status), ["skipped", "failed"]);
  assert.equal(driver.actions.length, 0);
  driver.permissions = false;
  assert.equal((await ready(engine)).status, "failed");
});

test("duplicate labels, protected controls, OCR, disabled fields and incomplete before-values cannot receive approval", async () => {
  for (const mutation of ["duplicate", "sensitive", "ocr", "disabled", "oversized", "missing_value", "missing_identity", "zero_bounds", "missing_bounds", "nonfinite_bounds"]) {
    const driver = new Driver();
    driver.mutate = snapshot => {
      if (mutation === "duplicate") snapshot.controls.push({ ...snapshot.controls[0]!, id: "duplicate" });
      if (mutation === "sensitive") snapshot.controls[0]!.sensitive = true;
      if (mutation === "ocr") snapshot.controls[0]!.source = "ocr";
      if (mutation === "disabled") snapshot.controls[0]!.enabled = false;
      if (mutation === "oversized") snapshot.controls[0]!.value = "x".repeat(2001);
      if (mutation === "missing_value") delete snapshot.controls[0]!.value;
      if (mutation === "missing_identity") delete snapshot.controls[0]!.identity;
      if (mutation === "zero_bounds") snapshot.controls[0]!.bounds!.width = 0;
      if (mutation === "missing_bounds") delete snapshot.controls[0]!.bounds;
      if (mutation === "nonfinite_bounds") snapshot.controls[0]!.bounds!.x = Number.NaN;
    };
    const result = await ready(new BatchEngine(driver));
    assert.equal(result.status, "failed", mutation); assert.equal(driver.actions.length, 0);
  }
});

test("unrelated menu/chrome geometry may change without weakening editable form identity checks", async () => {
  const driver = new Driver(); const engine = new BatchEngine(driver);
  driver.mutate = (snapshot, count) => {
    snapshot.controls.push({ id: `menu-${count}`, identity: `menu-native-${count}`, role: "AXMenuItem", label: "Unrelated menu", enabled: true,
      editable: false, source: "accessibility", actions: ["press"], bounds: { x: 0, y: 0, width: count === 1 ? 0 : 100, height: count === 1 ? 0 : 24 } });
  };
  const review = await ready(engine);
  assert.equal(review.status, "awaiting_approval");
  const result = await approve(engine, review.id, review.approvalId!);
  assert.equal(result.status, "completed"); assert.equal(driver.actions.length, 3);

  const changed = new Driver(); const changedEngine = new BatchEngine(changed);
  changed.mutate = (snapshot, count) => {
    snapshot.controls.push({ ...snapshot.controls[0]!, id: "unrequested", identity: count === 1 ? "original-extra" : "replacement-extra", label: "Unrequested field" });
  };
  const before = await ready(changedEngine, { ...input, fields: { First: "Ada" } });
  const failed = await approve(changedEngine, before.id, before.approvalId!);
  assert.equal(failed.status, "failed"); assert.equal(changed.actions.length, 0);
});

test("wrong process, missing window identity and changed form/window/bounds/remaining values fail closed", async () => {
  for (const mutation of ["pid", "missing_token", "window", "document", "identity", "label", "bounds", "value"]) {
    const driver = new Driver(); const engine = new BatchEngine(driver);
    driver.mutate = (snapshot, count) => {
      if (count !== 2) return;
      if (mutation === "pid") snapshot.app.pid++;
      if (mutation === "missing_token") delete snapshot.windowToken;
      if (mutation === "window") snapshot.windowToken = "other-window-same-title";
      if (mutation === "document") snapshot.documentToken = "changed-document";
      if (mutation === "identity") snapshot.controls[2]!.identity = "replacement-same-label-and-bounds";
      if (mutation === "label") snapshot.controls[2]!.label = "Other";
      if (mutation === "bounds") snapshot.controls[2]!.bounds!.x++;
      if (mutation === "value") snapshot.controls[2]!.value = "User edited";
    };
    const review = await ready(engine); const result = await approve(engine, review.id, review.approvalId!);
    assert.equal(result.status, "failed", mutation); assert.equal(driver.actions.length, 0, mutation);
  }
});

test("an expired or duplicate approval never replays writes", async t => {
  const driver = new Driver(); const engine = new BatchEngine(driver);
  const review = await ready(engine);
  const originalNow = Date.now();
  t.mock.method(Date, "now", () => originalNow + BATCH_APPROVAL_TTL_MS + 1);
  assert.equal((await engine.approve(review.id, review.approvalId!)).status, "expired");
  assert.equal(driver.actions.length, 0);
  t.mock.restoreAll();
  const second = await ready(engine);
  await engine.approve(second.id, second.approvalId!);
  await assert.rejects(engine.approve(second.id, second.approvalId!));
  await engine.awaitIdle(second.id);
  await assert.rejects(engine.approve(second.id, second.approvalId!));
  assert.equal(driver.actions.length, 3);
});

test("stop during observation revokes approval and holds the active slot until pending work settles", async () => {
  const driver = new Driver(); const engine = new BatchEngine(driver);
  const review = await ready(engine);
  const gate = deferred<NativeSnapshot>(); const nativeObserve = driver.observe.bind(driver);
  driver.observe = () => gate.promise;
  await engine.approve(review.id, review.approvalId!);
  assert.equal(engine.stop(review.id).status, "stopped"); assert.ok(driver.cancels > 0);
  await assert.rejects(engine.prepare(input));
  gate.resolve(await nativeObserve()); await engine.awaitIdle(review.id);
  assert.equal(driver.actions.length, 0); assert.equal(engine.active, false);
});

test("stop or ambiguous failure after dispatch reports an unverified write and never retries", async () => {
  for (const stopping of [true, false]) {
    const driver = new Driver(); const engine = new BatchEngine(driver); const review = await ready(engine);
    const gate = deferred<void>();
    driver.act = async action => { driver.actions.push(action); if (stopping) await gate.promise; else throw new Error("untrusted private diagnostic"); };
    await engine.approve(review.id, review.approvalId!);
    await new Promise(resolve => setImmediate(resolve));
    if (stopping) { engine.stop(review.id); gate.resolve(); }
    const result = await engine.awaitIdle(review.id);
    assert.equal(driver.actions.length, 1); assert.equal(result.fields[0]!.status, "failed");
    assert.equal(result.verification, undefined); assert.ok(!JSON.stringify(result).includes("untrusted private diagnostic"));
    assert.equal(result.fields[1]!.status, "skipped");
  }
});

test("post-write mismatch stops before the next field and records the observed value", async () => {
  const driver = new Driver(); const engine = new BatchEngine(driver);
  driver.act = async action => { driver.actions.push(action); driver.values[0] = "App rejected input"; };
  const review = await ready(engine); const result = await approve(engine, review.id, review.approvalId!);
  assert.equal(result.status, "failed"); assert.equal(driver.actions.length, 1);
  assert.equal(result.fields[0]!.after, "App rejected input"); assert.equal(result.fields[0]!.status, "failed");
  assert.equal(result.fields[1]!.status, "skipped");
});

test("final whole-batch readback catches an earlier field changing after later writes", async () => {
  const driver = new Driver(); const engine = new BatchEngine(driver);
  driver.mutate = (snapshot, count) => { if (count === 8) snapshot.controls[0]!.value = "Changed after verification"; };
  const review = await ready(engine); const result = await approve(engine, review.id, review.approvalId!);
  assert.equal(result.status, "failed"); assert.equal(result.verification, undefined);
  assert.equal(result.fields[0]!.status, "failed"); assert.equal(driver.actions.length, 3);
});

test("already-correct fields are skipped and still included in final exact readback", async () => {
  const driver = new Driver(); driver.values[0] = "Ada"; const engine = new BatchEngine(driver);
  const review = await ready(engine); const result = await approve(engine, review.id, review.approvalId!);
  assert.equal(result.status, "completed"); assert.equal(result.fields[0]!.status, "skipped");
  assert.equal(result.fields[0]!.after, "Ada"); assert.equal(driver.actions.length, 2);
});

// In-memory acquisition failures: the returned fields remain identical, so only
// the coverage signal distinguishes these observations from a complete tree.
const incompleteCoverage = ["partial", "unknown", undefined] as const;
const coverageFailure = /Native form coverage is incomplete or unknown/;
function loseCoverage(driver: Driver, observation: number, coverage: typeof incompleteCoverage[number]) {
  driver.mutate = (snapshot, count) => {
    if (count !== observation) return;
    if (coverage === undefined) delete snapshot.controlCoverage;
    else snapshot.controlCoverage = coverage;
  };
}

test("batch coverage: incomplete acquisition cannot create an approval", async () => {
  for (const coverage of incompleteCoverage) {
    const driver = new Driver(); const engine = new BatchEngine(driver);
    const before = [...driver.values];
    loseCoverage(driver, 1, coverage);
    const result = await ready(engine);
    assert.equal(result.status, "failed", String(coverage));
    assert.match(result.error!, coverageFailure);
    assert.equal(result.approvalId, undefined);
    assert.equal(result.verification, undefined);
    assert.deepEqual(result.metrics, { observations: 1, nativeActions: 0, modelCalls: 0 });
    assert.ok(result.fields.every(field => field.status === "skipped"));
    assert.deepEqual(driver.values, before);
    assert.equal(driver.actions.length, 0);
    assert.equal(driver.cancels, 1);
    assert.equal(engine.active, false);
  }
});

test("batch coverage: loss before first dispatch consumes approval without writing", async () => {
  for (const coverage of incompleteCoverage) {
    const driver = new Driver(); const engine = new BatchEngine(driver);
    const before = [...driver.values];
    const review = await ready(engine);
    assert.equal(review.status, "awaiting_approval");
    loseCoverage(driver, 2, coverage);
    const result = await approve(engine, review.id, review.approvalId!);
    assert.equal(result.status, "failed", String(coverage));
    assert.match(result.error!, coverageFailure);
    assert.equal(result.verification, undefined);
    assert.equal(result.approvalId, undefined);
    assert.deepEqual(result.metrics, { observations: 2, nativeActions: 0, modelCalls: 0 });
    assert.deepEqual(driver.values, before);
    await assert.rejects(engine.approve(review.id, review.approvalId!));
    assert.equal(driver.actions.length, 0);
    assert.equal(driver.observations, 2, "coverage rejection must not retry observation");
    assert.equal(engine.active, false);
  }
});

test("batch coverage: loss before a later dispatch preserves verified edits without replay", async () => {
  for (const coverage of incompleteCoverage) for (const observation of [4, 6]) {
    const driver = new Driver(); const engine = new BatchEngine(driver);
    const before = [...driver.values];
    const review = await ready(engine);
    loseCoverage(driver, observation, coverage);
    const result = await approve(engine, review.id, review.approvalId!);
    const written = observation === 4 ? 1 : 2;
    assert.equal(result.status, "failed", `${coverage} at ${observation}`);
    assert.match(result.error!, coverageFailure);
    assert.equal(result.verification, undefined);
    assert.equal(result.approvalId, undefined);
    assert.deepEqual(result.metrics, { observations: observation, nativeActions: written, modelCalls: 0 });
    assert.deepEqual(driver.values, before.map((value, index) => index < written ? Object.values(input.fields)[index] : value));
    assert.ok(result.fields.slice(0, written).every(field => field.status === "verified" && field.after === field.proposed));
    assert.equal(result.fields[written]!.status, "failed");
    assert.ok(result.fields.slice(written + 1).every(field => field.status === "skipped"));
    await assert.rejects(engine.approve(review.id, review.approvalId!));
    assert.equal(driver.actions.length, written);
    assert.equal(driver.observations, observation, "no replay, rollback or extra observation");
    assert.equal(engine.active, false);
  }
});

test("batch coverage: incomplete readback leaves the dispatched fill unverified", async () => {
  for (const coverage of incompleteCoverage) {
    const driver = new Driver(); const engine = new BatchEngine(driver);
    const before = [...driver.values];
    const review = await ready(engine);
    loseCoverage(driver, 3, coverage);
    const result = await approve(engine, review.id, review.approvalId!);
    assert.equal(result.status, "failed", String(coverage));
    assert.match(result.error!, coverageFailure);
    assert.match(result.error!, /earlier writes may remain/);
    assert.equal(result.verification, undefined);
    assert.equal(result.approvalId, undefined);
    assert.deepEqual(result.metrics, { observations: 3, nativeActions: 1, modelCalls: 0 });
    assert.equal(result.fields[0]!.status, "failed", "dispatch is not verified readback");
    assert.ok(result.fields.slice(1).every(field => field.status === "skipped"));
    assert.deepEqual(driver.values, [input.fields.First, ...before.slice(1)], "the applied effect is retained");
    await assert.rejects(engine.approve(review.id, review.approvalId!));
    assert.equal(driver.actions.length, 1);
    assert.equal(driver.observations, 3);
    assert.equal(engine.active, false);
  }
});

test("batch coverage: final acquisition loss cannot upgrade individual readbacks to batch completion", async () => {
  for (const coverage of incompleteCoverage) {
    const driver = new Driver(); const engine = new BatchEngine(driver);
    const review = await ready(engine);
    loseCoverage(driver, 8, coverage);
    const result = await approve(engine, review.id, review.approvalId!);
    assert.equal(result.status, "failed", String(coverage));
    assert.match(result.error!, coverageFailure);
    assert.equal(result.verification, undefined);
    assert.equal(result.approvalId, undefined);
    assert.deepEqual(result.metrics, { observations: 8, nativeActions: 3, modelCalls: 0 });
    assert.deepEqual(driver.values, Object.values(input.fields));
    assert.ok(result.fields.every(field => field.status === "verified" && field.after === field.proposed), "earlier complete readbacks remain historical evidence");
    await assert.rejects(engine.approve(review.id, review.approvalId!));
    assert.equal(driver.actions.length, 3);
    assert.equal(driver.observations, 8);
    assert.equal(engine.active, false);
  }
});

test("batch coverage: complete native frames beyond compact limits still verify exact values", async () => {
  const driver = new Driver(); const engine = new BatchEngine(driver);
  const before = [...driver.values];
  driver.mutate = snapshot => {
    // The editable targets occur after the MCP response's 128-row maximum.
    // BatchEngine operates on the full native acquisition, not that serializer.
    for (let index = 0; index < 130; index++) snapshot.controls.unshift({
      id: `static-${index}`, identity: `static-identity-${index}`, role: "AXStaticText", label: `Static ${index}`,
      enabled: true, editable: false, source: "accessibility", actions: [],
    });
  };
  const value = "東京".repeat(300);
  const review = await ready(engine, { ...input, fields: { First: value } });
  assert.equal(review.status, "awaiting_approval");
  assert.equal(review.fields[0]!.before, before[0]);
  assert.equal(driver.actions.length, 0);
  const result = await approve(engine, review.id, review.approvalId!);
  assert.equal(result.status, "completed");
  assert.equal(result.verification, "native_readback");
  assert.deepEqual(result.metrics, { observations: 4, nativeActions: 1, modelCalls: 0 });
  assert.equal(result.fields[0]!.after, value);
  assert.deepEqual(driver.values, [value, ...before.slice(1)]);
  assert.equal(driver.actions[0]!.targetId, "control-2-0");
  assert.equal(driver.cancels, 1);
  assert.equal(engine.active, false);
});
