import { z } from "zod";
import {
  campaignPlanDocumentSchema,
  createGameRuntime,
  createInMemoryPersistence,
  generationIssueSchema,
  loadGameDefinition,
  type CampaignPlanDocument,
  type GameSession,
  type ModelRuntime,
  type PersistencePorts,
  type WorldMetadata,
} from "@llm-ttrpg/engine";
import {
  compileStartingRegionCampaign,
  createStartingRegionProposalModel,
  generateStartingRegion,
  openingBriefFromCampaign,
  openingIncidentProposalSchema,
  realizeOpeningIncidentCampaign,
  referenceGameDefinition,
  referenceSceneSource,
  requestOpeningIncidentProposal,
  startingRegionRequestSchema,
  startingRegionSeedSchema,
  type StartingRegionRequest,
  type StartingRegionSeed,
} from "@llm-ttrpg/reference-game";
import { openApplicationDatabase } from "./database.js";
import {
  DesktopPlaySession,
  type NarrationPreference,
  type PlaySessionPersistence,
  type TranscriptEntry,
} from "./play-session.js";
import { createSqlitePersistence } from "./persistence/sqlite-persistence.js";
import type { SqlClient } from "./persistence/sql-client.js";

export interface CreateCampaignInput {
  readonly name: string;
  readonly locationDescription: string;
  readonly playerDescription: string;
  readonly powerGuidance?: string;
  readonly allowGeneratedDetails?: boolean;
  readonly followUpAnswers?: readonly CampaignFollowUpAnswer[];
}

export interface CampaignFollowUpQuestion {
  readonly id: string;
  readonly question: string;
  readonly materialImpact: string;
  readonly scope: "region" | "player";
}

export interface CampaignFollowUpAnswer extends CampaignFollowUpQuestion {
  readonly answer: string;
}

export interface CampaignCreationProgress {
  readonly current: number;
  readonly total: number;
  readonly stageId: string;
  readonly label: string;
  readonly refining: boolean;
}

export type CampaignCreationResult =
  | { readonly kind: "created"; readonly session: DesktopPlaySession }
  | { readonly kind: "needs-input"; readonly questions: readonly CampaignFollowUpQuestion[] };

export interface CampaignCreationOptions {
  readonly onProgress?: (progress: CampaignCreationProgress) => void;
}

export interface DesktopApplication {
  readonly modelRuntime?: ModelRuntime;
  createWorld(input: CreateCampaignInput | string): Promise<DesktopPlaySession>;
  createCampaign(
    input: CreateCampaignInput,
    options?: CampaignCreationOptions,
  ): Promise<CampaignCreationResult>;
  listWorlds(): Promise<readonly WorldMetadata[]>;
  openWorld(worldId: string): Promise<DesktopPlaySession>;
}

export interface DesktopApplicationOptions {
  readonly modelRuntime?: ModelRuntime;
  readonly now?: () => string;
  readonly randomId?: () => string;
  readonly nextSeed?: () => number;
}

const generationDiagnosticSchema = z.object({
  stageId: z.string().min(1),
  attempts: z.number().int().positive(),
  issues: z.array(generationIssueSchema),
  accepted: z.boolean(),
});

const generatedPackageDescriptorSchema = z.object({
  request: startingRegionRequestSchema,
  seed: startingRegionSeedSchema,
  diagnostics: z.array(generationDiagnosticSchema),
  openingProposal: openingIncidentProposalSchema,
}).strict();
type GeneratedPackageDescriptor = z.infer<typeof generatedPackageDescriptorSchema>;

const campaignGenerationStages = [
  ["normalize", "Understanding your setup"],
  ["region", "Establishing the wider region"],
  ["settlement", "Shaping the starting settlement"],
  ["institutions", "Creating local institutions"],
  ["locality", "Mapping nearby places and routes"],
  ["player-context", "Grounding your character in the world"],
  ["npcs", "Populating recurring characters"],
  ["pressures", "Seeding conflicts and supernatural pressures"],
  ["opening-situation", "Framing the opening situation"],
  ["coherence-audit", "Checking the campaign for contradictions"],
  ["opening-incident", "Realizing the opening incident"],
  ["finalize", "Saving the campaign and preparing play"],
] as const;

const campaignGenerationStageIndex = new Map<string, number>(
  campaignGenerationStages.map(([id], index) => [id, index + 1]),
);

function addFollowUpAnswers(
  description: string,
  answers: readonly CampaignFollowUpAnswer[] | undefined,
  scope: CampaignFollowUpQuestion["scope"],
): string {
  const relevant = (answers ?? []).filter((item) =>
    item.scope === scope && item.answer.trim().length > 0
  );
  if (relevant.length === 0) return description;
  const rendered = relevant.map((item) =>
    `Question: ${item.question}\nAnswer: ${item.answer.trim()}`
  ).join("\n\n");
  return `${description}\n\nAdditional player-provided setup details:\n${rendered}`;
}

const transcriptEntrySchema = z.object({
  id: z.string().min(1),
  speaker: z.enum(["player", "narrator", "npc", "system"]),
  text: z.string().min(1),
}).strict();

interface DesktopSessionRow {
  generated_package_json: string | null;
  player_actor_id: string;
  locality_scope_id: string | null;
  narration_preference: NarrationPreference;
  transcript_json: string;
}

function createIdGenerator(randomId: () => string) {
  return {
    next(kind: "world" | "checkpoint" | "slot" | "event" | "scheduled-trigger") {
      return `${kind}.${randomId().toLowerCase()}`;
    },
  };
}

function createInitialPlan(
  session: GameSession,
  playerActorId: string,
  seed: StartingRegionSeed,
  incidentId: string,
): CampaignPlanDocument {
  const basis = session.planningBasis();
  const grounding = [{ kind: "entity" as const, id: playerActorId }];
  const reviewed = { worldRevision: basis.worldRevision, eventSequence: basis.eventSequence };
  const makeThread = (
    id: string,
    horizon: "high" | "medium" | "low",
    title: string,
    summary: string,
    priority: number,
  ) => ({
    id,
    title,
    summary,
    kind: "developing-situation",
    horizon,
    priority,
    status: "active" as const,
    grounding,
    related: [{ kind: "entity" as const, id: incidentId }],
    playerInterestIds: [],
    currentTension: "How will the player's choices redirect established pressures?",
    assumptions: horizon === "low" ? [{
      id: "assumption.player-starting-location",
      summary: "The player remains at the established starting location.",
      validation: {
        kind: "exists" as const,
        reference: {
          kind: "fact" as const,
          id: `state.fact.location.${playerActorId}`,
        },
        expected: false,
      },
      status: "valid" as const,
      lastEvaluatedAt: reviewed,
    }] : [],
    conditionalDevelopments: [{
      id: `development.${horizon}.opening-pressure`,
      summary: "The established opening pressure may develop if canonical circumstances support it.",
      condition: "The incident and related pressures remain unresolved and relevant.",
      grounding: [{ kind: "entity" as const, id: incidentId }],
      rationale: "Keep a grounded possibility without scheduling an event.",
    }],
    lastReviewedAt: reviewed,
    rationale: "Start from generated player, locality, and incident material.",
  });
  const threads = [
    makeThread(
      "thread.campaign-direction",
      "high",
      "Campaign direction",
      "Develop the player's place in a changed world without prescribing an ending.",
      60,
    ),
    makeThread(
      "thread.opening-arc",
      "medium",
      "Opening arc",
      "Follow grounded consequences of the realized opening incident.",
      75,
    ),
    makeThread(
      "thread.near-term-choice",
      "low",
      "Near-term choice",
      "Attend to the player's immediate choices and accessible consequences.",
      90,
    ),
  ];
  return campaignPlanDocumentSchema.parse({
    schemaVersion: 1,
    planRevision: 0,
    basedOnWorldRevision: basis.worldRevision,
    basedOnEventSequence: basis.eventSequence,
    updatedAtFictionalTime: session.snapshot().fictionalTime,
    horizons: {
      high: {
        summary: "Keep several campaign directions and end states possible.",
        attention: ["Reuse established themes and pressures."],
        threadIds: [threads[0]!.id],
      },
      medium: {
        summary: "Develop the opening incident through consequences and relationships.",
        attention: ["Let player choices redirect the arc."],
        threadIds: [threads[1]!.id],
      },
      low: {
        summary: "Surface grounded opportunities around the player's current situation.",
        attention: ["Do not require one response to the opening."],
        threadIds: [threads[2]!.id],
      },
    },
    threads,
    playerGoals: seed.normalized.player.currentWants.map((summary, index) => ({
      id: `player-goal.generated-${index + 1}`,
      summary,
      grounding,
      active: true,
    })),
    interestSignals: [],
  });
}

async function rebuildGeneratedGame(
  descriptorValue: GeneratedPackageDescriptor,
  runtimeDependencies: (
    game: ReturnType<typeof loadGameDefinition>,
    persistence: PersistencePorts,
  ) => Parameters<typeof createGameRuntime>[0],
) {
  const descriptor = generatedPackageDescriptorSchema.parse(descriptorValue);
  const baseCampaign = compileStartingRegionCampaign(
    descriptor.request,
    descriptor.seed,
    descriptor.diagnostics,
  );
  const baseGame = loadGameDefinition({ ...referenceGameDefinition, campaign: baseCampaign });
  const temporary = await createGameRuntime(
    runtimeDependencies(baseGame, createInMemoryPersistence()),
  ).createWorld("Opening incident reconstruction");
  const context = temporary.assembleContext({
    role: "orchestrator",
    perspective: { kind: "canonical" },
    budget: { maxUnits: 50_000 },
  });
  const campaign = realizeOpeningIncidentCampaign({
    campaign: baseCampaign,
    setting: referenceGameDefinition.setting,
    world: temporary.snapshot(),
    context,
    proposal: descriptor.openingProposal,
  });
  return loadGameDefinition({ ...referenceGameDefinition, campaign });
}

export function createDesktopApplication(
  database: SqlClient,
  options: DesktopApplicationOptions = {},
): DesktopApplication {
  const persistence = createSqlitePersistence(database);
  const now = options.now ?? (() => new Date().toISOString());
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const nextSeed = options.nextSeed ?? (() => {
    const seed = new Uint32Array(1);
    crypto.getRandomValues(seed);
    return seed[0]!;
  });
  const dependencies = (
    game: ReturnType<typeof loadGameDefinition>,
    selectedPersistence: PersistencePorts = persistence,
  ) => ({
    persistence: selectedPersistence,
    wallClock: { now },
    idGenerator: createIdGenerator(randomId),
    worldSeedSource: { nextSeed },
    game,
    context: { sceneSource: referenceSceneSource },
  });
  const presentationPersistence: PlaySessionPersistence = {
    async savePresentation(input) {
      await database.execute(
        "UPDATE desktop_play_sessions SET narration_preference = ?, transcript_json = ? WHERE world_id = ?",
        [input.narrationPreference, JSON.stringify(input.transcript), input.worldId],
      );
    },
  };

  async function sessionRow(worldId: string): Promise<DesktopSessionRow | undefined> {
    const rows = await database.select<DesktopSessionRow[]>(
      "SELECT generated_package_json, player_actor_id, locality_scope_id, narration_preference, transcript_json FROM desktop_play_sessions WHERE world_id = $1",
      [worldId],
    );
    return rows[0];
  }

  async function wrap(
    session: GameSession,
    row: DesktopSessionRow,
  ): Promise<DesktopPlaySession> {
    const transcript = z.array(transcriptEntrySchema).parse(
      JSON.parse(row.transcript_json),
    ) as TranscriptEntry[];
    return new DesktopPlaySession(
      session,
      options.modelRuntime,
      row.player_actor_id,
      row.locality_scope_id ?? undefined,
      { transcript, narrationPreference: row.narration_preference },
      presentationPersistence,
    );
  }

  async function createGeneratedCampaign(
    inputValue: CreateCampaignInput,
    creationOptions: CampaignCreationOptions = {},
  ): Promise<CampaignCreationResult> {
    if (!options.modelRuntime) {
      throw new Error("A configured local model is required to generate a new campaign");
    }
    const report = (stageId: string, refining = false) => {
      const current = campaignGenerationStageIndex.get(stageId);
      const stage = campaignGenerationStages.find(([id]) => id === stageId);
      if (!current || !stage) return;
      creationOptions.onProgress?.({
        current,
        total: campaignGenerationStages.length,
        stageId,
        label: refining ? `Refining: ${stage[1]}` : stage[1],
        refining,
      });
    };
    const input = {
      name: inputValue.name.trim() || "Untitled campaign",
      locationDescription: addFollowUpAnswers(
        inputValue.locationDescription.trim(),
        inputValue.followUpAnswers,
        "region",
      ),
      playerDescription: addFollowUpAnswers(
        inputValue.playerDescription.trim(),
        inputValue.followUpAnswers,
        "player",
      ),
      allowGeneratedDetails: inputValue.allowGeneratedDetails ?? false,
      ...(inputValue.powerGuidance?.trim()
        ? { powerGuidance: inputValue.powerGuidance.trim() }
        : {}),
    };
    const request: StartingRegionRequest = startingRegionRequestSchema.parse({
      locationDescription: input.locationDescription,
      player: {
        description: input.playerDescription,
        ...(input.powerGuidance ? { powerGuidance: input.powerGuidance } : {}),
      },
      startTime: now(),
      campaignId: `campaign.generated-${randomId().toLowerCase()}`,
      controlSeed: nextSeed(),
      allowGeneratedDetails: input.allowGeneratedDetails,
    });
    const proposalModel = createStartingRegionProposalModel(options.modelRuntime);
    const generated = await generateStartingRegion(request, {
      propose(stageId, context) {
        report(stageId);
        return proposalModel.propose(stageId, context);
      },
      repair(stageId, candidate, issues, context) {
        report(stageId, true);
        return proposalModel.repair(stageId, candidate, issues, context);
      },
      audit(seed, context) {
        report("coherence-audit");
        return proposalModel.audit(seed, context);
      },
    });
    if (generated.kind === "needs-input") {
      return { kind: "needs-input", questions: generated.questions };
    }
    const baseGame = loadGameDefinition({
      ...referenceGameDefinition,
      campaign: generated.campaign,
    });
    const temporary = await createGameRuntime(
      dependencies(baseGame, createInMemoryPersistence()),
    ).createWorld("Opening incident proposal context");
    const protectedContext = temporary.assembleContext({
      role: "orchestrator",
      perspective: { kind: "canonical" },
      budget: { maxUnits: 50_000 },
    });
    report("opening-incident");
    const openingProposal = await requestOpeningIncidentProposal({
      modelRuntime: options.modelRuntime,
      context: protectedContext,
      openingBrief: openingBriefFromCampaign(generated.campaign),
    });
    report("finalize");
    const campaign = realizeOpeningIncidentCampaign({
      campaign: generated.campaign,
      setting: referenceGameDefinition.setting,
      world: temporary.snapshot(),
      context: protectedContext,
      proposal: openingProposal,
    });
    const game = loadGameDefinition({ ...referenceGameDefinition, campaign });
    const session = await createGameRuntime(dependencies(game)).createWorld(input.name);
    const playerActorId = generated.seed.playerContext.entity.id;
    const localityScopeId = `scope.${generated.seed.locality.id}`;
    const descriptor = generatedPackageDescriptorSchema.parse({
      request,
      seed: generated.seed,
      diagnostics: generated.diagnostics,
      openingProposal,
    });
    await database.execute(
      "INSERT INTO desktop_play_sessions(world_id, generated_package_json, player_actor_id, locality_scope_id, narration_preference, transcript_json) VALUES ($1, $2, $3, $4, 'standard', '[]')",
      [session.worldId, JSON.stringify(descriptor), playerActorId, localityScopeId],
    );
    await session.initializeCampaignPlan(createInitialPlan(
      session,
      playerActorId,
      generated.seed,
      openingProposal.incident.id,
    ));
    return { kind: "created", session: await wrap(session, (await sessionRow(session.worldId))!) };
  }

  return {
    ...(options.modelRuntime ? { modelRuntime: options.modelRuntime } : {}),
    listWorlds() {
      return persistence.worlds.list();
    },
    createCampaign: createGeneratedCampaign,
    async createWorld(inputValue) {
      if (typeof inputValue === "string") {
        const game = loadGameDefinition(referenceGameDefinition);
        const session = await createGameRuntime(dependencies(game)).createWorld(inputValue);
        const playerActorId = session.snapshot().actorSocialStates[0]?.actorId ??
          session.snapshot().entities.find((entity) => entity.kind === "actor")?.id;
        if (!playerActorId) throw new Error("Campaign has no player actor");
        await database.execute(
          "INSERT INTO desktop_play_sessions(world_id, generated_package_json, player_actor_id, locality_scope_id, narration_preference, transcript_json) VALUES ($1, NULL, $2, NULL, 'standard', '[]')",
          [session.worldId, playerActorId],
        );
        return wrap(session, (await sessionRow(session.worldId))!);
      }
      const result = await createGeneratedCampaign(inputValue);
      if (result.kind === "needs-input") {
        throw new Error(result.questions.map((question) => question.question).join(" "));
      }
      return result.session;
    },
    async openWorld(worldId) {
      const row = await sessionRow(worldId);
      if (!row) {
        throw new Error(`Playable session metadata is missing for world ${worldId}`);
      }
      const game = row.generated_package_json
        ? await rebuildGeneratedGame(
            generatedPackageDescriptorSchema.parse(
              JSON.parse(row.generated_package_json),
            ),
            dependencies,
          )
        : loadGameDefinition(referenceGameDefinition);
      const session = await createGameRuntime(dependencies(game)).openWorld(worldId);
      return wrap(session, row);
    },
  };
}

export async function startDesktopApplication(
  options: DesktopApplicationOptions = {},
): Promise<DesktopApplication> {
  return createDesktopApplication(await openApplicationDatabase(), options);
}
