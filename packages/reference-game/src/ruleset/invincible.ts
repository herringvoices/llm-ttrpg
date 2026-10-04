import {
  advanceFictionalInstant,
  fictionalDurationMs,
  fictionalInstant,
  jsonValueSchema,
  OperationValidationError,
  stableIdSchema,
  type EventTypeDefinition,
  type RulesOperation,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import {
  powerStateSchema,
  rulesActorStateSchema,
  statusSchema,
  type PowerState,
} from "./model.js";

export const INVINCIBLE_POWER_ID = "power.invincible";
export const INVINCIBLE_ACTIVE_STATUS_ID = "status.invincible.active";
export const INVINCIBLE_PASSIVE_STATUS_ID = "status.invincible.reinforced-body";

export const invinciblePower = powerStateSchema.parse({
  id: INVINCIBLE_POWER_ID,
  name: "Invincible",
  corePrinciple:
    "The user's body is supernaturally reinforced and can briefly reject new external physical bodily injury.",
  characterLevelAtManifestation: 1,
  manifestationStrength: 1,
  growthProfile: "scaling",
  pp: 5,
  powerLevel: 1,
  functions: [
    {
      id: "power-function.invincible.reinforced-body",
      name: "Reinforced Body",
      description: "Passively derives additional Durability and Strength.",
      manaCost: 0,
      activationTimeMs: 0,
      conditions: ["the power is manifested"],
      targets: ["self"],
      limits: ["derived modifiers do not overwrite base attributes"],
      scalingFormula: "Durability=floor(2*CL+2*M+3*floor(PL^2/4)); Strength=floor(Durability/2)",
    },
    {
      id: "power-function.invincible.state",
      name: "Invincible State",
      description: "Briefly prevents new external physical bodily Injury.",
      manaCost: 25,
      activationTimeMs: 250,
      conditions: ["at least 25 Mana", "self only"],
      targets: ["self"],
      limits: [
        "2 second duration at Manifestation Strength 1 and Power Level 1",
        "does not prevent displacement restraint suffocation non-Injury Stress or mind/social effects",
      ],
      scalingFormula: "durationSeconds=1+M+floor(PL^2/4)",
    },
  ],
  developmentAxes: ["passive reinforcement", "active duration"],
  balanceRationale:
    "The active is short, self-only, costs meaningful Mana, and protects injury rather than all consequences.",
});

export function validateInvinciblePower(power: PowerState): PowerState {
  const parsed = powerStateSchema.parse(power);
  if (JSON.stringify(parsed) !== JSON.stringify(invinciblePower)) {
    throw new OperationValidationError(
      "Invincible must use its settled Level-1 reference specification",
    );
  }
  return parsed;
}

export function invinciblePassiveStatus(
  characterLevel: number,
  power: PowerState,
) {
  const growth = Math.floor((power.powerLevel ** 2) / 4);
  const durabilityBonus = Math.floor(
    2 * characterLevel + 2 * power.manifestationStrength + 3 * growth,
  );
  return statusSchema.parse({
    id: INVINCIBLE_PASSIVE_STATUS_ID,
    name: "Reinforced Body",
    description: "Invincible's derived passive bodily reinforcement.",
    attributeModifiers: [],
    performanceModifiers: [],
    derivedAttributeBonuses: [
      {
        id: "modifier.invincible.durability",
        description: "Invincible Level-1 Durability bonus",
        attributeId: "durability",
        amount: durabilityBonus,
      },
      {
        id: "modifier.invincible.strength",
        description: "Invincible Level-1 Strength bonus",
        attributeId: "strength",
        amount: Math.floor(durabilityBonus / 2),
      },
    ],
    sourcePowerId: power.id,
  });
}

export const activateInvincibleInputSchema = z.object({
  actorId: stableIdSchema,
  scopeIds: z.array(stableIdSchema),
  causedByEventIds: z.array(stableIdSchema),
}).strict();

export const activateInvincibleResultSchema = z.object({
  actorId: stableIdSchema,
  powerId: z.literal(INVINCIBLE_POWER_ID),
  manaSpent: z.literal(25),
  manaRemaining: z.number().finite().nonnegative(),
  activationTimeMs: z.literal(250),
  durationMs: z.literal(2000),
  activeFrom: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();

export const invincibleActivatedEventType: EventTypeDefinition<
  z.infer<typeof activateInvincibleResultSchema>
> = {
  type: "rules.invincible-activated",
  schemaVersion: 1,
  payloadSchema: activateInvincibleResultSchema,
};

export const activateInvincibleOperation: RulesOperation<
  z.infer<typeof activateInvincibleInputSchema>,
  z.infer<typeof activateInvincibleResultSchema>
> = {
  metadata: {
    id: "rules.progression.activate-invincible",
    kind: "ordinary",
    description:
      "Spend Mana and activate Invincible's settled short external-bodily-injury protection.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "progression", label: "Progression" },
      tags: ["power", "invincible", "mana"],
    },
  },
  inputSchema: activateInvincibleInputSchema,
  outputSchema: activateInvincibleResultSchema,
  execute(context, input) {
    const entity = context.world.entities.find((item) => item.id === input.actorId);
    if (!entity) throw new OperationValidationError(`Missing actor ${input.actorId}`);
    const mechanics = rulesActorStateSchema.safeParse(entity.data.mechanics);
    if (!mechanics.success) {
      throw new OperationValidationError(
        `Actor ${input.actorId} lacks complete human mechanics`,
      );
    }
    const next = JSON.parse(JSON.stringify(mechanics.data)) as z.infer<
      typeof rulesActorStateSchema
    >;
    const power = next.progression.powers?.find((item) =>
      item.id === INVINCIBLE_POWER_ID
    );
    if (!power) {
      throw new OperationValidationError(
        `Actor ${input.actorId} has not manifested Invincible`,
      );
    }
    validateInvinciblePower(power);
    const mana = next.progression.mana;
    if (!mana || mana.current < 25) {
      throw new OperationValidationError("Invincible requires 25 available Mana");
    }
    const activeFrom = advanceFictionalInstant(
      fictionalInstant(String(context.world.fictionalTime)),
      fictionalDurationMs(250),
    );
    const expiresAt = advanceFictionalInstant(
      activeFrom,
      fictionalDurationMs(2000),
    );
    mana.current -= 25;
    const active = statusSchema.parse({
      id: INVINCIBLE_ACTIVE_STATUS_ID,
      name: "Invincible State",
      description:
        "New external physical bodily Injury is prevented; other consequences remain resolvable.",
      attributeModifiers: [],
      performanceModifiers: [],
      sourcePowerId: INVINCIBLE_POWER_ID,
      expiresAt,
      protection: { blocksExternalPhysicalBodilyInjury: true },
    });
    const existing = next.statuses.findIndex((status) => status.id === active.id);
    if (existing === -1) next.statuses.push(active);
    else next.statuses[existing] = active;
    const result = activateInvincibleResultSchema.parse({
      actorId: input.actorId,
      powerId: INVINCIBLE_POWER_ID,
      manaSpent: 25,
      manaRemaining: mana.current,
      activationTimeMs: 250,
      durationMs: 2000,
      activeFrom,
      expiresAt,
    });
    return {
      result,
      advanceTimeByMs: fictionalDurationMs(250),
      proposedMutations: [{
        kind: "set-entity-data",
        entityId: input.actorId,
        key: "mechanics",
        value: jsonValueSchema.parse(rulesActorStateSchema.parse(next)),
      }],
      proposedEvents: [{
        type: "rules.invincible-activated",
        schemaVersion: 1,
        summary: `${input.actorId} activated Invincible for two seconds.`,
        relatedEntityIds: [input.actorId],
        scopeIds: input.scopeIds,
        causedByEventIds: input.causedByEventIds,
        origin: {
          kind: "rules-operation",
          id: "rules.progression.activate-invincible",
        },
        payload: result,
        access: "public",
      }],
    };
  },
};
