import {
  stableIdSchema,
  type DeterministicRandom,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import {
  ATTRIBUTE_LABELS,
  attributeIdSchema,
  attributeModifierSchema,
  effectMagnitudeSchema,
  fixedResistanceProvenanceSchema,
  percentageModifierSchema,
  realizedEffectSchema,
  rulesMechanicalCoreSchema,
  rulesConstants,
  skillSchema,
  stressTrackSchema,
  type AttributeId,
  type EffectMagnitude,
  type RealizedEffect,
  type RulesMechanicalCore,
  type Skill,
} from "./model.js";

export const helperSchema = z
  .object({
    actorId: stableIdSchema,
    contribution: z.string().trim().min(1),
  })
  .strict();

export const combinedAttributeContributionSchema = z
  .object({
    actorId: stableIdSchema,
    attributeId: attributeIdSchema,
    justification: z.string().trim().min(1),
  })
  .strict();

export const performancePlanSchema = z
  .object({
    attributeIds: z.array(attributeIdSchema).min(1),
    applicableSkillIds: z.array(stableIdSchema),
    attributeModifiers: z.array(attributeModifierSchema),
    performanceModifiers: z.array(percentageModifierSchema),
    helpers: z.array(helperSchema),
    maxUsefulHelpers: z.number().int().min(0).max(8),
    combinedAttributeContributions: z.array(
      combinedAttributeContributionSchema,
    ),
  })
  .strict()
  .superRefine((plan, context) => {
    const attributeIds = new Set(plan.attributeIds);
    if (attributeIds.size !== plan.attributeIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Relevant attributes must be unique",
        path: ["attributeIds"],
      });
    }
    if (new Set(plan.applicableSkillIds).size !== plan.applicableSkillIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Applicable skills must be unique",
        path: ["applicableSkillIds"],
      });
    }
    const modifierIds = [
      ...plan.attributeModifiers.map((modifier) => modifier.id),
      ...plan.performanceModifiers.map((modifier) => modifier.id),
    ];
    if (new Set(modifierIds).size !== modifierIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A submitted modifier may apply only once",
        path: ["performanceModifiers"],
      });
    }
    const helperIds = plan.helpers.map((helper) => helper.actorId);
    if (new Set(helperIds).size !== helperIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Helpers must be unique",
        path: ["helpers"],
      });
    }
    if (plan.helpers.length > plan.maxUsefulHelpers) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Helper count exceeds the fictionally useful limit",
        path: ["helpers"],
      });
    }
    const combinedKeys = plan.combinedAttributeContributions.map(
      (item) => `${item.actorId}\u0000${item.attributeId}`,
    );
    if (new Set(combinedKeys).size !== combinedKeys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "One participant may contribute each combined attribute only once",
        path: ["combinedAttributeContributions"],
      });
    }
    const performanceModifierTotal = plan.performanceModifiers.reduce(
      (total, modifier) => total + modifier.percent,
      0,
    );
    if (Math.abs(performanceModifierTotal) > 40) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Submitted overall Performance modifiers exceed the Extreme band; change feasibility, Effect, timing, or fictional state instead",
        path: ["performanceModifiers"],
      });
    }
    for (const attributeId of attributeIds) {
      const total = plan.attributeModifiers
        .filter((modifier) => modifier.attributeId === attributeId)
        .reduce((sum, modifier) => sum + modifier.percent, 0);
      if (Math.abs(total) > 40) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `Submitted ${attributeId} modifiers exceed the Extreme band; change feasibility, Effect, timing, or fictional state instead`,
          path: ["attributeModifiers"],
        });
      }
    }
    for (const [index, contribution] of plan.combinedAttributeContributions.entries()) {
      if (!attributeIds.has(contribution.attributeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Combined capability must contribute to a relevant attribute",
          path: ["combinedAttributeContributions", index, "attributeId"],
        });
      }
      if (helperIds.includes(contribution.actorId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "A participant cannot provide both ordinary assistance and literal combined capability",
          path: ["combinedAttributeContributions", index, "actorId"],
        });
      }
    }
  });
export type PerformancePlan = z.infer<typeof performancePlanSchema>;

const appliedModifierSchema = percentageModifierSchema;

export const performanceCalculationSchema = z
  .object({
    attributes: z.array(
      z
        .object({
          id: attributeIdSchema,
          name: z.string().min(1),
          value: z.number().finite().nonnegative(),
          combinedContribution: z.number().finite().nonnegative(),
          modifiers: z.array(appliedModifierSchema),
          modifierPercent: z.number().finite(),
          modifiedValue: z.number().finite().nonnegative(),
        })
        .strict(),
    ),
    attributeBasis: z.number().finite().nonnegative(),
    applicableSkills: z.array(
      z
        .object({
          skillId: stableIdSchema,
          name: z.string().min(1),
          level: z.number().int().nonnegative(),
          rank: z.enum([
            "Untrained",
            "Novice",
            "Apprentice",
            "Journeyman",
            "Expert",
            "Master",
          ]),
          specificity: z.number().int().min(1).max(4),
          bonusPercent: z.number().finite().nonnegative(),
          effectiveContribution: z.number().finite().nonnegative(),
          trainedCapability: z.number().finite().nonnegative(),
        })
        .strict(),
    ),
    selectedSkillId: stableIdSchema.nullable(),
    trainedCapability: z.number().finite().nonnegative(),
    performanceModifiers: z.array(appliedModifierSchema),
    situationalModifierPercent: z.number().finite(),
    assistancePercent: z.number().finite().nonnegative(),
    stressPoints: z.number().int().nonnegative(),
    stressPenaltyPercent: z.number().finite().nonnegative(),
    totalPerformanceModifierPercent: z.number().finite(),
    deterministicPerformance: z.number().finite().nonnegative(),
    performanceRange: z
      .object({
        minimum: z.number().finite().nonnegative(),
        maximum: z.number().finite().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type PerformanceCalculation = z.infer<
  typeof performanceCalculationSchema
>;

export type SkillRank = PerformanceCalculation["applicableSkills"][number]["rank"];

export function skillLevelFromSp(sp: number): number {
  const parsedSp = skillSchema.shape.sp.parse(sp);
  let level = Math.floor(Math.cbrt((4 * parsedSp) / 5));
  while (level > 0 && parsedSp < minimumSpForSkillLevel(level)) level -= 1;
  while (parsedSp >= minimumSpForSkillLevel(level + 1)) level += 1;
  return level;
}

export function minimumSpForSkillLevel(level: number): number {
  const parsedLevel = z.number().int().nonnegative().parse(level);
  if (parsedLevel === 0) return 0;
  return Math.ceil((5 * parsedLevel ** 3) / 4);
}

export function skillRank(level: number): SkillRank {
  const parsed = z.number().int().nonnegative().parse(level);
  if (parsed === 0) return "Untrained";
  if (parsed <= 2) return "Novice";
  if (parsed <= 4) return "Apprentice";
  if (parsed <= 6) return "Journeyman";
  if (parsed <= 9) return "Expert";
  return "Master";
}

function sumPercent(modifiers: readonly { readonly percent: number }[]): number {
  return modifiers.reduce((total, modifier) => total + modifier.percent, 0);
}

function skillCalculation(skill: Skill, attributeBasis: number) {
  const level = skillLevelFromSp(skill.sp);
  const bonusPercent =
    level * skill.specificity * rulesConstants.skillPercentPerLevelSpecificity;
  const effectiveContribution = attributeBasis * (bonusPercent / 100);
  return {
    skillId: skill.id,
    name: skill.name,
    level,
    rank: skillRank(level),
    specificity: skill.specificity,
    bonusPercent,
    effectiveContribution,
    trainedCapability: attributeBasis + effectiveContribution,
  };
}

export function totalStressPoints(state: RulesMechanicalCore): number {
  return Object.values(state.stress).reduce((total, value) => total + value, 0);
}

export function stressPenaltyPercent(state: RulesMechanicalCore): number {
  return Math.min(
    totalStressPoints(state) * rulesConstants.stressPenaltyPercentPerPoint,
    rulesConstants.maximumStressPenaltyPercent,
  );
}

export function calculatePerformance(
  actorState: RulesMechanicalCore,
  plan: PerformancePlan,
  combinedActorStates: ReadonlyMap<string, RulesMechanicalCore> = new Map(),
): PerformanceCalculation {
  const actor = rulesMechanicalCoreSchema.parse(actorState);
  const parsedPlan = performancePlanSchema.parse(plan);
  const statusAttributeModifiers = actor.statuses.flatMap(
    (status) => status.attributeModifiers,
  );
  const attributes = parsedPlan.attributeIds.map((attributeId) => {
    const value = actor.attributes[attributeId];
    if (value === undefined) {
      throw new Error(`Actor is missing attribute ${attributeId}`);
    }
    const combinedContribution = parsedPlan.combinedAttributeContributions
      .filter((item) => item.attributeId === attributeId)
      .reduce((total, item) => {
        const contributor = combinedActorStates.get(item.actorId);
        if (!contributor) {
          throw new Error(
            `Missing combined-capability participant ${item.actorId}`,
          );
        }
        const contribution = contributor.attributes[attributeId];
        if (contribution === undefined) {
          throw new Error(
            `Combined-capability participant ${item.actorId} is missing ${attributeId}`,
          );
        }
        return total + contribution;
      }, 0);
    const modifiers = [
      ...parsedPlan.attributeModifiers,
      ...statusAttributeModifiers,
    ].filter((modifier) => modifier.attributeId === attributeId);
    const modifierPercent = sumPercent(modifiers);
    return {
      id: attributeId,
      name: ATTRIBUTE_LABELS[attributeId],
      value,
      combinedContribution,
      modifiers: modifiers.map(({ attributeId: _attributeId, ...modifier }) =>
        modifier
      ),
      modifierPercent,
      modifiedValue: Math.max(
        0,
        (value + combinedContribution) * (1 + modifierPercent / 100),
      ),
    };
  });
  const attributeBasis = attributes.reduce(
    (total, attribute) => total + attribute.modifiedValue,
    0,
  ) / attributes.length;
  const skillById = new Map(actor.skills.map((skill) => [skill.id, skill]));
  const applicableSkills = parsedPlan.applicableSkillIds.map((skillId) => {
    const skill = skillById.get(skillId);
    if (!skill) throw new Error(`Actor does not have applicable skill ${skillId}`);
    return skillCalculation(skill, attributeBasis);
  });
  applicableSkills.sort(
    (left, right) =>
      right.trainedCapability - left.trainedCapability ||
      left.skillId.localeCompare(right.skillId),
  );
  const selectedSkill = applicableSkills[0];
  const trainedCapability = selectedSkill?.trainedCapability ?? attributeBasis;
  const performanceModifiers = [
    ...parsedPlan.performanceModifiers,
    ...actor.statuses.flatMap((status) => status.performanceModifiers),
  ];
  const situationalModifierPercent = sumPercent(performanceModifiers);
  const assistancePercent =
    parsedPlan.helpers.length * rulesConstants.assistancePercentPerHelper;
  const stressPoints = totalStressPoints(actor);
  const stressPenalty = stressPenaltyPercent(actor);
  const totalPerformanceModifierPercent =
    situationalModifierPercent + assistancePercent - stressPenalty;
  const deterministicPerformance = Math.max(
    0,
    trainedCapability * (1 + totalPerformanceModifierPercent / 100),
  );
  const variance = rulesConstants.variancePercent / 100;

  return performanceCalculationSchema.parse({
    attributes,
    attributeBasis,
    applicableSkills,
    selectedSkillId: selectedSkill?.skillId ?? null,
    trainedCapability,
    performanceModifiers,
    situationalModifierPercent,
    assistancePercent,
    stressPoints,
    stressPenaltyPercent: stressPenalty,
    totalPerformanceModifierPercent,
    deterministicPerformance,
    performanceRange: {
      minimum: deterministicPerformance * (1 - variance),
      maximum: deterministicPerformance * (1 + variance),
    },
  });
}

export type CheckClassification = "automatic" | "impossible" | "uncertain";

export function classifyFixedResistance(
  performance: PerformanceCalculation,
  resistance: number,
): CheckClassification {
  const parsedResistance = z.number().finite().nonnegative().parse(resistance);
  if (performance.performanceRange.minimum > parsedResistance) return "automatic";
  if (performance.performanceRange.maximum <= parsedResistance) return "impossible";
  return "uncertain";
}

export function classifyOpposedResistance(
  actor: PerformanceCalculation,
  opponent: PerformanceCalculation,
): CheckClassification {
  if (actor.performanceRange.minimum > opponent.performanceRange.maximum) {
    return "automatic";
  }
  if (actor.performanceRange.maximum <= opponent.performanceRange.minimum) {
    return "impossible";
  }
  return "uncertain";
}

export interface PerformanceRoll {
  readonly dice: readonly [number, number];
  readonly variancePercent: number;
  readonly finalPerformance: number;
}

export function rollPerformanceVariance(
  deterministicPerformance: number,
  rng: DeterministicRandom,
): PerformanceRoll {
  const parsed = z.number().finite().nonnegative().parse(
    deterministicPerformance,
  );
  const first = Math.floor(rng.next() * 16) + 1;
  const second = Math.floor(rng.next() * 16) + 1;
  const variancePercent = first + second - 17;
  return {
    dice: [first, second],
    variancePercent,
    finalPerformance: parsed * (1 + variancePercent / 100),
  };
}

export function checkedEffectThresholds(baseResistance: number) {
  const resistance = z.number().finite().positive().parse(baseResistance);
  return {
    effect1:
      resistance * rulesConstants.checkedEffectThresholdMultipliers[0],
    effect2:
      resistance * rulesConstants.checkedEffectThresholdMultipliers[1],
    effect3:
      resistance * rulesConstants.checkedEffectThresholdMultipliers[2],
  };
}

export function checkedRealizedEffect(
  performance: number,
  baseResistance: number,
  potentialEffect: EffectMagnitude,
): RealizedEffect {
  const parsedPerformance = z.number().finite().nonnegative().parse(performance);
  const potential = effectMagnitudeSchema.parse(potentialEffect);
  const thresholds = checkedEffectThresholds(baseResistance);
  const tolerance = Number.EPSILON * Math.max(1, parsedPerformance);
  let realized: RealizedEffect;
  if (parsedPerformance <= thresholds.effect1 + tolerance) realized = 0;
  else if (parsedPerformance < thresholds.effect2 - tolerance) realized = 1;
  else if (parsedPerformance < thresholds.effect3 - tolerance) realized = 2;
  else realized = 3;
  return realizedEffectSchema.parse(Math.min(realized, potential));
}

const skillSpAwardTable = Object.freeze({
  1: { failure: 0.25, success: 0.5 },
  2: { failure: 0.5, success: 1 },
  3: { failure: 0.75, success: 1.5 },
} as const);

export function skillSpAward(
  potentialEffect: EffectMagnitude,
  succeeded: boolean,
): number {
  const potential = effectMagnitudeSchema.parse(potentialEffect);
  return skillSpAwardTable[potential][succeeded ? "success" : "failure"];
}

export function benchmarkFixedResistance(
  benchmark: RulesMechanicalCore,
  plan: PerformancePlan,
  description: string,
) {
  const calculation = calculatePerformance(benchmark, plan);
  return {
    value: calculation.deterministicPerformance,
    provenance: fixedResistanceProvenanceSchema.parse({
      kind: "benchmark",
      description,
    }),
    benchmark: calculation,
  };
}

export const repeatAttemptChangeSchema = z.enum([
  "time",
  "action-window",
  "approach",
  "preparation",
  "resources",
  "circumstances",
]);

export const repeatAttemptSchema = z
  .object({
    priorActionId: stableIdSchema,
    changes: z.array(repeatAttemptChangeSchema).min(1),
    description: z.string().trim().min(1),
  })
  .strict();

export const meaningfulStageSchema = z
  .object({
    id: stableIdSchema,
    description: z.string().trim().min(1),
    expectedDurationMs: z.number().int().nonnegative(),
    changes: z
      .array(
        z.enum([
          "competency",
          "resistance",
          "circumstances",
          "consequences",
          "decision",
        ]),
      )
      .min(1),
  })
  .strict();

export const extendedTaskSchema = z
  .object({
    goal: z.string().trim().min(1),
    stages: z.array(meaningfulStageSchema).min(2),
  })
  .strict()
  .superRefine((task, context) => {
    const ids = task.stages.map((stage) => stage.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Extended-task stage IDs must be unique",
        path: ["stages"],
      });
    }
  });

export const materialEffectSchema = z
  .object({
    intentId: stableIdSchema,
    timeToMaterialEffectMs: z.number().int().nonnegative(),
  })
  .strict();

export function groupMaterialEffectsByTime(
  effects: readonly z.infer<typeof materialEffectSchema>[],
) {
  const sorted = z.array(materialEffectSchema).parse(effects).sort(
    (left, right) =>
      left.timeToMaterialEffectMs - right.timeToMaterialEffectMs ||
      left.intentId.localeCompare(right.intentId),
  );
  const groups: Array<{
    timeToMaterialEffectMs: number;
    effects: typeof sorted;
  }> = [];
  for (const effect of sorted) {
    const prior = groups.at(-1);
    if (prior?.timeToMaterialEffectMs === effect.timeToMaterialEffectMs) {
      prior.effects.push(effect);
    } else {
      groups.push({
        timeToMaterialEffectMs: effect.timeToMaterialEffectMs,
        effects: [effect],
      });
    }
  }
  return groups;
}

export function relevantAttributeLabels(ids: readonly AttributeId[]): string[] {
  return z.array(attributeIdSchema).parse(ids).map((id) => ATTRIBUTE_LABELS[id]);
}
