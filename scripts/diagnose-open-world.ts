import { DatabaseSync } from "node:sqlite";
import { createDesktopApplication } from "../apps/desktop/src/application.js";
import type {
  SqlBindValue,
  SqlClient,
} from "../apps/desktop/src/persistence/sql-client.js";

const databasePath = process.env.DIAGNOSE_DATABASE_PATH;
if (!databasePath) throw new Error("DIAGNOSE_DATABASE_PATH is required");

function positionalQuery(
  query: string,
  bindValues: readonly SqlBindValue[],
): { readonly query: string; readonly bindValues: readonly SqlBindValue[] } {
  const positional: SqlBindValue[] = [];
  const normalized = query.replace(/\$(\d+)/g, (_match, rawIndex: string) => {
    const index = Number(rawIndex) - 1;
    if (index < 0 || index >= bindValues.length) {
      throw new Error(`Missing SQL bind value $${rawIndex}`);
    }
    positional.push(bindValues[index]!);
    return "?";
  });
  return positional.length > 0
    ? { query: normalized, bindValues: positional }
    : { query, bindValues };
}

const database = new DatabaseSync(databasePath);
database.exec("PRAGMA busy_timeout = 5000");
const sqlClient: SqlClient = {
  async execute(query, bindValues = []) {
    const normalized = positionalQuery(query, bindValues);
    return database.prepare(normalized.query).run(...normalized.bindValues);
  },
  async select<T>(query, bindValues: readonly SqlBindValue[] = []): Promise<T> {
    const normalized = positionalQuery(query, bindValues);
    return database.prepare(normalized.query).all(...normalized.bindValues) as T;
  },
};

const application = createDesktopApplication(sqlClient);
const results: unknown[] = [];
for (const world of await application.listWorlds()) {
  try {
    const session = await application.openWorld(world.id);
    const before = session.view();
    const after = await session.prepareOpening();
    results.push({
      world,
      ok: true,
      before: {
        playerName: before.playerName,
        currentLocationId: before.currentLocationId,
        transcriptEntries: before.transcript.length,
      },
      after: {
        busy: after.busy,
        preparingOpening: after.preparingOpening,
        error: after.lastError,
        transcriptEntries: after.transcript.length,
      },
    });
  } catch (error) {
    results.push({
      world,
      ok: false,
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : String(error),
    });
  }
}
database.close();
console.log(JSON.stringify(results, null, 2));
