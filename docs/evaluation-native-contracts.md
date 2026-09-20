# Native integration contract evaluation

Preview the cases with `npm run eval:native-contracts`. This default command launches no app and makes no model call.

## The decision

Can Otto's `run_steps` integration preserve its execution contract when native state changes or a write fails? A failure blocks a claim that the tested contract works. Passing is a narrow regression result; it does not establish general computer-use capability, model quality, or SOTA performance.

The unit scored is one fresh fixture trial. Ten public, authored cases cover four contract families on **one AppKit form**. They are development and regression material, not a hidden holdout or ten independent applications. Case definitions and expected outcomes live in [the versioned manifest](../evals/native-contracts.ts).

## Recorded native run

On **2026-09-20 UTC**, all ten scheduled cases ran once on macOS arm64 with seed `20260920`. The independently observed outcomes were:

| Observation | Result |
| --- | ---: |
| Nominal goals completed | 6 / 6 |
| Required stops under injected faults | 4 / 4 |
| Extra writes on the repeated completed workflow | 0 |
| Forbidden submit/reset/duplicate-target mutations | 0 |
| Missing oracle evidence or unrun cases | 0 |
| Model calls in this scripted suite | 0 |

The [reviewed synthetic evidence](evidence/native-contracts-2026-09-20.json) includes original grades, before/after state, per-request checkpoints, receipts, and source/runtime hashes. Local temporary paths and process-launch metadata are omitted; the original report hash is retained. Raw local evidence remains under `output/native-contracts/2026-09-20T01-44-16-760Z/`.

After execution, an independent code review found that the grader checked total write attempts but did not verify their per-field attribution. A forged record could therefore claim a write to an already-correct field while preserving totals. The corrected grader checks per-field attempts and rejections, including every checkpoint. Original evidence and judgments are preserved; replay explicitly reports whether the current grader hash differs. No new native attempt was made to replace the recorded results.

The [separately recorded regrade](evidence/native-contracts-2026-09-20-regrade.json) still passes all **10/10 contracts**, with **6 completed goals** and **4 required stops**. The [original grader source](evidence/native-contracts-grader-original.ts.txt) was recovered exactly and verified against its recorded SHA-256; [its provenance note](evidence/native-contracts-grader-original.md) describes that recovery. It is archived evidence, not the active grader.

Replay the published evidence without controlling the desktop or calling a model:

```sh
npm run eval:replay -- docs/evidence/native-contracts-2026-09-20.json
```

Replay checks how recorded evidence grades under the current code; it does not authenticate the logs or create new execution evidence. A changed grader is disclosed separately from changed system behavior. The suite's launch handling also received a cleanup fix after this run: it captures validated ownership before writing logs and aborts further trials if startup ownership is uncertain. That failure-path fix is covered by input-validation tests; the ten-case recorded native run predates it.

A separate post-change smoke run of `exact-standard-six` passed with six writes, no forbidden effects, and complete cleanup. All 14 preserved runtime inputs matched their hashes. Its local evidence is `output/native-contracts/2026-09-20T01-52-36-427Z/`; it is not pooled into the ten-case result above.

| Family | What is tested | What the grader checks |
| --- | --- | --- |
| Exact literals | Normal, multilingual/multiline, and long values | Complete strings match, including characters beyond compact preview limits |
| Selective and idempotent updates | Two-field updates, prefilled values, repeated completed workflow | Unrelated values remain intact; already-correct fields do not receive extra writes |
| Interference | An external edit, disappearing field, or duplicate label after the first write | Remaining work stops; externally changed and unrelated state is preserved |
| Verification failure | The app rejects the final write | No false verified receipt and no automatic replay of an uncertain action |

**Idempotence** means repeating an already-completed operation does not add side effects. The explicit repeat case performs a second request only after the first returns verified; it is not a retry after failure.

## What runs

The harness starts a fresh disposable native app for each trial and sends scripted requests through the real MCP stdio client/server and macOS Accessibility driver. The app's own recorder supplies the independent before/after oracle. The grader does not import Otto's verification implementation or accept a success receipt as proof of final state.

The suite uses no model or provider API. `modelCalls: 0` describes this scripted harness. Provider token usage and billed cost are `null`, because they were not measured. Do not label these results LLM task success or combine them with the historical Codex token comparison.

## Run on macOS

1. Build the runtime with `npm run build`.
2. Reserve desktop access; do not run another computer-use controller alongside the suite.
3. Execute `npm run eval:native-contracts -- --run`.
4. Read `output/native-contracts/<timestamp>/report.md` and its `report.json` evidence.

Native Accessibility must already be available to the launch context. The suite never opens a permission prompt, reads provider keys, or changes the installed Otto app. Every server is scoped to its own fixture's exact PID. Otto's worker lease applies; contention returns a recorded failure rather than switching executors.

The default is one trial per case, ordered by a recorded deterministic seed. `--case CASE_ID` selects a case; `--repetitions 3` runs three fresh trials per case; `--seed 42` changes reproducible ordering. Repetitions can reveal environment instability, but remain clustered by case and fixture. They do not create independent application samples.

## Read the result correctly

- **Contract passed:** the required outcome, forbidden-side-effect checks, receipt honesty, and evidence checks passed together.
- **Goal completed:** the requested final state was independently observed. A correct refusal is not included here.
- **Expected stop:** a deliberately injected fault produced the required stop and preserved protected state.
- **Evidence incomplete:** the oracle, response, process identity, or runtime evidence is missing or invalid. This never becomes a pass.

The denominator includes every scheduled trial. Interruptions leave remaining trials visible as `not_run`. All started failures retain their responses and available final state before cleanup. A post-dispatch error is never automatically replayed. Cleanup verifies the exact fixture process; an uncertain cleanup stops subsequent trials.

The recorded plan freezes case definitions, seed, repetition count, and runtime hashes before execution. Future runs also copy those source/runtime inputs under the report's `runtime/` directory; the first recorded run captured hashes before this snapshot feature was added. Per-trial files include launch output, tool manifest, actual MCP requests/results, oracle states, grade, and failures. Changes to the runtime invalidate the run. Raw artifacts remain local under ignored `output/` because future fixtures may contain sensitive data; publish only reviewed synthetic evidence.

## Improve the evaluation

Add a case by defining its initial state, authorized steps, observable final state, forbidden side effects, expected receipts, and write budget in the manifest. Add a grader regression that forges a success receipt while breaking the expected state. `npm test` must reject that forged success before the new case is useful.

For an LLM-agent comparison, use the same task contracts with natural-language goals, frozen tools/model/budgets, independent final-state grading, and paired AB/BA order. Keep strategy compliance, task outcome, usage coverage, and operational failures separate. Include a strong batching baseline and tasks on additional app backends. The current native suite does not run that model comparison; the existing [one-pair Codex evaluation](evaluation-codex-agent-bridge.md) remains preliminary.

See the [case definitions and grader](../evals/native-contracts.ts) and [native harness](../tests/native/contract-suite.ts) for the implementation.
