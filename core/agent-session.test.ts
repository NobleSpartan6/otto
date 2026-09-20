import assert from "node:assert/strict";
import test from "node:test";
import { AgentSession, AgentSessionError } from "./agent-session.js";
import type { NativeAction, NativeDriver, NativeSnapshot } from "../shared/types.js";

const app = { id: "fixture", name: "Fixture", pid: 123 };
class Driver implements NativeDriver {
  value = "Before";
  observed = 0;
  configured: string[][] = [];
  actions: NativeAction[] = [];
  cancelled = 0;
  mutate = (_snapshot: NativeSnapshot, _count: number) => {};
  async apps() { return { apps: [app], permissions: { accessibility: true, screenCapture: false, platform: "fixture" } }; }
  async configure(ids: string[]) { this.configured.push([...ids]); }
  async observe(): Promise<NativeSnapshot> {
    const count = ++this.observed;
    const snapshot: NativeSnapshot = { snapshotId: `snapshot-${count}`, windowToken: "window-1", documentToken: "document-1", app: { ...app },
      title: "Fixture form", text: "Useful document text", capturedAt: new Date().toISOString(), screenshot: "SECRET_SCREENSHOT",
      controls: [
        { id: `field-${count}`, identity: "field-native", role: "AXTextField", label: "Name", value: this.value, enabled: true, editable: true, source: "accessibility", actions: ["fill"], bounds: { x: 1, y: 2, width: 200, height: 30 } },
        { id: `button-${count}`, identity: "button-native", role: "AXButton", label: "Save", value: "", enabled: true, editable: false, source: "accessibility", actions: ["press"], bounds: { x: 1, y: 50, width: 90, height: 30 } },
        { id: `scroll-${count}`, identity: "scroll-native", role: "AXScrollArea", label: "Document", enabled: true, editable: false, source: "accessibility", actions: ["scrollUp", "scrollDown"] },
      ] };
    this.mutate(snapshot, count); return snapshot;
  }
  async act(action: NativeAction) {
    this.actions.push(structuredClone(action));
    assert.equal(action.appId, "fixture"); assert.equal(action.snapshotId, `snapshot-${this.observed}`);
    if (action.kind === "fill") this.value = action.value!;
  }
  cancel() { this.cancelled++; }
}
const code = (expected: AgentSessionError["code"]) => (error: unknown) => error instanceof AgentSessionError && error.code === expected;
function fixture() { const driver = new Driver(); return { driver, session: new AgentSession(driver, ["fixture"]) }; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }

test("inspect is scoped, compact and immutable; fill rebinds fresh IDs without configure and returns exact readback", async () => {
  const { driver, session } = fixture();
  const observed = await session.inspect("fixture");
  assert.doesNotMatch(JSON.stringify(observed), /SECRET_SCREENSHOT|field-native|field-1/);
  observed.controls[0]!.label = "Changed by caller";
  const result = await session.act({ snapshotToken: observed.snapshotToken, ref: "c1", operation: "fill", value: "Élodie 東京\n" });
  assert.equal(result.outcome, "verified"); assert.equal(result.observation.controls[0]!.value, "Élodie 東京\n");
  assert.equal(result.observation.controls[0]!.label, "Name");
  assert.equal(driver.actions[0]!.targetId, "field-2"); assert.equal(driver.actions[0]!.snapshotId, "snapshot-2");
  assert.equal(driver.observed, 3); assert.deepEqual(driver.configured, [["fixture"]]);
  assert.notEqual(result.observation.snapshotToken, observed.snapshotToken);
  await session.act({ snapshotToken: result.observation.snapshotToken, ref: "c2", operation: "press" });
  assert.equal(driver.actions.length, 2); assert.deepEqual(driver.configured, [["fixture"]]);
});

test("press, scrolling and bounded keys report dispatch without claiming task completion", async () => {
  for (const operation of ["press", "scrollUp", "scrollDown", "key"] as const) {
    const { driver, session } = fixture(); const snapshot = await session.inspect("fixture");
    const result = await session.act({ snapshotToken: snapshot.snapshotToken, operation,
      ...(operation === "key" ? { value: "enter" } : { ref: operation === "press" ? "c2" : "c3" }) });
    assert.equal(result.outcome, "dispatched");
    assert.equal(driver.actions[0]!.kind, operation.startsWith("scroll") ? "scroll" : operation);
    if (operation === "key") { assert.equal(driver.actions[0]!.value, "enter"); assert.equal(driver.actions[0]!.targetId, undefined); }
  }
});

test("constructor and observations reject expanded app scope and incorrect native process", async () => {
  const driver = new Driver();
  for (const ids of [[], ["fixture", "fixture"], ["a", "b", "c", "d", "e"], ["bad\napp"]]) assert.throws(() => new AgentSession(driver, ids), code("scope"));
  const session = new AgentSession(driver, ["fixture"]);
  await assert.rejects(session.inspect("other"), code("scope")); assert.equal(driver.observed, 0);
  driver.mutate = snapshot => { snapshot.app.pid++; };
  await assert.rejects(session.inspect("fixture"), code("scope")); assert.equal(driver.actions.length, 0);
});

test("expired, replaced and duplicate snapshot references never dispatch again", async t => {
  const { driver, session } = fixture(); const first = await session.inspect("fixture");
  await session.inspect("fixture");
  await assert.rejects(session.act({ snapshotToken: first.snapshotToken, ref: "c2", operation: "press" }), code("stale_snapshot"));
  const expired = await session.inspect("fixture"); const now = Date.now();
  t.mock.method(Date, "now", () => now + 30_001);
  await assert.rejects(session.act({ snapshotToken: expired.snapshotToken, ref: "c2", operation: "press" }), code("stale_snapshot"));
  t.mock.restoreAll();
  const fresh = await session.inspect("fixture");
  const input = { snapshotToken: fresh.snapshotToken, ref: "c2", operation: "press" as const };
  const running = session.act(input);
  await assert.rejects(session.act(input), code("busy")); await running;
  await assert.rejects(session.act(input), code("stale_snapshot")); assert.equal(driver.actions.length, 1);
});

test("changed app, process, window, document, control, capabilities and value stop before dispatch", async () => {
  for (const change of ["app", "pid", "window", "document", "missing_window", "identity", "label", "bounds", "value", "disabled", "capability", "sensitive"]) {
    const { driver, session } = fixture(); const snapshot = await session.inspect("fixture");
    driver.mutate = after => {
      if (change === "app") after.app.id = "outside";
      if (change === "pid") after.app.pid++;
      if (change === "window") after.windowToken = "another-window";
      if (change === "document") after.documentToken = "another-document";
      if (change === "missing_window") delete after.windowToken;
      if (change === "identity") after.controls[0]!.identity = "replacement";
      if (change === "label") after.controls[0]!.label = "Other";
      if (change === "bounds") after.controls[0]!.bounds!.x++;
      if (change === "value") after.controls[0]!.value = "User edit";
      if (change === "disabled") after.controls[0]!.enabled = false;
      if (change === "capability") after.controls[0]!.actions = [];
      if (change === "sensitive") after.controls[0]!.sensitive = true;
    };
    await assert.rejects(session.act({ snapshotToken: snapshot.snapshotToken, ref: "c1", operation: "fill", value: "New" }), undefined, change);
    assert.equal(driver.actions.length, 0, change);
  }
});

test("protected, OCR, unknown and malformed targets or values cannot dispatch", async () => {
  for (const change of ["sensitive", "ocr", "missing_identity", "unknown", "oversized", "secret_value", "extra_field", "key_combo", "key_ref", "press_value"]) {
    const { driver, session } = fixture();
    driver.mutate = snapshot => {
      if (change === "sensitive") snapshot.controls[0]!.sensitive = true;
      if (change === "ocr") snapshot.controls[0]!.source = "ocr";
      if (change === "missing_identity") delete snapshot.controls[0]!.identity;
    };
    const snapshot = await session.inspect("fixture");
    let input = { snapshotToken: snapshot.snapshotToken, ref: "c1", operation: "fill", value: "New" };
    if (change === "unknown") input.ref = "c99";
    if (change === "oversized") input.value = "a".repeat(2001);
    if (change === "secret_value") input.value = "sk-abcdefghijklmnop123456789";
    if (change === "extra_field") Object.assign(input, { point: { x: 10, y: 20 } });
    if (change === "key_combo") input = { ...input, operation: "key", ref: undefined as unknown as string, value: "cmd+enter" };
    if (change === "key_ref") input = { ...input, operation: "key", value: "enter" };
    if (change === "press_value") input = { ...input, operation: "press", ref: "c2" };
    await assert.rejects(session.act(input as Parameters<AgentSession["act"]>[0]), undefined, change);
    assert.equal(driver.actions.length, 0, change);
  }
});

test("keyboard input requires an unchanged whole frame", async () => {
  const { driver, session } = fixture(); const snapshot = await session.inspect("fixture");
  driver.mutate = after => { after.controls[0]!.value = "User changed input"; };
  await assert.rejects(session.act({ snapshotToken: snapshot.snapshotToken, operation: "key", value: "tab" }), code("stale_snapshot"));
  assert.equal(driver.actions.length, 0);
});

test("failed exact readback or native errors report uncertain dispatch without retry or private diagnostics", async () => {
  for (const throwing of [false, true]) {
    const { driver, session } = fixture(); const snapshot = await session.inspect("fixture");
    driver.act = async action => { driver.actions.push(action); if (throwing) throw new Error("private-native-diagnostic"); };
    await assert.rejects(session.act({ snapshotToken: snapshot.snapshotToken, ref: "c1", operation: "fill", value: "New" }), error => {
      assert.ok(code("action_unverified")(error)); assert.doesNotMatch(String(error), /private-native-diagnostic/); return true;
    });
    await assert.rejects(session.act({ snapshotToken: snapshot.snapshotToken, ref: "c1", operation: "fill", value: "New" }), code("stale_snapshot"));
    assert.equal(driver.actions.length, 1);
  }
});

test("cancellation revokes in-flight preflight and retains the busy slot until native work settles", async () => {
  const { driver, session } = fixture(); const snapshot = await session.inspect("fixture");
  const gate = deferred(); const observe = driver.observe.bind(driver);
  driver.observe = async () => { await gate.promise; return observe(); };
  const work = session.act({ snapshotToken: snapshot.snapshotToken, ref: "c2", operation: "press" });
  session.cancel(); assert.equal(driver.cancelled, 1);
  await assert.rejects(session.inspect("fixture"), code("busy"));
  gate.resolve(); await assert.rejects(work, code("cancelled")); assert.equal(driver.actions.length, 0);
  await session.inspect("fixture");
});

test("action arguments cannot change during preflight, and cancellation after dispatch does not replay", async () => {
  const { driver, session } = fixture(); const snapshot = await session.inspect("fixture");
  const gate = deferred(); const observe = driver.observe.bind(driver);
  driver.observe = async () => { await gate.promise; return observe(); };
  const input = { snapshotToken: snapshot.snapshotToken, ref: "c1", operation: "fill" as const, value: "Reviewed literal" };
  const filling = session.act(input); input.value = "Changed during preflight";
  gate.resolve(); const result = await filling;
  assert.equal(driver.value, "Reviewed literal"); assert.equal(result.outcome, "verified");

  const actionGate = deferred(); const nativeAct = driver.act.bind(driver);
  driver.act = async action => { await nativeAct(action); await actionGate.promise; };
  const next = session.act({ snapshotToken: result.observation.snapshotToken, ref: "c2", operation: "press" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(driver.actions.length, 2); session.cancel(); actionGate.resolve();
  await assert.rejects(next, code("cancelled")); assert.equal(driver.actions.length, 2);
  await assert.rejects(session.act({ snapshotToken: result.observation.snapshotToken, ref: "c2", operation: "press" }), code("stale_snapshot"));
});

test("failed inspect and explicit invalidation revoke old refs", async () => {
  const { driver, session } = fixture(); const snapshot = await session.inspect("fixture");
  const observe = driver.observe.bind(driver);
  driver.observe = async () => { throw new Error("private-native-diagnostic"); };
  await assert.rejects(session.inspect("fixture"), error => { assert.doesNotMatch(String(error), /private-native-diagnostic/); return true; });
  await assert.rejects(session.act({ snapshotToken: snapshot.snapshotToken, ref: "c2", operation: "press" }), code("stale_snapshot"));
  driver.observe = observe; const fresh = await session.inspect("fixture"); session.invalidate();
  await assert.rejects(session.act({ snapshotToken: fresh.snapshotToken, ref: "c2", operation: "press" }), code("stale_snapshot"));
});

test("field guards and completion checks use full native values beyond compact output limits", async () => {
  const { session } = fixture(); const snapshot = await session.inspect("fixture");
  const guard = session.pinFields(["c1"]);
  assert.deepEqual(guard.values, ["Before"]); assert.ok(Object.isFrozen(guard) && Object.isFrozen(guard.values));
  assert.throws(() => session.validateFields({ ...guard }, ["Before"]), code("invalid_input"));
  const value = "東京".repeat(300);
  const result = await session.act({ snapshotToken: snapshot.snapshotToken, ref: "c1", operation: "fill", value }, { guard, values: guard.values });
  assert.equal(result.outcome, "verified"); assert.equal(result.observation.controls[0]!.value!.length, 512);
  assert.deepEqual(result.observation.truncation.details, [{ ref: "c1", fields: ["value"] }]);
  session.validateFields(guard, [value]);
  assert.deepEqual(session.matchesValues({ Name: value }), [{ label: "Name", matched: true }]);
  assert.deepEqual(session.matchesValues({ Name: "Wrong", Future: "Not yet visible" }), [{ label: "Name", matched: false }, { label: "Future", matched: false }]);
  assert.equal(session.dispatchCount, 1);
});

test("a pinned field replaced or changed during fresh preflight stops before another field is written", async () => {
  for (const change of ["identity", "value"]) {
    const { driver, session } = fixture();
    driver.mutate = (snapshot, count) => {
      snapshot.controls.push({ ...snapshot.controls[0]!, id: `notes-${count}`, identity: "notes-native", label: "Notes", value: "Other before" });
      if (count >= 4) {
        if (change === "identity") snapshot.controls[0]!.identity = "replacement-identical-label-and-value";
        else snapshot.controls[0]!.value = "Unexpected later edit";
      }
    };
    const snapshot = await session.inspect("fixture"); const guard = session.pinFields(["c1", "c4"]);
    const result = await session.act({ snapshotToken: snapshot.snapshotToken, ref: "c1", operation: "fill", value: "Updated" }, { guard, values: guard.values });
    const expected = ["Updated", "Other before"];
    session.validateFields(guard, expected);
    await assert.rejects(session.act({ snapshotToken: result.observation.snapshotToken, ref: "c4", operation: "fill", value: "New note" }, { guard, values: expected }), code("stale_snapshot"));
    assert.equal(driver.actions.length, 1, change); assert.equal(session.dispatchCount, 1, change);
  }
});

test("completion checks abstain on ambiguous, protected, disabled, OCR and incomplete native values", async () => {
  for (const change of ["duplicate", "sensitive", "disabled", "ocr", "missing_value", "truncated", "missing_identity"]) {
    const { driver, session } = fixture();
    driver.mutate = snapshot => {
      if (change === "duplicate") snapshot.controls.push({ ...snapshot.controls[0]!, id: "duplicate", identity: "duplicate-native" });
      if (change === "sensitive") snapshot.controls[0]!.sensitive = true;
      if (change === "disabled") snapshot.controls[0]!.enabled = false;
      if (change === "ocr") snapshot.controls[0]!.source = "ocr";
      if (change === "missing_value") delete snapshot.controls[0]!.value;
      if (change === "truncated") snapshot.controls[0]!.value = "a".repeat(2001);
      if (change === "missing_identity") delete snapshot.controls[0]!.identity;
    };
    await session.inspect("fixture");
    assert.deepEqual(session.matchesValues({ Name: "Before" }), [{ label: "Name", matched: false }], change);
  }
});

test("completion matching ignores duplicate OCR and static labels but rejects duplicate native fields", async () => {
  const { driver, session } = fixture();
  driver.mutate = snapshot => {
    snapshot.controls.push({ ...snapshot.controls[0]!, id: "ocr-label", identity: undefined, role: "text", source: "ocr", editable: false, actions: ["press"] });
    snapshot.controls.push({ ...snapshot.controls[0]!, id: "static-label", identity: "static-native", role: "AXStaticText", editable: false, actions: [] });
  };
  await session.inspect("fixture");
  assert.deepEqual(session.matchesValues({ Name: "Before" }), [{ label: "Name", matched: true }]);
  const previous = driver.mutate;
  driver.mutate = (snapshot, count) => {
    previous(snapshot, count);
    snapshot.controls.push({ ...snapshot.controls[0]!, id: "native-duplicate", identity: "duplicate-native" });
  };
  await session.inspect("fixture");
  assert.deepEqual(session.matchesValues({ Name: "Before" }), [{ label: "Name", matched: false }]);
});

test("repeated inspect preserves native identities and guards; cancellation reconfigures the connection", async () => {
  const { driver, session } = fixture();
  driver.mutate = snapshot => {
    snapshot.windowToken = `window-configuration-${driver.configured.length}`;
    for (const control of snapshot.controls) control.identity += `-configuration-${driver.configured.length}`;
  };
  const first = await session.inspect("fixture");
  const guard = session.pinFields(["c1"]);
  const second = await session.inspect("fixture");
  assert.notEqual(first.snapshotToken, second.snapshotToken);
  assert.equal(driver.configured.length, 1);
  session.validateFields(guard, guard.values);
  const result = await session.act({ snapshotToken: second.snapshotToken, ref: "c1", operation: "fill", value: "After" }, { guard, values: guard.values });
  await session.inspect("fixture");
  session.validateFields(guard, ["After"]);
  assert.equal(driver.configured.length, 1);
  assert.equal(result.outcome, "verified");
  session.cancel();
  await session.inspect("fixture");
  assert.equal(driver.configured.length, 2);
  assert.throws(() => session.validateFields(guard, ["After"]), code("stale_snapshot"));
  await new AgentSession(driver, ["fixture"]).inspect("fixture");
  assert.equal(driver.configured.length, 3, "a new scoped session configures its own scope");
});

test("driver failures require configuration again without retrying failed native work", async () => {
  for (const stage of ["apps", "configure", "observe", "act"] as const) {
    const { driver, session } = fixture();
    const first = stage === "configure" ? undefined : await session.inspect("fixture");
    const original = driver[stage].bind(driver);
    driver[stage] = (async () => { throw new Error("private connection error"); }) as typeof driver[typeof stage];
    if (stage === "act") await assert.rejects(session.act({ snapshotToken: first!.snapshotToken, ref: "c2", operation: "press" }), code("action_unverified"));
    else await assert.rejects(session.inspect("fixture"), code("native_unavailable"));
    assert.equal(session.dispatchCount, stage === "act" ? 1 : 0);
    driver[stage] = original as typeof driver[typeof stage];
    await session.inspect("fixture");
    assert.equal(driver.configured.length, stage === "configure" ? 1 : 2, stage);
  }
});

test("cancellation during configuration cannot mark a killed helper as configured", async () => {
  const { driver, session } = fixture();
  const gate = deferred(); const configure = driver.configure.bind(driver);
  driver.configure = async ids => { await configure(ids); await gate.promise; };
  const pending = session.inspect("fixture");
  await new Promise(resolve => setImmediate(resolve));
  session.cancel(); gate.resolve();
  await assert.rejects(pending, code("cancelled"));
  await session.inspect("fixture");
  assert.equal(driver.configured.length, 2); assert.equal(driver.actions.length, 0);
});
