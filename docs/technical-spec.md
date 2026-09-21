# Otto: hybrid native computer use

## Product

Otto is an open-source macOS/Windows desktop CUA with an Electron interface and local tools for coding agents. It offers supervised model-driven tasks, reviewed exact form fills, and an executable MCP bridge. The original read-only context/preparation server also remains available. The distribution website points to source and release artifacts; it does not remotely control a visitor's computer. General reliability and SOTA require comparable task evidence, not an implementation label.

The [OCR/Jev reference](https://github.com/awlevin/typesafe-computer-use) is external architectural provenance. Otto's implementation adds native accessibility, scoped execution, separate verification, and explicit supervision; reference-project results are not Otto benchmarks.

## Architecture

- **Electron main:** owns the guided task loop, provider keys, app allowlist, approvals, budgets, and native helper lifecycle. No public or localhost control listener is exposed.
- **Sandboxed renderer:** displays app selection, task composer, actual window image, decision trace, approval, Stop, and settings through a narrow context bridge.
- **macOS helper:** Swift, AXUIElement, selected-window capture, native actions, and process/window identity checks.
- **Windows helper:** fixed bundled PowerShell/.NET UI Automation and User32 code; normal user access, no elevation or interpolated scripts.
- **Local OCR:** bundled Tesseract/English data extracts text boxes from the selected window. Native controls are preferred when they overlap recognized text targets. OCR is not arbitrary visual grounding.
- **Jev:** chooses from a bounded candidate list using the TypeSafe API. It cannot generate free text, interpret screenshots, or supply executable selectors or arbitrary action arguments.
- **Planner:** an optional GPT-6 Astra Responses adapter proposes subgoals and text at planning, uncertainty, missing-text, or recovery boundaries. Its tools are disabled. Screenshot transmission requires separate consent.
- **Reviewed fill engine:** applies supplied literal field values after an immutable human review, using native identity checks and readback without provider calls, clicks, keyboard input, or added submission actions.
- **Executable MCP bridge:** `desktop/agent-server.ts` exposes scoped inspection, single actions, bounded workflows, optional Jev delegation, and control release over local stdio. It is read-only by default; `--allow-actions` enables host-authorized action tools.
- **Read-only developer server:** `desktop/developer-server.ts` exposes compact observations and inert fill preparation. It has no execution or approval bridge into Electron.
- **Native dictation:** explicitly started microphone sessions produce an editable task draft using supported on-device speech recognition. They cannot start tasks or grant action approval.

Guided tasks, Electron reviewed fills, and MCP workflows are separate entrypoints. They share native infrastructure, not interchangeable approval tokens. See [agent bridge setup](agent-bridge.md), [read-only tools](developer-tools.md), and [current-task CLI usage](current-task-usage.md).

## Observation and action contract

Native snapshots contain a selected process/window identity, capture timestamp, bounded accessible text, supported controls, and an optional selected-window image. Controls carry opaque snapshot-scoped target IDs, native roles, labels, operations, and optional bounds. Helper-issued window/control identities support rebinding; document identity is included when available. Native handles do not leave the helper.

The executable bridge's inspection defaults to 64 controls and 4,000 free-text characters, bounded at 128 and 16,000. It reports native acquisition coverage separately from serialization truncation. An optional exact label/role query filters already-acquired native controls before the response cap; it does not expand traversal or select another window/subtree. Partial or unknown acquisition cannot establish a total match count. See [scoped discovery](scoped-discovery.md).

Agent-facing refs are single-use and expire after 30 seconds. Actions require a fresh native observation and identity checks before dispatch. The current bridge supports native press, fill, vertical scroll, and Enter/Escape/Tab. A fill checks exact native readback; press/key/scroll report dispatch only. General pointer/drag, arbitrary hotkeys, app launch, and a browser DOM adapter are not part of this bridge.

The guided Electron loop additionally enumerates activation of allowed running apps and bounded OCR press targets. OCR coordinates are derived locally from observed regions; the planner cannot invent unrestricted coordinates. Canvas and icon-only interaction remain limited.

## Guided task loop

1. Validate consent, selected apps, provider configuration, and permissions.
2. Observe the selected app and combine native controls with local OCR targets when available.
3. At a planning boundary, request a schema-validated subgoal or draft from the optional planner.
4. Construct at most 64 concrete candidates, retaining navigation and stopping choices.
5. Ask Jev to choose and reject malformed output or unknown candidate IDs.
6. Present the exact action for single-use review.
7. Revalidate the native target, dispatch once, and observe the result. Escalate or stop on insufficient progress.
8. Present evidence for human confirmation. A model's finish signal is not independent task verification.

The guided loop permits at most 20 Jev calls and five planner calls. Jev-only mode removes the planner dependency and uses supplied literal text; it is not offline inference. Stop revokes pending approval and future work and terminates the helper. It cannot undo an already-delivered native effect. Provider timeouts and ambiguous native failures do not trigger blind retries.

## Executable MCP and CLI workflows

The launcher selects one to four exact application IDs or names. Tools are `list_apps`, `inspect`, `act`, `run_steps`, `delegate`, and `release_control`; mutating tools require `--allow-actions`. The host remains responsible for task scope and any required consequential-action confirmation. Tool arguments cannot enable disabled capabilities.

`run_steps` executes 1–16 exact steps with zero model calls. All-fill workflows preflight every target, require complete native coverage, pin native identities and expected values, and recheck before each write. Optional final checks use full native values or supplied text conditions. `expected: "filled_values"` derives checks from distinct all-fill literals. No submit action, automatic rollback, or uncertain replay is added.

`delegate` uses Jev only to select among caller-supplied, single-use allowed actions. It requires explicit expected-state checks and a configured TypeSafe key. There is no hidden generative planner in the MCP worker; model confidence cannot certify completion.

The one-shot CLI uses this same bridge. Inspection refs expire when the connection closes; a later workflow reobserves and rebinds. Existing connections are not hot-patched when source changes.

## Reviewed Electron fills

Electron's separate fill workflow accepts one app and 1–16 exact field labels with literal values, at most 2,000 characters each and 16,000 total. Preparation resolves observed native editable fields, records current/proposed values and identity, and requires every mapping to resolve before review. OCR fields are not writable through this path.

Review expires after two minutes. A consumed approval starts deterministic execution, with fresh app/process, window/document, control-identity, form-shape, and expected-value checks before writes. Each fill is read back; an additional final inspection checks the requested values. Failures retain partial outcomes without automatic retry or rollback.

This path validates the returned native fields and their identity. Native readback does not by itself establish complete acquisition, and some applications reuse native controls across logical states. The workflow is not universal transactional editing. See the [reviewed fill contract](verified-fills.md).

A successful result proves the requested observed values, not external persistence or submission. An application may autosave or trigger other effects when a field changes. Zero model calls describes execution inside Otto and excludes any host cost of generating the literals.

## Ownership, privacy, and authentication

The cooperative lease coordinates participating MCP clients and Electron builds containing shared ownership support. It is not a system-wide desktop lock: older builds, other CUA tools, and human input still require coordination and native identity/focus checks. Inspect/act sequences retain ownership for up to 30 idle seconds; workflows release it on completion. Cancellation and helper termination need their own runtime validation.

BYOK keys remain in main-process memory or optional OS-backed encrypted storage, never the renderer or native helper environment. Guided observations go to configured providers; screenshots require an additional opt-in. MCP text and returned literals go to the host agent and may enter its provider context. Reviewed fills make no provider calls.

Guided exports omit raw observations and screenshots but can contain task text and action labels. Fill receipts contain reviewed/read-back values. The CLI's optional count-only JSONL receipt has a different privacy contract; see [CLI receipts](current-task-usage.md#optional-private-execution-receipt).

Dictation audio is not saved by Otto. macOS requires on-device recognition support; Windows uses installed System.Speech recognition. There is no cloud fallback. ChatGPT subscription integration is separate and unimplemented; no credential extraction or shared relay is permitted. See [subscription connection](subscription-connection.md).

## Acceptance and distribution

Keep fixture results, provider-backed tasks, platform runtime checks, and independent outcomes separate. Compare complete workflows at matched tools, task scope, approvals, and budgets. Count failures and unknown usage. Byte counts and declared-tokenizer counts are not billed savings.

Trusted publisher signing, clean-machine onboarding, broad application coverage, and general model-driven task quality require separate evidence. macOS ad-hoc signing verifies bundle integrity but is not Developer ID signing or notarization. See [validation](validation.md) and [evaluation methods](research/general-desktop-evaluation.md) for evidence boundaries.
