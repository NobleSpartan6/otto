import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DeveloperSession, formatObservation } from "../core/developer.js";
import { validateWorkflow } from "../core/agent-workflow.js";
import { cheapestUseful, selectEvidence } from "../core/evidence-policy.js";
import { AGENT_INSTRUCTIONS, AGENT_TOOLS } from "../desktop/agent-server.js";
import { developerFixtures, FIXTURE_TIME } from "../benchmarks/fixtures/developer.js";
import { EVIDENCE_CASES, EVIDENCE_LIMITATIONS } from "./evidence-cases.js";
import { measure, VALUES } from "./agent-bridge-paired.js";
import { writeProgress } from "./progress.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = (value: unknown) => JSON.stringify(value);
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const RESEARCH_PLAN = {
  version: "otto-bounded-autoresearch-v1",
  experiments: ["reuse-fill-values", "compact-snapshot-handles", "select-next-evidence"],
  limits: { experiments: 3, providerRequests: 8, nativeActions: 0 },
  gates: ["All relevant regression tests pass", "Fill request size never increases on these cases; total validation payload including schema decreases",
    "Snapshot-token mean size decreases without changing observation data or freshness checks", "Do not promote Jev without live comparative evidence"],
  scope: "Finite candidate evaluation, not an autonomous code writer or scheduled service. Never commits, publishes, changes permissions, or edits production source.",
};
export function researchArgs(args: string[]) {
  let run = false, jev = false, baseline: string | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (seen.has(arg)) throw new Error("Duplicate research argument.");
    seen.add(arg);
    if (arg === "--run") run = true;
    else if (arg === "--jev") jev = true;
    else if (arg === "--baseline-protocol") {
      baseline = args[++i]; if (!baseline || baseline.startsWith("--")) throw new Error("Supply a saved baseline protocol JSON path.");
    } else throw new Error("Usage: tsx evals/autoresearch.ts [--run --baseline-protocol <json>] [--jev]");
  }
  if (run && !baseline) throw new Error("Freeze the baseline protocol before running; --baseline-protocol is required.");
  return { run, jev, baseline };
}
const requestCases = [
  { id: "one-short-field", partition: "dev", values: { Name: "Ada" } },
  { id: "six-field-onboarding", partition: "dev", values: VALUES },
  { id: "multilingual-profile", partition: "validation", values: { 氏名: "山田", عنوان: "الجيزة", Prénom: "Élodie", "Descripción 🪴": "Jardín" } },
  { id: "long-release-notes", partition: "validation", values: { Notes: "Release notes — verified locally.\n".repeat(50) } },
  { id: "sixteen-environment-values", partition: "validation", values: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`Setting ${i + 1}`, `development-value-${i + 1}`])) },
];
const percent = (before: number, after: number) => Number((100 * (1 - after / before)).toFixed(2));

function markdown(report: Record<string, any>) {
  const fills = report.experiments.find((row: any) => row.name === "reuse-fill-values");
  const handles = report.experiments.find((row: any) => row.name === "compact-snapshot-handles");
  const evidence = report.experiments.find((row: any) => row.name === "select-next-evidence");
  return ["# Otto bounded research run", "", `Run status: **${report.status}**. Three predefined experiments; no native actions.`, "",
    "| Experiment | Decision |", "| --- | --- |", ...report.experiments.map((row: any) => `| ${row.name} | ${row.decision} |`), "",
    ...(fills ? ["## Literal reuse", "", "| Authored case | Request tokens before → after | Schema once + request before → after |", "| --- | ---: | ---: |",
      ...fills.rows.map((row: any) => `| ${row.id} | ${row.baselineRequest.tokens} → ${row.candidateRequest.tokens} | ${row.baselineSchemaOncePlusRequest.tokens} → ${row.candidateSchemaOncePlusRequest.tokens} |`), "", fills.limitations, ""] : []),
    ...(handles ? ["## Snapshot handles", "", "| Fixture | Mean observation tokens before → after |", "| --- | ---: |",
      ...handles.rows.map((row: any) => `| ${row.case} | ${row.meanBaselineTokens.toFixed(2)} → ${row.meanCandidateTokens.toFixed(2)} |`), "", handles.scope, ""] : []),
    ...(evidence ? ["## Evidence selection", "", `Live Jev status: **${evidence.jevStatus}**.`, "", evidence.limitations, ""] : []),
    "## Evidence and reproduction", "", "[Full report](report.json), [regression output](regression-tests.txt), [baseline protocol](baseline-protocol.json), [candidate protocol](candidate-protocol.json). Source snapshots and hashes accompany this run.", "",
    "Counts use js-tiktoken 1.0.21 / o200k_base. Actual host token usage, cached tokens, billing and general-task success are not measured. A keep_local decision recommends retaining the source change; this runner never modifies source or publishes it.", "",
    ...(report.failure ? [`Global failure: ${report.failure}`, ""] : []),
  ].join("\n");
}

export async function main(args = process.argv.slice(2)) {
  const options = researchArgs(args);
  if (!options.run) { console.log(json({ ...RESEARCH_PLAN, mode: "plan-only", liveJevRequested: options.jev })); return; }
  const directory = join(root, "output/autoresearch", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const sources = ["evals/autoresearch.ts", "evals/evidence-cases.ts", "core/evidence-policy.ts", "core/developer.ts", "core/agent-session.ts",
    "core/agent-workflow.ts", "core/typesafe.ts", "core/candidates.ts", "desktop/agent-server.ts", "desktop/agent-lease.ts", "desktop/native-driver.ts", "desktop/ocr.ts",
    "evals/progress.ts", "shared/types.ts", "core/evidence-policy.test.ts", "core/developer.test.ts", "core/agent-session.test.ts",
    "core/agent-workflow.test.ts", "desktop/agent-server.test.ts", "benchmarks/fixtures/developer.ts", "evals/agent-bridge-paired.ts", "package-lock.json"];
  const hashes: Record<string, string> = {};
  for (const path of sources) {
    const bytes = await readFile(join(root, path)); hashes[path] = sha(bytes);
    const dest = join(directory, "source", path); await mkdir(dirname(dest), { recursive: true, mode: 0o700 }); await writeFile(dest, bytes, { mode: 0o600 });
  }
  const baselineText = await readFile(resolve(options.baseline!), "utf8"), baseline = JSON.parse(baselineText);
  assert.ok(Array.isArray(baseline.tools) && typeof baseline.instructions === "string", "Invalid saved baseline protocol.");
  assert.ok(!json(baseline).includes("filled_values"), "Baseline must predate the shortcut.");
  const baselineProtocol = json(baseline), candidateProtocol = json({ instructions: AGENT_INSTRUCTIONS, tools: AGENT_TOOLS });
  await writeFile(join(directory, "baseline-protocol.json"), baselineProtocol, { mode: 0o600 });
  await writeFile(join(directory, "candidate-protocol.json"), candidateProtocol, { mode: 0o600 });
  const report: Record<string, any> = { plan: RESEARCH_PLAN, options: { ...options, baseline: "baseline-protocol.json" }, hashes,
    baselineProtocolSHA256: sha(baselineProtocol), candidateProtocolSHA256: sha(candidateProtocol),
    status: "running", experiments: [], actualHostTokens: null, billedCost: null };
  const save = () => writeProgress(join(directory, "report.json"), report);
  await save();
  try {
    const checks = spawnSync(process.execPath, ["--import", "tsx", "--test", ...sources.filter(path => path.endsWith(".test.ts"))],
      { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 2_000_000 });
    await writeFile(join(directory, "regression-tests.txt"), (checks.stdout ?? "") + (checks.stderr ?? ""), { mode: 0o600 });
    report.regressionExitCode = checks.status;
    assert.equal(checks.status, 0, "Regression gate failed; no candidate may be kept.");
    const rows = requestCases.map(item => {
      const base = { appId: "fixture", steps: Object.entries(item.values).map(([label, value]) => ({ operation: "fill", label, value })), expected: { values: item.values } };
      const candidate = { ...base, expected: "filled_values" };
      validateWorkflow(base); validateWorkflow(candidate);
      const a = json({ name: "run_steps", arguments: base }), b = json({ name: "run_steps", arguments: candidate });
      return { id: item.id, partition: item.partition, baselineRequest: measure(a), candidateRequest: measure(b),
        baselineSchemaOncePlusRequest: measure(baselineProtocol + "\n" + a), candidateSchemaOncePlusRequest: measure(candidateProtocol + "\n" + b),
        requestReductionPercent: percent(measure(a).tokens, measure(b).tokens) };
    });
    const validation = rows.filter(row => row.partition === "validation");
    const totals = { baseline: validation.reduce((n, row) => n + row.baselineSchemaOncePlusRequest.tokens, 0), candidate: validation.reduce((n, row) => n + row.candidateSchemaOncePlusRequest.tokens, 0) };
    const keep = rows.every(row => row.candidateRequest.tokens <= row.baselineRequest.tokens) && totals.candidate < totals.baseline;
    report.experiments.push({ name: "reuse-fill-values", decision: keep ? "keep_local" : "reject", rows, validationTotals: totals,
      limitations: "Request-only serialized token count plus full schema/instructions once per case; responses, host reasoning/caching/billing unmeasured. Every per-case regression including schema remains visible. Hand-authored cases, not secret holdout." });
    await save();

    const tokenRows = developerFixtures().map(fixture => {
      const frame = new DeveloperSession({ now: () => FIXTURE_TIME }).inspect(fixture.snapshot);
      let before = 0, after = 0, regressions = 0;
      for (let i = 0; i < 128; i++) {
        // Seeded format experiment only. Production uses crypto.randomBytes, never these seeds.
        const bytes = createHash("sha256").update(`otto-token-format-v1:${i}`).digest().subarray(0, 16);
        bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
        const hex = bytes.toString("hex"), uuid = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
        const compact = bytes.toString("base64url"); assert.deepEqual(Buffer.from(compact, "base64url"), bytes);
        const a = { ...frame, snapshotToken: uuid }, b = { ...frame, snapshotToken: compact };
        assert.deepEqual({ ...a, snapshotToken: null }, { ...b, snapshotToken: null });
        const x = measure(formatObservation(a)).tokens, y = measure(formatObservation(b)).tokens;
        before += x; after += y; if (y > x) regressions++;
      }
      return { case: fixture.id, samples: 128, meanBaselineTokens: before / 128, meanCandidateTokens: after / 128, samplesThatGrew: regressions, reductionPercent: percent(before, after) };
    });
    report.experiments.push({ name: "compact-snapshot-handles", decision: tokenRows.every(row => row.meanCandidateTokens < row.meanBaselineTokens) ? "keep_local" : "reject",
      rows: tokenRows, scope: "Only encoding varies: 36 to 22 characters for the same bytes. Same observation data, expiry and invalidation. 128 seeded UUID-shaped byte vectors repeated over eight fixtures, not 1,024 independent tasks. Fixed UUID version bits make this an encoding experiment, not production token sampling. Production generates 128 random bits. Counts cover formatted observation text only." });
    await save();

    assert.ok(EVIDENCE_CASES.length <= RESEARCH_PLAN.limits.providerRequests, "Evidence schedule exceeds the provider-call budget.");
    const evidenceRows = [];
    for (const item of EVIDENCE_CASES) {
      const first = cheapestUseful(item.request);
      const eligible = item.request.probes.filter(probe => first.candidateIds.includes(probe.id));
      const ladder = eligible.sort((a, b) => Number(a.kind === "ask_host") - Number(b.kind === "ask_host") || a.cost - b.cost || a.id.localeCompare(b.id));
      const acquired: string[] = []; let costUnits = 0;
      for (const probe of ladder) {
        acquired.push(probe.id); costUnits += probe.cost;
        const outcome = item.hidden.outcomes[probe.id];
        assert.ok(outcome, "Fixture outcome must exist for each eligible probe.");
        if (outcome.resolution !== "unresolved") break;
      }
      const selected = options.jev && process.env.TYPESAFE_API_KEY ? await selectEvidence(item.request, { apiKey: process.env.TYPESAFE_API_KEY }) : null;
      evidenceRows.push({ id: item.id, partition: item.partition, family: item.family, baselineFirst: first.probeId,
        baselineFixedLadder: { acquired, costUnits, final: item.hidden.outcomes[acquired.at(-1)!]?.resolution ?? "unresolved" },
        jev: selected, jevOutcomeAnnotation: selected?.probeId ? item.hidden.outcomes[selected.probeId]?.resolution ?? "unresolved" : null });
      report.evidenceProgress = evidenceRows; await save();
    }
    delete report.evidenceProgress;
    report.experiments.push({ name: "select-next-evidence", decision: "defer_live_comparison",
      jevStatus: options.jev ? process.env.TYPESAFE_API_KEY ? "attempted" : "not_run_missing_environment_key" : "not_requested",
      rows: evidenceRows, limitations: EVIDENCE_LIMITATIONS + " Cost units are authored relative costs, not dollars/tokens/measured acquisition latency. A selected probe is not acquired evidence or task success. No native probes are wired to this experimental module." });
    for (const path of sources) assert.equal(sha(await readFile(join(root, path))), hashes[path], "Source changed during research run.");
    report.status = "complete";
  } catch (error) {
    report.status = "failed"; report.failure = error instanceof assert.AssertionError ? error.message : "Research failed; inspect the local regression artifact.";
    for (const experiment of report.experiments) if (experiment.decision === "keep_local") {
      experiment.provisionalDecision = experiment.decision;
      experiment.decision = "invalidated_global_gate_failure";
    }
    process.exitCode = 1;
  } finally {
    await save(); await writeFile(join(directory, "report.md"), markdown(report), { mode: 0o600 });
    console.log(json({ status: report.status, directory, decisions: report.experiments.map(({ name, decision }: any) => ({ name, decision })) }));
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
