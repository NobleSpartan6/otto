# Otto: an integration and evaluation engineering case study

**Review the execution contract, run its tests, and inspect an independently graded failure.** This is the strongest current demonstration of Otto's engineering work.

## Why this work is relevant

Cohere's [Software Engineer, Integrations description](https://jobs.ashbyhq.com/cohere/96c74af4-b3d7-4960-a666-212ce4debac8) connects integration ownership with regression evaluation and improving tool descriptions from feedback. Its [Applied AI Engineer, Agents & Automations description](https://jobs.ashbyhq.com/cohere/3fe03041-347a-479f-8361-6b1f5f81338e) also emphasizes multi-step workflows, tool strategies, context construction, and instrumentation. These official descriptions were researched on September 19, 2026 through indexed listings; application availability has not been confirmed.

My assessment: Otto fits the integration and applied-agent engineering direction more directly than a claim of frontier model research. Adding a Cohere provider adapter by itself would not demonstrate those skills. This project is independent and is not affiliated with, endorsed by, or deployed inside Cohere.

## The problem and implementation

A coding agent can spend repeated reasoning turns inspecting controls and issuing predictable desktop actions. Otto exposes a local MCP integration that accepts a bounded sequence, checks fresh native state between actions, and returns a compact receipt. The host remains responsible for task interpretation and authority.

| Engineering concern | Implemented evidence |
| --- | --- |
| Integration boundary | Explicit app scope, validated tool schemas, structured results, and launcher-controlled execution in [the MCP server](../../desktop/agent-server.ts) |
| Reliable execution | Fresh control identity, bounded actions, no blind replay after uncertainty, and native completion checks in [the executor](../../core/agent-session.ts) |
| Concurrent clients | Per-user/host ownership and explicit release in [the lease](../../desktop/agent-lease.ts), with filesystem failure and contention tests |
| Evaluation quality | Versioned native cases, independent fixture-state grading, retained failures, and grader regression tests in [the contract suite](../../evals/native-contracts.ts) |
| Developer adoption | A working [one-shot client](../../scripts/otto-task.mjs), [MCP setup](../agent-bridge.md), and instructions that distinguish supported native controls from unsupported workflows |

## Evidence, with its limits

The [live Codex comparison](../evaluation-codex-agent-bridge.md) measured one authored six-field task in two fresh runs. Both completed all six fields. Reported input decreased by 72.31% including cached input, or 32.00% after subtracting reported cached input. The comparison did not establish billed savings, a general success rate, or superiority over a strong competing batching implementation.

The [native contract suite](../evaluation-native-contracts.md) broadens regression coverage to exact strings, selective/idempotent updates, interference, and rejected writes. It uses real MCP and native Accessibility, but scripted requests rather than an LLM choosing its actions. All ten cases share one authored app. Repetitions of these cases are not independent application samples, and public development cases are not a holdout.

The recorded run completed **6/6 nominal goals** and produced **4/4 required stops** in the injected-fault cases. Repeating the completed task added **zero native writes**. [Published synthetic evidence](../evidence/native-contracts-2026-09-20.json) can be regraded locally with `npm run eval:replay -- docs/evidence/native-contracts-2026-09-20.json`; its original grades and grader hash remain available for audit.

Protocol and unit tests cover additional behavior with synthetic drivers. Their passing does not prove native app coverage. The current source supports macOS and Windows adapters, but the authored native suite is macOS-only.

## One failure worth explaining

The original live evaluation incorrectly treated a Codex startup warning as an unexpected tool error. Raw events and oracle states had been retained, so the grader could be corrected and the same evidence regraded without buying a more favorable new run. The correction matched the exact warning; unrelated errors remained failures. The original and revised judgments were preserved.

This is a useful interview distinction: a model can fail, an integration can fail, the environment can block execution, or the grader itself can be wrong. A single red/green result is insufficient for diagnosis. A later native CLI attempt also stopped with an unverified action and an unresolved cause; that [limitation remains documented](../current-task-usage.md#validation-status).

The new grader is tested against forged success receipts, wrong final values, changed protected fields, replayed writes, and incomplete evidence. In the repeated-operation case, each request needs its own independent state checkpoint: final state alone cannot prove that the second request added no writes.

A later review found another false-pass path: correct total write counts did not establish which fields received those writes. A mutation test exposed it, per-field attribution checks were added, and the saved native evidence was retained for replay. This measures an improvement to the evaluation instrument, without presenting it as an improvement to the agent's capability.

## The next defensible experiment

1. Define additional task families on different app backends, with independent persistence checks and explicit forbidden effects.
2. Freeze natural-language tasks, tool schemas, model configuration, time/retry budgets, and paired AB/BA order before a live agent comparison.
3. Compare interactive Otto, batched Otto, and a credible existing batching tool. Include unsuccessful and blocked attempts in outcome denominators.
4. Reserve new cases from tuning. Report completion, forbidden effects, latency, reported/cached token coverage, and unknown costs separately.

Do not claim SOTA from the current evidence. A stronger near-term claim would concern a clearly named task population and a measured quality–cost tradeoff. Integration work still to demonstrate includes a real third-party service's authentication lifecycle, rate limits, and schema evolution; native MCP tests are not evidence that those problems have been solved.

## Explain the work in 90 seconds

Use this structure in your own words:

1. **Problem:** what repeated work the host agent performs and why it is expensive.
2. **Decision:** which steps belong in the local executor and which require the host's judgment.
3. **Evidence:** one completed outcome and one correct stop, each checked independently.
4. **Limits:** what the experiment cannot prove and the next comparison that would change your decision.

Practice the [five short concepts](../learning/agent-evals.md) before describing the project as evaluation work. Being able to defend the measurements is more useful than repeating a large percentage.
