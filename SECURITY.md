# Security model

Otto is a local desktop agent with user-level access to explicitly selected applications. It is not a sandbox for those applications. Start with disposable tasks and review each proposed action in this alpha.

The Electron renderer has no Node.js access. Context isolation, sandboxing, CSP, navigation blocking, and sender-validated IPC protect the local control boundary. Native helpers have no model credentials and accept enumerated JSON operations over private pipes. App content and model replies cannot change the application allowlist.

Native targets expire after 30 seconds and are consumed before dispatch. Helpers recheck process/window identity and supported operations. An uncertain native error is never retried automatically. OCR click targets come from local image analysis; helpers require the original window, point containment, verified foreground ownership, and an unchanged target image patch.

All native effects in the initial Guided mode require exact-action approval. Completion is user-confirmed. The global stop shortcut, Stop button, app shutdown, provider cancellation, and helper termination prevent further queued actions. They do not reverse effects already delivered.

Known limits: accessibility providers can be incomplete or misleading; OCR can misread labels; small image comparisons do not prove unchanged semantics; applications may have surprising effects behind ordinary buttons. Prompt injection is treated as untrusted data but remains an evaluation concern. Screenshots can contain private content outside what native field filtering can recognize.

Do not expose the native helper through a network service, bypass OS permission prompts, reuse someone else's subscription credentials, or disable TLS verification. Report vulnerabilities privately to the repository maintainer through GitHub before publishing sensitive reproduction details.
