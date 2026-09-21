import assert from "node:assert/strict";
import test from "node:test";
import { cheapestUseful, EvidencePolicyError, selectEvidence, validateEvidenceRequest, type EvidenceRequest } from "./evidence-policy.js";
import type { Decision, DecisionInput } from "./typesafe.js";
import type { JevRequestMetric } from "../shared/types.js";
import { EVIDENCE_CASES, EVIDENCE_LIMITATIONS } from "../evals/evidence-cases.js";

const input = (): EvidenceRequest => ({ claim: { id: "claim", description: "The name equals Ada." }, context: { appId: "fixture", summary: "The field can be read." }, probes: [
  { id: "tree", kind: "inspect_tree", description: "Read selected tree.", appId: "fixture", claimIds: ["claim"], cost: 5, available: true },
  { id: "value", kind: "read_value", description: "Read Name.", appId: "fixture", claimIds: ["claim"], cost: 1, available: true },
  { id: "host", kind: "ask_host", description: "Return to host.", appId: "fixture", claimIds: ["claim"], cost: 0, available: true },
] });
const decision = (choice = "value", confidence = 0.9): Decision => ({ choice, confidence, probabilities: { [choice]: 1 }, complete: 1,
  latencyMs: 1, inputTokens: 22, outputTokens: 3, model: "test-model" });
const key = "private-test-key";
const metric = (patch: Partial<JevRequestMetric> = {}): JevRequestMetric => ({ id: "request-1", requestedModel: "jev-latest", model: null,
  startedAt: new Date().toISOString(), completedAt: null, outcome: "pending", responseReceived: false, httpStatus: null,
  inputTokens: null, outputTokens: null, latencyMs: null, ...patch });

test("baseline selects cheapest relevant available read, then caller-owned host fallback", () => {
  const request = input(), original = JSON.stringify(request);
  const result = cheapestUseful(request);
  assert.equal(result.probeId, "value"); assert.equal(result.probeKind, "read_value"); assert.equal(result.status, "selected");
  assert.equal(result.confidence, null); assert.equal(result.model.deciderCalls, 0);
  assert.equal(result.authorized, false); assert.equal(result.evidenceAcquired, false); assert.equal(result.completion, "unknown");
  assert.equal(JSON.stringify(request), original);
  request.probes.filter(p => p.kind !== "ask_host").forEach(p => p.available = false);
  assert.equal(cheapestUseful(request).probeId, "host");
  request.probes.forEach(p => p.available = false);
  assert.equal(cheapestUseful(request).reason, "no_available_probe");
});

test("scope, availability and relevance filter model candidates before invocation", async () => {
  const request = input();
  request.probes.push({ ...request.probes[1]!, id: "outside", appId: "other" }, { ...request.probes[1]!, id: "unavailable", available: false },
    { ...request.probes[1]!, id: "unrelated", claimIds: ["different"] });
  let calls = 0;
  const result = await selectEvidence(request, { apiKey: key, decider: async data => {
    calls++; assert.deepEqual(data.candidates.map(p => p.id), ["tree", "value", "host"]);
    assert.deepEqual(data.observation, { claim: request.claim, context: request.context });
    assert.deepEqual(data.history, []); return decision();
  } });
  assert.equal(calls, 1); assert.equal(result.probeId, "value");
  assert.deepEqual(result.excluded, [{ id: "outside", reason: "wrong_scope" }, { id: "unavailable", reason: "unavailable" }, { id: "unrelated", reason: "unrelated_claim" }]);
  assert.equal(result.completion, "unknown"); assert.equal(result.authorized, false); assert.equal(result.evidenceAcquired, false);
  assert.equal(result.model.attemptedRequests, null); assert.equal(result.model.receivedResponses, null);
  assert.equal(result.model.inputTokens, 22); assert.equal(result.model.outputTokens, 3); assert.equal(result.model.usageComplete, true);
});

test("selector snapshots its input and never exposes hidden outcomes or takes completion authority", async () => {
  const request = input();
  const result = await selectEvidence(request, { apiKey: key, decider: async data => {
    request.probes[1]!.id = "mutated";
    assert.ok(data.goal.includes("do not declare completion"));
    return decision("value");
  } });
  assert.equal(result.probeId, "value"); assert.equal(result.completion, "unknown");
  assert.throws(() => validateEvidenceRequest({ ...input(), hidden: { oracle: true } }), EvidencePolicyError);
});

test("unknown/unavailable selections and invalid confidence fail without retry", async () => {
  for (const response of [decision("outside"), decision("missing"), decision("value", NaN), decision("value", 1.01)]) {
    let calls = 0; const result = await selectEvidence(input(), { apiKey: key, decider: async () => { calls++; return response; } });
    assert.equal(result.status, "failed"); assert.equal(result.reason, "invalid_choice"); assert.equal(result.probeId, null); assert.equal(calls, 1);
  }
  const request = input(); request.probes[1]!.available = false;
  assert.equal((await selectEvidence(request, { apiKey: key, decider: async () => decision() })).reason, "invalid_choice");
});

test("low confidence abstains; it does not invent a probe or completion", async () => {
  const result = await selectEvidence(input(), { apiKey: key, decider: async () => decision("value", 0.4) });
  assert.equal(result.status, "abstained"); assert.equal(result.reason, "low_confidence"); assert.equal(result.confidence, 0.4);
  assert.equal(result.probeId, null); assert.equal(result.completion, "unknown");
});

test("only eligible host probes select the cheapest host without a key or model call", async () => {
  const request = input();
  request.probes.filter(probe => probe.kind !== "ask_host").forEach(probe => probe.available = false);
  request.probes[2]!.cost = 2;
  request.probes.push({ ...request.probes[2]!, id: "host-b", cost: 1 }, { ...request.probes[2]!, id: "host-a", cost: 1 });
  let calls = 0;
  const result = await selectEvidence(request, { apiKey: "", decider: async () => { calls++; throw new Error("Must not call"); } });
  assert.equal(calls, 0); assert.equal(result.probeId, "host-a"); assert.equal(result.probeKind, "ask_host");
  assert.equal(result.confidence, null); assert.equal(result.completion, "unknown"); assert.equal(result.authorized, false);
  assert.equal(result.evidenceAcquired, false);
  assert.deepEqual(result.model, { deciderCalls: 0, attemptedRequests: 0, receivedResponses: 0, elapsedMs: 0,
    inputTokens: 0, outputTokens: 0, usageComplete: true, servedModel: null });
});

test("a lone actual read still needs the decider and may abstain", async () => {
  const request = input(); request.probes = [request.probes[1]!];
  let calls = 0;
  const result = await selectEvidence(request, { apiKey: key, decider: async () => { calls++; return decision("value", 0.1); } });
  assert.equal(calls, 1); assert.equal(result.probeId, null); assert.equal(result.reason, "low_confidence");
});

test("provider failure records unknown usage; telemetry preserves known usage without echoing errors", async () => {
  for (const telemetry of [false, true]) {
    let calls = 0;
    const result = await selectEvidence(input(), { apiKey: key, decider: async data => {
      calls++; if (telemetry) {
        data.onRequest?.(metric()); data.onRequest?.(metric({ responseReceived: true, inputTokens: 11, outcome: "invalid_response", completedAt: new Date().toISOString() }));
      }
      throw new Error("PRIVATE_PROVIDER_BODY private-test-key");
    } });
    assert.equal(calls, 1); assert.equal(result.reason, "provider_failed"); assert.equal(result.model.deciderCalls, 1);
    assert.equal(result.model.attemptedRequests, telemetry ? 1 : null); assert.equal(result.model.receivedResponses, telemetry ? 1 : null);
    assert.equal(result.model.inputTokens, telemetry ? 11 : null); assert.equal(result.model.outputTokens, null); assert.equal(result.model.usageComplete, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER_BODY|private-test-key/);
  }
});

test("request lifecycle updates count one request and actual served-model metadata", async () => {
  const result = await selectEvidence(input(), { apiKey: key, decider: async data => {
    data.onRequest?.(metric()); data.onRequest?.(metric({ outcome: "succeeded", responseReceived: true, inputTokens: 31, outputTokens: 4, model: "actual-served-model" }));
    return decision();
  } });
  assert.equal(result.model.attemptedRequests, 1); assert.equal(result.model.receivedResponses, 1);
  assert.equal(result.model.servedModel, "actual-served-model"); assert.equal(result.model.inputTokens, 31); assert.equal(result.model.outputTokens, 4);
});

test("pre-cancel and no candidates avoid the decider; cancellation after response invalidates selection", async () => {
  let calls = 0;
  const decider = async () => { calls++; return decision(); };
  const cancelled = await selectEvidence(input(), { apiKey: key, signal: AbortSignal.abort(), decider });
  assert.equal(cancelled.reason, "cancelled"); assert.equal(cancelled.model.deciderCalls, 0);
  const empty = input(); empty.probes = [];
  assert.equal((await selectEvidence(empty, { apiKey: "", decider })).reason, "no_available_probe"); assert.equal(calls, 0);
  const controller = new AbortController();
  const result = await selectEvidence(input(), { apiKey: key, signal: controller.signal, decider: async () => { controller.abort(); return decision(); } });
  assert.equal(result.reason, "cancelled"); assert.equal(result.probeId, null);
});

test("bad metadata/options cannot widen capabilities or silently truncate evidence", async () => {
  for (const mutate of [
    (r: any) => { r.probes[0].kind = "click"; }, (r: any) => { r.probes[0].execute = "command"; },
    (r: any) => { r.probes[0].cost = -1; }, (r: any) => { r.probes[0].cost = Infinity; },
    (r: any) => { r.probes[0].available = "true"; }, (r: any) => { r.probes.push(r.probes[0]); },
    (r: any) => { r.context.summary = "x".repeat(8001); }, (r: any) => { r.claim.description = "x".repeat(2001); },
    (r: any) => { r.probes[0].description = "x".repeat(1001); }, (r: any) => { r.probes[0].claimIds = []; },
    (r: any) => { r.probes = Array.from({ length: 17 }, (_, i) => ({ ...r.probes[0], id: `p${i}` })); },
  ]) { const request = input(); mutate(request); assert.throws(() => validateEvidenceRequest(request), EvidencePolicyError); }
  const decider = async () => { throw new Error("Must not call"); };
  await assert.rejects(selectEvidence(input(), { apiKey: key, minConfidence: 2, decider }), EvidencePolicyError);
  const leaked = input(); leaked.context.summary = key;
  await assert.rejects(selectEvidence(leaked, { apiKey: key, decider }), EvidencePolicyError);
});

test("synthetic partitions use distinct families/templates and hidden annotations never enter model input", async () => {
  assert.equal(EVIDENCE_CASES.length, 8); assert.match(EVIDENCE_LIMITATIONS, /not a hidden benchmark/);
  const development = EVIDENCE_CASES.filter(row => row.partition === "dev"), validation = EVIDENCE_CASES.filter(row => row.partition === "validation");
  assert.equal(development.length, 4); assert.equal(validation.length, 4);
  assert.ok(validation.every(row => !development.some(other => other.family === row.family || other.template === row.template)));
  for (const item of EVIDENCE_CASES) {
    const clean = validateEvidenceRequest(item.request);
    for (const p of clean.probes.filter(probe => probe.available && probe.appId === clean.context.appId)) assert.ok(item.hidden.outcomes[p.id]);
    let observed: DecisionInput | undefined;
    const result = await selectEvidence(clean, { apiKey: key, decider: async data => { observed = data; return decision(data.candidates[0]!.id); } });
    if (observed) assert.doesNotMatch(JSON.stringify(observed), /claimTruth|oracle|outcomes|resolution|partition|template/);
    else { assert.equal(result.probeKind, "ask_host"); assert.equal(result.model.deciderCalls, 0); }
    assert.equal(result.completion, "unknown"); assert.equal(result.authorized, false);
  }
});

test("cheapest-useful is an honest metadata baseline, not an oracle-guided resolver", () => {
  const item = EVIDENCE_CASES.find(row => row.id === "validation-ledger-document")!;
  const result = cheapestUseful(item.request);
  assert.equal(result.probeId, "value"); assert.equal(item.hidden.outcomes[result.probeId!]!.resolution, "unresolved");
  assert.equal(item.hidden.outcomes.document!.resolution, "contradicts");
});
