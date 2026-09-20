# Agent bridge native evaluation

This manual smoke benchmark compares one delegated six-field desktop task with seven host tool calls: inspect once, then fill six controls using the fresh observation returned after each action. Both variants use the same literal values and fresh copies of the same blank native AppKit fixture. The host caller is deterministic; no model plans the task.

Run only after building the current agent bridge, on an unlocked macOS desktop with existing Accessibility permission:

```sh
npm run build
npx tsx tests/native/agent-bridge-smoke.ts
```

The harness launches only disposable fixture applications and scopes each MCP server to its exact new PID with `--allow-actions`. It never targets an existing user application, requests an OS permission, reads a provider key, or submits the fixture. A missing permission is recorded as blocked. Server build and source hashes are captured before and after; concurrent changes invalidate the run. Do not run another desktop automation suite concurrently.

## Cases and checks

| Case | MCP workflow | Required independent result |
| --- | --- | --- |
| Baseline | `inspect` + six `act` calls, each using returned current references | Six exact native field values, six writes, no submit or reset |
| Delegated | One `run_steps` call containing those same six fills and exact expected values | Same six values and writes; verified receipt agrees with fixture state |
| Changed field | One `run_steps`; fixture changes Notes after the first write | Stop after one write, preserve changed Notes, leave remaining fields blank, no false verified receipt |

The oracle is the fixture-owned `state.json`, read independently of MCP responses. Action acceptance alone is insufficient. Every attempt retains its full tool arguments/results, initial/final oracle, receipt, errors, stderr, and cleanup result under `output/agent-bridge/<timestamp>/`. The final report includes failed and blocked attempts. Fixture processes are terminated only after checking that each PID still belongs to the exact launched executable.

## Accounting boundary

The tokenizer is `js-tiktoken` 1.0.21, `o200k_base`. Each counted exchange is the exact JSON serialization of `{name, arguments}`, a newline, and the complete MCP `callTool` result. Exchanges are joined with newlines. Runtime IDs and receipts are retained without canonicalization. Tool schemas and server instructions are reported separately, then once alongside the transcript; MCP initialization and `listTools` transport chatter are not counted as task calls.

These are reproducible text-payload counts, not provider billing, model-specific prompt formatting, cumulative context replay, cached tokens, image-token usage, or measured inference cost. No screenshot payload is accepted into the text calculation. Elapsed time covers the task calls and local processing after MCP startup/schema discovery; fixture compilation and launch are excluded. One pair cannot establish a latency distribution.

## Acceptance and limits

All three cases must pass; an incorrect value, extra native write, submit/reset, overwritten external edit, false verified receipt, leaked fixture process, or source drift fails the run. No successful-only aggregate is produced when either comparison variant fails.

This evaluation can support a narrow statement about equivalent six-field fixture outcomes and host transcript size for this bridge version. It does not establish general desktop success, live-agent reasoning quality, Jev quality, Windows support, universal token savings, or state-of-the-art performance. A live host-agent comparison requires separately recorded prompts, model/version, retries, provider usage, and independently graded multi-application outcomes.

`desktop/agent-server.test.ts` separately exercises the official MCP SDK's in-memory transport with a synthetic native driver. Protocol cases cover launcher authority, fresh action readback and replay refusal, exact app-name/restart scope, workflow receipts, rejected writes, cancellation before dispatch, and OCR labels that duplicate native labels. These are offline protocol tests, not native execution evidence.

## Recorded attempts

The corrected third run passed all three cases on macOS arm64 / Node v26.8.1, September 20, 2026 UTC. Report: `output/agent-bridge/2026-09-20T00-15-53-517Z/report.json`; SHA-256: `4db0a987f2b736cbf5f2ab0c5c72c84f64a629f458df6ee3b00d17869ddb0e31`. Source and built-runtime hashes remained unchanged during execution. Every fixture child was cleaned up.

| Metric | Sequential baseline | `run_steps` |
| --- | ---: | ---: |
| Host task calls | 7 | 1 |
| Exchange UTF-8 bytes | 23,817 | 1,308 |
| Exchange `o200k_base` tokens | 6,667 | 300 |
| Tools + instructions tokens, once | 1,221 | 1,221 |
| Exchange + schema/instructions tokens | 7,888 | 1,521 |
| Independent native writes | 6 | 6 |
| Task-call elapsed milliseconds, one trial | 7,752 | 6,958 |
| Independent final field matches | 6/6 | 6/6 |

The measured exchange payload was 95.5% smaller; counting the shared schemas/instructions once, it was 80.72% smaller. Neither percentage is provider token billing or inference savings. The delegated receipt recorded 14 native observations and zero model calls. It still performs fresh native checks locally; this is a reduction in host exchanges, not a claim that native work disappeared.

The changed-field case also passed: one native write, three observations, then a stopped receipt; the injected Notes edit remained intact and the other four unfilled fields stayed blank. It issued no submit or reset. One pair and one fault case establish this fixture behavior only, with no statistical reliability or speed claim.

The first native run is retained at `output/agent-bridge/2026-09-20T00-09-12-940Z/report.json`. The baseline passed with seven host calls, 6,664 exchange tokens, and six independently recorded writes. Both delegated cases stopped before dispatch because each native field label also appeared as an OCR label, making the initial matching rule ambiguous. Both recorded zero writes; the fault injection therefore never ran. All three fixture processes were cleaned up and source hashes remained unchanged. The comparison is invalid for savings claims, and its report contains no successful-pair aggregate. A protocol regression covers this native/OCR overlap, corrected before the subsequent runs.

The second run is retained at `output/agent-bridge/2026-09-20T00-12-44-316Z/report.json`. The baseline and changed-field refusal passed. The ordinary delegated case wrote all six correct values, but its final inspection reconfigured the helper, resetting native identity tokens; the pinned-field check correctly refused those replacement tokens and the receipt stayed stopped. This attempt also has no successful-pair comparison. The fixture oracle confirms six writes for the ordinary case and one write for the fault case, with changed Notes preserved. All fixture children were cleaned up; source hashes remained unchanged. A separate protocol regression covers identity-preserving final inspection.
