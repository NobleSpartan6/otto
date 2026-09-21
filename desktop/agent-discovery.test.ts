import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentServer } from "./agent-server.js";
import { AgentLease } from "./agent-lease.js";
import type { ControlCoverage, NativeAction, NativeDriver, NativeSnapshot } from "../shared/types.js";

class Driver implements NativeDriver {
  app = { id: "fixture", name: "Fixture", pid: 123 };
  coverage: ControlCoverage = "complete";
  duplicate = true;
  observed = 0;
  value = "Before";
  actions: NativeAction[] = [];
  async apps() { return { apps: [this.app], permissions: { accessibility: true, screenCapture: false, platform: "fixture" } }; }
  async configure(_ids: string[]) {}
  async observe(): Promise<NativeSnapshot> {
    const count = ++this.observed;
    return { controlCoverage: this.coverage, snapshotId: `snapshot-${count}`, app: { ...this.app },
      windowToken: "window", documentToken: "document", title: "Fixture", text: "Unrelated text", capturedAt: new Date().toISOString(),
      controls: Array.from({ length: 150 }, (_, index) => ({
        id: `native-${index}-${count}`, identity: `identity-${index}`, role: "AXTextField",
        label: index === 140 || this.duplicate && index === 149 ? "Destination" : `Other ${index}`,
        value: index === 140 ? this.value : "Other", enabled: true, editable: true, source: "accessibility" as const, actions: ["fill"],
      })) };
  }
  async act(action: NativeAction) { assert.equal(action.targetId, `native-140-${this.observed}`); this.actions.push(action); this.value = action.value!; }
  cancel() {}
}
function text(result: unknown) {
  return (result as { content: Array<{ type: string; text?: string }> }).content.filter(item => item.type === "text").map(item => item.text).join("\n");
}
function metadata(result: unknown) {
  return text(result).split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line)).find(value => typeof value.snapshotToken === "string");
}
const isError = (result: unknown) => (result as { isError?: boolean }).isError === true;
async function setup(t: TestContext, allowActions = false) {
  const directory = mkdtempSync(join(tmpdir(), "otto-discovery-test-"));
  const driver = new Driver();
  const { server, stop } = await createAgentServer(driver, { appIds: [driver.app.id], appNames: [], allowActions }, new AgentLease({ directory }));
  const client = new Client({ name: "test-discovery", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { stop(); await client.close(); await server.close(); rmSync(directory, { recursive: true, force: true }); });
  return { driver, client, call: (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) };
}

test("MCP read-only inspect exposes query counts without hiding duplicates or partial traversal", async t => {
  const { driver, client, call } = await setup(t);
  const manifest = await client.listTools();
  const inspect = manifest.tools.find(tool => tool.name === "inspect")!;
  assert.equal(inspect.annotations?.readOnlyHint, true);
  assert.ok(inspect.inputSchema.properties?.query);
  const args = { appId: "fixture", query: { label: "Destination", role: "AXTextField" }, maxControls: 1, maxTextChars: 0 };
  const found = await call("inspect", args);
  assert.equal(isError(found), false, text(found));
  assert.deepEqual(metadata(found).discovery, { scope: "selected_native_tree", observedMatches: 2, totalMatches: 2, matchesOmitted: 1 });
  assert.equal(text(found).split("\n").filter(line => line.startsWith("[")).length, 1);
  assert.doesNotMatch(text(found), /native-140|identity-140|Unrelated text/);
  driver.coverage = "partial";
  const partial = await call("inspect", args);
  assert.equal(metadata(partial).discovery.totalMatches, null);
  assert.equal(metadata(partial).discovery.observedMatches, 2);
  const before = driver.observed;
  assert.equal(isError(await call("inspect", { ...args, query: { label: "Destination", windowToken: "foreign" } })), true);
  assert.equal(driver.observed, before, "invalid queries do not fall back to broad inspection");
  assert.equal(isError(await call("act", { snapshotToken: metadata(partial).snapshotToken, ref: "c1", operation: "fill", value: "No" })), true);
  assert.equal(driver.actions.length, 0);
});

test("MCP discovered aliases execute only through existing authorized fresh-ref actions", async t => {
  const { driver, call } = await setup(t, true);
  driver.duplicate = false;
  const found = await call("inspect", { appId: "fixture", query: { label: "Destination" }, maxControls: 1, maxTextChars: 0 });
  assert.equal(isError(found), false, text(found));
  const args = { snapshotToken: metadata(found).snapshotToken, ref: "c1", operation: "fill", value: "Exact" };
  const acted = await call("act", args);
  assert.equal(isError(acted), false, text(acted));
  assert.equal(JSON.parse(text(acted).split("\n")[0]!).outcome, "verified");
  assert.equal(metadata(acted).discovery.totalMatches, 1);
  assert.equal(driver.value, "Exact");
  assert.equal(driver.actions.length, 1);
  assert.equal(isError(await call("act", args)), true);
  assert.equal(driver.actions.length, 1, "consumed aliases cannot replay");
});
