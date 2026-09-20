# Original native-contract grader source

The adjacent [source snapshot](native-contracts-grader-original.ts.txt) preserves the exact grader bytes used for the original native run recorded in [the public evidence](native-contracts-2026-09-20.json). It was reconstructed by reversing only the later per-field attempt-validation patch and saved only after its SHA-256 matched the run artifact.

SHA-256: `991fc59721d952d7374f85e0b614c05e67c839eefd59ec6b066eceae5a152f1b`.

This historical grader checks total native attempts but does not enforce their per-field distribution. It is retained for reproducibility, not as the current grader. Current grading uses `evals/native-contracts.ts`; subsequent regrades must remain separately labeled. The original evidence and verdicts were not modified.
