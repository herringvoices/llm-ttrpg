import {
  fictionalDurationMs,
  jsonValueSchema,
  OperationValidationError,
  stableIdSchema,
  type EventTypeDefinition,
  type RulesOperation,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import {
  powerDiscoveredBehaviorSchema,
  rulesActorStateSchema,
} from "./model.js";

export const recordPowerDiscoveryInputSchema = z.object({
  actorId: stableIdSchema,
  powerId: stableIdSchema,
  behavior: powerDiscoveredBehaviorSchema,
  scopeIds: z.array(stableIdSchema),
  causedByEventIds: z.array(stableIdSchema),
  reason: z.string().trim().min(1),
}).strict();

export const recordPowerDiscoveryResultSchema = z.object({
  actorId: stableIdSchema,
  powerId: stableIdSchema,
  behaviorId: stableIdSchema,
  outcome: z.enum(["valid", "invalid", "conditional"]),
}).strict();

export const powerBehaviorDiscoveredEventType: EventTypeDefinition<
  z.infer<typeof recordPowerDiscoveryResultSchema>
> = {
  type: "rules.power-behavior-discovered",
  schemaVersion: 1,
  payloadSchema: recordPowerDiscoveryResultSchema,
};

export const recordPowerDiscoveryOperation: RulesOperation<
  z.infer<typeof recordPowerDiscoveryInputSchema>,
  z.infer<typeof recordPowerDiscoveryResultSchema>
> = {
  metadata: {
    id: "rules.progression.record-power-discovery",
    kind: "ordinary",
    description:
      "Commit a previously unsettled reusable power behavior after authoritative adjudication.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "progression", label: "Progression" },
      tags: ["power", "discovery", "adjudication"],
    },
  },
  inputSchema: recordPowerDiscoveryInputSchema,
  outputSchema: recordPowerDiscoveryResultSchema,
  execute(context, input) {
    const entity = context.world.entities.find((item) => item.id === input.actorId);
    if (!entity) {
      throw new OperationValidationError(`Missing actor ${input.actorId}`);
    }
    const parsed = rulesActorStateSchema.safeParse(entity.data.mechanics);
    if (!parsed.success) {
      throw new OperationValidationError(
        `Actor ${input.actorId} lacks complete human mechanics`,
      );
    }

    const next = JSON.parse(JSON.stringify(parsed.data)) as z.infer<
      typeof rulesActorStateSchema
    >;
    const power = next.progression.powers?.find(
      (candidate) => candidate.id === input.powerId,
    );
    if (!power) {
      throw new OperationValidationError(
        `Actor ${input.actorId} does not have power ${input.powerId}`,
      );
    }
    if (
      power.discoveredBehaviors.some(
        (behavior) => behavior.id === input.behavior.id,
      )
    ) {
      throw new OperationValidationError(
        `Power behavior ${input.behavior.id} is already established`,
      );
    }

    power.discoveredBehaviors.push(input.behavior);
    const mechanics = rulesActorStateSchema.parse(next);
    const result = recordPowerDiscoveryResultSchema.parse({
      actorId: input.actorId,
      powerId: input.powerId,
      behaviorId: input.behavior.id,
      outcome: input.behavior.outcome,
    });

    return {
      result,
      advanceTimeByMs: fictionalDurationMs(0),
      proposedMutations: [{
        kind: "set-entity-data",
        entityId: input.actorId,
        key: "mechanics",
        value: jsonValueSchema.parse(mechanics),
      }],
      proposedEvents: [{
        type: "rules.power-behavior-discovered",
        schemaVersion: 1,
        summary:
          `${input.actorId} established a reusable behavior for ${power.name}: ${input.reason}`,
        relatedEntityIds: [input.actorId],
        scopeIds: input.scopeIds,
        causedByEventIds: input.causedByEventIds,
        origin: {
          kind: "rules-operation",
          id: "rules.progression.record-power-discovery",
        },
        payload: result,
        access: "public",
      }],
    };
  },
};
