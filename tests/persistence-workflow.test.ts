import { readFileSync } from "node:fs";
import initSqlJs, { type Database } from "sql.js";
import { describe, expect, it } from "vitest";
import {
  createGameRuntime,
  createInMemoryPersistence,
  loadGameDefinition,
  type PersistencePorts,
} from "@llm-ttrpg/engine";
import { referenceGameDefinition } from "@llm-ttrpg/reference-game";
import { createSqlitePersistence } from "../apps/desktop/src/persistence/sqlite-persistence.js";
import type {
  SqlBindValue,
  SqlClient,
} from "../apps/desktop/src/persistence/sql-client.js";

function createDependencies(persistence: PersistencePorts) {
  let id = 0;
  let tick = 0;
  return {
    persistence,
    game: loadGameDefinition(referenceGameDefinition),
    clock: {
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
    },
    idGenerator: {
      next(kind: "world" | "checkpoint" | "slot" | "event") {
        return `${kind}.test-${++id}`;
      },
    },
  };
}

function createSqlJsClient(database: Database): SqlClient {
  return {
    async execute(query: string, bindValues?: readonly SqlBindValue[]) {
      database.run(query, bindValues ? [...bindValues] : undefined);
    },
    async select<T>(query: string, bindValues?: readonly SqlBindValue[]) {
      const statement = database.prepare(query);
      try {
        if (bindValues) statement.bind([...bindValues]);
        const rows: unknown[] = [];
        while (statement.step()) rows.push(statement.getAsObject());
        return rows as T;
      } finally {
        statement.free();
      }
    },
  };
}

async function exercisePersistence(persistence: PersistencePorts) {
  const dependencies = createDependencies(persistence);
  const firstRuntime = createGameRuntime(dependencies);
  const originalSession = await firstRuntime.createWorld("First campaign");
  const worldId = originalSession.worldId;
  const originalState = originalSession.snapshot();
  const firstSlot = await originalSession.save("Manual save");
  const firstCheckpoint = await persistence.saves.loadCheckpoint(
    firstSlot.checkpointId,
  );

  expect(firstCheckpoint?.state).toEqual(originalState);

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
    { seed: 7 },
  );
  const changedState = reopened.snapshot();
  expect(changedState.events).toHaveLength(originalState.events.length + 1);

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
  expect((await persistence.saves.findSlot(worldId, "Manual save"))?.checkpointId)
    .toBe(secondSlot.checkpointId);
  expect(await persistence.content.events(worldId)).toEqual(changedState.events);
}

describe("project shell persistence workflow", () => {
  it("runs against the headless in-memory adapter", async () => {
    await exercisePersistence(createInMemoryPersistence());
  });

  it("runs against the relational SQLite adapter and immutable schema", async () => {
    const SQL = await initSqlJs();
    const database = new SQL.Database();
    const migration = readFileSync(
      "apps/desktop/src-tauri/migrations/0001_persistence_foundation.sql",
      "utf8",
    );
    database.exec(migration);
    const persistence = createSqlitePersistence(createSqlJsClient(database));

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
    expect(stale.snapshot().events).toHaveLength(0);
  });
});
