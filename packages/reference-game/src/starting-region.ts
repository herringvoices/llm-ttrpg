import {
  actorSocialStateSchema,
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
  type JsonValue,
  type MechanicalRealization,
  type WorldProcessDefinition,
  type WorldSimulationContribution,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import {
  normalizedPlayerSetupSchema,
  playerCreationInputSchema,
  startingHumanGenerationIssues,
  startingHumanProposalSchema,
  validateNormalizedPlayerSetup,
  type NormalizedPlayerSetup,
  type PlayerCreationInput,
  type StartingHumanProposal,
} from "./player-creation.js";

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

export const startingRegionRequestSchema = z.object({
  locationDescription: z.string().trim().min(1),
  player: playerCreationInputSchema,
  startTime: z.string().datetime(),
  campaignId: stableIdSchema,
  controlSeed: z.number().int().nonnegative().optional(),
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
    sourceText: z.string().trim().min(1),
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

const pressureKnowledgeProcessSchema = z.object({
  pressures: z.array(pressureSeedSchema).min(3),
  creatures: z.array(creatureSeedSchema),
  knowledge: knowledgeSeedSchema,
  processes: z.array(activeProcessSeedSchema).min(2),
}).strict();

export const coherenceAuditSchema = z.object({
  issues: z.array(generationIssueSchema.extend({
    repairStageId: z.enum([
      "settlement",
      "institutions",
      "player-context",
      "npcs",
      "pressures",
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

export interface StartingRegionWorkingState {
  readonly request: StartingRegionRequest;
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

function stageIssues(
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
    const normalized = normalizedRegionConstraintsSchema.parse(candidate);
    for (const constraint of normalized.explicitConstraints) {
      if (!state.request.locationDescription.includes(constraint.sourceText)) {
        add(
          "generation.player-constraint-source",
          `Explicit constraint ${constraint.id} is not grounded in the player's location input.`,
          ["explicitConstraints"],
        );
      }
    }
    validateNormalizedPlayerSetup(state.request.player, normalized.player);
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
  } else if (stageId === "player-context") {
    const player = playerContextSeedSchema.parse(candidate);
    if (player.entity.kind !== "actor" || player.socialState.actorId !== player.entity.id) {
      add(
        "generation.player-context.actor-mismatch",
        "Player entity and player social state must describe the same actor.",
        ["socialState", "actorId"],
      );
    }
    issues.push(...startingHumanGenerationIssues(player.mechanics));
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
    !state.processes
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
  };
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
  for (const pressure of seed.pressures) {
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
  const scopeIds = new Set([
    `scope.${seed.region.id}`,
    `scope.${seed.settlement.id}`,
    `scope.${seed.locality.id}`,
  ]);
  for (const process of seed.processes) {
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
      processValue: 0,
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
          typeof pressure?.data.processValue === "number"
            ? pressure.data.processValue
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
          key: "processValue",
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
      history: [],
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
  };
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
    ...seed.locality.locations.map((entity) => clone(entity)),
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
    ...seed.npcs.map((npc) => ({
      ...clone(npc.entity),
      data: {
        ...clone(npc.entity.data),
        simulationReasons: npc.simulationReasons,
        generationProvenance: npc.provenance,
      },
    })),
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
      },
    })),
    ...seed.pressures.map(pressureEntity),
  ];

  const content = emptyContentBundle();
  content.entities.push(...entities);
  content.facts.push(...seed.knowledge.facts);
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
): Promise<
  | {
      readonly kind: "needs-input";
      readonly normalized: NormalizedRegionConstraints;
      readonly questions: NormalizedRegionConstraints["followUpQuestions"];
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
  let state: StartingRegionWorkingState = { request };

  const normalization = await runGenerationPipeline(state, [
    makeStage(
      "normalize",
      normalizedRegionConstraintsSchema,
      (current, candidate) =>
        mergeState(current, {
          normalized: normalizedRegionConstraintsSchema.parse(candidate),
        }),
      model,
    ),
  ]);
  state = normalization.state;
  if (state.normalized!.followUpQuestions.length > 0) {
    return {
      kind: "needs-input",
      normalized: state.normalized!,
      questions: state.normalized!.followUpQuestions,
    };
  }

  const stages: GenerationStage<StartingRegionWorkingState, unknown>[] = [
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
  ];

  const generated = await runGenerationPipeline(state, stages);
  state = generated.state;
  let seed = requireSeed(state);
  let audit = coherenceAuditSchema.parse(await model.audit(seed, state));
  const auditDiagnostics: Array<{
    stageId: string;
    attempts: number;
    issues: GenerationIssue[];
    accepted: boolean;
  }> = [];
  let auditAttempt = 1;

  while (audit.issues.some((issue) => issue.severity === "error") && auditAttempt <= 2) {
    const repairable = audit.issues.find(
      (issue) => issue.severity === "error" && issue.repairStageId,
    );
    if (!repairable?.repairStageId) break;
    const stageId = repairable.repairStageId;
    const candidate = stageId === "settlement"
      ? state.settlement
      : stageId === "institutions"
        ? state.institutions
        : stageId === "player-context"
          ? state.playerContext
          : stageId === "npcs"
            ? state.npcs
            : {
                pressures: state.pressures,
                creatures: state.creatures,
                knowledge: state.knowledge,
                processes: state.processes,
              };
    const repaired = await model.repair(
      stageId,
      candidate,
      audit.issues,
      state,
    );
    const stage = stages.find((item) => item.id === stageId);
    if (!stage) break;
    const parsed = stage.candidateSchema.parse(repaired);
    const hard = stage.validate?.(parsed, state) ?? [];
    if (hard.some((issue) => issue.severity === "error")) {
      auditDiagnostics.push({
        stageId: "coherence-audit",
        attempts: auditAttempt,
        issues: [...hard],
        accepted: false,
      });
      break;
    }
    state = stage.accept(state, parsed);
    seed = requireSeed(state);
    auditAttempt += 1;
    audit = coherenceAuditSchema.parse(await model.audit(seed, state));
  }

  const hardIssues = validateStartingRegionSeed(seed);
  const finalAuditErrors = audit.issues.filter((issue) => issue.severity === "error");
  if (hardIssues.length > 0 || finalAuditErrors.length > 0) {
    const messages = [...hardIssues, ...finalAuditErrors]
      .map((issue) => issue.message)
      .join(" ");
    throw new Error(`Starting region failed validation: ${messages}`);
  }

  auditDiagnostics.push({
    stageId: "coherence-audit",
    attempts: auditAttempt,
    issues: audit.issues,
    accepted: true,
  });
  const diagnostics = [
    ...normalization.diagnostics,
    ...generated.diagnostics,
    ...auditDiagnostics,
  ];
  const campaign = compileStartingRegionCampaign(request, seed, diagnostics);
  return {
    kind: "generated",
    seed,
    campaign,
    diagnostics,
    audit,
  };
}
