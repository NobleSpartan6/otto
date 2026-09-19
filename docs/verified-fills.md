# Review once, verify every field

Otto's **Fill a form** workflow applies an exact set of native text edits with one review. It is intended for supplied values such as project settings, repetitive setup forms, and data already prepared by a coding agent. It requires no provider key and makes no model request.

1. Open the target form and choose **Fill a form** in Otto.
2. Choose one app and paste a flat JSON object whose keys match the visible native field labels.
3. Allow local inspection, then choose **Review fields**. Preparation changes nothing.
4. Review every current and proposed value. **Fill N fields** authorizes only those exact edits.
5. Read the receipt. A completed fill means every requested value matched a final native readback. Export the JSON receipt if needed.

```json
{
  "Project name": "Otto Demo",
  "Repository URL": "https://code.example.invalid/otto-demo",
  "Local directory": "/tmp/otto-demo",
  "Package manager": "npm",
  "Test command": "npm test",
  "Notes": "Local fixture only — no files changed."
}
```

These strings are data, including text that resembles a command or path. The fill engine does not run them as commands. The target application can still interpret its inputs, autosave, run validators, or trigger other effects when values change. Review the app and values accordingly. Otto issues no Submit, click, or keyboard action in this workflow; readback does not establish persistence or external submission.

## Execution contract

The review is immutable and expires after two minutes. Any edit or new attempt requires a fresh review. Before the first write, and again before every following write, Otto checks all requested fields against their expected values. It binds the selected app/process, native window identity, available document identity, native control identities, labels, roles, and native editable-field structure. It then fills one field, reads the result, and checks the complete requested set again at the end.

Unknown or duplicate labels, protected fields, disabled fields, unreadable current values, OCR-only targets, and missing native identities cannot receive approval. The limit is 16 fields, 2,000 characters per value, and 16,000 characters in total. Exact native readback is required; normalization or a plausible screenshot is insufficient.

Stop revokes pending execution and terminates native work. A timed-out or uncertain write is never retried automatically. Receipts distinguish verified values, an unverified dispatched write, and fields not executed. Earlier changes may remain. There is no rollback guarantee.

Some applications reuse the same native controls across logical documents or provide incomplete accessibility information. Native identity and structural checks cannot prove every hidden application state. Use a stable, visible form; this is not a general transactional editing API.

## Coding agents

The [MCP interface](developer-tools.md) remains scoped, read-only inspection and preparation. It does not execute fills or approve on the user's behalf. A coding agent can prepare the literal field map; the user reviews and applies it in Otto. Costs of generating those values belong to the host agent and are separate from Otto's zero-model-call fill execution.

## Task dictation

The composer microphone starts a short native dictation session. Stop adds the transcript to the editable task draft; Cancel discards it. Dictation never starts a task, submits a form, or grants approval. Typed text remains available if speech recognition fails.

On macOS, Otto requires a recognizer reporting on-device support and sets `requiresOnDeviceRecognition`. On Windows it uses an installed System.Speech recognizer. Availability depends on the OS, speech language, installed speech components, input device, and permissions. There is no cloud-recognition fallback. Otto does not save audio; a transcript is held in the draft and enters the normal task/provider flow only when the user starts that task.

Native speech contracts: [Apple on-device recognition](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition), [Microsoft SpeechRecognitionEngine](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine).

## macOS installation and access

Mac alpha bundles use ad-hoc integrity signing, without a Developer ID or notarization. Release CI verifies the complete bundle with `codesign --verify --deep --strict` before upload. Ad-hoc signing does not identify a trusted publisher, and an update may require renewing macOS app authorization.

Choose **Open system permissions**, enable the installed Otto app under Accessibility, then return. Otto rechecks when its window regains focus and reconnects an idle native helper when needed. After an update, an enabled entry can still reference an older build. If access remains unavailable, remove the old Otto entry and add the final installed `/Applications/Otto.app` again. Otto does not bypass the OS grant. Stable publisher identity and smoother distribution require Developer ID signing and notarization, which this alpha does not provide.

Screen capture is optional for text-only tasks. A key saved only for the current session must be entered again after the application restarts; **Remember keys** uses OS-protected storage only when explicitly selected. The current installed-build authorization result is recorded separately in [validation](validation.md); a checked Settings entry alone does not prove native access.
