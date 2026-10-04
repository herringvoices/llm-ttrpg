import { z } from "zod";
import {
  createAuthoritativeGroundingCatalog,
  groundingReferenceSchema,
  type GroundingReference,
} from "./content-planning.js";
import { contextItemSchema, type ContextItem } from "./context-contracts.js";
import type { CanonicalEvent } from "./events.js";
import { stableIdSchema } from "./identity.js";
import { jsonValueSchema, type JsonValue } from "./json.js";
import type { ModelInvocationOptions, ModelRuntime } from "./model-runtime.js";
import { fictionalInstantSchema } from "./time.js";
import type { WorldState } from "./world.js";

export const planningHorizonSchema = z.enum(["high", "medium", "low"]);
export type PlanningHorizon = z.infer<typeof planningHorizonSchema>;

export const narrativeThreadStatusSchema = z.enum(["active", "dormant", "retired"]);
export const planningAssumptionStatusSchema = z.enum(["valid", "invalid", "unknown"]);

const authoritativeBasisSchema = z.object({
  worldRevision: z.number().int().nonnegative(),
  eventSequence: z.number().int().nonnegative(),
}).strict();

export const planningAssumptionSchema = z.object({
  id: stableIdSchema,
  summary: z.string().trim().min(1),
  validation: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("equals"),
      reference: groundingReferenceSchema,
      expectedValue: jsonValueSchema,
    }).strict(),
    z.object({
      kind: z.literal("exists"),
      reference: groundingReferenceSchema,
      expected: z.boolean(),
    }).strict(),
    z.object({
      kind: z.literal("heuristic"),
      evidence: z.array(groundingReferenceSchema).min(1),
      rationale: z.string().trim().min(1),
    }).strict(),
  ]),
  status: planningAssumptionStatusSchema,
  lastEvaluatedAt: authoritativeBasisSchema,
}).strict();
export type PlanningAssumption = z.infer<typeof planningAssumptionSchema>;

export const conditionalDevelopmentSchema = z.object({
  id: stableIdSchema,
  summary: z.string().trim().min(1),
  condition: z.string().trim().min(1),
  grounding: z.array(groundingReferenceSchema).min(1),
  rationale: z.string().trim().min(1),
}).strict();
export type ConditionalDevelopment = z.infer<typeof conditionalDevelopmentSchema>;

export const narrativeThreadSchema = z.object({
  id: stableIdSchema,
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  kind: stableIdSchema,
  horizon: planningHorizonSchema,
  priority: z.number().int().min(0).max(100),
  status: narrativeThreadStatusSchema,
  grounding: z.array(groundingReferenceSchema).min(1),
  related: z.array(groundingReferenceSchema).default([]),
  playerInterestIds: z.array(stableIdSchema).default([]),
  currentTension: z.string().trim().min(1),
  assumptions: z.array(planningAssumptionSchema).default([]),
  conditionalDevelopments: z.array(conditionalDevelopmentSchema).default([]),
  lastReviewedAt: authoritativeBasisSchema,
  rationale: z.string().trim().min(1),
}).strict();
export type NarrativeThread = z.infer<typeof narrativeThreadSchema>;

export const playerGoalSchema = z.object({
  id: stableIdSchema,
  summary: z.string().trim().min(1),
  grounding: z.array(groundingReferenceSchema).min(1),
  active: z.boolean(),
}).strict();
export type PlayerGoal = z.infer<typeof playerGoalSchema>;

export const playerInterestSignalSchema = z.object({
  id: stableIdSchema,
  subjectId: stableIdSchema,
  direction: z.enum(["engaged", "avoided"]),
  strength: z.number().int().min(1).max(100),
  confidence: z.number().int().min(1).max(100),
  evidence: z.array(groundingReferenceSchema).min(1),
  lastReviewedAt: authoritativeBasisSchema,
}).strict();
export type PlayerInterestSignal = z.infer<typeof playerInterestSignalSchema>;

export const planHorizonStateSchema = z.object({
  summary: z.string().trim().min(1),
  attention: z.array(z.string().trim().min(1)),
  threadIds: z.array(stableIdSchema),
}).strict();

export const campaignPlanDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  planRevision: z.number().int().nonnegative(),
  basedOnWorldRevision: z.number().int().nonnegative(),
  basedOnEventSequence: z.number().int().nonnegative(),
  updatedAtFictionalTime: fictionalInstantSchema,
  horizons: z.object({
    high: planHorizonStateSchema,
    medium: planHorizonStateSchema,
    low: planHorizonStateSchema,
  }).strict(),
  threads: z.array(narrativeThreadSchema),
  playerGoals: z.array(playerGoalSchema),
  interestSignals: z.array(playerInterestSignalSchema),
}).strict().superRefine((plan, context) => {
  const threadIds = new Set<string>();
  const assumptionIds = new Set<string>();
  const developmentIds = new Set<string>();
  const interestIds = new Set(plan.interestSignals.map((signal) => signal.id));
  for (const [index, thread] of plan.threads.entries()) {
    if (threadIds.has(thread.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate thread ${thread.id}`, path: ["threads", index, "id"] });
    }
    threadIds.add(thread.id);
    for (const interestId of thread.playerInterestIds) {
      if (!interestIds.has(interestId)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown interest signal ${interestId}`, path: ["threads", index, "playerInterestIds"] });
    }
    for (const assumption of thread.assumptions) {
      if (assumptionIds.has(assumption.id)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate assumption ${assumption.id}`, path: ["threads", index, "assumptions"] });
      assumptionIds.add(assumption.id);
    }
    for (const development of thread.conditionalDevelopments) {
      if (developmentIds.has(development.id)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate development ${development.id}`, path: ["threads", index, "conditionalDevelopments"] });
      developmentIds.add(development.id);
    }
  }
  for (const horizon of planningHorizonSchema.options) {
    const listed = plan.horizons[horizon].threadIds;
    if (new Set(listed).size !== listed.length) context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate ${horizon} thread reference`, path: ["horizons", horizon, "threadIds"] });
    for (const threadId of listed) {
      const thread = plan.threads.find((candidate) => candidate.id === threadId);
      if (!thread || thread.horizon !== horizon) context.addIssue({ code: z.ZodIssueCode.custom, message: `Thread ${threadId} is missing or belongs to another horizon`, path: ["horizons", horizon, "threadIds"] });
    }
    for (const thread of plan.threads.filter((candidate) => candidate.horizon === horizon)) {
      if (!listed.includes(thread.id)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Thread ${thread.id} is not linked from its horizon`, path: ["horizons", horizon, "threadIds"] });
    }
  }
});
export type CampaignPlanDocument = z.infer<typeof campaignPlanDocumentSchema>;

export const planningSignalSchema = z.object({
  id: stableIdSchema,
  kind: stableIdSchema,
  minimumHorizon: planningHorizonSchema,
  summary: z.string().trim().min(1),
  grounding: z.array(groundingReferenceSchema).min(1),
  sourceWorldRevision: z.number().int().nonnegative(),
  sourceEventSequence: z.number().int().nonnegative(),
  salience: z.number().int().min(1).max(100),
  createdAtFictionalTime: fictionalInstantSchema,
}).strict();
export type PlanningSignal = z.infer<typeof planningSignalSchema>;

const threadMutationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("upsert-thread"), thread: narrativeThreadSchema }).strict(),
  z.object({ kind: z.literal("remove-thread"), threadId: stableIdSchema }).strict(),
  z.object({ kind: z.literal("set-horizon"), summary: z.string().trim().min(1), attention: z.array(z.string().trim().min(1)) }).strict(),
  z.object({ kind: z.literal("upsert-player-goal"), goal: playerGoalSchema }).strict(),
  z.object({ kind: z.literal("upsert-interest-signal"), signal: playerInterestSignalSchema }).strict(),
  z.object({ kind: z.literal("remove-interest-signal"), signalId: stableIdSchema }).strict(),
  z.object({ kind: z.literal("request-escalation"), to: planningHorizonSchema, reason: z.string().trim().min(1) }).strict(),
]);
export const planMutationSchema = threadMutationSchema;
export type PlanMutation = z.infer<typeof planMutationSchema>;

export const planMutationProposalSchema = z.object({
  requestedHorizon: planningHorizonSchema,
  basedOnPlanRevision: z.number().int().nonnegative(),
  basedOnWorldRevision: z.number().int().nonnegative(),
  basedOnEventSequence: z.number().int().nonnegative(),
  consumedSignalIds: z.array(stableIdSchema),
  mutations: z.array(planMutationSchema),
  rationale: z.string().trim().min(1),
}).strict();
export type PlanMutationProposal = z.infer<typeof planMutationProposalSchema>;

export const planRevisionDiagnosticSchema = z.object({
  planRevisionBefore: z.number().int().nonnegative(),
  planRevisionAfter: z.number().int().nonnegative(),
  basedOnWorldRevision: z.number().int().nonnegative(),
  basedOnEventSequence: z.number().int().nonnegative(),
  signalsConsumed: z.array(stableIdSchema),
  horizonReviewed: planningHorizonSchema,
  assumptionsEvaluated: z.array(stableIdSchema),
  assumptionsInvalidated: z.array(stableIdSchema),
  threadChanges: z.array(z.string().min(1)),
  interestSignalChanges: z.array(z.string().min(1)),
  escalationRequested: planningHorizonSchema.optional(),
  rationale: z.string().min(1),
  repairAttempted: z.boolean(),
  canonicalMutationCount: z.literal(0),
}).strict();
export type PlanRevisionDiagnostic = z.infer<typeof planRevisionDiagnosticSchema>;

export class PlannerValidationError extends Error {
  override readonly name: string = "PlannerValidationError";
}
export class PlannerStaleProposalError extends PlannerValidationError {
  override readonly name = "PlannerStaleProposalError";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createEmptyCampaignPlan(input: {
  readonly worldRevision: number;
  readonly eventSequence: number;
  readonly fictionalTime: string;
}): CampaignPlanDocument {
  return campaignPlanDocumentSchema.parse({
    schemaVersion: 1,
    planRevision: 0,
    basedOnWorldRevision: input.worldRevision,
    basedOnEventSequence: input.eventSequence,
    updatedAtFictionalTime: input.fictionalTime,
    horizons: {
      high: { summary: "No high-horizon direction established yet.", attention: [], threadIds: [] },
      medium: { summary: "No medium-horizon direction established yet.", attention: [], threadIds: [] },
      low: { summary: "No low-horizon direction established yet.", attention: [], threadIds: [] },
    },
    threads: [],
    playerGoals: [],
    interestSignals: [],
  });
}

export interface AssumptionValidationResult {
  readonly plan: CampaignPlanDocument;
  readonly evaluatedIds: readonly string[];
  readonly invalidatedIds: readonly string[];
  readonly signals: readonly PlanningSignal[];
}

export function validatePlanningAssumptions(input: {
  readonly plan: CampaignPlanDocument;
  readonly world: WorldState;
  readonly history?: readonly CanonicalEvent[];
  readonly worldRevision: number;
  readonly eventSequence: number;
}): AssumptionValidationResult {
  const plan = campaignPlanDocumentSchema.parse(input.plan);
  const catalog = createAuthoritativeGroundingCatalog(input.world, input.history ?? []);
  const evaluatedIds: string[] = [];
  const invalidatedIds: string[] = [];
  const signals: PlanningSignal[] = [];
  const threads = plan.threads.map((thread) => ({
    ...thread,
    assumptions: thread.assumptions.map((assumption) => {
      if (assumption.validation.kind === "heuristic") return assumption;
      evaluatedIds.push(assumption.id);
      const resolved = catalog.resolve(assumption.validation.reference);
      const valid = assumption.validation.kind === "exists"
        ? (resolved !== undefined) === assumption.validation.expected
        : resolved !== undefined && sameJson(resolved, assumption.validation.expectedValue);
      const status = valid ? "valid" as const : "invalid" as const;
      if (!valid) {
        invalidatedIds.push(assumption.id);
        signals.push(planningSignalSchema.parse({
          id: `assumption-invalidated.${assumption.id}.${input.worldRevision}`,
          kind: "assumption-invalidated",
          minimumHorizon: thread.horizon,
          summary: `Assumption no longer holds: ${assumption.summary}`,
          grounding: [assumption.validation.reference],
          sourceWorldRevision: input.worldRevision,
          sourceEventSequence: input.eventSequence,
          salience: 100,
          createdAtFictionalTime: input.world.fictionalTime,
        }));
      }
      return {
        ...assumption,
        status,
        lastEvaluatedAt: { worldRevision: input.worldRevision, eventSequence: input.eventSequence },
      };
    }),
  }));
  return {
    plan: campaignPlanDocumentSchema.parse({ ...plan, threads }),
    evaluatedIds,
    invalidatedIds,
    signals,
  };
}

function validateGrounding(plan: CampaignPlanDocument, world: WorldState, history: readonly CanonicalEvent[]): void {
  const catalog = createAuthoritativeGroundingCatalog(world, history);
  const references: GroundingReference[] = [
    ...plan.threads.flatMap((thread) => [
      ...thread.grounding,
      ...thread.related,
      ...thread.assumptions.flatMap((assumption) => assumption.validation.kind === "heuristic" ? assumption.validation.evidence : [assumption.validation.reference]),
      ...thread.conditionalDevelopments.flatMap((development) => development.grounding),
    ]),
    ...plan.playerGoals.flatMap((goal) => goal.grounding),
    ...plan.interestSignals.flatMap((signal) => signal.evidence),
  ];
  const missing = references.find((reference) => !catalog.has(reference));
  if (missing) throw new PlannerValidationError(`Missing authoritative grounding ${missing.kind}:${missing.id}`);
}

function permittedEscalation(from: PlanningHorizon): PlanningHorizon | undefined {
  return from === "low" ? "medium" : from === "medium" ? "high" : undefined;
}

export function applyPlanMutationProposal(input: {
  readonly plan: CampaignPlanDocument;
  readonly proposal: PlanMutationProposal;
  readonly signals: readonly PlanningSignal[];
  readonly world: WorldState;
  readonly history?: readonly CanonicalEvent[];
  readonly worldRevision: number;
  readonly eventSequence: number;
  readonly assumptionValidation?: AssumptionValidationResult;
}): { readonly plan: CampaignPlanDocument; readonly diagnostic: PlanRevisionDiagnostic } {
  const current = campaignPlanDocumentSchema.parse(input.plan);
  const proposal = planMutationProposalSchema.parse(input.proposal);
  if (proposal.basedOnPlanRevision !== current.planRevision || proposal.basedOnWorldRevision !== input.worldRevision || proposal.basedOnEventSequence !== input.eventSequence) {
    throw new PlannerStaleProposalError("Planner proposal is stale against the current plan or authoritative basis");
  }
  const knownSignals = new Set(input.signals.map((signal) => planningSignalSchema.parse(signal).id));
  if (proposal.consumedSignalIds.some((id) => !knownSignals.has(id))) {
    throw new PlannerValidationError("Planner proposal consumes an unknown signal");
  }
  let threads = clone(input.assumptionValidation?.plan.threads ?? current.threads);
  let playerGoals = clone(current.playerGoals);
  let interestSignals = clone(current.interestSignals);
  const horizons = clone(current.horizons);
  const threadChanges: string[] = [];
  const interestSignalChanges: string[] = [];
  let escalationRequested: PlanningHorizon | undefined;
  for (const mutation of proposal.mutations) {
    if (mutation.kind === "upsert-thread") {
      if (mutation.thread.horizon !== proposal.requestedHorizon) throw new PlannerValidationError("A planner pass cannot write another horizon");
      const existing = threads.findIndex((thread) => thread.id === mutation.thread.id);
      if (existing >= 0 && threads[existing]!.horizon !== proposal.requestedHorizon) throw new PlannerValidationError("Thread promotion or demotion must be performed by the destination horizon pass");
      if (existing >= 0) threads[existing] = clone(mutation.thread); else threads.push(clone(mutation.thread));
      threadChanges.push(`${mutation.kind}:${mutation.thread.id}`);
    } else if (mutation.kind === "remove-thread") {
      const existing = threads.find((thread) => thread.id === mutation.threadId);
      if (!existing || existing.horizon !== proposal.requestedHorizon) throw new PlannerValidationError("A planner pass cannot remove another horizon's thread");
      threads = threads.filter((thread) => thread.id !== mutation.threadId);
      threadChanges.push(`${mutation.kind}:${mutation.threadId}`);
    } else if (mutation.kind === "set-horizon") {
      horizons[proposal.requestedHorizon] = { ...horizons[proposal.requestedHorizon], summary: mutation.summary, attention: mutation.attention };
    } else if (mutation.kind === "upsert-player-goal") {
      const existing = playerGoals.findIndex((goal) => goal.id === mutation.goal.id);
      if (existing >= 0) playerGoals[existing] = clone(mutation.goal); else playerGoals.push(clone(mutation.goal));
    } else if (mutation.kind === "upsert-interest-signal") {
      const existing = interestSignals.findIndex((signal) => signal.id === mutation.signal.id);
      if (existing >= 0) interestSignals[existing] = clone(mutation.signal); else interestSignals.push(clone(mutation.signal));
      interestSignalChanges.push(`${mutation.kind}:${mutation.signal.id}`);
    } else if (mutation.kind === "remove-interest-signal") {
      interestSignals = interestSignals.filter((signal) => signal.id !== mutation.signalId);
      interestSignalChanges.push(`${mutation.kind}:${mutation.signalId}`);
    } else {
      const permitted = permittedEscalation(proposal.requestedHorizon);
      if (!permitted || mutation.to !== permitted) throw new PlannerValidationError("Invalid planner horizon escalation");
      escalationRequested = mutation.to;
    }
  }
  for (const horizon of planningHorizonSchema.options) {
    horizons[horizon].threadIds = threads.filter((thread) => thread.horizon === horizon).map((thread) => thread.id);
  }
  const plan = campaignPlanDocumentSchema.parse({
    ...current,
    planRevision: current.planRevision + 1,
    basedOnWorldRevision: input.worldRevision,
    basedOnEventSequence: input.eventSequence,
    updatedAtFictionalTime: input.world.fictionalTime,
    horizons,
    threads,
    playerGoals,
    interestSignals,
  });
  validateGrounding(plan, input.world, input.history ?? []);
  return {
    plan,
    diagnostic: planRevisionDiagnosticSchema.parse({
      planRevisionBefore: current.planRevision,
      planRevisionAfter: plan.planRevision,
      basedOnWorldRevision: input.worldRevision,
      basedOnEventSequence: input.eventSequence,
      signalsConsumed: proposal.consumedSignalIds,
      horizonReviewed: proposal.requestedHorizon,
      assumptionsEvaluated: input.assumptionValidation?.evaluatedIds ?? [],
      assumptionsInvalidated: input.assumptionValidation?.invalidatedIds ?? [],
      threadChanges,
      interestSignalChanges,
      ...(escalationRequested ? { escalationRequested } : {}),
      rationale: proposal.rationale,
      repairAttempted: false,
      canonicalMutationCount: 0,
    }),
  };
}

export function createCampaignPlanContextItem(planValue: CampaignPlanDocument): ContextItem {
  const plan = campaignPlanDocumentSchema.parse(planValue);
  return contextItemSchema.parse({
    localId: `campaign-plan.${plan.planRevision}`,
    kind: "campaign-plan-attention",
    salience: "prominent",
    content: plan,
    provenance: { sourceKind: "plan", sourceIds: [`campaign-plan.${plan.planRevision}`], worldRevision: plan.basedOnWorldRevision },
    access: {
      audience: ["planner", "orchestrator", "debug"],
      perspective: { kind: "canonical" },
      actorAware: false,
      identityRecognized: true,
      privileged: true,
    },
    derivation: "raw",
    relevance: 100,
  });
}

export interface PlannerPassResult {
  readonly ok: boolean;
  readonly proposal?: PlanMutationProposal;
  readonly plan?: CampaignPlanDocument;
  readonly diagnostic?: PlanRevisionDiagnostic;
  readonly error?: string;
  readonly repairAttempted: boolean;
}

export async function runPlannerPass(input: {
  readonly modelRuntime: ModelRuntime;
  readonly plan: CampaignPlanDocument;
  readonly horizon: PlanningHorizon;
  readonly signals: readonly PlanningSignal[];
  readonly world: WorldState;
  readonly history?: readonly CanonicalEvent[];
  readonly worldRevision: number;
  readonly eventSequence: number;
  readonly guidance?: readonly string[];
  readonly authoritativeContext?: JsonValue;
  readonly options?: ModelInvocationOptions;
}): Promise<PlannerPassResult> {
  const validation = validatePlanningAssumptions(input);
  const promptContext: JsonValue = jsonValueSchema.parse({
    requestedHorizon: input.horizon,
    plan: validation.plan,
    signals: input.signals,
    assumptionValidation: { evaluatedIds: validation.evaluatedIds, invalidatedIds: validation.invalidatedIds },
    authoritativeBasis: { worldRevision: input.worldRevision, eventSequence: input.eventSequence },
    ...(input.authoritativeContext === undefined
      ? {}
      : { authoritativeContext: input.authoritativeContext }),
  });
  let lastError = "Planner model failed";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await input.modelRuntime.generate({
      prompt: {
        instructions: [
          "Propose only structured mutations to hidden non-authoritative campaign planning state.",
          "Never create canonical facts, events, actions, or required player choices.",
          "Write only the requested horizon; request escalation instead of changing a higher horizon.",
          ...(input.guidance ?? []),
          ...(attempt === 1 ? [`Repair the prior invalid proposal: ${lastError}`] : []),
        ],
        context: JSON.stringify(promptContext),
        input: `Review the ${input.horizon} campaign-planning horizon.`,
      },
      output: { kind: "structured", schemaId: "campaign-plan-mutation-proposal.v1", schema: planMutationProposalSchema },
      trace: { operation: "campaign-planner", invocationId: `planner.${input.plan.planRevision}.${input.horizon}.${attempt}` },
    }, input.options);
    if (!result.ok) {
      lastError = result.error.message;
      if (result.error.kind !== "invalid-output") break;
      continue;
    }
    try {
      const proposal = planMutationProposalSchema.parse(result.output.value);
      const applied = applyPlanMutationProposal({
        ...input,
        proposal,
        assumptionValidation: validation,
      });
      return {
        ok: true,
        proposal,
        plan: applied.plan,
        diagnostic: { ...applied.diagnostic, repairAttempted: attempt === 1 },
        repairAttempted: attempt === 1,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Invalid planner proposal";
    }
  }
  return { ok: false, error: lastError, repairAttempted: true };
}
