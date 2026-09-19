import assert from "node:assert/strict";
import test from "node:test";
import {
  DeveloperSession,
  DeveloperError,
  DEVELOPER_TTL_MS,
  formatObservation,
  formatPreparation,
} from "./developer.js";
import {
  FIXTURE_TIME,
  formFixture,
  developerFixtures,
  changedStateFixture,
  errorFixture,
} from "../benchmarks/fixtures/developer.js";

const session = () => new DeveloperSession({ now: () => FIXTURE_TIME });
const code = (expected: DeveloperError["code"]) => (error: unknown) =>
  error instanceof DeveloperError && error.code === expected;

test("inspect preserves retained target details and exposes no screenshot, geometry, or native handles", () => {
  const snapshot = formFixture(4);
  snapshot.screenshot = "data:image/png;base64,do-not-return";
  const result = session().inspect(snapshot);
  assert.equal(result.controls.length, snapshot.controls.length);
  for (const [index, control] of result.controls.entries()) {
    const source = snapshot.controls[index]!;
    assert.deepEqual(control, {
      ref: `c${index + 1}`,
      role: source.role,
      label: source.label,
      value: source.value,
      enabled: source.enabled,
      editable: source.editable,
      source: source.source,
      actions: source.actions,
    });
  }
  const rendered = formatObservation(result);
  assert.ok(
    rendered.includes(
      '"ref","role","label","value","enabled","editable","source","actions"',
    ),
  );
  assert.ok(!rendered.includes("do-not-return"));
  assert.ok(!rendered.includes('"bounds"'));
  assert.ok(!rendered.includes("control-0"));
  assert.equal(result.truncation.controlsOmitted, 0);
  assert.equal(result.truncation.text.truncated, false);
});

test("bounded observations report all omitted controls and clipped details explicitly", () => {
  const fixture = developerFixtures().find(
    (item) => item.id === "long-content",
  )!;
  const result = session().inspect(fixture.snapshot, {
    maxControls: 2,
    maxTextChars: 80,
  });
  assert.equal(result.controls.length, 2);
  assert.equal(result.truncation.controlsOmitted, 2);
  assert.equal(result.text.length, 80);
  assert.equal(result.truncation.text.truncated, true);
  assert.deepEqual(result.truncation.details, [
    { ref: "c1", fields: ["value"] },
  ]);
  assert.equal(result.controls[0]!.value!.length, 512);
  assert.equal(result.redacted, false);
  const state = session();
  const limited = state.inspect(formFixture(180));
  assert.deepEqual(
    state.prepareFill({
      snapshotToken: limited.snapshotToken,
      fields: { "Field 180": "literal" },
    }).unresolved,
    [{ field: "Field 180", reason: "unknown_field" }],
  );
});

test("redaction expansion reports sanitized lengths and every cap without leaking short protected values", () => {
  const snapshot = formFixture(2);
  snapshot.controls[0]!.sensitive = true;
  snapshot.controls[0]!.value = "a";
  snapshot.controls[1]!.value = "a".repeat(60);
  snapshot.text = "a".repeat(3000);
  const result = session().inspect(snapshot, { maxTextChars: 16000 });
  assert.equal(result.redacted, true);
  assert.deepEqual(result.truncation.text, {
    originalChars: 3000,
    sanitizedChars: 30000,
    returnedChars: 16000,
    truncated: true,
  });
  assert.deepEqual(result.truncation.details, [
    { ref: "c1", fields: ["value"] },
  ]);
  assert.equal(result.controls[0]!.value!.length, 512);
});

test("protected values are redacted from text and ordinary controls while protected targets are omitted", () => {
  const fixture = developerFixtures().find(
    (item) => item.id === "sensitive-fields",
  )!;
  fixture.snapshot.controls[0]!.value =
    "Copied fixture-password-do-not-disclose";
  const result = session().inspect(fixture.snapshot);
  assert.equal(result.sensitiveControlsOmitted, 1);
  assert.equal(result.redacted, true);
  assert.ok(result.text.includes("€42"));
  assert.ok(
    !JSON.stringify(result).includes("fixture-password-do-not-disclose"),
  );
  assert.ok(!JSON.stringify(result).includes("abcdefghijklmnop"));
});

test("Unicode labels and literal values round trip in compact rows and fill preparation", () => {
  const fixture = developerFixtures().find(
    (item) => item.id === "multilingual",
  )!;
  const state = session();
  const inspected = state.inspect(fixture.snapshot);
  const prepared = state.prepareFill({
    snapshotToken: inspected.snapshotToken,
    fields: fixture.fields,
  });
  assert.equal(prepared.executed, false);
  assert.equal(prepared.unresolved.length, 0);
  assert.deepEqual(
    prepared.plan.map((step) => step.value),
    Object.values(fixture.fields),
  );
  assert.ok(formatObservation(inspected).includes("Descripción 🪴"));
  assert.ok(formatPreparation(prepared).includes("not executed"));
});

test("duplicate labels including hidden duplicates abstain; explicit refs remain unambiguous", () => {
  const fixture = developerFixtures().find(
    (item) => item.id === "duplicate-labels",
  )!;
  const state = session();
  const inspected = state.inspect(fixture.snapshot, { maxControls: 1 });
  assert.deepEqual(
    state.prepareFill({
      snapshotToken: inspected.snapshotToken,
      fields: { Email: "literal" },
    }).unresolved,
    [{ field: "Email", reason: "ambiguous_label" }],
  );
  assert.equal(
    state.prepareFill({
      snapshotToken: inspected.snapshotToken,
      fields: [{ ref: "c1", value: "literal" }],
    }).plan.length,
    1,
  );
});

test("only enabled native editable targets accept preparation; OCR, buttons, disabled and unknown refs abstain", () => {
  const snapshot = formFixture(4);
  snapshot.controls[0]!.source = "ocr";
  snapshot.controls[1]!.enabled = false;
  snapshot.controls[2]!.editable = false;
  snapshot.controls[2]!.actions = ["press"];
  const state = session();
  const inspected = state.inspect(snapshot);
  const result = state.prepareFill({
    snapshotToken: inspected.snapshotToken,
    fields: [
      { ref: "c1", value: "a" },
      { ref: "c2", value: "b" },
      { ref: "c3", value: "c" },
      { ref: "c4", value: "d" },
      { ref: "c4", value: "duplicate" },
      { ref: "c999", value: "unknown" },
    ],
  });
  assert.deepEqual(
    result.unresolved.map((item) => item.reason),
    [
      "not_native_editable",
      "disabled",
      "not_native_editable",
      "duplicate_target",
      "unknown_ref",
    ],
  );
  assert.deepEqual(result.plan, [{ ref: "c4", label: "Field 4", value: "d" }]);
});

test("stale, replaced, expired and failed observations cannot prepare an old alias", () => {
  let now = FIXTURE_TIME;
  const state = new DeveloperSession({ now: () => now });
  const [before, after] = changedStateFixture();
  const first = state.inspect(before);
  const second = state.inspect(after);
  const old = {
    snapshotToken: first.snapshotToken,
    fields: [{ ref: "c1", value: "test" }],
  };
  assert.throws(() => state.prepareFill(old), code("stale_snapshot"));
  assert.equal(
    state.prepareFill({ ...old, snapshotToken: second.snapshotToken }).plan[0]!
      .label,
    "Field 2",
  );
  now += DEVELOPER_TTL_MS;
  assert.throws(
    () => state.prepareFill({ ...old, snapshotToken: second.snapshotToken }),
    code("stale_snapshot"),
  );
  now = FIXTURE_TIME;
  const third = state.inspect(before);
  assert.throws(() => state.inspect(errorFixture()), code("invalid_snapshot"));
  assert.throws(
    () => state.prepareFill({ ...old, snapshotToken: third.snapshotToken }),
    code("stale_snapshot"),
  );
});

test("input and output mutation cannot alter the private current frame", () => {
  const snapshot = formFixture(2);
  const state = session();
  const inspected = state.inspect(snapshot);
  snapshot.controls[0]!.label = "Mutated source";
  inspected.controls[0]!.label = "Mutated output";
  inspected.controls[0]!.editable = false;
  assert.equal(
    state.prepareFill({
      snapshotToken: inspected.snapshotToken,
      fields: [{ ref: "c1", value: "" }],
    }).plan[0]!.label,
    "Field 1",
  );
  state.invalidate();
  assert.throws(
    () =>
      state.prepareFill({
        snapshotToken: inspected.snapshotToken,
        fields: { "Field 1": "a" },
      }),
    code("stale_snapshot"),
  );
});

test("rejects executable extra fields, malformed literals and excessive request sizes", () => {
  const state = session();
  const inspected = state.inspect(formFixture(2));
  const valid = {
    snapshotToken: inspected.snapshotToken,
    fields: [{ ref: "c1", value: "literal" }],
  };
  for (const bad of [
    { ...valid, script: "execute" },
    { ...valid, submit: true },
    { ...valid, fields: [{ ref: "c1", value: "literal", click: true }] },
    { ...valid, fields: [{ ref: "c1", value: { text: "nested" } }] },
    { ...valid, fields: [{ ref: "c1", value: "x".repeat(2001) }] },
    {
      ...valid,
      fields: Array.from({ length: 33 }, () => ({ ref: "c1", value: "x" })),
    },
    {
      ...valid,
      fields: Array.from({ length: 9 }, () => ({
        ref: "c1",
        value: "x".repeat(2000),
      })),
    },
    { ...valid, fields: {} },
    { ...valid, fields: [] },
  ])
    assert.throws(() => state.prepareFill(bad), code("invalid_input"));
  assert.equal(
    state.prepareFill({
      ...valid,
      fields: [{ ref: "c1", value: "sk-proj-abcdefghijklmnop12345678" }],
    }).unresolved[0]!.reason,
    "sensitive_value",
  );
  assert.throws(
    () => state.inspect(formFixture(2), { maxControls: 129 }),
    code("invalid_input"),
  );
});
