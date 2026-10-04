import { z } from "zod";
import {
  canonicalEventSchema,
  conversationTurnRequestSchema,
  conversationWorkingStateSchema,
  contextAssemblyRequestSchema,
  eventAccessSchema,
  fictionalInstantSchema,
  jsonValueSchema,
  mutationProposalSchema,
  playerActionRequestSchema,
  stableIdSchema,
  worldStateSchema,
  type CanonicalEvent,
  type ContextAssemblyRequest,
  type SceneSourceProvider,
  type ContextPackage,
  type GameComposition,
  type GameDefinition,
  type JsonValue,
  type ModelRuntime,
  type MutationProposal,
  type PlayerActionRequest,
  type WorldState,
} from "@llm-ttrpg/engine";

export const traceLevelSchema = z.enum(["summary", "decision", "full"]);
export type TraceLevel = z.infer<typeof traceLevelSchema>;

export type ScenarioSetup = (session: HarnessScenarioSession) =>
  void | Promise<void>;

export interface HarnessScenario<TData extends JsonValue = JsonValue> {
  readonly id: string;
  readonly description: string;
  readonly game: GameDefinition;
  readonly seed: number;
  readonly worldName?: string;
  readonly data?: TData;
  readonly modelRuntime?: ModelRuntime;
  readonly modelRuntimeFactory?: () => ModelRuntime;
  readonly sceneSource?: SceneSourceProvider;
  readonly setup?: ScenarioSetup;
  readonly assertInvariants?: (session: HarnessScenarioSession) =>
    void | Promise<void>;
}

/** The setup-facing subset prevents scenario setup from forking/exporting itself. */
export interface HarnessScenarioSession {
  readonly scenarioId: string;
  readonly worldId: string;
  world(): WorldState;
  advanceTime(durationMs: number): Promise<WorldState>;
  injectMutations(
    proposals: readonly MutationProposal[],
    label?: string,
  ): Promise<WorldState>;
  injectEvent(event: HarnessEventInput): Promise<CanonicalEvent>;
  executeOperation<TResult = unknown>(
    operationId: string,
    input: unknown,
  ): Promise<TResult>;
}

export function defineScenario<TData extends JsonValue = JsonValue>(
  scenario: HarnessScenario<TData>,
): HarnessScenario<TData> {
  stableIdSchema.parse(scenario.id);
  z.string().trim().min(1).parse(scenario.description);
  z.number().int().min(0).max(0xffff_ffff).parse(scenario.seed);
  if (scenario.data !== undefined) jsonValueSchema.parse(scenario.data);
  return Object.freeze({ ...scenario });
}

export interface HarnessEventInput {
  readonly type: string;
  readonly schemaVersion: number;
  readonly summary: string;
  readonly occurredAt?: string;
  readonly relatedEntityIds?: readonly string[];
  readonly scopeIds?: readonly string[];
  readonly causedByEventIds?: readonly string[];
  readonly payload: JsonValue;
  readonly access?: "public" | "gm-only";
}

export const harnessEventInputSchema = z.object({
  type: stableIdSchema,
  schemaVersion: z.number().int().positive(),
  summary: z.string().trim().min(1),
  occurredAt: fictionalInstantSchema.optional(),
  relatedEntityIds: z.array(stableIdSchema).optional(),
  scopeIds: z.array(stableIdSchema).optional(),
  causedByEventIds: z.array(stableIdSchema).optional(),
  payload: jsonValueSchema,
  access: eventAccessSchema.optional(),
}).strict();

export type HarnessSnapshotCategory =
  | "time"
  | "revision"
  | "entities"
  | "facts"
  | "beliefs"
  | "documents"
  | "actor-social-state"
  | "mechanical-realizations"
  | "scheduled-triggers"
  | "simulation-cursors"
  | "events"
  | "rng"
  | "diagnostics";

export interface HarnessSnapshot {
  readonly scenarioId: string;
  readonly game: GameComposition;
  readonly worldId: string;
  readonly revision: number;
  readonly eventSequence: number;
  readonly state: WorldState;
  readonly history: readonly CanonicalEvent[];
  readonly diagnostics?: JsonValue;
}

export interface SemanticChange {
  readonly category: HarnessSnapshotCategory;
  readonly path: string;
  readonly kind: "added" | "removed" | "changed";
  readonly before?: JsonValue;
  readonly after?: JsonValue;
}

export interface SemanticDiff {
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly changes: readonly SemanticChange[];
  readonly changedCategories: readonly HarnessSnapshotCategory[];
}

export interface HarnessTraceEntry {
  readonly sequence: number;
  readonly level: TraceLevel;
  readonly command: string;
  readonly status: "succeeded" | "failed";
  readonly summary: string;
  readonly worldRevisionBefore: number;
  readonly worldRevisionAfter: number;
  readonly fictionalTimeBefore: string;
  readonly fictionalTimeAfter: string;
  readonly changedCategories: readonly HarnessSnapshotCategory[];
  readonly decision?: JsonValue;
  readonly full?: JsonValue;
  readonly error?: string;
}

export const replayCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("advance-time"),
    durationMs: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    kind: z.literal("catch-up"),
    scopeId: stableIdSchema,
    maxWorkUnits: z.number().int().positive().optional(),
  }).strict(),
  z.object({
    kind: z.literal("inject-event"),
    event: harnessEventInputSchema,
  }).strict(),
  z.object({
    kind: z.literal("inject-mutations"),
    proposals: z.array(mutationProposalSchema),
    label: z.string().trim().min(1),
  }).strict(),
  z.object({
    kind: z.literal("execute-operation"),
    operationId: stableIdSchema,
    input: jsonValueSchema,
  }).strict(),
  z.object({
    kind: z.literal("execute-action"),
    request: playerActionRequestSchema,
  }).strict(),
  z.object({
    kind: z.literal("execute-conversation"),
    request: conversationTurnRequestSchema,
    bindings: z.object({
      recordCommunicationOperationId: stableIdSchema,
      applyConsequencesOperationId: stableIdSchema,
    }).strict(),
    workingState: conversationWorkingStateSchema.optional(),
  }).strict(),
]);
export type ReplayCommand = z.infer<typeof replayCommandSchema>;

export const reproductionBundleSchema = z.object({
  schemaVersion: z.literal(1),
  scenarioId: stableIdSchema,
  idNamespace: stableIdSchema,
  game: z.object({
    ruleset: z.object({ id: stableIdSchema, version: z.string().min(1) }).strict(),
    setting: z.object({ id: stableIdSchema, version: z.string().min(1) }).strict(),
    adapter: z.object({ id: stableIdSchema, version: z.string().min(1) }).strict(),
    campaign: z.object({ id: stableIdSchema, version: z.string().min(1) }).strict(),
    presentation: z.object({ id: stableIdSchema, version: z.string().min(1) }).strict(),
  }).strict(),
  seed: z.number().int().min(0).max(0xffff_ffff),
  startingSnapshot: z.object({
    revision: z.number().int().nonnegative(),
    eventSequence: z.number().int().nonnegative(),
    fictionalTime: fictionalInstantSchema,
    randomness: z.object({
      algorithm: z.literal("mulberry32-v1"),
      rootSeed: z.number().int().min(0).max(0xffff_ffff),
      nextStream: z.number().int().nonnegative(),
    }).strict(),
    state: worldStateSchema,
    history: z.array(canonicalEventSchema),
  }).strict(),
  commands: z.array(replayCommandSchema),
  finalSnapshot: z.object({
    revision: z.number().int().nonnegative(),
    eventSequence: z.number().int().nonnegative(),
    fictionalTime: fictionalInstantSchema,
    randomness: z.object({
      algorithm: z.literal("mulberry32-v1"),
      rootSeed: z.number().int().min(0).max(0xffff_ffff),
      nextStream: z.number().int().nonnegative(),
    }).strict(),
    state: worldStateSchema,
    history: z.array(canonicalEventSchema),
  }).strict(),
  traceLevel: traceLevelSchema,
  scriptedModelInvocations: z.array(jsonValueSchema).optional(),
  failure: z.string().optional(),
}).strict();
export type ReproductionBundle = z.infer<typeof reproductionBundleSchema>;

export interface ContextInspection {
  readonly request: ContextAssemblyRequest;
  readonly package: ContextPackage;
}

export interface ToolInspection {
  readonly domains: readonly {
    readonly id: string;
    readonly description: string;
    readonly subsystems: readonly {
      readonly id: string;
      readonly description: string;
      readonly tools: readonly {
        readonly id: string;
        readonly description: string;
        readonly contract: JsonValue;
      }[];
    }[];
  }[];
}

// Retain runtime schema ownership at the boundary where JSON callers enter.
export function validateContextRequest(input: unknown): ContextAssemblyRequest {
  return contextAssemblyRequestSchema.parse(input);
}

export function validateCanonicalEvent(input: unknown): CanonicalEvent {
  return canonicalEventSchema.parse(input);
}

export type ExecuteActionInput = PlayerActionRequest;
