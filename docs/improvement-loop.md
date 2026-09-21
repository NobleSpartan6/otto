# Branch improvement loop

Target: `codex/otto-agent-improvements` in `NobleSpartan6/otto`.

The user authorizes incremental commits and pushes to this feature branch. GPT-6 Pro proposes and implements bounded slices through its available GitHub write tools. Codex reviews actual commits and runs local checks. No main-branch writes, force-pushes, merges, releases, deployments, new dependencies or model downloads without separate authorization.

<!-- FREQUENT COMMITS: make one small, coherent commit after each verified slice; include Change, Validation, Limits and Next in the commit comment/body. -->

## One iteration

1. Read the remote branch HEAD and the latest implementation/review. Do not start a second Pro job while the previous one runs.
2. Choose one evidenced gap from `docs/development-handoff.md`. State the expected behavior and one meaningful regression check before editing. Prefer actual user-task failures over speculative features.
3. Implement the smallest coherent change. Preserve ownership, scope, identity, cancellation, coverage and uncertain-write stops. Do not modify eval thresholds merely to pass.
4. Make frequent commits with concrete subjects. Commit comments must contain Change, Validation, Limits and Next. If the plugin cannot run tests, write **not run** and label the commit as awaiting Codex validation; never invent results.
5. Codex fetches the exact commit, fast-forwards only from a clean compatible checkout, runs relevant checks and reviews the diff. A conflicting/dirty checkout is preserved, not reset. Record private per-iteration evidence under ignored `output/private/improvement-loop/` with base/head SHA, hypothesis, checks, outcome and next action.
6. Feed concrete failures back to Pro for a focused fix. If a change regresses behavior, repair or revert only the owned change with a new commit. Never automatically replay native effects to gather a benchmark baseline.
7. Proceed only after the previous slice is validated. After three failed attempts on the same gap, stop that line of work and report the blocker. Do not endlessly re-prompt or replace missing evidence with activity.

## Scope and evidence

Start with scoped native discovery, bounded read-only settling, and useful stop handoffs. Keep Locked Cut isolated. Its live inference and owned-media gates require real inputs. The older synthetic savings pilot remains discontinued; no 30%/20% claim is established. Missing usage is unknown. Runtime/native/Windows claims require their own evidence.

Only one writer owns a slice at a time. Before any GitHub write, re-read HEAD and use the integration's conflict protection. Return actual commit SHAs. This loop does not authorize changing credentials, plugin permissions, repository visibility, model settings or user app data.

Run hourly while there is actionable work. Remain quiet when Pro is still working or nothing changed. Notify on validated progress, a failed regression, a material blocker, or required user action. The loop is a bounded engineering feedback process, not autonomous model training or a claim of recursive intelligence gains.
