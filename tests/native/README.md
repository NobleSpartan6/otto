# Native smoke fixture

Run on macOS from the repository root:

```sh
node scripts/build-native.mjs
node_modules/.bin/tsx tests/native/smoke.ts
```

This manual integration test compiles a disposable AppKit app in a temporary directory. It permits native actions only against that child PID, edits harmless fixture text, presses a button that updates the same window, and closes the fixture. It checks accessibility discovery, one-shot snapshots, allowlist rejection, and selected-window OCR geometry when screen capture is available. It calls no model API, requests no permissions, retains no screenshots, and removes its temporary app afterward.

The fixture briefly becomes the foreground app. Avoid interacting with the desktop during the short run. Missing Accessibility permission reports `blocked` with exit code 2; the test never grants it. Other failures exit 1. This integration test is deliberately separate from unattended unit tests and is not included in packaged app files.

An app may exit before Accessibility acknowledges a close action. The test records this as uncertain OS acknowledgement and independently requires its exact child process to exit successfully. It never retries an ambiguous action.
