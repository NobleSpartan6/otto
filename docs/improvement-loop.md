# Contribution review workflow

Use small, reviewable changes to improve an evidenced behavior or contract. Follow [AGENTS.md](../AGENTS.md) and the [development guide](development-handoff.md).

## One change

1. Read the intended branch HEAD, relevant implementation, tests, and current interface documentation. Preserve unrelated or uncommitted work.
2. State the observable behavior to change and a regression that distinguishes the intended result from the current behavior. Prefer a concrete failure over speculative infrastructure.
3. Implement the smallest coherent change. Preserve scope, identity, ownership, coverage, cancellation, exact-value checks, and uncertain-effect stops. Do not change evaluation thresholds merely to obtain a passing result.
4. Run applicable checks. Distinguish unit tests, protocol fixtures, native runtime checks, independent outcomes, and real provider inference. A check that could not be executed must be labeled **not run**.
5. Review the diff and create one commit for the coherent slice. Do not create empty checkpoint commits or bundle unrelated changes.
6. Validate the exact resulting revision before layering further behavior changes. Fix or revert a regression with a new, focused commit rather than rewriting another contributor's work.

Repeated failure on the same approach should lead to a smaller hypothesis, a reproducible blocker, or a different design, not weakened guards or unbounded retries. Never replay uncertain native effects merely to obtain comparison data.

## Commit format

Use a concrete technical subject and include:

```text
Change: Observable behavior or contract changed and its technical rationale.
Validation: Commands and actual results; identify checks not run.
Limits: Unsupported environments, evidence gaps, or remaining constraints.
Next: A bounded technical follow-up, when applicable.
```

Commit messages should explain the implementation independently of a development session. Keep operational logs and application data out of commit messages, issues, and documentation. Necessary public source citations and reproducible technical evidence are appropriate.

## Branch and concurrency discipline

Work on the designated feature branch. Re-read its remote HEAD immediately before each remote write and use the integration's conflict protection. Stop on unexpected divergence rather than overwriting concurrent work. Do not force-push, amend another contributor's commit, reset a dirty checkout, or treat branch access as authorization to merge, deploy, or release.

Return an actual confirmed commit SHA when reporting publication. A successful local check applies to that checked revision, not automatically to a later commit. Contributors should fetch and compare exact revisions before fast-forwarding a clean compatible checkout.

## Evidence and validation boundaries

Keep experiments isolated from production execution. Local mocks prove fixture behavior; native checks prove only their tested platforms and applications; provider-backed results require recorded requests and usage. Missing usage remains unknown. Neither a model's finish signal nor a successful dispatch independently establishes task completion.

For documentation changes, verify relative destinations and anchors and distinguish source-derived facts from proposals. Preserve public source revisions and limitations rather than promoting historical results to current capabilities. Do not publish raw traces, screenshots, secrets, or local report locations.

Do not start native evaluations, provider calls, installations, or model downloads as an incidental part of code review. Those operations need their own explicit authorization and environment checks. Keep Locked Cut and other examples independent of the main product flow.
