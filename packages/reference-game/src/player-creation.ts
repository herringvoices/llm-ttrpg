import {
  generationIssueSchema,
  mechanicalConstraintSchema,
  stableIdSchema,
  presentationSceneSnapshotSchema,
  type GenerationIssue,
  type MechanicalConstraint,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import {
  ATTRIBUTE_IDS,
  attributeIdSchema,
  emptyStressState,
  powerStateSchema,
  rulesActorStateSchema,
  type RulesActorState,
} from "./ruleset/model.js";

export const STARTING_ATTRIBUTE_TOTAL_RANGE = Object.freeze({
  minimum: 972,
  maximum: 1118,
});

export const STARTING_SKILL_POINT_RANGE = Object.freeze({
  minimum: 50,
  maximum: 600,
});

export const playerCreationInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1),
  powerGuidance: z.string().trim().min(1).optional(),
}).strict();
export type PlayerCreationInput = z.infer<typeof playerCreationInputSchema>;

export const playerEstablishedFactSchema = z.object({
  id: stableIdSchema,
  category: z.enum([
    "identity",
    "appearance",
    "location",
    "living-situation",
    "work-school",
    "routine",
    "community",
    "relationship",
    "biography",
    "goal",
    "resource",
    "other",
  ]),
  statement: z.string().trim().min(1),
  sourceText: z.string().trim().min(1).describe(
    "An exact quotation from the player's description, not a JSON field name.",
  ),
}).strict();

export const powerPreferenceSchema = z.object({
  positive: z.array(z.object({
    description: z.string().trim().min(1),
    strength: z.enum(["like", "prefer", "strongly-prefer"]),
  }).strict()),
  negative: z.array(z.string().trim().min(1)),
  surpriseMe: z.boolean(),
}).strict();

export const normalizedPlayerSetupSchema = z.object({
  establishedFacts: z.array(playerEstablishedFactSchema),
  unspecifiedAreas: z.array(z.string().trim().min(1)),
  currentWants: z.array(z.string().trim().min(1)),
  powerPreferences: powerPreferenceSchema,
  followUpQuestions: z.array(z.object({
    id: stableIdSchema,
    question: z.string().trim().min(1),
    materialImpact: z.string().trim().min(1),
  }).strict()),
}).strict();
export type NormalizedPlayerSetup = z.infer<
  typeof normalizedPlayerSetupSchema
>;

function normalizeQuotedText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function sourceContainsQuotedText(source: string, quotation: string): boolean {
  return normalizeQuotedText(source).includes(normalizeQuotedText(quotation));
}

export function validateNormalizedPlayerSetup(
  input: PlayerCreationInput,
  proposal: unknown,
): NormalizedPlayerSetup {
  const parsedInput = playerCreationInputSchema.parse(input);
  const normalized = normalizedPlayerSetupSchema.parse(proposal);
  for (const fact of normalized.establishedFacts) {
    if (!sourceContainsQuotedText(parsedInput.description, fact.sourceText)) {
      throw new Error(
        `Player-established fact ${fact.id} cites text not present in the player's description`,
      );
    }
  }
  if (
    normalized.followUpQuestions.some(
      (question) => question.materialImpact.trim().length === 0,
    )
  ) {
    throw new Error("Every setup follow-up must identify a material game impact");
  }
  return normalized;
}

export const attributeEvidenceSchema = z.object({
  attributeId: attributeIdSchema,
  direction: z.enum(["below-baseline", "near-baseline", "above-baseline"]),
  rationale: z.string().trim().min(1),
  sourceFactIds: z.array(stableIdSchema),
}).strict();

export const startingHumanProposalSchema = z.object({
  mechanics: rulesActorStateSchema,
  attributeEvidence: z.array(attributeEvidenceSchema),
  skillEvidence: z.array(z.object({
    skillId: stableIdSchema,
    rationale: z.string().trim().min(1),
    sourceFactIds: z.array(stableIdSchema),
  }).strict()),
}).strict();
export type StartingHumanProposal = z.infer<typeof startingHumanProposalSchema>;

function startingHumanIssues(
  proposal: StartingHumanProposal,
  allowedSourceFactIds?: ReadonlySet<string>,
): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  const totalAttributes = Object.values(proposal.mechanics.attributes)
    .reduce((sum, value) => sum + value, 0);
  if (
    totalAttributes < STARTING_ATTRIBUTE_TOTAL_RANGE.minimum ||
    totalAttributes > STARTING_ATTRIBUTE_TOTAL_RANGE.maximum
  ) {
    issues.push(generationIssueSchema.parse({
      code: "player.attributes.total-out-of-range",
      severity: "error",
      message:
        `Starting Attribute total ${totalAttributes} is outside ${STARTING_ATTRIBUTE_TOTAL_RANGE.minimum}-${STARTING_ATTRIBUTE_TOTAL_RANGE.maximum}.`,
      path: ["mechanics", "attributes"],
      repairHint:
        "Reconcile ordinary-human attributes to the allowed total while preserving strongly evidenced traits.",
    }));
  }
  const evidenceIds = new Set(
    proposal.attributeEvidence.map((evidence) => evidence.attributeId),
  );
  for (const attributeId of ATTRIBUTE_IDS) {
    if (!evidenceIds.has(attributeId)) {
      issues.push(generationIssueSchema.parse({
        code: "player.attributes.missing-evidence",
        severity: "error",
        message: `Missing baseline/evidence judgment for ${attributeId}.`,
        path: ["attributeEvidence"],
      }));
    }
  }
  if (evidenceIds.size !== proposal.attributeEvidence.length) {
    issues.push(generationIssueSchema.parse({
      code: "player.attributes.duplicate-evidence",
      severity: "error",
      message: "Attribute evidence must contain exactly one judgment per Attribute.",
      path: ["attributeEvidence"],
    }));
  }
  for (const evidence of proposal.attributeEvidence) {
    if (
      evidence.direction !== "near-baseline" &&
      evidence.sourceFactIds.length === 0
    ) {
      issues.push(generationIssueSchema.parse({
        code: "player.attributes.direction-without-evidence",
        severity: "error",
        message: `${evidence.attributeId} departs from baseline without an established supporting fact.`,
        path: ["attributeEvidence"],
      }));
    }
    for (const sourceFactId of evidence.sourceFactIds) {
      if (allowedSourceFactIds && !allowedSourceFactIds.has(sourceFactId)) {
        issues.push(generationIssueSchema.parse({
          code: "player.attributes.unknown-evidence-source",
          severity: "error",
          message: `Attribute evidence references unknown player fact ${sourceFactId}.`,
          path: ["attributeEvidence"],
        }));
      }
    }
  }

  const totalSkillPoints = proposal.mechanics.skills.reduce(
    (sum, skill) => sum + skill.sp,
    0,
  );
  if (
    totalSkillPoints < STARTING_SKILL_POINT_RANGE.minimum ||
    totalSkillPoints > STARTING_SKILL_POINT_RANGE.maximum
  ) {
    issues.push(generationIssueSchema.parse({
      code: "player.skills.total-out-of-range",
      severity: "error",
      message:
        `Starting Skill Point total ${totalSkillPoints} is outside ${STARTING_SKILL_POINT_RANGE.minimum}-${STARTING_SKILL_POINT_RANGE.maximum}.`,
      path: ["mechanics", "skills"],
      repairHint:
        "Derive learned skills from plausible sustained experience rather than filling a budget.",
    }));
  }
  const skillIds = new Set(proposal.mechanics.skills.map((skill) => skill.id));
  const skillEvidenceIds = new Set<string>();
  for (const evidence of proposal.skillEvidence) {
    if (!skillIds.has(evidence.skillId)) {
      issues.push(generationIssueSchema.parse({
        code: "player.skills.evidence-without-skill",
        severity: "error",
        message: `Skill evidence references missing skill ${evidence.skillId}.`,
        path: ["skillEvidence"],
      }));
    }
    if (skillEvidenceIds.has(evidence.skillId)) {
      issues.push(generationIssueSchema.parse({
        code: "player.skills.duplicate-evidence",
        severity: "error",
        message: `Skill ${evidence.skillId} has duplicate evidence records.`,
        path: ["skillEvidence"],
      }));
    }
    skillEvidenceIds.add(evidence.skillId);
    if (evidence.sourceFactIds.length === 0) {
      issues.push(generationIssueSchema.parse({
        code: "player.skills.missing-evidence-source",
        severity: "error",
        message: `Skill ${evidence.skillId} requires an established supporting fact.`,
        path: ["skillEvidence"],
      }));
    }
    for (const sourceFactId of evidence.sourceFactIds) {
      if (allowedSourceFactIds && !allowedSourceFactIds.has(sourceFactId)) {
        issues.push(generationIssueSchema.parse({
          code: "player.skills.unknown-evidence-source",
          severity: "error",
          message: `Skill evidence references unknown player fact ${sourceFactId}.`,
          path: ["skillEvidence"],
        }));
      }
    }
  }
  for (const skillId of skillIds) {
    if (!skillEvidenceIds.has(skillId)) {
      issues.push(generationIssueSchema.parse({
        code: "player.skills.missing-evidence",
        severity: "error",
        message: `Starting skill ${skillId} has no evidence record.`,
        path: ["skillEvidence"],
      }));
    }
  }

  if (
    proposal.mechanics.progression.characterLevel !== 0 ||
    (proposal.mechanics.progression.characterXp ?? 0) !== 0
  ) {
    issues.push(generationIssueSchema.parse({
      code: "player.progression.must-start-mundane",
      severity: "error",
      message: "The player must begin as a mundane Level 0 human with 0 Character XP.",
      path: ["mechanics", "progression"],
    }));
  }
  if ((proposal.mechanics.progression.powers ?? []).length > 0) {
    issues.push(generationIssueSchema.parse({
      code: "player.progression.power-before-awakening",
      severity: "error",
      message: "The starting mundane player cannot already have a manifested power.",
      path: ["mechanics", "progression", "powers"],
    }));
  }
  if (!proposal.mechanics.isPlayerCharacter) {
    issues.push(generationIssueSchema.parse({
      code: "player.mechanics.not-player",
      severity: "error",
      message: "Starting player mechanics must be marked as the player character.",
      path: ["mechanics", "isPlayerCharacter"],
    }));
  }
  return issues;
}

export function validateStartingHumanProposal(
  proposal: unknown,
  allowedSourceFactIds?: ReadonlySet<string>,
): StartingHumanProposal {
  const parsed = startingHumanProposalSchema.parse(proposal);
  const errors = startingHumanIssues(parsed, allowedSourceFactIds).filter(
    (issue) => issue.severity === "error",
  );
  if (errors.length > 0) {
    throw new Error(errors.map((issue) => issue.message).join(" "));
  }
  return parsed;
}

export function startingHumanGenerationIssues(
  proposal: unknown,
  allowedSourceFactIds?: ReadonlySet<string>,
): readonly GenerationIssue[] {
  const parsed = startingHumanProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => generationIssueSchema.parse({
      code: "player.mechanics.schema-invalid",
      severity: "error",
      message: issue.message,
      path: issue.path,
    }));
  }
  return startingHumanIssues(parsed.data, allowedSourceFactIds);
}

export function createDefaultMundaneProgression(): RulesActorState["progression"] {
  return {
    characterLevel: 0,
    characterXp: 0,
    skillPointsPerCharacterLevel: 5,
    skillLearningRateMultiplier: 1,
    skillUseEvidence: [],
    powers: [],
  };
}

export function createEmptyMundanePlayerMechanics(
  attributes: RulesActorState["attributes"],
  skills: RulesActorState["skills"],
): RulesActorState {
  return rulesActorStateSchema.parse({
    attributes,
    skills,
    stress: emptyStressState(),
    statuses: [],
    progression: createDefaultMundaneProgression(),
    isPlayerCharacter: true,
  });
}

export const firstPowerProposalSchema = z.object({
  power: powerStateSchema,
  preferenceRationale: z.string().trim().min(1),
  negativeConstraintsRespected: z.boolean(),
}).strict();

export function validateFirstPowerProposal(
  proposal: unknown,
): z.infer<typeof firstPowerProposalSchema> {
  const parsed = firstPowerProposalSchema.parse(proposal);
  if (
    parsed.power.characterLevelAtManifestation !== 1 ||
    parsed.power.manifestationStrength !== 1 ||
    parsed.power.pp !== 5 ||
    parsed.power.powerLevel !== 1
  ) {
    throw new Error(
      "A first power must manifest at Character Level 1 with Strength 1 and the initial 5 PP budget.",
    );
  }
  if (!parsed.negativeConstraintsRespected) {
    throw new Error("A generated first power violated a hard negative preference");
  }
  if (parsed.power.tags.length === 0) {
    throw new Error("A generated first power must include semantic power tags");
  }
  if (parsed.power.tags.includes("role.stat-enhancement")) {
    throw new Error(
      "A raw stat-enhancement power cannot be the Awakening Earth player's first power",
    );
  }
  return parsed;
}

export const openingModeSchema = z.enum([
  "supernatural-inciting-incident",
  "mundane-manifestation",
]);
export type OpeningMode = z.infer<typeof openingModeSchema>;

export const openingSupernaturalFocusSchema = z.enum([
  "creature",
  "phenomenon",
  "none",
]);
export type OpeningSupernaturalFocus = z.infer<
  typeof openingSupernaturalFocusSchema
>;

const openingNarrativeGuidanceSchema = z.string().trim().min(12).refine(
  (value) => /\s/.test(value) && !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(value),
  "Opening guidance must be a concrete narrative statement, not an entity or pressure ID",
);

export const openingSituationSchema = z.object({
  ordinaryAnchorEntityIds: z.array(stableIdSchema).min(1),
  openingMode: openingModeSchema.default("supernatural-inciting-incident"),
  supernaturalFocus: openingSupernaturalFocusSchema.default("creature"),
  awakeningEvent: openingNarrativeGuidanceSchema,
  manifestationOpportunity: openingNarrativeGuidanceSchema,
  manifestationTargetTurn: z.number().int().min(1).max(3).default(3),
  manifestationDeadlineTurns: z.literal(3).default(3),
  combatRequired: z.literal(false),
  unresolvedConsequences: z.array(z.string().trim().min(1)).min(1),
  actionableDirections: z.object({
    social: z.array(z.string().trim().min(1)).min(1),
    investigative: z.array(z.string().trim().min(1)).min(1),
    risky: z.array(z.string().trim().min(1)).min(1),
  }).strict(),
  mandatoryQuest: z.literal(false),
}).strict().superRefine((opening, context) => {
  if (
    opening.openingMode === "mundane-manifestation" &&
    opening.supernaturalFocus !== "none"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "A mundane-manifestation opening cannot begin with a committed supernatural focus",
      path: ["supernaturalFocus"],
    });
  }
  if (
    opening.openingMode === "supernatural-inciting-incident" &&
    opening.supernaturalFocus === "none"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "A supernatural-inciting opening must identify a creature or phenomenon focus",
      path: ["supernaturalFocus"],
    });
  }
});
export type OpeningSituation = z.infer<typeof openingSituationSchema>;

export const openingProgressionStateSchema = z.object({
  schemaVersion: z.literal(1),
  openingMode: openingModeSchema,
  supernaturalFocus: openingSupernaturalFocusSchema,
  playerTurnsSinceStart: z.number().int().nonnegative(),
  manifestationTargetTurn: z.number().int().min(1).max(3),
  manifestationDeadlineTurns: z.literal(3),
  firstPowerManifested: z.boolean(),
  manifestationOpportunity: openingNarrativeGuidanceSchema,
  characterSummary: z.string().trim().min(1),
  normalizedSetup: normalizedPlayerSetupSchema,
  firstPowerProposal: firstPowerProposalSchema.optional(),
  manifestationEvidenceEventId: stableIdSchema.optional(),
  manifestationEventId: stableIdSchema.optional(),
  /** Immutable post-commit player view for a presentation-only restart. */
  manifestationPresentationScene: presentationSceneSnapshotSchema.optional(),
  manifestationNarrationPending: z.boolean(),
}).strict().superRefine((state, context) => {
  if (state.playerTurnsSinceStart > state.manifestationDeadlineTurns) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Opening progression cannot advance beyond the manifestation deadline",
      path: ["playerTurnsSinceStart"],
    });
  }
  if (state.firstPowerManifested && !state.firstPowerProposal) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "A manifested opening power requires the validated first-power proposal",
      path: ["firstPowerProposal"],
    });
  }
  if (state.manifestationNarrationPending && !state.firstPowerManifested) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Manifestation narration can only be pending after the power is committed",
      path: ["manifestationNarrationPending"],
    });
  }
});
export type OpeningProgressionState = z.infer<
  typeof openingProgressionStateSchema
>;

export function createOpeningProgressionState(
  openingValue: unknown,
  input: {
    readonly characterSummary: string;
    readonly normalizedSetup: NormalizedPlayerSetup;
  },
): OpeningProgressionState {
  const opening = openingSituationSchema.parse(openingValue);
  return openingProgressionStateSchema.parse({
    schemaVersion: 1,
    openingMode: opening.openingMode,
    supernaturalFocus: opening.supernaturalFocus,
    playerTurnsSinceStart: 0,
    manifestationTargetTurn: opening.manifestationTargetTurn,
    manifestationDeadlineTurns: opening.manifestationDeadlineTurns,
    firstPowerManifested: false,
    manifestationOpportunity: opening.manifestationOpportunity,
    characterSummary: input.characterSummary,
    normalizedSetup: input.normalizedSetup,
    manifestationNarrationPending: false,
  });
}

export function playerMechanicalConstraints(
  playerEntityId: string,
  normalized: NormalizedPlayerSetup,
): MechanicalConstraint[] {
  return normalized.establishedFacts.map((fact) =>
    mechanicalConstraintSchema.parse({
      id: `constraint.${playerEntityId}.${fact.id}`,
      sourceKind: "player-established",
      sourceId: fact.id,
      summary: fact.statement,
    })
  );
}
