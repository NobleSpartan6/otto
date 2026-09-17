# Windows native fixture smoke

Verified on 2026-09-17: [workflow run](https://github.com/NobleSpartan6/otto/actions/runs/35188722719) returned `status: passed`. The unmodified [result artifact](RESULTS.json) records the tested scope and screenshot geometry.

Run from the repository root on an interactive Windows desktop:

```sh
npx tsx tests/native/windows/smoke.ts
```

The harness compiles a temporary WinForms EXE using Windows PowerShell's `Add-Type`, launches it, and permits native effects only against that exact child PID. It tests app discovery, explicit configuration, real ValuePattern text filling, real button invocation, resulting UI state, reused/replaced snapshot rejection, wrong-app rejection, and revocation. All data is harmless fixture text. It calls no model API and never grants permissions.

The fixture closes through a private temporary-file signal and also exits if its parent disappears or two minutes elapse. An uncertain native action is never retried. Read-only observation/state polling may repeat while waiting for the app.

Results go to `test-results/windows-native-smoke.json`: exit 0 means passed, 2 means blocked by the desktop environment, and 1 means failure. Optional screenshot geometry is recorded when `PrintWindow` works; screenshots themselves are not retained. This test does not validate OCR clicking, global key input, mixed-DPI behavior, every application, or complete AI task success.

The manually dispatched `Windows native fixture smoke` workflow uses `windows-latest`. If the hosted runner has no visible interactive desktop, its report and job summary say **BLOCKED**. A green workflow carrying that report must not be described as successful Windows native validation. This workflow is intentionally separate from required CI and installer builds.
