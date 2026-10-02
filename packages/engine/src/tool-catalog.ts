import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { executableIntentSchema } from "./action-pressure.js";
import {
  componentIdentitySchema,
  stableIdSchema,
  type ComponentIdentity,
} from "./identity.js";
import { jsonValueSchema, type JsonValue } from "./json.js";
import {
  immutableOperationWorldView,
  type DeepReadonly,
  type OperationRegistry,
  type OperationWorldView,
  type RegisteredRulesOperation,
} from "./operations.js";
import {
  createResolutionEnvelopeSchema,
  resolutionRequestSchema,
  type ResolutionRequest,
} from "./resolution.js";
import type { WorldState } from "./world.js";

export const toolDomainDescriptorSchema = z
  .object({
    id: stableIdSchema,
    description: z.string().min(1),
  })
  .strict();
export type ToolDomainDescriptor = z.infer<typeof toolDomainDescriptorSchema>;

export const toolSubsystemDescriptorSchema = z
  .object({
    id: stableIdSchema,
    domainId: stableIdSchema,
    description: z.string().min(1),
  })
  .strict();
export type ToolSubsystemDescriptor = z.infer<
  typeof toolSubsystemDescriptorSchema
>;

export interface ToolDescriptor {
  readonly id: string;
  readonly description: string;
  readonly domainId: string;
  readonly subsystemId: string;
  readonly sourceComponent: ComponentIdentity;
}

export type ToolSummary = ToolDescriptor;

export interface ToolContract extends ToolDescriptor {
  readonly inputSchema: JsonValue;
  readonly outputSchema: JsonValue;
}

export interface EngineQueryContext {
  readonly world: DeepReadonly<OperationWorldView>;
}

export interface EngineQueryTool<
  TInput = JsonValue,
  TOutput extends JsonValue = JsonValue,
> {
  readonly id: string;
  readonly description: string;
  readonly domainId: string;
  readonly subsystemId: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly query: (
    context: EngineQueryContext,
    input: TInput,
  ) => TOutput;
}

// Catalog composition is intentionally heterogeneous and recovers concrete
// types through each query's authoritative runtime schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RegisteredEngineQueryTool = EngineQueryTool<any, any>;

export interface ToolCatalogContribution {
  readonly domains: readonly ToolDomainDescriptor[];
  readonly subsystems: readonly ToolSubsystemDescriptor[];
  readonly queries: readonly RegisteredEngineQueryTool[];
}

export interface SourcedToolCatalogContribution {
  readonly sourceComponent: ComponentIdentity;
  readonly contribution: ToolCatalogContribution;
}

export type ToolAvailabilityPolicy = (
  descriptor: ToolDescriptor,
) => boolean;

export interface OrdinaryOperationToolBinding {
  readonly kind: "ordinary-operation";
  readonly operationId: string;
  readonly inputSchema: z.ZodType<unknown>;
  readonly outputSchema: z.ZodType<unknown>;
}

export interface ResolutionOperationToolBinding {
  readonly kind: "resolution-operation";
  readonly operationId: string;
  readonly invocationSchema: z.ZodType<unknown>;
  readonly outputSchema: z.ZodType<unknown>;
}

export interface EngineQueryToolBinding {
  readonly kind: "engine-query";
  readonly toolId: string;
  readonly inputSchema: z.ZodType<unknown>;
  readonly outputSchema: z.ZodType<unknown>;
  readonly query: RegisteredEngineQueryTool["query"];
}

export type ToolBinding =
  | OrdinaryOperationToolBinding
  | ResolutionOperationToolBinding
  | EngineQueryToolBinding;

export interface ToolCatalog {
  listDomains(policy?: ToolAvailabilityPolicy): readonly ToolDomainDescriptor[];
  listSubsystems(
    domainId: string,
    policy?: ToolAvailabilityPolicy,
  ): readonly ToolSubsystemDescriptor[];
  listTools(
    domainId: string,
    subsystemId: string,
    policy?: ToolAvailabilityPolicy,
  ): readonly ToolSummary[];
  inspectTool(toolId: string, policy?: ToolAvailabilityPolicy): ToolContract;
  resolveBinding(toolId: string, policy?: ToolAvailabilityPolicy): ToolBinding;
}

export class ToolCatalogValidationError extends Error {
  override readonly name = "ToolCatalogValidationError";
}

export class ToolCatalogNotFoundError extends Error {
  override readonly name = "ToolCatalogNotFoundError";
}

export class ToolUnavailableError extends Error {
  override readonly name = "ToolUnavailableError";
}

interface ToolEntry {
  readonly descriptor: ToolDescriptor;
  readonly inputSchema: z.ZodType<unknown>;
  readonly outputSchema: z.ZodType<unknown>;
  readonly binding: ToolBinding;
}

export interface CreateToolCatalogInput {
  readonly operationRegistry: OperationRegistry;
  readonly rulesetSource: ComponentIdentity;
  readonly contributions: readonly SourcedToolCatalogContribution[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function subsystemKey(domainId: string, subsystemId: string): string {
  return `${domainId}\u0000${subsystemId}`;
}

function isZodSchema(value: unknown): value is z.ZodType<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "safeParse" in value &&
    typeof value.safeParse === "function"
  );
}

function modelSchema(schema: z.ZodType<unknown>): JsonValue {
  const generated = zodToJsonSchema(schema, {
    $refStrategy: "none",
  });
  return jsonValueSchema.parse(clone(generated));
}

function allowAll(): boolean {
  return true;
}

function sameDomain(
  left: ToolDomainDescriptor,
  right: ToolDomainDescriptor,
): boolean {
  return left.id === right.id && left.description === right.description;
}

function sameSubsystem(
  left: ToolSubsystemDescriptor,
  right: ToolSubsystemDescriptor,
): boolean {
  return (
    left.id === right.id &&
    left.domainId === right.domainId &&
    left.description === right.description
  );
}

function validateToolLocation(
  id: string,
  domainId: string,
  subsystemId: string,
  domains: ReadonlyMap<string, ToolDomainDescriptor>,
  subsystems: ReadonlyMap<string, ToolSubsystemDescriptor>,
): void {
  if (!domains.has(domainId)) {
    throw new ToolCatalogValidationError(
      `Tool ${id} references unknown domain ${domainId}`,
    );
  }
  if (!subsystems.has(subsystemKey(domainId, subsystemId))) {
    throw new ToolCatalogValidationError(
      `Tool ${id} references unknown subsystem ${domainId}.${subsystemId}`,
    );
  }
  const prefix = `${domainId}.${subsystemId}.`;
  if (!id.startsWith(prefix)) {
    throw new ToolCatalogValidationError(
      `Tool ${id} must be nested under ${prefix}`,
    );
  }
}

function entryFromOperation(
  operation: RegisteredRulesOperation,
  sourceComponent: ComponentIdentity,
): ToolEntry {
  const descriptor: ToolDescriptor = {
    id: operation.metadata.id,
    description: operation.metadata.description,
    domainId: operation.metadata.category.domain.id,
    subsystemId: operation.metadata.category.subsystem.id,
    sourceComponent,
  };
  if (operation.metadata.kind === "ordinary") {
    return {
      descriptor,
      inputSchema: operation.inputSchema,
      outputSchema: operation.outputSchema,
      binding: {
        kind: "ordinary-operation",
        operationId: operation.metadata.id,
        inputSchema: operation.inputSchema,
        outputSchema: operation.outputSchema,
      },
    };
  }

  const invocationSchema = z
    .object({
      intent: executableIntentSchema,
      input: operation.inputSchema,
    })
    .strict();
  const outputSchema = createResolutionEnvelopeSchema(
    operation.outputSchema,
    operation.metadata.id,
  );
  return {
    descriptor,
    inputSchema: invocationSchema,
    outputSchema,
    binding: {
      kind: "resolution-operation",
      operationId: operation.metadata.id,
      invocationSchema,
      outputSchema,
    },
  };
}

export function createToolCatalog(input: CreateToolCatalogInput): ToolCatalog {
  const rulesetSource = componentIdentitySchema.parse(input.rulesetSource);
  const domains = new Map<string, ToolDomainDescriptor>();
  const subsystems = new Map<string, ToolSubsystemDescriptor>();
  const normalizedContributions = input.contributions.map((item) => {
    const contribution = item.contribution as Partial<ToolCatalogContribution>;
    if (
      !contribution ||
      !Array.isArray(contribution.domains) ||
      !Array.isArray(contribution.subsystems) ||
      !Array.isArray(contribution.queries)
    ) {
      throw new ToolCatalogValidationError(
        "Tool catalog contributions require domains, subsystems, and queries arrays",
      );
    }
    return {
      sourceComponent: componentIdentitySchema.parse(item.sourceComponent),
      contribution: contribution as ToolCatalogContribution,
    };
  });

  for (const { contribution } of normalizedContributions) {
    for (const candidate of contribution.domains) {
      const descriptor = toolDomainDescriptorSchema.parse(candidate);
      const existing = domains.get(descriptor.id);
      if (existing && !sameDomain(existing, descriptor)) {
        throw new ToolCatalogValidationError(
          `Conflicting tool domain descriptor: ${descriptor.id}`,
        );
      }
      domains.set(descriptor.id, descriptor);
    }
    for (const candidate of contribution.subsystems) {
      const descriptor = toolSubsystemDescriptorSchema.parse(candidate);
      const key = subsystemKey(descriptor.domainId, descriptor.id);
      const existing = subsystems.get(key);
      if (existing && !sameSubsystem(existing, descriptor)) {
        throw new ToolCatalogValidationError(
          `Conflicting tool subsystem descriptor: ${descriptor.domainId}.${descriptor.id}`,
        );
      }
      subsystems.set(key, descriptor);
    }
  }

  for (const descriptor of subsystems.values()) {
    if (!domains.has(descriptor.domainId)) {
      throw new ToolCatalogValidationError(
        `Tool subsystem ${descriptor.domainId}.${descriptor.id} references an unknown domain`,
      );
    }
  }

  const entries = new Map<string, ToolEntry>();
  const register = (entry: ToolEntry): void => {
    validateToolLocation(
      entry.descriptor.id,
      entry.descriptor.domainId,
      entry.descriptor.subsystemId,
      domains,
      subsystems,
    );
    if (entries.has(entry.descriptor.id)) {
      throw new ToolCatalogValidationError(
        `Duplicate tool ID: ${entry.descriptor.id}`,
      );
    }
    entries.set(entry.descriptor.id, entry);
  };

  for (const metadata of input.operationRegistry.listAll()) {
    register(entryFromOperation(
      input.operationRegistry.get(metadata.id),
      rulesetSource,
    ));
  }

  for (const { sourceComponent, contribution } of normalizedContributions) {
    for (const query of contribution.queries) {
      if (
        !isZodSchema(query.inputSchema) ||
        !isZodSchema(query.outputSchema) ||
        typeof query.query !== "function"
      ) {
        throw new ToolCatalogValidationError(
          `Engine query tool ${query.id} must expose Zod input/output schemas and a query handler`,
        );
      }
      const descriptor: ToolDescriptor = {
        id: stableIdSchema.parse(query.id),
        description: z.string().min(1).parse(query.description),
        domainId: stableIdSchema.parse(query.domainId),
        subsystemId: stableIdSchema.parse(query.subsystemId),
        sourceComponent,
      };
      register({
        descriptor,
        inputSchema: query.inputSchema,
        outputSchema: query.outputSchema,
        binding: {
          kind: "engine-query",
          toolId: descriptor.id,
          inputSchema: query.inputSchema,
          outputSchema: query.outputSchema,
          query: query.query,
        },
      });
    }
  }

  const sortedEntries = [...entries.values()].sort((left, right) =>
    left.descriptor.id.localeCompare(right.descriptor.id),
  );
  const policyOrDefault = (
    policy?: ToolAvailabilityPolicy,
  ): ToolAvailabilityPolicy => policy ?? allowAll;
  const requiredEntry = (toolId: string): ToolEntry => {
    const entry = entries.get(toolId);
    if (!entry) {
      throw new ToolCatalogNotFoundError(`Unknown tool: ${toolId}`);
    }
    return entry;
  };
  const availableEntry = (
    toolId: string,
    policy?: ToolAvailabilityPolicy,
  ): ToolEntry => {
    const entry = requiredEntry(toolId);
    if (!policyOrDefault(policy)(clone(entry.descriptor))) {
      throw new ToolUnavailableError(`Tool is unavailable: ${toolId}`);
    }
    return entry;
  };

  return {
    listDomains(policy) {
      const isAvailable = policyOrDefault(policy);
      return [...domains.values()]
        .filter((domain) => sortedEntries.some(
          (entry) =>
            entry.descriptor.domainId === domain.id &&
            isAvailable(clone(entry.descriptor)),
        ))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(clone);
    },
    listSubsystems(domainId, policy) {
      if (!domains.has(domainId)) {
        throw new ToolCatalogNotFoundError(`Unknown tool domain: ${domainId}`);
      }
      const isAvailable = policyOrDefault(policy);
      return [...subsystems.values()]
        .filter(
          (subsystem) =>
            subsystem.domainId === domainId &&
            sortedEntries.some(
              (entry) =>
                entry.descriptor.domainId === domainId &&
                entry.descriptor.subsystemId === subsystem.id &&
                isAvailable(clone(entry.descriptor)),
            ),
        )
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(clone);
    },
    listTools(domainId, subsystemId, policy) {
      if (!domains.has(domainId)) {
        throw new ToolCatalogNotFoundError(`Unknown tool domain: ${domainId}`);
      }
      if (!subsystems.has(subsystemKey(domainId, subsystemId))) {
        throw new ToolCatalogNotFoundError(
          `Unknown tool subsystem: ${domainId}.${subsystemId}`,
        );
      }
      const isAvailable = policyOrDefault(policy);
      return sortedEntries
        .filter(
          (entry) =>
            entry.descriptor.domainId === domainId &&
            entry.descriptor.subsystemId === subsystemId &&
            isAvailable(clone(entry.descriptor)),
        )
        .map((entry) => clone(entry.descriptor));
    },
    inspectTool(toolId, policy) {
      const entry = availableEntry(toolId, policy);
      return {
        ...clone(entry.descriptor),
        inputSchema: modelSchema(entry.inputSchema),
        outputSchema: modelSchema(entry.outputSchema),
      };
    },
    resolveBinding(toolId, policy) {
      return availableEntry(toolId, policy).binding;
    },
  };
}

export function createResolutionRequestFromBinding(
  binding: ToolBinding,
  invocation: unknown,
): ResolutionRequest {
  if (binding.kind !== "resolution-operation") {
    throw new ToolCatalogValidationError(
      "A resolution request requires a resolution-operation binding",
    );
  }
  const parsed = binding.invocationSchema.parse(invocation) as {
    intent: z.infer<typeof executableIntentSchema>;
    input: unknown;
  };
  return resolutionRequestSchema.parse({
    intent: parsed.intent,
    operation: {
      id: binding.operationId,
      input: parsed.input,
    },
  });
}

export function executeEngineQueryTool<TResult extends JsonValue = JsonValue>(
  binding: ToolBinding,
  world: WorldState,
  input: unknown,
): TResult {
  if (binding.kind !== "engine-query") {
    throw new ToolCatalogValidationError(
      "Engine query execution requires an engine-query binding",
    );
  }
  const parsedInput = binding.inputSchema.parse(input);
  const output = binding.query(
    { world: immutableOperationWorldView(world) },
    parsedInput,
  );
  const parsedOutput = binding.outputSchema.parse(output);
  return clone(jsonValueSchema.parse(parsedOutput)) as TResult;
}
