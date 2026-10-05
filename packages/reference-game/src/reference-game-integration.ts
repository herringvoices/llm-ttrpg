import {
  assertNoRetconJsonExtension,
  canonicalFactSchema,
  contextPackageSchema,
  createAuthoritativeGroundingCatalog,
  entitySchema,
  fictionalDurationMs,
  fictionalInstant,
  jsonValueSchema,
  stableIdSchema,
  type Campaign,
  type AuthoredEvent,
  type ContextPackage,
  type EventTypeDefinition,
  type JsonValue,
  type ModelInvocationOptions,
  type ModelRuntime,
  type Setting,
  type WorldProcessDefinition,
  type WorldSimulationContribution,
  type WorldState,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import { threatEnvelopeSchema } from "./starting-region.js";
import { MAGICAL_INTERACTION_FACT_IDS } from "./adapter/index.js";

export const publicResponseStatusSchema = z.enum([
  "reported",
  "dispatching",
  "responding",
  "on-scene",
  "contained",
  "resolved",
  "handed-off",
]);

export const openingIncidentProposalSchema = z.object({
  incident: z.object({
    id: stableIdSchema,
    name: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    locationRef: stableIdSchema,
    involvedRefs: z.array(stableIdSchema).min(1),
    groundingRefs: z.array(stableIdSchema).min(1),
    contactObject: z.object({
      id: stableIdSchema,
      name: z.string().trim().min(1),
      summary: z.string().trim().min(1),
      wielderRef: stableIdSchema,
    }).strict(),
    observedFacts: z.array(z.object({
      id: stableIdSchema,
      predicate: stableIdSchema,
      value: jsonValueSchema,
      visibility: z.enum(["public", "hidden"]),
      tags: z.array(stableIdSchema),
    }).strict()).min(1),
  }).strict(),
  creature: z.object({
    entityRef: stableIdSchema,
    deliberateNearTermPlayerFacing: z.literal(true),
    threatEnvelope: threatEnvelopeSchema,
    observedTraits: z.array(z.string().trim().min(1)).min(1),
  }).strict(),
  publicResponse: z.object({
    institutionId: stableIdSchema,
    institutionName: z.string().trim().min(1),
    responseId: stableIdSchema,
    observedThreat: z.string().trim().min(1),
    reportedAt: z.string().datetime(),
    responsibleDispatch: z.string().trim().min(1),
    responderAssignment: z.string().trim().min(1),
    dispatchDelayMs: z.number().int().positive(),
    travelDurationMs: z.number().int().positive(),
    onSceneDurationMs: z.number().int().positive(),
    finalStatus: z.enum(["contained", "resolved", "handed-off"]),
  }).strict(),
  gateFixture: z.object({
    gateId: stableIdSchema,
    gateName: z.string().trim().min(1),
    entranceRef: stableIdSchema,
    interiorId: stableIdSchema,
    interiorName: z.string().trim().min(1),
    routeFactId: stableIdSchema,
    stabilityFactId: stableIdSchema,
    scopeId: stableIdSchema,
    summary: z.string().trim().min(1),
  }).strict().optional(),
}).strict();
export type OpeningIncidentProposal = z.infer<
  typeof openingIncidentProposalSchema
>;

const openingIncidentModelProposalSchema = z.object({
  incident: z.object({
    name: z.string().optional(),
    summary: z.string().optional(),
    locationRef: z.string(),
    involvedRefs: z.array(z.string()).default([]),
    groundingRefs: z.array(z.string()).default([]),
    contactObject: z.object({
      name: z.string().optional(),
      summary: z.string().optional(),
      wielderRef: z.string(),
    }).passthrough(),
    observedCondition: z.string().optional(),
  }).passthrough(),
  creature: z.object({
    entityRef: z.string(),
    observedTraits: z.array(z.string()).default([]),
  }).passthrough(),
  publicResponse: z.object({
    institutionName: z.string().optional(),
    observedThreat: z.string().optional(),
    responsibleDispatch: z.string().optional(),
    responderAssignment: z.string().optional(),
    finalStatus: z.string().optional(),
  }).passthrough().default({}),
  gateFixture: z.object({
    gateName: z.string().optional(),
    entranceRef: z.string(),
    interiorName: z.string().optional(),
    summary: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

function generatedSlug(value: string, fallback: string): string {
  const slug = value.toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

function expandOpeningIncidentProposal(
  rawProposal: unknown,
  context: ContextPackage,
  campaign: Campaign,
): OpeningIncidentProposal {
  const compact = openingIncidentModelProposalSchema.parse(rawProposal);
  const allowedRefs = new Set(context.situation.scene.map((item) => item.localRef));
  const requireRef = (ref: string, label: string) => {
    if (!allowedRefs.has(ref) || !context.diagnostics.localReferences[ref]) {
      throw new OpeningIncidentValidationError(
        `Compact incident ${label} references unauthorized local ref ${ref}`,
      );
    }
    return ref;
  };
  const creatureRef = requireRef(compact.creature.entityRef, "creature");
  const creatureId = context.diagnostics.localReferences[creatureRef]!;
  const creature = campaign.content.entities.find((entity) => entity.id === creatureId);
  if (!creature) {
    throw new OpeningIncidentValidationError(
      `Compact incident creature ${creatureId} is not canonical campaign content`,
    );
  }
  const threatEnvelope = threatEnvelopeSchema.parse(creature.data.threatEnvelope);
  const storedTraits = Array.isArray(creature.data.observedTraits)
    ? creature.data.observedTraits.filter((value): value is string =>
        typeof value === "string" && value.trim().length > 0
      )
    : [];
  const observedTraits = [...new Set([
    ...compact.creature.observedTraits.map((value) => value.trim()).filter(Boolean),
    ...storedTraits,
  ])].slice(0, 6);
  const name = compact.incident.name?.trim().slice(0, 120) || "Opening Supernatural Incident";
  const generatedNameSlug = generatedSlug(name, "opening-incident");
  const slug = generatedNameSlug.endsWith("-incident")
    ? generatedNameSlug.slice(0, -"-incident".length)
    : generatedNameSlug;
  const incidentId = `generated.incident.${slug}`;
  const contactName = compact.incident.contactObject.name?.trim().slice(0, 120) ||
    "Available Everyday Object";
  const involvedRefs = [...new Set([
    ...compact.incident.involvedRefs.map((ref) => requireRef(ref, "involved entity")),
    creatureRef,
    requireRef(compact.incident.contactObject.wielderRef, "contact-object wielder"),
  ])];
  const groundingRefs = [...new Set([
    ...compact.incident.groundingRefs.map((ref) => requireRef(ref, "grounding entity")),
    requireRef(compact.incident.locationRef, "location"),
    creatureRef,
  ])];
  const finalStatus = ["contained", "resolved", "handed-off"].includes(
      compact.publicResponse.finalStatus ?? "",
    )
    ? compact.publicResponse.finalStatus
    : "contained";
  const gateSlug = `${slug}-pocket`;

  return openingIncidentProposalSchema.parse({
    incident: {
      id: incidentId,
      name,
      summary: compact.incident.summary?.trim().slice(0, 320) ||
        "A grounded supernatural threat becomes immediately relevant to the player.",
      locationRef: requireRef(compact.incident.locationRef, "location"),
      involvedRefs,
      groundingRefs,
      contactObject: {
        id: `generated.object.${slug}-contact`,
        name: contactName,
        summary: compact.incident.contactObject.summary?.trim().slice(0, 240) ||
          `${contactName} is an ordinary object immediately available to the player.`,
        wielderRef: requireRef(compact.incident.contactObject.wielderRef, "contact-object wielder"),
      },
      observedFacts: [{
        id: `generated.fact.${slug}-observable-condition`,
        predicate: "incident.observable-condition",
        value: compact.incident.observedCondition?.trim().slice(0, 280) ||
          "An observable supernatural disturbance is developing.",
        visibility: "public",
        tags: ["incident", "observation", "supernatural"],
      }],
    },
    creature: {
      entityRef: creatureRef,
      deliberateNearTermPlayerFacing: true,
      threatEnvelope,
      observedTraits: observedTraits.length > 0
        ? observedTraits
        : ["an observable supernatural anomaly"],
    },
    publicResponse: {
      institutionId: `generated.institution.${slug}-public-response`,
      institutionName: compact.publicResponse.institutionName?.trim().slice(0, 160) ||
        "Local Public Supernatural Response",
      responseId: `generated.response.${slug}`,
      observedThreat: compact.publicResponse.observedThreat?.trim().slice(0, 280) ||
        "A supernatural creature is active near civilians.",
      reportedAt: campaign.startTime,
      responsibleDispatch: compact.publicResponse.responsibleDispatch?.trim().slice(0, 160) ||
        "Local emergency dispatch",
      responderAssignment: compact.publicResponse.responderAssignment?.trim().slice(0, 160) ||
        "Available public supernatural-response personnel",
      dispatchDelayMs: 2 * 60_000,
      travelDurationMs: 8 * 60_000,
      onSceneDurationMs: 10 * 60_000,
      finalStatus,
    },
    ...(compact.gateFixture
      ? {
          gateFixture: {
            gateId: `generated.spatial-anomaly.${gateSlug}`,
            gateName: compact.gateFixture.gateName?.trim().slice(0, 160) ||
              "Local Pocket Entrance",
            entranceRef: requireRef(compact.gateFixture.entranceRef, "Gate entrance"),
            interiorId: `generated.location.${gateSlug}`,
            interiorName: compact.gateFixture.interiorName?.trim().slice(0, 160) ||
              "Local Pocket Interior",
            routeFactId: `generated.fact.${gateSlug}-route`,
            stabilityFactId: `generated.fact.${gateSlug}-stability`,
            scopeId: `scope.generated.${gateSlug}`,
            summary: compact.gateFixture.summary?.trim().slice(0, 280) ||
              "A small stable pocket environment connected to the incident location.",
          },
        }
      : {}),
  });
}

export class OpeningIncidentValidationError extends Error {
  override readonly name = "OpeningIncidentValidationError";
}

export interface RequestOpeningIncidentInput {
  readonly modelRuntime: ModelRuntime;
  readonly context: ContextPackage;
  readonly campaign: Campaign;
  readonly openingBrief: JsonValue;
  readonly options?: ModelInvocationOptions;
}

export async function requestOpeningIncidentProposal(
  input: RequestOpeningIncidentInput,
): Promise<OpeningIncidentProposal> {
  const context = contextPackageSchema.parse(input.context);
  const campaign = input.campaign;
  if (
    !["orchestrator", "planner"].includes(context.bootstrap.role) ||
    context.bootstrap.perspective.kind !== "canonical"
  ) {
    throw new OpeningIncidentValidationError(
      "Opening-incident generation requires protected canonical orchestration context",
    );
  }
  const result = await input.modelRuntime.generate({
    prompt: {
      instructions: [
        "Propose one grounded Awakening Earth opening incident as structured data.",
        "Use only opaque local references present in the supplied context for existing entities.",
        "The opening brief is non-authoritative guidance, not an event that has already happened.",
        "Return only concise creative choices: incident framing, existing local refs, an ordinary contact object, observed condition, creature traits, and public-response wording.",
        "Do not emit IDs, threat mechanics, facts, timestamps, response timings, or other persistence boilerplate; the engine derives and validates those deterministically.",
        "Include a Gate fixture only when the opening brief actually calls for one.",
      ],
      context: JSON.stringify({
        fictionalTime: context.situation.fictionalTime,
        scene: context.situation.scene.map((item) => ({
          localRef: item.localRef,
          displayIdentity: item.displayIdentity,
          category: item.category,
          prominence: item.prominence,
          ...(item.summary ? { summary: item.summary } : {}),
          ...(item.coarseState !== undefined ? { coarseState: item.coarseState } : {}),
        })),
      }),
      input: `Protected opening brief: ${JSON.stringify(input.openingBrief)}`,
    },
    output: {
      kind: "structured",
      schemaId: "awakening-earth.opening-incident-compact-v1",
      schema: openingIncidentModelProposalSchema,
    },
    trace: { operation: "reference-game.generate-opening-incident" },
  }, input.options);
  if (!result.ok) {
    if (
      result.error.kind === "invalid-output" &&
      result.error.candidate !== undefined
    ) {
      try {
        return expandOpeningIncidentProposal(result.error.candidate, context, campaign);
      } catch (error) {
        throw new OpeningIncidentValidationError(
          `Opening-incident compact output could not be normalized: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    throw new OpeningIncidentValidationError(
      `Opening-incident model generation failed: ${result.error.kind}: ${result.error.message}`,
    );
  }
  if (result.output.kind !== "structured") {
    throw new OpeningIncidentValidationError(
      "Opening-incident model returned non-structured output",
    );
  }
  return expandOpeningIncidentProposal(result.output.value, context, campaign);
}

const incidentRealizedPayloadSchema = z.object({
  incidentId: stableIdSchema,
  locationId: stableIdSchema,
  creatureId: stableIdSchema,
  responseId: stableIdSchema,
  groundingEntityIds: z.array(stableIdSchema).min(1),
  gateId: stableIdSchema.optional(),
}).strict();

export const openingIncidentRealizedEventType: EventTypeDefinition<
  z.infer<typeof incidentRealizedPayloadSchema>
> = {
  type: "campaign.opening-incident-realized",
  schemaVersion: 1,
  payloadSchema: incidentRealizedPayloadSchema,
};

const publicResponseAdvancedPayloadSchema = z.object({
  responseId: stableIdSchema,
  fromStatus: publicResponseStatusSchema,
  toStatus: publicResponseStatusSchema,
  responsibleDispatch: z.string().trim().min(1),
  responderAssignment: z.string().trim().min(1),
}).strict();

export const publicResponseAdvancedEventType: EventTypeDefinition<
  z.infer<typeof publicResponseAdvancedPayloadSchema>
> = {
  type: "campaign.public-response-advanced",
  schemaVersion: 1,
  payloadSchema: publicResponseAdvancedPayloadSchema,
};

const responseStateSchema = z.object({
  incidentId: stableIdSchema,
  locationId: stableIdSchema,
  observedThreat: z.string().trim().min(1),
  reportedAt: z.string().datetime(),
  responsibleDispatch: z.string().trim().min(1),
  responderAssignment: z.string().trim().min(1),
  dispatchDelayMs: z.number().int().positive(),
  travelDurationMs: z.number().int().positive(),
  onSceneDurationMs: z.number().int().positive(),
  status: publicResponseStatusSchema,
  finalStatus: z.enum(["contained", "resolved", "handed-off"]),
}).strict();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function statusAt(
  state: z.infer<typeof responseStateSchema>,
  to: string,
): z.infer<typeof publicResponseStatusSchema> {
  const elapsed = Math.max(0, Date.parse(to) - Date.parse(state.reportedAt));
  if (elapsed < state.dispatchDelayMs) return "reported";
  if (elapsed < state.dispatchDelayMs + state.travelDurationMs / 2) {
    return "dispatching";
  }
  if (elapsed < state.dispatchDelayMs + state.travelDurationMs) {
    return "responding";
  }
  if (
    elapsed <
      state.dispatchDelayMs + state.travelDurationMs + state.onSceneDurationMs
  ) {
    return "on-scene";
  }
  return state.finalStatus;
}

function createPublicResponseProcess(
  responseId: string,
): WorldProcessDefinition {
  return {
    metadata: {
      id: `process.${responseId}`,
      version: "0.1.0",
      description:
        "Advance one generated public supernatural-incident response from report through disposition.",
      kind: "deterministic",
      scopeKinds: ["campaign-locality"],
      dependencies: [],
      eventInterests: [],
      scheduledTriggerTypes: [],
    },
    selectRelevantState({ world }) {
      const response = world.entities.find((item) => item.id === responseId);
      return jsonValueSchema.parse({
        responseId,
        responseState: response?.data["response-state"] ?? null,
        context: response?.data.context ?? null,
      });
    },
    runCatchUp(input) {
      const selected = input.relevantState as {
        readonly responseId: string;
        readonly responseState: unknown;
        readonly context: unknown;
      };
      const state = responseStateSchema.parse(selected.responseState);
      const nextStatus = statusAt(state, String(input.to));
      if (nextStatus === state.status) {
        return {
          workUnits: 0,
          mutations: [],
          events: [],
          processedScheduledTriggerIds: [],
          cancelScheduledTriggerIds: [],
          schedule: [],
          diagnostics: jsonValueSchema.parse({ status: state.status }),
        };
      }
      const next = responseStateSchema.parse({ ...state, status: nextStatus });
      const context = selected.context && typeof selected.context === "object"
        ? { ...(selected.context as Record<string, JsonValue>), coarseState: {
            status: nextStatus,
            responderAssignment: state.responderAssignment,
          } }
        : undefined;
      return {
        workUnits: 1,
        mutations: [
          {
            kind: "set-entity-data",
            entityId: responseId,
            key: "response-state",
            value: jsonValueSchema.parse(next),
          },
          ...(context
            ? [{
                kind: "set-entity-data" as const,
                entityId: responseId,
                key: "context",
                value: jsonValueSchema.parse(context),
              }]
            : []),
          {
            kind: "upsert-fact",
            fact: canonicalFactSchema.parse({
              id: `state.fact.${responseId}`,
              subjectId: responseId,
              predicate: "public-response.status",
              value: nextStatus,
              visibility: "public",
              tags: ["institution", "response", "supernatural-incident"],
            }),
          },
        ],
        events: [{
          type: "campaign.public-response-advanced",
          schemaVersion: 1,
          summary: `Public response ${responseId} advanced from ${state.status} to ${nextStatus}.`,
          relatedEntityIds: [responseId, state.incidentId, state.locationId],
          scopeIds: [input.scopeId],
          causedByEventIds: [],
          origin: { kind: "world-process", id: `process.${responseId}` },
          payload: publicResponseAdvancedPayloadSchema.parse({
            responseId,
            fromStatus: state.status,
            toStatus: nextStatus,
            responsibleDispatch: state.responsibleDispatch,
            responderAssignment: state.responderAssignment,
          }),
          access: "public",
        }],
        processedScheduledTriggerIds: [],
        cancelScheduledTriggerIds: [],
        schedule: [],
        diagnostics: jsonValueSchema.parse({
          fromStatus: state.status,
          toStatus: nextStatus,
          elapsedDurationMs: input.elapsedDurationMs,
        }),
      };
    },
  };
}

export interface RealizeOpeningIncidentInput {
  readonly campaign: Campaign;
  readonly setting: Setting;
  readonly world: WorldState;
  readonly context: ContextPackage;
  readonly proposal: OpeningIncidentProposal;
}

export function openingBriefFromCampaign(campaign: Campaign): JsonValue {
  const brief = campaign.generationRecord?.acceptedStageOutputs?.[
    "opening-situation"
  ];
  if (brief === undefined) {
    throw new OpeningIncidentValidationError(
      "Generated campaign is missing its protected opening-situation brief",
    );
  }
  return clone(brief);
}

export function realizeOpeningIncidentCampaign(
  input: RealizeOpeningIncidentInput,
): Campaign {
  const proposal = openingIncidentProposalSchema.parse(input.proposal);
  const context = contextPackageSchema.parse(input.context);
  openingBriefFromCampaign(input.campaign);
  if (
    !["orchestrator", "planner"].includes(context.bootstrap.role) ||
    context.bootstrap.perspective.kind !== "canonical"
  ) {
    throw new OpeningIncidentValidationError(
      "Incident realization requires protected canonical context",
    );
  }
  const resolveRef = (ref: string): string => {
    const id = context.diagnostics.localReferences[ref];
    if (!id) {
      throw new OpeningIncidentValidationError(
        `Incident proposal references unauthorized or unknown local ref ${ref}`,
      );
    }
    return id;
  };
  const locationId = resolveRef(proposal.incident.locationRef);
  const involvedIds = proposal.incident.involvedRefs.map(resolveRef);
  const groundingIds = proposal.incident.groundingRefs.map(resolveRef);
  const creatureId = resolveRef(proposal.creature.entityRef);
  const wielderId = resolveRef(proposal.incident.contactObject.wielderRef);
  const catalog = createAuthoritativeGroundingCatalog(input.world);
  for (const id of new Set([
    locationId,
    ...involvedIds,
    ...groundingIds,
    creatureId,
    wielderId,
  ])) {
    if (!catalog.has({ kind: "entity", id })) {
      throw new OpeningIncidentValidationError(
        `Incident grounding does not resolve to authoritative entity ${id}`,
      );
    }
  }

  for (const factId of [
    MAGICAL_INTERACTION_FACT_IDS.resistance,
    MAGICAL_INTERACTION_FACT_IDS.wieldedObject,
    MAGICAL_INTERACTION_FACT_IDS.projectileDissipation,
    "setting.fact.response-ecology",
    ...(proposal.gateFixture ? ["setting.fact.gates-pocket-environments"] : []),
  ]) {
    if (!input.setting.content.facts.some((fact) => fact.id === factId)) {
      throw new OpeningIncidentValidationError(
        `Incident realization requires setting fact ${factId}`,
      );
    }
  }

  const existingIds = new Set([
    ...input.setting.content.entities.map((item) => item.id),
    ...input.setting.content.facts.map((item) => item.id),
    ...input.setting.content.events.map((item) => item.id),
    ...input.campaign.content.entities.map((item) => item.id),
    ...input.campaign.content.facts.map((item) => item.id),
    ...input.campaign.content.events.map((item) => item.id),
  ]);
  const proposedIds = [
    proposal.incident.id,
    `${proposal.incident.id}.realized`,
    proposal.publicResponse.institutionId,
    proposal.publicResponse.responseId,
    proposal.incident.contactObject.id,
    `${proposal.incident.contactObject.id}.wielder`,
    `${proposal.incident.id}.creature-magical`,
    `state.fact.${proposal.publicResponse.responseId}`,
    ...proposal.incident.observedFacts.map((fact) => fact.id),
    ...(proposal.gateFixture
      ? [
          proposal.gateFixture.gateId,
          proposal.gateFixture.interiorId,
          proposal.gateFixture.routeFactId,
          proposal.gateFixture.stabilityFactId,
        ]
      : []),
  ];
  if (new Set(proposedIds).size !== proposedIds.length) {
    throw new OpeningIncidentValidationError(
      "Incident proposal contains duplicate committed IDs",
    );
  }
  for (const id of proposedIds) {
    if (existingIds.has(id)) {
      throw new OpeningIncidentValidationError(
        `Incident proposal would retcon existing record ${id}`,
      );
    }
  }

  const creature = input.campaign.content.entities.find((item) =>
    item.id === creatureId
  );
  if (!creature) {
    throw new OpeningIncidentValidationError(
      `Near-term creature ${creatureId} must already be canonical`,
    );
  }
  if (
    JSON.stringify(creature.data.threatEnvelope) !==
      JSON.stringify(proposal.creature.threatEnvelope)
  ) {
    throw new OpeningIncidentValidationError(
      `Near-term creature ${creatureId} proposal does not preserve its threat envelope`,
    );
  }
  const realization = input.world.mechanicalRealizations.find((item) =>
    item.entityId === creatureId
  );
  if (
    !realization || realization.level !== "constrained" ||
    !realization.constraints.some((constraint) =>
      constraint.sourceKind === "threat-envelope" &&
      constraint.sourceId === creatureId &&
      constraint.summary === JSON.stringify(proposal.creature.threatEnvelope)
    )
  ) {
    throw new OpeningIncidentValidationError(
      `Near-term creature ${creatureId} lacks a durable threat-envelope constraint`,
    );
  }
  if (creature.data.mechanics !== undefined) {
    throw new OpeningIncidentValidationError(
      `Creature ${creatureId} mechanics were realized before rules interaction required them`,
    );
  }

  const existingCreatureContext =
    creature.data.context !== null &&
      typeof creature.data.context === "object" &&
      !Array.isArray(creature.data.context)
      ? clone(creature.data.context) as Record<string, JsonValue>
      : {};
  if (
    existingCreatureContext.locationId !== undefined &&
    existingCreatureContext.locationId !== locationId
  ) {
    throw new OpeningIncidentValidationError(
      `Incident would relocate creature ${creatureId} without a canonical transition`,
    );
  }
  const existingPrivilegedDetail =
    existingCreatureContext.privilegedDetail !== null &&
      typeof existingCreatureContext.privilegedDetail === "object" &&
      !Array.isArray(existingCreatureContext.privilegedDetail)
      ? clone(existingCreatureContext.privilegedDetail) as Record<string, JsonValue>
      : {};
  const nextCreatureData = {
    ...clone(creature.data),
    magicalStructure: true,
    observedTraits: proposal.creature.observedTraits,
    context: {
      ...existingCreatureContext,
      locationId,
      category: "participant",
      prominence: "prominent",
      unrecognizedIdentity: "weak magical creature",
      observable: true,
      activeParticipant: true,
      orchestratorVisible: true,
      knownBy: [],
      identities: [],
      coarseState: { observedTraits: proposal.creature.observedTraits },
      privilegedDetail: {
        ...existingPrivilegedDetail,
        threatEnvelope: proposal.creature.threatEnvelope,
      },
    },
  };
  try {
    const stableBefore = clone(creature.data) as Record<string, JsonValue>;
    const stableAfter = clone(nextCreatureData) as Record<string, JsonValue>;
    delete stableBefore.context;
    delete stableAfter.context;
    assertNoRetconJsonExtension(stableBefore, stableAfter);
  } catch (error) {
    throw new OpeningIncidentValidationError(
      error instanceof Error ? error.message : "Creature densification retcon rejected",
    );
  }

  const responseState = responseStateSchema.parse({
    incidentId: proposal.incident.id,
    locationId,
    observedThreat: proposal.publicResponse.observedThreat,
    reportedAt: proposal.publicResponse.reportedAt,
    responsibleDispatch: proposal.publicResponse.responsibleDispatch,
    responderAssignment: proposal.publicResponse.responderAssignment,
    dispatchDelayMs: proposal.publicResponse.dispatchDelayMs,
    travelDurationMs: proposal.publicResponse.travelDurationMs,
    onSceneDurationMs: proposal.publicResponse.onSceneDurationMs,
    status: "reported",
    finalStatus: proposal.publicResponse.finalStatus,
  });
  if (proposal.publicResponse.reportedAt !== input.campaign.startTime) {
    throw new OpeningIncidentValidationError(
      "Opening incident realization must be reported at the generated campaign start",
    );
  }

  const incidentEntity = entitySchema.parse({
    id: proposal.incident.id,
    kind: "supernatural-incident",
    name: proposal.incident.name,
    summary: proposal.incident.summary,
    data: {
      locationId,
      involvedEntityIds: involvedIds,
      status: "active",
      generationProvenance: {
        class: "generator-chosen",
        sourceIds: groundingIds,
        rationale: "Validated structured opening-incident realization.",
      },
      commitmentEvidence: {
        groundingEntityIds: groundingIds,
        settingFactIds: [
          MAGICAL_INTERACTION_FACT_IDS.resistance,
          "setting.fact.response-ecology",
        ],
      },
      context: {
        locationId,
        category: "condition",
        prominence: "prominent",
        observable: true,
        activeParticipant: false,
        orchestratorVisible: true,
        knownBy: [],
        identities: [],
        coarseState: { status: "active" },
      },
    },
  });
  const responseInstitution = entitySchema.parse({
    id: proposal.publicResponse.institutionId,
    kind: "institution",
    name: proposal.publicResponse.institutionName,
    summary: "The public institution responsible for supernatural-incident dispatch.",
    data: {
      institutionType: "public-supernatural-response",
      serviceAreaEntityId: locationId,
      settingModelId: "setting.entity.monster-response",
    },
  });
  const responseEntity = entitySchema.parse({
    id: proposal.publicResponse.responseId,
    kind: "public-response",
    name: `Response to ${proposal.incident.name}`,
    summary: proposal.publicResponse.observedThreat,
    data: {
      "response-state": responseState,
      institutionId: proposal.publicResponse.institutionId,
      context: {
        locationId,
        category: "condition",
        prominence: "ambient",
        observable: true,
        activeParticipant: false,
        orchestratorVisible: true,
        knownBy: [],
        identities: [],
        coarseState: {
          status: "reported",
          responderAssignment: proposal.publicResponse.responderAssignment,
        },
      },
    },
  });

  const contactObject = entitySchema.parse({
    id: proposal.incident.contactObject.id,
    kind: "object",
    name: proposal.incident.contactObject.name,
    summary: proposal.incident.contactObject.summary,
    data: {
      currentWielderId: wielderId,
      currentLocation: locationId,
      context: {
        locationId,
        category: "object",
        prominence: "ambient",
        observable: true,
        activeParticipant: false,
        orchestratorVisible: true,
        knownBy: [],
        identities: [],
      },
    },
  });
  const newEntities = [
    incidentEntity,
    responseInstitution,
    responseEntity,
    contactObject,
  ];
  const newFacts = [
    ...proposal.incident.observedFacts.map((fact) => canonicalFactSchema.parse({
      ...fact,
      subjectId: proposal.incident.id,
    })),
    canonicalFactSchema.parse({
      id: `${proposal.incident.id}.creature-magical`,
      subjectId: creatureId,
      predicate: "magic.intrinsic-structure",
      value: true,
      visibility: "public",
      tags: ["magic", "creature", "interaction"],
    }),
    canonicalFactSchema.parse({
      id: `state.fact.${proposal.publicResponse.responseId}`,
      subjectId: proposal.publicResponse.responseId,
      predicate: "public-response.status",
      value: "reported",
      visibility: "public",
      tags: ["institution", "response", "supernatural-incident"],
    }),
    canonicalFactSchema.parse({
      id: `${proposal.incident.contactObject.id}.wielder`,
      subjectId: proposal.incident.contactObject.id,
      predicate: "object.directly-wielded-by",
      value: wielderId,
      visibility: "public",
      tags: ["object", "wielding", "interaction"],
    }),
  ];

  let gateScope: WorldSimulationContribution["scopes"] = [];
  if (proposal.gateFixture) {
    const entranceId = resolveRef(proposal.gateFixture.entranceRef);
    const entrance = input.world.entities.find((item) => item.id === entranceId);
    if (!entrance || entrance.kind !== "location") {
      throw new OpeningIncidentValidationError(
        "Gate entrance must resolve to an ordinary canonical location",
      );
    }
    newEntities.push(
      entitySchema.parse({
        id: proposal.gateFixture.gateId,
        kind: "spatial-anomaly",
        name: proposal.gateFixture.gateName,
        summary: proposal.gateFixture.summary,
        data: {
          entranceLocationId: entranceId,
          interiorLocationId: proposal.gateFixture.interiorId,
          stable: true,
          traversable: true,
          settingConceptId: "setting.entity.gates",
        },
      }),
      entitySchema.parse({
        id: proposal.gateFixture.interiorId,
        kind: "location",
        name: proposal.gateFixture.interiorName,
        summary: "A bounded pocket environment reached through an ordinary route fact.",
        data: {
          context: {
            locationId: proposal.gateFixture.interiorId,
            category: "feature",
            prominence: "prominent",
            observable: true,
            activeParticipant: false,
            orchestratorVisible: true,
            knownBy: [],
            identities: [],
          },
        },
      }),
    );
    newFacts.push(
      canonicalFactSchema.parse({
        id: proposal.gateFixture.routeFactId,
        subjectId: proposal.gateFixture.gateId,
        predicate: "location.route",
        value: {
          fromId: entranceId,
          toId: proposal.gateFixture.interiorId,
          summary: "A stable traversable entrance and exit link.",
          traversable: true,
          bidirectional: true,
        },
        visibility: "public",
        tags: ["location", "route", "spatial-anomaly"],
      }),
      canonicalFactSchema.parse({
        id: proposal.gateFixture.stabilityFactId,
        subjectId: proposal.gateFixture.gateId,
        predicate: "spatial-anomaly.stability",
        value: { stable: true, traversable: true, exitEstablished: true },
        visibility: "public",
        tags: ["spatial-anomaly", "stability", "traversal"],
      }),
    );
    const localityScope = input.campaign.worldSimulation?.scopes?.find((scope) =>
      scope.kind === "campaign-locality"
    );
    gateScope = [{
      id: proposal.gateFixture.scopeId,
      kind: "campaign-pocket-environment",
      ...(localityScope ? { parentScopeId: localityScope.id } : {}),
      dependencyScopeIds: [],
    }];
  }

  const payload = incidentRealizedPayloadSchema.parse({
    incidentId: proposal.incident.id,
    locationId,
    creatureId,
    responseId: proposal.publicResponse.responseId,
    groundingEntityIds: groundingIds,
    ...(proposal.gateFixture ? { gateId: proposal.gateFixture.gateId } : {}),
  });
  const incidentEvent: AuthoredEvent = {
    id: `${proposal.incident.id}.realized`,
    type: "campaign.opening-incident-realized",
    schemaVersion: 1,
    occurredAt: fictionalInstant(proposal.publicResponse.reportedAt),
    relatedEntityIds: [
      proposal.incident.id,
      locationId,
      creatureId,
      proposal.publicResponse.responseId,
    ],
    scopeIds: input.campaign.worldSimulation?.scopes
      ?.filter((scope) => scope.kind === "campaign-locality")
      .map((scope) => scope.id) ?? [],
    causedByEventIds: [],
    origin: {
      kind: "campaign-initialization",
      id: input.campaign.identity.id,
    },
    summary: proposal.incident.summary,
    payload,
    access: "public",
  };

  const content = clone(input.campaign.content);
  content.entities = content.entities.map((item) =>
    item.id === creatureId
      ? entitySchema.parse({ ...item, data: nextCreatureData })
      : item
  );
  content.entities.push(...newEntities);
  content.facts.push(...newFacts);
  content.events.push(incidentEvent);
  const existingSimulation = input.campaign.worldSimulation;
  const simulation: WorldSimulationContribution = {
    scopes: [...(existingSimulation?.scopes ?? []), ...(gateScope ?? [])],
    processes: [
      ...(existingSimulation?.processes ?? []),
      createPublicResponseProcess(proposal.publicResponse.responseId),
    ],
  };
  return {
    ...input.campaign,
    identity: {
      ...input.campaign.identity,
      version: "0.2.0",
    },
    description: `${input.campaign.description} Includes one validated generated opening incident.`,
    content,
    eventTypes: [
      ...input.campaign.eventTypes,
      openingIncidentRealizedEventType,
      publicResponseAdvancedEventType,
    ],
    worldSimulation: simulation,
  };
}
