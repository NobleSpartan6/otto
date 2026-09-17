# Validation status

This file records observed results, not forecast capability.

- TypeSafe adapter: mocked contract/error/cancellation tests passed; live API execution awaits a configured user key.
- Native task engine: 57 tests pass across provider contracts, planning, approval, cancellation, stale snapshots, completion confirmation, privacy boundaries, usage receipts, and limits.
- macOS: Swift helper compiled with Swift 6.3.2 and strict concurrency. A real disposable AppKit fixture passed seven native checks: discovery, app allowlist, consumed snapshots, exact text fill, button effect, selected-window capture, and local OCR geometry. See [native evidence](../tests/native/RESULTS.md).
- Windows: a real WinForms fixture passed UIA discovery, exact ValuePattern text entry, InvokePattern button effects, selected-window capture, app isolation, stale/consumed snapshot rejection, and access revocation on a Windows runner. [Workflow](https://github.com/NobleSpartan6/otto/actions/runs/35188722719), [actual result](../tests/native/windows/RESULTS.json). This does not establish arbitrary-app, OCR-click, or keyboard-input compatibility.
- Local OCR: recognized text from a local UI image with bundled language data, without a remote OCR service.
- Desktop UI: the actual Electron app passed configuration/app discovery, consent gating, app limits, settings, mode switching, and keyboard/modal focus checks. Its screenshot was compared against the design concept. Provider-backed task runs are pending.
- Distribution: Mac arm64, Mac Intel, and Windows x64 installer builds passed and were published as an explicitly unsigned prerelease. The public project page was verified in the in-app browser. No signed/notarized production installer or benchmark-backed SOTA claim yet.
- Packaging: local OCR also passed from inside the packaged application's ASAR/resources layout, with bundled language data.

Update this report with actual build, native smoke, provider-backed run, and release results as they are completed.
