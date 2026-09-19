# Validation status

This file records observed results, not forecast capability.

- TypeSafe adapter: mocked contract/error/cancellation tests passed. Duplicate candidate data was removed from requests; live decision quality and provider-reported savings remain unmeasured.
- Automated suite: 70 tests pass across provider contracts, planning, approval, cancellation, stale snapshots, completion confirmation, privacy boundaries, usage receipts, limits, compact observations, literal preparation, and actual MCP stdio client/server communication.
- macOS: Swift helper compiled with Swift 6.3.2 and strict concurrency. A real disposable AppKit fixture passed eight native checks, including compact inspection and preparation without mutation, discovery, app isolation, consumed snapshots, exact text fill, button effects, capture/OCR geometry, and fixture exit. See [native evidence](../tests/native/RESULTS.md).
- Windows: a real WinForms fixture passed UIA discovery, exact ValuePattern text entry, InvokePattern button effects, selected-window capture, app isolation, stale/consumed snapshot rejection, and access revocation on a Windows runner. [Workflow](https://github.com/NobleSpartan6/otto/actions/runs/35188722719), [actual result](../tests/native/windows/RESULTS.json). This does not establish arbitrary-app, OCR-click, or keyboard-input compatibility.
- Local OCR: recognized text from a local UI image with bundled language data, without a remote OCR service.
- Desktop UI (2026-09-18): the actual app loaded its redesigned renderer and retained the existing connection. The production renderer/preload also passed isolated Electron fixture flows at 1280×820 and 900×660: keyboard app selection, four-app limit, search, focus trapping/restoration, consent, Hybrid setup, loading, provider/runtime errors, approval, separate completion verification, Stop, fresh recovery, and independent scrolling. Long review overflow and initial modal focus were found and fixed. These fixture transitions do not establish live model-driven task success or Windows visual QA. See the [design assessment](design/agent-workspace.md) and [reproducible fixture](../tests/ui/README.md).
- Website: rendered at 1280px and 390px with no horizontal overflow, meaningful download/developer links, working help/Escape focus restoration, and no relevant console errors.
- Developer context: eight synthetic cases measure exact UTF-8 bytes and `o200k_base` tokenizer counts with schema overhead, omissions, negative cases, and stale/error traces disclosed. These are not billed savings or completed desktop tasks. See [results and reproduction](evaluation-developer.md).
- Distribution: Mac arm64, Mac Intel, and Windows x64 installer builds passed and were published as an explicitly unsigned prerelease. The public project page was verified in the in-app browser. No signed/notarized production installer or benchmark-backed SOTA claim yet.
- Packaging: local OCR also passed from inside the packaged application's ASAR/resources layout, with bundled language data.

Update this report with actual build, native smoke, provider-backed run, and release results as they are completed.
