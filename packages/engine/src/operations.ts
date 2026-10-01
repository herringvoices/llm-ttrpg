import { z } from "zod";
import {
  canonicalFactSchema,
  jsonValueSchema,
  type JsonValue,
} from "./content.js";
import { stableIdSchema } from "./identity.js";
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
    kind: stableIdSchema,
    summary: z.string().min(1),
    participantIds: z.array(stableIdSchema),
    details: z.record(jsonValueSchema),
  })
  .strict();
export type ProposedEvent = z.infer<typeof proposedEventSchema>;

export interface DeterministicRandom {
  next(): number;
}

export interface RuleOperationContext {
  readonly world: Readonly<WorldState>;
  readonly rng: DeterministicRandom;
}

export interface OperationResult<TResult> {
  readonly result: TResult;
  readonly proposedMutations: readonly MutationProposal[];
  readonly proposedEvents: readonly ProposedEvent[];
}

export interface RulesOperation<TInput = unknown, TResult = unknown> {
  readonly metadata: OperationMetadata;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TResult>;
  readonly execute: (
    context: RuleOperationContext,
    input: TInput,
  ) => OperationResult<TResult>;
}

// A registry is intentionally heterogeneous. Type safety is recovered at the
// execution boundary by each operation's runtime input/output schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RegisteredRulesOperation = RulesOperation<any, any>;

export interface OperationRegistry {
  get(id: string): RulesOperation;
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
    if (typeof operation.execute !== "function") {
      throw new OperationValidationError(
        `Operation ${metadata.id} must expose a deterministic implementation`,
      );
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

  return {
    get(id) {
      const operation = byId.get(id);
      if (!operation) {
        throw new OperationValidationError(`Unknown rules operation: ${id}`);
      }
      return operation;
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
        .map((operation) => operation.metadata)
        .sort((a, b) => a.id.localeCompare(b.id));
    },
  };
}

export function executeRulesOperation<TInput, TResult>(
  registry: OperationRegistry,
  operationId: string,
  context: RuleOperationContext,
  input: TInput,
): OperationResult<TResult> {
  const operation = registry.get(operationId) as RulesOperation<TInput, TResult>;
  const parsedInput = operation.inputSchema.parse(input);
  const outcome = operation.execute(context, parsedInput);
  const parsedResult = operation.outputSchema.parse(outcome.result);
  const proposedMutations = z
    .array(mutationProposalSchema)
    .parse(outcome.proposedMutations);
  const proposedEvents = z
    .array(proposedEventSchema)
    .parse(outcome.proposedEvents);

  return {
    result: parsedResult,
    proposedMutations,
    proposedEvents,
  };
}

export function createSeededRandom(seed: number): DeterministicRandom {
  let state = seed >>> 0;
  return {
    next() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    },
  };
}

export function jsonOutcome(value: JsonValue): JsonValue {
  return value;
}
