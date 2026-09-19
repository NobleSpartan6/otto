import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2);
let fault = "none";
let prefill = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--fault") fault = args[++index] ?? "";
  else if (args[index] === "--prefill") prefill = true;
  else throw new Error("Usage: tsx scripts/launch-form-fixture.ts [--fault none|changed|disappeared|duplicate|reject] [--prefill]");
}
if (!["none", "changed", "disappeared", "duplicate", "reject"].includes(fault)) throw new Error("Unknown fixture fault mode.");
if (process.platform !== "darwin") throw new Error("This fixture requires macOS.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(join(tmpdir(), "otto-form-eval-"));
const appPath = join(directory, "OttoFormFixture.app");
const contents = join(appPath, "Contents");
const executable = join(contents, "MacOS", "OttoFormFixture");
const statePath = join(directory, "state.json");
await mkdir(dirname(executable), { recursive: true });
await writeFile(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>ai.otto.form-fixture</string><key>CFBundleName</key><string>Otto Form Fixture</string><key>CFBundleExecutable</key><string>OttoFormFixture</string><key>CFBundlePackageType</key><string>APPL</string><key>NSHighResolutionCapable</key><true/></dict></plist>`);
// Deliberately do not inherit API keys, provider configuration, or other secrets.
const environment: NodeJS.ProcessEnv = {
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  LANG: process.env.LANG,
};
if (existsSync("/Applications/Xcode.app/Contents/Developer")) environment.DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";
const compile = spawnSync("xcrun", ["swiftc", "-swift-version", "6", "-strict-concurrency=complete", "-parse-as-library",
  join(root, "tests/native/FormFixture.swift"), "-o", executable, "-framework", "AppKit"],
{ env: environment, stdio: "inherit", timeout: 60_000 });
if (compile.status !== 0) throw new Error("Native form fixture compilation failed.");
const log = await open(join(directory, "fixture.log"), "a", 0o600);
const child = spawn(executable, [statePath, fault, prefill ? "prefill" : "blank"], {
  env: environment, detached: true, stdio: ["ignore", log.fd, log.fd],
});
await log.close();
child.unref();
let startupError: Error | undefined;
child.once("error", error => { startupError = error; });
let state: { pid: number; status: string } | undefined;
for (let attempt = 0; attempt < 100; attempt++) {
  if (startupError) throw startupError;
  try { state = JSON.parse(await readFile(statePath, "utf8")); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (state?.status === "ready" && state.pid === child.pid) break;
  await delay(100);
}
if (!state || state.status !== "ready" || state.pid !== child.pid) {
  child.kill("SIGTERM");
  throw new Error("Fixture did not become ready; its exact child process was stopped.");
}
const literalFields = {
  "Project name": "Otto Demo",
  "Repository URL": "https://code.example.invalid/otto-demo",
  "Local directory": "/tmp/otto-demo",
  "Package manager": "npm",
  "Test command": "npm test",
  "Notes": "Local fixture only — no files changed.",
};
const report = { appPath, executable, pid: child.pid, appId: String(child.pid), statePath, fault, prefill,
  literalFields, task: Object.entries(literalFields).map(([label, value]) => `Set ${label} to ${JSON.stringify(value)}`).join("; ") + ". Fill only. Do not submit or reset.",
  cleanup: "Close the fixture window when finished. It exits automatically after 30 minutes; remove its temporary directory after collecting the oracle." };
await writeFile(join(directory, "launch.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
