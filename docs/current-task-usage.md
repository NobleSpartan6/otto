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

### Recover omitted controls without extra free text

Inspection defaults to 64 controls and 4,000 text characters. If `truncation.controlsOmitted` is nonzero, request a larger control budget within the same app. For control discovery, omit the free-text section:

```sh
node /absolute/path/to/otto/scripts/otto-task.mjs inspect \
  --app "12345" --max-controls 128 --max-text-chars 0
```

`--max-controls` accepts 1–128 and `--max-text-chars` accepts 0–16,000, on `inspect` only. Zero text retains control labels and values; it is not a privacy filter. Defaults remain compact, and Otto never expands budgets or retries automatically. Check `controlCoverage` as well as output omissions. If coverage is partial or unknown, or controls remain omitted, do not assume a label is unique or guess a hidden target. Label workflows stop on partial/unknown native coverage; a larger output budget does not expand native traversal. Use an appropriate supported inspection method before acting. The larger inspection is read-only and still returns ephemeral refs.

## Execute a known sequence

Create a regular UTF-8 JSON file containing only `steps` and optional `expected` checks. For the disposable fixture launched with `npm run demo:form`:

```json
{
  "steps": [
    { "operation": "fill", "label": "Project name", "value": "Otto Demo" },
    { "operation": "fill", "label": "Package manager", "value": "npm" }
  ],
  "expected": "filled_values"
}
```

`expected: "filled_values"` verifies every supplied fill literal with native readback, without repeating the values. It requires fill-only steps with distinct labels after trimming whitespace and Unicode NFC normalization. Mixed operations require explicit checks, such as `"expected": { "values": { "Project name": "Otto Demo" } }`; use explicit `values` or `textIncludes` for additional checks. The shortcut does not authorize submission or verify external persistence.

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

The ownership lease coordinates Otto MCP workers and Electron builds containing the shared-ownership integration. `desktop_busy` means another Otto worker owns control; close or explicitly release that owner before a later attempt. `desktop_unavailable` means the local lease filesystem cannot be accessed; fix that access before retrying. Both return a nonzero exit status. The client never automatically retries or switches to another executor. Older installed Electron builds and other computer-use tools still require coordination; the lease is not a system-wide desktop lock.

Target-resolution stops include optional `targetResolution` diagnostics: `target_missing`, `target_ambiguous`, or `incomplete_observation`, with native `controlCoverage`, matching/omitted control counts and an identity-truncation flag. Partial/unknown native coverage requires better native acquisition or explicit inspected refs; only output omissions can be addressed with larger serialization budgets. An incomplete observation has `matchCount: null`; it cannot establish uniqueness. These counts add no app text and do not authorize a retry. Inspect current state and revise the remaining work instead of replaying completed steps.

Every call has a bounded timeout, and cancellation closes the client. Partial effects can remain. Inspect the actual app before choosing a new action; do not replay the entire file after an uncertain write. This command route does not grant additional task authority or override an explicitly denied action.

For persistent MCP tools, see [agent bridge setup](agent-bridge.md). For measured host usage and its limits, see [the Codex evaluation](evaluation-codex-agent-bridge.md).

## Optional private execution receipt

Add `--receipt /absolute/path/to/new-receipt.jsonl` to any CLI command to record counts and timing without app names, IDs, labels, values, screenshots, file paths, or raw errors. The parent directory must exist. Otto reserves a new file with mode `0600` before starting; an existing destination or symlink is refused without running the task. Filesystem permissions on Windows depend on the directory ACL.

Schema version 2 is an append-only JSON Lines stream with increasing `sequence` values: `started`, pre-call `intent`, received `result`, and `final` records. Each checkpoint is synced before continuing. An intent is written before invoking the tool; it is not proof that the tool call or native effect occurred. Until a valid final record exists, counters are partial lower bounds and effects may be unknown. Do not skip corrupt records or treat a truncated last line as completion. Earlier local version-1 single-JSON receipts are not this format.

The receipt records tool-call attempts and received results separately, plus manifest/discovery attempts, CLI execution time, returned UTF-8 text bytes and whitelisted workflow counters. CLI time includes input validation, connection, execution, intermediate receipt checkpoints and connection closure; it excludes final receipt I/O and the calling agent's reasoning. Text bytes exclude the host's tool wrapper and are not model tokens. Native actions and matched checks come from the executor's receipt, not an independent task grader. `finished` means the CLI returned successfully; it does not upgrade `completed` into verified success.

Ordinary errors, cancellation and uncertain stops retain a final record when the filesystem remains writable. Abrupt termination retains earlier complete checkpoints where available; no final record means incomplete evidence, never a safe-to-retry signal. Process-interruption tests do not establish hardware/power-loss durability on every filesystem. If saving the report fails after execution, Otto reports that the task may already have run. Host token usage, baseline and savings remain `null`; no telemetry is transmitted. Store receipts in a private ignored directory and use a fresh filename per attempt.

## Validation history

On September 19, 2026, the real CLI was run from outside the checkout against a disposable macOS fixture: one inspection, then a six-field workflow. The successful run returned six matching checks; the fixture independently recorded six writes, zero submissions, and zero resets. Otto made no model calls. SDK protocol and CLI validation tests run in the normal test suite.

An earlier CLI attempt stopped after its fourth dispatch attempt with an unverified native action. It did not replay that action. That attempt's post-action fixture state was not retained, so its exact effects and cause remain unresolved. A separate diagnostic run and the fresh CLI run succeeded without a native code change. These checks establish a working local route, not a reliability rate, Windows UI validation, or additional token-savings evidence.
