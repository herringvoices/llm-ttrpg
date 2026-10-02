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

export const statusSchema = z
  .object({
    id: stableIdSchema,
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    attributeModifiers: z.array(attributeModifierSchema),
    performanceModifiers: z.array(percentageModifierSchema),
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

export const rulesActorStateSchema = z
  .object({
    attributes: attributesSchema,
    skills: z.array(skillSchema),
    stress: stressStateSchema,
    statuses: z.array(statusSchema),
    progression: z
      .object({
        characterLevel: z.number().int().positive(),
        skillPointsPerCharacterLevel: z.literal(5),
        skillLearningRateMultiplier: z.number().finite().positive(),
        skillUseEvidence: z.array(skillUseEvidenceSchema),
      })
      .strict(),
    isPlayerCharacter: z.boolean(),
  })
  .strict()
  .superRefine((state, context) => {
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
  });
export type RulesActorState = z.infer<typeof rulesActorStateSchema>;

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
