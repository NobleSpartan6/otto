import { randomUUID } from "node:crypto";
import type { DesktopApp, NativeAction, NativeControl, NativeDriver, NativeSnapshot } from "../shared/types.js";
import { DeveloperError, DeveloperSession, DEVELOPER_TTL_MS, type CompactObservation, type InspectLimits } from "./developer.js";
import { isSensitive } from "./candidates.js";

export interface AgentActionInput {
  snapshotToken: string;
  ref?: string;
  operation: "press" | "fill" | "scrollUp" | "scrollDown" | "key";
  value?: string;
}
export interface AgentActionResult {
  outcome: "verified" | "dispatched";
  observation: CompactObservation;
}
/** Session-owned guard for trusted workflow code; never include this in tool output. */
export interface AgentFieldGuard {
  readonly values: readonly string[];
  readonly refs: readonly string[];
}
export interface AgentActionGuard { guard: AgentFieldGuard; values: readonly string[] }
export class AgentSessionError extends Error {
  constructor(public readonly code: "invalid_input" | "busy" | "scope" | "stale_snapshot" | "cancelled" | "native_unavailable" | "action_unverified", message: string) {
    super(message); this.name = "AgentSessionError";
  }
}
interface Frame {
  token: string;
  snapshot: NativeSnapshot;
  bindings: Map<string, NativeControl>;
  limits: InspectLimits;
}
type WindowIdentity = Pick<NativeSnapshot, "app" | "title" | "windowToken" | "documentToken">;
interface PinnedFields { window: WindowIdentity; shape: string; controls: NativeControl[] }
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const literal = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && !value.includes("\0");
const scopeId = (value: unknown): value is string => literal(value, 256) && Boolean(value.trim()) && !/[\x00-\x1f\x7f]/.test(value);
const operations = new Set(["press", "fill", "scrollUp", "scrollDown", "key"]);
const nativeField = (control: NativeControl) => control.source === "accessibility" && (control.editable || control.actions.includes("fill"));
const labelKey = (label: string) => label.trim().normalize("NFC");
const identity = (control: NativeControl) => JSON.stringify({ identity: control.identity, role: control.role, label: control.label,
  bounds: control.bounds, enabled: control.enabled, editable: control.editable, sensitive: control.sensitive, source: control.source,
  actions: [...control.actions].sort() });
const frameShape = (snapshot: NativeSnapshot) => JSON.stringify({ text: snapshot.text,
  controls: snapshot.controls.map(control => JSON.stringify([identity(control), control.value])).sort() });
const fieldShape = (snapshot: NativeSnapshot) => JSON.stringify(snapshot.controls.filter(nativeField).map(identity).sort());

/** No model calls. The caller must enforce explicit launcher write authorization. */
export class AgentSession {
  private readonly allowed: string[];
  private readonly context = new DeveloperSession();
  private frame?: Frame;
  private busy = false;
  private configured = false;
  private generation = 0;
  private dispatchedActions = 0;
  private readonly apps = new Map<string, DesktopApp>();
  private readonly fieldGuards = new WeakMap<AgentFieldGuard, PinnedFields>();

  constructor(private readonly driver: NativeDriver, appIds: readonly string[]) {
    if (!Array.isArray(appIds) || !appIds.length || appIds.length > 4 || appIds.some(id => !scopeId(id)) || new Set(appIds).size !== appIds.length)
      throw new AgentSessionError("scope", "Select one to four distinct native app IDs when starting the session.");
    this.allowed = [...appIds];
  }
  get dispatchCount(): number { return this.dispatchedActions; }

  invalidate(): void { this.generation++; this.frame = undefined; this.context.invalidate(); }
  cancel(): void { this.invalidate(); this.configured = false; this.driver.cancel(); }

  pinFields(refs: string[]): AgentFieldGuard {
    const frame = this.latest();
    if (!Array.isArray(refs) || !refs.length || refs.length > 16 || refs.some(ref => !literal(ref, 256) || !ref) || new Set(refs).size !== refs.length)
      throw new AgentSessionError("invalid_input", "Pin one to sixteen distinct current native field references.");
    this.requireCompleteFormCoverage(frame.snapshot);
    this.sameWindow(frame.snapshot, frame.snapshot);
    // A complete form identity cannot be established from anonymous native fields.
    if (frame.snapshot.controls.filter(nativeField).some(control => !literal(control.identity, 256) || !control.identity))
      throw new AgentSessionError("stale_snapshot", "The native form identity cannot be verified.");
    const controls = refs.map(ref => {
      const control = frame.bindings.get(ref);
      this.readableField(control);
      return structuredClone(this.rebind(control!, frame.snapshot));
    });
    if (new Set(controls.map(control => control.identity)).size !== controls.length)
      throw new AgentSessionError("invalid_input", "The field references must identify distinct native controls.");
    const guard: AgentFieldGuard = Object.freeze({ values: Object.freeze(controls.map(control => control.value!)), refs: Object.freeze([...refs]) });
    this.fieldGuards.set(guard, { window: { app: { ...frame.snapshot.app }, title: frame.snapshot.title,
      windowToken: frame.snapshot.windowToken, documentToken: frame.snapshot.documentToken }, shape: fieldShape(frame.snapshot), controls });
    return guard;
  }

  validateFields(guard: AgentFieldGuard, expected: readonly string[]): void {
    this.validateFieldsAgainst(this.latest().snapshot, guard, expected);
  }

  private validateFieldsAgainst(snapshot: NativeSnapshot, guard: AgentFieldGuard, expected: readonly string[]): void {
    const pinned = this.fieldGuards.get(guard);
    if (!pinned || !Array.isArray(expected) || expected.length !== pinned.controls.length || expected.some(value => !literal(value, 2000)))
      throw new AgentSessionError("invalid_input", "Use this session's native field guard and complete bounded expected values.");
    this.requireCompleteFormCoverage(snapshot);
    this.sameWindow(pinned.window, snapshot);
    if (fieldShape(snapshot) !== pinned.shape)
      throw new AgentSessionError("stale_snapshot", "The pinned native form changed. Remaining fields must not be filled.");
    for (const [index, target] of pinned.controls.entries()) {
      const control = this.rebind(target, snapshot);
      this.readableField(control);
      if (control.value !== expected[index]) throw new AgentSessionError("stale_snapshot", "A pinned field does not match its expected full native value.");
    }
  }

  matchesValues(values: Record<string, string>): Array<{ label: string; matched: boolean }> {
    const frame = this.latest();
    if (!plain(values)) throw new AgentSessionError("invalid_input", "Supply exact native field labels and bounded literal values.");
    const entries = Object.entries(values);
    if (!entries.length || entries.length > 16 || entries.some(([label, value]) => !literal(label, 256) || !label.trim() || !literal(value, 2000)) ||
        new Set(entries.map(([label]) => labelKey(label))).size !== entries.length)
      throw new AgentSessionError("invalid_input", "Supply one to sixteen unique native field labels and values of at most 2,000 characters.");
    return entries.map(([label, expected]) => {
      if (frame.snapshot.controlCoverage !== "complete") return { label, matched: false };
      const matches = frame.snapshot.controls.filter(control => nativeField(control) && labelKey(control.label) === labelKey(label));
      if (matches.length !== 1) return { label, matched: false };
      const control = matches[0]!;
      try { this.readableField(control); } catch { return { label, matched: false }; }
      return { label, matched: control.value === expected };
    });
  }

  async inspect(appId: string, limits: InspectLimits = {}): Promise<CompactObservation> {
    this.reserve(); this.invalidate(); const generation = this.generation;
    try {
      if (!scopeId(appId) || !this.allowed.includes(appId)) throw new AgentSessionError("scope", "The app is outside this session's launcher scope.");
      const discovery = await this.native(() => this.driver.apps()); this.current(generation);
      const app = discovery.apps.find(candidate => candidate.id === appId);
      if (!discovery.permissions.accessibility || !app || !Number.isSafeInteger(app.pid) || app.pid < 1)
        throw new AgentSessionError("native_unavailable", "The selected app or Accessibility access is unavailable.");
      const previous = this.apps.get(appId);
      if (previous && previous.pid !== app.pid) throw new AgentSessionError("scope", "The selected process changed. Start a new scoped session.");
      this.apps.set(appId, { ...app });
      // Reconfiguring a live helper resets its stable window/control identities.
      if (!this.configured) {
        await this.native(() => this.driver.configure(this.allowed)); this.current(generation);
        this.configured = true;
      }
      const snapshot = await this.native(() => this.driver.observe(appId)); this.current(generation);
      return this.accept(snapshot, app, limits);
    } catch (error) { this.invalidate(); throw this.failure(error, false); }
    finally { this.busy = false; }
  }

  async act(input: AgentActionInput, options?: AgentActionGuard): Promise<AgentActionResult> {
    this.reserve(); let dispatched = false;
    try {
      if (!plain(input) || Object.keys(input).some(key => !["snapshotToken", "ref", "operation", "value"].includes(key)) ||
          !literal(input.snapshotToken, 256) || !input.snapshotToken || !operations.has(input.operation))
        throw new AgentSessionError("invalid_input", "Supply a current snapshot token and a supported native operation.");
      input = { ...input };
      const frame = this.frame;
      if (!frame || input.snapshotToken !== frame.token || Date.now() - Date.parse(frame.snapshot.capturedAt) >= DEVELOPER_TTL_MS)
        throw new AgentSessionError("stale_snapshot", "The observation expired or was consumed. Inspect again.");
      let guarded: AgentActionGuard | undefined;
      if (options !== undefined) {
        if (!plain(options) || Object.keys(options).some(key => !["guard", "values"].includes(key)) || !Array.isArray(options.values))
          throw new AgentSessionError("invalid_input", "Use a native workflow guard and expected field values.");
        guarded = { guard: options.guard, values: [...options.values] };
        this.validateFieldsAgainst(frame.snapshot, guarded.guard, guarded.values);
      }
      const key = input.operation === "key";
      let target: NativeControl | undefined;
      if (key) {
        if (input.ref !== undefined || !["enter", "escape", "tab"].includes(input.value ?? ""))
          throw new AgentSessionError("invalid_input", "Keys must be enter, escape, or tab, without a control reference.");
      } else {
        if (!literal(input.ref, 256) || !input.ref || !(target = frame.bindings.get(input.ref)))
          throw new AgentSessionError("invalid_input", "The control reference is not in the current observation.");
        if (target.source !== "accessibility" || isSensitive(target) || !target.enabled || !literal(target.identity, 256) || !target.identity ||
            !target.actions.includes(input.operation))
          throw new AgentSessionError("invalid_input", "The target is not an enabled, supported native control.");
        if (input.operation === "fill") {
          if (!literal(input.value, 2000) || !target.editable || !literal(target.value, 2000))
            throw new AgentSessionError("invalid_input", "A fill requires a complete native current value and at most 2,000 literal characters.");
          const preparation = this.context.prepareFill({ snapshotToken: input.snapshotToken, fields: [{ ref: input.ref, value: input.value }] });
          if (preparation.unresolved.length) throw new AgentSessionError("invalid_input", "The fill value or target is protected or unsupported.");
        } else if (input.value !== undefined) throw new AgentSessionError("invalid_input", "Only fills and bounded keys accept a value.");
      }
      // Revocation precedes every await and every effect: duplicates cannot replay.
      this.invalidate(); const generation = this.generation;
      const fresh = await this.native(() => this.driver.observe(frame.snapshot.app.id)); this.current(generation);
      this.validateSnapshot(fresh, frame.snapshot.app);
      this.sameWindow(frame.snapshot, fresh);
      if (guarded) this.validateFieldsAgainst(fresh, guarded.guard, guarded.values);
      let rebound: NativeControl | undefined;
      if (key) {
        if (frameShape(frame.snapshot) !== frameShape(fresh)) throw new AgentSessionError("stale_snapshot", "The keyboard frame changed. Inspect again.");
      } else {
        rebound = this.rebind(target!, fresh);
        if (rebound.value !== target!.value) throw new AgentSessionError("stale_snapshot", "The selected control's value changed. Inspect again.");
      }
      const action: NativeAction = { id: randomUUID(), appId: fresh.app.id, snapshotId: fresh.snapshotId,
        kind: key ? "key" : input.operation.startsWith("scroll") ? "scroll" : input.operation as "press" | "fill",
        label: key ? `Press ${input.value}` : `${input.operation} native control`,
        ...(key ? { value: input.value } : { targetId: rebound!.id, nativeAction: input.operation,
          ...(input.operation === "fill" ? { value: input.value } : {}) }) };
      this.current(generation); dispatched = true; this.dispatchedActions++;
      await this.native(() => this.driver.act(action)); this.current(generation);
      const after = await this.native(() => this.driver.observe(fresh.app.id)); this.current(generation);
      this.validateSnapshot(after, fresh.app);
      if (input.operation === "fill") {
        this.sameWindow(fresh, after);
        if (this.rebind(rebound!, after).value !== input.value)
          throw new AgentSessionError("action_unverified", "The fill was dispatched but its exact value was not verified. Inspect before retrying.");
      }
      return { outcome: input.operation === "fill" ? "verified" : "dispatched", observation: this.accept(after, fresh.app, frame.limits) };
    } catch (error) { this.invalidate(); throw this.failure(error, dispatched); }
    finally { this.busy = false; }
  }

  private reserve() { if (this.busy) throw new AgentSessionError("busy", "A native operation is still active. Wait for it or cancel it."); this.busy = true; }
  private async native<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) { this.configured = false; throw error; }
  }
  private current(generation: number) { if (this.generation !== generation) throw new AgentSessionError("cancelled", "The native operation was cancelled. A dispatched action may already have taken effect."); }
  private validateSnapshot(snapshot: NativeSnapshot, app: DesktopApp) {
    if (!snapshot || snapshot.app?.id !== app.id || snapshot.app.pid !== app.pid)
      throw new AgentSessionError("scope", "The observation does not belong to the selected process.");
    // Reuse all compact-observation structure, sensitive-field, and freshness validation.
    new DeveloperSession().inspect(snapshot, { maxControls: 1, maxTextChars: 0 });
  }
  private sameWindow(before: WindowIdentity, after: WindowIdentity) {
    if (before.app.id !== after.app.id || before.app.pid !== after.app.pid ||
        !literal(before.windowToken, 256) || !before.windowToken || before.windowToken !== after.windowToken ||
        before.title !== after.title || before.documentToken !== after.documentToken)
      throw new AgentSessionError("stale_snapshot", "The selected native window or document changed. Inspect again.");
  }
  private latest(): Frame {
    if (!this.frame || Date.now() - Date.parse(this.frame.snapshot.capturedAt) >= DEVELOPER_TTL_MS)
      throw new AgentSessionError("stale_snapshot", "The native observation expired or was consumed. Inspect again.");
    return this.frame;
  }
  private requireCompleteFormCoverage(snapshot: NativeSnapshot): void {
    // Equal returned fields do not prove an unchanged form after partial acquisition.
    // This uses native coverage, not compact-output truncation; explicit refs remain usable.
    if (snapshot.controlCoverage !== "complete")
      throw new AgentSessionError("stale_snapshot", "Native form coverage is incomplete or unknown. Inspect again before filling remaining fields.");
  }
  private readableField(control: NativeControl | undefined): void {
    if (!control || !nativeField(control) || !control.editable || !control.enabled || !control.actions.includes("fill") || isSensitive(control) ||
        !literal(control.identity, 256) || !control.identity || !literal(control.value, 2000))
      throw new AgentSessionError("stale_snapshot", "The native field is protected, unavailable, or its complete value cannot be verified.");
  }
  private rebind(target: NativeControl, snapshot: NativeSnapshot) {
    const matches = snapshot.controls.filter(control => control.identity === target.identity && control.source === "accessibility");
    if (matches.length !== 1 || identity(matches[0]!) !== identity(target) || isSensitive(matches[0]!))
      throw new AgentSessionError("stale_snapshot", "The selected native control changed. Inspect again.");
    return matches[0]!;
  }
  private accept(snapshot: NativeSnapshot, app: DesktopApp, limits: InspectLimits): CompactObservation {
    this.validateSnapshot(snapshot, app);
    const observation = this.context.inspect(snapshot, limits);
    const safe = snapshot.controls.filter(control => !isSensitive(control));
    this.frame = { token: observation.snapshotToken, snapshot: structuredClone(snapshot), limits: { ...limits },
      bindings: new Map(observation.controls.map((control, index) => [control.ref, structuredClone(safe[index]!)])) };
    return observation;
  }
  private failure(error: unknown, dispatched: boolean): Error {
    if (error instanceof AgentSessionError && error.code === "cancelled") return error;
    if (dispatched) return new AgentSessionError("action_unverified", "The native action was dispatched but its result was not verified. Inspect before retrying; it was not retried.");
    if (error instanceof AgentSessionError || error instanceof DeveloperError) return error;
    return new AgentSessionError("native_unavailable", "The native operation failed before dispatch. Inspect the selected app again.");
  }
}
