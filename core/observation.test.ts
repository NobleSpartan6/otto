import assert from "node:assert/strict";
import test from "node:test";
import { observationText } from "./observation.js";
import type { NativeSnapshot } from "../shared/types.js";

test("retains useful static text while redacting protected field values and supplied credentials", () => {
  const snapshot: NativeSnapshot = {
    snapshotId: "one",
    app: { id: "editor", name: "Editor", pid: 1 },
    title: "Note",
    capturedAt: new Date().toISOString(),
    text: "The invoice is $42.50, due September 30. hidden-passphrase test-provider-key password: hush Bearer abcdefghijklmnopqrstuvwxyz",
    controls: [
      {
        id: "secure",
        role: "secureText",
        label: "Password",
        value: "hidden-passphrase",
        enabled: true,
        sensitive: true,
        actions: [],
      },
    ],
  };
  const text = observationText(snapshot, ["test-provider-key"]);
  assert.ok(text.includes("The invoice is $42.50, due September 30."));
  for (const secret of [
    "hidden-passphrase",
    "test-provider-key",
    "hush",
    "abcdefghijklmnopqrstuvwxyz",
  ])
    assert.ok(!text.includes(secret));
  assert.ok(text.includes("[redacted]"));
  assert.equal(
    observationText({ ...snapshot, text: "x".repeat(40_000) }).length,
    16_000,
  );
});
