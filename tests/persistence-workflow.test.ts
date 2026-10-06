import { describe, expect, it } from "vitest";
import {
  createGameRuntime,
  createInMemoryPersistence,
  loadGameDefinition,
  type PersistencePorts,
} from "@llm-ttrpg/engine";
import { contractTestGameDefinition } from "./support/contract-game.js";
import { createMigratedSqlitePersistence } from "./support/sqlite.js";

function createDependencies(persistence: PersistencePorts) {
  let id = 0;
  let tick = 0;
  return {
    persistence,
    game: loadGameDefinition(contractTestGameDefinition),
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
    "test.actions.resolve-effort",
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
    await first.executeOperation("test.actions.resolve-effort", input);
    await expect(stale.executeOperation("test.actions.resolve-effort", input))
      .rejects.toThrow(/revision changed/);
    expect(stale.snapshot()).not.toHaveProperty("events");
    expect(await stale.eventHistory()).toHaveLength(2);
  });

  it("deletes one in-memory world completely without disturbing another", async () => {
    const persistence = createInMemoryPersistence();
    const runtime = createGameRuntime(createDependencies(persistence));
    const doomed = await runtime.createWorld("Delete me");
    const retained = await runtime.createWorld("Keep me");
    const slot = await doomed.save("Before deletion");

    expect(await persistence.worlds.delete(doomed.worldId)).toEqual({
      deleted: true,
      worldId: doomed.worldId,
    });
    expect(await persistence.worlds.load(doomed.worldId)).toBeUndefined();
    expect(await persistence.saves.loadCheckpoint(slot.checkpointId)).toBeUndefined();
    expect(await persistence.worlds.load(retained.worldId)).toBeDefined();
    expect(await persistence.worlds.delete(doomed.worldId)).toEqual({
      deleted: false,
      worldId: doomed.worldId,
      reason: "not-found",
    });
  });

  it("atomically deletes all SQLite-owned rows through the privileged lifecycle command", async () => {
    const { database, persistence } = await createMigratedSqlitePersistence();
    const runtime = createGameRuntime(createDependencies(persistence));
    const doomed = await runtime.createWorld("Delete me");
    const retained = await runtime.createWorld("Keep me");
    const slot = await doomed.save("Before deletion");
    const retainedBefore = await persistence.worlds.load(retained.worldId);
    const retainedHistoryBefore = await persistence.history.query(retained.worldId);

    database.run(
      "INSERT INTO action_runs(world_id, action_id, actor_id, declaration, run_json) VALUES (?, 'action.test', 'actor.test', 'test', '{}')",
      [doomed.worldId],
    );
    database.run(
      "INSERT INTO campaign_plans(world_id, schema_version, plan_revision, based_on_world_revision, based_on_event_sequence, document_json) VALUES (?, 1, 0, 0, 0, '{}')",
      [doomed.worldId],
    );
    database.run(
      "INSERT INTO checkpoint_campaign_plans(checkpoint_id, source_world_id, document_json) VALUES (?, ?, '{}')",
      [slot.checkpointId, doomed.worldId],
    );
    database.run(
      "INSERT INTO desktop_play_sessions(world_id, player_actor_id) VALUES (?, 'actor.test')",
      [doomed.worldId],
    );

    expect(() => database.run(
      "DELETE FROM events WHERE world_id = ?",
      [doomed.worldId],
    )).toThrow(/event history is immutable/);
    expect(() => database.run(
      "DELETE FROM checkpoints WHERE world_id = ?",
      [doomed.worldId],
    )).toThrow(/checkpoints are immutable/);

    expect(await persistence.worlds.delete(doomed.worldId)).toEqual({
      deleted: true,
      worldId: doomed.worldId,
    });

    for (const table of [
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
      "extended_world_states",
      "action_runs",
      "campaign_plans",
      "desktop_play_sessions",
    ]) {
      const result = database.exec(
        `SELECT COUNT(*) FROM ${table} WHERE world_id = '${doomed.worldId}'`,
      );
      expect(result[0]?.values[0]?.[0], table).toBe(0);
    }
    expect(database.exec(
      `SELECT COUNT(*) FROM worlds WHERE id = '${doomed.worldId}'`,
    )[0]?.values[0]?.[0]).toBe(0);
    expect(database.exec(
      `SELECT COUNT(*) FROM checkpoint_campaign_plans WHERE source_world_id = '${doomed.worldId}'`,
    )[0]?.values[0]?.[0]).toBe(0);
    expect(await persistence.saves.loadCheckpoint(slot.checkpointId)).toBeUndefined();
    expect(await persistence.worlds.load(retained.worldId)).toEqual(retainedBefore);
    expect(await persistence.history.query(retained.worldId)).toEqual(retainedHistoryBefore);
    expect(await persistence.worlds.delete(doomed.worldId)).toEqual({
      deleted: false,
      worldId: doomed.worldId,
      reason: "not-found",
    });

    expect(() => database.run(
      "DELETE FROM events WHERE world_id = ?",
      [retained.worldId],
    )).toThrow(/event history is immutable/);
    database.close();
  });
});
