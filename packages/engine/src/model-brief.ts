import { z } from "zod";
import type { ContextPackage, KnowledgePerspective, SceneElement } from "./context-contracts.js";

/**
 * Small, purpose-specific model projections. Source assembly, knowledge checks,
 * and canonical-to-local aliases remain entirely within the engine.
 */
export const modelBriefPurposeSchema = z.enum([
  "routing",
  "action-interpretation",
  "operation-selection",
  "npc-response",
  "narration",
]);
export type ModelBriefPurpose = z.infer<typeof modelBriefPurposeSchema>;

export interface ModelBriefRequest {
  readonly purpose: ModelBriefPurpose;
  /** An already access-filtered actor/group context; never pass canonical context. */
  readonly context: ContextPackage;
  readonly perspective: Exclude<KnowledgePerspective, { kind: "canonical" }>;
  readonly requiredEntityIds?: readonly string[];
  readonly maxCharacters?: number;
  /** Public/actor-visible committed receipts, never proposal or private events. */
  readonly committedOutcomes?: readonly string[];
}

export interface PreparedModelBrief {
  readonly purpose: ModelBriefPurpose;
  readonly modelText: string;
  /** Engine-only mapping for this exact context snapshot. Never stringify with modelText. */
  readonly localReferences: Readonly<Record<string, string>>;
  readonly basis: {
    readonly worldRevision: number;
    readonly eventSequence?: number;
  };
  readonly diagnostics: {
    readonly serializedCharacters: number;
    readonly omittedCount: number;
    readonly requiredOverflow: boolean;
    readonly maxCharacters: number;
    readonly projector: "compact-v1";
  };
}

const DEFAULT_BUDGET: Record<ModelBriefPurpose, number> = {
  routing: 2_000,
  "action-interpretation": 4_000,
  "operation-selection": 5_000,
  "npc-response": 4_000,
  narration: 6_000,
};

/** Oversized *required* context is not silently cut down to fit a soft budget. */
const HARD_REQUIRED_LIMIT = 16_000;

function jsonLength(value: unknown): number {
  return JSON.stringify(value).length;
}

function samePerspective(
  a: KnowledgePerspective,
  b: Exclude<KnowledgePerspective, { kind: "canonical" }>,
): boolean {
  return a.kind === b.kind && a.id === b.id;
}

function cleanText(text: string, forbidden: readonly string[]): string {
  let safe = text;
  for (const id of forbidden) {
    if (id) safe = safe.split(id).join("[unavailable]");
  }
  return safe.trim();
}

interface SmallSceneElement {
  readonly localRef: string;
  readonly displayIdentity: string;
  readonly category: SceneElement["category"];
  readonly summary?: string;
}

function essential(
  element: SceneElement,
  requiredIds: ReadonlySet<string>,
  canonicalId: string | undefined,
  focalRef: string | undefined,
): boolean {
  return element.localRef === focalRef ||
    (canonicalId !== undefined && requiredIds.has(canonicalId)) ||
    element.activeInteraction ||
    (element.category === "condition" && element.prominence === "prominent");
}

/**
 * Never accepts an orchestrator/planner/debug context: those can expose
 * unrecognized identities and GM-only objects even when actorAware is false.
 * Use a fresh actor-context assembly for each stage from the same world revision.
 */
export function prepareModelBrief(request: ModelBriefRequest): PreparedModelBrief {
  const purpose = modelBriefPurposeSchema.parse(request.purpose);
  const context = request.context;
  const perspective = request.perspective;
  if (
    (perspective.kind !== "actor" && perspective.kind !== "group") ||
    context.bootstrap.role !== "actor" ||
    context.situation.role !== "actor" ||
    !samePerspective(context.bootstrap.perspective, perspective) ||
    !samePerspective(context.situation.perspective, perspective)
  ) {
    throw new Error("Model briefs require a matching, authorized actor/group context");
  }
  const maxCharacters = request.maxCharacters ?? DEFAULT_BUDGET[purpose];
  if (!Number.isInteger(maxCharacters) || maxCharacters <= 0) {
    throw new Error("Model brief budget must be a positive integer");
  }
  const forbidden = [...new Set(Object.values(context.diagnostics.localReferences))];
  const requiredIds = new Set(request.requiredEntityIds ?? []);
  const focalRef = context.situation.focalActorRef;
  // Current location is also an indispensable spatial anchor.
  const requiredRefs = new Set([focalRef, context.situation.locationRef].filter(Boolean));
  // A brief can only bind entities actually included in this authorized scene.
  const candidates = context.situation.scene.filter((element) =>
    !element.access.privileged &&
    element.access.actorAware &&
    samePerspective(element.access.perspective, perspective)
  );
  const items = candidates.map((element) => {
    const canonicalId = context.diagnostics.localReferences[element.localRef];
    const projected: SmallSceneElement = {
      localRef: element.localRef,
      displayIdentity: cleanText(element.displayIdentity, forbidden),
      category: element.category,
      ...(element.summary
        ? { summary: cleanText(element.summary, forbidden) }
        : {}),
    };
    return {
      element: projected,
      required: requiredRefs.has(element.localRef) ||
        essential(element, requiredIds, canonicalId, focalRef),
      canonicalId,
    };
  });

  const situation = context.situation;
  const recentQueryResults = context.retrieved
    .filter((item) => item.provenance.sourceKind === "tool-result" &&
      item.access.audience.includes("actor") &&
      !item.access.privileged &&
      samePerspective(item.access.perspective, perspective))
    .slice(0, 2)
    .map((item) => cleanText(JSON.stringify(item.content), forbidden))
    .filter((text) => text.length <= 1_200);
  const base = {
    situation: {
      fictionalTime: situation.fictionalTime,
      ...(situation.actionPressure && typeof situation.actionPressure === "object"
        ? { actionPressure: situation.actionPressure }
        : {}),
      ...(situation.locationRef ? { locationRef: situation.locationRef } : {}),
      ...(situation.focalActorRef ? { focalActorRef: situation.focalActorRef } : {}),
      ...(situation.executableIntent
        ? {
            action: {
              goal: cleanText(situation.executableIntent.goal, forbidden),
              targetRefs: situation.executableIntent.targetRefs,
              authorizedHorizonMs: situation.executableIntent.authorizedHorizonMs,
              wasNarrowed: situation.executableIntent.wasNarrowed,
            },
          }
        : {}),
      scene: [] as SmallSceneElement[],
    },
    ...(request.committedOutcomes?.length
      ? { committedOutcomes: request.committedOutcomes.map((summary) =>
          cleanText(summary, forbidden)
        ) }
      : {}),
    ...(recentQueryResults.length ? { recentQueryResults } : {}),
    note: "Unmentioned details are unknown, not absent. Never invent new canonical facts.",
  };
  // Fail safely if indispensable text cannot fit even the explicit hard ceiling.
  const essentialItems = items.filter((item) => item.required);
  const essentialPayload = {
    ...base,
    situation: { ...base.situation, scene: essentialItems.map((item) => item.element) },
  };
  if (jsonLength(essentialPayload) > HARD_REQUIRED_LIMIT) {
    throw new Error("Required authorized model-brief anchors exceed the hard safety ceiling");
  }
  const chosen = new Set(essentialItems.map((item) => item.element.localRef));
  // Relevance order was already deterministically established in assembleContext.
  for (const item of items) {
    if (item.required) continue;
    const scene = items.filter((candidate) =>
      chosen.has(candidate.element.localRef) ||
      candidate.element.localRef === item.element.localRef
    ).map((candidate) => candidate.element);
    if (jsonLength({ ...base, situation: { ...base.situation, scene } }) <= maxCharacters) {
      chosen.add(item.element.localRef);
    }
  }
  const scene = items.filter((item) => chosen.has(item.element.localRef))
    .map((item) => item.element);
  const modelText = JSON.stringify({
    ...base,
    situation: { ...base.situation, scene },
  });
  const references = Object.fromEntries(items
    .filter((item) => chosen.has(item.element.localRef) && item.canonicalId)
    .map((item) => [item.element.localRef, item.canonicalId!]));
  // No raw full-context object, access metadata, or canonical sidecar in the text.
  return {
    purpose,
    modelText,
    localReferences: references,
    basis: {
      worldRevision: context.diagnostics.worldRevision,
      ...(context.diagnostics.eventSequence !== undefined
        ? { eventSequence: context.diagnostics.eventSequence }
        : {}),
    },
    diagnostics: {
      serializedCharacters: modelText.length,
      omittedCount: items.length - scene.length +
        context.diagnostics.decisions.filter((d) => d.decision === "omitted").length,
      requiredOverflow: modelText.length > maxCharacters,
      maxCharacters,
      projector: "compact-v1",
    },
  };
}

/** Validate against this particular authorized brief, not today's generic scene. */
export function resolveBriefReference(
  brief: PreparedModelBrief,
  localRef: string,
  current: { readonly worldRevision: number; readonly eventSequence?: number },
): string {
  if (
    brief.basis.worldRevision !== current.worldRevision ||
    (brief.basis.eventSequence !== undefined &&
      current.eventSequence !== brief.basis.eventSequence)
  ) throw new Error("Stale model brief reference");
  if (!/^scene\.\d{3}$/.test(localRef)) throw new Error("Invalid model brief reference");
  const canonical = brief.localReferences[localRef];
  if (!canonical) throw new Error("Unknown or unauthorized model brief reference");
  return canonical;
}
