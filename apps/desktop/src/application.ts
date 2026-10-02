import {
  createGameRuntime,
  loadGameDefinition,
  type GameSession,
  type ModelRuntime,
  type WorldMetadata,
} from "@llm-ttrpg/engine";
import {
  referenceGameDefinition,
  referenceSceneSource,
} from "@llm-ttrpg/reference-game";
import { openApplicationDatabase } from "./database.js";
import { createSqlitePersistence } from "./persistence/sqlite-persistence.js";
import type { SqlClient } from "./persistence/sql-client.js";

export interface DesktopApplication {
  readonly modelRuntime?: ModelRuntime;
  createWorld(name: string): Promise<GameSession>;
  listWorlds(): Promise<readonly WorldMetadata[]>;
  openWorld(worldId: string): Promise<GameSession>;
}

export interface DesktopApplicationOptions {
  readonly modelRuntime?: ModelRuntime;
}

function createIdGenerator() {
  return {
    next(kind: "world" | "checkpoint" | "slot" | "event" | "scheduled-trigger") {
      return `${kind}.${crypto.randomUUID()}`;
    },
  };
}

export function createDesktopApplication(
  database: SqlClient,
  options: DesktopApplicationOptions = {},
): DesktopApplication {
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
    context: { sceneSource: referenceSceneSource },
  });
  return {
    ...runtime,
    ...(options.modelRuntime ? { modelRuntime: options.modelRuntime } : {}),
  };
}

export async function startDesktopApplication(
  options: DesktopApplicationOptions = {},
): Promise<DesktopApplication> {
  return createDesktopApplication(await openApplicationDatabase(), options);
}
