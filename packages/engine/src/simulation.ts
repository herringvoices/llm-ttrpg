import { z } from "zod";
import {
  eventAccessSchema,
  type CanonicalEvent,
} from "./events.js";
import {
  componentIdentitySchema,
  stableIdSchema,
  versionSchema,
  type ComponentIdentity,
} from "./identity.js";
import { jsonValueSchema, type JsonValue } from "./json.js";
import {
  immutableOperationWorldView,
  mutationProposalSchema,
  proposedEventSchema,
  type DeepReadonly,
  type MutationProposal,
  type OperationWorldView,
  type ProposedEvent,
} from "./operations.js";
import type { DeterministicRandom, RandomnessTrace } from "./randomness.js";
import {
  fictionalDurationMsSchema,
  fictionalInstantSchema,
  type FictionalDurationMs,
  type FictionalInstant,
} from "./time.js";
import type { ScheduledTrigger, WorldState } from "./world.js";

export const simulationScopeDefinitionSchema = z.object({
  id: stableIdSchema,
  kind: stableIdSchema,
  parentScopeId: stableIdSchema.optional(),
  dependencyScopeIds: z.array(stableIdSchema).default([]),
}).strict();
export type SimulationScopeDefinition = z.infer<
  typeof simulationScopeDefinitionSchema
>;

export const eventInterestDefinitionSchema = z.object({
  types: z.array(stableIdSchema).min(1).optional(),
  currentScope: z.literal(true).optional(),
  scopeId: stableIdSchema.optional(),
  relatedEntityId: stableIdSchema.optional(),
  originKind: stableIdSchema.optional(),
  originId: stableIdSchema.optional(),
  access: z.array(eventAccessSchema).min(1).optional(),
}).strict().superRefine((interest, context) => {
  if (interest.currentScope && interest.scopeId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Event interest cannot select both currentScope and scopeId",
      path: ["scopeId"],
    });
  }
  if (
    !interest.types &&
    !interest.currentScope &&
    !interest.scopeId &&
    !interest.relatedEntityId &&
    !interest.originKind &&
    !interest.originId
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Event interest must include a type, scope, entity, or origin filter",
    });
  }
});
export type EventInterestDefinition = z.infer<
  typeof eventInterestDefinitionSchema
>;

export const worldProcessMetadataSchema = z.object({
  id: stableIdSchema,
  version: versionSchema,
  description: z.string().trim().min(1),
  kind: z.enum(["deterministic", "stochastic"]),
  scopeKinds: z.array(stableIdSchema).default([]),
  dependencies: z.array(stableIdSchema).default([]),
  eventInterests: z.array(eventInterestDefinitionSchema).default([]),
  scheduledTriggerTypes: z.array(stableIdSchema).default([]),
}).strict();
export type WorldProcessMetadata = z.infer<
  typeof worldProcessMetadataSchema
>;

export const proposedScheduledWorkSchema = z.object({
  type: stableIdSchema,
  schemaVersion: z.number().int().positive(),
  dueAt: fictionalInstantSchema,
  scopeIds: z.array(stableIdSchema).min(1),
  payload: jsonValueSchema,
}).strict();
export type ProposedScheduledWork = z.infer<
  typeof proposedScheduledWorkSchema
>;

export const worldProcessCatchUpResultSchema = z.object({
  workUnits: z.number().int().nonnegative(),
  mutations: z.array(mutationProposalSchema),
  events: z.array(proposedEventSchema),
  processedScheduledTriggerIds: z.array(stableIdSchema),
  cancelScheduledTriggerIds: z.array(stableIdSchema),
  schedule: z.array(proposedScheduledWorkSchema),
  diagnostics: jsonValueSchema,
}).strict();
export type WorldProcessCatchUpResult = z.infer<
  typeof worldProcessCatchUpResultSchema
>;

export interface WorldProcessStateSelectionInput {
  readonly scopeId: string;
  readonly world: DeepReadonly<OperationWorldView>;
}

export interface WorldProcessCatchUpInput {
  readonly scopeId: string;
  readonly from: FictionalInstant;
  readonly to: FictionalInstant;
  readonly elapsedDurationMs: FictionalDurationMs;
  readonly relevantState: JsonValue;
  readonly relevantEvents: readonly CanonicalEvent[];
  readonly dueScheduledWork: readonly ScheduledTrigger[];
  readonly remainingWorkUnits: number;
  readonly rng?: DeterministicRandom;
}

export interface WorldProcessDefinition {
  readonly metadata: WorldProcessMetadata;
  readonly selectRelevantState: (
    input: WorldProcessStateSelectionInput,
  ) => JsonValue;
  readonly runCatchUp: (
    input: WorldProcessCatchUpInput,
  ) => WorldProcessCatchUpResult;
}

export interface WorldSimulationContribution {
  readonly scopes?: readonly SimulationScopeDefinition[];
  readonly processes?: readonly WorldProcessDefinition[];
}

export interface SourcedWorldSimulationContribution {
  readonly sourceComponent: ComponentIdentity;
  readonly contribution: WorldSimulationContribution;
}

export interface RegisteredWorldProcess {
  readonly metadata: WorldProcessMetadata;
  readonly sourceComponent: ComponentIdentity;
  readonly selectRelevantState: WorldProcessDefinition["selectRelevantState"];
  readonly runCatchUp: WorldProcessDefinition["runCatchUp"];
}

export interface WorldSimulationRegistry {
  listScopes(): readonly SimulationScopeDefinition[];
  getScope(scopeId: string): SimulationScopeDefinition;
  listChildren(scopeId: string): readonly SimulationScopeDefinition[];
  listAncestors(scopeId: string): readonly SimulationScopeDefinition[];
  dependencyClosure(scopeId: string): readonly SimulationScopeDefinition[];
  listProcesses(scopeKind: string): readonly RegisteredWorldProcess[];
  getProcess(processId: string): RegisteredWorldProcess;
  scheduledHandler(
    scopeKind: string,
    triggerType: string,
  ): RegisteredWorldProcess | undefined;
}

export class SimulationValidationError extends Error {
  override readonly name = "SimulationValidationError";
}

export class SimulationNotFoundError extends Error {
  override readonly name = "SimulationNotFoundError";
}

export class SimulationBudgetExceededError extends Error {
  override readonly name = "SimulationBudgetExceededError";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function deterministicTopologicalOrder<T extends { readonly id: string }>(
  values: readonly T[],
  dependenciesFor: (value: T) => readonly string[],
  priorityFor: (value: T) => number = () => 0,
): T[] {
  const byId = new Map(values.map((value) => [value.id, value]));
  const remaining = new Map(
    values.map((value) => [value.id, new Set(dependenciesFor(value))]),
  );
  const ordered: T[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([id]) => byId.get(id)!)
      .sort((left, right) =>
        priorityFor(left) - priorityFor(right) || left.id.localeCompare(right.id)
      );
    if (ready.length === 0) {
      throw new SimulationValidationError(
        `Dependency cycle: ${[...remaining.keys()].sort().join(", ")}`,
      );
    }
    const value = ready[0]!;
    ordered.push(value);
    remaining.delete(value.id);
    for (const dependencies of remaining.values()) dependencies.delete(value.id);
  }
  return ordered;
}

function supportsScopeKind(
  process: RegisteredWorldProcess,
  scopeKind: string,
): boolean {
  return process.metadata.scopeKinds.length === 0 ||
    process.metadata.scopeKinds.includes(scopeKind);
}

export function createWorldSimulationRegistry(
  contributions: readonly SourcedWorldSimulationContribution[],
): WorldSimulationRegistry {
  const scopes = new Map<string, SimulationScopeDefinition>();
  const processes = new Map<string, RegisteredWorldProcess>();

  for (const sourced of contributions) {
    const sourceComponent = componentIdentitySchema.parse(sourced.sourceComponent);
    const contribution = sourced.contribution;
    for (const candidate of contribution.scopes ?? []) {
      const scope = simulationScopeDefinitionSchema.parse(candidate);
      if (scopes.has(scope.id)) {
        throw new SimulationValidationError(`Duplicate simulation scope: ${scope.id}`);
      }
      const duplicateDependencies = findDuplicates(scope.dependencyScopeIds);
      if (duplicateDependencies.length > 0) {
        throw new SimulationValidationError(
          `Simulation scope ${scope.id} has duplicate dependencies: ${duplicateDependencies.join(", ")}`,
        );
      }
      scopes.set(scope.id, scope);
    }
    for (const candidate of contribution.processes ?? []) {
      const metadata = worldProcessMetadataSchema.parse(candidate.metadata);
      if (
        typeof candidate.selectRelevantState !== "function" ||
        typeof candidate.runCatchUp !== "function"
      ) {
        throw new SimulationValidationError(
          `World process ${metadata.id} requires state selection and catch-up functions`,
        );
      }
      if (processes.has(metadata.id)) {
        throw new SimulationValidationError(`Duplicate world process: ${metadata.id}`);
      }
      for (const [label, values] of [
        ["scope kinds", metadata.scopeKinds],
        ["dependencies", metadata.dependencies],
        ["scheduled trigger types", metadata.scheduledTriggerTypes],
      ] as const) {
        const duplicates = findDuplicates(values);
        if (duplicates.length > 0) {
          throw new SimulationValidationError(
            `World process ${metadata.id} has duplicate ${label}: ${duplicates.join(", ")}`,
          );
        }
      }
      if (metadata.kind === "stochastic" && metadata.scheduledTriggerTypes.length > 0) {
        throw new SimulationValidationError(
          `Stochastic world process ${metadata.id} cannot own scheduled work`,
        );
      }
      processes.set(metadata.id, {
        metadata,
        sourceComponent,
        selectRelevantState: candidate.selectRelevantState,
        runCatchUp: candidate.runCatchUp,
      });
    }
  }

  const scopeKinds = new Set([...scopes.values()].map((scope) => scope.kind));
  if (processes.size > 0 && scopes.size === 0) {
    throw new SimulationValidationError(
      "World processes require at least one active simulation scope",
    );
  }
  for (const scope of scopes.values()) {
    const dependencies = [
      ...(scope.parentScopeId ? [scope.parentScopeId] : []),
      ...scope.dependencyScopeIds,
    ];
    if (scope.parentScopeId && scope.dependencyScopeIds.includes(scope.parentScopeId)) {
      throw new SimulationValidationError(
        `Simulation scope ${scope.id} lists its parent as a duplicate dependency`,
      );
    }
    for (const dependencyId of dependencies) {
      if (!scopes.has(dependencyId)) {
        throw new SimulationValidationError(
          `Simulation scope ${scope.id} references missing dependency ${dependencyId}`,
        );
      }
      if (dependencyId === scope.id) {
        throw new SimulationValidationError(
          `Simulation scope ${scope.id} cannot depend on itself`,
        );
      }
    }
  }
  const allScopes = [...scopes.values()];
  deterministicTopologicalOrder(
    allScopes,
    (scope) => [
      ...(scope.parentScopeId ? [scope.parentScopeId] : []),
      ...scope.dependencyScopeIds,
    ],
  );

  for (const process of processes.values()) {
    for (const scopeKind of process.metadata.scopeKinds) {
      if (!scopeKinds.has(scopeKind)) {
        throw new SimulationValidationError(
          `World process ${process.metadata.id} references unknown scope kind ${scopeKind}`,
        );
      }
    }
    for (const dependencyId of process.metadata.dependencies) {
      const dependency = processes.get(dependencyId);
      if (!dependency) {
        throw new SimulationValidationError(
          `World process ${process.metadata.id} references missing dependency ${dependencyId}`,
        );
      }
      if (
        process.metadata.kind === "deterministic" &&
        dependency.metadata.kind === "stochastic"
      ) {
        throw new SimulationValidationError(
          `Deterministic process ${process.metadata.id} cannot depend on stochastic process ${dependencyId}`,
        );
      }
      const supportedKinds = process.metadata.scopeKinds.length > 0
        ? process.metadata.scopeKinds
        : [...scopeKinds];
      for (const scopeKind of supportedKinds) {
        if (!supportsScopeKind(dependency, scopeKind)) {
          throw new SimulationValidationError(
            `Process dependency ${dependencyId} does not support ${scopeKind} required by ${process.metadata.id}`,
          );
        }
      }
    }
  }
  const orderedProcesses = deterministicTopologicalOrder(
    [...processes.values()].map((process) => ({
      id: process.metadata.id,
      process,
    })),
    (value) => value.process.metadata.dependencies,
    (value) => value.process.metadata.kind === "deterministic" ? 0 : 1,
  ).map((value) => value.process);

  for (const scopeKind of scopeKinds) {
    const handlers = new Map<string, string>();
    for (const process of orderedProcesses.filter((item) =>
      supportsScopeKind(item, scopeKind)
    )) {
      for (const triggerType of process.metadata.scheduledTriggerTypes) {
        const existing = handlers.get(triggerType);
        if (existing) {
          throw new SimulationValidationError(
            `Scheduled trigger ${triggerType} has multiple handlers for ${scopeKind}: ${existing}, ${process.metadata.id}`,
          );
        }
        handlers.set(triggerType, process.metadata.id);
      }
    }
  }

  const getScope = (scopeId: string): SimulationScopeDefinition => {
    const scope = scopes.get(scopeId);
    if (!scope) throw new SimulationNotFoundError(`Unknown simulation scope: ${scopeId}`);
    return clone(scope);
  };
  const getProcess = (processId: string): RegisteredWorldProcess => {
    const process = processes.get(processId);
    if (!process) throw new SimulationNotFoundError(`Unknown world process: ${processId}`);
    return process;
  };

  return {
    listScopes() {
      return [...scopes.values()].sort((a, b) => a.id.localeCompare(b.id)).map(clone);
    },
    getScope,
    listChildren(scopeId) {
      getScope(scopeId);
      return [...scopes.values()]
        .filter((scope) => scope.parentScopeId === scopeId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(clone);
    },
    listAncestors(scopeId) {
      const ancestors: SimulationScopeDefinition[] = [];
      let current = scopes.get(getScope(scopeId).parentScopeId ?? "");
      while (current) {
        ancestors.unshift(current);
        current = scopes.get(current.parentScopeId ?? "");
      }
      return ancestors.map(clone);
    },
    dependencyClosure(scopeId) {
      const included = new Set<string>();
      const visit = (id: string): void => {
        if (included.has(id)) return;
        const scope = scopes.get(id);
        if (!scope) throw new SimulationNotFoundError(`Unknown simulation scope: ${id}`);
        if (scope.parentScopeId) visit(scope.parentScopeId);
        for (const dependency of scope.dependencyScopeIds) visit(dependency);
        included.add(id);
      };
      visit(scopeId);
      const selected = [...included].map((id) => scopes.get(id)!);
      return deterministicTopologicalOrder(
        selected,
        (scope) => [
          ...(scope.parentScopeId && included.has(scope.parentScopeId)
            ? [scope.parentScopeId]
            : []),
          ...scope.dependencyScopeIds.filter((id) => included.has(id)),
        ],
      ).map(clone);
    },
    listProcesses(scopeKind) {
      if (!scopeKinds.has(scopeKind)) {
        throw new SimulationNotFoundError(`Unknown simulation scope kind: ${scopeKind}`);
      }
      return orderedProcesses.filter((process) => supportsScopeKind(process, scopeKind));
    },
    getProcess,
    scheduledHandler(scopeKind, triggerType) {
      return orderedProcesses.find((process) =>
        supportsScopeKind(process, scopeKind) &&
        process.metadata.scheduledTriggerTypes.includes(triggerType)
      );
    },
  };
}

export function selectWorldProcessState(
  process: RegisteredWorldProcess,
  world: WorldState,
  scopeId: string,
): JsonValue {
  return clone(jsonValueSchema.parse(process.selectRelevantState({
    scopeId: stableIdSchema.parse(scopeId),
    world: immutableOperationWorldView(world),
  })));
}

export function executeWorldProcess(
  process: RegisteredWorldProcess,
  input: Omit<WorldProcessCatchUpInput, "rng">,
  rng?: DeterministicRandom,
): WorldProcessCatchUpResult {
  if (process.metadata.kind === "stochastic" && !rng) {
    throw new SimulationValidationError(
      `Stochastic process ${process.metadata.id} requires engine RNG`,
    );
  }
  const immutableInput = deepFreeze(clone(input));
  const outcome = process.runCatchUp({
    ...immutableInput,
    ...(process.metadata.kind === "stochastic" ? { rng } : {}),
  });
  return worldProcessCatchUpResultSchema.parse(outcome);
}

export interface WorldProcessExecutionDiagnostic {
  readonly scopeId: string;
  readonly processId: string;
  readonly sourceComponent: ComponentIdentity;
  readonly from: FictionalInstant;
  readonly to: FictionalInstant;
  readonly elapsedDurationMs: FictionalDurationMs;
  readonly workUnits: number;
  readonly relevantEventIds: readonly string[];
  readonly scheduledTriggerIds: readonly string[];
  readonly mutations: readonly MutationProposal[];
  readonly proposedEvents: readonly ProposedEvent[];
  readonly canonicalEventIds: readonly string[];
  readonly processedScheduledTriggerIds: readonly string[];
  readonly cancelledScheduledTriggerIds: readonly string[];
  readonly scheduledTriggerIdsAdded: readonly string[];
  readonly randomness: RandomnessTrace | null;
  readonly diagnostics: JsonValue;
}

export interface CatchUpScopeRequest {
  readonly scopeId: string;
  readonly targetTime?: FictionalInstant;
  readonly maxWorkUnits?: number;
}

export type CatchUpScopeResult =
  | {
      readonly kind: "no-op";
      readonly requestedScopeId: string;
      readonly targetTime: FictionalInstant;
      readonly originalCursor: FictionalInstant;
      readonly finalCursor: FictionalInstant;
      readonly reason: "already-current";
      readonly awakenedScopeIds: readonly [];
      readonly scopeOrder: readonly [];
      readonly processOrder: readonly [];
      readonly relevantEventIds: readonly [];
      readonly processedScheduledTriggerIds: readonly [];
      readonly canonicalEventIds: readonly [];
      readonly randomness: readonly [];
      readonly processOutcomes: readonly [];
    }
  | {
      readonly kind: "caught-up";
      readonly requestedScopeId: string;
      readonly targetTime: FictionalInstant;
      readonly originalCursor: FictionalInstant;
      readonly finalCursor: FictionalInstant;
      readonly awakenedScopeIds: readonly string[];
      readonly scopeOrder: readonly string[];
      readonly processOrder: readonly string[];
      readonly relevantEventIds: readonly string[];
      readonly processedScheduledTriggerIds: readonly string[];
      readonly canonicalEventIds: readonly string[];
      readonly randomness: readonly RandomnessTrace[];
      readonly processOutcomes: readonly WorldProcessExecutionDiagnostic[];
      readonly workUnitsUsed: number;
      readonly worldRevisionBefore: number;
      readonly worldRevisionAfter: number;
    };
