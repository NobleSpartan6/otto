import { createHash, randomUUID } from "node:crypto";
import type {
  DesktopApp,
  NativeAction,
  NativeDriver,
  NativeSnapshot,
  OttoRun,
  RunStatus,
  StartInput,
} from "../shared/types.js";
import {
  buildCandidates,
  isSensitive,
  literalValues,
  type GeneratedFill,
} from "./candidates.js";
import {
  decide,
  TypeSafeError,
  type Decision,
  type DecisionInput,
} from "./typesafe.js";
import { plan, PlannerError, type Plan, type PlannerInput } from "./planner.js";
import { observationText } from "./observation.js";

export const MAX_STEPS = 20;
export const APPROVAL_TTL_MS = 30_000;
export const RUN_TIMEOUT_MS = 10 * 60_000;
export const MAX_PLANNER_CALLS = 5;
type Decider = (input: DecisionInput) => Promise<Decision>;
type Planner = (input: PlannerInput) => Promise<Plan>;
const TERMINAL = new Set<RunStatus>([
  "completed",
  "stopped",
  "failed",
  "limit_reached",
  "blocked",
]);

interface RunState {
  run: OttoRun;
  apiKey?: string;
  plannerKey?: string;
  plannerScreenshot: boolean;
  drafts: GeneratedFill[];
  work?: Promise<OttoRun>;
  controller: AbortController;
  epoch: number;
  busy: boolean;
  calls: number;
  apps: DesktopApp[];
  currentAppId: string;
  pending?: NativeAction;
  timer?: ReturnType<typeof setTimeout>;
  history: Array<{ action: string; observationChanged: boolean }>;
  observationHash?: string;
  lastAction?: { signature: string; beforeHash: string; label: string };
  noProgressAction?: string;
  noProgressCount: number;
}

function validateInput(
  input: StartInput,
  apiKey: string,
  plannerKey?: string,
): void {
  if (!input || input.consent !== true)
    throw new Error("Consent is required before observing your desktop.");
  if (
    typeof input.goal !== "string" ||
    !input.goal.trim() ||
    input.goal.length > 4000
  )
    throw new Error("Enter a goal between 1 and 4,000 characters.");
  if (
    !Array.isArray(input.appIds) ||
    input.appIds.length < 1 ||
    input.appIds.length > 4 ||
    input.appIds.some(
      (id) => typeof id !== "string" || !id.trim() || id.length > 512,
    ) ||
    new Set(input.appIds).size !== input.appIds.length
  )
    throw new Error("Choose one to four distinct applications.");
  if (
    typeof apiKey !== "string" ||
    !apiKey.trim() ||
    apiKey.length > 512 ||
    /[\r\n\0]/.test(apiKey)
  )
    throw new Error("Enter a valid TypeSafe API key.");
  if (input.goal.includes(apiKey))
    throw new Error("Remove credentials from the task description.");
  if (literalValues(input.goal).length > 8)
    throw new Error("Use at most eight quoted text values in one task.");
  if (
    input.mode !== undefined &&
    input.mode !== "jev" &&
    input.mode !== "hybrid"
  )
    throw new Error("Choose Jev or hybrid mode.");
  if (
    input.plannerScreenshot !== undefined &&
    typeof input.plannerScreenshot !== "boolean"
  )
    throw new Error("Invalid screenshot consent.");
  if (
    input.mode === "hybrid" &&
    (typeof plannerKey !== "string" ||
      !plannerKey.trim() ||
      plannerKey.length > 512 ||
      /[\r\n\0]/.test(plannerKey))
  )
    throw new Error("Hybrid mode requires an OpenAI Platform API key.");
  if (plannerKey && input.goal.includes(plannerKey))
    throw new Error("Remove credentials from the task description.");
}

function snapshotHash(snapshot: NativeSnapshot): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        appId: snapshot.app.id,
        pid: snapshot.app.pid,
        title: snapshot.title,
        text: snapshot.text,
        controls: snapshot.controls.map(
          ({
            role,
            label,
            value,
            enabled,
            actions,
            editable,
            sensitive,
            bounds,
          }) => ({
            role,
            label,
            value,
            enabled,
            actions,
            editable,
            sensitive,
            bounds,
          }),
        ),
      }),
    )
    .digest("hex");
}

function validateSnapshot(
  snapshot: NativeSnapshot,
  expected: DesktopApp,
): void {
  if (
    !snapshot ||
    snapshot.app?.id !== expected.id ||
    snapshot.app.pid !== expected.pid ||
    typeof snapshot.snapshotId !== "string" ||
    !snapshot.snapshotId ||
    typeof snapshot.title !== "string" ||
    typeof snapshot.text !== "string" ||
    !Array.isArray(snapshot.controls) ||
    snapshot.controls.length > 2000
  )
    throw new Error("Invalid desktop observation.");
  const age = Date.now() - Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(age) || age < -1000 || age >= APPROVAL_TTL_MS)
    throw new Error("Desktop observation is out of date.");
  const ids = new Set<string>();
  for (const control of snapshot.controls) {
    if (
      !control ||
      typeof control.id !== "string" ||
      !control.id ||
      ids.has(control.id) ||
      typeof control.role !== "string" ||
      typeof control.label !== "string" ||
      typeof control.enabled !== "boolean" ||
      !Array.isArray(control.actions) ||
      control.actions.some((action) => typeof action !== "string")
    )
      throw new Error("Invalid desktop control.");
    ids.add(control.id);
  }
}

/** Native effects are always explicitly approved. Jev only proposes observed candidates. */
export class OttoEngine {
  private readonly runs = new Map<string, RunState>();
  private active?: RunState;

  constructor(
    private readonly driver: NativeDriver,
    private readonly decideFn: Decider = decide,
    private readonly plannerFn: Planner = plan,
  ) {}

  get isActive(): boolean {
    return this.active !== undefined;
  }

  get(id: string): OttoRun {
    return structuredClone(this.requireRun(id).run);
  }

  async waitForIdle(id: string): Promise<OttoRun> {
    await this.requireRun(id).work;
    return this.get(id);
  }

  async start(
    input: StartInput,
    apiKey: string,
    plannerKey?: string,
  ): Promise<OttoRun> {
    validateInput(input, apiKey, plannerKey);
    if (this.active)
      throw new Error(
        "Stop the current task and wait for it to finish before starting another.",
      );
    const state: RunState = {
      run: {
        id: randomUUID(),
        goal: input.goal.trim(),
        appIds: [...input.appIds],
        status: "running",
        step: 0,
        maxSteps: MAX_STEPS,
        createdAt: new Date().toISOString(),
        events: [],
        mode: input.mode ?? "jev",
        plannerCalls: 0,
        decisionCalls: 0,
      },
      apiKey,
      controller: new AbortController(),
      epoch: 0,
      busy: false,
      calls: 0,
      apps: [],
      currentAppId: input.appIds[0]!,
      history: [],
      noProgressCount: 0,
      plannerKey: input.mode === "hybrid" ? plannerKey : undefined,
      plannerScreenshot: input.plannerScreenshot === true,
      drafts: [],
    };
    // Reserve synchronously: stopAll can cancel even while app discovery is pending.
    this.active = state;
    this.runs.set(state.run.id, state);
    state.timer = setTimeout(() => {
      if (!TERMINAL.has(state.run.status))
        this.finish(
          state,
          "limit_reached",
          "The task reached its ten-minute time limit.",
        );
    }, RUN_TIMEOUT_MS);
    state.timer.unref?.();
    this.event(
      state,
      "started",
      "Task started. Every desktop action requires your approval.",
    );
    state.work = this.operation(state, async (epoch) => {
      const discovery = await this.driver.apps();
      if (!this.current(state, epoch)) return;
      if (!discovery.permissions.accessibility)
        throw new Error("Accessibility permission is required.");
      state.apps = state.run.appIds.map((id) => {
        const app = discovery.apps.find((item) => item.id === id);
        if (!app || !Number.isInteger(app.pid) || app.pid <= 0)
          throw new Error("An application is no longer available.");
        return { ...app };
      });
      await this.driver.configure([...state.run.appIds]);
      if (!this.current(state, epoch)) return;
      await this.advance(state, epoch);
    });
    return structuredClone(state.run);
  }

  async approve(id: string, actionId: string): Promise<OttoRun> {
    const state = this.requireRun(id);
    if (
      state.busy ||
      state.run.status !== "awaiting_approval" ||
      !state.pending ||
      state.pending.id !== actionId
    ) {
      throw new Error("That approval is no longer available.");
    }
    // Consume before any await so duplicate clicks cannot dispatch twice.
    const action = state.pending;
    state.pending = undefined;
    delete state.run.pendingAction;
    state.run.status = "running";
    state.work = this.operation(state, async (epoch) => {
      const snapshot = state.run.snapshot;
      if (
        !snapshot ||
        Date.now() - Date.parse(snapshot.capturedAt) >= APPROVAL_TTL_MS
      ) {
        this.event(
          state,
          "expired",
          "The approval expired. Observing again before proposing a new action.",
        );
        await this.advance(state, epoch);
        return;
      }
      if (
        !state.run.appIds.includes(action.appId) ||
        action.snapshotId !== snapshot.snapshotId ||
        (action.kind !== "activate" && action.appId !== snapshot.app.id)
      )
        throw new Error("Invalid action target.");
      const target = action.targetId
        ? snapshot.controls.find((control) => control.id === action.targetId)
        : undefined;
      if (
        action.kind === "key" &&
        !["enter", "escape", "tab"].includes(action.value!)
      )
        throw new Error("Unsupported keyboard action.");
      if (
        action.kind !== "activate" &&
        action.kind !== "key" &&
        (!target ||
          !target.enabled ||
          isSensitive(target) ||
          !target.actions.includes(action.nativeAction!))
      ) {
        throw new Error("The target is no longer available.");
      }
      if (action.kind === "fill") {
        const drafted = state.drafts.some(
          (draft) =>
            draft.appId === action.appId &&
            draft.title === snapshot.title &&
            draft.role === target?.role &&
            draft.label === target.label &&
            draft.text === action.value &&
            snapshot.controls.filter(
              (control) =>
                control.role === draft.role && control.label === draft.label,
            ).length === 1,
        );
        if (
          !target?.editable ||
          (!literalValues(state.run.goal).includes(action.value!) && !drafted)
        )
          throw new Error("Invalid text value.");
      }
      if (!this.current(state, epoch)) return;
      const signature = JSON.stringify({
        kind: action.kind,
        appId: action.appId,
        nativeAction: action.nativeAction,
        value: action.value,
        role: target?.role,
        label: target?.label,
        bounds: target?.bounds,
      });
      // The helper revalidates live identity and state immediately before the OS call.
      await this.driver.act(structuredClone(action));
      if (!this.current(state, epoch)) return;
      state.run.step++;
      state.lastAction = {
        signature,
        beforeHash: state.observationHash!,
        label: action.label,
      };
      state.currentAppId = action.appId;
      this.event(state, "action", action.label);
      await this.advance(state, epoch);
    });
    return structuredClone(state.run);
  }

  confirm(id: string): OttoRun {
    const state = this.requireRun(id);
    if (state.busy || state.run.status !== "awaiting_confirmation")
      throw new Error("This task is not waiting for confirmation.");
    state.run.verification = "user_confirmed";
    this.finish(
      state,
      "completed",
      "You confirmed that the requested outcome is complete.",
    );
    return this.get(id);
  }

  stop(id: string): OttoRun {
    const state = this.requireRun(id);
    if (!TERMINAL.has(state.run.status))
      this.finish(
        state,
        "stopped",
        "Task stopped. No further actions will be dispatched.",
      );
    return this.get(id);
  }

  stopAll(): void {
    if (this.active && !TERMINAL.has(this.active.run.status))
      this.stop(this.active.run.id);
    else this.driver.cancel();
  }

  private async advance(
    state: RunState,
    epoch: number,
    plannerUsed = false,
  ): Promise<void> {
    if (!this.current(state, epoch)) return;
    const expected = state.apps.find((app) => app.id === state.currentAppId)!;
    const snapshot = await this.driver.observe(expected.id);
    if (!this.current(state, epoch)) return;
    validateSnapshot(snapshot, expected);
    // Protected controls never contribute values or candidates to model state.
    const safeControls = snapshot.controls.filter(
      (control) => !isSensitive(control),
    );
    state.run.snapshot = structuredClone({
      ...snapshot,
      text: observationText(snapshot, [
        state.apiKey ?? "",
        state.plannerKey ?? "",
      ]),
      controls: safeControls,
    });
    const hash = snapshotHash({ ...snapshot, controls: safeControls });
    if (state.lastAction) {
      const changed = hash !== state.lastAction.beforeHash;
      state.history.push({
        action: state.lastAction.label,
        observationChanged: changed,
      });
      if (!changed) {
        state.noProgressCount =
          state.noProgressAction === state.lastAction.signature
            ? state.noProgressCount + 1
            : 1;
        state.noProgressAction = state.lastAction.signature;
      } else {
        state.noProgressCount = 0;
        state.noProgressAction = undefined;
      }
      state.lastAction = undefined;
    }
    state.observationHash = hash;
    if (state.noProgressCount >= 3 && state.run.mode !== "hybrid") {
      this.finish(
        state,
        "blocked",
        "The same action left the desktop unchanged three times. Review the application before continuing.",
      );
      return;
    }
    if (state.calls >= MAX_STEPS || state.run.step >= MAX_STEPS) {
      this.finish(
        state,
        "limit_reached",
        "The task reached its 20-decision limit.",
      );
      return;
    }
    const candidates = buildCandidates(
      state.run.snapshot,
      state.apps,
      state.run.goal,
      state.drafts,
    );
    const needsText =
      /\b(write|compose|type|enter|fill|draft|search)\b/i.test(
        state.run.subgoal ?? state.run.goal,
      ) &&
      safeControls.some(
        (control) => control.editable && control.actions.includes("fill"),
      ) &&
      !candidates.some((candidate) => candidate.kind === "fill");
    if (
      state.run.mode === "hybrid" &&
      !plannerUsed &&
      (!state.run.subgoal || state.noProgressCount >= 3 || needsText)
    ) {
      const reason = !state.run.subgoal
        ? "initial_plan"
        : state.noProgressCount >= 3
          ? "stalled"
          : "text_needed";
      if (await this.replan(state, epoch, reason))
        await this.advance(state, epoch, true);
      return;
    }
    state.calls++;
    state.run.decisionCalls = state.calls;
    this.event(
      state,
      "observing",
      `Observed ${expected.name}. Selecting from available controls.`,
    );
    // Text from the selected application is untrusted evidence. Screenshots and
    // native handles stay out of Jev requests; protected values are redacted.
    const decision = await this.decideFn({
      goal: state.run.subgoal ?? state.run.goal,
      observation: {
        originalGoal: state.run.goal,
        app: { ...snapshot.app },
        title: snapshot.title,
        text: state.run.snapshot.text,
        controls: safeControls.map(
          ({ role, label, value, enabled, editable, actions, source }) => ({
            role,
            label,
            value,
            enabled,
            editable,
            actions,
            source,
          }),
        ),
      },
      candidates: candidates.map(({ id, label }) => ({ id, label })),
      history: structuredClone(state.history),
      apiKey: state.apiKey!,
      signal: state.controller.signal,
    });
    if (!this.current(state, epoch)) return;
    const action = candidates.find(
      (candidate) => candidate.id === decision.choice,
    );
    if (
      !action ||
      !Number.isFinite(decision.confidence) ||
      decision.confidence < 0 ||
      decision.confidence > 1 ||
      !Number.isFinite(decision.complete) ||
      decision.complete < 0 ||
      decision.complete > 1
    )
      throw new Error("Invalid model decision.");
    this.event(state, "decision", action.label, {
      ...decision,
      model: "jev-latest",
    });
    if (
      state.run.mode === "hybrid" &&
      !plannerUsed &&
      (decision.confidence < 0.55 ||
        action.kind === "finish" ||
        action.kind === "blocked")
    ) {
      const reason =
        decision.confidence < 0.55
          ? "uncertain"
          : action.kind === "finish"
            ? "subgoal_complete"
            : "blocked";
      if (await this.replan(state, epoch, reason))
        await this.advance(state, epoch, true);
      return;
    }
    if (action.kind === "finish") {
      state.run.status = "awaiting_confirmation";
      this.event(
        state,
        "confirmation",
        "Review the application and confirm whether your goal is complete.",
      );
    } else if (action.kind === "blocked") {
      this.finish(
        state,
        "blocked",
        "No available action was selected. Review the application or refine the goal.",
      );
    } else {
      state.pending = action;
      state.run.pendingAction = {
        id: action.id,
        label: action.label,
        reason:
          "Review the target and its effect. This approval allows only this action.",
      };
      state.run.status = "awaiting_approval";
    }
  }

  private async replan(
    state: RunState,
    epoch: number,
    reason: string,
  ): Promise<boolean> {
    if (!this.current(state, epoch)) return false;
    if ((state.run.plannerCalls ?? 0) >= MAX_PLANNER_CALLS) {
      this.finish(
        state,
        "limit_reached",
        "The task reached its five-planner-call limit.",
      );
      return false;
    }
    const observation = state.run.snapshot!;
    const candidates = buildCandidates(
      observation,
      state.apps,
      state.run.goal,
      state.drafts,
      true,
    );
    state.run.plannerCalls = (state.run.plannerCalls ?? 0) + 1;
    const proposal = await this.plannerFn({
      goal: state.run.goal,
      observation: structuredClone(observation),
      candidates,
      apps: structuredClone(state.apps),
      history: structuredClone(state.history),
      apiKey: state.plannerKey!,
      signal: state.controller.signal,
      allowScreenshot: state.plannerScreenshot,
      reason,
    });
    if (!this.current(state, epoch)) return false;
    const selected =
      proposal.actionId === null
        ? undefined
        : candidates.find((candidate) => candidate.id === proposal.actionId);
    if (
      typeof proposal.subgoal !== "string" ||
      !proposal.subgoal.trim() ||
      proposal.subgoal.length > 1000 ||
      typeof proposal.summary !== "string" ||
      proposal.summary.length > 1500 ||
      typeof proposal.done !== "boolean" ||
      (proposal.actionId !== null && !selected) ||
      (proposal.text !== null &&
        (typeof proposal.text !== "string" ||
          proposal.text.length > 2000 ||
          selected?.kind !== "fill")) ||
      (proposal.needsHuman !== null &&
        (typeof proposal.needsHuman !== "string" ||
          !proposal.needsHuman.trim() ||
          proposal.needsHuman.length > 1000)) ||
      (!proposal.done && proposal.needsHuman === null && !selected) ||
      ((proposal.done || proposal.needsHuman !== null) &&
        (proposal.actionId !== null || proposal.text !== null)) ||
      (proposal.done && proposal.needsHuman !== null) ||
      !Number.isFinite(proposal.latencyMs) ||
      proposal.latencyMs < 0 ||
      typeof proposal.model !== "string" ||
      [
        proposal.subgoal,
        proposal.summary,
        proposal.text,
        proposal.needsHuman,
      ].some(
        (text) =>
          typeof text === "string" &&
          (text.includes(state.apiKey!) || text.includes(state.plannerKey!)),
      )
    )
      throw new Error("Invalid planner proposal.");
    if (proposal.text !== null) {
      const target = observation.controls.find(
        (control) => control.id === selected!.targetId,
      );
      if (
        !target?.editable ||
        isSensitive(target) ||
        !target.actions.includes("fill") ||
        observation.controls.filter(
          (control) =>
            control.role === target.role && control.label === target.label,
        ).length !== 1
      )
        throw new Error("Ambiguous planner text target.");
      state.drafts = state.drafts.filter(
        (draft) =>
          !(
            draft.appId === observation.app.id &&
            draft.title === observation.title &&
            draft.role === target.role &&
            draft.label === target.label
          ),
      );
      state.drafts.push({
        appId: observation.app.id,
        title: observation.title,
        role: target.role,
        label: target.label,
        text: proposal.text,
      });
    }
    state.run.subgoal = proposal.subgoal;
    state.noProgressCount = 0;
    state.noProgressAction = undefined;
    this.event(state, "planner", proposal.summary, {
      latencyMs: proposal.latencyMs,
      model: proposal.model,
    });
    if (proposal.needsHuman) {
      this.finish(state, "blocked", proposal.needsHuman);
      return false;
    }
    if (proposal.done) {
      state.run.status = "awaiting_confirmation";
      this.event(
        state,
        "confirmation",
        "Review the application and confirm whether your original goal is complete.",
      );
      return false;
    }
    return true;
  }

  private async operation(
    state: RunState,
    work: (epoch: number) => Promise<void>,
  ): Promise<OttoRun> {
    if (state.busy) throw new Error("A desktop operation is already running.");
    state.busy = true;
    const epoch = state.epoch;
    try {
      await work(epoch);
    } catch (error) {
      if (this.current(state, epoch)) {
        const safeProviderError =
          (error instanceof TypeSafeError || error instanceof PlannerError) &&
          ![state.apiKey, state.plannerKey].some(
            (key) => key && error.message.includes(key),
          );
        this.finish(
          state,
          "failed",
          safeProviderError
            ? error.message
            : "The desktop operation or model request failed. No action was retried.",
        );
      }
    } finally {
      state.busy = false;
      if (TERMINAL.has(state.run.status) && this.active === state)
        this.active = undefined;
    }
    return structuredClone(state.run);
  }

  private current(state: RunState, epoch: number): boolean {
    return (
      this.active === state &&
      state.epoch === epoch &&
      !state.controller.signal.aborted &&
      !TERMINAL.has(state.run.status)
    );
  }

  private finish(state: RunState, status: RunStatus, message: string): void {
    state.epoch++;
    state.controller.abort();
    state.apiKey = undefined;
    state.plannerKey = undefined;
    state.pending = undefined;
    delete state.run.pendingAction;
    if (state.timer) clearTimeout(state.timer);
    state.timer = undefined;
    state.run.status = status;
    if (status === "failed") state.run.error = message;
    else state.run.result = message;
    this.event(state, status, message);
    // Cleanup must not restore activity or block Stop if a helper is already gone.
    try {
      this.driver.cancel();
    } catch {
      /* The cancellation epoch is already revoked. */
    }
    // Hold the active slot until any already-issued helper operation settles.
    if (!state.busy && this.active === state) this.active = undefined;
  }

  private event(
    state: RunState,
    kind: string,
    message: string,
    metrics?: { confidence?: number; latencyMs?: number; model?: string },
  ): void {
    state.run.events.push({
      id: randomUUID(),
      kind,
      message,
      timestamp: new Date().toISOString(),
      ...metrics,
    });
  }

  private requireRun(id: string): RunState {
    const state = this.runs.get(id);
    if (!state) throw new Error("Task not found.");
    return state;
  }
}
