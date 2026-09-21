import { decide, type DecisionInput, type Decision } from "../../core/typesafe.js";
import { applyProposal, proposals, type Cut, type Shot } from "./sequence.js";
export type StoryRequest = { shots: Shot[]; current: Cut[]; locks: number[]; brief: string };
export async function chooseStory(input: StoryRequest, apiKey: string, choose: (input: DecisionInput) => Promise<Decision> = decide) {
  if (typeof input.brief !== "string" || !input.brief.trim() || input.brief.length > 800) throw new Error("Write a brief of 1–800 characters.");
  const candidates = proposals(input.shots, input.current, input.locks);
  if (input.shots.some(shot => shot.tags === "Add descriptive tags")) throw new Error("Describe each imported clip before asking Jev.");
  if (input.locks.length === 6) return { status: "held", reason: "Every shot is locked. Unlock a slot to make another cut.", source: "constraints", cuts: input.current };
  if (!apiKey.trim()) return { status: "held", reason: "Add a TypeSafe key to ask Jev. Your current cut is unchanged.", source: "unavailable", cuts: input.current };
  const decision = await choose({ apiKey, goal: `Choose the best editorial sequence for this brief: ${input.brief}. Judge only supplied tags/transcripts. Do not claim to see footage. Use hold if no candidate fits.`,
    observation: { shots: input.shots.map(({ id, name, tags, transcript }) => ({ id, name, tags, transcript })), lockedSlots: input.locks.map(i => i + 1), durationSeconds: 12, cutSeconds: 2 }, history: [],
    candidates: [...candidates.map(p => ({ id: p.id, label: p.cuts.map(c => c.shotId).join(" → ") })), { id: "hold", label: "Keep the current cut; none of the supplied sequences adequately fits this brief." }],
  });
  const selected = candidates.find(p => p.id === decision.choice);
  // Explicit prototype heuristic; neither calibrated nor a success probability.
  const ranked = Object.values(decision.probabilities).sort((a, b) => b - a);
  const margin = (ranked[0] ?? 0) - (ranked[1] ?? 0);
  const accepted = selected && decision.confidence >= 0.5 && margin >= 0.02;
  return { status: accepted ? "selected" : "held", source: "jev", cuts: accepted ? applyProposal(input.shots, input.current, input.locks, selected) : input.current,
    reason: accepted ? "Jev selected a cut from the supplied metadata." : "Jev did not separate a suitable cut clearly enough. Your current cut is unchanged.",
    evidence: { model: decision.model, latencyMs: decision.latencyMs, inputTokens: decision.inputTokens, outputTokens: decision.outputTokens ?? null, choice: decision.choice, confidence: decision.confidence, margin, candidateCount: candidates.length + 1 } };
}
