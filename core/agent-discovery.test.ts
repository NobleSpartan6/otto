import assert from "node:assert/strict";
import test from "node:test";
import { AgentSession, AgentSessionError } from "./agent-session.js";
import { DeveloperError, DeveloperSession, type InspectLimits } from "./developer.js";
import type { NativeAction, NativeControl, NativeDriver, NativeSnapshot } from "../shared/types.js";

const app = { id: "discovery-fixture", name: "Discovery fixture", pid: 123 };
const targetIndex = 140;
/** In-memory contracts only: no native UI, provider calls, or benchmark evidence. */
class Driver implements NativeDriver {
  values = Array.from({ length: 150 }, (_, index) => `Before ${index}`);
  observed = 0;
  actions: NativeAction[] = [];
  mutate = (_snapshot: NativeSnapshot) => {};
  async apps() { return { apps: [app], permissions: { accessibility: true, screenCapture: false, platform: "fixture" } }; }
  async configure(_ids: string[]) {}
  async observe(): Promise<NativeSnapshot> {
    const count = ++this.observed;
    const snapshot: NativeSnapshot = {
      controlCoverage: "complete", snapshotId: `snapshot-${count}`, app: { ...app },
      title: "Same title", windowToken: "window-1", documentToken: "document-1", text: "Unrelated text",
      capturedAt: new Date().toISOString(), screenshot: "PRIVATE_SCREENSHOT",
      controls: this.values.map((value, index): NativeControl => ({
        id: `field-${index}-${count}`, identity: `native-field-${index}`, role: "AXTextField",
        label: index === targetIndex ? "Destination" : `Other ${index}`, value,
        enabled: true, editable: true, source: "accessibility", actions: ["fill"],
      })),
    };
    this.mutate(snapshot);
    return snapshot;
  }
  async act(action: NativeAction) {
    assert.equal(action.appId, app.id);
    assert.equal(action.snapshotId, `snapshot-${this.observed}`);
    this.actions.push(structuredClone(action));
    const index = this.values.findIndex((_, index) => action.targetId === `field-${index}-${this.observed}`);
    assert.ok(index >= 0);
    this.values[index] = action.value!;
  }
  cancel() {}
}
function fixture() { const driver = new Driver(); return { driver, session: new AgentSession(driver, [app.id]) }; }
const limits = (): InspectLimits => ({ maxControls: 1, maxTextChars: 0, query: { label: "Destination" } });
const code = (expected: AgentSessionError["code"]) => (error: unknown) => error instanceof AgentSessionError && error.code === expected;
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }

test("query finds a native field beyond the response cap and its alias rebinds the right target", async () => {
  const { driver, session } = fixture();
  const ordinary = await session.inspect(app.id, { maxControls: 128 });
  assert.equal(ordinary.controls.length, 128);
  assert.equal(ordinary.discovery, undefined);
  assert.equal(ordinary.controls.some(control => control.label === "Destination"), false);
  const found = await session.inspect(app.id, limits());
  assert.deepEqual(found.discovery, { scope: "selected_native_tree", observedMatches: 1, totalMatches: 1, matchesOmitted: 0 });
  assert.equal(found.controls[0]!.label, "Destination");
  assert.equal(found.controls[0]!.ref, "c1");
  assert.equal(found.truncation.controlsOmitted, 149, "filtered rows remain omitted in the whole-observation count");
  assert.equal(found.text, "");
  assert.doesNotMatch(JSON.stringify(found), /PRIVATE_SCREENSHOT|native-field|field-140/);
  const result = await session.act({ snapshotToken: found.snapshotToken, ref: "c1", operation: "fill", value: "Exact destination" });
  assert.equal(result.outcome, "verified");
  assert.equal(driver.actions[0]!.targetId, "field-140-3");
  assert.equal(driver.values[0], "Before 0");
  assert.equal(driver.values[targetIndex], "Exact destination");
  assert.equal(result.observation.controls[0]!.value, "Exact destination");
  assert.equal(result.observation.discovery!.totalMatches, 1);
});

test("duplicate native targets beyond a one-row cap remain counted and cannot verify a unique label", async () => {
  const { driver, session } = fixture();
  driver.mutate = snapshot => { snapshot.controls[149]!.label = "Destination"; };
  const found = await session.inspect(app.id, limits());
  assert.equal(found.controls.length, 1);
  assert.deepEqual(found.discovery, { scope: "selected_native_tree", observedMatches: 2, totalMatches: 2, matchesOmitted: 1 });
  assert.deepEqual(session.matchesValues({ Destination: driver.values[targetIndex]! }), [{ label: "Destination", matched: false }]);
  const context = new DeveloperSession();
  const compact = context.inspect(await driver.observe(), limits());
  assert.deepEqual(context.prepareFill({ snapshotToken: compact.snapshotToken, fields: { Destination: "New" } }).unresolved,
    [{ field: "Destination", reason: "ambiguous_label" }]);
  assert.equal(driver.actions.length, 0);
});

test("partial traversal and unknown coverage never turn one or zero visible matches into exact totals", async () => {
  for (const coverage of ["partial", "unknown", undefined] as const) {
    const { driver, session } = fixture();
    driver.mutate = snapshot => { snapshot.controlCoverage = coverage; };
    const found = await session.inspect(app.id, limits());
    assert.deepEqual(found.discovery, { scope: "selected_native_tree", observedMatches: 1, totalMatches: null, matchesOmitted: 0 });
    assert.equal(found.controlCoverage, coverage ?? "unknown");
    assert.deepEqual(session.matchesValues({ Destination: driver.values[targetIndex]! }), [{ label: "Destination", matched: false }]);
    assert.throws(() => session.pinFields(["c1"]), code("stale_snapshot"));
    const absent = await session.inspect(app.id, { query: { label: "Not observed" } });
    assert.equal(absent.controls.length, 0);
    assert.equal(absent.discovery!.observedMatches, 0);
    assert.equal(absent.discovery!.totalMatches, null);
    assert.equal(driver.actions.length, 0);
  }
});

test("exact normalized labels and roles filter native controls without OCR or sensitive matches", async () => {
  const { driver, session } = fixture();
  driver.mutate = snapshot => {
    const target = snapshot.controls[targetIndex]!;
    target.label = "Re\u0301sume\u0301";
    snapshot.controls[149]!.label = "Résumé";
    snapshot.controls[149]!.role = "AXTextArea";
    snapshot.controls.push({ ...target, id: "ocr", identity: undefined, source: "ocr" });
    snapshot.controls.push({ ...target, id: "protected", identity: "protected-native", sensitive: true, value: "private-canary" });
    target.value = "private-canary";
    snapshot.text = "private-canary";
  };
  const found = await session.inspect(app.id, { query: { label: " Résumé ", role: "AXTextField" } });
  assert.equal(found.discovery!.totalMatches, 1);
  assert.equal(found.controls.length, 1);
  assert.equal(found.sensitiveControlsOmitted, 1);
  assert.equal(found.redacted, true);
  assert.doesNotMatch(JSON.stringify(found), /private-canary|PRIVATE_SCREENSHOT/);
  const absent = await session.inspect(app.id, { query: { label: "résumé", role: "AXTextField" } });
  assert.equal(absent.discovery!.totalMatches, 0, "case differences are not fuzzy matches");
});

test("invalid queries fail before observation and revoke old refs rather than silently inspecting broadly", async () => {
  for (const query of [null, [], {}, { label: "" }, { label: " " }, { label: 1 }, { label: "x".repeat(257) },
    { label: "Destination", role: "" }, { label: "Destination", role: "x".repeat(97) },
    { label: "Destination", windowToken: "foreign" }, { label: "Destination", regex: true }]) {
    const { driver, session } = fixture();
    const before = await session.inspect(app.id);
    await assert.rejects(session.inspect(app.id, { query } as InspectLimits), error => error instanceof DeveloperError && error.code === "invalid_input");
    assert.equal(driver.observed, 1);
    await assert.rejects(session.act({ snapshotToken: before.snapshotToken, ref: "c1", operation: "fill", value: "No" }), code("stale_snapshot"));
    assert.equal(driver.actions.length, 0);
  }
});

test("query cannot expand application scope or bypass window/document/target freshness", async () => {
  const outside = fixture();
  await assert.rejects(outside.session.inspect("outside", limits()), code("scope"));
  assert.equal(outside.driver.observed, 0);
  for (const change of ["window", "document", "identity", "value"] as const) {
    const { driver, session } = fixture();
    const before = await session.inspect(app.id, limits());
    driver.mutate = snapshot => {
      if (change === "window") snapshot.windowToken = "replacement-with-same-title";
      if (change === "document") snapshot.documentToken = "other-document";
      if (change === "identity") snapshot.controls[targetIndex]!.identity = "replacement";
      if (change === "value") snapshot.controls[targetIndex]!.value = "User edited";
    };
    await assert.rejects(session.act({ snapshotToken: before.snapshotToken, ref: "c1", operation: "fill", value: "No" }), code("stale_snapshot"));
    assert.equal(driver.actions.length, 0, change);
  }
});

test("filtered-out controls remain in whole-frame key and form-identity guards", async () => {
  for (const kind of ["key", "guard"] as const) {
    const { driver, session } = fixture();
    const before = await session.inspect(app.id, limits());
    const guard = session.pinFields(["c1"]);
    driver.mutate = snapshot => {
      if (kind === "key") snapshot.controls[0]!.value = "Changed outside query";
      else snapshot.controls[0]!.identity = "Replaced outside query";
    };
    const request = kind === "key"
      ? { snapshotToken: before.snapshotToken, operation: "key" as const, value: "tab" }
      : { snapshotToken: before.snapshotToken, ref: "c1", operation: "fill" as const, value: "No" };
    await assert.rejects(session.act(request, kind === "guard" ? { guard, values: guard.values } : undefined), code("stale_snapshot"));
    assert.equal(driver.actions.length, 0);
  }
});

test("pending queries are copied, and returned aliases cannot be retargeted through caller mutation", async () => {
  const { driver, session } = fixture();
  const gate = deferred(); const apps = driver.apps.bind(driver);
  driver.apps = async () => { await gate.promise; return apps(); };
  const input = limits();
  const pending = session.inspect(app.id, input);
  input.query!.label = "Other 0";
  gate.resolve();
  const found = await pending;
  assert.equal(found.controls[0]!.label, "Destination");
  found.controls[0]!.label = "Other 0";
  await session.act({ snapshotToken: found.snapshotToken, ref: "c1", operation: "fill", value: "Exact" });
  assert.equal(driver.values[targetIndex], "Exact");
  assert.equal(driver.values[0], "Before 0");
});

test("cancelled discovery cannot return fresh aliases or preserve previously issued ones", async () => {
  const { driver, session } = fixture();
  const before = await session.inspect(app.id, limits());
  const gate = deferred(); const observe = driver.observe.bind(driver);
  driver.observe = async () => { await gate.promise; return observe(); };
  const pending = session.inspect(app.id, limits());
  await new Promise(resolve => setImmediate(resolve));
  session.cancel(); gate.resolve();
  await assert.rejects(pending, code("cancelled"));
  await assert.rejects(session.act({ snapshotToken: before.snapshotToken, ref: "c1", operation: "fill", value: "No" }), code("stale_snapshot"));
  assert.equal(driver.actions.length, 0);
});

test("a failed discovered-target write stays uncertain and is never replayed", async () => {
  const { driver, session } = fixture();
  const found = await session.inspect(app.id, limits());
  const act = driver.act.bind(driver);
  driver.act = async action => { await act(action); throw new Error("private-native-error"); };
  const request = { snapshotToken: found.snapshotToken, ref: "c1", operation: "fill" as const, value: "Applied" };
  await assert.rejects(session.act(request), error => { assert.ok(code("action_unverified")(error)); assert.doesNotMatch(String(error), /private-native-error/); return true; });
  await assert.rejects(session.act(request), code("stale_snapshot"));
  assert.equal(driver.actions.length, 1);
  assert.equal(driver.values[targetIndex], "Applied");
});
