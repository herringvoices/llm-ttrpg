import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import { z } from "zod";
import {
  createGameRuntime,
  createInMemoryPersistence,
  fictionalDurationMs,
  initializeCampaignHistory,
  initializeCampaignWorld,
  loadGameDefinition,
  type ExecutableIntent,
  type GameDefinition,
  type LoadedGameDefinition,
  type PersistencePorts,
  type RegisteredRulesOperation,
  type ResolutionOperation,
  type RulesOperation,
  type WorldState,
} from "@llm-ttrpg/engine";
import { referenceGameDefinition } from "@llm-ttrpg/reference-game";
import { createSqlitePersistence } from "../apps/desktop/src/persistence/sqlite-persistence.js";
import {
  createMigratedSqlitePersistence,
  createSqlJsClient,
  migrationSql,
} from "./support/sqlite.js";

const fixtureOperationId = "rules.resolution.resolve-contract-fixture";

function executableIntent(horizonMs = 60_000): ExecutableIntent {
  return {
    actorId: "campaign.entity.amelia",
    goal: "establish a favorable position",
    targetIds: ["campaign.location.brownbag-groceries"],
    pressureLevel: 6,
    requestedHorizonMs: fictionalDurationMs(horizonMs),
    authorizedHorizonMs: fictionalDurationMs(horizonMs),
    wasNarrowed: false,
  };
}

function dependencies(
  persistence: PersistencePorts,
  rootSeed = 0x1357_9bdf,
  game: LoadedGameDefinition = loadGameDefinition(referenceGameDefinition),
) {
  let id = 0;
  let wallSecond = 0;
  return {
    persistence,
    game,
    wallClock: {
      now: () =>
        new Date(Date.UTC(2041, 0, 1, 0, 0, wallSecond++)).toISOString(),
    },
    idGenerator: {
      next(
        kind: "world" | "checkpoint" | "slot" | "event" | "scheduled-trigger",
      ) {
        return `${kind}.resolution-${++id}`;
      },
    },
    worldSeedSource: { nextSeed: () => rootSeed },
  };
}

function request(
  mode:
    | "automatic"
    | "impossible"
    | "uncertain-random"
    | "uncertain-no-random"
    | "opposed",
  overrides: Record<string, unknown> = {},
  horizonMs = 60_000,
) {
  return {
    intent: executableIntent(horizonMs),
    operation: {
      id: fixtureOperationId,
      input: {
        actorId: "campaign.entity.amelia",
        mode,
        modifier: 0,
        durationMs: 1_000,
        ...(mode === "opposed"
          ? { counterpartId: "campaign.location.brownbag-groceries" }
          : {}),
        ...overrides,
      },
    },
  };
}

async function exerciseResolutionPersistence(persistence: PersistencePorts) {
  const runtimeDependencies = dependencies(persistence);
  const runtime = createGameRuntime(runtimeDependencies);
  const session = await runtime.createWorld("Resolution fixture");
  const initialHistory = await session.eventHistory();
  expect(session.snapshot().randomness).toEqual({
    algorithm: "mulberry32-v1",
    rootSeed: 0x1357_9bdf,
    nextStream: 0,
  });

  const automatic = await session.resolve(request("automatic", {
    setStatus: "positioned",
  }));
  expect(automatic.path).toBe("automatic");
  expect(automatic.randomness).toBeNull();
  expect(automatic.result).toEqual({
    outcome: "automatic-complete",
    facets: ["no-uncertainty"],
  });
  expect(automatic.basis).toEqual(expect.objectContaining({
    fixtureMetric: "echo-position",
    modifier: 0,
  }));
  expect(automatic.events).toHaveLength(1);
  expect(session.snapshot().entities.find(
    (entity) => entity.id === "campaign.entity.amelia",
  )?.data.status).toBe("positioned");
  expect(session.snapshot().randomness.nextStream).toBe(0);

  const impossible = await session.resolve(request("impossible"));
  expect(impossible.path).toBe("impossible");
  expect(impossible.randomness).toBeNull();
  expect(impossible.result).toEqual({
    outcome: "locally-blocked",
    facets: ["approach-blocked", "goal-may-have-alternatives"],
  });
  expect(impossible).not.toHaveProperty("stopReason");
  expect(session.snapshot().randomness.nextStream).toBe(0);

  const noDraw = await session.resolve(request("uncertain-no-random"));
  expect(noDraw.path).toBe("uncertain");
  expect(noDraw.randomness).toBeNull();
  expect(session.snapshot().randomness.nextStream).toBe(0);

  const stochastic = await session.resolve(request("uncertain-random"));
  expect(stochastic.path).toBe("uncertain");
  expect(stochastic.randomness).toEqual({
    algorithm: "mulberry32-v1",
    stream: 0,
    seed: expect.any(Number),
    draws: 2,
  });
  expect(stochastic.result).toEqual(expect.objectContaining({
    outcome: expect.stringMatching(/^(clear|complicated|setback)$/),
    score: expect.any(Number),
    facets: expect.any(Array),
  }));
  expect(stochastic.result).not.toHaveProperty("success");
  expect(stochastic.result).not.toHaveProperty("degree");
  expect(session.snapshot().randomness.nextStream).toBe(1);
  const firstSlot = await session.save("Resolution progression");

  const opposed = await session.resolve(request("opposed"));
  expect(opposed.path).toBe("uncertain");
  expect(opposed.randomness).toEqual(expect.objectContaining({
    stream: 1,
    draws: 2,
  }));
  expect(opposed.result).toEqual(expect.objectContaining({
    outcome: expect.stringMatching(
      /^(initiator-edge|balanced|counterpart-edge)$/,
    ),
    facets: ["ruleset-owned-opposition", "two-sided-position"],
  }));
  expect(session.snapshot().randomness.nextStream).toBe(2);

  const checkpoint = await persistence.saves.loadCheckpoint(
    firstSlot.checkpointId,
  );
  expect(checkpoint?.state.randomness.nextStream).toBe(1);
  const reopened = await createGameRuntime(runtimeDependencies).openWorld(
    session.worldId,
  );
  expect(reopened.snapshot().randomness.nextStream).toBe(2);
  expect(await session.eventHistory()).toHaveLength(initialHistory.length + 5);
  return session.worldId;
}

function gameWithOperations(
  operations: readonly RegisteredRulesOperation[],
): LoadedGameDefinition {
  const definition: GameDefinition = {
    ...referenceGameDefinition,
    ruleset: {
      ...referenceGameDefinition.ruleset,
      operations: [
        ...referenceGameDefinition.ruleset.operations,
        ...operations,
      ],
    },
  };
  return loadGameDefinition(definition);
}

function gameWithSecondFixtureActor(): LoadedGameDefinition {
  const definition: GameDefinition = {
    ...referenceGameDefinition,
    campaign: {
      ...referenceGameDefinition.campaign,
      content: {
        ...referenceGameDefinition.campaign.content,
        entities: [
          ...referenceGameDefinition.campaign.content.entities,
          {
            id: "campaign.entity.test-counterpart",
            kind: "actor",
            name: "Test Counterpart",
            summary: "A test-only second actor for applicability validation.",
            data: { descriptors: ["test-only"] },
          },
        ],
      },
    },
  };
  return loadGameDefinition(definition);
}

describe("resolution paths and persistence", () => {
  it("runs equivalent important behavior against in-memory persistence", async () => {
    await exerciseResolutionPersistence(createInMemoryPersistence());
  });

  it("runs equivalent important behavior against SQLite persistence", async () => {
    const { database, persistence } = await createMigratedSqlitePersistence();
    const worldId = await exerciseResolutionPersistence(persistence);
    expect(() =>
      database.run("UPDATE randomness_states SET next_stream = -1"),
    ).toThrow();
    expect(() =>
      database.run(
        "UPDATE randomness_states SET next_stream = 99 WHERE checkpoint_id IS NOT NULL",
      ),
    ).toThrow(/immutable/);
    database.run(
      "DELETE FROM randomness_states WHERE world_id = ? AND checkpoint_id IS NULL",
      [worldId],
    );
    await expect(persistence.worlds.load(worldId)).rejects.toThrow(
      /exactly one randomness state/i,
    );
    database.close();
  });

  it("reproduces the same local stream and reflects ruleset modifiers", async () => {
    async function resolveOnce(modifier: number) {
      const runtime = createGameRuntime(
        dependencies(createInMemoryPersistence(), 0x2468_ace0),
      );
      const session = await runtime.createWorld("Reproducible resolution");
      return session.resolve(request("uncertain-random", { modifier }));
    }

    const first = await resolveOnce(0);
    const second = await resolveOnce(0);
    const modified = await resolveOnce(200);
    expect(second.randomness).toEqual(first.randomness);
    expect(second.result).toEqual(first.result);
    expect(modified.randomness).toEqual(first.randomness);
    expect(modified.result).not.toEqual(first.result);
  });

  it("rejects invalid requests and over-horizon outcomes without effects", async () => {
    const persistence = createInMemoryPersistence();
    const runtime = createGameRuntime(dependencies(persistence));
    const session = await runtime.createWorld("Invalid resolution");
    const before = session.snapshot();
    const historyBefore = await session.eventHistory();

    await expect(session.resolve({
      ...request("uncertain-random"),
      operation: { id: fixtureOperationId, input: { malformed: true } },
    } as never)).rejects.toThrow();
    await expect(session.resolve({
      ...request("automatic"),
      operation: { id: "rules.resolution.missing", input: {} },
    })).rejects.toThrow(/unknown rules operation/i);
    await expect(session.resolve({
      ...request("automatic"),
      operation: {
        id: "rules.actions.resolve-effort",
        input: {
          actorId: "campaign.entity.amelia",
          base: 1,
          modifier: 0,
          difficulty: 1,
        },
      },
    })).rejects.toThrow(/not a resolution operation/i);
    await expect(session.resolve({
      ...request("automatic", { actorId: "campaign.entity.missing" }),
      intent: {
        ...executableIntent(),
        actorId: "campaign.entity.missing",
      },
    })).rejects.toThrow(/missing participant/i);
    await expect(session.resolve(request(
      "automatic",
      { durationMs: 2_000 },
      1_000,
    ))).rejects.toThrow(/exceeds authorized horizon/i);

    expect(session.snapshot()).toEqual(before);
    expect(await session.eventHistory()).toEqual(historyBefore);
  });

  it("rejects a valid operation actor that does not match the executable intent", async () => {
    const persistence = createInMemoryPersistence();
    const runtime = createGameRuntime(dependencies(
      persistence,
      0x1357_9bdf,
      gameWithSecondFixtureActor(),
    ));
    const session = await runtime.createWorld("Mismatched resolution actor");
    const before = session.snapshot();
    const historyBefore = await session.eventHistory();

    await expect(session.resolve(request("uncertain-random", {
      actorId: "campaign.entity.test-counterpart",
      setStatus: "should-not-apply",
    }))).rejects.toThrow(/does not match executable intent actor/i);

    expect(session.snapshot()).toEqual(before);
    expect(session.snapshot().fictionalTime).toBe(before.fictionalTime);
    expect(session.snapshot().randomness.nextStream).toBe(
      before.randomness.nextStream,
    );
    expect(await session.eventHistory()).toEqual(historyBefore);
  });

  it("does not commit tentative RNG use when result validation fails", async () => {
    const invalidAfterDraw: ResolutionOperation<
      Record<string, never>,
      { marker: string },
      { value: number }
    > = {
      metadata: {
        id: "rules.resolution.invalid-after-draw",
        kind: "resolution",
        description: "Test-only invalid output after a tentative draw.",
        category: {
          domain: { id: "rules", label: "Rules" },
          subsystem: { id: "resolution", label: "Resolution" },
          tags: ["test"],
        },
      },
      inputSchema: z.object({}).strict(),
      preparedSchema: z.object({ marker: z.string() }).strict(),
      outputSchema: z.object({ value: z.number() }).strict(),
      assess() {
        return {
          path: "uncertain",
          basis: { reason: "test-invalid-output" },
          prepared: { marker: "draw-then-fail" },
        };
      },
      resolve(context) {
        context.rng.next();
        return {
          result: { value: "invalid" } as never,
          advanceTimeByMs: fictionalDurationMs(0),
          proposedMutations: [],
          proposedEvents: [],
        };
      },
    };
    const persistence = createInMemoryPersistence();
    const runtime = createGameRuntime(dependencies(
      persistence,
      0x1357_9bdf,
      gameWithOperations([invalidAfterDraw]),
    ));
    const session = await runtime.createWorld("Tentative draw validation");
    const before = session.snapshot();
    await expect(session.resolve({
      intent: executableIntent(),
      operation: { id: invalidAfterDraw.metadata.id, input: {} },
    })).rejects.toThrow();
    expect(session.snapshot()).toEqual(before);
    expect((await persistence.worlds.load(session.worldId))?.state.randomness)
      .toEqual(before.randomness);
  });

  it("does not consume another stream after a persistence conflict", async () => {
    const persistence = createInMemoryPersistence();
    const runtime = createGameRuntime(dependencies(persistence));
    const created = await runtime.createWorld("Resolution conflict");
    const first = await runtime.openWorld(created.worldId);
    const stale = await runtime.openWorld(created.worldId);
    await first.resolve(request("uncertain-random"));
    await expect(stale.resolve(request("uncertain-random")))
      .rejects.toThrow(/revision changed/i);
    expect(stale.snapshot().randomness.nextStream).toBe(0);
    expect((await persistence.worlds.load(created.worldId))?.state.randomness.nextStream)
      .toBe(1);
  });
});

describe("operation mutation authority", () => {
  it("deep-freezes nested operation context while allowing proposals", async () => {
    const mutationProbe: RulesOperation<
      Record<string, never>,
      {
        rootFrozen: boolean;
        nestedFrozen: boolean;
        directMutationBlocked: boolean;
        worldHasRandomness: boolean;
      }
    > = {
      metadata: {
        id: "rules.actions.mutation-probe",
        kind: "ordinary",
        description: "Test-only deep-freeze probe.",
        category: {
          domain: { id: "rules", label: "Rules" },
          subsystem: { id: "actions", label: "Actions" },
          tags: ["test"],
        },
      },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({
        rootFrozen: z.boolean(),
        nestedFrozen: z.boolean(),
        directMutationBlocked: z.boolean(),
        worldHasRandomness: z.boolean(),
      }).strict(),
      execute(context) {
        let directMutationBlocked = false;
        try {
          const mutable = context.world as unknown as WorldState;
          mutable.entities[0]!.data.status = "illicit";
        } catch {
          directMutationBlocked = true;
        }
        return {
          result: {
            rootFrozen: Object.isFrozen(context.world),
            nestedFrozen: Object.isFrozen(context.world.entities[0]!.data),
            directMutationBlocked,
            worldHasRandomness: "randomness" in context.world,
          },
          advanceTimeByMs: fictionalDurationMs(0),
          proposedMutations: [],
          proposedEvents: [],
        };
      },
    };
    const persistence = createInMemoryPersistence();
    const runtime = createGameRuntime(dependencies(
      persistence,
      0x1357_9bdf,
      gameWithOperations([mutationProbe]),
    ));
    const session = await runtime.createWorld("Mutation authority");
    const beforeStatus = session.snapshot().entities[0]!.data.status;
    await expect(session.executeOperation(mutationProbe.metadata.id, {}))
      .resolves.toEqual({
        rootFrozen: true,
        nestedFrozen: true,
        directMutationBlocked: true,
        worldHasRandomness: false,
      });
    expect(session.snapshot().entities[0]!.data.status).toBe(beforeStatus);
  });

  it("omits RNG state from both resolution phases and exposes only explicit RNG", async () => {
    const visibilityProbe: ResolutionOperation<
      Record<string, never>,
      { assessmentWorldHasRandomness: boolean },
      {
        assessmentWorldHasRandomness: boolean;
        executionWorldHasRandomness: boolean;
        explicitRngAvailable: boolean;
      }
    > = {
      metadata: {
        id: "rules.resolution.world-view-probe",
        kind: "resolution",
        description: "Test-only operation-world-view visibility probe.",
        category: {
          domain: { id: "rules", label: "Rules" },
          subsystem: { id: "resolution", label: "Resolution" },
          tags: ["test"],
        },
      },
      inputSchema: z.object({}).strict(),
      preparedSchema: z.object({
        assessmentWorldHasRandomness: z.boolean(),
      }).strict(),
      outputSchema: z.object({
        assessmentWorldHasRandomness: z.boolean(),
        executionWorldHasRandomness: z.boolean(),
        explicitRngAvailable: z.boolean(),
      }).strict(),
      assess(context) {
        return {
          path: "uncertain",
          basis: { reason: "test-operation-world-view" },
          prepared: {
            assessmentWorldHasRandomness: "randomness" in context.world,
          },
        };
      },
      resolve(context, prepared) {
        return {
          result: {
            assessmentWorldHasRandomness:
              prepared.assessmentWorldHasRandomness,
            executionWorldHasRandomness: "randomness" in context.world,
            explicitRngAvailable: typeof context.rng.next === "function",
          },
          advanceTimeByMs: fictionalDurationMs(0),
          proposedMutations: [],
          proposedEvents: [],
        };
      },
    };
    const persistence = createInMemoryPersistence();
    const runtime = createGameRuntime(dependencies(
      persistence,
      0x1357_9bdf,
      gameWithOperations([visibilityProbe]),
    ));
    const session = await runtime.createWorld("Operation world view");

    const resolution = await session.resolve({
      intent: executableIntent(),
      operation: { id: visibilityProbe.metadata.id, input: {} },
    });

    expect(resolution.result).toEqual({
      assessmentWorldHasRandomness: false,
      executionWorldHasRandomness: false,
      explicitRngAvailable: true,
    });
    expect(resolution.randomness).toBeNull();
    expect(session.snapshot().randomness.nextStream).toBe(0);
  });
});

describe("randomness migration", () => {
  it("initializes pre-#8 worlds and checkpoints at documented future stream zero", async () => {
    const SQL = await initSqlJs();
    const database = new SQL.Database();
    for (const file of [
      "0001_persistence_foundation.sql",
      "0002_fictional_time_event_history.sql",
      "0003_action_pressure.sql",
    ]) {
      database.exec(migrationSql(file));
    }
    const game = loadGameDefinition(referenceGameDefinition);
    const currentState = initializeCampaignWorld(game, 0xfeed_beef);
    const { randomness: _omitted, ...legacyState } = currentState;
    const initialEvents = initializeCampaignHistory(game);
    const metadata = {
      id: "world.pre-resolution-rng",
      name: "Pre-resolution RNG world",
      createdAt: "2041-01-01T00:00:00.000Z",
      updatedAt: "2041-01-01T00:00:00.000Z",
      game: game.composition,
    };
    database.run("INSERT INTO persistence_commands(payload_json) VALUES (?)", [
      JSON.stringify({
        operation: "create-world",
        metadata,
        state: legacyState,
        initialEvents,
      }),
    ]);
    const checkpoint = {
      id: "checkpoint.pre-resolution-rng",
      worldId: metadata.id,
      createdAt: "2041-01-01T00:01:00.000Z",
      revision: 0,
      eventSequence: initialEvents.length,
      game: game.composition,
    };
    database.run("INSERT INTO persistence_commands(payload_json) VALUES (?)", [
      JSON.stringify({
        operation: "save-checkpoint",
        checkpoint,
        state: legacyState,
        slot: {
          id: "slot.pre-resolution-rng",
          name: "Legacy RNG save",
          createdAt: checkpoint.createdAt,
          updatedAt: checkpoint.createdAt,
        },
      }),
    ]);

    database.exec(migrationSql("0004_resolution_randomness.sql"));
    const persistence = createSqlitePersistence(createSqlJsClient(database));
    const expected = {
      algorithm: "mulberry32-v1",
      rootSeed: 0,
      nextStream: 0,
    };
    expect((await persistence.worlds.load(metadata.id))?.state.randomness)
      .toEqual(expected);
    expect(
      (await persistence.saves.loadCheckpoint(checkpoint.id))?.state.randomness,
    ).toEqual(expected);
    database.close();
  });
});
