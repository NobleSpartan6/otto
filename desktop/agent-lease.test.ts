import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readdirSync, mkdirSync, writeFileSync, chmodSync, readFileSync, symlinkSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { AgentLease, AgentLeaseBusyError, AgentLeaseUnavailableError } from "./agent-lease.js";

function directory(t: { after: (fn: () => void) => void }) {
  const path = mkdtempSync(join(tmpdir(), "otto-lease-test-"));
  t.after(() => rmSync(path, { recursive: true, force: true })); return path;
}
const busy = (error: unknown) => error instanceof AgentLeaseBusyError && error.code === "desktop_busy";
const unavailable = (error: unknown) => {
  assert.ok(error instanceof AgentLeaseUnavailableError);
  assert.equal(error.code, "desktop_unavailable");
  assert.doesNotMatch(String(error), /otto-lease-test|private|Another Otto/);
  return true;
};

test("two owners conflict, same owner reacquires, and explicit release permits handoff", t => {
  const path = directory(t); const one = new AgentLease({ directory: path }); const two = new AgentLease({ directory: path });
  one.acquire(); one.acquire();
  assert.throws(() => two.acquire(), busy);
  two.release(); assert.throws(() => two.acquire(), busy);
  one.release(); two.acquire();
  one.release(); assert.throws(() => one.acquire(), busy);
  two.release(); one.acquire(); one.release();
  assert.deepEqual(readdirSync(path), []);
});

test("idle ownership expires locally and invalidates references before another owner acquires", async t => {
  const path = directory(t); const one = new AgentLease({ directory: path, idleMs: 10 }); const two = new AgentLease({ directory: path });
  let expired = false;
  one.acquire(); one.idle(() => { expired = true; assert.throws(() => two.acquire(), busy); });
  assert.throws(() => two.acquire(), busy);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(expired, true); two.acquire(); two.release();
});

test("active live owners cannot be stolen and reacquire cancels idle expiration", async t => {
  const path = directory(t); const one = new AgentLease({ directory: path, idleMs: 5 }); const two = new AgentLease({ directory: path });
  let expired = false;
  one.acquire(); one.idle(() => { expired = true; }); one.acquire();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(expired, false); assert.throws(() => two.acquire(), busy); one.release();
});

test("a lease from an exited process is recovered without a time-based live-owner takeover", t => {
  const path = directory(t);
  const moduleUrl = new URL("./agent-lease.ts", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import {AgentLease} from ${JSON.stringify(moduleUrl)}; new AgentLease({directory:process.argv[1]}).acquire();`, path], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  const lease = new AgentLease({ directory: path }); lease.acquire(); lease.release();
  assert.deepEqual(readdirSync(path), []);
});

test("an empty lock left by an interrupted release is recoverable on every platform", t => {
  const path = directory(t); mkdirSync(join(path, "desktop.lock"));
  const one = new AgentLease({ directory: path }); const two = new AgentLease({ directory: path });
  one.acquire(); assert.throws(() => two.acquire(), busy);
  one.release(); two.acquire(); two.release();
  assert.deepEqual(readdirSync(path), []);
});

test("unrecognized ownership data fails closed and errors never expose local paths", t => {
  const path = directory(t); mkdirSync(join(path, "desktop.lock")); writeFileSync(join(path, "desktop.lock", "unknown"), "private");
  const lease = new AgentLease({ directory: path });
  assert.throws(() => lease.acquire(), error => { assert.ok(busy(error)); assert.doesNotMatch(String(error), /otto-lease-test|private/); return true; });
  lease.release(); assert.deepEqual(readdirSync(join(path, "desktop.lock")), ["unknown"]);
});

test("invalid lease directory and lock paths report unavailable instead of fabricating another owner", t => {
  const path = directory(t);
  const blocked = join(path, "private-path"); writeFileSync(blocked, "not a directory");
  assert.throws(() => new AgentLease({ directory: blocked }).acquire(), unavailable);
  assert.equal(readFileSync(blocked, "utf8"), "not a directory");
  writeFileSync(join(path, "desktop.lock"), "not a directory");
  assert.throws(() => new AgentLease({ directory: path }).acquire(), unavailable);
  assert.equal(readFileSync(join(path, "desktop.lock"), "utf8"), "not a directory");
});

test("a pre-existing symlink lock is rejected without replacing it or modifying its target", t => {
  const path = directory(t); const target = join(path, "target"); mkdirSync(target);
  writeFileSync(join(target, "preserved"), "unchanged");
  const lock = join(path, "desktop.lock"); symlinkSync(target, lock, "junction");
  assert.throws(() => new AgentLease({ directory: path }).acquire(), unavailable);
  assert.equal(lstatSync(lock).isSymbolicLink(), true);
  assert.deepEqual(readdirSync(target), ["preserved"]);
  assert.equal(readFileSync(join(target, "preserved"), "utf8"), "unchanged");
});

test("filesystem access denial reports unavailable without exposing the local path", t => {
  if (process.platform === "win32" || process.getuid?.() === 0) { t.skip("POSIX permission enforcement requires a non-root account."); return; }
  const path = directory(t); chmodSync(path, 0o500);
  try { assert.throws(() => new AgentLease({ directory: path }).acquire(), unavailable); }
  finally { chmodSync(path, 0o700); }
});

test("persistent rename EPERM without an owner is unavailable; a real live owner remains busy", t => {
  const path = directory(t); const one = new AgentLease({ directory: path }); const two = new AgentLease({ directory: path });
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (String(to) === join(path, "desktop.lock")) throw Object.assign(new Error("private-path denial"), { code: "EPERM" });
    return rename(from, to);
  });
  syncBuiltinESMExports();
  try { assert.throws(() => one.acquire(), unavailable); assert.deepEqual(readdirSync(path), []); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  one.acquire();
  t.mock.method(fs, "renameSync", () => { throw Object.assign(new Error("private-path denial"), { code: "EPERM" }); });
  syncBuiltinESMExports();
  try { assert.throws(() => two.acquire(), busy); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); one.release(); }
});

test("failed marker removal retains ownership and can be retried after filesystem repair", t => {
  const path = directory(t); const one = new AgentLease({ directory: path }); const two = new AgentLease({ directory: path });
  one.acquire();
  const marker = join(path, "desktop.lock", readdirSync(join(path, "desktop.lock"))[0]!);
  const unlink = fs.unlinkSync;
  t.mock.method(fs, "unlinkSync", value => {
    if (String(value) === marker) throw Object.assign(new Error("private-path denial"), { code: "EACCES" });
    return unlink(value);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => one.release(), unavailable);
    one.acquire(); assert.throws(() => two.acquire(), busy);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  one.release(); two.acquire(); two.release();
  assert.deepEqual(readdirSync(path), []);
});

test("idle release failure remains reserved without throwing from the timer", async t => {
  const path = directory(t); const one = new AgentLease({ directory: path, idleMs: 5 }); const two = new AgentLease({ directory: path });
  one.acquire(); const marker = join(path, "desktop.lock", readdirSync(join(path, "desktop.lock"))[0]!);
  const unlink = fs.unlinkSync; let invalidated = false;
  t.mock.method(fs, "unlinkSync", value => {
    if (String(value) === marker) throw Object.assign(new Error("private-path denial"), { code: "EPERM" });
    return unlink(value);
  });
  syncBuiltinESMExports();
  try {
    one.idle(() => { invalidated = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(invalidated, true); assert.throws(() => two.acquire(), busy);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); one.release(); }
});

test("four separate processes never hold the shared desktop lease concurrently", async t => {
  const path = directory(t); const moduleUrl = new URL("./agent-lease.ts", import.meta.url).href;
  const script = `import {AgentLease,AgentLeaseBusyError} from ${JSON.stringify(moduleUrl)};
    const lease=new AgentLease({directory:process.argv[1]});
    const until=Date.now()+5000;
    while(true){try{lease.acquire();break;}catch(error){if(!(error instanceof AgentLeaseBusyError)||Date.now()>until)throw error; await new Promise(r=>setTimeout(r,5));}}
    process.stdout.write(JSON.stringify({event:'acquired',at:Date.now()})+'\\n');
    await new Promise(r=>setTimeout(r,30));
    process.stdout.write(JSON.stringify({event:'releasing',at:Date.now()})+'\\n');lease.release();`;
  const results = await Promise.all(Array.from({ length: 4 }, () => new Promise<Array<{ event: string; at: number }>>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, path], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "";
    child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { errors += data; });
    child.once("error", reject); child.once("close", code => { if (code !== 0) reject(new Error(errors)); else resolve(output.trim().split("\n").map(line => JSON.parse(line))); });
  })));
  const intervals = results.map(events => { assert.equal(events.length, 2); return { from: events[0]!.at, until: events[1]!.at }; }).sort((a, b) => a.from - b.from);
  for (let index = 1; index < intervals.length; index++) assert.ok(intervals[index]!.from >= intervals[index - 1]!.until);
  assert.deepEqual(readdirSync(path), []);
});
