# Electron interface checks

Build with `npm run build`, then run `npm run test:ui`. This launches the production renderer and preload in a separate Electron process with a disposable profile and fixture IPC responses. It never loads provider keys, creates a native driver, sends requests, or changes another application.

Use the **Scenario** menu to select onboarding, loading, missing permissions, empty applications, application/runtime/key/start errors, a running task, a failed/blocked task, or polling errors. **Window size** provides 1280 × 820, 900 × 660, and 680 × 740. A normal fixture task moves through working → action review → result verification → user-confirmed completion. History includes 18 entries to exercise scrolling. The application list includes long names and more items than fit on screen.

Check with Computer Use:

- Keyboard traversal, visible focus, modal trapping, Escape, and focus restoration.
- Search and select apps; selected count and four-app cap; scope change resets consent.
- TypeSafe-only and Hybrid modes; provider setup is honest about saved versus verified keys.
- Start loading, action review's exact application/target/value, disabled repeated approval, Stop, verification, and fresh attempts after a failure.
- History and long text scroll without hiding the primary action. Smaller windows preserve Task/App state and keep Stop available.
- Errors announce and offer a relevant recovery path; polling failures do not erase the latest known task.

Fixture flows verify UI behavior only. Native-driver tests and live provider tasks are separate. Console warnings/errors are printed to the launching terminal. Close the fixture window to remove its temporary profile.

## Browser renderer fixture

When native Electron input is unavailable, run `node tests/ui/browser-fixture.mjs` after building. Open `http://127.0.0.1:4327` in the in-app browser. The server binds only to loopback and loads the production renderer with an isolated mock bridge. This tests **browser renderer behavior**, not Electron IPC, native field verification, system permissions, or speech recognition.

The toolbar switches Success, Mismatch, held execution, delayed permission return, and unavailable speech scenarios. Its viewport selector changes the embedded browsing context between 1280 × 820 and 900 × 660 without reloading the renderer. Form receipts deliberately contain synthetic readbacks; no other app is read or changed. Held execution makes the Stop path repeatable.

Dictation returns a fixed synthetic sentence. **Finish fixture dictation** and **Cancel fixture dictation** send mock native completion events. Verify that existing text remains, completion appends once, cancellation adds nothing, and **Guided starts** stays zero. The delayed permission scenario changes its mock grant after 1.4 seconds so the renderer's automatic recheck can be exercised. Export controls do not write files in this harness.

If the computer-use client cannot interact with the iframe, open `http://127.0.0.1:4327/app?scenario=success` directly. Use `mismatch`, `hold`, `permissionReturn`, or `voiceUnavailable` in the scenario query to reset into another case. The direct page has a small **Browser fixture controls** disclosure for synthetic speech completion/cancellation and the guided-start counter. These controls are injected by the test server only.

Run the independent source-value regression checks with `npx tsx --test tests/ui/fill-values.test.ts`. They cover exact value preservation, duplicate keys including overwritten non-string values and normalized labels, string-token boundaries, and input limits.

## Recorded alpha.4 renderer checks

The root agent exercised the direct production renderer in the in-app browser with the mock bridge. These are browser UI results, not Electron IPC or native execution evidence:

- Six-field source → exact before/after review → approval → receipt passed. The mock reported five simulated writes and one already-matching field; all six synthetic readbacks matched.
- The 1280 × 820 normal layout passed visual inspection. The 900 × 660 receipt remained within the viewport, with no horizontal overflow and its footer actions visible.
- At 900 × 660, an expanded 875-character value retained its full text, introduced no horizontal overflow, and kept the footer visible (approximately y=570–639). Edit values had a visible keyboard focus ring.
- A 16-field review at 900 × 660 scrolled with PageDown from the focused heading. After settling, the dialog body reported scrollTop 415 with scrollHeight 898 and clientHeight 483; footer actions stayed visible. Screenshot evidence: small-scrolled-review-browser.png (browser fixture).
- A numeric City value hidden by a later duplicate City string was rejected by the rebuilt renderer; focus returned to the JSON input.
- Review moved keyboard focus to its title. Closing with **Done** restored focus to **Fill form**.
- Dictation **Stop** appended the synthetic transcript once. **Cancel** preserved the existing draft without adding text or submitting a task.
- A mismatched field stopped the remaining writes. The failure title received focus; recovery retained the JSON and selected app while resetting consent.

- During held execution, Escape kept the running dialog open. Stop produced a stopped receipt with remaining fields unexecuted.
- Delayed permission return updated App access enabled after approximately 1.7 seconds without a manual check.
- Unavailable speech kept the draft and showed an actionable error. Natural completion appended once and focused the draft; external cancellation preserved the draft. Guided starts stayed zero.
- Keyboard Tab moved from source textarea to consent, Shift+Tab returned to the textarea, and the native modal state remained true. At the final button, Tab passed through the browser boundary and returned to Close; underlying application controls remained inert. Space on Close and Escape while editing restored Fill form focus.

The installed Electron app's initial screenshot rendered correctly. Interactive native Computer Use still produced no effect or `noWindowsAvailable` despite a readable accessibility tree; those attempted interactions are not counted as passed. Browser fixture results do not prove Electron IPC or real speech recognition.

The JSON parser regressions are also included in `npm test` and `npm run check`.
