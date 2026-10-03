import {
  actionPressureAssessmentSchema,
  boundInterpretedIntent,
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
import { jsonValueSchema } from "./json.js";
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
  createContextQueryExecutionOptions,
  queryAuthorizationFromContext,
  renderContextForModel,
  type SceneSourceProvider,
} from "./context.js";
import type {
  ContextAssemblyRequest,
  ContextItem,
  ContextPackage,
} from "./context-contracts.js";
import type { ToolAvailabilityPolicy } from "./tool-catalog.js";
import {
  createResolutionRequestFromBinding,
  executeEngineQueryTool,
} from "./tool-catalog.js";
import type {
  ModelRuntime,
  ModelFailure,
  ModelResultMetadata,
} from "./model-runtime.js";
import {
  actionRunSchema,
  executionDecisionSchema,
  intentInterpretationDecisionSchema,
  playerActionRequestSchema,
  type ActionRun,
  type CommittedOperationReceipt,
  type ExecutionDecision,
  type PlayerActionRequest,
  type PlayerActionResult,
  type PlayerActionTraceEntry,
} from "./player-action-contracts.js";

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

export interface PerformPlayerActionOptions {
  readonly modelRuntime: ModelRuntime;
  readonly maxModelTurns?: number;
  readonly toolPolicy?: ToolAvailabilityPolicy;
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
  performPlayerAction(
    request: PlayerActionRequest,
    options: PerformPlayerActionOptions,
  ): Promise<PlayerActionResult>;
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

function replaceLocalReferences(
  value: JsonValue,
  references: Readonly<Record<string, string>>,
): JsonValue {
  if (typeof value === "string") {
    if (references[value]) return references[value];
    if (value.startsWith("scene.")) {
      throw new Error(`Unknown or stale context-local reference: ${value}`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceLocalReferences(item, references));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      replaceLocalReferences(item, references),
    ]));
  }
  return value;
}

function injectActor(value: JsonValue, actorId: string): JsonValue {
  if (!value || Array.isArray(value) || typeof value !== "object") return value;
  return { ...value, actorId };
}

function rejectModelAuthoredCanonicalEntityIds(
  value: JsonValue,
  entityIds: ReadonlySet<string>,
): void {
  if (typeof value === "string") {
    if (entityIds.has(value)) {
      throw new Error("Model-authored tool arguments must use current context-local entity references");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) rejectModelAuthoredCanonicalEntityIds(item, entityIds);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      rejectModelAuthoredCanonicalEntityIds(item, entityIds);
    }
  }
}

async function structuredModelDecision<T>(
  modelRuntime: ModelRuntime,
  schemaId: string,
  schema: import("zod").ZodType<T>,
  prompt: { instructions: string[]; context?: string; input: string },
): Promise<
  | { ok: true; value: T; attempts: number; metadata: ModelResultMetadata }
  | { ok: false; failure: ModelFailure; attempts: number }
> {
  let currentPrompt = prompt;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await modelRuntime.generate({
      prompt: currentPrompt,
      output: { kind: "structured", schemaId, schema },
      trace: { operation: schemaId },
    });
    if (result.ok) {
      return {
        ok: true,
        value: result.output.value,
        attempts: attempt,
        metadata: result.metadata,
      };
    }
    if (result.error.kind !== "invalid-output" || attempt === 2) {
      return { ok: false, failure: result, attempts: attempt };
    }
    currentPrompt = {
      ...prompt,
      instructions: [
        ...prompt.instructions,
        "Your previous response did not satisfy the required schema. Return exactly one valid structured decision.",
      ],
    };
  }
  throw new Error("Unreachable structured model retry state");
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
    actionRun?: ActionRun,
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
      ...(actionRun ? { actionRun } : {}),
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
    async performPlayerAction(rawRequest, options) {
      const request = playerActionRequestSchema.parse(rawRequest);
      const trace: PlayerActionTraceEntry[] = [];
      const record = (
        phase: PlayerActionTraceEntry["phase"],
        detail: JsonValue,
        extras: Partial<Pick<PlayerActionTraceEntry, "attempt" | "worldRevision">> = {},
      ) => trace.push({ phase, detail, ...extras });
      const resultTrace = () => ({ entries: clone(trace) });
      const currentPersisted = async () =>
        dependencies.persistence.worlds.load(persisted.metadata.id);
      const fail = (
        kind: "model" | "proposal" | "idempotency" | "external-revision" | "turn-limit" | "persistence",
        message: string,
        run?: ActionRun,
        modelFailure?: ModelFailure,
      ): PlayerActionResult => ({
        kind: "failed",
        actionId: request.actionId,
        failure: { kind, message, ...(modelFailure ? { modelFailure } : {}) },
        ...(run ? { run: clone(run) } : {}),
        trace: resultTrace(),
      });
      const identityMatches = (run: ActionRun) =>
        run.actorId === request.actorId && run.declaration === request.declaration;

      if (!state.entities.some((entity) => entity.id === request.actorId)) {
        record("rejection", { reason: "player-action-actor-not-found" });
        return fail("proposal", `Player action actor not found: ${request.actorId}`);
      }

      let run = await dependencies.persistence.actionRuns.load(
        persisted.metadata.id,
        request.actionId,
      );
      if (run && !identityMatches(run)) {
        record("rejection", { reason: "action-id-identity-conflict" });
        return fail(
          "idempotency",
          `Action ID ${request.actionId} is already bound to a different actor or declaration`,
          run,
        );
      }

      const orchestratorRequest = {
        role: "orchestrator" as const,
        perspective: { kind: "canonical" as const },
        focalActorId: request.actorId,
        ...(request.locationId ? { locationId: request.locationId } : {}),
        declaration: request.declaration,
        budget: request.budget,
      };
      let retrieved: ContextItem[] = [];

      if (!run) {
        const context = assembleContext({
          game: dependencies.game,
          world: state,
          worldRevision: revision,
          eventSequence,
          request: orchestratorRequest,
          ...(dependencies.context?.sceneSource
            ? { sceneSource: dependencies.context.sceneSource }
            : {}),
          ...(options.toolPolicy ? { toolPolicy: options.toolPolicy } : {}),
        });
        record("context", { stage: "interpretation", usedUnits: context.diagnostics.usedUnits }, { worldRevision: revision });
        const decision = await structuredModelDecision(
          options.modelRuntime,
          "player-action.intent-interpretation.v1",
          intentInterpretationDecisionSchema,
          {
            instructions: [
              "Interpret the player's declaration once. Do not plan an operation chain.",
              "Use only context-local scene references for targets. Assess current action pressure from 1 (low) to 9 (immediate).",
              "If a material player choice is missing, request that choice instead of guessing.",
            ],
            context: renderContextForModel(context),
            input: request.declaration,
          },
        );
        record("model", {
          stage: "interpretation",
          ok: decision.ok,
          attempts: decision.attempts,
          ...(decision.ok
            ? { metadata: jsonValueSchema.parse(clone(decision.metadata)) }
            : { failure: jsonValueSchema.parse(clone(decision.failure)) }),
        });
        if (!decision.ok) {
          return fail("model", decision.failure.error.message, undefined, decision.failure);
        }
        if (decision.value.kind === "player-decision-required") {
          record("stop", { reason: "player-decision-required" });
          return {
            kind: "needs-player-input",
            actionId: request.actionId,
            question: decision.value.question,
            trace: resultTrace(),
          };
        }
        let targetIds: string[];
        try {
          targetIds = decision.value.targetRefs.map((reference) => {
            const id = context.diagnostics.localReferences[reference];
            if (!id) throw new Error(`Unknown or stale target reference: ${reference}`);
            return id;
          });
        } catch (error) {
          record("rejection", { reason: error instanceof Error ? error.message : "Invalid target reference" });
          return fail("proposal", error instanceof Error ? error.message : "Invalid target reference");
        }
        const interpretedIntent = {
          actorId: request.actorId,
          goal: decision.value.goal,
          targetIds,
          requestedHorizonMs: fictionalDurationMs(decision.value.requestedHorizonMs),
        };
        const candidate = clone(state);
        candidate.actionPressure = { status: "assessed", level: decision.value.pressureLevel };
        const executableIntent = boundInterpretedIntent(
          interpretedIntent,
          candidate.actionPressure,
        );
        const newRun = actionRunSchema.parse({
          schemaVersion: 1,
          id: request.actionId,
          worldId: persisted.metadata.id,
          actorId: request.actorId,
          declaration: request.declaration,
          interpretedIntent,
          executableIntent,
          status: "active",
          elapsedMs: 0,
          lastWorldRevision: revision + 1,
          receipts: [],
        });
        try {
          await commitCandidate(candidate, [], newRun);
          run = newRun;
          record("pressure", { level: decision.value.pressureLevel }, { worldRevision: revision });
          record("intent", {
            goal: executableIntent.goal,
            requestedHorizonMs: executableIntent.requestedHorizonMs,
            authorizedHorizonMs: executableIntent.authorizedHorizonMs,
            wasNarrowed: executableIntent.wasNarrowed,
          }, { worldRevision: revision });
        } catch (error) {
          return fail("persistence", error instanceof Error ? error.message : "Could not persist action run");
        }
      }

      const makeDevelopmentSignal = (completed: ActionRun) => ({
        kind: "player-action-resolved" as const,
        actionId: completed.id,
        actorId: completed.actorId,
        goal: completed.executableIntent.goal,
        stopReason: completed.stopReason!,
        elapsedMs: completed.elapsedMs,
        operationIds: completed.receipts.map((receipt) => receipt.toolId),
        eventIds: completed.receipts.flatMap((receipt) => receipt.events.map((event) => event.id)),
        finalWorldRevision: completed.lastWorldRevision,
      });

      const narrate = async (completed: ActionRun): Promise<PlayerActionResult> => {
        if (completed.narration) {
          record("narration", { ok: true, reused: true });
          return {
            kind: "resolved",
            run: clone(completed),
            narration: completed.narration,
            developmentSignal: makeDevelopmentSignal(completed),
            trace: resultTrace(),
          };
        }
        const actorContext = assembleContext({
          game: dependencies.game,
          world: state,
          worldRevision: revision,
          eventSequence,
          request: {
            role: "actor",
            perspective: { kind: "actor", id: completed.actorId },
            focalActorId: completed.actorId,
            ...(request.locationId ? { locationId: request.locationId } : {}),
            declaration: completed.declaration,
            budget: request.budget,
          },
          ...(dependencies.context?.sceneSource
            ? { sceneSource: dependencies.context.sceneSource }
            : {}),
        });
        const outcomes = completed.receipts.map((receipt) => ({
          elapsedMs: receipt.advanceTimeByMs,
          publicEvents: receipt.events
            .filter((event) => event.access === "public")
            .map((event) => ({ type: event.type, summary: event.summary })),
        }));
        const narrationResult = await options.modelRuntime.generate({
          prompt: {
            instructions: [
              `Narrate only what the focal actor can perceive. Style: ${dependencies.game.presentation.narrationStyle}`,
              "Do not reveal canonical IDs, hidden state, rejected proposals, private events, mechanics not exposed by the presentation, or GM reasoning.",
              "Do not invent additional world changes. The supplied committed outcomes are authoritative.",
            ],
            context: renderContextForModel(actorContext),
            input: JSON.stringify({
              declaration: completed.declaration,
              goal: completed.executableIntent.goal,
              elapsedMs: completed.elapsedMs,
              stopReason: completed.stopReason,
              committedActorVisibleOutcomes: outcomes,
            }),
          },
          output: { kind: "text" },
          trace: { operation: "player-action.narration.v1" },
        });
        if (!narrationResult.ok) {
          record("narration", {
            ok: false,
            failure: jsonValueSchema.parse(clone(narrationResult)),
          });
          return {
            kind: "resolved",
            run: clone(completed),
            narrationFailure: narrationResult,
            developmentSignal: makeDevelopmentSignal(completed),
            trace: resultTrace(),
          };
        }
        completed = actionRunSchema.parse({ ...completed, narration: narrationResult.output.text });
        await dependencies.persistence.actionRuns.update(completed);
        record("narration", {
          ok: true,
          metadata: jsonValueSchema.parse(clone(narrationResult.metadata)),
        });
        return {
          kind: "resolved",
          run: clone(completed),
          narration: completed.narration,
          developmentSignal: makeDevelopmentSignal(completed),
          trace: resultTrace(),
        };
      };

      if (run.status === "stopped") return narrate(run);

      const maxTurns = options.maxModelTurns ?? 24;
      for (let turn = 1; turn <= maxTurns; turn += 1) {
        const persistedWorld = await currentPersisted();
        if (!persistedWorld || persistedWorld.revision !== revision || run.lastWorldRevision !== revision) {
          run = actionRunSchema.parse({
            ...run,
            status: "stopped",
            stopReason: "pressure-reassessment-required",
          });
          await dependencies.persistence.actionRuns.update(run);
          record("stop", { reason: "external-world-revision" }, { worldRevision: persistedWorld?.revision });
          return fail("external-revision", "World revision changed outside this action run", run);
        }
        if (run.elapsedMs >= run.executableIntent.authorizedHorizonMs) {
          run = actionRunSchema.parse({
            ...run,
            status: "stopped",
            stopReason: "budget-exhausted",
          });
          await dependencies.persistence.actionRuns.update(run);
          record("stop", { reason: "budget-exhausted" }, { worldRevision: revision });
          return narrate(run);
        }
        const contextRequest = {
          ...orchestratorRequest,
          executableIntent: run.executableIntent,
        };
        const context = assembleContext({
          game: dependencies.game,
          world: state,
          worldRevision: revision,
          eventSequence,
          request: contextRequest,
          ...(dependencies.context?.sceneSource
            ? { sceneSource: dependencies.context.sceneSource }
            : {}),
          ...(retrieved.length ? { retrieved } : {}),
          ...(options.toolPolicy ? { toolPolicy: options.toolPolicy } : {}),
        });
        record("context", { stage: "execution", turn, usedUnits: context.diagnostics.usedUnits }, { worldRevision: revision });
        const decisionResult = await structuredModelDecision(
          options.modelRuntime,
          "player-action.execution-decision.v1",
          executionDecisionSchema,
          {
            instructions: [
              "Choose exactly one next action: discover subsystems/tools, inspect a tool, invoke one tool, or stop.",
              "Do not produce an execution plan. Tool invocations must use context-local scene references; the engine injects the actor and bounded intent.",
              `The action has ${Math.max(0, run.executableIntent.authorizedHorizonMs - run.elapsedMs)}ms of authorized fictional time remaining.`,
            ],
            context: renderContextForModel(context),
            input: JSON.stringify({
              declaration: run.declaration,
              goal: run.executableIntent.goal,
              elapsedMs: run.elapsedMs,
              committedReceipts: run.receipts.map((receipt) => {
                const reverse = new Map(
                  Object.entries(context.diagnostics.localReferences)
                    .map(([local, canonical]) => [canonical, local]),
                );
                const entityIds = new Set(state.entities.map((entity) => entity.id));
                const project = (value: JsonValue): JsonValue => {
                  if (typeof value === "string" && entityIds.has(value)) {
                    return reverse.get(value) ?? "unavailable-reference";
                  }
                  if (Array.isArray(value)) return value.map(project);
                  if (value && typeof value === "object") {
                    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, project(item)]));
                  }
                  return value;
                };
                return {
                  sequence: receipt.sequence,
                  toolId: receipt.toolId,
                  result: project(receipt.result),
                  advanceTimeByMs: receipt.advanceTimeByMs,
                  eventSummaries: receipt.events.map((event) => event.summary),
                };
              }),
            }),
          },
        );
        record("model", {
          stage: "execution",
          turn,
          ok: decisionResult.ok,
          attempts: decisionResult.attempts,
          ...(decisionResult.ok
            ? { metadata: jsonValueSchema.parse(clone(decisionResult.metadata)) }
            : { failure: jsonValueSchema.parse(clone(decisionResult.failure)) }),
        });
        if (!decisionResult.ok) {
          return fail("model", decisionResult.failure.error.message, run, decisionResult.failure);
        }
        const decision: ExecutionDecision = decisionResult.value;
        if (decision.kind === "stop") {
          run = actionRunSchema.parse({ ...run, status: "stopped", stopReason: decision.reason });
          await dependencies.persistence.actionRuns.update(run);
          record("stop", { reason: decision.reason }, { worldRevision: revision });
          return narrate(run);
        }

        let catalogContent: JsonValue | undefined;
        try {
          if (decision.kind === "discover-subsystems") {
            catalogContent = dependencies.game.toolCatalog.listSubsystems(
              decision.domainId,
              options.toolPolicy,
            ) as unknown as JsonValue;
          } else if (decision.kind === "discover-tools") {
            catalogContent = dependencies.game.toolCatalog.listTools(
              decision.domainId,
              decision.subsystemId,
              options.toolPolicy,
            ) as unknown as JsonValue;
          } else if (decision.kind === "inspect-tool") {
            catalogContent = dependencies.game.toolCatalog.inspectTool(
              decision.toolId,
              options.toolPolicy,
            ) as unknown as JsonValue;
          }
        } catch (error) {
          catalogContent = { error: error instanceof Error ? error.message : "Catalog request failed" };
        }
        if (catalogContent !== undefined) {
          retrieved.push({
            localId: `tool-result.${turn}`,
            kind: "tool-catalog-result",
            salience: "retrieved",
            content: jsonValueSchema.parse(catalogContent),
            provenance: {
              sourceKind: "tool-catalog",
              sourceIds: [decision.kind === "inspect-tool" ? decision.toolId : "tool-catalog"],
            },
            access: {
              audience: ["orchestrator"],
              perspective: { kind: "canonical" },
              actorAware: false,
              identityRecognized: true,
              privileged: true,
            },
            derivation: "raw",
            relevance: 100,
          });
          record("catalog", { decision: decision.kind, result: catalogContent }, { worldRevision: revision });
          continue;
        }

        if (decision.kind !== "invoke-tool") {
          record("rejection", { reason: "Catalog decision produced no result" });
          continue;
        }

        let argumentsValue: JsonValue;
        try {
          const binding = dependencies.game.toolCatalog.resolveBinding(
            decision.toolId,
            options.toolPolicy,
          );
          rejectModelAuthoredCanonicalEntityIds(
            decision.arguments,
            new Set(state.entities.map((entity) => entity.id)),
          );
          argumentsValue = replaceLocalReferences(
            decision.arguments,
            context.diagnostics.localReferences,
          );
          if (binding.kind !== "engine-query") {
            argumentsValue = injectActor(argumentsValue, run.actorId);
          }
          if (binding.kind === "engine-query") {
            const queryOptions = dependencies.context?.sceneSource
              ? createContextQueryExecutionOptions({
                  context,
                  request: contextRequest,
                  world: state,
                  sceneSource: dependencies.context.sceneSource,
                })
              : {
                  authorization: queryAuthorizationFromContext(context),
                  localReferences: context.diagnostics.localReferences,
                  localDisplays: Object.fromEntries(context.situation.scene.map((item) => [item.localRef, item.displayIdentity])),
                };
            const output = await executeEngineQueryTool(
              binding,
              state,
              argumentsValue,
              {
                ...queryOptions,
                worldId: persisted.metadata.id,
                history: dependencies.persistence.history,
              },
            );
            retrieved.push({
              localId: `tool-result.${turn}`,
              kind: "engine-query-result",
              salience: "retrieved",
              content: output,
              provenance: { sourceKind: "tool-result", sourceIds: [decision.toolId], worldRevision: revision },
              access: {
                audience: ["orchestrator"],
                perspective: { kind: "canonical" },
                actorAware: false,
                identityRecognized: true,
                privileged: true,
              },
              derivation: "raw",
              relevance: 100,
            });
            record("query", { toolId: decision.toolId, output }, { worldRevision: revision });
            continue;
          }

          const sequence = run.receipts.length + 1;
          const stepId = `${run.id}.step.${sequence}`;
          const existing = run.receipts.find((receipt) => receipt.sequence === sequence);
          if (existing) {
            if (existing.stepId !== stepId || existing.toolId !== decision.toolId || JSON.stringify(existing.input) !== JSON.stringify(argumentsValue)) {
              throw new Error(`Idempotency conflict for action step ${sequence}`);
            }
            record("commit", { replayed: true, stepId }, { worldRevision: revision });
            continue;
          }

          const candidate = clone(state);
          let outcome: OperationResult<unknown>;
          let resolution: CommittedOperationReceipt["resolution"];
          if (binding.kind === "ordinary-operation") {
            const validatedInput = binding.inputSchema.parse(argumentsValue);
            argumentsValue = jsonValueSchema.parse(validatedInput);
            outcome = executeRulesOperation(
              dependencies.game.operationRegistry,
              binding.operationId,
              { world: candidate },
              validatedInput,
            );
          } else {
            const remaining = Math.max(0, run.executableIntent.authorizedHorizonMs - run.elapsedMs);
            const invocationIntent = {
              ...run.executableIntent,
              authorizedHorizonMs: fictionalDurationMs(remaining),
            };
            const resolutionRequest = createResolutionRequestFromBinding(binding, {
              intent: invocationIntent,
              input: argumentsValue,
            });
            argumentsValue = jsonValueSchema.parse(resolutionRequest.operation.input);
            const assessment = assessResolutionOperation<JsonValue, JsonValue, JsonValue>(
              dependencies.game.operationRegistry,
              resolutionRequest.operation.id,
              candidate,
              resolutionRequest.intent,
              resolutionRequest.operation.input,
            );
            const randomness = createLazyRandomnessStream(candidate.randomness);
            outcome = assessment.path === "uncertain"
              ? resolveUncertainOperation(
                  dependencies.game.operationRegistry,
                  resolutionRequest.operation.id,
                  candidate,
                  assessment.prepared,
                  randomness.random,
                )
              : assessment.outcome;
            const randomnessTrace = randomness.trace();
            if (randomnessTrace) {
              candidate.randomness = randomnessStateSchema.parse({
                ...candidate.randomness,
                nextStream: candidate.randomness.nextStream + 1,
              });
            }
            resolution = {
              path: assessment.path,
              basis: jsonValueSchema.parse(clone(assessment.basis)),
              randomness: randomnessTrace ? clone(randomnessTrace) : null,
            };
          }
          const remaining = run.executableIntent.authorizedHorizonMs - run.elapsedMs;
          if (outcome.advanceTimeByMs > remaining) {
            throw new ResolutionValidationError(
              `Operation duration ${outcome.advanceTimeByMs}ms exceeds remaining authorized horizon ${remaining}ms`,
            );
          }
          const canonicalEvents = await applyOutcome(candidate, outcome, {
            origin: { kind: "player-action", id: run.id },
          });
          const contract = dependencies.game.toolCatalog.inspectTool(decision.toolId, options.toolPolicy);
          const receipt: CommittedOperationReceipt = {
            stepId,
            sequence,
            toolId: decision.toolId,
            kind: binding.kind,
            sourceComponent: contract.sourceComponent,
            input: argumentsValue,
            result: jsonValueSchema.parse(clone(outcome.result)),
            advanceTimeByMs: outcome.advanceTimeByMs,
            mutations: outcome.proposedMutations.map((mutation) => clone(mutation)),
            events: clone(canonicalEvents),
            ...(resolution ? { resolution } : {}),
            worldRevisionBefore: revision,
            worldRevisionAfter: revision + 1,
          };
          const updatedRun = actionRunSchema.parse({
            ...run,
            elapsedMs: run.elapsedMs + outcome.advanceTimeByMs,
            lastWorldRevision: revision + 1,
            receipts: [...run.receipts, receipt],
          });
          record("proposal", { toolId: decision.toolId, sequence, durationMs: outcome.advanceTimeByMs }, { worldRevision: revision });
          try {
            await commitCandidate(candidate, canonicalEvents, updatedRun);
          } catch (error) {
            record("rejection", {
              toolId: decision.toolId,
              phase: "persistence",
              message: error instanceof Error ? error.message : "Authoritative commit failed",
            }, { worldRevision: revision });
            return fail(
              "persistence",
              error instanceof Error ? error.message : "Authoritative commit failed",
              run,
            );
          }
          run = updatedRun;
          record("commit", {
            receipt,
            elapsedMs: run.elapsedMs,
            remainingHorizonMs: run.executableIntent.authorizedHorizonMs - run.elapsedMs,
          }, { worldRevision: revision });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Tool proposal failed";
          record("rejection", { toolId: decision.toolId, message }, { worldRevision: revision });
          retrieved.push({
            localId: `tool-result.${turn}`,
            kind: "tool-rejection",
            salience: "retrieved",
            content: { toolId: decision.toolId, error: message },
            provenance: { sourceKind: "tool-result", sourceIds: [decision.toolId], worldRevision: revision },
            access: {
              audience: ["orchestrator"],
              perspective: { kind: "canonical" },
              actorAware: false,
              identityRecognized: true,
              privileged: true,
            },
            derivation: "raw",
            relevance: 100,
          });
        }
      }

      run = actionRunSchema.parse({ ...run, status: "stopped", stopReason: "budget-exhausted" });
      await dependencies.persistence.actionRuns.update(run);
      record("stop", { reason: "model-turn-limit", maxTurns }, { worldRevision: revision });
      return fail("turn-limit", `Player action exceeded ${maxTurns} model turns`, run);
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
