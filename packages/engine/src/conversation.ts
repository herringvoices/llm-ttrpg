import { z } from "zod";
import {
  boundInterpretedIntent,
} from "./action-pressure.js";
import {
  actorOperationProposalSchema,
  communicationActSchema,
  communicationInterpretationSchema,
  conversationTurnRequestSchema,
  conversationWorkingStateSchema,
  durableConversationExtractionSchema,
  materialCommunicationSemanticKindSchema,
  narrationTargetSchema,
  npcDecisionSchema,
  NARRATION_CHARACTER_TARGETS,
  type ActorOperationProposal,
  type CommunicationAct,
  type ConversationStopReason,
  type ConversationTurnRequest,
  type ConversationWorkingState,
  type DurableConversationExtraction,
  type NarrationTarget,
  type NpcDecision,
} from "./conversation-contracts.js";
import {
  contextItemSchema,
  type ContextItem,
  type ContextPackage,
} from "./context-contracts.js";
import { renderContextForModel } from "./context.js";
import { jsonValueSchema, type JsonValue } from "./json.js";
import type { ModelInvocationOptions, ModelRuntime } from "./model-runtime.js";
import { mutationProposalSchema } from "./operations.js";
import type { ResolutionEnvelope } from "./resolution.js";
import type { GameSession } from "./runtime.js";
import { fictionalDurationMs } from "./time.js";
import type { WorldState } from "./world.js";
import { compileNarrationDirective, deriveSceneRegister } from "./presentation.js";
import { tryOrdinaryNpcConversation } from "./conversation-ordinary.js";

export interface ConversationAuthorityBindings {
  readonly recordCommunicationOperationId: string;
  readonly applyConsequencesOperationId: string;
}

export interface PerformConversationTurnInput {
  readonly session: GameSession;
  readonly modelRuntime: ModelRuntime;
  readonly request: ConversationTurnRequest;
  readonly bindings: ConversationAuthorityBindings;
  readonly workingState?: ConversationWorkingState;
  /** LM-05: opt into a short NPC-perspective response before the exceptional path. */
  readonly ordinaryFastPath?: boolean;
  readonly modelOptions?: ModelInvocationOptions;
  readonly onProgress?: (
    phase: "understanding" | "responding" | "updating" | "presenting",
  ) => void;
}

export interface CommittedConversationAction {
  readonly actorId: string;
  readonly toolId: string;
  readonly kind: "ordinary-operation" | "resolution-operation";
  readonly result: JsonValue;
  readonly resolutionPath?: "automatic" | "impossible" | "uncertain";
}

export interface ConversationTurnResult {
  readonly act: CommunicationAct;
  readonly communicationCommitted: boolean;
  readonly decisions: readonly NpcDecision[];
  readonly committedActions: readonly CommittedConversationAction[];
  readonly communicationEventIds: readonly string[];
  readonly extractionEventIds: readonly string[];
  readonly stopReason: ConversationStopReason;
  readonly narrationTarget: NarrationTarget;
  readonly narration?: string;
  readonly narrationError?: string;
  readonly narrationPresentation?: {
    readonly presentationComponent: { readonly id: string; readonly version: string };
    readonly profile: { readonly id: string; readonly version: string };
    readonly protectedGuidanceIncluded: true;
    readonly compiledProfileSize: number;
    readonly selectedExemplarIds: readonly string[];
    readonly sceneRegister: import("./presentation.js").SceneRegister;
    readonly narrationPreference: import("./conversation-contracts.js").NarrationPreference;
    readonly targetBand: NarrationTarget["band"];
    readonly contextOmissions: readonly {
      readonly localId: string;
      readonly decision: "omitted" | "compressed";
      readonly reason: string;
    }[];
    readonly modelElapsedMs: number;
    readonly status: "complete" | "failed";
    readonly presentationKind: "conversation";
  };
  readonly workingState: ConversationWorkingState;
}

export class ConversationValidationError extends Error {
  override readonly name = "ConversationValidationError";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function structuredDecision<T>(
  model: ModelRuntime,
  schemaId: string,
  schema: z.ZodType<T>,
  prompt: {
    readonly instructions: readonly string[];
    readonly context?: string;
    readonly input: string;
  },
  options?: ModelInvocationOptions,
): Promise<T> {
  const result = await model.generate({
    prompt: {
      instructions: [...prompt.instructions],
      ...(prompt.context ? { context: prompt.context } : {}),
      input: prompt.input,
    },
    output: { kind: "structured", schemaId, schema },
    trace: { operation: schemaId },
  }, options);
  if (!result.ok) {
    throw new ConversationValidationError(
      `${schemaId} failed: ${result.error.kind}: ${result.error.message}`,
    );
  }
  if (result.output.kind !== "structured") {
    throw new ConversationValidationError(`${schemaId} returned text`);
  }
  return schema.parse(result.output.value);
}

function extractedQuotes(declaration: string): readonly string[] {
  return [...declaration.matchAll(/"([^"\r\n]+)"/g)].map((match) => match[1]!);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateInterpretation(
  request: ConversationTurnRequest,
  raw: z.infer<typeof communicationInterpretationSchema>,
): CommunicationAct {
  const quotes = extractedQuotes(request.declaration);
  if (!sameStrings(quotes, raw.exactQuoteFragments)) {
    throw new ConversationValidationError(
      "Communication interpretation must preserve every literal player quote exactly",
    );
  }
  if (quotes.length === 0 && raw.inputMode !== "described") {
    throw new ConversationValidationError(
      "Speech without literal quotes must be interpreted as described",
    );
  }
  if (quotes.length > 0 && raw.inputMode === "described") {
    throw new ConversationValidationError(
      "Literal player quotes cannot be downgraded to described speech",
    );
  }
  const allowedMaterial = new Set(request.authorizedMaterialSemanticKinds);
  for (const semantic of raw.semanticKinds) {
    const parsed = materialCommunicationSemanticKindSchema.safeParse(semantic);
    if (parsed.success && !allowedMaterial.has(parsed.data)) {
      throw new ConversationValidationError(
        `Interpretation added unauthorized consequential player intent: ${semantic}`,
      );
    }
  }
  const authorizedTestimony = new Map(
    request.authorizedTestimony.map((item) => [item.id, item]),
  );
  const testimony = raw.testimonyIds.map((id) => {
    const item = authorizedTestimony.get(id);
    if (!item) {
      throw new ConversationValidationError(
        `Interpretation added unauthorized testimony: ${id}`,
      );
    }
    return item;
  });
  const authorizedCommitments = new Set(request.authorizedMaterialCommitments);
  for (const commitment of raw.materialCommitments) {
    if (!authorizedCommitments.has(commitment)) {
      throw new ConversationValidationError(
        `Interpretation added unauthorized player commitment: ${commitment}`,
      );
    }
  }
  if (raw.containsNonSpeechAction !== Boolean(request.authorizedPlayerAction)) {
    throw new ConversationValidationError(
      "Non-speech action interpretation must match the pre-authorized player operation",
    );
  }
  if (raw.deliveryIntent === "deceive" && !request.authorizedDeception) {
    throw new ConversationValidationError(
      "Interpretation added an unauthorized player deception",
    );
  }
  return communicationActSchema.parse({
    id: `${request.turnId}.communication`,
    interactionId: request.interactionId,
    speakerId: request.playerActorId,
    recipientIds: request.recipientIds,
    inputMode: raw.inputMode,
    exactQuoteFragments: raw.exactQuoteFragments,
    semanticKinds: raw.semanticKinds,
    authorizedContent: raw.authorizedContent,
    ...(raw.intendedSocialEffect
      ? { intendedSocialEffect: raw.intendedSocialEffect }
      : {}),
    testimony,
    materialCommitments: raw.materialCommitments,
    deliveryIntent: raw.deliveryIntent,
    groundingIds: testimony.map((item) => item.source.id),
    containsNonSpeechAction: raw.containsNonSpeechAction,
    durationMs: raw.estimatedDurationMs,
  });
}

function actorKnowledgeItems(
  world: WorldState,
  actorId: string,
  workingState: ConversationWorkingState,
): readonly ContextItem[] {
  const access = {
    audience: ["actor" as const],
    perspective: { kind: "actor" as const, id: actorId },
    actorAware: true,
    identityRecognized: true,
    privileged: false,
  };
  const social = world.actorSocialStates.find((item) => item.actorId === actorId);
  const beliefs = world.beliefs
    .filter((item) => item.holder.kind === "actor" && item.holder.id === actorId)
    .map(({ truthStatus: _privateTruthStatus, ...belief }) => belief);
  const localState = workingState.npcStates.find((item) => item.actorId === actorId);
  const visibleTranscript = workingState.recentTranscript.filter((entry) =>
    entry.kind !== "narration" &&
    (entry.speakerId === actorId || entry.audienceIds.includes(actorId))
  );
  return [
    contextItemSchema.parse({
      localId: `conversation.social.${actorId}`,
      kind: "actor-social-state",
      salience: "required",
      content: jsonValueSchema.parse(social ?? {
        actorId,
        goals: [],
        relationships: [],
        memories: [],
        commitments: [],
      }),
      provenance: {
        sourceKind: "tool-result",
        sourceIds: [actorId],
      },
      access,
      derivation: "projected",
      relevance: 100,
    }),
    contextItemSchema.parse({
      localId: `conversation.beliefs.${actorId}`,
      kind: "actor-beliefs",
      salience: "required",
      content: jsonValueSchema.parse(beliefs),
      provenance: {
        sourceKind: "belief",
        sourceIds: beliefs.length > 0 ? beliefs.map((item) => item.id) : [actorId],
      },
      access,
      derivation: "projected",
      relevance: 100,
    }),
    contextItemSchema.parse({
      localId: `conversation.working.${actorId}`,
      kind: "conversation-working-state",
      salience: "required",
      content: jsonValueSchema.parse({
        ...(localState ? { sceneLocalState: localState } : {}),
        compactedSummary: workingState.compactedSummary ?? null,
        recentTranscript: visibleTranscript,
      }),
      provenance: {
        sourceKind: "working-context",
        sourceIds: [workingState.interactionId],
      },
      access,
      derivation: "raw",
      relevance: 100,
    }),
  ];
}

function replaceLocalReferences(
  value: JsonValue,
  references: Readonly<Record<string, string>>,
): JsonValue {
  if (typeof value === "string") return references[value] ?? value;
  if (Array.isArray(value)) {
    return value.map((item) => replaceLocalReferences(item, references));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      replaceLocalReferences(item, references),
    ]));
  }
  return value;
}

function injectActor(value: JsonValue, actorId: string): JsonValue {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new ConversationValidationError("Actor operation arguments must be an object");
  }
  return { ...value, actorId };
}

async function executeActorOperation(
  session: GameSession,
  actorId: string,
  proposalValue: ActorOperationProposal,
  context: ContextPackage,
): Promise<CommittedConversationAction> {
  const proposal = actorOperationProposalSchema.parse(proposalValue);
  const world = session.snapshot();
  const targetIds = proposal.targetRefs.map((reference) => {
    const resolved = context.diagnostics.localReferences[reference];
    if (!resolved) {
      throw new ConversationValidationError(
        `NPC action references unavailable target ${reference}`,
      );
    }
    return resolved;
  });
  const intent = boundInterpretedIntent({
    actorId,
    goal: proposal.goal,
    targetIds,
    requestedHorizonMs: fictionalDurationMs(proposal.requestedHorizonMs),
  }, world.actionPressure);
  if (proposal.estimatedDurationMs > intent.authorizedHorizonMs) {
    throw new ConversationValidationError(
      `NPC action exceeds its Action Pressure horizon (${intent.authorizedHorizonMs}ms)`,
    );
  }
  const canonicalInput = injectActor(
    replaceLocalReferences(proposal.arguments, context.diagnostics.localReferences),
    actorId,
  );
  if (proposal.kind === "ordinary-operation") {
    const result = await session.executeOperation(
      proposal.toolId,
      canonicalInput,
    );
    return {
      actorId,
      toolId: proposal.toolId,
      kind: proposal.kind,
      result: jsonValueSchema.parse(result),
    };
  }
  const envelope = await session.resolve({
    intent,
    operation: { id: proposal.toolId, input: canonicalInput },
  }) as ResolutionEnvelope;
  return {
    actorId,
    toolId: proposal.toolId,
    kind: proposal.kind,
    result: jsonValueSchema.parse(envelope.result),
    resolutionPath: envelope.path,
  };
}

function validateNpcKnowledge(
  decision: NpcDecision,
  world: WorldState,
): void {
  if (decision.disclosure.mode === "none") return;
  const known = new Set<string>();
  for (const fact of world.facts) {
    if (fact.visibility === "public") known.add(fact.id);
  }
  for (const belief of world.beliefs) {
    if (belief.holder.kind === "actor" && belief.holder.id === decision.actorId) {
      known.add(belief.id);
      if (belief.sourceFactId) known.add(belief.sourceFactId);
      for (const source of belief.sources ?? []) known.add(source.id);
    }
  }
  const social = world.actorSocialStates.find((state) =>
    state.actorId === decision.actorId
  );
  for (const memory of social?.memories ?? []) known.add(memory.id);
  for (const id of decision.disclosure.groundingIds) {
    if (!known.has(id)) {
      throw new ConversationValidationError(
        `NPC ${decision.actorId} cannot ground disclosure in unknown record ${id}`,
      );
    }
  }
}

function initialWorkingState(
  request: ConversationTurnRequest,
  prior?: ConversationWorkingState,
): ConversationWorkingState {
  if (prior && prior.interactionId !== request.interactionId) {
    throw new ConversationValidationError(
      "Conversation working state belongs to a different interaction",
    );
  }
  const participantIds = [...new Set([
    ...(prior?.participantIds ?? []),
    request.playerActorId,
    ...request.recipientIds,
    ...request.materialNpcIds,
  ])];
  return conversationWorkingStateSchema.parse({
    interactionId: request.interactionId,
    participantIds,
    beat: prior?.beat ?? 0,
    npcStates: prior?.npcStates ?? [],
    recentTranscript: prior?.recentTranscript ?? [],
    ...(prior?.compactedSummary
      ? { compactedSummary: prior.compactedSummary }
      : {}),
  });
}

export function selectNarrationTarget(
  preferenceValue: ConversationTurnRequest["narrationPreference"],
  complexity: ConversationTurnRequest["beatComplexity"],
): NarrationTarget {
  const band = complexity === "terse"
    ? "small"
    : complexity === "complex"
      ? "large"
      : "medium";
  const [minimumCharacters, maximumCharacters] =
    NARRATION_CHARACTER_TARGETS[preferenceValue][band];
  return narrationTargetSchema.parse({
    preference: preferenceValue,
    band,
    minimumCharacters,
    maximumCharacters,
    hardLimit: false,
  });
}

function chooseStopReason(decisions: readonly NpcDecision[]): ConversationStopReason {
  const priority: readonly ConversationStopReason[] = [
    "answer-expected",
    "meaningful-player-choice",
    "material-circumstance-change",
    "pc-behavior-required",
    "pressure-boundary",
    "no-material-reaction",
    "safety-ceiling",
  ];
  return priority.find((reason) =>
    decisions.some((decision) => decision.stopReason === reason)
  ) ?? "no-material-reaction";
}

function eventIdsAfter(
  beforeIds: ReadonlySet<string>,
  events: readonly { readonly id: string }[],
): readonly string[] {
  return events.filter((event) => !beforeIds.has(event.id)).map((event) => event.id);
}

function validateExtraction(
  extraction: DurableConversationExtraction,
  eventIds: ReadonlySet<string>,
  participantIds: ReadonlySet<string>,
): void {
  for (const proposal of extraction.proposals) {
    for (const eventId of proposal.sourceEventIds) {
      if (!eventIds.has(eventId)) {
        throw new ConversationValidationError(
          `Durable consequence references unavailable event ${eventId}`,
        );
      }
    }
    const mutation = mutationProposalSchema.parse(proposal.mutation);
    if (
      "actorId" in mutation && !participantIds.has(mutation.actorId)
    ) {
      throw new ConversationValidationError(
        `Durable consequence targets non-participant ${mutation.actorId}`,
      );
    }
    if (
      mutation.kind === "upsert-belief" &&
      mutation.belief.holder.kind === "actor" &&
      !participantIds.has(mutation.belief.holder.id)
    ) {
      throw new ConversationValidationError(
        `Durable belief targets non-participant ${mutation.belief.holder.id}`,
      );
    }
  }
}

export async function performConversationTurn(
  input: PerformConversationTurnInput,
): Promise<ConversationTurnResult> {
  const reportProgress = (
    phase: "understanding" | "responding" | "updating" | "presenting",
  ) => {
    try {
      input.onProgress?.(phase);
    } catch {
      // Progress is a non-authoritative observer and cannot interrupt a turn.
    }
  };
  const request = conversationTurnRequestSchema.parse(input.request);
  if (input.ordinaryFastPath) {
    const ordinary = await tryOrdinaryNpcConversation(input);
    if (ordinary) return ordinary;
    // An escalated reply remains a proposal. The existing authoritative
    // conversation flow starts from the same unchanged world snapshot.
  }
  let working = initialWorkingState(request, input.workingState);
  const worldAtStart = input.session.snapshot();
  for (const actorId of [
    request.playerActorId,
    ...request.recipientIds,
    ...request.materialNpcIds,
  ]) {
    if (!worldAtStart.entities.some((entity) => entity.id === actorId)) {
      throw new ConversationValidationError(`Conversation actor not found: ${actorId}`);
    }
  }
  const interpretationContext = input.session.assembleContext({
    role: "orchestrator",
    perspective: { kind: "canonical" },
    focalActorId: request.playerActorId,
    ...(request.locationId ? { locationId: request.locationId } : {}),
    declaration: request.declaration,
    budget: request.budget,
  });
  reportProgress("understanding");
  const interpretation = await structuredDecision(
    input.modelRuntime,
    "conversation.player-communication.v1",
    communicationInterpretationSchema,
    {
      instructions: [
        "Normalize only the speech and non-speech content the player actually authorized.",
        "Preserve every literal quote exactly and do not add a promise, threat, agreement, confession, lie, disclosure, romantic advance, or other consequential intent.",
        `First-person and ${request.playerCharacterName}-name third-person declarations have identical meaning.`,
        "Select testimony only from the explicitly authorized testimony IDs supplied in the input.",
      ],
      context: renderContextForModel(interpretationContext),
      input: JSON.stringify({
        declaration: request.declaration,
        authorizedMaterialSemanticKinds: request.authorizedMaterialSemanticKinds,
        authorizedMaterialCommitments: request.authorizedMaterialCommitments,
        authorizedTestimony: request.authorizedTestimony,
        authorizedDeception: request.authorizedDeception,
        hasPreauthorizedNonSpeechAction: Boolean(request.authorizedPlayerAction),
      }),
    },
    input.modelOptions,
  );
  const act = validateInterpretation(request, interpretation);

  if (
    worldAtStart.actionPressure.status === "unassessed" ||
    worldAtStart.actionPressure.level !== interpretation.pressureLevel
  ) {
    await input.session.applyActionPressureAssessment({
      level: interpretation.pressureLevel,
    });
  }
  const speechIntent = boundInterpretedIntent({
    actorId: request.playerActorId,
    goal: act.authorizedContent,
    targetIds: act.recipientIds,
    requestedHorizonMs: fictionalDurationMs(act.durationMs),
  }, input.session.snapshot().actionPressure);
  if (act.durationMs > speechIntent.authorizedHorizonMs) {
    return {
      act,
      communicationCommitted: false,
      decisions: [],
      committedActions: [],
      communicationEventIds: [],
      extractionEventIds: [],
      stopReason: "pressure-boundary",
      narrationTarget: selectNarrationTarget(
        request.narrationPreference,
        request.beatComplexity,
      ),
      narrationError:
        "Authorized speech did not fit the Action Pressure horizon and was not rewritten or committed.",
      workingState: working,
    };
  }

  const committedActions: CommittedConversationAction[] = [];
  reportProgress("responding");
  if (request.authorizedPlayerAction) {
    if (request.authorizedPlayerAction.actorId !== request.playerActorId) {
      throw new ConversationValidationError(
        "Pre-authorized player action belongs to a different actor",
      );
    }
    const playerAction = await input.session.performPlayerAction(
      request.authorizedPlayerAction,
      { modelRuntime: input.modelRuntime },
    );
    if (playerAction.kind !== "resolved") {
      return {
        act,
        communicationCommitted: false,
        decisions: [],
        committedActions: [],
        communicationEventIds: [],
        extractionEventIds: [],
        stopReason: playerAction.kind === "needs-player-input"
          ? "meaningful-player-choice"
          : "material-circumstance-change",
        narrationTarget: selectNarrationTarget(
          request.narrationPreference,
          request.beatComplexity,
        ),
        narrationError:
          "The pre-authorized non-speech action did not resolve, so communication was not committed.",
        workingState: working,
      };
    }
    committedActions.push(...playerAction.run.receipts.map((receipt) => ({
      actorId: request.playerActorId,
      toolId: receipt.toolId,
      kind: receipt.kind,
      result: receipt.result,
      ...(receipt.resolution ? { resolutionPath: receipt.resolution.path } : {}),
    })));
  }

  const historyBeforeCommunication = await input.session.eventHistory();
  const priorEventIds = new Set(historyBeforeCommunication.map((event) => event.id));
  await input.session.executeOperation(
    input.bindings.recordCommunicationOperationId,
    {
      actorId: request.playerActorId,
      act,
      durationMs: act.durationMs,
      scopeIds: [],
    },
  );
  let allEvents = await input.session.eventHistory();
  const communicationEventIds = [...eventIdsAfter(priorEventIds, allEvents)];
  const beat = working.beat + 1;
  const playerTranscript = {
    beat,
    speakerId: request.playerActorId,
    audienceIds: request.recipientIds,
    kind: "player-act" as const,
    content: act.authorizedContent,
    exactQuoteFragments: act.exactQuoteFragments,
  };
  working = conversationWorkingStateSchema.parse({
    ...working,
    beat,
    recentTranscript: [...working.recentTranscript, playerTranscript],
  });

  const responderIds = [...new Set([
    ...request.recipientIds,
    ...request.materialNpcIds,
  ])].filter((id) => id !== request.playerActorId);
  const decisions: NpcDecision[] = [];
  for (const [index, actorId] of responderIds.entries()) {
    const world = input.session.snapshot();
    const actorContext = input.session.assembleContext({
      role: "actor",
      perspective: { kind: "actor", id: actorId },
      focalActorId: actorId,
      ...(request.locationId ? { locationId: request.locationId } : {}),
      declaration: request.declaration,
      workingContext: {
        interactionId: request.interactionId,
        currentConversationEntityId: request.playerActorId,
        activeEntityIds: working.participantIds,
        recentEntityIds: [],
        aliases: [],
      },
      budget: request.budget,
    }, {
      retrieved: actorKnowledgeItems(world, actorId, working),
    });
    const actorRef = Object.entries(actorContext.diagnostics.localReferences)
      .find(([, canonical]) => canonical === actorId)?.[0];
    if (!actorRef) {
      throw new ConversationValidationError(
        `Material NPC ${actorId} is unavailable in its own actor context`,
      );
    }
    const rawDecision = await structuredDecision(
      input.modelRuntime,
      "conversation.npc-decision.v1",
      npcDecisionSchema,
      {
        instructions: [
          "Reason only from this actor-perspective context and private scene-local working state.",
          "Return structured intent, not final prose. Do not infer another actor's hidden knowledge or make a player-character decision.",
          "A consequential action is only a proposal and must identify an ordinary registered operation or resolution operation.",
          "Use the supplied opaque actor reference and context-local target references.",
        ],
        context: renderContextForModel(actorContext),
        input: JSON.stringify({
          actorRef,
          latestCommunication: act,
          priorSceneLocalState: working.npcStates.find((state) =>
            state.actorId === actorId
          ) ?? null,
        }),
      },
      input.modelOptions,
    );
    const resolvedActorId = actorContext.diagnostics.localReferences[
      rawDecision.actorId
    ] ?? rawDecision.actorId;
    const resolvedSceneActorId = actorContext.diagnostics.localReferences[
      rawDecision.sceneState.actorId
    ] ?? rawDecision.sceneState.actorId;
    const decision = npcDecisionSchema.parse({
      ...rawDecision,
      actorId: resolvedActorId,
      sceneState: { ...rawDecision.sceneState, actorId: resolvedSceneActorId },
    });
    if (decision.actorId !== actorId || decision.sceneState.actorId !== actorId) {
      throw new ConversationValidationError(
        `NPC decision actor does not match selected responder ${actorId}`,
      );
    }
    validateNpcKnowledge(decision, world);
    if (decision.intendedSpeechSemantics) {
      const speechIntent = boundInterpretedIntent({
        actorId,
        goal: decision.intendedSpeechSemantics,
        targetIds: [request.playerActorId],
        requestedHorizonMs: fictionalDurationMs(
          decision.estimatedSpeechDurationMs,
        ),
      }, world.actionPressure);
      if (decision.estimatedSpeechDurationMs > speechIntent.authorizedHorizonMs) {
        throw new ConversationValidationError(
          `NPC speech exceeds its Action Pressure horizon (${speechIntent.authorizedHorizonMs}ms)`,
        );
      }
    }
    decisions.push(decision);
    working = conversationWorkingStateSchema.parse({
      ...working,
      npcStates: [
        ...working.npcStates.filter((state) => state.actorId !== actorId),
        decision.sceneState,
      ],
      recentTranscript: decision.intendedSpeechSemantics
        ? [...working.recentTranscript, {
            beat,
            speakerId: actorId,
            audienceIds: [request.playerActorId],
            kind: "npc-semantics",
            content: decision.intendedSpeechSemantics,
            exactQuoteFragments: [],
          }]
        : working.recentTranscript,
    });
    if (decision.intendedSpeechSemantics) {
      const npcAct = communicationActSchema.parse({
        id: `${request.turnId}.npc-${index + 1}`,
        interactionId: request.interactionId,
        speakerId: actorId,
        recipientIds: [request.playerActorId],
        inputMode: "described",
        exactQuoteFragments: [],
        semanticKinds: decision.speechSemanticKinds,
        authorizedContent: decision.intendedSpeechSemantics,
        ...(decision.intendedSocialEffect
          ? { intendedSocialEffect: decision.intendedSocialEffect }
          : {}),
        testimony: [],
        materialCommitments: [],
        deliveryIntent: decision.disclosure.mode === "deceive"
          ? "deceive"
          : decision.disclosure.mode === "withhold"
            ? "withhold"
            : "honest",
        groundingIds: decision.disclosure.mode === "none"
          ? []
          : decision.disclosure.groundingIds,
        containsNonSpeechAction: Boolean(decision.proposedAction),
        durationMs: decision.estimatedSpeechDurationMs,
      });
      await input.session.executeOperation(
        input.bindings.recordCommunicationOperationId,
        {
          actorId,
          act: npcAct,
          durationMs: decision.estimatedSpeechDurationMs,
          scopeIds: [],
        },
      );
    }
    if (decision.proposedAction) {
      committedActions.push(await executeActorOperation(
        input.session,
        actorId,
        decision.proposedAction,
        actorContext,
      ));
    }
  }

  let extractionEventIds: readonly string[] = [];
  if (request.extractDurableConsequences) {
    reportProgress("updating");
    allEvents = await input.session.eventHistory();
    const eventIds = new Set(allEvents.map((event) => event.id));
    const extraction = await structuredDecision(
      input.modelRuntime,
      "conversation.durable-extraction.v1",
      durableConversationExtractionSchema,
      {
        instructions: [
          "Propose only selective durable consequences justified by canonical communication/action events.",
          "Do not create a memory for every line. Transcript and scene cognition are non-authoritative.",
          "Use existing belief, goal, relationship, memory, and commitment structures only.",
        ],
        input: JSON.stringify({
          participantIds: working.participantIds,
          availableEventIds: [...eventIds],
          recentTranscript: working.recentTranscript,
        }),
      },
      input.modelOptions,
    );
    validateExtraction(
      extraction,
      eventIds,
      new Set(working.participantIds),
    );
    if (extraction.proposals.length > 0) {
      const before = new Set(allEvents.map((event) => event.id));
      await input.session.executeOperation(
        input.bindings.applyConsequencesOperationId,
        {
          actorId: request.playerActorId,
          proposals: extraction.proposals,
          scopeIds: [],
        },
      );
      extractionEventIds = eventIdsAfter(
        before,
        await input.session.eventHistory(),
      );
    }
    if (extraction.compactedSummary) {
      working = conversationWorkingStateSchema.parse({
        ...working,
        compactedSummary: extraction.compactedSummary,
      });
    }
  }

  const stopReason = chooseStopReason(decisions);
  const narrationTarget = selectNarrationTarget(
    request.narrationPreference,
    request.beatComplexity,
  );
  const playerContext = input.session.assembleContext({
    role: "actor",
    perspective: { kind: "actor", id: request.playerActorId },
    focalActorId: request.playerActorId,
    ...(request.locationId ? { locationId: request.locationId } : {}),
    declaration: request.declaration,
    workingContext: {
      interactionId: request.interactionId,
      activeEntityIds: working.participantIds,
      recentEntityIds: [],
      aliases: [],
    },
    budget: request.budget,
  });
  const reversePlayerRefs = new Map(
    Object.entries(playerContext.diagnostics.localReferences)
      .map(([localRef, canonicalId]) => [canonicalId, localRef]),
  );
  const publicDecisions = decisions.map((decision) => ({
    actorRef: reversePlayerRefs.get(decision.actorId) ?? "unavailable-actor",
    responseKind: decision.responseKind,
    intendedSpeechSemantics: decision.intendedSpeechSemantics ?? null,
    committedActionOccurred: committedActions.some((action) =>
      action.actorId === decision.actorId
    ),
  }));
  const conversationElapsedMs = act.durationMs + decisions.reduce(
    (total, decision) => total + decision.estimatedSpeechDurationMs,
    0,
  );
  const pressure = input.session.snapshot().actionPressure;
  if (pressure.status !== "assessed") {
    throw new ConversationValidationError("Conversation narration requires assessed Action Pressure");
  }
  const presentation = input.session.presentation();
  const directive = compileNarrationDirective(
    presentation.narrationProfile,
    deriveSceneRegister({
      kind: "conversation",
      actionPressure: pressure.level,
      authorizedHorizonMs: speechIntent.authorizedHorizonMs,
      elapsedMs: conversationElapsedMs,
    }),
  );
  reportProgress("presenting");
  const narrationResult = await input.modelRuntime.generate({
    prompt: {
      protectedContext: [directive.protectedContext],
      instructions: [
        "Narrate only authorized player speech, observable NPC responses, and committed outcomes supplied here.",
        "Do not add facts, promises, decisions, actions, private cognition, hidden truth status, or player-character behavior.",
        "Preserve every exact player quote verbatim.",
        "Do not invent actionable objects, routes, hazards, witnesses, resources, or clues.",
        `Target ${narrationTarget.minimumCharacters}-${narrationTarget.maximumCharacters} characters (${narrationTarget.preference}/${narrationTarget.band}); this is guidance, never a truncation limit.`,
      ],
      context: renderContextForModel(playerContext),
      input: JSON.stringify({
        playerCommunication: {
          inputMode: act.inputMode,
          exactQuoteFragments: act.exactQuoteFragments,
          semanticKinds: act.semanticKinds,
          authorizedContent: act.authorizedContent,
          materialCommitments: act.materialCommitments,
          deliveryIntent: act.deliveryIntent,
          containsNonSpeechAction: act.containsNonSpeechAction,
        },
        npcResponses: publicDecisions,
        stopReason,
      }),
    },
    output: { kind: "text" },
    trace: { operation: "conversation.narration.v1" },
  }, input.modelOptions);
  let narration: string | undefined;
  let narrationError: string | undefined;
  if (!narrationResult.ok) {
    narrationError = `${narrationResult.error.kind}: ${narrationResult.error.message}`;
  } else {
    narration = narrationResult.output.text;
    for (const quote of act.exactQuoteFragments) {
      if (!narration.includes(quote)) {
        narration = undefined;
        narrationError = `Narration omitted or rewrote exact player quote: ${quote}`;
        break;
      }
    }
  }
  if (narration) {
    working = conversationWorkingStateSchema.parse({
      ...working,
      recentTranscript: [...working.recentTranscript, {
        beat,
        speakerId: request.playerActorId,
        audienceIds: [request.playerActorId],
        kind: "narration",
        content: narration,
        exactQuoteFragments: act.exactQuoteFragments,
      }].slice(-12),
    });
  }

  return {
    act,
    communicationCommitted: true,
    decisions,
    committedActions,
    communicationEventIds,
    extractionEventIds,
    stopReason,
    narrationTarget,
    ...(narration ? { narration } : {}),
    ...(narrationError ? { narrationError } : {}),
    narrationPresentation: {
      presentationComponent: presentation.identity,
      profile: presentation.narrationProfile.identity,
      protectedGuidanceIncluded: true,
      compiledProfileSize: directive.compiledProfileSize,
      selectedExemplarIds: directive.selectedExemplarIds,
      sceneRegister: directive.sceneRegister,
      narrationPreference: narrationTarget.preference,
      targetBand: narrationTarget.band,
      contextOmissions: playerContext.diagnostics.decisions
        .filter((decision): decision is typeof decision & {
          decision: "omitted" | "compressed";
        } => decision.decision !== "included")
        .map((decision) => ({
          localId: decision.localId,
          decision: decision.decision,
          reason: decision.reason,
        })),
      modelElapsedMs: narrationResult.metadata.elapsedMs,
      status: narration ? "complete" : "failed",
      presentationKind: "conversation",
    },
    workingState: working,
  };
}

export function endConversationWorkingState(
  stateValue: ConversationWorkingState,
): ConversationWorkingState {
  const state = conversationWorkingStateSchema.parse(stateValue);
  return conversationWorkingStateSchema.parse({
    ...state,
    npcStates: [],
    recentTranscript: [],
  });
}
