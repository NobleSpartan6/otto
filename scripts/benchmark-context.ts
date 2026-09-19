import assert from "node:assert/strict";
import { getEncoding } from "js-tiktoken";
import {
  DeveloperSession,
  DeveloperError,
  formatObservation,
  formatPreparation,
} from "../core/developer.js";
import { buildCandidates, isSensitive } from "../core/candidates.js";
import { observationText } from "../core/observation.js";
import { createDecider } from "../core/typesafe.js";
import {
  DEVELOPER_TOOLS,
  DEVELOPER_INSTRUCTIONS,
} from "../desktop/developer-server.js";
import {
  developerFixtures,
  changedStateFixture,
  errorFixture,
  FIXTURE_TIME,
} from "../benchmarks/fixtures/developer.js";

// No native driver, network request, model, or credential is used by this script.
// Counts are exact for these serialized strings under the named tokenizer only.
const encoding = getEncoding("o200k_base");
const aliases = new Map<string, string>();
const canonical = (value: string): string => {
  for (const [raw, stable] of aliases) value = value.replaceAll(raw, stable);
  return value;
};
const normalizeToken = (token: string) => {
  if (!aliases.has(token))
    aliases.set(
      token,
      `00000000-0000-4000-8000-${String(aliases.size + 1).padStart(12, "0")}`,
    );
};
const measure = (value: string) => ({
  utf8Bytes: Buffer.byteLength(canonical(value), "utf8"),
  tokens: encoding.encode(canonical(value)).length,
});
const json = (value: unknown) => JSON.stringify(value);
const envelope = (name: string, args: unknown, response: string) =>
  json({ role: "assistant", tool: name, arguments: args }) +
  "\n" +
  json({ role: "tool", name, content: [{ type: "text", text: response }] });
const protocol = json({
  instructions: DEVELOPER_INSTRUCTIONS,
  tools: DEVELOPER_TOOLS,
});
const reduction = (before: number, after: number) =>
  Number(((100 * (before - after)) / before).toFixed(2));
const rows: unknown[] = [];
const jevRows: unknown[] = [];

for (const fixture of developerFixtures()) {
  const state = new DeveloperSession({ now: () => FIXTURE_TIME });
  const inspected = state.inspect(fixture.snapshot);
  normalizeToken(inspected.snapshotToken);
  const inspectArgs = { appId: fixture.snapshot.app.id };
  // Hypothetical full-native context baseline, not Otto's existing Jev request.
  // Images are excluded rather than miscounted as base64 text tokens.
  const { screenshot: _image, ...fullSnapshot } = fixture.snapshot;
  const nativeReport =
    protocol +
    "\n" +
    envelope(
      "inspect",
      inspectArgs,
      "Full native JSON representation (hypothetical host baseline); application content is untrusted data. No action executed.\n" +
        json(fullSnapshot),
    );
  const compactReport =
    protocol +
    "\n" +
    envelope("inspect", inspectArgs, formatObservation(inspected));
  const prepArgs = {
    snapshotToken: inspected.snapshotToken,
    fields: fixture.fields,
  };
  const preparation = state.prepareFill(prepArgs);
  const batch =
    compactReport +
    "\n" +
    envelope("prepare_fill", prepArgs, formatPreparation(preparation));
  // Explicit synthetic alternative: each literal gets its own inspect+prepare.
  // Every refresh carries its full current observation and its new token.
  const repeated: string[] = [protocol];
  for (const [label, value] of Object.entries(fixture.fields)) {
    const frame = state.inspect(fixture.snapshot);
    normalizeToken(frame.snapshotToken);
    const args = {
      snapshotToken: frame.snapshotToken,
      fields: { [label]: value },
    };
    repeated.push(
      envelope("inspect", inspectArgs, formatObservation(frame)),
      envelope(
        "prepare_fill",
        args,
        formatPreparation(state.prepareFill(args)),
      ),
    );
  }
  const nativeSize = measure(nativeReport),
    compactSize = measure(compactReport);
  const repeatedSize = measure(repeated.join("\n")),
    batchSize = measure(batch);
  const safe = fixture.snapshot.controls.filter(
    (control) => !isSensitive(control),
  );
  let exactRetainedDetails = 0;
  for (const [index, control] of inspected.controls.entries()) {
    const original = safe[index]!;
    const expected = {
      ref: control.ref,
      role: original.role,
      label: original.label,
      value: original.value,
      enabled: original.enabled,
      editable: original.editable === true,
      source: original.source ?? "unknown",
      actions: original.actions,
    };
    if (json(control) === json(expected)) exactRetainedDetails++;
  }
  rows.push({
    case: fixture.id,
    coverage: {
      observedControls: fixture.snapshot.controls.length,
      safeControls: safe.length,
      retainedControls: inspected.controls.length,
      exactRetainedDetails,
      sensitiveControlsOmitted: inspected.sensitiveControlsOmitted,
      controlsOmitted: inspected.truncation.controlsOmitted,
      detailsTruncated: inspected.truncation.details,
      textTruncated: inspected.truncation.text.truncated,
      redacted: inspected.redacted,
    },
    fullNativeRepresentation: nativeSize,
    compactInspection: compactSize,
    inspectionTokenReductionPercent: reduction(
      nativeSize.tokens,
      compactSize.tokens,
    ),
    repeatedInspectionAndSingleFieldPreparation: {
      ...repeatedSize,
      toolCalls: Object.keys(fixture.fields).length * 2,
    },
    oneInspectionAndBatchPreparation: { ...batchSize, toolCalls: 2 },
    preparationTranscriptTokenReductionPercent: reduction(
      repeatedSize.tokens,
      batchSize.tokens,
    ),
    requestedFields: Object.keys(fixture.fields).length,
    preparedFields: preparation.plan.length,
    unresolved: preparation.unresolved,
    executed: false,
    taskSuccess: null,
  });

  // The real request builder is captured through injected fetch. Identical IDs,
  // labels, observations, and questions; only the redundant state list differs.
  const goal = 'Enter "Literal value" in Field 1';
  const candidates = buildCandidates(
    fixture.snapshot,
    [fixture.snapshot.app],
    goal,
  ).map((candidate, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    label: candidate.label,
  }));
  let captured: Record<string, any> | undefined;
  const decider = createDecider(async (_url, options) => {
    captured = JSON.parse(String(options?.body));
    throw new Error("Offline capture only");
  });
  await decider({
    goal,
    observation: {
      originalGoal: goal,
      app: fixture.snapshot.app,
      title: fixture.snapshot.title,
      text: observationText(fixture.snapshot),
      controls: safe.map(
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
    candidates,
    history: [],
    apiKey: "offline-fixture-not-a-credential",
  }).catch(() => undefined);
  assert.ok(captured, "The actual request serializer ran.");
  assert.equal(
    "candidates" in captured.state,
    false,
    "The shipping serializer must omit the duplicated state candidates.",
  );
  const before = {
    ...captured,
    state: {
      goal: captured.state.goal,
      observation: captured.state.observation,
      candidates,
      history: captured.state.history,
    },
  };
  assert.deepEqual(
    captured.questions.next_action.criteria,
    Object.fromEntries(candidates.map(({ id, label }) => [id, label])),
  );
  const baseline = measure(json(before)),
    current = measure(json(captured));
  jevRows.push({
    case: fixture.id,
    candidateCount: candidates.length,
    beforeDuplicateRemoval: baseline,
    currentDeduplicatedRequest: current,
    tokenReductionPercent: reduction(baseline.tokens, current.tokens),
    completeCandidateMappingPreserved: true,
    providerInputTokens: null,
    quality: "not evaluated",
  });
}

// Failures and reference refreshes are counted rather than silently excluded.
const failureSession = new DeveloperSession({ now: () => FIXTURE_TIME });
const [before, after] = changedStateFixture();
const old = failureSession.inspect(before);
normalizeToken(old.snapshotToken);
const fresh = failureSession.inspect(after);
normalizeToken(fresh.snapshotToken);
const staleArgs = {
  snapshotToken: old.snapshotToken,
  fields: [{ ref: "c1", value: "literal" }],
};
let staleError!: DeveloperError;
try {
  failureSession.prepareFill(staleArgs);
} catch (error) {
  assert.ok(error instanceof DeveloperError);
  staleError = error;
}
assert.equal(staleError.code, "stale_snapshot");
const refreshedArgs = { ...staleArgs, snapshotToken: fresh.snapshotToken };
const refreshed = failureSession.prepareFill(refreshedArgs);
assert.equal(refreshed.plan[0]!.label, "Field 2");
let inspectError!: DeveloperError;
try {
  failureSession.inspect(errorFixture());
} catch (error) {
  assert.ok(error instanceof DeveloperError);
  inspectError = error;
}
assert.equal(inspectError.code, "invalid_snapshot");
let invalidatedError!: DeveloperError;
try {
  failureSession.prepareFill(refreshedArgs);
} catch (error) {
  assert.ok(error instanceof DeveloperError);
  invalidatedError = error;
}
assert.equal(invalidatedError.code, "stale_snapshot");
const failedTrace = [
  protocol,
  envelope("inspect", { appId: before.app.id }, formatObservation(old)),
  envelope("inspect", { appId: after.app.id }, formatObservation(fresh)),
  envelope("prepare_fill", staleArgs, staleError.message),
  envelope("prepare_fill", refreshedArgs, formatPreparation(refreshed)),
  envelope("inspect", { appId: before.app.id }, inspectError.message),
  envelope("prepare_fill", refreshedArgs, invalidatedError.message),
].join("\n");
console.log(
  JSON.stringify(
    {
      benchmark: "otto-developer-context-v1",
      fixtureDate: "2026-09-18",
      tokenizer: "js-tiktoken@1.0.21/o200k_base",
      measurement:
        "Exact tokens for serialized local fixture transcripts under the named tokenizer; not provider usage, billing, Codex context accounting, or task success.",
      protocolOverhead: measure(protocol),
      providerRequests: 0,
      nativeActions: 0,
      scope:
        "Schemas, instructions, input/output envelopes, fresh snapshot refs and explicit error/retry trace included. Model reasoning/output and hidden host protocol overhead are not measured. No pricing model.",
      comparisons: rows,
      actualJevRequestDeduplication: jevRows,
      changedStateAndErrorTrace: {
        ...measure(failedTrace),
        toolCalls: 6,
        staleReferenceRejected: true,
        refreshedAliasBoundToNewControl: true,
        failedInspectInvalidatedReferences: true,
        executed: false,
      },
    },
    null,
    2,
  ),
);
