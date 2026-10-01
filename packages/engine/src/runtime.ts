import type { CanonicalEvent } from "./content.js";
import type { LoadedGameDefinition } from "./contracts.js";
import {
  createSeededRandom,
  executeRulesOperation,
  type MutationProposal,
} from "./operations.js";
import type {
  CheckpointMetadata,
  PersistedWorld,
  PersistencePorts,
  SaveSlot,
  WorldMetadata,
} from "./persistence.js";
import { PersistenceNotFoundError } from "./persistence.js";
import { validateGameCompositionForGame } from "./save.js";
import {
  initializeCampaignWorld,
  validateWorldState,
  type WorldState,
} from "./world.js";

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  next(kind: "world" | "checkpoint" | "slot" | "event"): string;
}

export interface GameRuntimeDependencies {
  readonly persistence: PersistencePorts;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly game: LoadedGameDefinition;
}

export interface ExecuteOperationOptions {
  readonly seed?: number;
}

export interface GameSession {
  readonly worldId: string;
  snapshot(): WorldState;
  executeOperation<TResult = unknown>(
    operationId: string,
    input: unknown,
    options?: ExecuteOperationOptions,
  ): Promise<TResult>;
  save(slotName: string): Promise<SaveSlot>;
  listSlots(): Promise<readonly SaveSlot[]>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function applyMutations(
  state: WorldState,
  mutations: readonly MutationProposal[],
): void {
  for (const mutation of mutations) {
    if (mutation.kind === "set-entity-data") {
      const entity = state.entities.find((item) => item.id === mutation.entityId);
      if (!entity) {
        throw new PersistenceNotFoundError(
          `Mutation references missing entity: ${mutation.entityId}`,
        );
      }
      entity.data[mutation.key] = clone(mutation.value);
    } else if (mutation.kind === "upsert-fact") {
      const index = state.facts.findIndex((item) => item.id === mutation.fact.id);
      if (index === -1) state.facts.push(clone(mutation.fact));
      else state.facts[index] = clone(mutation.fact);
    } else {
      state.facts = state.facts.filter((item) => item.id !== mutation.factId);
    }
  }
}

function openSession(
  dependencies: GameRuntimeDependencies,
  persisted: PersistedWorld,
): GameSession {
  let state = clone(persisted.state);
  let revision = persisted.revision;

  return {
    worldId: persisted.metadata.id,
    snapshot() {
      return clone(state);
    },
    async executeOperation<TResult>(
      operationId: string,
      input: unknown,
      options?: ExecuteOperationOptions,
    ) {
      const candidate = clone(state);
      const outcome = executeRulesOperation<unknown, TResult>(
        dependencies.game.operationRegistry,
        operationId,
        { world: candidate, rng: createSeededRandom(options?.seed ?? 0) },
        input,
      );
      applyMutations(candidate, outcome.proposedMutations);
      for (const event of outcome.proposedEvents) {
        const canonicalEvent: CanonicalEvent = {
          id: dependencies.idGenerator.next("event"),
          kind: event.kind,
          occurredAt: dependencies.clock.now(),
          summary: event.summary,
          participantIds: [...event.participantIds],
          details: clone(event.details),
          visibility: "public",
        };
        candidate.events.push(canonicalEvent);
      }

      validateWorldState(candidate);

      const committed = await dependencies.persistence.worlds.commit({
        worldId: persisted.metadata.id,
        expectedRevision: revision,
        updatedAt: dependencies.clock.now(),
        state: candidate,
      });
      state = clone(committed.state);
      revision = committed.revision;
      return outcome.result;
    },
    async save(slotName) {
      const timestamp = dependencies.clock.now();
      const existingSlot = await dependencies.persistence.saves.findSlot(
        persisted.metadata.id,
        slotName,
      );
      const checkpoint: CheckpointMetadata = {
        id: dependencies.idGenerator.next("checkpoint"),
        worldId: persisted.metadata.id,
        ...(existingSlot
          ? { parentCheckpointId: existingSlot.checkpointId }
          : {}),
        createdAt: timestamp,
        revision,
        game: clone(state.game),
      };
      return dependencies.persistence.saves.saveCheckpoint({
        checkpoint,
        state,
        slot: {
          id: existingSlot?.id ?? dependencies.idGenerator.next("slot"),
          name: slotName,
          createdAt: existingSlot?.createdAt ?? timestamp,
          updatedAt: timestamp,
        },
      });
    },
    async listSlots() {
      return dependencies.persistence.saves.listSlots(persisted.metadata.id);
    },
  };
}

export function createGameRuntime(dependencies: GameRuntimeDependencies) {
  return {
    async createWorld(name: string): Promise<GameSession> {
      const timestamp = dependencies.clock.now();
      const id = dependencies.idGenerator.next("world");
      const state = initializeCampaignWorld(dependencies.game);
      const metadata: WorldMetadata = {
        id,
        name,
        createdAt: timestamp,
        updatedAt: timestamp,
        game: clone(state.game),
      };
      const world = await dependencies.persistence.worlds.create({
        metadata,
        state,
      });
      return openSession(dependencies, {
        ...world,
        state: validateWorldState(world.state),
      });
    },
    listWorlds() {
      return dependencies.persistence.worlds.list();
    },
    async openWorld(worldId: string): Promise<GameSession> {
      const world = await dependencies.persistence.worlds.load(worldId);
      if (!world) {
        throw new PersistenceNotFoundError(`World not found: ${worldId}`);
      }
      validateGameCompositionForGame(world.state.game, dependencies.game);
      return openSession(dependencies, {
        ...world,
        state: validateWorldState(world.state),
      });
    },
  };
}
