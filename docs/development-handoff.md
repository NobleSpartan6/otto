# Development guide

Read [the repository working rules](../AGENTS.md) before making changes. This guide describes the code boundaries and validation requirements for contributors; it does not grant publication or runtime permissions.

## Source map

| Area | Implementation | Contract |
| --- | --- | --- |
| Executable agent bridge | `desktop/agent-server.ts`, `core/agent-session.ts`, `core/agent-workflow.ts` | Launcher-scoped inspection, single native actions, bounded exact workflows, optional Jev delegation, and control release. |
| Read-only developer server | `desktop/developer-server.ts`, `core/developer.ts` | Compact observations and inert literal fill preparation; no execution or approval bridge. |
| Electron workflows | `core/engine.ts`, `core/batch.ts`, `desktop/main.ts` | Guided tasks with per-action review and a separate immutable reviewed-fill workflow. |
| Native control | `desktop/native-driver.ts`, `desktop/native/`, `desktop/agent-lease.ts` | Native identity, freshness, cancellation, and cooperative desktop ownership. |
| Provider integration | `core/typesafe.ts`, `core/planner.ts` | Validated structured decisions and an optional planner; provider outputs do not authorize effects or certify completion. |
| Evaluation | `evals/`, `tests/native/`, `scripts/otto-task.mjs` | Separate automated fixtures, native integration checks, host-model usage, and opt-in local receipts. |

See the [agent bridge](agent-bridge.md), [read-only tools](developer-tools.md), [current-task CLI](current-task-usage.md), [scoped discovery](scoped-discovery.md), and [reviewed fills](verified-fills.md) for interface details.

## Preserve execution contracts

Keep exact application scope, process/window/document identity, single-use references, expected values, cancellation, and uncertain-effect stops. Do not automatically repeat an action whose effect is unknown.

Native acquisition coverage and compact-response truncation are different. Query filtering of acquired controls does not expand native traversal or prove a complete tree. Label-based workflows require sufficient coverage to establish uniqueness; explicit-reference operations retain their own freshness and identity checks. Keep safety behavior consistent across entrypoints without assuming their authorization policies are interchangeable.

The desktop lease coordinates participating Otto implementations. It is not a system-wide lock against people, other automation tools, or older builds. Native focus and identity checks remain necessary.

## Validation

For core changes, run:

```sh
npm run typecheck
npm test
```

For the isolated Locked Cut example, run:

```sh
npm run test:locked-cut
npx tsc -p examples/locked-cut/tsconfig.json
```

Read [the example's own documentation](../examples/locked-cut/README.md) before modifying it. Fixture behavior does not establish live provider behavior or creative quality. Hosted Jev is an external service, not an open-source model included with Otto.

For documentation-only changes, check affected relative links, section anchors, commands, interface names, and evidence labels. Do not claim checks that were not run. Native and host-model evaluations can control the desktop or consume provider usage; they are not routine unit tests and require explicit runtime authorization and an appropriate environment. Report macOS, Windows, browser, fixture, and provider evidence separately.

## Change review

Use the [contribution review workflow](improvement-loop.md). Keep each change coherent, preserve unrelated work, and use conflict-protected updates on the intended feature branch. A patch, local checkpoint, or attempted API call is not evidence of a published commit. Record the resulting SHA and the validation performed on that revision.

For contributors using ChatGPT's GitHub integration, see the [official integration documentation](https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt). Check the connected tool's actual supported operations and permissions before attempting a write.

Public changes should contain standalone code, contracts, reproducible methods, and necessary source provenance. Exclude credentials, application contents, private recordings, raw operational logs, and unrelated personal material. Evaluation results must retain failures and unknown usage without exposing private data. Neither serialized byte counts nor tokenizer counts establish billed savings.
