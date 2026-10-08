import {
  fictionalDurationMs,
  OperationValidationError,
  stableIdSchema,
  type EventTypeDefinition,
  type RulesOperation,
} from "@llm-ttrpg/engine";
import { z } from "zod";

export const completeRoutineTaskInputSchema = z.object({
  actorId: stableIdSchema,
  actionSummary: z.string().trim().min(1).max(240),
  durationMs: z.number().int().nonnegative().max(60 * 60_000),
}).strict();

export const completeRoutineTaskResultSchema = z.object({
  actorId: stableIdSchema,
  actionSummary: z.string().trim().min(1),
}).strict();

export const routineTaskCompletedEventType: EventTypeDefinition<
  z.infer<typeof completeRoutineTaskResultSchema>
> = {
  type: "rules.routine-task-completed",
  schemaVersion: 1,
  payloadSchema: completeRoutineTaskResultSchema,
};

export const completeRoutineTaskOperation: RulesOperation<
  z.infer<typeof completeRoutineTaskInputSchema>,
  z.infer<typeof completeRoutineTaskResultSchema>
> = {
  metadata: {
    id: "rules.actions.complete-routine-task",
    kind: "ordinary",
    retentionClass: "continuity",
    description:
      "Complete a concrete, ordinary, uncontested task when the established fiction gives it no meaningful uncertainty, opposition, danger, or mechanical consequence. Do not use for risky or resisted actions.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "actions", label: "Actions" },
      tags: ["routine", "ordinary", "world-state"],
    },
    applicability: {
      actionModes: ["interaction", "manipulation", "observation", "communication"],
    },
  },
  inputSchema: completeRoutineTaskInputSchema,
  outputSchema: completeRoutineTaskResultSchema,
  execute(context, input) {
    const actor = context.world.entities.find((item) => item.id === input.actorId);
    if (!actor || actor.kind !== "actor") {
      throw new OperationValidationError(`Missing actor ${input.actorId}`);
    }
    const result = completeRoutineTaskResultSchema.parse({
      actorId: input.actorId,
      actionSummary: input.actionSummary,
    });
    return {
      result,
      advanceTimeByMs: fictionalDurationMs(input.durationMs),
      proposedMutations: [],
      // Ordinary no-effect work consumes time and has a committed execution
      // receipt. It is not itself a durable narrative world event.
      proposedEvents: [],    };
  },
};
