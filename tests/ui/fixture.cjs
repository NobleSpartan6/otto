// Disposable Electron UI fixture. No providers, keys, native driver, or app effects.
// Run after npm run build: npx electron tests/ui/fixture.cjs
const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const { join } = require("node:path");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const root = join(__dirname, "../..");
const profile = mkdtempSync(join(tmpdir(), "otto-ui-qa-"));
app.setPath("userData", profile);
let scenario = "ready";
let run = null;
let batchRun = null;
let fixtureEpoch = 0;
let voiceListening = false;
let voiceEpoch = 0;
let voiceCachedText = "";
let fixturePermissionsGranted = false;
let window;
let configured = true;
let plannerConfigured = false;
const apps = [
  { id: "fixture-editor", name: "TextEdit", pid: 101 },
  { id: "fixture-browser", name: "Browser", pid: 102 },
  { id: "fixture-sheet", name: "Spreadsheet", pid: 103 },
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `fixture-${i}`,
    name: `Sample application ${i + 1}${i === 0 ? " with a very long name that wraps" : ""}`,
    pid: 200 + i,
  })),
];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function makeRun(input) {
  return {
    id: "fixture-run",
    goal: input.goal,
    appIds: input.appIds,
    mode: input.mode,
    status: "running",
    step: 1,
    maxSteps: 20,
    createdAt: new Date().toISOString(),
    subgoal: "Enter the supplied text in the selected document.",
    events: [
      {
        id: "1",
        kind: "observation",
        message: "Observed TextEdit. Found an editable document.",
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
function progress(status) {
  if (!run)
    run = makeRun({
      goal: "In TextEdit, type “Hello from Otto”.",
      appIds: ["fixture-editor"],
      mode: "jev",
    });
  run.status = status;
  run.step = status === "completed" ? 3 : 2;
  run.pendingAction =
    status === "awaiting_approval"
      ? {
          id: "review-1",
          label: "Fill Document with “Hello from Otto”",
          appName: "TextEdit",
          operation: "fill",
          target: "Document",
          value: "Hello from Otto",
          reason:
            "Enter the exact text you supplied into the current TextEdit document.",
        }
      : undefined;
  if (run.pendingAction && scenario === "long-approval")
    run.pendingAction.value =
      "This is a long proposed paragraph for keyboard and scrolling checks.\n".repeat(
        24,
      );
  run.snapshot = {
    snapshotId: "fixture-snapshot",
    app: apps[0],
    title: "Untitled — QA fixture",
    text: "Document\nHello from Otto",
    controls: [
      {
        id: "field",
        role: "AXTextArea",
        label: "Document",
        value: "Hello from Otto",
        editable: true,
        enabled: true,
        actions: ["fill"],
      },
    ],
    capturedAt: new Date().toISOString(),
  };
  run.events = Array.from({ length: 18 }, (_, i) => ({
    id: String(i),
    kind: i % 3 ? "observation" : "action",
    message:
      i % 3
        ? `Observed the current document at step ${i + 1}.`
        : "Entered the supplied text.",
    timestamp: new Date(Date.now() - (18 - i) * 1000).toISOString(),
    latencyMs: 93,
  }));
  run.metrics = {
    jevInputTokens: 820,
    plannerInputTokens: null,
    plannerOutputTokens: null,
    modelLatencyMs: 420,
  };
  run.decisionCalls = 2;
  run.error =
    status === "failed"
      ? "The selected window changed before the action could be verified. No retry was made."
      : undefined;
  run.result =
    status === "blocked"
      ? "The document is read-only. Open an editable document, then start a fresh attempt."
      : status === "completed"
        ? "You confirmed the task is complete."
        : undefined;
  run.verification = status === "completed" ? "user_confirmed" : undefined;
}
function handle(name, fn) {
  ipcMain.handle(`otto:${name}`, (_event, ...args) => fn(...args));
}
handle("config", async () => {
  if (scenario === "loading") await delay(2500);
  if (scenario === "runtime-error")
    throw new Error("The desktop runtime could not be reached. Try again.");
  return {
    desktop: true,
    platform: process.platform,
    version: "UI fixture",
    configured,
    plannerConfigured,
    maxSteps: 20,
    sourceUrl: "https://github.com/NobleSpartan6/otto",
  };
});
handle("apps", async () => {
  if (scenario === "loading") await delay(2500);
  if (scenario === "late-apps") await delay(6000);
  if (scenario === "apps-error")
    throw new Error("Unable to list applications. Refresh to try again.");
  return {
    apps: scenario === "empty" ? [] : apps,
    permissions: {
      platform: process.platform,
      accessibility:
        !["permissions", "permissionReturn"].includes(scenario) ||
        fixturePermissionsGranted,
      screenCapture: false,
    },
  };
});
handle("permissions", async () => {
  if (scenario === "permissionReturn")
    schedule(2200, () => {
      fixturePermissionsGranted = true;
    });
  else fixturePermissionsGranted = true;
  return {
    platform: process.platform,
    accessibility: fixturePermissionsGranted,
    screenCapture: false,
  };
});
handle("start", async (input) => {
  await delay(650);
  if (scenario === "start-error")
    throw new Error("TypeSafe rejected the API key. Check the configured key.");
  run = makeRun(input);
  if (scenario !== "running")
    setTimeout(
      () =>
        progress(
          scenario === "failed" || scenario === "blocked"
            ? scenario
            : "awaiting_approval",
        ),
      1200,
    );
  return run;
});
handle("run", () => {
  if (scenario === "poll-error")
    throw new Error("Unable to refresh this run. Stop remains available.");
  return run;
});
handle("approve", async () => {
  await delay(500);
  progress("running");
  setTimeout(() => progress("awaiting_confirmation"), 900);
  return run;
});
handle("confirm", () => {
  progress("completed");
  return run;
});
handle("stop", () => {
  progress("stopped");
  return run;
});
handle("save-key", async (value) => {
  await delay(500);
  if (scenario === "key-error")
    throw new Error("Unable to save the key. Please try again.");
  configured = Boolean(value);
});
handle("save-planner-key", async (value) => {
  await delay(500);
  plannerConfigured = Boolean(value);
});
handle("clear-key", () => {
  configured = false;
});
handle("clear-planner-key", () => {
  plannerConfigured = false;
});
handle("export", () => true);
handle("external", () => undefined);

// Batch and speech are isolated UI responses. They never invoke a native helper.
function schedule(ms, callback) {
  const epoch = fixtureEpoch;
  setTimeout(() => {
    if (epoch === fixtureEpoch) callback();
  }, ms);
}
handle("prepare-fill", async (input) => {
  batchRun = {
    id: "fixture-batch",
    kind: "exact_fill",
    status: "preparing",
    appId: input.appId,
    app: apps.find((item) => item.id === input.appId),
    windowTitle: "Contact form — QA fixture",
    createdAt: new Date().toISOString(),
    fields: Object.entries(input.fields).map(([label, proposed], index) => ({
      label,
      before: index === 0 ? proposed : "Previous value",
      proposed,
      status: "pending",
    })),
    metrics: { observations: 0, nativeActions: 0, modelCalls: 0 },
  };
  if (scenario !== "batchPreparing")
    schedule(700, () => {
      if (batchRun?.status !== "preparing") return;
      batchRun.status = "awaiting_approval";
      batchRun.approvalId = "fixture-fill-approval";
      batchRun.expiresAt = new Date(Date.now() + 300_000).toISOString();
      batchRun.metrics.observations = 1;
      if (scenario === "batchExpired")
        schedule(6000, () => {
          if (batchRun?.status !== "awaiting_approval") return;
          batchRun.status = "expired";
          delete batchRun.approvalId;
          batchRun.result =
            "The reviewed fill expired. Prepare a fresh review. No fields were changed.";
          batchRun.fields.forEach((field) => {
            field.status = "skipped";
            field.error = "Not executed.";
          });
        });
    });
  return batchRun;
});
handle("batch", () => batchRun);
handle("approve-fill", async (_id, approvalId) => {
  if (
    !batchRun ||
    batchRun.status !== "awaiting_approval" ||
    approvalId !== batchRun.approvalId
  )
    throw new Error("This fixture approval is no longer available.");
  await delay(500);
  batchRun.status = "running";
  delete batchRun.approvalId;
  const fillNext = (index) => {
    if (!batchRun || batchRun.status !== "running") return;
    const field = batchRun.fields[index];
    if (!field) {
      batchRun.status = "completed";
      batchRun.verification = "native_readback";
      batchRun.metrics.observations++;
      batchRun.result =
        "All requested values match the fixture readback. No submit action was issued.";
      return;
    }
    batchRun.metrics.observations++;
    if (
      scenario === "batchMismatch" &&
      index === Math.min(1, batchRun.fields.length - 1)
    ) {
      field.status = "failed";
      field.after = "Unexpected fixture value";
      field.error = "The native readback did not match the approved text.";
      batchRun.metrics.nativeActions++;
      batchRun.status = "failed";
      batchRun.error =
        "A field did not match. Remaining fields were not filled.";
      batchRun.fields.slice(index + 1).forEach((item) => {
        item.status = "skipped";
        item.error = "Not executed.";
      });
      return;
    }
    field.after = field.proposed;
    field.status = field.before === field.proposed ? "skipped" : "verified";
    if (field.status === "verified") batchRun.metrics.nativeActions++;
    schedule(650, () => fillNext(index + 1));
  };
  schedule(650, () => fillNext(0));
  return batchRun;
});
handle("stop-fill", () => {
  if (
    batchRun &&
    ["preparing", "awaiting_approval", "running"].includes(batchRun.status)
  ) {
    batchRun.status = "stopped";
    delete batchRun.approvalId;
    batchRun.result = "Fill stopped. Review any earlier field results.";
    batchRun.fields.forEach((field) => {
      if (field.status === "pending") {
        field.status = "skipped";
        field.error = "Not executed.";
      }
    });
  }
  return batchRun;
});
handle("export-fill", () => true);
function voiceEnded(cancelled) {
  if (window && !window.isDestroyed())
    window.webContents.send("otto:voice-ended", { cancelled });
}
function simulateVoiceFinish() {
  if (!voiceListening) return;
  voiceListening = false;
  voiceCachedText = "Add a short note to the current document.";
  voiceEnded(false);
}
function simulateVoiceCancel() {
  voiceEpoch++;
  voiceListening = false;
  voiceCachedText = "";
  voiceEnded(true);
}
handle("voice-start", async () => {
  const revision = ++voiceEpoch;
  await delay(300);
  if (revision !== voiceEpoch)
    return { status: "unavailable", message: "Cancelled." };
  if (scenario !== "voiceListening")
    return {
      status: "unavailable",
      message:
        "Dictation is unavailable in this fixture scenario. Your typed text is preserved. Choose voiceListening to test transcript insertion.",
    };
  voiceListening = true;
  voiceCachedText = "";
  return { status: "listening" };
});
handle("voice-stop", async () => {
  const revision = voiceEpoch;
  await delay(450);
  if (revision !== voiceEpoch) return { text: "" };
  const text =
    voiceCachedText ||
    (voiceListening ? "Add a short note to the current document." : "");
  voiceListening = false;
  voiceCachedText = "";
  voiceEnded(false);
  return { text };
});
handle("voice-cancel", simulateVoiceCancel);

function setScenario(value) {
  scenario = value;
  fixtureEpoch++;
  voiceEpoch++;
  run = null;
  batchRun = null;
  voiceListening = false;
  voiceCachedText = "";
  fixturePermissionsGranted = false;
  configured = value !== "onboarding" && value !== "late-apps";
  plannerConfigured = false;
  window.reload();
}
void app.whenReady().then(async () => {
  app.setAccessibilitySupportEnabled(true);
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 620,
    minHeight: 480,
    title: "Otto UI QA",
    webPreferences: {
      preload: join(root, "dist-desktop/desktop/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.webContents.session.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'",
        ],
      },
    }),
  );
  window.webContents.on("page-title-updated", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("console-message", (details) => {
    if (details.level === "error" || details.level === "warning")
      process.stderr.write(`renderer ${details.level}: ${details.message}\n`);
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "Otto QA", submenu: [{ role: "quit" }] },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "resetZoom" },
        ],
      },
      {
        label: "Scenario",
        submenu: [
          "ready",
          "onboarding",
          "loading",
          "late-apps",
          "permissions",
          "empty",
          "apps-error",
          "runtime-error",
          "start-error",
          "key-error",
          "running",
          "failed",
          "blocked",
          "poll-error",
          "long-approval",
          "permissionReturn",
          "batchSuccess",
          "batchMismatch",
          "batchPreparing",
          "batchExpired",
          "voiceUnavailable",
          "voiceListening",
        ].map((value) => ({ label: value, click: () => setScenario(value) })),
      },
      {
        label: "Voice events",
        submenu: [
          { label: "Simulate natural completion", click: simulateVoiceFinish },
          {
            label: "Simulate emergency cancellation",
            click: simulateVoiceCancel,
          },
        ],
      },
      {
        label: "Window size",
        submenu: [
          {
            label: "Normal 1280 × 820",
            click: () => window.setSize(1280, 820),
          },
          { label: "Small 900 × 660", click: () => window.setSize(900, 660) },
          { label: "Narrow 680 × 740", click: () => window.setSize(680, 740) },
        ],
      },
    ]),
  );
  await window.loadFile(join(root, "dist/index.html"));
  window.setTitle("Otto UI QA — isolated fixtures");
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => rmSync(profile, { recursive: true, force: true }));
