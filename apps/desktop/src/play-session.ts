import {
  compileNarrationDirective,
  deriveSceneRegister,
  buildPresentationBeat,
  prepareModelBrief,
  observableEventSummaries,
  validatePresentedText,
  fictionalDurationMs,
  maximumResolutionHorizon,
  chooseScenePressure,
  scenePressureSources,
  jsonValueSchema,
  observeModelRuntime,
  classifyTurnDeclaration,
  projectContinuity,
  recallContinuity,
  performConversationTurn,
  renderContextForModel,
  reviewCampaignDirection,
  selectCampaignReview,
  changedPlanningSources,
  type CampaignReviewDiagnostic,
  type ConversationWorkingState,
  type GameSession,
  type JsonValue,
  type ModelRuntime,
  type ModelCallDiagnostic,
  type PlanRevisionDiagnostic,
} from "@llm-ttrpg/engine";
import {
  createPowerProposalModel,
  firstPowerGenerationRequest,
  openingProgressionStateSchema,
  referenceConversationBindings,
  referenceGameDefinition,
  rulesActorStateSchema,
  type OpeningProgressionState,
} from "@llm-ttrpg/reference-game";
import { projectCharacterSheet, type CharacterSheetView } from "./character-sheet.js";

export type NarrationPreference = "concise" | "standard" | "expansive";

export interface TranscriptEntry {
  readonly id: string;
  readonly speaker: "player" | "narrator" | "npc" | "system";
  readonly text: string;
  /** Visible speaker label for player-accessible historical dialogue (not canon). */
  readonly speakerName?: string;
}

export type TurnProgressPhase =
  | "understanding"
  | "resolving"
  | "responding"
  | "updating"
  | "presenting";

export interface TurnProgress {
  readonly phase: TurnProgressPhase;
  readonly label: string;
}

export type TurnProgressListener = (view: PlaySessionView) => void;

export type WorldRecordCounts = Readonly<Record<
  "entities" | "facts" | "beliefs" | "actorSocialStates" | "documents" |
    "simulationCursors" | "mechanicalRealizations" | "events",
  number
>>;

export interface TurnPerformanceDiagnostic {
  readonly turnId: string;
  readonly totalWallMs: number;
  /** Sum of measured invocation durations; overlapping calls are counted separately. */
  readonly modelWorkMs: number;
  readonly modelCallCount: number;
  readonly failedModelCallCount: number;
  readonly callsByPhase: Readonly<Record<string, number>>;
  readonly calls: readonly (ModelCallDiagnostic & { readonly attemptIndex: number })[];
  /** Only provider-reported token counts. Missing metadata is not inferred as zero. */
  readonly reportedInputTokens?: number;
  readonly reportedOutputTokens?: number;
  readonly callsMissingInputTokens: number;
  readonly callsMissingOutputTokens: number;
  readonly promptCharacters: number;
  readonly outcome: "resolved" | "needs-player-input" | "failed" | "committed-presentation-failed";
}

function recordCounts(
  world: ReturnType<GameSession["snapshot"]>,
  eventSequence: number,
): WorldRecordCounts {
  return {
    entities: world.entities.length,
    facts: world.facts.length,
    beliefs: world.beliefs.length,
    actorSocialStates: world.actorSocialStates.length,
    documents: world.documents.length,
    simulationCursors: world.simulationCursors.length,
    mechanicalRealizations: world.mechanicalRealizations.length,
    events: eventSequence,
  };
}

function recordDelta(before: WorldRecordCounts, after: WorldRecordCounts): WorldRecordCounts {
  return {
    entities: after.entities - before.entities,
    facts: after.facts - before.facts,
    beliefs: after.beliefs - before.beliefs,
    actorSocialStates: after.actorSocialStates - before.actorSocialStates,
    documents: after.documents - before.documents,
    simulationCursors: after.simulationCursors - before.simulationCursors,
    mechanicalRealizations: after.mechanicalRealizations - before.mechanicalRealizations,
    events: after.events - before.events,
  };
}

function aggregatePerformance(
  turnId: string,
  startedAt: number,
  calls: readonly ModelCallDiagnostic[],
  turnOutcome: TurnPerformanceDiagnostic["outcome"],
): TurnPerformanceDiagnostic {
    const totalWallMs = Math.max(0, nowMs() - startedAt);
    const modelWorkMs = calls.reduce((sum, call) => sum + call.elapsedWallMs, 0);
    const countsByPhase: Record<string, number> = {};
    const attempts = new Map<string, number>();
    const measuredCalls = calls.map((call) => {
      countsByPhase[call.phase] = (countsByPhase[call.phase] ?? 0) + 1;
      const key = `${call.phase}:${call.operation ?? ""}:${call.schemaId ?? ""}`;
      const attemptIndex = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attemptIndex);
      return { ...call, attemptIndex };
    });
    const reportedInput = calls.filter((call) => call.inputTokens !== undefined);
    const reportedOutput = calls.filter((call) => call.outputTokens !== undefined);
    const performance: TurnPerformanceDiagnostic = {
      turnId,
      totalWallMs,
      modelWorkMs,
      modelCallCount: calls.length,
      failedModelCallCount: calls.filter((call) => call.status !== "ok").length,
      callsByPhase: countsByPhase,
      calls: measuredCalls,
      ...(reportedInput.length
        ? { reportedInputTokens: reportedInput.reduce((sum, call) => sum + call.inputTokens!, 0) }
        : {}),
      ...(reportedOutput.length
        ? { reportedOutputTokens: reportedOutput.reduce((sum, call) => sum + call.outputTokens!, 0) }
        : {}),
      callsMissingInputTokens: calls.length - reportedInput.length,
      callsMissingOutputTokens: calls.length - reportedOutput.length,
      promptCharacters: calls.reduce((sum, call) => sum + call.promptCharacters, 0),
      outcome: turnOutcome,
    };
    return performance;
}

export interface TurnDiagnostics {
  readonly declaration: string;
  readonly route: "action" | "conversation";
  readonly worldRevisionBefore: number;
  readonly worldRevisionAfter: number;
  readonly fictionalTimeBefore: string;
  readonly fictionalTimeAfter: string;
  readonly modelMs: number;
  readonly deterministicAndApplicationMs: number;
  readonly modelTimingAvailable: boolean;
  readonly eventCountBefore: number;
  readonly eventCountAfter: number;
  readonly actionTrace?: JsonValue;
  readonly planner?: PlanRevisionDiagnostic | { readonly error: string };
  /** Every submitted play turn reports why planning ran or safely skipped. */
  readonly plannerReview?: CampaignReviewDiagnostic | {
    readonly reason: "routine" | "unrelated" | "no-plan" | "historical-recall";
    readonly historyQueryCount: 0 | 1;
    readonly modelCalls: 0;
    readonly noOp: true;
    readonly planRevisionBefore?: number;
    readonly planRevisionAfter?: number;
  };
  readonly narrationStatus: "complete" | "failed";
  /** Legacy absolute after-state totals; retained for existing developer consumers. */
  readonly growth: WorldRecordCounts;
  readonly stateCounts: {
    readonly before: WorldRecordCounts;
    readonly after: WorldRecordCounts;
    readonly delta: WorldRecordCounts;
  };
  readonly performance: TurnPerformanceDiagnostic;
  /** Derived memory-work diagnostics. Actual provider tokens are in performance. */
  readonly continuity?: ReturnType<typeof projectContinuity>["diagnostics"];
  readonly continuityBoundary?: {
    readonly reason: "scene-transition" | "time-jump";
    readonly scope: "location" | "actor";
    readonly diagnostics: ReturnType<typeof projectContinuity>["diagnostics"];
  };
}

export interface PlaySessionView {
  readonly worldId: string;
  readonly playerActorId: string;
  readonly playerName: string;
  readonly characterSheet?: CharacterSheetView;
  readonly currentLocationId?: string;
  readonly currentLocationName?: string;
  readonly fictionalTime: string;
  readonly narrationPreference: NarrationPreference;
  readonly transcript: readonly TranscriptEntry[];
  readonly busy: boolean;
  readonly preparingOpening: boolean;
  readonly turnProgress?: TurnProgress;
  readonly canRetryOpeningManifestation: boolean;
  readonly error?: string;
  readonly diagnostics?: TurnDiagnostics;
  readonly recentPerformance?: readonly TurnPerformanceDiagnostic[];
  readonly openingProgression?: {
    readonly playerTurnsSinceStart: number;
    readonly manifestationDeadlineTurns: 3;
    readonly firstPowerManifested: boolean;
  };
}

export interface PlaySessionPersistence {
  savePresentation(input: {
    readonly worldId: string;
    readonly narrationPreference: NarrationPreference;
    readonly transcript: readonly TranscriptEntry[];
    readonly openingProgression?: OpeningProgressionState;
  }): Promise<void>;
}

const ROUTING_CONTEXT_BUDGET_UNITS = 8_000;
const ACTION_CONTEXT_BUDGET_UNITS = 12_000;
const ACTION_MAX_MODEL_TURNS = 6;

/** A tightly scoped recollection request, never an instruction to change the world.
 * Addressed speech ("I ask Mara...") is not intercepted. */
function historicalRecallQuestion(declaration: string):
  | { readonly speakerName?: string; readonly query: string; readonly topic?: string }
  | undefined {
  const trimmed = declaration.trim().replace(/[?.!]$/, "").trim();
  const withoutPreface = trimmed.replace(
    /^(?:(?:please |can you )?remind me |do you remember )/i, "",
  );
  const spoken = withoutPreface.match(
    /^what did ([a-z][a-z0-9 .'-]{0,75}?) (?:say|tell me|mention)(?: (?:about|regarding) (.+?))?(?: (?:yesterday|earlier|last night|last week|last time))?$/i,
  ) ?? withoutPreface.match(
    /^what ([a-z][a-z0-9 .'-]{0,75}?) (?:said|told me|mentioned)(?: (?:about|regarding) (.+?))?$/i,
  );
  if (spoken) return {
    speakerName: spoken[1]!.trim(),
    query: trimmed,
    ...(spoken[2] ? { topic: spoken[2].trim() } : {}),
  };
  if (/^what happened (?:to|at|with) .+/i.test(withoutPreface)) {
    return { query: withoutPreface };
  }
  return undefined;
}

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function asJson(value: unknown): JsonValue {
  return jsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DesktopPlaySession {
  private transcriptEntries: TranscriptEntry[];
  private preference: NarrationPreference;
  private workingConversation?: ConversationWorkingState;
  private active = false;
  private preparingOpening = false;
  private turnProgress?: TurnProgress;
  private lastError?: string;
  private lastDiagnostics?: TurnDiagnostics;
  private pendingPlannerEscalation = false;
  private lastContinuityDiagnostics?: ReturnType<typeof projectContinuity>["diagnostics"];
  private lastBoundaryContinuityDiagnostics?: TurnDiagnostics["continuityBoundary"];
  private readonly observedModelRuntime?: ModelRuntime;
  private activeCalls?: ModelCallDiagnostic[];
  private readonly recentPerformanceEntries: TurnPerformanceDiagnostic[] = [];
  private readonly diagnosticsEnabled: boolean;
  private lastActionRequest?: {
    readonly actionId: string;
    readonly actorId: string;
    readonly declaration: string;
    readonly locationId?: string;
    readonly budget: { readonly maxUnits: number };
  };
  private pendingActionClarification?: {
    readonly declaration: string;
    readonly question: string;
    readonly segmentActionId?: string;
  };
  private openingProgression?: OpeningProgressionState;

  constructor(
    private readonly session: GameSession,
    private readonly modelRuntime: ModelRuntime | undefined,
    readonly playerActorId: string,
    private readonly localityScopeId: string | undefined,
    initial: {
      readonly transcript?: readonly TranscriptEntry[];
      readonly narrationPreference?: NarrationPreference;
      readonly openingProgression?: OpeningProgressionState;
      readonly diagnosticsEnabled?: boolean;
    } = {},
    private readonly presentationPersistence?: PlaySessionPersistence,
    private readonly openingNarration?: () => Promise<TranscriptEntry>,
  ) {
    this.diagnosticsEnabled = initial.diagnosticsEnabled ?? true;
    this.observedModelRuntime = this.modelRuntime && this.diagnosticsEnabled
      ? observeModelRuntime(
          this.modelRuntime,
          (call) => { this.activeCalls?.push(call); },
          () => this.turnProgress?.phase ?? "understanding",
        )
      : this.modelRuntime;
    this.transcriptEntries = [...(initial.transcript ?? [])];
    this.preference = initial.narrationPreference ?? "standard";
    this.openingProgression = initial.openingProgression
      ? openingProgressionStateSchema.parse(initial.openingProgression)
      : undefined;
  }

  /** Recent sanitized performance records; never persisted or exported with saves. */
  recentPerformance(): readonly TurnPerformanceDiagnostic[] {
    return [...this.recentPerformanceEntries];
  }

  private recordPerformance(performance: TurnPerformanceDiagnostic): void {
    try {
      this.recentPerformanceEntries.push(performance);
      if (this.recentPerformanceEntries.length > 20) this.recentPerformanceEntries.shift();
    } catch {
      // Observer-only; do not affect the caller.
    }
  }

  private recordRetryPerformance(
    turnId: string,
    startedAt: number,
    calls: readonly ModelCallDiagnostic[],
  ): void {
    this.activeCalls = undefined;
    if (!this.diagnosticsEnabled) return;
    try {
      this.recordPerformance(aggregatePerformance(
        turnId,
        startedAt,
        calls,
        this.lastError ? "failed" : "resolved",
      ));
    } catch {
      // Instrumentation must not affect narration retry.
    }
  }

  engineSession(): GameSession {
    return this.session;
  }

  view(): PlaySessionView {
    const world = this.session.snapshot();
    const player = world.entities.find((entity) => entity.id === this.playerActorId);
    const characterSheet = projectCharacterSheet(player?.data.mechanics);
    const locationId = world.facts.find((fact) =>
      fact.subjectId === this.playerActorId && fact.predicate === "actor.current-location"
    )?.value ?? player?.data.currentLocation;
    const normalizedLocationId = typeof locationId === "string" ? locationId : undefined;
    const location = world.entities.find((entity) => entity.id === normalizedLocationId);
    return {
      worldId: this.session.worldId,
      playerActorId: this.playerActorId,
      playerName: player?.name ?? "Player",
      ...(characterSheet ? { characterSheet } : {}),
      ...(normalizedLocationId ? { currentLocationId: normalizedLocationId } : {}),
      ...(location ? { currentLocationName: location.name } : {}),
      fictionalTime: world.fictionalTime,
      narrationPreference: this.preference,
      transcript: [...this.transcriptEntries],
      busy: this.active,
      preparingOpening: this.preparingOpening,
      canRetryOpeningManifestation: Boolean(
        this.openingProgression &&
        !this.openingProgression.firstPowerManifested &&
        this.openingProgression.playerTurnsSinceStart >=
          this.openingProgression.manifestationTargetTurn &&
        this.openingProgression.manifestationEvidenceEventId,
      ),
      ...(this.turnProgress ? { turnProgress: this.turnProgress } : {}),
      ...(this.lastError ? { error: this.lastError } : {}),
      ...(this.lastDiagnostics ? { diagnostics: this.lastDiagnostics } : {}),
      ...(this.diagnosticsEnabled ? { recentPerformance: this.recentPerformance() } : {}),
      ...(this.openingProgression
        ? {
            openingProgression: {
              playerTurnsSinceStart: this.openingProgression.playerTurnsSinceStart,
              manifestationDeadlineTurns:
                this.openingProgression.manifestationDeadlineTurns,
              firstPowerManifested: this.openingProgression.firstPowerManifested,
            },
          }
        : {}),
    };
  }

  setNarrationPreference(preference: NarrationPreference): PlaySessionView {
    this.preference = preference;
    return this.view();
  }

  private add(speaker: TranscriptEntry["speaker"], text: string, speakerName?: string): void {
    this.transcriptEntries.push({
      id: `transcript.${crypto.randomUUID()}`,
      speaker,
      text,
      ...(speaker === "npc" && speakerName ? { speakerName } : {}),
    });
  }

  /** Only established actor-visible records and saved player-visible NPC replies
   * are eligible. No free-text answer generation or world mutation occurs. */
  private async answerHistoricalRecall(declaration: string): Promise<string | undefined> {
    const request = historicalRecallQuestion(declaration);
    if (!request) return undefined;
    const world = this.session.snapshot();
    const speakers = request.speakerName
      ? world.entities.filter((entity) =>
          entity.name.toLowerCase() === request.speakerName!.toLowerCase())
      : [];
    // Do not silently attribute dialogue to the wrong character.
    if (request.speakerName && speakers.length !== 1) {
      return `I can't identify a unique established speaker named ${request.speakerName}. I won't guess about their words.`;
    }
    const speaker = speakers[0];
    const topicWords = (request.topic?.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
      .filter((word) => !["the", "and", "about", "from", "with", "into"].includes(word));
    const savedReplies = speaker ? this.transcriptEntries.filter((entry) =>
      entry.speaker === "npc" &&
      entry.speakerName?.toLowerCase() === speaker.name.toLowerCase() &&
      topicWords.every((word) => entry.text.toLowerCase().includes(word))
    ).slice(-2) : [];
    const history = await this.session.eventHistory({
      access: ["public"], relatedEntityId: this.playerActorId,
      direction: "descending", limit: 100,
    });
    const relevant = speaker ? history.filter((event) =>
      event.relatedEntityIds.includes(speaker.id)
    ) : history;
    const basis = this.session.planningBasis();
    const projection = recallContinuity({
      worldId: this.session.worldId, world,
      worldRevision: basis.worldRevision, eventSequence: basis.eventSequence,
      perspective: { kind: "actor", id: this.playerActorId },
      scope: speaker ? { kind: "relationship", id: speaker.id }
        : { kind: "actor", id: this.playerActorId },
      events: relevant,
      query: request.topic ?? request.query,
      limit: 4,
    });
    const pieces: string[] = [];
    if (savedReplies.length) {
      pieces.push(`From your saved conversation with ${speaker!.name}:\n${savedReplies.map(
        (entry) => entry.text
      ).join("\n")}`);
    }
    if (projection.summaryText) {
      pieces.push(`Other established context (not a verbatim quote):\n${projection.summaryText}`);
    }
    if (pieces.length === 0) {
      return "I don't have an authorized, preserved account of that earlier exchange or event. I won't invent the details.";
    }
    this.lastContinuityDiagnostics = {
      refreshed: false, trigger: "cache-hit",
      selectedSourceCount: projection.points.length,
      omittedSourceCount: 0,
      serializedCharacters: projection.summaryText.length,
      modelRefreshCalls: 0,
    };
    return pieces.join("\n\n");
  }

  private requireModel(): ModelRuntime {
    if (!this.modelRuntime) {
      throw new Error(
        "No local model runtime is configured; the world was not changed.",
      );
    }
    return this.observedModelRuntime ?? this.modelRuntime;
  }

  private reportTurnProgress(
    phase: TurnProgressPhase,
    listener?: TurnProgressListener,
  ): void {
    const labels: Record<TurnProgressPhase, string> = {
      understanding: "Understanding what you want to do…",
      resolving: "Resolving what happens…",
      responding: "Seeing how others respond…",
      updating: "Updating the world…",
      presenting: "Putting the scene into words…",
    };
    this.turnProgress = { phase, label: labels[phase] };
    try {
      listener?.(this.view());
    } catch {
      // Progress is a non-authoritative observer and cannot interrupt a turn.
    }
  }

  async prepareOpening(): Promise<PlaySessionView> {
    if (this.transcriptEntries.length > 0 || !this.openingNarration) return this.view();
    if (this.active) throw new Error("The play session is already busy");
    this.active = true;
    this.preparingOpening = true;
    this.lastError = undefined;
    try {
      const entry = await this.openingNarration();
      if (this.transcriptEntries.length === 0) this.transcriptEntries.push(entry);
      await this.persistPresentation();
    } catch (error) {
      this.lastError = errorMessage(error);
    } finally {
      this.preparingOpening = false;
      this.active = false;
    }
    return this.view();
  }

  private async classifyDeclaration(declaration: string) {
    const basis = this.session.planningBasis();
    const context = this.session.assembleContext({
      role: "actor",
      perspective: { kind: "actor", id: this.playerActorId },
      focalActorId: this.playerActorId,
      ...(this.view().currentLocationId
        ? { locationId: this.view().currentLocationId } : {}),
      declaration,
      budget: { maxUnits: ROUTING_CONTEXT_BUDGET_UNITS },
    });
    const continuity = projectContinuity({
      worldId: this.session.worldId,
      world: this.session.snapshot(),
      worldRevision: basis.worldRevision,
      eventSequence: basis.eventSequence,
      perspective: { kind: "actor", id: this.playerActorId },
      scope: { kind: "actor", id: this.playerActorId },
      maxCharacters: 1_000,
    });
    this.lastContinuityDiagnostics = continuity.diagnostics;
    return classifyTurnDeclaration({
      declaration,
      actorId: this.playerActorId,
      context,
      continuity: continuity.summary,
      modelRuntime: this.requireModel(),
      ...basis,
    });
  }

  private async persistPresentation(): Promise<void> {
    await this.presentationPersistence?.savePresentation({
      worldId: this.session.worldId,
      narrationPreference: this.preference,
      transcript: [...this.transcriptEntries],
      ...(this.openingProgression
        ? { openingProgression: this.openingProgression }
        : {}),
    });
  }

  private playerMechanics() {
    const player = this.session.snapshot().entities.find(
      (entity) => entity.id === this.playerActorId,
    );
    if (!player) throw new Error(`Missing player actor ${this.playerActorId}`);
    return rulesActorStateSchema.parse(player.data.mechanics);
  }

  private async narrateCommittedAwakening(
    listener?: TurnProgressListener,
  ): Promise<void> {
    const state = this.openingProgression;
    if (!state?.manifestationNarrationPending || !state.firstPowerProposal) return;
    const mechanics = this.playerMechanics();
    const power = mechanics.progression.powers?.find(
      (candidate) => candidate.id === state.firstPowerProposal!.power.id,
    );
    if (!power) {
      throw new Error(
        "First-power narration was requested before the power was committed",
      );
    }

    this.reportTurnProgress("presenting", listener);
    const world = this.session.snapshot();
    const pressure = world.actionPressure.status === "assessed"
      ? world.actionPressure.level
      : "unassessed";
    const directive = compileNarrationDirective(
      referenceGameDefinition.presentation.narrationProfile,
      deriveSceneRegister({
        kind: "action",
        actionPressure: pressure,
        authorizedHorizonMs: 0,
        elapsedMs: 0,
      }),
    );
    let frozen = state.manifestationPresentationScene;
    if (!frozen) {
      const context = this.session.assembleContext({
        role: "actor",
        perspective: { kind: "actor", id: this.playerActorId },
        focalActorId: this.playerActorId,
        ...(this.view().currentLocationId
          ? { locationId: this.view().currentLocationId } : {}),
        budget: { maxUnits: 8_000 },
      });
      const brief = prepareModelBrief({
        purpose: "narration", context, maxCharacters: 3_800,
        perspective: { kind: "actor", id: this.playerActorId },
      });
      const history = await this.session.eventHistory();
      const manifestationEvent = state.manifestationEventId
        ? history.find((event) => event.id === state.manifestationEventId)
        : [...history].reverse().find((event) => event.type === "rules.first-power-manifested");
      const manifestationEvidenceEvent = state.manifestationEvidenceEventId
        ? history.find((event) => event.id === state.manifestationEvidenceEventId)
        : undefined;
      const locationId = this.view().currentLocationId;
      const observed = observableEventSummaries(
        [manifestationEvidenceEvent, manifestationEvent].filter(
          (candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate),
        ), [this.playerActorId], locationId,
      );
      frozen = {
        schemaVersion: 1,
        sceneBrief: brief.modelText,
        worldRevision: brief.basis.worldRevision,
        eventSequence: brief.basis.eventSequence ?? this.session.planningBasis().eventSequence,
        observableOutcomes: [
          ...observed,
          JSON.stringify({
            firstAwakeningCommitted: true,
            name: power.name, corePrinciple: power.corePrinciple,
            functions: power.functions.map((fn) => ({
              name: fn.name, description: fn.description,
            })),
          }),
        ],
      };
      // Persist the authorized source snapshot BEFORE any model generation:
      // a presentation timeout cannot make the next attempt see a later scene.
      this.openingProgression = openingProgressionStateSchema.parse({
        ...state, manifestationPresentationScene: frozen,
      });
      await this.persistPresentation();
    }
    const beat = buildPresentationBeat({
      id: state.manifestationEventId ?? `awakening.${this.playerActorId}`,
      kind: "awakening", scene: frozen,
      observableOutcomes: frozen.observableOutcomes ?? [],
      elapsedMs: 0,
    });
    const result = await this.requireModel().generate({
      prompt: {
        protectedContext: [directive.protectedContext],
        instructions: [
          "Present the already-committed first-power manifestation using the protected narration profile.",
          "The rules operation has already made the power authoritative. Narration may describe only observable consequences of that committed state.",
          "Do not invent additional functions, costs, mechanics, choices, player speech, player thoughts, or a second triggering action.",
          "Use second person for the focal actor. Treat the triggering evidence event as already completed: do not replay, undo, contradict, prolong, or replace it.",
          "Begin at the final instant of the triggering evidence event or immediately afterward. Do not invent earlier failed attempts, tools, or complications.",
          "Make the moment legible as the character's first personal Awakening, then return control.",
        ],
        input: beat.modelText,
      },
      output: { kind: "text" },
      trace: { operation: "desktop.first-power-narration.v1" },
    }, {
      timeoutMs: 5 * 60 * 1_000,
      generation: { temperature: 0.4, maxOutputTokens: 512 },
    });
    const checked = result.ok
      ? validatePresentedText(result.output.text, beat)
      : { ok: false as const, reason: "model-failure" };
    if (!checked.ok) {
      this.add(
        "system",
        "Your first power manifested, but presentation failed. You may retry narration safely without replaying the Awakening.",
      );
      await this.persistPresentation();
      return;
    }

    this.add("narrator", checked.text);
    this.openingProgression = openingProgressionStateSchema.parse({
      ...state,
      manifestationPresentationScene: frozen,
      manifestationNarrationPending: false,
    });
    await this.persistPresentation();
  }

  private async ensureOpeningManifestation(
    evidenceEventIds: readonly string[],
    listener?: TurnProgressListener,
  ): Promise<void> {
    const state = this.openingProgression;
    if (!state || state.firstPowerManifested) return;

    const currentMechanics = this.playerMechanics();
    const alreadyManifested = currentMechanics.progression.characterLevel > 0 ||
      (currentMechanics.progression.powers?.length ?? 0) > 0;
    if (alreadyManifested) {
      if (!state.firstPowerProposal) {
        throw new Error(
          "Player is already awakened but the protected first-power proposal is missing",
        );
      }
      const history = await this.session.eventHistory();
      const event = [...history].reverse().find((candidate) =>
        candidate.type === "rules.first-power-manifested"
      );
      this.openingProgression = openingProgressionStateSchema.parse({
        ...state,
        firstPowerManifested: true,
        ...(event ? { manifestationEventId: event.id } : {}),
        manifestationNarrationPending: true,
      });
      await this.persistPresentation();
      await this.narrateCommittedAwakening(listener);
      return;
    }

    let proposal = state.firstPowerProposal;
    if (!proposal) {
      this.reportTurnProgress("updating", listener);
      proposal = await createPowerProposalModel(this.requireModel()).propose(
        firstPowerGenerationRequest({
          characterSummary: state.characterSummary,
          normalizedSetup: state.normalizedSetup,
        }),
      );
      this.openingProgression = openingProgressionStateSchema.parse({
        ...state,
        firstPowerProposal: proposal,
      });
      await this.persistPresentation();
    }

    const mechanics = this.playerMechanics();
    const skill = [...mechanics.skills].sort((left, right) =>
      right.sp - left.sp || left.id.localeCompare(right.id)
    )[0];
    if (!skill) {
      throw new Error("The player has no grounded skill available for Level 1 allocation");
    }
    const historyBefore = await this.session.eventHistory();
    const evidenceIdSet = new Set([
      ...evidenceEventIds,
      ...(state.manifestationEvidenceEventId
        ? [state.manifestationEvidenceEventId]
        : []),
    ]);
    const evidence = [...historyBefore].reverse().find((event) =>
      evidenceIdSet.has(event.id)
    );
    if (!evidence) {
      throw new Error(
        "First-power manifestation requires an authoritative event committed by the current opening turn",
      );
    }

    this.reportTurnProgress("updating", listener);
    await this.session.executeOperation("rules.progression.manifest-first-power", {
      actorId: this.playerActorId,
      power: proposal.power,
      skillAllocations: [{
        skillId: skill.id,
        amount: 5,
        evidenceEventIds: [evidence.id],
      }],
      scopeIds: evidence.scopeIds.length > 0
        ? evidence.scopeIds
        : this.localityScopeId
          ? [this.localityScopeId]
          : [],
      causedByEventIds: [evidence.id],
      reason: state.manifestationOpportunity,
    });

    const historyAfter = await this.session.eventHistory();
    const manifested = [...historyAfter].reverse().find((event) =>
      event.type === "rules.first-power-manifested"
    );
    this.openingProgression = openingProgressionStateSchema.parse({
      ...this.openingProgression!,
      firstPowerManifested: true,
      ...(manifested ? { manifestationEventId: manifested.id } : {}),
      manifestationNarrationPending: true,
    });
    await this.persistPresentation();
    await this.narrateCommittedAwakening(listener);
  }

  private async advanceOpeningProgression(
    evidenceEventIds: readonly string[],
    committedTurn: {
      readonly transcriptId: string;
      readonly sourceKind: "committed-player-action" | "completed-conversation";
      readonly description: string;
    },
    listener?: TurnProgressListener,
  ): Promise<void> {
    const state = this.openingProgression;
    if (!state || state.firstPowerManifested) return;
    const nextTurns = Math.min(
      state.manifestationDeadlineTurns,
      state.playerTurnsSinceStart + 1,
    );
    let evidenceEventId = evidenceEventIds.at(-1) ??
      state.manifestationEvidenceEventId;
    if (nextTurns >= state.manifestationTargetTurn && !evidenceEventId) {
      // LM-06: a routine action or casual conversation is a committed turn
      // even when it creates no canonical history. We emit exactly one
      // opening-specific causal anchor only when the first power is due.
      // The player's stable transcript message was already persisted before
      // the turn, and this method runs only after its completion.
      const history = await this.session.eventHistory();
      const previous = history.find((event) =>
        event.type === "rules.opening-turn-evidenced" &&
        event.relatedEntityIds.includes(this.playerActorId) &&
        typeof event.payload === "object" && event.payload !== null &&
        !Array.isArray(event.payload) &&
        event.payload.turnId === committedTurn.transcriptId
      );
      if (previous) {
        evidenceEventId = previous.id;
      } else {
        await this.session.executeOperation(
          "rules.progression.record-opening-turn-evidence",
          {
            actorId: this.playerActorId,
            turnId: committedTurn.transcriptId,
            sourceKind: committedTurn.sourceKind,
            description: committedTurn.description.slice(0, 240),
          },
        );
        const newlyCommitted = await this.session.eventHistory();
        const anchor = newlyCommitted.find((event) =>
          event.type === "rules.opening-turn-evidenced" &&
          !history.some((prior) => prior.id === event.id) &&
          event.relatedEntityIds.includes(this.playerActorId)
        );
        if (!anchor) throw new Error("Opening turn evidence was not committed");
        evidenceEventId = anchor.id;
      }
    }
    this.openingProgression = openingProgressionStateSchema.parse({
      ...state,
      playerTurnsSinceStart: nextTurns,
      ...(evidenceEventId ? { manifestationEvidenceEventId: evidenceEventId } : {}),
    });
    await this.persistPresentation();
    if (nextTurns >= state.manifestationTargetTurn && evidenceEventId) {
      await this.ensureOpeningManifestation([evidenceEventId], listener);
    }
  }

  /** Only grounded changes and meaningful scene boundaries reach the planner.
   * No full-history scans, no escalation cascade, no canonical writes. */
  private async reviewCampaignAtBoundary(input: {
    readonly before: ReturnType<GameSession["snapshot"]>;
    readonly beforeBasis: ReturnType<GameSession["planningBasis"]>;
    readonly beforeLocationId?: string;
    readonly materialEventIds: readonly string[];
    readonly onProgress?: TurnProgressListener;
  }): Promise<{
    readonly revision?: PlanRevisionDiagnostic;
    readonly review: NonNullable<TurnDiagnostics["plannerReview"]>;
  }> {
    const plan = await this.session.campaignPlan();
    if (!plan) return { review: {
      reason: "no-plan", historyQueryCount: 0, modelCalls: 0, noOp: true,
    } };
    const after = this.session.snapshot();
    const basis = this.session.planningBasis();
    const currentLocationId = this.view().currentLocationId;
    const changed = changedPlanningSources(plan, input.before, after);
    const locationChanged = input.beforeLocationId !== currentLocationId;
    const fictionalHours = (Date.parse(after.fictionalTime) -
      Date.parse(input.before.fictionalTime)) / 3_600_000;
    const hasNewEventEvidence = input.materialEventIds.length > 0 &&
      basis.eventSequence > input.beforeBasis.eventSequence;
    if (changed.length === 0 && !locationChanged && fictionalHours < 24 &&
        !hasNewEventEvidence) {
      return { review: {
        reason: "routine", historyQueryCount: 0, modelCalls: 0, noOp: true,
        planRevisionBefore: plan.planRevision, planRevisionAfter: plan.planRevision,
      } };
    }
    // Read only the finite newly committed receipt window. This also supports
    // event-sparse worlds with canonical state changes but no routine events.
    const events = hasNewEventEvidence
      ? await this.session.eventHistory({
          direction: "descending",
          limit: Math.min(64, Math.max(1, basis.eventSequence -
            input.beforeBasis.eventSequence)),
        })
      : [];
    const trigger = selectCampaignReview({
      plan, before: input.before, after, basis,
      beforeLocationId: input.beforeLocationId,
      afterLocationId: currentLocationId,
      playerActorId: this.playerActorId,
      events,
      deferUntilBoundary: this.pendingPlannerEscalation,
    });
    if (!trigger.reason) return { review: {
      reason: "unrelated",
      historyQueryCount: events.length ? 1 : 0,
      modelCalls: 0, noOp: true,
      planRevisionBefore: plan.planRevision, planRevisionAfter: plan.planRevision,
    } };
    input.onProgress && this.reportTurnProgress("updating", input.onProgress);
    const reviewed = await reviewCampaignDirection({
      plan, world: after, basis, trigger,
      history: events,
      historyQueryCount: hasNewEventEvidence ? 1 : 0,
      modelRuntime: this.requireModel(),
    });
    this.pendingPlannerEscalation = Boolean(reviewed.diagnostic.deferredEscalation);
    if (reviewed.plan) {
      try {
        await this.session.commitCampaignPlan(plan.planRevision, reviewed.plan);
        return { revision: reviewed.revision, review: reviewed.diagnostic };
      } catch (error) {
        return { review: {
          ...reviewed.diagnostic, noOp: true,
          planRevisionAfter: plan.planRevision,
          error: errorMessage(error),
        } };
      }
    }
    return { review: reviewed.diagnostic };
  }

  async performTurn(
    rawDeclaration: string,
    onProgress?: TurnProgressListener,
  ): Promise<PlaySessionView> {
    const submittedDeclaration = rawDeclaration.trim();
    if (!submittedDeclaration) return this.view();
    if (this.active) throw new Error("A player turn is already running");
    this.active = true;
    this.lastError = undefined;
    this.lastDiagnostics = undefined;
    this.lastContinuityDiagnostics = undefined;
    this.lastBoundaryContinuityDiagnostics = undefined;
    const startedAt = nowMs();
    const turnId = `turn.${crypto.randomUUID()}`;
    const calls: ModelCallDiagnostic[] = [];
    if (this.diagnosticsEnabled) this.activeCalls = calls;
    let beforeWorld: ReturnType<GameSession["snapshot"]> | undefined;
    let beforeBasis: ReturnType<GameSession["planningBasis"]> | undefined;
    const locationBeforeTurn = this.view().currentLocationId;
    let routeKind: "action" | "conversation" = "action";
    let actionTrace: JsonValue | undefined;
    let narrationStatus: "complete" | "failed" = "complete";
    let planner: PlanRevisionDiagnostic | { readonly error: string } | undefined;
    let plannerReview: TurnDiagnostics["plannerReview"];
    let turnOutcome: TurnPerformanceDiagnostic["outcome"] = "failed";
    const pendingClarification = this.pendingActionClarification;
    this.pendingActionClarification = undefined;
    const declaration = pendingClarification
      ? `${pendingClarification.declaration}\n\nPlayer clarification in response to "${pendingClarification.question}": ${submittedDeclaration}`
      : submittedDeclaration;
    this.add("player", submittedDeclaration);
    const playerMessageId = this.transcriptEntries.at(-1)!.id;
    this.reportTurnProgress("understanding", onProgress);
    try {
      // Persist the player message and its stable ID before committing any
      // segment; a restart must not lose the parent identity of stored receipts.
      await this.persistPresentation();
      beforeBasis = this.session.planningBasis();
      const before = this.session.snapshot();
      beforeWorld = before;
      // Preserve the asynchronous progress boundary even when diagnostics no
      // longer need an expensive event-history read before model routing.
      await Promise.resolve();
      let meaningfulTurn = false;
      let openingEvidenceEventIds: string[] = [];
      const recallAnswer = pendingClarification
        ? undefined
        : await this.answerHistoricalRecall(declaration);
      if (recallAnswer !== undefined) {
        this.reportTurnProgress("presenting", onProgress);
        this.add("narrator", recallAnswer);
        turnOutcome = "resolved";
      }
      const classified = recallAnswer !== undefined || pendingClarification
        ? undefined
        : await this.classifyDeclaration(declaration);
      if (classified?.kind === "player-decision-required") {
        turnOutcome = "needs-player-input";
        this.pendingActionClarification = {
          declaration,
          question: classified.question,
        };
        this.add("system", classified.question);
      }
      const segments = classified?.kind === "interpreted"
        ? classified.segments
        : pendingClarification
          ? [{ kind: "legacy-action" as const, text: declaration }]
          : [];
      const segmentTraces: JsonValue[] = [];
      let remainingTurnMs: number | undefined;
      let previousSegmentPressure: number | undefined;
      for (const [index, segment] of segments.entries()) {
        const segmentStartingLocationId = this.view().currentLocationId;
        const worldForPressure = this.session.snapshot();
        // A first action can persist its first assessment atomically with the
        // action run; avoid a separate empty-world-revision pressure commit.
        const scene = worldForPressure.actionPressure.status === "unassessed" &&
          segment.kind !== "communication"
          ? { ...chooseScenePressure(
              worldForPressure.actionPressure,
              scenePressureSources(worldForPressure, this.playerActorId,
                segmentStartingLocationId),
              segment.kind === "action" ? segment.pressureLevel : 3,
            ), changed: false }
          : await this.session.ensureScenePressure({
              actorId: this.playerActorId,
              ...(segmentStartingLocationId ? { locationId: segmentStartingLocationId } : {}),
              proposedLevel: segment.kind === "action" ? segment.pressureLevel : 3,
            });
        if (previousSegmentPressure !== undefined && scene.changed &&
            scene.level !== previousSegmentPressure) {
          this.add("system", "The situation changed before the next step. Decide how to continue under the new pressure.");
          break;
        }
        previousSegmentPressure = scene.level;
        remainingTurnMs = Math.min(
          remainingTurnMs ?? maximumResolutionHorizon(scene.level),
          maximumResolutionHorizon(scene.level),
        );
        if (remainingTurnMs <= 0) {
          this.add("system", "The Action Pressure window is exhausted. The remaining steps were not performed.");
          break;
        }
        // IDs are derived from the persisted player transcript identity, not
        // random per-operation IDs. Each segment is a distinct action run.
        const segmentId = `action.${playerMessageId}.segment.${index + 1}`;
        if (segment.kind === "communication") {
          routeKind = "conversation";
          const visible = this.session.assembleContext({
            role: "actor",
            perspective: { kind: "actor", id: this.playerActorId },
            focalActorId: this.playerActorId,
            ...(this.view().currentLocationId
              ? { locationId: this.view().currentLocationId } : {}),
            workingContext: {
              activeEntityIds: [...segment.recipientIds],
              recentEntityIds: [],
              aliases: [],
            },
            budget: { maxUnits: ROUTING_CONTEXT_BUDGET_UNITS },
          });
          const available = new Set(Object.values(visible.diagnostics.localReferences));
          const recipientIds = segment.recipientIds.filter((id) =>
            id !== this.playerActorId && available.has(id) &&
            visible.situation.scene.some((entity) =>
              visible.diagnostics.localReferences[entity.localRef] === id &&
              entity.access.actorAware && !entity.access.privileged
            )
          );
          if (recipientIds.length !== segment.recipientIds.length || !recipientIds.length) {
            turnOutcome = "failed";
            this.lastError = "The intended recipient is not available or visible after the preceding action.";
            this.add("system", this.lastError);
            break;
          }
          const player = this.session.snapshot().entities.find(
            (entity) => entity.id === this.playerActorId
          );
          const result = await performConversationTurn({
            session: this.session,
            modelRuntime: this.requireModel(),
            bindings: referenceConversationBindings,
            ordinaryFastPath: true,
            availableWindowMs: remainingTurnMs,
            request: {
              turnId: `conversation.${playerMessageId}.segment.${index + 1}`,
              interactionId: this.workingConversation?.interactionId ?? `interaction.${playerMessageId}`,
              playerActorId: this.playerActorId,
              playerCharacterName: player?.name ?? "Player",
              recipientIds,
              materialNpcIds: recipientIds,
              declaration: segment.text,
              ...(this.view().currentLocationId
                ? { locationId: this.view().currentLocationId } : {}),
              narrationPreference: this.preference,
              beatComplexity: "ordinary",
              budget: { maxUnits: 40_000 },
              authorizedMaterialSemanticKinds: ["disclosure", "promise", "threat", "offer", "agreement"],
              authorizedMaterialCommitments: [],
              authorizedDeception: false,
              authorizedTestimony: [],
              extractDurableConsequences: true,
            },
            ...(this.workingConversation ? { workingState: this.workingConversation } : {}),
            onProgress: (phase) => this.reportTurnProgress(phase, onProgress),
          });
          this.workingConversation = result.workingState;
          if (result.communicationCommitted) {
            remainingTurnMs = Math.max(0, remainingTurnMs - (result.elapsedMs ?? result.act.durationMs));
          }
          segmentTraces.push(asJson({
            communicationEventIds: result.communicationEventIds,
            extractionEventIds: result.extractionEventIds,
            decisions: result.decisions,
            committedActions: result.committedActions,
            stopReason: result.stopReason,
            narrationPresentation: result.narrationPresentation,
          }));
          openingEvidenceEventIds.push(...result.communicationEventIds, ...result.extractionEventIds);
          meaningfulTurn = meaningfulTurn || result.communicationCommitted ||
            result.committedActions.length > 0;
          if (!result.communicationCommitted) {
            turnOutcome = "failed";
            this.lastError = result.narrationError ??
              "The preceding action did not permit the intended speech.";
            this.add("system", this.lastError);
            break;
          }
          turnOutcome = result.narration ? "resolved" : "committed-presentation-failed";
          if (result.narration) {
            const npcName = recipientIds.length === 1
              ? this.session.snapshot().entities.find((entity) =>
                  entity.id === recipientIds[0])?.name
              : undefined;
            this.add("npc", result.narration, npcName);
            // The ordinary NPC path makes no canonical communication event.
            // Persist its finished speech before a first-power threshold can
            // anchor this turn as successfully completed.
            await this.persistPresentation();
          } else {
            narrationStatus = "failed";
            this.add("system", result.narrationError ??
              "The conversation committed, but narration was unavailable.");
            break;
          }
          if (this.view().currentLocationId !== segmentStartingLocationId) {
            // Scene-local cognition/remarks cannot follow the player into
            // a different canonical place; durable world state is untouched.
            this.workingConversation = undefined;
          }
          if (result.stopReason === "pressure-boundary" || remainingTurnMs <= 0) {
            this.add("system", "The scene's time window ended before any later declared steps.");
            break;
          }
          continue;
        }

        const currentBasis = this.session.planningBasis();
        const actionRequest = {
          actionId: pendingClarification?.segmentActionId ?? segmentId,
          actorId: this.playerActorId,
          declaration: segment.text,
          ...(this.view().currentLocationId
            ? { locationId: this.view().currentLocationId } : {}),
          budget: { maxUnits: ACTION_CONTEXT_BUDGET_UNITS },
        };
        this.lastActionRequest = actionRequest;
        const result = await this.session.performPlayerAction(actionRequest, {
          modelRuntime: this.requireModel(),
          maxModelTurns: ACTION_MAX_MODEL_TURNS,
          registeredOnly: true,
          maxAuthorizedHorizonMs: remainingTurnMs,
          ...(segment.kind === "action"
            ? { preinterpreted: {
                declaration: segment.text,
                goal: segment.goal,
                targetIds: [...segment.targetIds],
                modes: [...segment.modes],
                statedMeans: [...segment.statedMeans],
                pressureLevel: segment.pressureLevel,
                requestedHorizonMs: fictionalDurationMs(segment.requestedHorizonMs),
                ...currentBasis,
              } }
            : {}),
          narrationPreference: this.preference,
          onProgress: (phase) => this.reportTurnProgress(phase, onProgress),
        });
        segmentTraces.push(asJson(result.trace));
        if (result.kind === "needs-player-input") {
          turnOutcome = "needs-player-input";
          this.pendingActionClarification = {
            declaration: segment.text,
            question: result.question,
            segmentActionId: actionRequest.actionId,
          };
          this.add("system", result.question);
          break;
        }
        if (result.kind === "failed") {
          if (result.developmentSignal) {
            meaningfulTurn = meaningfulTurn ||
              result.developmentSignal.operationIds.length > 0 ||
              result.developmentSignal.eventIds.length > 0;
            openingEvidenceEventIds.push(...result.developmentSignal.eventIds);
            narrationStatus = "failed";
            turnOutcome = "committed-presentation-failed";
            this.add("system", "The action changed the world, but presentation failed. You may retry narration without replaying it.");
          } else {
            turnOutcome = "failed";
            this.lastError = result.failure.message;
            this.add("system", this.lastError);
          }
          break;
        }
        remainingTurnMs = Math.max(0, remainingTurnMs - result.run.elapsedMs);
        meaningfulTurn = meaningfulTurn ||
          result.developmentSignal.operationIds.length > 0 ||
          result.developmentSignal.eventIds.length > 0;
        openingEvidenceEventIds.push(...result.developmentSignal.eventIds);
        if (this.view().currentLocationId !== segmentStartingLocationId) {
          this.workingConversation = undefined;
        }
        turnOutcome = result.narration ? "resolved" : "committed-presentation-failed";
        if (result.narration) this.add("narrator", result.narration);
        else {
          narrationStatus = "failed";
          this.add("system", "The action committed, but narration was unavailable. You may retry narration safely.");
          break;
        }
        if (result.run.stopReason !== "goal-achieved" || remainingTurnMs <= 0) {
          if (index < segments.length - 1) {
            this.add("system", "The remaining declared steps were not attempted; decide how to proceed.");
          }
          break;
        }
      }
      actionTrace = segmentTraces.length === 1
        ? segmentTraces[0]
        : asJson({ segments: segmentTraces });
      if (meaningfulTurn) {
        try {
          await this.advanceOpeningProgression(openingEvidenceEventIds, {
            transcriptId: playerMessageId,
            sourceKind: routeKind === "conversation"
              ? "completed-conversation"
              : "committed-player-action",
            description: submittedDeclaration,
          }, onProgress);
          if (this.openingProgression?.manifestationNarrationPending) {
            narrationStatus = "failed";
            turnOutcome = "committed-presentation-failed";
          }
        } catch (error) {
          const message = errorMessage(error);
          this.lastError =
            `The action completed, but your first Awakening could not be prepared: ${message}. ` +
            "Retry Awakening safely; the completed action will not replay.";
          this.add(
            "system",
            "The action is complete, but your first Awakening needs another attempt. Retry Awakening safely; the completed action will not replay.",
          );
        }
      }
      if (recallAnswer === undefined) {
        const planReview = await this.reviewCampaignAtBoundary({
          before, beforeBasis: beforeBasis!,
          beforeLocationId: locationBeforeTurn,
          materialEventIds: openingEvidenceEventIds,
          onProgress,
        }).catch((error: unknown) => ({ review: {
          reason: "unrelated" as const, historyQueryCount: 0 as const,
          modelCalls: 0 as const, noOp: true as const,
        }, error: errorMessage(error) }));
        plannerReview = planReview.review;
        if ("revision" in planReview) planner = planReview.revision;
        if ("error" in planReview) planner = { error: planReview.error };
      } else {
        plannerReview = {
          reason: "historical-recall", historyQueryCount: 0,
          modelCalls: 0, noOp: true,
        };
      }
    } catch (error) {
      this.lastError = errorMessage(error);
    } finally {
      // Foreground boundary: warm the next authorized, place-scoped projection
      // after a genuine scene change or meaningful fictional-time jump. No
      // summarizer is invoked, and no derived record becomes world canon.
      if (beforeWorld && beforeBasis && turnOutcome !== "failed" && turnOutcome !== "needs-player-input") {
        try {
          const after = this.session.snapshot();
          const locationAfterTurn = this.view().currentLocationId;
          const sceneChanged = locationAfterTurn !== locationBeforeTurn;
          const elapsedMs = Date.parse(after.fictionalTime) - Date.parse(beforeWorld.fictionalTime);
          if (sceneChanged || elapsedMs >= 3_600_000) {
            const basis = this.session.planningBasis();
            const history = await this.session.eventHistory({
              relatedEntityId: this.playerActorId, access: ["public"],
              direction: "descending", limit: 48,
            });
            const projection = projectContinuity({
              worldId: this.session.worldId, world: after,
              worldRevision: basis.worldRevision, eventSequence: basis.eventSequence,
              perspective: { kind: "actor", id: this.playerActorId },
              scope: locationAfterTurn
                ? { kind: "location", id: locationAfterTurn }
                : { kind: "actor", id: this.playerActorId },
              events: history, maxCharacters: 1_000,
            });
            this.lastBoundaryContinuityDiagnostics = {
              reason: sceneChanged ? "scene-transition" : "time-jump",
              scope: locationAfterTurn ? "location" : "actor",
              diagnostics: projection.diagnostics,
            };
          }
        } catch {
          // Projection errors never alter or invalidate an otherwise committed turn.
        }
      }
      this.active = false;
      this.turnProgress = undefined;
      await this.persistPresentation().catch((error: unknown) => {
        if (!this.lastError) this.lastError = errorMessage(error);
      });
      this.activeCalls = undefined;
      if (this.diagnosticsEnabled && beforeWorld && beforeBasis) {
        try {
          const after = this.session.snapshot();
          const afterBasis = this.session.planningBasis();
          const beforeCounts = recordCounts(beforeWorld, beforeBasis.eventSequence);
          const afterCounts = recordCounts(after, afterBasis.eventSequence);
          const performance = aggregatePerformance(turnId, startedAt, calls, turnOutcome);
          this.lastDiagnostics = {
            declaration,
            route: routeKind,
            worldRevisionBefore: beforeBasis.worldRevision,
            worldRevisionAfter: afterBasis.worldRevision,
            fictionalTimeBefore: beforeWorld.fictionalTime,
            fictionalTimeAfter: after.fictionalTime,
            modelMs: performance.modelWorkMs,
            deterministicAndApplicationMs: Math.max(0, performance.totalWallMs - performance.modelWorkMs),
            modelTimingAvailable: calls.length > 0,
            eventCountBefore: beforeBasis.eventSequence,
            eventCountAfter: afterBasis.eventSequence,
            ...(actionTrace ? { actionTrace } : {}),
            ...(planner ? { planner } : {}),
            ...(plannerReview ? { plannerReview } : {}),
            narrationStatus,
            growth: afterCounts,
            stateCounts: {
              before: beforeCounts,
              after: afterCounts,
              delta: recordDelta(beforeCounts, afterCounts),
            },
            performance,
            ...(this.lastContinuityDiagnostics
              ? { continuity: this.lastContinuityDiagnostics }
              : {}),
            ...(this.lastBoundaryContinuityDiagnostics
              ? { continuityBoundary: this.lastBoundaryContinuityDiagnostics }
              : {}),
          };
          this.recordPerformance(performance);
        } catch {
          // Diagnostics are not authoritative; never convert a successful turn
          // into an error because measurement failed.
        }
      }
    }
    return this.view();
  }

  async retryNarration(onProgress?: TurnProgressListener): Promise<PlaySessionView> {
    if (this.active) throw new Error("A player turn is already running");
    const startedAt = nowMs();
    const retryId = `narration-retry.${crypto.randomUUID()}`;
    const calls: ModelCallDiagnostic[] = [];
    if (this.diagnosticsEnabled) this.activeCalls = calls;
    if (
      this.openingProgression &&
      !this.openingProgression.firstPowerManifested &&
      this.openingProgression.playerTurnsSinceStart >=
        this.openingProgression.manifestationTargetTurn &&
      this.openingProgression.manifestationEvidenceEventId
    ) {
      this.active = true;
      this.lastError = undefined;
      try {
        await this.ensureOpeningManifestation(
          [this.openingProgression.manifestationEvidenceEventId],
          onProgress,
        );
        if (this.openingProgression?.manifestationNarrationPending) {
          throw new Error("Awakening narration is still unavailable; the committed power was not replayed");
        }
      } catch (error) {
        this.lastError = errorMessage(error);
      } finally {
        this.active = false;
        this.turnProgress = undefined;
        await this.persistPresentation().catch(() => undefined);
        this.recordRetryPerformance(retryId, startedAt, calls);
      }
      return this.view();
    }
    if (this.openingProgression?.manifestationNarrationPending) {
      this.active = true;
      this.lastError = undefined;
      try {
        await this.narrateCommittedAwakening(onProgress);
        if (this.openingProgression?.manifestationNarrationPending) {
          throw new Error(
            "Awakening narration is still unavailable; the committed power was not replayed",
          );
        }
      } catch (error) {
        this.lastError = errorMessage(error);
      } finally {
        this.active = false;
        this.turnProgress = undefined;
        await this.persistPresentation().catch(() => undefined);
        this.recordRetryPerformance(retryId, startedAt, calls);
      }
      return this.view();
    }
    if (!this.lastActionRequest) {
      this.activeCalls = undefined;
      throw new Error("There is no action narration to retry");
    }
    this.active = true;
    this.lastError = undefined;
    this.reportTurnProgress("presenting", onProgress);
    try {
      const result = await this.session.performPlayerAction(this.lastActionRequest, {
        modelRuntime: this.requireModel(),
        narrationPreference: this.preference,
      });
      if (result.kind === "resolved" && result.narration) this.add("narrator", result.narration);
      else throw new Error("Narration is still unavailable; the committed action was not replayed");
    } catch (error) {
      this.lastError = errorMessage(error);
    } finally {
      this.active = false;
      this.turnProgress = undefined;
      this.recordRetryPerformance(retryId, startedAt, calls);
    }
    return this.view();
  }

  async passThreeDaysAndCatchUp(): Promise<PlaySessionView> {
    if (this.active) throw new Error("A player turn is already running");
    this.active = true;
    this.lastError = undefined;
    try {
      await this.session.advanceTime(3 * 24 * 60 * 60 * 1_000);
      if (this.localityScopeId) await this.session.catchUpScope({ scopeId: this.localityScopeId });
      this.add("system", "Three fictional days pass. Relevant local processes catch up when you return attention here.");
    } catch (error) {
      this.lastError = errorMessage(error);
    } finally {
      this.active = false;
      await this.persistPresentation().catch((error: unknown) => {
        if (!this.lastError) this.lastError = errorMessage(error);
      });
    }
    return this.view();
  }

  async save(slotName = "Manual save"): Promise<PlaySessionView> {
    await this.session.save(slotName);
    this.add("system", `Saved to ${slotName}.`);
    await this.persistPresentation();
    return this.view();
  }
}
