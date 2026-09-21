import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLease, AgentLeaseBusyError } from "./agent-lease.js";
import { PlatformDriver } from "./native-driver.js";

class StubDriver extends PlatformDriver {
  calls: string[] = [];
  failConfigure = false;
  override async request<T>(op: string): Promise<T> {
    this.calls.push(op);
    if (this.failConfigure && op === "configure") throw new Error("configure failed");
    return {} as T;
  }
}
function setup(t: { after(fn: () => void): void }) {
  const directory = mkdtempSync(join(tmpdir(), "otto-driver-lease-"));
  const lease = new AgentLease({ directory });
  const other = new AgentLease({ directory });
  const driver = new StubDriver("unused", false, lease);
  t.after(() => { driver.cancel(); other.release(); rmSync(directory, { recursive: true, force: true }); });
  return { driver, lease, other };
}
test("Electron configuration respects an existing MCP owner before native dispatch", async t => {
  const { driver, other } = setup(t);
  other.acquire();
  await assert.rejects(driver.configure(["app"]), AgentLeaseBusyError);
  assert.deepEqual(driver.calls, []);
});
test("Electron holds ownership until cancellation and cannot inspect after release", async t => {
  const { driver, other } = setup(t);
  await driver.configure(["app"]);
  assert.throws(() => other.acquire(), AgentLeaseBusyError);
  driver.cancel();
  other.acquire();
  await assert.rejects(driver.observe("app"), AgentLeaseBusyError);
  assert.deepEqual(driver.calls, ["configure"]);
});
test("repeated Stop retains ownership until the helper closes", async t => {
  const { driver, other } = setup(t);
  await driver.configure(["app"]);
  const child = Object.assign(new EventEmitter(), { kill: () => true });
  Object.assign(driver, { child });
  driver.cancel(); driver.cancel();
  assert.throws(() => other.acquire(), AgentLeaseBusyError);
  await assert.rejects(driver.configure(["app"]), AgentLeaseBusyError);
  child.emit("close");
  other.acquire();
});
test("lost ownership cannot silently reacquire through inspection", async t => {
  const { driver, lease, other } = setup(t);
  await driver.configure(["app"]);
  lease.release();
  await assert.rejects(driver.observe("app"), AgentLeaseBusyError);
  other.acquire();
  assert.deepEqual(driver.calls, ["configure"]);
});
test("failed configuration releases ownership when no helper remains", async t => {
  const { driver, other } = setup(t);
  driver.failConfigure = true;
  await assert.rejects(driver.configure(["app"]), /configure failed/);
  other.acquire();
});
