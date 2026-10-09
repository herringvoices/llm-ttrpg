import { z } from "zod";
import {
  fictionalDurationMs, OperationValidationError, stableIdSchema,
  type EventTypeDefinition, type RulesOperation,
} from "@llm-ttrpg/engine";
import { densifyGeneratedEntity } from "../starting-region.js";

export const realizeSourcedDetailInputSchema = z.object({
  entityId: stableIdSchema,
  factId: stableIdSchema,
  dataKey: stableIdSchema,
}).strict();
export const realizeSourcedDetailResultSchema = z.object({
  entityId: stableIdSchema, factId: stableIdSchema,
  dataKey: stableIdSchema, added: z.boolean(),
}).strict();
export const sourcedDetailRealizedEventType: EventTypeDefinition<
  z.infer<typeof realizeSourcedDetailResultSchema>
> = {
  type: "rules.sourced-detail-realized", schemaVersion: 1,
  payloadSchema: realizeSourcedDetailResultSchema,
};
export const realizeSourcedDetailOperation: RulesOperation<
  z.infer<typeof realizeSourcedDetailInputSchema>,
  z.infer<typeof realizeSourcedDetailResultSchema>
> = {
  metadata: {
    id: "rules.realization.realize-sourced-detail", kind: "ordinary",
    retentionClass: "canonical",
    description: "Add one missing field from an already authoritative canonical entity-detail fact.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "realization", label: "Mechanical Realization" },
      tags: ["realization", "no-retcon"],
    },
  },
  inputSchema: realizeSourcedDetailInputSchema,
  outputSchema: realizeSourcedDetailResultSchema,
  execute({ world }, input) {
    const entity = world.entities.find((item) => item.id === input.entityId);
    const fact = world.facts.find((item) => item.id === input.factId);
    if (!entity || !fact || fact.subjectId !== entity.id ||
        fact.predicate !== `entity.detail.${input.dataKey}` ||
        fact.visibility !== "public") {
      throw new OperationValidationError("Missing publicly established, source-linked entity detail.");
    }
    if (Object.prototype.hasOwnProperty.call(entity.data, input.dataKey)) {
      if (JSON.stringify(entity.data[input.dataKey]) !== JSON.stringify(fact.value)) {
        throw new OperationValidationError("Existing entity detail conflicts with its source fact.");
      }
      return {
        result: { ...input, added: false },
        advanceTimeByMs: fictionalDurationMs(0),
        proposedMutations: [], proposedEvents: [],
      };
    }
    const densified = densifyGeneratedEntity(entity, {
      entityId: entity.id, candidateData: { ...entity.data, [input.dataKey]: fact.value },
      requiredPaths: [input.dataKey],
      provenance: {
        class: "later-densification",
        sourceIds: [fact.id],
        rationale: "Only a missing, source-verified, player-relevant field is realized.",
      },
    });
    const result = realizeSourcedDetailResultSchema.parse({ ...input, added: true });
    return {
      result,
      advanceTimeByMs: fictionalDurationMs(0),
      proposedMutations: densified.mutations,
      proposedEvents: [{
        type: "rules.sourced-detail-realized", schemaVersion: 1,
        summary: "A source-grounded entity detail became available to the current action.",
        relatedEntityIds: [entity.id], scopeIds: [],
        causedByEventIds: [], payload: result,
        access: "gm-only",
        origin: { kind: "rules-operation", id: "rules.realization.realize-sourced-detail" },
      }],
    };
  },
};
