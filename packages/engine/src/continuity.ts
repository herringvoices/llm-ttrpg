import { z } from "zod";
import { stableIdSchema } from "./identity.js";
import { knowledgePerspectiveSchema } from "./context-contracts.js";
import { redactModelBriefText } from "./model-brief.js";
import type { WorldState } from "./world.js";
import type { CanonicalEvent } from "./events.js";
import type { ModelRuntime } from "./model-runtime.js";

/**
 * LM-07: derived, perspective-scoped memory. No source is written back into
 * WorldState. A point must always have a typed, currently authorized source.
 */
export const continuitySourceRefSchema = z.object({
  kind: z.enum(["player-established", "fact", "belief", "goal", "relationship", "memory", "commitment", "event"]),
  id: stableIdSchema,
}).strict();
export type ContinuitySourceRef = z.infer<typeof continuitySourceRefSchema>;
export const continuitySummarySchema = z.object({
  schemaVersion: z.literal(1),
  scope: z.object({
    kind: z.enum(["actor", "relationship", "location", "scene", "campaign"]),
    id: stableIdSchema.optional(),
  }).strict(),
  perspective: knowledgePerspectiveSchema.refine((value) => value.kind !== "canonical"),
  status: z.enum(["current", "stale", "blocked"]),
  summaryText: z.string().max(1_500),
  points: z.array(z.object({
    text: z.string().min(1).max(240),
    provenance: z.enum(["public-fact", "firsthand", "subjective-belief", "recorded-memory", "material-event"]),
    sourceRefs: z.array(continuitySourceRefSchema).min(1).max(3),
  }).strict()).max(12),
  sourceRefs: z.array(continuitySourceRefSchema).max(24),
  basis: z.object({
    gameFingerprint: z.string().min(1),
    sourceFingerprint: z.string().min(1),
    worldRevision: z.number().int().nonnegative(),
    eventSequence: z.number().int().nonnegative(),
    refreshedAt: z.string().min(1),
  }).strict(),
}).strict();
export type ContinuitySummary = z.infer<typeof continuitySummarySchema>;

export interface ContinuityRequest {
  readonly worldId: string;
  readonly world: WorldState;
  readonly worldRevision: number;
  readonly eventSequence: number;
  readonly perspective: { readonly kind: "actor" | "group"; readonly id: string };
  readonly scope: ContinuitySummary["scope"];
  /** Only history already authorized by the caller, or whole history filtered below. */
  readonly events?: readonly CanonicalEvent[];
  readonly maxCharacters?: number;
  readonly maxSources?: number;
}

interface Candidate {
  readonly priority: number;
  readonly id: string;
  readonly kind: ContinuitySourceRef["kind"];
  readonly provenance: ContinuitySummary["points"][number]["provenance"];
  readonly text: string;
  readonly value: unknown;
}
export interface ContinuityProjection {
  readonly summary: ContinuitySummary;
  readonly diagnostics: {
    readonly refreshed: boolean;
    readonly trigger: "initial" | "material-sources-changed" | "cache-hit";
    readonly selectedSourceCount: number;
    readonly omittedSourceCount: number;
    readonly serializedCharacters: number;
    readonly modelRefreshCalls: 0;
  };
}

const cache = new Map<string, { readonly summary: ContinuitySummary; readonly sourceSignature: string }>();
const CACHE_LIMIT = 64;
const DEFAULT_MAX = 1_200;
const DEFAULT_SOURCES = 12;

function digest(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function safe(value: string, max = 196): string {
  const text = redactModelBriefText(value).replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}
function asPoint(source: Candidate): ContinuitySummary["points"][number] {
  return {
    text: safe(source.text),
    provenance: source.provenance,
    sourceRefs: [{ kind: source.kind, id: source.id }],
  };
}
function sources(input: ContinuityRequest): Candidate[] {
  const { world, perspective, scope } = input;
  const actorId = perspective.kind === "actor" ? perspective.id : undefined;
  const related = new Set([perspective.id, ...(scope.id ? [scope.id] : [])]);
  const candidates: Candidate[] = [];
  const push = (kind: Candidate["kind"], id: string, priority: number,
    provenance: Candidate["provenance"], text: string, value: unknown) => {
    if (safe(text)) candidates.push({ kind, id, priority, provenance, text, value });
  };
  // Only the focal actor's own social state or beliefs are actor-private sources.
  // Neither source is shared with a group merely because an actor is in it.
  const social = actorId
    ? world.actorSocialStates.find((item) => item.actorId === actorId)
    : undefined;
  if (social) {
    for (const item of social.commitments) {
      if (scope.kind === "relationship" && scope.id &&
          !item.relatedEntityIds.includes(scope.id)) continue;
      push("commitment", item.id, 1_000, "firsthand",
        `Active obligation: ${item.label} (until ${item.end}).`, item);
    }
    for (const item of social.goals.filter((goal) => goal.status === "active")) {
      if (scope.kind === "relationship" && scope.id &&
          !item.relatedEntityIds.includes(scope.id)) continue;
      push("goal", item.id, 900 + Math.round(item.priority * 100), "firsthand",
        `Current goal: ${item.description}.`, item);
    }
    for (const item of social.relationships) {
      if (scope.kind === "relationship" && scope.id &&
          item.targetEntityId !== scope.id) continue;
      push("relationship", item.id, 760 + Math.round(item.salience * 100), "firsthand",
        `Relationship stance: ${item.tags.join(", ") || "established relationship"}.`, item);
    }
    for (const item of social.memories) {
      if (scope.kind === "relationship" && scope.id &&
          !item.relatedEntityIds.includes(scope.id)) continue;
      if (scope.kind === "location" && scope.id &&
          !item.relatedEntityIds.includes(scope.id)) continue;
      push("memory", item.id, 600 + Math.round(item.salience * 100),
        "recorded-memory", `Remembers: ${item.summary}`, item);
    }
  }
  if (actorId) {
    // Free-form entity summaries may contain GM evaluations, incorrect-theory
    // commentary or hidden motives. Only explicitly player-established,
    // immutable realization constraints are safe as autobiographical source.
    const realization = world.mechanicalRealizations.find((item) =>
      item.entityId === actorId
    );
    for (const item of realization?.constraints ?? []) {
      if (item.sourceKind !== "player-established") continue;
      push("player-established", item.id, 975, "firsthand",
        `Established personal history: ${item.summary}`, item);
    }
  }
  for (const belief of world.beliefs) {
    if (belief.holder.kind !== perspective.kind ||
        belief.holder.id !== perspective.id) continue;
    if (scope.kind === "relationship" && scope.id &&
        belief.subjectId !== scope.id) continue;
    if (scope.kind === "location" && scope.id &&
        belief.subjectId !== scope.id) continue;
    push("belief", belief.id, 580, "subjective-belief",
      `Believes (not confirmed fact): ${belief.proposition}`, belief);
  }
  // A public fact is not an all-knowing NPC's memory. For a scoped actor
  // summary include only the focal actor's facts; for location/relationship,
  // the explicitly requested subject, never all the world's public records.
  for (const fact of world.facts) {
    if (fact.visibility !== "public") continue;
    if (scope.kind === "actor" && fact.subjectId !== perspective.id) continue;
    if (scope.kind === "scene" || scope.kind === "campaign") {
      if (fact.subjectId !== perspective.id) continue;
    }
    if ((scope.kind === "location" || scope.kind === "relationship") &&
        fact.subjectId !== scope.id && fact.subjectId !== perspective.id) continue;
    // Avoid serializing opaque mechanics and deeply structured data.
    if (typeof fact.value !== "string" && typeof fact.value !== "number" &&
      typeof fact.value !== "boolean") continue;
    if (fact.predicate === "actor.current-location" &&
        typeof fact.value === "string") {
      const location = world.entities.find((item) => item.id === fact.value);
      push("fact", fact.id, 820, "public-fact",
        `Current location: ${location?.name ?? "an established place"}.`, fact);
    } else if (/^(?:character|actor|relationship|location)\./.test(fact.predicate) &&
        typeof fact.value !== "string") {
      // Raw data fields should not be turned into narrated private mechanics.
      continue;
    } else if (fact.tags.some((tag) =>
      ["clue", "discovery", "obligation", "reputation"].includes(tag))) {
      push("fact", fact.id, 780, "public-fact",
        `Established ${fact.predicate}: ${String(fact.value)}.`, fact);
    }
  }
  for (const event of input.events ?? []) {
    if (event.access !== "public" ||
      !event.relatedEntityIds.some((id) => related.has(id))) continue;
    if (scope.kind === "relationship" && scope.id &&
      !event.relatedEntityIds.includes(scope.id)) continue;
    push("event", event.id, 700 + Math.min(100, event.sequence / 1000),
      "material-event", `Recorded event: ${event.summary}`, event);
  }
  candidates.sort((a, b) => b.priority - a.priority ||
    a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Reevaluate all source access on EVERY request; cache only the already
 * projected text when the authorized source fingerprint matches.
 * Reopen with an empty cache simply rebuilds the same deterministic projection.
 */
export function projectContinuity(input: ContinuityRequest): ContinuityProjection {
  if (input.perspective.kind !== "actor" && input.perspective.kind !== "group") {
    throw new Error("Continuity projection requires an actor/group perspective");
  }
  const budget = Math.min(1_500, Math.max(120, input.maxCharacters ?? DEFAULT_MAX));
  const sourceCap = Math.min(24, Math.max(1, input.maxSources ?? DEFAULT_SOURCES));
  const available = sources(input);
  const selected = available.slice(0, sourceCap);
  const gameFingerprint = digest(input.world.game);
  const sourceSignature = JSON.stringify(selected.map((item) =>
    [item.kind, item.id, item.value]));
  const fingerprint = digest(sourceSignature);
  const key = JSON.stringify([input.worldId, input.scope,
    input.perspective, gameFingerprint, budget, sourceCap]);
  const previous = cache.get(key);
  // Fingerprints are diagnostic identifiers, not security proofs. Exact
  // comparison is necessary before reusing any actor-private cached prose.
  if (previous?.sourceSignature === sourceSignature) {
    return { summary: previous.summary,
      diagnostics: {
        refreshed: false, trigger: "cache-hit", selectedSourceCount: previous.summary.sourceRefs.length,
        omittedSourceCount: Math.max(0, available.length - previous.summary.sourceRefs.length),
        serializedCharacters: previous.summary.summaryText.length, modelRefreshCalls: 0,
      },
    };
  }
  const points: ContinuitySummary["points"][number][] = [];
  let used = 0;
  for (const item of selected) {
    if (points.length >= 12) break;
    const point = asPoint(item);
    const length = point.text.length + 2;
    if (used + length > budget) continue;
    points.push(point);
    used += length;
  }
  const summary = continuitySummarySchema.parse({
    schemaVersion: 1,
    scope: input.scope,
    perspective: input.perspective,
    status: "current",
    summaryText: points.map((point) => point.text).join("\n"),
    points,
    sourceRefs: points.flatMap((point) => point.sourceRefs),
    basis: {
      gameFingerprint,
      sourceFingerprint: fingerprint,
      worldRevision: input.worldRevision,
      eventSequence: input.eventSequence,
      refreshedAt: input.world.fictionalTime,
    },
  });
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, { summary, sourceSignature });
  return {
    summary,
    diagnostics: {
      refreshed: true,
      trigger: previous ? "material-sources-changed" : "initial",
      selectedSourceCount: points.length,
      omittedSourceCount: available.length - points.length,
      serializedCharacters: summary.summaryText.length,
      modelRefreshCalls: 0,
    },
  };
}

export function recallContinuity(
  request: ContinuityRequest & { readonly query: string; readonly limit?: number },
): ContinuitySummary {
  const search = new Set((request.query.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
    .filter((term) => !["what", "when", "where", "about", "have", "said", "tell"].includes(term)));
  const available = sources(request).filter((item) => {
    const value = item.text.toLowerCase();
    return [...search].some((term) => value.includes(term));
  }).slice(0, Math.min(8, request.limit ?? 5));
  const points = available.map(asPoint);
  return continuitySummarySchema.parse({
    schemaVersion: 1,
    scope: request.scope, perspective: request.perspective,
    status: "current",
    summaryText: points.map((item) => item.text).join("\n"),
    points, sourceRefs: points.flatMap((item) => item.sourceRefs),
    basis: {
      gameFingerprint: digest(request.world.game),
      sourceFingerprint: digest(available.map((item) => [item.kind, item.id, item.value])),
      worldRevision: request.worldRevision,
      eventSequence: request.eventSequence,
      refreshedAt: request.world.fictionalTime,
    },
  });
}

/** Foreground-only optional compression: the model can select or reorder only
 * already-verified source points, never author prose, facts or source IDs.
 * Ordinary turns never invoke this helper. The extractive original is safe
 * fallback on timeout, invalid output or out-of-range selection.
 */
export const continuitySelectionSchema = z.object({
  selectedPositions: z.array(z.number().int().nonnegative()).max(12),
}).strict();

export async function condenseContinuityAtBoundary(input: {
  readonly summary: ContinuitySummary;
  readonly modelRuntime: ModelRuntime;
  readonly trigger: "scene-transition" | "material-event" | "time-jump" | "explicit-recall";
  readonly maxCharacters?: number;
}): Promise<{
  readonly summary: ContinuitySummary;
  readonly diagnostics: { readonly modelRefreshCalls: number; readonly usedModel: boolean; readonly fallbackReason?: string };
}> {
  const original = continuitySummarySchema.parse(input.summary);
  const fallback = (reason: string, calls: number) => ({
    summary: original,
    diagnostics: { modelRefreshCalls: calls, usedModel: false, fallbackReason: reason },
  });
  if (original.status !== "current") return fallback("summary-not-current", 0);
  if (original.points.length < 7) return fallback("already-compact", 0);
  const maxCharacters = Math.min(1_500, input.maxCharacters ?? 900);
  try {
    const response = await input.modelRuntime.generate({
      prompt: {
        instructions: [
          "Choose which established continuity sentences remain most useful.",
          "Return only selectedPositions in priority order, using zero-based indices.",
          "Retain all active obligations, commitments, and established personal history.",
          "You cannot add claims, author new prose, request additional records, or edit facts.",
        ],
        input: JSON.stringify({
          trigger: input.trigger,
          points: original.points.map((item, position) =>
            ({ position, text: item.text })),
          maxCharacters,
        }),
      },
      output: {
        kind: "structured",
        schemaId: "continuity.select.v1",
        schema: continuitySelectionSchema,
      },
      trace: { operation: "continuity.select.v1" },
    });
    if (!response.ok || response.output.kind !== "structured") {
      return fallback("model-unavailable", 1);
    }
    const parsed = continuitySelectionSchema.safeParse(response.output.value);
    if (!parsed.success) return fallback("invalid-model-selection", 1);
    const indices = parsed.data.selectedPositions;
    if (new Set(indices).size !== indices.length ||
        indices.some((index) => index >= original.points.length)) {
      return fallback("unauthorized-source-position", 1);
    }
    const mandatory = original.points.flatMap((point, index) =>
      /^(?:Active obligation:|Established personal history:)/.test(point.text) ? [index] : []);
    if (!mandatory.every((index) => indices.includes(index))) {
      return fallback("mandatory-continuity-omitted", 1);
    }
    const points = indices.map((index) => original.points[index]!);
    const summaryText = points.map((point) => point.text).join("\n");
    if (summaryText.length > maxCharacters) return fallback("model-overflow", 1);
    const summary = continuitySummarySchema.parse({
      ...original, summaryText, points,
      sourceRefs: points.flatMap((point) => point.sourceRefs),
    });
    return { summary, diagnostics: { modelRefreshCalls: 1, usedModel: true } };
  } catch {
    return fallback("invalid-output-or-timeout", 1);
  }
}

/** Use this when a cached record is held across a scene or package change.
 * A stale record never carries old text into a new actor-facing model brief.
 */
export function assessContinuityFreshness(
  previous: ContinuitySummary,
  current: ContinuityRequest,
): ContinuitySummary {
  const now = projectContinuity(current).summary;
  if (previous.schemaVersion === now.schemaVersion &&
      JSON.stringify(previous.perspective) === JSON.stringify(now.perspective) &&
      JSON.stringify(previous.scope) === JSON.stringify(now.scope) &&
      previous.basis.gameFingerprint === now.basis.gameFingerprint &&
      previous.basis.sourceFingerprint === now.basis.sourceFingerprint) {
    return previous;
  }
  return continuitySummarySchema.parse({
    ...previous, status: "stale", summaryText: "", points: [], sourceRefs: [],
  });
}
