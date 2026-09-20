# Use Otto from a running Codex task

An active task may not have newly configured MCP tools in its current tool inventory. It can use this one-shot local client through its existing command tool when the user has authorized the desktop work. No Codex restart, global setup, provider key, or additional model is required.

Build Otto first with `npm run build`. The client requires the current agent server, including its desktop-ownership protocol. It refuses an older server without `release_control` before inspection or writes. These commands run on the computer hosting the target app:

```sh
node /absolute/path/to/otto/scripts/otto-task.mjs list-apps
node /absolute/path/to/otto/scripts/otto-task.mjs inspect --app-name "TextEdit"
node /absolute/path/to/otto/scripts/otto-task.mjs inspect --app "12345"
```

`list-apps` returns running app names and native IDs, without reading their contents. Each inspection selects one exact ID or name. A name-scoped server first returns only its allowed app list; the client requires a unique exact match before continuing. No match, duplicate names, or a changed scope stops the request. IDs can change after an app restarts.

Inspection returns compact text. **Refs expire when this command exits** because its MCP connection closes. They cannot be reused in another invocation. Use the observed exact field labels to construct a fresh bounded workflow instead of copying an expired snapshot token.

## Execute a known sequence

Create a regular UTF-8 JSON file containing only `steps` and optional `expected` checks. For the disposable fixture launched with `npm run demo:form`:

```json
{
  "steps": [
    { "operation": "fill", "label": "Project name", "value": "Otto Demo" },
    { "operation": "fill", "label": "Package manager", "value": "npm" }
  ],
  "expected": {
    "values": { "Project name": "Otto Demo", "Package manager": "npm" }
  }
}
```

Then, within the authorized task:

```sh
node /absolute/path/to/otto/scripts/otto-task.mjs run-steps \
  --app-name "Otto Form Fixture" --file /absolute/path/to/task.json
```

`run-steps` enables native actions only for that one launcher-selected app. The client supplies its resolved ID; the file cannot select another app or expand scope. It uses the existing MCP workflow engine and closes the connection afterward. It does not call Jev, retrieve the Electron app's saved keys, or modify Codex configuration.

The file is limited to 64 KiB and 1–16 actions. Fill values are literal strings of at most 2,000 characters, totaling at most 16,000. Expected checks total at most 16. Supported operations are `fill`, `press`, `scrollUp`, `scrollDown`, and bounded `key` values `enter`, `escape`, or `tab`. Consequential presses and keys require authorization for their actual effects; an exact value map does not authorize submission. No submit action is added automatically.

Never put credentials in the file. Known credential-like values and protected-field labels are rejected, but pattern checks cannot recognize every secret format. Selected app text and workflow literals returned to the calling agent may enter its model context.

## Read the result and stop on failure

Standard output contains the compact tool response. Standard error contains fixed diagnostics and, after inspection, a reminder that refs expire. Exit status `0` means inspection succeeded or the workflow returned `completed`/`verified`; `1` means invalid local input/setup; `2` means a stopped, busy, failed, cancelled, or uncertain request. `completed` without expected checks is not verified task success. `verified` covers only the supplied native value/text checks, not external persistence or submission.

The ownership lease coordinates Otto MCP workers. `desktop_busy` means another Otto worker owns control; close or explicitly release that owner before a later attempt. `desktop_unavailable` means the local lease filesystem cannot be accessed; fix that access before retrying. Both return a nonzero exit status. The client never automatically retries or switches to another executor. Other computer-use tools and the separate Electron app still require coordination; the lease is not a system-wide desktop lock.

Every call has a bounded timeout, and cancellation closes the client. Partial effects can remain. Inspect the actual app before choosing a new action; do not replay the entire file after an uncertain write. This command route does not grant additional task authority or override an explicitly denied action.

For persistent MCP tools, see [agent bridge setup](agent-bridge.md). For measured host usage and its limits, see [the Codex evaluation](evaluation-codex-agent-bridge.md).

## Validation status

On September 19, 2026, the real CLI was run from outside the checkout against a disposable macOS fixture: one inspection, then a six-field workflow. The successful run returned six matching checks; the fixture independently recorded six writes, zero submissions, and zero resets. Otto made no model calls. SDK protocol and CLI validation tests run in the normal test suite.

An earlier CLI attempt stopped after its fourth dispatch attempt with an unverified native action. It did not replay that action. That attempt's post-action fixture state was not retained, so its exact effects and cause remain unresolved. A separate diagnostic run and the fresh CLI run succeeded without a native code change. These checks establish a working local route, not a reliability rate, Windows UI validation, or additional token-savings evidence.
