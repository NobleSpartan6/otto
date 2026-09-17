# Reference architecture: TypeSafe computer use

Reviewed 2026-09-17. Reference: [Aaron Levin's thread](https://x.com/awlevin/status/2100281322208215297) and [`awlevin/typesafe-computer-use`, commit `7d120f1`](https://github.com/awlevin/typesafe-computer-use/tree/7d120f1944d0156773d5089b81f8e46d108a6c8d). Repository code was read, not executed. Findings below describe that revision; recommendations describe work for Otto, not verified release capabilities.

## What the reference actually does

It is a native macOS Python agent with screenshot OCR and synthetic input. It does not use Playwright, a DOM, a full accessibility-tree candidate set, or a frontier vision model in its main implementation. A separate browser-backend pull request is [open, not merged](https://github.com/awlevin/typesafe-computer-use/pull/4).

| Stage | Implementation |
| --- | --- |
| Capture | `screencapture -D 1` captures the main display. Quartz supplies the Retina pixel-to-point scale. AppleScript supplies the frontmost app and browser URL. Accessibility supplies only the focused field's role, label, placeholder, value, and frame. |
| OCR | `ocrmac` invokes Apple Vision's accurate recognizer. It discards confidence below 0.3, filters text echoing the user's goal, merges aligned adjacent lines, orders blocks by rows, and caps candidates at 255. |
| Context | Current time, recent eight actions, screen text, coarse 3×3 spatial regions, focused field, and deterministic date offsets. Date hints also attach to nearby lines. |
| Decision | One TypeSafe `system_one` request contains separate Choice questions for action kind, OCR item, and catalog website. The item question is omitted when there are no blocks. |
| Execution | Quartz clicks the chosen OCR block's center or synthesizes keys/text/scroll; AppleScript activates the browser or opens a URL. |

Sources: [macOS adapter](https://github.com/awlevin/typesafe-computer-use/blob/7d120f1944d0156773d5089b81f8e46d108a6c8d/typesafe_computer_use/macos.py), [perception](https://github.com/awlevin/typesafe-computer-use/blob/7d120f1944d0156773d5089b81f8e46d108a6c8d/typesafe_computer_use/perception.py), [dates](https://github.com/awlevin/typesafe-computer-use/blob/7d120f1944d0156773d5089b81f8e46d108a6c8d/typesafe_computer_use/dates.py), [decisions](https://github.com/awlevin/typesafe-computer-use/blob/7d120f1944d0156773d5089b81f8e46d108a6c8d/typesafe_computer_use/decide.py).

The code does not explicitly select a Jev version; it calls the TypeSafe SDK's default `system_one` model. The README identifies that decision model as Jev. An optional Anthropic writer defaults to `claude-haiku-4-5`, configurable with `CLICKER_WRITER_MODEL`. It receives text and field metadata, not screenshots. It generates a structured text-fill proposal or a URL outside the eight-site catalog. Without writer credentials, those actions are refused; low Jev confidence stops the run rather than automatically invoking a stronger planner. Preset email entry is separate. [Writer](https://github.com/awlevin/typesafe-computer-use/blob/7d120f1944d0156773d5089b81f8e46d108a6c8d/typesafe_computer_use/writer.py), [configuration](https://github.com/awlevin/typesafe-computer-use/blob/7d120f1944d0156773d5089b81f8e46d108a6c8d/typesafe_computer_use/config.py).

After generated text is typed, a further TypeSafe Noul evaluates the result; under 0.5 the implementation clears the focused field. Click confidence is the minimum of kind/item confidence, while site confidence is not included in the gate. Default stopping conditions include confidence below 0.4, two consecutive no-ops, or twelve steps. The runner waits two seconds after each performed step by default. [Actions](https://github.com/awlevin/typesafe-computer-use/blob/7d120f1944d0156773d5089b81f8e46d108a6c8d/typesafe_computer_use/actions.py), [runner](https://github.com/awlevin/typesafe-computer-use/blob/7d120f1944d0156773d5089b81f8e46d108a6c8d/typesafe_computer_use/runner.py).

## What the performance claims establish

These are the author's reported figures for a same-screenshot, same-goal comparison, not an independently reproduced benchmark:

| Quantity | Jev | Baseline named in README | Interpretation |
| --- | --- | --- | --- |
| Single decision cost | ~$0.0002 | ~$0.032 | Rounded arithmetic is 160×; README claims 155×. Exact unrounded billing is absent. |
| Model latency | 0.13–0.38 s | 5.2 s | Roughly 14–40×; a 20× headline refers to this layer. |
| Step including capture/OCR | ~1.5 s | ~5.5 s | About 3.7×, not 20×. |
| Twelve-step task cost | ~$0.003 | ~$0.40–$0.90 | Task totals, not per-decision prices. $0.003 versus $0.50 would be ~167×. |

The README names its baseline “Claude Opus 5.” That identity and its pricing are not independently verified here. It acknowledges that the larger model interpreted event dates itself while Jev needed deterministic date enrichment. [Reported comparison](https://github.com/awlevin/typesafe-computer-use/blob/7d120f1944d0156773d5089b81f8e46d108a6c8d/README.md#why).

The repository has no paired benchmark harness, raw comparison billing records, success-rate dataset, or per-provider cost accounting. Calls discard usage metadata; run summaries record total duration and actions. Writer calls and verification calls therefore need separate accounting in Otto. The configured two-second settle delay also makes the headline step timing ambiguous as a measure of continuous-run wall time. Do not market these ratios as Otto results.

## Tests and practical limits

There are 19 pure-logic test functions for configuration, URL validation, dates, block merging/ordering/filtering, and decision/state construction. The reviewed revision's [macOS CI run succeeded](https://github.com/awlevin/typesafe-computer-use/actions/runs/35130618195); this inspection did not rerun it. Tests do not demonstrate live desktop task completion, Windows support, provider billing, cancellation during native calls, or robustness across screen layouts. [Tests](https://github.com/awlevin/typesafe-computer-use/tree/7d120f1944d0156773d5089b81f8e46d108a6c8d/tests), [CI](https://github.com/awlevin/typesafe-computer-use/blob/7d120f1944d0156773d5089b81f8e46d108a6c8d/.github/workflows/ci.yaml).

Code-level limits relevant to Otto:

- OCR text is not evidence that a region is clickable. Icon-only controls are missing; duplicate labels split probability. [Issue #3](https://github.com/awlevin/typesafe-computer-use/issues/3) describes this on Wikipedia; [issue #2](https://github.com/awlevin/typesafe-computer-use/issues/2) requests accessibility-tree support.
- Whole-display capture and global input can include unrelated windows or act on changed focus. The original adapter does not bind a coordinate to a selected application's current window and snapshot.
- Date-neighbor hints use vertical proximity without a column constraint, which can associate the wrong date with a neighboring card. This is an inference from `dates.py`.
- `run.json` is not a trustworthy success label: `RunState.outcome` defaults to `completed`, and low-confidence, `none`, and dry-run exits do not replace it. This follows directly from `runner.py`.
- Raw screenshots, focused values, and full payloads are saved by default. Otto should make capture retention/export explicit and redact sensitive fields.

## What Otto should reuse and improve

Keep the central idea: construct a bounded set of concrete actions locally and let Jev select among them. Reuse the separation of perception, decision, action, and verification; local OCR; contextual time/date facts; and replayable diagnostics. Preserve the upstream copyright and license if copying or adapting code: the project is [MIT, copyright 2026 Aaron Levin](https://github.com/awlevin/typesafe-computer-use/blob/7d120f1944d0156773d5089b81f8e46d108a6c8d/LICENSE). This report has not copied implementation code into Otto.

Recommended design:

1. **Native controls first, local OCR when needed.** Merge AX/UIA controls with OCR boxes from the selected window. Prefer a native control when geometry and text match. Keep provenance, nearby labels, parent context, and geometry so distinct same-name controls remain distinguishable.
2. **Two explicit modes.** Jev-only uses native/OCR observations, deterministic transforms, and literal user-provided text; if text must be invented, ask the user or stop. Hybrid adds a bounded writer/recovery model. Its output remains a proposal checked against the same allowlist, snapshot, and approval rules. No silent provider fallback.
3. **Coordinate fallback with native ownership checks.** Map OCR IDs to coordinates only in trusted local code. Verify selected process/window, capture dimensions, unchanged geometry, snapshot lifetime, foreground ownership, point ownership, and a fresh local image patch before clicking. Consume the snapshot once and never retry an uncertain click automatically.
4. **Verification and measurement.** Capture after effects; distinguish success, blocked, uncertain, canceled, and step limit. Record OCR, each model call, action, settling, verification, token usage, and estimated billed cost separately. Evaluate real macOS and Windows tasks with duplicate labels, scaled displays, app switching, empty accessibility trees, and stale screens before publishing performance claims.

## Windows OCR choice

`Windows.Media.Ocr.OcrEngine` provides local recognition and word rectangles, installed-language discovery, and a maximum-image-size property. However, Microsoft lists the OCR classes among desktop APIs requiring package identity. An unpackaged PowerShell helper inside a conventional Electron installer should not assume this API is universally available. It is a candidate for a later packaged native helper with explicit Windows validation. [OcrEngine](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine?view=winrt-26100), [desktop API restrictions](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/winrt-api-desktop-app-support).

For the present Electron distribution, use bundled Tesseract.js assets as the predictable cross-platform local OCR path. The registry reports version 7.0.0 at review time. Reuse a warm worker, explicitly enable block/box output, and package language data, worker code, and WASM locally; default language paths may otherwise download data from a CDN. Keep OCR off the UI thread, report unavailable languages plainly, and benchmark its accuracy/latency on actual app screenshots. It recognizes text, not arbitrary icon semantics. [Tesseract.js](https://github.com/naptha/tesseract.js), [local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md), [API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md).
