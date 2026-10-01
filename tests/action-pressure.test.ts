import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import {
  UnassessedActionPressureError,
  actionPressureLevelSchema,
  boundInterpretedIntent,
  createGameRuntime,
  createInMemoryPersistence,
  fictionalDurationMs,
  initializeCampaignHistory,
  initializeCampaignWorld,
  intentStopReasonSchema,
  loadGameDefinition,
  maximumResolutionHorizon,
  type InterpretedIntent,
  type PersistencePorts,
} from "@llm-ttrpg/engine";
import { referenceGameDefinition } from "@llm-ttrpg/reference-game";
import { createSqlitePersistence } from "../apps/desktop/src/persistence/sqlite-persistence.js";
import {
  createMigratedSqlitePersistence,
  createSqlJsClient,
  migrationSql,
} from "./support/sqlite.js";

function dependencies(persistence: PersistencePorts) {
  let id = 0;
  let wallSecond = 0;
  return {
    persistence,
    game: loadGameDefinition(referenceGameDefinition),
    wallClock: {
      now: () =>
        new Date(Date.UTC(2040, 0, 1, 0, 0, wallSecond++)).toISOString(),
    },
    idGenerator: {
      next(
        kind: "world" | "checkpoint" | "slot" | "event" | "scheduled-trigger",
      ) {
        return `${kind}.pressure-${++id}`;
      },
    },
  };
}

async function exercisePressurePersistence(persistence: PersistencePorts) {
  const runtimeDependencies = dependencies(persistence);
  const runtime = createGameRuntime(runtimeDependencies);
  const session = await runtime.createWorld("Pressure fixture");
  const initialState = session.snapshot();
  const initialHistory = await session.eventHistory();
  const initialRevision = (await persistence.worlds.load(session.worldId))!
    .revision;

  expect(initialState.actionPressure).toEqual({ status: "unassessed" });
  await expect(
    session.applyActionPressureAssessment({ level: 0 } as never),
  ).rejects.toThrow();
  expect(session.snapshot()).toEqual(initialState);

  await expect(
    session.applyActionPressureAssessment({ level: 1 }),
  ).resolves.toEqual({ status: "assessed", level: 1 });
  expect(session.snapshot().actionPressure).toEqual({
    status: "assessed",
    level: 1,
  });
  expect(session.snapshot().fictionalTime).toBe(initialState.fictionalTime);
  expect(await session.eventHistory()).toEqual(initialHistory);
  expect((await persistence.worlds.load(session.worldId))!.revision).toBe(
    initialRevision + 1,
  );

  const slot = await session.save("Pressure save");
  const checkpoint = await persistence.saves.loadCheckpoint(slot.checkpointId);
  expect(checkpoint?.state.actionPressure).toEqual({
    status: "assessed",
    level: 1,
  });

  const reopened = await createGameRuntime(runtimeDependencies).openWorld(
    session.worldId,
  );
  expect(reopened.snapshot().actionPressure).toEqual({
    status: "assessed",
    level: 1,
  });
  await reopened.applyActionPressureAssessment({ level: 9 });
  expect(reopened.snapshot().actionPressure).toEqual({
    status: "assessed",
    level: 9,
  });
  expect(
    (await persistence.saves.loadCheckpoint(slot.checkpointId))?.state
      .actionPressure,
  ).toEqual({ status: "assessed", level: 1 });
}

describe("action pressure contracts", () => {
  it("validates exactly the integer levels 1 through 9", () => {
    for (let level = 1; level <= 9; level += 1) {
      expect(actionPressureLevelSchema.parse(level)).toBe(level);
    }
    for (const invalid of [0, 10, 1.5]) {
      expect(actionPressureLevelSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("maps every pressure level to the exact deterministic horizon", () => {
    const expected = [
      8 * 60 * 60 * 1_000,
      2 * 60 * 60 * 1_000,
      30 * 60 * 1_000,
      10 * 60 * 1_000,
      2 * 60 * 1_000,
      60 * 1_000,
      30 * 1_000,
      10 * 1_000,
      5 * 1_000,
    ];
    expect(
      expected.map((_, index) =>
        maximumResolutionHorizon(actionPressureLevelSchema.parse(index + 1)),
      ),
    ).toEqual(expected);
  });

  it("defines the generic relinquish-control vocabulary", () => {
    expect(intentStopReasonSchema.options).toEqual([
      "budget-exhausted",
      "goal-achieved",
      "goal-impossible",
      "material-circumstance-change",
      "pressure-reassessment-required",
      "player-decision-required",
    ]);
  });

  it("bounds the same goal without changing its meaning or consuming time", () => {
    const game = loadGameDefinition(referenceGameDefinition);
    const world = initializeCampaignWorld(game);
    const worldBefore = structuredClone(world);
    const historyBefore = initializeCampaignHistory(game);
    const intent: InterpretedIntent = {
      actorId: "actor.player",
      goal: "locate Jonny",
      targetIds: ["character.jonny"],
      requestedHorizonMs: fictionalDurationMs(4 * 60 * 60 * 1_000),
    };

    const lowPressure = boundInterpretedIntent(intent, {
      status: "assessed",
      level: 1,
    });
    const highPressure = boundInterpretedIntent(intent, {
      status: "assessed",
      level: 9,
    });

    expect(lowPressure).toEqual({
      ...intent,
      pressureLevel: 1,
      authorizedHorizonMs: fictionalDurationMs(4 * 60 * 60 * 1_000),
      wasNarrowed: false,
    });
    expect(highPressure).toEqual({
      ...intent,
      pressureLevel: 9,
      authorizedHorizonMs: fictionalDurationMs(5_000),
      wasNarrowed: true,
    });
    expect(world).toEqual(worldBefore);
    expect(initializeCampaignHistory(game)).toEqual(historyBefore);
  });

  it("treats the authorized horizon as a ceiling and requires assessment", () => {
    const intent: InterpretedIntent = {
      actorId: "actor.player",
      goal: "look through the doorway",
      targetIds: ["location.doorway"],
      requestedHorizonMs: fictionalDurationMs(2_000),
    };
    for (const level of [1, 9] as const) {
      expect(
        boundInterpretedIntent(intent, { status: "assessed", level }),
      ).toEqual({
        ...intent,
        pressureLevel: level,
        authorizedHorizonMs: fictionalDurationMs(2_000),
        wasNarrowed: false,
      });
    }
    expect(() =>
      boundInterpretedIntent(intent, { status: "unassessed" }),
    ).toThrow(UnassessedActionPressureError);
  });
});

describe("action pressure persistence", () => {
  it("runs the workflow against in-memory persistence", async () => {
    await exercisePressurePersistence(createInMemoryPersistence());
  });

  it("runs the workflow against SQLite persistence", async () => {
    const { database, persistence } = await createMigratedSqlitePersistence();
    await exercisePressurePersistence(persistence);
    expect(() =>
      database.run("UPDATE action_pressure_states SET level = 10"),
    ).toThrow();
    expect(() =>
      database.run(
        "UPDATE action_pressure_states SET level = 2 WHERE checkpoint_id IS NOT NULL",
      ),
    ).toThrow(/immutable/);
    database.close();
  });

  it("does not expose a pressure assessment after a revision conflict", async () => {
    const persistence = createInMemoryPersistence();
    const runtime = createGameRuntime(dependencies(persistence));
    const created = await runtime.createWorld("Pressure conflict");
    const first = await runtime.openWorld(created.worldId);
    const stale = await runtime.openWorld(created.worldId);
    await first.applyActionPressureAssessment({ level: 4 });
    await expect(stale.applyActionPressureAssessment({ level: 8 }))
      .rejects.toThrow(/revision changed/);
    expect(stale.snapshot().actionPressure).toEqual({ status: "unassessed" });
  });

  it("migrates pre-#7 worlds and checkpoints to unassessed", async () => {
    const SQL = await initSqlJs();
    const database = new SQL.Database();
    database.exec(migrationSql("0001_persistence_foundation.sql"));
    database.exec(migrationSql("0002_fictional_time_event_history.sql"));
    const game = loadGameDefinition(referenceGameDefinition);
    const currentState = initializeCampaignWorld(game);
    const { actionPressure: _omitted, ...legacyState } = currentState;
    const initialEvents = initializeCampaignHistory(game);
    const metadata = {
      id: "world.pre-pressure",
      name: "Pre-pressure world",
      createdAt: "2040-01-01T00:00:00.000Z",
      updatedAt: "2040-01-01T00:00:00.000Z",
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
      id: "checkpoint.pre-pressure",
      worldId: metadata.id,
      createdAt: "2040-01-01T00:01:00.000Z",
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
          id: "slot.pre-pressure",
          name: "Legacy save",
          createdAt: checkpoint.createdAt,
          updatedAt: checkpoint.createdAt,
        },
      }),
    ]);

    database.exec(migrationSql("0003_action_pressure.sql"));
    const persistence = createSqlitePersistence(createSqlJsClient(database));
    expect((await persistence.worlds.load(metadata.id))?.state.actionPressure)
      .toEqual({ status: "unassessed" });
    expect(
      (await persistence.saves.loadCheckpoint(checkpoint.id))?.state
        .actionPressure,
    ).toEqual({ status: "unassessed" });
    const levels = database.exec(
      "SELECT level FROM action_pressure_states ORDER BY checkpoint_id IS NOT NULL",
    )[0]!.values;
    expect(levels).toEqual([[null], [null]]);
    database.close();
  });
});
