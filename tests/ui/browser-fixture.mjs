// Production renderer + a local mock bridge. No Electron IPC, native apps, keys, or providers.
// Build first, then: node tests/ui/browser-fixture.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist");

function installBridge() {
  const scenario = new URL(location.href).searchParams.get("scenario") || "success";
  const apps = [{ id: "editor", name: "TextEdit", pid: 101 }, { id: "form", name: "Contact form", pid: 102 }];
  const listeners = new Set();
  let batch = null, permitted = scenario !== "permissionReturn", voice = false, cached = "", epoch = 0, starts = 0;
  const delay = ms => new Promise(done => setTimeout(done, ms));
  const notify = () => {
    parent.postMessage({ fixture: true, starts }, location.origin);
    const counter = document.getElementById("fixture-start-count");
    if (counter) counter.textContent = `Guided starts: ${starts}`;
  };
  const ended = cancelled => { for (const listener of listeners) listener({ cancelled }); };
  const finishVoice = () => { if (voice) { voice = false; cached = "Add a short note to the current document."; ended(false); } };
  const cancelVoice = () => { epoch++; voice = false; cached = ""; ended(true); };
  window.addEventListener("message", event => {
    if (event.origin !== location.origin) return;
    if (event.data === "fixture-finish-voice") finishVoice();
    if (event.data === "fixture-cancel-voice") cancelVoice();
  });
  window.addEventListener("DOMContentLoaded", () => {
    if (parent !== window) return;
    document.title = "Otto browser renderer fixture — no native calls";
    const panel = document.createElement("details");
    panel.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:5000;max-width:230px;padding:7px 10px;background:#fff;border:1px solid #b9c6d4;border-radius:6px;color:#26313b;font:12px/1.6 system-ui;box-shadow:0 2px 10px #0001";
    panel.innerHTML = '<summary>Browser fixture controls</summary><div style="display:flex;gap:6px;margin:8px 0"><button type="button" id="fixture-finish">Finish fixture dictation</button><button type="button" id="fixture-cancel">Cancel fixture dictation</button></div><output id="fixture-start-count">Guided starts: 0</output>';
    panel.querySelector("#fixture-finish").onclick = finishVoice;
    panel.querySelector("#fixture-cancel").onclick = cancelVoice;
    document.body.append(panel);
  });
  window.otto = Object.freeze({
    config: async () => ({ desktop: true, platform: "darwin", version: "browser renderer fixture", configured: true, plannerConfigured: false, maxSteps: 20, sourceUrl: "https://github.com/NobleSpartan6/otto" }),
    apps: async () => ({ apps, permissions: { accessibility: permitted, screenCapture: false, platform: "darwin" } }),
    permissions: async () => { setTimeout(() => { permitted = true; }, 1400); return { accessibility: permitted, screenCapture: false, platform: "darwin" }; },
    start: async () => { starts++; notify(); throw new Error("Fixture recorded a guided start; no action was executed."); },
    run: async () => null, approve: async () => null, confirm: async () => null, stop: async () => null,
    saveKey: async () => {}, clearKey: async () => {}, savePlannerKey: async () => {}, clearPlannerKey: async () => {},
    exportRun: async () => false, exportFill: async () => false, openExternal: async () => {},
    prepareFill: async input => {
      batch = { id: "browser-batch", kind: "exact_fill", status: "preparing", appId: input.appId, app: apps.find(app => app.id === input.appId), windowTitle: "Contact form — browser fixture", createdAt: new Date().toISOString(), fields: Object.entries(input.fields).map(([label, proposed], i) => ({ label, before: i === 0 ? proposed : "Previous value", proposed, status: "pending" })), metrics: { observations: 0, nativeActions: 0, modelCalls: 0 } };
      const current = batch;
      setTimeout(() => {
        if (current.status !== "preparing") return;
        current.status = "awaiting_approval"; current.approvalId = "review"; current.metrics.observations = 1;
      }, 300);
      return structuredClone(batch);
    },
    batch: async () => structuredClone(batch),
    approveFill: async (_id, approvalId) => {
      if (!batch || batch.status !== "awaiting_approval" || approvalId !== batch.approvalId) throw new Error("This review is no longer available.");
      batch.status = "running"; delete batch.approvalId;
      const current = batch;
      const fillNext = index => {
        if (current.status !== "running" || scenario === "hold") return;
        const field = current.fields[index];
        if (!field) { current.status = "completed"; current.verification = "native_readback"; current.metrics.observations++; current.result = "Fixture native values match the approved text. No submit action was issued."; return; }
        current.metrics.observations++;
        if (scenario === "mismatch" && index === Math.min(1, current.fields.length - 1)) {
          field.status = "failed"; field.after = "Unexpected fixture value"; field.error = "Readback did not match the approved value.";
          current.metrics.nativeActions++; current.status = "failed"; current.error = "A value did not match. Remaining fields were not filled.";
          current.fields.slice(index + 1).forEach(item => { item.status = "skipped"; item.error = "Not executed."; }); return;
        }
        field.after = field.proposed; field.status = field.before === field.proposed ? "skipped" : "verified";
        if (field.status === "verified") current.metrics.nativeActions++;
        setTimeout(() => fillNext(index + 1), 350);
      };
      setTimeout(() => fillNext(0), 350);
      return structuredClone(batch);
    },
    stopFill: async () => {
      if (batch && ["preparing", "awaiting_approval", "running"].includes(batch.status)) {
        batch.status = "stopped"; delete batch.approvalId; batch.result = "Stopped. Earlier field results remain in this receipt.";
        batch.fields.forEach(field => { if (field.status === "pending") { field.status = "skipped"; field.error = "Not executed."; } });
      }
      return structuredClone(batch);
    },
    voiceStart: async () => { if (scenario === "voiceUnavailable") return { status: "unavailable", message: "Speech recognition is unavailable in this fixture. Your typed draft is preserved." }; epoch++; cached = ""; voice = true; return { status: "listening" }; },
    voiceStop: async () => { const revision = epoch; await delay(200); if (revision !== epoch) return { text: "" }; const text = cached || (voice ? "Add a short note to the current document." : ""); cached = ""; voice = false; ended(false); return { text }; },
    voiceCancel: async () => cancelVoice(),
    onVoiceEnded: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  });
  notify();
}

const shell = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Otto browser renderer fixture</title>
<style>body{margin:0;background:#dde3e8;font:13px system-ui;color:#26313b}header{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px;background:#fff;border-bottom:1px solid #ccd4dc}label{display:flex;gap:6px;align-items:center}select,button{font:inherit;padding:5px;border:1px solid #bbc6d2;border-radius:4px;background:white}iframe{display:block;border:0;margin:12px auto;background:white}#starts{margin-left:auto}</style>
<header><strong>Browser renderer fixture · No native calls</strong><label>Scenario<select id="scenario"><option value="success">Success</option><option value="mismatch">Mismatch</option><option value="hold">Hold execution</option><option value="permissionReturn">Permission return</option><option value="voiceUnavailable">Voice unavailable</option></select></label><label>Renderer viewport<select id="size"><option value="1280,820">1280 × 820</option><option value="900,660">900 × 660</option></select></label><button id="finish">Finish fixture dictation</button><button id="cancel">Cancel fixture dictation</button><span id="starts">Guided starts: 0</span></header>
<iframe id="app" title="Production Otto renderer with mock bridge" width="1280" height="820" src="/app?scenario=success"></iframe>
<script>const frame=document.getElementById('app');document.getElementById('scenario').onchange=e=>{frame.src='/app?scenario='+e.target.value};document.getElementById('size').onchange=e=>{const[w,h]=e.target.value.split(',');frame.width=w;frame.height=h};document.getElementById('finish').onclick=()=>frame.contentWindow.postMessage('fixture-finish-voice',location.origin);document.getElementById('cancel').onclick=()=>frame.contentWindow.postMessage('fixture-cancel-voice',location.origin);addEventListener('message',e=>{if(e.origin===location.origin&&e.data.fixture)document.getElementById('starts').textContent='Guided starts: '+e.data.starts});</script></html>`;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'self'; object-src 'none'");
    if (path === "/") { res.setHeader("Content-Type", "text/html"); res.end(shell); return; }
    if (path === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(`(${installBridge.toString()})();`); return; }
    if (path === "/app") { res.setHeader("Content-Type", "text/html"); res.end((await readFile(resolve(dist, "index.html"), "utf8")).replace('<script type="module"', '<script src="/fixture.js"></script><script type="module"')); return; }
    const file = resolve(dist, `.${decodeURIComponent(path)}`);
    if (!file.startsWith(`${dist}/`)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream"); res.end(await readFile(file));
  } catch { res.writeHead(404).end("Not found"); }
});
server.listen(Number(process.env.OTTO_FIXTURE_PORT || 4327), "127.0.0.1", () => console.log("Browser renderer fixture: http://127.0.0.1:4327"));
