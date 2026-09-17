# Connecting a ChatGPT subscription

Status: researched on 2026-09-17; **not implemented or advertised as available**. Otto's core remains TypeSafe-only.

## What is supported

OpenAI documents **Codex App Server** as an integration for custom products. Its managed ChatGPT authentication can use a person's ChatGPT/Codex subscription. This is not an OAuth token for the general OpenAI Responses API; that API continues to use a separately billed Platform key.

Use a trusted **local companion for each user**, communicating with the official Codex runtime over stdio. Let Codex perform and retain authentication. The user signs in through the returned official URL; Otto must not read `auth.json`, copy access tokens, intercept refresh tokens, or relay the developer's subscription to hosted visitors.

Official JSON-RPC sequence (after the documented `initialize`/`initialized` handshake):

```json
{ "id": 1, "method": "account/read", "params": { "refreshToken": false } }
{ "id": 2, "method": "account/login/start", "params": { "type": "chatgpt" } }
```

The second call returns `loginId` and `authUrl`; open that exact returned URL. Codex hosts its localhost callback. Wait for `account/login/completed` with `success: true`; `account/updated` identifies `authMode: "chatgpt"` and the available plan type. No token handling is required in the companion.

For device-code sign-in, send `account/login/start` with `type: "chatgptDeviceCode"`, then display the returned `verificationUrl` and `userCode`. The same completion notifications apply. `account/login/cancel` cancels an unfinished flow and `account/logout` disconnects. Do not use experimental `chatgptAuthTokens` to scrape or repurpose another application's credentials.

Sources: [App-server authentication](https://learn.chatgpt.com/docs/app-server#authentication-modes), [Codex authentication](https://learn.chatgpt.com/docs/auth), [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk).

## Why the planner bridge is not enabled

Otto would pass arbitrary application content to this planner. A prompt injection inside a document or application must not be able to read unrelated local files, execute commands, access connected accounts, or modify the machine. A prompt saying “do not use tools” does not establish that boundary.

The official sources verify several controls, but not a complete inference-only mode:

| Control | Verified behavior | Remaining issue |
| --- | --- | --- |
| `features.shell_tool = false` | Disables the default shell tool | Not a documented global tool allowlist |
| `web_search = "disabled"` | Removes web search | Does not disable unrelated tools |
| Apps, plugins, hooks, MCP settings | Separate feature/server controls exist | Inherited configuration and future tool additions need fail-closed handling |
| Read-only sandbox | Stops writes under its policy | Defaults to **full read access**, so it alone does not protect host data |
| Restricted read roots | `readOnly.access` supports restricted roots | Must also isolate automatically loaded context and tools outside command sandboxing |
| Command network restrictions | Restrict sandboxed commands | Do not govern hosted tools, apps, connectors, or MCP transports |
| `dynamicTools` | Supplies custom client tools | Adds tools; no documented suppression of all built-ins |
| `outputSchema` | Constrains the final answer shape | Does not prevent tool execution while producing the answer |

Read-only protocol shape supports `access: { type: "restricted", includePlatformDefaults: false, readableRoots: [...] }`. This is useful defense in depth, but is not equivalent to disabling every tool.

The installed CLI reported `codex-cli 0.154.0-alpha.6.2`. Its read-only feature inventory marks `apply_patch_freeform` as **removed**, so it cannot be relied on to disable patch operations. Generating its app-server protocol schemas into a temporary directory confirmed no built-in `tools: []` or global tool allowlist parameter in `thread/start` or `turn/start`. No model turn, authentication flow, or untrusted session was started during this research.

Sources: [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), [Permissions and network boundaries](https://learn.chatgpt.com/docs/permissions), [App-server turn and sandbox controls](https://learn.chatgpt.com/docs/app-server).

## Required next step

Implement this only after either a supported tools-disabled interface is verified for a pinned Codex version, or a separately isolated runtime is built and tested. An isolated design must keep host files, inherited plugins/configuration, signed-in application sessions, and the Codex authentication store outside model-controlled execution. It must expose only Otto's bounded observation and plan exchange, enforce resource limits, deny unsolicited approval requests, and reject unexpected tool calls before execution. The default read-only preset and an empty working directory are not sufficient evidence of that isolation.

Until then, do not add a nonfunctional “Connect ChatGPT” button to the desktop app. If a paid optional planner is later wanted, the native Responses API with the user's Platform key supports a clean no-tools request; keep that explicitly separate from subscription access and from TypeSafe-only mode.
