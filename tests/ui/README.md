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
