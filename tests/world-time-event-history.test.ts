import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import {
  canonicalEventSchema,
  createGameRuntime,
  createInMemoryPersistence,
  fictionalInstant,
  loadGameDefinition,
  type PersistencePorts,
} from "@llm-ttrpg/engine";
import { referenceGameDefinition } from "@llm-ttrpg/reference-game";
import {
  createMigratedSqlitePersistence,
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
        new Date(Date.UTC(2035, 0, 1, 0, 0, wallSecond++)).toISOString(),
    },
    idGenerator: {
      next(
        kind: "world" | "checkpoint" | "slot" | "event" | "scheduled-trigger",
      ) {
        return `${kind}.history-${++id}`;
      },
    },
    worldSeedSource: { nextSeed: () => 0x1234_5678 },
  };
}

async function exerciseTimeAndHistory(persistence: PersistencePorts) {
  const runtimeDependencies = dependencies(persistence);
  const runtime = createGameRuntime(runtimeDependencies);
  const session = await runtime.createWorld("History fixture");
  const worldId = session.worldId;
  const initialHistory = await session.eventHistory();

  expect(session.snapshot().fictionalTime).toBe("2026-04-12T14:00:00.000Z");
  expect(session.snapshot()).not.toHaveProperty("events");

  await session.advanceTime(60_000);
  expect(session.snapshot().fictionalTime).toBe("2026-04-12T14:01:00.000Z");
  const revisionAfterAdvance = (await persistence.worlds.load(worldId))?.revision;
  await session.advanceTime(0);
  expect((await persistence.worlds.load(worldId))?.revision).toBe(
    revisionAfterAdvance,
  );
  await expect(session.advanceTime(-1)).rejects.toThrow();
  expect(session.snapshot().fictionalTime).toBe("2026-04-12T14:01:00.000Z");
  const persistedAfterAdvance = (await persistence.worlds.load(worldId))!;
  await expect(persistence.worlds.commit({
    worldId,
    expectedRevision: persistedAfterAdvance.revision,
    updatedAt: "2035-01-01T00:05:00.000Z",
    state: {
      ...persistedAfterAdvance.state,
      fictionalTime: fictionalInstant("2026-04-12T14:00:00.000Z"),
    },
    events: [],
    eventSequence: persistedAfterAdvance.eventSequence,
  })).rejects.toThrow(/cannot move backward/i);

  await session.setSimulationCursor(
    "scope.reference-scene",
    fictionalInstant("2026-04-12T14:01:00.000Z"),
  );
  await expect(
    session.setSimulationCursor(
      "scope.future",
      fictionalInstant("2026-04-12T14:02:00.000Z"),
    ),
  ).rejects.toThrow(/cannot be later than world time/);

  await expect(
    session.scheduleTrigger({
      type: "simulation.presentation-owned-work",
      schemaVersion: 1,
      sourceComponent: runtimeDependencies.game.presentation.identity,
      dueAt: fictionalInstant("2026-04-12T18:00:00.000Z"),
      scopeIds: ["scope.reference-scene"],
      payload: {},
    }),
  ).rejects.toThrow(/not an active simulation component/i);
  expect(session.snapshot().scheduledTriggers).toEqual([]);

  const scheduled = await session.scheduleTrigger({
    type: "simulation.evaluate-store",
    schemaVersion: 1,
    sourceComponent: runtimeDependencies.game.campaign.identity,
    dueAt: fictionalInstant("2026-04-12T18:00:00.000Z"),
    scopeIds: ["scope.reference-scene"],
    payload: { subjectId: "campaign.location.brownbag-groceries" },
  });
  expect(scheduled.dueAt).toBe("2026-04-12T18:00:00.000Z");
  expect(await session.eventHistory()).toEqual(initialHistory);
  expect(initialHistory).toHaveLength(1);
  expect(initialHistory[0]?.sourceComponent).toEqual(
    runtimeDependencies.game.campaign.identity,
  );

  const operationInput = {
    actorId: "campaign.entity.amelia",
    base: 3,
    modifier: 1,
    difficulty: 4,
    scopeId: "scope.reference-scene",
    durationMs: 30_000,
  };
  await session.executeOperation("rules.actions.resolve-effort", operationInput);
  expect(session.snapshot().fictionalTime).toBe("2026-04-12T14:01:30.000Z");
  const firstEvent = (await session.eventHistory()).at(-1)!;
  const firstSlot = await session.save("History");

  await session.executeOperation(
    "rules.actions.resolve-effort",
    { ...operationInput, durationMs: 0 },
    { causedByEventIds: [firstEvent.id] },
  );
  const secondSlot = await session.save("History");
  const history = await session.eventHistory();

  expect(history).toHaveLength(3);
  expect(history.map((event) => event.sequence)).toEqual([1, 2, 3]);
  expect(history.map((event) => event.occurredAt)).toEqual([
    "2026-04-12T13:55:00.000Z",
    "2026-04-12T14:01:30.000Z",
    "2026-04-12T14:01:30.000Z",
  ]);
  expect(history[1]?.occurredAt).not.toBe("2035-01-01T00:00:00.000Z");
  expect(history[1]?.sourceComponent).toEqual(
    runtimeDependencies.game.ruleset.identity,
  );
  expect(history[2]?.causedByEventIds).toEqual([firstEvent.id]);

  expect(await session.eventHistory({
    types: ["rules.effort-resolved"],
    relatedEntityId: "campaign.entity.amelia",
    scopeId: "scope.reference-scene",
    originKind: "rules-operation",
    originId: "rules.actions.resolve-effort",
    access: ["public"],
    from: fictionalInstant("2026-04-12T14:01:30.000Z"),
    to: fictionalInstant("2026-04-12T14:01:30.000Z"),
  })).toEqual(history.slice(1));
  expect(await session.eventHistory({ causedByEventId: firstEvent.id }))
    .toEqual([history[2]]);
  expect(await session.eventHistory({
    cursor: {
      occurredAt: history[1]!.occurredAt,
      sequence: history[1]!.sequence,
    },
  })).toEqual([history[2]]);
  expect(await session.eventHistory({ direction: "descending", limit: 1 }))
    .toEqual([history[2]]);
  await expect(session.eventHistory({
    from: fictionalInstant("2026-04-12T15:00:00.000Z"),
    to: fictionalInstant("2026-04-12T14:00:00.000Z"),
  })).rejects.toThrow(/start must not be later/);

  expect(() => runtimeDependencies.game.eventTypeRegistry.validatePayload(
    "rules.effort-resolved",
    1,
    { total: "invalid", difficulty: 4 },
  )).toThrow();

  const firstCheckpoint = await persistence.saves.loadCheckpoint(
    firstSlot.checkpointId,
  );
  const secondCheckpoint = await persistence.saves.loadCheckpoint(
    secondSlot.checkpointId,
  );
  expect(firstCheckpoint?.history).toEqual(history.slice(0, 2));
  expect(firstCheckpoint?.metadata.eventSequence).toBe(2);
  expect(secondCheckpoint?.history).toEqual(history);
  expect(secondCheckpoint?.metadata.eventSequence).toBe(3);
  expect(firstCheckpoint?.state).not.toHaveProperty("events");

  const current = (await persistence.worlds.load(worldId))!;
  await expect(persistence.worlds.commit({
    worldId,
    expectedRevision: current.revision,
    updatedAt: "2035-01-01T00:10:00.000Z",
    state: current.state,
    events: [{
      ...history.at(-1)!,
      id: "event.invalid-cause",
      sequence: current.eventSequence + 1,
      causedByEventIds: ["event.missing-cause"],
    }],
    eventSequence: current.eventSequence + 1,
  })).rejects.toThrow(/cause/i);
  expect(await session.eventHistory()).toEqual(history);

  const reopened = await createGameRuntime(runtimeDependencies).openWorld(worldId);
  expect(reopened.snapshot()).toEqual(session.snapshot());
  expect(await reopened.eventHistory()).toEqual(history);
  expect(reopened.snapshot().simulationCursors).toEqual([
    {
      scopeId: "scope.reference-scene",
      lastSimulatedAt: "2026-04-12T14:01:00.000Z",
    },
  ]);
  expect(reopened.snapshot().scheduledTriggers).toHaveLength(1);
}

describe("fictional time and event history", () => {
  it("normalizes fictional instants to UTC", () => {
    expect(fictionalInstant("2026-04-12T15:00:00+01:00")).toBe(
      "2026-04-12T14:00:00.000Z",
    );
  });

  it("runs the complete workflow with in-memory persistence", async () => {
    await exerciseTimeAndHistory(createInMemoryPersistence());
  });

  it("runs the complete workflow with SQLite persistence", async () => {
    const { database, persistence } = await createMigratedSqlitePersistence();
    await exerciseTimeAndHistory(persistence);
    expect(() => database.run("UPDATE events SET access = 'gm-only'"))
      .toThrow(/event history is immutable/);
    database.close();
  });

  it("migrates provisional #5 event rows into the versioned envelope", async () => {
    const SQL = await initSqlJs();
    const database = new SQL.Database();
    database.exec(migrationSql("0001_persistence_foundation.sql"));
    const game = loadGameDefinition(referenceGameDefinition);
    const legacyEvent = {
      id: "event.legacy-effort",
      kind: "rules.effort-resolved",
      occurredAt: "2026-04-12T14:00:00.000Z",
      summary: "A legacy effort resolved.",
      participantIds: ["campaign.entity.amelia"],
      details: { total: 4, difficulty: 4 },
      visibility: "hidden",
    };
    database.run(
      "INSERT INTO worlds(id,name,created_at,updated_at,revision,composition_json,initialized_from_campaign,fictional_time) VALUES (?,?,?,?,?,?,?,?)",
      [
        "world.legacy",
        "Legacy",
        "2035-01-01T00:00:00.000Z",
        "2035-01-01T00:00:00.000Z",
        0,
        JSON.stringify(game.composition),
        game.campaign.identity.id,
        game.campaign.startTime,
      ],
    );
    database.run(
      "INSERT INTO events(world_id,checkpoint_id,event_id,kind,occurred_at,visibility,details_json,payload_json) VALUES (?,NULL,?,?,?,?,?,?)",
      [
        "world.legacy",
        legacyEvent.id,
        legacyEvent.kind,
        legacyEvent.occurredAt,
        legacyEvent.visibility,
        JSON.stringify(legacyEvent.details),
        JSON.stringify(legacyEvent),
      ],
    );

    database.exec(migrationSql("0002_fictional_time_event_history.sql"));
    const result = database.exec(
      "SELECT worlds.event_sequence, events.canonical_json FROM worlds JOIN events ON events.world_id = worlds.id WHERE worlds.id = 'world.legacy'",
    )[0]!;
    expect(result.values[0]?.[0]).toBe(1);
    expect(canonicalEventSchema.parse(
      JSON.parse(String(result.values[0]?.[1])),
    )).toEqual(expect.objectContaining({
      id: legacyEvent.id,
      type: legacyEvent.kind,
      schemaVersion: 1,
      sourceComponent: game.ruleset.identity,
      sequence: 1,
      access: "gm-only",
      payload: legacyEvent.details,
    }));
    database.close();
  });
});
