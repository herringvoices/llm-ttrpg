import { z } from "zod";
import { narrationSceneKindSchema, type NarrationSceneKind } from "./presentation.js";
import { redactModelBriefText } from "./model-brief.js";
import type { CommittedOperationReceipt } from "./player-action-contracts.js";
import type { CanonicalEvent } from "./events.js";

export const presentationBeatKindSchema = z.union([
  narrationSceneKindSchema, z.literal("awakening"),
]);
export type PresentationBeatKind = z.infer<typeof presentationBeatKindSchema>;

/** This versioned source snapshot stores only an already-authorized ACTOR
 * projection. It is frozen before the first narration model invocation. */
export const presentationSceneSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  sceneBrief: z.string().min(1).max(16_000),
  worldRevision: z.number().int().nonnegative(),
  eventSequence: z.number().int().nonnegative(),
}).strict();
export type PresentationSceneSnapshot = z.infer<typeof presentationSceneSnapshotSchema>;

export interface PresentationBeatInput {
  readonly id: string;
  readonly kind: PresentationBeatKind;
  readonly scene: PresentationSceneSnapshot;
  readonly declaration?: string;
  readonly observableOutcomes: readonly string[];
  readonly quotedSpeech?: readonly string[];
  readonly elapsedMs: number;
  readonly stopReason?: string;
}
/** No private source refs are emitted in modelText. The basis is an engine-only
 * sidecar, never part of the JSON sent to a narrator. */
export interface PresentationBeat {
  readonly kind: PresentationBeatKind;
  readonly modelText: string;
  readonly basis: { readonly id: string; readonly worldRevision: number;
    readonly eventSequence: number };
  readonly observableOutcomes: readonly string[];
  readonly quotedSpeech: readonly string[];
  readonly elapsedMs: number;
}

function safe(text: string, limit: number): string {
  return redactModelBriefText(text).slice(0, limit);
}

export function buildPresentationBeat(input: PresentationBeatInput): PresentationBeat {
  const kind = presentationBeatKindSchema.parse(input.kind);
  const scene = presentationSceneSnapshotSchema.parse(input.scene);
  const observableOutcomes = input.observableOutcomes.slice(0, 12)
    .map((part) => safe(part, 460)).filter(Boolean);
  const quotedSpeech = (input.quotedSpeech ?? []).slice(0, 12)
    .map((quote) => safe(quote, 400)).filter(Boolean);
  const declaration = input.declaration ? safe(input.declaration, 1_500) : undefined;
  const elapsedMs = z.number().int().nonnegative().parse(input.elapsedMs);
  return {
    kind, basis: {
      id: z.string().min(1).parse(input.id),
      worldRevision: scene.worldRevision, eventSequence: scene.eventSequence,
    }, observableOutcomes, quotedSpeech, elapsedMs,
    modelText: JSON.stringify({
      kind, scene: JSON.parse(scene.sceneBrief) as unknown,
      ...(declaration ? { declaration } : {}),
      observableOutcomes, quotedSpeech, elapsedMs,
      ...(input.stopReason ? { stopReason: safe(input.stopReason, 80) } : {}),
      note: "Narrate only these authorized sources. Absence of an event does not mean the action did not occur.",
    }),
  };
}

/** Never serialize raw receipt input, result, mutations, randomness, hidden
 * events, or event IDs. Event access='public' alone does NOT prove that an
 * off-scene player perceived an event. */
export function observableActionOutcomes(input: {
  readonly receipts: readonly CommittedOperationReceipt[];
  readonly authorizedEntityIds: readonly string[];
  readonly playerActorId: string;
  readonly locationId?: string;
}): string[] {
  const authorized = new Set([input.playerActorId, ...input.authorizedEntityIds]);
  const lines: string[] = [];
  for (const receipt of input.receipts) {
    // Rule-owned zero-duration realization is preparation, not a second
    // player-visible action or an automatic narrative success.
    if (receipt.toolId.includes("realize-mechanics") ||
        receipt.toolId.includes("realize-observed-person") ||
        receipt.toolId.includes("realize-sourced-detail")) continue;
    const result = receipt.result;
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const data = result as Record<string, unknown>;
      if (typeof data.actionSummary === "string") {
        lines.push("Committed routine action: " + safe(data.actionSummary, 210));
      } else if (typeof data.success === "boolean") {
        lines.push(data.success
          ? "The attempted action succeeded according to the committed rules result."
          : "The attempted action did not succeed according to the committed rules result.");
      }
    }
    const observed = receipt.events.filter((event) =>
      event.access === "public" &&
      (event.relatedEntityIds.some((id) => authorized.has(id)) ||
        Boolean(input.locationId && event.scopeIds.includes(input.locationId)))
    );
    lines.push(...observed.slice(0, 3).map((event) => safe(event.summary, 350)));
    if (receipt.advanceTimeByMs > 0) lines.push(
      `This committed step took ${receipt.advanceTimeByMs}ms of fictional time.`);
  }
  return lines.slice(0, 12);
}

/** Already selected public + actor-local events, for first power / opening.
 * Deliberately caller-scoped, never all public world events. */
export function observableEventSummaries(
  events: readonly CanonicalEvent[],
  authorizedEntityIds: readonly string[],
  locationId?: string,
): string[] {
  const ids = new Set(authorizedEntityIds);
  return events.filter((event) =>
    event.access === "public" &&
    (event.relatedEntityIds.some((id) => ids.has(id)) ||
      Boolean(locationId && event.scopeIds.includes(locationId)))
  ).slice(0, 6).map((event) => safe(event.summary, 360));
}

const unsupportedPlayerAgency =
  /\byou\s+(?:decide|choose|promise|agree|secretly think|want|intend|resolve)\b/i;
const ungroundedAffordance =
  /\b(?:an?\s+)?(?:unlocked|hidden|new|secret)\s+(?:door|exit|gate|window|staircase|weapon|gun|key|passage|clue|witness|portal|artifact)\b/gi;

export function validatePresentedText(
  text: string,
  beat: PresentationBeat,
): { readonly ok: true; readonly text: string } |
   { readonly ok: false; readonly reason: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > 4_800) return { ok: false, reason: "overlong" };
  if (unsupportedPlayerAgency.test(trimmed)) {
    return { ok: false, reason: "invented-player-agency" };
  }
  for (const quote of beat.quotedSpeech) {
    if (!trimmed.includes(quote)) return { ok: false, reason: "missing-verbatim-quote" };
  }
  const grounding = beat.modelText.toLowerCase();
  for (const match of trimmed.matchAll(ungroundedAffordance)) {
    if (!grounding.includes(match[0].toLowerCase())) {
      return { ok: false, reason: "ungrounded-actionable-detail" };
    }
  }
  return { ok: true, text: trimmed };
}

/** A deterministic recap is deliberately less vivid than an unsupported
 * invention, and is safe to display after model timeout or failed validation. */
export function deterministicBeatFallback(beat: PresentationBeat): string | undefined {
  const outcome = beat.observableOutcomes.find((part) =>
    part.startsWith("Committed routine action: "));
  if (outcome) {
    const phrase = outcome.slice("Committed routine action: ".length).trim();
    if (/^I\s+/i.test(phrase)) return phrase.replace(/^I\s+/i, "You ");
    if (/^You\s+/i.test(phrase)) return phrase;
    return `You complete the established routine task: ${phrase}`;
  }
  if (beat.observableOutcomes.some((part) => part.includes("did not succeed"))) {
    return "Your attempt does not succeed. You can choose what to try next.";
  }
  if (beat.observableOutcomes.some((part) => part.includes("action succeeded"))) {
    return beat.elapsedMs > 0
      ? `Your attempt succeeds within the committed ${beat.elapsedMs}ms of fictional time.`
      : "Your attempt succeeds.";
  }
  return undefined;
}

/** A display-ready LM-05 NPC reply is presentation already: no model pass
 * that could translate the NPC's words or promote an allegation to fact. */
export function composeNpcReplies(replies: readonly {
  readonly speaker: string; readonly speech: string;
  readonly visibleManner?: string;
}[]): string {
  return replies.map((reply) =>
    `${reply.speaker}: "${reply.speech}"${reply.visibleManner
      ? ` (${reply.visibleManner})` : ""}`).join("\n");
}
