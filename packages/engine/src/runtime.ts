import { z } from "zod";
import {
  actionPressureAssessmentSchema,
  boundInterpretedIntent,
  intentStopReasonSchema,
  type ActionPressureAssessment,
  type ActionPressureState,
} from "./action-pressure.js";
import {
  canonicalEventSchema,
  type CanonicalEvent,
  type EventOrigin,
  type EventQuery,
} from "./events.js";
import type { LoadedGameDefinition, PresentationConfig } from "./contracts.js";
import {
  applyMutationProposals,
  assessResolutionOperation,
  executeRulesOperation,
  resolveUncertainOperation,
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
  compareFictionalInstants,
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
  SimulationBudgetExceededError,
  SimulationValidationError,
  executeWorldProcess,
  selectWorldProcessState,
  type CatchUpScopeRequest,
  type CatchUpScopeResult,
  type EventInterestDefinition,
  type RegisteredWorldProcess,
  type SimulationScopeDefinition,
  type WorldProcessExecutionDiagnostic,
} from "./simulation.js";
import {
  assembleContext,
  createContextQueryExecutionOptions,
  queryAuthorizationFromContext,
  prepareModelBrief,
  resolveBriefReference,
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
  interpretedIntentDecisionSchema,
  intentInterpretationDecisionSchema,
  playerActionRequestSchema,
  type ActionRun,
  type CommittedOperationReceipt,
  type ExecutionDecision,
  type PlayerActionRequest,
  type PlayerActionResult,
  type PlayerActionTraceEntry,
} from "./player-action-contracts.js";
import {
  campaignPlanDocumentSchema,
  type CampaignPlanDocument,
} from "./campaign-planning.js";
import { compileNarrationDirective, deriveSceneRegister } from "./presentation.js";
import {
  NARRATION_CHARACTER_TARGETS,
  narrationPreferenceSchema,
  type NarrationPreference,
} from "./conversation-contracts.js";
import type { SemanticActionMode } from "./semantic-action.js";

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
  readonly narrationPreference?: NarrationPreference;
  readonly onProgress?: (
    phase: "understanding" | "resolving" | "presenting",
  ) => void;
}

export interface GameSession {
  readonly worldId: string;
  presentation(): PresentationConfig;
  snapshot(): WorldState;
  planningBasis(): { readonly worldRevision: number; readonly eventSequence: number };
  campaignPlan(): Promise<CampaignPlanDocument | undefined>;
  initializeCampaignPlan(plan: CampaignPlanDocument): Promise<CampaignPlanDocument>;
  commitCampaignPlan(
    expectedPlanRevision: number,
    plan: CampaignPlanDocument,
  ): Promise<CampaignPlanDocument>;
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
  catchUpScope(request: CatchUpScopeRequest): Promise<CatchUpScopeResult>;
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

function clampOperationDurationFields(
  value: JsonValue,
  remainingMs: number,
): { readonly value: JsonValue; readonly clampedKeys: readonly string[] } {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return { value, clampedKeys: [] };
  }
  const durationKeys = new Set([
    "durationMs",
    "travelDurationMs",
  ]);
  const clampedKeys: string[] = [];
  const next = Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (durationKeys.has(key) && typeof item === "number" && item > remainingMs) {
      clampedKeys.push(key);
      return [key, remainingMs];
    }
    return [key, item];
  }));
  return { value: jsonValueSchema.parse(next), clampedKeys };
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

function constrainedExecutionDecisionSchema(
  candidateIds: readonly string[],
  singleCandidateArgumentSchema?: z.ZodType<unknown>,
) {
  if (candidateIds.length === 0) return executionDecisionSchema;
  const toolIdSchema = candidateIds.length === 1
    ? z.literal(candidateIds[0]!)
    : z.enum(candidateIds as [string, ...string[]]);
  return z.discriminatedUnion("kind", [
    candidateIds.length === 1
      ? z.object({
          kind: z.literal("invoke-tool"),
          toolId: toolIdSchema,
          arguments: singleCandidateArgumentSchema ?? jsonValueSchema,
        }).strict()
      : z.object({
          kind: z.literal("invoke-tool"),
          toolId: toolIdSchema,
        }),
    z.object({ kind: z.literal("stop"), reason: intentStopReasonSchema }).strict(),
  ]);
}

function modelOperationInputSchema(schema: z.ZodType<unknown>): z.ZodType<unknown> {
  if (!(schema instanceof z.ZodObject) || !("actorId" in schema.shape)) return schema;
  const { actorId: _actorId, ...modelShape } = schema.shape;
  return z.object(modelShape).strict();
}

const completedModesStopDecisionSchema = z.object({
  kind: z.literal("stop"),
  reason: intentStopReasonSchema,
}).strict();

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

function declarationCommitsToAction(declaration: string): boolean {
  const trimmed = declaration.trim();
  const asksPlayerFacingQuestion = /^(?:what|where|when|who|why|how|should|could|can|would|may|do|does|did|is|are|am)(?:\s|$)/i
    .test(trimmed);
  const expressesUncertainty = /\b(?:i|we)\s+(?:(?:do not|don't|cannot|can't)\s+know|(?:am|are)\s+(?:unsure|uncertain)|wonder(?:ing)?\b)/i
    .test(trimmed);
  if (asksPlayerFacingQuestion || expressesUncertainty) return false;
  if (/\b(?:i|we)\s+[a-z][a-z'-]*\b/i.test(trimmed)) return true;
  return [
    /\b(?:i|we)\s+(?:decide|choose|intend|plan)\s+to\b/i,
    /\b(?:i|we)\s+(?:want|would like)\s+to\b/i,
    /\b(?:i'd|we'd)\s+like\s+to\b/i,
    /\b(?:i|we)\s+(?:(?:just|carefully|quickly|quietly|immediately|now)\s+){0,2}(?:go|head|walk|run|travel|move|enter|leave|approach|return|start|begin|fix|repair|tighten|adjust|install|remove|use|work|attempt|open|take|grab|pick|check|look|inspect|examine|search|find|investigate|observe|ask|tell|say|announce|speak)\b/i,
    /\b(?:i(?:'m| am)|we(?:'re| are))\s+(?:(?:just|carefully|quickly|quietly|immediately|now)\s+){0,2}(?:going|heading|walking|running|traveling|moving|entering|leaving|approaching|returning|starting|beginning|fixing|repairing|tightening|adjusting|installing|removing|using|working|attempting|opening|taking|grabbing|picking|checking|looking|inspecting|examining|searching|finding|investigating|observing|asking|telling|saying|announcing|speaking)\b/i,
  ].some((pattern) => pattern.test(declaration));
}

function clarificationDelegatesWorldOutcome(question: string): boolean {
  return [
    /\bwhat\s+(?:specific\s+)?(?:response|reaction|action|result|effect|change|sound|sight)\b/i,
    /\bwhat\s+(?:do|does|did|would)\s+(?:you\s+)?observe\b/i,
    /\bwhat\s+happens?\b/i,
    /\bhow\s+(?:do|does|did|would)\s+(?:the\s+)?(?:npc|creature|target|environment|world|it|they|he|she)\s+(?:respond|react|behave|change)\b/i,
    /\bdescribe\s+(?:what|how)\s+(?:the\s+)?(?:npc|creature|target|environment|world|it|they|he|she)\b/i,
    /\bwhat\s+(?:do|does|did|would)\s+(?:the\s+)?(?:npc|creature|target|environment|world|it|they|he|she)\s+do\b/i,
  ].some((pattern) => pattern.test(question));
}

function inferredDeclaredActionModes(declaration: string): SemanticActionMode[] {
  const inferred = new Set<SemanticActionMode>();
  if (/\b(?:go|goes|going|head|heads|heading|walk|walks|walking|run|runs|running|travel|travels|traveling|move|moves|moving|enter|enters|entering|leave|leaves|leaving|approach|approaches|approaching|return|returns|returning)\b/i.test(declaration)) {
    inferred.add("movement");
  }
  if (/\b(?:fix|fixes|fixing|repair|repairs|repairing|tighten|tightens|tightening|adjust|adjusts|adjusting|install|installs|installing|remove|removes|removing|use|uses|using|work|works|working|open|opens|opening|take|takes|taking|grab|grabs|grabbing|pick|picks|picking|build|builds|building)\b/i.test(declaration)) {
    inferred.add("manipulation");
  }
  if (/\b(?:look|looks|looking|inspect|inspects|inspecting|examine|examines|examining|search|searches|searching|find|finds|finding|check|checks|checking|investigate|investigates|investigating|observe|observes|observing|shine|shines|shining|illuminate|illuminates|illuminating|light|lights|lighting)\b/i.test(declaration)) {
    inferred.add("observation");
  }
  if (/\b(?:ask|asks|asking|call|calls|calling|greet|greets|greeting|tell|tells|telling|say|says|saying|announce|announces|announcing|speak|speaks|speaking|talk|talks|talking)\b/i.test(declaration)) {
    inferred.add("communication");
    inferred.add("interaction");
  }
  if (/\b(?:attack|attacks|attacking|strike|strikes|striking|shoot|shoots|shooting|fight|fights|fighting)\b/i.test(declaration)) {
    inferred.add("attack");
  }
  return [...inferred];
}

function declarationExplicitlyTargetsSelf(declaration: string): boolean {
  return /\b(?:myself|ourselves|on me|on us|my own body|our own bodies)\b/i.test(declaration);
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
    priorBatch: readonly CanonicalEvent[] = [],
  ): Promise<CanonicalEvent[]> {
    applyMutationProposals(candidate, outcome.proposedMutations);
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
        const earlierInBatch = [...priorBatch, ...canonicalEvents].some(
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
        sequence: eventSequence + priorBatch.length + canonicalEvents.length + 1,
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

  function eventMatchesInterest(
    event: CanonicalEvent,
    interest: EventInterestDefinition,
    scopeId: string,
  ): boolean {
    if (interest.types && !interest.types.includes(event.type)) return false;
    if (interest.currentScope && !event.scopeIds.includes(scopeId)) return false;
    if (interest.scopeId && !event.scopeIds.includes(interest.scopeId)) return false;
    if (
      interest.relatedEntityId &&
      !event.relatedEntityIds.includes(interest.relatedEntityId)
    ) return false;
    if (interest.originKind && event.origin?.kind !== interest.originKind) return false;
    if (interest.originId && event.origin?.id !== interest.originId) return false;
    if (interest.access && !interest.access.includes(event.access)) return false;
    return true;
  }

  async function queryRelevantEvents(
    process: RegisteredWorldProcess,
    scope: SimulationScopeDefinition,
    from: FictionalInstant,
    to: FictionalInstant,
    priorBatch: readonly CanonicalEvent[],
  ): Promise<CanonicalEvent[]> {
    const byId = new Map<string, CanonicalEvent>();
    for (const interest of process.metadata.eventInterests) {
      let cursor: EventQuery["cursor"];
      while (true) {
        const page = await dependencies.persistence.history.query(
          persisted.metadata.id,
          {
            from,
            to,
            ...(interest.types ? { types: interest.types } : {}),
            ...(interest.currentScope
              ? { scopeId: scope.id }
              : interest.scopeId
                ? { scopeId: interest.scopeId }
                : {}),
            ...(interest.relatedEntityId
              ? { relatedEntityId: interest.relatedEntityId }
              : {}),
            ...(interest.originKind ? { originKind: interest.originKind } : {}),
            ...(interest.originId ? { originId: interest.originId } : {}),
            ...(interest.access ? { access: interest.access } : {}),
            direction: "ascending",
            limit: 1000,
            ...(cursor ? { cursor } : {}),
          },
        );
        for (const event of page) {
          if (
            compareFictionalInstants(event.occurredAt, from) > 0 &&
            compareFictionalInstants(event.occurredAt, to) <= 0 &&
            eventMatchesInterest(event, interest, scope.id)
          ) {
            byId.set(event.id, clone(event));
          }
        }
        if (page.length < 1000) break;
        const last = page.at(-1)!;
        cursor = { occurredAt: last.occurredAt, sequence: last.sequence };
      }
      for (const event of priorBatch) {
        if (eventMatchesInterest(event, interest, scope.id)) {
          byId.set(event.id, clone(event));
        }
      }
    }
    return [...byId.values()].sort((left, right) =>
      compareFictionalInstants(left.occurredAt, right.occurredAt) ||
      left.sequence - right.sequence
    );
  }

  function requireUniqueIds(label: string, ids: readonly string[]): void {
    if (new Set(ids).size !== ids.length) {
      throw new SimulationValidationError(`${label} contains duplicate IDs`);
    }
  }

  return {
    worldId: persisted.metadata.id,
    presentation() {
      return dependencies.game.presentation;
    },
    snapshot() {
      return clone(state);
    },
    planningBasis() {
      return { worldRevision: revision, eventSequence };
    },
    campaignPlan() {
      return dependencies.persistence.planner.load(persisted.metadata.id);
    },
    initializeCampaignPlan(planValue) {
      const plan = campaignPlanDocumentSchema.parse(planValue);
      return dependencies.persistence.planner.initialize({
        worldId: persisted.metadata.id,
        expectedWorldRevision: revision,
        expectedEventSequence: eventSequence,
        plan,
      });
    },
    commitCampaignPlan(expectedPlanRevision, planValue) {
      const plan = campaignPlanDocumentSchema.parse(planValue);
      return dependencies.persistence.planner.commit({
        worldId: persisted.metadata.id,
        expectedPlanRevision,
        expectedWorldRevision: revision,
        expectedEventSequence: eventSequence,
        plan,
      });
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
      if (dependencies.game.worldSimulationRegistry.listScopes().length > 0) {
        dependencies.game.worldSimulationRegistry.getScope(scopeId);
        throw new SimulationValidationError(
          "Registered simulation cursors advance only through catch-up",
        );
      }
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
      if (dependencies.game.worldSimulationRegistry.listScopes().length > 0) {
        if (trigger.scopeIds.length === 0) {
          throw new SimulationValidationError(
            "Scheduled simulation work requires at least one registered scope",
          );
        }
        for (const scopeId of trigger.scopeIds) {
          const scope = dependencies.game.worldSimulationRegistry.getScope(scopeId);
          if (!dependencies.game.worldSimulationRegistry.scheduledHandler(
            scope.kind,
            trigger.type,
          )) {
            throw new SimulationValidationError(
              `No world process handles scheduled trigger ${trigger.type} in ${scope.kind}`,
            );
          }
        }
      }
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
    async catchUpScope(rawRequest) {
      const request: CatchUpScopeRequest = {
        scopeId: rawRequest.scopeId,
        ...(rawRequest.targetTime ? { targetTime: fictionalInstant(rawRequest.targetTime) } : {}),
        ...(rawRequest.maxWorkUnits !== undefined
          ? { maxWorkUnits: rawRequest.maxWorkUnits }
          : {}),
      };
      const registry = dependencies.game.worldSimulationRegistry;
      registry.getScope(request.scopeId);
      const targetTime = request.targetTime ?? state.fictionalTime;
      if (compareFictionalInstants(targetTime, state.fictionalTime) > 0) {
        throw new SimulationValidationError(
          "Catch-up target cannot be later than current fictional world time",
        );
      }
      const targetCursor = state.simulationCursors.find(
        (cursor) => cursor.scopeId === request.scopeId,
      );
      if (!targetCursor) {
        throw new SimulationValidationError(
          `Missing simulation cursor for scope ${request.scopeId}`,
        );
      }
      if (compareFictionalInstants(targetCursor.lastSimulatedAt, targetTime) > 0) {
        throw new SimulationValidationError(
          `Simulation cursor for ${request.scopeId} is later than the catch-up target`,
        );
      }
      if (targetCursor.lastSimulatedAt === targetTime) {
        return {
          kind: "no-op" as const,
          requestedScopeId: request.scopeId,
          targetTime,
          originalCursor: targetCursor.lastSimulatedAt,
          finalCursor: targetCursor.lastSimulatedAt,
          reason: "already-current" as const,
          awakenedScopeIds: [] as const,
          scopeOrder: [] as const,
          processOrder: [] as const,
          relevantEventIds: [] as const,
          processedScheduledTriggerIds: [] as const,
          canonicalEventIds: [] as const,
          randomness: [] as const,
          processOutcomes: [] as const,
        };
      }

      const maximumWorkUnits = request.maxWorkUnits ?? 1000;
      if (!Number.isSafeInteger(maximumWorkUnits) || maximumWorkUnits <= 0) {
        throw new SimulationValidationError(
          "Catch-up work budget must be a positive safe integer",
        );
      }
      const closure = registry.dependencyClosure(request.scopeId);
      const cursorByScope = new Map(
        state.simulationCursors.map((cursor) => [cursor.scopeId, cursor]),
      );
      for (const scope of closure) {
        const cursor = cursorByScope.get(scope.id);
        if (!cursor) {
          throw new SimulationValidationError(
            `Missing simulation cursor for scope ${scope.id}`,
          );
        }
        if (compareFictionalInstants(cursor.lastSimulatedAt, targetTime) > 0) {
          throw new SimulationValidationError(
            `Simulation cursor for ${scope.id} is later than the catch-up target`,
          );
        }
      }
      const awakened = closure.filter((scope) =>
        cursorByScope.get(scope.id)!.lastSimulatedAt !== targetTime
      );
      const candidate = clone(state);
      const canonicalEvents: CanonicalEvent[] = [];
      const processOutcomes: WorldProcessExecutionDiagnostic[] = [];
      const relevantEventIds = new Set<string>();
      const processedScheduledTriggerIds = new Set<string>();
      const randomness: NonNullable<WorldProcessExecutionDiagnostic["randomness"]>[] = [];
      const processOrder: string[] = [];
      let workUnitsUsed = 0;

      for (const scope of awakened) {
        const cursor = candidate.simulationCursors.find(
          (item) => item.scopeId === scope.id,
        )!;
        const from = cursor.lastSimulatedAt;
        const elapsedDurationMs = fictionalDurationMs(
          Date.parse(targetTime) - Date.parse(from),
        );
        const processes = registry.listProcesses(scope.kind);
        const dueForScope = candidate.scheduledTriggers
          .filter((trigger) =>
            trigger.scopeIds.includes(scope.id) &&
            compareFictionalInstants(trigger.dueAt, from) > 0 &&
            compareFictionalInstants(trigger.dueAt, targetTime) <= 0
          )
          .sort((left, right) =>
            compareFictionalInstants(left.dueAt, right.dueAt) ||
            left.id.localeCompare(right.id)
          );
        const dueByProcess = new Map<string, ScheduledTrigger[]>();
        for (const trigger of dueForScope) {
          const handler = registry.scheduledHandler(scope.kind, trigger.type);
          if (!handler) {
            throw new SimulationValidationError(
              `No world process handles due trigger ${trigger.type} in ${scope.kind}`,
            );
          }
          const existing = dueByProcess.get(handler.metadata.id) ?? [];
          existing.push(trigger);
          dueByProcess.set(handler.metadata.id, existing);
        }

        for (const process of processes) {
          if (workUnitsUsed >= maximumWorkUnits) {
            throw new SimulationBudgetExceededError(
              `Catch-up exceeded its ${maximumWorkUnits}-unit work budget`,
            );
          }
          const relevantEvents = await queryRelevantEvents(
            process,
            scope,
            from,
            targetTime,
            canonicalEvents,
          );
          for (const event of relevantEvents) relevantEventIds.add(event.id);
          const dueScheduledWork = (dueByProcess.get(process.metadata.id) ?? [])
            .filter((trigger) => candidate.scheduledTriggers.some(
              (current) => current.id === trigger.id,
            ));
          const selectedState = selectWorldProcessState(process, candidate, scope.id);
          const lazyRandomness = process.metadata.kind === "stochastic"
            ? createLazyRandomnessStream(candidate.randomness)
            : undefined;
          const outcome = executeWorldProcess(
            process,
            {
              scopeId: scope.id,
              from,
              to: targetTime,
              elapsedDurationMs,
              relevantState: selectedState,
              relevantEvents,
              dueScheduledWork,
              remainingWorkUnits: maximumWorkUnits - workUnitsUsed,
            },
            lazyRandomness?.random,
          );
          const cost = outcome.workUnits + 1;
          if (cost > maximumWorkUnits - workUnitsUsed) {
            throw new SimulationBudgetExceededError(
              `World process ${process.metadata.id} exceeded the remaining catch-up work budget`,
            );
          }
          workUnitsUsed += cost;
          requireUniqueIds(
            `Processed scheduled work from ${process.metadata.id}`,
            outcome.processedScheduledTriggerIds,
          );
          requireUniqueIds(
            `Scheduled cancellations from ${process.metadata.id}`,
            outcome.cancelScheduledTriggerIds,
          );
          const expectedProcessed = dueScheduledWork.map((trigger) => trigger.id).sort();
          const actualProcessed = [...outcome.processedScheduledTriggerIds].sort();
          if (JSON.stringify(expectedProcessed) !== JSON.stringify(actualProcessed)) {
            throw new SimulationValidationError(
              `World process ${process.metadata.id} must process every due trigger assigned to it exactly once`,
            );
          }
          const cancellationSet = new Set(outcome.cancelScheduledTriggerIds);
          for (const triggerId of cancellationSet) {
            if (!candidate.scheduledTriggers.some((trigger) => trigger.id === triggerId)) {
              throw new SimulationValidationError(
                `World process ${process.metadata.id} cancels unknown scheduled trigger ${triggerId}`,
              );
            }
          }

          const newCanonicalEvents = await applyOutcome(
            candidate,
            {
              result: null,
              advanceTimeByMs: fictionalDurationMs(0),
              proposedMutations: outcome.mutations,
              proposedEvents: outcome.events,
            },
            { origin: { kind: "world-process", id: process.metadata.id } },
            canonicalEvents,
          );
          canonicalEvents.push(...newCanonicalEvents);

          const removedIds = new Set([
            ...outcome.processedScheduledTriggerIds,
            ...outcome.cancelScheduledTriggerIds,
          ]);
          candidate.scheduledTriggers = candidate.scheduledTriggers.filter(
            (trigger) => !removedIds.has(trigger.id),
          );
          for (const triggerId of outcome.processedScheduledTriggerIds) {
            processedScheduledTriggerIds.add(triggerId);
          }
          const scheduledTriggerIdsAdded: string[] = [];
          for (const proposal of outcome.schedule) {
            if (compareFictionalInstants(proposal.dueAt, targetTime) <= 0) {
              throw new SimulationValidationError(
                `World process ${process.metadata.id} scheduled work that is already due`,
              );
            }
            for (const scheduledScopeId of proposal.scopeIds) {
              const scheduledScope = registry.getScope(scheduledScopeId);
              if (!registry.scheduledHandler(scheduledScope.kind, proposal.type)) {
                throw new SimulationValidationError(
                  `No world process handles scheduled trigger ${proposal.type} in ${scheduledScope.kind}`,
                );
              }
            }
            const scheduled = scheduledTriggerSchema.parse({
              ...proposal,
              id: dependencies.idGenerator.next("scheduled-trigger"),
              sourceComponent: process.sourceComponent,
            });
            candidate.scheduledTriggers.push(scheduled);
            scheduledTriggerIdsAdded.push(scheduled.id);
          }
          const randomnessTrace = lazyRandomness?.trace() ?? null;
          if (randomnessTrace) {
            candidate.randomness = randomnessStateSchema.parse({
              ...candidate.randomness,
              nextStream: candidate.randomness.nextStream + 1,
            });
            randomness.push(clone(randomnessTrace));
          }
          processOrder.push(`${scope.id}:${process.metadata.id}`);
          processOutcomes.push({
            scopeId: scope.id,
            processId: process.metadata.id,
            sourceComponent: clone(process.sourceComponent),
            from,
            to: targetTime,
            elapsedDurationMs,
            workUnits: cost,
            relevantEventIds: relevantEvents.map((event) => event.id),
            scheduledTriggerIds: dueScheduledWork.map((trigger) => trigger.id),
            mutations: clone(outcome.mutations),
            proposedEvents: clone(outcome.events),
            canonicalEventIds: newCanonicalEvents.map((event) => event.id),
            processedScheduledTriggerIds: clone(outcome.processedScheduledTriggerIds),
            cancelledScheduledTriggerIds: clone(outcome.cancelScheduledTriggerIds),
            scheduledTriggerIdsAdded,
            randomness: randomnessTrace ? clone(randomnessTrace) : null,
            diagnostics: clone(outcome.diagnostics),
          });
        }
        cursor.lastSimulatedAt = targetTime;
      }

      validateWorldState(candidate);
      const revisionBefore = revision;
      await commitCandidate(candidate, canonicalEvents);
      return {
        kind: "caught-up" as const,
        requestedScopeId: request.scopeId,
        targetTime,
        originalCursor: targetCursor.lastSimulatedAt,
        finalCursor: targetTime,
        awakenedScopeIds: awakened.map((scope) => scope.id),
        scopeOrder: awakened.map((scope) => scope.id),
        processOrder,
        relevantEventIds: [...relevantEventIds].sort(),
        processedScheduledTriggerIds: [...processedScheduledTriggerIds].sort(),
        canonicalEventIds: canonicalEvents.map((event) => event.id),
        randomness,
        processOutcomes,
        workUnitsUsed,
        worldRevisionBefore: revisionBefore,
        worldRevisionAfter: revision,
      };
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
      const reportProgress = (
        phase: "understanding" | "resolving" | "presenting",
      ) => {
        try {
          options.onProgress?.(phase);
        } catch {
          // Progress is a non-authoritative observer and cannot interrupt a turn.
        }
      };
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
      const narrationRetry = run?.status === "stopped" && !run.narration;
      if (run && !identityMatches(run)) {
        record("rejection", { reason: "action-id-identity-conflict" });
        return fail(
          "idempotency",
          `Action ID ${request.actionId} is already bound to a different actor or declaration`,
          run,
        );
      }

      const actorModelRequest = {
        role: "actor" as const,
        perspective: { kind: "actor" as const, id: request.actorId },
        focalActorId: request.actorId,
        ...(request.locationId ? { locationId: request.locationId } : {}),
        declaration: request.declaration,
        budget: request.budget,
      };
      let retrieved: ContextItem[] = [];

      if (!run) {
        reportProgress("understanding");
        const context = assembleContext({
          game: dependencies.game,
          world: state,
          worldRevision: revision,
          eventSequence,
          request: actorModelRequest,
          ...(dependencies.context?.sceneSource
            ? { sceneSource: dependencies.context.sceneSource }
            : {}),
          ...(options.toolPolicy ? { toolPolicy: options.toolPolicy } : {}),
        });
        const interpretationBrief = prepareModelBrief({
          purpose: "action-interpretation",
          perspective: { kind: "actor", id: request.actorId },
          context,
        });
        record("context", {
          stage: "interpretation",
          projector: interpretationBrief.diagnostics.projector,
          serializedCharacters: interpretationBrief.diagnostics.serializedCharacters,
          requiredOverflow: interpretationBrief.diagnostics.requiredOverflow,
          usedUnits: context.diagnostics.usedUnits,
        }, { worldRevision: revision });
        let decision = await structuredModelDecision(
          options.modelRuntime,
          "player-action.intent-interpretation.v1",
          intentInterpretationDecisionSchema,
          {
            instructions: [
              "Interpret the player's declaration once. Do not plan an operation chain.",
              "Use only context-local scene references for targets. Assess current action pressure from 1 (low) to 9 (immediate).",
              "The focal actor reference identifies who is acting, not the target. Never return it as a target unless the declaration explicitly targets the actor themself.",
              "Include every applicable action mode. A declaration that moves to a place and then performs a task normally has both movement and task modes.",
              "Treat omitted implementation details as intentionally delegated to the game. Infer the smallest reasonable detail from the declaration and current fiction; do not ask the player to specify a room, object instance, route, tool, order, or method they did not care to specify.",
              "Request a player choice only when proceeding would materially replace the player's intent, usually because the declared action is impossible as stated and multiple genuinely different alternatives require the player's choice. A stated investigation is actionable: begin with the most relevant reasonable observation.",
              "Never ask the player to author an external outcome, sensory result, NPC response, creature reaction, or environmental change. Determining what the world does in response is the game engine's job.",
              "Never ask for confirmation, permission to begin, preferred ordering, preparation, or a choice whose answer the player already stated. Honor explicit sequencing words such as first, now, before, and then.",
            ],
            context: interpretationBrief.modelText,
            input: request.declaration,
          },
        );
        let rejectedClarification: string | undefined;
        let interpretationAttempts = decision.attempts;
        if (
          decision.ok &&
          decision.value.kind === "player-decision-required" &&
          (
            declarationCommitsToAction(request.declaration) ||
            clarificationDelegatesWorldOutcome(decision.value.question)
          )
        ) {
          rejectedClarification = decision.value.question;
          const forced = await structuredModelDecision(
            options.modelRuntime,
            "player-action.intent-interpretation.v1",
            interpretedIntentDecisionSchema,
            {
              instructions: [
                "The player has already committed to a concrete action. Interpret it as executable now.",
                "Do not ask a question and do not substitute an alternative action. Honor the named target, stated order, and stated means.",
                "If a minor implementation detail is unstated, choose the smallest reasonable first step from the authorized scene context.",
                "Assume omitted detail was intentionally delegated. Never ask the player to choose a room, object instance, route, tool, order, or method unless proceeding would materially replace their declared intent.",
                "Never ask the player to author an external outcome, sensory result, NPC response, creature reaction, or environmental change. Interpret the declared attempt; the rules and simulation determine the response.",
                "Use only context-local scene references for targets and assess current action pressure from 1 (low) to 9 (immediate).",
                "The focal actor reference identifies who is acting, not the target. Never return it as a target unless the declaration explicitly targets the actor themself.",
                "Include every applicable action mode. A declaration that moves to a place and then performs a task normally has both movement and task modes.",
              ],
              context: interpretationBrief.modelText,
              input: JSON.stringify({
                declaration: request.declaration,
                rejectedClarification,
              }),
            },
          );
          interpretationAttempts += forced.attempts;
          decision = forced;
        }
        record("model", {
          stage: "interpretation",
          ok: decision.ok,
          attempts: interpretationAttempts,
          ...(rejectedClarification
            ? { rejectedClarification, forcedExecutableInterpretation: true }
            : {}),
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
        const interpretedDecision = interpretedIntentDecisionSchema.parse(decision.value);
        let targetIds: string[];
        try {
          targetIds = interpretedDecision.targetRefs.map((reference) => {
            return resolveBriefReference(
              interpretationBrief, reference,
              { worldRevision: revision, eventSequence },
            );
          });
        } catch (error) {
          record("rejection", { reason: error instanceof Error ? error.message : "Invalid target reference" });
          return fail("proposal", error instanceof Error ? error.message : "Invalid target reference");
        }
        if (!declarationExplicitlyTargetsSelf(request.declaration)) {
          const withoutActor = targetIds.filter((id) => id !== request.actorId);
          if (withoutActor.length !== targetIds.length) {
            record("rejection", {
              reason: "acting-actor-removed-from-targets",
              removedTargetId: request.actorId,
            });
            targetIds = withoutActor;
          }
        }
        const inferredModes = inferredDeclaredActionModes(request.declaration);
        const normalizedModes = [
          ...new Set<SemanticActionMode>([
            ...interpretedDecision.modes,
            ...inferredModes,
          ]),
        ].filter((mode) => mode !== "other" || interpretedDecision.modes.length + inferredModes.length === 1);
        if (
          normalizedModes.length !== interpretedDecision.modes.length ||
          normalizedModes.some((mode, index) => mode !== interpretedDecision.modes[index])
        ) {
          record("intent", {
            normalization: "semantic-action-modes",
            modelModes: interpretedDecision.modes,
            inferredModes,
            normalizedModes,
          });
        }
        const interpretedIntent = {
          actorId: request.actorId,
          goal: interpretedDecision.goal,
          targetIds,
          requestedHorizonMs: fictionalDurationMs(interpretedDecision.requestedHorizonMs),
        };
        const candidate = clone(state);
        candidate.actionPressure = { status: "assessed", level: interpretedDecision.pressureLevel };
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
          semanticAction: {
            modes: normalizedModes,
            statedMeans: interpretedDecision.statedMeans,
          },
          executableIntent,
          status: "active",
          elapsedMs: 0,
          lastWorldRevision: revision + 1,
          receipts: [],
        });
        try {
          await commitCandidate(candidate, [], newRun);
          run = newRun;
          record("pressure", { level: interpretedDecision.pressureLevel }, { worldRevision: revision });
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
        if (completed.receipts.length === 0) {
          record("rejection", { reason: "narration-requires-committed-outcome" });
          return fail(
            "proposal",
            "The action produced no committed outcome, so narration was withheld",
            completed,
          );
        }
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
        const narrationBrief = prepareModelBrief({
          purpose: "narration",
          perspective: { kind: "actor", id: completed.actorId },
          context: actorContext,
          requiredEntityIds: completed.executableIntent.targetIds,
          committedOutcomes: outcomes.flatMap((outcome) =>
            outcome.publicEvents.map((event) => event.summary)),
        });
        const narrationKind = completed.executableIntent.pressureLevel >= 7
          ? "immediate-danger"
          : completed.elapsedMs >= 10 * 60 * 1_000
            ? "compressed-duration"
            : completed.semanticAction?.modes.some((mode) =>
                mode === "movement" || mode === "observation"
              )
              ? "exploration"
              : "action";
        const directive = compileNarrationDirective(
          dependencies.game.presentation.narrationProfile,
          deriveSceneRegister({
            kind: narrationKind,
            actionPressure: completed.executableIntent.pressureLevel,
            authorizedHorizonMs: completed.executableIntent.authorizedHorizonMs,
            elapsedMs: completed.elapsedMs,
          }),
        );
        const narrationPreference = narrationPreferenceSchema.parse(
          options.narrationPreference ?? "standard",
        );
        const narrationBand = directive.sceneRegister.pacing === "immediate"
          ? "small"
          : directive.sceneRegister.pacing === "compressed"
            ? "large"
            : "medium";
        const [minimumCharacters, maximumCharacters] =
          NARRATION_CHARACTER_TARGETS[narrationPreference][narrationBand];
        reportProgress("presenting");
        record("narration", {
          stage: "prepared",
          presentationComponent: dependencies.game.presentation.identity,
          profile: dependencies.game.presentation.narrationProfile.identity,
          protectedGuidanceIncluded: true,
          compiledProfileSize: directive.compiledProfileSize,
          selectedExemplarIds: [...directive.selectedExemplarIds],
          sceneRegister: directive.sceneRegister,
          narrationPreference,
          targetBand: narrationBand,
          targetCharacters: { minimum: minimumCharacters, maximum: maximumCharacters },
          sourceCategories: ["actor-visible-context", "committed-outcomes", "player-declaration"],
          briefCharacters: narrationBrief.diagnostics.serializedCharacters,
          briefOverflow: narrationBrief.diagnostics.requiredOverflow,
          contextOmissions: actorContext.diagnostics.decisions
            .filter((decision) => decision.decision !== "included")
            .map((decision) => ({
              localId: decision.localId,
              decision: decision.decision,
              reason: decision.reason,
            })),
          presentationKind: narrationRetry ? "retry" : "action",
        });
        const narrationResult = await options.modelRuntime.generate({
          prompt: {
            protectedContext: [directive.protectedContext],
            instructions: [
              "Narrate only what the focal actor can perceive.",
              "Do not reveal canonical IDs, hidden state, rejected proposals, private events, mechanics not exposed by the presentation, or GM reasoning.",
              "Do not invent additional world changes. The supplied committed outcomes are authoritative.",
              "Do not invent player thoughts, feelings, dialogue, decisions, or voluntary actions beyond the submitted declaration.",
              "Do not invent specific tools, equipment, actionable objects, routes, hazards, witnesses, resources, or clues. Harmless transient color must not create a future affordance.",
              "Use second person for the focal actor. If the committed outcomes are sparse, be concise instead of padding with invented attempts, complications, or details.",
              `Aim for at most ${maximumCharacters} characters (${narrationPreference}/${narrationBand}). The nominal ${minimumCharacters}-character lower bound is optional when the authoritative outcomes do not support that much detail.`,
            ],
            context: narrationBrief.modelText,
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

      const maxTurns = options.maxModelTurns ?? (
        run.semanticAction && dependencies.game.toolCatalog.listActionCandidates(
          run.semanticAction.modes,
          options.toolPolicy,
        ).length > 0
          ? 6
          : 24
      );
      reportProgress("resolving");
      let rejectedPrematureStops = 0;
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
          ...actorModelRequest,
          executableIntent: run.executableIntent,
        };
        const coveredModes = new Set<SemanticActionMode>();
        for (const receipt of run.receipts) {
          const applicability = dependencies.game.operationRegistry.get(receipt.toolId)
            .metadata.applicability;
          for (const mode of applicability?.actionModes ?? []) coveredModes.add(mode);
        }
        const supportedModes = new Set<SemanticActionMode>(
          dependencies.game.operationRegistry.listAll().flatMap((operation) =>
            operation.applicability?.actionModes ?? []
          ),
        );
        const pendingDeclaredModes = (run.semanticAction?.modes ?? [])
          .filter((mode) =>
            mode !== "other" && supportedModes.has(mode) && !coveredModes.has(mode)
          );
        const hasTrackableDeclaredModes = (run.semanticAction?.modes ?? []).some((mode) =>
          mode !== "other" && supportedModes.has(mode)
        );
        let candidates = run.semanticAction
          ? dependencies.game.toolCatalog.listActionCandidates(
              run.semanticAction.modes,
              options.toolPolicy,
            ).filter((candidate) => {
              if (run!.receipts.length === 0 || !hasTrackableDeclaredModes) return true;
              const modes = dependencies.game.operationRegistry.get(candidate.id)
                .metadata.applicability?.actionModes ?? [];
              return modes.some((mode) => pendingDeclaredModes.includes(mode));
            })
          : [];
        const explicitlyRoutine = run.executableIntent.pressureLevel <= 4 &&
          /\b(?:quick|simple|routine|straightforward|easy|ordinary)\b/i.test(run.declaration);
        const routineCandidate = candidates.find((candidate) => {
          const metadata = dependencies.game.operationRegistry.get(candidate.id).metadata;
          const modes = new Set(metadata.applicability?.actionModes ?? []);
          return metadata.category.tags.includes("routine") &&
            pendingDeclaredModes.every((mode) => modes.has(mode));
        });
        if (explicitlyRoutine && routineCandidate) {
          const beforeIds = candidates.map((candidate) => candidate.id);
          candidates = candidates.filter((candidate) =>
            dependencies.game.operationRegistry.get(candidate.id).metadata.kind !== "resolution"
          );
          const afterIds = candidates.map((candidate) => candidate.id);
          if (afterIds.length !== beforeIds.length) {
            record("catalog", {
              stage: "routine-task-fast-path",
              routineCandidateId: routineCandidate.id,
              removedCandidateIds: beforeIds.filter((id) => !afterIds.includes(id)),
            }, { worldRevision: revision });
          }
        }
        const modelCandidates = candidates.map(({ outputSchema: _outputSchema, ...candidate }) =>
          candidate
        );
        const requireStopDecision = run.receipts.length > 0 &&
          hasTrackableDeclaredModes && pendingDeclaredModes.length === 0;
        const candidateIds = new Set(candidates.map((candidate) => candidate.id));
        if (candidates.length) {
          record("catalog", {
            stage: "deterministic-candidate-selection",
            modes: run.semanticAction!.modes,
            candidateIds: [...candidateIds],
          }, { worldRevision: revision });
        }
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
        const executionBrief = prepareModelBrief({
          purpose: "operation-selection",
          perspective: { kind: "actor", id: run.actorId },
          context,
          requiredEntityIds: run.executableIntent.targetIds,
        });
        record("context", {
          stage: "execution",
          turn,
          projector: executionBrief.diagnostics.projector,
          serializedCharacters: executionBrief.diagnostics.serializedCharacters,
          requiredOverflow: executionBrief.diagnostics.requiredOverflow,
          usedUnits: context.diagnostics.usedUnits,
        }, { worldRevision: revision });
        const singleCandidateArgumentSchema = candidates.length === 1
          ? modelOperationInputSchema(
              dependencies.game.operationRegistry.get(candidates[0]!.id).inputSchema,
            )
          : undefined;
        const decisionSchema = requireStopDecision
          ? completedModesStopDecisionSchema
          : constrainedExecutionDecisionSchema(
              [...candidateIds],
              singleCandidateArgumentSchema,
            );
        const decisionResult = await structuredModelDecision<unknown>(
          options.modelRuntime,
          "player-action.execution-decision.v1",
          decisionSchema as z.ZodType<unknown>,
          {
            instructions: [
              ...(requireStopDecision
                ? ["Every supported mode in the declared action has a committed outcome. Stop now with the reason that best matches those outcomes."]
                : candidates.length
                ? candidates.length === 1
                  ? [
                    "The engine has selected the only applicable capability. Supply its model-safe arguments, or stop if the goal is already complete.",
                    "You may not discover catalog entries, inspect tools, or choose another tool.",
                  ]
                  : [
                    "Choose exactly one next action: invoke one supplied candidate or stop.",
                    "You may not discover catalog entries, inspect tools, or choose a tool outside the supplied candidates.",
                  ]
                : ["Choose exactly one next action: discover subsystems/tools, inspect a tool, invoke one tool, or stop."]),
              "Do not produce an execution plan. Tool invocations must use context-local scene references; the engine injects the actor and bounded intent.",
              "Do not stop for player input during execution. The interpretation stage has already established an executable intent.",
              ...(run.receipts.length === 0
                ? ["No outcome has been committed yet. Invoke an applicable capability before stopping."]
                : []),
              ...(pendingDeclaredModes.length > 0
                ? [`The declared action still has unresolved modes: ${pendingDeclaredModes.join(", ")}. Do not claim the goal is achieved until each is covered by a committed capability.`]
                : []),
              `The action has ${Math.max(0, run.executableIntent.authorizedHorizonMs - run.elapsedMs)}ms of authorized fictional time remaining.`,
            ],
            context: executionBrief.modelText,
            input: JSON.stringify({
              declaration: run.declaration,
              goal: run.executableIntent.goal,
              semanticAction: run.semanticAction,
              ...(!requireStopDecision && modelCandidates.length
                ? {
                    candidates: candidates.length > 1
                      ? modelCandidates.map(({ inputSchema: _inputSchema, ...candidate }) =>
                          candidate
                        )
                      : modelCandidates,
                  }
                : {}),
              elapsedMs: run.elapsedMs,
              ...(rejectedPrematureStops > 0 ? { rejectedPrematureStops } : {}),
              coveredDeclaredModes: [...coveredModes],
              pendingDeclaredModes,
              committedReceipts: run.receipts.map((receipt) => {
                const reverse = new Map(
                  Object.entries(executionBrief.localReferences)
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
                  // Numerical receipt internals and non-public events stay engine-only.
                  advanceTimeByMs: receipt.advanceTimeByMs,
                  eventSummaries: receipt.events
                    .filter((event) => event.access === "public")
                    .map((event) => project(event.summary)),
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
        let decision = decisionResult.value as
          | ExecutionDecision
          | { readonly kind: "invoke-tool"; readonly toolId: string };
        if (decision.kind === "stop") {
          if (
            decision.reason === "player-decision-required" ||
            run.receipts.length === 0 ||
            (decision.reason === "goal-achieved" && pendingDeclaredModes.length > 0)
          ) {
            rejectedPrematureStops += 1;
            record("rejection", {
              reason: decision.reason === "player-decision-required"
                ? "execution-cannot-request-player-decision"
                : decision.reason === "goal-achieved" && pendingDeclaredModes.length > 0
                  ? "goal-achieved-before-declared-modes-resolved"
                : "stop-requires-committed-outcome",
              proposedStopReason: decision.reason,
              ...(pendingDeclaredModes.length > 0 ? { pendingDeclaredModes } : {}),
              rejectedPrematureStops,
            }, { worldRevision: revision });
            continue;
          }
          run = actionRunSchema.parse({ ...run, status: "stopped", stopReason: decision.reason });
          await dependencies.persistence.actionRuns.update(run);
          record("stop", { reason: decision.reason }, { worldRevision: revision });
          return narrate(run);
        }

        if (decision.kind === "invoke-tool" && !("arguments" in decision)) {
          const selectedToolId = decision.toolId;
          const operation = dependencies.game.operationRegistry.get(selectedToolId);
          const argumentResult = await structuredModelDecision(
            options.modelRuntime,
            "player-action.tool-arguments.v1",
            modelOperationInputSchema(operation.inputSchema),
            {
              instructions: [
                `Supply arguments for the already-selected capability ${selectedToolId}.`,
                "Use only context-local scene references for entities. The engine injects the acting actor and the bounded intent.",
                "Return only arguments that satisfy the capability input schema; do not reconsider the tool choice or narrate.",
                "Any action summary must restate only the submitted declaration and goal. Do not add later movement, an exit, dialogue, thoughts, failed attempts, or undeclared equipment.",
              ],
              context: executionBrief.modelText,
              input: JSON.stringify({
                declaration: run.declaration,
                goal: run.executableIntent.goal,
                selectedCapability: {
                  id: selectedToolId,
                  description: candidates.find((candidate) =>
                    candidate.id === selectedToolId
                  )?.description,
                },
                elapsedMs: run.elapsedMs,
                remainingAuthorizedTimeMs: Math.max(
                  0,
                  run.executableIntent.authorizedHorizonMs - run.elapsedMs,
                ),
              }),
            },
          );
          record("model", {
            stage: "execution-arguments",
            turn,
            toolId: selectedToolId,
            ok: argumentResult.ok,
            attempts: argumentResult.attempts,
            ...(argumentResult.ok
              ? { metadata: jsonValueSchema.parse(clone(argumentResult.metadata)) }
              : { failure: jsonValueSchema.parse(clone(argumentResult.failure)) }),
          });
          if (!argumentResult.ok) {
            return fail("model", argumentResult.failure.error.message, run, argumentResult.failure);
          }
          decision = {
            ...decision,
            arguments: jsonValueSchema.parse(argumentResult.value),
          };
        }

        if (candidates.length && decision.kind !== "invoke-tool") {
          record("rejection", {
            reason: "candidate-selection-required",
            decision: decision.kind,
          }, { worldRevision: revision });
          continue;
        }
        if (
          candidates.length &&
          decision.kind === "invoke-tool" &&
          !candidateIds.has(decision.toolId)
        ) {
          record("rejection", {
            reason: "tool-outside-candidate-set",
            toolId: decision.toolId,
          }, { worldRevision: revision });
          continue;
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
        if (!("arguments" in decision)) {
          record("rejection", { reason: "Tool invocation omitted validated arguments" });
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
          for (const [alias] of Object.entries(executionBrief.localReferences)) {
            // The alias table is scoped to the exact model-input snapshot.
            resolveBriefReference(
              executionBrief, alias, { worldRevision: revision, eventSequence },
            );
          }
          const validateAliases = (value: JsonValue): void => {
            if (typeof value === "string" && /^scene\\.\\d{3}$/.test(value)) {
              resolveBriefReference(
                executionBrief, value,
                { worldRevision: revision, eventSequence },
              );
            } else if (Array.isArray(value)) {
              for (const entry of value) validateAliases(entry);
            } else if (value && typeof value === "object") {
              for (const entry of Object.values(value)) validateAliases(entry);
            }
          };
          validateAliases(decision.arguments);
          argumentsValue = replaceLocalReferences(
            decision.arguments,
            executionBrief.localReferences,
          );
          if (binding.kind !== "engine-query") {
            argumentsValue = injectActor(argumentsValue, run.actorId);
          }
          if (binding.kind === "ordinary-operation") {
            const remainingMs = Math.max(
              0,
              run.executableIntent.authorizedHorizonMs - run.elapsedMs,
            );
            const clamped = clampOperationDurationFields(argumentsValue, remainingMs);
            argumentsValue = clamped.value;
            if (clamped.clampedKeys.length > 0) {
              record("intent", {
                normalization: "operation-duration-bounded-by-authorized-horizon",
                toolId: decision.toolId,
                clampedKeys: [...clamped.clampedKeys],
                remainingMs,
              }, { worldRevision: revision });
            }
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
                localReferences: executionBrief.localReferences,
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
              // The query ran with actor knowledge authorization, so only this
              // same actor can use its result as short-term model context.
              access: {
                audience: ["actor"],
                perspective: { kind: "actor", id: run.actorId },
                actorAware: true,
                identityRecognized: true,
                privileged: false,
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

      run = actionRunSchema.parse({ ...run, status: "stopped", stopReason: "model-turn-limit" });
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
      const plannerState = await dependencies.persistence.planner.load(
        persisted.metadata.id,
      );
      return dependencies.persistence.saves.saveCheckpoint({
        checkpoint,
        state,
        ...(plannerState ? { plannerState } : {}),
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
    async createWorldFromCheckpoint(
      checkpointId: string,
      name: string,
    ): Promise<GameSession> {
      const checkpoint = await dependencies.persistence.saves.loadCheckpoint(checkpointId);
      if (!checkpoint) {
        throw new PersistenceNotFoundError(`Checkpoint not found: ${checkpointId}`);
      }
      validateGameCompositionForGame(checkpoint.state.game, dependencies.game);
      const timestamp = dependencies.wallClock.now();
      const id = dependencies.idGenerator.next("world");
      const world = await dependencies.persistence.worlds.create({
        metadata: {
          id,
          name,
          createdAt: timestamp,
          updatedAt: timestamp,
          game: clone(checkpoint.state.game),
        },
        state: validateWorldState(clone(checkpoint.state)),
        initialEvents: clone(checkpoint.history),
      });
      await dependencies.persistence.planner.restoreCheckpoint({
        checkpointId,
        targetWorldId: id,
        expectedWorldRevision: world.revision,
        expectedEventSequence: world.eventSequence,
      });
      return openSession(dependencies, {
        ...world,
        state: validateWorldState(world.state),
      });
    },
  };
}
