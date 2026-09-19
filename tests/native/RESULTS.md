# macOS native integration evidence

Run date: 2026-09-18. `node_modules/.bin/tsx tests/native/smoke.ts` exited **0**.

The test launched a disposable AppKit fixture and allowlisted only that child PID. Existing Accessibility and screen-capture permissions were available; no permission prompt was requested. No provider requests were made, no existing user application was acted on, and screenshots were not retained. The temporary fixture bundle was removed after the app exited.

Verified through the actual `PlatformDriver` and compiled native helper:

- Accessibility exposed the fixture's editable text field and buttons.
- The developer adapter compacted that real native snapshot and prepared a literal fill; a fresh native observation proved preparation did not change the field.
- Observe and action requests outside the fixture allowlist were rejected.
- An already consumed action snapshot was rejected on reuse.
- Filling the field produced the exact expected text on a fresh observation.
- Pressing the fixture button updated its own status with the filled text.
- The selected window image was captured, local OCR found the painted test label, and all five OCR controls had finite coordinates inside that window's bounds.
- The close action exited the exact launched child with status 0.

Close acknowledgement was uncertain because termination destroyed the Accessibility connection before its reply. The harness verified the independent child exit and did **not** retry the action. This exercises the helper's conservative handling of ambiguous native outcomes.

Tested helper SHA-256: `b8d9e99f1546c2704f00825e434907c98b357123faf32fe08dc4b58c1016d9ae`.

Windows native execution and live provider integration were not covered by this run. The developer MCP protocol is separately exercised through an actual SDK client/server subprocess using an injected fixture driver.
