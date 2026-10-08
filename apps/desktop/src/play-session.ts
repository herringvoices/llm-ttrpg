import {
  compileNarrationDirective,
  createCampaignPlanContextItem,
  deriveSceneRegister,
  jsonValueSchema,
  observeModelRuntime,
  classifyTurnDeclaration,
  performConversationTurn,
  renderContextForModel,
  runPlannerPass,
  validatePlanningAssumptions,
  type CampaignPlanDocument,
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

export type NarrationPreference = "concise" | "standard" | "expansive";

export interface TranscriptEntry {
  readonly id: string;
  readonly speaker: "player" | "narrator" | "npc" | "system";
  readonly text: string;
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
  readonly narrationStatus: "complete" | "failed";
  /** Legacy absolute after-state totals; retained for existing developer consumers. */
  readonly growth: WorldRecordCounts;
  readonly stateCounts: {
    readonly before: WorldRecordCounts;
    readonly after: WorldRecordCounts;
    readonly delta: WorldRecordCounts;
  };
  readonly performance: TurnPerformanceDiagnostic;
}

export interface PlaySessionView {
  readonly worldId: string;
  readonly playerActorId: string;
  readonly playerName: string;
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
    const locationId = world.facts.find((fact) =>
      fact.subjectId === this.playerActorId && fact.predicate === "actor.current-location"
    )?.value ?? player?.data.currentLocation;
    const normalizedLocationId = typeof locationId === "string" ? locationId : undefined;
    const location = world.entities.find((entity) => entity.id === normalizedLocationId);
    return {
      worldId: this.session.worldId,
      playerActorId: this.playerActorId,
      playerName: player?.name ?? "Player",
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

  private add(speaker: TranscriptEntry["speaker"], text: string): void {
    this.transcriptEntries.push({
      id: `transcript.${crypto.randomUUID()}`,
      speaker,
      text,
    });
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
    return classifyTurnDeclaration({
      declaration,
      actorId: this.playerActorId,
      context,
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
    const context = this.session.assembleContext({
      role: "actor",
      perspective: { kind: "actor", id: this.playerActorId },
      focalActorId: this.playerActorId,
      ...(this.view().currentLocationId
        ? { locationId: this.view().currentLocationId }
        : {}),
      budget: { maxUnits: 30_000 },
    });
    const history = await this.session.eventHistory();
    const manifestationEvent = state.manifestationEventId
      ? history.find((event) => event.id === state.manifestationEventId)
      : [...history].reverse().find((event) => event.type === "rules.first-power-manifested");
    const manifestationEvidenceEvent = state.manifestationEvidenceEventId
      ? history.find((event) => event.id === state.manifestationEvidenceEventId)
      : undefined;
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
        context: renderContextForModel(context),
        input: JSON.stringify({
          manifestationEvent: manifestationEvent
            ? { id: manifestationEvent.id, summary: manifestationEvent.summary }
            : undefined,
          triggeringEvidenceEvent: manifestationEvidenceEvent
            ? {
                id: manifestationEvidenceEvent.id,
                type: manifestationEvidenceEvent.type,
                summary: manifestationEvidenceEvent.summary,
              }
            : undefined,
          power: {
            name: power.name,
            corePrinciple: power.corePrinciple,
            functions: power.functions.map((fn) => ({
              name: fn.name,
              description: fn.description,
            })),
          },
        }),
      },
      output: { kind: "text" },
      trace: { operation: "desktop.first-power-narration.v1" },
    }, {
      timeoutMs: 5 * 60 * 1_000,
      generation: { temperature: 0.4, maxOutputTokens: 512 },
    });
    if (!result.ok || !result.output.text.trim()) {
      this.add(
        "system",
        "Your first power manifested, but presentation failed. You may retry narration safely without replaying the Awakening.",
      );
      await this.persistPresentation();
      return;
    }

    this.add("narrator", result.output.text.trim());
    this.openingProgression = openingProgressionStateSchema.parse({
      ...state,
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
    const evidenceIdSet = new Set(evidenceEventIds);
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
    listener?: TurnProgressListener,
  ): Promise<void> {
    const state = this.openingProgression;
    if (!state || state.firstPowerManifested) return;
    const nextTurns = Math.min(
      state.manifestationDeadlineTurns,
      state.playerTurnsSinceStart + 1,
    );
    const evidenceEventId = evidenceEventIds.at(-1);
    this.openingProgression = openingProgressionStateSchema.parse({
      ...state,
      playerTurnsSinceStart: nextTurns,
      ...(evidenceEventId ? { manifestationEvidenceEventId: evidenceEventId } : {}),
    });
    await this.persistPresentation();
    if (nextTurns >= state.manifestationTargetTurn) {
      await this.ensureOpeningManifestation(evidenceEventIds, listener);
    }
  }

  private async replanIfInvalidated(
    listener?: TurnProgressListener,
  ): Promise<PlanRevisionDiagnostic | { readonly error: string } | undefined> {
    let plan = await this.session.campaignPlan();
    if (!plan) return undefined;
    const basis = this.session.planningBasis();
    const history = await this.session.eventHistory();
    const validation = validatePlanningAssumptions({
      plan,
      world: this.session.snapshot(),
      history,
      ...basis,
    });
    if (validation.signals.length === 0) return undefined;
    this.reportTurnProgress("updating", listener);
    const model = this.requireModel();
    let horizon: "low" | "medium" | "high" = "low";
    let finalDiagnostic: PlanRevisionDiagnostic | undefined;
    while (true) {
      const protectedContext = this.session.assembleContext({
        role: "planner",
        perspective: { kind: "canonical" },
        budget: { maxUnits: 40_000 },
      }, { retrieved: [createCampaignPlanContextItem(plan)] });
      const currentBasis = this.session.planningBasis();
      const pass = await runPlannerPass({
        modelRuntime: model,
        plan,
        horizon,
        signals: validation.signals,
        world: this.session.snapshot(),
        history: await this.session.eventHistory(),
        ...currentBasis,
        authoritativeContext: asJson(protectedContext),
      });
      if (!pass.ok || !pass.plan || !pass.diagnostic) {
        return { error: pass.error ?? "Planner pass failed; the previous plan remains active." };
      }
      plan = await this.session.commitCampaignPlan(plan.planRevision, pass.plan);
      finalDiagnostic = pass.diagnostic;
      if (!pass.diagnostic.escalationRequested) break;
      horizon = pass.diagnostic.escalationRequested;
    }
    return finalDiagnostic;
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
    const startedAt = nowMs();
    const turnId = `turn.${crypto.randomUUID()}`;
    const calls: ModelCallDiagnostic[] = [];
    if (this.diagnosticsEnabled) this.activeCalls = calls;
    let beforeWorld: ReturnType<GameSession["snapshot"]> | undefined;
    let beforeBasis: ReturnType<GameSession["planningBasis"]> | undefined;
    let routeKind: "action" | "conversation" = "action";
    let actionTrace: JsonValue | undefined;
    let narrationStatus: "complete" | "failed" = "complete";
    let planner: PlanRevisionDiagnostic | { readonly error: string } | undefined;
    let turnOutcome: TurnPerformanceDiagnostic["outcome"] = "failed";
    const pendingClarification = this.pendingActionClarification;
    this.pendingActionClarification = undefined;
    const declaration = pendingClarification
      ? `${pendingClarification.declaration}\n\nPlayer clarification in response to "${pendingClarification.question}": ${submittedDeclaration}`
      : submittedDeclaration;
    this.add("player", submittedDeclaration);
    this.reportTurnProgress("understanding", onProgress);
    try {
      beforeBasis = this.session.planningBasis();
      const before = this.session.snapshot();
      beforeWorld = before;
      // Preserve the asynchronous progress boundary even when diagnostics no
      // longer need an expensive event-history read before model routing.
      await Promise.resolve();
      let meaningfulTurn = false;
      let openingEvidenceEventIds: string[] = [];
      const classified = pendingClarification
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
      for (const [index, segment] of segments.entries()) {
        // IDs are derived from the persisted player transcript identity, not
        // random per-operation IDs. Each segment is a distinct action run.
        const playerMessageId = this.transcriptEntries.at(-1)!.id;
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
            this.lastError = result.narrationError ??
              "The preceding action did not permit the intended speech.";
            this.add("system", this.lastError);
            break;
          }
          turnOutcome = result.narration ? "resolved" : "committed-presentation-failed";
          if (result.narration) this.add("npc", result.narration);
          else {
            narrationStatus = "failed";
            this.add("system", result.narrationError ??
              "The conversation committed, but narration was unavailable.");
            break;
          }
          continue;
        }

        const currentBasis = this.session.planningBasis();
        const actionRequest = {
          actionId: segmentId,
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
          ...(segment.kind === "action"
            ? { preinterpreted: {
                declaration: segment.text,
                goal: segment.goal,
                targetIds: [...segment.targetIds],
                modes: [...segment.modes],
                statedMeans: [...segment.statedMeans],
                pressureLevel: segment.pressureLevel,
                requestedHorizonMs: segment.requestedHorizonMs,
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
            declaration,
            question: result.question,
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
            this.lastError = result.failure.message;
            this.add("system", this.lastError);
          }
          break;
        }
        meaningfulTurn = meaningfulTurn ||
          result.developmentSignal.operationIds.length > 0 ||
          result.developmentSignal.eventIds.length > 0;
        openingEvidenceEventIds.push(...result.developmentSignal.eventIds);
        turnOutcome = result.narration ? "resolved" : "committed-presentation-failed";
        if (result.narration) this.add("narrator", result.narration);
        else {
          narrationStatus = "failed";
          this.add("system", "The action committed, but narration was unavailable. You may retry narration safely.");
          break;
        }
      }
      actionTrace = segmentTraces.length === 1
        ? segmentTraces[0]
        : asJson({ segments: segmentTraces });
      if (meaningfulTurn) {
        try {
          await this.advanceOpeningProgression(openingEvidenceEventIds, onProgress);
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
      planner = await this.replanIfInvalidated(onProgress)
        .catch((error: unknown) => ({ error: errorMessage(error) }));
    } catch (error) {
      this.lastError = errorMessage(error);
    } finally {
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
            narrationStatus,
            growth: afterCounts,
            stateCounts: {
              before: beforeCounts,
              after: afterCounts,
              delta: recordDelta(beforeCounts, afterCounts),
            },
            performance,
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
