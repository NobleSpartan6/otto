import { createHash, randomUUID } from "node:crypto";
import type { NativeControl, NativeDriver, NativeSnapshot } from "../shared/types.js";
import type { BatchInput, BatchRun, BatchStatus } from "../shared/batch.js";
import { isSensitive } from "./candidates.js";

export const BATCH_APPROVAL_TTL_MS = 120_000;
const BATCH_OBSERVATION_TTL_MS = 30_000;
export const BATCH_RUN_TIMEOUT_MS = 120_000;
const terminal = (status: BatchStatus) => ["completed", "stopped", "failed", "expired"].includes(status);
const normalized = (value: string) => value.trim().normalize("NFC");
const literal = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && !value.includes("\0");
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const nativeField = (control: NativeControl) => control.source === "accessibility" && (control.editable || control.actions.includes("fill"));
const finiteBounds = (bounds: NativeControl["bounds"]) => Boolean(bounds) && [bounds!.x, bounds!.y, bounds!.width, bounds!.height].every(Number.isFinite);
const visibleBounds = (bounds: NativeControl["bounds"]) => finiteBounds(bounds) && bounds!.width > 0 && bounds!.height > 0;
class BatchFault extends Error { constructor(message: string, readonly field?: number) { super(message); } }
interface Target { identity: string; role: string; label: string; bounds: NativeControl["bounds"]; expected: string }
interface State {
  run: BatchRun;
  epoch: number;
  busy: boolean;
  work?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  identity?: { pid: number; windowToken: string; documentToken?: string; title: string; shape: string };
  targets: Target[];
  currentField?: number;
  unverifiedWrite?: number;
  approvalDeadline?: number;
}

function shape(snapshot: NativeSnapshot): string {
  // Native IDs are one-shot. Bind every editable field, including unrequested
  // fields, while unrelated menu/chrome visibility can change with app focus.
  const rows = snapshot.controls.filter(nativeField)
    .map(({ identity, role, label, bounds, editable, sensitive, actions }) => JSON.stringify({ identity, role, label, bounds, editable, sensitive, actions: [...actions].sort() }))
    .sort();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
function validate(input: BatchInput) {
  if (!plain(input) || Object.keys(input).some(key => !["appId", "fields", "consent"].includes(key)) ||
      input.consent !== true || !literal(input.appId, 512) || !input.appId.trim() || !plain(input.fields))
    throw new Error("Select one application and consent to reading its fields.");
  const entries = Object.entries(input.fields);
  if (!entries.length || entries.length > 16 || entries.some(([label, value]) => !literal(label, 256) || !label.trim() || !literal(value, 2000)) ||
      entries.reduce((total, [, value]) => total + String(value).length, 0) > 16_000 ||
      new Set(entries.map(([label]) => normalized(label))).size !== entries.length)
    throw new Error("Supply 1–16 unique field labels and literal values: at most 2,000 characters each and 16,000 total.");
}

/** Executes only an immutable, explicitly reviewed set of native field fills. */
export class BatchEngine {
  private readonly runs = new Map<string, State>();
  private currentState?: State;
  constructor(private readonly driver: NativeDriver) {}
  get active() { return Boolean(this.currentState); }
  get isActive() { return this.active; }
  get(id: string): BatchRun { return structuredClone(this.require(id).run); }
  async awaitIdle(id: string): Promise<BatchRun> { await this.require(id).work; return this.get(id); }

  async prepare(input: BatchInput): Promise<BatchRun> {
    validate(input);
    if (this.active) throw new Error("Stop the current fill and wait for it to finish before preparing another.");
    const state: State = { epoch: 0, busy: false, targets: [], run: {
      id: randomUUID(), kind: "exact_fill", appId: input.appId, status: "preparing", createdAt: new Date().toISOString(),
      fields: Object.entries(input.fields).map(([label, proposed]) => ({ label: normalized(label), before: "", proposed, status: "pending" })),
      metrics: { observations: 0, nativeActions: 0, modelCalls: 0 },
    } };
    this.currentState = state;
    this.runs.set(state.run.id, state);
    this.deadline(state, BATCH_RUN_TIMEOUT_MS, "The fill preparation timed out.");
    this.launch(state, async epoch => {
      const discovery = await this.driver.apps();
      if (!this.live(state, epoch)) return;
      const app = discovery.apps.find(item => item.id === state.run.appId);
      if (!discovery.permissions.accessibility || !app || !Number.isSafeInteger(app.pid) || app.pid < 1)
        throw new BatchFault("The selected app or Accessibility permission is unavailable.");
      state.run.app = { ...app };
      await this.driver.configure([app.id]);
      if (!this.live(state, epoch)) return;
      const snapshot = await this.observe(state, epoch);
      if (!snapshot) return;
      state.run.windowTitle = snapshot.title;
      let unresolved = false;
      for (const [index, field] of state.run.fields.entries()) {
        const matches = snapshot.controls.filter(control => nativeField(control) && normalized(control.label) === field.label);
        const control = matches[0];
        let error: string | undefined;
        if (matches.length !== 1) error = matches.length ? "The field label is ambiguous." : "No unique native editable field has this label.";
        else if (!control!.enabled || !control!.editable || !control!.actions.includes("fill") || isSensitive(control!)) error = "This field is disabled, protected, or not natively editable.";
        else if (!literal(control!.identity, 256) || !control!.identity) error = "The field's native identity cannot be verified.";
        else if (!visibleBounds(control!.bounds)) error = "The field's visible native bounds cannot be verified.";
        else if (!literal(control!.value, 2000)) error = "The field's complete current value cannot be verified.";
        else if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i.test(field.proposed)) error = "Credential-like values are not supported in batch fills.";
        if (error) { field.status = "failed"; field.error = error; unresolved = true; continue; }
        field.label = control!.label;
        field.before = control!.value!;
        state.targets[index] = { identity: control!.identity!, role: control!.role, label: control!.label, bounds: structuredClone(control!.bounds), expected: control!.value! };
      }
      if (unresolved) throw new BatchFault("Every field must resolve uniquely before review. Nothing was changed.");
      state.identity = { pid: snapshot.app.pid, windowToken: snapshot.windowToken!, documentToken: snapshot.documentToken, title: snapshot.title, shape: shape(snapshot) };
      state.approvalDeadline = Date.now() + BATCH_APPROVAL_TTL_MS;
      state.run.expiresAt = new Date(state.approvalDeadline).toISOString();
      state.run.approvalId = randomUUID();
      state.run.status = "awaiting_approval";
      this.deadline(state, BATCH_APPROVAL_TTL_MS, "The reviewed fill expired. Prepare a fresh review.");
    });
    return this.get(state.run.id);
  }

  async approve(id: string, approvalId: string): Promise<BatchRun> {
    const state = this.require(id);
    if (state.busy || state.run.status !== "awaiting_approval" || state.run.approvalId !== approvalId)
      throw new Error("That fill approval is no longer available.");
    if (Date.now() >= state.approvalDeadline!) {
      this.finish(state, "expired", "The reviewed fill expired. Prepare a fresh review.");
      return this.get(id);
    }
    delete state.run.approvalId;
    state.run.status = "running";
    this.deadline(state, BATCH_RUN_TIMEOUT_MS, "The fill reached its two-minute limit. Review the partial receipt.");
    this.launch(state, async epoch => {
      for (let index = 0; index < state.targets.length; index++) {
        state.currentField = index;
        const snapshot = await this.observe(state, epoch);
        if (!snapshot) return;
        const controls = this.rebind(state, snapshot);
        const target = controls[index]!;
        const field = state.run.fields[index]!;
        if (target.value === field.proposed) {
          field.after = target.value;
          field.status = "skipped";
          continue;
        }
        if (!this.live(state, epoch)) return;
        // Count dispatch attempts: an OS error can mean a write occurred.
        state.run.metrics.nativeActions++;
        state.unverifiedWrite = index;
        await this.driver.act({ id: randomUUID(), kind: "fill", nativeAction: "fill", appId: state.run.appId,
          targetId: target.id, snapshotId: snapshot.snapshotId, label: `Fill ${field.label}`, value: field.proposed });
        if (!this.live(state, epoch)) return;
        state.targets[index]!.expected = field.proposed;
        const after = await this.observe(state, epoch);
        if (!after) return;
        this.rebind(state, after);
        field.status = "verified";
        state.unverifiedWrite = undefined;
      }
      state.currentField = undefined;
      const final = await this.observe(state, epoch);
      if (!final) return;
      this.rebind(state, final);
      state.run.verification = "native_readback";
      this.finish(state, "completed", "All requested field values match the final native readback. No submit action was issued.");
    });
    return this.get(id);
  }

  stop(id: string): BatchRun {
    const state = this.require(id);
    if (!terminal(state.run.status)) this.finish(state, "stopped", "Fill stopped. Earlier writes may remain; review the receipt.");
    return this.get(id);
  }
  stopAll() { if (this.currentState) this.stop(this.currentState.run.id); else this.driver.cancel(); }

  private async observe(state: State, epoch: number): Promise<NativeSnapshot | undefined> {
    state.run.metrics.observations++;
    const snapshot = await this.driver.observe(state.run.appId);
    if (!this.live(state, epoch)) return;
    const age = Date.now() - Date.parse(snapshot?.capturedAt);
    if (!snapshot || snapshot.app?.id !== state.run.appId || snapshot.app.pid !== state.run.app?.pid ||
        !literal(snapshot.windowToken, 256) || !snapshot.windowToken || !literal(snapshot.snapshotId, 256) || !snapshot.snapshotId ||
        !literal(snapshot.title, 16_000) || !Number.isFinite(age) || age < -1000 || age >= BATCH_OBSERVATION_TTL_MS ||
        (snapshot.documentToken !== undefined && !literal(snapshot.documentToken, 256)) ||
        !Array.isArray(snapshot.controls) || snapshot.controls.length > 2000)
      throw new BatchFault("The app, window identity, or native observation is unavailable or changed.");
    // Every preparation, rebind and final verification uses this acquisition gate.
    // An unchanged returned field list cannot establish a complete native form.
    if (snapshot.controlCoverage !== "complete")
      throw new BatchFault("Native form coverage is incomplete or unknown. Inspect the app before preparing a new review; earlier writes may remain.");
    const ids = new Set<string>();
    for (const control of snapshot.controls) {
      if (!control || !literal(control.id, 512) || !control.id || ids.has(control.id) || !literal(control.label, 4096) ||
          !literal(control.role, 256) || typeof control.enabled !== "boolean" || !Array.isArray(control.actions) ||
          control.actions.some(action => typeof action !== "string") ||
          (control.bounds !== undefined && !finiteBounds(control.bounds)))
        throw new BatchFault("The native controls could not be validated.");
      ids.add(control.id);
    }
    return snapshot;
  }

  private rebind(state: State, snapshot: NativeSnapshot): NativeControl[] {
    const identity = state.identity!;
    if (snapshot.app.pid !== identity.pid || snapshot.windowToken !== identity.windowToken || snapshot.documentToken !== identity.documentToken || snapshot.title !== identity.title || shape(snapshot) !== identity.shape)
      throw new BatchFault("The reviewed window or form changed. Remaining fields were not filled.");
    return state.targets.map((target, index) => {
      const matches = snapshot.controls.filter(control => control.source === "accessibility" && control.identity === target.identity && control.role === target.role && control.label === target.label &&
        JSON.stringify(control.bounds) === JSON.stringify(target.bounds));
      const control = matches[0];
      if (matches.length !== 1 || !control!.enabled || !control!.editable || !control!.actions.includes("fill") || !visibleBounds(control!.bounds) || isSensitive(control!))
        throw new BatchFault("A reviewed field changed or became unavailable. Remaining fields were not filled.", index);
      state.run.fields[index]!.after = control!.value;
      if (control!.value !== target.expected)
        throw new BatchFault("A field did not match its expected native value. Remaining fields were not filled.", index);
      return control!;
    });
  }

  private launch(state: State, work: (epoch: number) => Promise<void>) {
    state.busy = true;
    const epoch = state.epoch;
    state.work = (async () => {
      try { await work(epoch); }
      catch (error) {
        if (this.live(state, epoch)) {
          const index = error instanceof BatchFault ? error.field ?? state.currentField : state.currentField;
          if (index !== undefined) {
            state.run.fields[index]!.status = "failed";
            state.run.fields[index]!.error = error instanceof BatchFault ? error.message : "The native operation was not confirmed. It was not retried.";
          }
          this.finish(state, "failed", error instanceof BatchFault ? error.message : "The native operation failed or was not confirmed. It was not retried; review the receipt.");
        }
      } finally {
        state.busy = false;
        if (terminal(state.run.status) && this.currentState === state) this.currentState = undefined;
      }
    })();
  }
  private live(state: State, epoch: number) { return this.currentState === state && state.epoch === epoch && !terminal(state.run.status); }
  private deadline(state: State, ms: number, message: string) {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => this.finish(state, "expired", message), ms);
    state.timer.unref?.();
  }
  private finish(state: State, status: BatchStatus, message: string) {
    state.epoch++;
    state.run.status = status;
    delete state.run.approvalId;
    if (state.unverifiedWrite !== undefined && state.run.fields[state.unverifiedWrite]!.status === "pending") {
      state.run.fields[state.unverifiedWrite]!.status = "failed";
      state.run.fields[state.unverifiedWrite]!.error = "A write was dispatched but its final value was not verified. Inspect the app before retrying.";
    }
    if (status === "failed") state.run.error = message; else state.run.result = message;
    for (const field of state.run.fields) if (field.status === "pending") { field.status = "skipped"; field.error = "Not executed."; }
    if (state.timer) clearTimeout(state.timer);
    state.timer = undefined;
    try { this.driver.cancel(); } catch { /* Revocation already happened. */ }
    if (!state.busy && this.currentState === state) this.currentState = undefined;
  }
  private require(id: string): State { const state = this.runs.get(id); if (!state) throw new Error("Fill task not found."); return state; }
}
