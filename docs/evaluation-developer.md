# Developer context and preparation evaluation

This is a **keyless, offline context-size and preparation test**, dated 2026-09-18. It does not establish billed token savings, lower cost, fewer agent reasoning turns, or successful computer-use tasks. No provider request or native action occurs in this benchmark.

## Implemented boundary

[`DeveloperSession`](../core/developer.ts) accepts a native observation supplied by the local adapter. `inspect` returns a complete current-frame report, short references, and explicit omission/redaction/truncation metadata. `prepareFill` accepts literal values by observed reference or exact label and returns an inert plan plus unresolved fields. `executed` is always `false`. These plans are **not connected to Electron's approval or execution flow**; there is no tool that types, submits, toggles, clicks, or approves a plan.

The [MCP adapter](developer-tools.md) can expose this boundary to a host agent without a TypeSafe or OpenAI key. The host receives selected application text under the launcher's explicit app scope. This is not ChatGPT subscription OAuth.

Limits are deliberate:

- References apply only to the latest successful inspection and expire 30 seconds after native capture. A refresh, failed refresh, cancellation, or explicit invalidation revokes previous references. No cross-frame deltas or stable-control identity are claimed.
- Default inspection retains 64 controls and 4,000 text characters; configurable maxima are 128 controls and 16,000 text characters. Role, label, value, enabled/editable state, source, and supported actions are retained. Oversized detail fields are explicitly marked. Screenshots, coordinates, and native control handles are not returned.
- Preparation accepts 1–32 supplied fields, at most 2,000 characters per literal and 16,000 in total. Unknown input properties and nested/executable arguments are rejected. Only enabled accessibility controls exposing an editable `fill` action qualify. OCR text is not evidence of an editable field.
- Sensitive targets are omitted. Known protected values and credential-like text are redacted before clipping; sanitized lengths are recorded so redaction expansion cannot hide truncation. This is deterministic filtering, not a guarantee that every possible secret can be recognized.
- Duplicate labels, including duplicates omitted by a control cap, remain unresolved. Explicit current-frame references can identify otherwise ambiguous controls. Missing, disabled, non-native, repeated, and sensitive-value requests return explicit reasons.

## Reproduce

After installing repository dependencies:

```sh
node_modules/.bin/tsx --test core/developer.test.ts
node_modules/.bin/tsx scripts/benchmark-context.ts
```

The benchmark prints a JSON report. It uses the pinned `js-tiktoken@1.0.21` package and its bundled **`o200k_base`** encoding, with no download or key. Counts are exact for the serialized strings under that encoding. They are not actual TypeSafe, GPT-6 Astra, Codex, or other host billing counts: a host may use different tokenization, hidden messages, image accounting, caching, or tool serialization.

Fixtures are authored synthetic forms, not sampled user tasks. Their timestamp is fixed, and randomly created snapshot tokens are replaced with deterministic UUID-shaped strings only for measurement. Native IDs and labels remain unchanged in the Jev comparison. Production references remain random and snapshot-bound.

Tool schemas and server instructions are imported from the production adapter. Both alternatives include these definitions, inspect/prepare inputs, response envelopes, and visible instructions. One-time protocol metadata contributes **458 tokenizer tokens / 2,026 UTF-8 bytes** in this revision. The report also includes a six-call changed-state/error trace: stale reference rejection, refresh, rebound alias, failed inspection, and preparation after failed inspection. All failure calls remain in that transcript (1,465 tokenizer tokens / 5,734 UTF-8 bytes).

## Inspection representation comparison

The baseline below is the **full native JSON representation without screenshots**, a hypothetical context representation for a host. It is not the current Jev request or a recording of Codex. Native IDs and geometry remain in that baseline. Sensitive-data omission and clipping therefore contribute to some reductions; the table states coverage rather than labeling all reductions lossless. Both alternatives include the same production tool-schema overhead.

| Fixture | Full native JSON tokens | Compact report tokens | Reduction | Retained / observed controls | Qualification |
| --- | ---: | ---: | ---: | ---: | --- |
| Form, 1 field | 676 | 748 | **−10.65%** | 1 / 1 | Compact metadata costs more on a tiny view |
| Form, 4 fields | 871 | 835 | 4.13% | 4 / 4 | Retained control details unchanged |
| Form, 24 fields | 2,171 | 1,415 | 34.82% | 24 / 24 | Retained control details unchanged |
| Form, 180 fields | 12,464 | 2,575 | 79.34% | 64 / 180 | 116 controls omitted; requested Field 180 unresolved |
| Multilingual | 872 | 836 | 4.13% | 4 / 4 | Japanese, Arabic, accents and emoji preserved |
| Duplicate labels | 802 | 802 | 0% | 3 / 3 | Duplicate email label remains unresolved |
| Sensitive fields | 826 | 786 | 4.84% | 2 / 3 | Protected target omitted; copied secrets redacted |
| Long content | 7,355 | 1,525 | 79.27% | 4 / 4 | Document clipped; one field value clipped; explicitly reported |

Tests compare every retained metadata field against its source when no redaction/truncation is needed. The JSON report separately records observed, safe, retained, exact-detail, and omitted counts. Large percentages in capped cases cannot support a claim of equal information or equal agent quality.

## One preparation versus repeated preparation

This comparison measures two **synthetic preparation transcripts** for the same supplied literal map. The repeated variant inspects and prepares each field separately; the batch variant inspects once and prepares the complete map. Each refresh includes its current full report and newly bound reference. Neither variant executes the plan, and the repeated baseline is not a measurement of a particular existing agent. These counts demonstrate protocol overhead only.

| Fixture | Repeated transcript tokens | Batch transcript tokens | Prepared / requested fields |
| --- | ---: | ---: | ---: |
| Form, 1 field | 899 | 899 | 1 / 1 |
| Form, 4 fields | 2,570 | 1,067 | 4 / 4 |
| Form, 24 fields | 13,754 | 1,863 | 12 / 12 |
| Form, 180 fields | 29,937 | 3,045 | 12 / 13 |
| Multilingual | 2,566 | 1,060 | 4 / 4 |
| Duplicate labels | 1,440 | 972 | 1 / 2 |
| Sensitive fields | 1,407 | 955 | 1 / 2 |
| Long content | 1,674 | 1,674 | 1 / 1 |

Every row has `executed: false` and `taskSuccess: null`. An unresolved field is preserved in the result; it is not counted as prepared or silently dropped. There is no submit action. Execution would require fresh native observations, checks and trusted approval; those costs are not estimated here.

## Actual Jev request deduplication

The script captures the **current real TypeSafe request serializer** through injected fetch, which deliberately stops before networking. It reconstructs the previous state key order exactly: `{goal, observation, candidates, history}`. The only before/after difference is the redundant `state.candidates` list; the complete ID-to-label mapping remains in `questions.next_action.criteria`. IDs, labels, instructions, observation and questions are identical. This is separate from the developer-context format and its short references.

| Fixture | Previous request tokens | Deduplicated request tokens | Reduction |
| --- | ---: | ---: | ---: |
| Form, 1 field | 597 | 420 | 29.65% |
| Form, 4 fields | 885 | 612 | 30.85% |
| Form, 24 fields | 2,805 | 1,892 | 32.55% |
| Form, 180 fields | 10,521 | 8,488 | 19.32% |
| Multilingual | 885 | 613 | 30.73% |
| Duplicate labels | 777 | 540 | 30.50% |
| Sensitive fields | 704 | 495 | 29.69% |
| Long content | 3,767 | 3,494 | 7.25% |

These are `o200k_base` counts of serialized request text, **not Jev-reported input tokens**. `providerInputTokens` remains `null`; no token price or dollar saving is calculated. Removing redundant context can still affect a model's decisions. Live paired decision and task-quality evaluation remains required before claiming equivalent behavior.

## What remains unmeasured

The unit fixtures establish bounded parsing, retained metadata fidelity, redaction, safe abstention, reference invalidation, and literal plan construction. The native disposable-app test separately checks inspection/preparation leaves its field unchanged. Neither establishes agent task success across arbitrary applications.

A consequential comparison should run paired, resettable workflows with the same task, host model, permissions and action budget. Record the **host agent's** actual usage as well as Jev/planner usage; preserve missing usage, failures and retries. Grade authoritative final field contents and forbidden side effects independently of the agent's completion claim. Report success, interventions, complete-task latency and usage together. Existing run metrics cover reported valid responses and are not a complete billing ledger for cancelled or failed calls. No market-wide performance, cost, or reliability claim follows from this offline suite.
