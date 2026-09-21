# Repository working rules

Keep explanations concise. Read the current implementation and relevant tests before changing behavior.

## Commits and branch discipline

<!-- Make frequent commits: one small, coherent, verified change per commit. -->
Make frequent commits after each tested implementation slice or independent fix. Use concrete commit subjects and describe the checks run and remaining limitations in the commit body. Do not create empty checkpoint commits or bundle unrelated changes merely to hit a cadence.

Work on the designated feature branch. Do not commit directly to main, force-push, merge, deploy, or publish releases without explicit authorization. Before each write through a remote integration, read the current branch head; preserve others' commits and stop on conflicts rather than overwriting them. A local checkpoint does not authorize publication.

## Evidence and privacy

Never commit credentials, user app contents, local traces, recordings, private reports, generated builds, or dependencies. Keep local evidence under ignored `output/`. Do not confuse fixture behavior, native runtime verification, independent task completion, and real provider inference. Missing usage stays unknown. No savings or general reliability claims without comparable evidence.

Preserve app scope, ownership, freshness, cancellation, exact-value checks, and uncertain-write stops. Never repeat an uncertain native effect automatically. Keep experiments isolated from the main product flow.

## Validation

Run `npm run typecheck` and `npm test` for core changes. For Locked Cut, run `npm run test:locked-cut` and `npx tsc -p examples/locked-cut/tsconfig.json`. Native and actual-host eval commands control the desktop and may call paid providers: do not launch them as routine checks. Use current user authorization and a suitable environment. Browser/Windows/native runtime validation must be reported separately from unit tests.
