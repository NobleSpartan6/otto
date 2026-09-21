# Prime RLM fit for Otto

Research assessment, 19 September 2026. This is a proposed experiment; no Prime runtime has been installed or integrated.

RLM is a candidate context-processing worker for longer tasks. It addresses decomposition and evidence processing; it does not supply missing native actions, authorization, or visual grounding. A host can use Otto's existing executable bridge without embedding another full agent harness inside Otto.

## What it contributes

[Prime Agent](https://www.primeintellect.ai/blog/prime-agent) implements RLM through a persistent Python environment with programmatic access to context and child agents. It is an agent harness around language models, rather than a replacement model. Its continual refinement of memories and skills is a separate feature; adopting RLM does not require adopting automatic self-modification.

A controller could retain task evidence as scoped, versioned data, then search, filter, calculate over, and selectively delegate portions of it. Reconciling several documents and application observations before updating a workbook is a candidate workload. Routine short desktop interactions should remain on the existing controller and execution paths.

The original [RLM paper](https://arxiv.org/html/2512.24601v2) reports benefits on long-context tasks, but also weaker results at smaller input sizes, variable costs with expensive outliers, and substantial runtime dependence on sub-call execution. Those results do not establish faster or cheaper Mac/Windows computer use.

## Relationship to Jev

The proposed responsibilities are complementary:

| Component | Responsibility |
| --- | --- |
| Scoped executor | Perform permitted actions and obtain fresh evidence |
| Jev | Bounded semantic routing or grounded action selection |
| General controller | Plan, generate text, interpret unfamiliar state, and recover |
| Optional RLM worker | Process a large body of task evidence and decompose reasoning into bounded subproblems |

One research hypothesis is that Jev can help determine when recursive reasoning is worth its overhead. Another is replacing suitable closed-set RLM leaf judgments with Jev while retaining a generative model for synthesis. Test these separately; do not attribute an RLM improvement automatically to Jev.

An RLM worker should return evidence references, conclusions, and proposed next steps. Older observations remain historical evidence; any resulting desktop action needs a fresh target binding. Parallel reasoning is compatible with one serialized desktop executor. Subagents must not independently compete for the same mouse, window, or approval.

## Integration boundary

In **agent-delegated use**, Prime Agent, Codex, or another host can own complex reasoning and call Otto for bounded desktop work. The executable MCP bridge already provides scoped `inspect`, `act`, `run_steps`, optional `delegate`, and `release_control`; action tools require explicit launcher permission and host task authorization. The original read-only `developer-server` remains separate. See [the agent bridge contract](../agent-bridge.md). A general goal-driven task service and a Prime integration are not implemented.

In **standalone use**, a lazily started, separately isolated RLM worker is a candidate for large-context work. It would receive only scoped evidence and a bounded model-call interface, with shared deadlines, cancellation, and total spend limits. All native effects must continue through the executor. Prime's [README](https://github.com/PrimeIntellect-ai/prime-agent) distinguishes process lifecycle isolation from a security sandbox; a separate child process alone is insufficient isolation for untrusted application content.

Source review pinned Prime Agent at [`63d88319`](https://github.com/PrimeIntellect-ai/prime-agent/commit/63d88319bf5870cf609fef01f9042bbf431d7df2). Its [SDK](https://github.com/PrimeIntellect-ai/prime-agent/blob/63d88319bf5870cf609fef01f9042bbf431d7df2/packages/coding-agent/docs/sdk.md) supports headless sessions but still brings the full harness and Python runtime. The Python `prime-agent-runtime` package is a host bridge, not a standalone inference engine. At that revision, default installation targeted macOS/Linux; an Otto-ready Windows distribution was not established. Reusing the design and integrating the complete product are different decisions.

Preserved context is not perfect recall, and old screenshots are not live state. Learned memories or skills must not rewrite execution permissions or completion checks.

## Evaluation

Hold the base model, tools, execution policy, context budget, and task set fixed. Compare the controller with neither addition, Jev only, RLM only, and both. Here “Jev only” means the controller plus Jev, not Otto's TypeSafe-only product mode. Give the non-RLM baseline competent retrieval, batching, and a compact task ledger.

Separate short UI jobs, long cross-app workflows, and large-artifact analysis. Count every child model call, failed attempt, context read, screenshot, kernel startup, and worker's RAM/CPU. Compare independently verified completion, false completion, interventions, total cost, and p50/p95 duration. Bound depth, fan-out, and total tokens globally across children; per-child limits do not bound the whole run.

Adopt an RLM path only for workloads where it provides a measured benefit. A smaller parent prompt alone is not lower total cost. This assessment establishes neither novelty nor SOTA and does not authorize an experiment. See the [evaluation methodology](general-desktop-evaluation.md) for evidence requirements.
