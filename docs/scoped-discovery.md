# Exact native-control discovery: first slice

The executable agent MCP `inspect` tool accepts an optional exact label/role query:

```json
{
  "appId": "<allowed app ID from list_apps>",
  "query": { "label": "Destination", "role": "AXTextField" },
  "maxControls": 1,
  "maxTextChars": 0
}
```

Labels are case-sensitive after trimming and NFC normalization. Roles match exactly;
use the actual platform role. Only non-sensitive accessibility controls match, not
OCR or unknown-source controls. The query filters the acquired native snapshot
before the compact row cap. It does not expand app scope or select a different
window/subtree. Free text retains its independent limit; use zero to omit it.

Query responses add `discovery` counts:

- `observedMatches`: matches in the acquired native controls, before the row cap.
- `totalMatches`: that count only when native coverage is complete; otherwise null.
- `matchesOmitted`: observed matches not returned because of the row cap.
- `scope`: `selected_native_tree`, not a claim about every visual control or window.

Two observed matches with `maxControls: 1` therefore report 2/2/1, not uniqueness.
Partial or legacy coverage with one observed match reports 1/null/0. Zero observed
matches on incomplete coverage does not prove absence. Protected controls are not
included in these counts. Counts are evidence, never authorization or verification.

Existing `truncation.controlsOmitted` still counts every non-sensitive acquired
control absent from the response, including filtered nonmatches. Do not subtract
that count to bypass existing workflow uniqueness checks. `run_steps` and
`delegate` remain unchanged and conservative; they do not yet use query coverage.

Returned aliases bind the matching native controls, remain single-use, and expire
as before. `act` uses fresh native rebinds and keeps the query on its returned
observation; inspect without a query to restore a broad view. The complete native
frame remains available to window/document, keyboard, form and exact-value guards.
App scope, lease, cancellation, uncertain-write stops and host authorization are
unchanged. A query never executes an action or grants new permissions.

## Remaining work and validation

This is response-scoped discovery over already acquired native controls, not native
subtree traversal. It cannot find controls omitted by AX/UIA acquisition limits or
failures, and never upgrades partial coverage. Helper-issued window/subtree scoping,
matching-aware native traversal, workflow adoption and CLI query flags remain for
separate validated slices. Existing workers require rebuilding/reconnecting outside
active runs. Older tool schemas do not support `query`; unqueried calls are unchanged.

Regression files: `core/agent-discovery.test.ts` and
`desktop/agent-discovery.test.ts`. Tests use synthetic in-memory snapshots/transports,
not native runtime, live Jev, task-success, billing or token-savings evidence. Run the
repository typecheck and full suite on the exact commit before the next slice.
