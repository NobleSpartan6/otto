import assert from "node:assert/strict";
import test from "node:test";
import { AgentSession, AgentSessionError } from "./agent-session.js";
import { runSteps } from "./agent-workflow.js";
import type { NativeAction, NativeControl, NativeDriver, NativeSnapshot } from "../shared/types.js";

const app = { id: "coverage-fixture", name: "Coverage fixture", pid: 123 };
const incomplete = ["partial", "unknown", undefined] as const;
const stale = (error: unknown) => error instanceof AgentSessionError && error.code === "stale_snapshot";

/** In-memory contract fixture only: no OS calls, provider calls, or benchmark claims. */
class CoverageDriver implements NativeDriver {
  values = ["Before", "Unchanged"];
  observed = 0;
  actions: NativeAction[] = [];
  mutate = (_snapshot: NativeSnapshot, _count: number) => {};
  async apps() { return { apps: [app], permissions: { accessibility: true, screenCapture: false, platform: "fixture" } }; }
  async configure(_ids: string[]) {}
  async observe(): Promise<NativeSnapshot> {
    const count = ++this.observed;
    const snapshot: NativeSnapshot = {
      controlCoverage: "complete", snapshotId: `snapshot-${count}`, app: { ...app },
      title: "Coverage form", text: "", windowToken: "window-1", documentToken: "document-1",
      capturedAt: new Date().toISOString(),
      controls: this.values.map((value, index): NativeControl => ({
        id: `field-${index}-${count}`, identity: `native-field-${index}`,
        role: "AXTextField", label: index === 0 ? "Name" : "Notes", value,
        enabled: true, editable: true, source: "accessibility", actions: ["fill"],
      })),
    };
    this.mutate(snapshot, count);
    return snapshot;
  }
  async act(action: NativeAction) {
    assert.equal(action.kind, "fill");
    assert.equal(action.appId, app.id);
    assert.equal(action.snapshotId, `snapshot-${this.observed}`);
    const index = this.values.findIndex((_, index) => action.targetId === `field-${index}-${this.observed}`);
    assert.ok(index >= 0, "dispatch must use a freshly rebound native target");
    this.actions.push(structuredClone(action));
    this.values[index] = action.value!;
  }
  cancel() {}
}
function fixture() { const driver = new CoverageDriver(); return { driver, session: new AgentSession(driver, [app.id]) }; }

test("form guards cannot be pinned from partial, unknown, or legacy coverage", async () => {
  for (const coverage of incomplete) {
    const { driver, session } = fixture();
    driver.mutate = snapshot => { snapshot.controlCoverage = coverage; };
    await session.inspect(app.id);
    assert.throws(() => session.pinFields(["c1", "c2"]), stale, String(coverage));
    assert.equal(driver.actions.length, 0);
  }
});

test("identical returned fields cannot validate a pinned form after native coverage drops", async () => {
  for (const coverage of incomplete) {
    const { driver, session } = fixture();
    await session.inspect(app.id);
    const guard = session.pinFields(["c1", "c2"]);
    driver.mutate = snapshot => { snapshot.controlCoverage = coverage; };
    await session.inspect(app.id);
    assert.throws(() => session.validateFields(guard, guard.values), stale, String(coverage));
    assert.equal(driver.actions.length, 0);
  }
});

test("run_steps stops before dispatch when fresh coverage drops, retaining earlier fills without replay", async () => {
  for (const coverage of incomplete) for (const count of [2, 4]) {
    const { driver, session } = fixture();
    // Only the pre-dispatch observation loses coverage. All field identities,
    // values, and returned controls stay identical to the preceding good frame.
    driver.mutate = (snapshot, observed) => { if (observed === count) snapshot.controlCoverage = coverage; };
    const receipt = await runSteps(session, {
      appId: app.id,
      steps: [
        { operation: "fill", label: "Name", value: "After" },
        { operation: "fill", label: "Notes", value: "Updated note" },
      ],
      expected: "filled_values",
    });
    const completed = count === 2 ? 0 : 1;
    assert.equal(receipt.status, "stopped", `${coverage} at observation ${count}`);
    assert.match(receipt.reason!, /Native form coverage is incomplete or unknown/);
    assert.equal(receipt.actions, completed);
    assert.equal(receipt.completedSteps, completed);
    assert.equal(receipt.uncertainAction, undefined, "rejection happened before this action's dispatch");
    assert.equal(receipt.modelCalls, 0);
    assert.equal(driver.actions.length, completed);
    assert.equal(driver.observed, count, "no automatic retry or extra observation");
    assert.deepEqual(driver.values, [completed ? "After" : "Before", "Unchanged"]);
  }
});

test("exact field readback does not validate an incomplete form or authorize its next guarded fill", async () => {
  for (const coverage of incomplete) {
    const { driver, session } = fixture();
    const before = await session.inspect(app.id);
    const guard = session.pinFields(["c1", "c2"]);
    driver.mutate = (snapshot, count) => { if (count >= 3) snapshot.controlCoverage = coverage; };
    const result = await session.act({ snapshotToken: before.snapshotToken, ref: "c1", operation: "fill", value: "After" }, { guard, values: guard.values });
    assert.equal(result.outcome, "verified", "the exact selected-field readback remains distinct from whole-form verification");
    const expected = ["After", "Unchanged"];
    assert.throws(() => session.validateFields(guard, expected), stale);
    await assert.rejects(session.act({ snapshotToken: result.observation.snapshotToken, ref: "c2", operation: "fill", value: "Updated note" }, { guard, values: expected }), stale);
    assert.equal(driver.actions.length, 1);
    assert.equal(session.dispatchCount, 1);
    assert.deepEqual(driver.values, expected);
  }
});

test("explicit unguarded refs remain usable without claiming label uniqueness on incomplete trees", async () => {
  for (const coverage of incomplete) {
    const { driver, session } = fixture();
    driver.mutate = snapshot => { snapshot.controlCoverage = coverage; };
    const before = await session.inspect(app.id);
    const result = await session.act({ snapshotToken: before.snapshotToken, ref: "c1", operation: "fill", value: "After" });
    assert.equal(result.outcome, "verified");
    assert.equal(result.observation.controlCoverage, coverage ?? "unknown");
    assert.deepEqual(session.matchesValues({ Name: "After" }), [{ label: "Name", matched: false }]);
    assert.equal(driver.actions.length, 1);
  }
});

test("compact response truncation does not invalidate a form guard with complete native coverage", async () => {
  const { driver, session } = fixture();
  const before = await session.inspect(app.id, { maxControls: 1, maxTextChars: 0 });
  assert.equal(before.controlCoverage, "complete");
  assert.equal(before.truncation.controlsOmitted, 1);
  const guard = session.pinFields(["c1"]);
  const result = await session.act({ snapshotToken: before.snapshotToken, ref: "c1", operation: "fill", value: "After" }, { guard, values: guard.values });
  session.validateFields(guard, ["After"]);
  assert.equal(result.outcome, "verified");
  assert.equal(result.observation.truncation.controlsOmitted, 1);
  assert.deepEqual(driver.values, ["After", "Unchanged"]);
  assert.equal(driver.actions.length, 1);
});
