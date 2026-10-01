import { describe, expect, it } from "vitest";
import {
  createGameRuntime,
  createInMemoryPersistence,
  loadGameDefinition,
  type PersistencePorts,
} from "@llm-ttrpg/engine";
import { referenceGameDefinition } from "@llm-ttrpg/reference-game";
import { createMigratedSqlitePersistence } from "./support/sqlite.js";

function createDependencies(persistence: PersistencePorts) {
  let id = 0;
  let tick = 0;
  return {
    persistence,
    game: loadGameDefinition(referenceGameDefinition),
    wallClock: {
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
    },
    idGenerator: {
      next(kind: "world" | "checkpoint" | "slot" | "event" | "scheduled-trigger") {
        return `${kind}.test-${++id}`;
      },
    },
    worldSeedSource: { nextSeed: () => 0x1234_5678 },
  };
}

async function exercisePersistence(persistence: PersistencePorts) {
  const dependencies = createDependencies(persistence);
  const firstRuntime = createGameRuntime(dependencies);
  const originalSession = await firstRuntime.createWorld("First campaign");
  const worldId = originalSession.worldId;
  const originalState = originalSession.snapshot();
  const originalHistory = await originalSession.eventHistory();
  const firstSlot = await originalSession.save("Manual save");
  const firstCheckpoint = await persistence.saves.loadCheckpoint(
    firstSlot.checkpointId,
  );

  expect(firstCheckpoint?.state).toEqual(originalState);
  expect(firstCheckpoint?.history).toEqual(originalHistory);

  // This is a new application/runtime boundary using only persisted state.
  const secondRuntime = createGameRuntime(dependencies);
  const reopened = await secondRuntime.openWorld(worldId);
  expect(reopened.snapshot()).toEqual(originalState);
  expect((await secondRuntime.listWorlds())[0]?.game).toEqual(
    dependencies.game.composition,
  );

  await reopened.executeOperation(
    "rules.actions.resolve-effort",
    {
      actorId: "campaign.entity.amelia",
      base: 3,
      modifier: 1,
      difficulty: 4,
    },
  );
  const changedState = reopened.snapshot();
  const changedHistory = await reopened.eventHistory();
  expect(changedHistory).toHaveLength(originalHistory.length + 1);
  expect(changedState).not.toHaveProperty("events");

  const secondSlot = await reopened.save("Manual save");
  expect(secondSlot.id).toBe(firstSlot.id);
  expect(secondSlot.checkpointId).not.toBe(firstSlot.checkpointId);

  const checkpoints = await persistence.saves.listCheckpoints(worldId);
  expect(checkpoints).toHaveLength(2);
  expect(checkpoints[1]?.parentCheckpointId).toBe(firstSlot.checkpointId);
  expect((await persistence.saves.loadCheckpoint(firstSlot.checkpointId))?.state)
    .toEqual(originalState);
  expect((await persistence.saves.loadCheckpoint(secondSlot.checkpointId))?.state)
    .toEqual(changedState);
  expect((await persistence.saves.loadCheckpoint(firstSlot.checkpointId))?.history)
    .toEqual(originalHistory);
  expect((await persistence.saves.loadCheckpoint(secondSlot.checkpointId))?.history)
    .toEqual(changedHistory);
  expect((await persistence.saves.findSlot(worldId, "Manual save"))?.checkpointId)
    .toBe(secondSlot.checkpointId);
  expect(await persistence.history.query(worldId)).toEqual(changedHistory);
}

describe("project shell persistence workflow", () => {
  it("runs against the headless in-memory adapter", async () => {
    await exercisePersistence(createInMemoryPersistence());
  });

  it("runs against the relational SQLite adapter and immutable schema", async () => {
    const { database, persistence } = await createMigratedSqlitePersistence();

    await exercisePersistence(persistence);

    expect(() => database.run("UPDATE checkpoints SET revision = 99"))
      .toThrow(/immutable/);
    const tables = database.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )[0]?.values.flat();
    expect(tables).toEqual(expect.arrayContaining([
      "worlds",
      "checkpoints",
      "save_slots",
      "entities",
      "facts",
      "events",
      "beliefs",
      "documents",
      "document_sections",
      "scheduled_triggers",
      "simulation_cursors",
      "action_pressure_states",
      "randomness_states",
    ]));
    database.close();
  });

  it("does not expose an unpersisted result after a revision conflict", async () => {
    const persistence = createInMemoryPersistence();
    const dependencies = createDependencies(persistence);
    const runtime = createGameRuntime(dependencies);
    const created = await runtime.createWorld("Conflict test");
    const first = await runtime.openWorld(created.worldId);
    const stale = await runtime.openWorld(created.worldId);
    const input = {
      actorId: "campaign.entity.amelia",
      base: 1,
      modifier: 0,
      difficulty: 2,
    };
    await first.executeOperation("rules.actions.resolve-effort", input);
    await expect(stale.executeOperation("rules.actions.resolve-effort", input))
      .rejects.toThrow(/revision changed/);
    expect(stale.snapshot()).not.toHaveProperty("events");
    expect(await stale.eventHistory()).toHaveLength(2);
  });
});
