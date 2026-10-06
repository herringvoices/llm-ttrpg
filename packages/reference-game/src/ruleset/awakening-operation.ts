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
  invinciblePassiveStatus,
  INVINCIBLE_POWER_ID,
  validateInvinciblePower,
} from "./invincible.js";
import {
  powerStateSchema,
  rulesActorStateSchema,
  validateCompleteHumanMechanics,
} from "./model.js";

export const manifestFirstPowerInputSchema = z.object({
  actorId: stableIdSchema,
  power: powerStateSchema,
  skillAllocations: z.array(z.object({
    skillId: stableIdSchema,
    amount: z.number().int().positive(),
    evidenceEventIds: z.array(stableIdSchema).min(1),
  }).strict()).min(1),
  scopeIds: z.array(stableIdSchema),
  causedByEventIds: z.array(stableIdSchema),
  reason: z.string().trim().min(1),
}).strict().superRefine((input, context) => {
  const total = input.skillAllocations.reduce(
    (sum, allocation) => sum + allocation.amount,
    0,
  );
  if (total !== 5) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Level 1 awakening must allocate exactly 5 level-up Skill Points",
      path: ["skillAllocations"],
    });
  }
  if (new Set(input.skillAllocations.map((item) => item.skillId)).size !==
      input.skillAllocations.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A skill may appear only once in the awakening allocation",
      path: ["skillAllocations"],
    });
  }
});

export const manifestFirstPowerResultSchema = z.object({
  actorId: stableIdSchema,
  characterLevel: z.literal(1),
  characterXp: z.literal(2),
  powerId: stableIdSchema,
  maxMana: z.number().finite().positive(),
  skillPointsAllocated: z.literal(5),
}).strict();

export const firstPowerManifestedEventType: EventTypeDefinition<
  z.infer<typeof manifestFirstPowerResultSchema>
> = {
  type: "rules.first-power-manifested",
  schemaVersion: 1,
  payloadSchema: manifestFirstPowerResultSchema,
};

export const manifestFirstPowerOperation: RulesOperation<
  z.infer<typeof manifestFirstPowerInputSchema>,
  z.infer<typeof manifestFirstPowerResultSchema>
> = {
  metadata: {
    id: "rules.progression.manifest-first-power",
    kind: "ordinary",
    description:
      "Cross a mundane human into Level 1, allocate the threshold's five Skill Points, and manifest a validated first power.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "progression", label: "Progression" },
      tags: ["awakening", "power", "level-threshold"],
    },
  },
  inputSchema: manifestFirstPowerInputSchema,
  outputSchema: manifestFirstPowerResultSchema,
  execute(context, input) {
    const entity = context.world.entities.find((item) => item.id === input.actorId);
    if (!entity) throw new OperationValidationError(`Missing actor ${input.actorId}`);
    if (entity.kind !== "actor") {
      throw new OperationValidationError(
        `Entity ${input.actorId} is not a human actor`,
      );
    }
    const parsed = rulesActorStateSchema.safeParse(entity.data.mechanics);
    if (!parsed.success) {
      throw new OperationValidationError(
        `Entity ${input.actorId} does not have complete human mechanics`,
      );
    }
    const current = parsed.data;
    if (
      current.progression.characterLevel !== 0 ||
      (current.progression.characterXp ?? 0) !== 0 ||
      (current.progression.powers ?? []).length > 0
    ) {
      throw new OperationValidationError(
        `Entity ${input.actorId} is not an unawakened Level 0 human`,
      );
    }
    if (
      input.power.characterLevelAtManifestation !== 1 ||
      input.power.manifestationStrength !== 1 ||
      input.power.pp !== 5 ||
      input.power.powerLevel !== 1
    ) {
      throw new OperationValidationError(
        "A first power must manifest at Level 1 with Strength 1 and the initial 5 PP budget",
      );
    }

    if (input.power.tags.includes("role.stat-enhancement")) {
      throw new OperationValidationError(
        "A raw stat-enhancement power cannot be the Awakening Earth player's first power",
      );
    }

    const next = JSON.parse(JSON.stringify(current)) as typeof current;
    for (const allocation of input.skillAllocations) {
      const skill = next.skills.find((item) => item.id === allocation.skillId);
      if (!skill) {
        throw new OperationValidationError(
          `Awakening allocation references missing skill ${allocation.skillId}`,
        );
      }
      skill.sp += allocation.amount;
    }
    const maxMana = next.attributes.endurance! + next.attributes.cool!;
    next.progression = {
      ...next.progression,
      characterXp: 2,
      characterLevel: 1,
      mana: { current: maxMana, max: maxMana },
      powers: [input.power],
    };
    if (input.power.id === INVINCIBLE_POWER_ID) {
      validateInvinciblePower(input.power);
      next.statuses.push(invinciblePassiveStatus(1, input.power));
    }
    const mechanics = validateCompleteHumanMechanics(next);
    const result = manifestFirstPowerResultSchema.parse({
      actorId: input.actorId,
      characterLevel: 1,
      characterXp: 2,
      powerId: input.power.id,
      maxMana,
      skillPointsAllocated: 5,
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
        type: "rules.first-power-manifested",
        schemaVersion: 1,
        summary: `${input.actorId} awakened and manifested ${input.power.name}: ${input.reason}`,
        relatedEntityIds: [input.actorId],
        scopeIds: input.scopeIds,
        causedByEventIds: input.causedByEventIds,
        origin: {
          kind: "rules-operation",
          id: "rules.progression.manifest-first-power",
        },
        payload: result,
        access: "public",
      }],
    };
  },
};
