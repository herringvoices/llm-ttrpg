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
  eventQuerySchema,
  type CanonicalEvent,
  type EventQuery,
} from "./events.js";
import { compareFictionalInstants } from "./time.js";
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
  const histories = new Map<string, CanonicalEvent[]>();

  function loadRequiredWorld(worldId: WorldId): PersistedWorld {
    const world = worlds.get(worldId);
    if (!world) {
      throw new PersistenceNotFoundError(`World not found: ${worldId}`);
    }
    return world;
  }

  function validateAppendedEvents(
    world: PersistedWorld,
    events: readonly CanonicalEvent[],
    eventSequence: number,
    fictionalTime: PersistedWorld["state"]["fictionalTime"],
  ): void {
    if (eventSequence !== world.eventSequence + events.length) {
      throw new PersistenceConflictError("Event sequence is not contiguous");
    }
    const history = histories.get(world.metadata.id) ?? [];
    const knownIds = new Set(history.map((event) => event.id));
    let lastOccurredAt = history.at(-1)?.occurredAt;
    for (const [index, event] of events.entries()) {
      if (event.sequence !== world.eventSequence + index + 1) {
        throw new PersistenceConflictError("Event sequence is not contiguous");
      }
      if (knownIds.has(event.id)) {
        throw new PersistenceConflictError(`Event already exists: ${event.id}`);
      }
      if (compareFictionalInstants(event.occurredAt, fictionalTime) > 0) {
        throw new PersistenceConflictError("Event cannot occur after world time");
      }
      if (
        lastOccurredAt &&
        compareFictionalInstants(event.occurredAt, lastOccurredAt) < 0
      ) {
        throw new PersistenceConflictError(
          "Event occurrence time cannot move backward",
        );
      }
      for (const causeId of event.causedByEventIds) {
        if (!knownIds.has(causeId)) {
          throw new PersistenceConflictError(
            `Event ${event.id} has unknown or non-prior cause ${causeId}`,
          );
        }
      }
      knownIds.add(event.id);
      lastOccurredAt = event.occurredAt;
    }
  }

  function queryHistory(
    worldId: string,
    query: EventQuery = {},
  ): CanonicalEvent[] {
    const parsedQuery = eventQuerySchema.parse(query);
    const direction = parsedQuery.direction ?? "ascending";
    const limit = parsedQuery.limit ?? 100;
    return clone(histories.get(worldId) ?? [])
      .filter((event) => {
        if (parsedQuery.from && event.occurredAt < parsedQuery.from) return false;
        if (parsedQuery.to && event.occurredAt > parsedQuery.to) return false;
        if (parsedQuery.types && !parsedQuery.types.includes(event.type)) return false;
        if (
          parsedQuery.relatedEntityId &&
          !event.relatedEntityIds.includes(parsedQuery.relatedEntityId)
        ) return false;
        if (parsedQuery.scopeId && !event.scopeIds.includes(parsedQuery.scopeId)) return false;
        if (
          parsedQuery.causedByEventId &&
          !event.causedByEventIds.includes(parsedQuery.causedByEventId)
        ) return false;
        if (parsedQuery.originKind && event.origin?.kind !== parsedQuery.originKind) return false;
        if (parsedQuery.originId && event.origin?.id !== parsedQuery.originId) return false;
        if (parsedQuery.access && !parsedQuery.access.includes(event.access)) return false;
        if (parsedQuery.cursor) {
          const comparison =
            event.occurredAt.localeCompare(parsedQuery.cursor.occurredAt) ||
            event.sequence - parsedQuery.cursor.sequence;
          if (direction === "ascending" ? comparison <= 0 : comparison >= 0) {
            return false;
          }
        }
        return true;
      })
      .sort((left, right) => {
        const comparison =
          left.occurredAt.localeCompare(right.occurredAt) ||
          left.sequence - right.sequence;
        return direction === "ascending" ? comparison : -comparison;
      })
      .slice(0, limit);
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
          eventSequence: input.initialEvents.length,
          state: clone(input.state),
        };
        const emptyWorld = { ...world, eventSequence: 0 };
        histories.set(input.metadata.id, []);
        validateAppendedEvents(
          emptyWorld,
          input.initialEvents,
          input.initialEvents.length,
          input.state.fictionalTime,
        );
        histories.set(input.metadata.id, clone([...input.initialEvents]));
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
        if (
          compareFictionalInstants(
            input.state.fictionalTime,
            current.state.fictionalTime,
          ) < 0
        ) {
          throw new PersistenceConflictError(
            "Fictional time cannot move backward",
          );
        }
        validateAppendedEvents(
          current,
          input.events,
          input.eventSequence,
          input.state.fictionalTime,
        );
        const committed: PersistedWorld = {
          metadata: {
            ...current.metadata,
            updatedAt: input.updatedAt,
            game: clone(input.state.game),
          },
          revision: current.revision + 1,
          eventSequence: input.eventSequence,
          state: clone(input.state),
        };
        histories.set(input.worldId, [
          ...(histories.get(input.worldId) ?? []),
          ...clone(input.events),
        ]);
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
        if (world.eventSequence !== input.checkpoint.eventSequence) {
          throw new PersistenceConflictError(
            `Cannot checkpoint event sequence ${input.checkpoint.eventSequence}; current sequence is ${world.eventSequence}`,
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
          history: clone(histories.get(input.checkpoint.worldId) ?? []),
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
    history: {
      async get(worldId, eventId) {
        loadRequiredWorld(worldId);
        const event = (histories.get(worldId) ?? []).find(
          (candidate) => candidate.id === eventId,
        );
        return event ? clone(event) : undefined;
      },
      async query(worldId, query) {
        loadRequiredWorld(worldId);
        return queryHistory(worldId, query);
      },
    },
  };
}
