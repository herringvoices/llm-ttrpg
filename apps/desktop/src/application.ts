import {
  createGameRuntime,
  loadGameDefinition,
  type GameSession,
  type WorldMetadata,
} from "@llm-ttrpg/engine";
import { referenceGameDefinition } from "@llm-ttrpg/reference-game";
import { openApplicationDatabase } from "./database.js";
import { createSqlitePersistence } from "./persistence/sqlite-persistence.js";
import type { SqlClient } from "./persistence/sql-client.js";

export interface DesktopApplication {
  createWorld(name: string): Promise<GameSession>;
  listWorlds(): Promise<readonly WorldMetadata[]>;
  openWorld(worldId: string): Promise<GameSession>;
}

function createIdGenerator() {
  return {
    next(kind: "world" | "checkpoint" | "slot" | "event" | "scheduled-trigger") {
      return `${kind}.${crypto.randomUUID()}`;
    },
  };
}

export function createDesktopApplication(database: SqlClient): DesktopApplication {
  const runtime = createGameRuntime({
    persistence: createSqlitePersistence(database),
    wallClock: { now: () => new Date().toISOString() },
    idGenerator: createIdGenerator(),
    worldSeedSource: {
      nextSeed() {
        const seed = new Uint32Array(1);
        crypto.getRandomValues(seed);
        return seed[0]!;
      },
    },
    game: loadGameDefinition(referenceGameDefinition),
  });
  return runtime;
}

export async function startDesktopApplication(): Promise<DesktopApplication> {
  return createDesktopApplication(await openApplicationDatabase());
}
