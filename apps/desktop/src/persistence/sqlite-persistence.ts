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
  EventQuery,
  PersistedCheckpoint,
  PersistedWorld,
  PersistencePorts,
  SaveCheckpointInput,
  SaveSlot,
  WorldMetadata,
  WorldState,
  ActionPressureState,
  ActionRun,
  RandomnessState,
  ScheduledTrigger,
  SimulationCursor,
  ActorSocialState,
  MechanicalRealization,
  GenerationRecord,
  CampaignPlanDocument,
} from "@llm-ttrpg/engine";
import {
  PersistenceConflictError,
  actionPressureStateSchema,
  actionRunSchema,
  canonicalEventSchema,
  eventQuerySchema,
  fictionalInstant,
  randomnessStateSchema,
  validateActionRunMetadataUpdate,
  validateActionRunWorldCommit,
  campaignPlanDocumentSchema,
} from "@llm-ttrpg/engine";
import type { SqlBindValue, SqlClient } from "./sql-client.js";

interface WorldRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  revision: number;
  event_sequence: number;
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
  event_sequence: number;
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

interface EventRow {
  canonical_json: string;
}

interface ActionPressureRow {
  level: number | null;
}

interface RandomnessRow {
  algorithm: string;
  root_seed: number;
  next_stream: number;
}

interface ActionRunRow {
  run_json: string;
}

interface ExtendedWorldStateRow {
  actor_social_json: string;
  mechanical_realizations_json: string;
  generation_record_json: string | null;
}

interface CampaignPlanRow {
  document_json: string;
}

function parse<T>(value: string): T {
  return JSON.parse(value) as T;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
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

async function tableExists(
  database: SqlClient,
  tableName: string,
): Promise<boolean> {
  const rows = await database.select<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = $1",
    [tableName],
  );
  return rows.length > 0;
}

async function readExtendedWorldState(
  database: SqlClient,
  worldId: string,
  checkpointId: string | null,
): Promise<{
  actorSocialStates: ActorSocialState[];
  mechanicalRealizations: MechanicalRealization[];
  generationRecord?: GenerationRecord;
}> {
  if (!(await tableExists(database, "extended_world_states"))) {
    return { actorSocialStates: [], mechanicalRealizations: [] };
  }
  const rows = await database.select<ExtendedWorldStateRow[]>(
    `SELECT actor_social_json, mechanical_realizations_json, generation_record_json
     FROM extended_world_states
     WHERE owner_key = $1`,
    [checkpointId === null ? `world:${worldId}` : `checkpoint:${checkpointId}`],
  );
  if (rows.length !== 1) {
    throw new PersistenceConflictError(
      `Expected exactly one extended world-state row; found ${rows.length}`,
    );
  }
  const row = rows[0]!;
  return {
    actorSocialStates: parse<ActorSocialState[]>(row.actor_social_json),
    mechanicalRealizations: parse<MechanicalRealization[]>(
      row.mechanical_realizations_json,
    ),
    ...(row.generation_record_json
      ? { generationRecord: parse<GenerationRecord>(row.generation_record_json) }
      : {}),
  };
}

async function readState(
  database: SqlClient,
  owner: WorldRow | CheckpointRow,
  checkpointId: string | null,
): Promise<WorldState> {
  const worldId = "world_id" in owner ? owner.world_id : owner.id;
  const [entities, facts, beliefs, documents, scheduledTriggers, simulationCursors, actionPressure, randomness, extended] = await Promise.all([
    payloads<Entity>(database, "entities", worldId, checkpointId, "entity_id"),
    payloads<CanonicalFact>(database, "facts", worldId, checkpointId, "fact_id"),
    payloads<Belief>(database, "beliefs", worldId, checkpointId, "belief_id"),
    payloads<LongFormDocument>(database, "documents", worldId, checkpointId, "document_id"),
    payloads<ScheduledTrigger>(database, "scheduled_triggers", worldId, checkpointId, "due_at, trigger_id"),
    payloads<SimulationCursor>(database, "simulation_cursors", worldId, checkpointId, "scope_id"),
    readActionPressure(database, worldId, checkpointId),
    readRandomness(database, worldId, checkpointId),
    readExtendedWorldState(database, worldId, checkpointId),
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
    fictionalTime: fictionalInstant(owner.fictional_time),
    actionPressure,
    randomness,
    entities,
    facts,
    beliefs,
    actorSocialStates: extended.actorSocialStates,
    mechanicalRealizations: extended.mechanicalRealizations,
    ...(extended.generationRecord ? { generationRecord: extended.generationRecord } : {}),
    documents: documents.map((document) => ({
      ...document,
      sections: sectionsByDocument.get(document.id) ?? [],
    })),
    scheduledTriggers,
    simulationCursors,
  };
}

async function readRandomness(
  database: SqlClient,
  worldId: string,
  checkpointId: string | null,
): Promise<RandomnessState> {
  const rows = await database.select<RandomnessRow[]>(
    `SELECT algorithm, root_seed, next_stream FROM randomness_states WHERE world_id = $1 AND ${
      checkpointId === null ? "checkpoint_id IS NULL" : "checkpoint_id = $2"
    }`,
    checkpointId === null ? [worldId] : [worldId, checkpointId],
  );
  if (rows.length !== 1) {
    const scope = checkpointId
      ? `checkpoint ${checkpointId}`
      : `current world ${worldId}`;
    throw new PersistenceConflictError(
      `Expected exactly one randomness state for ${scope}; found ${rows.length}`,
    );
  }
  const row = rows[0]!;
  return randomnessStateSchema.parse({
    algorithm: row.algorithm,
    rootSeed: row.root_seed,
    nextStream: row.next_stream,
  });
}

async function readActionPressure(
  database: SqlClient,
  worldId: string,
  checkpointId: string | null,
): Promise<ActionPressureState> {
  const rows = await database.select<ActionPressureRow[]>(
    `SELECT level FROM action_pressure_states WHERE world_id = $1 AND ${
      checkpointId === null ? "checkpoint_id IS NULL" : "checkpoint_id = $2"
    }`,
    checkpointId === null ? [worldId] : [worldId, checkpointId],
  );
  if (rows.length !== 1) {
    const scope = checkpointId
      ? `checkpoint ${checkpointId}`
      : `current world ${worldId}`;
    throw new PersistenceConflictError(
      `Expected exactly one action pressure state for ${scope}; found ${rows.length}`,
    );
  }
  const level = rows[0]!.level;
  return actionPressureStateSchema.parse(
    level === null
      ? { status: "unassessed" }
      : { status: "assessed", level },
  );
}

async function readEvents(
  database: SqlClient,
  worldId: string,
  checkpointId: string | null,
  query: EventQuery = {},
): Promise<CanonicalEvent[]> {
  const parsedQuery = eventQuerySchema.parse(query);
  const bindings: SqlBindValue[] = [worldId];
  const bind = (value: SqlBindValue): string => {
    bindings.push(value);
    return `$${bindings.length}`;
  };
  const conditions = [
    "world_id = $1",
    checkpointId === null
      ? "checkpoint_id IS NULL"
      : `checkpoint_id = ${bind(checkpointId)}`,
  ];
  if (parsedQuery.from) conditions.push(`occurred_at >= ${bind(parsedQuery.from)}`);
  if (parsedQuery.to) conditions.push(`occurred_at <= ${bind(parsedQuery.to)}`);
  if (parsedQuery.types?.length) {
    conditions.push(
      `event_type IN (${parsedQuery.types.map((type) => bind(type)).join(", ")})`,
    );
  }
  if (parsedQuery.relatedEntityId) {
    conditions.push(
      `EXISTS (SELECT 1 FROM json_each(related_entity_ids_json) WHERE value = ${bind(parsedQuery.relatedEntityId)})`,
    );
  }
  if (parsedQuery.scopeId) {
    conditions.push(
      `EXISTS (SELECT 1 FROM json_each(scope_ids_json) WHERE value = ${bind(parsedQuery.scopeId)})`,
    );
  }
  if (parsedQuery.causedByEventId) {
    conditions.push(
      `EXISTS (SELECT 1 FROM json_each(caused_by_event_ids_json) WHERE value = ${bind(parsedQuery.causedByEventId)})`,
    );
  }
  if (parsedQuery.originKind) conditions.push(`origin_kind = ${bind(parsedQuery.originKind)}`);
  if (parsedQuery.originId) conditions.push(`origin_id = ${bind(parsedQuery.originId)}`);
  if (parsedQuery.access?.length) {
    conditions.push(
      `access IN (${parsedQuery.access.map((access) => bind(access)).join(", ")})`,
    );
  }
  const direction = parsedQuery.direction ?? "ascending";
  if (parsedQuery.cursor) {
    const time = bind(parsedQuery.cursor.occurredAt);
    const sequence = bind(parsedQuery.cursor.sequence);
    const operator = direction === "ascending" ? ">" : "<";
    conditions.push(
      `(occurred_at ${operator} ${time} OR (occurred_at = ${time} AND sequence ${operator} ${sequence}))`,
    );
  }
  const limit = parsedQuery.limit ?? 100;
  const order = direction === "ascending" ? "ASC" : "DESC";
  const rows = await database.select<EventRow[]>(
    `SELECT canonical_json FROM events WHERE ${conditions.join(" AND ")} ORDER BY occurred_at ${order}, sequence ${order} LIMIT ${bind(limit)}`,
    bindings,
  );
  return rows.map((row) => canonicalEventSchema.parse(parse(row.canonical_json)));
}

async function readCheckpointEvents(
  database: SqlClient,
  worldId: string,
  checkpointId: string,
): Promise<CanonicalEvent[]> {
  const rows = await database.select<EventRow[]>(
    "SELECT canonical_json FROM events WHERE world_id = $1 AND checkpoint_id = $2 ORDER BY occurred_at, sequence",
    [worldId, checkpointId],
  );
  return rows.map((row) => canonicalEventSchema.parse(parse(row.canonical_json)));
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
  const loadCampaignPlan = async (worldId: string): Promise<CampaignPlanDocument | undefined> => {
    const rows = await database.select<CampaignPlanRow[]>(
      "SELECT document_json FROM campaign_plans WHERE world_id = $1",
      [worldId],
    );
    return rows[0]
      ? campaignPlanDocumentSchema.parse(parse(rows[0].document_json))
      : undefined;
  };
  const loadActionRun = async (worldId: string, actionId: string): Promise<ActionRun | undefined> => {
    const rows = await database.select<ActionRunRow[]>(
      "SELECT run_json FROM action_runs WHERE world_id = $1 AND action_id = $2",
      [worldId, actionId],
    );
    return rows[0] ? actionRunSchema.parse(parse(rows[0].run_json)) : undefined;
  };
  const loadWorld = async (worldId: string): Promise<PersistedWorld | undefined> => {
    const rows = await database.select<WorldRow[]>(
      "SELECT * FROM worlds WHERE id = $1",
      [worldId],
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      metadata: asMetadata(row),
      revision: row.revision,
      eventSequence: row.event_sequence,
      state: await readState(database, row, null),
    };
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
        if (input.actionRun) {
          try {
            validateActionRunWorldCommit(
              await loadActionRun(input.worldId, input.actionRun.id),
              input.actionRun,
              input.expectedRevision,
            );
          } catch (error) {
            throw new PersistenceConflictError(
              error instanceof Error ? error.message : "Invalid action run commit",
            );
          }
        }
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
          eventSequence: row.event_sequence,
          game: parse(row.composition_json),
        };
        return {
          metadata,
          state: await readState(database, row, row.id),
          history: await readCheckpointEvents(database, row.world_id, row.id),
        };
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
          eventSequence: row.event_sequence,
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
      beliefs: (worldId) => payloads(database, "beliefs", worldId, null, "belief_id"),
      async actorSocialStates(worldId) {
        return (await loadWorld(worldId))?.state.actorSocialStates ?? [];
      },
      async mechanicalRealizations(worldId) {
        return (await loadWorld(worldId))?.state.mechanicalRealizations ?? [];
      },
      async documents(worldId) {
        return (await loadWorld(worldId))?.state.documents ?? [];
      },
      async documentSections(worldId, documentId) {
        const documents = (await loadWorld(worldId))?.state.documents ?? [];
        return documents.find((document) => document.id === documentId)?.sections ?? [];
      },
    },
    history: {
      async get(worldId, eventId) {
        const rows = await database.select<EventRow[]>(
          "SELECT canonical_json FROM events WHERE world_id = $1 AND checkpoint_id IS NULL AND event_id = $2",
          [worldId, eventId],
        );
        return rows[0]
          ? canonicalEventSchema.parse(parse(rows[0].canonical_json))
          : undefined;
      },
      query(worldId, query) {
        return readEvents(database, worldId, null, query);
      },
    },
    actionRuns: {
      async load(worldId, actionId) {
        return loadActionRun(worldId, actionId);
      },
      async create(run: ActionRun) {
        const parsedRun = actionRunSchema.parse(run);
        const worlds = await database.select<Array<{ revision: number }>>(
          "SELECT revision FROM worlds WHERE id = $1",
          [parsedRun.worldId],
        );
        if (
          worlds[0]?.revision !== parsedRun.lastWorldRevision ||
          parsedRun.status !== "active" ||
          parsedRun.receipts.length !== 0 ||
          parsedRun.elapsedMs !== 0
        ) {
          throw new PersistenceConflictError(
            "A created action run must be empty, active, and current with its world",
          );
        }
        try {
          await database.execute(
            "INSERT INTO action_runs(world_id, action_id, actor_id, declaration, run_json) VALUES ($1, $2, $3, $4, $5)",
            [
              parsedRun.worldId,
              parsedRun.id,
              parsedRun.actorId,
              parsedRun.declaration,
              JSON.stringify(parsedRun),
            ],
          );
        } catch (error) {
          throw new PersistenceConflictError(
            error instanceof Error ? error.message : "Action run creation failed",
          );
        }
        return parsedRun;
      },
      async update(run: ActionRun) {
        const parsedRun = actionRunSchema.parse(run);
        const existing = await loadActionRun(parsedRun.worldId, parsedRun.id);
        if (!existing) {
          throw new PersistenceConflictError(`Action run not found: ${parsedRun.id}`);
        }
        try {
          validateActionRunMetadataUpdate(existing, parsedRun);
        } catch (error) {
          throw new PersistenceConflictError(
            error instanceof Error ? error.message : "Invalid action run metadata update",
          );
        }
        await database.execute(
          "UPDATE action_runs SET run_json = ? WHERE world_id = ? AND action_id = ?",
          [JSON.stringify(parsedRun), parsedRun.worldId, parsedRun.id],
        );
        return parsedRun;
      },
    },
    planner: {
      load: loadCampaignPlan,
      async initialize(input) {
        const plan = campaignPlanDocumentSchema.parse(input.plan);
        if (
          plan.planRevision !== 0 ||
          plan.basedOnWorldRevision !== input.expectedWorldRevision ||
          plan.basedOnEventSequence !== input.expectedEventSequence
        ) {
          throw new PersistenceConflictError("Campaign plan initialization basis is stale or invalid");
        }
        try {
          await database.execute(
            `INSERT INTO campaign_plans (
              world_id, schema_version, plan_revision,
              based_on_world_revision, based_on_event_sequence, document_json
            )
            SELECT $1, 1, $2, $3, $4, $5
            FROM worlds
            WHERE id = $1 AND revision = $3 AND event_sequence = $4`,
            [input.worldId, plan.planRevision, input.expectedWorldRevision, input.expectedEventSequence, JSON.stringify(plan)],
          );
        } catch (error) {
          throw new PersistenceConflictError(error instanceof Error ? error.message : "Campaign plan initialization failed");
        }
        const stored = await loadCampaignPlan(input.worldId);
        if (!stored || canonicalJson(stored) !== canonicalJson(plan)) {
          throw new PersistenceConflictError("Campaign plan initialization basis is stale");
        }
        return stored;
      },
      async commit(input) {
        const plan = campaignPlanDocumentSchema.parse(input.plan);
        if (
          plan.planRevision !== input.expectedPlanRevision + 1 ||
          plan.basedOnWorldRevision !== input.expectedWorldRevision ||
          plan.basedOnEventSequence !== input.expectedEventSequence
        ) {
          throw new PersistenceConflictError("Campaign plan commit is non-contiguous or has a stale basis");
        }
        try {
          await database.execute(
            `UPDATE campaign_plans
             SET plan_revision = ?,
                 based_on_world_revision = ?,
                 based_on_event_sequence = ?,
                 document_json = ?
             WHERE world_id = ?
               AND plan_revision = ?
               AND EXISTS (
                 SELECT 1 FROM worlds
                 WHERE id = ? AND revision = ? AND event_sequence = ?
               )`,
            [
              plan.planRevision,
              input.expectedWorldRevision,
              input.expectedEventSequence,
              JSON.stringify(plan),
              input.worldId,
              input.expectedPlanRevision,
              input.worldId,
              input.expectedWorldRevision,
              input.expectedEventSequence,
            ],
          );
        } catch (error) {
          throw new PersistenceConflictError(error instanceof Error ? error.message : "Campaign plan commit failed");
        }
        const stored = await loadCampaignPlan(input.worldId);
        if (!stored || canonicalJson(stored) !== canonicalJson(plan)) {
          throw new PersistenceConflictError("Campaign plan commit lost an optimistic-concurrency race");
        }
        return stored;
      },
      async loadCheckpoint(checkpointId) {
        const checkpoints = await database.select<Array<{ id: string }>>(
          "SELECT id FROM checkpoints WHERE id = $1",
          [checkpointId],
        );
        if (!checkpoints[0]) throw new PersistenceConflictError(`Checkpoint not found: ${checkpointId}`);
        const rows = await database.select<CampaignPlanRow[]>(
          "SELECT document_json FROM checkpoint_campaign_plans WHERE checkpoint_id = $1",
          [checkpointId],
        );
        return rows[0]
          ? campaignPlanDocumentSchema.parse(parse(rows[0].document_json))
          : undefined;
      },
      async restoreCheckpoint(input) {
        const snapshotRows = await database.select<CampaignPlanRow[]>(
          "SELECT document_json FROM checkpoint_campaign_plans WHERE checkpoint_id = $1",
          [input.checkpointId],
        );
        if (!snapshotRows[0]) return undefined;
        const snapshot = campaignPlanDocumentSchema.parse(parse(snapshotRows[0].document_json));
        const worlds = await database.select<Array<{ fictional_time: string }>>(
          "SELECT fictional_time FROM worlds WHERE id = $1 AND revision = $2 AND event_sequence = $3",
          [input.targetWorldId, input.expectedWorldRevision, input.expectedEventSequence],
        );
        if (!worlds[0]) throw new PersistenceConflictError("Campaign-plan restore basis is stale");
        const restored = campaignPlanDocumentSchema.parse({
          ...snapshot,
          basedOnWorldRevision: input.expectedWorldRevision,
          basedOnEventSequence: input.expectedEventSequence,
          updatedAtFictionalTime: worlds[0].fictional_time,
        });
        try {
          await database.execute(
            `INSERT INTO campaign_plans (
              world_id, schema_version, plan_revision,
              based_on_world_revision, based_on_event_sequence, document_json
            ) VALUES ($1, 1, $2, $3, $4, $5)`,
            [input.targetWorldId, restored.planRevision, input.expectedWorldRevision, input.expectedEventSequence, JSON.stringify(restored)],
          );
        } catch (error) {
          throw new PersistenceConflictError(error instanceof Error ? error.message : "Campaign-plan restore failed");
        }
        return restored;
      },
    },
  };
}
