import {
  fictionalDurationMs,
  type EventTypeDefinition,
  type RulesOperation,
  type Ruleset,
} from "@llm-ttrpg/engine";
import { z } from "zod";

export const effortInputSchema = z
  .object({
    actorId: z.string().min(1),
    base: z.number().int(),
    modifier: z.number().int(),
    difficulty: z.number().int(),
    scopeId: z.string().min(1).optional(),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .strict();

export const effortResultSchema = z
  .object({
    total: z.number().int(),
    success: z.boolean(),
  })
  .strict();

export const effortResolvedPayloadSchema = z
  .object({
    total: z.number().int(),
    difficulty: z.number().int(),
  })
  .strict();

export const effortResolvedEventType: EventTypeDefinition<
  z.infer<typeof effortResolvedPayloadSchema>
> = {
  type: "rules.effort-resolved",
  schemaVersion: 1,
  payloadSchema: effortResolvedPayloadSchema,
};

export const resolveEffortOperation: RulesOperation<
  z.infer<typeof effortInputSchema>,
  z.infer<typeof effortResultSchema>
> = {
  metadata: {
    id: "rules.actions.resolve-effort",
    description:
      "Resolve a tiny deterministic effort total for the contract fixture.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "actions", label: "Actions" },
      tags: ["deterministic", "fixture"],
    },
  },
  inputSchema: effortInputSchema,
  outputSchema: effortResultSchema,
  execute(_context, input) {
    const total = input.base + input.modifier;
    return {
      result: { total, success: total >= input.difficulty },
      advanceTimeByMs: fictionalDurationMs(input.durationMs ?? 0),
      proposedMutations: [],
      proposedEvents: [
        {
          type: "rules.effort-resolved",
          schemaVersion: 1,
          summary: `Resolved effort at ${total} against ${input.difficulty}.`,
          relatedEntityIds: [input.actorId],
          scopeIds: input.scopeId ? [input.scopeId] : [],
          causedByEventIds: [],
          origin: {
            kind: "rules-operation",
            id: "rules.actions.resolve-effort",
          },
          payload: {
            total,
            difficulty: input.difficulty,
          },
          access: "public",
        },
      ],
    };
  },
};

export const referenceRuleset: Ruleset = {
  identity: { id: "reference-rules", version: "0.1.0" },
  description: "Minimal rules fixture; not the real game rules.",
  operations: [resolveEffortOperation],
  eventTypes: [effortResolvedEventType],
};
