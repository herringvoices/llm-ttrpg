import Database from "@tauri-apps/plugin-sql";
import type { SqlBindValue, SqlClient } from "./persistence/sql-client.js";

export const DATABASE_URL = "sqlite:llm-ttrpg.db";

export async function openApplicationDatabase(): Promise<SqlClient> {
  const database = await Database.load(DATABASE_URL);
  return {
    execute(query: string, bindValues?: readonly SqlBindValue[]) {
      return database.execute(query, bindValues ? [...bindValues] : undefined);
    },
    select<T>(query: string, bindValues?: readonly SqlBindValue[]) {
      return database.select<T>(query, bindValues ? [...bindValues] : undefined);
    },
  };
}
