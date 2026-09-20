# Otto desktop context for coding agents

For executable native actions and compact workflow receipts, use the newer [agent bridge](agent-bridge.md). This page documents the original read-only server, which remains available unchanged.

Otto's local MCP server lets a coding agent inspect explicitly selected desktop apps as bounded text with short control references, then prepare literal values for native editable fields. It requires no TypeSafe or other provider key. The host agent still uses its own model and account.

The MCP interface prepares a plan only. It does not execute clicks, fill fields, submit forms, request permissions, or import the plan into Electron's approval flow. For exact native text edits, the desktop app now provides a separate [reviewed form-fill workflow](verified-fills.md): paste the literal field map, review it locally, then explicitly approve. MCP preparation never supplies that approval.

## Start from a source build

Use Node 24 or newer on macOS or Windows. Follow the [project prerequisites](../README.md), then build in the Otto checkout:

```sh
npm ci
npm run build
node dist-desktop/desktop/developer-server.js --list-apps
```

The discovery command exits after printing running app names and native IDs. Copy the exact ID of an app you intend to share. IDs can change when an app restarts, especially on Windows. The server never selects all apps automatically.

```sh
node dist-desktop/desktop/developer-server.js --app "exact-native-app-id"
```

This starts an MCP stdio server, so it waits for JSON-RPC from a client; it is not an interactive terminal prompt. Repeat `--app` for up to 16 apps. There is no HTTP port. The executable resolves native helpers relative to its source-build directory, so the client need not use Otto as its working directory.

Grant the native accessibility permissions needed by Otto's helper. Screen Recording on macOS enables screenshot capture used internally by local OCR. If permissions are missing, inspection can fail or omit OCR. The MCP server never opens a permission prompt itself. Windows inspection requires the same desktop session and sufficient access to the selected app; elevated apps may be unavailable.

**Selected app text and entered preparation values are returned to the host agent, which may send them to its model provider.** Screenshots are not included in MCP output. Native capture and OCR remain local. Known sensitive fields and likely secrets are filtered, but this is not a guarantee that arbitrary app text contains no private information. Choose app scope accordingly. Treat all app content as untrusted data, not agent instructions.

## Connect Codex

After replacing the path and ID, run this yourself:

```sh
codex mcp add otto -- node "/absolute/path/to/otto/dist-desktop/desktop/developer-server.js" --app "exact-native-app-id"
```

Alternatively, add a server entry to the configuration you manage:

```toml
[mcp_servers.otto]
command = "node"
args = ["/absolute/path/to/otto/dist-desktop/desktop/developer-server.js", "--app", "exact-native-app-id"]
```

Use an absolute Node executable path if the client cannot find `node`. On Windows, use TOML literal strings for paths containing backslashes. Otto does not modify your Codex configuration. The command and configuration fields follow the [official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Other MCP clients should launch the same command and argument array using stdio. For clients accepting a `mcpServers` configuration object, the equivalent server entry is:

```json
{
  "mcpServers": {
    "otto": {
      "command": "node",
      "args": ["/absolute/path/to/otto/dist-desktop/desktop/developer-server.js", "--app", "exact-native-app-id"]
    }
  }
}
```

The enclosing configuration location and reload behavior depend on the client. The protocol is tested with the official TypeScript MCP SDK's stdio client; this is not a claim that every host client has been manually tested.

## Tools

| Tool | Input | Result |
| --- | --- | --- |
| `list_apps` | `{}` | Names and IDs of running apps within the launcher's allowlist. |
| `inspect` | `{ "appId": "…" }` | Compact text, short refs such as `c1`, an opaque snapshot token, expiry, and explicit omission/redaction information. |
| `prepare_fill` | `{ "snapshotToken": "…", "fields": { "Name": "Ada" } }` | Literal field plan plus unresolved fields. `executed` is always `false`. |

For ambiguous labels, supply refs copied from the same observation:

```json
{
  "snapshotToken": "token-from-latest-inspect",
  "fields": [{ "ref": "c1", "value": "Ada" }]
}
```

Inspection defaults to 64 controls and 4,000 text characters. Optional `maxControls` supports 1–128; `maxTextChars` supports 0–16,000. Output excludes images, native element IDs, and geometry. Control details have additional fixed caps, with truncation disclosed.

Only the latest successful snapshot can prepare fields, and it expires 30 seconds after native capture. Starting a new observation invalidates previous refs, even if the refresh fails. Native calls are serialized, with at most four pending tool calls. Cancelling an active tool call invalidates the current observation. Terminating the server cancels the native helper.

Preparation accepts 1–32 fields, at most 2,000 characters per value and 16,000 characters total. It matches exact normalized labels or current short refs. Unknown fields, ambiguous labels, duplicate targets, disabled controls, sensitive values, and controls without native editable capabilities remain unresolved. OCR-only targets cannot receive prepared fills. The returned plan is a snapshot-based proposal, not verification that the UI has remained unchanged.

## Measuring usefulness

Run the local, keyless benchmark with:

```sh
npm run benchmark:context
```

See the [developer evaluation report](evaluation-developer.md) for the exact fixtures, named encoding, results, and limitations.

The reproducible context benchmark compares the exact compact tool result with a raw **text-only** native snapshot of the same synthetic form. It counts using the named tokenizer and includes production tool schema/instructions overhead separately. Image payloads are excluded from both sides. Omission, redaction, and target coverage must accompany any percentage: a shorter result alone does not prove equivalent usefulness.

The desktop agent also sends each Jev candidate ID and label once in the choice criteria, removing the previous duplicate candidate list from shared state. The evaluation reports before/after request-context counts for this change separately. All candidates remain available to Jev; the smaller payload does not establish unchanged model behavior or improved task quality.

UTF-8 byte counts and tokenizer counts are exact for the serialized strings and named encoding. They are not provider billing or model-specific inference usage. A future execution benchmark needs paired runs with the same tasks, model, app state, approvals, and success criteria; provider-reported input/output/cached tokens; all specialist and fallback costs; wall time; retries; and independently verified outcomes. Report failures and abstentions alongside success. Do not infer universal savings from form-only fixtures.

## What the Cua-S1 thread establishes

The [five-post announcement](https://x.com/trycua/status/2101014004927729737) describes a narrow form specialist: choose document values and fixed actions in one batch, then let deterministic code order and validate execution. Otto's MCP interface implements context and preparation only. The separate desktop [reviewed fill workflow](verified-fills.md) applies supplied literal values after human review, with fresh native target checks and readback; it does not include a learned form specialist or accept execution approval from MCP.

The [published model card at revision 4171435](https://huggingface.co/cua-ai/cua-s1-forms/blob/4171435d90e7fd78d6d3f0e78b1c4e4cca896706/README.md) describes a 706,048-parameter byte transformer with an option-attention head. It reports 99.95% synthetic decision accuracy and 100% on 196 decisions from three demo forms. These are author-reported choice accuracies, not independently reproduced end-to-end task success or token/cost measurements. Its hosted-Jev comparison also mixes learned no-op conventions with action judgments. The [MIT dataset card at revision 8273f34](https://huggingface.co/datasets/cua-ai/cua-s1-forms/blob/8273f34778b99ac2e12d9f6e7d57dad99ae20845/README.md) describes synthetic form-signature splits and a small demo evaluation.

There is a release consistency gap as inspected on September 18, 2026. The Hugging Face model repository publishes an MIT-tagged `.pt` checkpoint, while the [GitHub source README at 83f142c](https://github.com/trycua/cua/blob/83f142c4290a0f7d9ed545ae8532858c6e4f8145/libs/cua-s1/README.md) describes a source-only release and requires safetensors plus JSON. Its portable driver does not advertise the value-mutation capability required for fills. The model card's linked results document was absent from that Git tree. These exact source and artifact revisions should be reconciled before reproducing the reported model results. Otto does not download, load, or redistribute these weights.

Useful source patterns include [separate execution/submission flags and reobservation after each mutation](https://github.com/trycua/cua/blob/83f142c4290a0f7d9ed545ae8532858c6e4f8145/libs/cua-s1/python/src/cua_s1/planner.py#L210), and [separate accuracy, coverage, wrong-target, and unsafe-action metrics](https://github.com/trycua/cua/blob/83f142c4290a0f7d9ed545ae8532858c6e4f8145/libs/cua-s1/evals/metrics.py#L34). Otto's developer interface does not import Cua-S1 code or assert its benchmark results as Otto results.
