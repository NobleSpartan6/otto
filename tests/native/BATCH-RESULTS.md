# Native batch integration results

**2026-09-19 UTC · macOS 26.5.1 · arm64 · seven authored cases, one run each.**

The final run passed all seven checks: three exact-fill cases completed, and four injected faults produced the required failed receipt. This is a native integration check, not a general task-success benchmark or a token-saving comparison. There were **zero provider requests and zero submissions**.

The harness used the real `BatchEngine`, `PlatformDriver`, and compiled Accessibility helper. Each case launched a fresh AppKit form, configured only that child PID, prepared a review without changing fields, approved the bounded batch, and independently inspected the form's atomic JSON state. The executor never reads that oracle. Values, process/launch identity, reset count, mutation counts, and forbidden-submit count were checked. Each child was stopped and its temporary directory removed.

| Case | Required receipt | Native fill attempts | Actual field changes | Outcome |
| --- | --- | ---: | ---: | --- |
| Six blank onboarding fields | Completed | 6 | 6 | All six literal values exact |
| First two fields already correct | Completed | 4 | 4 | First two fields unchanged; all six final values exact |
| Unicode and multiline literals | Completed | 6 | 6 | Japanese, Arabic, accents, emoji, newline and literal command-like text preserved |
| Notes changed after first fill | Failed | 1 | 1 | Fixture's unexpected edit preserved; remaining fills stopped |
| Notes disappears after first fill | Failed | 1 | 1 | Missing target detected; remaining fills stopped |
| Duplicate Notes target appears | Failed | 1 | 1 | Duplicate untouched; remaining fills stopped |
| Notes setter rejects its write | Failed | 6 | 5 | One rejection recorded; unchanged value detected; no false completion |

Every observation also checked that hidden zero-sized menu controls and the shared Apple menu entry were absent from actionable results. Native fill calls may activate their selected app, so run the suite without another UI automation task operating concurrently.

## Reproduce

Build the native helper first, then run on a macOS desktop with Accessibility permission already granted:

```sh
node scripts/build-native.mjs
node --import tsx tests/native/batch-smoke.ts
```

The harness copies the helper into a private temporary resource directory before testing, so concurrent builds cannot change its executable mid-run. JSON reports and per-case evidence are kept in local, ignored output and contain no screenshots or provider keys.

Recorded revisions for the passing run:

| Artifact | SHA-256 |
| --- | --- |
| `FormFixture.swift` | `380c9c31c92540ccb871eb02145c56a265b13355592e9c07056b4e4bc4ae1571` |
| `core/batch.ts` | `973adb1b099cf1de4d39bfaa2ac53f092f98fa3e6d83ee651feb66945944c31b` |
| `OttoAX.swift` | `a65ad229b1d5849448f6007034d144f684c3904768e99ed029d2e24c41afeeae` |
| Pinned `otto-ax` executable | `b3505deb61f89108e66555e63df4e6676a1d28004f5e5d87d2aa2a17baae20a4` |

## Failures retained

Two earlier full runs remain separate from the passing result:

- In the first run, all seven cases failed before approval because unrelated hidden menu controls had zero-sized bounds. The implementation scopes its form fingerprint to editable native fields, requires valid geometry for every requested target, and excludes the shared Apple menu subtree.
- In the second run, all seven cases failed because the fixture's overridden accessibility setter did not update the real text control. Native readback and the independent oracle caught the mismatch. The fixture setter was corrected; failures were not discarded.

No live Jev baseline was run by this suite. No provider billing, comparative latency, arbitrary-app compatibility, Windows batch result, or reliability rate beyond these seven cases is established. See the [developer evaluation](../../docs/evaluation-developer.md) for the separate offline context measurements.
