# Connect a coding agent to Otto

The native agent bridge is separate from the older read-only [developer context server](developer-tools.md). It runs locally over MCP stdio; it does not require an HTTP service. Start with the disposable **Otto Form Fixture** and **TextEdit** scope, then deliberately choose other apps for later tasks.

Share the [Otto for agents page](https://noblespartan6.github.io/otto/agents.html) for an overview and setup. For a task that is already running and cannot reload its MCP catalog, use the [current-task CLI adapter](current-task-usage.md). Both interfaces use the same scoped executor.

A public interaction reference is [AI Builder Club's Jev browser demonstration](https://x.com/aibuilderclub_/status/2101316543317684368), reviewed September 19, 2026. It shows website navigation with an intermediate worker loop, not evidence of its source implementation, token savings, or general desktop reliability. Otto's implementation is independent and uses its existing native adapters.

## Build and review setup

Use Node 24 or newer on macOS or Windows:

```sh
npm ci
npm run build
node dist-desktop/desktop/agent-server.js --help
node dist-desktop/desktop/agent-server.js --list-apps
node scripts/install-codex.mjs
```

The setup script checks the built server and platform helper paths, then prints a TOML table for the current project's `.codex/config.toml`. It **writes no configuration** and does not inspect app contents, request native permissions, or read keys. If a project already has a configuration, merge the table without duplicating an existing `mcp_servers.otto` entry. Keep project-specific paths and scope local; do not commit a user's configuration.

The default generated scope is the exact names `Otto Form Fixture` and `TextEdit`, with `list_apps`, `inspect`, and `release_control` enabled. Override it explicitly with repeated `--app-name` or `--app` arguments, up to four apps. For example:

```sh
node scripts/install-codex.mjs --app-name "Otto Form Fixture" --app-name "TextEdit"
```

The fixture must be launched separately with `npm run demo:form`. TextEdit is a macOS example; on Windows choose the exact name or ID of an intended running test app. Exact names resolve against running apps when the server lists or inspects them. Native IDs are process-specific and can change on restart. A name can match a different future process, so use a PID when the task must remain tied to one launch. Duplicate or missing names must be resolved before acting; do not widen scope automatically.

To generate an action-enabled configuration for those same apps:

```sh
node scripts/install-codex.mjs --allow-actions
```

This adds the server's `--allow-actions` flag and allows the `act`, `run_steps`, and `delegate` tools. Inspect the live tool schemas for their exact inputs, budgets, reference lifetime, cancellation, and result contract. Do not copy a schema from an earlier release. Default inspection and native actions require no model key. `delegate` additionally needs `TYPESAFE_API_KEY` in the server environment.

Codex also applies its own tool approval rules. With `approval_policy = "never"`, a mutating MCP call that requires approval is rejected. To explicitly trust this local executor for `act` and `run_steps` within the same launcher app scope, generate:

```sh
node scripts/install-codex.mjs --allow-actions --trust-actions
```

This emits `mcp_servers.otto.tools.act.approval_mode = "approve"` and the equivalent `run_steps` setting. It leaves global approval policy and `delegate` unchanged. The host must still follow the user's task and obtain confirmation when the action itself requires it; tool trust does not authorize unrelated work. Without `--trust-actions`, normal host approval remains. [Official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

| Tool | Current contract |
| --- | --- |
| `inspect` | Returns bounded text and control refs; defaults to 64 controls and 4,000 text characters. Explicit maxima are 128 controls and 16,000 text characters. An optional exact label/role query filters acquired native controls before serialization; see [scoped discovery](scoped-discovery.md). Refs expire after 30 seconds. |
| `act` | Uses the latest snapshot token and a control ref, except bounded `enter`, `escape`, or `tab` keys. A fill verifies its native value; press, scroll, and key report dispatch. |
| `run_steps` | Runs 1–16 exact steps locally, with no model call. Native operations are `press`, `fill`, `scrollUp`, `scrollDown`, and `key`. Optional `expected.values` or `expected.textIncludes` checks determine verified completion. For distinct fill-only steps, `expected: "filled_values"` verifies every supplied literal without sending it twice; use explicit checks for additional fields or text. |
| `delegate` | Jev chooses only from supplied `allowedActions` within one app. Exact `expected` checks are required. The default action budget is eight, with a maximum of 16. Supplied literals are used; no hidden planner generates text. |
| `release_control` | Ends this connection's interactive desktop lease and invalidates its refs. It cannot release a different connection's lease. Available in read-only mode too. |

Workflow receipts distinguish `completed` steps from `verified` explicit checks and `stopped` partial work. The caller chooses the checks, so a matched text string does not prove a file was saved, a remote change persisted, or the whole goal succeeded. `actions` and `completedSteps` are numeric counts. Preserve any `uncertainAction`, failed checks, and reason when reporting the result. Calls have a 120-second server deadline; the generated host timeout leaves an additional 30 seconds for cleanup and the result. Run calls serially on one interactive desktop.

`inspect.controlCoverage` reports native control traversal separately from output truncation: `complete`, `partial`, or `unknown` for older helpers. Complete means the eligible selected window/menu tree was traversed without a reported limit or traversal failure; it is not proof that the app exposes every visual control. Native depth/node/control/time limits and skipped traversal failures report partial coverage. Label workflows and label-based value checks require complete coverage; explicit inspected refs remain usable with native freshness and identity checks. Larger output budgets cannot repair partial native acquisition. Rebuild the native helper and restart the server when upgrading.

Current Otto agent servers coordinate through a local lock shared across projects for the same OS user and host. A workflow holds control for its native work and releases it afterward. Interactive `inspect`/`act` calls retain control for up to 30 seconds of idle time; call `release_control` as soon as you finish. The CLI closes its connection and releases control automatically. Another Otto client receives `desktop_busy` before inspection or execution; wait and retry Otto later instead of starting a competing controller. Active live owners are never displaced just because time has passed. Restart older connections that do not expose `release_control`.

Electron builds containing the shared-ownership integration acquire the same lease when configuring a task and retain it through review and execution until cancellation or completion. Cancellation retains ownership until the native helper closes. Older installed Electron builds do not participate. This does not coordinate arbitrary apps, human input, or other computer-use tools. Fresh observations and field guards remain necessary; a lock is not a transaction or rollback guarantee for OS actions.

If that key is already supplied to the MCP host environment, generate its explicit forwarding declaration with:

```sh
node scripts/install-codex.mjs --allow-actions --forward-typesafe-key
```

The generator emits only the environment variable's name, never its value. It does not extract the key saved in the Electron app. Avoid putting a literal key in project configuration or shell history. Host setup must provide the environment separately; enabling forwarding does not prove a key exists or works.

## Load and verify the connection

Codex supports trusted-project `.codex/config.toml`, local stdio commands, tool allowlists, and explicit environment forwarding. After reviewing and applying the table, use the host's MCP restart/reload control and verify that Otto's actual tool manifest appears. The desktop documentation specifies **Save**, then **Restart**; the CLI's `/mcp` shows connected servers. Editing a file does not update the tool inventory already supplied to an active task. Start a fresh turn/session if the host cannot refresh it. [Official MCP setup](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

For a client that controls Codex App Server, `config/mcpServer/reload` queues a refresh of loaded threads; `mcpServerStatus/list` reports available tools. Those protocol methods are not automatically callable by every Codex task. [Official App Server API](https://learn.chatgpt.com/docs/app-server).

The repository includes [a project skill](../.agents/skills/otto-computer-use/SKILL.md) in the standard `.agents/skills` directory. A fresh Codex task in this trusted checkout can discover it. It does not install global tools or authorize additional apps; the MCP server must also be configured and loaded.

## Native permission and execution boundaries

The server must run on the computer and desktop session containing the selected apps. macOS Accessibility and optional Screen Recording grants apply to the actual executable/launch context; the installed Otto app's grant does not prove a source-built helper launched by Codex has access. Verify on the owned fixture first. Windows UIA access depends on the same interactive session and process privileges; an elevated app may be inaccessible.

The bridge only exposes launcher-scoped apps. Action enablement permits the available API; the user's task still bounds allowed changes. Tool errors or timeouts can leave partial changes, so inspect actual state before deciding what to do next. Do not let another agent or user automation compete for foreground input while a task is executing. Captured app text returned to Codex may be sent to its model provider; read-only does not mean content-free.

## Measure usefulness with real outcomes

For a reproducible host-usage comparison, use separate fresh `codex exec --json` runs with the same pinned model, reasoning setting, task, initial app state, tool permissions, approvals, and completion budget. Capture the entire JSONL stream and stderr to separate files. A sample shape is:

```sh
codex exec --json --color never -C /absolute/path/to/eval-project \
  -o /absolute/path/to/results/final.txt \
  "The exact frozen evaluation task" \
  > /absolute/path/to/results/events.jsonl \
  2> /absolute/path/to/results/stderr.txt
```

Create the results directory first and set the same explicit model/reasoning configuration for each arm. This command consumes the host account's normal usage; it is an evaluation recipe, not a setup check. Verify from tool-call events that the intended Otto or baseline tools were actually used.

The documented `turn.completed` event includes `usage.input_tokens`, `cached_input_tokens`, `output_tokens`, and `reasoning_output_tokens`. Retain the raw fields and failed/interrupted turns; do not double-count cumulative updates or assume reasoning/cache fields are additive. App Server clients can record `thread/tokenUsage/updated` instead. [JSON event documentation](https://learn.chatgpt.com/docs/non-interactive-mode), [App Server events](https://learn.chatgpt.com/docs/app-server).

Compare independently checked final state, first-attempt success, interventions, elapsed time, and all host plus Jev attempts together. Missing failed-call usage remains unknown. Provider counters measure reported usage, not necessarily a reconciled bill; Codex subscription percentages are not per-task dollar costs. Keep cold and repeated tasks separate. The [offline context benchmark](evaluation-developer.md) remains useful for exact serialized size, but cannot establish actual task savings. See the [evaluation methodology](research/general-desktop-evaluation.md).
