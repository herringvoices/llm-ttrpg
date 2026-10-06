import { stableIdSchema } from "@llm-ttrpg/engine";
import { z } from "zod";

export const ATTRIBUTE_IDS = [
  "strength",
  "endurance",
  "durability",
  "agility",
  "perception",
  "fine-motor-skills",
  "critical-thinking",
  "learning",
  "focus",
  "memory",
  "creativity",
  "improvisation",
  "presence",
  "empathy",
  "attractiveness",
  "cool",
  "social-fluency",
  "self-awareness",
] as const;

export const attributeIdSchema = z.enum(ATTRIBUTE_IDS);
export type AttributeId = z.infer<typeof attributeIdSchema>;

export const ATTRIBUTE_LABELS: Readonly<Record<AttributeId, string>> = {
  strength: "Strength",
  endurance: "Endurance",
  durability: "Durability",
  agility: "Agility",
  perception: "Perception",
  "fine-motor-skills": "Fine Motor Skills",
  "critical-thinking": "Critical Thinking",
  learning: "Learning",
  focus: "Focus",
  memory: "Memory",
  creativity: "Creativity",
  improvisation: "Improvisation",
  presence: "Presence",
  empathy: "Empathy",
  attractiveness: "Attractiveness",
  cool: "Cool",
  "social-fluency": "Social Fluency",
  "self-awareness": "Self-Awareness",
};

export const skillSpecificitySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type SkillSpecificity = z.infer<typeof skillSpecificitySchema>;

export const skillSchema = z
  .object({
    id: stableIdSchema,
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    specificity: skillSpecificitySchema,
    sp: z.number().finite().nonnegative(),
  })
  .strict();
export type Skill = z.infer<typeof skillSchema>;

export const stressTrackSchema = z.enum([
  "injury",
  "fear",
  "anger",
  "exhaustion",
  "insecurity",
]);
export type StressTrack = z.infer<typeof stressTrackSchema>;

export const stressStateSchema = z
  .object({
    injury: z.number().int().min(0).max(5),
    fear: z.number().int().min(0).max(5),
    anger: z.number().int().min(0).max(5),
    exhaustion: z.number().int().min(0).max(5),
    insecurity: z.number().int().min(0).max(5),
  })
  .strict();
export type StressState = z.infer<typeof stressStateSchema>;

export const percentageModifierSchema = z
  .object({
    id: stableIdSchema,
    description: z.string().trim().min(1),
    percent: z.number().finite().min(-40).max(40),
  })
  .strict();
export type PercentageModifier = z.infer<typeof percentageModifierSchema>;

export const attributeModifierSchema = percentageModifierSchema
  .extend({ attributeId: attributeIdSchema })
  .strict();
export type AttributeModifier = z.infer<typeof attributeModifierSchema>;

export const derivedAttributeBonusSchema = z.object({
  id: stableIdSchema,
  description: z.string().trim().min(1),
  attributeId: attributeIdSchema,
  amount: z.number().finite(),
}).strict();

export const statusSchema = z
  .object({
    id: stableIdSchema,
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    attributeModifiers: z.array(attributeModifierSchema),
    performanceModifiers: z.array(percentageModifierSchema),
    derivedAttributeBonuses: z.array(derivedAttributeBonusSchema).optional(),
    sourcePowerId: stableIdSchema.optional(),
    expiresAt: z.string().datetime().optional(),
    protection: z.object({
      blocksExternalPhysicalBodilyInjury: z.literal(true),
    }).strict().optional(),
  })
  .strict();
export type Status = z.infer<typeof statusSchema>;

const attributesSchema = z
  .record(attributeIdSchema, z.number().finite().nonnegative())
  .superRefine((attributes, context) => {
    for (const id of ATTRIBUTE_IDS) {
      if (attributes[id] === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing attribute: ${id}`,
          path: [id],
        });
      }
    }
  });

export const skillUseEvidenceSchema = z
  .object({
    declaredActionId: stableIdSchema,
    skillId: stableIdSchema,
    baseAmount: z.number().finite().positive(),
    learningRateMultiplier: z.number().finite().positive(),
    amount: z.number().finite().positive(),
    potentialEffect: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    succeeded: z.boolean(),
  })
  .strict();

export function characterLevelFromXp(xp: number): number {
  const parsedXp = z.number().int().nonnegative().parse(xp);
  return Math.floor(Math.cbrt((4 * parsedXp) / 5));
}

export function pointDerivedLevel(points: number): number {
  const parsed = z.number().int().nonnegative().parse(points);
  return Math.floor(Math.cbrt((4 * parsed) / 5));
}

export const powerGrowthProfileSchema = z.enum([
  "milestone",
  "scaling",
  "hybrid",
]);

export const powerTagSchema = stableIdSchema;
export type PowerTag = z.infer<typeof powerTagSchema>;

export const powerDiscoveredBehaviorSchema = z.object({
  id: stableIdSchema,
  question: z.string().trim().min(1),
  outcome: z.enum(["valid", "invalid", "conditional"]),
  ruling: z.string().trim().min(1),
  establishedBy: z.enum(["authored", "experiment", "adjudication"]),
  evidenceEventIds: z.array(stableIdSchema),
}).strict();
export type PowerDiscoveredBehavior = z.infer<
  typeof powerDiscoveredBehaviorSchema
>;

export const powerCommittedMilestoneSchema = z.object({
  powerLevel: z.number().int().positive(),
  description: z.string().trim().min(1),
  functionIds: z.array(stableIdSchema).min(1),
}).strict();
export type PowerCommittedMilestone = z.infer<
  typeof powerCommittedMilestoneSchema
>;

export const powerFunctionSchema = z.object({
  id: stableIdSchema,
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  manaCost: z.number().finite().nonnegative(),
  activationTimeMs: z.number().int().nonnegative(),
  conditions: z.array(z.string().trim().min(1)),
  targets: z.array(z.string().trim().min(1)),
  limits: z.array(z.string().trim().min(1)),
  scalingFormula: z.string().trim().min(1).optional(),
}).strict();

export const powerStateSchema = z.object({
  id: stableIdSchema,
  name: z.string().trim().min(1),
  corePrinciple: z.string().trim().min(1),
  characterLevelAtManifestation: z.number().int().positive(),
  manifestationStrength: z.number().int().positive(),
  growthProfile: powerGrowthProfileSchema,
  pp: z.number().int().nonnegative(),
  powerLevel: z.number().int().nonnegative(),
  functions: z.array(powerFunctionSchema).min(1),
  developmentAxes: z.array(z.string().trim().min(1)).min(1),
  tags: z.array(powerTagSchema),
  discoveredBehaviors: z.array(powerDiscoveredBehaviorSchema),
  committedMilestones: z.array(powerCommittedMilestoneSchema),
  balanceRationale: z.string().trim().min(1),
}).strict().superRefine((power, context) => {
  if (power.powerLevel !== pointDerivedLevel(power.pp)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Power Level must be derived from PP",
      path: ["powerLevel"],
    });
  }
  const expectedStrength = 1 + Math.floor(power.characterLevelAtManifestation / 2);
  if (power.manifestationStrength !== expectedStrength) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Manifestation Strength must be derived from manifestation level",
      path: ["manifestationStrength"],
    });
  }

  const functionIds = new Set<string>();
  for (const [index, fn] of power.functions.entries()) {
    if (functionIds.has(fn.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate power function ID: ${fn.id}`,
        path: ["functions", index, "id"],
      });
    }
    functionIds.add(fn.id);
  }

  const tags = new Set<string>();
  for (const [index, tag] of power.tags.entries()) {
    if (tags.has(tag)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate power tag: ${tag}`,
        path: ["tags", index],
      });
    }
    tags.add(tag);
  }

  const behaviorIds = new Set<string>();
  for (const [index, behavior] of power.discoveredBehaviors.entries()) {
    if (behaviorIds.has(behavior.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate discovered power behavior ID: ${behavior.id}`,
        path: ["discoveredBehaviors", index, "id"],
      });
    }
    behaviorIds.add(behavior.id);
  }

  const milestoneLevels = new Set<number>();
  for (const [index, milestone] of power.committedMilestones.entries()) {
    if (milestone.powerLevel > power.powerLevel) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Committed power milestones cannot be above the current Power Level",
        path: ["committedMilestones", index, "powerLevel"],
      });
    }
    if (milestoneLevels.has(milestone.powerLevel)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate committed milestone at Power Level ${milestone.powerLevel}`,
        path: ["committedMilestones", index, "powerLevel"],
      });
    }
    milestoneLevels.add(milestone.powerLevel);
    for (const functionId of milestone.functionIds) {
      if (!functionIds.has(functionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Committed milestone references missing function ${functionId}`,
          path: ["committedMilestones", index, "functionIds"],
        });
      }
    }
  }
});
export type PowerState = z.infer<typeof powerStateSchema>;

export const manaStateSchema = z.object({
  current: z.number().finite().nonnegative(),
  max: z.number().finite().positive(),
}).strict().superRefine((mana, context) => {
  if (mana.current > mana.max) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Current Mana cannot exceed Max Mana",
      path: ["current"],
    });
  }
});

export const humanProgressionSchema = z.object({
  characterLevel: z.number().int().nonnegative(),
  characterXp: z.number().int().nonnegative().optional(),
  skillPointsPerCharacterLevel: z.literal(5),
  skillLearningRateMultiplier: z.number().finite().positive(),
  skillUseEvidence: z.array(skillUseEvidenceSchema),
  mana: manaStateSchema.optional(),
  powers: z.array(powerStateSchema).optional(),
}).strict().superRefine((progression, context) => {
  if (
    progression.characterXp !== undefined &&
    characterLevelFromXp(progression.characterXp) !== progression.characterLevel
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Character Level must be derived from Character XP",
      path: ["characterLevel"],
    });
  }
});
export type HumanProgression = z.infer<typeof humanProgressionSchema>;

function validateMechanicalCollections(
  state: {
    readonly skills: readonly Skill[];
    readonly statuses: readonly Status[];
  },
  context: z.RefinementCtx,
): void {
  const skillIds = new Set<string>();
  const normalizedNames = new Set<string>();
  for (const [index, skill] of state.skills.entries()) {
    const normalizedName = skill.name.trim().toLocaleLowerCase();
    if (skillIds.has(skill.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate skill ID: ${skill.id}`,
        path: ["skills", index, "id"],
      });
    }
    if (normalizedNames.has(normalizedName)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate normalized skill name: ${skill.name}`,
        path: ["skills", index, "name"],
      });
    }
    skillIds.add(skill.id);
    normalizedNames.add(normalizedName);
  }
  const statusIds = new Set<string>();
  for (const [index, status] of state.statuses.entries()) {
    if (statusIds.has(status.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate status ID: ${status.id}`,
        path: ["statuses", index, "id"],
      });
    }
    statusIds.add(status.id);
  }
}

const rulesMechanicalCoreBaseSchema = z.object({
  attributes: attributesSchema,
  skills: z.array(skillSchema),
  stress: stressStateSchema,
  statuses: z.array(statusSchema),
});

export const rulesMechanicalCoreSchema = rulesMechanicalCoreBaseSchema
  .passthrough()
  .superRefine(validateMechanicalCollections);
export type RulesMechanicalCore = z.infer<typeof rulesMechanicalCoreSchema>;

export const rulesActorStateSchema = rulesMechanicalCoreBaseSchema.extend({
  progression: humanProgressionSchema,
  isPlayerCharacter: z.boolean(),
}).strict().superRefine(validateMechanicalCollections);
export type RulesActorState = z.infer<typeof rulesActorStateSchema>;

export const rulesCreatureStateSchema = rulesMechanicalCoreBaseSchema.extend({
  isPlayerCharacter: z.literal(false),
}).strict().superRefine(validateMechanicalCollections);
export type RulesCreatureState = z.infer<typeof rulesCreatureStateSchema>;

export const rulesEntityStateSchema = z.union([
  rulesActorStateSchema,
  rulesCreatureStateSchema,
]);
export type RulesEntityState = z.infer<typeof rulesEntityStateSchema>;

export const partialRulesMechanicsSchema = z.object({
  attributes: z.record(attributeIdSchema, z.number().finite().nonnegative()).optional(),
  skills: z.array(skillSchema).optional(),
  stress: stressStateSchema.optional(),
  statuses: z.array(statusSchema).optional(),
  progression: humanProgressionSchema.optional(),
  isPlayerCharacter: z.boolean().optional(),
}).strict().superRefine((state, context) => {
  if (Object.keys(state).length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Partial mechanics must establish at least one field",
    });
  }
  if (state.skills || state.statuses) {
    validateMechanicalCollections({
      skills: state.skills ?? [],
      statuses: state.statuses ?? [],
    }, context);
  }
});
export type PartialRulesMechanics = z.infer<typeof partialRulesMechanicsSchema>;

export function validateCompleteHumanMechanics(
  value: unknown,
): RulesActorState {
  const state = rulesActorStateSchema.parse(value);
  const powers = state.progression.powers ?? [];
  if (state.progression.characterLevel === 0) {
    if (powers.length > 0) {
      throw new Error("A Level 0 mundane human cannot have manifested powers");
    }
    return state;
  }
  if (powers.length === 0 || !state.progression.mana) {
    throw new Error(
      "A complete awakened human requires manifested power and Mana state",
    );
  }
  return state;
}


export const effectMagnitudeSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type EffectMagnitude = z.infer<typeof effectMagnitudeSchema>;

export const realizedEffectSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type RealizedEffect = z.infer<typeof realizedEffectSchema>;

export const fixedResistanceProvenanceSchema = z
  .object({
    kind: z.enum(["direct", "authored", "benchmark"]),
    description: z.string().trim().min(1),
    sourceId: stableIdSchema.optional(),
    sourceIds: z.array(stableIdSchema).min(1).optional(),
  })
  .strict();
export type FixedResistanceProvenance = z.infer<
  typeof fixedResistanceProvenanceSchema
>;

export const modifierBandPercent = Object.freeze({
  minor: 5,
  significant: 10,
  major: 20,
  extreme: 40,
} as const);

export const rulesConstants = Object.freeze({
  variancePercent: 15,
  skillPercentPerLevelSpecificity: 5,
  stressPenaltyPercentPerPoint: 5,
  maximumStressPenaltyPercent: 70,
  assistancePercentPerHelper: 5,
  takenOutAt: 5,
  skillPointsPerCharacterLevel: 5,
  checkedEffectThresholdMultipliers: [1, 1.15, 1.3] as const,
});

export function emptyStressState(): StressState {
  return {
    injury: 0,
    fear: 0,
    anger: 0,
    exhaustion: 0,
    insecurity: 0,
  };
}
