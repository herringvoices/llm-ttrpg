import { z } from "zod";
import {
  applyPlanMutationProposal,
  campaignPlanDocumentSchema,
  validatePlanningAssumptions,
  type CampaignPlanDocument,
  type NarrativeThread,
  type PlanningHorizon,
  type PlanningSignal,
  type PlanRevisionDiagnostic,
} from "./campaign-planning.js";
import {
  createAuthoritativeGroundingCatalog,
  groundingReferenceKey,
  type GroundingReference,
} from "./content-planning.js";
import type { CanonicalEvent } from "./events.js";
import type { ModelRuntime } from "./model-runtime.js";
import type { WorldState } from "./world.js";

type Basis = { readonly worldRevision: number; readonly eventSequence: number };
type ChangedSource = { readonly reference: GroundingReference; readonly horizon: PlanningHorizon };
export type PlanningBoundaryReason =
  | "material-source" | "material-event" | "scene-transition" | "downtime" | "deferred";

const MAX_DIRECTION_CHARS = 3_200;
const MAX_THREADS = 5;
const MAX_EVENTS = 12;

/** Hidden GM-only, non-authoritative direction. Nothing here belongs in NPC
 * or narrator prompts. Stable canonical references stay in the engine sidecar. */
export function projectCampaignDirection(planInput: CampaignPlanDocument, horizon: PlanningHorizon = "low") {
  const plan = campaignPlanDocumentSchema.parse(planInput);
  const sorted = plan.threads.filter((thread) => thread.status === "active")
    .sort((a, b) => (a.horizon === horizon ? -1 : 0) - (b.horizon === horizon ? -1 : 0)
      || b.priority - a.priority || a.id.localeCompare(b.id)).slice(0, MAX_THREADS);
  const threadRefs = new Map<string, string>();
  const threads = sorted.map((thread, index) => {
    const ref = `thread.${index + 1}`;
    threadRefs.set(ref, thread.id);
    return {
      ref, horizon: thread.horizon, title: thread.title.slice(0, 110),
      currentTension: thread.currentTension.slice(0, 220),
      priority: thread.priority,
      opportunities: thread.conditionalDevelopments.slice(0, 1).map((development) =>
        development.summary.slice(0, 180)),
    };
  });
  const base = {
    role: "private-campaign-direction",
    authority: "Suggestions only; simulation determines reality and the player chooses their actions.",
    horizon,
    presentSituation: plan.horizons.low.summary.slice(0, 260),
    widerTension: plan.horizons.medium.summary.slice(0, 180),
    longTerm: plan.horizons.high.summary.slice(0, 160),
    playerStatedGoals: plan.playerGoals.filter((goal) => goal.active).slice(0, 3)
      .map((goal) => goal.summary.slice(0, 160)),
  };
  // Fit a hard bound by *omitting* optional threads, never truncating serialized
  // JSON into an invalid prompt. Unselected threads cannot be revised by the model.
  let selected = [...threads];
  let modelText = JSON.stringify({ ...base, threads: selected });
  while (modelText.length > MAX_DIRECTION_CHARS && selected.length > 0) {
    selected = selected.slice(0, -1);
    modelText = JSON.stringify({ ...base, threads: selected });
  }
  const allowed = new Set(selected.map((thread) => thread.ref));
  return {
    modelText: modelText.slice(0, MAX_DIRECTION_CHARS),
    threadIdsByRef: new Map([...threadRefs].filter(([ref]) => allowed.has(ref))),
    diagnostics: {
      serializedCharacters: modelText.length,
      selectedThreads: selected.length,
      omittedThreads: plan.threads.length - selected.length,
      sourceReferences: selected.map((thread) => ({
        ref: thread.ref, id: threadRefs.get(thread.ref)!, visibility: "gm-only" as const,
      })),
    },
  };
}

function record(world: WorldState, ref: GroundingReference): unknown {
  switch (ref.kind) {
    case "entity": return world.entities.find((v) => v.id === ref.id);
    case "fact": return world.facts.find((v) => v.id === ref.id);
    case "belief": return world.beliefs.find((v) => v.id === ref.id);
    case "document": return world.documents.find((v) => v.id === ref.id);
    case "actor-social-state": return world.actorSocialStates.find((v) => v.actorId === ref.id);
    case "actor-goal": return world.actorSocialStates.flatMap((v) => v.goals).find((v) => v.id === ref.id);
    case "actor-relationship": return world.actorSocialStates.flatMap((v) => v.relationships).find((v) => v.id === ref.id);
    case "actor-memory": return world.actorSocialStates.flatMap((v) => v.memories).find((v) => v.id === ref.id);
    case "actor-commitment": return world.actorSocialStates.flatMap((v) => v.commitments).find((v) => v.id === ref.id);
    case "mechanical-realization": return world.mechanicalRealizations.find((v) => v.entityId === ref.id);
    case "scheduled-trigger": return world.scheduledTriggers.find((v) => v.id === ref.id);
    case "simulation-scope": return world.simulationCursors.find((v) => v.scopeId === ref.id);
    default: return undefined; // Event refs are checked against bounded event receipts.
  }
}

function atPath(root: unknown, path?: readonly (string | number)[]): unknown {
  let value: unknown = root;
  for (const segment of path ?? []) {
    if (value === undefined || value === null || typeof value !== "object") return undefined;
    value = (value as Record<string | number, unknown>)[segment];
  }
  return value;
}

/** Compare only indexed plan-owned references, not the full world or event log. */
export function changedPlanningSources(
  plan: CampaignPlanDocument, before: WorldState, after: WorldState,
): readonly ChangedSource[] {
  const candidates: ChangedSource[] = [];
  for (const thread of plan.threads.filter((item) => item.status === "active")) {
    for (const reference of [
      ...thread.grounding, ...thread.related,
      ...thread.assumptions.flatMap((assumption) =>
        assumption.validation.kind === "heuristic" ? assumption.validation.evidence
          : [assumption.validation.reference]),
    ]) {
      if (reference.kind === "event") continue;
      // A broad entity/actor record is intentionally compared as a root; a
      // narrower assumption path is tracked independently below.
      if (JSON.stringify(atPath(record(before, reference), reference.path)) !==
          JSON.stringify(atPath(record(after, reference), reference.path))) {
        candidates.push({ reference, horizon: thread.horizon });
      }
    }
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.horizon + groundingReferenceKey(candidate.reference);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

const materialEventTypes = /(?:first-power-manifested|opening-incident-realized|material-disclosure|commitment-created|agreement-reached|goal-adopted|goal-refused|relationship-changed|status-changed|mystery-discovered|secret-revealed)$/;
const horizonOrder: readonly PlanningHorizon[] = ["low", "medium", "high"];

/** A cheap deterministic review gate; event receipts are already bounded by
 * the caller and never interpreted as proof of an unobserved fact. */
export function selectCampaignReview(input: {
  readonly plan: CampaignPlanDocument;
  readonly before: WorldState;
  readonly after: WorldState;
  readonly beforeLocationId?: string;
  readonly afterLocationId?: string;
  readonly playerActorId: string;
  readonly events?: readonly CanonicalEvent[];
  readonly basis: Basis;
  readonly deferUntilBoundary?: boolean;
}): {
  readonly reason?: PlanningBoundaryReason;
  readonly horizon: PlanningHorizon;
  readonly changedRefs: readonly GroundingReference[];
  readonly signals: readonly PlanningSignal[];
} {
  const changed = changedPlanningSources(input.plan, input.before, input.after);
  const relevantIds = new Set(input.plan.threads.filter((thread) => thread.status === "active")
    .flatMap((thread) => [...thread.grounding, ...thread.related].map((ref) => ref.id)));
  const relevantEvents = (input.events ?? []).filter((event) =>
    materialEventTypes.test(event.type) &&
    (event.relatedEntityIds.some((id) => relevantIds.has(id)) ||
      event.scopeIds.some((id) => relevantIds.has(id)))
  ).slice(0, MAX_EVENTS);
  const sceneChanged = input.beforeLocationId !== input.afterLocationId;
  const elapsed = Date.parse(input.after.fictionalTime) - Date.parse(input.before.fictionalTime);
  const meaningfulDowntime = elapsed >= 24 * 60 * 60 * 1_000;
  const active = input.plan.threads.some((thread) => thread.status === "active");
  const boundary = sceneChanged || meaningfulDowntime;
  const reason: PlanningBoundaryReason | undefined = changed.length > 0
    ? "material-source" : relevantEvents.length > 0 ? "material-event"
    : boundary && active && input.deferUntilBoundary ? "deferred"
    : sceneChanged && active ? "scene-transition"
    : meaningfulDowntime && active ? "downtime" : undefined;
  const horizon = changed.length
    ? [...changed.map((v) => v.horizon)].sort((a, b) =>
        horizonOrder.indexOf(a) - horizonOrder.indexOf(b))[0]!
    : "low";
  if (!reason) return { horizon, changedRefs: [], signals: [] };
  // Scene/downtime prompts need a verified grounding anchor even if no
  // individual plan source changed.
  const changes = changed.map((item) => item.reference);
  const grounding = changes[0] ?? relevantEvents.map((event) => ({
    kind: "event" as const, id: event.id,
  }))[0] ?? { kind: "entity" as const, id: input.playerActorId };
  const signal: PlanningSignal = {
    id: `planning.${reason}.${input.basis.worldRevision}.${input.basis.eventSequence}`,
    kind: reason,
    minimumHorizon: horizon,
    summary: reason === "scene-transition" ? "A new scene needs appropriate grounded attention."
      : reason === "downtime" ? "A substantial fictional-time boundary may change near-term opportunities."
      : reason === "material-event" ? "A relevant canonical event may change active direction."
      : "A referenced source changed; review only the affected direction.",
    grounding: [grounding],
    sourceWorldRevision: input.basis.worldRevision,
    sourceEventSequence: input.basis.eventSequence,
    salience: reason === "material-source" || reason === "material-event" ? 85 : 45,
    createdAtFictionalTime: input.after.fictionalTime,
  };
  return { reason, horizon, changedRefs: changes, signals: [signal] };
}

export const campaignDirectionDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("keep"), reason: z.string().max(220) }).strict(),
  z.object({
    kind: z.literal("revise-thread"),
    threadRef: z.string().regex(/^thread\.[1-5]$/),
    currentTension: z.string().trim().min(1).max(240),
    priority: z.number().int().min(0).max(100),
    horizonSummary: z.string().trim().min(1).max(260).optional(),
    reason: z.string().trim().min(1).max(220),
  }).strict(),
  z.object({
    kind: z.literal("retire-thread"),
    threadRef: z.string().regex(/^thread\.[1-5]$/),
    reason: z.string().trim().min(1).max(220),
  }).strict(),
  z.object({
    kind: z.literal("propose-opportunity"),
    threadRef: z.string().regex(/^thread\.[1-5]$/),
    opportunity: z.string().trim().min(1).max(220),
    condition: z.string().trim().min(1).max(220),
    reason: z.string().trim().min(1).max(220),
  }).strict(),
  z.object({ kind: z.literal("defer-escalation"), reason: z.string().trim().min(1).max(220) }).strict(),
]);
export type CampaignDirectionDecision = z.infer<typeof campaignDirectionDecisionSchema>;

export interface CampaignReviewDiagnostic {
  readonly reason: PlanningBoundaryReason;
  readonly evaluatedAssumptions: readonly string[];
  readonly invalidatedAssumptions: readonly string[];
  readonly historyQueryCount: number;
  readonly historyRecordsRead: number;
  readonly modelCalls: number;
  readonly contextCharacters: number;
  readonly selectedThreads: number;
  readonly decision: CampaignDirectionDecision["kind"] | "invalid";
  readonly planRevisionBefore: number;
  readonly planRevisionAfter: number;
  readonly noOp: boolean;
  readonly error?: string;
  readonly deferredEscalation?: boolean;
}

export async function reviewCampaignDirection(input: {
  readonly plan: CampaignPlanDocument;
  readonly world: WorldState;
  readonly history?: readonly CanonicalEvent[];
  readonly modelRuntime: ModelRuntime;
  readonly trigger: ReturnType<typeof selectCampaignReview>;
  readonly basis: Basis;
  readonly historyQueryCount?: number;
}): Promise<{
  readonly plan?: CampaignPlanDocument;
  readonly diagnostic: CampaignReviewDiagnostic;
  readonly revision?: PlanRevisionDiagnostic;
}> {
  const { plan, trigger, basis, world } = input;
  if (!trigger.reason) throw new Error("No material planning review was requested");
  const brief = projectCampaignDirection(plan, trigger.horizon);
  const evaluation = validatePlanningAssumptions({
    plan, world, history: input.history ?? [], ...basis,
    changedReferences: trigger.changedRefs,
  });
  const base: CampaignReviewDiagnostic = {
    reason: trigger.reason,
    evaluatedAssumptions: evaluation.evaluatedIds,
    invalidatedAssumptions: evaluation.invalidatedIds,
    historyQueryCount: input.historyQueryCount ?? 0,
    historyRecordsRead: input.history?.length ?? 0,
    modelCalls: 1,
    contextCharacters: brief.modelText.length,
    selectedThreads: brief.diagnostics.selectedThreads,
    decision: "invalid",
    planRevisionBefore: plan.planRevision,
    planRevisionAfter: plan.planRevision,
    noOp: true,
  };
  let response;
  try {
    response = await input.modelRuntime.generate({
      prompt: {
        instructions: [
          "You are a private, non-authoritative campaign direction reviewer, NOT a narrator or world simulator.",
          "Select only a currently listed thread reference. Preserve player agency and established goals.",
          "Never assert new world facts, compel scenes, promise outcomes or schedule world actions.",
          "Use existing grounded pressures for possible attention. Pacing and actual scenes belong to the narrator and simulation.",
          "Prefer keep when the signal does not materially affect direction. One decision, no chain or retry.",
        ],
        context: JSON.stringify({
          direction: JSON.parse(brief.modelText),
          signal: trigger.signals.slice(0, 2).map((s) => ({ reason: s.kind, summary: s.summary })),
          assumptionValidation: {
            evaluated: evaluation.evaluatedIds, invalidated: evaluation.invalidatedIds,
          },
        }),
        input: "Choose one bounded campaign-direction decision.",
      },
      output: {
        kind: "structured", schemaId: "campaign-direction-review.v1",
        schema: campaignDirectionDecisionSchema,
      },
      trace: { operation: "campaign-direction-review" },
    });
    if (!response.ok) throw new Error(response.error.message);
    const decision = campaignDirectionDecisionSchema.parse(response.output.value);
    if (decision.kind === "keep" || decision.kind === "defer-escalation") {
      return { diagnostic: { ...base, decision: decision.kind,
        ...(decision.kind === "defer-escalation" ? { deferredEscalation: true } : {}) } };
    }
    const id = brief.threadIdsByRef.get(decision.threadRef);
    const thread = evaluation.plan.threads.find((item) => item.id === id);
    if (!thread || thread.status !== "active" || thread.horizon !== trigger.horizon) {
      throw new Error("Reviewer selected an unavailable, inactive, or cross-horizon thread");
    }
    const reviewedAt = { worldRevision: basis.worldRevision, eventSequence: basis.eventSequence };
    const revised: NarrativeThread = {
      ...thread,
      lastReviewedAt: reviewedAt,
      rationale: decision.reason,
      ...(decision.kind === "revise-thread" ? {
        currentTension: decision.currentTension, priority: decision.priority,
      } : {}),
      ...(decision.kind === "retire-thread" ? { status: "retired" as const } : {}),
      ...(decision.kind === "propose-opportunity" ? {
        conditionalDevelopments: [...thread.conditionalDevelopments, {
          id: `development.review.${plan.planRevision + 1}.${thread.id}`,
          summary: decision.opportunity, condition: decision.condition,
          grounding: thread.grounding, rationale: decision.reason,
        }],
      } : {}),
    };
    const mutations: import("./campaign-planning.js").PlanMutation[] = [
      { kind: "upsert-thread", thread: revised },
    ];
    if (decision.kind === "revise-thread" && decision.horizonSummary) {
      mutations.push({ kind: "set-horizon",
        summary: decision.horizonSummary, attention: plan.horizons[trigger.horizon].attention });
    }
    const result = applyPlanMutationProposal({
      plan, world, history: input.history ?? [], ...basis,
      signals: [...trigger.signals, ...evaluation.signals],
      assumptionValidation: evaluation,
      proposal: {
        requestedHorizon: trigger.horizon,
        basedOnPlanRevision: plan.planRevision,
        basedOnWorldRevision: basis.worldRevision,
        basedOnEventSequence: basis.eventSequence,
        consumedSignalIds: trigger.signals.map((s) => s.id),
        mutations, rationale: decision.reason,
      },
    });
    return {
      plan: result.plan, revision: result.diagnostic,
      diagnostic: { ...base, decision: decision.kind, noOp: false,
        planRevisionAfter: result.plan.planRevision },
    };
  } catch (error) {
    return { diagnostic: { ...base, error: error instanceof Error ? error.message : String(error) } };
  }
}
