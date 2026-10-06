import {
  fictionalDurationMs,
  jsonValueSchema,
  OperationValidationError,
  stableIdSchema,
  type DeepReadonly,
  type EventTypeDefinition,
  type OperationWorldView,
  type RulesOperation,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import { minimumSpForSkillLevel, skillLevelFromSp, skillRank } from "./mechanics.js";
import {
  rulesActorStateSchema,
  skillSchema,
  skillSpecificitySchema,
  stressTrackSchema,
  type RulesActorState,
} from "./model.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function actorState(
  world: DeepReadonly<OperationWorldView>,
  actorId: string,
): RulesActorState {
  const entity = world.entities.find((candidate) => candidate.id === actorId);
  if (!entity) throw new OperationValidationError(`Missing actor ${actorId}`);
  const parsed = rulesActorStateSchema.safeParse(entity.data.mechanics);
  if (!parsed.success) {
    throw new OperationValidationError(
      `Entity ${actorId} does not have valid reference-rules mechanics`,
    );
  }
  return parsed.data;
}

export const emergentSkillProposalSchema = z
  .object({
    id: stableIdSchema,
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    specificity: skillSpecificitySchema,
    reason: z.enum(["learning", "discovery"]),
  })
  .strict();

const semanticSkillReviewSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("accepted"),
      comparedAgainstExistingSkills: z.boolean(),
      specificityJustification: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      decision: z.literal("duplicate"),
      existingSkillId: stableIdSchema,
      rationale: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      decision: z.literal("over-narrow"),
      rationale: z.string().trim().min(1),
    })
    .strict(),
]);

export const createEmergentSkillInputSchema = z
  .object({
    actorId: stableIdSchema,
    proposal: emergentSkillProposalSchema,
    semanticReview: semanticSkillReviewSchema,
    authorized: z.literal(true),
    scopeIds: z.array(stableIdSchema),
  })
  .strict();

export const createdSkillResultSchema = z
  .object({
    skill: skillSchema.extend({
      level: z.number().int().nonnegative(),
      rank: z.enum([
        "Untrained",
        "Novice",
        "Apprentice",
        "Journeyman",
        "Expert",
        "Master",
      ]),
      visible: z.boolean(),
    }),
    reason: z.enum(["learning", "discovery"]),
  })
  .strict();

export const skillCreatedPayloadSchema = z
  .object({
    actorId: stableIdSchema,
    skillId: stableIdSchema,
    reason: z.enum(["learning", "discovery"]),
    specificity: skillSpecificitySchema,
    startingSp: z.number().finite().nonnegative(),
  })
  .strict();

export const skillCreatedEventType: EventTypeDefinition<
  z.infer<typeof skillCreatedPayloadSchema>
> = {
  type: "rules.skill-created",
  schemaVersion: 1,
  payloadSchema: skillCreatedPayloadSchema,
};

export const createEmergentSkillOperation: RulesOperation<
  z.infer<typeof createEmergentSkillInputSchema>,
  z.infer<typeof createdSkillResultSchema>
> = {
  metadata: {
    id: "rules.skills.create-emergent-skill",
    kind: "ordinary",
    description:
      "Create an authorized learned or discovered competency after external semantic duplicate and specificity review.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "skills", label: "Skills" },
      tags: ["learning", "discovery", "progression-evidence"],
    },
  },
  inputSchema: createEmergentSkillInputSchema,
  outputSchema: createdSkillResultSchema,
  execute(context, input) {
    const current = actorState(context.world, input.actorId);
    if (input.semanticReview.decision === "duplicate") {
      throw new OperationValidationError(
        `Proposed skill duplicates ${input.semanticReview.existingSkillId}`,
      );
    }
    if (input.semanticReview.decision === "over-narrow") {
      throw new OperationValidationError(
        "Proposed skill is an artificial hyper-specialization",
      );
    }
    if (!input.semanticReview.comparedAgainstExistingSkills) {
      throw new OperationValidationError(
        "Emergent skill creation requires comparison against existing skills",
      );
    }
    const normalizedName = input.proposal.name.toLocaleLowerCase();
    if (
      current.skills.some(
        (skill) =>
          skill.id === input.proposal.id ||
          skill.name.trim().toLocaleLowerCase() === normalizedName,
      )
    ) {
      throw new OperationValidationError(
        `Skill ${input.proposal.name} already exists`,
      );
    }
    const startingSp = input.proposal.reason === "discovery"
      ? minimumSpForSkillLevel(1)
      : 0;
    const skill = skillSchema.parse({
      id: input.proposal.id,
      name: input.proposal.name,
      description: input.proposal.description,
      specificity: input.proposal.specificity,
      sp: startingSp,
    });
    const updated = rulesActorStateSchema.parse({
      ...clone(current),
      skills: [...current.skills, skill],
    });
    const level = skillLevelFromSp(skill.sp);
    const result = createdSkillResultSchema.parse({
      skill: {
        ...skill,
        level,
        rank: skillRank(level),
        visible: level >= 1,
      },
      reason: input.proposal.reason,
    });
    return {
      result,
      advanceTimeByMs: fictionalDurationMs(0),
      proposedMutations: [
        {
          kind: "set-entity-data",
          entityId: input.actorId,
          key: "mechanics",
          value: jsonValueSchema.parse(updated),
        },
      ],
      proposedEvents: [
        {
          type: "rules.skill-created",
          schemaVersion: 1,
          summary: `${input.proposal.name} became a modeled competency.`,
          relatedEntityIds: [input.actorId],
          scopeIds: input.scopeIds,
          causedByEventIds: [],
          origin: {
            kind: "rules-operation",
            id: "rules.skills.create-emergent-skill",
          },
          payload: {
            actorId: input.actorId,
            skillId: skill.id,
            reason: input.proposal.reason,
            specificity: skill.specificity,
            startingSp,
          },
          access: "public",
        },
      ],
    };
  },
};

const injuryRecoveryBasisSchema = z
  .object({
    kind: z.enum(["treatment", "healing"]),
    description: z.string().trim().min(1),
    justifiedAmount: z.number().int().min(1).max(5),
  })
  .strict();

const ordinaryRecoveryBasisSchema = z
  .object({
    kind: z.enum([
      "safety",
      "distance",
      "reassurance",
      "regained-control",
      "regulation",
      "resolution",
      "restored-social-footing",
      "success",
      "rest",
    ]),
    description: z.string().trim().min(1),
    durationMs: z.number().int().nonnegative(),
    restfulOvernight: z.boolean(),
  })
  .strict();

export const recoverStressInputSchema = z
  .object({
    actorId: stableIdSchema,
    track: stressTrackSchema,
    basis: z.union([injuryRecoveryBasisSchema, ordinaryRecoveryBasisSchema]),
    scopeIds: z.array(stableIdSchema),
  })
  .strict();

export const recoverStressResultSchema = z
  .object({
    actorId: stableIdSchema,
    track: stressTrackSchema,
    before: z.number().int().min(0).max(5),
    recovered: z.number().int().min(0).max(5),
    after: z.number().int().min(0).max(5),
    statusesRemain: z.array(stableIdSchema),
  })
  .strict();

export const stressRecoveredPayloadSchema = recoverStressResultSchema;

export const stressRecoveredEventType: EventTypeDefinition<
  z.infer<typeof stressRecoveredPayloadSchema>
> = {
  type: "rules.stress-recovered",
  schemaVersion: 1,
  payloadSchema: stressRecoveredPayloadSchema,
};

export const concessionInputSchema = z
  .object({
    actorId: stableIdSchema,
    contest: z.string().trim().min(1),
    outcome: z.string().trim().min(1),
    durationMs: z.number().int().nonnegative(),
    scopeIds: z.array(stableIdSchema),
  })
  .strict();

export const concessionResultSchema = z
  .object({
    actorId: stableIdSchema,
    conceded: z.literal(true),
    outcome: z.string().trim().min(1),
  })
  .strict();

export const concessionRecordedEventType: EventTypeDefinition<
  z.infer<typeof concessionResultSchema>
> = {
  type: "rules.concession-recorded",
  schemaVersion: 1,
  payloadSchema: concessionResultSchema,
};

export const concedeOperation: RulesOperation<
  z.infer<typeof concessionInputSchema>,
  z.infer<typeof concessionResultSchema>
> = {
  metadata: {
    id: "rules.actions.concede",
    kind: "ordinary",
    description:
      "Record a voluntary surrender, withdrawal, retreat, or other contextual concession before Taken Out.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "actions", label: "Actions" },
      tags: ["concession", "contest", "control"],
    },
  },
  inputSchema: concessionInputSchema,
  outputSchema: concessionResultSchema,
  execute(context, input) {
    actorState(context.world, input.actorId);
    const result = concessionResultSchema.parse({
      actorId: input.actorId,
      conceded: true,
      outcome: input.outcome,
    });
    return {
      result,
      advanceTimeByMs: fictionalDurationMs(input.durationMs),
      proposedMutations: [],
      proposedEvents: [
        {
          type: "rules.concession-recorded",
          schemaVersion: 1,
          summary: `${input.actorId} conceded ${input.contest}: ${input.outcome}`,
          relatedEntityIds: [input.actorId],
          scopeIds: input.scopeIds,
          causedByEventIds: [],
          origin: {
            kind: "rules-operation",
            id: "rules.actions.concede",
          },
          payload: result,
          access: "public",
        },
      ],
    };
  },
};

function ordinaryRecoveryAllowed(
  track: z.infer<typeof stressTrackSchema>,
  kind: z.infer<typeof ordinaryRecoveryBasisSchema>["kind"],
): boolean {
  if (track === "exhaustion") return kind === "rest";
  if (track === "fear") {
    return ["safety", "distance", "reassurance", "regained-control", "rest"]
      .includes(kind);
  }
  if (track === "anger") {
    return ["distance", "regulation", "resolution", "rest"].includes(kind);
  }
  if (track === "insecurity") {
    return [
      "distance",
      "reassurance",
      "restored-social-footing",
      "success",
      "rest",
    ].includes(kind);
  }
  return false;
}

function recoveredAmount(
  current: number,
  input: z.infer<typeof recoverStressInputSchema>,
): number {
  if (current === 0) return 0;
  if (input.track === "injury") {
    if (input.basis.kind !== "treatment" && input.basis.kind !== "healing") {
      throw new OperationValidationError(
        "Injury stress requires treatment or healing",
      );
    }
    return Math.min(current, input.basis.justifiedAmount);
  }
  if (input.basis.kind === "treatment" || input.basis.kind === "healing") {
    throw new OperationValidationError(
      `${input.basis.kind} is not a valid ${input.track} recovery basis`,
    );
  }
  const basis = input.basis;
  if (!("durationMs" in basis)) {
    throw new OperationValidationError("Ordinary recovery requires duration");
  }
  if (!ordinaryRecoveryAllowed(input.track, basis.kind)) {
    throw new OperationValidationError(
      `${basis.kind} does not address ${input.track} stress`,
    );
  }
  if (basis.restfulOvernight) return current;
  const tenMinutes = 10 * 60 * 1_000;
  const additionalHour = 60 * 60 * 1_000;
  if (basis.durationMs < tenMinutes) return 0;
  return Math.min(
    current,
    1 + Math.floor((basis.durationMs - tenMinutes) / additionalHour),
  );
}

export const recoverStressOperation: RulesOperation<
  z.infer<typeof recoverStressInputSchema>,
  z.infer<typeof recoverStressResultSchema>
> = {
  metadata: {
    id: "rules.recovery.recover-stress",
    kind: "ordinary",
    description:
      "Recover stress only when a structured fictional basis and sufficient recovery time address its cause.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "recovery", label: "Recovery" },
      tags: ["stress", "healing", "rest"],
    },
    applicability: { actionModes: ["recovery"] },
  },
  inputSchema: recoverStressInputSchema,
  outputSchema: recoverStressResultSchema,
  execute(context, input) {
    const current = actorState(context.world, input.actorId);
    const before = current.stress[input.track];
    const recovered = recoveredAmount(before, input);
    const updated = rulesActorStateSchema.parse({
      ...clone(current),
      stress: {
        ...current.stress,
        [input.track]: before - recovered,
      },
    });
    const result = recoverStressResultSchema.parse({
      actorId: input.actorId,
      track: input.track,
      before,
      recovered,
      after: before - recovered,
      statusesRemain: updated.statuses.map((status) => status.id),
    });
    return {
      result,
      advanceTimeByMs: fictionalDurationMs(
        "durationMs" in input.basis ? input.basis.durationMs : 0,
      ),
      proposedMutations: recovered > 0
        ? [
            {
              kind: "set-entity-data" as const,
              entityId: input.actorId,
              key: "mechanics",
              value: jsonValueSchema.parse(updated),
            },
          ]
        : [],
      proposedEvents: recovered > 0
        ? [
            {
              type: "rules.stress-recovered",
              schemaVersion: 1,
              summary: `${input.actorId} recovered ${recovered} ${input.track} stress.`,
              relatedEntityIds: [input.actorId],
              scopeIds: input.scopeIds,
              causedByEventIds: [],
              origin: {
                kind: "rules-operation" as const,
                id: "rules.recovery.recover-stress",
              },
              payload: result,
              access: "public" as const,
            },
          ]
        : [],
    };
  },
};
