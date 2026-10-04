import { z } from "zod";
import { stableIdSchema } from "./identity.js";
import { fictionalInstantSchema } from "./time.js";

export const actorGoalStatusSchema = z.enum([
  "active",
  "blocked",
  "satisfied",
  "abandoned",
]);

export const actorGoalSchema = z.object({
  id: stableIdSchema,
  description: z.string().trim().min(1),
  priority: z.number().min(0).max(1),
  status: actorGoalStatusSchema,
  relatedEntityIds: z.array(stableIdSchema),
  sourceEventIds: z.array(stableIdSchema).optional(),
  createdAt: fictionalInstantSchema,
  lastUpdatedAt: fictionalInstantSchema.optional(),
}).strict();
export type ActorGoal = z.infer<typeof actorGoalSchema>;

export const directedRelationshipSchema = z.object({
  id: stableIdSchema,
  targetEntityId: stableIdSchema,
  dimensions: z.record(stableIdSchema, z.number().min(-1).max(1)),
  salience: z.number().min(0).max(1),
  tags: z.array(stableIdSchema),
  sourceEventIds: z.array(stableIdSchema).optional(),
  lastUpdatedAt: fictionalInstantSchema,
}).strict();
export type DirectedRelationship = z.infer<typeof directedRelationshipSchema>;

export const episodicMemorySchema = z.object({
  id: stableIdSchema,
  summary: z.string().trim().min(1),
  formedAt: fictionalInstantSchema,
  occurredAt: fictionalInstantSchema.optional(),
  salience: z.number().min(0).max(1),
  relatedEntityIds: z.array(stableIdSchema),
  sourceEventIds: z.array(stableIdSchema),
  tags: z.array(stableIdSchema),
}).strict();
export type EpisodicMemory = z.infer<typeof episodicMemorySchema>;

export const availabilityImpactSchema = z.enum([
  "available",
  "occupied",
  "unavailable",
]);

export const actorCommitmentSchema = z.object({
  id: stableIdSchema,
  label: z.string().trim().min(1),
  start: fictionalInstantSchema,
  end: fictionalInstantSchema,
  availabilityImpact: availabilityImpactSchema,
  relatedEntityIds: z.array(stableIdSchema),
  sourceEventIds: z.array(stableIdSchema).optional(),
  tags: z.array(stableIdSchema),
}).strict().superRefine((value, context) => {
  if (value.end < value.start) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Commitment end cannot precede its start",
      path: ["end"],
    });
  }
});
export type ActorCommitment = z.infer<typeof actorCommitmentSchema>;

function uniqueIds(
  values: readonly { readonly id: string }[],
  label: string,
  context: z.RefinementCtx,
  path: string,
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate ${label} ID: ${value.id}`,
        path: [path, index, "id"],
      });
    }
    seen.add(value.id);
  }
}

export const actorSocialStateSchema = z.object({
  actorId: stableIdSchema,
  goals: z.array(actorGoalSchema),
  relationships: z.array(directedRelationshipSchema),
  memories: z.array(episodicMemorySchema),
  commitments: z.array(actorCommitmentSchema),
}).strict().superRefine((value, context) => {
  uniqueIds(value.goals, "goal", context, "goals");
  uniqueIds(value.relationships, "relationship", context, "relationships");
  uniqueIds(value.memories, "memory", context, "memories");
  uniqueIds(value.commitments, "commitment", context, "commitments");
});
export type ActorSocialState = z.infer<typeof actorSocialStateSchema>;

export function emptyActorSocialState(actorId: string): ActorSocialState {
  return actorSocialStateSchema.parse({
    actorId,
    goals: [],
    relationships: [],
    memories: [],
    commitments: [],
  });
}
