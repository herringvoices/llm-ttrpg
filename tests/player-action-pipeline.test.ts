import { describe, expect, it } from "vitest";
import {
  createGameRuntime,
  createInMemoryPersistence,
  fictionalDurationMs,
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
import { referenceGameDefinition, referenceSceneSource } from "@llm-ttrpg/reference-game";
import { ScriptedModelRuntime } from "@llm-ttrpg/harness";
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
  it("rejects a clarification that merely reconfirms an explicit committed action", async () => {
    const { runtime } = makeRuntime();
    const session = await runtime.createWorld("Committed action clarification guard");
    const model = new QueueModelRuntime([
      {
        kind: "player-decision-required",
        question: "Do you want to fix the shower now, or get parts first?",
      },
      {
        kind: "interpreted",
        goal: "fix the shower now",
        targetRefs: [],
        modes: ["manipulation"],
        statedMeans: ["maintenance tools"],
        requestedHorizonMs: 60_000,
        pressureLevel: 3,
      },
      {
        kind: "invoke-tool",
        toolId: "test.actions.resolve-effort",
        arguments: { base: 8, modifier: 2, difficulty: 7, durationMs: 1_000 },
      },
      { kind: "stop", reason: "goal-achieved" },
      "You tighten the fitting and the leak stops.",
    ]);

    const result = await session.performPlayerAction({
      ...request,
      actionId: "action.explicit-commitment",
      declaration: "I decide to fix the leaking shower now.",
    }, { modelRuntime: model });

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") throw new Error("Expected resolved action");
    expect(result.narration).toBe("You tighten the fitting and the leak stops.");
    expect(result.run.receipts).toHaveLength(1);
    expect(model.requests.filter((entry) =>
      entry.output.kind === "structured" &&
      entry.output.schemaId === "player-action.intent-interpretation.v1"
    )).toHaveLength(2);
    expect(result.trace.entries).toContainEqual(expect.objectContaining({
      phase: "model",
      detail: expect.objectContaining({
        forcedExecutableInterpretation: true,
        rejectedClarification: "Do you want to fix the shower now, or get parts first?",
      }),
    }));
  });

  it("rejects a clarification that asks the player to author the world's response", async () => {
    const { runtime } = makeRuntime();
    const session = await runtime.createWorld("World-outcome clarification guard");
    const delegatedQuestion =
      "What specific response or action do you observe from the slime upon being illuminated and addressed?";
    const model = new QueueModelRuntime([
      {
        kind: "player-decision-required",
        question: delegatedQuestion,
      },
      {
        kind: "interpreted",
        goal: "illuminate the slime and call out to it",
        targetRefs: [],
        modes: ["manipulation"],
        statedMeans: ["my light", "my voice"],
        requestedHorizonMs: 60_000,
        pressureLevel: 6,
      },
      {
        kind: "invoke-tool",
        toolId: "test.actions.resolve-effort",
        arguments: { base: 8, modifier: 2, difficulty: 7, durationMs: 1_000 },
      },
      { kind: "stop", reason: "goal-achieved" },
      "Your beam crosses the slime, and the world supplies its response.",
    ]);

    const result = await session.performPlayerAction({
      ...request,
      actionId: "action.shine-and-call",
      declaration: "I shine my light on the slime. \"Hello?\" I call.",
    }, { modelRuntime: model });

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") throw new Error("Expected resolved action");
    expect(result.narration).toContain("world supplies its response");
    expect(result.run.semanticAction?.modes).toEqual([
      "manipulation",
      "observation",
      "communication",
      "interaction",
    ]);
    expect(result.trace.entries).toContainEqual(expect.objectContaining({
      phase: "model",
      detail: expect.objectContaining({
        forcedExecutableInterpretation: true,
        rejectedClarification: delegatedQuestion,
      }),
    }));
  });

  it("keeps an explicit player question eligible for clarification", async () => {
    const { runtime } = makeRuntime();
    const session = await runtime.createWorld("Player question clarification guard");
    const model = new QueueModelRuntime([{
      kind: "player-decision-required",
      question: "Which marked object do you mean?",
    }]);

    const result = await session.performPlayerAction({
      ...request,
      actionId: "action.player-question",
      declaration: "What do I see when I look at the marked objects?",
    }, { modelRuntime: model });

    expect(result).toEqual(expect.objectContaining({
      kind: "needs-player-input",
      question: "Which marked object do you mean?",
    }));
    expect(model.requests.filter((entry) =>
      entry.output.kind === "structured" &&
      entry.output.schemaId === "player-action.intent-interpretation.v1"
    )).toHaveLength(1);
  });

  it("normalizes an explicitly declared move-and-repair action and rejects an empty execution stop", async () => {
    const { runtime } = makeRuntime();
    const session = await runtime.createWorld("Move and repair execution invariants");
    const model = new QueueModelRuntime([
      {
        kind: "interpreted",
        goal: "repair the leaky pipe in the shower facility",
        targetRefs: [],
        modes: ["other"],
        statedMeans: ["maintenance tools"],
        requestedHorizonMs: 60_000,
        pressureLevel: 3,
      },
      { kind: "stop", reason: "player-decision-required" },
      {
        kind: "invoke-tool",
        toolId: "test.actions.resolve-effort",
        arguments: { base: 8, modifier: 2, difficulty: 7, durationMs: 1_000 },
      },
      { kind: "stop", reason: "goal-achieved" },
      "You reach the shower and complete the repair.",
    ]);

    const result = await session.performPlayerAction({
      ...request,
      actionId: "action.move-and-repair",
      declaration: "I'm heading to the showers first. There's a leaky pipe that should be a quick fix.",
    }, { modelRuntime: model });

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") throw new Error("Expected resolved action");
    expect(result.run.semanticAction?.modes).toEqual(["movement", "manipulation"]);
    expect(result.run.receipts).toHaveLength(1);
    expect(result.trace.entries).toContainEqual(expect.objectContaining({
      phase: "rejection",
      detail: expect.objectContaining({
        reason: "execution-cannot-request-player-decision",
        proposedStopReason: "player-decision-required",
      }),
    }));
  });

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
    expect(narrationRequest?.prompt.protectedContext?.join("\n"))
      .toContain("awakening-earth-grounded");
    expect(narrationRequest?.prompt.protectedContext?.join("\n"))
      .toContain("actionableDetailPolicy");
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

  it("freezes the actor-visible committed scene across time changes and narration-only retry", async () => {
    const { runtime, persistence } = makeRuntime();
    const session = await runtime.createWorld("Frozen presentation basis");
    const actionRequest = { ...request, actionId: "action.lm12.frozen-scene" };
    const first = await session.performPlayerAction(actionRequest, {
      modelRuntime: new QueueModelRuntime([
        { kind: "interpreted", goal: "test my position", targetRefs: [],
          requestedHorizonMs: 10_000, pressureLevel: 8 },
        { kind: "invoke-tool", toolId: "test.actions.resolve-effort",
          arguments: { base: 5, modifier: 2, difficulty: 6, durationMs: 1_000 } },
        { kind: "stop", reason: "goal-achieved" },
        { failure: "timeout" },
      ]),
    });
    expect(first.kind).toBe("resolved");
    if (first.kind !== "resolved") return;
    const frozen = first.run.narrationScene;
    expect(frozen?.schemaVersion).toBe(1);
    const atCommit = (await session.eventHistory({ types: ["test.effort-resolved"] })).length;
    await session.advanceTime(60 * 60_000);
    const changedRevision = (await persistence.worlds.load(session.worldId))!.revision;
    const retryModel = new QueueModelRuntime([
      "Your recorded attempt succeeds; no later encounter is described.",
    ]);
    const second = await session.performPlayerAction(actionRequest, {
      modelRuntime: retryModel,
    });
    expect(second.kind).toBe("resolved");
    if (second.kind !== "resolved") return;
    expect(second.run.narrationScene).toEqual(frozen);
    const actualBeat = JSON.parse(retryModel.requests[0]!.prompt.input) as {
      scene: unknown; observableOutcomes: string[];
    };
    expect(actualBeat.scene).toEqual(JSON.parse(frozen!.sceneBrief));
    expect(actualBeat.observableOutcomes).toEqual(frozen!.observableOutcomes);
    expect((await persistence.worlds.load(session.worldId))!.revision).toBe(changedRevision);
    expect(await session.eventHistory({ types: ["test.effort-resolved" })).toHaveLength(atCommit);
    expect(retryModel.requests).toHaveLength(1);
  });

  it("rejects narration that invents a usable exit without replaying an authoritative result", async () => {
    const { runtime } = makeRuntime();
    const session = await runtime.createWorld("Presentation must not create exits");
    const actionRequest = { ...request, actionId: "action.lm12.unsafe-prose" };
    const first = await session.performPlayerAction(actionRequest, {
      modelRuntime: new QueueModelRuntime([
        { kind: "interpreted", goal: "test my position", targetRefs: [],
          requestedHorizonMs: 10_000, pressureLevel: 8 },
        { kind: "invoke-tool", toolId: "test.actions.resolve-effort",
          arguments: { base: 5, modifier: 2, difficulty: 6, durationMs: 1_000 } },
        { kind: "stop", reason: "goal-achieved" },
        "You succeed. An unlocked exit appears beside you.",
      ]),
    });
    expect(first.kind).toBe("resolved");
    if (first.kind !== "resolved") return;
    expect(first.narration).toBeUndefined();
    expect(first.run.narrationScene).toBeDefined();
    const history = await session.eventHistory();
    const retry = await session.performPlayerAction(actionRequest, {
      modelRuntime: new QueueModelRuntime(["Your attempt succeeds."]),
    });
    expect(retry.kind).toBe("resolved");
    if (retry.kind !== "resolved") return;
    expect(retry.narration).toBe("Your attempt succeeds.");
    expect(await session.eventHistory()).toEqual(history);
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

describe("LM-04 reference ruleset mechanics without model-authored inputs", () => {
  it("commits an improvised generic attempt with no mechanical-planning model call", async () => {
    const persistence = createInMemoryPersistence();
    let id = 0;
    const runtime = createGameRuntime({
      persistence,
      wallClock: { now: () => "2042-01-01T00:00:00.000Z" },
      idGenerator: { next: (kind) => `${kind}.attempt-${++id}` },
      worldSeedSource: { nextSeed: () => 0x13579bdf },
      game: loadGameDefinition(referenceGameDefinition),
      context: { sceneSource: referenceSceneSource },
    });
    const session = await runtime.createWorld("Trusted improvised mechanics");
    const basis = session.planningBasis();
    const declaration = "I attempt a strange improvised signal.";
    // For a registered generic handler, this fixture supplies only the stop
    // choice and post-commit narration. No structured mechanics are authored.
    const model = new QueueModelRuntime([
      { kind: "stop", reason: "goal-achieved" },
      "You try your improvised signal. The world responds.",
    ]);
    const result = await session.performPlayerAction({
      actionId: "action.lm04.signal",
      actorId: "campaign.entity.amelia",
      declaration,
      budget: { maxUnits: 50_000 },
    }, {
      modelRuntime: model,
      registeredOnly: true,
      preinterpreted: {
        declaration,
        goal: "Attempt an improvised signal",
        targetIds: [],
        modes: ["other"],
        statedMeans: [],
        pressureLevel: 6,
        requestedHorizonMs: fictionalDurationMs(10_000),
        ...basis,
      },
    });
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.run.receipts).toHaveLength(1);
    expect(result.run.receipts[0]?.toolId).toBe("rules.actions.resolve-action");
    expect(result.trace.entries).toContainEqual(expect.objectContaining({
      phase: "intent",
      detail: expect.objectContaining({ stage: "ruleset-derived-mechanics" }),
    }));
    expect(model.requests.filter((entry) => entry.output.kind === "structured" &&
      entry.output.schemaId === "player-action.tool-arguments.v1")).toHaveLength(0);
    expect(model.requests.filter((entry) => entry.output.kind === "structured" &&
      entry.output.schemaId === "player-action.intent-interpretation.v1")).toHaveLength(0);

    const before = session.snapshot().randomness;
    const again = await session.performPlayerAction({
      actionId: "action.lm04.signal",
      actorId: "campaign.entity.amelia",
      declaration,
      budget: { maxUnits: 50_000 },
    }, { modelRuntime: new QueueModelRuntime([]), registeredOnly: true });
    expect(again.kind).toBe("resolved");
    expect(session.snapshot().randomness).toEqual(before);
    expect(await session.eventHistory({ types: ["rules.action-resolved"] })).toHaveLength(1);
  });
  it("materializes a missing opponent before the opposed roll, then resumes without duplicate prerequisites", async () => {
    const persistence = createInMemoryPersistence();
    let id = 0;
    const npcId = "campaign.entity.lm10-unrealized-opponent";
    const base = referenceGameDefinition;
    const game = loadGameDefinition({
      ...base,
      campaign: {
        ...base.campaign,
        content: {
          ...base.campaign.content,
          entities: [...base.campaign.content.entities, {
            id: npcId, kind: "actor" as const,
            name: "Visible Opponent", summary: "A present nearby opponent.",
            data: {
              context: {
                locationId: "campaign.location.brownbag-groceries",
                category: "participant", prominence: "prominent",
                observable: true, activeParticipant: true,
                orchestratorVisible: true,
                knownBy: [{ kind: "actor", id: "campaign.entity.amelia" }],
                identities: [],
              },
            },
          }],
        },
      },
    });
    const runtime = createGameRuntime({
      persistence,
      wallClock: { now: () => "2042-01-01T00:00:00.000Z" },
      idGenerator: { next: (kind) => `${kind}.lm10-action-${++id}` },
      worldSeedSource: { nextSeed: () => 0x13579bdf },
      game, context: { sceneSource: referenceSceneSource },
    });
    const session = await runtime.createWorld("Foreground opposed check");
    const basis = session.planningBasis();
    const declaration = "I swing a punch at the opponent.";
    const model = new QueueModelRuntime([
      { kind: "stop", reason: "goal-achieved" },
      "You strike at the visible opponent as they move to block.",
    ]);
    const result = await session.performPlayerAction({
      actionId: "action.lm10.opposed",
      actorId: "campaign.entity.amelia",
      declaration, budget: { maxUnits: 50_000 },
    }, {
      modelRuntime: model,
      registeredOnly: true,
      preinterpreted: {
        declaration, goal: "Punch the opponent",
        targetIds: [npcId],
        modes: ["attack"], statedMeans: [],
        pressureLevel: 8, requestedHorizonMs: fictionalDurationMs(10_000),
        ...basis,
      },
    });
    if (result.kind !== "resolved") {
      throw new Error(`LM-10 opposed check failed: ${JSON.stringify(result).slice(0, 4000)}`);
    }
    expect(result.run.receipts).toHaveLength(2);
    expect(result.run.receipts.map((receipt) => receipt.toolId)).toEqual([
      "rules.realization.realize-mechanics",
      "rules.actions.resolve-action",
    ]);
    expect(result.trace.entries).toContainEqual(expect.objectContaining({
      phase: "commit",
      detail: expect.objectContaining({
        kind: "foreground-realization", sourceId: npcId, modelCalls: 0,
      }),
    }));
    const realizationEvents = await session.eventHistory({ types: ["rules.mechanics-realized"] });
    const checks = await session.eventHistory({ types: ["rules.action-resolved"] });
    expect(realizationEvents).toHaveLength(1);
    expect(checks).toHaveLength(1);
    expect(realizationEvents[0]!.sequence).toBeLessThan(checks[0]!.sequence);
    const snapshot = session.snapshot().randomness;
    const replay = await session.performPlayerAction({
      actionId: "action.lm10.opposed", actorId: "campaign.entity.amelia",
      declaration, budget: { maxUnits: 50_000 },
    }, { modelRuntime: new QueueModelRuntime([]), registeredOnly: true });
    expect(replay.kind).toBe("resolved");
    expect((await session.eventHistory({ types: ["rules.mechanics-realized"] }))).toHaveLength(1);
    expect(session.snapshot().randomness).toEqual(snapshot);
  });

  it("keeps a five-second pressure-9 attempt distinct from a stated whole-morning search without an LLM stop vote", async () => {
    let id = 0;
    const runtime = createGameRuntime({
      persistence: createInMemoryPersistence(),
      wallClock: { now: () => "2045-01-01T00:00:00Z" },
      idGenerator: { next: (kind) => `${kind}.lm11-${++id}` },
      worldSeedSource: { nextSeed: () => 418 },
      game: loadGameDefinition(referenceGameDefinition),
      context: { sceneSource: referenceSceneSource },
    });
    const session = await runtime.createWorld("High pressure search");
    await session.applyActionPressureAssessment({ level: 9 });
    const basis = session.planningBasis();
    const declaration = "I look around all morning for Jonny Blonny.";
    const model = new ScriptedModelRuntime([
      { id: "choose", match: { schemaId: "player-action.execution-decision.v1" },
        result: { kind: "structured", value: {
          kind: "invoke-tool", toolId: "rules.actions.resolve-action",
        } } },
      { id: "narration", match: { operation: "player-action.narration.v1" },
        result: { kind: "text", text: "You search your immediate surroundings for five seconds, but cannot complete an all-morning search." } },
    ]);
    const result = await session.performPlayerAction({
      actionId: "action.lm11.bounded-search",
      actorId: "campaign.entity.amelia",
      declaration, budget: { maxUnits: 50_000 },
    }, { modelRuntime: model, registeredOnly: true, preinterpreted: {
      declaration, goal: "Look around for Jonny Blonny",
      targetIds: [], modes: ["observation"], statedMeans: ["look around"],
      pressureLevel: 1, requestedHorizonMs: fictionalDurationMs(4 * 60 * 60_000),
      ...basis,
    } });
    if (result.kind !== "resolved") {
      throw new Error(`High pressure search failed: ${JSON.stringify(result).slice(0, 1400)}`);
    }
    expect(result.run.interpretedIntent.requestedHorizonMs).toBe(14_400_000);
    expect(result.run.executableIntent.pressureLevel).toBe(9);
    expect(result.run.executableIntent.authorizedHorizonMs).toBe(5_000);
    expect(result.run.executableIntent.wasNarrowed).toBe(true);
    expect(result.run.elapsedMs).toBeLessThanOrEqual(5_000);
    expect(result.run.stopReason).toBe("budget-exhausted");
    // One operation-selection decision is permitted when several registered
    // operations fit. There must be no second *post-commit* stop-only vote.
    expect(model.invocations.filter((call) =>
      call.schemaId === "player-action.execution-decision.v1")).toHaveLength(1);
    expect(result.trace.entries.filter((entry) =>
      entry.phase === "stop" &&
      typeof entry.detail === "object" && entry.detail !== null &&
      "source" in entry.detail &&
      entry.detail.source === "validated-committed-effect"
    )).toHaveLength(1);
    expect(result.narration).not.toMatch(/searched all morning/i);
    const originalHistory = await session.eventHistory();
    const replay = await session.performPlayerAction({
      actionId: "action.lm11.bounded-search", actorId: "campaign.entity.amelia",
      declaration, budget: { maxUnits: 50_000 },
    }, { modelRuntime: new ScriptedModelRuntime([]), registeredOnly: true });
    expect(replay.kind).toBe("resolved");
    expect(await session.eventHistory()).toEqual(originalHistory);
  });

  it("does not silently extend the authorized horizon for a later compound segment", async () => {
    const { runtime } = makeRuntime();
    const session = await runtime.createWorld("Shared budget clamp");
    await session.applyActionPressureAssessment({ level: 9 });
    const basis = session.planningBasis();
    const declaration = "I inspect the nearby area for an hour.";
    const model = new QueueModelRuntime([
      { kind: "invoke-tool", toolId: "test.actions.resolve-effort",
        arguments: { base: 8, modifier: 2, difficulty: 7, durationMs: 1_000 } },
      { kind: "stop", reason: "goal-achieved" },
      "You inspect only a nearby area.",
    ]);
    const outcome = await session.performPlayerAction({
      actionId: "action.lm11.partial", actorId: request.actorId,
      declaration, budget: request.budget,
    }, { modelRuntime: model, maxAuthorizedHorizonMs: 2_000,
      preinterpreted: {
        declaration, goal: "Inspect nearby area",
        targetIds: [], modes: ["observation"], statedMeans: [],
        pressureLevel: 1, requestedHorizonMs: fictionalDurationMs(3_600_000),
        ...basis,
      },
    });
    if (outcome.kind !== "resolved") {
      throw new Error(`Partial segment failed: ${JSON.stringify(outcome).slice(0, 1200)}`);
    }
    expect(outcome.run.interpretedIntent.requestedHorizonMs).toBe(3_600_000);
    expect(outcome.run.executableIntent.authorizedHorizonMs).toBe(2_000);
    expect(outcome.run.elapsedMs).toBeLessThanOrEqual(2_000);
    expect(outcome.run.executableIntent.wasNarrowed).toBe(true);
  });

});
