import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs, { type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { writeProgress } from "./progress.js";

async function fixture(t: TestContext) {
  const directory = await fs.mkdtemp(join(tmpdir(), "otto-progress-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const path = join(directory, "progress.json");
  const previous = '{"status":"running","step":1}\n';
  await fs.writeFile(path, previous);
  return { directory, path, previous };
}
async function unchanged(directory: string, path: string, previous: string) {
  assert.equal(await fs.readFile(path, "utf8"), previous);
  assert.deepEqual(await fs.readdir(directory), ["progress.json"]);
}

test("awaited snapshots contain complete JSON, use private file mode, and leave no temporary files", async t => {
  const { directory, path } = await fixture(t);
  await writeProgress(path, { status: "running", step: 2, text: "東京\nÉlodie" });
  const final = { status: "complete", step: 3, rows: [{ passed: true }] };
  await writeProgress(path, final);
  const bytes = await fs.readFile(path, "utf8");
  assert.deepEqual(JSON.parse(bytes), final); assert.ok(bytes.endsWith("\n"));
  if (process.platform !== "win32") assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(directory), ["progress.json"]);
});

test("serialization failures preserve the previous snapshot and propagate original errors", async t => {
  const { directory, path, previous } = await fixture(t);
  const circular: { self?: unknown } = {}; circular.self = circular;
  await assert.rejects(writeProgress(path, circular), TypeError);
  await assert.rejects(writeProgress(path, undefined), TypeError);
  const failure = new Error("private serialization diagnostic");
  await assert.rejects(writeProgress(path, { toJSON() { throw failure; } }), error => error === failure);
  await unchanged(directory, path, previous);
});

test("partial writes and sync failures close their handle, retain previous bytes, and remove their temp", async t => {
  const { directory, path, previous } = await fixture(t);
  for (const stage of ["writeFile", "sync"] as const) {
    const failure = new Error(`private ${stage} diagnostic`);
    const open = fs.open; let opened: FileHandle | undefined;
    t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if (dirname(String(args[0])) === directory) {
        opened = handle;
        if (stage === "writeFile") {
          const write = handle.writeFile.bind(handle);
          t.mock.method(handle, "writeFile", async () => { await write("incomplete"); throw failure; });
        } else t.mock.method(handle, "sync", async () => { throw failure; });
      }
      return handle;
    });
    try {
      await assert.rejects(writeProgress(path, { step: 2 }), error => error === failure);
      assert.ok(opened); await assert.rejects(opened.stat(), { code: "EBADF" });
      await unchanged(directory, path, previous);
    } finally { t.mock.restoreAll(); }
  }
});

test("rename failure retains the old snapshot and never removes another writer's temporary file", async t => {
  const { directory, path, previous } = await fixture(t);
  const unrelated = join(directory, ".progress.json.someone-else.tmp");
  await fs.writeFile(unrelated, "unrelated evidence");
  const failure = Object.assign(new Error("private rename diagnostic"), { code: "EACCES" });
  t.mock.method(fs, "rename", async () => { throw failure; });
  try {
    await assert.rejects(writeProgress(path, { step: 2 }), error => error === failure);
    assert.equal(await fs.readFile(path, "utf8"), previous);
    assert.equal(await fs.readFile(unrelated, "utf8"), "unrelated evidence");
    assert.deepEqual((await fs.readdir(directory)).sort(), [".progress.json.someone-else.tmp", "progress.json"]);
  } finally { t.mock.restoreAll(); }
});

test("exclusive-open failure does not delete a temporary file the writer never owned", async t => {
  const { directory, path, previous } = await fixture(t);
  const open = fs.open; let collided = "";
  const failure = Object.assign(new Error("exclusive create failed"), { code: "EEXIST" });
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    collided = String(args[0]);
    const other = await open(...args); await other.writeFile("another owner's bytes"); await other.close();
    throw failure;
  });
  try {
    await assert.rejects(writeProgress(path, { step: 2 }), error => error === failure);
    assert.equal(await fs.readFile(path, "utf8"), previous);
    assert.equal(await fs.readFile(collided, "utf8"), "another owner's bytes");
    assert.equal((await fs.readdir(directory)).length, 2);
  } finally { t.mock.restoreAll(); }
});

test("readers retain the last complete snapshot until atomic rename finishes", async t => {
  const { directory, path, previous } = await fixture(t);
  const rename = fs.rename;
  let entered!: () => void, finish!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => { entered(); await gate; return rename(...args); });
  const writing = writeProgress(path, { step: 2 });
  try {
    await ready; assert.equal(await fs.readFile(path, "utf8"), previous);
    finish(); await writing;
    assert.deepEqual(JSON.parse(await fs.readFile(path, "utf8")), { step: 2 });
    assert.deepEqual(await fs.readdir(directory), ["progress.json"]);
  } finally { finish(); await writing; t.mock.restoreAll(); }
});
