import type {
  CheckpointMetadata,
  CommitWorldInput,
  CreateWorldInput,
  PersistedCheckpoint,
  PersistedWorld,
  PersistencePorts,
  SaveCheckpointInput,
  SaveSlot,
  WorldId,
  WorldMetadata,
} from "./persistence.js";
import {
  PersistenceConflictError,
  PersistenceNotFoundError,
} from "./persistence.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createInMemoryPersistence(): PersistencePorts {
  const worlds = new Map<string, PersistedWorld>();
  const checkpoints = new Map<string, PersistedCheckpoint>();
  const slots = new Map<string, SaveSlot>();

  function loadRequiredWorld(worldId: WorldId): PersistedWorld {
    const world = worlds.get(worldId);
    if (!world) {
      throw new PersistenceNotFoundError(`World not found: ${worldId}`);
    }
    return world;
  }

  return {
    worlds: {
      async create(input: CreateWorldInput) {
        if (worlds.has(input.metadata.id)) {
          throw new PersistenceConflictError(
            `World already exists: ${input.metadata.id}`,
          );
        }
        if (!sameJson(input.metadata.game, input.state.game)) {
          throw new PersistenceConflictError(
            "World metadata and state use different game compositions",
          );
        }
        const world: PersistedWorld = {
          metadata: clone(input.metadata),
          revision: 0,
          state: clone(input.state),
        };
        worlds.set(input.metadata.id, world);
        return clone(world);
      },
      async list(): Promise<readonly WorldMetadata[]> {
        return [...worlds.values()]
          .map((world) => clone(world.metadata))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },
      async load(worldId: WorldId) {
        const world = worlds.get(worldId);
        return world ? clone(world) : undefined;
      },
      async commit(input: CommitWorldInput) {
        const current = loadRequiredWorld(input.worldId);
        if (current.revision !== input.expectedRevision) {
          throw new PersistenceConflictError(
            `World ${input.worldId} revision changed from ${input.expectedRevision} to ${current.revision}`,
          );
        }
        if (!sameJson(current.metadata.game, input.state.game)) {
          throw new PersistenceConflictError(
            "A commit cannot change the world's game composition",
          );
        }
        const committed: PersistedWorld = {
          metadata: {
            ...current.metadata,
            updatedAt: input.updatedAt,
            game: clone(input.state.game),
          },
          revision: current.revision + 1,
          state: clone(input.state),
        };
        worlds.set(input.worldId, committed);
        return clone(committed);
      },
    },
    saves: {
      async saveCheckpoint(input: SaveCheckpointInput) {
        const world = loadRequiredWorld(input.checkpoint.worldId);
        if (checkpoints.has(input.checkpoint.id)) {
          throw new PersistenceConflictError(
            `Checkpoint already exists: ${input.checkpoint.id}`,
          );
        }
        if (world.revision !== input.checkpoint.revision) {
          throw new PersistenceConflictError(
            `Cannot checkpoint world revision ${input.checkpoint.revision}; current revision is ${world.revision}`,
          );
        }
        if (
          !sameJson(world.metadata.game, input.checkpoint.game) ||
          !sameJson(input.checkpoint.game, input.state.game)
        ) {
          throw new PersistenceConflictError(
            "Checkpoint composition does not match its world and state",
          );
        }
        const existing = [...slots.values()].find(
          (slot) =>
            slot.worldId === input.checkpoint.worldId &&
            slot.name === input.slot.name,
        );
        if (existing && existing.id !== input.slot.id) {
          throw new PersistenceConflictError(
            `Save slot name already exists: ${input.slot.name}`,
          );
        }
        checkpoints.set(input.checkpoint.id, {
          metadata: clone(input.checkpoint),
          state: clone(input.state),
        });
        const slot: SaveSlot = {
          id: input.slot.id,
          worldId: input.checkpoint.worldId,
          name: input.slot.name,
          checkpointId: input.checkpoint.id,
          createdAt: existing?.createdAt ?? input.slot.createdAt,
          updatedAt: input.slot.updatedAt,
        };
        slots.set(slot.id, slot);
        return clone(slot);
      },
      async loadCheckpoint(checkpointId: string) {
        const checkpoint = checkpoints.get(checkpointId);
        return checkpoint ? clone(checkpoint) : undefined;
      },
      async listCheckpoints(worldId: string): Promise<readonly CheckpointMetadata[]> {
        return [...checkpoints.values()]
          .filter((checkpoint) => checkpoint.metadata.worldId === worldId)
          .map((checkpoint) => clone(checkpoint.metadata))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      },
      async listSlots(worldId: string): Promise<readonly SaveSlot[]> {
        return [...slots.values()]
          .filter((slot) => slot.worldId === worldId)
          .map(clone)
          .sort((a, b) => a.name.localeCompare(b.name));
      },
      async findSlot(worldId: string, name: string) {
        const slot = [...slots.values()].find(
          (candidate) => candidate.worldId === worldId && candidate.name === name,
        );
        return slot ? clone(slot) : undefined;
      },
    },
    content: {
      async entities(worldId) {
        return clone(loadRequiredWorld(worldId).state.entities);
      },
      async facts(worldId) {
        return clone(loadRequiredWorld(worldId).state.facts);
      },
      async events(worldId) {
        return clone(loadRequiredWorld(worldId).state.events);
      },
      async beliefs(worldId) {
        return clone(loadRequiredWorld(worldId).state.beliefs);
      },
      async documents(worldId) {
        return clone(loadRequiredWorld(worldId).state.documents);
      },
      async documentSections(worldId, documentId) {
        const document = loadRequiredWorld(worldId).state.documents.find(
          (candidate) => candidate.id === documentId,
        );
        return clone(document?.sections ?? []);
      },
    },
  };
}
