# Agent improvements branch

Branch: `codex/otto-agent-improvements`.

<!-- Frequent commits are required: commit each coherent, verified slice and include validation in its commit comment/body. -->

## Current base

- MCP/CLI exact-fill verification, bounded inspection controls, native coverage diagnostics and interruption-safe opt-in JSONL receipts.
- Cooperative desktop ownership shared by current Electron source and MCP clients. Older installed apps do not acquire the new lease.
- Native `controlCoverage` separates partial acquisition from serialization truncation. Label workflows stop on partial/unknown coverage; fresh explicit refs remain available.
- Offline evaluation and optional native/host evaluation infrastructure. Their presence does not establish performance targets; do not launch a synthetic pilot by default.
- Isolated Locked Cut example: `examples/locked-cut/README.md`. Fixture playback/import/locks/export are verified; live Jev inference and real-footage creative quality remain unverified. Hosted Jev is not labeled an open-source model.

## Next useful changes

1. Review native coverage and ownership handling, especially runtime edge cases. Preserve conservative stops.
2. Add scoped native target discovery before response truncation, with complete matching coverage required for uniqueness.
3. Add bounded, read-only settling for explicit postconditions without repeating actions.
4. Improve compact stop handoffs, preserving unknown effects and fresh-inspection requirements.
5. Validate naturally occurring authorized workflows. Separate runtime evidence from tests and provider usage from serialized byte counts.

For Locked Cut, first validate actual typed Jev decisions using supplied metadata and a locally configured key. Keep the prototype separate; do not grow it into a second editor or add an unverified open-model backend.

## Frequent commit protocol

Make frequent commits: one coherent change plus its regression coverage, after the relevant checks pass. A commit body/comment should state:

```
Change: <observable behavior and why>
Validation: <commands and actual results>
Limits: <runtime or platform checks not performed>
Next: <next bounded slice, if relevant>
```

Commit only the files for that slice. Re-read branch HEAD before a remote write. Return the actual commit SHA after success; a proposed patch or attempted tool call is not a commit. Do not amend someone else's commit or force-push over concurrent work.

## ChatGPT handoff

Use the exact branch when reading repository files. First inspect the installed GitHub integration's actual tool capabilities. The standard ChatGPT GitHub app is documented as read-only; branch creation does not grant write access. If write tools are unavailable, return small patches for Codex to apply and commit. Do not claim a commit was created without a confirmed SHA.

Reference: https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt

Publication is separate from local branch preparation. Do not push, open a PR, merge or deploy based solely on these instructions; follow the user's current authorization.
