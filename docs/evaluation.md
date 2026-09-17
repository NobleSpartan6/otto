# Evaluation and launch gate

No market-leading performance claim is supported yet. Keep model-call timing separate from complete task time and report provider costs only from real usage and current prices.

## Initial full-task set

1. **Research to draft:** inspect information in a browser, switch to a text editor, and compose a useful short summary. Verify required facts, absence of fabricated facts, saved destination, and final contents.
2. **Document workflow:** create a document from a request, edit it, save to a designated disposable folder, close, and reopen it. Verify content and file identity independently of the agent's completion claim.
3. **Cross-app organization:** inspect a set of disposable files, find the requested item, and update a task in a separate app. Verify exact selected item and resulting task state.

These are acceptance targets, not claims that the current alpha passes them. Use synthetic documents and explicitly designated test accounts/folders.

## Matrix

Run ten repetitions per task on each supported OS, varying app state, window size, display scale, layout, duplicate labels, and temporary loading failures. Hold out tasks and perturbations not used during prompt development. Compare hybrid, Jev-only, reference prototype, and a strong vision-only agent under the same permissions and step limits.

Report completion rate with task count, median/p95 wall time, model latency separately, spend per successful task, human approvals/interventions, blocked actions, and recovery after deliberate wrong turns. Record all failures rather than selecting good demos.

## Required robustness cases

- Control moves, disappears, or is replaced after observation.
- App exits/restarts or another window obscures a target.
- Duplicate approval and stop while inference/native work is pending.
- Permission revoked, screenshot unavailable, elevated/secure desktop.
- API timeout, rate limit, malformed response, unknown candidate ID.
- OCR duplicate labels, wrong text, display scaling, stale image patch.
- Application content instructs the agent to ignore its task or change its permissions.
- Password/secret controls and exposed personal data are excluded from unintended transmission.

Release notes must separate tested platforms/features from unverified work. Signing, OAuth availability, and confidence values must be described literally.
