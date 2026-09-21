import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  safeStorage,
  shell,
  systemPreferences,
  type IpcMainInvokeEvent,
} from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { PlatformDriver } from "./native-driver.js";
import { AgentLease } from "./agent-lease.js";
import { OttoEngine } from "../core/engine.js";
import { BatchEngine } from "../core/batch.js";
import { VoiceSession } from "./voice.js";
import type { BatchInput } from "../shared/batch.js";
import { allowedExternalUrl, assertString } from "./ipc-policy.js";
import type { StartInput } from "../shared/types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
if (!app.isPackaged) {
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch {
    /* Settings or exported environment can supply keys. */
  }
}
let window: BrowserWindow | undefined;
let driver: PlatformDriver;
let engine: OttoEngine;
let batchEngine: BatchEngine;
let voice: VoiceSession;
let permissionChanging = false;
let key = process.env.TYPESAFE_API_KEY ?? "";
let plannerKey = process.env.OPENAI_API_KEY ?? "";
const keyFile = () => join(app.getPath("userData"), "typesafe-key.enc");
const plannerKeyFile = () => join(app.getPath("userData"), "planner-key.enc");

function authorize(event: IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== pathToFileURL(join(root, "dist/index.html")).href
  )
    throw new Error("Untrusted app request.");
}
function handle(channel: string, action: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args) => {
    authorize(event);
    return action(...args);
  });
}

async function loadKey() {
  try {
    if (!key && safeStorage.isEncryptionAvailable())
      key = safeStorage.decryptString(await readFile(keyFile()));
  } catch {
    /* No remembered key, or the OS account can no longer decrypt it. */
  }
  try {
    if (!plannerKey && safeStorage.isEncryptionAvailable())
      plannerKey = safeStorage.decryptString(await readFile(plannerKeyFile()));
  } catch {
    /* No remembered planner key. */
  }
}

function registerIPC() {
  let discoveryInFlight: ReturnType<PlatformDriver["apps"]> | undefined;
  let deniedReconnectAt = -Infinity;
  handle("otto:config", () => ({
    desktop: true,
    platform: process.platform,
    version: app.getVersion(),
    configured: Boolean(key),
    plannerConfigured: Boolean(plannerKey),
    sourceUrl: "https://github.com/NobleSpartan6/otto",
    maxSteps: 20,
  }));
  handle("otto:apps", () => {
    // Focus and permission-watch reads share one probe, so a reconnect cannot
    // cancel another discovery request. The helper remains the authority.
    if (discoveryInFlight) return discoveryInFlight;
    discoveryInFlight = (async () => {
      let discovery = await driver.apps();
      // Both processes can retain a denied AX check after a Settings change.
      // Do not gate a fresh helper on the main process's potentially stale check.
      const now = Date.now();
      if (process.platform === "darwin" && !discovery.permissions.accessibility &&
          !engine.isActive && !batchEngine.isActive && !voice.isActive && !permissionChanging &&
          now - deniedReconnectAt >= 5_000) {
        deniedReconnectAt = now;
        driver.cancel();
        discovery = await driver.apps();
      }
      if (discovery.permissions.accessibility) deniedReconnectAt = -Infinity;
      return discovery;
    })().finally(() => { discoveryInFlight = undefined; });
    return discoveryInFlight;
  });
  handle("otto:permissions", async (kind: unknown) => {
    if (kind !== "accessibility" && kind !== "screenCapture")
      throw new Error("Unknown permission.");
    if (permissionChanging || engine.isActive || batchEngine.isActive) throw new Error("Stop the current task before changing app permissions.");
    permissionChanging = true;
    try {
      if (process.platform === "darwin") {
        if (kind === "accessibility") systemPreferences.isTrustedAccessibilityClient(true);
        else await driver.requestPermission(kind);
        await shell.openExternal(kind === "accessibility"
          ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
          : "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
        driver.cancel();
        return await driver.permissions();
      }
      return await driver.requestPermission(kind);
    } finally { permissionChanging = false; }
  });
  handle("otto:start", async (input: StartInput) => {
    if (permissionChanging || voice.isActive) throw new Error("Finish dictation or the permission check before starting a task.");
    if (batchEngine.isActive) throw new Error("Finish or stop the form fill before starting another task.");
    if (
      input?.apiKey !== undefined &&
      (typeof input.apiKey !== "string" || input.apiKey.length > 500)
    )
      throw new Error("Invalid API key.");
    return engine.start(input, input.apiKey?.trim() || key, plannerKey);
  });
  handle("otto:run", (id: unknown) => {
    assertString(id);
    return engine.get(id);
  });
  handle("otto:approve", (id: unknown, actionId: unknown) => {
    assertString(id);
    assertString(actionId);
    return engine.approve(id, actionId);
  });
  handle("otto:confirm", (id: unknown) => {
    assertString(id);
    return engine.confirm(id);
  });
  handle("otto:stop", (id: unknown) => {
    assertString(id);
    return engine.stop(id);
  });
  handle("otto:save-key", async (value: unknown, remember: unknown) => {
    assertString(value, 500);
    if (typeof remember !== "boolean")
      throw new Error("Choose whether to remember the key.");
    if (remember) {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error(
          "OS-protected key storage is unavailable. Use this session only.",
        );
      await mkdir(app.getPath("userData"), { recursive: true });
      await writeFile(keyFile(), safeStorage.encryptString(value.trim()), {
        mode: 0o600,
      });
    } else await unlink(keyFile()).catch(() => undefined);
    key = value.trim();
  });
  handle("otto:clear-key", async () => {
    key = "";
    await unlink(keyFile()).catch(() => undefined);
  });
  handle("otto:save-planner-key", async (value: unknown, remember: unknown) => {
    assertString(value, 500);
    if (typeof remember !== "boolean")
      throw new Error("Choose whether to remember the key.");
    if (remember) {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error(
          "OS-protected key storage is unavailable. Use this session only.",
        );
      await mkdir(app.getPath("userData"), { recursive: true });
      await writeFile(
        plannerKeyFile(),
        safeStorage.encryptString(value.trim()),
        { mode: 0o600 },
      );
    } else await unlink(plannerKeyFile()).catch(() => undefined);
    plannerKey = value.trim();
  });
  handle("otto:clear-planner-key", async () => {
    plannerKey = "";
    await unlink(plannerKeyFile()).catch(() => undefined);
  });
  handle("otto:export", async (id: unknown) => {
    assertString(id);
    const run = engine.get(id);
    const { canceled, filePath } = await dialog.showSaveDialog(window!, {
      defaultPath: `otto-${id}.json`,
      filters: [{ name: "JSON trace", extensions: ["json"] }],
    });
    if (canceled || !filePath) return false;
    // Keep screenshots and app text out of the exported trace by default.
    const { snapshot: _snapshot, ...trace } = run;
    await writeFile(filePath, JSON.stringify(trace, null, 2), { mode: 0o600 });
    return true;
  });
  handle("otto:external", (url: unknown) =>
    shell.openExternal(allowedExternalUrl(url)),
  );
  handle("otto:prepare-fill", (input: BatchInput) => {
    if (permissionChanging || voice.isActive) throw new Error("Finish dictation or the permission check before preparing a fill.");
    if (engine.isActive) throw new Error("Stop the current task before preparing a form fill.");
    return batchEngine.prepare(input);
  });
  handle("otto:batch", (id: unknown) => { assertString(id); return batchEngine.get(id); });
  handle("otto:approve-fill", (id: unknown, approvalId: unknown) => {
    assertString(id); assertString(approvalId);
    if (engine.isActive) throw new Error("Stop the current task before filling a form.");
    return batchEngine.approve(id, approvalId);
  });
  handle("otto:stop-fill", (id: unknown) => { assertString(id); return batchEngine.stop(id); });
  handle("otto:export-fill", async (id: unknown) => {
    assertString(id);
    const receipt = batchEngine.get(id);
    const { canceled, filePath } = await dialog.showSaveDialog(window!, {
      defaultPath: `otto-fill-${id}.json`, filters: [{ name: "JSON receipt", extensions: ["json"] }],
    });
    if (canceled || !filePath) return false;
    await writeFile(filePath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
    return true;
  });
  handle("otto:voice-start", () => {
    if (engine.isActive || batchEngine.isActive) throw new Error("Finish or stop the current task before dictating another.");
    return voice.start();
  });
  handle("otto:voice-stop", () => voice.stop());
  handle("otto:voice-cancel", () => voice.cancel());
}

void app
  .whenReady()
  .then(async () => {
    driver = new PlatformDriver(
      app.isPackaged ? process.resourcesPath : root,
      app.isPackaged,
      new AgentLease(),
    );
    engine = new OttoEngine(driver);
    batchEngine = new BatchEngine(driver);
    voice = new VoiceSession(app.isPackaged ? process.resourcesPath : root, app.isPackaged, {
      onEnd: (event) => { if (window && !window.isDestroyed()) window.webContents.send("otto:voice-ended", event); },
    });
    await loadKey();
    registerIPC();
    window = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 880,
      minHeight: 660,
      title: "Otto",
      backgroundColor: "#ffffff",
      webPreferences: {
        preload: join(root, "dist-desktop/desktop/preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    window.webContents.session.webRequest.onHeadersReceived(
      (details, callback) =>
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'",
            ],
          },
        }),
    );
    await window.loadFile(join(root, "dist/index.html"));
    const shortcut = "CommandOrControl+Shift+Backspace";
    if (
      !globalShortcut.register(shortcut, () => {
        engine.stopAll();
        batchEngine.stopAll();
        voice.cancel();
        window?.show();
      })
    ) {
      await dialog.showMessageBox(window, {
        type: "warning",
        message: "The global stop shortcut is unavailable.",
        detail:
          "Use the Stop button in Otto. Another app may have registered the shortcut.",
      });
    }
    window.on("closed", () => {
      engine.stopAll();
      batchEngine.stopAll();
      voice.cancel();
      window = undefined;
    });
  })
  .catch((error) => {
    console.error(
      "Otto could not start:",
      error instanceof Error ? error.message : "unknown startup error",
    );
    app.quit();
  });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  engine?.stopAll();
  batchEngine?.stopAll();
  voice?.cancel();
  driver?.cancel();
  key = "";
  plannerKey = "";
  globalShortcut.unregisterAll();
});
