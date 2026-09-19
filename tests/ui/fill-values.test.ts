import test from "node:test";
import assert from "node:assert/strict";
import { parseFillFields } from "../../src/native/fillValues.js";

test("preserves exact whitespace, empty text, newlines, and Unicode values", () => {
  const fields = { Name: "  Ada\nLovelace  ", City: "", Note: "café 🪴" };
  assert.deepEqual(parseFillFields(JSON.stringify(fields)), fields);
});
test("accepts both the 16-field and 16,000-character boundary", () => {
  const fields = Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => [`Field ${i}`, "x".repeat(1000)]),
  );
  assert.deepEqual(parseFillFields(JSON.stringify(fields)), fields);
});
test("rejects invalid JSON and non-object roots", () => {
  for (const value of ["{", "[]", "null", '"text"'])
    assert.throws(() => parseFillFields(value));
});
test("rejects surviving non-string values", () => {
  for (const value of [1, false, null, [], {}])
    assert.throws(
      () => parseFillFields(JSON.stringify({ Field: value })),
      /quoted text/,
    );
});
test("rejects a numeric value hidden by a duplicate string key", () => {
  assert.throws(
    () => parseFillFields('{"City":1,"City":"Paris"}'),
    /more than once/,
  );
});
test("rejects duplicate keys after structured or boolean values", () => {
  for (const value of ['{"nested":"x"}', '[{"nested":"x"}]', "false"])
    assert.throws(
      () => parseFillFields(`{"City":${value},"City":"Paris"}`),
      /more than once/,
    );
});
test("rejects duplicate keys encoded with Unicode escapes", () => {
  assert.throws(
    () => parseFillFields('{"City":"One","\\u0043ity":"Two"}'),
    /more than once/,
  );
});
test("rejects keys that normalize to the same native label", () => {
  assert.throws(
    () => parseFillFields('{" City ":"One","City":"Two"}'),
    /more than once/,
  );
  assert.throws(
    () => parseFillFields('{"Café":"One","Cafe\\u0301":"Two"}'),
    /more than once/,
  );
});
test("ignores braces, escaped quotes, and key-like text inside values", () => {
  const fields = {
    Name: 'Literal {"City":1,"City":"Paris"} [text]',
    City: "Paris",
  };
  assert.deepEqual(parseFillFields(JSON.stringify(fields)), fields);
});
test("rejects oversized fields, totals, labels, and invalid names", () => {
  const cases = [
    {},
    { "": "x" },
    { ["x".repeat(257)]: "x" },
    { Name: "\0" },
    { Name: "x".repeat(2001) },
    Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`f${i}`, "x"])),
    Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`f${i}`, "x".repeat(2000)]),
    ),
  ];
  for (const fields of cases)
    assert.throws(() => parseFillFields(JSON.stringify(fields)));
  assert.throws(() => parseFillFields(" ".repeat(200_001)), /too large/);
});
