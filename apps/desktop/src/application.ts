import { z } from "zod";
import {
  campaignPlanDocumentSchema,
  compileNarrationDirective,
  createGameRuntime,
  createInMemoryPersistence,
  generationIssueSchema,
  generationStageDiagnosticSchema,
  deriveSceneRegister,
  loadGameDefinition,
  renderContextForModel,
  type CampaignPlanDocument,
  type GameSession,
  type ModelRuntime,
  type PersistencePorts,
  type WorldMetadata,
} from "@llm-ttrpg/engine";
import {
  compileStartingRegionCampaign,
  createStartingRegionProposalModel,
  ensureOpeningCreature,
  generateStartingRegion,
  openingBriefFromCampaign,
  openingIncidentProposalSchema,
  realizeOpeningIncidentCampaign,
  referenceGameDefinition,
  referenceSceneSource,
  requestOpeningIncidentProposal,
  startingRegionRequestSchema,
  startingRegionSeedSchema,
  startingRegionWorkingStateSchema,
  type StartingRegionRequest,
  type StartingRegionSeed,
  type StartingRegionWorkingState,
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
  | {
      readonly kind: "needs-input";
      readonly draftId: string;
      readonly questions: readonly CampaignFollowUpQuestion[];
    };

export type CampaignGenerationDraftStatus = "generating" | "needs-input" | "failed";

export interface CampaignGenerationDraft {
  readonly id: string;
  readonly name: string;
  readonly input: CreateCampaignInput;
  readonly status: CampaignGenerationDraftStatus;
  readonly questions: readonly CampaignFollowUpQuestion[];
  readonly lastCompletedStageId?: string;
  readonly errorMessage?: string;
  readonly updatedAt: string;
}

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
  listCampaignDrafts(): Promise<readonly CampaignGenerationDraft[]>;
  resumeCampaign(
    draftId: string,
    options?: CampaignCreationOptions,
  ): Promise<CampaignCreationResult>;
  answerCampaignQuestions(
    draftId: string,
    answers: readonly CampaignFollowUpAnswer[],
    allowGeneratedDetails: boolean,
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

const campaignFollowUpQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  materialImpact: z.string().min(1),
  scope: z.enum(["region", "player"]),
}).strict();

const campaignFollowUpAnswerSchema = campaignFollowUpQuestionSchema.extend({
  answer: z.string(),
}).strict();

const createCampaignInputSchema = z.object({
  name: z.string(),
  locationDescription: z.string(),
  playerDescription: z.string(),
  powerGuidance: z.string().optional(),
  allowGeneratedDetails: z.boolean().optional(),
  followUpAnswers: z.array(campaignFollowUpAnswerSchema).optional(),
}).strict();

const completedStartingRegionSchema = z.object({
  seed: startingRegionSeedSchema,
  diagnostics: z.array(generationStageDiagnosticSchema),
}).strict();

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

interface CampaignGenerationDraftRow {
  id: string;
  name: string;
  input_json: string;
  request_json: string;
  state_json: string;
  diagnostics_json: string;
  generated_json: string | null;
  opening_proposal_json: string | null;
  status: CampaignGenerationDraftStatus;
  questions_json: string | null;
  last_completed_stage_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
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

  async function createOpeningNarration(
    session: GameSession,
    row: DesktopSessionRow,
    descriptor: GeneratedPackageDescriptor,
  ): Promise<TranscriptEntry> {
    const proposal = descriptor.openingProposal;
    const world = session.snapshot();
    const player = world.entities.find((entity) => entity.id === row.player_actor_id);
    const currentLocation = world.facts.find((fact) =>
      fact.subjectId === row.player_actor_id && fact.predicate === "actor.current-location"
    )?.value ?? player?.data.currentLocation;
    const locationId = typeof currentLocation === "string" ? currentLocation : undefined;
    const context = session.assembleContext({
      role: "actor",
      perspective: { kind: "actor", id: row.player_actor_id },
      focalActorId: row.player_actor_id,
      ...(locationId ? { locationId } : {}),
      budget: { maxUnits: 30_000 },
    });
    const fallback = [
      proposal.incident.name,
      proposal.incident.summary,
      ...proposal.incident.observedFacts
        .filter((fact) => fact.visibility === "public")
        .map((fact) => typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value)),
    ].map((part) => part.trim()).filter(Boolean).join("\n\n");
    let narration = fallback;
    if (options.modelRuntime) {
      const pressure = world.actionPressure.status === "assessed"
        ? world.actionPressure.level
        : "unassessed";
      const directive = compileNarrationDirective(
        referenceGameDefinition.presentation.narrationProfile,
        deriveSceneRegister({
          kind: "opening",
          actionPressure: pressure,
          authorizedHorizonMs: 0,
          elapsedMs: 0,
        }),
      );
      const result = await options.modelRuntime.generate({
        prompt: {
          protectedContext: [directive.protectedContext],
          instructions: [
            "Open the campaign using the protected narration profile.",
            "Narrate only what the player character can immediately perceive from the authorized context and canonical opening material.",
            "Do not invent world changes, private knowledge, player actions, player speech, player thoughts, mechanics, or GM commentary.",
            "Establish the place, the immediate supernatural tension, and concrete sensory details, then leave the player's response completely open.",
            "Do not ask a meta-level question such as what the player wants to do.",
            "Target 500-900 characters.",
          ],
          context: renderContextForModel(context),
          input: JSON.stringify({
            incident: {
              name: proposal.incident.name,
              summary: proposal.incident.summary,
              observedFacts: proposal.incident.observedFacts.filter((fact) =>
                fact.visibility === "public"
              ).map((fact) => ({ predicate: fact.predicate, value: fact.value })),
              contactObject: {
                name: proposal.incident.contactObject.name,
                summary: proposal.incident.contactObject.summary,
              },
            },
            creatureObservedTraits: proposal.creature.observedTraits,
            publicResponse: {
              observedThreat: proposal.publicResponse.observedThreat,
              status: "reported",
            },
          }),
        },
        output: { kind: "text" },
        trace: { operation: "desktop.opening-narration.v1" },
      }, {
        timeoutMs: 5 * 60 * 1_000,
        generation: { temperature: 0.4, maxOutputTokens: 512 },
      });
      if (result.ok && result.output.text.trim()) narration = result.output.text.trim();
    }
    const entry = transcriptEntrySchema.parse({
      id: `transcript.${randomId().toLowerCase()}`,
      speaker: "narrator",
      text: narration,
    }) as TranscriptEntry;
    await database.execute(
      "UPDATE desktop_play_sessions SET transcript_json = ? WHERE world_id = ?",
      [JSON.stringify([entry]), session.worldId],
    );
    return entry;
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
      row.generated_package_json
        ? () => createOpeningNarration(
            session,
            row,
            generatedPackageDescriptorSchema.parse(JSON.parse(row.generated_package_json!)),
          )
        : undefined,
    );
  }

  async function draftRow(draftId: string): Promise<CampaignGenerationDraftRow | undefined> {
    const rows = await database.select<CampaignGenerationDraftRow[]>(
      "SELECT * FROM campaign_generation_drafts WHERE id = ?",
      [draftId],
    );
    return rows[0];
  }

  function draftSummary(row: CampaignGenerationDraftRow): CampaignGenerationDraft {
    return {
      id: row.id,
      name: row.name,
      input: createCampaignInputSchema.parse(JSON.parse(row.input_json)),
      status: row.status,
      questions: row.questions_json
        ? z.array(campaignFollowUpQuestionSchema).parse(JSON.parse(row.questions_json))
        : [],
      ...(row.last_completed_stage_id
        ? { lastCompletedStageId: row.last_completed_stage_id }
        : {}),
      ...(row.error_message ? { errorMessage: row.error_message } : {}),
      updatedAt: row.updated_at,
    };
  }

  function normalizeCampaignInput(inputValue: CreateCampaignInput): CreateCampaignInput {
    return createCampaignInputSchema.parse({
      name: inputValue.name.trim() || "Untitled campaign",
      locationDescription: inputValue.locationDescription.trim(),
      playerDescription: inputValue.playerDescription.trim(),
      allowGeneratedDetails: inputValue.allowGeneratedDetails ?? false,
      ...(inputValue.powerGuidance?.trim()
        ? { powerGuidance: inputValue.powerGuidance.trim() }
        : {}),
      ...(inputValue.followUpAnswers
        ? { followUpAnswers: inputValue.followUpAnswers }
        : {}),
    });
  }

  function requestForInput(
    input: CreateCampaignInput,
    stable?: StartingRegionRequest,
  ): StartingRegionRequest {
    return startingRegionRequestSchema.parse({
      locationDescription: addFollowUpAnswers(
        input.locationDescription,
        input.followUpAnswers,
        "region",
      ),
      player: {
        description: addFollowUpAnswers(
          input.playerDescription,
          input.followUpAnswers,
          "player",
        ),
        ...(input.powerGuidance ? { powerGuidance: input.powerGuidance } : {}),
      },
      startTime: stable?.startTime ?? now(),
      campaignId: stable?.campaignId ?? `campaign.generated-${randomId().toLowerCase()}`,
      controlSeed: stable?.controlSeed ?? nextSeed(),
      allowGeneratedDetails: input.allowGeneratedDetails ?? false,
    });
  }

  async function runCampaignDraft(
    draftId: string,
    creationOptions: CampaignCreationOptions = {},
  ): Promise<CampaignCreationResult> {
    if (!options.modelRuntime) {
      throw new Error("A configured local model is required to generate a new campaign");
    }
    const stored = await draftRow(draftId);
    if (!stored) throw new Error(`Campaign generation draft ${draftId} does not exist`);
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
    const input = createCampaignInputSchema.parse(JSON.parse(stored.input_json));
    const request = startingRegionRequestSchema.parse(JSON.parse(stored.request_json));

    await database.execute(
      "UPDATE campaign_generation_drafts SET status = 'generating', error_message = NULL, updated_at = ? WHERE id = ?",
      [now(), draftId],
    );

    try {
      let completed = stored.generated_json
        ? completedStartingRegionSchema.parse(JSON.parse(stored.generated_json))
        : undefined;
      if (completed) {
        const normalizedSeed = ensureOpeningCreature(completed.seed);
        if (normalizedSeed !== completed.seed) {
          completed = completedStartingRegionSchema.parse({
            ...completed,
            seed: normalizedSeed,
          });
          await database.execute(
            "UPDATE campaign_generation_drafts SET generated_json = ?, updated_at = ? WHERE id = ?",
            [JSON.stringify(completed), now(), draftId],
          );
        }
      }
      let baseCampaign: ReturnType<typeof compileStartingRegionCampaign>;
      if (!completed) {
        const proposalModel = createStartingRegionProposalModel(options.modelRuntime);
        const previousDiagnostics = z.array(generationStageDiagnosticSchema).parse(
          JSON.parse(stored.diagnostics_json),
        );
        const resumeState = startingRegionWorkingStateSchema.parse(
          JSON.parse(stored.state_json),
        ) as StartingRegionWorkingState;
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
        }, {
          resumeState,
          previousDiagnostics,
          async onCheckpoint(checkpoint) {
            await database.execute(
              "UPDATE campaign_generation_drafts SET state_json = ?, diagnostics_json = ?, last_completed_stage_id = ?, status = 'generating', questions_json = NULL, error_message = NULL, updated_at = ? WHERE id = ?",
              [
                JSON.stringify(checkpoint.state),
                JSON.stringify(checkpoint.diagnostics),
                checkpoint.lastCompletedStageId,
                now(),
                draftId,
              ],
            );
          },
        });
        if (generated.kind === "needs-input") {
          await database.execute(
            "UPDATE campaign_generation_drafts SET status = 'needs-input', questions_json = ?, error_message = NULL, updated_at = ? WHERE id = ?",
            [JSON.stringify(generated.questions), now(), draftId],
          );
          return {
            kind: "needs-input",
            draftId,
            questions: generated.questions,
          };
        }
        completed = completedStartingRegionSchema.parse({
          seed: generated.seed,
          diagnostics: generated.diagnostics,
        });
        await database.execute(
          "UPDATE campaign_generation_drafts SET generated_json = ?, last_completed_stage_id = 'coherence-audit', updated_at = ? WHERE id = ?",
          [JSON.stringify(completed), now(), draftId],
        );
        baseCampaign = generated.campaign;
      } else {
        baseCampaign = compileStartingRegionCampaign(
          request,
          completed.seed,
          completed.diagnostics,
        );
      }

      const baseGame = loadGameDefinition({
        ...referenceGameDefinition,
        campaign: baseCampaign,
      });
      const temporary = await createGameRuntime(
        dependencies(baseGame, createInMemoryPersistence()),
      ).createWorld("Opening incident proposal context");
      const protectedContext = temporary.assembleContext({
        role: "orchestrator",
        perspective: { kind: "canonical" },
        budget: { maxUnits: 50_000 },
      });
      let openingProposal = stored.opening_proposal_json
        ? openingIncidentProposalSchema.parse(JSON.parse(stored.opening_proposal_json))
        : undefined;
      if (!openingProposal) {
        report("opening-incident");
        openingProposal = await requestOpeningIncidentProposal({
          modelRuntime: options.modelRuntime,
          context: protectedContext,
          campaign: baseCampaign,
          openingBrief: openingBriefFromCampaign(baseCampaign),
          options: {
            timeoutMs: 20 * 60 * 1_000,
            generation: { temperature: 0, maxOutputTokens: 1_024 },
          },
        });
        await database.execute(
          "UPDATE campaign_generation_drafts SET opening_proposal_json = ?, last_completed_stage_id = 'opening-incident', updated_at = ? WHERE id = ?",
          [JSON.stringify(openingProposal), now(), draftId],
        );
      }
      report("finalize");
      const campaign = realizeOpeningIncidentCampaign({
        campaign: baseCampaign,
        setting: referenceGameDefinition.setting,
        world: temporary.snapshot(),
        context: protectedContext,
        proposal: openingProposal,
      });
      const game = loadGameDefinition({ ...referenceGameDefinition, campaign });
      const session = await createGameRuntime(dependencies(game)).createWorld(input.name);
      const playerActorId = completed.seed.playerContext.entity.id;
      const localityScopeId = `scope.${completed.seed.locality.id}`;
      const descriptor = generatedPackageDescriptorSchema.parse({
        request,
        seed: completed.seed,
        diagnostics: completed.diagnostics,
        openingProposal,
      });
      await database.execute(
        "INSERT INTO desktop_play_sessions(world_id, generated_package_json, player_actor_id, locality_scope_id, narration_preference, transcript_json) VALUES ($1, $2, $3, $4, 'standard', '[]')",
        [session.worldId, JSON.stringify(descriptor), playerActorId, localityScopeId],
      );
      await session.initializeCampaignPlan(createInitialPlan(
        session,
        playerActorId,
        completed.seed,
        openingProposal.incident.id,
      ));
      const row = await sessionRow(session.worldId);
      if (!row) throw new Error(`Playable session metadata is missing for world ${session.worldId}`);
      const wrapped = await wrap(session, row);
      await wrapped.prepareOpening();
      await database.execute("DELETE FROM campaign_generation_drafts WHERE id = ?", [draftId]);
      return { kind: "created", session: wrapped };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await database.execute(
        "UPDATE campaign_generation_drafts SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?",
        [message, now(), draftId],
      );
      throw error;
    }
  }

  async function createGeneratedCampaign(
    inputValue: CreateCampaignInput,
    creationOptions: CampaignCreationOptions = {},
  ): Promise<CampaignCreationResult> {
    if (!options.modelRuntime) {
      throw new Error("A configured local model is required to generate a new campaign");
    }
    const input = normalizeCampaignInput(inputValue);
    const request = requestForInput(input);
    const draftId = `draft.${randomId().toLowerCase()}`;
    const timestamp = now();
    await database.execute(
      "INSERT INTO campaign_generation_drafts(id, name, input_json, request_json, state_json, diagnostics_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '[]', 'generating', ?, ?)",
      [
        draftId,
        input.name,
        JSON.stringify(input),
        JSON.stringify(request),
        JSON.stringify({ request }),
        timestamp,
        timestamp,
      ],
    );
    return runCampaignDraft(draftId, creationOptions);
  }

  return {
    ...(options.modelRuntime ? { modelRuntime: options.modelRuntime } : {}),
    listWorlds() {
      return persistence.worlds.list();
    },
    async listCampaignDrafts() {
      const rows = await database.select<CampaignGenerationDraftRow[]>(
        "SELECT * FROM campaign_generation_drafts ORDER BY updated_at DESC",
      );
      return rows.map(draftSummary);
    },
    createCampaign: createGeneratedCampaign,
    resumeCampaign(draftId, creationOptions) {
      return runCampaignDraft(draftId, creationOptions);
    },
    async answerCampaignQuestions(
      draftId,
      answers,
      allowGeneratedDetails,
      creationOptions,
    ) {
      const stored = await draftRow(draftId);
      if (!stored) throw new Error(`Campaign generation draft ${draftId} does not exist`);
      const previousInput = createCampaignInputSchema.parse(JSON.parse(stored.input_json));
      const previousRequest = startingRegionRequestSchema.parse(JSON.parse(stored.request_json));
      const input = normalizeCampaignInput({
        ...previousInput,
        allowGeneratedDetails,
        followUpAnswers: z.array(campaignFollowUpAnswerSchema).parse(answers),
      });
      const request = requestForInput(input, previousRequest);
      await database.execute(
        "UPDATE campaign_generation_drafts SET input_json = ?, request_json = ?, state_json = ?, diagnostics_json = '[]', generated_json = NULL, opening_proposal_json = NULL, status = 'generating', questions_json = NULL, last_completed_stage_id = NULL, error_message = NULL, updated_at = ? WHERE id = ?",
        [
          JSON.stringify(input),
          JSON.stringify(request),
          JSON.stringify({ request }),
          now(),
          draftId,
        ],
      );
      return runCampaignDraft(draftId, creationOptions);
    },
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
