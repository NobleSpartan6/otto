# Otto

An open-source desktop computer-use agent for **macOS and Windows**. Otto combines TypeSafe Jev decisions with an optional GPT-6 Astra planner, and can apply an exact set of form values after one review without calling a model. It works through native accessibility controls and local OCR.

**Status: early development alpha.** Native controls have been tested on macOS and Windows. Broad app compatibility, model-driven task success, trusted publisher signing, and subscription sign-in remain unverified or unfinished. See [validation](docs/validation.md).

[Download alpha builds](https://github.com/NobleSpartan6/otto/releases) · [Project page](https://noblespartan6.github.io/otto/) · [Technical spec](docs/technical-spec.md)

## How it works

Choose the workflow that matches the work:

| Workflow | Input and review | Model access |
| --- | --- | --- |
| **Guided task · Jev-only** | A goal, selected apps, and approval of each concrete action. Quote exact text to enter. | TypeSafe key |
| **Guided task · Hybrid** | The same action review, with subgoals and text drafts from the planner. | TypeSafe and OpenAI Platform keys |
| **Fill a form** | A literal field map for one app; review all before/proposed values once. Each write and the final field set are checked through native readback. | No model calls or key |
| **Agent bridge (source build)** | Scoped native inspection, actions, verified workflows, and optional bounded Jev delegation from Codex or another MCP host. | Exact actions: no Otto key. Delegation: TypeSafe key |

For a guided task:

1. Select the running apps Otto may use and describe a task.
2. Otto reads those apps through macOS Accessibility or Windows UI Automation. Local OCR adds text targets missed by accessibility.
3. In Hybrid mode, GPT-6 Astra provides a plan and generated text when needed. Jev chooses concrete actions between planning calls.
4. Otto presents the exact action before it executes. The next observation checks what changed.
5. You confirm the final result. Model confidence is shown as a model score, not a guarantee of success.

Jev-only mode requires just a TypeSafe key. Quote exact text you want entered, for example: `In TextEdit, enter “Hello from Otto”.` Hybrid mode also requires an OpenAI Platform API key. A ChatGPT subscription does not automatically provide API credits; see [subscription connection](docs/subscription-connection.md).

Native operations include press/invoke, text-field values, supported scrolling, switching selected apps, and bounded Enter/Escape/Tab keys. OCR clicks are tied to the observed window, checked against a fresh image patch, and require approval. Canvas and icon-only interfaces remain a limitation; the planner cannot invent unrestricted coordinates or shell commands.

For supplied values, choose **Fill a form**. Preparation changes nothing; approval covers only the reviewed edits. The fill stops on changed targets or values and records partial results without automatic rollback. No submit action is issued, although the target app may autosave or react to changed values. See the [reviewed fill contract](docs/verified-fills.md).

The microphone can dictate into an editable task draft using available on-device speech recognition. Dictation never starts a task or grants approval. OS, language, device, and permission support vary; there is no cloud fallback.

## Getting started

Downloadable builds bundle the runtime. Native access requires OS permissions; guided tasks also require your own API keys. Current macOS packaging uses ad-hoc integrity signing, without Developer ID signing or notarization; Windows publisher signing is not configured. Read each release's notes before installing.

To build from source: Node.js 24+, npm, macOS 14+ with Xcode command-line tools, or Windows 10/11 with Windows PowerShell 5.1. Linux can build the website but does not have a native control adapter.

```sh
git clone https://github.com/NobleSpartan6/otto.git
cd otto
npm install
npm run dev
```

If your package manager disables dependency installation scripts, run `node node_modules/electron/install.js` to install Electron from its official distribution. On macOS, the native build uses Xcode when available to avoid mismatched command-line SDKs.

For guided tasks, paste your TypeSafe key into **Connections** and click **Save connection**. Jev-only mode is selected by default; no OpenAI key is required. **Fill a form** needs no provider connection.

For your first task:

1. Open a blank document in TextEdit (macOS) or Notepad (Windows).
2. Allow Accessibility when prompted, then click **Check again**.
3. Use **Choose apps** to select that app, then click **Try a simple first task**.
4. Allow selected-app text to be sent to TypeSafe, click **Start task**, and review each proposed action.
5. Confirm the result when the text appears.

A saved key has not yet been verified against TypeSafe; the first guided task makes the live request. Add an OpenAI API key under **OpenAI planner** in Connections to use Hybrid mode. Keys remain in the main process; optional persistence uses Electron's OS-backed encryption. Session-only keys must be entered again after restarting. The renderer never receives stored keys.

On macOS, grant Otto Accessibility permission. Screen Recording is optional for text-only tasks and required for window previews, local OCR, and visual planning. Windows access is limited to the normal user desktop; elevated apps and UAC screens are unsupported.

**Stop:** use the Stop button or **Command/Ctrl + Shift + Backspace**. Stop cancels future dispatch; it cannot undo an input already delivered to an app. Close Otto to terminate its helper.

## Privacy and control

- Only explicitly selected running apps are observed; Otto's own UI and protected system dialogs are excluded.
- Guided tasks send selected app text to TypeSafe. Hybrid mode sends selected app observations to OpenAI. Sending window screenshots to OpenAI requires a separate opt-in. Reviewed form fills run locally without provider calls.
- OCR runs locally with bundled English language data; it does not download models at runtime.
- Password controls are excluded from native actions and text observations. Screenshots may still contain private information visible in the selected window.
- No public remote-control listener or unauthenticated localhost API is exposed. Native helpers communicate through private child-process pipes.
- Guided-task exports omit screenshots and raw app observations; task descriptions and action labels can still contain user-entered data. Fill receipts include reviewed and read-back field values. Review exports before sharing.
- Dictation keeps audio in memory and does not save audio files. Its transcript becomes draft text; starting a guided task sends that text through the normal provider flow. MCP output goes to the host agent, which may send it to its provider.

## Development

```sh
npm run check       # TypeScript, tests, native helper, frontend build
npm run dev:web     # distribution website preview
npm run package     # installer for the current OS
npm run test:ui     # isolated Electron UI fixtures after building
npm run test:batch-native # disposable macOS form fixture; requires native permissions
npm run benchmark:context # reproducible representation/tokenizer comparison
```

`core/` contains provider adapters, candidate construction, the bounded task loop, and the reviewed fill engine. `desktop/` contains Electron IPC, local OCR, dictation, and native helpers. `shared/` owns the protocol types. `src/` is the desktop UI and distribution site.

See the [technical spec](docs/technical-spec.md), [evaluation plan](docs/evaluation.md), and [reference architecture analysis](docs/reference-architecture.md). GPT-6 Pro was consulted on the architecture; its advice is evaluated against actual implementation and tests.

The redesigned agent workspace follows an [assessment of Diffusion Studio's installed app and source, plus Cua](docs/design/agent-workspace.md). Task preparation, action review, and result verification stay distinct; routine activity is expandable.

## For Codex and other coding agents

Otto's source-build **agent bridge** lets a coding agent inspect an explicitly scoped native app, execute a known sequence locally, and receive a compact receipt. `run_steps` makes no model calls and checks supplied final values/text against native state. `act` supports individual fresh-reference actions. Optional `delegate` lets Jev choose among the host's explicit, single-use permitted actions; it stops on uncertainty instead of inventing actions or text.

The bridge is read-only unless started with `--allow-actions`. Host task authorization still applies. It supports exposed native press/fill/vertical-scroll controls and Enter/Escape/Tab; it does not yet provide arbitrary visual grounding, drag, app launch, or a browser DOM driver. See [Codex setup](docs/agent-bridge.md), the [real Codex usage comparison](docs/evaluation-codex-agent-bridge.md), [native execution evaluation](docs/evaluation-agent-bridge.md), and the [older read-only context/preparation server](docs/developer-tools.md). The installed Alpha4 app remains a separate workflow.

## Distribution

Build on each supported OS. macOS packages require Developer ID signing and notarization for a smooth public install; Windows installers require Authenticode signing to establish publisher identity. The macOS ad-hoc signature checks bundle integrity and is verified in release CI; it does not establish a trusted publisher or remove Gatekeeper prompts. These artifacts remain alpha releases.

## Credits and license

MIT © 2026 Otto contributors. TypeSafe Jev and OpenAI models are external services, not part of Otto's open-source license.

Architecture informed by [Aaron Levin's typesafe-computer-use](https://github.com/awlevin/typesafe-computer-use), an MIT-licensed OCR/Jev prototype. Otto's native adapters and application are independently implemented. Its published cost/latency figures are not Otto benchmarks.
