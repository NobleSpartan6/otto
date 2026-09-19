import assert from "node:assert/strict";
import test from "node:test";
import type {
  DesktopApp,
  NativeAction,
  NativeDriver,
  NativeSnapshot,
  StartInput,
} from "../shared/types.js";
import {
  OttoEngine,
  APPROVAL_TTL_MS,
  MAX_STEPS,
  MAX_PLANNER_CALLS,
  RUN_TIMEOUT_MS,
} from "./engine.js";
import { buildCandidates, MAX_CANDIDATES } from "./candidates.js";
import type { Decision, DecisionInput } from "./typesafe.js";
import { PLANNER_MODEL, type Plan, type PlannerInput } from "./planner.js";

const KEY = "typesafe-private-test-key";
const apps: DesktopApp[] = [
  { id: "app-one", name: "Text editor", pid: 100 },
  { id: "app-two", name: "Calculator", pid: 200 },
  { id: "app-three", name: "Unselected", pid: 300 },
];
const input: StartInput = {
  goal: 'Enter "hello" in the document',
  appIds: ["app-one"],
  consent: true,
};

function snapshot(appId = "app-one", sequence = 1): NativeSnapshot {
  return {
    snapshotId: `snapshot-${sequence}`,
    app: apps.find((app) => app.id === appId)!,
    title: "Untitled",
    text: "Document New",
    capturedAt: new Date().toISOString(),
    screenshot: "data:image/png;base64,SECRET_SCREENSHOT",
    controls: [
      {
        id: "new",
        role: "button",
        label: "New",
        enabled: true,
        actions: ["press"],
      },
      {
        id: "document",
        role: "text",
        label: "Document",
        enabled: true,
        editable: true,
        actions: ["fill"],
      },
      {
        id: "password",
        role: "secureText",
        label: "Password",
        value: "protected-password",
        enabled: true,
        editable: true,
        sensitive: true,
        actions: ["fill"],
      },
    ],
  };
}

class Driver implements NativeDriver {
  actions: NativeAction[] = [];
  configured: string[][] = [];
  observations = 0;
  discoveries = 0;
  cancels = 0;
  makeSnapshot = (id: string, sequence: number) => snapshot(id, sequence);
  async apps() {
    this.discoveries++;
    return {
      apps,
      permissions: {
        accessibility: true,
        screenCapture: true,
        platform: "test",
      },
    };
  }
  async configure(ids: string[]) {
    this.configured.push(ids);
  }
  async observe(id: string) {
    return this.makeSnapshot(id, ++this.observations);
  }
  async act(action: NativeAction) {
    this.actions.push(action);
  }
  cancel() {
    this.cancels++;
  }
}

function decision(request: DecisionInput, prefix = "Press"): Decision {
  const selected = request.candidates.find((candidate) =>
    candidate.label.startsWith(prefix),
  );
  assert.ok(selected, `Missing candidate ${prefix}`);
  return {
    choice: selected.id,
    confidence: 0.9,
    probabilities: Object.fromEntries(
      request.candidates.map((candidate) => [
        candidate.id,
        candidate.id === selected.id ? 1 : 0,
      ]),
    ),
    complete: 0,
    latencyMs: 1,
    inputTokens: 100,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function startReady(
  engine: OttoEngine,
  value: StartInput,
  key: string,
  plannerKey?: string,
) {
  const run = await engine.start(value, key, plannerKey);
  return engine.waitForIdle(run.id);
}

async function approveReady(engine: OttoEngine, id: string, actionId: string) {
  await engine.approve(id, actionId);
  return engine.waitForIdle(id);
}

test("every native action waits for explicit approval and provider payload omits screenshots and protected values", async () => {
  const driver = new Driver();
  let request!: DecisionInput;
  let calls = 0;
  const engine = new OttoEngine(driver, async (value) => {
    request = value;
    return decision(value, ++calls === 1 ? "Enter" : "Finish");
  });
  const run = await startReady(engine, input, KEY);
  assert.equal(run.status, "awaiting_approval");
  assert.equal(run.pendingAction?.appName, "Text editor");
  assert.equal(run.pendingAction?.operation, "fill");
  assert.equal(run.pendingAction?.target, "Document");
  assert.equal(run.pendingAction?.value, "hello");
  assert.equal(driver.actions.length, 0);
  assert.ok(run.snapshot?.screenshot);
  assert.ok(
    !JSON.stringify({ ...request, apiKey: undefined }).includes(
      "SECRET_SCREENSHOT",
    ),
  );
  assert.ok(
    !JSON.stringify(request.observation).includes("protected-password"),
  );
  assert.ok(!JSON.stringify(run).includes("protected-password"));
  assert.ok(!JSON.stringify(request.observation).includes("snapshot-"));
  assert.ok(JSON.stringify(request.observation).includes("Document New"));
  assert.ok(!JSON.stringify(run).includes(KEY));
  assert.deepEqual(driver.configured, [["app-one"]]);
  const next = await approveReady(engine, run.id, run.pendingAction!.id);
  assert.equal(driver.actions.length, 1);
  assert.equal(driver.actions[0]!.value, "hello");
  assert.equal(next.status, "awaiting_confirmation");
  engine.stopAll();
});

test("completion is a human assertion, never a model probability", async () => {
  const driver = new Driver();
  const engine = new OttoEngine(driver, async (request) => ({
    ...decision(request, "Finish"),
    complete: 1,
  }));
  const run = await startReady(engine, input, KEY);
  assert.equal(run.status, "awaiting_confirmation");
  assert.equal(run.verification, undefined);
  assert.equal(driver.actions.length, 0);
  const completed = engine.confirm(run.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.verification, "user_confirmed");
  assert.equal(engine.isActive, false);
  assert.throws(() => engine.confirm(run.id));
  const actionEngine = new OttoEngine(driver, async (request) => ({
    ...decision(request),
    complete: 1,
  }));
  const actionRun = await startReady(actionEngine, input, KEY);
  assert.equal(actionRun.status, "awaiting_approval");
  assert.throws(() => actionEngine.confirm(actionRun.id));
  actionEngine.stopAll();
});

test("validates consent, goal, key, and explicit app selection before driver access", async () => {
  const driver = new Driver();
  const engine = new OttoEngine(driver);
  for (const bad of [
    { ...input, consent: false },
    { ...input, goal: "" },
    { ...input, goal: "a".repeat(4001) },
    { ...input, appIds: [] },
    { ...input, appIds: ["app-one", "app-one"] },
    { ...input, appIds: ["a", "b", "c", "d", "e"] },
    { ...input, goal: KEY },
  ])
    await assert.rejects(engine.start(bad, KEY));
  await assert.rejects(engine.start(input, ""));
  await assert.rejects(engine.start(input, "bad\nkey"));
  assert.equal(driver.discoveries, 0);
});

test("only observed supported controls and allowlisted app switches become candidates", () => {
  const observation = snapshot();
  observation.controls.push(
    {
      id: "disabled",
      role: "button",
      label: "Disabled",
      enabled: false,
      actions: ["press"],
    },
    {
      id: "unsupported",
      role: "button",
      label: "Arbitrary shell",
      enabled: true,
      actions: ["exec"],
    },
    {
      id: "sensitive-label",
      role: "text",
      label: "API key",
      enabled: true,
      editable: true,
      actions: ["fill"],
    },
    {
      id: "scroll",
      role: "list",
      label: "Items",
      enabled: true,
      actions: ["scrollUp", "scrollDown"],
    },
  );
  const candidates = buildCandidates(observation, apps.slice(0, 2), input.goal);
  assert.ok(
    candidates.every((candidate) =>
      ["app-one", "app-two"].includes(candidate.appId),
    ),
  );
  assert.ok(
    !candidates.some((candidate) =>
      ["password", "disabled", "unsupported", "sensitive-label"].includes(
        candidate.targetId ?? "",
      ),
    ),
  );
  assert.equal(
    candidates.filter((candidate) => candidate.kind === "fill").length,
    1,
  );
  assert.equal(
    candidates.filter((candidate) => candidate.kind === "scroll").length,
    2,
  );
  assert.equal(
    candidates.find((candidate) => candidate.kind === "activate")!.appId,
    "app-two",
  );
  assert.ok(
    buildCandidates(observation, apps.slice(0, 1), "Write a poem").every(
      (candidate) => candidate.kind !== "fill",
    ),
  );
});

test("unknown model choices and observations from outside the selected app fail closed", async () => {
  const driver = new Driver();
  const engine = new OttoEngine(driver, async (request) => ({
    ...decision(request),
    choice: "invented-id",
  }));
  assert.equal((await startReady(engine, input, KEY)).status, "failed");
  assert.equal(driver.actions.length, 0);
  let calls = 0;
  driver.makeSnapshot = () => snapshot("app-three");
  const other = new OttoEngine(driver, async (request) => {
    calls++;
    return decision(request);
  });
  assert.equal((await startReady(other, input, KEY)).status, "failed");
  assert.equal(calls, 0);
  const unknown = await startReady(
    other,
    { ...input, appIds: ["not-running"] },
    KEY,
  );
  assert.equal(unknown.status, "failed");
});

test("expired approvals reobserve and replan instead of replaying old actions", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const driver = new Driver();
  const engine = new OttoEngine(driver, async (request) => decision(request));
  const run = await startReady(engine, input, KEY);
  const oldId = run.pendingAction!.id;
  t.mock.timers.tick(APPROVAL_TTL_MS);
  const updated = await approveReady(engine, run.id, oldId);
  assert.equal(driver.actions.length, 0);
  assert.equal(driver.observations, 2);
  assert.equal(updated.status, "awaiting_approval");
  assert.notEqual(updated.pendingAction!.id, oldId);
  await assert.rejects(engine.approve(run.id, oldId));
  engine.stopAll();
});

test("duplicate approvals can dispatch only once", async () => {
  const driver = new Driver();
  const action = deferred<void>();
  driver.act = async (value) => {
    driver.actions.push(value);
    await action.promise;
  };
  const engine = new OttoEngine(driver, async (request) =>
    decision(request, driver.actions.length ? "Finish" : "Press"),
  );
  const run = await startReady(engine, input, KEY);
  const pending = engine.approve(run.id, run.pendingAction!.id);
  await assert.rejects(engine.approve(run.id, run.pendingAction!.id));
  assert.equal(driver.actions.length, 1);
  action.resolve();
  await pending;
  await engine.waitForIdle(run.id);
  engine.stopAll();
});

test("stop while inference is pending prevents a late model response from restoring approval", async () => {
  const driver = new Driver();
  const response = deferred<Decision>();
  const entered = deferred<DecisionInput>();
  const engine = new OttoEngine(driver, async (request) => {
    entered.resolve(request);
    return response.promise;
  });
  const pending = engine.start(input, KEY);
  const request = await entered.promise;
  engine.stopAll();
  assert.equal(request.signal!.aborted, true);
  await assert.rejects(engine.start(input, KEY));
  response.resolve(decision(request));
  const run = await engine.waitForIdle((await pending).id);
  assert.equal(run.status, "stopped");
  assert.equal(run.pendingAction, undefined);
  assert.equal(driver.actions.length, 0);
  assert.equal(engine.isActive, false);
});

test("a stopped start retains its reservation until pending configuration settles", async () => {
  const driver = new Driver();
  const configured = deferred<void>();
  const entered = deferred<void>();
  driver.configure = async () => {
    entered.resolve();
    await configured.promise;
  };
  const engine = new OttoEngine(driver, async (request) => decision(request));
  const pending = engine.start(input, KEY);
  await entered.promise;
  engine.stopAll();
  await assert.rejects(engine.start(input, KEY));
  configured.resolve();
  assert.equal(
    (await engine.waitForIdle((await pending).id)).status,
    "stopped",
  );
  assert.equal(driver.observations, 0);
  assert.equal(engine.isActive, false);
});

test("stop cancels the helper immediately and ignores a late native result", async () => {
  const driver = new Driver();
  const response = deferred<void>();
  driver.act = async (value) => {
    driver.actions.push(value);
    await response.promise;
  };
  const engine = new OttoEngine(driver, async (request) => decision(request));
  const run = await startReady(engine, input, KEY);
  const pending = engine.approve(run.id, run.pendingAction!.id);
  const cancels = driver.cancels;
  engine.stop(run.id);
  assert.equal(driver.cancels, cancels + 1);
  response.resolve();
  const stopped = await engine.waitForIdle((await pending).id);
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.step, 0);
  assert.equal(driver.observations, 1);
});

test("three identical effects with unchanged observations stop the loop", async () => {
  const driver = new Driver();
  const engine = new OttoEngine(driver, async (request) => decision(request));
  let run = await startReady(engine, input, KEY);
  for (let i = 0; i < 3; i++)
    run = await approveReady(engine, run.id, run.pendingAction!.id);
  assert.equal(run.status, "blocked");
  assert.equal(run.step, 3);
  assert.equal(driver.actions.length, 3);
});

test("call and action budgets stop at twenty without making another inference", async () => {
  const driver = new Driver();
  driver.makeSnapshot = (id, sequence) => ({
    ...snapshot(id, sequence),
    text: `Changed state ${sequence}`,
  });
  let calls = 0;
  const engine = new OttoEngine(driver, async (request) => {
    calls++;
    return decision(request);
  });
  let run = await startReady(engine, input, KEY);
  for (let i = 0; i < MAX_STEPS; i++)
    run = await approveReady(engine, run.id, run.pendingAction!.id);
  assert.equal(run.status, "limit_reached");
  assert.equal(calls, MAX_STEPS);
  assert.equal(driver.actions.length, MAX_STEPS);
});

test("human approval waiting is included in the ten-minute deadline", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  const driver = new Driver();
  const engine = new OttoEngine(driver, async (request) => decision(request));
  const run = await startReady(engine, input, KEY);
  t.mock.timers.tick(RUN_TIMEOUT_MS);
  assert.equal(engine.get(run.id).status, "limit_reached");
  assert.equal(engine.get(run.id).pendingAction, undefined);
  assert.equal(engine.isActive, false);
  await assert.rejects(engine.approve(run.id, run.pendingAction!.id));
});

test("native failures are not retried and do not expose provider or credential details", async () => {
  const driver = new Driver();
  driver.act = async (value) => {
    driver.actions.push(value);
    throw new Error(KEY);
  };
  const engine = new OttoEngine(driver, async (request) => decision(request));
  const run = await startReady(engine, input, KEY);
  const failed = await approveReady(engine, run.id, run.pendingAction!.id);
  assert.equal(failed.status, "failed");
  assert.equal(driver.actions.length, 1);
  assert.ok(!JSON.stringify(failed).includes(KEY));
  assert.equal(engine.isActive, false);
});

test("get returns a copy and cannot be used to alter an approved target", async () => {
  const driver = new Driver();
  const engine = new OttoEngine(driver, async (request) => decision(request));
  const run = await startReady(engine, input, KEY);
  run.appIds.push("app-three");
  run.pendingAction!.id = "invented";
  run.snapshot!.controls[0]!.id = "outside";
  const current = engine.get(run.id);
  assert.deepEqual(current.appIds, ["app-one"]);
  assert.equal(current.snapshot!.controls[0]!.id, "new");
  await assert.rejects(engine.approve(run.id, "invented"));
  engine.stopAll();
});

function proposal(request: PlannerInput, fill = false): Plan {
  return {
    subgoal: fill ? "Write a greeting in the document" : "Open a document",
    summary: fill
      ? "Compose a short greeting for the document."
      : "Open a document using the available controls.",
    actionId: request.candidates.find(
      (candidate) => candidate.kind === (fill ? "fill" : "press"),
    )!.id,
    text: fill ? "Hello from Otto!" : null,
    done: false,
    needsHuman: null,
    latencyMs: 5,
    model: PLANNER_MODEL,
  };
}

test("hybrid caches the planner subgoal and offers generated text as an approval-gated Jev candidate", async () => {
  const driver = new Driver();
  let plannerCalls = 0;
  let jevCalls = 0;
  const plannerKey = "openai-private-test-key";
  const engine = new OttoEngine(
    driver,
    async (request) => {
      jevCalls++;
      assert.equal(request.goal, "Write a greeting in the document");
      assert.equal(request.apiKey, KEY);
      assert.ok(
        !JSON.stringify({ ...request, apiKey: undefined }).includes(plannerKey),
      );
      assert.ok(
        !JSON.stringify(request.observation).includes("SECRET_SCREENSHOT"),
      );
      return decision(
        request,
        jevCalls === 1 ? 'Enter "Hello from Otto!"' : "Press New",
      );
    },
    async (request) => {
      plannerCalls++;
      assert.equal(request.apiKey, plannerKey);
      assert.equal(request.allowScreenshot, false);
      return proposal(request, true);
    },
  );
  const run = await startReady(
    engine,
    { ...input, goal: "Write a short greeting", mode: "hybrid" },
    KEY,
    plannerKey,
  );
  assert.equal(run.status, "awaiting_approval");
  assert.match(run.pendingAction!.label, /Hello from Otto/);
  assert.equal(driver.actions.length, 0);
  assert.equal(run.plannerCalls, 1);
  assert.equal(run.decisionCalls, 1);
  const next = await approveReady(engine, run.id, run.pendingAction!.id);
  assert.equal(driver.actions[0]!.value, "Hello from Otto!");
  assert.equal(next.status, "awaiting_approval");
  assert.equal(plannerCalls, 1);
  assert.equal(jevCalls, 2);
  assert.ok(!JSON.stringify(next).includes(plannerKey));
  assert.ok(!JSON.stringify(next).includes(KEY));
  assert.equal(
    next.events.find((event) => event.kind === "planner")!.model,
    PLANNER_MODEL,
  );
  engine.stopAll();
});

test("hybrid escalates uncertainty after an ordinary fast-path action", async () => {
  const driver = new Driver();
  const reasons: string[] = [];
  let decisions = 0;
  const engine = new OttoEngine(
    driver,
    async (request) => ({
      ...decision(request),
      confidence: ++decisions === 2 ? 0.2 : 0.9,
    }),
    async (request) => {
      reasons.push(request.reason!);
      return proposal(request);
    },
  );
  const run = await startReady(
    engine,
    { ...input, mode: "hybrid" },
    KEY,
    "openai-key",
  );
  const next = await approveReady(engine, run.id, run.pendingAction!.id);
  assert.deepEqual(reasons, ["initial_plan", "uncertain"]);
  assert.equal(next.plannerCalls, 2);
  assert.equal(driver.actions.length, 1);
  assert.equal(next.status, "awaiting_approval");
  engine.stopAll();
});

test("trace metrics sum measured usage and latency while preserving unknown planner totals", async () => {
  const driver = new Driver();
  driver.makeSnapshot = (id, sequence) => ({ ...snapshot(id, sequence), text: `State ${sequence}` });
  const usage = [
    { inputTokens: 1000, outputTokens: 20 },
    { inputTokens: 700, outputTokens: 30 },
    undefined,
    { inputTokens: 100, outputTokens: 4 },
  ];
  let calls = 0;
  const engine = new OttoEngine(
    driver,
    async request => ({ ...decision(request), confidence: 0.2 }),
    async request => ({ ...proposal(request), usage: usage[calls++] }),
  );
  try {
    let run = await engine.start({ ...input, mode: "hybrid" }, KEY, "openai-key");
    assert.deepEqual(run.metrics, { jevInputTokens: 0, plannerInputTokens: null, plannerOutputTokens: null, modelLatencyMs: 0 });
    run = await engine.waitForIdle(run.id);
    assert.deepEqual(run.metrics, { jevInputTokens: 100, plannerInputTokens: 1000, plannerOutputTokens: 20, modelLatencyMs: 6 });
    run = await approveReady(engine, run.id, run.pendingAction!.id);
    assert.deepEqual(run.metrics, { jevInputTokens: 300, plannerInputTokens: 1700, plannerOutputTokens: 50, modelLatencyMs: 13 });
    run = await approveReady(engine, run.id, run.pendingAction!.id);
    assert.deepEqual(run.metrics, { jevInputTokens: 500, plannerInputTokens: null, plannerOutputTokens: null, modelLatencyMs: 20 });
    run = await approveReady(engine, run.id, run.pendingAction!.id);
    assert.deepEqual(run.metrics, { jevInputTokens: 700, plannerInputTokens: null, plannerOutputTokens: null, modelLatencyMs: 27 });
    assert.equal(run.plannerCalls, 4);
    assert.equal(run.decisionCalls, 7);
    assert.deepEqual(JSON.parse(JSON.stringify(run)).metrics, run.metrics);
  } finally { engine.stopAll(); }
});

test("hybrid escalates a three-action stall without issuing an unapproved recovery action", async () => {
  const driver = new Driver();
  const reasons: string[] = [];
  const engine = new OttoEngine(
    driver,
    async (request) => decision(request),
    async (request) => {
      reasons.push(request.reason!);
      return proposal(request);
    },
  );
  let run = await startReady(
    engine,
    { ...input, mode: "hybrid" },
    KEY,
    "openai-key",
  );
  for (let i = 0; i < 3; i++)
    run = await approveReady(engine, run.id, run.pendingAction!.id);
  assert.deepEqual(reasons, ["initial_plan", "stalled"]);
  assert.equal(driver.actions.length, 3);
  assert.equal(run.status, "awaiting_approval");
  engine.stopAll();
});

test("Jev-only mode never calls the planner and hybrid requires its own key", async () => {
  const driver = new Driver();
  let plans = 0;
  const engine = new OttoEngine(
    driver,
    async (request) => decision(request),
    async (request) => {
      plans++;
      return proposal(request);
    },
  );
  await assert.rejects(engine.start({ ...input, mode: "hybrid" }, KEY));
  const run = await startReady(engine, { ...input, mode: "jev" }, KEY);
  assert.equal(plans, 0);
  assert.equal(run.plannerCalls, 0);
  engine.stopAll();
});

test("hybrid asks the planner about subgoal completion and still requires user confirmation", async () => {
  const driver = new Driver();
  let plans = 0;
  const engine = new OttoEngine(
    driver,
    async (request) =>
      decision(request, driver.actions.length ? "Finish" : "Press"),
    async (request) => {
      plans++;
      return plans === 1
        ? proposal(request)
        : {
            ...proposal(request),
            actionId: null,
            text: null,
            done: true,
            summary: "The requested document is visible.",
          };
    },
  );
  const run = await startReady(
    engine,
    { ...input, mode: "hybrid" },
    KEY,
    "openai-key",
  );
  const next = await approveReady(engine, run.id, run.pendingAction!.id);
  assert.equal(plans, 2);
  assert.equal(next.status, "awaiting_confirmation");
  assert.equal(next.verification, undefined);
  assert.equal(engine.confirm(run.id).verification, "user_confirmed");
});

test("planner call budget is enforced independently of the Jev decision budget", async () => {
  const driver = new Driver();
  driver.makeSnapshot = (id, sequence) => ({
    ...snapshot(id, sequence),
    text: `State ${sequence}`,
  });
  let plans = 0;
  const engine = new OttoEngine(
    driver,
    async (request) => ({ ...decision(request), confidence: 0.2 }),
    async (request) => {
      plans++;
      return proposal(request);
    },
  );
  let run = await startReady(
    engine,
    { ...input, mode: "hybrid" },
    KEY,
    "openai-key",
  );
  for (let i = 0; i < MAX_PLANNER_CALLS; i++)
    run = await approveReady(engine, run.id, run.pendingAction!.id);
  assert.equal(run.status, "limit_reached");
  assert.equal(plans, MAX_PLANNER_CALLS);
  assert.equal(run.plannerCalls, MAX_PLANNER_CALLS);
});

test("start returns a task ID immediately and Stop cancels a pending planner", async () => {
  const driver = new Driver();
  const entered = deferred<PlannerInput>();
  const planned = deferred<Plan>();
  let decisions = 0;
  const engine = new OttoEngine(
    driver,
    async (request) => {
      decisions++;
      return decision(request);
    },
    async (request) => {
      entered.resolve(request);
      return planned.promise;
    },
  );
  const run = await engine.start(
    { ...input, mode: "hybrid" },
    KEY,
    "openai-key",
  );
  assert.ok(run.id);
  assert.equal(run.status, "running");
  const request = await entered.promise;
  engine.stop(run.id);
  assert.equal(request.signal!.aborted, true);
  planned.resolve(proposal(request));
  assert.equal((await engine.waitForIdle(run.id)).status, "stopped");
  assert.equal(decisions, 0);
  assert.equal(driver.actions.length, 0);
});

test("planner output cannot introduce an unknown target or echo provider credentials into run state", async () => {
  for (const mutation of ["target", "key"]) {
    const driver = new Driver();
    const engine = new OttoEngine(
      driver,
      async (request) => decision(request),
      async (request) => ({
        ...proposal(request),
        ...(mutation === "target"
          ? { actionId: "invented" }
          : { summary: KEY }),
      }),
    );
    const run = await startReady(
      engine,
      { ...input, mode: "hybrid" },
      KEY,
      "openai-key",
    );
    assert.equal(run.status, "failed");
    assert.ok(!JSON.stringify(run).includes(KEY));
    assert.equal(driver.actions.length, 0);
  }
});

test("candidate ranking bounds large observations while retaining typing, keys, switches, and task matches", () => {
  const observation = snapshot();
  observation.controls = Array.from({ length: 300 }, (_, i) => ({
    id: `button-${i}`,
    role: "button",
    label: `Item ${i}`,
    enabled: true,
    actions: ["press"],
  }));
  observation.controls.push(
    {
      id: "export",
      role: "button",
      label: "Export invoice",
      enabled: true,
      actions: ["press"],
    },
    {
      id: "input",
      role: "text",
      label: "Invoice name",
      enabled: true,
      editable: true,
      actions: ["fill"],
    },
  );
  const candidates = buildCandidates(
    observation,
    apps.slice(0, 2),
    'Export invoice named "report"',
  );
  assert.equal(candidates.length, MAX_CANDIDATES);
  assert.ok(candidates.some((candidate) => candidate.targetId === "export"));
  assert.ok(
    candidates.some(
      (candidate) => candidate.kind === "fill" && candidate.value === "report",
    ),
  );
  assert.deepEqual(
    candidates
      .filter((candidate) => candidate.kind === "key")
      .map((candidate) => candidate.value),
    ["enter", "escape", "tab"],
  );
  for (const kind of ["activate", "finish", "blocked"])
    assert.ok(candidates.some((candidate) => candidate.kind === kind));
});

test("bounded keyboard actions remain snapshot-bound and approval-gated", async () => {
  const driver = new Driver();
  const engine = new OttoEngine(driver, async (request) =>
    decision(request, driver.actions.length ? "Finish" : "Press Enter"),
  );
  const run = await startReady(engine, input, KEY);
  assert.equal(driver.actions.length, 0);
  const immediate = await engine.approve(run.id, run.pendingAction!.id);
  assert.equal(immediate.status, "running");
  await engine.waitForIdle(run.id);
  assert.equal(driver.actions[0]!.kind, "key");
  assert.equal(driver.actions[0]!.value, "enter");
  assert.equal(driver.actions[0]!.appId, "app-one");
  assert.equal(driver.actions[0]!.snapshotId, run.snapshot!.snapshotId);
  engine.stopAll();
});
