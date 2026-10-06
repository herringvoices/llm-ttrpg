import { z } from "zod";
import {
  compileNarrationDirective,
  createCampaignPlanContextItem,
  deriveSceneRegister,
  jsonValueSchema,
  performConversationTurn,
  renderContextForModel,
  runPlannerPass,
  validatePlanningAssumptions,
  type CampaignPlanDocument,
  type ConversationWorkingState,
  type GameSession,
  type JsonValue,
  type ModelRuntime,
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
  readonly growth: {
    readonly entities: number;
    readonly facts: number;
    readonly beliefs: number;
    readonly actorSocialStates: number;
    readonly documents: number;
    readonly simulationCursors: number;
    readonly mechanicalRealizations: number;
    readonly events: number;
  };
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
  readonly error?: string;
  readonly diagnostics?: TurnDiagnostics;
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

const turnRouteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("action") }).strict(),
  z.object({ kind: z.literal("conversation"), recipientRefs: z.array(z.string().min(1)).min(1) }).strict(),
]);

const ROUTING_CONTEXT_BUDGET_UNITS = 8_000;
const ACTION_CONTEXT_BUDGET_UNITS = 12_000;
const ACTION_MAX_MODEL_TURNS = 6;

function mayBeConversation(declaration: string): boolean {
  return /["“”]|\b(answer|ask|call|greet|reply|say|speak|talk|tell|text|whisper|yell)\b/i
    .test(declaration);
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

function reportedModelMs(trace: JsonValue | undefined): number | undefined {
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) return undefined;
  const entries = (trace as Record<string, JsonValue>).entries;
  if (!Array.isArray(entries)) return undefined;
  const values = entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const detail = (entry as Record<string, JsonValue>).detail;
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) return [];
    const metadata = (detail as Record<string, JsonValue>).metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
    const elapsed = (metadata as Record<string, JsonValue>).elapsedMs;
    return typeof elapsed === "number" ? [elapsed] : [];
  });
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : undefined;
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
    } = {},
    private readonly presentationPersistence?: PlaySessionPersistence,
    private readonly openingNarration?: () => Promise<TranscriptEntry>,
  ) {
    this.transcriptEntries = [...(initial.transcript ?? [])];
    this.preference = initial.narrationPreference ?? "standard";
    this.openingProgression = initial.openingProgression
      ? openingProgressionStateSchema.parse(initial.openingProgression)
      : undefined;
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
      ...(this.turnProgress ? { turnProgress: this.turnProgress } : {}),
      ...(this.lastError ? { error: this.lastError } : {}),
      ...(this.lastDiagnostics ? { diagnostics: this.lastDiagnostics } : {}),
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
    return this.modelRuntime;
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

  private async routeDeclaration(declaration: string) {
    const model = this.requireModel();
    const context = this.session.assembleContext({
      role: "orchestrator",
      perspective: { kind: "canonical" },
      focalActorId: this.playerActorId,
      ...(this.view().currentLocationId ? { locationId: this.view().currentLocationId } : {}),
      declaration,
      budget: { maxUnits: ROUTING_CONTEXT_BUDGET_UNITS },
    });
    const result = await model.generate({
      prompt: {
        instructions: [
          "Route the declaration as conversation only when speech or communicative behavior targets an available actor.",
          "Use only local references from the authorized scene context. Otherwise choose action.",
        ],
        context: renderContextForModel(context),
        input: declaration,
      },
      output: { kind: "structured", schemaId: "desktop.turn-route.v1", schema: turnRouteSchema },
      trace: { operation: "desktop-turn-route", invocationId: `turn-route.${crypto.randomUUID()}` },
    });
    if (!result.ok) throw new Error(`Unable to interpret the turn safely: ${result.error.message}`);
    return { route: result.output.value, context };
  }

  private async persistPresentation(): Promise<void> {
    await this.presentationPersistence?.savePresentation({
      worldId: this.session.worldId,
      narrationPreference: this.preference,
      transcript: this.transcriptEntries,
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
    const result = await this.requireModel().generate({
      prompt: {
        protectedContext: [directive.protectedContext],
        instructions: [
          "Present the already-committed first-power manifestation using the protected narration profile.",
          "The rules operation has already made the power authoritative. Narration may describe only observable consequences of that committed state.",
          "Do not invent additional functions, costs, mechanics, choices, player speech, player thoughts, or a second triggering action.",
          "Make the moment legible as the character's first personal Awakening, then return control.",
        ],
        context: renderContextForModel(context),
        input: JSON.stringify({
          manifestationEvent: manifestationEvent
            ? { id: manifestationEvent.id, summary: manifestationEvent.summary }
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
    const evidence = historyBefore.at(-1);
    if (!evidence) {
      throw new Error(
        "First-power manifestation requires an authoritative event from the opening turn",
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
    listener?: TurnProgressListener,
  ): Promise<void> {
    const state = this.openingProgression;
    if (!state || state.firstPowerManifested) return;
    const nextTurns = Math.min(
      state.manifestationDeadlineTurns,
      state.playerTurnsSinceStart + 1,
    );
    this.openingProgression = openingProgressionStateSchema.parse({
      ...state,
      playerTurnsSinceStart: nextTurns,
    });
    await this.persistPresentation();
    if (nextTurns >= state.manifestationTargetTurn) {
      await this.ensureOpeningManifestation(listener);
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
    try {
      if (
        this.openingProgression &&
        !this.openingProgression.firstPowerManifested &&
        this.openingProgression.playerTurnsSinceStart >=
          this.openingProgression.manifestationDeadlineTurns
      ) {
        await this.ensureOpeningManifestation(onProgress);
      }
    } catch (error) {
      this.lastError = errorMessage(error);
      this.active = false;
      this.turnProgress = undefined;
      await this.persistPresentation().catch(() => undefined);
      return this.view();
    }
    const pendingClarification = this.pendingActionClarification;
    this.pendingActionClarification = undefined;
    const declaration = pendingClarification
      ? `${pendingClarification.declaration}\n\nPlayer clarification in response to "${pendingClarification.question}": ${submittedDeclaration}`
      : submittedDeclaration;
    this.add("player", submittedDeclaration);
    this.reportTurnProgress("understanding", onProgress);
    try {
      const beforeBasis = this.session.planningBasis();
      const before = this.session.snapshot();
      const historyBefore = await this.session.eventHistory();
      const startedAt = nowMs();
      let routeKind: "action" | "conversation" = "action";
      let meaningfulTurn = false;
      const routed = !pendingClarification && mayBeConversation(declaration)
        ? await this.routeDeclaration(declaration)
        : undefined;
      const route = routed?.route ?? { kind: "action" as const };
      routeKind = route.kind;
      let actionTrace: JsonValue | undefined;
      let narrationStatus: "complete" | "failed" = "complete";
      if (route.kind === "conversation") {
        const recipientIds = route.recipientRefs
          .map((ref) => routed!.context.diagnostics.localReferences[ref])
          .filter((id): id is string => Boolean(id && id !== this.playerActorId));
        if (recipientIds.length === 0) throw new Error("No authorized conversation recipient was available");
        const player = before.entities.find((entity) => entity.id === this.playerActorId);
        const result = await performConversationTurn({
          session: this.session,
          modelRuntime: this.requireModel(),
          bindings: referenceConversationBindings,
          request: {
            turnId: `conversation-turn.${crypto.randomUUID()}`,
            interactionId: this.workingConversation?.interactionId ?? `interaction.${crypto.randomUUID()}`,
            playerActorId: this.playerActorId,
            playerCharacterName: player?.name ?? "Player",
            recipientIds,
            materialNpcIds: recipientIds,
            declaration,
            ...(this.view().currentLocationId ? { locationId: this.view().currentLocationId } : {}),
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
        meaningfulTurn = true;
        if (result.narration) this.add("npc", result.narration);
        else {
          narrationStatus = "failed";
          this.add("system", result.narrationError ?? "The conversation committed, but narration was unavailable.");
        }
        actionTrace = asJson({
          communicationEventIds: result.communicationEventIds,
          extractionEventIds: result.extractionEventIds,
          decisions: result.decisions,
          committedActions: result.committedActions,
          stopReason: result.stopReason,
          narrationPresentation: result.narrationPresentation,
        });
      } else {
        const actionRequest = {
          actionId: `action.${crypto.randomUUID()}`,
          actorId: this.playerActorId,
          declaration,
          ...(this.view().currentLocationId ? { locationId: this.view().currentLocationId } : {}),
          budget: { maxUnits: ACTION_CONTEXT_BUDGET_UNITS },
        };
        this.lastActionRequest = actionRequest;
        const result = await this.session.performPlayerAction(actionRequest, {
          modelRuntime: this.requireModel(),
          maxModelTurns: ACTION_MAX_MODEL_TURNS,
          narrationPreference: this.preference,
          onProgress: (phase) => this.reportTurnProgress(phase, onProgress),
        });
        actionTrace = asJson(result.trace);
        if (result.kind === "needs-player-input") {
          this.pendingActionClarification = {
            declaration,
            question: result.question,
          };
          this.add("system", result.question);
        }
        else if (result.kind === "failed") {
          if (result.developmentSignal) {
            meaningfulTurn = true;
            narrationStatus = "failed";
            this.add("system", "The action changed the world, but presentation failed. You may retry narration without replaying it.");
          } else throw new Error(result.failure.message);
        } else {
          meaningfulTurn = true;
          if (result.narration) this.add("narrator", result.narration);
          else {
            narrationStatus = "failed";
            this.add("system", "The action committed, but narration was unavailable. You may retry narration safely.");
          }
        }
      }
      if (meaningfulTurn) {
        await this.advanceOpeningProgression(onProgress);
      }
      const planner = await this.replanIfInvalidated(onProgress)
        .catch((error: unknown) => ({ error: errorMessage(error) }));
      const after = this.session.snapshot();
      const afterBasis = this.session.planningBasis();
      const historyAfter = await this.session.eventHistory();
      const totalMs = Math.max(0, nowMs() - startedAt);
      const modelMs = reportedModelMs(actionTrace);
      this.lastDiagnostics = {
        declaration,
        route: routeKind,
        worldRevisionBefore: beforeBasis.worldRevision,
        worldRevisionAfter: afterBasis.worldRevision,
        fictionalTimeBefore: before.fictionalTime,
        fictionalTimeAfter: after.fictionalTime,
        modelMs: modelMs ?? 0,
        deterministicAndApplicationMs: Math.max(0, totalMs - (modelMs ?? 0)),
        modelTimingAvailable: modelMs !== undefined,
        eventCountBefore: historyBefore.length,
        eventCountAfter: historyAfter.length,
        ...(actionTrace ? { actionTrace } : {}),
        ...(planner ? { planner } : {}),
        narrationStatus,
        growth: {
          entities: after.entities.length,
          facts: after.facts.length,
          beliefs: after.beliefs.length,
          actorSocialStates: after.actorSocialStates.length,
          documents: after.documents.length,
          simulationCursors: after.simulationCursors.length,
          mechanicalRealizations: after.mechanicalRealizations.length,
          events: historyAfter.length,
        },
      };
    } catch (error) {
      this.lastError = errorMessage(error);
    } finally {
      this.active = false;
      this.turnProgress = undefined;
      await this.persistPresentation().catch((error: unknown) => {
        if (!this.lastError) this.lastError = errorMessage(error);
      });
    }
    return this.view();
  }

  async retryNarration(onProgress?: TurnProgressListener): Promise<PlaySessionView> {
    if (this.active) throw new Error("A player turn is already running");
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
      }
      return this.view();
    }
    if (!this.lastActionRequest) throw new Error("There is no action narration to retry");
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
