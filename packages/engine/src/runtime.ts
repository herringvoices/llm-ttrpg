import {
  actionPressureAssessmentSchema,
  type ActionPressureAssessment,
  type ActionPressureState,
} from "./action-pressure.js";
import {
  canonicalEventSchema,
  type CanonicalEvent,
  type EventOrigin,
  type EventQuery,
} from "./events.js";
import type { LoadedGameDefinition } from "./contracts.js";
import {
  assessResolutionOperation,
  executeRulesOperation,
  resolveUncertainOperation,
  type MutationProposal,
  type OperationResult,
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
  createLazyRandomnessStream,
  randomnessStateSchema,
  type WorldSeedSource,
} from "./randomness.js";
import {
  createResolutionEnvelopeSchema,
  ResolutionValidationError,
  resolutionRequestSchema,
  type ResolutionEnvelope,
  type ResolutionRequest,
} from "./resolution.js";
import type { JsonValue } from "./json.js";
import {
  advanceFictionalInstant,
  fictionalDurationMs,
  fictionalInstant,
  type FictionalInstant,
} from "./time.js";
import {
  initializeCampaignHistory,
  initializeCampaignWorld,
  scheduledTriggerSchema,
  validateWorldState,
  type ScheduledTrigger,
  type WorldState,
} from "./world.js";
import {
  assembleContext,
  type SceneSourceProvider,
} from "./context.js";
import type {
  ContextAssemblyRequest,
  ContextItem,
  ContextPackage,
} from "./context-contracts.js";
import type { ToolAvailabilityPolicy } from "./tool-catalog.js";

export interface WallClock {
  now(): string;
}

export interface IdGenerator {
  next(
    kind: "world" | "checkpoint" | "slot" | "event" | "scheduled-trigger",
  ): string;
}

export interface GameRuntimeDependencies {
  readonly persistence: PersistencePorts;
  readonly wallClock: WallClock;
  readonly idGenerator: IdGenerator;
  readonly worldSeedSource: WorldSeedSource;
  readonly game: LoadedGameDefinition;
  readonly context?: {
    readonly sceneSource?: SceneSourceProvider;
  };
}

export interface AssembleSessionContextOptions {
  readonly retrieved?: readonly ContextItem[];
  readonly toolPolicy?: ToolAvailabilityPolicy;
}

export interface ExecuteOperationOptions {
  readonly causedByEventIds?: readonly string[];
  readonly origin?: EventOrigin;
}

export interface GameSession {
  readonly worldId: string;
  snapshot(): WorldState;
  applyActionPressureAssessment(
    assessment: ActionPressureAssessment,
  ): Promise<ActionPressureState>;
  advanceTime(durationMs: number): Promise<WorldState>;
  setSimulationCursor(
    scopeId: string,
    lastSimulatedAt: FictionalInstant,
  ): Promise<WorldState>;
  scheduleTrigger(
    trigger: Omit<ScheduledTrigger, "id">,
  ): Promise<ScheduledTrigger>;
  eventHistory(query?: EventQuery): Promise<readonly CanonicalEvent[]>;
  assembleContext(
    request: ContextAssemblyRequest,
    options?: AssembleSessionContextOptions,
  ): ContextPackage;
  executeOperation<TResult = unknown>(
    operationId: string,
    input: unknown,
    options?: ExecuteOperationOptions,
  ): Promise<TResult>;
  resolve<TResult extends JsonValue = JsonValue>(
    request: ResolutionRequest,
    options?: ExecuteOperationOptions,
  ): Promise<ResolutionEnvelope<TResult>>;
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
  let eventSequence = persisted.eventSequence;

  async function commitCandidate(
    candidate: WorldState,
    events: readonly CanonicalEvent[] = [],
  ): Promise<void> {
    validateWorldState(candidate);
    const nextSequence = eventSequence + events.length;
    const committed = await dependencies.persistence.worlds.commit({
      worldId: persisted.metadata.id,
      expectedRevision: revision,
      updatedAt: dependencies.wallClock.now(),
      state: candidate,
      events,
      eventSequence: nextSequence,
    });
    state = clone(committed.state);
    revision = committed.revision;
    eventSequence = committed.eventSequence;
  }

  async function applyOutcome(
    candidate: WorldState,
    outcome: OperationResult<unknown>,
    options?: ExecuteOperationOptions,
  ): Promise<CanonicalEvent[]> {
    applyMutations(candidate, outcome.proposedMutations);
    candidate.fictionalTime = advanceFictionalInstant(
      candidate.fictionalTime,
      outcome.advanceTimeByMs,
    );
    const canonicalEvents: CanonicalEvent[] = [];
    for (const event of outcome.proposedEvents) {
      const definition = dependencies.game.eventTypeRegistry.resolve(
        event.type,
        event.schemaVersion,
      );
      const causedByEventIds = [
        ...new Set([
          ...(options?.causedByEventIds ?? []),
          ...event.causedByEventIds,
        ]),
      ];
      for (const causeId of causedByEventIds) {
        const earlierInBatch = canonicalEvents.some(
          (candidateEvent) => candidateEvent.id === causeId,
        );
        if (
          !earlierInBatch &&
          !(await dependencies.persistence.history.get(
            persisted.metadata.id,
            causeId,
          ))
        ) {
          throw new PersistenceNotFoundError(
            `Event cause not found: ${causeId}`,
          );
        }
      }
      const canonicalEvent = canonicalEventSchema.parse({
        id: dependencies.idGenerator.next("event"),
        type: event.type,
        schemaVersion: event.schemaVersion,
        sourceComponent: definition.sourceComponent,
        occurredAt: candidate.fictionalTime,
        sequence: eventSequence + canonicalEvents.length + 1,
        summary: event.summary,
        relatedEntityIds: [...event.relatedEntityIds],
        scopeIds: [...event.scopeIds],
        causedByEventIds,
        ...(event.origin ?? options?.origin
          ? { origin: clone(event.origin ?? options!.origin!) }
          : {}),
        payload: dependencies.game.eventTypeRegistry.validatePayload(
          event.type,
          event.schemaVersion,
          event.payload,
        ),
        access: event.access,
      });
      canonicalEvents.push(canonicalEvent);
    }
    return canonicalEvents;
  }

  return {
    worldId: persisted.metadata.id,
    snapshot() {
      return clone(state);
    },
    async applyActionPressureAssessment(assessment) {
      const parsed = actionPressureAssessmentSchema.parse(assessment);
      const candidate = clone(state);
      candidate.actionPressure = {
        status: "assessed",
        level: parsed.level,
      };
      await commitCandidate(candidate);
      return clone(state.actionPressure);
    },
    async advanceTime(durationMs) {
      const duration = fictionalDurationMs(durationMs);
      if (duration === 0) return clone(state);
      const candidate = clone(state);
      candidate.fictionalTime = advanceFictionalInstant(
        candidate.fictionalTime,
        duration,
      );
      await commitCandidate(candidate);
      return clone(state);
    },
    async setSimulationCursor(scopeId, lastSimulatedAt) {
      const candidate = clone(state);
      const normalized = fictionalInstant(lastSimulatedAt);
      const index = candidate.simulationCursors.findIndex(
        (cursor) => cursor.scopeId === scopeId,
      );
      const cursor = { scopeId, lastSimulatedAt: normalized };
      if (index === -1) candidate.simulationCursors.push(cursor);
      else candidate.simulationCursors[index] = cursor;
      await commitCandidate(candidate);
      return clone(state);
    },
    async scheduleTrigger(trigger) {
      const simulationSources = [
        state.game.ruleset,
        state.game.setting,
        state.game.adapter,
        state.game.campaign,
      ];
      const sourceIsActive = simulationSources.some(
        (component) =>
          component.id === trigger.sourceComponent.id &&
          component.version === trigger.sourceComponent.version,
      );
      if (!sourceIsActive) {
        throw new Error(
          `Scheduled trigger source is not an active simulation component: ${trigger.sourceComponent.id}@${trigger.sourceComponent.version}`,
        );
      }
      const scheduled = scheduledTriggerSchema.parse({
        ...trigger,
        id: dependencies.idGenerator.next("scheduled-trigger"),
      });
      const candidate = clone(state);
      candidate.scheduledTriggers.push(scheduled);
      await commitCandidate(candidate);
      return clone(scheduled);
    },
    eventHistory(query) {
      return dependencies.persistence.history.query(persisted.metadata.id, query);
    },
    assembleContext(request, options = {}) {
      return assembleContext({
        game: dependencies.game,
        world: state,
        worldRevision: revision,
        eventSequence,
        request,
        ...(dependencies.context?.sceneSource
          ? { sceneSource: dependencies.context.sceneSource }
          : {}),
        ...(options.retrieved ? { retrieved: options.retrieved } : {}),
        ...(options.toolPolicy ? { toolPolicy: options.toolPolicy } : {}),
      });
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
        { world: candidate },
        input,
      );
      const canonicalEvents = await applyOutcome(candidate, outcome, options);
      await commitCandidate(candidate, canonicalEvents);
      return outcome.result;
    },
    async resolve<TResult extends JsonValue>(
      request: ResolutionRequest,
      options?: ExecuteOperationOptions,
    ): Promise<ResolutionEnvelope<TResult>> {
      const parsedRequest = resolutionRequestSchema.parse(request);
      const candidate = clone(state);
      const assessment = assessResolutionOperation<
        JsonValue,
        JsonValue,
        TResult
      >(
        dependencies.game.operationRegistry,
        parsedRequest.operation.id,
        candidate,
        parsedRequest.intent,
        parsedRequest.operation.input,
      );

      const randomness = createLazyRandomnessStream(candidate.randomness);
      const outcome = assessment.path === "uncertain"
        ? resolveUncertainOperation<JsonValue, TResult>(
            dependencies.game.operationRegistry,
            parsedRequest.operation.id,
            candidate,
            assessment.prepared,
            randomness.random,
          )
        : assessment.outcome;

      if (
        outcome.advanceTimeByMs > parsedRequest.intent.authorizedHorizonMs
      ) {
        throw new ResolutionValidationError(
          `Resolution duration ${outcome.advanceTimeByMs}ms exceeds authorized horizon ${parsedRequest.intent.authorizedHorizonMs}ms`,
        );
      }

      const canonicalEvents = await applyOutcome(candidate, outcome, options);
      const randomnessTrace = randomness.trace();
      if (randomnessTrace) {
        candidate.randomness = randomnessStateSchema.parse({
          ...candidate.randomness,
          nextStream: candidate.randomness.nextStream + 1,
        });
      }
      const operation = dependencies.game.operationRegistry.get(
        parsedRequest.operation.id,
      );
      const envelope = createResolutionEnvelopeSchema(
        operation.outputSchema,
        operation.metadata.id,
      ).parse({
        intent: clone(parsedRequest.intent),
        operationId: parsedRequest.operation.id,
        path: assessment.path,
        basis: clone(assessment.basis),
        result: clone(outcome.result),
        advanceTimeByMs: outcome.advanceTimeByMs,
        randomness: randomnessTrace ? clone(randomnessTrace) : null,
        events: clone(canonicalEvents),
      }) as ResolutionEnvelope<TResult>;

      await commitCandidate(candidate, canonicalEvents);
      return envelope;
    },
    async save(slotName) {
      const timestamp = dependencies.wallClock.now();
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
        eventSequence,
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
      const timestamp = dependencies.wallClock.now();
      const id = dependencies.idGenerator.next("world");
      const state = initializeCampaignWorld(
        dependencies.game,
        dependencies.worldSeedSource.nextSeed(),
      );
      const initialEvents = initializeCampaignHistory(dependencies.game);
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
        initialEvents,
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
