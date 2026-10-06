import { describe, expect, it } from "vitest";
import {
  createGameRuntime,
  createInMemoryPersistence,
  loadGameDefinition,
  type ModelInvocationOptions,
  type ModelRuntime,
  type ModelRuntimeCapabilities,
  type StructuredModelRequest,
  type StructuredModelResult,
  type TextModelRequest,
  type TextModelResult,
} from "@llm-ttrpg/engine";
import { contractTestGameDefinition } from "./support/contract-game.js";
import { createMigratedSqlitePersistence } from "./support/sqlite.js";

type QueuedAnswer = unknown | { failure: "invalid-output" | "timeout" };

class QueueModelRuntime implements ModelRuntime {
  readonly capabilities: ModelRuntimeCapabilities = {
    structuredOutput: true,
    streamingText: false,
  };
  readonly requests: Array<TextModelRequest | StructuredModelRequest<unknown>> = [];

  constructor(private readonly answers: QueuedAnswer[]) {}

  generate(
    request: TextModelRequest,
    options?: ModelInvocationOptions,
  ): Promise<TextModelResult>;
  generate<T>(
    request: StructuredModelRequest<T>,
    options?: ModelInvocationOptions,
  ): Promise<StructuredModelResult<T>>;
  async generate<T>(
    request: TextModelRequest | StructuredModelRequest<T>,
    _options?: ModelInvocationOptions,
  ): Promise<TextModelResult | StructuredModelResult<T>> {
    this.requests.push(request as TextModelRequest | StructuredModelRequest<unknown>);
    const answer = this.answers.shift();
    const metadata = { runtimeId: "queue-fixture", elapsedMs: 0 };
    if (answer && typeof answer === "object" && "failure" in answer) {
      const failure = (answer as { failure: "invalid-output" | "timeout" }).failure;
      return {
        ok: false,
        error: { kind: failure, message: `Fixture ${failure}` },
        metadata,
      };
    }
    if (request.output.kind === "text") {
      return {
        ok: true,
        output: { kind: "text", text: String(answer ?? "The action settles.") },
        metadata,
      };
    }
    return {
      ok: true,
      output: { kind: "structured", value: request.output.schema.parse(answer) },
      metadata,
    };
  }
}

function makeRuntime(persistence = createInMemoryPersistence()) {
  let id = 0;
  return {
    persistence,
    runtime: createGameRuntime({
      persistence,
      wallClock: { now: () => "2042-01-01T00:00:00.000Z" },
      idGenerator: { next: (kind) => `${kind}.action-${++id}` },
      worldSeedSource: { nextSeed: () => 0x1234_5678 },
      game: loadGameDefinition(contractTestGameDefinition),
    }),
  };
}

const request = {
  actionId: "action.fixture-one",
  actorId: "campaign.entity.amelia",
  declaration: "I press on and test my position.",
  budget: { maxUnits: 50_000 },
} as const;

describe("player action execution pipeline", () => {
  it("uses deterministic candidates without catalog discovery", async () => {
    const { runtime } = makeRuntime();
    const session = await runtime.createWorld("Bounded candidate selection");
    const model = new QueueModelRuntime([
      {
        kind: "interpreted",
        goal: "test the current position",
        targetRefs: [],
        modes: ["manipulation"],
        statedMeans: ["my hands"],
        requestedHorizonMs: 60_000,
        pressureLevel: 6,
      },
      {
        kind: "invoke-tool",
        toolId: "test.actions.resolve-effort",
        arguments: { base: 8, modifier: 2, difficulty: 9, durationMs: 1_000 },
      },
      { kind: "stop", reason: "goal-achieved" },
      "Amelia tests her footing and finds it holds.",
    ]);

    const result = await session.performPlayerAction(request, { modelRuntime: model });

    expect(result.kind).toBe("resolved");
    expect(result.trace.entries.some((entry) =>
      entry.phase === "catalog" &&
      typeof entry.detail === "object" &&
      entry.detail !== null &&
      !Array.isArray(entry.detail) &&
      entry.detail.stage === "deterministic-candidate-selection",
    )).toBe(true);
    expect(model.requests).toHaveLength(4);
    expect(model.requests.some((entry) => entry.prompt.instructions.some((instruction) =>
      instruction.includes("discover subsystems/tools"),
    ))).toBe(false);
    const boundedDecision = model.requests.find((entry) =>
      entry.output.kind === "structured" &&
      entry.output.schemaId === "player-action.execution-decision.v1",
    );
    expect(boundedDecision?.output.kind).toBe("structured");
    if (boundedDecision?.output.kind !== "structured") {
      throw new Error("Expected a bounded execution decision request");
    }
    expect(boundedDecision.output.schema.safeParse({
      kind: "invoke-tool",
      toolId: "test.actions.unrelated-capability",
      arguments: {},
    }).success).toBe(false);
  });

  it("records a model-turn limit without misreporting fictional-time exhaustion", async () => {
    const { runtime } = makeRuntime();
    const session = await runtime.createWorld("Model turn limit");
    const result = await session.performPlayerAction(
      { ...request, actionId: "action.turn-limit" },
      {
        modelRuntime: new QueueModelRuntime([
          {
            kind: "interpreted",
            goal: "inspect the current situation",
            targetRefs: [],
            requestedHorizonMs: 60_000,
            pressureLevel: 6,
          },
          { kind: "discover-subsystems", domainId: "test" },
        ]),
        maxModelTurns: 1,
      },
    );

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") throw new Error("Expected turn-limit failure");
    expect(result.failure.kind).toBe("turn-limit");
    expect(result.run).toEqual(expect.objectContaining({
      elapsedMs: 0,
      stopReason: "model-turn-limit",
    }));
  });

  it("interprets once, commits operations with receipts, stops, narrates, and resumes idempotently", async () => {
    const { runtime, persistence } = makeRuntime();
    const session = await runtime.createWorld("Action pipeline");
    const model = new QueueModelRuntime([
      { failure: "invalid-output" },
      {
        kind: "interpreted",
        goal: "test the current position",
        targetRefs: [],
        requestedHorizonMs: 60_000,
        pressureLevel: 6,
      },
      { kind: "discover-subsystems", domainId: "test" },
      { kind: "discover-tools", domainId: "test", subsystemId: "actions" },
      { kind: "inspect-tool", toolId: "test.actions.resolve-effort" },
      {
        kind: "invoke-tool",
        toolId: "test.actions.resolve-effort",
        arguments: { base: 8, modifier: 2, difficulty: 9, durationMs: 1_000 },
      },
      { kind: "stop", reason: "goal-achieved" },
      "Amelia tests her footing and finds it holds.",
    ]);

    const result = await session.performPlayerAction(request, { modelRuntime: model });
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") throw new Error("Expected resolved action");
    expect(result.run).toEqual(expect.objectContaining({
      status: "stopped",
      stopReason: "goal-achieved",
      elapsedMs: 1_000,
      narration: "Amelia tests her footing and finds it holds.",
    }));
    expect(result.run.receipts).toHaveLength(1);
    expect(result.run.receipts[0]).toEqual(expect.objectContaining({
      sequence: 1,
      toolId: "test.actions.resolve-effort",
      input: expect.objectContaining({ actorId: request.actorId }),
      worldRevisionBefore: 1,
      worldRevisionAfter: 2,
    }));
    expect(result.trace.entries.some((entry) => entry.phase === "catalog")).toBe(true);
    const narrationRequest = model.requests.at(-1);
    expect(narrationRequest?.output.kind).toBe("text");
    expect(narrationRequest?.prompt.input).not.toContain("campaign.entity.amelia");
    expect(narrationRequest?.prompt.input).not.toContain("proposedMutations");
    expect(await persistence.actionRuns.load(session.worldId, request.actionId)).toEqual(result.run);

    const replay = await session.performPlayerAction(request, {
      modelRuntime: new QueueModelRuntime(["Narration may be retried without replaying mechanics."]),
    });
    expect(replay.kind).toBe("resolved");
    expect((await persistence.worlds.load(session.worldId))?.revision).toBe(2);
    expect((await session.eventHistory({ types: ["test.effort-resolved"] }))).toHaveLength(1);
  });

  it("rolls back rejected tentative RNG and re-prompts for a recoverable proposal", async () => {
    const { runtime } = makeRuntime();
    const session = await runtime.createWorld("Rejected proposal");
    const result = await session.performPlayerAction(
      { ...request, actionId: "action.rng-rollback" },
      {
        modelRuntime: new QueueModelRuntime([
          {
            kind: "interpreted",
            goal: "resolve an uncertain attempt",
            targetRefs: [],
            requestedHorizonMs: 5_000,
            pressureLevel: 9,
          },
          {
            kind: "invoke-tool",
            toolId: "test.resolution.resolve-contract-fixture",
            arguments: { mode: "uncertain-random", modifier: 0, durationMs: 6_000 },
          },
          {
            kind: "invoke-tool",
            toolId: "test.resolution.resolve-contract-fixture",
            arguments: { mode: "uncertain-random", modifier: 0, durationMs: 1_000 },
          },
          { kind: "stop", reason: "goal-achieved" },
          "The uncertain attempt resolves.",
        ]),
      },
    );
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") throw new Error("Expected resolved action");
    expect(result.run.receipts).toHaveLength(1);
    expect(result.run.receipts[0]?.resolution?.randomness?.stream).toBe(0);
    expect(session.snapshot().randomness.nextStream).toBe(1);
    expect(result.trace.entries.some(
      (entry) => entry.phase === "rejection" && JSON.stringify(entry.detail).includes("remaining authorized horizon"),
    )).toBe(true);
  });

  it("persists an action run atomically in SQLite and keeps it out of checkpoints", async () => {
    const sqlite = await createMigratedSqlitePersistence();
    const { runtime } = makeRuntime(sqlite.persistence);
    const session = await runtime.createWorld("SQLite action pipeline");
    const result = await session.performPlayerAction(
      { ...request, actionId: "action.sqlite" },
      {
        modelRuntime: new QueueModelRuntime([
          {
            kind: "interpreted",
            goal: "make one deterministic effort",
            targetRefs: [],
            requestedHorizonMs: 10_000,
            pressureLevel: 7,
          },
          {
            kind: "invoke-tool",
            toolId: "test.resolution.resolve-contract-fixture",
            arguments: { mode: "uncertain-random", modifier: 1, durationMs: 500 },
          },
          { kind: "stop", reason: "goal-achieved" },
          "The effort succeeds.",
        ]),
      },
    );
    expect(result.kind).toBe("resolved");
    expect(await sqlite.persistence.actionRuns.load(session.worldId, "action.sqlite"))
      .toEqual(result.kind === "resolved" ? result.run : undefined);
    await session.save("after action");
    const checkpointColumns = sqlite.database.exec("PRAGMA table_info(checkpoints)")[0]?.values.flat() ?? [];
    expect(checkpointColumns).not.toContain("action_run");
    expect(sqlite.database.exec("SELECT COUNT(*) FROM action_runs")[0]?.values[0]?.[0]).toBe(1);
    const revision = (await sqlite.persistence.worlds.load(session.worldId))?.revision;
    const replay = await session.performPlayerAction(
      { ...request, actionId: "action.sqlite" },
      { modelRuntime: new QueueModelRuntime([]) },
    );
    expect(replay.kind).toBe("resolved");
    expect((await sqlite.persistence.worlds.load(session.worldId))?.revision).toBe(revision);
    expect(await session.eventHistory({ types: ["test.contract-resolution-recorded"] }))
      .toHaveLength(1);
    expect((await sqlite.persistence.worlds.load(session.worldId))?.state.randomness.nextStream)
      .toBe(1);
  });

  it("feeds a read-only query into fresh context before an uncertain resolution", async () => {
    const { runtime } = makeRuntime();
    const session = await runtime.createWorld("Query then resolve");
    const result = await session.performPlayerAction(
      { ...request, actionId: "action.query-resolution" },
      {
        modelRuntime: new QueueModelRuntime([
          {
            kind: "interpreted",
            goal: "learn what matters and attempt the uncertain action",
            targetRefs: [],
            requestedHorizonMs: 30_000,
            pressureLevel: 7,
          },
          { kind: "invoke-tool", toolId: "knowledge.facts.retrieve", arguments: {} },
          {
            kind: "invoke-tool",
            toolId: "test.resolution.resolve-contract-fixture",
            arguments: { mode: "uncertain-random", modifier: 0, durationMs: 1_500 },
          },
          { kind: "stop", reason: "goal-achieved" },
          "The attempt resolves according to what Amelia can perceive.",
        ]),
      },
    );
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") throw new Error("Expected resolved action");
    expect(result.trace.entries.find((entry) => entry.phase === "query")).toBeDefined();
    expect(result.run.receipts[0]?.resolution).toEqual(expect.objectContaining({
      path: "uncertain",
      randomness: expect.objectContaining({ stream: 0 }),
    }));
    expect(result.run.receipts[0]?.events).toHaveLength(1);
  });

  it("commits multiple fresh decisions exactly and stops early on material change", async () => {
    const { runtime } = makeRuntime();
    const session = await runtime.createWorld("Multiple operations");
    const model = new QueueModelRuntime([
      {
        kind: "interpreted",
        goal: "make broad progress until circumstances change",
        targetRefs: [],
        requestedHorizonMs: 7_200_000,
        pressureLevel: 2,
      },
      {
        kind: "invoke-tool",
        toolId: "test.actions.resolve-effort",
        arguments: { base: 4, modifier: 1, difficulty: 3, durationMs: 1_000 },
      },
      {
        kind: "invoke-tool",
        toolId: "test.actions.resolve-effort",
        arguments: { base: 7, modifier: 1, difficulty: 6, durationMs: 2_000 },
      },
      { kind: "stop", reason: "material-circumstance-change" },
      "Two efforts land before the situation changes.",
    ]);
    const result = await session.performPlayerAction(
      { ...request, actionId: "action.multiple" },
      { modelRuntime: model },
    );
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") throw new Error("Expected resolved action");
    expect(result.run.receipts.map((receipt) => receipt.advanceTimeByMs)).toEqual([1_000, 2_000]);
    expect(result.run.elapsedMs).toBe(3_000);
    expect(result.run.executableIntent.authorizedHorizonMs).toBe(7_200_000);
    expect(result.run.stopReason).toBe("material-circumstance-change");
    expect(await session.eventHistory({ types: ["test.effort-resolved"] })).toHaveLength(2);
    expect(model.requests.filter((item) => item.output.kind === "structured")).toHaveLength(4);
  });

  it("keeps committed reality after narration failure and retries prose only", async () => {
    const { runtime, persistence } = makeRuntime();
    const session = await runtime.createWorld("Narration retry");
    const actionRequest = { ...request, actionId: "action.narration-retry" };
    const first = await session.performPlayerAction(actionRequest, {
      modelRuntime: new QueueModelRuntime([
        {
          kind: "interpreted",
          goal: "complete one effort",
          targetRefs: [],
          requestedHorizonMs: 10_000,
          pressureLevel: 8,
        },
        {
          kind: "invoke-tool",
          toolId: "test.actions.resolve-effort",
          arguments: { base: 5, modifier: 0, difficulty: 4, durationMs: 1_000 },
        },
        { kind: "stop", reason: "goal-achieved" },
        { failure: "timeout" },
      ]),
    });
    expect(first.kind).toBe("resolved");
    if (first.kind !== "resolved") throw new Error("Expected committed result");
    expect(first.narrationFailure?.error.kind).toBe("timeout");
    const revision = (await persistence.worlds.load(session.worldId))?.revision;

    const retryModel = new QueueModelRuntime(["The already-recorded effort succeeds."]);
    const retry = await session.performPlayerAction(actionRequest, { modelRuntime: retryModel });
    expect(retry.kind).toBe("resolved");
    expect(retry.kind === "resolved" ? retry.narration : undefined).toBe("The already-recorded effort succeeds.");
    expect((await persistence.worlds.load(session.worldId))?.revision).toBe(revision);
    expect(await session.eventHistory({ types: ["test.effort-resolved"] })).toHaveLength(1);
    expect(retryModel.requests).toHaveLength(1);
  });

  it("feeds invalid proposals back without effects until a valid operation is chosen", async () => {
    const { runtime } = makeRuntime();
    const session = await runtime.createWorld("Proposal recovery");
    const result = await session.performPlayerAction(
      { ...request, actionId: "action.proposal-recovery" },
      {
        modelRuntime: new QueueModelRuntime([
          {
            kind: "interpreted",
            goal: "recover from invalid proposals",
            targetRefs: [],
            requestedHorizonMs: 10_000,
            pressureLevel: 8,
          },
          { kind: "invoke-tool", toolId: "test.actions.missing", arguments: {} },
          {
            kind: "invoke-tool",
            toolId: "test.actions.resolve-effort",
            arguments: { base: 5, modifier: 0, difficulty: 4, scopeId: "scene.999" },
          },
          {
            kind: "invoke-tool",
            toolId: "test.actions.resolve-effort",
            arguments: { base: "wrong", modifier: 0, difficulty: 4 },
          },
          {
            kind: "invoke-tool",
            toolId: "test.actions.resolve-effort",
            arguments: { base: 5, modifier: 0, difficulty: 4, durationMs: 250 },
          },
          { kind: "stop", reason: "goal-achieved" },
          "Only the valid effort happens.",
        ]),
      },
    );
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") throw new Error("Expected resolved action");
    expect(result.run.receipts).toHaveLength(1);
    expect(result.run.elapsedMs).toBe(250);
    expect(result.trace.entries.filter((entry) => entry.phase === "rejection")).toHaveLength(3);
    expect(await session.eventHistory({ types: ["test.effort-resolved"] })).toHaveLength(1);
  });

  it("stops an active run when the world advances externally", async () => {
    const { runtime, persistence } = makeRuntime();
    const session = await runtime.createWorld("External revision");
    const actionRequest = { ...request, actionId: "action.external-revision" };
    const interrupted = await session.performPlayerAction(actionRequest, {
      modelRuntime: new QueueModelRuntime([
        {
          kind: "interpreted",
          goal: "continue later",
          targetRefs: [],
          requestedHorizonMs: 30_000,
          pressureLevel: 7,
        },
        { failure: "timeout" },
      ]),
    });
    expect(interrupted.kind).toBe("failed");
    expect(interrupted.kind === "failed" ? interrupted.run?.status : undefined).toBe("active");

    const otherSession = await runtime.openWorld(session.worldId);
    await otherSession.executeOperation("test.actions.resolve-effort", {
      actorId: request.actorId,
      base: 1,
      modifier: 0,
      difficulty: 1,
      durationMs: 0,
    });
    const resumeModel = new QueueModelRuntime([]);
    const resumed = await session.performPlayerAction(actionRequest, { modelRuntime: resumeModel });
    expect(resumed.kind).toBe("failed");
    expect(resumed.kind === "failed" ? resumed.failure.kind : undefined).toBe("external-revision");
    expect(resumed.kind === "failed" ? resumed.run?.stopReason : undefined)
      .toBe("pressure-reassessment-required");
    expect(resumeModel.requests).toHaveLength(0);
    expect((await persistence.actionRuns.load(session.worldId, actionRequest.actionId))?.status)
      .toBe("stopped");
  });
});
