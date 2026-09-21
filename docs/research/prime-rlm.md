# Prime RLM fit for Otto

Research assessment, 19 September 2026. This is a proposed experiment; no Prime runtime has been installed or integrated.

**Recommendation: evaluate RLM as an optional context-processing worker for longer tasks, and support Prime Agent as another client of Otto's eventual execution interface.** First establish general desktop control and recovery. RLM addresses context processing and decomposition; it does not supply missing native actions or visual grounding.

## What it contributes

[Prime Agent](https://www.primeintellect.ai/blog/prime-agent) implements RLM through a persistent Python environment with programmatic access to context and child agents. It is an agent harness around language models, rather than a replacement model. Its continual refinement of memories and skills is a separate feature; adopting RLM does not require adopting automatic self-modification.

For Otto, retain task evidence as scoped, versioned data and let a capable model search, filter, calculate over, and selectively delegate portions of it. A useful case is reconciling several documents and application observations before updating a workbook. Routine short desktop interactions should continue through the existing controller and execution paths.

The original [RLM paper](https://arxiv.org/html/2512.24601v2) reports benefits on long-context tasks, but also weaker results at smaller input sizes, variable costs with expensive outliers, and substantial runtime dependence on sub-call execution. Those results do not establish faster or cheaper Mac/Windows computer use.

## Relationship to Jev

The proposed responsibilities are complementary:

| Component | Responsibility |
| --- | --- |
| Native/DOM executor | Perform scoped actions and obtain fresh evidence |
| Jev | Bounded semantic routing: continue, acquire more evidence, or escalate |
| General controller | Understand unfamiliar screens, plan, generate text, and recover |
| Optional RLM worker | Process a large body of task evidence and decompose reasoning into bounded subproblems |

One research hypothesis is that Jev can help determine when recursive reasoning is worth its overhead. Another is replacing suitable closed-set RLM leaf judgments with Jev while retaining a generative model for synthesis. Test these separately; do not attribute an RLM improvement automatically to Jev.

An RLM worker should return evidence references, conclusions and proposed next steps. Older observations remain historical evidence; any resulting desktop action needs a fresh target binding. Parallel reasoning is compatible with one serialized desktop executor. Subagents must not independently compete for the same mouse, window or approval.

## Integration choice

In **agent-delegated use**, Prime Agent, Codex or another host can own complex reasoning and call Otto for bounded desktop work. An additional full agent harness inside Otto may duplicate that host's context and orchestration. Otto's current MCP is read-only inspection/preparation, so general execution delegation still requires the broker described in [Otto's direction](otto-direction.md).

In **standalone use**, a lazily started, separately isolated RLM worker is a candidate for large-context work. It receives only scoped evidence and a bounded model-call interface, with a shared deadline, cancellation and total spend limits. All native effects continue through Otto's broker. Prime's current [README](https://github.com/PrimeIntellect-ai/prime-agent) explicitly distinguishes process lifecycle isolation from a security sandbox; its ordinary Python/project commands execute with user permissions. A separate child process alone is insufficient isolation for untrusted screen content.

Source review pinned Prime Agent at [`63d88319`](https://github.com/PrimeIntellect-ai/prime-agent/commit/63d88319bf5870cf609fef01f9042bbf431d7df2). Its [SDK](https://github.com/PrimeIntellect-ai/prime-agent/blob/63d88319bf5870cf609fef01f9042bbf431d7df2/packages/coding-agent/docs/sdk.md) supports headless agent sessions, but still brings the full harness and Python runtime. The Python `prime-agent-runtime` package is a host bridge, not a standalone inference engine. Default installation targets macOS/Linux; an Otto-ready Windows distribution has not been established. Reusing the design and integrating the complete Prime Agent product are separate decisions.

Do not interpret preserved context as perfect recall or old screenshots as live state. Do not permit learned memories or skills to rewrite execution permissions or completion checks.

## Experiment

Hold the base model, tools, execution policy, context budget and task set fixed. Compare the general controller with: neither addition; Jev only; RLM only; both. Here “Jev only” means the controller plus Jev, not Otto's existing TypeSafe-only product mode. Give the non-RLM baseline competent retrieval, batching and a compact task ledger.

Separate short UI jobs, long cross-app workflows, and large-artifact analysis. Count every child model call, failed attempt, context read, screenshot, kernel startup and worker's RAM/CPU. Compare independently verified completion, false completion, interventions, total cost and p50/p95 duration. Bound depth, fan-out and total tokens globally across children; local per-child limits do not bound the whole run.

Adopt RLM only for the slices where it offers a measurable quality/efficiency improvement. A smaller parent prompt by itself is not evidence of lower total cost. This experiment does not establish novelty or SOTA.
