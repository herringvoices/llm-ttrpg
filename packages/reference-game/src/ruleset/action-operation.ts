import {
  fictionalDurationMs,
  jsonValueSchema,
  OperationValidationError,
  stableIdSchema,
  type DeepReadonly,
  type EventTypeDefinition,
  type OperationWorldView,
  type ResolutionOperation,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import {
  calculatePerformance,
  checkedEffectThresholds,
  checkedRealizedEffect,
  classifyFixedResistance,
  classifyOpposedResistance,
  performanceCalculationSchema,
  performancePlanSchema,
  rollPerformanceVariance,
  skillSpAward,
  type CheckClassification,
  type PerformanceCalculation,
  type PerformancePlan,
  type PerformanceRoll,
} from "./mechanics.js";
import {
  effectMagnitudeSchema,
  fixedResistanceProvenanceSchema,
  realizedEffectSchema,
  rulesActorStateSchema,
  statusSchema,
  stressTrackSchema,
  type EffectMagnitude,
  type RulesActorState,
} from "./model.js";

const fixedResistanceSchema = z
  .object({
    kind: z.literal("fixed"),
    value: z.number().finite().nonnegative(),
    provenance: fixedResistanceProvenanceSchema,
  })
  .strict();

const opposedResistanceSchema = z
  .object({
    kind: z.literal("opposed"),
    actorId: stableIdSchema,
    performance: performancePlanSchema,
  })
  .strict();

export const resistanceSchema = z.discriminatedUnion("kind", [
  fixedResistanceSchema,
  opposedResistanceSchema,
]);

const fixedEffectSchema = z
  .object({
    mode: z.literal("fixed"),
    potentialEffect: effectMagnitudeSchema,
  })
  .strict();

const derivedEffectObjectSchema = z
  .object({
    mode: z.literal("derived"),
    potentialEffect: effectMagnitudeSchema,
    derivedEffect: effectMagnitudeSchema,
    basis: z.string().trim().min(1),
  })
  .strict();

const derivedEffectSchema = derivedEffectObjectSchema.superRefine(
  (effect, context) => {
    if (effect.derivedEffect > effect.potentialEffect) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Derived Effect cannot exceed Potential Effect",
        path: ["derivedEffect"],
      });
    }
  },
);

const checkedEffectSchema = z
  .object({
    mode: z.literal("checked"),
    potentialEffect: effectMagnitudeSchema,
    performance: performancePlanSchema,
    baseResistance: z.number().finite().positive(),
    provenance: fixedResistanceProvenanceSchema,
  })
  .strict();

export const effectPlanSchema = z.union([
  fixedEffectSchema,
  derivedEffectSchema,
  checkedEffectSchema,
]);

const stressConsequenceSchema = z
  .object({
    targetId: stableIdSchema,
    track: stressTrackSchema,
    statusOnTakenOut: statusSchema.optional(),
    normallyFatal: z.boolean(),
    pcDeathConsent: z.boolean(),
  })
  .strict()
  .superRefine((consequence, context) => {
    if (consequence.normallyFatal && consequence.track !== "injury") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only an Injury consequence may be normally fatal",
        path: ["normallyFatal"],
      });
    }
  });

const feasibilitySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("feasible") }).strict(),
  z
    .object({
      status: z.literal("impossible"),
      reason: z.string().trim().min(1),
    })
    .strict(),
]);

export const resolveActionInputSchema = z
  .object({
    declaredActionId: stableIdSchema,
    actorId: stableIdSchema,
    approach: z.string().trim().min(1),
    feasibility: feasibilitySchema,
    performance: performancePlanSchema,
    resistance: resistanceSchema,
    effect: effectPlanSchema,
    stressConsequence: stressConsequenceSchema.optional(),
    timeToMaterialEffectMs: z.number().int().nonnegative(),
    scopeIds: z.array(stableIdSchema),
  })
  .strict();
export type ResolveActionInput = z.infer<typeof resolveActionInputSchema>;

const classificationSchema = z.enum([
  "automatic",
  "impossible",
  "uncertain",
]);

const resistanceBasisSchema = z.discriminatedUnion("kind", [
  fixedResistanceSchema,
  z
    .object({
      kind: z.literal("opposed"),
      actorId: stableIdSchema,
      value: z.number().finite().nonnegative(),
      performance: performanceCalculationSchema,
    })
    .strict(),
]);

const effectBasisSchema = z.discriminatedUnion("mode", [
  fixedEffectSchema.extend({ classification: z.literal("automatic") }).strict(),
  derivedEffectObjectSchema
    .extend({ classification: z.literal("automatic") })
    .strict(),
  checkedEffectSchema
    .omit({ performance: true })
    .extend({
      performance: performanceCalculationSchema,
      thresholds: z
        .object({
          effect1: z.number().finite().positive(),
          effect2: z.number().finite().positive(),
          effect3: z.number().finite().positive(),
        })
        .strict(),
      classification: classificationSchema,
    })
    .strict(),
]);

export const actionResolutionBasisSchema = z
  .object({
    declaredActionId: stableIdSchema,
    approach: z.string().min(1),
    feasibility: feasibilitySchema,
    actorPerformance: performanceCalculationSchema,
    resistance: resistanceBasisSchema,
    actionClassification: classificationSchema,
    effect: effectBasisSchema,
  })
  .strict();
export type ActionResolutionBasis = z.infer<
  typeof actionResolutionBasisSchema
>;

const performanceRollSchema = z
  .object({
    dice: z.tuple([
      z.number().int().min(1).max(16),
      z.number().int().min(1).max(16),
    ]),
    variancePercent: z.number().int().min(-15).max(15),
    finalPerformance: z.number().finite().nonnegative(),
  })
  .strict();

export const skillSpAwardSchema = z
  .object({
    actorId: stableIdSchema,
    skillId: stableIdSchema,
    baseAmount: z.number().finite().positive(),
    learningRateMultiplier: z.number().finite().positive(),
    amount: z.number().finite().positive(),
    potentialEffect: effectMagnitudeSchema,
    succeeded: z.boolean(),
  })
  .strict();

const stressChangeSchema = z
  .object({
    actorId: stableIdSchema,
    track: stressTrackSchema,
    before: z.number().int().min(0).max(5),
    after: z.number().int().min(0).max(5),
  })
  .strict();

const takenOutSchema = z
  .object({
    actorId: stableIdSchema,
    track: stressTrackSchema,
    statusId: stableIdSchema.nullable(),
    fatalOutcome: z.enum([
      "nonfatal",
      "npc-fatal",
      "pc-pending-consent",
      "pc-death-accepted",
    ]),
    fatalToPcPendingConsent: z.boolean(),
    deathAccepted: z.boolean(),
  })
  .strict();

export const resolveActionResultSchema = z
  .object({
    success: z.boolean(),
    finalPerformance: z.number().finite().nonnegative(),
    resistance: z.number().finite().nonnegative(),
    numericMargin: z.number().finite(),
    realizedEffect: realizedEffectSchema,
    performanceVariance: z
      .object({
        actor: performanceRollSchema.nullable(),
        opponent: performanceRollSchema.nullable(),
        effect: performanceRollSchema.nullable(),
      })
      .strict(),
    stressChanges: z.array(stressChangeSchema),
    statusesCreatedOrChanged: z.array(statusSchema),
    skillSpAwards: z.array(skillSpAwardSchema),
    takenOut: z.array(takenOutSchema),
    timeToMaterialEffectMs: z.number().int().nonnegative(),
  })
  .strict();
export type ResolveActionResult = z.infer<typeof resolveActionResultSchema>;

export const actionResolvedPayloadSchema = z
  .object({
    declaredActionId: stableIdSchema,
    actorId: stableIdSchema,
    path: classificationSchema,
    success: z.boolean(),
    finalPerformance: z.number().finite().nonnegative(),
    resistance: z.number().finite().nonnegative(),
    numericMargin: z.number().finite(),
    potentialEffect: effectMagnitudeSchema,
    realizedEffect: realizedEffectSchema,
    skillSpAwards: z.array(skillSpAwardSchema),
    takenOut: z.array(takenOutSchema),
  })
  .strict();

export const actionResolvedEventType: EventTypeDefinition<
  z.infer<typeof actionResolvedPayloadSchema>
> = {
  type: "rules.action-resolved",
  schemaVersion: 1,
  payloadSchema: actionResolvedPayloadSchema,
};

interface ActionAssessment {
  readonly actorState: RulesActorState;
  readonly actorPerformance: PerformanceCalculation;
  readonly opponentState?: RulesActorState;
  readonly stressTargetState?: RulesActorState;
  readonly opponentPerformance?: PerformanceCalculation;
  readonly effectPerformance?: PerformanceCalculation;
  readonly actionClassification: CheckClassification;
  readonly effectClassification: CheckClassification;
  readonly operationClassification: CheckClassification;
  readonly basis: ActionResolutionBasis;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function entity(
  world: DeepReadonly<OperationWorldView>,
  id: string,
) {
  const found = world.entities.find((candidate) => candidate.id === id);
  if (!found) throw new OperationValidationError(`Missing actor/entity ${id}`);
  return found;
}

function actorState(
  world: DeepReadonly<OperationWorldView>,
  id: string,
): RulesActorState {
  const mechanics = entity(world, id).data.mechanics;
  const parsed = rulesActorStateSchema.safeParse(mechanics);
  if (!parsed.success) {
    throw new OperationValidationError(
      `Entity ${id} does not have valid reference-rules mechanics`,
    );
  }
  return parsed.data;
}

function participantIds(plan: PerformancePlan): string[] {
  return [
    ...plan.helpers.map((helper) => helper.actorId),
    ...plan.combinedAttributeContributions.map((item) => item.actorId),
  ];
}

function combinedStates(
  world: DeepReadonly<OperationWorldView>,
  plan: PerformancePlan,
): Map<string, RulesActorState> {
  return new Map(
    plan.combinedAttributeContributions.map((contribution) => [
      contribution.actorId,
      actorState(world, contribution.actorId),
    ]),
  );
}

function validateParticipants(
  world: DeepReadonly<OperationWorldView>,
  actorId: string,
  plan: PerformancePlan,
): void {
  for (const participantId of participantIds(plan)) {
    if (participantId === actorId) {
      throw new OperationValidationError(
        `Actor ${actorId} cannot assist their own performance`,
      );
    }
    entity(world, participantId);
  }
}

function hasPriorAward(
  state: RulesActorState,
  declaredActionId: string,
): boolean {
  return state.progression.skillUseEvidence.some(
    (evidence) => evidence.declaredActionId === declaredActionId,
  );
}

function assessAction(
  world: DeepReadonly<OperationWorldView>,
  input: ResolveActionInput,
): ActionAssessment {
  validateParticipants(world, input.actorId, input.performance);
  const primaryActorState = actorState(world, input.actorId);
  if (hasPriorAward(primaryActorState, input.declaredActionId)) {
    throw new OperationValidationError(
      `Action ${input.declaredActionId} already produced skill-use evidence`,
    );
  }
  const actorPerformance = calculatePerformance(
    primaryActorState,
    input.performance,
    combinedStates(world, input.performance),
  );

  let opponentState: RulesActorState | undefined;
  let opponentPerformance: PerformanceCalculation | undefined;
  let resistanceBasis: z.infer<typeof resistanceBasisSchema>;
  let actionClassification: CheckClassification;

  if (input.resistance.kind === "fixed") {
    resistanceBasis = input.resistance;
    actionClassification = classifyFixedResistance(
      actorPerformance,
      input.resistance.value,
    );
  } else {
    validateParticipants(
      world,
      input.resistance.actorId,
      input.resistance.performance,
    );
    opponentState = actorState(world, input.resistance.actorId);
    opponentPerformance = calculatePerformance(
      opponentState,
      input.resistance.performance,
      combinedStates(world, input.resistance.performance),
    );
    resistanceBasis = {
      kind: "opposed",
      actorId: input.resistance.actorId,
      value: opponentPerformance.deterministicPerformance,
      performance: opponentPerformance,
    };
    actionClassification = classifyOpposedResistance(
      actorPerformance,
      opponentPerformance,
    );
  }

  if (input.feasibility.status === "impossible") {
    actionClassification = "impossible";
  }

  let effectPerformance: PerformanceCalculation | undefined;
  let effectClassification: CheckClassification = "automatic";
  let effectBasis: z.infer<typeof effectBasisSchema>;
  if (input.effect.mode === "checked") {
    validateParticipants(world, input.actorId, input.effect.performance);
    effectPerformance = calculatePerformance(
      primaryActorState,
      input.effect.performance,
      combinedStates(world, input.effect.performance),
    );
    effectClassification = classifyFixedResistance(
      effectPerformance,
      input.effect.baseResistance,
    );
    effectBasis = {
      ...input.effect,
      performance: effectPerformance,
      thresholds: checkedEffectThresholds(input.effect.baseResistance),
      classification: effectClassification,
    };
  } else {
    effectBasis = { ...input.effect, classification: "automatic" };
  }

  const operationClassification = actionClassification === "impossible"
    ? "impossible"
    : actionClassification === "uncertain" ||
        (input.effect.mode === "checked" && effectClassification === "uncertain")
      ? "uncertain"
      : "automatic";

  const participantStateIds = new Set([
    input.actorId,
    ...(input.resistance.kind === "opposed" ? [input.resistance.actorId] : []),
  ]);
  const stressTargetState =
    input.stressConsequence &&
      !participantStateIds.has(input.stressConsequence.targetId)
      ? actorState(world, input.stressConsequence.targetId)
      : undefined;

  return {
    actorState: primaryActorState,
    actorPerformance,
    ...(opponentState ? { opponentState } : {}),
    ...(stressTargetState ? { stressTargetState } : {}),
    ...(opponentPerformance ? { opponentPerformance } : {}),
    ...(effectPerformance ? { effectPerformance } : {}),
    actionClassification,
    effectClassification,
    operationClassification,
    basis: actionResolutionBasisSchema.parse({
      declaredActionId: input.declaredActionId,
      approach: input.approach,
      feasibility: input.feasibility,
      actorPerformance,
      resistance: resistanceBasis,
      actionClassification,
      effect: effectBasis,
    }),
  };
}

interface RollSet {
  actor: PerformanceRoll | null;
  opponent: PerformanceRoll | null;
  effect: PerformanceRoll | null;
}

function addAward(
  awards: z.infer<typeof skillSpAwardSchema>[],
  candidate: z.infer<typeof skillSpAwardSchema> | undefined,
): void {
  if (!candidate) return;
  const existing = awards.find(
    (award) =>
      award.actorId === candidate.actorId &&
      award.skillId === candidate.skillId,
  );
  if (!existing) {
    awards.push(candidate);
    return;
  }
  if (candidate.amount > existing.amount) {
    existing.amount = candidate.amount;
    existing.potentialEffect = candidate.potentialEffect;
    existing.succeeded = candidate.succeeded;
  }
}

function awardFor(
  actorId: string,
  actor: RulesActorState,
  performance: PerformanceCalculation,
  potentialEffect: EffectMagnitude,
  succeeded: boolean,
) {
  if (!performance.selectedSkillId) return undefined;
  const baseAmount = skillSpAward(potentialEffect, succeeded);
  return skillSpAwardSchema.parse({
        actorId,
        skillId: performance.selectedSkillId,
        baseAmount,
        learningRateMultiplier:
          actor.progression.skillLearningRateMultiplier,
        amount:
          baseAmount * actor.progression.skillLearningRateMultiplier,
        potentialEffect,
        succeeded,
      });
}

function updatedStateWithAwards(
  original: RulesActorState,
  input: ResolveActionInput,
  awards: readonly z.infer<typeof skillSpAwardSchema>[],
): RulesActorState {
  const updated = clone(original);
  for (const award of awards) {
    const skill = updated.skills.find((candidate) => candidate.id === award.skillId);
    if (!skill) {
      throw new OperationValidationError(
        `Cannot award missing skill ${award.skillId}`,
      );
    }
    skill.sp += award.amount;
    updated.progression.skillUseEvidence.push({
      declaredActionId: input.declaredActionId,
      skillId: award.skillId,
      baseAmount: award.baseAmount,
      learningRateMultiplier: award.learningRateMultiplier,
      amount: award.amount,
      potentialEffect: award.potentialEffect,
      succeeded: award.succeeded,
    });
  }
  return rulesActorStateSchema.parse(updated);
}

function resolveResult(
  assessment: ActionAssessment,
  input: ResolveActionInput,
  random?: { next(): number },
) {
  const rolls: RollSet = { actor: null, opponent: null, effect: null };
  let finalPerformance = assessment.actorPerformance.deterministicPerformance;
  let resistance = input.resistance.kind === "fixed"
    ? input.resistance.value
    : assessment.opponentPerformance!.deterministicPerformance;

  if (assessment.actionClassification === "uncertain") {
    if (!random) throw new Error("Uncertain action requires randomness");
    rolls.actor = rollPerformanceVariance(finalPerformance, random);
    finalPerformance = rolls.actor.finalPerformance;
    if (assessment.opponentPerformance) {
      rolls.opponent = rollPerformanceVariance(resistance, random);
      resistance = rolls.opponent.finalPerformance;
    }
  }

  const success = assessment.actionClassification === "automatic" ||
    (assessment.actionClassification === "uncertain" &&
      finalPerformance > resistance);
  const numericMargin = finalPerformance - resistance;
  let realizedEffect: z.infer<typeof realizedEffectSchema> = 0;
  let effectSucceeded = false;
  if (success) {
    if (input.effect.mode === "fixed") {
      realizedEffect = input.effect.potentialEffect;
      effectSucceeded = true;
    } else if (input.effect.mode === "derived") {
      realizedEffect = input.effect.derivedEffect;
      effectSucceeded = true;
    } else {
      let effectPerformance = assessment.effectPerformance!.deterministicPerformance;
      if (assessment.effectClassification === "uncertain") {
        if (!random) throw new Error("Uncertain Effect requires randomness");
        rolls.effect = rollPerformanceVariance(effectPerformance, random);
        effectPerformance = rolls.effect.finalPerformance;
      }
      realizedEffect = checkedRealizedEffect(
        effectPerformance,
        input.effect.baseResistance,
        input.effect.potentialEffect,
      );
      effectSucceeded = effectPerformance > input.effect.baseResistance;
    }
  }

  const awards: z.infer<typeof skillSpAwardSchema>[] = [];
  if (assessment.actionClassification === "uncertain") {
    addAward(
      awards,
      awardFor(
        input.actorId,
        assessment.actorState,
        assessment.actorPerformance,
        input.effect.potentialEffect,
        success,
      ),
    );
    if (input.resistance.kind === "opposed") {
      addAward(
        awards,
        awardFor(
          input.resistance.actorId,
          assessment.opponentState!,
          assessment.opponentPerformance!,
          input.effect.potentialEffect,
          !success,
        ),
      );
    }
  }
  if (
    success &&
    input.effect.mode === "checked" &&
    assessment.effectClassification === "uncertain"
  ) {
    addAward(
      awards,
      awardFor(
        input.actorId,
        assessment.actorState,
        assessment.effectPerformance!,
        input.effect.potentialEffect,
        effectSucceeded,
      ),
    );
  }

  const states = new Map<string, RulesActorState>();
  states.set(
    input.actorId,
    updatedStateWithAwards(
      assessment.actorState,
      input,
      awards.filter((award) => award.actorId === input.actorId),
    ),
  );
  if (input.resistance.kind === "opposed" && assessment.opponentState) {
    const opponentId = input.resistance.actorId;
    states.set(
      opponentId,
      updatedStateWithAwards(
        assessment.opponentState,
        input,
        awards.filter((award) => award.actorId === opponentId),
      ),
    );
  }

  const stressChanges: z.infer<typeof stressChangeSchema>[] = [];
  const statusesCreatedOrChanged: z.infer<typeof statusSchema>[] = [];
  const takenOut: z.infer<typeof takenOutSchema>[] = [];
  if (input.stressConsequence && realizedEffect > 0) {
    const consequence = input.stressConsequence;
    const prior = states.get(consequence.targetId) ??
      actorStateFromAssessmentOrThrow(assessment, input, consequence.targetId);
    const target = clone(prior);
    const before = target.stress[consequence.track];
    const after = Math.min(5, before + realizedEffect);
    target.stress[consequence.track] = after;
    stressChanges.push({
      actorId: consequence.targetId,
      track: consequence.track,
      before,
      after,
    });
    if (before < 5 && after === 5) {
      if (consequence.statusOnTakenOut) {
        const index = target.statuses.findIndex(
          (status) => status.id === consequence.statusOnTakenOut!.id,
        );
        if (index === -1) target.statuses.push(consequence.statusOnTakenOut);
        else target.statuses[index] = consequence.statusOnTakenOut;
        statusesCreatedOrChanged.push(consequence.statusOnTakenOut);
      }
      const pendingConsent =
        target.isPlayerCharacter &&
        consequence.normallyFatal &&
        !consequence.pcDeathConsent;
      const fatalOutcome = !consequence.normallyFatal
        ? "nonfatal"
        : target.isPlayerCharacter
          ? consequence.pcDeathConsent
            ? "pc-death-accepted"
            : "pc-pending-consent"
          : "npc-fatal";
      takenOut.push({
        actorId: consequence.targetId,
        track: consequence.track,
        statusId: consequence.statusOnTakenOut?.id ?? null,
        fatalOutcome,
        fatalToPcPendingConsent: pendingConsent,
        deathAccepted:
          target.isPlayerCharacter &&
          consequence.normallyFatal &&
          consequence.pcDeathConsent,
      });
    }
    states.set(consequence.targetId, rulesActorStateSchema.parse(target));
  }

  const result = resolveActionResultSchema.parse({
    success,
    finalPerformance,
    resistance,
    numericMargin,
    realizedEffect,
    performanceVariance: rolls,
    stressChanges,
    statusesCreatedOrChanged,
    skillSpAwards: awards,
    takenOut,
    timeToMaterialEffectMs: input.timeToMaterialEffectMs,
  });

  return { result, states };
}

function actorStateFromAssessmentOrThrow(
  assessment: ActionAssessment,
  input: ResolveActionInput,
  actorId: string,
): RulesActorState {
  if (actorId === input.actorId) return assessment.actorState;
  if (
    input.resistance.kind === "opposed" &&
    actorId === input.resistance.actorId &&
    assessment.opponentState
  ) {
    return assessment.opponentState;
  }
  if (
    input.stressConsequence?.targetId === actorId &&
    assessment.stressTargetState
  ) {
    return assessment.stressTargetState;
  }
  throw new OperationValidationError(
    `Stress target ${actorId} must be the acting or opposing participant`,
  );
}

function outcome(
  assessment: ActionAssessment,
  input: ResolveActionInput,
  path: CheckClassification,
  random?: { next(): number },
) {
  const resolved = resolveResult(assessment, input, random);
  const relatedEntityIds = [...new Set([
    input.actorId,
    ...(input.resistance.kind === "opposed" ? [input.resistance.actorId] : []),
    ...(input.stressConsequence ? [input.stressConsequence.targetId] : []),
    ...participantIds(input.performance),
    ...(input.resistance.kind === "opposed"
      ? participantIds(input.resistance.performance)
      : []),
    ...(input.effect.mode === "checked"
      ? participantIds(input.effect.performance)
      : []),
  ])];
  return {
    result: resolved.result,
    advanceTimeByMs: fictionalDurationMs(input.timeToMaterialEffectMs),
    proposedMutations: [...resolved.states.entries()].map(
      ([entityId, mechanics]) => ({
        kind: "set-entity-data" as const,
        entityId,
        key: "mechanics",
        value: jsonValueSchema.parse(mechanics),
      }),
    ),
    proposedEvents: [
      {
        type: "rules.action-resolved",
        schemaVersion: 1,
        summary: `${entityIdLabel(input.actorId)} ${
          resolved.result.success ? "succeeded" : "did not succeed"
        } at ${input.approach}.`,
        relatedEntityIds,
        scopeIds: input.scopeIds,
        causedByEventIds: [],
        origin: {
          kind: "rules-operation" as const,
          id: "rules.actions.resolve-action",
        },
        payload: actionResolvedPayloadSchema.parse({
          declaredActionId: input.declaredActionId,
          actorId: input.actorId,
          path,
          success: resolved.result.success,
          finalPerformance: resolved.result.finalPerformance,
          resistance: resolved.result.resistance,
          numericMargin: resolved.result.numericMargin,
          potentialEffect: input.effect.potentialEffect,
          realizedEffect: resolved.result.realizedEffect,
          skillSpAwards: resolved.result.skillSpAwards,
          takenOut: resolved.result.takenOut,
        }),
        access: "public" as const,
      },
    ],
  };
}

function entityIdLabel(id: string): string {
  return id.split(".").at(-1) ?? id;
}

export const resolveActionOperation: ResolutionOperation<
  ResolveActionInput,
  ResolveActionInput,
  ResolveActionResult
> = {
  metadata: {
    id: "rules.actions.resolve-action",
    kind: "resolution",
    description:
      "Resolve one physical, mental, social, environmental, competitive, or timing uncertainty through the unified Performance-versus-Resistance rules.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "actions", label: "Actions" },
      tags: ["performance", "resistance", "effect", "stress"],
    },
  },
  inputSchema: resolveActionInputSchema,
  preparedSchema: resolveActionInputSchema,
  outputSchema: resolveActionResultSchema,
  assess(context, intent, input) {
    if (input.actorId !== intent.actorId) {
      throw new OperationValidationError(
        `Action actor ${input.actorId} does not match executable intent actor ${intent.actorId}`,
      );
    }
    const assessment = assessAction(context.world, input);
    if (assessment.operationClassification === "uncertain") {
      return {
        path: "uncertain",
        basis: assessment.basis,
        prepared: input,
      };
    }
    return {
      path: assessment.operationClassification,
      basis: assessment.basis,
      outcome: outcome(
        assessment,
        input,
        assessment.operationClassification,
      ),
    };
  },
  resolve(context, input) {
    const assessment = assessAction(context.world, input);
    if (assessment.operationClassification !== "uncertain") {
      throw new OperationValidationError(
        "Prepared action is no longer uncertain",
      );
    }
    return outcome(assessment, input, "uncertain", context.rng);
  },
};
