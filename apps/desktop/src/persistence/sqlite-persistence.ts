import type {
  Belief,
  CanonicalEvent,
  CanonicalFact,
  CheckpointMetadata,
  CommitWorldInput,
  CreateWorldInput,
  DocumentSection,
  Entity,
  LongFormDocument,
  PersistedCheckpoint,
  PersistedWorld,
  PersistencePorts,
  SaveCheckpointInput,
  SaveSlot,
  WorldMetadata,
  WorldState,
} from "@llm-ttrpg/engine";
import { PersistenceConflictError } from "@llm-ttrpg/engine";
import type { SqlClient } from "./sql-client.js";

interface WorldRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  revision: number;
  composition_json: string;
  initialized_from_campaign: string;
  fictional_time: string;
}

interface CheckpointRow {
  id: string;
  world_id: string;
  parent_checkpoint_id: string | null;
  created_at: string;
  revision: number;
  composition_json: string;
  initialized_from_campaign: string;
  fictional_time: string;
}

interface SlotRow {
  id: string;
  world_id: string;
  name: string;
  checkpoint_id: string;
  created_at: string;
  updated_at: string;
}

interface PayloadRow {
  payload_json: string;
}

function parse<T>(value: string): T {
  return JSON.parse(value) as T;
}

function asSlot(row: SlotRow): SaveSlot {
  return {
    id: row.id,
    worldId: row.world_id,
    name: row.name,
    checkpointId: row.checkpoint_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function asMetadata(row: WorldRow): WorldMetadata {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    game: parse(row.composition_json),
  };
}

async function payloads<T>(
  database: SqlClient,
  table: string,
  worldId: string,
  checkpointId: string | null,
  orderBy: string,
): Promise<T[]> {
  const scope = checkpointId === null ? "checkpoint_id IS NULL" : "checkpoint_id = $2";
  const bindings = checkpointId === null ? [worldId] : [worldId, checkpointId];
  const rows = await database.select<PayloadRow[]>(
    `SELECT payload_json FROM ${table} WHERE world_id = $1 AND ${scope} ORDER BY ${orderBy}`,
    bindings,
  );
  return rows.map((row) => parse<T>(row.payload_json));
}

async function readState(
  database: SqlClient,
  owner: WorldRow | CheckpointRow,
  checkpointId: string | null,
): Promise<WorldState> {
  const worldId = "world_id" in owner ? owner.world_id : owner.id;
  const [entities, facts, events, beliefs, documents] = await Promise.all([
    payloads<Entity>(database, "entities", worldId, checkpointId, "entity_id"),
    payloads<CanonicalFact>(database, "facts", worldId, checkpointId, "fact_id"),
    payloads<CanonicalEvent>(database, "events", worldId, checkpointId, "occurred_at, event_id"),
    payloads<Belief>(database, "beliefs", worldId, checkpointId, "belief_id"),
    payloads<LongFormDocument>(database, "documents", worldId, checkpointId, "document_id"),
  ]);
  const sectionsByDocument = new Map<string, DocumentSection[]>();
  const sectionRows = await database.select<Array<PayloadRow & { document_id: string }>>(
    `SELECT document_id, payload_json FROM document_sections WHERE world_id = $1 AND ${
      checkpointId === null ? "checkpoint_id IS NULL" : "checkpoint_id = $2"
    } ORDER BY document_id, position`,
    checkpointId === null ? [worldId] : [worldId, checkpointId],
  );
  for (const row of sectionRows) {
    const existing = sectionsByDocument.get(row.document_id) ?? [];
    existing.push(parse<DocumentSection>(row.payload_json));
    sectionsByDocument.set(row.document_id, existing);
  }
  return {
    game: parse(owner.composition_json),
    initializedFromCampaign: owner.initialized_from_campaign,
    fictionalTime: owner.fictional_time,
    entities,
    facts,
    events,
    beliefs,
    documents: documents.map((document) => ({
      ...document,
      sections: sectionsByDocument.get(document.id) ?? [],
    })),
  };
}

async function issueCommand(database: SqlClient, command: unknown): Promise<void> {
  try {
    await database.execute(
      "INSERT INTO persistence_commands(payload_json) VALUES ($1)",
      [JSON.stringify(command)],
    );
  } catch (error) {
    throw new PersistenceConflictError(
      error instanceof Error ? error.message : "SQLite persistence command failed",
    );
  }
}

export function createSqlitePersistence(database: SqlClient): PersistencePorts {
  const loadWorld = async (worldId: string): Promise<PersistedWorld | undefined> => {
    const rows = await database.select<WorldRow[]>(
      "SELECT * FROM worlds WHERE id = $1",
      [worldId],
    );
    const row = rows[0];
    if (!row) return undefined;
    return { metadata: asMetadata(row), revision: row.revision, state: await readState(database, row, null) };
  };

  return {
    worlds: {
      async create(input: CreateWorldInput) {
        await issueCommand(database, { operation: "create-world", ...input });
        return (await loadWorld(input.metadata.id))!;
      },
      async list() {
        const rows = await database.select<WorldRow[]>(
          "SELECT * FROM worlds ORDER BY updated_at DESC",
        );
        return rows.map(asMetadata);
      },
      load: loadWorld,
      async commit(input: CommitWorldInput) {
        await issueCommand(database, { operation: "commit-world", ...input });
        return (await loadWorld(input.worldId))!;
      },
    },
    saves: {
      async saveCheckpoint(input: SaveCheckpointInput) {
        await issueCommand(database, { operation: "save-checkpoint", ...input });
        const rows = await database.select<SlotRow[]>(
          "SELECT * FROM save_slots WHERE id = $1",
          [input.slot.id],
        );
        return asSlot(rows[0]!);
      },
      async loadCheckpoint(checkpointId: string): Promise<PersistedCheckpoint | undefined> {
        const rows = await database.select<CheckpointRow[]>(
          "SELECT * FROM checkpoints WHERE id = $1",
          [checkpointId],
        );
        const row = rows[0];
        if (!row) return undefined;
        const metadata: CheckpointMetadata = {
          id: row.id,
          worldId: row.world_id,
          ...(row.parent_checkpoint_id ? { parentCheckpointId: row.parent_checkpoint_id } : {}),
          createdAt: row.created_at,
          revision: row.revision,
          game: parse(row.composition_json),
        };
        return { metadata, state: await readState(database, row, row.id) };
      },
      async listCheckpoints(worldId: string) {
        const rows = await database.select<CheckpointRow[]>(
          "SELECT * FROM checkpoints WHERE world_id = $1 ORDER BY created_at, id",
          [worldId],
        );
        return rows.map((row) => ({
          id: row.id,
          worldId: row.world_id,
          ...(row.parent_checkpoint_id ? { parentCheckpointId: row.parent_checkpoint_id } : {}),
          createdAt: row.created_at,
          revision: row.revision,
          game: parse(row.composition_json),
        }));
      },
      async listSlots(worldId: string) {
        const rows = await database.select<SlotRow[]>(
          "SELECT * FROM save_slots WHERE world_id = $1 ORDER BY name",
          [worldId],
        );
        return rows.map(asSlot);
      },
      async findSlot(worldId: string, name: string) {
        const rows = await database.select<SlotRow[]>(
          "SELECT * FROM save_slots WHERE world_id = $1 AND name = $2",
          [worldId, name],
        );
        return rows[0] ? asSlot(rows[0]) : undefined;
      },
    },
    content: {
      entities: (worldId) => payloads(database, "entities", worldId, null, "entity_id"),
      facts: (worldId) => payloads(database, "facts", worldId, null, "fact_id"),
      events: (worldId) => payloads(database, "events", worldId, null, "occurred_at, event_id"),
      beliefs: (worldId) => payloads(database, "beliefs", worldId, null, "belief_id"),
      async documents(worldId) {
        return (await loadWorld(worldId))?.state.documents ?? [];
      },
      async documentSections(worldId, documentId) {
        const documents = (await loadWorld(worldId))?.state.documents ?? [];
        return documents.find((document) => document.id === documentId)?.sections ?? [];
      },
    },
  };
}
