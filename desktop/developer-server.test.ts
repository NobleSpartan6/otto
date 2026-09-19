import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  createDeveloperServer,
  parseLauncherArgs,
  type InspectionDriver,
} from "./developer-server.js";

function text(result: unknown): string {
  return (result as { content: Array<{ type: string; text?: string }> }).content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
}
function metadata(result: unknown) {
  return JSON.parse(text(result).split("\n")[1]);
}
function isError(result: unknown) {
  return (result as { isError?: boolean }).isError === true;
}

test("launcher requires explicit scope and rejects scope expansion arguments", () => {
  assert.deepEqual(
    parseLauncherArgs([
      "--app",
      "com.example.Fixture",
      "--app",
      "com.example.Fixture",
    ]),
    { appIds: ["com.example.Fixture"], listApps: false, help: false },
  );
  assert.equal(parseLauncherArgs(["--list-apps"]).listApps, true);
  assert.equal(parseLauncherArgs(["--help"]).help, true);
  for (const args of [
    [],
    ["--app"],
    ["--app", "--all"],
    ["--all"],
    ["--execute"],
    ["--list-apps", "--app", "a"],
    ["--app", "a\nb"],
  ]) {
    assert.throws(() => parseLauncherArgs(args));
  }
});

test("invalid launcher scope cannot boot a native driver", async () => {
  const driver: InspectionDriver = {
    apps: async () => {
      throw new Error("Unexpected native call");
    },
    configure: async () => {
      throw new Error("Unexpected native call");
    },
    observe: async () => {
      throw new Error("Unexpected native call");
    },
    cancel: () => {
      throw new Error("Unexpected native call");
    },
  };
  await assert.rejects(createDeveloperServer(driver, []), /explicit/);
  await assert.rejects(createDeveloperServer(driver, ["bad\napp"]), /explicit/);
});

test(
  "real MCP stdio handshake exposes compact inspection and preparation only",
  { timeout: 20_000 },
  async (t) => {
    const client = new Client({ name: "otto-protocol-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        "--import",
        "tsx",
        fileURLToPath(
          new URL("../tests/fixtures/developer-server.ts", import.meta.url),
        ),
      ],
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    t.after(async () => {
      await client.close();
      assert.equal(stderr, "");
    });
    await client.connect(transport);
    const manifest = await client.listTools();
    assert.deepEqual(
      manifest.tools.map((tool) => tool.name),
      ["list_apps", "inspect", "prepare_fill"],
    );
    assert.ok(
      manifest.tools.every((tool) => tool.annotations?.readOnlyHint === true),
    );
    const listed = await client.callTool({ name: "list_apps", arguments: {} });
    assert.deepEqual(JSON.parse(text(listed)), {
      apps: [{ id: "fixture", name: "Fixture" }],
    });
    assert.equal(
      isError(
        await client.callTool({ name: "list_apps", arguments: { all: true } }),
      ),
      true,
    );
    assert.equal(
      isError(await client.callTool({ name: "act", arguments: {} })),
      true,
    );
    assert.equal(
      isError(
        await client.callTool({
          name: "inspect",
          arguments: { appId: "unselected" },
        }),
      ),
      true,
    );
    const observed = await client.callTool({
      name: "inspect",
      arguments: { appId: "fixture" },
    });
    assert.equal(isError(observed), false, text(observed));
    assert.doesNotMatch(
      text(observed),
      /SECRET_SCREENSHOT|sensitive-marker|private-native-|data:image/,
    );
    const token = metadata(observed).snapshotToken;
    const prep = await client.callTool({
      name: "prepare_fill",
      arguments: {
        snapshotToken: token,
        fields: { Name: "Ada", City: "London" },
      },
    });
    assert.deepEqual(metadata(prep).plan, [
      { ref: "c1", label: "Name", value: "Ada" },
    ]);
    assert.equal(metadata(prep).executed, false);
    assert.deepEqual(metadata(prep).unresolved, [
      { field: "City", reason: "not_native_editable" },
    ]);
    assert.equal(
      isError(
        await client.callTool({
          name: "prepare_fill",
          arguments: {
            snapshotToken: token,
            fields: { Name: "Ada" },
            execute: true,
          },
        }),
      ),
      true,
    );
    const invalidLimits = await client.callTool({
      name: "inspect",
      arguments: { appId: "fixture", maxControls: 129 },
    });
    assert.equal(isError(invalidLimits), true);
    const refreshed = await client.callTool({
      name: "inspect",
      arguments: { appId: "fixture", maxControls: 1, maxTextChars: 0 },
    });
    assert.equal(metadata(refreshed).truncation.controlsOmitted, 1);
    assert.equal(
      isError(
        await client.callTool({
          name: "prepare_fill",
          arguments: { snapshotToken: token, fields: { Name: "Ada" } },
        }),
      ),
      true,
    );
    const currentToken = metadata(refreshed).snapshotToken;
    const failed = await client.callTool({
      name: "inspect",
      arguments: { appId: "broken" },
    });
    assert.equal(isError(failed), true);
    assert.doesNotMatch(text(failed), /Private native details/);
    assert.equal(
      isError(
        await client.callTool({
          name: "prepare_fill",
          arguments: { snapshotToken: currentToken, fields: { Name: "Ada" } },
        }),
      ),
      true,
    );
    const mismatch = await client.callTool({
      name: "inspect",
      arguments: { appId: "mismatch" },
    });
    assert.equal(isError(mismatch), true);
    assert.doesNotMatch(text(mismatch), /SECRET_SCREENSHOT|Fixture form/);
    const batch = await Promise.all(
      Array.from({ length: 5 }, () =>
        client.callTool({ name: "inspect", arguments: { appId: "fixture" } }),
      ),
    );
    assert.equal(batch.filter(isError).length, 1);
    assert.match(text(batch.find(isError)), /busy/);
    assert.ok(
      batch
        .filter((result) => !isError(result))
        .every((result) => metadata(result).snapshotToken),
    );
  },
);
