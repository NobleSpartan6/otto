# Otto agent workspace

Design assessment, 18 September 2026. Implemented independently; no Diffusion source copied.

## Evidence

Installed Diffusion Studio version: **0.205.2**, read from its application bundle metadata.

The installed Diffusion Studio app was inspected through Computer Use. At the observed 1223 × 768 capture, the left agent pane occupied about 275 image pixels while the canvas dominated. The composer remained at the bottom of that pane; its model control was quiet and internal to the composer. Chat/Assets, history, and new-chat controls formed a compact header. The provider menu explicitly showed an unavailable Codex installation. The existing project had no chat history, so running tools and approvals were studied in source, not claimed as live observations.

Source was pinned to Diffusion Studio [`0add88d`](https://github.com/diffusionstudio/editor/tree/0add88db090cd865bda7050af4a5979bc9482b58) and Cua [`83f142c`](https://github.com/trycua/cua/tree/83f142c4290a0f7d9ed545ae8532858c6e4f8145).

| Concern | Grounded finding | Otto decision |
| --- | --- | --- |
| Proportions | Diffusion [store.ts:402](https://github.com/diffusionstudio/editor/blob/0add88db090cd865bda7050af4a5979bc9482b58/apps/web/src/agent-chat/store.ts#L402) specifies a 340px chat panel; [chat-panel.tsx:138](https://github.com/diffusionstudio/editor/blob/0add88db090cd865bda7050af4a5979bc9482b58/apps/web/src/agent-chat/chat-panel.tsx#L138) uses a 48px header and permanent composer. | Compact agent pane beside a generous app surface. Avoid a second empty activity card. |
| Type and space | Diffusion [composer.tsx:68](https://github.com/diffusionstudio/editor/blob/0add88db090cd865bda7050af4a5979bc9482b58/apps/web/src/agent-chat/composer.tsx#L68) uses 16px insets, 12px type/20px leading, and 12px radius. [index.css:6](https://github.com/diffusionstudio/editor/blob/0add88db090cd865bda7050af4a5979bc9482b58/apps/web/src/index.css#L6) bundles Inter/JetBrains Mono and restrained emphasis. | Preserve Otto's off-white, ink, and cobalt identity. Use more readable 13–14px primary product text, with smaller secondary metadata. Remove the desktop marketing heading. |
| Hierarchy | [items.tsx:70](https://github.com/diffusionstudio/editor/blob/0add88db090cd865bda7050af4a5979bc9482b58/apps/web/src/agent-chat/items.tsx#L70) uses 24px tool rows with details on demand. | Lead with goal, current state, and required decision. Collapse routine history; retain all evidence. |
| Progress | [transcript.tsx:47](https://github.com/diffusionstudio/editor/blob/0add88db090cd865bda7050af4a5979bc9482b58/apps/web/src/agent-chat/transcript.tsx#L47) owns scrolling and avoids a duplicate loader when tools already indicate progress. | One truthful current-status line. No invented percentage. Approval and verification are waiting states. |
| Interruptions | [question-card.tsx:58](https://github.com/diffusionstudio/editor/blob/0add88db090cd865bda7050af4a5979bc9482b58/apps/web/src/agent-chat/question-card.tsx#L58) anchors questions above the composer. Its [protocol.ts:71](https://github.com/diffusionstudio/editor/blob/0add88db090cd865bda7050af4a5979bc9482b58/packages/agent-chat/src/protocol.ts#L71) is question-only. | Borrow placement, not permission behavior. Otto retains its own action approvals and displays operation, app, target, and exact value. |
| Provider readiness | [model-picker.tsx:55](https://github.com/diffusionstudio/editor/blob/0add88db090cd865bda7050af4a5979bc9482b58/apps/web/src/agent-chat/model-picker.tsx#L55) gives missing providers specific states. | “Key added” is not “verified.” Keep configured keys in main; never read them into renderer fields. |
| Web/desktop | [connection.ts:14](https://github.com/diffusionstudio/editor/blob/0add88db090cd865bda7050af4a5979bc9482b58/apps/web/src/agent-chat/connection.ts#L14) resolves native capability, and the panel offers a desktop-download CTA without a host. | Public page explains and distributes the desktop app. Real desktop work begins only behind the native bridge. |
| Cua interaction | [ChatPanel.tsx:90](https://github.com/trycua/cua/blob/83f142c4290a0f7d9ed545ae8532858c6e4f8145/libs/typescript/playground/src/components/composed/ChatPanel.tsx#L90) exposes model/computer context; [ToolCallsGroup.tsx:68](https://github.com/trycua/cua/blob/83f142c4290a0f7d9ed545ae8532858c6e4f8145/libs/typescript/playground/src/components/primitives/ToolCallsGroup.tsx#L68) groups details. | Compact, explicit app scope and provider mode; quiet expandable activity. |

## Complete flow

Connect providers in a focused dialog; choose applications in a searchable picker; describe the task in a stable composer. Missing prerequisites explain their repair. A running task shows its goal and current subgoal. An approval is the main next action, above secondary activity. Errors retain context and offer a fresh attempt instead of replaying an old effect. Completion explicitly requires the user's verification and remains labeled user-confirmed.

Below the width where both panes remain usable, Task/App view controls retain their mounted content and scroll position. Stop and execution status remain available. Modal dialogs trap/restore keyboard focus; polling must not move focus; long lists, proposed values, and activity scroll within their surfaces.

## GPT-6 Pro consultation

This assessment and all five CUA-S1 thread posts were included in the existing [Otto consultation](https://chatgpt.com/g/g-p-6aab76ef83348191ba1a4f34ed604089-otto/c/6aab7709-8e24-83ea-acd3-ffb85c655d28), with the UI showing **6 Pro**. The response agreed with compact persistent task/app panes, truthful readiness, structured approvals, separate verification, and progressive disclosure. It recommended preserving execution policy while implementing a read-only developer interface first.

Accepted: compact current snapshots and inert preparation, explicit app scope, no screenshots or keys exported, exact declared-tokenizer measurements, coverage before savings. Deferred: cross-snapshot deltas (native IDs change), external execution/approval protocols, autonomous batch fills, and billed-savings claims. The current developer preparation result is not imported into Electron for execution; that handoff remains separate work.
