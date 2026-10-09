import {
  actorSocialStateSchema,
  assertNoRetconJsonExtension,
  beliefSchema,
  canonicalFactSchema,
  emptyContentBundle,
  entitySchema,
  fictionalDurationMs,
  fictionalInstant,
  generationIssueSchema,
  generationRecordSchema,
  jsonValueSchema,
  mechanicalRealizationSchema,
  runGenerationPipeline,
  stableIdSchema,
  type ActorSocialState,
  type Campaign,
  type Entity,
  type EventTypeDefinition,
  type GenerationIssue,
  type GenerationStage,
  type GenerationStageDiagnostic,
  type JsonValue,
  type MechanicalRealization,
  type MutationProposal,
  type ModelRuntime,
  type WorldProcessDefinition,
  type WorldSimulationContribution,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import {
  normalizedPlayerSetupSchema,
  openingSituationSchema,
  playerCreationInputSchema,
  sourceContainsQuotedText,
  startingHumanGenerationIssues,
  startingHumanProposalSchema,
  createEmptyMundanePlayerMechanics,
  validateNormalizedPlayerSetup,
  type NormalizedPlayerSetup,
  type OpeningSituation,
  type PlayerCreationInput,
  type StartingHumanProposal,
} from "./player-creation.js";
import {
  ATTRIBUTE_IDS,
  skillSchema,
} from "./ruleset/model.js";
import { awakeningEarthModernBaseline } from "./setting/index.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const provenanceSchema = z.object({
  class: z.enum([
    "player-established",
    "real-world-anchor",
    "setting-derived",
    "generator-chosen",
    "simulation-derived",
    "later-densification",
  ]),
  sourceIds: z.array(stableIdSchema),
  rationale: z.string().trim().min(1),
}).strict();


export const identityResolutionLevelSchema = z.enum([
  "statistical",
  "ephemeral",
  "identified",
  "persistent",
]);
export type IdentityResolutionLevel = z.infer<
  typeof identityResolutionLevelSchema
>;

const identityResolutionRank: Readonly<Record<IdentityResolutionLevel, number>> = {
  statistical: 0,
  ephemeral: 1,
  identified: 2,
  persistent: 3,
};

export const identityResolutionStepSchema = z.object({
  id: stableIdSchema,
  level: identityResolutionLevelSchema,
  establishedAt: z.string().datetime(),
  provenance: provenanceSchema,
}).strict();

export const observedPersonSeedSchema = z.object({
  id: stableIdSchema,
  summary: z.string().trim().min(1),
  resolution: z.enum(["statistical", "ephemeral"]),
  establishedData: z.record(z.string(), jsonValueSchema),
  provenance: provenanceSchema,
}).strict();
export type ObservedPersonSeed = z.infer<typeof observedPersonSeedSchema>;

export const generatedPersonPromotionSchema = z.object({
  entity: entitySchema,
  targetResolution: z.enum(["identified", "persistent"]),
  resolutionStep: identityResolutionStepSchema,
  socialState: actorSocialStateSchema.optional(),
}).strict().superRefine((proposal, context) => {
  if (proposal.resolutionStep.level !== proposal.targetResolution) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Promotion step must establish the requested target resolution",
      path: ["resolutionStep", "level"],
    });
  }
  if (
    proposal.targetResolution === "persistent" &&
    !proposal.socialState
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Persistent promotion requires actor social state",
      path: ["socialState"],
    });
  }
  if (
    proposal.socialState &&
    proposal.socialState.actorId !== proposal.entity.id
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Promoted social state must belong to the promoted entity",
      path: ["socialState", "actorId"],
    });
  }
});
export type GeneratedPersonPromotion = z.infer<
  typeof generatedPersonPromotionSchema
>;

export function promoteObservedPerson(
  observationValue: unknown,
  proposalValue: unknown,
): {
  readonly entity: Entity;
  readonly socialState?: ActorSocialState;
  readonly mutations: readonly MutationProposal[];
} {
  const observation = observedPersonSeedSchema.parse(observationValue);
  const proposal = generatedPersonPromotionSchema.parse(proposalValue);
  if (
    identityResolutionRank[proposal.targetResolution] <=
      identityResolutionRank[observation.resolution]
  ) {
    throw new Error("Person promotion must increase identity resolution");
  }
  try {
    assertNoRetconJsonExtension(
      observation.establishedData,
      proposal.entity.data,
    );
  } catch (error) {
    throw new Error(
      `Promoted person contradicts an established observation: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const entity = clone(proposal.entity);
  entity.data = {
    ...entity.data,
    identityResolutionHistory: jsonValueSchema.parse([
      {
        id: `resolution.${observation.id}.${observation.resolution}`,
        level: observation.resolution,
        establishedAt: proposal.resolutionStep.establishedAt,
        provenance: observation.provenance,
      },
      proposal.resolutionStep,
    ]),
  };

  const mutations: MutationProposal[] = [{
    kind: "add-entity",
    entity,
  }];
  if (proposal.socialState) {
    mutations.push({
      kind: "ensure-actor-social-state",
      actorId: entity.id,
    });
    for (const goal of proposal.socialState.goals) {
      mutations.push({ kind: "upsert-actor-goal", actorId: entity.id, goal });
    }
    for (const relationship of proposal.socialState.relationships) {
      mutations.push({
        kind: "upsert-actor-relationship",
        actorId: entity.id,
        relationship,
      });
    }
    for (const memory of proposal.socialState.memories) {
      mutations.push({ kind: "upsert-actor-memory", actorId: entity.id, memory });
    }
    for (const commitment of proposal.socialState.commitments) {
      mutations.push({
        kind: "upsert-actor-commitment",
        actorId: entity.id,
        commitment,
      });
    }
  }
  return {
    entity,
    ...(proposal.socialState ? { socialState: clone(proposal.socialState) } : {}),
    mutations,
  };
}

export const generatedEntityDensificationSchema = z.object({
  entityId: stableIdSchema,
  candidateData: z.record(stableIdSchema, jsonValueSchema),
  requiredPaths: z.array(z.string().trim().min(1)).min(1),
  provenance: provenanceSchema.extend({
    class: z.literal("later-densification"),
  }),
}).strict();

export function densifyGeneratedEntity(
  existingValue: unknown,
  requestValue: unknown,
): {
  readonly entity: Entity;
  readonly mutations: readonly MutationProposal[];
} {
  const existing = entitySchema.parse(existingValue);
  const request = generatedEntityDensificationSchema.parse(requestValue);
  if (request.entityId !== existing.id) {
    throw new Error("Densification request targets a different entity");
  }
  try {
    assertNoRetconJsonExtension(existing.data, request.candidateData);
  } catch (error) {
    throw new Error(
      `Generated detail would retcon established truth: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const history = Array.isArray(existing.data["densification-history"])
    ? existing.data["densification-history"]
    : [];
  const nextData = {
    ...request.candidateData,
    "densification-history": jsonValueSchema.parse([
      ...history,
      {
        id: `densification.${existing.id}.${history.length + 1}`,
        requiredPaths: request.requiredPaths,
        provenance: request.provenance,
      },
    ]),
  };
  const entity = entitySchema.parse({ ...existing, data: nextData });
  const mutations: MutationProposal[] = [];
  for (const [key, value] of Object.entries(nextData)) {
    if (JSON.stringify(existing.data[key]) === JSON.stringify(value)) continue;
    mutations.push({
      kind: "set-entity-data",
      entityId: existing.id,
      key,
      value,
    });
  }
  return { entity, mutations };
}

export const startingRegionRequestSchema = z.object({
  locationDescription: z.string().trim().min(1),
  player: playerCreationInputSchema,
  startTime: z.string().datetime(),
  campaignId: stableIdSchema,
  controlSeed: z.number().int().nonnegative().optional(),
  allowGeneratedDetails: z.boolean().optional(),
}).strict();
export type StartingRegionRequest = z.infer<typeof startingRegionRequestSchema>;

export const normalizedRegionConstraintsSchema = z.object({
  geographyMode: z.enum([
    "fictional-in-real-region",
    "fictional-relative-to-real-place",
    "explicit-real-locality",
  ]),
  geographicDescription: z.string().trim().min(1),
  settlementScale: z.enum([
    "rural",
    "small-town",
    "town",
    "small-city",
    "medium-city",
    "large-city",
    "major-city",
  ]),
  explicitConstraints: z.array(z.object({
    id: stableIdSchema,
    statement: z.string().trim().min(1),
    sourceText: z.string().trim().min(1).describe(
      "An exact quotation from locationDescription, not the name of that JSON field.",
    ),
  }).strict()),
  realWorldAnchors: z.array(z.object({
    id: stableIdSchema,
    description: z.string().trim().min(1),
  }).strict()),
  followUpQuestions: z.array(z.object({
    id: stableIdSchema,
    question: z.string().trim().min(1),
    materialImpact: z.string().trim().min(1),
  }).strict()),
  player: normalizedPlayerSetupSchema,
}).strict();
export type NormalizedRegionConstraints = z.infer<
  typeof normalizedRegionConstraintsSchema
>;

export const regionalFrameSchema = z.object({
  id: stableIdSchema,
  name: z.string().trim().min(1),
  broadGeography: z.string().trim().min(1),
  climate: z.string().trim().min(1),
  terrain: z.array(z.string().trim().min(1)).min(1),
  settlementPattern: z.string().trim().min(1),
  transportationConnectivity: z.string().trim().min(1),
  economicContext: z.string().trim().min(1),
  supernaturalPressureBaseline: z.string().trim().min(1),
  gateHistory: z.string().trim().min(1),
  nearestPopulationCenters: z.array(z.string().trim().min(1)),
  provenance: provenanceSchema,
}).strict();
export type RegionalFrame = z.infer<typeof regionalFrameSchema>;

const districtSchema = z.object({
  id: stableIdSchema,
  name: z.string().trim().min(1),
  summary: z.string().trim().min(1),
}).strict();

export const settlementSeedSchema = z.object({
  id: stableIdSchema,
  name: z.string().trim().min(1),
  approximatePopulation: z.number().int().positive(),
  settlementType: z.string().trim().min(1),
  economy: z.array(z.string().trim().min(1)).min(1),
  districts: z.array(districtSchema).min(1),
  transportation: z.array(z.string().trim().min(1)).min(1),
  supernaturalHistory: z.string().trim().min(1),
  institutionalCapacity: z.string().trim().min(1),
  traits: z.array(z.string().trim().min(1)),
  provenance: provenanceSchema,
}).strict();
export type SettlementSeed = z.infer<typeof settlementSeedSchema>;

export const startingLocalitySchema = z.object({
  id: stableIdSchema,
  name: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  locations: z.array(entitySchema).min(2),
  routes: z.array(z.object({
    fromId: stableIdSchema,
    toId: stableIdSchema,
    summary: z.string().trim().min(1),
  }).strict()).min(1),
  ordinaryWeekCoverage: z.array(z.string().trim().min(1)).min(3),
  provenance: provenanceSchema,
}).strict();
export type StartingLocality = z.infer<typeof startingLocalitySchema>;

export const institutionSeedSchema = z.object({
  entity: entitySchema,
  institutionType: stableIdSchema,
  serviceAreaEntityId: stableIdSchema,
  goals: z.array(z.string().trim().min(1)).min(1),
  capabilities: z.array(z.string().trim().min(1)),
  resources: z.array(z.string().trim().min(1)),
  constraints: z.array(z.string().trim().min(1)),
  currentPressures: z.array(z.string().trim().min(1)),
  provenance: provenanceSchema,
}).strict();
export type InstitutionSeed = z.infer<typeof institutionSeedSchema>;

export const playerContextSeedSchema = z.object({
  entity: entitySchema,
  homeLocationId: stableIdSchema,
  routineLocationIds: z.array(stableIdSchema),
  accessEntityIds: z.array(stableIdSchema),
  currentObligations: z.array(z.string().trim().min(1)),
  ordinaryPressures: z.array(z.string().trim().min(1)),
  socialState: actorSocialStateSchema,
  mechanics: startingHumanProposalSchema,
  provenance: provenanceSchema,
}).strict();
export type PlayerContextSeed = z.infer<typeof playerContextSeedSchema>;

const playerContextModelProposalSchema = z.object({
  entity: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    summary: z.string().optional(),
  }).passthrough().default({}),
  homeLocationId: z.string().optional(),
  routineLocationIds: z.array(z.string()).default([]),
  accessEntityIds: z.array(z.string()).default([]),
  currentObligations: z.array(z.string()).default([]),
  ordinaryPressures: z.array(z.string()).default([]),
  mechanicalSignals: z.object({
    attributeDirections: z.array(z.object({
      attributeId: z.string(),
      direction: z.string(),
      rationale: z.string().optional(),
      sourceFactIds: z.array(z.string()).default([]),
    }).passthrough()).default([]),
    skills: z.array(z.object({
      skill: z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        specificity: z.number().optional(),
        sp: z.number().optional(),
      }).passthrough().default({}),
      rationale: z.string().optional(),
      sourceFactIds: z.array(z.string()).default([]),
    }).passthrough()).default([]),
  }).passthrough().default({ attributeDirections: [], skills: [] }),
  provenance: z.unknown().optional(),
}).passthrough();
type PlayerContextModelProposal = z.infer<typeof playerContextModelProposalSchema>;

export const persistentNpcSeedSchema = z.object({
  entity: entitySchema,
  simulationReasons: z.array(z.string().trim().min(1)).min(1),
  socialState: actorSocialStateSchema,
  mechanicallyRelevantConstraints: z.array(z.object({
    id: stableIdSchema,
    summary: z.string().trim().min(1),
    sourceId: stableIdSchema,
  }).strict()),
  awakenedLicenseBand: z.enum([
    "Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Pink", "Silver",
  ]).optional(),
  provenance: provenanceSchema,
}).strict();
export type PersistentNpcSeed = z.infer<typeof persistentNpcSeedSchema>;

const npcModelProposalSchema = z.array(z.object({
  name: z.string().optional(),
  summary: z.string().optional(),
  simulationReasons: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  relationshipToPlayer: z.object({
    dimensions: z.record(z.string(), z.number()).default({}),
    salience: z.number().optional(),
    tags: z.array(z.string()).default([]),
  }).passthrough().optional(),
  memories: z.array(z.object({
    summary: z.string().optional(),
    salience: z.number().optional(),
    tags: z.array(z.string()).default([]),
  }).passthrough()).default([]),
  mechanicallyRelevantConstraints: z.array(z.object({
    summary: z.string().optional(),
  }).passthrough()).default([]),
  awakenedLicenseBand: z.string().optional(),
}).passthrough());
type NpcModelProposal = z.infer<typeof npcModelProposalSchema>;

const compactNpcRecoverySchema = z.array(z.object({
  name: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(200),
  simulationReasons: z.array(z.string().trim().min(1).max(120)).min(1).max(2),
  goals: z.array(z.string().trim().min(1).max(160)).min(1).max(2),
}).strict()).min(1).max(2);

const compactInstitutionRecoverySchema = z.array(z.object({
  name: z.string().trim().min(1).max(100),
  summary: z.string().trim().min(1).max(200),
  institutionType: z.string().trim().min(1).max(80),
  serviceAreaEntityId: z.string().trim().min(1).max(160),
  goals: z.array(z.string().trim().min(1).max(160)).min(1).max(2),
  capabilities: z.array(z.string().trim().min(1).max(160)).max(2).default([]),
  resources: z.array(z.string().trim().min(1).max(160)).max(2).default([]),
  constraints: z.array(z.string().trim().min(1).max(160)).max(2).default([]),
  currentPressures: z.array(z.string().trim().min(1).max(160)).max(2).default([]),
}).strict()).max(2);

export const threatEnvelopeSchema = z.object({
  challengeBand: z.enum([
    "Routine",
    "Challenging",
    "Hard",
    "Severe",
    "Overwhelming",
  ]),
  overallThreat: z.string().trim().min(1),
  offensivePressure: z.number().min(0).max(1),
  survivability: z.number().min(0).max(1),
  mobilityReach: z.number().min(0).max(1),
  controlDenial: z.number().min(0).max(1),
  sensoryInformation: z.number().min(0).max(1),
  multiTargetPressure: z.number().min(0).max(1),
  resourcePressure: z.number().min(0).max(1),
  hardCounterRisks: z.array(z.string().trim().min(1)),
  requiredSignatureCapabilities: z.array(z.string().trim().min(1)).min(1),
  requiredTells: z.array(z.string().trim().min(1)).min(1),
  requiredCounterplay: z.array(z.string().trim().min(1)).min(1),
  allowedGrowthRange: z.string().trim().min(1),
}).strict();

export const creatureSeedSchema = z.object({
  entity: entitySchema,
  origin: z.enum([
    "transformed-terrestrial-life",
    "spontaneous-magical-generation",
  ]),
  morphology: z.string().trim().min(1),
  behavior: z.string().trim().min(1),
  corePrinciple: z.string().trim().min(1),
  observedTraits: z.array(z.string().trim().min(1)),
  nearTermPlayerFacing: z.boolean(),
  threatEnvelope: threatEnvelopeSchema.optional(),
  provenance: provenanceSchema,
}).strict().superRefine((creature, context) => {
  if (creature.nearTermPlayerFacing && !creature.threatEnvelope) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A near-term player-facing creature requires a durable threat envelope",
      path: ["threatEnvelope"],
    });
  }
});
export type CreatureSeed = z.infer<typeof creatureSeedSchema>;

export const pressureSeedSchema = z.object({
  id: stableIdSchema,
  category: z.enum(["ordinary", "social-institutional", "supernatural"]),
  summary: z.string().trim().min(1),
  currentState: z.string().trim().min(1),
  cause: z.string().trim().min(1),
  likelyTrajectory: z.string().trim().min(1),
  actorEntityIds: z.array(stableIdSchema),
  scopeId: stableIdSchema,
  changeConditions: z.array(z.string().trim().min(1)),
  provenance: provenanceSchema,
}).strict();
export type PressureSeed = z.infer<typeof pressureSeedSchema>;

export const activeProcessSeedSchema = z.object({
  id: stableIdSchema,
  scopeId: stableIdSchema,
  pressureId: stableIdSchema,
  changePerDay: z.number().finite(),
  summary: z.string().trim().min(1),
}).strict();
export type ActiveProcessSeed = z.infer<typeof activeProcessSeedSchema>;

export const knowledgeSeedSchema = z.object({
  facts: z.array(canonicalFactSchema),
  beliefs: z.array(beliefSchema),
}).strict();
export type KnowledgeSeed = z.infer<typeof knowledgeSeedSchema>;

export const pressureKnowledgeProcessSchema = z.object({
  pressures: z.array(pressureSeedSchema).min(3),
  creatures: z.array(creatureSeedSchema),
  knowledge: knowledgeSeedSchema,
  processes: z.array(activeProcessSeedSchema).min(2),
}).strict();

const pressureModelProposalSchema = z.object({
  pressures: z.array(z.object({
    category: z.string().optional(),
    summary: z.string().optional(),
    currentState: z.string().optional(),
    cause: z.string().optional(),
    likelyTrajectory: z.string().optional(),
    actorEntityIds: z.array(z.string()).default([]),
    scope: z.string().optional(),
    changeConditions: z.array(z.string()).default([]),
    visibility: z.string().optional(),
  }).passthrough()).default([]),
  creatures: z.array(z.object({
    name: z.string().optional(),
    summary: z.string().optional(),
    origin: z.string().optional(),
    morphology: z.string().optional(),
    behavior: z.string().optional(),
    corePrinciple: z.string().optional(),
    observedTraits: z.array(z.string()).default([]),
    nearTermPlayerFacing: z.boolean().optional(),
    threat: z.object({
      challengeBand: z.string().optional(),
      overallThreat: z.string().optional(),
      hardCounterRisks: z.array(z.string()).default([]),
      signatureCapabilities: z.array(z.string()).default([]),
      tells: z.array(z.string()).default([]),
      counterplay: z.array(z.string()).default([]),
    }).passthrough().default({
      hardCounterRisks: [],
      signatureCapabilities: [],
      tells: [],
      counterplay: [],
    }),
  }).passthrough()).default([]),
  beliefs: z.array(z.object({
    holderActorId: z.string().optional(),
    subjectRef: z.string().optional(),
    proposition: z.string().optional(),
    truthStatus: z.string().optional(),
    confidence: z.number().optional(),
  }).passthrough()).default([]),
}).passthrough();
type PressureModelProposal = z.infer<typeof pressureModelProposalSchema>;

export const coherenceAuditSchema = z.object({
  issues: z.array(generationIssueSchema.extend({
    repairStageId: z.enum([
      "settlement",
      "institutions",
      "player-context",
      "npcs",
      "pressures",
      "opening-situation",
    ]).optional(),
  }).strict()),
}).strict();

export interface StartingRegionProposalModel {
  propose(
    stageId: string,
    context: Readonly<StartingRegionWorkingState>,
  ): Promise<unknown> | unknown;
  repair(
    stageId: string,
    candidate: unknown,
    issues: readonly GenerationIssue[],
    context: Readonly<StartingRegionWorkingState>,
  ): Promise<unknown> | unknown;
  audit(
    seed: StartingRegionSeed,
    context: Readonly<StartingRegionWorkingState>,
  ): Promise<unknown> | unknown;
}

function stableGeneratedSlug(value: string, fallback: string): string {
  const slug = value.toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || fallback;
}

function compactStrings(values: readonly string[], maximum: number): string[] {
  return [...new Set(values
    .map((value) => value.trim().slice(0, 240))
    .filter(Boolean))]
    .slice(0, maximum);
}

export function expandPlayerContextProposal(
  rawProposal: unknown,
  context: Readonly<StartingRegionWorkingState>,
): PlayerContextSeed {
  const proposal = playerContextModelProposalSchema.parse(rawProposal);
  const establishedFacts = context.normalized?.player.establishedFacts ?? [];
  const establishedFactIds = new Set([
    "player.input",
    ...establishedFacts.map((fact) => fact.id),
  ]);
  const attributeIds = new Set<string>(ATTRIBUTE_IDS);
  const directionByAttribute = new Map(
    proposal.mechanicalSignals.attributeDirections.slice(0, 8)
      .map((signal) => ({
        attributeId: signal.attributeId,
        direction: signal.direction === "above-baseline"
          ? "above-baseline" as const
          : signal.direction === "below-baseline"
            ? "below-baseline" as const
            : undefined,
        rationale: signal.rationale?.trim().slice(0, 240) ||
          "The normalized player biography supports this departure from baseline.",
        sourceFactIds: signal.sourceFactIds.filter((id) => establishedFactIds.has(id)),
      }))
      .filter((signal) =>
        attributeIds.has(signal.attributeId) &&
        signal.direction !== undefined &&
        signal.sourceFactIds.length > 0
      )
      .map((signal) => [signal.attributeId, signal] as const),
  );
  const attributes = Object.fromEntries(ATTRIBUTE_IDS.map((attributeId) => [
    attributeId,
    directionByAttribute.get(attributeId)?.direction === "above-baseline"
      ? 60
      : directionByAttribute.get(attributeId)?.direction === "below-baseline"
        ? 52
        : 56,
  ]));
  const groundedSkillCandidates = proposal.mechanicalSignals.skills.slice(0, 4)
    .map((item) => ({
      skill: skillSchema.parse({
        id: `skill.generated.${stableGeneratedSlug(
          item.skill.id ?? item.skill.name ?? "experience",
          "experience",
        )}`,
        name: item.skill.name?.trim().slice(0, 120) || "Everyday Experience",
        description: item.skill.description?.trim().slice(0, 240) ||
          item.rationale?.trim().slice(0, 240) ||
          "Practical experience established by the player's background.",
        specificity: Number.isInteger(item.skill.specificity) &&
            item.skill.specificity! >= 1 && item.skill.specificity! <= 5
          ? item.skill.specificity
          : 2,
        sp: Math.min(150, Math.max(50, Math.round(item.skill.sp ?? 50))),
      }),
      rationale: item.rationale?.trim().slice(0, 240) ||
        "The skill follows from an established player-background fact.",
      sourceFactIds: item.sourceFactIds.filter((id) => establishedFactIds.has(id)),
    }))
    .filter((item) => item.sourceFactIds.length > 0);
  const skillIds = new Set<string>();
  const skillNames = new Set<string>();
  let groundedSkills = groundedSkillCandidates.filter((item) => {
    const normalizedName = item.skill.name.trim().toLocaleLowerCase();
    if (skillIds.has(item.skill.id) || skillNames.has(normalizedName)) return false;
    skillIds.add(item.skill.id);
    skillNames.add(normalizedName);
    return true;
  });
  if (groundedSkills.length === 0) {
    const basis = establishedFacts[0];
    groundedSkills = [{
      skill: skillSchema.parse({
        id: `skill.generated.${stableGeneratedSlug(basis?.category ?? "everyday-experience", "everyday-experience")}`,
        name: basis
          ? `${basis.category.split("-").map((part) =>
              `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`
            ).join(" ")} Experience`
          : "Everyday Experience",
        description: basis?.statement ?? context.request.player.description.slice(0, 240),
        specificity: 2,
        sp: 50,
      }),
      rationale: basis?.statement ?? "Grounded in the player's supplied setup description.",
      sourceFactIds: [basis?.id ?? "player.input"],
    }];
  }
  const localityIds = new Set(context.locality?.locations.map((location) => location.id) ?? []);
  const homeLocationId = proposal.homeLocationId && localityIds.has(proposal.homeLocationId)
    ? proposal.homeLocationId
    : context.locality?.locations[0]?.id;
  if (!homeLocationId) throw new Error("Player-context generation requires a starting locality");
  const routineLocationIds = proposal.routineLocationIds.filter((id) => localityIds.has(id));
  const availableEntityIds = new Set([
    ...localityIds,
    ...(context.institutions?.map((institution) => institution.entity.id) ?? []),
  ]);
  const accessEntityIds = proposal.accessEntityIds.filter((id) => availableEntityIds.has(id));

  return playerContextSeedSchema.parse({
    entity: {
      id: "generated.actor.player",
      kind: "actor",
      name: context.request.player.name ?? (
        proposal.entity.name?.trim().slice(0, 120) || "Player"
      ),
      summary: proposal.entity.summary?.trim().slice(0, 320) ||
        context.request.player.description.slice(0, 320),
      data: {},
    },
    homeLocationId,
    routineLocationIds: routineLocationIds.length > 0
      ? routineLocationIds
      : [homeLocationId],
    accessEntityIds: accessEntityIds.length > 0
      ? accessEntityIds
      : [homeLocationId],
    currentObligations: proposal.currentObligations
      .map((value) => value.trim().slice(0, 240))
      .filter(Boolean)
      .slice(0, 3),
    ordinaryPressures: proposal.ordinaryPressures
      .map((value) => value.trim().slice(0, 240))
      .filter(Boolean)
      .slice(0, 5),
    socialState: actorSocialStateSchema.parse({
      actorId: "generated.actor.player",
      goals: (context.normalized?.player.currentWants ?? []).slice(0, 3).map(
        (description, index) => ({
          id: `goal.generated.actor.player.starting-${index + 1}`,
          description,
          priority: Math.max(0.5, 0.9 - index * 0.1),
          status: "active",
          relatedEntityIds: [],
          createdAt: context.request.startTime,
        }),
      ),
      relationships: [],
      memories: [],
      commitments: [],
    }),
    mechanics: {
      mechanics: createEmptyMundanePlayerMechanics(
        attributes,
        groundedSkills.map((item) => item.skill),
      ),
      attributeEvidence: ATTRIBUTE_IDS.map((attributeId) => {
        const signal = directionByAttribute.get(attributeId);
        return signal
          ? {
              attributeId,
              direction: signal.direction,
              rationale: signal.rationale,
              sourceFactIds: signal.sourceFactIds,
            }
          : {
              attributeId,
              direction: "near-baseline" as const,
              rationale: "No established biography fact moves this attribute from baseline.",
              sourceFactIds: [],
            };
      }),
      skillEvidence: groundedSkills.map((item) => ({
        skillId: item.skill.id,
        rationale: item.rationale,
        sourceFactIds: item.sourceFactIds,
      })),
    },
    provenance: {
      class: "generator-chosen",
      sourceIds: establishedFacts.slice(0, 8).map((fact) => fact.id).length > 0
        ? establishedFacts.slice(0, 8).map((fact) => fact.id)
        : ["player.input"],
      rationale: "Player-specific context expands the normalized setup without changing player-established facts.",
    },
  });
}

export function expandCompactInstitutionProposals(
  rawProposal: unknown,
  context: Readonly<StartingRegionWorkingState>,
): InstitutionSeed[] {
  if (!context.region || !context.settlement) {
    throw new Error("Institution recovery requires the accepted region and settlement");
  }
  const parsed = compactInstitutionRecoverySchema.parse(rawProposal);
  const proposals = parsed.length > 0
    ? parsed
    : [{
        name: `${context.settlement.name} Civic Services`,
        summary: `A local institution supporting ordinary life in ${context.settlement.name}.`,
        institutionType: "civic-services",
        serviceAreaEntityId: context.settlement.id,
        goals: ["Keep essential local services operating."],
        capabilities: ["Coordinate ordinary local services."],
        resources: [],
        constraints: ["Local capacity is limited."],
        currentPressures: [],
      }];
  const allowedServiceAreaIds = new Set([context.region.id, context.settlement.id]);
  const usedIds = new Set<string>();
  return proposals.map((proposal, index) => {
    const name = proposal.name.trim().slice(0, 100);
    const baseSlug = stableGeneratedSlug(name, `local-institution-${index + 1}`);
    let entityId = `generated.institution.${baseSlug}`;
    if (usedIds.has(entityId)) entityId = `${entityId}-${index + 1}`;
    usedIds.add(entityId);
    const goals = compactStrings(proposal.goals, 2);
    return institutionSeedSchema.parse({
      entity: {
        id: entityId,
        kind: "institution",
        name,
        summary: proposal.summary.trim().slice(0, 200),
        data: {},
      },
      institutionType: stableGeneratedSlug(proposal.institutionType, "local-services"),
      serviceAreaEntityId: allowedServiceAreaIds.has(proposal.serviceAreaEntityId)
        ? proposal.serviceAreaEntityId
        : context.settlement!.id,
      goals: goals.length > 0 ? goals : ["Support ordinary local life."],
      capabilities: compactStrings(proposal.capabilities, 2),
      resources: compactStrings(proposal.resources, 2),
      constraints: compactStrings(proposal.constraints, 2),
      currentPressures: compactStrings(proposal.currentPressures, 2),
      provenance: {
        class: "generator-chosen",
        sourceIds: [context.settlement!.id],
        rationale: "Expanded from a compact institution proposal against the accepted settlement.",
      },
    });
  });
}

export function expandNpcProposals(
  rawProposal: unknown,
  context: Readonly<StartingRegionWorkingState>,
): PersistentNpcSeed[] {
  const parsed = npcModelProposalSchema.parse(rawProposal);
  const proposals: NpcModelProposal = parsed.length > 0
    ? parsed.slice(0, 5)
    : [{
        name: "Local Contact",
        summary: "A local person connected to the player's starting situation.",
        simulationReasons: ["starting-situation connection"],
        goals: ["Respond to developments in the starting locality."],
        memories: [],
        mechanicallyRelevantConstraints: [],
      }];
  const usedIds = new Set<string>();
  const licenseBands = new Set([
    "Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Pink", "Silver",
  ]);

  return proposals.map((proposal, index) => {
    const name = proposal.name?.trim().slice(0, 120) || `Local Contact ${index + 1}`;
    const baseSlug = stableGeneratedSlug(name, `local-contact-${index + 1}`);
    let entityId = `generated.actor.${baseSlug}`;
    if (usedIds.has(entityId)) entityId = `${entityId}-${index + 1}`;
    usedIds.add(entityId);
    const relationship = proposal.relationshipToPlayer;
    const dimensions = Object.fromEntries(Object.entries(relationship?.dimensions ?? {})
      .map(([key, value]) => [
        stableGeneratedSlug(key, "connection"),
        Math.max(-1, Math.min(1, value)),
      ])
      .slice(0, 8));
    const relationshipTags = compactStrings(relationship?.tags ?? [], 6)
      .map((tag) => stableGeneratedSlug(tag, "connection"));
    const goals = compactStrings(proposal.goals, 4);
    const simulationReasons = compactStrings(proposal.simulationReasons, 4);
    const memories = proposal.memories
      .map((memory) => ({
        summary: memory.summary?.trim().slice(0, 240) ?? "",
        salience: Math.max(0, Math.min(1, memory.salience ?? 0.6)),
        tags: compactStrings(memory.tags, 6)
          .map((tag) => stableGeneratedSlug(tag, "memory")),
      }))
      .filter((memory) => memory.summary)
      .slice(0, 3);

    return persistentNpcSeedSchema.parse({
      entity: {
        id: entityId,
        kind: "actor",
        name,
        summary: proposal.summary?.trim().slice(0, 320) ||
          `${name} is connected to the player's starting situation.`,
        data: {},
      },
      simulationReasons: simulationReasons.length > 0
        ? simulationReasons
        : ["relevant to the player's starting situation"],
      socialState: {
        actorId: entityId,
        goals: (goals.length > 0
          ? goals
          : ["Respond to developments in the starting locality."]
        ).map((description, goalIndex) => ({
          id: `goal.${entityId}.starting-${goalIndex + 1}`,
          description,
          priority: Math.max(0.5, 0.8 - goalIndex * 0.1),
          status: "active",
          relatedEntityIds: [],
          createdAt: context.request.startTime,
        })),
        relationships: relationship
          ? [{
              id: `relationship.${entityId}.player`,
              targetEntityId: context.playerContext?.entity.id ?? "generated.actor.player",
              dimensions,
              salience: Math.max(0, Math.min(1, relationship.salience ?? 0.6)),
              tags: relationshipTags,
              lastUpdatedAt: context.request.startTime,
            }]
          : [],
        memories: memories.map((memory, memoryIndex) => ({
          id: `memory.${entityId}.starting-${memoryIndex + 1}`,
          summary: memory.summary,
          formedAt: context.request.startTime,
          salience: memory.salience,
          relatedEntityIds: [],
          sourceEventIds: [],
          tags: memory.tags,
        })),
        commitments: [],
      },
      mechanicallyRelevantConstraints: proposal.mechanicallyRelevantConstraints
        .map((constraint) => constraint.summary?.trim().slice(0, 240) ?? "")
        .filter(Boolean)
        .slice(0, 4)
        .map((summary, constraintIndex) => ({
          id: `constraint.${entityId}.starting-${constraintIndex + 1}`,
          summary,
          sourceId: entityId,
        })),
      ...(proposal.awakenedLicenseBand && licenseBands.has(proposal.awakenedLicenseBand)
        ? { awakenedLicenseBand: proposal.awakenedLicenseBand }
        : {}),
      provenance: {
        class: "generator-chosen",
        sourceIds: ["setting.awakening-earth"],
        rationale: "The NPC expands the generated starting situation without changing player-established facts.",
      },
    });
  });
}

export function expandPressureProposal(
  rawProposal: unknown,
  context: Readonly<StartingRegionWorkingState>,
): z.infer<typeof pressureKnowledgeProcessSchema> {
  const proposal: PressureModelProposal = pressureModelProposalSchema.parse(rawProposal);
  if (!context.region || !context.settlement || !context.locality || !context.playerContext) {
    throw new Error("Pressure generation requires the accepted region, settlement, locality, and player context");
  }
  const categories = ["ordinary", "social-institutional", "supernatural"] as const;
  type PressureCategory = typeof categories[number];
  const isCategory = (value: string | undefined): value is PressureCategory =>
    categories.includes(value as PressureCategory);
  const fallbackByCategory: Readonly<Record<PressureCategory, PressureModelProposal["pressures"][number]>> = {
    ordinary: {
      category: "ordinary",
      summary: context.playerContext.ordinaryPressures[0] ?? "Everyday obligations are accumulating",
      currentState: "An ordinary obligation needs the player's attention.",
      cause: "the player's established everyday circumstances",
      likelyTrajectory: "The obligation becomes harder to ignore.",
      actorEntityIds: [context.playerContext.entity.id],
      scope: "locality",
      changeConditions: ["the obligation is addressed", "circumstances materially change"],
    },
    "social-institutional": {
      category: "social-institutional",
      summary: "A local institution is under strain",
      currentState: "A locally relevant institution has limited capacity for a developing problem.",
      cause: "ordinary resource and coordination constraints",
      likelyTrajectory: "Services become less reliable if the strain continues.",
      actorEntityIds: [],
      scope: "settlement",
      changeConditions: ["resources arrive", "the institution adapts"],
    },
    supernatural: {
      category: "supernatural",
      summary: "A new supernatural danger is emerging",
      currentState: "Subtle signs of a magical creature have appeared near the starting locality.",
      cause: "the setting's recent supernatural emergence",
      likelyTrajectory: "The signs become more immediate and easier to investigate.",
      actorEntityIds: [],
      scope: "region",
      changeConditions: ["the source is investigated", "the creature changes territory"],
      visibility: "hidden",
    },
  };
  const selectedPressureProposals = categories.map((category) =>
    proposal.pressures.find((candidate) => candidate.category === category) ??
      fallbackByCategory[category]
  );
  const extraPressureProposals = proposal.pressures
    .filter((candidate) => isCategory(candidate.category))
    .filter((candidate) => !selectedPressureProposals.includes(candidate))
    .slice(0, 2);
  const actorIds = new Set([
    context.playerContext.entity.id,
    ...(context.npcs?.map((npc) => npc.entity.id) ?? []),
  ]);
  const scopeIdByName = {
    region: `scope.${context.region.id}`,
    settlement: `scope.${context.settlement.id}`,
    locality: `scope.${context.locality.id}`,
  } as const;
  const usedPressureIds = new Set<string>();
  const visibilityByPressure = new Map<string, "public" | "hidden">();
  const pressures = [...selectedPressureProposals, ...extraPressureProposals].map(
    (candidate, index) => {
      const category = isCategory(candidate.category) ? candidate.category : categories[index % 3]!;
      const summary = candidate.summary?.trim().slice(0, 160) ||
        fallbackByCategory[category].summary!;
      const baseId = `generated.pressure.${stableGeneratedSlug(summary, `${category}-${index + 1}`)}`;
      const id = usedPressureIds.has(baseId) ? `${baseId}-${index + 1}` : baseId;
      usedPressureIds.add(id);
      visibilityByPressure.set(
        id,
        candidate.visibility === "hidden" ||
            (candidate.visibility !== "public" && category === "supernatural")
          ? "hidden"
          : "public",
      );
      const requestedScope = candidate.scope?.trim().toLocaleLowerCase();
      const defaultScope = category === "ordinary"
        ? "locality"
        : category === "social-institutional"
          ? "settlement"
          : "region";
      const scopeKey = requestedScope === "region" || requestedScope === "settlement" ||
          requestedScope === "locality"
        ? requestedScope
        : defaultScope;
      const referencedActors = [...new Set(candidate.actorEntityIds.filter((actorId) =>
        actorIds.has(actorId)
      ))].slice(0, 4);
      return pressureSeedSchema.parse({
        id,
        category,
        summary,
        currentState: candidate.currentState?.trim().slice(0, 240) ||
          fallbackByCategory[category].currentState,
        cause: candidate.cause?.trim().slice(0, 240) || fallbackByCategory[category].cause,
        likelyTrajectory: candidate.likelyTrajectory?.trim().slice(0, 240) ||
          fallbackByCategory[category].likelyTrajectory,
        actorEntityIds: referencedActors.length > 0
          ? referencedActors
          : category === "ordinary" ? [context.playerContext!.entity.id] : [],
        scopeId: scopeIdByName[scopeKey],
        changeConditions: compactStrings(candidate.changeConditions, 4).length > 0
          ? compactStrings(candidate.changeConditions, 4)
          : fallbackByCategory[category].changeConditions,
        provenance: {
          class: category === "ordinary" ? "generator-chosen" : "setting-derived",
          sourceIds: category === "ordinary" ? ["player.input"] : ["setting.awakening-earth"],
          rationale: "Expanded from a compact pressure proposal against accepted campaign state.",
        },
      });
    },
  );

  const creatureProposals = proposal.creatures.length > 0
    ? proposal.creatures.slice(0, 3)
    : [{
        name: "Unfamiliar Magical Creature",
        summary: "A newly emerged magical creature is affecting the starting locality.",
        origin: "spontaneous-magical-generation",
        morphology: "an animal-like form altered by visible magical traits",
        behavior: "cautious and territorial rather than indiscriminately aggressive",
        corePrinciple: "distorts a single physical property in its immediate surroundings",
        observedTraits: ["unfamiliar tracks", "a localized physical anomaly"],
        nearTermPlayerFacing: true,
        threat: {
          challengeBand: "Hard",
          overallThreat: "Dangerous but observable, avoidable, and vulnerable to informed counterplay.",
          hardCounterRisks: [],
          signatureCapabilities: ["localized environmental distortion"],
          tells: ["the surrounding anomaly intensifies before it acts"],
          counterplay: ["use the visible tell to create distance or break its approach"],
        },
      }];
  const challengeValues = {
    Routine: 0.3,
    Challenging: 0.45,
    Hard: 0.6,
    Severe: 0.75,
    Overwhelming: 0.9,
  } as const;
  type ChallengeBand = keyof typeof challengeValues;
  const isChallengeBand = (value: string | undefined): value is ChallengeBand =>
    value !== undefined && Object.hasOwn(challengeValues, value);
  const usedCreatureIds = new Set<string>();
  const creatures = creatureProposals.map((candidate, index) => {
    const name = candidate.name?.trim().slice(0, 120) || `Magical Creature ${index + 1}`;
    const baseId = `generated.creature.${stableGeneratedSlug(name, `creature-${index + 1}`)}`;
    const entityId = usedCreatureIds.has(baseId) ? `${baseId}-${index + 1}` : baseId;
    usedCreatureIds.add(entityId);
    const challengeBand = isChallengeBand(candidate.threat.challengeBand)
      ? candidate.threat.challengeBand
      : "Hard";
    const baseThreat = challengeValues[challengeBand];
    const boundedThreat = (value: number) => Math.round(
      Math.max(0, Math.min(1, value)) * 100,
    ) / 100;
    const signatureCapabilities = compactStrings(candidate.threat.signatureCapabilities, 4);
    const tells = compactStrings(candidate.threat.tells, 4);
    const counterplay = compactStrings(candidate.threat.counterplay, 4);
    return creatureSeedSchema.parse({
      entity: {
        id: entityId,
        kind: "creature",
        name,
        summary: candidate.summary?.trim().slice(0, 280) ||
          `${name} is a newly emerged magical creature near the starting locality.`,
        data: {},
      },
      origin: candidate.origin === "transformed-terrestrial-life"
        ? "transformed-terrestrial-life"
        : "spontaneous-magical-generation",
      morphology: candidate.morphology?.trim().slice(0, 240) || "an unfamiliar animal-like form",
      behavior: candidate.behavior?.trim().slice(0, 240) || "cautious and territorial",
      corePrinciple: candidate.corePrinciple?.trim().slice(0, 240) ||
        "produces one consistent, observable magical effect",
      observedTraits: compactStrings(candidate.observedTraits, 5).length > 0
        ? compactStrings(candidate.observedTraits, 5)
        : ["unfamiliar tracks", "a localized magical anomaly"],
      nearTermPlayerFacing: candidate.nearTermPlayerFacing ?? index === 0,
      threatEnvelope: {
        challengeBand,
        overallThreat: candidate.threat.overallThreat?.trim().slice(0, 240) ||
          `${name} is dangerous but observable and avoidable with informed counterplay.`,
        offensivePressure: baseThreat,
        survivability: boundedThreat(Math.max(0.2, baseThreat - 0.05)),
        mobilityReach: boundedThreat(baseThreat + 0.1),
        controlDenial: boundedThreat(Math.max(0.1, baseThreat - 0.15)),
        sensoryInformation: boundedThreat(Math.max(0.25, baseThreat - 0.05)),
        multiTargetPressure: boundedThreat(Math.max(0.1, baseThreat - 0.3)),
        resourcePressure: boundedThreat(Math.max(0.15, baseThreat - 0.1)),
        hardCounterRisks: compactStrings(candidate.threat.hardCounterRisks, 3),
        requiredSignatureCapabilities: signatureCapabilities.length > 0
          ? signatureCapabilities
          : ["one consistent magical effect"],
        requiredTells: tells.length > 0 ? tells : ["an observable tell precedes its effect"],
        requiredCounterplay: counterplay.length > 0
          ? counterplay
          : ["recognize the tell and interrupt or avoid the effect"],
        allowedGrowthRange: "May develop through simulation and survival, never hidden party scaling.",
      },
      provenance: {
        class: "setting-derived",
        sourceIds: ["setting.awakening-earth"],
        rationale: "Expanded from a compact creature proposal under Awakening Earth constraints.",
      },
    });
  });

  const facts = pressures.map((pressure, index) => canonicalFactSchema.parse({
    id: `generated.fact.pressure-${index + 1}-state`,
    subjectId: pressure.id,
    predicate: "pressure.current-state",
    value: pressure.currentState,
    visibility: visibilityByPressure.get(pressure.id) ?? "public",
    tags: ["pressure", pressure.category],
  }));
  const subjectIdsByRef = new Map<string, string>();
  for (const item of [
    ...pressures.map((pressure) => ({ id: pressure.id, name: pressure.summary })),
    ...creatures.map((creature) => ({ id: creature.entity.id, name: creature.entity.name })),
  ]) {
    subjectIdsByRef.set(item.id, item.id);
    subjectIdsByRef.set(item.name.trim().toLocaleLowerCase(), item.id);
  }
  const truthStatuses = new Set(["true", "incomplete", "uncertain", "false"]);
  const beliefs = proposal.beliefs.flatMap((candidate, index) => {
    const holderId = candidate.holderActorId && actorIds.has(candidate.holderActorId)
      ? candidate.holderActorId
      : undefined;
    const subjectRef = candidate.subjectRef?.trim();
    const subjectId = subjectRef
      ? subjectIdsByRef.get(subjectRef) ?? subjectIdsByRef.get(subjectRef.toLocaleLowerCase())
      : undefined;
    const proposition = candidate.proposition?.trim().slice(0, 280);
    if (!holderId || !subjectId || !proposition) return [];
    return [beliefSchema.parse({
      id: `generated.belief.starting-${index + 1}`,
      holder: { kind: "actor", id: holderId },
      subjectId,
      proposition,
      truthStatus: candidate.truthStatus && truthStatuses.has(candidate.truthStatus)
        ? candidate.truthStatus
        : "uncertain",
      confidence: Math.max(0, Math.min(1, candidate.confidence ?? 0.6)),
    })];
  });
  const changeByCategory: Readonly<Record<PressureCategory, number>> = {
    ordinary: 1,
    "social-institutional": 0.5,
    supernatural: 0.25,
  };
  const processes = pressures.map((pressure, index) => activeProcessSeedSchema.parse({
    id: `generated.process.pressure-${index + 1}`,
    scopeId: pressure.scopeId,
    pressureId: pressure.id,
    changePerDay: changeByCategory[pressure.category],
    summary: `${pressure.summary}: ${pressure.likelyTrajectory}`,
  }));

  return pressureKnowledgeProcessSchema.parse({
    pressures,
    creatures,
    knowledge: { facts, beliefs },
    processes,
  });
}

const startingRegionStageSchemas: Readonly<Record<string, z.ZodType<unknown>>> = {
  normalize: normalizedRegionConstraintsSchema,
  region: regionalFrameSchema,
  settlement: settlementSeedSchema,
  institutions: z.array(institutionSeedSchema),
  locality: startingLocalitySchema,
  "player-context": playerContextModelProposalSchema,
  npcs: compactNpcRecoverySchema,
  pressures: pressureModelProposalSchema,
  "opening-situation": openingSituationSchema,
};

function startingRegionStageMaxOutputTokens(stageId: string): number {
  if (stageId === "opening-situation") return 1_024;
  if (stageId === "npcs") return 1_024;
  if (stageId === "pressures") return 1_536;
  if (stageId === "player-context") return 2_048;
  return 4_096;
}

function reachedStructuredOutputTokenLimit(error: {
  readonly kind: string;
  readonly message: string;
  readonly diagnostic?: string;
}): boolean {
  if (error.kind !== "invalid-output") return false;
  return `${error.message} ${error.diagnostic ?? ""}`
    .toLocaleLowerCase()
    .includes("output token limit");
}

export function normalizeOpeningSituationCandidate(
  value: unknown,
  context?: Readonly<Pick<StartingRegionWorkingState, "creatures" | "pressures">>,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  const looksLikeId = (item: unknown): item is string =>
    typeof item === "string" && /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(item);
  const referencedCreature = looksLikeId(candidate.awakeningEvent)
    ? context?.creatures?.find((creature) => creature.entity.id === candidate.awakeningEvent)
    : undefined;
  const referencedPressure = looksLikeId(candidate.awakeningEvent)
    ? context?.pressures?.find((pressure) => pressure.id === candidate.awakeningEvent)
    : undefined;
  const normalized = {
    ...candidate,
    ...(looksLikeId(candidate.awakeningEvent)
      ? {
          awakeningEvent: referencedCreature
            ? `${referencedCreature.entity.name} intrudes on the player's ordinary routine through ${referencedCreature.observedTraits[0] ?? "an unmistakable magical disturbance"}.`
            : referencedPressure
              ? referencedPressure.currentState
              : "An unmistakable supernatural disturbance intrudes on the player's ordinary routine.",
        }
      : {}),
    ...(looksLikeId(candidate.manifestationOpportunity)
      ? {
          manifestationOpportunity: "The player's first committed attempt to understand or address the supernatural disturbance becomes the event through which a first power manifests.",
        }
      : {}),
    manifestationTargetTurn: 1,
  };
  if (candidate.openingMode === "mundane-manifestation") {
    return {
      ...normalized,
      openingMode: "supernatural-inciting-incident",
      supernaturalFocus: "phenomenon",
    };
  }
  return normalized;
}

const STARTING_REGION_MODEL_TIMEOUT_MS = 20 * 60 * 1_000;

/** Adapts the provider-neutral model runtime to the staged region generator. */
export function createStartingRegionProposalModel(
  modelRuntime: ModelRuntime,
): StartingRegionProposalModel {
  const invoke = async (
    stageId: string,
    context: Readonly<StartingRegionWorkingState>,
    repair?: { readonly candidate: unknown; readonly issues: readonly GenerationIssue[] },
  ): Promise<unknown> => {
    const schema = startingRegionStageSchemas[stageId];
    if (!schema) throw new Error(`Unknown starting-region stage ${stageId}`);
    const authorizedWorkingState = stageId === "player-context"
      ? {
          request: context.request,
          player: context.normalized?.player,
          settlement: context.settlement,
          locality: context.locality,
          institutions: context.institutions,
        }
      : stageId === "npcs"
        ? {
            request: context.request,
            player: context.normalized?.player,
            settlement: context.settlement,
            locality: context.locality,
            institutions: context.institutions,
            playerContext: context.playerContext && {
              entity: context.playerContext.entity,
              currentObligations: context.playerContext.currentObligations,
              ordinaryPressures: context.playerContext.ordinaryPressures,
            },
          }
      : stageId === "pressures"
        ? {
            request: {
              startTime: context.request.startTime,
              allowGeneratedDetails: context.request.allowGeneratedDetails,
            },
            region: context.region && {
              id: context.region.id,
              name: context.region.name,
              supernaturalPressureBaseline: context.region.supernaturalPressureBaseline,
              gateHistory: context.region.gateHistory,
            },
            settlement: context.settlement && {
              id: context.settlement.id,
              name: context.settlement.name,
              economy: context.settlement.economy,
              institutionalCapacity: context.settlement.institutionalCapacity,
              supernaturalHistory: context.settlement.supernaturalHistory,
            },
            institutions: context.institutions?.map((institution) => ({
              entity: institution.entity,
              goals: institution.goals,
              constraints: institution.constraints,
              currentPressures: institution.currentPressures,
            })),
            locality: context.locality && {
              id: context.locality.id,
              name: context.locality.name,
              summary: context.locality.summary,
              locations: context.locality.locations,
            },
            playerContext: context.playerContext && {
              entity: context.playerContext.entity,
              currentObligations: context.playerContext.currentObligations,
              ordinaryPressures: context.playerContext.ordinaryPressures,
            },
            npcs: context.npcs?.map((npc) => ({
              entity: npc.entity,
              simulationReasons: npc.simulationReasons,
              goals: npc.socialState.goals.map((goal) => goal.description),
            })),
          }
      : stageId === "opening-situation"
        ? {
            request: { startTime: context.request.startTime },
            settlement: context.settlement && {
              id: context.settlement.id,
              name: context.settlement.name,
              supernaturalHistory: context.settlement.supernaturalHistory,
              institutionalCapacity: context.settlement.institutionalCapacity,
            },
            locality: context.locality && {
              id: context.locality.id,
              name: context.locality.name,
              summary: context.locality.summary,
              locations: context.locality.locations,
            },
            institutions: context.institutions?.map((institution) => ({
              entity: institution.entity,
              capabilities: institution.capabilities,
              constraints: institution.constraints,
              currentPressures: institution.currentPressures,
            })),
            player: context.playerContext && {
              entity: context.playerContext.entity,
              currentObligations: context.playerContext.currentObligations,
              ordinaryPressures: context.playerContext.ordinaryPressures,
              powerPreferences: context.normalized?.player.powerPreferences,
            },
            npcs: context.npcs?.map((npc) => ({
              entity: npc.entity,
              simulationReasons: npc.simulationReasons,
            })),
            pressures: context.pressures,
            creatures: context.creatures?.map((creature) => ({
              entity: creature.entity,
              behavior: creature.behavior,
              corePrinciple: creature.corePrinciple,
              observedTraits: creature.observedTraits,
              nearTermPlayerFacing: creature.nearTermPlayerFacing,
            })),
          }
      : context;
    const result = await modelRuntime.generate({
      prompt: {
        instructions: [
          "Generate only grounded Awakening Earth campaign material for the requested stage.",
          awakeningEarthModernBaseline,
          "Do not default to medieval or pseudo-medieval fantasy. Unless player-established facts explicitly support a historic or isolated exception, use contemporary roads, vehicles, utilities, communications, businesses, services, and public institutions; a town or rural setting is still modern.",
          "Preserve player-established facts verbatim and do not make unspecified details player-authored.",
          "Use stable lowercase dot- or dash-separated IDs and cite provenance for generated choices.",
          "Every region, settlement, locality, location, institution, actor, creature, and pressure must have a distinct ID; never reuse a containing place's ID for a nested place.",
          "Use concise strings and the smallest arrays that satisfy the requested contract.",
          ...(stageId === "normalize"
            ? [
                "For every explicitConstraints sourceText, copy an exact quotation from workingState.request.locationDescription; never write a field name such as locationDescription.",
                "For every player establishedFacts sourceText, copy an exact quotation from workingState.request.player.description; never write a field name such as player.",
                "Do not place generator-chosen biography, personality, routine, or goal details in establishedFacts. Leave them unspecified; later stages may generate them when authorized.",
              ]
            : []),
          ...(stageId === "player-context"
            ? [
                "Keep player-context compact. In mechanicalSignals.attributeDirections include only established-fact-supported departures from baseline; omitted attributes are filled deterministically at baseline.",
                "Provide one to four concise grounded skills in mechanicalSignals.skills. Do not emit stress, progression, statuses, powers, mana, or boilerplate attribute evidence; the engine supplies those mundane defaults.",
                "Do not emit goals, relationships, memories, commitments, or other social-state boilerplate; the engine derives initial goals from the normalized player setup.",
                "Use unique IDs, concise strings, and only location/institution references present in the provided context.",
              ]
            : []),
          ...(stageId === "institutions"
            ? [
                "Return only one or two locally relevant institutions. Use an empty object for every entity.data field; do not invent nested metadata there.",
                "Keep each goals, capabilities, resources, constraints, and currentPressures list to at most two concise one-sentence entries.",
                "Set serviceAreaEntityId only to the provided region.id or settlement.id; settlement district IDs are descriptive and are not world entities.",
              ]
            : []),
          ...(stageId === "npcs"
            ? [
                "Return only one or two concise, distinctive NPC proposals that connect to established people, places, institutions, obligations, or pressures.",
                "For each NPC return only name, summary, one or two simulationReasons, and one or two immediate goals. Finish the JSON before adding detail.",
                "Do not emit relationships, memories, mechanical constraints, entity IDs, actor social-state boilerplate, timestamps, provenance, commitments, or empty scaffolding. Those details are generated later if play makes the NPC important.",
              ]
            : []),
          ...(stageId === "pressures"
            ? [
                "Return exactly the compact creative decisions for three linked pressure categories: ordinary, social-institutional, and supernatural; add at most two extra pressures.",
                "Return one to three concise magical creatures, including observable traits, one coherent magical principle, signature capabilities, tells, and counterplay. Do not emit numeric threat dimensions.",
                "Use scope values region, settlement, or locality and only actorEntityIds present in the supplied context. Belief subjectRef may be an exact proposed pressure/creature name or ID.",
                "Do not emit IDs, provenance, canonical facts, processes, timestamps, or persistence boilerplate; the engine derives and validates those deterministically.",
              ]
            : []),
          ...(stageId === "opening-situation"
            ? [
                "Frame one concise opening from the accepted entities, ordinary life, player power preferences, and pressures supplied here.",
                "Use supernatural-inciting-incident so magic is immediately relevant in the opening narration. Do not choose a mundane prelude for a generated Awakening Earth campaign.",
                "For supernatural-inciting-incident choose supernaturalFocus creature only when an accepted near-term creature genuinely fits; otherwise use phenomenon for a Gate, magical object, environmental anomaly, unstable power, or other non-creature supernatural event. For mundane-manifestation use supernaturalFocus none.",
                "Set manifestationTargetTurn to 1. The first committed player action must provide the grounded event through which the first power manifests; do not script the player's action in advance.",
                "Use only existing entity IDs for ordinaryAnchorEntityIds. Offer social, investigative, and risky directions without requiring combat or a mandatory quest.",
                "awakeningEvent and manifestationOpportunity are protected opening guidance, not already-narrated outcomes. A mundane opening may keep both latent until the manifestation turn.",
                "Do not restate the world, create mechanics, or narrate an outcome; return only the requested opening brief.",
              ]
            : []),
          ...(context.request.allowGeneratedDetails
            ? [
                "The player authorizes grounded generator-chosen details for anything they left unspecified.",
                "Do not ask setup follow-up questions; choose those details yourself without presenting them as player-established facts.",
              ]
            : []),
          ...(repair ? ["Repair only the reported local validation problems; preserve unrelated accepted material."] : []),
        ],
        context: JSON.stringify({ workingState: authorizedWorkingState, ...(repair ?? {}) }),
        input: `${repair ? "Repair" : "Generate"} starting-region stage '${stageId}'.`,
      },
      output: {
        kind: "structured",
        schemaId: `starting-region.${stageId}.v1`,
        schema,
      },
      trace: { operation: "starting-region-generation", invocationId: `starting-region.${stageId}.${repair ? "repair" : "generate"}` },
    }, {
      timeoutMs: STARTING_REGION_MODEL_TIMEOUT_MS,
      generation: {
        temperature: 0,
        maxOutputTokens: startingRegionStageMaxOutputTokens(stageId),
      },
    });
    if (
      !result.ok &&
      reachedStructuredOutputTokenLimit(result.error) &&
      (stageId === "npcs" || stageId === "institutions")
    ) {
      const isNpcRecovery = stageId === "npcs";
      const recoveryPrompt = {
          instructions: isNpcRecovery
            ? [
                "The previous NPC response was truncated. Return exactly one or two very small NPC records.",
                "For each record return only name, summary, one or two simulationReasons, and one or two goals. Do not return any other fields.",
                "Finish the JSON before adding detail.",
              ]
            : [
                "The previous institution response was truncated. Return exactly one or two very small institution records.",
                "Use only the requested compact fields, with no more than two short strings in any array. serviceAreaEntityId must be the supplied region or settlement ID.",
                "Finish the JSON before adding detail.",
              ],
          context: JSON.stringify(isNpcRecovery
            ? {
                player: context.playerContext && {
                  name: context.playerContext.entity.name,
                  summary: context.playerContext.entity.summary,
                  currentObligations: context.playerContext.currentObligations,
                },
                locality: context.locality && {
                  name: context.locality.name,
                  locations: context.locality.locations.map((location) => ({
                    id: location.id,
                    name: location.name,
                  })),
                },
                institutions: context.institutions?.map((institution) => ({
                  id: institution.entity.id,
                  name: institution.entity.name,
                })),
              }
            : {
                region: context.region && { id: context.region.id, name: context.region.name },
                settlement: context.settlement && {
                  id: context.settlement.id,
                  name: context.settlement.name,
                  settlementType: context.settlement.settlementType,
                  districts: context.settlement.districts.map((district) => ({
                    id: district.id,
                    name: district.name,
                  })),
                },
              }),
          input: `Recover truncated starting-region stage '${stageId}'.`,
        };
      const recoveryTrace = {
        operation: "starting-region-generation" as const,
        invocationId: `starting-region.${stageId}.truncation-recovery`,
      };
      const recoveryOptions = {
        timeoutMs: STARTING_REGION_MODEL_TIMEOUT_MS,
        generation: { temperature: 0, maxOutputTokens: 1_024 },
      } as const;
      const recoveryResult = isNpcRecovery
        ? await modelRuntime.generate({
            prompt: recoveryPrompt,
            output: {
              kind: "structured",
              schemaId: "starting-region.npcs.compact-recovery.v1",
              schema: compactNpcRecoverySchema,
            },
            trace: recoveryTrace,
          }, recoveryOptions)
        : await modelRuntime.generate({
            prompt: recoveryPrompt,
            output: {
              kind: "structured",
              schemaId: "starting-region.institutions.compact-recovery.v1",
              schema: compactInstitutionRecoverySchema,
            },
            trace: recoveryTrace,
          }, recoveryOptions);
      if (recoveryResult.ok) {
        return isNpcRecovery
          ? expandNpcProposals(recoveryResult.output.value, context)
          : expandCompactInstitutionProposals(recoveryResult.output.value, context);
      }
      if (
        recoveryResult.error.candidate !== undefined
      ) {
        try {
          return isNpcRecovery
            ? expandNpcProposals(recoveryResult.error.candidate, context)
            : expandCompactInstitutionProposals(recoveryResult.error.candidate, context);
        } catch {
          // Fall through to the deterministic minimal record below.
        }
      }
      if (reachedStructuredOutputTokenLimit(recoveryResult.error)) {
        return isNpcRecovery
          ? expandNpcProposals([], context)
          : expandCompactInstitutionProposals([], context);
      }
      const recoveryDiagnostic = recoveryResult.error.diagnostic
        ? `: ${recoveryResult.error.diagnostic}`
        : "";
      throw new Error(
        `Starting-region ${stageId} compact recovery failed: ${recoveryResult.error.message}${recoveryDiagnostic}`,
      );
    }
    if (!result.ok) {
      if (
        result.error.kind === "invalid-output" &&
        result.error.candidate !== undefined
      ) {
        if (["player-context", "npcs", "pressures"].includes(stageId)) {
          try {
            if (stageId === "player-context") {
              return expandPlayerContextProposal(result.error.candidate, context);
            }
            if (stageId === "npcs") {
              return expandNpcProposals(result.error.candidate, context);
            }
            return expandPressureProposal(result.error.candidate, context);
          } catch (error) {
            throw new Error(
              `Starting-region ${stageId} compact output could not be normalized: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        if (stageId === "opening-situation") {
          return normalizeOpeningSituationCandidate(result.error.candidate, context);
        }
        return result.error.candidate;
      }
      const diagnostic = result.error.diagnostic
        ? `: ${result.error.diagnostic}`
        : "";
      throw new Error(
        `Starting-region ${stageId} model failure: ${result.error.message}${diagnostic}`,
      );
    }
    if (stageId === "player-context") {
      return expandPlayerContextProposal(result.output.value, context);
    }
    if (stageId === "npcs") {
      return expandNpcProposals(result.output.value, context);
    }
    if (stageId === "pressures") {
      return expandPressureProposal(result.output.value, context);
    }
    if (stageId === "opening-situation") {
      return normalizeOpeningSituationCandidate(result.output.value, context);
    }
    return result.output.value;
  };
  return {
    propose(stageId, context) {
      return invoke(stageId, context);
    },
    repair(stageId, candidate, issues, context) {
      return invoke(stageId, context, { candidate, issues });
    },
    async audit(seed, context) {
      const auditView = {
        normalizedConstraints: {
          explicitConstraints: seed.normalized.explicitConstraints,
          player: seed.normalized.player,
        },
        region: seed.region,
        settlement: seed.settlement,
        institutions: seed.institutions,
        locality: seed.locality,
        playerContext: {
          entity: seed.playerContext.entity,
          homeLocationId: seed.playerContext.homeLocationId,
          routineLocationIds: seed.playerContext.routineLocationIds,
          accessEntityIds: seed.playerContext.accessEntityIds,
          currentObligations: seed.playerContext.currentObligations,
          ordinaryPressures: seed.playerContext.ordinaryPressures,
        },
        npcs: seed.npcs.map((npc) => ({
          entity: npc.entity,
          simulationReasons: npc.simulationReasons,
          goals: npc.socialState.goals,
          relationships: npc.socialState.relationships,
          memories: npc.socialState.memories,
        })),
        pressures: seed.pressures,
        creatures: seed.creatures,
        knowledge: seed.knowledge,
        processes: seed.processes,
        openingSituation: seed.openingSituation,
      };
      const result = await modelRuntime.generate({
        prompt: {
          instructions: [
            "Audit the generated starting region for contradictions, missing required foundations, and accidental retcons.",
            "Return advisory warnings only; deterministic validation, not this model audit, decides whether generation may complete.",
            "Do not require every player biography fact, appearance detail, hobby, or online activity to be mirrored by a town location, institution, or NPC.",
            "A cultural tendency toward superstition is compatible with low current supernatural activity and is not itself a contradiction.",
            "Do not report multiple phrasings of the same concern. Do not rewrite the region in this step.",
            "Return no more than five material issues. Return an empty issues array when the compact seed is coherent.",
          ],
          context: JSON.stringify({ seed: auditView, request: context.request }),
          input: "Audit the complete generated starting region.",
        },
        output: { kind: "structured", schemaId: "starting-region.coherence-audit.v1", schema: coherenceAuditSchema },
        trace: { operation: "starting-region-generation", invocationId: "starting-region.coherence-audit" },
      }, {
        timeoutMs: STARTING_REGION_MODEL_TIMEOUT_MS,
        generation: { temperature: 0, maxOutputTokens: 1_024 },
      });
      if (!result.ok) throw new Error(`Starting-region audit model failure: ${result.error.message}`);
      return result.output.value;
    },
  };
}

export interface StartingRegionWorkingState {
  readonly request: StartingRegionRequest;
  readonly compactVersion?: 2;
  readonly compactSeed?: unknown;
  readonly normalized?: NormalizedRegionConstraints;
  readonly region?: RegionalFrame;
  readonly settlement?: SettlementSeed;
  readonly institutions?: readonly InstitutionSeed[];
  readonly locality?: StartingLocality;
  readonly playerContext?: PlayerContextSeed;
  readonly npcs?: readonly PersistentNpcSeed[];
  readonly pressures?: readonly PressureSeed[];
  readonly creatures?: readonly CreatureSeed[];
  readonly knowledge?: KnowledgeSeed;
  readonly processes?: readonly ActiveProcessSeed[];
  readonly openingSituation?: OpeningSituation;
}

export const startingRegionWorkingStateSchema = z.object({
  request: startingRegionRequestSchema,
  compactVersion: z.literal(2).optional(),
  compactSeed: z.unknown().optional(),
  normalized: normalizedRegionConstraintsSchema.optional(),
  region: regionalFrameSchema.optional(),
  settlement: settlementSeedSchema.optional(),
  institutions: z.array(institutionSeedSchema).optional(),
  locality: startingLocalitySchema.optional(),
  playerContext: playerContextSeedSchema.optional(),
  npcs: z.array(persistentNpcSeedSchema).optional(),
  pressures: z.array(pressureSeedSchema).optional(),
  creatures: z.array(creatureSeedSchema).optional(),
  knowledge: knowledgeSeedSchema.optional(),
  processes: z.array(activeProcessSeedSchema).optional(),
  openingSituation: openingSituationSchema.optional(),
}).strict();

export interface StartingRegionGenerationCheckpoint {
  readonly lastCompletedStageId: string;
  readonly state: StartingRegionWorkingState;
  readonly diagnostics: readonly GenerationStageDiagnostic[];
}

export interface StartingRegionGenerationOptions {
  readonly resumeState?: StartingRegionWorkingState;
  readonly previousDiagnostics?: readonly GenerationStageDiagnostic[];
  readonly onCheckpoint?: (
    checkpoint: StartingRegionGenerationCheckpoint,
  ) => Promise<void> | void;
}

function repairLegacyGeneratedScopeReferences(
  state: StartingRegionWorkingState,
): StartingRegionWorkingState {
  if (!state.region || !state.settlement || !state.locality || !state.pressures) {
    return state;
  }
  const legacyScopes = new Map([
    ["starting-region.region.v1", `scope.${state.region.id}`],
    ["starting-region.settlement.v1", `scope.${state.settlement.id}`],
    ["starting-region.locality.v1", `scope.${state.locality.id}`],
  ]);
  let changed = false;
  const pressures = state.pressures.map((pressure) => {
    const scopeId = legacyScopes.get(pressure.scopeId);
    if (!scopeId) return pressure;
    changed = true;
    return pressureSeedSchema.parse({ ...pressure, scopeId });
  });
  const scopeByPressureId = new Map(pressures.map((pressure) => [
    pressure.id,
    pressure.scopeId,
  ]));
  const processes = state.processes?.map((process) => {
    const scopeId = legacyScopes.get(process.scopeId) ??
      scopeByPressureId.get(process.pressureId);
    if (!scopeId || scopeId === process.scopeId) return process;
    changed = true;
    return activeProcessSeedSchema.parse({ ...process, scopeId });
  });
  return changed ? mergeState(state, { pressures, processes }) : state;
}

const playerWorkplaceAnchors = [
  { pattern: /\b(?:clothing|apparel) (?:store|shop)\b/i, term: "clothing", name: "Local Clothing Store", slug: "clothing-store" },
  { pattern: /\bgrocery (?:store|shop)\b/i, term: "grocery", name: "Local Grocery Store", slug: "grocery-store" },
  { pattern: /\b(?:restaurant|cafe|coffee shop)\b/i, term: "restaurant", name: "Local Restaurant", slug: "restaurant" },
  { pattern: /\b(?:factory|plant)\b/i, term: "plant", name: "Local Plant", slug: "plant" },
  { pattern: /\b(?:clinic|hospital)\b/i, term: "clinic", name: "Local Clinic", slug: "clinic" },
  { pattern: /\bwarehouse\b/i, term: "warehouse", name: "Local Warehouse", slug: "warehouse" },
  { pattern: /\b(?:school|college|university)\b/i, term: "school", name: "Local School", slug: "school" },
  { pattern: /\b(?:office|library|hotel|salon|garage|farm)\b/i, term: "work", name: "Local Workplace", slug: "workplace" },
] as const;

export function ensurePlayerRoutineAnchors(
  state: StartingRegionWorkingState,
): StartingRegionWorkingState {
  if (!state.normalized || !state.locality || !state.playerContext) return state;
  let locality = state.locality;
  let playerContext = state.playerContext;
  const factText = state.normalized.player.establishedFacts.map((fact) => ({
    fact,
    text: `${fact.statement} ${fact.sourceText}`,
  }));
  const anchors = playerWorkplaceAnchors.flatMap((anchor) => {
    const matched = factText.find(({ text }) => anchor.pattern.test(text));
    return matched ? [{ ...anchor, fact: matched.fact }] : [];
  }).slice(0, 2);

  for (const anchor of anchors) {
    const alreadyGrounded = locality.locations.some((location) =>
      anchor.pattern.test(`${location.name} ${location.summary}`)
    );
    if (alreadyGrounded) continue;
    const baseId = `${locality.id}.player-${anchor.slug}`;
    const locationId = locality.locations.some((location) => location.id === baseId)
      ? `${baseId}-2`
      : baseId;
    const location = entitySchema.parse({
      id: locationId,
      kind: "location",
      name: anchor.name,
      summary: `${anchor.name} grounds the player's established routine: ${anchor.fact.statement}.`,
      data: {
        "player-routine-anchor": true,
        generationProvenance: {
          class: "player-established",
          sourceIds: [anchor.fact.id],
          rationale: "Minimal location required to ground an explicit physical workplace.",
        },
      },
    });
    const routeFromId = locality.locations.some((item) =>
        item.id === playerContext.homeLocationId
      )
      ? playerContext.homeLocationId
      : locality.locations[0]!.id;
    locality = startingLocalitySchema.parse({
      ...locality,
      locations: [...locality.locations, location],
      routes: [...locality.routes, {
        fromId: routeFromId,
        toId: locationId,
        summary: `An ordinary local route connects ${anchor.name} to the player's existing routine.`,
      }],
      ordinaryWeekCoverage: [
        ...locality.ordinaryWeekCoverage,
        `work at ${anchor.name}`,
      ],
    });
    playerContext = playerContextSeedSchema.parse({
      ...playerContext,
      routineLocationIds: [...new Set([...playerContext.routineLocationIds, locationId])],
      accessEntityIds: [...new Set([...playerContext.accessEntityIds, locationId])],
      currentObligations: [...new Set([
        ...playerContext.currentObligations,
        `Work shifts at ${anchor.name}.`,
      ])],
    });
  }
  return locality === state.locality && playerContext === state.playerContext
    ? state
    : mergeState(state, { locality, playerContext });
}

export interface StartingRegionSeed {
  readonly normalized: NormalizedRegionConstraints;
  readonly region: RegionalFrame;
  readonly settlement: SettlementSeed;
  readonly institutions: readonly InstitutionSeed[];
  readonly locality: StartingLocality;
  readonly playerContext: PlayerContextSeed;
  readonly npcs: readonly PersistentNpcSeed[];
  readonly pressures: readonly PressureSeed[];
  readonly creatures: readonly CreatureSeed[];
  readonly knowledge: KnowledgeSeed;
  readonly processes: readonly ActiveProcessSeed[];
  readonly openingSituation: OpeningSituation;
}

export const startingRegionSeedSchema = z.object({
  normalized: normalizedRegionConstraintsSchema,
  region: regionalFrameSchema,
  settlement: settlementSeedSchema,
  institutions: z.array(institutionSeedSchema),
  locality: startingLocalitySchema,
  playerContext: playerContextSeedSchema,
  npcs: z.array(persistentNpcSeedSchema),
  pressures: z.array(pressureSeedSchema),
  creatures: z.array(creatureSeedSchema),
  knowledge: knowledgeSeedSchema,
  processes: z.array(activeProcessSeedSchema),
  openingSituation: openingSituationSchema,
}).strict();

/**
 * Repairs the narrow legacy/creature-opening case where an accepted pressure
 * stage produced no usable near-term creature. Mundane and non-creature
 * supernatural openings must not manufacture a creature merely to satisfy the
 * old incident contract.
 */
export function ensureOpeningCreature(
  seed: StartingRegionSeed,
): StartingRegionSeed {
  if (
    seed.openingSituation.openingMode !== "supernatural-inciting-incident" ||
    seed.openingSituation.supernaturalFocus !== "creature"
  ) {
    return seed;
  }
  if (seed.creatures.some((creature) =>
    creature.nearTermPlayerFacing && creature.threatEnvelope
  )) {
    return seed;
  }

  const pressure = seed.pressures.find((item) => item.category === "supernatural") ??
    seed.pressures[0];
  if (!pressure) {
    throw new Error(
      "Starting region cannot supply an opening creature because it has no developing pressures",
    );
  }
  const existingIds = entityIds(seed);
  const baseId = "generated.creature.opening-anomaly";
  let entityId = baseId;
  let suffix = 2;
  while (existingIds.has(entityId)) entityId = `${baseId}-${suffix++}`;

  const creature = creatureSeedSchema.parse({
    entity: {
      id: entityId,
      kind: "creature",
      name: "Emergent Magical Creature",
      summary: `A newly emerged magical creature manifests the developing pressure: ${pressure.summary}`,
      data: {},
    },
    origin: "spontaneous-magical-generation",
    morphology: "an unfamiliar animal-like form with one visible magical alteration",
    behavior: "cautious and reactive rather than indiscriminately aggressive",
    corePrinciple: "expresses one consistent, observable magical effect",
    observedTraits: [
      "an unfamiliar animal-like silhouette",
      "a localized magical anomaly that intensifies before it acts",
    ],
    nearTermPlayerFacing: true,
    threatEnvelope: {
      challengeBand: "Hard",
      overallThreat: "Dangerous but observable, avoidable, and vulnerable to informed counterplay.",
      offensivePressure: 0.6,
      survivability: 0.55,
      mobilityReach: 0.7,
      controlDenial: 0.45,
      sensoryInformation: 0.55,
      multiTargetPressure: 0.3,
      resourcePressure: 0.5,
      hardCounterRisks: [],
      requiredSignatureCapabilities: ["one consistent localized magical effect"],
      requiredTells: ["the surrounding anomaly intensifies before it acts"],
      requiredCounterplay: ["recognize the tell and interrupt or avoid the effect"],
      allowedGrowthRange: "May develop through simulation and survival, never hidden party scaling.",
    },
    provenance: {
      class: "setting-derived",
      sourceIds: [pressure.id, "setting.awakening-earth"],
      rationale: "Minimal canonical creature required to realize the accepted supernatural pressure in near-term play.",
    },
  });
  return startingRegionSeedSchema.parse({
    ...seed,
    creatures: [...seed.creatures, creature],
  });
}

function graphConnected(locality: StartingLocality): boolean {
  const ids = locality.locations.map((location) => location.id);
  const visited = new Set<string>();
  const pending = ids.length ? [ids[0]!] : [];
  while (pending.length) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const route of locality.routes) {
      if (route.fromId === current && !visited.has(route.toId)) pending.push(route.toId);
      if (route.toId === current && !visited.has(route.fromId)) pending.push(route.fromId);
    }
  }
  return ids.every((id) => visited.has(id));
}

const modernInfrastructurePattern =
  /\b(?:asphalt|broadband|bus|buses|car|cars|cell(?:ular)?|clinic|delivery|electric(?:al|ity)?|grid|hospital|internet|interstate|modern|paved|pharmacy|rail|school bus|state route|supermarket|truck|trucks|utilities|utility)\b/i;

function hasModernInfrastructureEvidence(value: unknown): boolean {
  return modernInfrastructurePattern.test(JSON.stringify(value));
}

export function normalizePlayerEstablishedFacts(
  candidate: unknown,
  state: Readonly<StartingRegionWorkingState>,
): NormalizedRegionConstraints {
  const normalized = normalizedRegionConstraintsSchema.parse(candidate);
  if (!state.request.allowGeneratedDetails) return normalized;
  return normalizedRegionConstraintsSchema.parse({
    ...normalized,
    player: {
      ...normalized.player,
      establishedFacts: normalized.player.establishedFacts.filter((fact) =>
        sourceContainsQuotedText(state.request.player.description, fact.sourceText)
      ),
    },
  });
}

export function stageIssues(
  stageId: string,
  candidate: unknown,
  state: Readonly<StartingRegionWorkingState>,
): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  const add = (
    code: string,
    message: string,
    path: Array<string | number>,
    repairHint?: string,
  ) => issues.push(generationIssueSchema.parse({
    code,
    severity: "error",
    message,
    path,
    ...(repairHint ? { repairHint } : {}),
  }));

  if (stageId === "normalize") {
    const normalized = normalizePlayerEstablishedFacts(candidate, state);
    for (const constraint of normalized.explicitConstraints) {
      if (!sourceContainsQuotedText(
        state.request.locationDescription,
        constraint.sourceText,
      )) {
        add(
          "generation.player-constraint-source",
          `Explicit constraint ${constraint.id} is not grounded in the player's location input.`,
          ["explicitConstraints"],
          "Set sourceText to an exact quotation from request.locationDescription, not a field name or paraphrase.",
        );
      }
    }
    validateNormalizedPlayerSetup(state.request.player, normalized.player);
  } else if (stageId === "settlement") {
    const settlement = settlementSeedSchema.parse(candidate);
    if (!hasModernInfrastructureEvidence(settlement)) {
      add(
        "generation.setting.modern-baseline",
        "The settlement does not visibly preserve Awakening Earth's contemporary modern infrastructure.",
        ["transportation"],
        "Add concise evidence of ordinary present-day transport, utilities, communications, commerce, or public services. Rural or traditional does not mean preindustrial.",
      );
    }
  } else if (stageId === "locality") {
    const locality = startingLocalitySchema.parse(candidate);
    const ids = new Set(locality.locations.map((location) => location.id));
    for (const route of locality.routes) {
      if (!ids.has(route.fromId) || !ids.has(route.toId)) {
        add(
          "generation.locality.route-reference",
          `Route references a location outside the starting locality.`,
          ["routes"],
        );
      }
    }
    if (!graphConnected(locality)) {
      add(
        "generation.locality.disconnected",
        "The detailed starting locality must be connected.",
        ["routes"],
        "Repair routes without regenerating unrelated locality content.",
      );
    }
    if (!hasModernInfrastructureEvidence(locality)) {
      add(
        "generation.setting.modern-baseline",
        "The starting locality does not visibly preserve Awakening Earth's contemporary modern infrastructure.",
        ["locations"],
        "Ground the locality in ordinary present-day roads, vehicles, utilities, communications, businesses, or public services without expanding it unnecessarily.",
      );
    }
  } else if (stageId === "player-context") {
    const player = playerContextSeedSchema.parse(candidate);
    if (player.entity.kind !== "actor" || player.socialState.actorId !== player.entity.id) {
      add(
        "generation.player-context.actor-mismatch",
        "Player entity and player social state must describe the same actor.",
        ["socialState", "actorId"],
      );
    }
    const allowedFactIds = new Set(
      [
        "player.input",
        ...(state.normalized?.player.establishedFacts.map((fact) => fact.id) ?? []),
      ],
    );
    issues.push(...startingHumanGenerationIssues(player.mechanics, allowedFactIds));
  } else if (stageId === "npcs") {
    const npcs = z.array(persistentNpcSeedSchema).parse(candidate);
    for (const npc of npcs) {
      if (npc.entity.kind !== "actor" || npc.socialState.actorId !== npc.entity.id) {
        add(
          "generation.npc.actor-mismatch",
          `NPC ${npc.entity.id} social state does not match its entity.`,
          ["npcs"],
        );
      }
    }
  } else if (stageId === "pressures") {
    const bundle = pressureKnowledgeProcessSchema.parse(candidate);
    const categories = new Set(bundle.pressures.map((pressure) => pressure.category));
    for (const category of ["ordinary", "social-institutional", "supernatural"] as const) {
      if (!categories.has(category)) {
        add(
          "generation.pressure.missing-category",
          `Starting pressures need at least one ${category} concern.`,
          ["pressures"],
        );
      }
    }
  } else if (stageId === "opening-situation") {
    const opening = openingSituationSchema.parse(candidate);
    const availableIds = new Set([
      state.region?.id,
      state.settlement?.id,
      state.locality?.id,
      ...(state.locality?.locations.map((item) => item.id) ?? []),
      ...(state.institutions?.map((item) => item.entity.id) ?? []),
      state.playerContext?.entity.id,
      ...(state.npcs?.map((item) => item.entity.id) ?? []),
      ...(state.creatures?.map((item) => item.entity.id) ?? []),
      ...(state.pressures?.map((item) => item.id) ?? []),
    ].filter((id): id is string => Boolean(id)));
    for (const anchorId of opening.ordinaryAnchorEntityIds) {
      if (!availableIds.has(anchorId)) {
        add(
          "generation.opening.missing-anchor",
          `Opening situation references missing ordinary anchor ${anchorId}.`,
          ["ordinaryAnchorEntityIds"],
        );
      }
    }
  }
  return issues;
}

function makeStage(
  id: string,
  schema: z.ZodType<unknown>,
  accept: (
    state: StartingRegionWorkingState,
    candidate: unknown,
  ) => StartingRegionWorkingState,
  model: StartingRegionProposalModel,
): GenerationStage<StartingRegionWorkingState, unknown> {
  return {
    id,
    ...(["player-context", "npcs", "pressures", "opening-situation"].includes(id)
      ? { maxRepairPasses: 0 }
      : {}),
    candidateSchema: schema,
    generate: (state) => model.propose(id, state),
    validate: (candidate, state) => stageIssues(id, candidate, state),
    repair: (candidate, issues, state) =>
      model.repair(id, candidate, issues, state),
    accept,
  };
}

function requireSeed(state: StartingRegionWorkingState): StartingRegionSeed {
  if (
    !state.normalized ||
    !state.region ||
    !state.settlement ||
    !state.institutions ||
    !state.locality ||
    !state.playerContext ||
    !state.npcs ||
    !state.pressures ||
    !state.creatures ||
    !state.knowledge ||
    !state.processes ||
    !state.openingSituation
  ) {
    throw new Error("Starting region generation is incomplete");
  }
  return {
    normalized: state.normalized,
    region: state.region,
    settlement: state.settlement,
    institutions: state.institutions,
    locality: state.locality,
    playerContext: state.playerContext,
    npcs: state.npcs,
    pressures: state.pressures,
    creatures: state.creatures,
    knowledge: state.knowledge,
    processes: state.processes,
    openingSituation: state.openingSituation,
  };
}

/**
 * Repairs model-generated collisions between the three nested geographic IDs.
 *
 * These records describe different scopes even when the model gives all of them
 * the same place-derived ID. Keep the first usable ID, allocate deterministic
 * type-prefixed IDs for collisions, and rewrite references according to the
 * kind of record that owns the reference.
 */
export function ensureUniqueStartingRegionIds(
  seed: StartingRegionSeed,
): StartingRegionSeed {
  const reservedIds = new Set([
    ...seed.locality.locations.map((item) => item.id),
    ...seed.institutions.map((item) => item.entity.id),
    seed.playerContext.entity.id,
    ...seed.npcs.map((item) => item.entity.id),
    ...seed.creatures.map((item) => item.entity.id),
    ...seed.pressures.map((item) => item.id),
  ]);
  const allocateId = (
    preferredId: string,
    prefix: "region" | "settlement" | "locality",
    name: string,
  ): string => {
    if (!reservedIds.has(preferredId)) {
      reservedIds.add(preferredId);
      return preferredId;
    }
    const base = `generated.${prefix}.${stableGeneratedSlug(name, prefix)}`;
    let candidate = base;
    let suffix = 2;
    while (reservedIds.has(candidate)) candidate = `${base}-${suffix++}`;
    reservedIds.add(candidate);
    return candidate;
  };

  const original = {
    region: seed.region.id,
    settlement: seed.settlement.id,
    locality: seed.locality.id,
  };
  const assigned = {
    region: allocateId(original.region, "region", seed.region.name),
    settlement: allocateId(original.settlement, "settlement", seed.settlement.name),
    locality: allocateId(original.locality, "locality", seed.locality.name),
  };
  if (
    assigned.region === original.region &&
    assigned.settlement === original.settlement &&
    assigned.locality === original.locality
  ) return seed;

  const referenceFor = (
    value: string,
    preference: readonly (keyof typeof original)[],
  ): string => {
    for (const kind of preference) {
      if (value === original[kind]) return assigned[kind];
    }
    return value;
  };
  const scopeForPressure = (pressure: PressureSeed): string => {
    const unscoped = pressure.scopeId.startsWith("scope.")
      ? pressure.scopeId.slice("scope.".length)
      : pressure.scopeId;
    const preference: readonly (keyof typeof original)[] =
      pressure.category === "ordinary"
        ? ["locality", "settlement", "region"]
        : pressure.category === "social-institutional"
          ? ["settlement", "locality", "region"]
          : ["region", "settlement", "locality"];
    const remapped = referenceFor(unscoped, preference);
    return remapped === unscoped ? pressure.scopeId : `scope.${remapped}`;
  };
  const pressures = seed.pressures.map((pressure) => pressureSeedSchema.parse({
    ...pressure,
    scopeId: scopeForPressure(pressure),
  }));
  const scopeByPressureId = new Map(pressures.map((pressure) => [
    pressure.id,
    pressure.scopeId,
  ]));

  return startingRegionSeedSchema.parse({
    ...seed,
    region: { ...seed.region, id: assigned.region },
    settlement: { ...seed.settlement, id: assigned.settlement },
    locality: { ...seed.locality, id: assigned.locality },
    institutions: seed.institutions.map((institution) => ({
      ...institution,
      serviceAreaEntityId: referenceFor(institution.serviceAreaEntityId, [
        "settlement", "region", "locality",
      ]),
    })),
    playerContext: {
      ...seed.playerContext,
      homeLocationId: referenceFor(seed.playerContext.homeLocationId, [
        "locality", "settlement", "region",
      ]),
      routineLocationIds: seed.playerContext.routineLocationIds.map((id) =>
        referenceFor(id, ["locality", "settlement", "region"])
      ),
      accessEntityIds: seed.playerContext.accessEntityIds.map((id) =>
        referenceFor(id, ["locality", "settlement", "region"])
      ),
    },
    pressures,
    processes: seed.processes.map((process) => ({
      ...process,
      scopeId: scopeByPressureId.get(process.pressureId) ?? process.scopeId,
    })),
    openingSituation: {
      ...seed.openingSituation,
      ordinaryAnchorEntityIds: seed.openingSituation.ordinaryAnchorEntityIds.map((id) =>
        referenceFor(id, ["locality", "settlement", "region"])
      ),
    },
  });
}

function entityIds(seed: StartingRegionSeed): Set<string> {
  return new Set([
    seed.region.id,
    seed.settlement.id,
    seed.locality.id,
    ...seed.locality.locations.map((item) => item.id),
    ...seed.institutions.map((item) => item.entity.id),
    seed.playerContext.entity.id,
    ...seed.npcs.map((item) => item.entity.id),
    ...seed.creatures.map((item) => item.entity.id),
    ...seed.pressures.map((item) => item.id),
  ]);
}

export function validateStartingRegionSeed(
  seed: StartingRegionSeed,
): readonly GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  const ids = entityIds(seed);
  const all = [...ids];
  const expectedCount =
    3 +
    seed.locality.locations.length +
    seed.institutions.length +
    1 +
    seed.npcs.length +
    seed.creatures.length +
    seed.pressures.length;
  if (all.length !== expectedCount) {
    issues.push(generationIssueSchema.parse({
      code: "generation.ids.duplicate",
      severity: "error",
      message: "Generated campaign records contain duplicate entity IDs.",
      path: [],
    }));
  }
  for (const institution of seed.institutions) {
    if (!ids.has(institution.serviceAreaEntityId)) {
      issues.push(generationIssueSchema.parse({
        code: "generation.institution.service-area",
        severity: "error",
        message:
          `Institution ${institution.entity.id} references missing service area ${institution.serviceAreaEntityId}.`,
        path: ["institutions"],
      }));
    }
  }
  for (const [label, referenceId] of [
    ["home location", seed.playerContext.homeLocationId],
    ...seed.playerContext.routineLocationIds.map((id) => ["routine location", id]),
    ...seed.playerContext.accessEntityIds.map((id) => ["access entity", id]),
  ] as const) {
    if (!ids.has(referenceId)) {
      issues.push(generationIssueSchema.parse({
        code: "generation.player-context.reference",
        severity: "error",
        message: `Player ${label} references missing entity ${referenceId}.`,
        path: ["playerContext"],
      }));
    }
  }
  const scopeIds = new Set([
    `scope.${seed.region.id}`,
    `scope.${seed.settlement.id}`,
    `scope.${seed.locality.id}`,
  ]);
  for (const pressure of seed.pressures) {
    if (!scopeIds.has(pressure.scopeId)) {
      issues.push(generationIssueSchema.parse({
        code: "generation.pressure.scope-reference",
        severity: "error",
        message: `Pressure ${pressure.id} references missing scope ${pressure.scopeId}.`,
        path: ["pressures"],
      }));
    }
    for (const actorId of pressure.actorEntityIds) {
      if (!ids.has(actorId)) {
        issues.push(generationIssueSchema.parse({
          code: "generation.pressure.actor-reference",
          severity: "error",
          message: `Pressure ${pressure.id} references missing actor ${actorId}.`,
          path: ["pressures"],
        }));
      }
    }
  }
  const pressureIds = new Set(seed.pressures.map((pressure) => pressure.id));
  const processIds = new Set<string>();
  for (const process of seed.processes) {
    if (processIds.has(process.id)) {
      issues.push(generationIssueSchema.parse({
        code: "generation.process.duplicate-id",
        severity: "error",
        message: `Generated process ID is duplicated: ${process.id}.`,
        path: ["processes"],
      }));
    }
    processIds.add(process.id);
    if (!pressureIds.has(process.pressureId)) {
      issues.push(generationIssueSchema.parse({
        code: "generation.process.pressure-reference",
        severity: "error",
        message: `Process ${process.id} references missing pressure ${process.pressureId}.`,
        path: ["processes"],
      }));
    }
    if (!scopeIds.has(process.scopeId)) {
      issues.push(generationIssueSchema.parse({
        code: "generation.process.scope-reference",
        severity: "error",
        message: `Process ${process.id} references missing scope ${process.scopeId}.`,
        path: ["processes"],
      }));
    }
  }
  for (const anchorId of seed.openingSituation.ordinaryAnchorEntityIds) {
    if (!ids.has(anchorId)) {
      issues.push(generationIssueSchema.parse({
        code: "generation.opening.missing-anchor",
        severity: "error",
        message: `Opening situation references missing ordinary anchor ${anchorId}.`,
        path: ["openingSituation", "ordinaryAnchorEntityIds"],
      }));
    }
  }
  return issues;
}

function pressureEntity(pressure: PressureSeed): Entity {
  return entitySchema.parse({
    id: pressure.id,
    kind: "pressure",
    name: pressure.summary,
    summary: pressure.currentState,
    data: {
      category: pressure.category,
      cause: pressure.cause,
      likelyTrajectory: pressure.likelyTrajectory,
      scopeId: pressure.scopeId,
      changeConditions: pressure.changeConditions,
      "process-value": 0,
      generationProvenance: pressure.provenance,
    },
  });
}

function seedEntity(
  id: string,
  kind: string,
  name: string,
  summary: string,
  data: Record<string, JsonValue>,
): Entity {
  return entitySchema.parse({ id, kind, name, summary, data });
}

const processAdvancedPayloadSchema = z.object({
  processId: stableIdSchema,
  pressureId: stableIdSchema,
  delta: z.number().finite(),
}).strict();

export const generatedProcessAdvancedEventType: EventTypeDefinition<
  z.infer<typeof processAdvancedPayloadSchema>
> = {
  type: "campaign.generated-process-advanced",
  schemaVersion: 1,
  payloadSchema: processAdvancedPayloadSchema,
};

function generatedWorldSimulation(
  seed: StartingRegionSeed,
): WorldSimulationContribution {
  const scopes = [
    {
      id: `scope.${seed.region.id}`,
      kind: "campaign-region",
      dependencyScopeIds: [],
    },
    {
      id: `scope.${seed.settlement.id}`,
      kind: "campaign-settlement",
      parentScopeId: `scope.${seed.region.id}`,
      dependencyScopeIds: [],
    },
    {
      id: `scope.${seed.locality.id}`,
      kind: "campaign-locality",
      parentScopeId: `scope.${seed.settlement.id}`,
      dependencyScopeIds: [],
    },
  ];
  const processes: WorldProcessDefinition[] = seed.processes.map((descriptor) => ({
    metadata: {
      id: descriptor.id,
      version: "0.1.0",
      description: descriptor.summary,
      kind: "deterministic",
      scopeKinds: ["campaign-region", "campaign-settlement", "campaign-locality"],
      dependencies: [],
      eventInterests: [],
      scheduledTriggerTypes: [],
    },
    selectRelevantState({ scopeId, world }) {
      if (scopeId !== descriptor.scopeId) {
        return jsonValueSchema.parse({ active: false });
      }
      const pressure = world.entities.find((entity) => entity.id === descriptor.pressureId);
      return jsonValueSchema.parse({
        active: true,
        processValue:
          typeof pressure?.data["process-value"] === "number"
            ? pressure.data["process-value"]
            : 0,
      });
    },
    runCatchUp(input) {
      const selected = input.relevantState as {
        readonly active?: boolean;
        readonly processValue?: number;
      };
      if (!selected.active) {
        return {
          workUnits: 0,
          mutations: [],
          events: [],
          processedScheduledTriggerIds: [],
          cancelScheduledTriggerIds: [],
          schedule: [],
          diagnostics: jsonValueSchema.parse({ skipped: true }),
        };
      }
      const days = input.elapsedDurationMs / fictionalDurationMs(24 * 60 * 60 * 1000);
      const delta = descriptor.changePerDay * days;
      const nextValue = (selected.processValue ?? 0) + delta;
      return {
        workUnits: 1,
        mutations: [{
          kind: "set-entity-data",
          entityId: descriptor.pressureId,
          key: "process-value",
          value: nextValue,
        }],
        events: delta === 0 ? [] : [{
          type: "campaign.generated-process-advanced",
          schemaVersion: 1,
          summary: descriptor.summary,
          relatedEntityIds: [descriptor.pressureId],
          scopeIds: [descriptor.scopeId],
          causedByEventIds: [],
          origin: {
            kind: "world-process",
            id: descriptor.id,
          },
          payload: {
            processId: descriptor.id,
            pressureId: descriptor.pressureId,
            delta,
          },
          access: "gm-only",
        }],
        processedScheduledTriggerIds: [],
        cancelScheduledTriggerIds: [],
        schedule: [],
        diagnostics: jsonValueSchema.parse({
          delta,
          elapsedDurationMs: input.elapsedDurationMs,
        }),
      };
    },
  }));
  return { scopes, processes };
}

function initialMechanicalRealizations(
  seed: StartingRegionSeed,
  startTime: string,
): MechanicalRealization[] {
  const playerConstraints = seed.normalized.player.establishedFacts.map((fact) => ({
    id: `constraint.${seed.playerContext.entity.id}.${fact.id}`,
    sourceKind: "player-established" as const,
    sourceId: fact.id,
    summary: fact.statement,
  }));
  const player: MechanicalRealization = mechanicalRealizationSchema.parse({
    entityId: seed.playerContext.entity.id,
    level: "complete",
    constraints: playerConstraints,
    history: [{
      id: `realization.${seed.playerContext.entity.id}.initial`,
      occurredAt: startTime,
      fromLevel: "unrealized",
      toLevel: "complete",
      sourceComponent: { id: "reference-rules", version: "0.3.0" },
      generatorVersion: "starting-region-v1",
      addedPaths: ["attributes", "skills", "stress", "statuses", "progression"],
      constraintIds: playerConstraints.map((constraint) => constraint.id),
      reason: "Generated mundane player mechanics from the established biography.",
    }],
  });
  const constrained = [
    ...seed.npcs.map((npc) => ({
      entityId: npc.entity.id,
      constraints: npc.mechanicallyRelevantConstraints.map((constraint) => ({
        id: constraint.id,
        sourceKind: "campaign" as const,
        sourceId: constraint.sourceId,
        summary: constraint.summary,
      })),
    })),
    ...seed.creatures.map((creature) => ({
      entityId: creature.entity.id,
      constraints: [{
        id: `constraint.${creature.entity.id}.concept`,
        sourceKind: "campaign" as const,
        sourceId: creature.entity.id,
        summary:
          `${creature.origin}; ${creature.morphology}; ${creature.corePrinciple}; ${creature.behavior}`,
      }, ...(creature.threatEnvelope ? [{
        id: `constraint.${creature.entity.id}.threat-envelope`,
        sourceKind: "threat-envelope" as const,
        sourceId: creature.entity.id,
        summary: JSON.stringify(creature.threatEnvelope),
      }] : [])],
    })),
  ].map(({ entityId, constraints }) =>
    mechanicalRealizationSchema.parse({
      entityId,
      level: "constrained",
      constraints,
      history: [{
        id: `realization.${entityId}.initial-constraints`,
        occurredAt: startTime,
        fromLevel: "unrealized",
        toLevel: "constrained",
        sourceComponent: { id: "reference-rules", version: "0.3.0" },
        generatorVersion: "starting-region-v1",
        addedPaths: [],
        constraintIds: constraints.map((constraint) => constraint.id),
        reason: "Recorded generated constraints before demand-driven mechanical realization.",
      }],
    })
  );
  return [player, ...constrained];
}

export function compileStartingRegionCampaign(
  request: StartingRegionRequest,
  seed: StartingRegionSeed,
  generationDiagnostics: readonly {
    readonly stageId: string;
    readonly attempts: number;
    readonly issues: readonly GenerationIssue[];
    readonly accepted: boolean;
  }[],
): Campaign {
  const player = clone(seed.playerContext.entity);
  player.data = {
    ...player.data,
    mechanics: jsonValueSchema.parse(seed.playerContext.mechanics.mechanics),
    currentLocation: seed.playerContext.homeLocationId,
    generationProvenance: seed.playerContext.provenance,
    context: {
      locationId: seed.playerContext.homeLocationId,
      category: "participant",
      prominence: "prominent",
      observable: true,
      activeParticipant: true,
      orchestratorVisible: true,
      knownBy: [{ kind: "actor", id: seed.playerContext.entity.id }],
      identities: [],
    },
  };
  const localityLocationIds = new Set(
    seed.locality.locations.map((location) => location.id),
  );
  const openingLocationId = seed.openingSituation.ordinaryAnchorEntityIds.find(
    (id) => localityLocationIds.has(id),
  ) ?? seed.playerContext.homeLocationId;
  const entities: Entity[] = [
    seedEntity(
      seed.region.id,
      "region",
      seed.region.name,
      seed.region.broadGeography,
      {
        climate: seed.region.climate,
        terrain: seed.region.terrain,
        settlementPattern: seed.region.settlementPattern,
        transportationConnectivity: seed.region.transportationConnectivity,
        economicContext: seed.region.economicContext,
        supernaturalPressureBaseline: seed.region.supernaturalPressureBaseline,
        gateHistory: seed.region.gateHistory,
        nearestPopulationCenters: seed.region.nearestPopulationCenters,
        generationProvenance: seed.region.provenance,
      },
    ),
    seedEntity(
      seed.settlement.id,
      "settlement",
      seed.settlement.name,
      seed.settlement.settlementType,
      {
        approximatePopulation: seed.settlement.approximatePopulation,
        economy: seed.settlement.economy,
        districts: seed.settlement.districts,
        transportation: seed.settlement.transportation,
        supernaturalHistory: seed.settlement.supernaturalHistory,
        institutionalCapacity: seed.settlement.institutionalCapacity,
        traits: seed.settlement.traits,
        generationProvenance: seed.settlement.provenance,
      },
    ),
    seedEntity(
      seed.locality.id,
      "locality",
      seed.locality.name,
      seed.locality.summary,
      {
        routes: seed.locality.routes,
        ordinaryWeekCoverage: seed.locality.ordinaryWeekCoverage,
        generationProvenance: seed.locality.provenance,
      },
    ),
    ...seed.locality.locations.map((entity) => ({
      ...clone(entity),
      data: {
        ...clone(entity.data),
        context: {
          locationId: entity.id,
          category: "feature",
          prominence: "prominent",
          observable: true,
          activeParticipant: false,
          orchestratorVisible: true,
          knownBy: [],
          identities: [],
        },
      },
    })),
    ...seed.institutions.map((institution) => ({
      ...clone(institution.entity),
      data: {
        ...clone(institution.entity.data),
        institutionType: institution.institutionType,
        serviceAreaEntityId: institution.serviceAreaEntityId,
        goals: institution.goals,
        capabilities: institution.capabilities,
        resources: institution.resources,
        constraints: institution.constraints,
        currentPressures: institution.currentPressures,
        generationProvenance: institution.provenance,
      },
    })),
    player,
    ...seed.npcs.map((npc) => {
      const currentLocation = npc.socialState.commitments
        .flatMap((commitment) => commitment.relatedEntityIds)
        .find((id) => localityLocationIds.has(id)) ?? openingLocationId;
      return {
        ...clone(npc.entity),
        data: {
          ...clone(npc.entity.data),
          currentLocation,
          simulationReasons: npc.simulationReasons,
          generationProvenance: npc.provenance,
          context: {
            locationId: currentLocation,
            category: "participant",
            prominence: "ambient",
            observable: true,
            activeParticipant: false,
            orchestratorVisible: true,
            knownBy: [{ kind: "actor", id: npc.entity.id }],
            identities: [],
          },
        },
      };
    }),
    ...seed.creatures.map((creature) => ({
      ...clone(creature.entity),
      data: {
        ...clone(creature.entity.data),
        origin: creature.origin,
        morphology: creature.morphology,
        behavior: creature.behavior,
        corePrinciple: creature.corePrinciple,
        observedTraits: creature.observedTraits,
        threatEnvelope: creature.threatEnvelope ?? null,
        generationProvenance: creature.provenance,
        context: {
          locationId: openingLocationId,
          category: "participant",
          prominence: "ambient",
          unrecognizedIdentity: "unidentified supernatural creature",
          observable: false,
          activeParticipant: false,
          orchestratorVisible: true,
          knownBy: [],
          identities: [],
          privilegedDetail: {
            corePrinciple: creature.corePrinciple,
            behavior: creature.behavior,
          },
        },
      },
    })),
    ...seed.pressures.map(pressureEntity),
  ];

  const content = emptyContentBundle();
  content.entities.push(...entities);
  content.facts.push(...seed.knowledge.facts);
  content.facts.push(...seed.locality.routes.map((route, index) => ({
    id: `generated.fact.route-${index + 1}`,
    subjectId: seed.locality.id,
    predicate: "location.route",
    value: {
      fromId: route.fromId,
      toId: route.toId,
      summary: route.summary,
      traversable: true,
      bidirectional: true,
    },
    visibility: "public" as const,
    tags: ["location", "route", "traversal"],
  })));
  content.beliefs.push(...seed.knowledge.beliefs.map((belief) => clone(belief)));

  return {
    identity: { id: request.campaignId, version: "0.1.0" },
    description:
      `Generated Awakening Earth campaign beginning in ${seed.settlement.name}.`,
    setting: { id: "awakening-earth", version: "0.2.0" },
    startTime: fictionalInstant(request.startTime),
    eventTypes: [generatedProcessAdvancedEventType],
    content,
    actorSocialStates: [
      clone(seed.playerContext.socialState),
      ...seed.npcs.map((npc) => clone(npc.socialState)),
    ],
    mechanicalRealizations: initialMechanicalRealizations(seed, request.startTime),
    generationRecord: generationRecordSchema.parse({
      generatorVersion: "starting-region-v1",
      rawInput: `${request.locationDescription}\n${request.player.description}`,
      normalizedConstraints: jsonValueSchema.parse(seed.normalized),
      stageDiagnostics: generationDiagnostics,
      acceptedStageOutputs: {
        normalize: jsonValueSchema.parse(seed.normalized),
        region: jsonValueSchema.parse(seed.region),
        settlement: jsonValueSchema.parse(seed.settlement),
        institutions: jsonValueSchema.parse(seed.institutions),
        locality: jsonValueSchema.parse(seed.locality),
        "player-context": jsonValueSchema.parse(seed.playerContext),
        npcs: jsonValueSchema.parse(seed.npcs),
        pressures: jsonValueSchema.parse({
          pressures: seed.pressures,
          creatures: seed.creatures,
          knowledge: seed.knowledge,
          processes: seed.processes,
        }),
        "opening-situation": jsonValueSchema.parse(seed.openingSituation),
      },
      coherenceAuditIssues: generationDiagnostics
        .filter((diagnostic) => diagnostic.stageId === "coherence-audit")
        .flatMap((diagnostic) => diagnostic.issues),
      ...(request.controlSeed === undefined
        ? {}
        : { controlSeed: request.controlSeed }),
    }),
    worldSimulation: generatedWorldSimulation(seed),
  };
}

function mergeState(
  state: StartingRegionWorkingState,
  patch: Partial<StartingRegionWorkingState>,
): StartingRegionWorkingState {
  return { ...state, ...patch };
}

export async function generateStartingRegion(
  rawRequest: unknown,
  model: StartingRegionProposalModel,
  options: StartingRegionGenerationOptions = {},
): Promise<
  | {
      readonly kind: "needs-input";
      readonly normalized: NormalizedRegionConstraints;
      readonly questions: readonly (NormalizedRegionConstraints["followUpQuestions"][number] & {
        readonly scope: "region" | "player";
      })[];
    }
  | {
      readonly kind: "generated";
      readonly seed: StartingRegionSeed;
      readonly campaign: Campaign;
      readonly diagnostics: readonly {
        readonly stageId: string;
        readonly attempts: number;
        readonly issues: readonly GenerationIssue[];
        readonly accepted: boolean;
      }[];
      readonly audit: z.infer<typeof coherenceAuditSchema>;
    }
> {
  const request = startingRegionRequestSchema.parse(rawRequest);
  let state: StartingRegionWorkingState = options.resumeState
    ? startingRegionWorkingStateSchema.parse(options.resumeState)
    : { request };
  if (JSON.stringify(state.request) !== JSON.stringify(request)) {
    throw new Error("Starting-region resume state does not match its request");
  }
  state = repairLegacyGeneratedScopeReferences(state);
  let diagnostics = [...(options.previousDiagnostics ?? [])];

  if (!state.normalized) {
    const normalization = await runGenerationPipeline(state, [
      makeStage(
        "normalize",
        normalizedRegionConstraintsSchema,
        (current, candidate) =>
          mergeState(current, {
            normalized: normalizePlayerEstablishedFacts(candidate, current),
          }),
        model,
      ),
    ], {
      async onStageAccepted(checkpoint) {
        diagnostics.push(checkpoint.diagnostic);
        await options.onCheckpoint?.({
          lastCompletedStageId: checkpoint.stageId,
          state: checkpoint.state,
          diagnostics,
        });
      },
    });
    state = normalization.state;
  }
  const normalized = state.normalized!;
  const questions = [
    ...normalized.followUpQuestions.map((question) => ({ ...question, scope: "region" as const })),
    ...normalized.player.followUpQuestions.map((question) => ({ ...question, scope: "player" as const })),
  ];
  if (!request.allowGeneratedDetails && questions.length > 0) {
    return {
      kind: "needs-input",
      normalized,
      questions,
    };
  }
  if (request.allowGeneratedDetails && questions.length > 0) {
    state = mergeState(state, {
      normalized: {
        ...normalized,
        followUpQuestions: [],
        player: { ...normalized.player, followUpQuestions: [] },
      },
    });
  }

  const allStages: GenerationStage<StartingRegionWorkingState, unknown>[] = [
    makeStage(
      "region",
      regionalFrameSchema,
      (current, candidate) =>
        mergeState(current, { region: regionalFrameSchema.parse(candidate) }),
      model,
    ),
    makeStage(
      "settlement",
      settlementSeedSchema,
      (current, candidate) =>
        mergeState(current, { settlement: settlementSeedSchema.parse(candidate) }),
      model,
    ),
    makeStage(
      "institutions",
      z.array(institutionSeedSchema),
      (current, candidate) =>
        mergeState(current, {
          institutions: z.array(institutionSeedSchema).parse(candidate),
        }),
      model,
    ),
    makeStage(
      "locality",
      startingLocalitySchema,
      (current, candidate) =>
        mergeState(current, { locality: startingLocalitySchema.parse(candidate) }),
      model,
    ),
    makeStage(
      "player-context",
      playerContextSeedSchema,
      (current, candidate) =>
        mergeState(current, {
          playerContext: playerContextSeedSchema.parse(candidate),
        }),
      model,
    ),
    makeStage(
      "npcs",
      z.array(persistentNpcSeedSchema),
      (current, candidate) =>
        mergeState(current, {
          npcs: z.array(persistentNpcSeedSchema).parse(candidate),
        }),
      model,
    ),
    makeStage(
      "pressures",
      pressureKnowledgeProcessSchema,
      (current, candidate) => {
        const parsed = pressureKnowledgeProcessSchema.parse(candidate);
        return mergeState(current, {
          pressures: parsed.pressures,
          creatures: parsed.creatures,
          knowledge: parsed.knowledge,
          processes: parsed.processes,
        });
      },
      model,
    ),
    makeStage(
      "opening-situation",
      openingSituationSchema,
      (current, candidate) =>
        mergeState(current, {
          openingSituation: openingSituationSchema.parse(candidate),
        }),
      model,
    ),
  ];

  const stages = allStages.filter((stage) => {
    if (stage.id === "region") return !state.region;
    if (stage.id === "settlement") return !state.settlement;
    if (stage.id === "institutions") return !state.institutions;
    if (stage.id === "locality") return !state.locality;
    if (stage.id === "player-context") return !state.playerContext;
    if (stage.id === "npcs") return !state.npcs;
    if (stage.id === "pressures") {
      return !state.pressures || !state.creatures || !state.knowledge || !state.processes;
    }
    if (stage.id === "opening-situation") return !state.openingSituation;
    return true;
  });
  const generated = await runGenerationPipeline(state, stages, {
    async onStageAccepted(checkpoint) {
      diagnostics.push(checkpoint.diagnostic);
      await options.onCheckpoint?.({
        lastCompletedStageId: checkpoint.stageId,
        state: checkpoint.state,
        diagnostics,
      });
    },
  });
  state = ensurePlayerRoutineAnchors(generated.state);
  const seed = ensureUniqueStartingRegionIds(
    ensureOpeningCreature(requireSeed(state)),
  );
  state = mergeState(state, seed);

  const hardIssues = validateStartingRegionSeed(seed);
  if (hardIssues.length > 0) {
    const messages = hardIssues.map((issue) => issue.message).join(" ");
    throw new Error(`Starting region failed validation: ${messages}`);
  }

  const rawAudit = coherenceAuditSchema.parse(await model.audit(seed, state));
  const seenAuditIssues = new Set<string>();
  const audit = coherenceAuditSchema.parse({
    issues: rawAudit.issues.flatMap((issue) => {
      const key = `${issue.code}|${JSON.stringify(issue.path)}|${issue.message
        .toLocaleLowerCase().replace(/\s+/g, " ").trim()}`;
      if (seenAuditIssues.has(key)) return [];
      seenAuditIssues.add(key);
      const { repairStageId: _repairStageId, ...advisoryIssue } = issue;
      return [{ ...advisoryIssue, severity: "warning" as const }];
    }),
  });

  const auditDiagnostics = [{
    stageId: "coherence-audit",
    attempts: 1,
    issues: audit.issues,
    accepted: true,
  }];
  diagnostics = [...diagnostics, ...auditDiagnostics];
  await options.onCheckpoint?.({
    lastCompletedStageId: "coherence-audit",
    state,
    diagnostics,
  });
  const campaign = compileStartingRegionCampaign(request, seed, diagnostics);
  return {
    kind: "generated",
    seed,
    campaign,
    diagnostics,
    audit,
  };
}
