# Learn agent evaluation with Otto

**Start with section 1. Read its example, then try the 60-second exercise.**

Reading time: about 8 minutes. Each exercise takes less than 2 minutes. You can stop after any section; no native automation or model call is needed for these exercises.

Otto gives a host agent scoped desktop tools. An evaluation asks whether a particular version achieved a defined result, respected its limits, and used fewer resources than a fair comparison.

## 1. A baseline makes a comparison meaningful

**Definition:** A baseline is the existing approach you compare against. Both approaches need the same starting state, task, permissions, and success criteria.

**Otto example:** The [recorded Codex comparison](../evaluation-codex-agent-bridge.md) filled six blank fields in a disposable Mac app. The baseline used `inspect` followed by six `act` calls. The candidate used one `run_steps` call with the same literal values. Both had the same model setting and tool access. The fixture independently confirmed six correct fields and no submit or reset in both runs.

That isolates a useful question: does delegating the intermediate steps reduce host-agent work? It does not compare different models or prove general desktop ability. There was only one trial per approach, baseline first; caching and order could affect the result.

**Try it — 60 seconds:** Write one sentence with three parts: “The baseline was __; the candidate changed __; both had to achieve __.”

**Done when:** You can describe what changed without saying “Otto is better.”

## 2. An independent grader checks the actual result

**Definition:** A grader decides whether an attempt met its criteria. An independent grader reads evidence separate from the agent's own success claim.

**Otto example:** The [native harness](../../tests/native/agent-bridge-smoke.ts) reads the fixture-owned `state.json` after execution. It checks literal field values, write counts, and submit/reset counts. The host agent cannot read this oracle. A `verified` tool receipt is useful evidence, but the harness still compares it with the fixture's state.

Graders also need scrutiny. In the live Codex evaluation, an exact startup warning was initially misclassified as an unexpected tool. The raw events were preserved and regraded with a narrowly corrected rule, without new model calls. Both the original failure and correction remain documented.

**Try it — 90 seconds:** Open [the published regrade](../evidence/native-contracts-2026-09-20-regrade.json). Find `interference-changed` and compare `contractPassed` with `goalCompleted`. In [the underlying evidence](../evidence/native-contracts-2026-09-20.json), find the same case's `evidence.after.fields.Notes` and `evidence.after.forbiddenSubmitCount`.

**Done when:** You can name one fact the grader checked without trusting the agent's text.

## 3. Task success and a correct stop are different outcomes

**Definition:** Task success means the requested result was reached. A correct stop means continuing would violate a condition, so the system halted. A safety case can pass while the task remains incomplete.

**Otto example:** In the recorded changed-field case, the fixture changed Notes after the first write. Otto stopped, preserved that edit, and left the remaining fields unfilled. The safety check passed; the six-field task did not complete. Earlier actions were not rolled back. A missing OS permission is a blocked attempt, not a successful safety test.

Keep the evidence layers separate:

| Evidence layer | What it checks | What it cannot establish alone |
| --- | --- | --- |
| Unit and MCP protocol tests | Rules and tool behavior using synthetic inputs or a fake native driver | Actual OS execution or agent reasoning |
| Deterministic native contract checks | Scripted calls against the real disposable app and its oracle | A model's ability to choose the right calls |
| Live LLM-agent evaluation | A model choosing tools, with outcomes graded independently | Broad reliability from one task pair |

The ten-case `eval:native-contracts` suite belongs to the middle row. The [recorded native run](../evaluation-native-contracts.md#recorded-native-run) completed six goals and made four required stops. Its default command prints the plan; `--run` explicitly executes native checks. A plan is not evidence that its cases passed. Read saved reports for learning; do not start a live suite alongside another desktop executor.

**Try it — 60 seconds:** Label the changed-field case on two axes: “task completed: __” and “required safety behavior: __.”

**Done when:** Your answer is “no” and “passed,” with the preserved Notes edit as evidence.

## 4. More cases do not automatically mean broader coverage

**Definition:** A slice groups cases by a condition, such as an ambiguous label. A task family represents a meaningfully different workflow. A holdout is a preselected set you keep out of development and tuning until evaluation.

**Otto example:** Ten fault or edge cases in one form can expose important regressions. They are still variations on one app and workflow, not ten independent task families. The authored fixture is development evidence, not a held-out benchmark. Its Mac results do not establish Windows behavior.

To broaden the claim, define other tasks and their graders before testing. Reserve some from implementation decisions. If a reserved case informs a fix, record that exposure; it is no longer untouched holdout evidence for that fix.

**Try it — 90 seconds:** Classify these proposed additions: a duplicate form label; a multiline value; editing and reopening a document in another app. The first two are form slices. The third could form a new task family with a persistence grader. None becomes held out merely by being new.

**Done when:** You can explain why “10 cases passed” needs a description of those cases.

## 5. Compare cost only alongside quality

**Definition:** A quality–cost tradeoff asks how resource use changes while preserving required outcomes. Token counts, elapsed time, and billed money are different measures.

**Otto example:** In the successful live comparison, both approaches achieved 6/6 exact fields. Reported input tokens fell from **191,645 to 53,072: 72.31% fewer**. Those totals include cached input. Subtracting reported cached tokens gives **27,037 to 18,384 uncached tokens: 32.00% fewer**.

Neither percentage is billed savings. Cache pricing, model routing, and invoices were not fully observed. The separate deterministic harness counts serialized tool text with `o200k_base`; that measures payload size, not the live host's cumulative input. Keep failed attempts visible rather than reporting only cheap successes. No model ran inside Otto in either comparison, so these results do not measure Jev's quality or cost.

**Try it — 90 seconds:** Say this aloud, replacing the blanks: “On __, both approaches achieved __. Reported input changed by __. I would need __ before claiming general savings.”

**Done when:** Your explanation includes the single Mac fixture and repeated, varied comparisons as the next evidence needed.

**Next — 60 seconds:** Explain section 3 aloud without reading it. Name the task outcome, the safety outcome, and the independent evidence.
