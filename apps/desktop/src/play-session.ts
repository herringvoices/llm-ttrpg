import { z } from "zod";
import {
  createCampaignPlanContextItem,
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
import { referenceConversationBindings } from "@llm-ttrpg/reference-game";

export type NarrationPreference = "concise" | "standard" | "expansive";

export interface TranscriptEntry {
  readonly id: string;
  readonly speaker: "player" | "narrator" | "npc" | "system";
  readonly text: string;
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
  readonly error?: string;
  readonly diagnostics?: TurnDiagnostics;
}

export interface PlaySessionPersistence {
  savePresentation(input: {
    readonly worldId: string;
    readonly narrationPreference: NarrationPreference;
    readonly transcript: readonly TranscriptEntry[];
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

  constructor(
    private readonly session: GameSession,
    private readonly modelRuntime: ModelRuntime | undefined,
    readonly playerActorId: string,
    private readonly localityScopeId: string | undefined,
    initial: {
      readonly transcript?: readonly TranscriptEntry[];
      readonly narrationPreference?: NarrationPreference;
    } = {},
    private readonly presentationPersistence?: PlaySessionPersistence,
    private readonly openingNarration?: () => Promise<TranscriptEntry>,
  ) {
    this.transcriptEntries = [...(initial.transcript ?? [])];
    this.preference = initial.narrationPreference ?? "standard";
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
      ...(this.lastError ? { error: this.lastError } : {}),
      ...(this.lastDiagnostics ? { diagnostics: this.lastDiagnostics } : {}),
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

  async prepareOpening(): Promise<PlaySessionView> {
    if (this.transcriptEntries.length > 0 || !this.openingNarration) return this.view();
    if (this.active) throw new Error("The play session is already busy");
    this.active = true;
    this.preparingOpening = true;
    this.lastError = undefined;
    try {
      const entry = await this.openingNarration();
      if (this.transcriptEntries.length === 0) this.transcriptEntries.push(entry);
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

  private async replanIfInvalidated(): Promise<PlanRevisionDiagnostic | { readonly error: string } | undefined> {
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

  async performTurn(rawDeclaration: string): Promise<PlaySessionView> {
    const submittedDeclaration = rawDeclaration.trim();
    if (!submittedDeclaration) return this.view();
    if (this.active) throw new Error("A player turn is already running");
    this.active = true;
    this.lastError = undefined;
    const pendingClarification = this.pendingActionClarification;
    this.pendingActionClarification = undefined;
    const declaration = pendingClarification
      ? `${pendingClarification.declaration}\n\nPlayer clarification in response to "${pendingClarification.question}": ${submittedDeclaration}`
      : submittedDeclaration;
    const beforeBasis = this.session.planningBasis();
    const before = this.session.snapshot();
    const historyBefore = await this.session.eventHistory();
    const startedAt = nowMs();
    let routeKind: "action" | "conversation" = "action";
    try {
      const routed = !pendingClarification && mayBeConversation(declaration)
        ? await this.routeDeclaration(declaration)
        : undefined;
      const route = routed?.route ?? { kind: "action" as const };
      routeKind = route.kind;
      this.add("player", submittedDeclaration);
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
        });
        this.workingConversation = result.workingState;
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
            narrationStatus = "failed";
            this.add("system", "The action changed the world, but presentation failed. You may retry narration without replaying it.");
          } else throw new Error(result.failure.message);
        } else if (result.narration) this.add("narrator", result.narration);
        else {
          narrationStatus = "failed";
          this.add("system", "The action committed, but narration was unavailable. You may retry narration safely.");
        }
      }
      const planner = await this.replanIfInvalidated().catch((error: unknown) => ({ error: errorMessage(error) }));
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
    }
    return this.view();
  }

  async retryNarration(): Promise<PlaySessionView> {
    if (!this.lastActionRequest) throw new Error("There is no action narration to retry");
    if (this.active) throw new Error("A player turn is already running");
    this.active = true;
    this.lastError = undefined;
    try {
      const result = await this.session.performPlayerAction(this.lastActionRequest, {
        modelRuntime: this.requireModel(),
      });
      if (result.kind === "resolved" && result.narration) this.add("narrator", result.narration);
      else throw new Error("Narration is still unavailable; the committed action was not replayed");
    } catch (error) {
      this.lastError = errorMessage(error);
    } finally {
      this.active = false;
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
    }
    return this.view();
  }

  async save(slotName = "Manual save"): Promise<PlaySessionView> {
    await this.session.save(slotName);
    await this.presentationPersistence?.savePresentation({
      worldId: this.session.worldId,
      narrationPreference: this.preference,
      transcript: this.transcriptEntries,
    });
    this.add("system", `Saved to ${slotName}.`);
    return this.view();
  }
}
