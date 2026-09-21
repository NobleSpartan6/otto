# Otto: a desktop worker for people and agents

Research decision, 19 September 2026. **Proposed architecture, not a claim about the current alpha.**

Otto should accept an outcome from a person or a coding agent, do the computer work, and return concise evidence of what succeeded and what remains. The same local execution service should power its clean desktop interface and its agent tools. A form fill is one useful operation inside this general system.

The strongest research question is: **can Jev decide when more observation or expensive reasoning is necessary, reducing total task cost and time without reducing completion?** Jev's role should be earned by that comparison. The product must remain useful when Jev is unavailable or the experiment rejects it.

## What the research changed

The current 64-candidate ceiling also constrains Otto's stronger planner. A model cannot choose a missing action or target. Adding a more capable model behind the same interface will leave major failures unresolved. Expand general control and recovery before optimizing the decision loop.

“Jev for computer use,” action selection, goal/stuck checks, native automation, and immutable action bindings already have close prior art in [Cua's Jev example](https://github.com/trycua/cua/tree/83f142c4290a0f7d9ed545ae8532858c6e4f8145/libs/cua-driver/examples/jev-use) and [jev-browser](https://github.com/jkudish/jev-browser). We cannot claim those combinations are new. The [source assessment](architecture-evidence.md) also covers Agent S, UI-TARS/Agent TARS, and native agent tools.

OpenAI's current [computer-use guide](https://developers.openai.com/api/docs/guides/tools-computer-use) recommends a persistent code-execution interface for GPT-6 Astra while retaining structured computer and custom function/MCP interfaces. This supports competent batching as a baseline; comparing Otto to an artificially slow screenshot-per-click loop would be misleading. On a personal desktop, model-generated code must not run inside Electron main. A constrained, isolated controller can compose only operations granted by the local broker.

## Recommended system

```mermaid
flowchart TD
    P[Person: text or voice] --> O[Otto task service]
    H[Codex or another agent] --> O
    O --> L[Goal, constraints, evidence and budget]
    L --> D[Deterministic execution when sufficient]
    L --> J[Jev: choose next observation or escalation]
    J --> N[Native controls and browser DOM]
    J --> V[Fresh image and general vision controller]
    N --> E[Scoped executor and verification]
    V --> E
    D --> E
    E --> L
    E --> R[Verified facts, unresolved work and usage]
```

- **General capability:** native AX/UIA and browser DOM controls, application launch/activation, text and keyboard chords, plus fresh screenshot-grounded pointer operations. Add drag when a real task requires it. No mandatory Jev decision after an already valid deterministic operation.
- **Selective observation:** start with relevant native state; request a subtree, browser state, crop, or full image when needed. Measure acquisition time and missed targets as well as prompt size. Jev cannot interpret screenshots; a vision-capable controller supplies that path.
- **Recovery:** distinguish missing capability, ambiguous target, stale observation, rejected response, no effect, and uncertain effect. Reobserve or ask the general controller for a new approach. Never replay an uncertain side effect automatically.
- **Execution ownership:** one executor per interactive desktop. Both UI and agent clients use the same scope, Stop, consent, and approval system. Run-scoped permission for understood local effects is a separate implementation change; consequential actions and scope expansion remain explicit decisions. Probabilities do not authorize actions.
- **Continuity:** maintain a compact ledger of constraints, verified facts, unresolved questions and failed attempts. Preserve evidence outside the model prompt. Add reusable procedures only after cold-task capability works; rebind targets and recheck preconditions each time.
- **Small footprint:** keep native execution independent of the Electron window; lazily start OCR and other expensive helpers. Use event-driven changes where reliable. Measure total helper/UI CPU, steady and peak RAM, startup time, and idle activity before describing the app as lightweight.

The agent interface could eventually expose general task submission, status and cancellation, with compact evidence retrieval. The current executable MCP bridge already provides scoped inspection, single native actions, exact `run_steps` workflows, bounded Jev selection through `delegate`, and control release. It does not yet provide the proposed general goal-driven task service; see [the current bridge contract](../agent-bridge.md). A host agent can supply general reasoning using its own supported tools and account, avoiding an additional planner subscription inside Otto. Standalone operation can use separately configured provider access. This does not turn a ChatGPT subscription into a general API key.

## The distinctive Jev experiment

Give Jev small, bounded choices such as “current evidence is enough,” “inspect this subtree,” “obtain a fresh image,” or “return to the general controller.” This tests whether Jev saves expensive reasoning and observation rather than adding a second model call to every action.

Compare the **same** execution and verification system with: (1) a competent general controller; (2) deterministic routing; (3) Jev routing; (4) a cheap general-model router. Keep models, tools, permissions, budgets and batching opportunities matched. Separately ablate Jev action selection, context reduction, and procedure reuse so their gains are not credited to the wrong component.

Remove Jev from the default path if its added latency/cost or missed escalation offsets its savings. Keep fast deterministic paths at zero model calls. A distinctive implementation is useful only if users actually finish work more reliably or efficiently.

## First real prototype and evidence

Build delegated **UI verification of a desktop application**: create an isolated editor profile, configure supplied settings through the UI, open a scratch document, reload, and verify persistence without modifying existing profiles. Inject a focus change and an unexpected dialog. This exercises a developer need, cross-step state and recovery; it is not a claim that GUI automation beats a direct configuration API.

Then use the [30-task pilot and benchmark plan](general-desktop-evaluation.md): files, documents, spreadsheets, app configuration, research/transfer and cross-app workflows, split by workflow template across Mac and Windows. Grade independently from the agent, count failures and interventions, and separate cold work from repeated procedures. Thirty tasks can select a design; they cannot establish SOTA.

The headline measurements are verified first-attempt completion, total cost per successful task including failed attempts, p50/p95 time, host roundtrips, interventions and memory/CPU. Report actual provider usage and unknown amounts; use billing evidence before claiming billed savings. Hold completion quality to a predeclared margin, then size a larger locked comparison from pilot variance. Published OSWorld, Mac and Windows benchmarks require their own pinned environments, task contracts and comparable tool access.

A defensible future claim would identify the tested systems and task set: **“Otto reduced cost and completion time on these Mac/Windows workflows while preserving verified completion within the declared margin.”** The numerical claim comes after the run. Neither this design, the existing form fixture, nor a selected demo establishes market-wide SOTA or novelty across X.

## Consultation and decisions

[GPT-6 Pro in the Otto project](https://chatgpt.com/g/g-p-6aab76ef83348191ba1a4f34ed604089-otto/c/6aab7709-8e24-83ea-acd3-ffb85c655d28) was consulted on this direction. Accepted: general capability first; optional Jev acceleration; a cheap-router baseline; bounded controller code outside Electron main; independent verification; meaningful task-level delegation. Deferred: automatic learned procedure reuse and broad autonomy until the general controller and shared permission broker are proven.

The exact Koala reference remains unconfirmed. No feature comparison against an assumed product is used in this decision.

Follow-up: [Prime RLM fit assessment](prime-rlm.md) proposes an optional context-processing worker and a separate Jev/RLM ablation. This extends the research plan; it does not change the current execution architecture.
