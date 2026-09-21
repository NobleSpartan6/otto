import { getEncoding } from "js-tiktoken";

export const PAIRED_VERSION = "otto-agent-bridge-paired-v1";
export type Arm = "baseline" | "workflow";
export const VALUES: Record<string, string> = {
  "Project name": "Otto Demo", "Repository URL": "https://code.example.invalid/otto-demo", "Local directory": "/tmp/otto-demo",
  "Package manager": "npm", "Test command": "npm test", Notes: "Local fixture only — no files changed.",
};
export const PLAN = ([ ["baseline", "workflow"], ["workflow", "baseline"], ["baseline", "workflow"] ] as const)
  .flatMap((arms, pair) => arms.map((arm, position) => ({ pair: pair + 1, position: position + 1, arm })));
export interface Exchange { request: string; result?: string; error?: string; elapsedMs?: number; dispatched: boolean; excludeResponseFromTextMeasurement?: boolean }
export interface PairedTrial {
  pair: number; position: number; arm: Arm; status: "not_run" | "running" | "passed" | "failed" | "blocked";
  calls: Exchange[]; maintenance: Exchange[]; errors: string[]; before?: unknown; after?: unknown;
  protocol?: string; taskElapsedMs?: number; taskWindowMs?: number; setupElapsedMs?: number; cleanup?: string;
  runtimeUnchanged?: boolean; outcomeFailures?: string[]; launch?: { pid: number };
}
const encoding = getEncoding("o200k_base");
export const measure = (value: string) => ({ bytes: Buffer.byteLength(value, "utf8"), tokens: encoding.encode(value, [], []).length });
export function exchangeText(calls: Exchange[]): string {
  return calls.filter(call => call.dispatched).map(call => call.request + (call.result === undefined || call.excludeResponseFromTextMeasurement ? "" : "\n" + call.result)).join("\n");
}
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
const elapsed = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function resultText(result: unknown): string {
  if (!record(result) || !Array.isArray(result.content) || !result.content.every(item => record(item) && item.type === "text" && typeof item.text === "string"))
    throw new Error("Expected a text-only MCP response; image payloads are outside this evaluation.");
  const text = result.content.map(item => (item as { text: string }).text).join("\n");
  if (text.includes("data:image/")) throw new Error("Image payloads cannot be measured as text.");
  if (result.isError === true) {
    let code: unknown; try { code = JSON.parse(text).code; } catch { /* No raw selected-app text in diagnostics. */ }
    throw new Error(code === "desktop_busy" || code === "desktop_unavailable" ? String(code) : "MCP tool returned an error.");
  }
  return text;
}
export function observation(result: unknown) {
  const lines = resultText(result).split("\n");
  const metadata = lines.filter(line => line.startsWith("{")).map(line => JSON.parse(line)).find(value => typeof value.snapshotToken === "string");
  const controls = lines.filter(line => line.startsWith("[")).map(line => JSON.parse(line) as unknown[]);
  if (!metadata || !controls.every(row => Array.isArray(row) && row.length === 8)) throw new Error("Malformed compact observation.");
  return { snapshotToken: metadata.snapshotToken as string, controls };
}

/** This blank fixture emits one ready event, then ordered attempt/change evidence. */
function validEvents(events: unknown): events is Array<Record<string, unknown>> {
  if (!Array.isArray(events) || !events.length || events.length > 2000) return false;
  let previousTime = 0;
  return events.every((event, index) => {
    if (!record(event) || event.sequence !== index + 1 || !elapsed(event.elapsedMs) || event.elapsedMs < previousTime) return false;
    previousTime = event.elapsedMs;
    if (index === 0) return event.kind === "ready";
    if (typeof event.field !== "string" || !Object.hasOwn(VALUES, event.field)) return false;
    if (event.kind === "ax-write-attempt") return typeof event.rejected === "boolean";
    return ["field-change", "text-edit", "observed-field-change"].includes(String(event.kind)) && typeof event.before === "string" && typeof event.after === "string";
  });
}
export function workflowReceiptFailures(value: unknown): string[] {
  if (!record(value)) return ["malformed_workflow_receipt"];
  const failures: string[] = [];
  if (value.status !== "verified" || value.actions !== 6 || value.completedSteps !== 6 || value.modelCalls !== 0 || !elapsed(value.elapsedMs)) failures.push("workflow_receipt_totals_or_status");
  if ((value.uncertainAction !== undefined && value.uncertainAction !== false) || ["reason", "validationCode", "error", "errors", "isError"].some(key => Object.hasOwn(value, key))) failures.push("contradictory_workflow_receipt");
  const checks = value.checks;
  if (!Array.isArray(checks) || checks.length !== 6 || !Object.keys(VALUES).every(label => checks.filter(check => record(check) && check.kind === "value" && check.label === label && check.matched === true).length === 1)) failures.push("workflow_receipt_checks");
  return failures;
}

/** Independent fixture truth; never accepts an executor receipt as outcome proof. */
export function gradeOutcome(before: unknown, after: unknown, pid: number, values: Record<string, string> = VALUES): string[] {
  const errors: string[] = [], fail = (condition: boolean, reason: string) => { if (!condition) errors.push(reason); };
  if (Object.keys(values).length !== 6 || !Object.keys(VALUES).every(label => typeof values[label] === "string" && values[label]!.length <= 2000)) return ["invalid_expected_values"];
  if (!record(before) || !record(after) || !record(before.fields) || !record(after.fields) || !validEvents(before.events) || !validEvents(after.events)) return ["missing_or_malformed_oracle"];
  fail(Number.isSafeInteger(pid) && pid > 1, "missing_launch_pid");
  fail(before.events.length === 1 && after.events[0]!.elapsedMs === before.events[0]!.elapsedMs, "initial_event_mismatch");
  fail(before.pid === pid && after.pid === pid && typeof before.launchId === "string" && !!before.launchId && after.launchId === before.launchId, "fixture_identity_mismatch");
  for (const state of [before, after]) {
    fail(state.schemaVersion === 1 && state.fixture === "otto-developer-onboarding-v1" && state.status === "ready", "oracle_schema_or_status_mismatch");
    fail(state.faultMode === "none" && state.faultTriggered === false && state.prefill === false, "fixture_configuration_mismatch");
    fail(["resetCount", "forbiddenSubmitCount", "rejectedWrites", "duplicateMutationCount"].every(key => state[key] === 0) && state.duplicateNotesValue === null, "forbidden_fixture_effect");
  }
  fail(before.axWriteAttempts === 0 && before.fieldMutationCount === 0 && after.axWriteAttempts === 6 && after.fieldMutationCount === 6, "attempt_or_mutation_count_mismatch");
  fail(Object.keys(before.fields).length === 6 && Object.keys(after.fields).length === 6, "field_set_mismatch");
  for (const [label, expected] of Object.entries(values)) {
    const original = before.fields[label], final = after.fields[label];
    fail(record(original) && original.value === "" && original.valueChangeCount === 0 && original.visible === true && original.editable === true && original.rejectAXWrites === false, `initial_field_mismatch:${label}`);
    fail(record(final) && final.value === expected && final.valueChangeCount === 1 && final.visible === true && final.editable === true && final.rejectAXWrites === false, `final_field_mismatch:${label}`);
  }
  const attempts = after.events.filter(event => record(event) && event.kind === "ax-write-attempt");
  fail(attempts.length === 6 && Object.keys(VALUES).every(label => attempts.filter(event => event.field === label && event.rejected === false).length === 1), "per_field_attempt_mismatch");
  const changes = after.events.filter(event => ["field-change", "text-edit", "observed-field-change"].includes(String(event.kind)));
  fail(changes.length === 6 && Object.entries(values).every(([label, value]) => changes.filter(event => event.field === label && event.before === "" && event.after === value).length === 1), "per_field_change_event_mismatch");
  return errors;
}

function trialFailures(row: PairedTrial): string[] {
  const failures: string[] = [];
  if (row.status !== "passed") failures.push("trial_not_passed");
  if (!Array.isArray(row.errors) || row.errors.length || !Array.isArray(row.outcomeFailures) || row.outcomeFailures.length) failures.push("recorded_failures_or_missing_grading");
  if (row.runtimeUnchanged !== true) failures.push("runtime_not_verified");
  if (!row.protocol) failures.push("schema_missing");
  if (!elapsed(row.taskElapsedMs) || !row.calls.every(call => elapsed(call.elapsedMs)) || Math.abs(row.calls.reduce((sum, call) => sum + (call.elapsedMs ?? 0), 0) - (row.taskElapsedMs ?? 0)) > 0.001) failures.push("timing_incomplete_or_inconsistent");
  failures.push(...gradeOutcome(row.before, row.after, row.launch?.pid ?? -1));
  if (row.calls.length !== (row.arm === "baseline" ? 7 : 1) || !row.calls.every(call => call.dispatched === true && typeof call.result === "string" && call.error === undefined && !call.excludeResponseFromTextMeasurement)) failures.push("task_response_coverage");
  try {
    for (const [index, call] of row.calls.entries()) {
      const request: unknown = JSON.parse(call.request), response: unknown = JSON.parse(call.result ?? "null");
      if (!record(request) || request.name !== (row.arm === "workflow" ? "run_steps" : index === 0 ? "inspect" : "act")) throw new Error("wrong task");
      if (row.arm === "workflow") failures.push(...workflowReceiptFailures(JSON.parse(resultText(response))));
      else { observation(response); if (index > 0 && JSON.parse(resultText(response).split("\n")[0]!).outcome !== "verified") throw new Error("unverified action"); }
    }
  } catch { failures.push("invalid_task_response"); }
  return failures;
}

export function summarizePaired(rows: PairedTrial[]) {
  const metrics = rows.map(row => {
    const payload = exchangeText(row.calls), schema = row.protocol;
    return { pair: row.pair, arm: row.arm, status: row.status, evidenceFailures: trialFailures(row), calls: row.calls.filter(call => call.dispatched).length,
      payload: measure(payload), maintenance: measure(exchangeText(row.maintenance)),
      includingSchema: schema === undefined ? null : measure(schema + "\n" + payload),
      responseCoverage: { received: row.calls.filter(call => call.dispatched && call.result !== undefined).length,
        excluded: row.calls.filter(call => call.excludeResponseFromTextMeasurement).length, attempted: row.calls.filter(call => call.dispatched).length },
      taskElapsedMs: elapsed(row.taskElapsedMs) ? row.taskElapsedMs : null, taskWindowMs: elapsed(row.taskWindowMs) ? row.taskWindowMs : null };
  });
  const pairs = [1, 2, 3].map(pair => {
    const baseline = metrics.find(row => row.pair === pair && row.arm === "baseline"), workflow = metrics.find(row => row.pair === pair && row.arm === "workflow");
    const source = rows.filter(row => row.pair === pair);
    const complete = rows.length === PLAN.length && !!baseline && !!workflow && source.length === 2 && baseline.evidenceFailures.length === 0 && workflow.evidenceFailures.length === 0 &&
      source[0]!.protocol === source[1]!.protocol && rows.every(row => row.protocol === undefined || row.protocol === source[0]!.protocol);
    return { pair, complete, baseline, workflow, delta: complete ? {
      taskCalls: workflow.calls - baseline.calls, payloadTokens: workflow.payload.tokens - baseline.payload.tokens,
      tokensIncludingSchema: workflow.includingSchema!.tokens - baseline.includingSchema!.tokens,
      taskElapsedMs: workflow.taskElapsedMs! - baseline.taskElapsedMs!,
      payloadReductionPercent: 100 * (1 - workflow.payload.tokens / baseline.payload.tokens),
      includingSchemaReductionPercent: 100 * (1 - workflow.includingSchema!.tokens / baseline.includingSchema!.tokens),
    } : null };
  });
  const armTotals = (["baseline", "workflow"] as const).map(arm => {
    const selected = metrics.filter(row => row.arm === arm), measured = selected.filter(row => row.responseCoverage.attempted > 0);
    return { arm, scheduled: 3, started: selected.filter(row => row.status !== "not_run").length, passed: selected.filter(row => row.evidenceFailures.length === 0).length, reportedPassed: selected.filter(row => row.status === "passed").length,
      failed: selected.filter(row => row.status === "failed").length, blocked: selected.filter(row => row.status === "blocked").length,
      unfinished: selected.filter(row => row.status === "running").length, notRun: selected.filter(row => row.status === "not_run").length,
      recordedPayloadTokensAllAttempts: selected.reduce((sum, row) => sum + row.payload.tokens, 0),
      recordedFailedPayloadTokens: selected.filter(row => row.status === "failed" || row.status === "blocked").reduce((sum, row) => sum + row.payload.tokens, 0),
      measuredTrials: measured.length, receivedResponses: selected.reduce((sum, row) => sum + row.responseCoverage.received, 0), attemptedCalls: selected.reduce((sum, row) => sum + row.calls, 0),
      excludedResponses: selected.reduce((sum, row) => sum + row.responseCoverage.excluded, 0),
      medianPayloadTokens: median(measured.map(row => row.payload.tokens)), medianTokensIncludingSchema: median(measured.flatMap(row => row.includingSchema ? [row.includingSchema.tokens] : [])),
      taskElapsedMsAllAttempts: selected.reduce((sum, row) => sum + (row.taskElapsedMs ?? 0), 0), medianTaskElapsedMs: median(measured.flatMap(row => row.taskElapsedMs === null ? [] : [row.taskElapsedMs])) };
  });
  const completePairs = pairs.filter(pair => pair.complete).length;
  return { scheduledTrials: 6, completePairs, pairs, arms: armTotals,
    medianPairedDelta: completePairs === 3 ? { payloadTokens: median(pairs.map(pair => pair.delta!.payloadTokens)),
      tokensIncludingSchema: median(pairs.map(pair => pair.delta!.tokensIncludingSchema)), taskElapsedMs: median(pairs.map(pair => pair.delta!.taskElapsedMs)),
      payloadReductionPercent: median(pairs.map(pair => pair.delta!.payloadReductionPercent)), includingSchemaReductionPercent: median(pairs.map(pair => pair.delta!.includingSchemaReductionPercent)) } : null,
    modelCalls: 0, actualHostInputTokens: null, providerTokenUsage: null, billedCost: null };
}
