import test from "node:test";
import assert from "node:assert/strict";
import { allowedExternalUrl } from "./ipc-policy.js";

test("external links permit only explicit documentation and source hosts", () => {
  assert.equal(
    allowedExternalUrl("https://docs.typesafe.ai/introduction"),
    "https://docs.typesafe.ai/introduction",
  );
  for (const url of [
    "file:///etc/passwd",
    "https://example.com",
    "https://github.com/other/repo",
    "https://user:pass@docs.typesafe.ai/",
    "javascript:alert(1)",
  ])
    assert.throws(() => allowedExternalUrl(url));
});
