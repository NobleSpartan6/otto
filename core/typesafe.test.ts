import assert from "node:assert/strict";
import test from "node:test";
import type { JevRequestMetric } from "../shared/types.js";
import {
  createDecider,
  TypeSafeError,
  type DecisionInput,
} from "./typesafe.js";

const input: DecisionInput = {
  goal: "Open the documentation",
  observation: { title: "Example", text: "Documentation" },
  candidates: [
    { id: "click-1", label: "Open Documentation" },
    { id: "stop", label: "Stop" },
  ],
  history: [],
  apiKey: "secret-test-key",
};

function validResponse() {
  return {
    model: "jev-latest",
    answers: {
      next_action: {
        type: "choice",
        choice: "click-1",
        confidence: 0.8,
        probabilities: { "click-1": 0.9, stop: 0.1 },
      },
      complete: { type: "noul", noul: 0.02 },
    },
    usage: { input_tokens: 321, output_tokens: 42 },
  };
}

function hasCode(code: TypeSafeError["code"]) {
  return (error: unknown) =>
    error instanceof TypeSafeError &&
    error.code === code &&
    !error.message.includes(input.apiKey);
}

test("sends documented native questions and returns a validated decision", async () => {
  let calls = 0;
  const decide = createDecider(async (url, options) => {
    calls++;
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(options?.method, "POST");
    assert.equal(options?.redirect, "error");
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      `Bearer ${input.apiKey}`,
    );
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "jev-latest");
    assert.deepEqual(body.state, {
      goal: input.goal,
      observation: input.observation,
      history: [],
    });
    assert.deepEqual(body.questions.next_action.criteria, {
      "click-1": "Open Documentation",
      stop: "Stop",
    });
    assert.equal(body.questions.next_action.type, "choice");
    assert.equal(body.questions.complete.type, "noul");
    assert.ok(!String(options?.body).includes(input.apiKey));
    return Response.json(validResponse());
  });
  const result = await decide(input);
  assert.equal(calls, 1);
  assert.equal(result.choice, "click-1");
  assert.equal(result.confidence, 0.8);
  assert.equal(result.probabilities["click-1"], 0.9);
  assert.equal(result.complete, 0.02);
  assert.equal(result.inputTokens, 321);
  assert.equal(result.outputTokens, 42);
  assert.equal(result.model, "jev-latest");
  assert.ok(Number.isFinite(result.latencyMs) && result.latencyMs >= 0);
});

test("rejects malformed, unsupported, or inconsistent model responses", async (t) => {
  const cases: Array<
    [string, (value: ReturnType<typeof validResponse>) => void]
  > = [
    [
      "unknown action",
      (value) => {
        value.answers.next_action.choice = "delete-everything";
      },
    ],
    [
      "confidence outside range",
      (value) => {
        value.answers.next_action.confidence = 1.1;
      },
    ],
    [
      "nonfinite confidence",
      (value) => {
        value.answers.next_action.confidence = NaN;
      },
    ],
    [
      "negative probability",
      (value) => {
        value.answers.next_action.probabilities.stop = -0.1;
      },
    ],
    [
      "nonfinite probability",
      (value) => {
        value.answers.next_action.probabilities.stop = Infinity;
      },
    ],
    [
      "probabilities do not sum to one",
      (value) => {
        value.answers.next_action.probabilities.stop = 0.6;
      },
    ],
    [
      "choice contradicts probabilities",
      (value) => {
        value.answers.next_action.choice = "stop";
      },
    ],
    [
      "completion outside range",
      (value) => {
        value.answers.complete.noul = -0.1;
      },
    ],
    [
      "wrong answer type",
      (value) => {
        value.answers.complete.type = "choice";
      },
    ],
    [
      "negative usage",
      (value) => {
        value.usage.input_tokens = -1;
      },
    ],
    [
      "fractional usage",
      (value) => {
        value.usage.output_tokens = 0.5;
      },
    ],
    [
      "missing model",
      (value) => {
        value.model = "";
      },
    ],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const value = validResponse();
      mutate(value);
      await assert.rejects(
        createDecider(async () => Response.json(value))(input),
        hasCode("invalid_response"),
      );
    });
  }
  for (const probabilities of [
    { "click-1": 1 },
    { "click-1": 0.9, surprise: 0.1 },
  ]) {
    const value = validResponse();
    const response = {
      ...value,
      answers: {
        ...value.answers,
        next_action: { ...value.answers.next_action, probabilities },
      },
    };
    await assert.rejects(
      createDecider(async () => Response.json(response))(input),
      hasCode("invalid_response"),
    );
  }
  await assert.rejects(
    createDecider(async () => new Response("invalid JSON"))(input),
    hasCode("invalid_response"),
  );
  await assert.rejects(
    createDecider(async () => Response.json(null))(input),
    hasCode("invalid_response"),
  );
});

test("redacts auth error bodies and never retries", async () => {
  let calls = 0;
  const decide = createDecider(async () => {
    calls++;
    return new Response(`Invalid key: ${input.apiKey}`, { status: 401 });
  });
  await assert.rejects(decide(input), (error) => {
    assert.ok(error instanceof TypeSafeError);
    assert.equal(error.code, "http_error");
    assert.equal(error.status, 401);
    assert.ok(!error.message.includes(input.apiKey));
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(calls, 1);
});

test("does not retry rate limits and redacts network errors", async () => {
  let calls = 0;
  const decide = createDecider(async () => {
    calls++;
    return new Response(input.apiKey, { status: 429 });
  });
  await assert.rejects(decide(input), hasCode("http_error"));
  assert.equal(calls, 1);
  await assert.rejects(
    createDecider(async () => {
      throw new Error(input.apiKey);
    })(input),
    hasCode("network_error"),
  );
});

test("does not send already cancelled requests", async () => {
  const controller = new AbortController();
  controller.abort(input.apiKey);
  let calls = 0;
  const decide = createDecider(async () => {
    calls++;
    return Response.json(validResponse());
  });
  await assert.rejects(
    decide({ ...input, signal: controller.signal }),
    hasCode("cancelled"),
  );
  assert.equal(calls, 0);
});

test("cancellation aborts an in-flight request without exposing its reason", async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  const decide = createDecider(async (_url, options) => {
    requestSignal = options?.signal;
    return new Promise<Response>((_resolve, reject) => {
      requestSignal?.addEventListener(
        "abort",
        () => reject(new Error(input.apiKey)),
        { once: true },
      );
    });
  });
  const pending = decide({ ...input, signal: controller.signal });
  controller.abort(input.apiKey);
  await assert.rejects(pending, hasCode("cancelled"));
  assert.equal(requestSignal?.aborted, true);
});

test("aborts timed-out requests after 15 seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const decide = createDecider(
    async (_url, options) =>
      new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      }),
  );
  const assertion = assert.rejects(decide(input), hasCode("timeout"));
  t.mock.timers.tick(15_000);
  await assertion;
});

test("rejects duplicate candidates before calling the provider", async () => {
  let calls = 0;
  const decide = createDecider(async () => {
    calls++;
    return Response.json(validResponse());
  });
  await assert.rejects(
    decide({
      ...input,
      candidates: [input.candidates[0]!, input.candidates[0]!],
    }),
    hasCode("invalid_input"),
  );
  assert.equal(calls, 0);
});

test("request ledger preserves actual model and both usage counters without request data", async () => {
  const records: JevRequestMetric[] = [];
  const response = { ...validResponse(), model: "jev-fixture-2026-09" };
  const result = await createDecider(async () => Response.json(response))({ ...input, onRequest: record => records.push(record) });
  assert.equal(result.model, response.model);
  assert.equal(records.length, 3);
  assert.equal(records[0]!.outcome, "pending");
  assert.equal(records[0]!.responseReceived, false);
  assert.equal(records[1]!.responseReceived, true);
  const final = records.at(-1)!;
  assert.equal(final.outcome, "succeeded");
  assert.equal(final.model, response.model);
  assert.equal(final.inputTokens, 321);
  assert.equal(final.outputTokens, 42);
  assert.equal(final.httpStatus, 200);
  assert.ok(final.completedAt && final.latencyMs !== null);
  assert.equal(new Set(records.map(record => record.id)).size, 1);
  assert.doesNotMatch(JSON.stringify(records), /secret-test-key|Open the documentation|Authorization/);
});

test("invalid decisions retain reported usage; malformed counters remain unknown", async () => {
  for (const outputTokens of [42, undefined, -1]) {
    const records: JevRequestMetric[] = [];
    const response = validResponse();
    response.answers.next_action.choice = "not-a-candidate";
    const body = { ...response, usage: { input_tokens: 321, output_tokens: outputTokens } };
    await assert.rejects(createDecider(async () => Response.json(body))({ ...input, onRequest: record => records.push(record) }), hasCode("invalid_response"));
    assert.equal(records.at(-1)!.outcome, "invalid_response");
    assert.equal(records.at(-1)!.responseReceived, true);
    assert.equal(records.at(-1)!.inputTokens, 321);
    assert.equal(records.at(-1)!.outputTokens, outputTokens === 42 ? 42 : null);
  }
});

test("HTTP/network failures and cancellation report unknown usage, never zero", async () => {
  for (const kind of ["http", "network", "cancel"] as const) {
    const records: JevRequestMetric[] = [];
    const controller = new AbortController();
    const fetcher: typeof fetch = async (_url, options) => {
      if (kind === "http") return new Response(input.apiKey, { status: 429 });
      if (kind === "network") throw new Error(input.apiKey);
      return new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error(input.apiKey)), { once: true });
      });
    };
    const pending = createDecider(fetcher)({ ...input, signal: controller.signal, onRequest: record => records.push(record) });
    if (kind === "cancel") controller.abort();
    await assert.rejects(pending, hasCode(kind === "http" ? "http_error" : kind === "network" ? "network_error" : "cancelled"));
    const final = records.at(-1)!;
    assert.equal(final.responseReceived, kind === "http");
    assert.equal(final.inputTokens, null);
    assert.equal(final.outputTokens, null);
    assert.equal(final.model, null);
    assert.ok(final.completedAt && final.latencyMs !== null);
    assert.ok(!JSON.stringify(records).includes(input.apiKey));
  }
  const controller = new AbortController(); controller.abort();
  const records: JevRequestMetric[] = [];
  await assert.rejects(createDecider(async () => { throw new Error("Must not send"); })({ ...input, signal: controller.signal, onRequest: record => records.push(record) }), hasCode("cancelled"));
  assert.equal(records.length, 0);
});

test("timeout remains an attempted request with unknown provider usage", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const records: JevRequestMetric[] = [];
  const decide = createDecider(async (_url, options) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  const pending = assert.rejects(decide({ ...input, onRequest: record => records.push(record) }), hasCode("timeout"));
  t.mock.timers.tick(15_000);
  await pending;
  assert.equal(records.at(-1)!.outcome, "timeout");
  assert.equal(records.at(-1)!.inputTokens, null);
  assert.equal(records.at(-1)!.outputTokens, null);
});

test("provider model metadata cannot echo the credential into the ledger", async () => {
  const records: JevRequestMetric[] = [];
  await assert.rejects(createDecider(async () => Response.json({ ...validResponse(), model: input.apiKey }))({ ...input, onRequest: record => records.push(record) }), hasCode("invalid_response"));
  assert.equal(records.at(-1)!.model, null);
  assert.ok(!JSON.stringify(records).includes(input.apiKey));
});
