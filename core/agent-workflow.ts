import { createHash } from "node:crypto";
import type { CompactControl, CompactObservation } from "./developer.js";
import type { AgentActionInput, AgentFieldGuard, AgentSession } from "./agent-session.js";
import { decide, TypeSafeError, type DecisionInput, type Decision } from "./typesafe.js";
import type { JevRequestMetric } from "../shared/types.js";

export interface WorkflowStep {
  operation: AgentActionInput["operation"];
  label?: string;
  role?: string;
  value?: string;
}
export interface ExpectedState { values?: Record<string, string>; textIncludes?: string[] }
export interface WorkflowInput {
  appId: string;
  steps: WorkflowStep[];
  expected?: ExpectedState;
}
export interface DelegateInput {
  appId: string;
  goal: string;
  allowedActions: WorkflowStep[];
  expected: ExpectedState;
  maxSteps?: number;
}
export interface WorkflowReceipt {
  status: "verified" | "completed" | "stopped";
  actions: number;
  completedSteps: number;
  checks: Array<{ kind: "value" | "text"; label: string; matched: boolean }>;
  modelCalls: number;
  elapsedMs: number;
  reason?: string;
  /** A dispatch may have taken effect before an error. Never replay automatically. */
  uncertainAction?: boolean;
  usage?: { inputTokens: number | null; outputTokens: number | null; unknownUsageRequests: number; requestLatencyMs: number };
  validationCode?: string;
}
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const literal = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && !value.includes("\0");
const normalize = (value: string) => value.trim().normalize("NFC");
const KEYS = new Set(["enter", "escape", "tab"]);
const OPS = new Set(["press", "fill", "scrollUp", "scrollDown", "key"]);
export class WorkflowError extends Error {}

function validateSteps(value: unknown): asserts value is WorkflowStep[] {
  if (!Array.isArray(value) || !value.length || value.length > 16) throw new WorkflowError("Supply 1–16 explicit actions.");
  let chars = 0;
  for (const step of value) {
    if (!plain(step) || Object.keys(step).some(key => !["operation", "label", "role", "value"].includes(key)) || !OPS.has(String(step.operation)))
      throw new WorkflowError("Unsupported action. Use native press, fill, scrollUp, scrollDown, or key.");
    if (step.operation === "key") {
      if (!KEYS.has(String(step.value)) || step.label !== undefined || step.role !== undefined) throw new WorkflowError("Keys must be enter, escape, or tab without a target.");
    } else if (!literal(step.label, 256) || !step.label.trim() || (step.role !== undefined && (!literal(step.role, 96) || !step.role)))
      throw new WorkflowError("Each targeted action needs a complete exact label and optional role.");
    if (step.operation === "fill") {
      if (!literal(step.value, 2000)) throw new WorkflowError("Fill values must be literal strings of at most 2,000 characters.");
      if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i.test(step.value)) throw new WorkflowError("Credential-like values are not supported in agent workflows.");
      chars += step.value.length;
    } else if (step.operation !== "key" && step.value !== undefined) throw new WorkflowError("Only fill and key actions accept a value.");
  }
  if (chars > 16_000) throw new WorkflowError("Action values exceed the 16,000-character budget.");
}
function validateExpected(value: unknown, required: boolean): asserts value is ExpectedState | undefined {
  if (value === undefined && !required) return;
  if (!plain(value) || Object.keys(value).some(key => !["values", "textIncludes"].includes(key))) throw new WorkflowError("Supply exact expected field values or textIncludes checks.");
  let count = 0;
  if (value.values !== undefined) {
    if (!plain(value.values) || Object.entries(value.values).some(([key, item]) => !literal(key, 256) || !key.trim() || !literal(item, 2000))) throw new WorkflowError("Invalid expected field values.");
    count += Object.keys(value.values).length;
  }
  if (value.textIncludes !== undefined) {
    if (!Array.isArray(value.textIncludes) || value.textIncludes.some(item => !literal(item, 1000) || !item.trim())) throw new WorkflowError("Invalid expected text.");
    count += value.textIncludes.length;
  }
  if (!count || count > 16) throw new WorkflowError("Supply 1–16 completion checks.");
}
export function validateWorkflow(value: unknown, delegated = false): asserts value is WorkflowInput | DelegateInput {
  if (!plain(value) || Object.keys(value).some(key => !(delegated ? ["appId", "goal", "allowedActions", "expected", "maxSteps"] : ["appId", "steps", "expected"]).includes(key)) ||
      !literal(value.appId, 256) || !value.appId.trim()) throw new WorkflowError("Invalid task input or app scope.");
  validateSteps(delegated ? value.allowedActions : value.steps);
  validateExpected(value.expected, delegated);
  if (delegated && (!literal(value.goal, 2000) || !value.goal.trim() || (value.maxSteps !== undefined && (!Number.isInteger(value.maxSteps) || Number(value.maxSteps) < 1 || Number(value.maxSteps) > 16))))
    throw new WorkflowError("Supply a goal and a step budget between 1 and 16.");
}
function unique(observation: CompactObservation, label: string, role?: string): CompactControl {
  // An omitted or truncated control could be a second match. Abstain instead of
  // silently interpreting a shortened observation as the complete application.
  if (observation.truncation.controlsOmitted || observation.truncation.details.some(row => row.fields.includes("label") || row.fields.includes("role")))
    throw new WorkflowError("The control list is incomplete. Use inspect and explicit refs instead of a label workflow.");
  const matches = observation.controls.filter(control => control.source === "accessibility" && normalize(control.label) === normalize(label) && (!role || control.role === role));
  if (matches.length !== 1) throw new WorkflowError("An action or completion label is missing or ambiguous. Inspect and revise the task.");
  return matches[0]!;
}
function action(observation: CompactObservation, step: WorkflowStep): AgentActionInput {
  if (step.operation === "key") return { snapshotToken: observation.snapshotToken, operation: "key", value: step.value };
  const control = unique(observation, step.label!, step.role);
  if (control.source !== "accessibility" || !control.enabled || !control.actions.includes(step.operation) || (step.operation === "fill" && !control.editable))
    throw new WorkflowError("The requested native action is unavailable on its target.");
  return { snapshotToken: observation.snapshotToken, ref: control.ref, operation: step.operation, ...(step.value === undefined ? {} : { value: step.value }) };
}
function check(session: AgentSession, observation: CompactObservation, expected?: ExpectedState): WorkflowReceipt["checks"] {
  const checks: WorkflowReceipt["checks"] = [];
  // Full native values stay inside the worker. Compact result truncation is not
  // allowed to turn a prefix into evidence of equality (or reject a valid fill).
  if (expected?.values && Object.keys(expected.values).length)
    for (const item of session.matchesValues(expected.values)) checks.push({ kind: "value", ...item });
  for (const value of expected?.textIncludes ?? []) checks.push({ kind: "text", label: value, matched: observation.text.includes(value) && !observation.redacted });
  return checks;
}
function signature(observation: CompactObservation) {
  return createHash("sha256").update(JSON.stringify({ title: observation.title, text: observation.text, controls: observation.controls.map(({ ref: _ref, ...control }) => control) })).digest("hex");
}
const allMatch = (checks: WorkflowReceipt["checks"]) => checks.length > 0 && checks.every(item => item.matched);
function active(signal?: AbortSignal) { if (signal?.aborted) throw new WorkflowError("Task cancelled. Earlier actions may remain; inspect before retrying."); }
function errorReason(error: unknown): string {
  if (error instanceof WorkflowError || error instanceof TypeSafeError || (error instanceof Error && error.name === "AgentSessionError")) return error.message;
  return "The native action could not be verified. Earlier actions may remain; inspect before retrying.";
}

/** Local bounded execution. The host supplies authority and exact literals; no model is invoked. */
export async function runSteps(session: AgentSession, input: WorkflowInput, signal?: AbortSignal): Promise<WorkflowReceipt> {
  validateWorkflow(input);
  const started = performance.now();
  const beforeDispatch = session.dispatchCount;
  const receipt: WorkflowReceipt = { status: "stopped", actions: 0, completedSteps: 0, checks: [], modelCalls: 0, elapsedMs: 0 };
  let inFlight = false;
  let lastDispatchCount = beforeDispatch;
  try {
    active(signal);
    let observation = await session.inspect(input.appId, { maxControls: 128, maxTextChars: 16000 });
    active(signal);
    // For a form, resolve every target before the first mutation and preserve
    // untouched/previously written values throughout. This catches interference.
    const form = input.steps.every(step => step.operation === "fill");
    const refs: string[] = [];
    let guard: AgentFieldGuard | undefined;
    let guardedValues: string[] = [];
    if (form) for (const step of input.steps) {
      action(observation, step);
      const control = unique(observation, step.label!, step.role);
      if (refs.includes(control.ref)) throw new WorkflowError("Form steps must address distinct fields.");
      refs.push(control.ref);
    }
    if (form) { guard = session.pinFields(refs); guardedValues = [...guard.values]; }
    for (const [index, step] of input.steps.entries()) {
      active(signal);
      if (guard) session.validateFields(guard, guardedValues);
      const request = action(observation, step);
      if (step.operation === "fill" && session.matchesValues({ [step.label!]: step.value! }).every(item => item.matched)) {
        receipt.completedSteps++;
        continue;
      }
      inFlight = true;
      lastDispatchCount = session.dispatchCount;
      const result = await session.act(request, guard ? { guard, values: guardedValues } : undefined);
      observation = result.observation;
      inFlight = false;
      receipt.completedSteps++;
      if (guard) { guardedValues[index] = step.value!; session.validateFields(guard, guardedValues); }
    }
    active(signal);
    // Reobserve independently after the final mutation; dispatch is never proof.
    observation = await session.inspect(input.appId, { maxControls: 128, maxTextChars: 16000 });
    active(signal);
    if (guard) session.validateFields(guard, guardedValues);
    receipt.checks = check(session, observation, input.expected);
    receipt.status = input.expected ? (allMatch(receipt.checks) ? "verified" : "stopped") : "completed";
    if (receipt.status === "stopped") receipt.reason = "Actions finished, but the requested final checks did not all match.";
  } catch (error) {
    receipt.reason = errorReason(error);
    if (inFlight && session.dispatchCount > lastDispatchCount) receipt.uncertainAction = true;
    session.invalidate();
  } finally { receipt.actions = session.dispatchCount - beforeDispatch; receipt.elapsedMs = Math.round(performance.now() - started); }
  return receipt;
}

/** Jev may select only the caller's explicit actions. Missing coverage returns to the host. */
export async function delegateTask(session: AgentSession, input: DelegateInput, apiKey: string, signal?: AbortSignal,
  decider: (input: DecisionInput) => Promise<Decision> = decide): Promise<WorkflowReceipt> {
  validateWorkflow(input, true);
  if (!apiKey.trim()) throw new WorkflowError("Jev delegation needs TYPESAFE_API_KEY in the server environment. Exact actions and run_steps need no provider key.");
  if (JSON.stringify(input).includes(apiKey)) throw new WorkflowError("Remove credentials from task arguments.");
  const started = performance.now();
  const beforeDispatch = session.dispatchCount;
  const records = new Map<string, JevRequestMetric>();
  const receipt: WorkflowReceipt = { status: "stopped", actions: 0, completedSteps: 0, checks: [], modelCalls: 0, elapsedMs: 0 };
  let inFlight = false;
  let lastDispatchCount = beforeDispatch;
  try {
    active(signal);
    let observation = await session.inspect(input.appId, { maxControls: 128, maxTextChars: 16000 });
    const history: Array<{ operation: string; target?: string }> = [];
    const consumed = new Set<string>();
    for (let index = 0; index <= (input.maxSteps ?? 8); index++) {
      active(signal);
      receipt.checks = check(session, observation, input.expected);
      if (allMatch(receipt.checks)) { receipt.status = "verified"; break; }
      if (index === (input.maxSteps ?? 8)) { receipt.reason = "Step budget reached. Final checks did not all match."; break; }
      const available: Array<{ id: string; step: WorkflowStep; request: AgentActionInput }> = [];
      for (const [stepIndex, step] of input.allowedActions.entries()) {
        const id = `a${stepIndex + 1}`;
        if (consumed.has(id)) continue;
        try {
          const request = action(observation, step);
          if (step.operation === "fill" && session.matchesValues({ [step.label!]: step.value! }).every(item => item.matched)) continue;
          available.push({ id, step, request });
        } catch { /* Only currently available authorized actions are candidates. */ }
      }
      if (!available.length) { receipt.reason = "No permitted action is available. Return to the host agent for a revised plan."; break; }
      receipt.modelCalls++;
      const result = await decider({ goal: input.goal, apiKey, signal, observation: { title: observation.title, text: observation.text, controls: observation.controls }, history,
        candidates: [...available.map(({ id, step }) => ({ id, label: JSON.stringify(step) })), { id: "stop", label: "Stop and return to the host agent: no safe permitted action advances the goal" }],
        onRequest: record => records.set(record.id, record) });
      active(signal);
      if (result.confidence < 0.7 || result.choice === "stop") { receipt.reason = "Jev abstained or lacked confidence. No further action was executed."; break; }
      const selected = available.find(item => item.id === result.choice);
      if (!selected) throw new WorkflowError("The decision did not match a permitted action.");
      const before = signature(observation);
      inFlight = true;
      lastDispatchCount = session.dispatchCount;
      consumed.add(selected.id);
      const acted = await session.act(selected.request);
      inFlight = false;
      receipt.completedSteps++;
      history.push({ operation: selected.step.operation, target: selected.step.label });
      observation = acted.observation;
      receipt.checks = check(session, observation, input.expected);
      if (allMatch(receipt.checks)) {
        observation = await session.inspect(input.appId, { maxControls: 128, maxTextChars: 16000 });
        active(signal);
        receipt.checks = check(session, observation, input.expected);
        if (allMatch(receipt.checks)) receipt.status = "verified";
        else receipt.reason = "Final evidence changed during verification.";
        break;
      }
      if (signature(observation) === before) { receipt.reason = "The action produced no observed progress. Return to the host instead of repeating it."; break; }
    }
  } catch (error) {
    receipt.reason = errorReason(error);
    if (inFlight && session.dispatchCount > lastDispatchCount) receipt.uncertainAction = true;
    if (error instanceof TypeSafeError && error.validation) receipt.validationCode = error.validation.code;
    session.invalidate();
  } finally {
    receipt.elapsedMs = Math.round(performance.now() - started);
    receipt.actions = session.dispatchCount - beforeDispatch;
    const rows = [...records.values()];
    const unknown = rows.filter(row => row.inputTokens === null || row.outputTokens === null).length + Math.max(0, receipt.modelCalls - rows.length);
    receipt.usage = { inputTokens: unknown ? null : rows.reduce((sum, row) => sum + row.inputTokens!, 0), outputTokens: unknown ? null : rows.reduce((sum, row) => sum + row.outputTokens!, 0),
      unknownUsageRequests: unknown, requestLatencyMs: rows.reduce((sum, row) => sum + (row.latencyMs ?? 0), 0) };
  }
  return receipt;
}
