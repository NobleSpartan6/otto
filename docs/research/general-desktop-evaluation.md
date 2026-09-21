# General desktop evaluation methodology

This document describes evaluation design and public benchmark references, not a scheduled experiment or a general-capability result. The source survey below was recorded on September 19, 2026; version and availability statements refer to that review, not to a fresh benchmark reproduction.

## Public benchmark references

| Benchmark | Source-review scope | Evaluation implication |
| --- | --- | --- |
| OSWorld-Verified | XLANG's July 2025 revision repaired reported task/environment/evaluator issues. Its maintainer instructions require comparable benchmark versions and a separate process for verified public leaderboard results. [Report](https://xlang.ai/blog/osworld-verified), [source](https://github.com/xlang-ai/OSWorld) | Pin versions and use independent outcome graders. An Ubuntu score does not establish native Mac/Windows capability; an adapted subset is not an official full-benchmark result. |
| OSWorld 2.0 | The June 28 paper, revised July 13, 2026, defines 108 long workflows, human median about 1.6 hours, and a 500-step primary completion metric. It separates binary completion, partial progress, and safety audits. [Paper v2](https://arxiv.org/abs/2606.29537v2) | Useful long-horizon coverage, not a comparison target for a six-field fixture. |
| OSWorld-V2 release | At the source review, the repository recommended **osworld-v2.1**, released September 16, 2026. Its code, gated tasks/assets, mock websites, and provider images must match the release; supplied images are Docker/AWS Ubuntu environments. [Versioned README](https://github.com/xlang-ai/OSWorld-V2/blob/3d778a3c9a34a079316f70df023b166700445792/README.md) | Separate paper results, release-specific reproducibility, and current leaderboard claims. |
| Windows Agent Arena | Microsoft provides Windows tasks, repeatable VM state, extensible agents, and local/Azure execution. Its repository identifies `predict()` and `reset()` as the agent interface. [Paper](https://arxiv.org/abs/2409.08264), [source](https://github.com/microsoft/WindowsAgentArena) | Retain task contracts, Windows images, budgets, and evaluators. Historical Navi results are not a current SOTA target. |
| MacArena | June 2026 paper: 421 tasks across 50 apps, including ported tasks and 49 new Mac-native tasks, on Apple Silicon virtualization. [Paper](https://arxiv.org/abs/2606.06560), [source](https://github.com/MacPaw/MacArena) | The source README identifies noncommercial restrictions on inherited macOSWorld tasks. Check task-level licenses before redistribution. The survey did not boot the image. |
| macOSWorld | The primary project lists 202 tasks, five languages, 28 Mac-exclusive apps, and 29 safety tasks, with reset and evaluator scripts. [Project](https://macos-world.github.io/), [paper](https://arxiv.org/abs/2506.04135) | Useful language and deceptive-context coverage; a different distribution from cross-platform workflows. |
| MacAgentBench | June 2026 paper and source describe 676 tasks across 25 apps, deterministic checks, and partial checkpoints. Many tasks involve both GUI and CLI. [Paper](https://arxiv.org/abs/2606.22557), [source](https://github.com/JetAstra/MacAgentBench) | GUI-only and shell/AppleScript/skills-enabled systems have different powers. Label system comparisons separately from equal-tools model comparisons. |

Repository revisions recorded during the source survey: OSWorld `b138d348256078fa634fc3b73567a7337c793e6b`; OSWorld-V2 `3d778a3c9a34a079316f70df023b166700445792`; Windows Agent Arena `6d39ed88c545a0d40a7a02e39b928e278df7332b`; MacArena `dcdc7d366da12641578ab90f085d69db91651c58`; MacAgentBench `65632d1479bfb3aa1d2d3e292628f94d1743808f`. Use published benchmark releases where available rather than treating these development revisions as release recommendations.

## Define the claim before the run

A useful comparison asks whether a bounded execution layer improves a specified set of desktop outcomes relative to a host's direct tool loop. Identify task contracts, applications, OS versions, models, tool access, permission scope, approval policies, and budgets before execution. A result on one platform does not establish parity on another.

Use relevant, authorized workflows with independently observable outcomes. Suitable checks can include a copied artifact's contents, application preference persistence, exact native field values, or an unsent draft plus no-send invariants. Prefer direct application or browser tests when those already cover the intended behavior. Do not force native automation into unrelated tasks.

For paired comparisons, use equivalent clean profiles or resettable developer-owned states. Do not replay consequential effects to manufacture a baseline. Observations from nonidentical ongoing tasks can inform applicability, but are not a controlled causal savings estimate.

Author cases with explicit initial state, goal, constraints, permitted tools, expected outcome, and forbidden effects. Keep related workflow templates and data variants in the same development or holdout split. Repeated runs estimate consistency within a template; they do not create new independent tasks. Once a holdout is exposed for tuning, treat it as regression material rather than a fresh generalization result.

## Separate the mechanisms

| Comparison | Hold constant | What it can test |
| --- | --- | --- |
| Direct calls versus bounded workflows | Host model, native backend, literals, tool access, approvals, and budget | Execution packaging and host roundtrips. Give the baseline competent batching where supported. |
| Fixed-rule versus Jev routing | The same supported observation/action choices, executor, verifier, and recovery options | Whether semantic routing justifies its additional calls. Include a no-Jev and, where useful, a cheap-router baseline. |
| Full versus compact context | Native execution semantics and task set | Representation cost and any loss of target coverage or action quality. |
| Otto versus another deployed tool | Declared task contract and measured outcomes | A product/system comparison. Different backend capabilities cannot automatically be credited to Jev. |

Keep native capability, execution authority, and provider configuration frozen within each controlled comparison. Do not give one arm hidden evaluator state, broader app scope, different approvals, or extra APIs. Return safe abstentions and unsupported tasks in the denominator instead of excluding them after the run.

## Cold and repeated work

**Cold work** starts from new task state without retained plans or learned procedures. Record provider caching where visible; do not assume caches are controlled merely because a local profile was reset.

**Repeated work** may retain a declared procedure or memory after independent state reset. Give equivalent reuse opportunities to comparison arms and charge initial preparation, failed validation, and relearning. Report the first run and repeated runs separately. Rebinding a current native target is not permission to replay old coordinates or approvals.

## Independent grading

Grade authoritative state outside the agent. Full completion, partial checkpoints, forbidden effects, safe stops, and uncertain effects are separate outcomes. An agent's finish message, a successful tool response, or its screenshot interpretation is not ground truth.

Test graders with known-good, known-bad, wrong-target, duplicate-write, and partial-result evidence. Preserve original grades when correcting a grader; report regrades separately from new executions. Use human review only for remaining visual/semantic ambiguity and retain disagreements.

Keep three evidence layers distinct: requested tool operation, native dispatch attempt, and observed postcondition. Independently established persistence or task completion is a further layer. A correct stop can pass a safety contract while still failing to complete the task.

## Usage and timing

Record all host and specialist model attempts, actual model identifiers when reported, input/output/cache/reasoning usage, retries, cancellation, errors, and unknown usage. Count observations, native dispatch attempts, host roundtrips, and human interventions. Missing responses never imply zero spend.

UTF-8 bytes, declared-tokenizer counts, provider usage, price-derived cost estimates, and billing records are separate measures. Include all failed attempts and upstream literal-generation costs in task totals, or explicitly exclude the same stage from every arm. Do not report billed savings without reconciled billing coverage.

Measure end-to-end time with human waiting separated from execution. Include failure and timeout durations and state the denominator for percentile summaries. Report paired per-task differences and uncertainty; choose sample sizes and completion margins before examining comparison results. Small runs expose dominant failures but cannot establish small efficiency gains or rare-event safety.

Measure CPU/RAM across the UI and all helpers, including OCR and any controller runtime. Candidate coverage and native acquisition time should accompany response-size measurements. A smaller response alone does not establish less work or preserved capability.

## Publication and execution boundaries

A public result needs versioned methods, source provenance, task eligibility, denominators, known failures, grading scope, and measurement limits. Publish only reviewed, non-sensitive evidence; retain raw application data and local report locations outside public artifacts.

The existing [native contract evaluation](../evaluation-native-contracts.md) and [one-pair Codex comparison](../evaluation-codex-agent-bridge.md) remain narrow historical results. They are not broad desktop reliability, Jev superiority, or current SOTA evidence. This methodology does not authorize launching evaluations, acquiring gated tasks, downloading models, or provisioning infrastructure.
