# Otto

An open-source desktop computer-use agent for **macOS and Windows**. Otto combines fast TypeSafe Jev decisions with an optional GPT-6 Astra planner. It works through native accessibility controls and local OCR, rather than a browser-only sandbox.

**Status: early development alpha.** This is not yet a validated SOTA release. Windows execution, broad task success rates, signed installers, and subscription sign-in must be verified before a general launch. See [validation](docs/validation.md).

[Download alpha builds](https://github.com/NobleSpartan6/otto/releases) · [Project page](https://noblespartan6.github.io/otto/) · [Technical spec](docs/technical-spec.md)

## How it works

1. Select the running apps Otto may use and describe a task.
2. Otto reads those apps through macOS Accessibility or Windows UI Automation. Local OCR adds text targets missed by accessibility.
3. In Hybrid mode, GPT-6 Astra provides a plan and generated text when needed. Jev chooses concrete actions between planning calls.
4. Guided mode presents the exact action before it executes. The next observation checks what changed.
5. You confirm the final result. Model confidence is shown as a model score, not a guarantee of success.

Jev-only mode requires just a TypeSafe key. Quote exact text you want entered, for example: `In TextEdit, enter “Hello from Otto”.` Hybrid mode also requires an OpenAI Platform API key. A ChatGPT subscription does not automatically provide API credits; see [subscription connection](docs/subscription-connection.md).

Native operations include press/invoke, text-field values, supported scrolling, switching selected apps, and bounded Enter/Escape/Tab keys. OCR clicks are tied to the observed window, checked against a fresh image patch, and require approval. Canvas and icon-only interfaces remain a limitation; the planner cannot invent unrestricted coordinates or shell commands.

## Getting started

Downloadable builds bundle the runtime; they require your own API keys and OS permissions. These alpha installers are unsigned and not notarized. Read their release notes before installing.

To build from source: Node.js 24+, npm, macOS 14+ with Xcode command-line tools, or Windows 10/11 with Windows PowerShell 5.1. Linux can build the website but does not have a native control adapter.

```sh
git clone https://github.com/NobleSpartan6/otto.git
cd otto
npm install
npm run dev
```

If your package manager disables dependency installation scripts, run `node node_modules/electron/install.js` to install Electron from its official distribution. On macOS, the native build uses Xcode when available to avoid mismatched command-line SDKs.

In Settings, enter your TypeSafe key. Add an OpenAI API key for Hybrid mode. Keys remain in the main process; optional persistence uses Electron's OS-backed encryption. The renderer never receives stored keys.

On macOS, grant Otto Accessibility permission. Screen Recording is optional for text-only tasks and required for window previews, local OCR, and visual planning. Windows access is limited to the normal user desktop; elevated apps and UAC screens are unsupported.

**Stop:** use the Stop button or **Command/Ctrl + Shift + Backspace**. Stop cancels future dispatch; it cannot undo an input already delivered to an app. Close Otto to terminate its helper.

## Privacy and control

- Only explicitly selected running apps are observed; Otto's own UI and protected system dialogs are excluded.
- Selected app text is sent to TypeSafe. Hybrid mode sends selected app observations to OpenAI. Sending window screenshots to OpenAI requires a separate opt-in.
- OCR runs locally with bundled English language data; it does not download models at runtime.
- Password controls are excluded from native actions and text observations. Screenshots may still contain private information visible in the selected window.
- No public remote-control listener or unauthenticated localhost API is exposed. Native helpers communicate through private child-process pipes.
- Exported traces omit screenshots and raw app text; task descriptions and action labels can still contain user-entered data.

## Development

```sh
npm run check       # TypeScript, tests, native helper, frontend build
npm run dev:web     # distribution website preview
npm run package     # installer for the current OS
```

`core/` contains provider adapters, candidate construction, and the bounded task loop. `desktop/` contains Electron IPC, local OCR, and native helpers. `shared/` owns the protocol types. `src/` is the desktop UI and distribution site.

See the [technical spec](docs/technical-spec.md), [evaluation plan](docs/evaluation.md), and [reference architecture analysis](docs/reference-architecture.md). GPT-6 Pro was consulted on the architecture; its advice is evaluated against actual implementation and tests.

## Distribution

Build on each supported OS. macOS packages require Developer ID signing and notarization for a smooth public install; Windows installers require Authenticode signing to establish publisher identity. A local development certificate is not a substitute. Do not describe unsigned alpha artifacts as a production release.

## Credits and license

MIT © 2026 Otto contributors. TypeSafe Jev and OpenAI models are external services, not part of Otto's open-source license.

Architecture informed by [Aaron Levin's typesafe-computer-use](https://github.com/awlevin/typesafe-computer-use), an MIT-licensed OCR/Jev prototype. Otto's native adapters and application are independently implemented. Its published cost/latency figures are not Otto benchmarks.
