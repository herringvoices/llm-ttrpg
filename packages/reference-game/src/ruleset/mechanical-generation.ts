import {
  assertNoRetconJsonExtension,
  fictionalDurationMs,
  jsonValueSchema,
  mechanicalConstraintSchema,
  mechanicalRealizationSchema,
  OperationValidationError,
  stableIdSchema,
  type DeepReadonly,
  type MechanicalConstraint,
  type OperationWorldView,
  type RulesOperation,
  type EventTypeDefinition,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import {
  attributeIdSchema,
  partialRulesMechanicsSchema,
  rulesActorStateSchema,
  rulesCreatureStateSchema,
  validateCompleteHumanMechanics,
} from "./model.js";

const realizationLevelSchema = z.enum(["constrained", "partial", "complete"]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const realizeMechanicsInputSchema = z.object({
  entityId: stableIdSchema,
  subjectKind: z.enum(["human", "creature"]),
  targetLevel: realizationLevelSchema,
  mechanics: partialRulesMechanicsSchema.optional(),
  constraints: z.array(mechanicalConstraintSchema),
  stepId: stableIdSchema,
  occurredAt: z.string().datetime(),
  generatorVersion: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  scopeIds: z.array(stableIdSchema),
}).strict().superRefine((input, context) => {
  if (input.targetLevel !== "constrained" && !input.mechanics) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Partial and complete realization require mechanics",
      path: ["mechanics"],
    });
  }
});

export const realizeMechanicsResultSchema = z.object({
  entityId: stableIdSchema,
  level: realizationLevelSchema,
  addedPaths: z.array(z.string().min(1)),
}).strict();

export const mechanicsRealizedPayloadSchema = realizeMechanicsResultSchema.extend({
  subjectKind: z.enum(["human", "creature"]),
  constraintIds: z.array(stableIdSchema),
}).strict();

export const mechanicsRealizedEventType: EventTypeDefinition<
  z.infer<typeof mechanicsRealizedPayloadSchema>
> = {
  type: "rules.mechanics-realized",
  schemaVersion: 1,
  payloadSchema: mechanicsRealizedPayloadSchema,
};

function entity(
  world: DeepReadonly<OperationWorldView>,
  entityId: string,
) {
  const found = world.entities.find((candidate) => candidate.id === entityId);
  if (!found) throw new OperationValidationError(`Missing entity ${entityId}`);
  return found;
}

function appendConstraints(
  prior: readonly MechanicalConstraint[],
  proposed: readonly MechanicalConstraint[],
): MechanicalConstraint[] {
  const merged = prior.map((constraint) => clone(constraint));
  const byId = new Map(merged.map((constraint) => [constraint.id, constraint]));
  for (const constraint of proposed) {
    const existing = byId.get(constraint.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(constraint)) {
        throw new OperationValidationError(
          `Mechanical constraint ${constraint.id} cannot be rewritten`,
        );
      }
      continue;
    }
    const cloned = clone(constraint);
    merged.push(cloned);
    byId.set(cloned.id, cloned);
  }
  return merged;
}

function collectAddedPaths(
  previous: unknown,
  next: unknown,
  path = "",
): string[] {
  if (previous === undefined) {
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return [path || "$"];
    }
    return Object.entries(next as Record<string, unknown>).flatMap(([key, value]) =>
      collectAddedPaths(
        undefined,
        value,
        path ? `${path}.${key}` : key,
      )
    );
  }
  if (
    previous === null ||
    next === null ||
    typeof previous !== "object" ||
    typeof next !== "object"
  ) {
    return [];
  }
  if (Array.isArray(previous) && Array.isArray(next)) {
    const previousIds = new Set(
      previous.flatMap((item) =>
        item && typeof item === "object" && !Array.isArray(item) &&
          typeof (item as { id?: unknown }).id === "string"
          ? [(item as { id: string }).id]
          : []
      ),
    );
    return next.flatMap((item, index) => {
      if (
        item && typeof item === "object" && !Array.isArray(item) &&
        typeof (item as { id?: unknown }).id === "string"
      ) {
        const id = (item as { id: string }).id;
        return previousIds.has(id) ? [] : [`${path}[${id}]`];
      }
      return index < previous.length ? [] : [`${path}[${index}]`];
    });
  }
  if (Array.isArray(previous) || Array.isArray(next)) return [];
  return Object.entries(next as Record<string, unknown>).flatMap(([key, value]) => {
    const nextPath = path ? `${path}.${key}` : key;
    const prior = (previous as Record<string, unknown>)[key];
    return collectAddedPaths(prior, value, nextPath);
  });
}

function validateMechanics(
  subjectKind: "human" | "creature",
  targetLevel: "constrained" | "partial" | "complete",
  mechanics: unknown,
): unknown {
  if (mechanics === undefined) return undefined;
  if (targetLevel !== "complete") {
    return partialRulesMechanicsSchema.parse(mechanics);
  }
  return subjectKind === "human"
    ? validateCompleteHumanMechanics(mechanics)
    : rulesCreatureStateSchema.parse(mechanics);
}

export const realizeMechanicsOperation: RulesOperation<
  z.infer<typeof realizeMechanicsInputSchema>,
  z.infer<typeof realizeMechanicsResultSchema>
> = {
  metadata: {
    id: "rules.realization.realize-mechanics",
    kind: "ordinary",
    description:
      "Densify one human or creature's mechanics without changing already committed mechanical truth.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "realization", label: "Mechanical Realization" },
      tags: ["generation", "densification", "no-retcon"],
    },
  },
  inputSchema: realizeMechanicsInputSchema,
  outputSchema: realizeMechanicsResultSchema,
  execute(context, input) {
    const target = entity(context.world, input.entityId);
    const previousMechanics = target.data.mechanics;
    const nextMechanics = validateMechanics(
      input.subjectKind,
      input.targetLevel,
      input.mechanics,
    );
    if (nextMechanics !== undefined) {
      try {
        assertNoRetconJsonExtension(previousMechanics, nextMechanics);
      } catch (error) {
        throw new OperationValidationError(
          error instanceof Error ? error.message : "Mechanical retcon rejected",
        );
      }
    }

    const previous = context.world.mechanicalRealizations.find(
      (candidate) => candidate.entityId === input.entityId,
    );
    const constraints = appendConstraints(
      previous?.constraints ?? [],
      input.constraints,
    );
    const addedPaths = nextMechanics === undefined
      ? []
      : collectAddedPaths(previousMechanics, nextMechanics);
    const realization = mechanicalRealizationSchema.parse({
      entityId: input.entityId,
      level: input.targetLevel,
      constraints,
      history: [
        ...(previous?.history ?? []),
        {
          id: input.stepId,
          occurredAt: input.occurredAt,
          fromLevel: previous?.level ?? "unrealized",
          toLevel: input.targetLevel,
          sourceComponent: {
            id: "reference-rules",
            version: "0.3.0",
          },
          generatorVersion: input.generatorVersion,
          addedPaths,
          constraintIds: input.constraints.map((constraint) => constraint.id),
          reason: input.reason,
        },
      ],
    });

    const result = realizeMechanicsResultSchema.parse({
      entityId: input.entityId,
      level: input.targetLevel,
      addedPaths,
    });
    return {
      result,
      advanceTimeByMs: fictionalDurationMs(0),
      proposedMutations: [
        ...(nextMechanics === undefined
          ? []
          : [{
              kind: "set-entity-data" as const,
              entityId: input.entityId,
              key: "mechanics",
              value: jsonValueSchema.parse(nextMechanics),
            }]),
        {
          kind: "upsert-mechanical-realization" as const,
          realization,
        },
      ],
      proposedEvents: [{
        type: "rules.mechanics-realized",
        schemaVersion: 1,
        summary: `${input.entityId} mechanics are now ${input.targetLevel}.`,
        relatedEntityIds: [input.entityId],
        scopeIds: input.scopeIds,
        causedByEventIds: [],
        origin: {
          kind: "rules-operation",
          id: "rules.realization.realize-mechanics",
        },
        payload: mechanicsRealizedPayloadSchema.parse({
          ...result,
          subjectKind: input.subjectKind,
          constraintIds: input.constraints.map((constraint) => constraint.id),
        }),
        access: "gm-only",
      }],
    };
  },
};

export const creatureGrowthInputSchema = z.object({
  entityId: stableIdSchema,
  attributeDeltas: z.record(
    attributeIdSchema,
    z.number().finite().positive(),
  ),
  skillSpDeltas: z.array(z.object({
    skillId: stableIdSchema,
    amount: z.number().finite().positive(),
  }).strict()),
  reason: z.string().trim().min(1),
  scopeIds: z.array(stableIdSchema),
}).strict();

export const creatureGrowthResultSchema = z.object({
  entityId: stableIdSchema,
  changedAttributes: z.array(attributeIdSchema),
  changedSkills: z.array(stableIdSchema),
}).strict();

export const creatureGrewEventType: EventTypeDefinition<
  z.infer<typeof creatureGrowthResultSchema>
> = {
  type: "rules.creature-grew",
  schemaVersion: 1,
  payloadSchema: creatureGrowthResultSchema,
};

export const applyCreatureGrowthOperation: RulesOperation<
  z.infer<typeof creatureGrowthInputSchema>,
  z.infer<typeof creatureGrowthResultSchema>
> = {
  metadata: {
    id: "rules.realization.apply-creature-growth",
    kind: "ordinary",
    description:
      "Apply fictionally authorized creature growth without routing monsters through human XP or power progression.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "realization", label: "Mechanical Realization" },
      tags: ["creature", "growth", "simulation"],
    },
  },
  inputSchema: creatureGrowthInputSchema,
  outputSchema: creatureGrowthResultSchema,
  execute(context, input) {
    const target = entity(context.world, input.entityId);
    const current = rulesCreatureStateSchema.safeParse(target.data.mechanics);
    if (!current.success) {
      throw new OperationValidationError(
        `Entity ${input.entityId} does not have complete creature mechanics`,
      );
    }
    const updated = clone(current.data);
    for (const [attributeId, amount] of Object.entries(input.attributeDeltas)) {
      if (amount === undefined) continue;
      const key = attributeId as keyof typeof updated.attributes;
      updated.attributes[key] = (updated.attributes[key] ?? 0) + amount;
    }
    for (const delta of input.skillSpDeltas) {
      const skill = updated.skills.find((candidate) => candidate.id === delta.skillId);
      if (!skill) {
        throw new OperationValidationError(
          `Creature is missing skill ${delta.skillId}`,
        );
      }
      skill.sp += delta.amount;
    }
    const mechanics = rulesCreatureStateSchema.parse(updated);
    const result = creatureGrowthResultSchema.parse({
      entityId: input.entityId,
      changedAttributes: Object.keys(input.attributeDeltas),
      changedSkills: input.skillSpDeltas.map((delta) => delta.skillId),
    });
    return {
      result,
      advanceTimeByMs: fictionalDurationMs(0),
      proposedMutations: [{
        kind: "set-entity-data",
        entityId: input.entityId,
        key: "mechanics",
        value: jsonValueSchema.parse(mechanics),
      }],
      proposedEvents: [{
        type: "rules.creature-grew",
        schemaVersion: 1,
        summary: `${input.entityId} changed through creature growth: ${input.reason}`,
        relatedEntityIds: [input.entityId],
        scopeIds: input.scopeIds,
        causedByEventIds: [],
        origin: {
          kind: "rules-operation",
          id: "rules.realization.apply-creature-growth",
        },
        payload: result,
        access: "gm-only",
      }],
    };
  },
};
