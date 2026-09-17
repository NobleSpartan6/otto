# Windows accessibility helper

`otto-uia.ps1` uses Windows PowerShell 5.1, .NET UI Automation, and User32. It requires no Python, browser driver, or separately installed .NET SDK.

The desktop host starts it as a child process:

```text
powershell.exe -NoLogo -NoProfile -NonInteractive -Mta -ExecutionPolicy Bypass -File otto-uia.ps1
```

The process accepts JSON lines on stdin and writes only JSON responses to stdout. Each request carries a string `id` and an `op`; responses preserve `id` with either `{ok:true,result}` or `{ok:false,error}`. The shared TypeScript contract is in `shared/types.ts`.

Supported operations:

- `permissions` and `requestPermission`: report whether UI Automation is available. Windows does not expose a macOS-style permission prompt for these APIs. This does not imply access to elevated apps, UAC prompts, locked desktops, or every app's screenshot.
- `apps`: list visible applications, with opaque IDs tied to process ID and process start time.
- `configure`: replace the explicit application allowlist and discard all observations. An empty list revokes access.
- `observe`: inspect only a selected application and keep native element references for its snapshot. Password and recognizably sensitive fields expose no value or action.
- `act`: use only the snapshot's native controls. Observations expire after 30 seconds and are consumed before any action. The adapter rechecks process identity, window ownership, element identity, visibility, enabled state, and ancestry.

Control actions are `press`, `fill`, `scrollUp`, and `scrollDown`, depending on UI Automation patterns reported by that control. Press uses Invoke, Toggle, SelectionItem, or ExpandCollapse. Fill uses ValuePattern; scrolling uses ScrollPattern. Activate asks Windows to foreground the selected application and verifies that it did. A separate `key` action accepts exactly `enter`, `escape`, or `tab`; the helper sends fixed keycodes only after validating the snapshot and exact foreground window. Held modifier keys cause rejection. There is no arbitrary command execution, selector evaluation, keyboard shortcut grammar, or freeform key injection.

The desktop main process can map a current OCR target to an internal `click` request with an absolute pixel `point`. This transport action is not exposed directly to the renderer or model. It requires the saved screenshot, matching snapshot/app, unchanged window rectangle, valid process identity, the exact selected window in foreground, and a hit-test at the point resolving to that window. Points outside the capture or inside known sensitive native fields are rejected. A fresh `PrintWindow` capture must also match a 64-pixel neighborhood around the target before one Win32 move/down/up batch is injected. The snapshot is consumed even if verification or injection fails.

Screenshots use `PrintWindow` for the selected window only and return `windowBounds` plus the actual pixel `screenshotSize`. Known sensitive native rectangles are filled black before screenshot serialization and returned as `protectedBounds` for defensive OCR filtering. Fresh captures used for click verification apply the same snapshot-specific masks. Some GPU-rendered apps return blank images or do not support this API; screenshot failure does not fall back to capturing unrelated desktop content, and OCR clicks then remain unavailable. Native controls retain their UIA execution path. OCR recognition itself runs locally in the desktop main process using packaged Tesseract assets.

Image-patch matching is a guard against stale visual targets, not proof of semantic identity. Focus highlights and animations may cause a safe refusal. A window can still change between the final check and OS input injection; no desktop API makes those operations atomic. Coordinates on mixed-DPI monitors, occlusion, foreground restrictions, and blank GPU captures require real Windows validation.

The host must enforce a child-process timeout and terminate the helper on cancellation. UI Automation providers and `PrintWindow` can block, and the helper must not automatically repeat an action whose outcome is unknown.

Validation on the macOS development host covers PowerShell parsing, embedded C# compilation, and JSON protocol failure behavior. Actual UI Automation and window capture need a Windows smoke test before a Windows release is described as verified. Use a standard, non-elevated Notepad or similar test app; avoid real private data.
