import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { VoiceSession, VOICE_START_TIMEOUT_MS, VOICE_CAPTURE_TIMEOUT_MS, VOICE_STOP_TIMEOUT_MS } from "./voice.js";

class Child extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough();
  commands: string[] = []; signals: unknown[] = []; autoClose = true; closed = false;
  constructor() { super(); this.stdin.on("data", chunk => this.commands.push(String(chunk))); }
  kill(signal: unknown) { this.signals.push(signal); if (this.autoClose) queueMicrotask(() => this.close()); return true; }
  close() { if (!this.closed) { this.closed = true; this.emit("close", 0); } }
  emitFrame(value: unknown) { this.stdout.write(JSON.stringify(value) + "\n"); }
}
function setup(onEnd?: (event: { cancelled: boolean }) => void) {
  const children: Child[] = []; const calls: unknown[][] = [];
  const launch = ((...args: unknown[]) => { calls.push(args); const child = new Child(); children.push(child); return child as unknown as ChildProcessWithoutNullStreams; }) as typeof spawn;
  return { session: new VoiceSession("/fixture", false, { spawn: launch, platform: "darwin", onEnd }), children, calls };
}
async function listening(fixture: ReturnType<typeof setup>) {
  const started = fixture.session.start(); const child = fixture.children.at(-1)!;
  child.emitFrame({ event: "listening" }); assert.deepEqual(await started, { status: "listening" }); return child;
}

test("dictation uses only its native helper, does not inherit provider keys, and returns bounded Unicode after one stop", async () => {
  const events: { cancelled: boolean }[] = [];
  const fixture = setup(event => events.push(event)); const child = await listening(fixture); child.autoClose = false;
  assert.equal(fixture.session.isActive, true);
  const options = fixture.calls[0]![2] as { env: Record<string, unknown> };
  assert.ok(!("OPENAI_API_KEY" in options.env)); assert.ok(!("TYPESAFE_API_KEY" in options.env));
  child.stderr.write("private speech diagnostic");
  const first = fixture.session.stop(); const second = fixture.session.stop();
  assert.deepEqual(child.commands, ["stop\n"]);
  child.emitFrame({ event: "result", text: "Écrire 東京 🌿" });
  assert.deepEqual(events, []); assert.equal(fixture.session.isActive, true);
  child.close();
  assert.deepEqual(await first, { text: "Écrire 東京 🌿" });
  assert.deepEqual(await second, { text: "Écrire 東京 🌿" });
  assert.deepEqual(events, [{ cancelled: false }]); assert.equal(fixture.session.isActive, false);
  assert.ok(child.signals.includes("SIGKILL"));
  await assert.rejects(fixture.session.stop(), /Start dictation/);
});

test("stop during startup kills the helper before it can begin listening", async () => {
  const fixture = setup(); const started = fixture.session.start(); const child = fixture.children[0]!;
  await assert.rejects(fixture.session.start(), /already active/);
  const stopped = fixture.session.stop();
  child.emitFrame({ event: "listening" });
  assert.equal((await started).status, "unavailable"); assert.deepEqual(await stopped, { text: "" });
  assert.deepEqual(child.commands, []); assert.deepEqual(child.signals, ["SIGKILL"]);
});

test("cancel keeps the session reserved until close and ignores old helper output after restart", async () => {
  const events: { cancelled: boolean }[] = [];
  const fixture = setup(event => { events.push(event); throw new Error("Renderer closed"); });
  const child = await listening(fixture); child.autoClose = false;
  let cancelled = false;
  const cancellation = fixture.session.cancel().then(() => { cancelled = true; });
  await assert.rejects(fixture.session.start(), /already active/);
  child.emitFrame({ event: "result", text: "Cancelled speech" });
  assert.deepEqual(events, []); assert.equal(cancelled, false); assert.equal(fixture.session.isActive, true);
  assert.doesNotThrow(() => child.close()); await cancellation;
  assert.equal(cancelled, true); assert.equal(fixture.session.isActive, false); assert.deepEqual(events, [{ cancelled: true }]);
  const next = await listening(fixture);
  child.emit("error", new Error("late old diagnostic"));
  const stopped = fixture.session.stop(); next.emitFrame({ event: "result", text: "New speech" });
  assert.deepEqual(await stopped, { text: "New speech" });
  assert.deepEqual(events, [{ cancelled: true }, { cancelled: false }]);
});

test("cancellation discards a transcript already emitted but not yet delivered to Stop", async () => {
  const fixture = setup(); const child = await listening(fixture); child.autoClose = false;
  const stopped = fixture.session.stop(); child.emitFrame({ event: "result", text: "Discard this" });
  fixture.session.cancel(); child.close(); assert.deepEqual(await stopped, { text: "" });
});

test("synchronous and asynchronous spawn failures release startup state without raw diagnostics", async () => {
  let attempts = 0; const child = new Child();
  const launch = (() => { if (++attempts === 1) throw new Error("private credential"); return child as unknown as ChildProcessWithoutNullStreams; }) as unknown as typeof spawn;
  const session = new VoiceSession("/fixture", false, { spawn: launch, platform: "darwin" });
  const failed = await session.start(); assert.equal(failed.status, "unavailable"); assert.ok(!failed.message?.includes("private"));
  const second = session.start(); child.emit("error", new Error("private credential"));
  assert.equal((await second).status, "unavailable");
  await assert.rejects(session.stop(), error => error instanceof Error && !error.message.includes("private"));
});

test("invalid, oversized, unsolicited and partial protocol frames fail closed", async () => {
  for (const output of ["not JSON\n", "x".repeat(32_001), JSON.stringify({ event: "result", text: "before listening" }) + "\n"]) {
    const fixture = setup(); const started = fixture.session.start(); fixture.children[0]!.stdout.write(output);
    assert.equal((await started).status, "unavailable"); await assert.rejects(fixture.session.stop());
  }
  for (const text of ["x".repeat(4001), "contains\0nul"]) {
    const fixture = setup(); const child = await listening(fixture); const stopped = fixture.session.stop();
    child.emitFrame({ event: "result", text }); await assert.rejects(stopped, /invalid response/);
  }
});

test("startup, capture and stop deadlines terminate an unresponsive helper", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const initial = setup(); const starting = initial.session.start();
  t.mock.timers.tick(VOICE_START_TIMEOUT_MS);
  assert.equal((await starting).status, "unavailable"); await assert.rejects(initial.session.stop(), /could not start/);
  const capture = setup(); await listening(capture);
  t.mock.timers.tick(VOICE_CAPTURE_TIMEOUT_MS); await assert.rejects(capture.session.stop(), /timed out/);
  const stopping = setup(); await listening(stopping); const result = stopping.session.stop();
  t.mock.timers.tick(VOICE_STOP_TIMEOUT_MS); await assert.rejects(result, /could not finish/);
});

test("a broken stdin pipe is handled rather than crashing the main process", async () => {
  const fixture = setup(); const child = await listening(fixture);
  const result = fixture.session.stop(); child.stdin.emit("error", new Error("EPIPE private diagnostic"));
  await assert.rejects(result, error => error instanceof Error && /stopped/.test(error.message) && !error.message.includes("private"));
});

test("process exit does not discard a final stdout frame that drains before close", async () => {
  const fixture = setup(); const child = await listening(fixture);
  const result = fixture.session.stop(); child.emit("exit", 0); child.emitFrame({ event: "result", text: "Final words" });
  assert.deepEqual(await result, { text: "Final words" });
});

test("unsupported platforms never spawn or leave startup locked", async () => {
  const session = new VoiceSession("/fixture", false, { platform: "linux", spawn: (() => { throw new Error("Must not run"); }) as typeof spawn });
  assert.equal((await session.start()).status, "unavailable"); assert.equal((await session.start()).status, "unavailable");
});
