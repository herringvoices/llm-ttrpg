import { z } from "zod";
import {
  canonicalFactSchema,
  jsonValueSchema,
  type JsonValue,
} from "./content.js";
import {
  executableIntentSchema,
  type ExecutableIntent,
} from "./action-pressure.js";
import { eventAccessSchema, eventOriginSchema } from "./events.js";
import { stableIdSchema } from "./identity.js";
import type { DeterministicRandom } from "./randomness.js";
import { resolutionPathSchema } from "./resolution.js";
import {
  fictionalDurationMsSchema,
  type FictionalDurationMs,
} from "./time.js";
import type { WorldState } from "./world.js";

export const operationCategorySchema = z
  .object({
    domain: z
      .object({ id: stableIdSchema, label: z.string().min(1) })
      .strict(),
    subsystem: z
      .object({ id: stableIdSchema, label: z.string().min(1) })
      .strict(),
    tags: z.array(stableIdSchema),
  })
  .strict();

export const operationMetadataSchema = z
  .object({
    id: stableIdSchema,
    kind: z.enum(["ordinary", "resolution"]),
    description: z.string().min(1),
    category: operationCategorySchema,
  })
  .strict();
export type OperationMetadata = z.infer<typeof operationMetadataSchema>;

export const mutationProposalSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("set-entity-data"),
      entityId: stableIdSchema,
      key: stableIdSchema,
      value: jsonValueSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("upsert-fact"),
      fact: canonicalFactSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("remove-fact"),
      factId: stableIdSchema,
    })
    .strict(),
]);
export type MutationProposal = z.infer<typeof mutationProposalSchema>;

export const proposedEventSchema = z
  .object({
    type: stableIdSchema,
    schemaVersion: z.number().int().positive(),
    summary: z.string().min(1),
    relatedEntityIds: z.array(stableIdSchema),
    scopeIds: z.array(stableIdSchema),
    causedByEventIds: z.array(stableIdSchema),
    origin: eventOriginSchema.optional(),
    payload: jsonValueSchema,
    access: eventAccessSchema,
  })
  .strict();
export type ProposedEvent = z.infer<typeof proposedEventSchema>;

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer TValue)[]
    ? readonly DeepReadonly<TValue>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T;

export type OperationWorldView = Pick<
  WorldState,
  | "game"
  | "initializedFromCampaign"
  | "fictionalTime"
  | "actionPressure"
  | "entities"
  | "facts"
  | "documents"
  | "beliefs"
  | "scheduledTriggers"
  | "simulationCursors"
>;

export interface RuleOperationContext {
  readonly world: DeepReadonly<OperationWorldView>;
}

export interface ResolutionAssessmentContext {
  readonly world: DeepReadonly<OperationWorldView>;
}

export interface ResolutionExecutionContext {
  readonly world: DeepReadonly<OperationWorldView>;
  readonly rng: DeterministicRandom;
}

export interface OperationResult<TResult> {
  readonly result: TResult;
  readonly advanceTimeByMs: FictionalDurationMs;
  readonly proposedMutations: readonly MutationProposal[];
  readonly proposedEvents: readonly ProposedEvent[];
}

export interface RulesOperation<TInput = unknown, TResult = unknown> {
  readonly metadata: OperationMetadata & { readonly kind: "ordinary" };
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TResult>;
  readonly execute: (
    context: RuleOperationContext,
    input: TInput,
  ) => OperationResult<TResult>;
}

export type ResolutionAssessment<TPrepared, TResult> =
  | {
      readonly path: "automatic" | "impossible";
      readonly basis: JsonValue;
      readonly outcome: OperationResult<TResult>;
    }
  | {
      readonly path: "uncertain";
      readonly basis: JsonValue;
      readonly prepared: TPrepared;
    };

export interface ResolutionOperation<
  TInput = JsonValue,
  TPrepared = JsonValue,
  TResult = JsonValue,
> {
  readonly metadata: OperationMetadata & { readonly kind: "resolution" };
  readonly inputSchema: z.ZodType<TInput>;
  readonly preparedSchema: z.ZodType<TPrepared>;
  readonly outputSchema: z.ZodType<TResult>;
  readonly assess: (
    context: ResolutionAssessmentContext,
    intent: ExecutableIntent,
    input: TInput,
  ) => ResolutionAssessment<TPrepared, TResult>;
  readonly resolve: (
    context: ResolutionExecutionContext,
    prepared: TPrepared,
  ) => OperationResult<TResult>;
}

// A registry is intentionally heterogeneous. Runtime schemas recover type
// safety at the operation boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RegisteredRulesOperation =
  | RulesOperation<any, any>
  | ResolutionOperation<any, any, any>;

export interface OperationRegistry {
  get(id: string): RegisteredRulesOperation;
  getOrdinary(id: string): RulesOperation;
  getResolution(id: string): ResolutionOperation;
  listDomains(): readonly OperationMetadata["category"]["domain"][];
  listSubsystems(
    domainId: string,
  ): readonly OperationMetadata["category"]["subsystem"][];
  listOperations(
    domainId: string,
    subsystemId: string,
  ): readonly OperationMetadata[];
}

export class OperationValidationError extends Error {
  override readonly name = "OperationValidationError";
}

function isZodSchema(value: unknown): value is z.ZodType<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "safeParse" in value &&
    typeof value.safeParse === "function"
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export function immutableOperationWorldView(
  world: WorldState,
): DeepReadonly<OperationWorldView> {
  return deepFreeze(
    JSON.parse(JSON.stringify({
      game: world.game,
      initializedFromCampaign: world.initializedFromCampaign,
      fictionalTime: world.fictionalTime,
      actionPressure: world.actionPressure,
      entities: world.entities,
      facts: world.facts,
      documents: world.documents,
      beliefs: world.beliefs,
      scheduledTriggers: world.scheduledTriggers,
      simulationCursors: world.simulationCursors,
    })) as OperationWorldView,
  ) as DeepReadonly<OperationWorldView>;
}

function validateOperationResult<TResult>(
  operation: { readonly outputSchema: z.ZodType<TResult> },
  outcome: OperationResult<TResult>,
  requireJsonResult: boolean,
): OperationResult<TResult> {
  const result = operation.outputSchema.parse(outcome.result);
  if (requireJsonResult) jsonValueSchema.parse(result);
  const advanceTimeByMs = fictionalDurationMsSchema.parse(
    outcome.advanceTimeByMs,
  );
  const proposedMutations = z
    .array(mutationProposalSchema)
    .parse(outcome.proposedMutations);
  const proposedEvents = z
    .array(proposedEventSchema)
    .parse(outcome.proposedEvents);

  return {
    result,
    advanceTimeByMs,
    proposedMutations,
    proposedEvents,
  };
}

export function createOperationRegistry(
  operations: readonly RegisteredRulesOperation[],
): OperationRegistry {
  const byId = new Map<string, RegisteredRulesOperation>();

  for (const operation of operations) {
    const metadata = operationMetadataSchema.parse(operation.metadata);
    if (!isZodSchema(operation.inputSchema) || !isZodSchema(operation.outputSchema)) {
      throw new OperationValidationError(
        `Operation ${metadata.id} must expose Zod input and output schemas`,
      );
    }
    if (metadata.kind === "ordinary") {
      if (typeof (operation as RulesOperation).execute !== "function") {
        throw new OperationValidationError(
          `Ordinary operation ${metadata.id} must expose execute`,
        );
      }
    } else {
      const resolution = operation as ResolutionOperation;
      if (
        !isZodSchema(resolution.preparedSchema) ||
        typeof resolution.assess !== "function" ||
        typeof resolution.resolve !== "function"
      ) {
        throw new OperationValidationError(
          `Resolution operation ${metadata.id} must expose preparedSchema, assess, and resolve`,
        );
      }
    }
    const prefix = `${metadata.category.domain.id}.${metadata.category.subsystem.id}.`;
    if (!metadata.id.startsWith(prefix)) {
      throw new OperationValidationError(
        `Operation ${metadata.id} must be nested under ${prefix}`,
      );
    }
    if (byId.has(metadata.id)) {
      throw new OperationValidationError(
        `Duplicate rules operation ID: ${metadata.id}`,
      );
    }
    byId.set(metadata.id, operation);
  }

  const get = (id: string): RegisteredRulesOperation => {
    const operation = byId.get(id);
    if (!operation) {
      throw new OperationValidationError(`Unknown rules operation: ${id}`);
    }
    return operation;
  };

  return {
    get,
    getOrdinary(id) {
      const operation = get(id);
      if (operation.metadata.kind !== "ordinary") {
        throw new OperationValidationError(
          `Operation ${id} is not an ordinary operation`,
        );
      }
      return operation as RulesOperation;
    },
    getResolution(id) {
      const operation = get(id);
      if (operation.metadata.kind !== "resolution") {
        throw new OperationValidationError(
          `Operation ${id} is not a resolution operation`,
        );
      }
      return operation as ResolutionOperation;
    },
    listDomains() {
      const domains = new Map<
        string,
        OperationMetadata["category"]["domain"]
      >();
      for (const operation of byId.values()) {
        domains.set(
          operation.metadata.category.domain.id,
          operation.metadata.category.domain,
        );
      }
      return [...domains.values()].sort((a, b) => a.id.localeCompare(b.id));
    },
    listSubsystems(domainId) {
      const subsystems = new Map<
        string,
        OperationMetadata["category"]["subsystem"]
      >();
      for (const operation of byId.values()) {
        if (operation.metadata.category.domain.id === domainId) {
          subsystems.set(
            operation.metadata.category.subsystem.id,
            operation.metadata.category.subsystem,
          );
        }
      }
      return [...subsystems.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
    },
    listOperations(domainId, subsystemId) {
      return [...byId.values()]
        .filter(
          (operation) =>
            operation.metadata.category.domain.id === domainId &&
            operation.metadata.category.subsystem.id === subsystemId,
        )
        .map((operation) => operationMetadataSchema.parse(operation.metadata))
        .sort((a, b) => a.id.localeCompare(b.id));
    },
  };
}

export function executeRulesOperation<TInput, TResult>(
  registry: OperationRegistry,
  operationId: string,
  context: { readonly world: WorldState },
  input: TInput,
): OperationResult<TResult> {
  const operation = registry.getOrdinary(operationId) as RulesOperation<
    TInput,
    TResult
  >;
  const parsedInput = operation.inputSchema.parse(input);
  const outcome = operation.execute(
    { world: immutableOperationWorldView(context.world) },
    parsedInput,
  );
  return validateOperationResult(operation, outcome, false);
}

export type ValidatedResolutionAssessment<TPrepared, TResult> =
  | {
      readonly path: "automatic" | "impossible";
      readonly basis: JsonValue;
      readonly outcome: OperationResult<TResult>;
    }
  | {
      readonly path: "uncertain";
      readonly basis: JsonValue;
      readonly prepared: TPrepared;
    };

export function assessResolutionOperation<TInput, TPrepared, TResult>(
  registry: OperationRegistry,
  operationId: string,
  world: WorldState,
  intent: ExecutableIntent,
  input: TInput,
): ValidatedResolutionAssessment<TPrepared, TResult> {
  const operation = registry.getResolution(operationId) as unknown as ResolutionOperation<
    TInput,
    TPrepared,
    TResult
  >;
  const parsedIntent = executableIntentSchema.parse(intent);
  const parsedInput = operation.inputSchema.parse(input);
  const assessment = operation.assess(
    { world: immutableOperationWorldView(world) },
    parsedIntent,
    parsedInput,
  );
  const path = resolutionPathSchema.parse(assessment.path);
  const basis = jsonValueSchema.parse(assessment.basis);

  if (path === "uncertain") {
    if (!("prepared" in assessment)) {
      throw new OperationValidationError(
        `Uncertain resolution ${operationId} did not provide prepared data`,
      );
    }
    const prepared = operation.preparedSchema.parse(assessment.prepared);
    jsonValueSchema.parse(prepared);
    return { path, basis, prepared };
  }
  if (!("outcome" in assessment)) {
    throw new OperationValidationError(
      `${path} resolution ${operationId} did not provide an outcome`,
    );
  }
  return {
    path,
    basis,
    outcome: validateOperationResult(operation, assessment.outcome, true),
  };
}

export function resolveUncertainOperation<TPrepared, TResult>(
  registry: OperationRegistry,
  operationId: string,
  world: WorldState,
  prepared: TPrepared,
  rng: DeterministicRandom,
): OperationResult<TResult> {
  const operation = registry.getResolution(operationId) as unknown as ResolutionOperation<
    unknown,
    TPrepared,
    TResult
  >;
  const parsedPrepared = operation.preparedSchema.parse(prepared);
  jsonValueSchema.parse(parsedPrepared);
  const outcome = operation.resolve(
    { world: immutableOperationWorldView(world), rng },
    parsedPrepared,
  );
  return validateOperationResult(operation, outcome, true);
}

export function jsonOutcome(value: JsonValue): JsonValue {
  return value;
}
