import { z } from "zod";
import {
  actionPressureLevelSchema,
  executableIntentSchema,
  interpretedIntentSchema,
  intentStopReasonSchema,
} from "./action-pressure.js";
import { contextBudgetSchema } from "./context-contracts.js";
import { canonicalEventSchema } from "./events.js";
import { componentIdentitySchema, stableIdSchema } from "./identity.js";
import { jsonValueSchema } from "./json.js";
import { mutationProposalSchema } from "./operations.js";
import { randomnessTraceSchema } from "./randomness.js";
import { resolutionPathSchema } from "./resolution.js";
import { semanticActionModeSchema, semanticActionSchema } from "./semantic-action.js";
import { fictionalDurationMsSchema } from "./time.js";

export const interpretedIntentDecisionSchema = z.object({
  kind: z.literal("interpreted"),
  goal: z.string().trim().min(1),
  targetRefs: z.array(stableIdSchema),
  modes: z.array(semanticActionModeSchema).min(1).default(["other"]),
  statedMeans: z.array(z.string().trim().min(1)).max(8).default([]),
  requestedHorizonMs: fictionalDurationMsSchema,
  pressureLevel: actionPressureLevelSchema,
}).strict();

export const playerDecisionRequiredSchema = z.object({
  kind: z.literal("player-decision-required"),
  question: z.string().trim().min(1),
}).strict();

export const intentInterpretationDecisionSchema = z.discriminatedUnion("kind", [
  interpretedIntentDecisionSchema,
  playerDecisionRequiredSchema,
]);
export type IntentInterpretationDecision = z.infer<
  typeof intentInterpretationDecisionSchema
>;

/** Engine-validated semantic interpretation from the shared turn classifier.
 * Canonical target IDs are never sent to or accepted from the model. */
export const preinterpretedPlayerActionSchema = z.object({
  declaration: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  targetIds: z.array(stableIdSchema),
  modes: z.array(semanticActionModeSchema).min(1),
  statedMeans: z.array(z.string().trim().min(1)).max(8),
  pressureLevel: actionPressureLevelSchema,
  requestedHorizonMs: fictionalDurationMsSchema,
  worldRevision: z.number().int().nonnegative(),
  eventSequence: z.number().int().nonnegative(),
}).strict();
export type PreinterpretedPlayerAction = z.infer<typeof preinterpretedPlayerActionSchema>;

export const executionDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("discover-subsystems"), domainId: stableIdSchema }).strict(),
  z.object({
    kind: z.literal("discover-tools"),
    domainId: stableIdSchema,
    subsystemId: stableIdSchema,
  }).strict(),
  z.object({ kind: z.literal("inspect-tool"), toolId: stableIdSchema }).strict(),
  z.object({
    kind: z.literal("invoke-tool"),
    toolId: stableIdSchema,
    arguments: jsonValueSchema,
  }).strict(),
  z.object({ kind: z.literal("stop"), reason: intentStopReasonSchema }).strict(),
]);
export type ExecutionDecision = z.infer<typeof executionDecisionSchema>;

export const committedOperationReceiptSchema = z.object({
  stepId: stableIdSchema,
  sequence: z.number().int().positive(),
  toolId: stableIdSchema,
  kind: z.enum(["ordinary-operation", "resolution-operation"]),
  sourceComponent: componentIdentitySchema,
  input: jsonValueSchema,
  result: jsonValueSchema,
  advanceTimeByMs: fictionalDurationMsSchema,
  mutations: z.array(mutationProposalSchema),
  events: z.array(canonicalEventSchema),
  resolution: z.object({
    path: resolutionPathSchema,
    basis: jsonValueSchema,
    randomness: randomnessTraceSchema.nullable(),
  }).strict().optional(),
  worldRevisionBefore: z.number().int().nonnegative(),
  worldRevisionAfter: z.number().int().positive(),
}).strict();
export type CommittedOperationReceipt = z.infer<
  typeof committedOperationReceiptSchema
>;

export const actionRunSchema = z.object({
  schemaVersion: z.literal(1),
  id: stableIdSchema,
  worldId: stableIdSchema,
  actorId: stableIdSchema,
  declaration: z.string().trim().min(1),
  interpretedIntent: interpretedIntentSchema,
  semanticAction: semanticActionSchema.optional(),
  executableIntent: executableIntentSchema,
  status: z.enum(["active", "stopped"]),
  elapsedMs: fictionalDurationMsSchema,
  lastWorldRevision: z.number().int().nonnegative(),
  receipts: z.array(committedOperationReceiptSchema),
  stopReason: intentStopReasonSchema.optional(),
  narration: z.string().min(1).optional(),
}).strict().superRefine((run, context) => {
  if (run.status === "stopped" && !run.stopReason) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Stopped action run requires a reason", path: ["stopReason"] });
  }
  if (run.status === "active" && run.stopReason) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Active action run cannot have a stop reason", path: ["stopReason"] });
  }
  const elapsed = run.receipts.reduce((sum, receipt) => sum + receipt.advanceTimeByMs, 0);
  if (elapsed !== run.elapsedMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Action elapsed time must equal committed receipt durations", path: ["elapsedMs"] });
  }
  for (const [index, receipt] of run.receipts.entries()) {
    if (receipt.sequence !== index + 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Receipt sequence must be contiguous", path: ["receipts", index, "sequence"] });
    }
  }
});
export type ActionRun = z.infer<typeof actionRunSchema>;

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function immutableRunCore(run: ActionRun) {
  return {
    schemaVersion: run.schemaVersion,
    id: run.id,
    worldId: run.worldId,
    actorId: run.actorId,
    declaration: run.declaration,
    interpretedIntent: run.interpretedIntent,
    executableIntent: run.executableIntent,
  };
}

export class ActionRunTransitionError extends Error {
  override readonly name = "ActionRunTransitionError";
}

/** Validates updates that must never rewrite authoritative execution receipts. */
export function validateActionRunMetadataUpdate(
  current: ActionRun,
  candidate: ActionRun,
): void {
  const before = actionRunSchema.parse(current);
  const after = actionRunSchema.parse(candidate);
  if (
    !sameJson(immutableRunCore(before), immutableRunCore(after)) ||
    !sameJson(before.receipts, after.receipts) ||
    before.elapsedMs !== after.elapsedMs ||
    before.lastWorldRevision !== after.lastWorldRevision
  ) {
    throw new ActionRunTransitionError(
      "A metadata update cannot rewrite action execution or receipts",
    );
  }
  if (before.status === "stopped" && after.status !== "stopped") {
    throw new ActionRunTransitionError("A stopped action run cannot be reactivated");
  }
  if (before.stopReason && before.stopReason !== after.stopReason) {
    throw new ActionRunTransitionError("An action run stop reason is immutable");
  }
  if (before.narration && before.narration !== after.narration) {
    throw new ActionRunTransitionError("Persisted narration is immutable");
  }
}

/** Validates the run transition included in one authoritative world commit. */
export function validateActionRunWorldCommit(
  current: ActionRun | undefined,
  candidate: ActionRun,
  worldRevisionBefore: number,
): void {
  const after = actionRunSchema.parse(candidate);
  if (after.lastWorldRevision !== worldRevisionBefore + 1) {
    throw new ActionRunTransitionError(
      "Committed action run revision must match the resulting world revision",
    );
  }
  if (!current) {
    if (after.status !== "active" || after.receipts.length !== 0 || after.elapsedMs !== 0) {
      throw new ActionRunTransitionError(
        "A new action run must begin active with no committed receipts",
      );
    }
    return;
  }
  const before = actionRunSchema.parse(current);
  if (!sameJson(immutableRunCore(before), immutableRunCore(after))) {
    throw new ActionRunTransitionError("An authoritative commit cannot change action identity or intent");
  }
  if (before.status !== "active" || after.status !== "active") {
    throw new ActionRunTransitionError("Authoritative steps require an active action run");
  }
  if (
    after.receipts.length !== before.receipts.length + 1 ||
    !sameJson(after.receipts.slice(0, -1), before.receipts)
  ) {
    throw new ActionRunTransitionError("An authoritative commit must append exactly one receipt");
  }
  const appended = after.receipts.at(-1)!;
  if (
    appended.worldRevisionBefore !== worldRevisionBefore ||
    appended.worldRevisionAfter !== worldRevisionBefore + 1
  ) {
    throw new ActionRunTransitionError("Receipt revisions do not match the world commit");
  }
}

export const playerActionRequestSchema = z.object({
  actionId: stableIdSchema,
  actorId: stableIdSchema,
  declaration: z.string().trim().min(1),
  locationId: stableIdSchema.optional(),
  budget: contextBudgetSchema,
}).strict();
export type PlayerActionRequest = z.infer<typeof playerActionRequestSchema>;

export const playerActionTraceEntrySchema = z.object({
  phase: z.enum([
    "context", "model", "pressure", "intent", "catalog", "query",
    "proposal", "rejection", "commit", "stop", "narration",
  ]),
  attempt: z.number().int().positive().optional(),
  worldRevision: z.number().int().nonnegative().optional(),
  detail: jsonValueSchema,
}).strict();
export type PlayerActionTraceEntry = z.infer<typeof playerActionTraceEntrySchema>;

export interface PlayerActionExecutionTrace {
  readonly entries: readonly PlayerActionTraceEntry[];
}

export interface PlayerActionDevelopmentSignal {
  readonly kind: "player-action-resolved";
  readonly actionId: string;
  readonly actorId: string;
  readonly goal: string;
  readonly stopReason: z.infer<typeof intentStopReasonSchema>;
  readonly elapsedMs: number;
  readonly operationIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly finalWorldRevision: number;
}

export interface PlayerActionPipelineFailure {
  readonly kind: "model" | "proposal" | "idempotency" | "external-revision" | "turn-limit" | "persistence";
  readonly message: string;
  readonly modelFailure?: import("./model-runtime.js").ModelFailure;
}

export type PlayerActionResult =
  | {
      readonly kind: "needs-player-input";
      readonly actionId: string;
      readonly question: string;
      readonly trace: PlayerActionExecutionTrace;
    }
  | {
      readonly kind: "resolved";
      readonly run: ActionRun;
      readonly narration?: string;
      readonly narrationFailure?: import("./model-runtime.js").ModelFailure;
      readonly developmentSignal: PlayerActionDevelopmentSignal;
      readonly trace: PlayerActionExecutionTrace;
    }
  | {
      readonly kind: "failed";
      readonly actionId: string;
      readonly failure: PlayerActionPipelineFailure;
      readonly run?: ActionRun;
      readonly developmentSignal?: PlayerActionDevelopmentSignal;
      readonly trace: PlayerActionExecutionTrace;
    };
