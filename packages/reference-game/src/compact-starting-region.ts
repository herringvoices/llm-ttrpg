import { z } from "zod";
import {
  type StartingRegionRequest,
  type StartingRegionWorkingState,
  type StartingRegionGenerationOptions,
  type StartingRegionProposalModel,
  type StartingRegionSeed,
  startingRegionRequestSchema,
  startingRegionWorkingStateSchema,
  startingRegionSeedSchema,
  normalizedRegionConstraintsSchema,
  regionalFrameSchema,
  settlementSeedSchema,
  startingLocalitySchema,
  expandPlayerContextProposal,
  expandCompactInstitutionProposals,
  expandNpcProposals,
  expandPressureProposal,
  ensurePlayerRoutineAnchors,
  ensureOpeningCreature,
  ensureUniqueStartingRegionIds,
  normalizePlayerEstablishedFacts,
  validateStartingRegionSeed,
  stageIssues,
  compileStartingRegionCampaign,
} from "./starting-region.js";
import { entitySchema, type ModelRuntime, type GenerationIssue, type GenerationStageDiagnostic } from "@llm-ttrpg/engine";
import { openingSituationSchema, validateNormalizedPlayerSetup } from "./player-creation.js";

/** A compact *creative* proposal, not persisted world state. All IDs, graphs,
 * provenance, mechanics and social structures are deterministically expanded. */
export const compactCampaignSeedProposalSchema = z.object({
  regionName: z.string().trim().min(2).max(90),
  settlementName: z.string().trim().min(2).max(90),
  settlementScale: z.enum(["rural", "small-town", "town", "small-city", "medium-city", "large-city", "major-city"]),
  settlementDetail: z.string().trim().min(8).max(220),
  localityName: z.string().trim().min(2).max(90),
  localityDetail: z.string().trim().min(8).max(220),
  publicPlace: z.object({
    name: z.string().trim().min(2).max(90),
    description: z.string().trim().min(8).max(200),
  }).strict(),
  contacts: z.array(z.object({
    name: z.string().trim().min(2).max(100),
    connection: z.string().trim().min(8).max(180),
    immediateGoal: z.string().trim().min(8).max(180),
  }).strict()).min(1).max(2),
  ordinaryPressure: z.string().trim().min(8).max(180),
  socialPressure: z.string().trim().min(8).max(180),
  supernaturalPressure: z.string().trim().min(8).max(180),
  magicalPrinciple: z.string().trim().min(8).max(180),
}).strict();
export type CompactCampaignSeedProposal = z.infer<typeof compactCampaignSeedProposalSchema>;

export const compactOpeningProposalSchema = z.object({
  mode: z.enum(["supernatural-inciting-incident", "mundane-manifestation"]),
  focus: z.enum(["creature", "phenomenon", "none"]),
  visibleSituation: z.string().trim().min(12).max(320),
  manifestationOpportunity: z.string().trim().min(12).max(320),
  targetTurn: z.number().int().min(1).max(3),
  unresolvedConsequence: z.string().trim().min(8).max(200),
  socialDirection: z.string().trim().min(8).max(180),
  investigativeDirection: z.string().trim().min(8).max(180),
  riskyDirection: z.string().trim().min(8).max(180),
}).strict().superRefine((opening, ctx) => {
  if ((opening.mode === "mundane-manifestation") !== (opening.focus === "none")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom,
      message: "Mundane openings require focus none; supernatural openings require creature or phenomenon.",
      path: ["focus"] });
  }
});

const provenance = (sourceIds: string[], rationale: string) => ({
  class: "generator-chosen" as const, sourceIds, rationale,
});
const presentDay = "Present-day roads, utilities, mobile phones, internet access, local commerce and emergency services";

function materializeCompactSeed(
  request: StartingRegionRequest,
  state: StartingRegionWorkingState,
  raw: unknown,
): StartingRegionWorkingState {
  const candidate = compactCampaignSeedProposalSchema.parse(raw);
  if (!state.normalized) throw new Error("Cannot materialize a campaign without accepted player constraints");
  const normalized = state.normalized;
  if (normalized.geographyMode === "explicit-real-locality" &&
      !request.locationDescription.toLocaleLowerCase().includes(
        candidate.settlementName.toLocaleLowerCase())) {
    throw new Error("Compact seed changed an explicitly named real-world locality; regenerate only the compact seed.");
  }
  // An accepted geographic scale is a player constraint, not a free model choice.
  const settlementScale = normalized.settlementScale;
  const regionId = "generated.region.starting";
  const settlementId = "generated.settlement.starting";
  const localityId = "generated.locality.starting";
  const homeId = "generated.location.home";
  const publicId = "generated.location.public";
  // Modern baseline is setting-derived, not a claim about unmentioned details
  // of the player's identity, history or home.
  const region = regionalFrameSchema.parse({
    id: regionId, name: candidate.regionName,
    broadGeography: normalized.geographicDescription,
    climate: "Weather follows the established geography and real-world seasonal conditions.",
    terrain: ["Connected inhabited land with working contemporary transport routes"],
    settlementPattern: `The starting settlement and nearby communities belong to ${candidate.regionName}.`,
    transportationConnectivity: presentDay,
    economicContext: "Contemporary employment, retail trade, public services and ordinary household life.",
    supernaturalPressureBaseline: candidate.supernaturalPressure,
    gateHistory: "Supernatural phenomena have recently begun to affect the contemporary world.",
    nearestPopulationCenters: [],
    provenance: provenance([request.campaignId], "Minimal geographic scaffold derived from accepted player location constraints."),
  });
  const approximatePopulation = {
    rural: 900, "small-town": 4_000, town: 16_000,
    "small-city": 60_000, "medium-city": 190_000,
    "large-city": 600_000, "major-city": 1_500_000,
  }[settlementScale];
  const settlement = settlementSeedSchema.parse({
    id: settlementId, name: candidate.settlementName, approximatePopulation,
    settlementType: settlementScale,
    economy: ["Modern local employment and services", candidate.settlementDetail],
    districts: [{ id: "generated.district.starting", name: candidate.localityName,
      summary: candidate.localityDetail }],
    transportation: [presentDay],
    supernaturalHistory: "The recent supernatural emergence is not yet fully understood.",
    institutionalCapacity: "Existing emergency, civic and commercial services remain available.",
    traits: [candidate.settlementDetail],
    provenance: provenance([regionId], "Settlement type and character expanded from compact seed."),
  });
  const home = entitySchema.parse({
    id: homeId, kind: "location",
    name: "Player's initial location",
    summary: `The player's starting point in ${candidate.localityName}. Housing and biographical details not supplied by the player remain unspecified.`,
    data: {},
  });
  const publicPlace = entitySchema.parse({
    id: publicId, kind: "location", name: candidate.publicPlace.name,
    summary: `${candidate.publicPlace.description} ${presentDay}.`, data: {},
  });
  const locality = startingLocalitySchema.parse({
    id: localityId, name: candidate.localityName, summary: candidate.localityDetail,
    locations: [home, publicPlace],
    routes: [{ fromId: homeId, toId: publicId,
      summary: "An accessible local route through the present-day neighborhood." }],
    ordinaryWeekCoverage: ["Access to a private daily routine", "Local commerce and communication",
      "Travel to nearby ordinary services"],
    provenance: provenance([settlementId], "Only immediately needed connected starting places are realized."),
  });
  let expanded: StartingRegionWorkingState = {
    ...state, compactVersion: 2, compactSeed: candidate, region, settlement, locality,
  };
  const institutions = expandCompactInstitutionProposals([{
    name: `${candidate.settlementName} Community Services`,
    summary: `Ordinary local services serving ${candidate.settlementName}.`,
    institutionType: "civic-services", serviceAreaEntityId: settlementId,
    goals: ["Maintain ordinary public services and communications."],
    capabilities: ["Coordinate routine community services."],
    resources: [], constraints: [], currentPressures: [],
  }], expanded);
  expanded = { ...expanded, institutions };
  const playerContext = expandPlayerContextProposal({
    entity: {
      name: request.player.name,
      summary: request.player.description.slice(0, 320),
    },
    homeLocationId: homeId, routineLocationIds: [homeId, publicId],
    accessEntityIds: [homeId, publicId],
    currentObligations: [], ordinaryPressures: [],
    mechanicalSignals: { attributeDirections: [], skills: [] },
  }, expanded);
  expanded = { ...expanded, playerContext };
  const npcs = expandNpcProposals(candidate.contacts.map((contact) => ({
    name: contact.name, summary: contact.connection,
    simulationReasons: ["Connected to the starting neighborhood"],
    goals: [contact.immediateGoal], memories: [],
  })), expanded);
  expanded = { ...expanded, npcs };
  const pressureBundle = expandPressureProposal({
    pressures: [
      { category: "ordinary", summary: candidate.ordinaryPressure,
        currentState: candidate.ordinaryPressure, scope: "locality",
        actorEntityIds: [], changeConditions: [], visibility: "public" },
      { category: "social-institutional", summary: candidate.socialPressure,
        currentState: candidate.socialPressure, scope: "settlement",
        actorEntityIds: [], changeConditions: [], visibility: "public" },
      { category: "supernatural", summary: candidate.supernaturalPressure,
        currentState: candidate.supernaturalPressure, scope: "region",
        actorEntityIds: [], changeConditions: [], visibility: "hidden" },
    ],
    creatures: [{
      name: "Emergent Local Anomaly",
      summary: candidate.supernaturalPressure,
      corePrinciple: candidate.magicalPrinciple,
      observedTraits: ["an observable unusual effect"],
      nearTermPlayerFacing: true,
      threat: {
        challengeBand: "Hard", overallThreat: "Noticeable and avoidable with informed counterplay.",
        signatureCapabilities: [candidate.magicalPrinciple],
        tells: ["visible changes occur shortly before the effect"],
        counterplay: ["observe, avoid, or interrupt the visible effect"],
      },
    }],
    beliefs: [],
  }, expanded);
  expanded = { ...expanded,
    pressures: pressureBundle.pressures, creatures: pressureBundle.creatures,
    knowledge: pressureBundle.knowledge, processes: pressureBundle.processes,
  };
  // Reuse the existing accepted-biography routine-anchor expansion (workplaces
  // and daily geography) rather than converting guesses into user biography.
  expanded = ensurePlayerRoutineAnchors(expanded);
  for (const stage of ["settlement", "locality", "player-context", "npcs", "pressures"] as const) {
    const value = stage === "settlement" ? expanded.settlement
      : stage === "locality" ? expanded.locality
      : stage === "player-context" ? expanded.playerContext
      : stage === "npcs" ? expanded.npcs
      : { pressures: expanded.pressures, creatures: expanded.creatures,
          knowledge: expanded.knowledge, processes: expanded.processes };
    const issues = stageIssues(stage, value, expanded);
    if (issues.length) throw new Error(`Deterministic compact seed ${stage} failed: ${issues.map((issue) => issue.message).join("; ")}`);
  }
  return expanded;
}

function materializeCompactOpening(
  state: StartingRegionWorkingState, raw: unknown,
): StartingRegionWorkingState {
  const candidate = compactOpeningProposalSchema.parse(raw);
  const homeId = state.playerContext?.homeLocationId;
  if (!homeId || !state.locality?.locations.some((place) => place.id === homeId)) {
    throw new Error("Compact opening must be anchored to the accepted starting locality");
  }
  const opening = openingSituationSchema.parse({
    ordinaryAnchorEntityIds: [homeId],
    openingMode: candidate.mode,
    supernaturalFocus: candidate.focus,
    awakeningEvent: candidate.visibleSituation,
    manifestationOpportunity: candidate.manifestationOpportunity,
    manifestationTargetTurn: candidate.targetTurn,
    manifestationDeadlineTurns: 3,
    combatRequired: false,
    unresolvedConsequences: [candidate.unresolvedConsequence],
    actionableDirections: {
      social: [candidate.socialDirection],
      investigative: [candidate.investigativeDirection],
      risky: [candidate.riskyDirection],
    },
    mandatoryQuest: false,
  });
  const next = { ...state, openingSituation: opening };
  const issues = stageIssues("opening-situation", opening, next);
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join("; "));
  return next;
}

const compactStageSchema = (stageId: string) =>
  stageId === "compact-seed" ? compactCampaignSeedProposalSchema : compactOpeningProposalSchema;

/** Model calls contain only a small creative contract; full world materialization
 * occurs in deterministic code. The legacy normalization path remains intact. */
export function createCompactStartingRegionProposalModel(runtime: ModelRuntime): StartingRegionProposalModel {
  return {
    async propose(stageId, context) {
      if (stageId === "normalize") {
        const { createStartingRegionProposalModel } = await import("./starting-region.js");
        return createStartingRegionProposalModel(runtime).propose(stageId, context);
      }
      if (stageId !== "compact-seed" && stageId !== "compact-opening") {
        throw new Error(`Unknown compact generation stage ${stageId}`);
      }
      const schema = compactStageSchema(stageId);
      const playerSource = [
        context.request.locationDescription, context.request.player.description,
        context.request.player.name ?? "", context.request.player.powerGuidance ?? "",
      ].join("\n");
      // Never silently truncate a user-authored constraint to fit the model.
      if (playerSource.length > 12_000) throw new Error(
        "Player-provided setup is too long for safe compact generation. Please shorten it without removing essential constraints.",
      );
      const briefing = stageId === "compact-seed"
        ? {
            location: context.request.locationDescription,
            playerName: context.request.player.name ?? null,
            playerDescription: context.request.player.description,
            establishedFacts: context.normalized?.player.establishedFacts ?? [],
            constraints: context.normalized?.explicitConstraints ?? [],
            normalizedLocation: context.normalized?.geographicDescription,
            settlementScale: context.normalized?.settlementScale,
          }
        : {
            player: context.playerContext && {
              name: context.playerContext.entity.name,
              goals: context.normalized?.player.currentWants ?? [],
              powerPreferences: context.normalized?.player.powerPreferences,
            },
            places: context.locality?.locations.map((place) => ({
              name: place.name, id: place.id, summary: place.summary,
            })),
            contacts: context.npcs?.map((npc) => ({ name: npc.entity.name })),
            pressures: context.pressures?.map((pressure) => ({
              category: pressure.category, summary: pressure.summary,
            })),
          };
      const prompt = {
        instructions: stageId === "compact-seed"
          ? [
              "Create a small, contemporary Awakening Earth starting neighborhood. Do not output canonical IDs or scaffolding.",
              "Preserve all explicit player facts and geographic limits. Rural does not mean preindustrial.",
              "Give one public place, one or two contacts, and concise ordinary, social, and supernatural pressures.",
              "Never invent an established player biography, relationship, promise or goal.",
            ]
          : [
              "Choose a playable supernatural incident or a mundane beginning where a first power will emerge.",
              "Mundane mode uses focus none; supernatural uses creature or phenomenon.",
              "First power manifests on meaningful turn 1, 2, or 3, not during generation.",
              "Ground visible details in the accepted scene and offer optional social, investigative and risky directions.",
              "Do not require combat, a quest, a response, or an outcome.",
            ],
        context: JSON.stringify(briefing),
        input: `Provide compact ${stageId} creative choices.`,
      };
      const trace = { operation: "starting-region-generation" as const,
        invocationId: `starting-region.${stageId}.generate` };
      const result = stageId === "compact-seed"
        ? await runtime.generate({
            prompt, output: { kind: "structured",
              schemaId: "starting-region.compact-seed.v2", schema: compactCampaignSeedProposalSchema }, trace,
          }, { generation: { temperature: 0, maxOutputTokens: 1_500 } })
        : await runtime.generate({
            prompt, output: { kind: "structured",
              schemaId: "starting-region.compact-opening.v2", schema: compactOpeningProposalSchema }, trace,
          }, { generation: { temperature: 0, maxOutputTokens: 850 } });
      if (!result.ok) throw new Error(
        `Compact ${stageId} generation failed: ${result.error.message}`);
      return result.output.value;
    },
    async repair(stageId, _candidate, _issues, context) {
      // One tightly bounded replacement invocation, never a full-world redo.
      return this.propose(stageId, context);
    },
    async audit() { return { issues: [] }; },
  };
}

/** New campaigns use three core calls: normalize, compact seed, opening.
 * Accepted checkpoints preserve the creative proposal and full expansion. */
export async function generateCompactStartingRegion(
  rawRequest: unknown,
  model: StartingRegionProposalModel,
  options: StartingRegionGenerationOptions = {},
): Promise<Awaited<ReturnType<typeof import("./starting-region.js").generateStartingRegion>>> {
  const request = startingRegionRequestSchema.parse(rawRequest);
  let state: StartingRegionWorkingState = options.resumeState
    ? startingRegionWorkingStateSchema.parse(options.resumeState)
    : { request, compactVersion: 2 };
  if (state.compactVersion !== 2) throw new Error("Legacy campaign drafts must use the legacy generator");
  if (JSON.stringify(state.request) !== JSON.stringify(request)) {
    throw new Error("Compact campaign draft request changed unexpectedly");
  }
  const diagnostics: GenerationStageDiagnostic[] = [...(options.previousDiagnostics ?? [])];
  const checkpoint = async (stageId: string, attempt = 1) => {
    diagnostics.push({ stageId, attempts: attempt, issues: [], accepted: true });
    await options.onCheckpoint?.({
      lastCompletedStageId: stageId, state, diagnostics,
    });
  };
  if (!state.normalized) {
    const candidate = await model.propose("normalize", state);
    let normalized = normalizedRegionConstraintsSchema.parse(
      normalizePlayerEstablishedFacts(candidate, state));
    let errors: readonly GenerationIssue[];
    try {
      errors = stageIssues("normalize", normalized, state);
      validateNormalizedPlayerSetup(request.player, normalized.player);
    } catch (error) {
      throw new Error(`Player normalization must preserve original source facts: ${String(error)}`);
    }
    if (errors.length) {
      const replacement = await model.repair("normalize", candidate, errors, state);
      normalized = normalizedRegionConstraintsSchema.parse(
        normalizePlayerEstablishedFacts(replacement, state));
      const retryIssues = stageIssues("normalize", normalized, state);
      if (retryIssues.length) throw new Error(retryIssues.map((issue) => issue.message).join("; "));
    }
    state = { ...state, normalized };
    await checkpoint("normalize", errors.length ? 2 : 1);
  }
  const normalized = state.normalized!;
  const questions = [
    ...normalized.followUpQuestions.map((question) => ({ ...question, scope: "region" as const })),
    ...normalized.player.followUpQuestions.map((question) => ({ ...question, scope: "player" as const })),
  ];
  if (!request.allowGeneratedDetails && questions.length) {
    return { kind: "needs-input", normalized, questions };
  }
  if (request.allowGeneratedDetails && questions.length) {
    state = { ...state, normalized: { ...normalized,
      followUpQuestions: [], player: { ...normalized.player, followUpQuestions: [] },
    } };
  }
  if (!state.compactSeed) {
    const candidate = await model.propose("compact-seed", state);
    // Save the compact model proposal, not a partially materialized world.
    const compact = compactCampaignSeedProposalSchema.parse(candidate);
    state = { ...state, compactSeed: compact };
    await checkpoint("compact-seed");
  }
  if (!state.region || !state.settlement || !state.playerContext || !state.pressures) {
    state = materializeCompactSeed(request, state, state.compactSeed);
    await checkpoint("expand-seed", 0);
  }
  if (!state.openingSituation) {
    const raw = await model.propose("compact-opening", state);
    state = materializeCompactOpening(state, raw);
    await checkpoint("compact-opening");
  }
  let seed: StartingRegionSeed = startingRegionSeedSchema.parse({
    normalized: state.normalized, region: state.region, settlement: state.settlement,
    institutions: state.institutions, locality: state.locality,
    playerContext: state.playerContext, npcs: state.npcs,
    pressures: state.pressures, creatures: state.creatures,
    knowledge: state.knowledge, processes: state.processes,
    openingSituation: state.openingSituation,
  });
  if (seed.openingSituation.supernaturalFocus !== "creature") {
    seed = { ...seed, creatures: [] };
  }
  seed = ensureUniqueStartingRegionIds(ensureOpeningCreature(seed));
  const issues = validateStartingRegionSeed(seed);
  if (issues.length) throw new Error(
    `Compact campaign cannot become playable: ${issues.map((item) => item.message).join("; ")}`);
  state = { ...state, ...seed };
  await checkpoint("finalize-seed", 0);
  const campaign = compileStartingRegionCampaign(request, seed, diagnostics);
  return { kind: "generated", seed, campaign, diagnostics, audit: { issues: [] } };
}
