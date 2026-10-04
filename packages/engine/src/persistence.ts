import type {
  Belief,
  CanonicalFact,
  DocumentSection,
  Entity,
  LongFormDocument,
} from "./content.js";
import type { CanonicalEvent, EventQuery } from "./events.js";
import type { GameComposition } from "./contracts.js";
import type { WorldState } from "./world.js";
import type { ActionRun } from "./player-action-contracts.js";
import type { ActorSocialState } from "./actor-social-state.js";
import type { MechanicalRealization } from "./mechanical-realization.js";

export type WorldId = string;
export type CheckpointId = string;
export type SaveSlotId = string;

export interface WorldMetadata {
  readonly id: WorldId;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly game: GameComposition;
}

export interface PersistedWorld {
  readonly metadata: WorldMetadata;
  readonly revision: number;
  readonly eventSequence: number;
  readonly state: WorldState;
}

export interface CheckpointMetadata {
  readonly id: CheckpointId;
  readonly worldId: WorldId;
  readonly parentCheckpointId?: CheckpointId;
  readonly createdAt: string;
  readonly revision: number;
  readonly eventSequence: number;
  readonly game: GameComposition;
}

export interface PersistedCheckpoint {
  readonly metadata: CheckpointMetadata;
  readonly state: WorldState;
  readonly history: readonly CanonicalEvent[];
}

export interface SaveSlot {
  readonly id: SaveSlotId;
  readonly worldId: WorldId;
  readonly name: string;
  readonly checkpointId: CheckpointId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateWorldInput {
  readonly metadata: WorldMetadata;
  readonly state: WorldState;
  readonly initialEvents: readonly CanonicalEvent[];
}

export interface CommitWorldInput {
  readonly worldId: WorldId;
  readonly expectedRevision: number;
  readonly updatedAt: string;
  readonly state: WorldState;
  readonly events: readonly CanonicalEvent[];
  readonly eventSequence: number;
  readonly actionRun?: ActionRun;
}

export interface ActionRunStore {
  load(worldId: WorldId, actionId: string): Promise<ActionRun | undefined>;
  create(run: ActionRun): Promise<ActionRun>;
  update(run: ActionRun): Promise<ActionRun>;
}

export interface SaveCheckpointInput {
  readonly checkpoint: CheckpointMetadata;
  readonly state: WorldState;
  readonly slot: {
    readonly id: SaveSlotId;
    readonly name: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
}

export interface WorldStore {
  create(input: CreateWorldInput): Promise<PersistedWorld>;
  list(): Promise<readonly WorldMetadata[]>;
  load(worldId: WorldId): Promise<PersistedWorld | undefined>;
  commit(input: CommitWorldInput): Promise<PersistedWorld>;
}

export interface SaveStore {
  saveCheckpoint(input: SaveCheckpointInput): Promise<SaveSlot>;
  loadCheckpoint(
    checkpointId: CheckpointId,
  ): Promise<PersistedCheckpoint | undefined>;
  listCheckpoints(worldId: WorldId): Promise<readonly CheckpointMetadata[]>;
  listSlots(worldId: WorldId): Promise<readonly SaveSlot[]>;
  findSlot(worldId: WorldId, name: string): Promise<SaveSlot | undefined>;
}

export interface WorldContentQueries {
  entities(worldId: WorldId): Promise<readonly Entity[]>;
  facts(worldId: WorldId): Promise<readonly CanonicalFact[]>;
  beliefs(worldId: WorldId): Promise<readonly Belief[]>;
  actorSocialStates(worldId: WorldId): Promise<readonly ActorSocialState[]>;
  mechanicalRealizations(worldId: WorldId): Promise<readonly MechanicalRealization[]>;
  documents(worldId: WorldId): Promise<readonly LongFormDocument[]>;
  documentSections(
    worldId: WorldId,
    documentId: string,
  ): Promise<readonly DocumentSection[]>;
}

export interface EventHistoryStore {
  get(
    worldId: WorldId,
    eventId: string,
  ): Promise<CanonicalEvent | undefined>;
  query(
    worldId: WorldId,
    query?: EventQuery,
  ): Promise<readonly CanonicalEvent[]>;
}

export interface PersistencePorts {
  readonly worlds: WorldStore;
  readonly saves: SaveStore;
  readonly content: WorldContentQueries;
  readonly history: EventHistoryStore;
  readonly actionRuns: ActionRunStore;
}

export class PersistenceConflictError extends Error {
  override readonly name = "PersistenceConflictError";
}

export class PersistenceNotFoundError extends Error {
  override readonly name = "PersistenceNotFoundError";
}
