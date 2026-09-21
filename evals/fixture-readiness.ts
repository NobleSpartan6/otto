import type { NativeDriver, NativeSnapshot } from "../shared/types.js";

const WINDOW_NOT_READY = "The app has no accessible window. Open a window, then try again.";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, maximum: number): value is string => typeof value === "string" && value.length <= maximum && !value.includes("\0");
const nonempty = (value: unknown, maximum: number): value is string => text(value, maximum) && !!value.trim();
type ReadinessCode = "invalid_input" | "bad_snapshot" | "scope" | "state_changed" | "ambiguous" | "native_error" | "timeout" | "cancelled";
export class FixtureReadinessError extends Error {
  constructor(public readonly code: ReadinessCode, message: string) { super(message); this.name = "FixtureReadinessError"; }
}

/** Missing controls/capabilities may be startup lag; malformed or changed data is not. */
function ready(value: unknown, appId: string, expected: Array<[string, string]>): boolean {
  const invalid = () => { throw new FixtureReadinessError("bad_snapshot", "Fixture readiness received an invalid native snapshot."); };
  if (!record(value) || !record(value.app) || !nonempty(value.app.id, 256) ||
      !Number.isSafeInteger(value.app.pid) || Number(value.app.pid) < 2 || !nonempty(value.app.name, 256)) return invalid();
  if (value.app.id !== appId || value.app.pid !== Number(appId))
    throw new FixtureReadinessError("scope", "Fixture readiness observed a different process. No action was attempted.");
  if (!nonempty(value.snapshotId, 256) || !nonempty(value.windowToken, 256) ||
      !text(value.title, 16000) || !text(value.text, 64000) || !text(value.capturedAt, 80) || !Number.isFinite(Date.parse(value.capturedAt)) ||
      !Array.isArray(value.controls) || value.controls.length > 2048) return invalid();
  const ids = new Set<string>();
  for (const control of value.controls) {
    if (!record(control) || !nonempty(control.id, 256) || ids.has(control.id) || !nonempty(control.role, 256) || !text(control.label, 2000) ||
        typeof control.enabled !== "boolean" || !Array.isArray(control.actions) || control.actions.length > 16 ||
        control.actions.some(action => !nonempty(action, 96)) ||
        (control.editable !== undefined && typeof control.editable !== "boolean") ||
        (control.sensitive !== undefined && typeof control.sensitive !== "boolean") ||
        (control.source !== undefined && !["accessibility", "ocr"].includes(String(control.source))) ||
        (control.value !== undefined && !text(control.value, 2001))) return invalid();
    ids.add(control.id);
  }
  let complete = true;
  const snapshot = value as unknown as NativeSnapshot;
  for (const [label, initial] of expected) {
    const matches = snapshot.controls.filter(control => control.source === "accessibility" && control.label === label);
    if (matches.length > 1) throw new FixtureReadinessError("ambiguous", "Fixture readiness found an ambiguous native field.");
    if (!matches.length) { complete = false; continue; }
    const field = matches[0]!;
    if (field.value === undefined) return invalid();
    if (field.value !== initial) throw new FixtureReadinessError("state_changed", "Fixture initial values changed before readiness. No action was attempted.");
    if (field.sensitive) throw new FixtureReadinessError("bad_snapshot", "Fixture readiness found a protected native field.");
    if (!field.enabled || !field.editable || !field.actions.includes("fill")) complete = false;
  }
  return complete;
}

/** Read-only startup check for a driver already configured to one owned fixture PID. */
export async function waitForFixtureReady(
  driver: Pick<NativeDriver, "observe" | "cancel">,
  appId: string,
  expectedValues: Record<string, string>,
  options: { signal?: AbortSignal; timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ attempts: number; elapsedMs: number }> {
  const timeoutMs = options.timeoutMs ?? 3000, intervalMs = options.intervalMs ?? 150;
  if (!/^[1-9]\d*$/.test(appId) || !Number.isSafeInteger(Number(appId)) || Number(appId) < 2 ||
      !record(expectedValues) || Object.keys(expectedValues).length < 1 || Object.keys(expectedValues).length > 16 ||
      Object.entries(expectedValues).some(([label, value]) => !nonempty(label, 256) || !text(value, 2000)) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3000 ||
      !Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 3000)
    throw new FixtureReadinessError("invalid_input", "Fixture readiness requires one owned PID, bounded initial values, and a timeout of at most three seconds.");
  const expected = Object.entries(expectedValues);
  const start = performance.now();
  let attempts = 0, stopped: FixtureReadinessError | undefined, pause: ReturnType<typeof setTimeout> | undefined;
  let rejectStop!: (error: FixtureReadinessError) => void;
  const stopPromise = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  void stopPromise.catch(() => undefined); // A pre-aborted signal need not start a read.
  const stop = (code: "timeout" | "cancelled") => {
    if (stopped) return;
    stopped = new FixtureReadinessError(code, code === "timeout" ? "Fixture did not become ready within the startup deadline." : "Fixture readiness was cancelled.");
    try { driver.cancel(); } catch { /* Keep cancellation diagnostics static. */ }
    rejectStop(stopped);
  };
  const abort = () => stop("cancelled");
  const timer = setTimeout(() => stop("timeout"), timeoutMs);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (options.signal?.aborted) abort();
    while (true) {
      if (stopped) throw stopped;
      let snapshot: unknown, windowPending = false;
      try {
        attempts++;
        snapshot = await Promise.race([driver.observe(appId), stopPromise]);
      } catch (error) {
        if (stopped) throw stopped;
        if (!(error instanceof Error) || error.message !== WINDOW_NOT_READY)
          throw new FixtureReadinessError("native_error", "Fixture readiness failed during native observation. No action was attempted.");
        windowPending = true;
      }
      if (stopped) throw stopped;
      if (!windowPending && ready(snapshot, appId, expected)) return { attempts, elapsedMs: Math.round(performance.now() - start) };
      await Promise.race([new Promise<void>(resolve => { pause = setTimeout(resolve, intervalMs); }), stopPromise]);
    }
  } finally {
    clearTimeout(timer); if (pause) clearTimeout(pause);
    options.signal?.removeEventListener("abort", abort);
  }
}
