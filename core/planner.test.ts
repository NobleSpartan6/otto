import assert from "node:assert/strict";
import test from "node:test";
import { buildCandidates } from "./candidates.js";
import {
  createPlanner,
  PlannerError,
  PLANNER_MODEL,
  PLANNER_TIMEOUT_MS,
  type PlannerInput,
} from "./planner.js";
import type { NativeSnapshot } from "../shared/types.js";

function input(): PlannerInput {
  const observation: NativeSnapshot = {
    snapshotId: "snapshot",
    app: { id: "editor", name: "Editor", pid: 100 },
    title: "Untitled",
    text: "Useful static document content. Protected value: private-password",
    capturedAt: new Date().toISOString(),
    screenshot: "data:image/png;base64,aGVsbG8=",
    controls: [
      {
        id: "field",
        role: "text",
        label: "Document",
        enabled: true,
        editable: true,
        actions: ["fill"],
      },
      {
        id: "button",
        role: "button",
        label: "New",
        enabled: true,
        actions: ["press"],
      },
      {
        id: "secret",
        role: "secureText",
        label: "Password",
        value: "private-password",
        enabled: true,
        editable: true,
        sensitive: true,
        actions: ["fill"],
      },
    ],
  };
  return {
    goal: "Write a short greeting",
    observation,
    candidates: buildCandidates(
      observation,
      [observation.app],
      "Write a short greeting",
      [],
      true,
    ),
    apps: [observation.app],
    history: [],
    apiKey: "private-openai-test-key",
    reason: "initial_plan",
  };
}

function output(request: PlannerInput) {
  return {
    subgoal: "Write a greeting in the document",
    summary: "Enter a short greeting in the document.",
    actionId: request.candidates.find((candidate) => candidate.kind === "fill")!
      .id,
    text: "Hello, friend!",
    done: false,
    needsHuman: null,
  };
}

function response(value: unknown) {
  return {
    model: PLANNER_MODEL,
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: JSON.stringify(value) }],
      },
    ],
  };
}

const errorCode = (code: PlannerError["code"]) => (error: unknown) =>
  error instanceof PlannerError &&
  error.code === code &&
  !error.message.includes("private-");

test("uses the documented Responses schema with no tools and exact grounded candidate IDs", async () => {
  const request = input();
  const plan = createPlanner(async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      `Bearer ${request.apiKey}`,
    );
    assert.equal(options?.redirect, "error");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "gpt-6-astra");
    assert.equal(body.store, false);
    assert.deepEqual(body.tools, []);
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.deepEqual(body.text.format.schema.properties.actionId.enum, [
      ...request.candidates.map((candidate) => candidate.id),
      null,
    ]);
    assert.equal(body.input[0].content.length, 1);
    assert.ok(!String(options?.body).includes(request.apiKey));
    assert.ok(!String(options?.body).includes("private-password"));
    assert.ok(String(options?.body).includes("Useful static document content"));
    assert.ok(!String(options?.body).includes("aGVsbG8="));
    return Response.json(response(output(request)));
  });
  const result = await plan(request);
  assert.equal(result.text, "Hello, friend!");
  assert.equal(result.model, PLANNER_MODEL);
  assert.ok(Number.isFinite(result.latencyMs) && result.latencyMs >= 0);
});

test("sends the selected-window image only with explicit consent as an image content part", async () => {
  const request = { ...input(), allowScreenshot: true };
  const plan = createPlanner(async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.deepEqual(body.input[0].content[1], {
      type: "input_image",
      image_url: request.observation.screenshot,
      detail: "original",
    });
    assert.ok(!body.input[0].content[0].text.includes("aGVsbG8="));
    return Response.json(response(output(request)));
  });
  await plan(request);
});

test("records actual response usage and rejects malformed counts without inventing missing usage", async () => {
  const request = input();
  const parse = (usage: unknown) => createPlanner(async () =>
    Response.json({ ...response(output(request)), usage }),
  )(request);
  assert.deepEqual((await parse({ input_tokens: 1234, output_tokens: 56 })).usage,
    { inputTokens: 1234, outputTokens: 56 });
  assert.deepEqual((await parse({ input_tokens: 0, output_tokens: 0 })).usage,
    { inputTokens: 0, outputTokens: 0 });
  assert.equal((await parse(undefined)).usage, undefined);
  assert.equal((await parse(null)).usage, undefined);
  for (const usage of [
    {},
    { input_tokens: "123", output_tokens: 1 },
    { input_tokens: 1, output_tokens: -1 },
    { input_tokens: 1.5, output_tokens: 1 },
    { input_tokens: Number.MAX_SAFE_INTEGER + 1, output_tokens: 1 },
    { input_tokens: 1, output_tokens: Infinity },
  ]) await assert.rejects(parse(usage), errorCode("invalid_response"));
});

test("rejects unknown targets, extra executable fields, incompatible text, and false terminal shapes", async () => {
  const request = input();
  const valid = output(request);
  const press = request.candidates.find(
    (candidate) => candidate.kind === "press",
  )!;
  for (const value of [
    { ...valid, actionId: "invented" },
    { ...valid, script: "exec" },
    { ...valid, actionId: press.id },
    { ...valid, done: true },
    { ...valid, actionId: null, text: null },
    { ...valid, text: null },
    { ...valid, summary: request.apiKey },
    { ...valid, subgoal: "" },
    {
      ...valid,
      done: true,
      needsHuman: "Please help",
      actionId: null,
      text: null,
    },
  ])
    await assert.rejects(
      createPlanner(async () => Response.json(response(value)))(request),
      errorCode("invalid_response"),
    );
});

test("accepts a completion hypothesis but never executes anything", async () => {
  const request = input();
  const value = { ...output(request), actionId: null, text: null, done: true };
  const result = await createPlanner(async () =>
    Response.json(response(value)),
  )(request);
  assert.equal(result.done, true);
  assert.equal(result.actionId, null);
});

test("fails closed on incomplete output, refusal, and unexpected tool calls", async () => {
  const request = input();
  await assert.rejects(
    createPlanner(async () =>
      Response.json({ ...response(output(request)), status: "incomplete" }),
    )(request),
    errorCode("invalid_response"),
  );
  await assert.rejects(
    createPlanner(async () =>
      Response.json({
        model: PLANNER_MODEL,
        status: "completed",
        output: [{ type: "function_call", name: "exec" }],
      }),
    )(request),
    errorCode("invalid_response"),
  );
  await assert.rejects(
    createPlanner(async () =>
      Response.json({
        model: PLANNER_MODEL,
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "refusal", refusal: "private-detail" }],
          },
        ],
      }),
    )(request),
    errorCode("refused"),
  );
});

test("provider error bodies and network errors are redacted without retries", async () => {
  let calls = 0;
  const request = input();
  await assert.rejects(
    createPlanner(async () => {
      calls++;
      return new Response(request.apiKey, { status: 401 });
    })(request),
    errorCode("http_error"),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    createPlanner(async () => {
      throw new Error(request.apiKey);
    })(request),
    errorCode("network_error"),
  );
});

test("cancellation and timeout abort pending inference", async (t) => {
  const request = input();
  const controller = new AbortController();
  const hanging = createPlanner(
    async (_url, options) =>
      new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new Error(request.apiKey)),
          { once: true },
        );
      }),
  );
  const pending = hanging({ ...request, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, errorCode("cancelled"));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const expired = assert.rejects(hanging(request), errorCode("timeout"));
  t.mock.timers.tick(PLANNER_TIMEOUT_MS);
  await expired;
});

test("rejects outside-app candidates before contacting OpenAI", async () => {
  const request = input();
  request.candidates[0]!.appId = "outside";
  let calls = 0;
  await assert.rejects(
    createPlanner(async () => {
      calls++;
      return Response.json({});
    })(request),
    errorCode("invalid_input"),
  );
  assert.equal(calls, 0);
});
