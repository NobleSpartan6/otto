# Actual Codex usage: one native form task

On 2026-09-20 UTC, two fresh Codex CLI runs filled the same six-field macOS fixture through Otto. One used `inspect` followed by six `act` calls; the other used one `run_steps` call. An independent fixture oracle confirmed all six exact values, six native write attempts, six field changes, and zero submits or resets in both runs.

| Observed measure | Inspect + six actions | One workflow |
| --- | ---: | ---: |
| Host MCP calls | 7 | 1 |
| Reported input tokens, including cached input | 191,645 | 53,072 |
| Reported cached input tokens | 164,608 | 34,688 |
| Uncached input, derived by subtraction | 27,037 | 18,384 |
| Reported output tokens | 509 | 226 |
| Reported reasoning output tokens | 0 | 0 |
| CLI run and bounded cleanup elapsed time | 49.137 s | 23.441 s |
| Independently correct fields | 6 / 6 | 6 / 6 |

In this pair, the workflow used **72.31% fewer reported input tokens**, including cached input; **32.00% fewer uncached input tokens**; and 55.60% fewer output tokens. Its measured elapsed time was 52.29% lower. These are actual completed-turn usage counters, not estimates from serialized text. They are **not billed savings**, a general reliability result, or a Jev comparison. Neither strategy invoked a model inside Otto.

## Conditions and limits

Both runs requested `gpt-6-astra` with low reasoning, used an empty temporary working directory, ignored user configuration, and exposed the same four Otto tools. The OS sandbox was read-only. Invocation-only preapproval for `act` and `run_steps` covered the same six authorized literal fills; each server was scoped to its newly launched fixture's exact PID. Shell, other computer-use tools, plugins, and subagents were disabled. Actual tool events were checked for strategy compliance.

The fixture and compiled runtime were hashed and checked for changes. Each arm began with six blank fields. The oracle was read by the harness, never exposed to Codex. Child processes were cleaned up using their recorded identity. Normal-account Codex authentication was used; the harness did not read provider keys or alter project/global settings.

This is one authored form, one trial per strategy, baseline first. Provider caching and order effects were not controlled. Elapsed time includes CLI/MCP/native work and bounded cleanup, but excludes fixture compilation, setup, and grading. Model routing, hidden provider retries, and invoices are not fully observable from these counters. Larger paired, randomized task sets are required before claiming general savings or equivalent quality.

## Retained failures and grader correction

An earlier pair was blocked before any writes because `approval=never` conflicted with the default mutating-tool approval requirement. Its usage is retained: baseline 74,316 input / 54,400 cached / 193 output tokens; workflow 53,060 input / 34,688 cached / 292 output tokens. Those failed attempts are not included in the successful-pair reductions. One fixture briefly became a zombie after SIGTERM; it was later confirmed reaped and its temporary directory removed.

The corrected pair initially failed the harness because Codex emitted its `skip_host_skill_discovery` startup warning as an error-typed item. The grader mistook it for an unexpected tool. Saved events were regraded **without new Codex calls**: only that exact event type and complete warning text are classified as a retained notice; every other error remains fatal. The original reports and raw traces were preserved alongside the separately labeled regrade. Grader SHA-256: `dde7a6e9b3b2725dc18072da8fc1460dee675e96ebfa3e593537bfe99c7b148e`.

Local evidence directories, intentionally excluded from Git:

- `output/codex-agent-bridge/2026-09-20T00-16-41-507Z/`: blocked initial pair and cleanup follow-up.
- `output/codex-agent-bridge/2026-09-20T00-20-21-643Z/`: raw corrected pair, original failed grader reports, and `regrade.json`.

## Reproduce

Build the current source and reserve the interactive desktop. This command launches two fresh fixtures and consumes normal Codex account usage:

```sh
npm run build
npx tsx tests/native/codex-agent-bridge-eval.ts --run
```

The [harness](../tests/native/codex-agent-bridge-eval.ts) records JSONL events, stderr, final responses, prompts, invocation arguments, hashes, oracle states, and failures. Without `--run`, it prints help and performs no trial.

The usage fields follow [Codex JSON event documentation](https://learn.chatgpt.com/docs/non-interactive-mode). The narrow tool approval override is documented in the [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). See the [agent bridge setup](agent-bridge.md) and [broader evaluation plan](research/otto-direction.md).
