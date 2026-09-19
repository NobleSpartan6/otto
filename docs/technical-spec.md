# Otto: hybrid native computer use

## Product

Otto is an open-source macOS/Windows desktop CUA. It offers supervised model-driven tasks, reviewed exact form fills, and a read-only MCP interface for coding agents. The distribution website points to source and release artifacts; it does not remotely control a visitor's computer. A successful launch requires credible full-task demonstrations, reliable recovery, and measured completion quality. SOTA is a benchmark claim, not an implementation label.

The design was reviewed with [GPT-6 Pro in the Otto project](https://chatgpt.com/g/g-p-6aab76ef83348191ba1a4f34ed604089-otto/c/6aab7709-8e24-83ea-acd3-ffb85c655d28). The final direction expands the [OCR/Jev reference](https://github.com/awlevin/typesafe-computer-use) with native accessibility, cross-app state, selective planning, explicit supervision, and testable outcomes.

## Architecture

- **Electron main:** owns the task loop, provider keys, app allowlist, approvals, budgets, and native helper lifecycle. No public or localhost control server.
- **Sandboxed renderer:** displays app selection, task composer, actual window image, decision trace, approval, Stop, and settings through a narrow context bridge.
- **macOS helper:** Swift 6, AXUIElement, selected-window capture, native actions, process/window identity checks.
- **Windows helper:** fixed bundled PowerShell/.NET UI Automation and User32 code; standard user access, no elevation or interpolated scripts.
- **Local OCR:** bundled Tesseract/English model extracts text boxes from only the selected window. Accessibility controls win when they overlap a recognized text target.
- **Jev:** chooses from a bounded, concrete candidate list using the documented TypeSafe API. It never supplies executable selectors or arbitrary arguments.
- **Planner:** GPT-6 Astra through the official Responses API supplies subgoals and text drafts at initial planning, uncertainty, missing text, or recovery boundaries. Screenshot input requires separate consent.
- **Reviewed fill engine:** applies a supplied literal field map after one immutable human review. It uses native identity checks and readback without provider calls, clicks, keyboard input, or submission actions.
- **MCP stdio server:** exposes scoped compact observations and inert literal fill preparation. It has no execution or approval bridge into the desktop app.
- **Native dictation:** explicitly started microphone sessions produce an editable task draft using supported on-device speech recognition. They never start tasks or grant action approval.

In guided tasks, the stronger model is not invoked for every routine click. A cached subgoal guides successive Jev decisions, with hard call/action budgets. Jev-only mode removes planner dependency and uses literal user-provided text. Reviewed fills are a separate bounded workflow, not an autonomous setting for the guided agent.

## Observation and action contract

The helper sends an opaque snapshot ID, selected process/window identity, capture timestamp, bounded accessible text, supported controls, and optional selected-window image. Each control has an opaque target ID, native role, readable label, allowed operations, and optional bounds. Stable helper-issued window and native control identity tokens support rebinding across fresh observations; a document token is included when available. Native handles never leave the helper. Missing identity tokens block reviewed fills.

Candidates use explicit app IDs and snapshot-bound targets. Supported actions are native press, fill, scroll, activate, bounded keyboard input, completion request, and blocked. OCR candidates map in the trusted main process to observed positions; the planner cannot choose unconstrained coordinates. Future icon/canvas grounding must preserve this target validation boundary.

## Guided task loop

1. Validate task consent, selected apps, provider configuration, and permissions.
2. Observe the selected app; fuse native controls with OCR text targets.
3. On a planning boundary, ask the planner for a schema-validated subgoal or draft.
4. Construct and rank at most 64 concrete actions. Keep navigation and stopping options available.
5. Ask Jev to choose; reject malformed output or unknown IDs.
6. Present exact action approval. Approvals are single-use and expire with the observation.
7. Revalidate the native target and dispatch once. Observe again; detect no progress and escalate or stop.
8. Present the final evidence for human confirmation. A model's finish signal is not verified task success.

One active task avoids conflicting cursor/focus owners. Stop cancels inference, revokes pending approval, invalidates the run generation, and terminates the helper. Provider timeouts and ambiguous OS errors do not trigger blind retries. The guided loop allows at most 20 Jev calls and five planner calls; a final model signal still requires human confirmation.

## Reviewed exact fills

The user supplies one app and a map of exact native field labels to literal values: at most 16 fields, 2,000 characters per value, and 16,000 characters total. Preparation reads the form without mutation. Every target must resolve uniquely to an enabled, non-sensitive native editable control with a readable current value and a stable identity. OCR targets cannot be filled. Any unresolved mapping blocks the entire preparation.

The immutable review contains current and proposed values and expires after two minutes. A single-use approval starts deterministic execution. Before the first write and each subsequent write, the engine obtains a fresh observation and checks the app/process, window, available document identity, native control identities, form shape, and all requested fields' expected values. Each write uses a fresh snapshot-bound target and is followed by exact native readback. An additional whole-batch readback is required before completion.

No model request or submit action is issued. The target app may still autosave or produce other effects when a field changes. The receipt records attempted native actions, observations, and zero model calls; this excludes any upstream cost of generating the supplied values. A failure or Stop halts the remaining edits and records verified, uncertain, and unattempted fields without automatic retry or rollback. Completion proves the final requested native values, not persistence or external submission.

Native identity does not prove every logical document state: some apps reuse controls or expose incomplete accessibility information. This workflow is for stable, visible forms, not universal transactional editing. See the [exact contract and user flow](verified-fills.md).

## Privacy and auth

BYOK keys live in main-process memory or optional OS-backed encrypted storage. Guided tasks send selected accessibility text to TypeSafe; hybrid observations go to OpenAI; screenshots require an additional opt-in. Reviewed fills make no provider calls. MCP observations and preparation values go to the host agent, which may send them to its provider. No inherited model secrets are passed to native helpers.

Guided-task exports omit raw app observations and screenshots, but goals and action labels may contain user data. Fill receipts contain reviewed and read-back values. Dictation audio remains in memory and is not saved; macOS requires on-device recognition support, and Windows uses installed System.Speech recognition. There is no cloud-recognition fallback. The transcript becomes editable draft text and follows normal task consent when the user starts a task.

ChatGPT subscription sign-in is a separate future local integration using official managed authentication. A website OAuth button cannot turn subscription access into general API credits. No token extraction or shared credential relay is permitted.

## Acceptance

Run the same held-out tasks with Otto Hybrid, Otto Jev-only, the reference prototype, and a strong vision-only baseline. Measure task completion, time to verified outcome, API spend per successful task, intervention count, unsafe actions, and recovery success. Compare complete workflows—not just one cheap model decision. Publish actual failure cases and platform coverage.

Before broad distribution: broader platform/app runtime tests, trusted publisher signing and macOS notarization, provider-backed E2E runs, clean-machine permission onboarding, and benchmark results. macOS release packaging uses ad-hoc integrity signing with strict bundle verification; it does not establish a trusted publisher. See [observed validation](validation.md) for completed checks and remaining limits.

The guided agent requires approval for every native action. Reviewed fills instead authorize an exact, bounded field set once and verify each write. Faster autonomous general navigation remains outside this policy.
