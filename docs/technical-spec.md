# Otto: hybrid native computer use

## Product

Otto is an open-source macOS/Windows desktop CUA for general tasks. The distribution website points to source and release artifacts; it does not remotely control a visitor's computer. A successful launch requires credible full-task demonstrations, reliable recovery, and measured completion quality. SOTA is a benchmark claim, not an implementation label.

The design was reviewed with [GPT-6 Pro in the Otto project](https://chatgpt.com/g/g-p-6aab76ef83348191ba1a4f34ed604089-otto/c/6aab7709-8e24-83ea-acd3-ffb85c655d28). The final direction expands the [OCR/Jev reference](https://github.com/awlevin/typesafe-computer-use) with native accessibility, cross-app state, selective planning, explicit supervision, and testable outcomes.

## Architecture

- **Electron main:** owns the task loop, provider keys, app allowlist, approvals, budgets, and native helper lifecycle. No public or localhost control server.
- **Sandboxed renderer:** displays app selection, task composer, actual window image, decision trace, approval, Stop, and settings through a narrow context bridge.
- **macOS helper:** Swift 6, AXUIElement, selected-window capture, native actions, process/window identity checks.
- **Windows helper:** fixed bundled PowerShell/.NET UI Automation and User32 code; standard user access, no elevation or interpolated scripts.
- **Local OCR:** bundled Tesseract/English model extracts text boxes from only the selected window. Accessibility controls win when they overlap a recognized text target.
- **Jev:** chooses from a bounded, concrete candidate list using the documented TypeSafe API. It never supplies executable selectors or arbitrary arguments.
- **Planner:** GPT-6 Astra through the official Responses API supplies subgoals and text drafts at initial planning, uncertainty, missing text, or recovery boundaries. Screenshot input requires separate consent.

The stronger model is not invoked for every routine click. A cached subgoal guides successive Jev decisions, with hard call/action budgets. Jev-only mode removes planner dependency and uses literal user-provided text.

## Observation and action contract

The helper sends an opaque snapshot ID, selected process/window identity, capture timestamp, bounded accessible text, supported controls, and optional selected-window image. Each control has an opaque target ID, native role, readable label, allowed operations, and optional bounds. Native handles never leave the helper.

Candidates use explicit app IDs and snapshot-bound targets. Supported actions are native press, fill, scroll, activate, bounded keyboard input, completion request, and blocked. OCR candidates map in the trusted main process to observed positions; the planner cannot choose unconstrained coordinates. Future icon/canvas grounding must preserve this target validation boundary.

## Execution loop

1. Validate task consent, selected apps, provider configuration, and permissions.
2. Observe the selected app; fuse native controls with OCR text targets.
3. On a planning boundary, ask the planner for a schema-validated subgoal or draft.
4. Construct and rank at most 64 concrete actions. Keep navigation and stopping options available.
5. Ask Jev to choose; reject malformed output or unknown IDs.
6. Present exact action approval in Guided mode. Approvals are single-use and expire with the observation.
7. Revalidate the native target and dispatch once. Observe again; detect no progress and escalate or stop.
8. Present the final evidence for human confirmation. A model's finish signal is not verified task success.

One active task avoids conflicting cursor/focus owners. Stop cancels inference, revokes pending approval, invalidates the run generation, and terminates the helper. Provider timeouts and ambiguous OS errors do not trigger blind retries.

## Privacy and auth

BYOK keys live in main-process memory or optional OS-backed encrypted storage. Selected accessibility text goes to TypeSafe; hybrid observations go to OpenAI; screenshots require an additional opt-in. Local traces omit raw app text/images by default. No inherited model secrets are passed to native helpers.

ChatGPT subscription sign-in is a separate future local integration using official managed authentication. A website OAuth button cannot turn subscription access into general API credits. No token extraction or shared credential relay is permitted.

## Acceptance

Run the same held-out tasks with Otto Hybrid, Otto Jev-only, the reference prototype, and a strong vision-only baseline. Measure task completion, time to verified outcome, API spend per successful task, intervention count, unsafe actions, and recovery success. Compare complete workflows—not just one cheap model decision. Publish actual failure cases and platform coverage.

Before broad distribution: Windows runtime smoke tests, signed/notarized installers, provider-backed E2E runs, clean-machine permission onboarding, stale-target/focus/stop tests, and benchmark results. The current development alpha uses approval on every action; faster autonomous navigation requires an explicit tested policy, not a model's safety assurance.
