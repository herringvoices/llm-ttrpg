import {
  fictionalDurationMs,
  OperationValidationError,
  stableIdSchema,
  type EventTypeDefinition,
  type RulesOperation,
} from "@llm-ttrpg/engine";
import { z } from "zod";

/**
 * A single event anchoring the opening's power manifestation, not a per-turn
 * event for routine activity. The desktop commits the player transcript before
 * calling this trusted operation and only supplies a successfully resolved
 * turn. Legacy saves may still use rules.routine-task-completed as evidence.
 */
export const openingTurnEvidenceSchema = z.object({
  actorId: stableIdSchema,
  turnId: stableIdSchema,
  sourceKind: z.enum(["committed-player-action", "completed-conversation"]),
  description: z.string().trim().min(1).max(240),
}).strict();

export const openingTurnEvidencedEventType: EventTypeDefinition<
  z.infer<typeof openingTurnEvidenceSchema>
> = {
  type: "rules.opening-turn-evidenced",
  schemaVersion: 1,
  payloadSchema: openingTurnEvidenceSchema,
};

export const recordOpeningTurnEvidenceOperation: RulesOperation<
  z.infer<typeof openingTurnEvidenceSchema>,
  z.infer<typeof openingTurnEvidenceSchema>
> = {
  metadata: {
    id: "rules.progression.record-opening-turn-evidence",
    kind: "ordinary",
    retentionClass: "canonical",
    description:
      "Anchor a successfully committed opening turn as one causal event when its first power is due. Never emit this for every routine action.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "progression", label: "Progression" },
      tags: ["opening", "causal-evidence", "manifestation"],
    },
  },
  inputSchema: openingTurnEvidenceSchema,
  outputSchema: openingTurnEvidenceSchema,
  execute(context, input) {
    const actor = context.world.entities.find((item) => item.id === input.actorId);
    if (!actor || actor.kind !== "actor") {
      throw new OperationValidationError("Opening turn evidence requires an existing actor");
    }
    const mechanics = actor.data.mechanics;
    if (mechanics && typeof mechanics === "object" &&
        "progression" in mechanics && mechanics.progression &&
        typeof mechanics.progression === "object" &&
        "characterLevel" in mechanics.progression &&
        typeof mechanics.progression.characterLevel === "number" &&
        mechanics.progression.characterLevel > 0) {
      throw new OperationValidationError("Opening evidence cannot be created for an already awakened actor");
    }
    const result = openingTurnEvidenceSchema.parse(input);
    return {
      result,
      advanceTimeByMs: fictionalDurationMs(0),
      proposedMutations: [],
      proposedEvents: [{
        type: "rules.opening-turn-evidenced",
        schemaVersion: 1,
        summary: `A committed opening turn is ready to ground first-power manifestation: ${input.description}`,
        relatedEntityIds: [input.actorId],
        scopeIds: [],
        causedByEventIds: [],
        origin: { kind: "rules-operation", id: "rules.progression.record-opening-turn-evidence" },
        payload: result,
        access: "gm-only",
      }],
    };
  },
};
