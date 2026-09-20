import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAgentServer, type AgentServerOptions } from "./agent-server.js";
import type { NativeAction, NativeDriver, NativeSnapshot } from "../shared/types.js";

class Driver implements NativeDriver {
  app = { id: "fixture", name: "Fixture", pid: 123 };
  extraApps: Array<typeof this.app> = [];
  values = ["Before", "London"];
  actions: NativeAction[] = [];
  observed = 0;
  cancelled = 0;
  rejectWrites = false;
  withOcrLabels = false;
  resetWindowOnConfigure = false;
  configureCalls = 0;
  beforeObserve = async (_count: number) => {};
  async apps() {
    return { apps: [{ ...this.app }, ...this.extraApps], permissions: { accessibility: true, screenCapture: false, platform: "fixture" } };
  }
  async configure(ids: string[]) { assert.deepEqual(ids, [this.app.id]); this.configureCalls++; }
  async observe(appId: string): Promise<NativeSnapshot> {
    assert.equal(appId, this.app.id);
    const count = ++this.observed;
    await this.beforeObserve(count);
    const controls: NativeSnapshot["controls"] = ["Name", "City"].map((label, index) => ({
        id: `native-${index}-${count}`, identity: `private-identity-${index}`, role: "AXTextField", label,
        value: this.values[index]!, enabled: true, editable: true, source: "accessibility", actions: ["fill"],
        bounds: { x: 20, y: 20 + index * 40, width: 200, height: 30 },
      }));
    if (this.withOcrLabels) for (const label of ["Name", "City"]) controls.push({
      id: `ocr-${label}-${count}`, role: "OCRText", label, enabled: true, editable: false, source: "ocr", actions: ["press"],
    });
    return { snapshotId: `snapshot-${count}`, app: { ...this.app }, windowToken: this.resetWindowOnConfigure ? `window-${this.configureCalls}` : "window-1", documentToken: "document-1",
      title: "Fixture", text: "Native fixture text", screenshot: "SECRET_SCREENSHOT", capturedAt: new Date().toISOString(), controls };
  }
  async act(action: NativeAction) {
    assert.equal(action.appId, this.app.id);
    assert.equal(action.snapshotId, `snapshot-${this.observed}`);
    this.actions.push(structuredClone(action));
    if (!this.rejectWrites && action.kind === "fill") this.values[Number(action.targetId!.split("-")[1])] = action.value!;
  }
  cancel() { this.cancelled++; }
}
function text(result: unknown) {
  return (result as { content: Array<{ type: string; text?: string }> }).content.filter(item => item.type === "text").map(item => item.text).join("\n");
}
function metadata(result: unknown) {
  return text(result).split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line)).find(value => typeof value.snapshotToken === "string");
}
const isError = (result: unknown) => (result as { isError?: boolean }).isError === true;
async function setup(t: TestContext, options: Partial<AgentServerOptions> = {}) {
  const driver = new Driver();
  const { server, stop } = await createAgentServer(driver, { appIds: ["fixture"], appNames: [], allowActions: true, ...options });
  const client = new Client({ name: "test-otto-agent", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { stop(); await client.close(); await server.close(); });
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  return { driver, client, call };
}

test("read-only manifest and launcher authority cannot be expanded by a tool request", async t => {
  const { driver, client, call } = await setup(t, { allowActions: false });
  const manifest = await client.listTools();
  assert.deepEqual(manifest.tools.map(tool => tool.name), ["list_apps", "inspect"]);
  assert.ok(manifest.tools.every(tool => tool.annotations?.readOnlyHint === true));
  for (const name of ["act", "run_steps", "delegate"]) {
    const result = await call(name, { allowActions: true });
    assert.equal(isError(result), true);
    assert.match(text(result), /launcher --allow-actions/);
  }
  assert.equal(isError(await call("inspect", { appId: "outside" })), true);
  assert.equal(isError(await call("list_apps", { all: true })), true);
  assert.equal(driver.actions.length, 0);
  assert.equal(driver.observed, 0);
});

test("act returns fresh readback without screenshots/handles and consumed refs cannot replay", async t => {
  const { driver, call } = await setup(t);
  const inspected = await call("inspect", { appId: "fixture" });
  assert.equal(isError(inspected), false, text(inspected));
  assert.doesNotMatch(text(inspected), /SECRET_SCREENSHOT|private-identity|native-0-/);
  const args = { snapshotToken: metadata(inspected).snapshotToken, ref: "c1", operation: "fill", value: "Élodie 東京" };
  const acted = await call("act", args);
  assert.equal(isError(acted), false, text(acted));
  assert.deepEqual(JSON.parse(text(acted).split("\n")[0]!), { outcome: "verified" });
  assert.notEqual(metadata(acted).snapshotToken, args.snapshotToken);
  assert.match(text(acted), /Élodie 東京/);
  assert.doesNotMatch(text(acted), /No action was executed|SECRET_SCREENSHOT|private-identity/);
  assert.equal(isError(await call("act", args)), true);
  assert.equal(driver.actions.length, 1);
  assert.equal(driver.values[0], args.value);
});

test("exact app-name scope follows a restarted process but revokes prior references", async t => {
  const { driver, call } = await setup(t, { appIds: [], appNames: ["Fixture"] });
  driver.extraApps = [{ id: "outside", name: "Other", pid: 222 }];
  assert.deepEqual(JSON.parse(text(await call("list_apps"))).apps, [{ id: "fixture", name: "Fixture" }]);
  const old = metadata(await call("inspect", { appId: "fixture" }));
  driver.app = { id: "restarted", name: "Fixture", pid: 456 };
  const replay = await call("act", { snapshotToken: old.snapshotToken, ref: "c1", operation: "fill", value: "No" });
  assert.equal(isError(replay), true);
  assert.equal(driver.actions.length, 0);
  assert.equal(isError(await call("inspect", { appId: "fixture" })), true);
  const current = await call("inspect", { appId: "restarted" });
  assert.equal(isError(current), false, text(current));
  assert.notEqual(metadata(current).snapshotToken, old.snapshotToken);
  driver.extraApps = [{ id: "ambiguous", name: "Fixture", pid: 789 }];
  assert.match(text(await call("list_apps")), /ambiguous/);
});

test("run_steps returns exact checks and real observation count without a model", async t => {
  const { driver, call } = await setup(t);
  const result = await call("run_steps", { appId: "fixture", steps: [
    { operation: "fill", label: "Name", value: "Ada" }, { operation: "fill", label: "City", value: "Paris" },
  ], expected: { values: { Name: "Ada", City: "Paris" } } });
  assert.equal(isError(result), false, text(result));
  const receipt = JSON.parse(text(result));
  assert.equal(receipt.status, "verified");
  assert.equal(receipt.actions, 2);
  assert.equal(receipt.completedSteps, 2);
  assert.equal(receipt.modelCalls, 0);
  assert.equal(receipt.observations, driver.observed);
  assert.equal(receipt.observations, 6);
  assert.deepEqual(receipt.checks, [{ kind: "value", label: "Name", matched: true }, { kind: "value", label: "City", matched: true }]);
  assert.deepEqual(driver.values, ["Ada", "Paris"]);
  assert.ok(driver.actions.every(action => action.kind === "fill"));
});

test("failed readback cannot produce verified completion or replay the write", async t => {
  const { driver, call } = await setup(t);
  driver.rejectWrites = true;
  const result = await call("run_steps", { appId: "fixture", steps: [{ operation: "fill", label: "Name", value: "Ada" }], expected: { values: { Name: "Ada" } } });
  assert.equal(isError(result), false, text(result));
  const receipt = JSON.parse(text(result));
  assert.equal(receipt.status, "stopped");
  assert.equal(receipt.uncertainAction, true);
  assert.equal(receipt.actions, 1);
  assert.equal(receipt.completedSteps, 0);
  assert.equal(receipt.modelCalls, 0);
  assert.equal(driver.actions.length, 1);
  assert.equal(driver.values[0], "Before");
  const delegated = await call("delegate", { appId: "fixture", goal: "Fill Name", allowedActions: [{ operation: "fill", label: "Name", value: "Ada" }], expected: { values: { Name: "Ada" } } });
  assert.equal(isError(delegated), true);
  assert.match(text(delegated), /TYPESAFE_API_KEY/);
  assert.equal(driver.actions.length, 1);
});

test("native workflow labels ignore OCR copies of the same visible label", async t => {
  const { driver, call } = await setup(t);
  driver.withOcrLabels = true;
  const result = await call("run_steps", { appId: "fixture", steps: [{ operation: "fill", label: "Name", value: "Ada" }], expected: { values: { Name: "Ada" } } });
  assert.equal(isError(result), false, text(result));
  const receipt = JSON.parse(text(result));
  assert.equal(receipt.status, "verified", receipt.reason);
  assert.equal(receipt.actions, 1);
  assert.equal(driver.values[0], "Ada");
});

test("run_steps without expected checks reports completed, not verified", async t => {
  const { driver, call } = await setup(t);
  const result = await call("run_steps", { appId: "fixture", steps: [{ operation: "fill", label: "Name", value: "Ada" }] });
  assert.equal(isError(result), false, text(result));
  const receipt = JSON.parse(text(result));
  assert.equal(receipt.status, "completed", receipt.reason);
  assert.equal(receipt.actions, 1);
  assert.equal(receipt.modelCalls, 0);
  assert.deepEqual(receipt.checks, []);
  assert.equal(driver.values[0], "Ada");
});

test("run_steps accepts text-only expected checks without an empty value assertion", async t => {
  const { driver, call } = await setup(t);
  const result = await call("run_steps", { appId: "fixture", steps: [{ operation: "fill", label: "Name", value: "Ada" }], expected: { textIncludes: ["Native fixture text"] } });
  assert.equal(isError(result), false, text(result));
  const receipt = JSON.parse(text(result));
  assert.equal(receipt.status, "verified", receipt.reason);
  assert.equal(receipt.actions, 1);
  assert.equal(receipt.modelCalls, 0);
  assert.deepEqual(receipt.checks, [{ kind: "text", label: "Native fixture text", matched: true }]);
  assert.equal(driver.values[0], "Ada");
});

test("run_steps final inspection preserves native identity instead of resetting driver scope", async t => {
  const { driver, call } = await setup(t);
  driver.resetWindowOnConfigure = true;
  const result = await call("run_steps", { appId: "fixture", steps: [{ operation: "fill", label: "Name", value: "Ada" }], expected: { values: { Name: "Ada" } } });
  assert.equal(isError(result), false, text(result));
  const receipt = JSON.parse(text(result));
  assert.equal(receipt.status, "verified", receipt.reason);
  assert.equal(driver.configureCalls, 1);
  assert.equal(driver.values[0], "Ada");
});

test("MCP cancellation during fresh observation revokes refs before dispatch", async t => {
  const { driver, client, call } = await setup(t);
  const snapshot = metadata(await call("inspect", { appId: "fixture" }));
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  driver.beforeObserve = async count => { if (count === 2) { enter(); await gate; } };
  const controller = new AbortController();
  const args = { snapshotToken: snapshot.snapshotToken, ref: "c1", operation: "fill", value: "No" };
  const pending = client.callTool({ name: "act", arguments: args }, undefined, { signal: controller.signal });
  await entered;
  controller.abort();
  await assert.rejects(pending);
  release();
  await call("list_apps"); // Wait behind the cancelled server request.
  assert.equal(driver.actions.length, 0);
  assert.ok(driver.cancelled > 0);
  assert.equal(isError(await call("act", args)), true);
});
