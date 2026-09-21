import assert from "node:assert/strict";
import test from "node:test";
import { fixtureShots, initialCut, proposals, applyProposal, diffusionSource, validateShots } from "./sequence.js";
import { chooseStory } from "./decision.js";
import { createDecider } from "../../core/typesafe.js";

test("every lock combination preserves the exact slot, duration and uniqueness across all candidates", () => {
  const current = initialCut(fixtureShots);
  for (let mask = 0; mask < 64; mask++) {
    const locks = current.flatMap((_, i) => mask & (1 << i) ? [i] : []);
    for (const proposal of proposals(fixtureShots, current, locks)) {
      const cut = applyProposal(fixtureShots, current, locks, proposal);
      assert.equal(new Set(cut.map(c => c.shotId)).size, 6);
      assert.equal(cut.reduce((n, c) => n + c.duration, 0), 12);
      for (const slot of locks) assert.deepEqual(cut[slot], current[slot]);
    }
  }
  assert.throws(() => applyProposal(fixtureShots, current, [0], { id: "bad", cuts: [...current].reverse() }), /locked/);
});
test("actual TypeSafe serializer and parser carry one typed story choice; simulated transport is explicitly not live inference", async () => {
  let calls = 0;
  const choose = createDecider(async (_url, options) => {
    calls++;
    const body = JSON.parse(options!.body as string);
    assert.equal(body.model, "jev-latest");
    assert.equal(body.questions.next_action.type, "choice");
    assert.equal(body.state.observation.shots.length, 10);
    assert.ok(!JSON.stringify(body).includes("blob:"));
    const ids = Object.keys(body.questions.next_action.criteria); const choice = ids[1]!;
    return new Response(JSON.stringify({ model: "test-transport", usage: { input_tokens: 123, output_tokens: 0 }, answers: {
      next_action: { type: "choice", choice, confidence: 0.9, probabilities: Object.fromEntries(ids.map(id => [id, id === choice ? 1 : 0])) }, complete: { type: "noul", noul: 0 },
    } }));
  });
  const current = initialCut(fixtureShots);
  const result = await chooseStory({ shots: fixtureShots, current, locks: [2], brief: "Fast reveal" }, "unit-test-key", choose);
  assert.equal(calls, 1); assert.equal(result.status, "selected"); assert.deepEqual(result.cuts[2], current[2]);
  assert.equal(result.evidence?.inputTokens, 123);
});
test("missing key, all locks, unclear choice and provider error never silently become fixture decisions", async () => {
  const input = { shots: fixtureShots, current: initialCut(fixtureShots), locks: [2], brief: "A quiet reveal" };
  let calls = 0;
  const choose = async () => { calls++; return { choice: "cut-1", confidence: .2, probabilities: { "cut-1": .51, "cut-2": .49 }, complete: 0, inputTokens: 1, latencyMs: 1 }; };
  assert.equal((await chooseStory(input, "", choose)).source, "unavailable");
  assert.equal((await chooseStory({ ...input, locks: [0, 1, 2, 3, 4, 5] }, "key", choose)).source, "constraints");
  assert.equal(calls, 0);
  const held = await chooseStory(input, "key", choose); assert.equal(held.status, "held"); assert.deepEqual(held.cuts, input.current);
  await assert.rejects(chooseStory(input, "key", async () => { throw new Error("provider offline"); }), /provider offline/);
  assert.equal(calls, 1);
});
test("media constraints and export preserve six explicit source trims without scripts from metadata", () => {
  assert.throws(() => validateShots(fixtureShots.map(s => ({ ...s, duration: 1 }))));
  assert.throws(() => validateShots(fixtureShots.map(s => ({ ...s, fileName: "../secret.mp4" }))));
  const slates = diffusionSource(fixtureShots, initialCut(fixtureShots), true);
  assert.match(slates, /TEST SLATE/); assert.equal((slates.match(/<group /g) ?? []).length, 6);
  const media = fixtureShots.map(s => ({ ...s, fileName: `${s.id}.mp4` }));
  const source = diffusionSource(media, initialCut(media), false);
  assert.equal((source.match(/sourceOut=\{2\}/g) ?? []).length, 6);
  assert.match(source, /start=\{10\} end=\{12\}/);
});
