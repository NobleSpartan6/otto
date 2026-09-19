# Otto general desktop evaluation — research and first 30 tasks

Checked 2026-09-19 UTC. Read-only source review; no benchmark environment, model calls, paid cloud resources, or user files were used. This is a proposed evaluation, not a result. The exact Koala reference is still pending; no competitor claim is inferred from that name.

## What the primary sources support

| Benchmark | Verified scope | Implication for Otto |
| --- | --- | --- |
| OSWorld-Verified | XLANG's July 2025 revision repaired 300+ reported task/environment/evaluator issues. Its maintainer instructions require comparable benchmark versions and a separate process for verified public leaderboard results. [Report](https://xlang.ai/blog/osworld-verified), [source](https://github.com/xlang-ai/OSWorld) | Use pinned versions and independent outcome graders. An Ubuntu score is not proof of native Mac/Windows capability; an adapted subset is not an official full-benchmark result. |
| OSWorld 2.0 | The June 28 paper, revised July 13, 2026, defines 108 long workflows, human median about 1.6 hours, and a 500-step primary completion metric. It separates binary completion, partial progress, and safety audits. [Paper v2](https://arxiv.org/abs/2606.29537v2) | Useful long-horizon target after basic reliability. Do not compare a six-field fixture or 30 short tasks to its headline results. |
| Current OSWorld-V2 release | The primary repository now recommends **osworld-v2.1**, released September 16, 2026. Code, gated tasks/assets, mock websites, and provider images must match that release; its supplied images are Docker/AWS Ubuntu environments. [Versioned README](https://github.com/xlang-ai/OSWorld-V2/blob/3d778a3c9a34a079316f70df023b166700445792/README.md) | Do not follow stale June/August setup instructions or describe paper results as current leaderboard scores. No gated data or infrastructure was provisioned here. |
| Windows Agent Arena | Microsoft provides 150+ Windows tasks, repeatable VM state, extensible agents, and local/Azure execution. Its repository identifies `predict()` and `reset()` as the agent interface and Windows 11 VM setup. [Paper](https://arxiv.org/abs/2409.08264), [source](https://github.com/microsoft/WindowsAgentArena) | Best existing Windows integration starting point; retain the benchmark's task contracts, Windows image, budgets, and evaluators. Historical Navi results are not a current state-of-the-art target. |
| MacArena | June 2026 paper: 421 tasks across 50 apps, including ported tasks and 49 new Mac-native tasks, on Apple Silicon virtualization. Public code and UTM VM setup exist. [Paper](https://arxiv.org/abs/2606.06560), [source](https://github.com/MacPaw/MacArena) | Strong first native-Mac harness candidate. Source README says inherited macOSWorld tasks carry noncommercial restrictions; check task-level licenses before redistributing a commercial eval bundle. This review did not boot or validate the image. |
| macOSWorld | Primary project lists 202 tasks, five languages, 28 Mac-exclusive apps, and 29 safety tasks, with state-reset and evaluator scripts. [Project](https://macos-world.github.io/), [paper](https://arxiv.org/abs/2506.04135) | Useful language and deceptive-context coverage. Do not equate these distributions with cross-platform workflows. |
| MacAgentBench | June 2026 paper and public repository describe 676 tasks across 25 apps, deterministic checks, and partial checkpoints. Nearly 60% involve GUI and CLI; the paper attributes much of the winning configuration's advantage to skill coverage. [Paper](https://arxiv.org/abs/2606.22557), [source](https://github.com/JetAstra/MacAgentBench) | Useful outcome/scoring examples. A GUI-only Otto versus a shell/AppleScript/skills-enabled framework is a system comparison with different powers, not an equal-tools model comparison. Do not silently grant Otto extra APIs just to reproduce the headline. |

Repository HEADs observed through GitHub API: OSWorld `b138d348256078fa634fc3b73567a7337c793e6b`; OSWorld-V2 `3d778a3c9a34a079316f70df023b166700445792`; WAA `6d39ed88c545a0d40a7a02e39b928e278df7332b`; MacArena `dcdc7d366da12641578ab90f085d69db91651c58`; MacAgentBench `65632d1479bfb3aa1d2d3e292628f94d1743808f`. Pin published benchmark releases where available, not these moving development HEADs merely because they were observed.

## Product decision and claim

**Decision:** should an Otto delegation layer replace a host agent's direct desktop loop for a defined mix of developer/productivity work on macOS and Windows?

**Candidate claim, only after evidence:** “On this named, versioned desktop task set, with these models, tools, permissions, and budgets, Otto achieved X/Y first-attempt outcomes at Z end-to-end cost and latency compared with the same host agent's direct tool loop.” Publish both platforms separately. Current evidence supports seven authored macOS exact-fill fixture cases, not general delegation, market leadership, or savings against a live Jev baseline. The Alpha.4 invalid-decision user trace belongs in the regression bank and must not be excluded from reliability accounting.

## First 30 authored tasks

Create six families with five distinct workflow templates each; 15 Mac and 15 Windows tasks overall. This is a pilot, not 30 independent copies of one form. Use clean test profiles and synthetic documents; keep setup/grader access unavailable to the agent.

| Family (5 each) | Concrete bounded examples | Independent success evidence |
| --- | --- | --- |
| Files and navigation | Find by content/name; rename and organize copies; create an archive in a designated fixture directory | Directory manifest, exact filenames/content hashes, untouched sibling invariants |
| Documents | Edit specified text; apply requested formatting; export a fixture document | Parsed text/style checks and independently rendered artifact comparison where needed |
| Spreadsheets | Import CSV; compute a specified formula; sort/filter; save a copy | Workbook values/formulas/order and protected-cell invariants |
| App configuration | Find and change a scoped editor preference; populate a project setup form; restore a previous value | App preference store or independent native state; no system-wide permission changes |
| Research and transfer | Locate facts in seeded local browser pages; enter a referenced value in another app | Source-grounded exact facts and destination state; no external submission |
| Cross-app completion | Convert notes to a document/table; reconcile two sources; prepare an unsent draft and saved artifact | Multi-artifact checks plus no-send/no-delete invariants |

Split before tuning: **12 development, 6 selection, 12 locked holdout** (2/1/2 per family), balanced as closely as possible by OS and difficulty. Group related templates, documents, apps' near-identical workflows, and all data variants together; changing names/values does not create an independent holdout. Have a separate author keep holdout details private. Once exposed, move the case to regression and replace it. The existing seven native fault fixtures and real parser failure are an additional regression suite, not holdout successes.

Predeclare native AX/UIA, OCR-only, mixed navigation, locale/Unicode, multi-app, and interruption slices. Keep unsupported capabilities visible: abstention is a failed task with a safe outcome, not an exclusion. Pilot tasks should cover real intended work even where today's limited action set cannot finish it. Label adapted public tasks and licensing/provenance; do not call this suite OSWorld, WAA, or MacArena.

## Comparable variants

Freeze one exact host model/version, system prompt, native observations, tool schemas, app/image versions, resolution, network access, token/time/action ceilings, and approval policy for the controlled comparison.

1. **No Jev:** the host planner chooses/actions through the same native tool interface directly.
2. **Fixed rules:** the same host produces a plan; literal/unique-label matching and deterministic form execution handle eligible edits, with explicit abstention elsewhere. Include host planning cost. Report both all-task success and eligibility coverage; do not pretend a supplied-value executor solves arbitrary planning.
3. **Host + Jev:** same host and task policy, adding Jev for grounded decisions. All Jev requests and latency count.
4. **Jev-only incumbent:** useful separate product-mode baseline. Its different planner/model mix makes this an entire-system comparison, not a clean Jev-only ablation.

Optional second controlled axis: full versus compact native context while holding execution semantics fixed. Disclose truncation/omissions and quality losses; serialized tokenizer counts are not bills. Do not give one variant shell/CLI, privileged files, hidden evaluator state, broader app scope, or bulk approval while restricting the others. If comparing deployed approval designs, label that separate workflow experiment and include interventions.

Use one fixed ceiling selected on development cases (provisionally 60 native actions and 10 minutes machine time per short task, no automatic reset/retry after ambiguous writes). Match all arms and report ceiling hits. Longer tasks require their own budget stratum, not a quiet exception. Run three fresh-reset repetitions per locked case/variant, order randomized/Latin-square; repeats estimate consistency but do not increase the count of independent task templates.

## Cold and repeated work

- **Cold:** new task/app state; clear agent memory, cached plans, and learned workflow artifacts. Record warm model service caches separately when provider control is unavailable.
- **Repeated:** independent reset and new data for a previously encountered workflow. Define exactly what memory/compiled plan may persist, make the same opportunity available to each eligible arm, and charge initial learning/compilation. Report first run, steady-state, and break-even count including failed/revalidation/relearning attempts.
- Keep these result tables separate. Do not tune on a heldout task and then call its later runs cold generalization.

## Outcomes, usage, and release gates

Grade authoritative state outside the agent: full task completion first; meaningful partial checkpoints second; forbidden effects separately. Never use the agent's “done” message or its own screenshot interpretation as ground truth. Audit graders with known-good, known-bad, wrong-target, duplicate-write, and partial-result fixtures before the comparison. Use blinded human review only for residual visual/semantic ambiguity and retain disagreements.

Record every provider attempt (host, Jev, other model), response, actual model, input/output/cache/reasoning usage where reported, retry/cancellation/error, native action, snapshot, approval, and timeout. Missing usage stays `null`/unknown. Provider-reported counters with dated public prices give an estimated charge; invoices or provider billing exports are the billed measure. Never infer zero spend from a missing response. Include all failed attempts in aggregate cost and cost per successful task, as well as host overhead. Report unknown-usage share; suppress total-billing savings claims when totals cannot be reconciled.

Report first-attempt success, all-three-repeat success, critical failures, intervention count, complete-task machine time and human waiting separately, failure/timeout times, median/P90 latency, and quality–cost–latency Pareto plots. Give paired per-case deltas and confidence intervals resampling whole template families, not individual actions. With only 12 heldout templates, intervals will be wide; this pilot can expose dominant failures, not establish small gains or rare-event safety.

Initial engineering gate: no wrong-app/unapproved/protected write or submit, no hidden mutation after Stop, exact final outcomes for required tasks, complete failure retention, and reproducible clean-reset runs. Any critical failure blocks the candidate. A comparative “cheaper/faster at equal quality” claim additionally needs a predeclared noninferiority margin and powered larger heldout run; choose its sample size from pilot discordance and the smallest useful effect. Thirty tasks are not a SOTA gate. Publish the task manifest, hashes, versions, budgets, eligibility/omissions, raw redacted receipts, all failures, and exact claim denominator.
