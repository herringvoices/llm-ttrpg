import {
  fictionalDurationMs,
  type RulesOperation,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import {
  extendedTaskSchema,
  groupMaterialEffectsByTime,
  materialEffectSchema,
  repeatAttemptSchema,
} from "./mechanics.js";

export const extendedTaskResultSchema = z
  .object({
    stageCount: z.number().int().min(2),
    totalExpectedDurationMs: z.number().int().nonnegative(),
    stageIds: z.array(z.string().min(1)),
  })
  .strict();

export const validateExtendedTaskOperation: RulesOperation<
  z.infer<typeof extendedTaskSchema>,
  z.infer<typeof extendedTaskResultSchema>
> = {
  metadata: {
    id: "rules.tasks.validate-extended-task",
    kind: "ordinary",
    description:
      "Validate that extended work is decomposed into meaningful stages instead of one mega-check.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "tasks", label: "Tasks" },
      tags: ["extended", "stages", "action-pressure"],
    },
  },
  inputSchema: extendedTaskSchema,
  outputSchema: extendedTaskResultSchema,
  execute(_context, input) {
    return {
      result: {
        stageCount: input.stages.length,
        totalExpectedDurationMs: input.stages.reduce(
          (total, stage) => total + stage.expectedDurationMs,
          0,
        ),
        stageIds: input.stages.map((stage) => stage.id),
      },
      advanceTimeByMs: fictionalDurationMs(0),
      proposedMutations: [],
      proposedEvents: [],
    };
  },
};

export const repeatAttemptResultSchema = z
  .object({
    allowed: z.literal(true),
    changedBy: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const validateRepeatAttemptOperation: RulesOperation<
  z.infer<typeof repeatAttemptSchema>,
  z.infer<typeof repeatAttemptResultSchema>
> = {
  metadata: {
    id: "rules.tasks.validate-repeat-attempt",
    kind: "ordinary",
    description:
      "Require a real change in time, action window, approach, preparation, resources, or circumstances before retrying.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "tasks", label: "Tasks" },
      tags: ["repeat", "retry", "action-pressure"],
    },
  },
  inputSchema: repeatAttemptSchema,
  outputSchema: repeatAttemptResultSchema,
  execute(_context, input) {
    return {
      result: { allowed: true, changedBy: [...input.changes] },
      advanceTimeByMs: fictionalDurationMs(0),
      proposedMutations: [],
      proposedEvents: [],
    };
  },
};

export const orderMaterialEffectsInputSchema = z
  .object({ effects: z.array(materialEffectSchema).min(1) })
  .strict();

export const orderMaterialEffectsResultSchema = z
  .object({
    groups: z.array(
      z
        .object({
          timeToMaterialEffectMs: z.number().int().nonnegative(),
          intentIds: z.array(z.string().min(1)).min(1),
          simultaneous: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

export const orderMaterialEffectsOperation: RulesOperation<
  z.infer<typeof orderMaterialEffectsInputSchema>,
  z.infer<typeof orderMaterialEffectsResultSchema>
> = {
  metadata: {
    id: "rules.timing.order-material-effects",
    kind: "ordinary",
    description:
      "Order obvious times to material effect and identify genuine ties without creating initiative or a scheduler.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "timing", label: "Timing" },
      tags: ["continuous-time", "ordering", "simultaneous"],
    },
  },
  inputSchema: orderMaterialEffectsInputSchema,
  outputSchema: orderMaterialEffectsResultSchema,
  execute(_context, input) {
    const groups = groupMaterialEffectsByTime(input.effects).map((group) => ({
      timeToMaterialEffectMs: group.timeToMaterialEffectMs,
      intentIds: group.effects.map((effect) => effect.intentId),
      simultaneous: group.effects.length > 1,
    }));
    return {
      result: { groups },
      advanceTimeByMs: fictionalDurationMs(0),
      proposedMutations: [],
      proposedEvents: [],
    };
  },
};
