# Execution-layer architecture options

Technical rationale and research hypotheses. Proposed capabilities below are not claims about the current alpha; the [agent bridge contract](../agent-bridge.md) describes the implemented interface.

## Existing boundary

Otto's executable MCP bridge provides scoped inspection, single native actions, exact `run_steps` workflows, bounded Jev selection through `delegate`, and control release. A host agent supplies task reasoning and authorization. The original read-only context/preparation server remains a separate interface. Electron provides supervised guided tasks and reviewed native fills.

A useful execution layer returns concise facts about completed checks, unresolved work, and uncertain effects. A general goal-driven task service would extend this boundary, but is not currently implemented. A deterministic form fill is one reusable operation, not evidence of general task capability.

## Prior art and capability limits

Jev action selection, native automation, immutable candidate bindings, and independent outcome checks have close prior art in [Cua's Jev example](https://github.com/trycua/cua/tree/83f142c4290a0f7d9ed545ae8532858c6e4f8145/libs/cua-driver/examples/jev-use) and [jev-browser](https://github.com/jkudish/jev-browser). These combinations are not established novelty. The [source comparison](architecture-evidence.md) also covers Agent S, UI-TARS/Agent TARS, and native agent tools.

The guided controller selects from bounded, pre-enumerated candidates. A stronger model behind the same interface cannot select an absent target or unsupported action. Broader control coverage, reliable target discovery, and recovery are separate engineering problems from cheaper selection.

OpenAI's [computer-use guide](https://developers.openai.com/api/docs/guides/tools-computer-use) describes code-execution, structured computer, and custom function/MCP interfaces. A fair baseline should permit competent batching and context reuse rather than artificially requiring a screenshot and model call for every click. Model-generated code must not execute inside Electron main; any controller runtime needs a constrained bridge to authorized operations.

## Candidate architecture boundaries

| Boundary | Responsibility | Status and constraint |
| --- | --- | --- |
| Native execution | Observe, bind, dispatch, and report evidence | Implemented through AX/UIA; scope, freshness, and uncertain-effect stops remain authoritative. |
| Deterministic workflows | Execute bounded supplied operations and explicit checks | Implemented through `run_steps` and the separate reviewed-fill engine. No mandatory model call. |
| Jev decisions | Select among grounded options | Implemented in guided tasks and bounded delegation. Probabilities are not authorization or verification. |
| General controller | Plan, author text, interpret unfamiliar visual state, and recover | A bounded optional planner exists; a general tool-executing vision controller does not. |
| Selective observation | Choose native state, narrower scope, image evidence, or further reasoning | Response filtering exists; matching-aware native traversal and adaptive routing remain separate proposals. |
| Reusable procedures | Rebind and verify repeated workflows | A research option, not coordinate replay or inherited approval. |

Model-independent executor contracts make it possible to evaluate a new driver or planner without replacing authorization, cancellation, or evidence semantics. A backend's successful response cannot be promoted to exact verification unless it supplies the required evidence.

Observation acquisition and serialization should be measured separately. A short response can still require an expensive full native walk or OCR pass. Target coverage must accompany any payload-size comparison. Historical observations may support reasoning but never substitute for fresh action bindings.

Both host-delegated and direct-use workflows need one coordinated desktop executor. Concurrent reasoning is different from concurrent mutation of the same desktop. Run-scoped permissions, wider app scope, and new input operations are explicit contract changes, not side effects of a UI redesign.

## Optional Jev routing hypothesis

Can Jev decide when additional observation or expensive reasoning is necessary, reducing total task cost or time without reducing independently checked completion?

A candidate router could choose among supported, bounded operations such as using current evidence, requesting a narrower observation, acquiring consented image evidence, or returning to the host. It must not call a model where a deterministic coverage or freshness failure already determines the next safe step. It cannot grant permission, establish uniqueness from incomplete data, or certify task success.

Compare the same executor and verification system with a competent general controller, deterministic routing, Jev routing, and a cheap general-model router. Match models, tools, permissions, budgets, and batching opportunities. Separately ablate action selection, context representation, and procedure reuse so gains are not credited to the wrong component.

Keep Jev optional when its added cost, latency, or missed escalation offsets any benefit. Zero-model exact workflows should remain usable without a provider. A useful product must retain its core execution contract when an optional model is unavailable.

## Evaluation boundary

Use authorized developer workflows with independent outcome checks, such as validating native settings persistence in a disposable application profile. This evaluates UI behavior, not whether GUI automation is preferable to a direct configuration API. Keep existing profiles and unrelated state protected; scope recovery to fresh observations after focus changes or unexpected dialogs.

The [evaluation methodology](general-desktop-evaluation.md) describes comparable tools, permissions, graders, usage, and cold/repeated-task accounting. It does not schedule a pilot or authorize native/provider runs. Existing authored fixtures are regression material, not broad adoption or general reliability evidence.

A comparative claim must identify the task set, revisions, models, tool access, approval policy, measured outcomes, and uncertainty. Report failed attempts and missing usage. There is no general SOTA or billed-savings claim established by this architecture.

The [RLM assessment](prime-rlm.md) considers an optional context-processing worker for longer tasks. Context processing does not supply missing native actions or alter the current execution boundary.
