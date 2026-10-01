import { readFileSync } from "node:fs";
import initSqlJs, { type Database } from "sql.js";
import { createSqlitePersistence } from "../../apps/desktop/src/persistence/sqlite-persistence.js";
import type {
  SqlBindValue,
  SqlClient,
} from "../../apps/desktop/src/persistence/sql-client.js";

export function createSqlJsClient(database: Database): SqlClient {
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

export function migrationSql(file: string): string {
  return readFileSync(`apps/desktop/src-tauri/migrations/${file}`, "utf8");
}

export async function createMigratedSqlitePersistence() {
  const SQL = await initSqlJs();
  const database = new SQL.Database();
  for (const file of [
    "0001_persistence_foundation.sql",
    "0002_fictional_time_event_history.sql",
    "0003_action_pressure.sql",
    "0004_resolution_randomness.sql",
  ]) {
    database.exec(
      migrationSql(file),
    );
  }
  return {
    database,
    persistence: createSqlitePersistence(createSqlJsClient(database)),
  };
}
