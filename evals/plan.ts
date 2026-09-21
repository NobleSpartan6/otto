import { CASES } from "./native-contracts.js";

export interface EvalOptions { run: boolean; repetitions: number; seed: number; caseId?: string }
export interface ScheduledTrial { index: number; caseId: string; family: string; repetition: number }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** A report must declare the same bounded options used to plan execution. */
export function validateOptions(value: unknown): EvalOptions {
  if (!record(value) || Object.keys(value).some(key => !["run", "repetitions", "seed", "caseId"].includes(key)) ||
      typeof value.run !== "boolean" || !Number.isSafeInteger(value.repetitions) || Number(value.repetitions) < 1 || Number(value.repetitions) > 3 ||
      !Number.isSafeInteger(value.seed) || Number(value.seed) < 1 || Number(value.seed) > 0xffffffff ||
      (value.caseId !== undefined && (typeof value.caseId !== "string" || !CASES.some(item => item.id === value.caseId))))
    throw new Error("Invalid evaluation options: supply run, 1–3 repetitions, a positive 32-bit seed, and an optional known caseId.");
  return { run: value.run, repetitions: Number(value.repetitions), seed: Number(value.seed),
    ...(value.caseId === undefined ? {} : { caseId: value.caseId as string }) };
}

export function parseOptions(args: string[]): EvalOptions {
  const options: EvalOptions = { run: false, repetitions: 1, seed: 20260920 };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (seen.has(flag)) throw new Error("Repeated option.");
    seen.add(flag);
    if (flag === "--run") options.run = true;
    else if (flag === "--case") {
      options.caseId = args[++i];
      if (!CASES.some(item => item.id === options.caseId)) throw new Error("Unknown contract case.");
    } else if (flag === "--repetitions" || flag === "--seed") {
      const raw = args[++i] ?? "";
      if (!/^[0-9]+$/.test(raw)) throw new Error("Use a positive integer.");
      if (flag === "--seed") options.seed = Number(raw); else options.repetitions = Number(raw);
    } else throw new Error("Usage: npm run eval:native-contracts -- [--run] [--case ID] [--repetitions 1..3] [--seed INTEGER]");
  }
  return validateOptions(options);
}

/** This order is part of suite v1's experiment contract; replay must reproduce it. */
export function schedule(input: EvalOptions): ScheduledTrial[] {
  const options = validateOptions(input);
  let state = options.seed >>> 0;
  const rows = Array.from({ length: options.repetitions }, (_, repetition) => CASES.filter(item => !options.caseId || item.id === options.caseId)
    .map(item => ({ caseId: item.id, family: item.family, repetition: repetition + 1 }))).flat();
  for (let i = rows.length - 1; i > 0; i--) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const j = (state >>> 0) % (i + 1); [rows[i], rows[j]] = [rows[j]!, rows[i]!];
  }
  return rows.map((item, index) => ({ ...item, index: index + 1 }));
}
